#ifndef blex_consilio_index_segmentmerger
#define blex_consilio_index_segmentmerger

#include "fieldinfo.h"
#include "term.h"
#include "terminfos.h"
#include "indexreader.h"
#include "segmentreader.h"

namespace Lucene
{

/** Information about a segment to merge. */
class SegmentMergeInfo
{
    public:
        /** Create an uninitialized SegmentMergeInfo. */
        SegmentMergeInfo();
        /** Create an initialized SegmentMergeInfo.
            @param b Base Document number
            @param te Term enumerator for the segment
            @param r IndexReader for the segment */
        SegmentMergeInfo(uint32_t b,
            TermEnum * te,
            IndexReader * r);
        ~SegmentMergeInfo();

        bool operator< (const SegmentMergeInfo & other) const;

        /** Skip to the next Term.
            @return If there was a next Term */
        bool Next();

        /// Current Term
        Term term;
        /// Base Document number
        uint32_t base;
        /// Term enumerator for the segment to merge
        const std::unique_ptr<TermEnum> termenum;
        /// IndexReader for the segment to merge
        IndexReader * reader;
        /// Documents and positions for the segment to merge
        std::shared_ptr<TermDocs> postings;
        /// Mapping of this segment's Document numbers to the merged segment's
        std::vector<int32_t> docmap;
};

/** A function object to compare SegmentMergeInfo%s.
    less_SMI is used as the sorting criterion for the SegmentMergeQueue.

    SegmentMergeInfo%s are sorted first by Term, then by base Document number. */
class less_SMI
{
    public:
        bool operator() (const std::shared_ptr<SegmentMergeInfo> & smi1, const std::shared_ptr<SegmentMergeInfo> & smi2) const
        {
                return *smi1.get() < *smi2.get();
        }
};

/** A Queue for segments to be merged. */
typedef std::multiset<std::shared_ptr<SegmentMergeInfo>, less_SMI> SegmentMergeQueue;

/** Create a new segment and merge existing segments into the new segment. */
class SegmentMerger
{
    public:
        /** Create a SegmentMerger.
            @param dir The Blex::ComplexFileSystem to create the new segment in
            @param name The name of the new segment to merge into */
        SegmentMerger(Blex::ComplexFileSystem * dir, const std::string & name);
        ~SegmentMerger();

        /** Add a segment to the list of segments to merge.
            @param reader IndexReader for the segment to merge */
        void Add(IndexReader * reader);

        /** Merge all segments into the new segment.
            @return The number of Document%s in the new segment */
        uint32_t Merge();

    private:
        /** A list of segments to merge. */
        typedef std::vector<std::shared_ptr<SegmentMergeInfo> > SegmentMergeInfoList;

        /** Merge the Field%s of the segments.
            @return The number of Document%s in the new segment */
        uint32_t MergeFields();
        /** Merge the Term%s of the segments. */
        void MergeTerms();
        /** Merge all Term%s and write them to a @c terminfoswriter.
            @param terminfoswriter The TermInfosWriter to write the Term%s to */
        void MergeTermInfos(TermInfosWriter *terminfoswriter);
        /** Merge the current Term from the segments in @smis and write them to a
            @c terminfoswriter.
            @param terminfoswriter The TermInfosWriter to write the Term%s to
            @param smis The list of segments to merge
            @param n The number of segments in the list */
        void MergeTermInfo(TermInfosWriter *terminfoswriter, const SegmentMergeInfoList & smis, uint32_t n);
        /** Add Document%s and positions to the .frq and .prx file for a list of
            segments.
            @param smis The list of segments to merge
            @param n The number of segments in the list
            @return The number of Document%s that contain the current Term (the
                    Document frequency of the current Term) */
        uint32_t AppendPostings(const SegmentMergeInfoList & smis, uint32_t n);
        /** Merge the Field normalization factors of the segments. */
        void MergeNorms();

        /// The Blex::ComplexFileSystem the index resides in
        Blex::ComplexFileSystem * directory;
        /// The name of the new segment
        const std::string & segment;

        /// IndexReader%s for each of the segments to merge
        std::vector<IndexReader *> readers;
        /// Information about the Field%s in the merged segment
        FieldInfos fieldinfos;

        /// Stream to write frequencies to
        std::unique_ptr<Blex::ComplexFileStream> freqoutput;
        /// Stream to write positions to
        std::unique_ptr<Blex::ComplexFileStream> proxoutput;
        /// The segments to merge
        SegmentMergeQueue queue;
};

} // namespace Lucene

#endif

