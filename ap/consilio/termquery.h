#ifndef blex_consilio_search_termquery
#define blex_consilio_search_termquery

#include "query.h"
#include "searcher.h"

namespace Lucene
{

/** A Query for a single Term.
    This Query can be used to search for a single Term. */
class TermQuery : public Query
{
    public:
        /** Create a TermQuery for a given Term.
            @param t The Term to search for */
        TermQuery(Term t);

        bool operator==(const Query & other) const;

        /** Get the Term that is searched for.
            @return The Term this TermQuery searches for */
        Term GetTerm();

        virtual QueryPtr Clone();
        virtual std::string ToStringWithField(const std::string & field);
        virtual FieldSet GetQueryFields();

    protected:
        virtual Weight * CreateWeight(QueryPtr thisquery, Searcher * searcher);

        /// The Term this TermQuery searches for
        Term term;

    private:
        class TermWeight;

    friend class TermWeight;
};

/** Weight for TermQuery%s. */
class TermQuery::TermWeight : public Weight
{
    public:
        /** Create a TermWeight for a Searcher.
            @param query The TermQuery that creates the TermWeight
            @param searcher The Searcher the TermWeight is created for */
        TermWeight(QueryPtr query, Searcher * searcher);
        ~TermWeight();

        virtual QueryPtr GetQuery();
        virtual float GetValue();
        virtual float SumOfSquaredWeights();
        virtual void Normalize(float querynorm);
        virtual Scorer * GetScorer(IndexReader * reader);

    private:
        /// The TermQuery that created this TermWeight
        QueryPtr query;
        /// The Searcher this TermWeight is created for
        Searcher * searcher;
        /// The normalized weight value
        float value;
        /// Inverse document frequency for this Term
        float idf;
        /// TermQuery normalization factor
        float querynorm;
        /// TermQuery weight
        float queryweight;
};

/** Scorer for TermQuery%s. */
class TermScorer : public Scorer
{
    public:
        /** Create a TermScorer with a Similarity to use to score Document%s.
            @param weight The TermQuery::TermWeight this TermScorer is created for
            @param td The TermDocs with matching Document%s for the TermQuery
            @param similarity The Similarity to use
            @param norms Normalization factors for the Document%s */
        TermScorer(Weight * weight, TermDocs * td, Similarity &similarity, const Blex::PodVector< uint8_t > & norms);
        ~TermScorer();

        virtual void Score(HitCollector * results, uint32_t maxdoc);

    private:
        /// The TermQuery::TermWeight this TermScorer is created for
        Weight * weight;
        /// TermDocs with matching Document%s for the TermQuery
        std::unique_ptr<TermDocs> termdocs;
        /// Normalization factors for the Document%s
        std::vector<uint8_t>norms;
        /// Weight value of the TermQuery::TermWeight
        float weightvalue;
        /// Document that is currently being scored
        uint32_t doc;

        /// Id of each Document
        std::vector<uint32_t> docs;
        /// Number of occurrences of the Term in each Document
        std::vector<uint32_t> freqs;
        /// Index of current Document in ::docs and ::freqs
        uint32_t pointer;
        /// Number of Document%s in docs and freqs
        uint32_t pointermax;

        /// Cache of Document scores
        std::vector<float> scorecache;
};

}

#endif

