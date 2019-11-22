#include <ap/libwebhare/allincludes.h>


#include "segmentmerger.h"
#include "fieldswriter.h"

namespace Lucene
{

SegmentMergeInfo::SegmentMergeInfo()
{
}

SegmentMergeInfo::SegmentMergeInfo(uint32_t b, TermEnum * te, IndexReader * r)
: termenum(te)
{
        base = b;
        reader = r;
        term = te->GetTerm();
        postings = reader->GetTermPositionsPtr();

        if (reader->HasDeletions())
        {
                uint32_t maxdoc = reader->MaxDoc();
                docmap.resize(maxdoc);
                uint32_t j = 0;
                for (uint32_t i = 0; i < maxdoc; ++i)
                {
                        if (reader->IsDeleted(i))
                            docmap[i] = -1;
                        else
                            docmap[i] = j++;
                }
        }
}

SegmentMergeInfo::~SegmentMergeInfo()
{
}

bool SegmentMergeInfo::operator< (const SegmentMergeInfo & other) const
{
        int comparison = term.CompareTo(other.term);
        if (comparison == 0)
            return base < other.base;
        else
            return comparison < 0;
}

bool SegmentMergeInfo::Next()
{
        if (termenum->Next())
        {
                term = termenum->GetTerm();
                return true;
        }
        else
        {
                term = Term();
                return false;
        }
}

SegmentMerger::SegmentMerger(Blex::ComplexFileSystem * dir, const std::string & name)
: segment(name)
{
        directory = dir;
}

SegmentMerger::~SegmentMerger()
{
        for (std::vector<IndexReader *>::iterator it = readers.begin(); it != readers.end(); ++it)
            delete *it;
}

void SegmentMerger::Add(IndexReader * reader)
{
        readers.push_back(reader);
}

uint32_t SegmentMerger::Merge()
{
        uint32_t value = MergeFields();
        MergeTerms();
        MergeNorms();

//        for (uint32_t i = 0; i < readers.size(); ++i)
//            readers[i]->Close();

        return value;
}

uint32_t SegmentMerger::MergeFields()
{
        fieldinfos = FieldInfos();

        uint32_t doccount = 0;
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                fieldinfos.Add(readers[i]->GetFieldNames(true), true);
                fieldinfos.Add(readers[i]->GetFieldNames(false), false);
        }
        fieldinfos.Write(*directory, segment + ".fnm");

        FieldsWriter fieldswriter(*directory, segment, fieldinfos);
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                uint32_t maxdoc = readers[i]->MaxDoc();
                for (uint32_t j = 0; j < maxdoc; ++j)
                    if (!readers[i]->IsDeleted(j))
                {
                        const std::unique_ptr<Document> doc(readers[i]->GetDocument(j));
                        fieldswriter.AddDocument(*doc);
                        doccount++;
                }
        }
        return doccount;
}

void SegmentMerger::MergeTerms()
{
        freqoutput.reset(directory->OpenFile(segment + ".frq",true,true));
        proxoutput.reset(directory->OpenFile(segment + ".prx",true,true));
        if (!freqoutput.get() || !proxoutput.get())
            throw LuceneException("Unable to open frq/prx output files for merged segment " + segment,false);

        const std::unique_ptr<TermInfosWriter> terminfoswriter(new TermInfosWriter(*directory, segment, fieldinfos));
        MergeTermInfos(terminfoswriter.get());
}

void SegmentMerger::MergeTermInfos(TermInfosWriter *terminfoswriter)
{
        uint32_t base = 0;
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                std::shared_ptr<SegmentMergeInfo> smi(new SegmentMergeInfo(base, readers[i]->Terms(), readers[i]));
                base += readers[i]->NumDocs();
                if (smi->Next())
                    queue.insert(smi);
        }

        SegmentMergeInfoList match;
        match.resize(readers.size());

        while (queue.size() > 0)
        {
                uint32_t matchsize = 0;
                match[matchsize++] = *queue.begin();
                queue.erase(queue.begin());
                Term term = match[0]->term;

                while (!queue.empty() && (term.CompareTo((*queue.begin())->term) == 0))
                {
                        match[matchsize++] = *queue.begin();
                        queue.erase(queue.begin());
                }

                MergeTermInfo(terminfoswriter, match, matchsize);

                while (matchsize > 0)
                {
                        std::shared_ptr<SegmentMergeInfo> smi = match[--matchsize];
                        if (smi->Next())
                            queue.insert(smi);
                }
        }
}

void SegmentMerger::MergeTermInfo(TermInfosWriter *terminfoswriter, const SegmentMergeInfoList & smis, uint32_t n)
{
        uint32_t freqpointer = freqoutput->GetOffset();
        uint32_t proxpointer = proxoutput->GetOffset();

        uint32_t df = AppendPostings(smis, n);

        if (df > 0)
            terminfoswriter->Add(smis[0]->term, TermInfo(df, freqpointer, proxpointer));
}

uint32_t SegmentMerger::AppendPostings(const SegmentMergeInfoList & smis, uint32_t n)
{
        uint32_t lastdoc = 0;
        uint32_t df = 0;
        for (uint32_t i = 0; i < n; ++i)
        {
                std::shared_ptr<TermDocs> postings = smis[i]->postings;
                uint32_t base = smis[i]->base;
                std::vector<int32_t> & docmap = smis[i]->docmap;
                postings->Seek(smis[i]->termenum.get());
                while (postings->Next())
                {
                        uint32_t doc = postings->Doc();
                        if (docmap.size() > 0)
                            doc = docmap[doc];
                        doc += base;

                        if (doc < lastdoc)
                            throw LuceneException("docs out of order",true);

                        uint32_t doccode = (doc - lastdoc) << 1;
                        lastdoc = doc;

                        uint32_t freq = postings->Freq();
                        if (freq == 1)
                            freqoutput->WriteLsb<uint32_t>(doccode | 1);
                        else
                        {
                                freqoutput->WriteLsb<uint32_t>(doccode);
                                freqoutput->WriteLsb<uint32_t>(freq);
                        }

                        uint32_t lastposition = 0;
                        uint32_t position;
                        for (uint32_t j = 0; j < freq; ++j)
                        {
                                position = postings->NextPosition();
                                proxoutput->WriteLsb<uint32_t>(position - lastposition);
                                lastposition = position;
                        }

                        df++;
                }
        }
        return df;
}

void SegmentMerger::MergeNorms()
{
        std::string normsfile = segment + ".nrm";
        const std::unique_ptr<Blex::ComplexFileStream> output(directory->OpenFile(normsfile,true,true));

        for (uint32_t i = 0; i < fieldinfos.Size(); ++i)
        {
                for (uint32_t j = 0; j < readers.size(); ++j)
                {
                        IndexReader * reader = readers[j];
                        Blex::PodVector< uint8_t > norms = reader->Norms(fieldinfos.FieldName(i));
                        uint32_t maxdoc = reader->MaxDoc();
                        for (uint32_t k = 0; k < maxdoc; ++k)
                        {
                                uint8_t norm = (norms.size() > 0) ? norms[k] : 0;
                                if (!reader->IsDeleted(k))
                                    output->WriteLsb<uint8_t>(norm);
                        }
                }
        }
}

} // namespace Lucene

