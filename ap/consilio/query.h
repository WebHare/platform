#ifndef blex_consilio_search_query
#define blex_consilio_search_query

#include "field.h"
#include "similarity.h"
#include "indexreader.h"

namespace Lucene
{

class HitCollector;             // Forward declaration for hits.h
class Searcher;                 // Forward declaration for searcher.h
class Weight;                   // Forward declaration
class Scorer;                   // Forward declaration

std::string ConvertFloat(float f);

typedef std::set<std::string> FieldSet;

class Query;
typedef std::shared_ptr<Query> QueryPtr;

/** A Query to run on the index.
    This is the base class to derive different types of queries from. It defines
    all methods which should be implemented by derived Query classes. */
class Query
{
    public:
        Query();
        virtual ~Query();

        virtual bool operator==(const Query & other) const;
        virtual bool operator!=(const Query & other) const;

        /** Set the boost factor for the Query. The default value is 1.0. The
            boost factor can be used in mixed Query%s to make a Query more important
            (b > 1.0) or less important (0 < b < 1.0).
            @param b The new boost factor */
        virtual void SetBoost(float b);
        /** Get the current boost factor for the Query.
            @return The boost factor */
        virtual float GetBoost() const;

        /** Get a string representation of the Query with a default field name.
            @param field Field name that can be omitted
            @return A string representing the Query */
        virtual std::string ToStringWithField(const std::string & field) = 0;
        /** Get a string representation of the Query, containing all field names.
            @return A string representing the Query */
        virtual std::string ToString();

        virtual FieldSet GetQueryFields() = 0;

        /** Get a Weight for the Query.
            @param thisquery A pointer to the Query itself
            @param searcher The Searcher for which the Weight is created
            @return A Weight for the query */
        virtual Weight * GetWeight(QueryPtr thisquery, Searcher * searcher);

        /** Rewrite the Query to a primitive form. For primitive Query%s, a Weight
            can be created to score matching Document%s using a Scorer.
            This is used when creating a Weight for the Query.
            @param thisquery A pointer to the Query itself
            @param reader The IndexReader used to rewrite the Query
            @return The rewritten Query */
        virtual QueryPtr Rewrite(QueryPtr thisquery, IndexReader * reader);
        /** Combine a list of Query%s to a single Query.
            @param queries A list of Query%s
            @return The combined Query */
        virtual QueryPtr Combine(std::vector<QueryPtr> queries);
//ADDME:        virtual QueryPtr MergeBooleanQueries(std::vector<QueryPtr> queries);

        /** Create a copy of the Query.
            @return A copy of the Query */
        virtual QueryPtr Clone();

    protected:
        /** Create a suitable Weight for the Query.
            @param thisquery A pointer to the Query itself
            @param searcher The Searcher for which the Weight is created
            @return A Weight for the query */
        virtual Weight * CreateWeight(QueryPtr thisquery, Searcher * searcher);

        /// The boost factor
        float boost;
};

/** The Weight is used by the Scorer to score the Document%s that matched a Query.
    A Weight is constructed by a Query, given a Searcher (Query::CreateWeight).
    The SumOfSquaredWeights() method is then called on the top-level Query to
    compute the Query normalization factor (Similarity::QueryNorm). This factor
    is then passed to Normalize(). At this point the weighting is complete and a
    Scorer may be constructed by calling GetScorer().
    It is only implemented for primitive Query%s (Queries that rewrite to themselves). */
class Weight
{
    public:
        virtual ~Weight();
        /** Get the Query the Weight is created for.
            @return The original Query */
        virtual QueryPtr GetQuery() = 0;
        /** Get the weight for a Query.
            @return The weight value */
        virtual float GetValue() = 0;
        /** Get the sum of squared weights of this Query and subqueries.
            @return The sum of squared weights */
        virtual float SumOfSquaredWeights() = 0;
        /** Normalize the weight value.
            @param querynorm Normalization factor to use */
        virtual void Normalize(float querynorm) = 0;
        /** Get a Scorer for the Query using the Weight.
            @param reader IndexReader to create a Scorer for
            @return A Scorer for the Query */
        virtual Scorer * GetScorer(IndexReader * reader) = 0;
};

/** The Scorer is used to score Document%s that matched a Query. */
class Scorer
{
    public:
        virtual ~Scorer();

        /** Score all Document%s and pass them to a HitCollector.
            @param results The HitCollector to send Hits (matched Document%s) to
            @param maxdoc The last Document to score */
        virtual void Score(HitCollector * results, uint32_t maxdoc) = 0;

    protected:
        /** Create a Scorer with a Similarity to use to score Document%s.
            @param similarity The Similarity to use */
        Scorer(Similarity &similarity);
        /** Get the Similarity used by this Scorer to score Document%s.
            @return The Similarity used */
        Similarity& GetSimilarity() { return similarity; }

    private:
        /// The Similarity used to score Document%s
        Similarity &similarity;
};

} // namespace Lucene

#endif

