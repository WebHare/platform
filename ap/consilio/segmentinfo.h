#ifndef blex_consilio_index_segmentinfo
#define blex_consilio_index_segmentinfo

#include <blex/complexfs.h>

class SegmentsCache;

namespace Lucene
{

/** Information about a segment. */
struct SegmentInfo
{
        /** Create and initialize a SegmentInfo.
            @param name The name of the segment
            @param doccount The number of Document%s
            @param dir The directory the index resides in */
        SegmentInfo(const std::string & name, uint32_t doccount, Blex::ComplexFileSystem *dir);

        /// The name of the segment
        std::string name;
        /// The number of Document%s in the segment
        uint32_t doccount;
        /// The directory the index resides in
        Blex::ComplexFileSystem *dir;
};

/** A reader and writer for the segments file. */
class SegmentInfos
{
    public:
        SegmentInfos();

        /** Get information about a segment.
            @param i The segment number to retrieve the information for
            @return Information about a segment */
        const SegmentInfo & Info(uint32_t i);

        /** Read segment information from the directory
            @param directory Blex::ComplexFileSystem to read from
            @param commit_lock_ref Commit lock (to ensure that a lock was taken out before reading segments) */
        void Read(Blex::ComplexFileSystem & directory, Blex::Mutex::AutoLock const &commit_lock_ref);
        /** Write segment information to a directory
            @param directory Blex::ComplexFileSystem to write to
            @param commit_lock_ref Commit lock (to ensure that a lock was taken out before writing segments) */
        void Write(Blex::ComplexFileSystem &directory, SegmentsCache &cache, Blex::Mutex::AutoLock const &commit_lock_ref);

        /** Get the generation counter (to be called after ::Read or ::Write). This
            is generally the number of changes made to the index.
            @return The current version of the index */
        uint32_t GetVersion();
        /** Read the generation counter of an index on disk.
            @return The current version of the index */
        static uint32_t ReadVersion(Blex::ComplexFileSystem * directory);

        /** Get the total number of Document%s (including deleted Document%s) in
            the index.
            @return The index size */
        uint32_t DocCount();

        /// The list of segments
        std::vector<SegmentInfo> segments;
        /// The number to use for generating a new segment's name
        uint32_t counter;

    private:
        /// The Consilio version of this index
        uint32_t indexversion;
        /// The generation counter of the index
        uint32_t version;
};

} // namespace Lucene

#endif

