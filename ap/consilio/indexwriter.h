#ifndef blex_consilio_index_indexwriter
#define blex_consilio_index_indexwriter

#include "segmentinfo.h"
#include "segmentreader.h"
#include "document.h"
#include "similarity.h"

namespace Lucene
{

const unsigned MergeFrequency = 30; //minimum time between merges in seconds

/** Writer for an index. */
class IndexWriter
{
    public:
        /** Create a new IndexWriter.
            @param commit_lock The Blex::Mutex that prevents multiple processes
                               from reading/writing the segments file at once (see
                               Consilio documentation for details)
            @param directory The Blex::ComplexFileSystem the index resides in
            @param create Create a new index from scratch (delete any existing
                          index files from @c d */
        IndexWriter(Blex::Mutex &commit_lock, Blex::ComplexFileSystem &d, Blex::ComplexFileSystem &ramfs, SegmentsCache &cache, bool create);
        ~IndexWriter();

        /** Get the size of the index (the total number of Document%s, including
            deleted Document%s).
            @return The index size */
        uint32_t DocCount();

        /** Add a new Document.
            @param doc The Document to add */
        void AddDocument(const std::string & id, const Document & doc);

        /** Optimize the index (merge all segments into one segment). */
        void Optimize();

        /// The maximum number of terms for one field
        uint32_t maxfieldlength;

    private:
        /** Get a name for a new segment.
            @return A segment name */
        std::string NewSegmentName();

        /** Merge segments in memory with segments on disk. After this action, no
            more RAM segments exits in the index. */
        void FlushRamSegments();
        /** Try to merge segments. For more information about automatic merging
            of segment, see the Consilio documentation. */
        void MaybeMergeSegments();
        /** Merge segments until there are @c minsegment segments remaining.
            @param minsegment The target number of segments */
        void MergeSegments(int32_t minsegment);

        /// The Blex::ComplexFileSystem the index resides in
        Blex::ComplexFileSystem &directory;
        /// The Blex::ComplexFileSystem that can be used for temporary indices
        Blex::ComplexFileSystem &ramdirectory;
        /// The Similarity used to calculate normalization factors
        Similarity &similarity;
        /// Information about the segments
        const std::unique_ptr<SegmentInfos> segmentinfos;
        /// Lock for committing changes to the segments file
        Blex::Mutex &commit_lock;
        /// Segments cache, for setting new list of valid segments
        SegmentsCache &cache;
        /// Deadline for the next merge. If Min, no merges are scheduled yet
        Blex::DateTime mergedeadline;

        SegmentList deletionsegments;
};

} // namespace Lucene

#endif

