#ifndef blex_consilio_index_segmentsreader
#define blex_consilio_index_segmentsreader

#include "indexreader.h"
#include "segmentinfo.h"
#include "segmentreader.h"
#include "segmentmerger.h"
#include "document.h"

namespace Lucene
{

/** A reader for multiple segments.
    This SegmentsReader takes care of mapping the complete Document number range
    of the index to the different segments. */
class SegmentsReader : public IndexReader
{
    public:
        /** Create a new SegmentsReader that reads through multiple segments.
            @param sis Information about the segments
            @param d The Blex::ComplexFileSystem the index resides in
            @param r A list of SegmentReader%s */
        SegmentsReader(std::shared_ptr<SegmentInfos> sis, Blex::ComplexFileSystem * d, SegmentList r);
        ~SegmentsReader();

        virtual uint32_t NumDocs();
        virtual uint32_t MaxDoc();

        virtual Document * GetDocument(uint32_t doc);
        virtual bool IsDeleted(uint32_t doc);
        virtual bool HasDeletions();
        virtual void DoDelete(uint32_t doc);

        /** Get the segment number of the segment which contains a given Document.
            @param doc The Document to look up
            @return The segment the Document can be found in */
        uint32_t ReaderIndex(uint32_t doc);

        virtual Blex::PodVector< uint8_t > const & Norms(const std::string & field);
        virtual void SetNorm(uint32_t doc, const std::string & field, uint8_t value);

        virtual TermEnum * Terms();
        virtual TermEnum * Terms(const Term & term);
        virtual TermDocs * GetTermDocs();
        virtual std::shared_ptr<TermDocs> GetTermPositionsPtr();
        virtual TermDocs * GetTermPositions();

        virtual int32_t DocFreq(const Term & term);

        virtual std::set<std::string> GetFieldNames();
        virtual std::set<std::string> GetFieldNames(bool indexed);

    private:
        /// The SegmentReader%s that read the segments
        SegmentList readers;
        /// Base Document numbers for each segment
        std::vector<uint32_t> starts;

        /** A mapping of Field names to normalization factors. */
        typedef std::map<std::string, Blex::PodVector< uint8_t > > NormsMap;
        /// Normalization factor cache
        NormsMap normscache;

        /// Total number of Document%s
        uint32_t maxdoc;
        /// Number of existing (undeleted) Document%s, or -1 if the number should
        /// be recalculated
        int32_t numdocs;
        /// Does this index contain deleted Document%s?
        bool hasdeletions;
};

/** A TermEnum for multiple segments. */
class SegmentsTermEnum : public TermEnum
{
    public:
        /** Create a new Term enumerator for multiple segments.
            @param readers The segments to read Term%s for
            @param starts Base Document numbers for each segments
            @param term An optional Term to seek to */
        SegmentsTermEnum(const SegmentList & readers, const std::vector<uint32_t> & starts, const Term & term = Term());
        ~SegmentsTermEnum();

        virtual bool Next();
        virtual Term GetTerm();
        virtual int32_t DocFreq();

    private:
        /// The list of segments to read
        SegmentMergeQueue queue;
        /// The current Term
        Term term;
        /// The number of Document%s that contain the current term
        int32_t docfreq;
};

/** A list of Document%s containing a certain Term in multiple segments.
    SegmentsTermDocs can also be used to retrieve the positions of the Term in
    the Document%s. */
class SegmentsTermDocs : public TermDocs
{
    public:
        /** Create a new list of Document%s.
            @param readers The segments to read Term%s for
            @param starts Base Document numbers for each segments
            @param positions Set to true to also retrieve positions */
        SegmentsTermDocs(const SegmentList & readers, const std::vector<uint32_t> & starts, bool positions);
        ~SegmentsTermDocs();

        virtual uint32_t Doc();
        virtual uint32_t Freq();

        virtual void Seek(const Term & term);
        virtual void Seek(TermEnum * termenum);

        virtual bool Next();
        virtual uint32_t NextPosition();

        virtual uint32_t Read(std::vector<uint32_t> * docs, std::vector<uint32_t> * freqs);
        virtual bool SkipTo(uint32_t target);

    protected:
        virtual SegmentTermDocs * TermDocs(SegmentReader * reader);

        /// The SegmentReader%s that read the segments
        const SegmentList & readers;
        /// Base Document numbers for each segment
        const std::vector<uint32_t> & starts;
        /// The Term to look for
        Term term;

        /// Base Document number for the current segment
        uint32_t base;
        /// Current Document for the current segment
        uint32_t pointer;
        /// Document list for the current segment
        SegmentTermDocs * current;

    private:
        /** Get a Document list for a segment.
            @param i The segment number to get a Document list for
            @return A new SegmentTermDocs for the current ::term */
        SegmentTermDocs * TermDocs(uint32_t i);

        /// Store for SegmentTermDocs for each segment
        std::vector<SegmentTermDocs *> segtermdocs;
};

} // namespace Lucene

#endif

