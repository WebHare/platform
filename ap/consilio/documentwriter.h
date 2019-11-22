#ifndef blex_consilio_index_documentwriter
#define blex_consilio_index_documentwriter

#include "similarity.h"
#include "fieldinfo.h"
#include "term.h"

namespace Lucene
{

/** A list of positions of a Term in a Document. */
typedef std::vector<uint32_t > Positions;

/** Occurrences of a Term in a Document. */
struct Posting
{
        /** Create a new Posting.
            @param position The position of the Term in the Document */
        Posting(uint32_t position);

        /// The number of times the Term occurs in the Document
        uint32_t freq;
        /// The positions of the Term in the Document
        Positions positions;
};

/** A list of different Term%s and their Positions in a Document. */
typedef std::map<Term, Posting> PostingTable;
/** The list of Term%s and their Positions in a Document. */
typedef std::vector<std::pair<Term, Posting> > PostingArray;

/** The DocumentWriter makes an inverted list of Document Term%s and writes it to
    an index. */
class DocumentWriter
{
    public:
        /** Create a DocumentWriter that writes to a Blex::ComplexFileSystem.
            @param directory The Blex::ComplexFileSystem to write to
            @param similarity The Similarity to use for calculating field normalization
                              factors
            @param maxfieldlength The maximum number of ConsilioToken%s per Field to add */
        DocumentWriter(Blex::ComplexFileSystem &directory, Similarity & similarity, uint32_t maxfieldlength);

        /** Invert a Document and write it to the index.
            @param segment The name of the segment to add the Document to
            @param doc The Document to add */
        void AddDocument(const std::string & segment, const Document & doc);

    private:
        /** Fill the PostingTable with Document Term%s and their Positions.
            @param doc The Document to invert */
        void InvertDocument(const Document &doc);
        void InvertDocumentField(const Field &field);

        /** Add a Term position to the PostingTable.
            @param field The Term fieldname
            @param text The Term text
            @param position The Term position within the Field */
        void AddPosition(const std::string & field, const std::string & text, uint32_t position);
        void AddSuggest(const std::string &prefix, const std::string &text);
        /** Sort the PostingTable into a PostingArray.
            @param array The PostingArray to store the Document Term%s in */
        void SortPostingTable(PostingArray *array);
        /** Standard quicksort routine for sorting a PostingArray.
            @param postings The PostingArray to sort
            @param lo Lower bound of array to sort
            @param hi Upper bound of array to sort */
        void QuickSort(PostingArray *postings, uint32_t lo, uint32_t hi);

        /** Write a Document PostingArray to an index segment.
            @param postings The PostingArray to write
            @param segment Name of the segment to write to */
        void WritePostings(const PostingArray & postings, const std::string & segment);
        /** Write normalization factors for a Document's Field%s to an index segment.
            @param doc The Document to write normalization factors for
            @param segment Name of the segment to write to */
        void WriteNorms(const Document & doc, const std::string & segment);

        /// Filesystem to write to
        Blex::ComplexFileSystem &directory;
        /// Similarity to use when calculating normalization factors
        Similarity &similarity;
        /// Store for Document Field information
        FieldInfos fieldinfos;
        /// Maximum number of ConsilioToken%s per Field
        int32_t maxfieldlength;

        /// Table to store Document Term%s with positions
        PostingTable postingtable;
        /// Number of ConsilioToken%s for each Document Field
        std::vector<uint32_t > fieldlengths;
        /// Current ConsilioToken position for each Document Field
        std::vector<uint32_t > fieldpositions;
        /// Boost factor for each Document Field
        std::vector<float> fieldboosts;

        /// Buffer to hold current Term
        Term termbuffer;

        /// Which fields should have their terms added to the suggest terms and what prefix should be used
        std::vector<std::pair<std::string, std::string> > suggestfields;
        /// Suggest terms
        std::shared_ptr<Blex::RandomStream> suggeststream;
};

} // namespace Lucene

#endif

