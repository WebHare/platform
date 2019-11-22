#ifndef blex_consilio_index_terminfos
#define blex_consilio_index_terminfos

#include "fieldinfo.h"
#include "term.h"
#include "terminfo.h"
#include "cache.h"

namespace Lucene
{

class SegmentTermEnum;          // Forward declaration for segmentreader.h

/** A reader for Term%s. */
class TermInfosReader
{
    public:
        /** Create a TermInfosReader to read Term%s for a @c segment from a @c dir.
            @param dir The Blex::ComplexFileSystem the index resides in
            @param segment The segment to read Term%s for
            @param fis Information about the segment Field%s */
        TermInfosReader(Blex::ComplexFileSystem &dir, const std::string & segment, SegmentCacheRef &_cacheref);

        /** Get the number of Term%s.
            @return The number of Term%s in the segment */
        uint32_t Size() const;

        /** Get the position of @c term in the list of index Term%s.
            @param term The Term to look up
            @return An index position in ::indexterms */
        uint32_t GetIndexOffset(const Term & term) const;
        /** Seek the reader to the index Term at @indexoffset.
            @param indexoffset The index Term to seek to */
        void SeekEnum(uint32_t indexoffset);

        /** Get information about a @c term
            @param term The Term to look up
            @return TermInfo about the @c term, or NULL if @c term could not be
                    found */
        const TermInfo * Get(const Term & term);
        /** Get the Term at a given @c position.
            @param position Position of the term in the segment
            @return The term at @c position, or an invalid Term if no term could
                    be found at @c position */
        Term GetTerm(int32_t position);
        /** Get the position of a Term in the segment.
            @param term The Term to look up
            @return The position of the Term, or -1 if @c term could not be found */
        int32_t GetPosition(const Term & term);

        /** Get a Term enumerator for the Term%s in this reader.
            @return An enumerator for all Term%s in the segment */
        SegmentTermEnum * Terms();
        /** Get a Term enumerator for the Term%s in this reader, starting at a
            @c term.
            @return An enumerator for Term%s in the segment */
        SegmentTermEnum * Terms(const Term & term);

        SegmentCacheRef cacheref;
/*
        /// Store for index (<tt>.tii</tt>) Term%s
        std::vector<Term> indexterms;
        /// Store for TermInfo%s for index (<tt>.tii</tt>) Term%s
        std::vector<TermInfo> indexinfos;
        /// Positions within the .tis file for index (<tt>.tii</tt>) Term%s
        std::vector<uint32_t> indexpointers;
*/

    private:
        /** Read the index Term%s from the <tt>.tii</tt> file. */
//        void ReadIndex();

        /** Skip to the given @c term and return the information about it.
            @param term The Term to skip to
            @return TermInfo about the @c term, or NULL if @c term could not be
                    found */
        const TermInfo * ScanEnum(const Term & term);
        /** Skip to the given @c position and the Term at that position.
            @param position The position to skip to
            @return The Term at @c position, or an invalid Term if the position
                    could not be found */
        Term ScanEnum(int32_t position);

        /// The Blex::ComplexFileSystem the index resides in
        Blex::ComplexFileSystem &directory;
        /// The segment this reader reads Term%s for
        std::string segment;
        /// Information about the Field%s in the segment
//        const FieldInfos & fieldinfos;

        /// Enumerator for the segment's Term%s
        std::unique_ptr<SegmentTermEnum> enumerator;
        /// The number of Term%s
        uint32_t size;
};

/** A writer for Term%s. */
class TermInfosWriter
{
    public:
        /** Create a TermInfosWriter to write Term%s for a @c segment in a @c dir.
            @param dir The Blex::ComplexFileSystem the index resides in
            @param segment The segment to write Term%s for
            @param fis Information about the segment Field%s */
        TermInfosWriter(Blex::ComplexFileSystem &directory, const std::string & segment, const FieldInfos & fis);
        ~TermInfosWriter();

        /** Add a Term to the segment.
            The Term and its frequency and position have to be greater than that
            of the last added Term, to ensure the correct Term order.
            @param term The Term to add
            @param ti Information about the Term
            @return If the Term could be added */
        bool Add(const Term & term, const TermInfo & ti);

    private:
        /** Create a TermInfosWriter internally to write Term%s (<tt>.tis</tt>) or index
            Term%s (.tii) for a @c segment in a @c dir.
            @param dir The Blex::ComplexFileSystem the index resides in
            @param segment The segment to write Term%s for
            @param fis Information about the segment Field%s
            @param isindex This writer writes index Term%s (<tt>.tii</tt>) */
        TermInfosWriter(Blex::ComplexFileSystem &directory, const std::string & segment, const FieldInfos & fis, bool isindex);
        /** Initialize this writer (reset state, open file, etc.)
            @param dir The Blex::ComplexFileSystem the index resides in
            @param segment The segment to write Term%s for
            @param isi This writer writes index Term%s (<tt>.tii</tt>) */
        void Initialize(Blex::ComplexFileSystem &directory, const std::string & segment, bool isi);

        /** Write a Term to disk.
            @param term The Term to write */
        void WriteTerm(const Term & term);

        /** Calculate the length of the shared prefix between two strings.
            I.e. if <tt>s1 == "hypermedia"</tt> and <tt>s2 == "hypertext"</tt>, then this
            function returns <tt>5</tt>. */
        static uint32_t StringDifference(const std::string & s1, const std::string & s2);

        /// Information about the Field%s in the segment
        const FieldInfos & fieldinfos;
        /// Output stream to write Term%s to
        std::unique_ptr<Blex::ComplexFileStream> output;
        /// Last Term written (used to calculate differences)
        Term lastterm;
        /// Information about the last Term
        TermInfo lastti;
        /// The number of Term%s written
        uint32_t size;
        /// Last index Term position
        uint32_t lastindexpointer;
        /// This writer writes index Term%s (<tt>.tii</tt>)
        bool isindex;
        /// Pointer to <tt>.tii</tt> writer for <tt>.tis</tt> writer, or to <tt>.tis</tt> writer
        /// for <tt>.tii</tt> writer
        TermInfosWriter* other;

        //ADDME: Hmm, bit of a hack to implement the 'other' and cyclic ownership. other_owner is NULL for the 'isindex==true' constructor
        /// Store for the <tt>.tii</tt> writer in the <tt>.tis</tt> writer
        std::unique_ptr<TermInfosWriter> other_owner;
};

} // namespace Lucene

#endif

