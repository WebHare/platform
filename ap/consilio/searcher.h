#ifndef blex_consilio_search_searcher
#define blex_consilio_search_searcher

#include "hits.h"
#include "query.h"
#include "filter.h"
#include "topdocs.h"
#include "similarity.h"
#include "document.h"
#include "bitvector.h"
#include "indexreader.h"
#include "term.h"

namespace Lucene
{

/** The general search class. */
class Searcher
{
    public:
        Searcher();
        virtual ~Searcher();

        /** Get the number of Document%s the Term @c term appears in.
            @param term The Term to look for
            @return The number of Document%s containing @c term */
        virtual int32_t DocFreq(const Term & term) = 0;
        /** Get the size of the index (the total number of Document%s, including
            deleted Document%s).
            @return The index size */
        virtual uint32_t MaxDoc() = 0;

        /** Get the stored Field%s for a Document from the index.
            @param doc Number of the Document to retrieve
            @return The requested Document, or NULL if @c n is out of bounds or
                    the Document is deleted */
        virtual Document * Doc(uint32_t i) = 0;

        /** Run a Query on the index and return the results.
            @param query The Query to run
            @return The matched Document%s (Hits) */
        Hits * Search(QueryPtr query);
        /** Run a Query on the index, apply a Filter and return the results.
            @param query The Query to run
            @param filter The Filter to apply
            @return The matched Document%s (Hits) */
        virtual Hits * Search(QueryPtr query, FilterPtr filter);

        /** Run a Query on the index, apply a Filter and return the results.
            @param query The Query to run
            @param filter The Filter to apply
            @return The matched Document%s, in a TopDocs structure */
        virtual TopDocs SearchTopDocs(QueryPtr query, FilterPtr filter, uint32_t n) = 0;

        //virtual void SetSimilarity(std::shared_ptr<Similarity> similarity);
        /** Get the Similarity used to score Hits.
            @return The current Similarity */
        virtual Similarity &GetSimilarity();

        /** Rewrite the Query to a primitive form. For primitive Query%s, a Weight
            can be created to score matching Document%s using a Scorer.
            @param thisquery A pointer to the Query itself
            @return The rewritten Query */
        virtual QueryPtr Rewrite(QueryPtr query) = 0;

    private:
        /// The Similarity used to score Hits
        Similarity &similarity;
};

/** The class to use when searching an index. */
class IndexSearcher : public Searcher
{
    public:
        /** Create an IndexSearcher.
            @param commit_lock The Blex::Mutex that prevents multiple processes
                               from reading/writing the segments file at once (see
                               Consilio documentation for details)
            @param directory The Blex::ComplexFileSystem the index resides in */
        IndexSearcher(Blex::Mutex &commit_lock, Blex::ComplexFileSystem &directory, SegmentsCache &cache);
        /** Create an IndexSeacher for an already opened IndexReader.
            @param r The IndexReader to use for reading the index */
        IndexSearcher(IndexReader * r);
        ~IndexSearcher();

        virtual int32_t DocFreq(const Term & term);
        virtual Document * Doc(uint32_t i);
        virtual uint32_t MaxDoc();

        virtual TopDocs SearchTopDocs(QueryPtr query, FilterPtr filter, uint32_t ndocs);

        virtual QueryPtr Rewrite(QueryPtr query);

    private:
        class Collector;

        /// IndexReader to read the index
        IndexReader * reader;
};

/** HitCollector to collect hits from a BooleanScorer. */
class IndexSearcher::Collector : public HitCollector
{
    public:
        /** Create a new Collector.
            @param bits Filter bits
            @param hq HitQueue Hits will be inserted to
            @param totalhits Store for the total number of hits */
        Collector(std::shared_ptr<BitVector> bits, HitQueue * hq, uint32_t * totalhits);

        virtual void Collect(uint32_t doc, float score);

    private:
        /// Filter bits to filter out unwanted Document%s
        std::shared_ptr<BitVector> bits;
        /// HitQueue to store Hits into
        HitQueue * hq;
        /// The number of Hits collected
        uint32_t * totalhits;
};

} // namespace Lucene

#endif

