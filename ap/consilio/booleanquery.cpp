#include <ap/libwebhare/allincludes.h>

#include "booleanquery.h"

namespace Lucene
{

uint32_t BooleanQuery::MaxClauseCount = 1024;

BooleanClause::BooleanClause(QueryPtr _query, bool r, bool p)
{
        query = _query;
        required = r;
        prohibited = p;
}

BooleanClause & BooleanClause::operator=(const BooleanClause & org)
{
        query = org.query;
        required = org.required;
        prohibited = org.prohibited;
        return *this;
}

bool BooleanClause::operator==(const BooleanClause & other) const
{
        Query * thisquery = query.get();
        Query * otherquery = other.query.get();
        return (*thisquery == *otherquery)
            && (required == other.required)
            && (prohibited == other.prohibited);
}

BooleanQuery::BooleanQuery()
{
}

bool BooleanQuery::operator==(const Query & other) const
{
        if (typeid(other) != typeid(BooleanQuery))
            return false;
        const BooleanQuery & otherboolean = (const BooleanQuery &)other;
        return (GetBoost() == otherboolean.GetBoost())
            && (clauses == otherboolean.clauses);
}

uint32_t BooleanQuery::GetMaxClauseCount()
{
        return MaxClauseCount;
}

void BooleanQuery::SetMaxClauseCount(uint32_t maxclausecount)
{
        BooleanQuery::MaxClauseCount = maxclausecount;
}

void BooleanQuery::Add(QueryPtr query, bool required, bool prohibited)
{
        Add(BooleanClause(query, required, prohibited));
}

void BooleanQuery::Add(const BooleanClause & clause)
{
        if (clauses.size() >= MaxClauseCount)
            throw LuceneException("Too many boolean clauses",false);

        clauses.push_back(clause);
}

const std::vector<BooleanClause> & BooleanQuery::GetClauses()
{
        return clauses;
}

QueryPtr BooleanQuery::Rewrite(QueryPtr, IndexReader * reader)
{
        // Only one clause: rewrite to single query
        if (clauses.size() == 1)
        {
                if (!clauses[0].prohibited)
                {
                        QueryPtr query = clauses[0].query->Rewrite(clauses[0].query, reader);
                        if (GetBoost() != 1.0)
                        {
                                if (*query == *clauses[0].query)
                                    query = query->Clone();
                                query->SetBoost(GetBoost() * query->GetBoost());
                        }
                        return query;
                }
        }

        // Rewrite each clause Query
        QueryPtr clone;
        for (uint32_t i = 0; i < clauses.size(); ++i)
        {
                QueryPtr query = clauses[i].query;
                query = query->Rewrite(query, reader);
                if (*query != *clauses[i].query)
                {
                        if (!clone.get())
                            clone = Clone();
                        ((BooleanQuery *)(clone.get()))->clauses[i] = BooleanClause(query, clauses[i].required, clauses[i].prohibited);
                }
        }
        if (clone.get())
            return clone;
        else
            return Clone();
}

QueryPtr BooleanQuery::Clone()
{
        BooleanQuery * clone = new BooleanQuery();
        clone->boost = boost;
        clone->clauses = clauses;
        return QueryPtr(clone);
}

std::string BooleanQuery::ToStringWithField(const std::string & field)
{
        std::string str;
        if (GetBoost() != 1.0)
            str.append("(");

        for (uint32_t i = 0; i < clauses.size(); ++i)
        {
                if (clauses[i].prohibited)
                    str.append("-");
                else if (clauses[i].required)
                    str.append("+");

                Query *clause = clauses[i].query.get();
                if (typeid(*clause) == typeid(BooleanQuery))
                {
                        str.append("(");
                        str.append(clauses[i].query->ToStringWithField(field));
                        str.append(")");
                }
                else
                {
                        str.append(clauses[i].query->ToStringWithField(field));
                }

                if (i != (clauses.size()-1))
                    str.append(" ");
        }

        if (GetBoost() != 1.0)
        {
                str.append(")^");
                str.append(ConvertFloat(GetBoost()));
        }

        return str;
}

FieldSet BooleanQuery::GetQueryFields()
{
        FieldSet fields;
        for (uint32_t i = 0; i < clauses.size(); ++i)
        {
                FieldSet clause_fields = clauses[i].query->GetQueryFields();
                fields.insert(clause_fields.begin(), clause_fields.end());
        }
        return fields;
}

Weight * BooleanQuery::CreateWeight(QueryPtr thisquery, Searcher * searcher)
{
        return new BooleanWeight(thisquery, searcher);
}

BooleanQuery::BooleanWeight::BooleanWeight(QueryPtr _query, Searcher * _searcher)
{
        query = _query;
        searcher = _searcher;

        norm = 0;
        BooleanQuery * booleanquery = ((BooleanQuery *)query.get());
        for (std::vector<BooleanClause>::iterator it = booleanquery->clauses.begin();
            it != booleanquery->clauses.end(); ++it)
        {
                QueryPtr q = it->query;
                Weight * weight = q->GetWeight(q, searcher);
                std::shared_ptr<Weight> scoped_weight(weight);
                weights.push_back(scoped_weight);
        }
}

BooleanQuery::BooleanWeight::~BooleanWeight()
{
}

QueryPtr BooleanQuery::BooleanWeight::GetQuery()
{
        return query;
}

float BooleanQuery::BooleanWeight::GetValue()
{
        return query->GetBoost();
}

float BooleanQuery::BooleanWeight::SumOfSquaredWeights()
{
        float sum = 0;
        for (uint32_t i = 0; i < weights.size(); ++i)
            if (!((BooleanQuery *)query.get())->clauses[i].prohibited)
                sum += weights[i]->SumOfSquaredWeights();
        sum *= query->GetBoost() * query->GetBoost();
        return sum;
}

void BooleanQuery::BooleanWeight::Normalize(float norm)
{
        norm *= query->GetBoost();
        for (uint32_t i = 0; i < weights.size(); ++i)
            if (!((BooleanQuery *)query.get())->clauses[i].prohibited)
                weights[i]->Normalize(norm);
}

Scorer * BooleanQuery::BooleanWeight::GetScorer(IndexReader * reader)
{
        BooleanScorer * result = new BooleanScorer(searcher->GetSimilarity());
        for (uint32_t i = 0; i < weights.size(); ++i)
        {
                const BooleanClause & c = ((BooleanQuery *)query.get())->clauses[i];
                Scorer * subscorer = weights[i]->GetScorer(reader);
                if (subscorer != NULL)
                    result->Add(subscorer, c.required, c.prohibited);
                else if (c.required)
                {
                        delete result;
                        return NULL;
                }
        }
        return result;
}

BooleanScorer::BooleanScorer(Similarity &similarity)
: Scorer(similarity)
{
        scorers = NULL;
        maxcoord = 1;
        coordfactors.clear();
        requiredmask = 0;
        prohibitedmask = 0;
        nextmask = 1;
        currentdoc = 0;
        buckettable.reset(new BucketTable(this));
}

BooleanScorer::~BooleanScorer()
{
        while (scorers != NULL)
        {
                SubScorer * nextscorer = scorers->next;
                delete scorers;
                scorers = nextscorer;
        }
}

void BooleanScorer::Add(Scorer * scorer, bool required, bool prohibited)
{
        uint32_t mask = 0;
        if (required || prohibited)
        {
                if (nextmask == 0)
                    throw LuceneException("More than 32 required/prohibited clauses in query",false);
                mask = nextmask;
                nextmask = nextmask << 1;
        }

        if (!prohibited)
            maxcoord++;

        if (prohibited)
            prohibitedmask |= mask;
        else if (required)
            requiredmask |= mask;

        scorers = new SubScorer(scorer, required, prohibited, buckettable->NewCollector(mask, buckettable), scorers);
}

void BooleanScorer::Score(HitCollector * results, uint32_t maxdoc)
{
        if (coordfactors.size() == 0)
            ComputeCoordFactors();

        while (currentdoc < maxdoc)
        {
                currentdoc = std::min(currentdoc + buckettable->SIZE, maxdoc);
                for (SubScorer * t = scorers; t != NULL; t = t->next)
                    t->scorer->Score(t->collector, currentdoc);
                buckettable->CollectHits(results);
        }
}

void BooleanScorer::ComputeCoordFactors()
{
        coordfactors.clear();
        coordfactors.resize(maxcoord);
        for (uint32_t i = 0; i < maxcoord; ++i)
            coordfactors[i] = GetSimilarity().Coord(i, maxcoord-1);
}

BooleanScorer::SubScorer::SubScorer(Scorer * _scorer,
                                    bool _required,
                                    bool _prohibited,
                                    HitCollector * _collector,
                                    SubScorer * _next)
{
        scorer = _scorer;
        required = _required;
        prohibited = _prohibited;
        collector = _collector;
        next = _next;
}

BooleanScorer::SubScorer::~SubScorer()
{
        delete scorer;
        delete collector;
}

BooleanScorer::Bucket::Bucket()
{
        doc = -1;
        score = 0;
        bits = 0;
        coord = 0;
        next = NULL;
}

uint32_t BooleanScorer::BucketTable::SIZE = 1 << 10;
uint32_t BooleanScorer::BucketTable::MASK = BooleanScorer::BucketTable::SIZE - 1;

BooleanScorer::BucketTable::BucketTable(BooleanScorer * _scorer)
{
        buckets.resize(SIZE);
        scorer = _scorer;
        first = NULL;
}

BooleanScorer::BucketTable::~BucketTable()
{
        for (uint32_t i = 0; i < buckets.size(); ++i)
            delete buckets[i];
}

void BooleanScorer::BucketTable::CollectHits(HitCollector * results)
{
        uint32_t required = scorer->requiredmask;
        uint32_t prohibited = scorer->prohibitedmask;
        std::vector<float> coord = scorer->coordfactors;

        for (Bucket * bucket = first; bucket != NULL; bucket = bucket->next)
        {
                if (((bucket->bits & prohibited) == 0) &&
                    ((bucket->bits & required) == required))
                    results->Collect(bucket->doc, bucket->score * coord[bucket->coord]);
        }
        first = NULL;
}

uint32_t BooleanScorer::BucketTable::Size()
{
        return SIZE;
}

HitCollector * BooleanScorer::BucketTable::NewCollector(uint32_t mask, std::shared_ptr<BucketTable> buckettable)
{
        return new Collector(mask, buckettable);
}

BooleanScorer::Collector::Collector(uint32_t _mask, std::shared_ptr<BucketTable> _buckettable)
{
        mask = _mask;
        buckettable = _buckettable;
}

BooleanScorer::Collector::~Collector()
{
}

void BooleanScorer::Collector::Collect(uint32_t doc, float score)
{
        uint32_t i = doc & buckettable->MASK;
        Bucket * bucket = buckettable->buckets[i];
        if (bucket == NULL)
        {
                delete buckettable->buckets[i];
                bucket = new Bucket;
                buckettable->buckets[i] = bucket;
        }

        if (bucket->doc < 0 || (uint32_t)bucket->doc != doc)
        {
                bucket->doc = doc;
                bucket->score = score;
                bucket->bits = mask;
                bucket->coord = 1;

                bucket->next = buckettable->first;
                buckettable->first = bucket;
        }
        else
        {
                bucket->score += score;
                bucket->bits |= mask;
                bucket->coord++;
        }
}

} // namespace Lucene

