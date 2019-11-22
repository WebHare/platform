#ifndef blex_consilio_search_similarity
#define blex_consilio_search_similarity

#include <blex/blexlib.h>
#include "consilio.h"
namespace Lucene
{

class Term;                     // Forward declaration for term.h
class Searcher;                 // Forward declaration for searcher.h

/** The Similarity class is used to calculate scores for Document%s. For details
    on scoring in Lucene, see the Consilio documentation. */
class Similarity
{
    private:
        static float normtable[256];
        static bool initnormtable;

        static void InitNormTable();

    public:
        virtual ~Similarity();

        /** Get the table of normalization factors. Normalization factors are
            float values encoded in one byte. These are calculated once and stored
            in a table.
            @return A pointer to the first value (there are 256 values in total) */
        static inline float * GetNormTable()
        {
                if (initnormtable)
                    InitNormTable();
                return normtable;
        }

        /** Get the default Similarity used for indexing and scoring.
            @return The default Similarity */
        static Similarity & GetDefault();

        /** Get the normalization factor for the Field with a given fieldname,
            given the number of tokens in it.
            @param fieldname Name of the Field
            @param numtokens The number of tokens in the field
            @return The Field normalization factor */
        virtual float LengthNorm(const std::string & fieldname, uint32_t numtokens) = 0;
        /** Get the normalization factor for a Query given the sum of squared weights
            of the Query terms.
            @param sumofsquaredweights The sum of squared weights
            @return The Query normalization factor */
        virtual float QueryNorm(float sumofsquaredweights) = 0;

        /** Get the normalization factor float value for a given encoded byte value.
            @param b The byte value
            @return The float value */
        static inline float DecodeNorm(uint8_t b)
        {
                return GetNormTable()[b & 0xFF];
        }

        /** Get the byte encoded normalization factor for a given float value.
            @param f The float value
            @return The byte value */
        static inline uint8_t EncodeNorm(float f)
        {
                return FloatToByte(f);
        }

        /** Calculate a score factor given the frequency in a Document.
            @param freq The frequency in a Document
            @return The score factor */
        float inline Tf(uint32_t freq)
        {
                return Tf((float )freq);
        }

        /** Calculate a score factor given the frequency in a Document.
            @param freq The frequency in a Document
            @return The score factor */
        virtual float Tf(float freq) = 0;
        /** Calculate the sloppy phrase match for a given edit distance.
            @param distance The edit distance
            @return The sloppy phrase match */
        virtual float SloppyFreq(F64 distance) = 0;
        /** Calculate the inverse document frequency for a Term in a Searcher.
            This is based on the number of occurrences of the Term found by the
            Searcher.
            @param term The term to calculate the idf for
            @param searcher Searcher used to calculate the idf
            @return The idf */
        float Idf(const Term & term, Searcher * searcher);
        /** Calculate the inverse document frequency (idf) for a list of Term%s
            in a Searcher. This is based on the number of occurrences of all Term%s
            found by the Searcher.
            @param terms The Term%s to calculate the idf for
            @param searcher Searcher used to calculate the idf
            @return The idf */
        float Idf(const std::vector<Term> & terms, Searcher * searcher);
        /** Calculate the inverse document frequency (idf) given the number of
            matching documents and the total number of documents.
            @param docfreq The number of matching documents
            @param numdocs The total number of documents
            @return The idf */
        virtual float Idf(uint32_t docfreq, uint32_t numdocs) = 0;
        /** Calculate a score factor given the number of Query Terms a Document
            contains (documents with more matching terms score higher).
            @param overlap The number of matching Terms in the Document
            @param maxoverlap The number of Terms in the Query
            @return The score factor */
        virtual float Coord(uint32_t overlap, uint32_t maxoverlap) = 0;

        /** Decode a byte-encoded normalization factor back to a float value.
            @param b Encoded byte value
            @return Decoded float value */
        static float ByteToFloat(uint8_t b);
        /** Encode a normalization factor float value to a byte.
            @param f Decoded float value
            @return Encoded byte value */
        static uint8_t FloatToByte(float f);
};

/* Note: the default similarity must be completely thread-safe, as it may be used by multiple threads */
/** A default scoring implementation. */
class DefaultSimilarity : public Similarity
{
    public:
        virtual float LengthNorm(const std::string & fieldname, uint32_t numtokens);
        virtual float QueryNorm(float sumofsquaredweights);
        virtual float Tf(float freq);
        virtual float SloppyFreq(F64 distance);
        virtual float Idf(uint32_t docfreq, uint32_t numdocs);
        virtual float Coord(uint32_t overlap, uint32_t maxoverlap);
};

} // namespace Lucene

#endif

