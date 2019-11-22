#include <ap/libwebhare/allincludes.h>


#include <sstream>
#include "query.h"
#include "searcher.h"

namespace Lucene
{

std::string ConvertFloat(float f)
{
        std::ostringstream conv;
        conv.precision(4);
        conv << (f + 0.00005);
        return conv.str();
}

Scorer::Scorer(Similarity& _similarity)
: similarity(_similarity)
{
}

Scorer::~Scorer()
{
}

Query::Query()
{
        boost = 1.0;
}

Query::~Query()
{
}

bool Query::operator==(const Query & other) const
{
        return GetBoost() == other.GetBoost();
}

bool Query::operator!=(const Query & other) const
{
        return !(*this == other);
}

void Query::SetBoost(float b)
{
        boost = b;
}

float Query::GetBoost() const
{
        return boost;
}

std::string Query::ToString()
{
        return ToStringWithField("");
}

Weight * Query::GetWeight(QueryPtr thisquery, Searcher * searcher)
{
        QueryPtr query = searcher->Rewrite(thisquery);
        Weight * weight = query->CreateWeight(query, searcher);
        float sum = weight->SumOfSquaredWeights();
        float norm = searcher->GetSimilarity().QueryNorm(sum);
        weight->Normalize(norm);
        return weight;
}

/* We use the first parameter to return the shared_ptr itself when rewriting the
   query, instead of creating a new shared_ptr for this query. */
QueryPtr Query::Rewrite(QueryPtr thisquery, IndexReader *)
{
        return thisquery;
}

QueryPtr Query::Combine(std::vector<QueryPtr>)
{
        throw LuceneException("Combine not supported for this query",false);
}

QueryPtr Query::Clone()
{
        throw LuceneException("Clone not supported for this query",false);
}

Weight * Query::CreateWeight(QueryPtr, Searcher *)
{
        throw LuceneException("CreateWeight not supported for this query",false);
}

Weight::~Weight()
{
}

} // namespace Lucene

