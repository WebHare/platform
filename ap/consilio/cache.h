#ifndef blex_consilio_index_cache
#define blex_consilio_index_cache

#include "term.h"
#include "terminfo.h"
#include "norms.h"
#include "fieldinfo.h"

class SegmentCacheRef;
class SegmentsCache;

/** This structure contains a cache with the non-mutable contents
    of a segment.
*/
class SegmentCache
{
    private:
        SegmentsCache *cache;
        signed refcount;

    public:
        SegmentCache(SegmentsCache *cache, std::string const &segname, Blex::ComplexFileSystem &directory);

        /// Name of the segment
        std::string segment;

        /// Fieldinfos
        std::unique_ptr< Lucene::FieldInfos > fieldinfos;

        /// Store for index (<tt>.tii</tt>) Term%s
        std::vector< Lucene::Term> indexterms;

        /// Store for TermInfo%s for index (<tt>.tii</tt>) Term%s
        std::vector< Lucene::TermInfo > indexinfos;

        /// Positions within the .tis file for index (<tt>.tii</tt>) Term%s
        std::vector< uint32_t > indexpointers;

        /// Normalization factor store
        Lucene::NormsMap norms;

        Blex::PodVector< uint8_t > const & GetNorms(const std::string & field);

    private:
        Blex::Mutex initmutex;
        Blex::PodVector< uint8_t > emptyvector;
        std::shared_ptr< Blex::ComplexFileStream > normsstream;

        uint32_t maxdoc;

        void InitializeFieldInfos(Blex::ComplexFileSystem &directory);
        void InitializeIndex(Blex::ComplexFileSystem &directory);
        void InitializeNorms(Blex::ComplexFileSystem &directory);

        friend class SegmentCacheRef;
};

/** Reference to the cache of a specific segment
*/
class SegmentCacheRef
{
    private:
        SegmentCache *segment;

        void Set(SegmentCache *rhs_segment);

    public:
        SegmentCacheRef();
        explicit SegmentCacheRef(SegmentCache *rhs_segment);
        ~SegmentCacheRef();
        SegmentCacheRef(SegmentCacheRef const &rhs);
        SegmentCacheRef & operator =(SegmentCacheRef const &rhs);

        SegmentCache & operator *() { return *segment; }
        SegmentCache const & operator *() const { return *segment; }

        inline SegmentCache * operator ->() { return segment; }
        inline SegmentCache const * operator ->() const { return segment; }

        SegmentCache const *get()
        {
                return segment;
        }

        void Swap(SegmentCacheRef &rhs);
        bool Valid() const { return segment != 0; }

        friend class SegmentsCache;
};

/** This structure contains all the caches of for all the segments
*/
class SegmentsCache
{
    private:
        struct Data
        {
                std::map< std::string, SegmentCacheRef > cache;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData lockeddata;

        typedef Blex::Mutex MutexType;
        MutexType refmutex;

    public:
        SegmentsCache();
        ~SegmentsCache();

        SegmentCacheRef GetSegment(std::string const &segmentname, Blex::ComplexFileSystem &directory);

        void EvictSegment(std::string const &segmentname);

        void Clear();

        void SetValidSegments(std::vector< std::string > const &segments);

    private:
        friend class SegmentCacheRef;
        friend class SegmentCache;
};


#endif
