#ifndef blex_consilio_index_indexreader
#define blex_consilio_index_indexreader

#include <blex/threads.h>
#include "segmentinfo.h"
#include "document.h"
#include "term.h"

namespace Lucene
{

class TermEnum;
class TermDocs;

/** The IndexReader is the general interface to read information from an index.
    It is also used to delete Document%s from the index. */
class IndexReader
{
    public:
        /** Open an IndexReader.
            @param commit_lock The Blex::Mutex that prevents multiple processes
                               from reading/writing the segments file at once (see
                               Consilio documentation for details)
            @param directory The Blex::ComplexFileSystem the index resides in */
        static IndexReader * Open(Blex::Mutex &commit_lock, Blex::ComplexFileSystem &directory, SegmentsCache &cache);
        virtual ~IndexReader();

        /** Get the Blex::ComplexFileSystem the index resides in.
            @return The index directory */
        Blex::ComplexFileSystem &GetDirectory() { return directory; }

        /** Get the number of existing (non-deleted) Document%s in the index.
            @return The number of Document%s */
        virtual uint32_t NumDocs() = 0;
        /** Get the size of the index (the total number of Document%s, including
            deleted Document%s).
            @return The index size */
        virtual uint32_t MaxDoc() = 0;

        /** Get the stored Field%s for a Document from the index.
            @param doc Number of the Document to retrieve
            @return The requested Document, or NULL if @c n is out of bounds or
                    the Document is deleted */
        virtual Document * GetDocument(uint32_t doc) = 0;
        /** Is the Document deleted?
            @param doc Number of the Document to check */
        virtual bool IsDeleted(uint32_t doc) = 0;
        /** Are there any deleted Document%s in this index? */
        virtual bool HasDeletions() = 0;

        /** Get the normalization factors for a Field.
            @param field Name of the Field
            @return A list of normalization factors, one for each Document */
        virtual Blex::PodVector< uint8_t > const & Norms(const std::string & field) = 0;
        /** Set the normalization factor for a Document in a Field.
            @param doc The Document to set the norm for
            @param field The Field to set the norm in
            @param value The byte-encoded normalization factor (see
                         Similarity::EncodeNorm) */
        virtual void SetNorm(uint32_t doc, const std::string & field, uint8_t value) = 0;
        /** Set the normalization factor for a Document in a Field.
            @param doc The Document to set the norm for
            @param field The Field to set the norm in
            @param value The normalization factor */
        void SetNorm(uint32_t doc, const std::string & field, float value);

        /** Get a TermEnum which enumerates all Term%s in the index.
            @return A TermEnum for this index */
        virtual TermEnum * Terms() = 0;
        /** Get a TermEnum which enumerates all Term%s in the index. The enumeration
            starts at the given Term, or, if that Term does not exist, at the
            Term before which @c term would be inserted (the first Term after @c
            term).
            @param term The Term to start enumerating
            @return A TermEnum for this index */
        virtual TermEnum * Terms(const Term & term) = 0;
        /** Get the number of Document%s the Term @c term appears in.
            @param term The Term to look for
            @return The number of Document%s containing @c term */
        virtual int32_t DocFreq(const Term & term) = 0;
        /** Get a list of Document%s (without positions) containing @c term.
            @param term The Term to look for
            @return A list of TermDocs */
        TermDocs * GetTermDocs(const Term & term);
        /** Get a list of Document%s (without positions).
            @return A list of TermDocs */
        virtual TermDocs * GetTermDocs() = 0;
        /** Get a list of Document%s with positions containing @c term.
            @param term The Term to look for
            @return A list of TermDocs (with positions) */
        std::shared_ptr<TermDocs> GetTermPositionsPtr(const Term & term);
        /** Get a list of Document%s with positions.
            @return A list of TermDocs (with positions) */
        virtual std::shared_ptr<TermDocs> GetTermPositionsPtr() = 0;
        /** Get a list of Document%s with positions containing @c term.
            @param term The Term to look for
            @return A list of TermDocs (with positions) */
        TermDocs * GetTermPositions(const Term & term);
        /** Get a list of Document%s with positions.
            @return A list of TermDocs (with positions) */
        virtual TermDocs * GetTermPositions() = 0;

        /** Delete a Document.
            @param doc The Document to delete */
        void Delete(uint32_t doc);
        /** Actual implementation of document deletion.
            @param doc The Document to delete */
        virtual void DoDelete(uint32_t doc) = 0;
        /** Delete all Document%s containg @ term.
            @param term The Term to delete
            @return The number of deleted Document%s */
        uint32_t Delete(const Term & term);

        /** Get a list of all Field names.
            @return A list of all Field names */
        virtual std::set<std::string> GetFieldNames() = 0;
        /** Get a list of all Field names which are (not) indexed.
            @param indexed Retrieve only Field%s which are (not) indexed
            @return A list of all Field names */
        virtual std::set<std::string> GetFieldNames(bool indexed) = 0;

    protected:
        /** Create an IndexReader in a given @c directory.
            @param directory The Blex::ComplexFileSystem the index resides in */
        IndexReader(Blex::ComplexFileSystem &directory);

        /// Information about the segments in the index
        std::shared_ptr<SegmentInfos> segmentinfos;

    private:
        /// The Blex::ComplexFileSystem the index resides in
        Blex::ComplexFileSystem& directory;
        /// The index was changed since the segments information was last read
        bool stale;
};

/** Enumerate over Term%s in an index. */
class TermEnum
{
    public:
        virtual ~TermEnum();

        /** Advance to the next Term.
            @return If there was a next Term */
        virtual bool Next() = 0;

        /** Get the current Term.
            @return The current Term, or an invalid Term if there is no current
                    Term */
        virtual Term GetTerm() = 0;

        /** Return the number of Document%s the current Term appears in.
            @return The current document frequency, or -1 if there is no current
                    Term */
        virtual int32_t DocFreq() = 0;
};

/** A list of Document%s containing a certain Term.
    TermDocs can also be used to retrieve the positions of the Term in the
    Document%s. */
class TermDocs
{
    public:
        /** Create a new list of Document%s.
            @param positions Set to true to also retrieve positions */
        TermDocs(bool positions);
        virtual ~TermDocs();

        /** Seek to a Term.
            @param term The Term to seek to */
        virtual void Seek(const Term & term) = 0;
        /** Seek to a Term in a TermEnum.
            @param termenum The TermEnum which is set to the Term to seek to */
        virtual void Seek(TermEnum * termenum) = 0;

        /** Get the id of the current Document.
            @return The Document id */
        virtual uint32_t Doc() = 0;
        /** Get the number of times the Term appears in the current Document.
            @return The Term frequency */
        virtual uint32_t Freq() = 0;

        /** Skip to the next Document. This function should be called at least
            once before ::Doc or ::Freq.
            @return If there was a next Document */
        virtual bool Next() = 0;
        /** Skip to the next position within the current Document. If there are
            no positions left, a LuceneException is thrown. This function cannot
            be called for TermDocs without positions.
            @return The next Term position */
        virtual uint32_t NextPosition() = 0;

        /** Read multiple Document%s and frequencies for the current Term, up to
            the length of @c docs. Document%s are stored in @c docs, frequencies
            in @c freqs. @c freqs must be as long as @c docs.
            @param docs An array to store Document numbers in
            @param freqs An array to store frequencies in
            @return The number of entries read */
        virtual uint32_t Read(std::vector<uint32_t> * docs, std::vector<uint32_t> * freqs) = 0;
        /** Skips entries to the first beyond the current whose Document number
            is greater than or equal to @c target.
            @param target The Document number to skip to
            @return If an entry was found */
        virtual bool SkipTo(uint32_t target) = 0;

    protected:
        /// Are positions read?
        bool positions;
};

} // namespace Lucene

#endif

