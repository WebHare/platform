#ifndef blex_consilio_index_segmentreader
#define blex_consilio_index_segmentreader

#include "indexreader.h"
#include "segmentinfo.h"
#include "fieldinfo.h"
#include "fieldsreader.h"
#include "term.h"
#include "terminfos.h"
#include "bitvector.h"

class SegmentsCache;

namespace Lucene
{

/** A reader for a single segment. */
class SegmentReader : public IndexReader
{
    public:
        /** Create a new SegmentReader, which may delete Document%s.
            @param commit_lock The Blex::Mutex that prevents multiple processes
                               from reading/writing the segments file at once (see
                               Consilio documentation for details)
            @param sis Information about the segments (needed to update the segments
                       file after Document%s are deleted and/or norms are updated)
            @param si Information about the segment to read */
        SegmentReader(Blex::Mutex &commit_lock, std::shared_ptr<SegmentInfos> sis, const SegmentInfo & si, SegmentsCache &_cache);
        /** Create a new SegmentReader.
            @param commit_lock The Blex::Mutex that prevents multiple processes
                               from reading/writing the segments file at once (see
                               Consilio documentation for details)
            @param si Information about the segment to read */
        SegmentReader(Blex::Mutex &commit_lock, const SegmentInfo & si, SegmentsCache &_cache);
        ~SegmentReader();

        /** Get this segment's name.
            @return The name of the segment */
        std::string const &GetSegmentName();
        /** Does a segment contain deleted Document%s?
            @param si Information about the segment to check */
        static bool HasDeletions(const SegmentInfo & si);
        virtual bool HasDeletions();

        virtual void DoDelete(uint32_t doc);
        virtual void DoMergeDelete(uint32_t doc);
        virtual void FlushMergeDeletions();
        virtual bool IsDeleted(uint32_t doc);

        /** Get a list of files belonging to this segment.
            @return A list of filenames */
        std::vector<std::string> Files();

        virtual void ResetTerms();
        virtual TermEnum * Terms();
        virtual TermEnum * Terms(const Term & term);
        virtual TermDocs * GetTermDocs();
        virtual std::shared_ptr<TermDocs> GetTermPositionsPtr();
        virtual TermDocs * GetTermPositions();

        virtual Document * GetDocument(uint32_t doc);

        virtual int32_t DocFreq(const Term & term);

        virtual uint32_t NumDocs();
        virtual uint32_t MaxDoc();

        virtual std::set<std::string> GetFieldNames();
        virtual std::set<std::string> GetFieldNames(bool indexed);

        virtual Blex::PodVector< uint8_t > const & Norms(const std::string & field);
        virtual void SetNorm(uint32_t doc, const std::string & field, uint8_t value);

        /** Read a range of normalization factors for a Field.
            @param field Name of the Field
            @param bytes A list of normalization factors, one for each Document
            @param offset The position to start storing norms in @c bytes */
        void Norms(const std::string & field, Blex::PodVector< uint8_t > * bytes, uint32_t offset);

        /// Information about the Field%s in this segment
//        FieldInfos fieldinfos;
        /// Reader for Term%s
        std::unique_ptr<TermInfosReader> tis;
        /// BitVector to store which Document%s in this segment are deleted
        std::unique_ptr<BitVector> deleteddocs;

        /// Stream to read Term frequencies from
        std::shared_ptr<Blex::ComplexFileStream> freqstream;
        /// Stream to read Term positions from
        std::shared_ptr<Blex::ComplexFileStream> proxstream;

        SegmentCacheRef cacheref;

    private:
        /** Initialize the SegmentReader.
            @param si Information about the segment */
        void Initialize(const SegmentInfo & si);

        /** Read normalization factors. */
        void OpenNorms();

        /// Name of this segment
        std::string const segment;

        /// Reader for stored Field%s
        std::unique_ptr<FieldsReader> fieldsreader;

        /// Has merge deletions
        bool hasmergedeletions;
        /// The deletions file should be rewritten
        bool deleteddocsdirty;
        /// The norms files should be rewritten
        bool normsdirty;

        /// Lock for committing changes to the segments file
        Blex::Mutex &commit_lock;

        /// Segments data cache
        SegmentsCache &cache;

    friend class Norm;
};

/** A list of SegmentReader%s. */
typedef std::vector<SegmentReader *> SegmentList;

/** A TermEnum for a single segment. */
class SegmentTermEnum : public TermEnum
{
    public:
        /** Create a new Term enumerator for a terms (index) file.
            @param fs The ComplexFileSystem the index resides in
            @param filename The name of the input file to read (.tii or .tis)
            @param fis Information about the segment Field%s
            @param isi This is an index (.tii) enumerator */
        SegmentTermEnum(Blex::ComplexFileSystem &fs, std::string const &filename, const FieldInfos & fis, bool isi);
        ~SegmentTermEnum();
        /** Clone this SegmentTermEnum, including opened file pointers.
            @return A clone of this SegmentTermEnum */
        SegmentTermEnum * Clone();

        /** Seek to a Term.
            @param pointer Offset in the input file
            @param p Position in the enumeration
            @param t The Term to seek to
            @param ti Information about the Term */
        void Seek(uint32_t pointer, int32_t p, const Term & t, const TermInfo & ti);
        virtual bool Next();

        void LowerBound(Term const &until);

        virtual Term GetTerm();
        /** Get information about the current Term.
            @return A pointer to the current Term's information */
        TermInfo * GetTermInfo();
        /** Set information about the current Term
            @param ti The new Term information */
        void SetTermInfo(const TermInfo & ti);
        virtual int32_t DocFreq();
        /** Get the current position in the frequencies file.
            @return The .frq file offset */
        uint32_t FreqPointer();
        /** Get the current position in the positions file.
            @return The .prx file offset */
        uint32_t ProxPointer();

        /// The number of terms
        uint32_t size;
        /// Position of the current term in the enumeration
        int32_t position;

        /// This is an index enumerator
        bool isindex;
        /// Position of the current index Term in the .tis file
        uint32_t indexpointer;

    private:

        std::string segment;

        /** Create a complete initialized enumerator for a terms (index) file.
            @param i Stream to read Term%s from
            @param fis Information about the segment Field%s
            @param isi This is an index (.tii) enumerator
            @param s The number of terms
            @param t The current Term
            @param ti Information about the current Term
            @param p Previous Term
            @param pos Position of the current term in the enumeration
            @param ptr Position of the current index Term in the .tis file
            @param buf Term text buffer */
        SegmentTermEnum( Blex::ComplexFileStream * i
                       , FieldInfos * fis
                       , bool isi
                       , uint32_t s
                       , const Term & t
                       , const TermInfo & ti
//                       , const Term & p
                       , int32_t pos
                       , uint32_t ptr
                       , const std::string & buf);

        /** Read the next Term. */
//        void ReadTerm();

        bool GetNextData(uint32_t *fieldnum, uint32_t *totallength);

        /// Stream to read Term%s from
        std::unique_ptr<Blex::ComplexFileStream> input;
        /// Information about the segment Field%s
        FieldInfos * fieldinfos;

        /// The current Term
        Term term;
        /// Information about the current Term
        TermInfo terminfo;

        /// Term text buffer
        std::string buffer;
};

/** A list of Document%s containing a certain Term in a segment.
    SegmentTermDocs can also be used to retrieve the positions of the Term in
    the Document%s. */
class SegmentTermDocs : public TermDocs
{
    public:
        /** Create a new list of Document%s.
            @param parent The SegmentReader to read Document%s and positions for
            @param positions Set to true to also retrieve positions */
        SegmentTermDocs(SegmentReader * parent, bool positions);
        ~SegmentTermDocs();

        virtual void Seek(const Term & term);
        virtual void Seek(TermEnum * termenum);
        /** Seek to a Term using the TermInfo.
            @param ti Information to use when seeking to the Term */
        void Seek(const TermInfo * ti);

        virtual uint32_t Doc();
        virtual uint32_t Freq();

        virtual bool Next();
        virtual uint32_t NextPosition();

        virtual uint32_t Read(std::vector<uint32_t> * docs, std::vector<uint32_t> * freqs);
        virtual bool SkipTo(uint32_t target);

        /// Current Document
        uint32_t doc;
        /// Number of occurrences in the current Document
        uint32_t freq;

    private:
        /** Skip remaining positions for the current Document. */
        void SkippingDoc();
        /** This internal function skips to the next Document, without reading
            positions.
            @return If there was a next Document */
        bool DocNext();

        /// The SegmentReader to read Document%s and positions for
        SegmentReader * parent;
        /// Stream to read Term frequencies from
        std::shared_ptr<Blex::ComplexFileStream> freqstream;
        /// Frequencies left to read
        uint32_t freqcount;

        /// Stream to read Term positions from
        std::shared_ptr<Blex::ComplexFileStream> proxstream;
        /// Positions left to read
        uint32_t proxcount;
        /// Current Term position
        uint32_t position;
};

} // namespace Lucene

#endif

