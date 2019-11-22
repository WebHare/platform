#include <ap/libwebhare/allincludes.h>

#include "indexwriter.h"
#include "documentwriter.h"
#include "segmentmerger.h"

namespace Lucene
{

IndexWriter::IndexWriter(Blex::Mutex &_commit_lock, Blex::ComplexFileSystem &d, Blex::ComplexFileSystem &ramfs, SegmentsCache &_cache, bool create)
: maxfieldlength(MAX_FIELD_LENGTH)
, directory(d)
, ramdirectory(ramfs)
, similarity(Similarity::GetDefault())
, segmentinfos(new SegmentInfos())
, commit_lock(_commit_lock)
, cache(_cache)
, mergedeadline(Blex::DateTime::Min())
{
        Blex::Mutex::AutoLock lock(commit_lock);
        DEBUGSEGMENTSPRINT("IndexWriter::IndexWriter got commit lock");
        if (create)
        {
                segmentinfos->Write(directory, cache, lock);
//                directory.Flush();
        }
        else
        {
                segmentinfos->Read(directory,lock);
        }
        DEBUGSEGMENTSPRINT("IndexWriter::IndexWriter releasing commit lock");
}


IndexWriter::~IndexWriter()
{
        FlushRamSegments();

        // If there hasn't been a merge, ther might still be segments with soft deletions left, so clear them up
        for (SegmentList::iterator it = deletionsegments.begin(); it != deletionsegments.end(); ++it)
        {
                // Make sure deletions are written to disk
                (*it)->FlushMergeDeletions();
                // Delete the reader, writing deletions to disk
                delete *it;
        }

//        directory.Flush();
}

uint32_t IndexWriter::DocCount()
{
        return segmentinfos->DocCount();
}

void IndexWriter::AddDocument(const std::string & id, const Document & doc)
{
        // Indexing the document with given id
        Term todelete("id", id);
        // Find the segment(s) containing the document
        for (uint32_t i = 0; i < segmentinfos->segments.size(); ++i)
        {
                SegmentInfo si = segmentinfos->Info(i);

                // Create a new reader
                SegmentReader * reader = new SegmentReader(commit_lock, si, cache);

                // Open a term docs reader to find the given id term
                const std::unique_ptr<TermDocs> termdocs(new SegmentTermDocs(reader, false));
                termdocs->Seek(todelete);

                // While there is a matching document
                uint32_t n = 0;
                while (termdocs->Next())
                {
                        // Do a soft delete of this document (cached in deleted document, won't be written to disc when reader
                        // is deleted)
                        reader->DoMergeDelete(termdocs->Doc());
                        n++;
                }

                if (n > 0)
                {
                        // There are deleted documents within this reader, so keep a reference to the reader
                        deletionsegments.push_back(reader);
                        // Reset internal term enumerators
                        reader->ResetTerms();
                }
                else
                {
                        // No deleted documents, delete and close the reader
                        delete reader;
                }
        }

        // Create a document writer for the new document
        DocumentWriter dw(ramdirectory, similarity, maxfieldlength);

        // Create a new segment and add the document to it
        std::string segmentname = NewSegmentName();
        dw.AddDocument(segmentname, doc);

        // Add the new segment to the list of segments
        segmentinfos->segments.push_back(SegmentInfo(segmentname, 1, &ramdirectory));

        // Possibly merge segments.
        MaybeMergeSegments();
}

void IndexWriter::Optimize()
{
        FlushRamSegments();
        while (segmentinfos->segments.size() > 1 ||
               (segmentinfos->segments.size() == 1 &&
                (SegmentReader::HasDeletions(segmentinfos->Info(0)) ||
                  segmentinfos->Info(0).dir != &directory)))
        {
                int32_t minsegment = segmentinfos->segments.size() - MERGE_FACTOR;
                MergeSegments(minsegment < 0 ? 0 : minsegment);
        }
}

std::string IndexWriter::NewSegmentName()
{
        // This is not thread-safe, but the Consilio server only allows one request using IndexWriter at a time using
        // GetCategoryRunPermission, which essentially provides the locking around the segment counter
        std::string name = "_";
        Blex::EncodeNumber(segmentinfos->counter++, 36, std::back_inserter(name));
        std::transform(name.begin(), name.end(), name.begin(), tolower);
        DEBUGPRINT("Generated name " << name);
        return name;
}

void IndexWriter::FlushRamSegments()
{
        int32_t minsegment = segmentinfos->segments.size() - 1;
        uint32_t doccount = 0;

        while ((minsegment >= 0) && (segmentinfos->Info(minsegment).dir == &ramdirectory))
        {
                doccount += segmentinfos->Info(minsegment).doccount;
                minsegment--;
        }

        if ((minsegment < 0) ||
            ((doccount + segmentinfos->Info(minsegment).doccount) > MIN_MERGE_DOCS) ||
            !(segmentinfos->Info(segmentinfos->segments.size()-1).dir == &ramdirectory))
            minsegment++;

        if (minsegment >= (int32_t)segmentinfos->segments.size())
            return;

        MergeSegments(minsegment);
}

void IndexWriter::MaybeMergeSegments() //ADDME: Consilio main thread should periodically force a merge
{
        if(mergedeadline == Blex::DateTime::Min())
              mergedeadline = Blex::DateTime::Now() + Blex::DateTime::Seconds(MergeFrequency);
        else if(Blex::DateTime::Now() < mergedeadline)
              return; //not our time to merge yet.

//std::stringstream str;str << "**before: "; for (int i = 0; i < segmentinfos->segments.size(); ++i) str << i << ":" << segmentinfos->Info(i).doccount << " "; DEBUGPRINT(str.str());
        uint32_t targetmergedocs = MIN_MERGE_DOCS;
        while (targetmergedocs <= MAX_MERGE_DOCS)
        {
                // Find segments smaller than current target size
                int32_t minsegment = segmentinfos->segments.size();
                uint32_t mergedocs = 0;
                while (--minsegment >= 0)
                {
                        if (segmentinfos->Info(minsegment).doccount >= targetmergedocs)
                            break;
                        mergedocs += segmentinfos->Info(minsegment).doccount;
                }

                if (mergedocs >= targetmergedocs) // found a merge to do
                    MergeSegments(minsegment+1);
                else
                    break;

                targetmergedocs *= MERGE_FACTOR; // increase target size
        }
        mergedeadline = Blex::DateTime::Min();
//std::stringstream str2;str2 << "**after : "; for (int i = 0; i < segmentinfos->segments.size(); ++i) str2 << i << ":" << segmentinfos->Info(i).doccount << " "; DEBUGPRINT(str2.str());
}

void IndexWriter::MergeSegments(int32_t minsegment)
{
        // If we got here, we're going to merge segments

        // Get a new segment name
        std::string mergedname = NewSegmentName();
        // Create the segment merger
        std::unique_ptr<SegmentMerger> merger(new SegmentMerger(&directory, mergedname));

        // Keep a list of segments that will be deleted from the index and disk
        SegmentList segmentstodelete;
        for (uint32_t i = minsegment; i < segmentinfos->segments.size(); ++i)
        {
                SegmentInfo si = segmentinfos->Info(i);
                DEBUGPRINT("Add segment to merge: " << si.name << " (" << si.doccount << " docs)");
                // Check if we already have a reader for this segment in the deletionsegments list
                SegmentReader * reader = NULL;
                for (SegmentList::iterator it = deletionsegments.begin(); it != deletionsegments.end(); ++it)
                {
                        if ((*it)->GetSegmentName() == si.name)
                        {
                                // Take the reader reference
                                reader = *it;
                                // Delete it from the list, the merger will take care of it now
                                deletionsegments.erase(it);
                                break;
                        }
                }
                if (!reader)
                {
                        // The segment doesn't have soft deletions, so create a new reader for this segment
                        reader = new SegmentReader(commit_lock, si, cache);
                }
                // Add the reader to the merger. The merger will delete the reader object upon destruction
                merger->Add(reader);
                // In theory, we might be able to merge segments from other locations, so check to be sure
                if (&reader->GetDirectory() == &directory || &reader->GetDirectory() == &ramdirectory)
                    segmentstodelete.push_back(reader);
        }

        // At this point, the merger has references to the readers for the segments that are going to be merged, segments
        // with soft deletions that are not going to be merged, are still in deletionsegments. The segments with soft
        // deletions will not write to disk when destroyed, but will return deleted documents.

        // Merge the segments
        // This will write the merged segment files directly to disk. The segments information isn't updated on disk yet.
        uint32_t mergeddoccount = merger->Merge();
        DEBUGPRINT("Merged segments into new segment: " << mergedname << " (" << mergeddoccount << " docs)");

        // Delete everything at pos #minsgement until the end
        segmentinfos->segments.erase(segmentinfos->segments.begin() + minsegment, segmentinfos->segments.end());

        // This will hold the merged segment if it doesn't contain documents and should be deleted
        std::unique_ptr<SegmentReader> merged;
        if (mergeddoccount > 0)
        {
                // If there are merged documents, add the segment to the list of segments
                segmentinfos->segments.push_back(SegmentInfo(mergedname, mergeddoccount, &directory));
        }
        else
        {
                // We only merged segments with deleted documents, so the merged segment is empty will have to be deleted
                // from disk
                merged.reset(new SegmentReader(commit_lock, SegmentInfo(mergedname, mergeddoccount, &directory), cache));
                segmentstodelete.push_back(merged.get());
        }

        // Collect files to delete for each segment to delete
        std::vector< std::pair< Blex::ComplexFileSystem *, std::string > > filestodelete;
        for (uint32_t i = 0; i < segmentstodelete.size(); ++i)
        {
                DEBUGPRINT("Deleting segment " << segmentstodelete[i]->GetSegmentName());
                std::vector< std::string > sf = segmentstodelete[i]->Files();
                for (std::vector< std::string >::iterator it = sf.begin(); it != sf.end(); ++it)
                    filestodelete.push_back(std::make_pair(&segmentstodelete[i]->GetDirectory(), *it));
//                filestodelete.insert(filestodelete.end(), sf.begin(), sf.end());

                // Remove the segment from the segment cache
                cache.EvictSegment(segmentstodelete[i]->GetSegmentName());
        }

        {
                // Take the commit lock to write segment information
                Blex::Mutex::AutoLock lock(commit_lock);
                DEBUGSEGMENTSPRINT("IndexWriter::MergeSegments got commit lock");

                // Delete merger before trying to delete the segments
                // This will delete the reader objects for the merged segments. Segments with soft deletions don't have to
                // and will not write their deletions to disk. Normal segments won't have any newly deleted documents and
                // will also not write their deletions to disk (if they already have deletions, the .del file will have been
                // returned by ->Files() above and will be deleted below)
                merger.reset();
                merged.reset();

                // Write the new segments to disk
                segmentinfos->Write(directory, cache, lock);

                // Delete the segment files on disk
                for (uint32_t i = 0; i < filestodelete.size(); ++i)
                    filestodelete[i].first->DeletePath(filestodelete[i].second);
//                directory.Flush();
                DEBUGSEGMENTSPRINT("IndexWriter::MergeSegments releasing commit lock");
        }

        // If there are unmerged segments with soft deletions, flush them to disk
        // Deletion of the reader will take the commit_lock, so this has to be done outside the locked block above. This
        // means that between the release of the lock above and the deletion of the reader, there is a small window in which
        // an added document will be returned twice if the original document isn't merged away.
        for (SegmentList::iterator it = deletionsegments.begin(); it != deletionsegments.end(); ++it)
        {
                // Make sure deletions are written to disk
                (*it)->FlushMergeDeletions();
                // Delete the reader, writing deletions to disk
                delete *it;
        }
        deletionsegments.clear();
}

} // namespace Lucene
