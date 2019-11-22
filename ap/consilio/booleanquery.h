#ifndef blex_consilio_search_booleanquery
#define blex_consilio_search_booleanquery

#include "hits.h"
#include "query.h"
#include "searcher.h"

namespace Lucene
{

/** A single clause in a BooleanQuery. */
struct BooleanClause
{
        /** Create a BooleanClause for a Query.
            It is invalid for a BooleanClause to be both required and prohibited.
            @param query The Query for this clause
            @param r This clause is required
            @param p This clause is prohibited */
        BooleanClause(QueryPtr query, bool r, bool p);
        BooleanClause(const BooleanClause & org) = default;
        BooleanClause & operator=(const BooleanClause & org);

        bool operator==(const BooleanClause & other) const;

        /// The Query for this clause
        QueryPtr query;
        /// This clause is required (Document%s must match this clause)
        bool required;
        /// This clause is prohibited (Document%s must not match this clause)
        bool prohibited;
};

/** A boolean Query.
    BooleanQuery%s can be used to combine multiple Query%s into a single Query.
    A requirement can be given to each Query, so that Document%s may, must or
    must not match the Query. */
class BooleanQuery : public Query
{
    public:
        BooleanQuery();

        bool operator==(const Query & other) const;

        /** Get the maximum number of BooleanClause%s supported.
            @return The maximum number of BooleanClause%s that can be added to a
                    BooleanQuery. */
        static uint32_t GetMaxClauseCount();
        /** Set the maximum number of BooleanClause%s supported. The default is 1024.
            @param maxclausecount The maximum number of BooleanClause%s that can
                                  be added to a BooleanQuery. */
        static void SetMaxClauseCount(uint32_t maxclausecount);

        /** Add a Query. A Query may be required, in which case Document%s MUST
            match the Query, or it may be prohibited, in which case Document%s
            MUST NOT match the Query. Only 32 Query%s can be either required or
            prohibited (this is NOT the MaxClauseCount limit). It is invalid for
            a Query to be both required and prohibited.
            @param query The Query to add
            @param required This is a required query
            @param prohibited This is a prohibited query */
        void Add(QueryPtr query, bool required, bool prohibited);
        /** Add a BooleanClause.
            @param clause The BooleanClause to add */
        void Add(const BooleanClause & clause);

        /** Get all BooleanClause%s.
            @return The list of BooleanClause%s */
        const std::vector<BooleanClause> & GetClauses();

        /** Rewrite the Query to a primitive form. For primitive Query%s, a Weight
            can be created to score matching Document%s using a Scorer.
            This is used when creating a Weight for the Query.
            For a BooleanQuery, all BooleanClause%s are rewritten. If there is only
            one clause, then that Query is rewritten and returned.
            @param thisquery A pointer to the Query itself
            @param reader The IndexReader used to rewrite the Query
            @return The rewritten Query */
        QueryPtr Rewrite(QueryPtr, IndexReader * reader);

        virtual QueryPtr Clone();
        virtual std::string ToStringWithField(const std::string & field);
        virtual FieldSet GetQueryFields();

    protected:
        virtual Weight * CreateWeight(QueryPtr thisquery, Searcher * searcher);

    private:
        class BooleanWeight;

        /// The maximum number of BooleanClause%s that can be added to a BooleanQuery
        static uint32_t MaxClauseCount;
        /// The BooleanClause%s in the BooleanQuery
        std::vector<BooleanClause> clauses;

    friend class BooleanWeight;
};

/** Weight for BooleanQuery%s. */
class BooleanQuery::BooleanWeight : public Weight
{
    public:
        /** Create a BooleanWeight for a Searcher.
            @param query The BooleanQuery that creates the BooleanWeight
            @param searcher The Searcher the BooleanWeight is created for */
        BooleanWeight(QueryPtr query, Searcher * searcher);
        ~BooleanWeight();

        virtual QueryPtr GetQuery();
        virtual float GetValue();
        virtual float SumOfSquaredWeights();
        virtual void Normalize(float norm);
        virtual Scorer * GetScorer(IndexReader * reader);

    private:
        /// The Query that created this BooleanWeight
        QueryPtr query;
        /// The Searcher this BooleanWeight is created for
        Searcher * searcher;
        /// Normalization factor
        float norm;
        /// Weight%s for each of the BooleanClause%s
        std::vector<std::shared_ptr<Weight> > weights;
};

/** Scorer for BooleanQuery%s. */
class BooleanScorer : public Scorer
{
    public:
        /** Create a BooleanScorer with a Similarity to use to score Document%s.
            @param similarity The Similarity to use */
        BooleanScorer(Similarity &similarity);
        ~BooleanScorer();

        /** Add a Scorer for a BooleanClause. It is invalid for a BooleanScorer
            to be both required and prohibited.
            @param scorer The Scorer for the Query of a BooleanClause
            @param required The BooleanClause is required
            @param prohibited The BooleanClause is prohibited */
        void Add(Scorer * scorer, bool required, bool prohibited);

        virtual void Score(HitCollector * results, uint32_t maxdoc);

    protected:
        /** Calculate the score factor (see Similarity::Coord()) for each of the
            BooleanClause%s. */
        void ComputeCoordFactors();

        /// The score factor (see Similarity::Coord()) for each of the BooleanClause%s
        std::vector<float > coordfactors;

        /// Mask for required BooleanClause%s
        uint32_t requiredmask;
        /// Mask for prohibited BooleanClause%s
        uint32_t prohibitedmask;

    private:
        struct SubScorer;
        struct Bucket;
        class BucketTable;
        class Collector;

        /// Document that is currently being processed
        uint32_t currentdoc;

        /// Pointer to the first SubScorer
        SubScorer * scorers;
        /// Store for Bucket%s
        std::shared_ptr<BucketTable> buckettable;

        /// Number of subqueries Document%s can match (i.e. non-prohibited clauses)
        uint32_t maxcoord;

        /// Next bit to set in BooleanScorer::requiredmask or BooleanScorer::prohibitedmask
        uint32_t nextmask;

    friend class BucketTable;
};

/** A SubScorer for a BooleanClause. */
struct BooleanScorer::SubScorer
{
        /** Create a subscorer for a BooleanClause. It is invalid for a SubScorer
            to be both required and prohibited.
            @param scorer The Scorer for the BooleanClause
            @param required This is a required clause
            @param prohibited This is a prohibited clause
            @param collector HitCollector to collect hits for the BooleanClause's
                             Query
            @param next Pointer to the next SubScorer in the linked list */
        SubScorer(Scorer * scorer,
                  bool required,
                  bool prohibited,
                  HitCollector * collector,
                  SubScorer * next);
        ~SubScorer();

        /// Clause Scorer
        Scorer * scorer;
        /// Required clause
        bool required;
        /// Prohibited clause
        bool prohibited;
        /// Clause HitCollector
        HitCollector * collector;
        /// Pointer to next SubScorer (NULL for last SubScorer)
        SubScorer * next;
};

/** Store for a single scored Document. */
struct BooleanScorer::Bucket
{
        /** Initialize this Bucket. */
        Bucket();

        /// Document id, or -1 for no Document
        int32_t doc;
        /// Score for this Document
        float score;
        /// This Document's bit in BooleanScorer::requiredmask or BooleanScorer::prohibitedmask
        uint32_t bits;
        /// Number of subqueries this Document matches
        uint32_t coord;
        /// Pointer to next Bucket (NULL for last Bucket)
        Bucket * next;
};

/** Store for Bucket%s. */
class BooleanScorer::BucketTable
{
    public:
        /** Create a BucketTable for a BooleanScorer.
            @param scorer The BooleanScorer that uses this BucketTable */
        BucketTable(BooleanScorer * scorer);
        ~BucketTable();

        /** Collect matching Document%s.
            @param results The HitCollector to collect the results in */
        void CollectHits(HitCollector * results);

        /** Get the size of this BucketTable.
            @return The maximum number of matching documents that can be stored in
                    this BucketTable */
        uint32_t Size();

        /** Create a new HitCollector to collect hits.
            @param mask Mask for this collector
            @param buckettable This BucketTable */
        HitCollector * NewCollector(uint32_t mask, std::shared_ptr<BucketTable> buckettable);

        /// Number of documents that can be stored in this BucketTable
        static uint32_t SIZE;
        /// Mask for each document
        static uint32_t MASK;

    private:
        /// Store for Bucket%s (The Bucket list is maintained as a linked list by
        /// ::first and Bucket::next)
        std::vector<Bucket *> buckets;
        /// Pointer to the first Bucket in the linked list
        Bucket * first;
        /// Scorer for this BucketTable
        BooleanScorer * scorer;

    friend class Collector;
};

/** HitCollector to collect hits from a BooleanScorer. */
class BooleanScorer::Collector : public HitCollector
{
    public:
        /** Create a new Collector.
            @param mask Mask for this Collector
            @param buckettable The BucketTable to collect hits for */
        Collector(uint32_t mask, std::shared_ptr<BucketTable> buckettable);
        ~Collector();

        virtual void Collect(uint32_t doc, float score);

    private:
        /// BucketTable to collect hits for
        std::shared_ptr<BucketTable> buckettable;
        /// Mask for this Collector
        uint32_t mask;
};

} // namespace Lucene

#endif

