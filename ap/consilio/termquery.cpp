#include <ap/libwebhare/allincludes.h>



#include "termquery.h"

namespace Lucene
{

TermQuery::TermQuery(Term t)
{
        term = t;
}

bool TermQuery::operator==(const Query & other) const
{
        if (typeid(other) != typeid(TermQuery))
            return false;
        const TermQuery & otherterm = (const TermQuery &)other;
        return (GetBoost() == otherterm.GetBoost())
            && term.Equals(otherterm.term);
}

Term TermQuery::GetTerm()
{
        return term;
}

Weight * TermQuery::CreateWeight(QueryPtr thisquery, Searcher * searcher)
{
        return new TermWeight(thisquery, searcher);
}

QueryPtr TermQuery::Clone()
{
        return QueryPtr(new TermQuery(*this));
}

std::string TermQuery::ToStringWithField(const std::string & field)
{
        std::string str;
        if (field.compare(term.Field()))
        {
                str.append(term.Field());
                str.append(":");
        }
        str.append(term.Text());
        if (GetBoost() != 1.0)
        {
                str.append("^");
                str.append(ConvertFloat(GetBoost()));
        }
        return str;
}

FieldSet TermQuery::GetQueryFields()
{
        FieldSet fields;
        fields.insert(term.Field());
        return fields;
}

TermQuery::TermWeight::TermWeight(QueryPtr _query, Searcher * _searcher)
{
        query = _query;
        searcher = _searcher;

        querynorm = 0;
        queryweight = 0;
}

TermQuery::TermWeight::~TermWeight()
{
}

QueryPtr TermQuery::TermWeight::GetQuery()
{
        return query;
}

float TermQuery::TermWeight::GetValue()
{
        return value;
}

float TermQuery::TermWeight::SumOfSquaredWeights()
{
        TermQuery * q = (TermQuery *)query.get();
        idf = searcher->GetSimilarity().Idf(q->term, searcher);
        queryweight = idf * q->GetBoost();
        return queryweight * queryweight;
}

void TermQuery::TermWeight::Normalize(float _querynorm)
{
        querynorm = _querynorm;
        queryweight *= querynorm;
        value = queryweight * idf;
}

Scorer * TermQuery::TermWeight::GetScorer(IndexReader * reader)
{
        TermQuery * q = (TermQuery *)query.get();
        TermDocs * termdocs = reader->GetTermDocs(q->term);
        if (termdocs == NULL)
            return NULL;
        return new TermScorer(this, termdocs, searcher->GetSimilarity(), reader->Norms(q->term.Field()));
}

TermScorer::TermScorer(Weight * _weight, TermDocs * td, Similarity &similarity, const Blex::PodVector< uint8_t > & _norms)
: Scorer(similarity)
{
        weight = _weight;
        termdocs.reset(td);
        norms.assign(_norms.begin(), _norms.end());
        weightvalue = weight->GetValue();
        pointer = 0;

        docs.resize(32);
        freqs.resize(32);
        scorecache.resize(SCORE_CACHE_SIZE);

        for (uint32_t i = 0; i < SCORE_CACHE_SIZE; ++i)
            scorecache[i] = GetSimilarity().Tf((uint32_t)i) * weightvalue;

        pointermax = termdocs->Read(&docs, &freqs);

        if (pointermax != 0)
            doc = docs[0];
        else
        {
                termdocs.reset();
                doc = 0xFFFFFFFF;
        }
}

TermScorer::~TermScorer()
{
}

void TermScorer::Score(HitCollector * c, uint32_t end)
{
        uint32_t d = doc;
        while (d < end)
        {
                uint32_t f = freqs[pointer];
                float score = (f < SCORE_CACHE_SIZE) ? scorecache[f] : GetSimilarity().Tf((uint32_t)f) * weightvalue;

                score *= GetSimilarity().DecodeNorm(norms[d]);
                c->Collect(d, score);

                if (++pointer == pointermax)
                {
                        pointermax = termdocs->Read(&docs, &freqs);

                        if (pointermax != 0)
                            pointer = 0;
                        else
                        {
                                termdocs.reset();
                                doc = 0xFFFFFFFF;
                                return;
                        }
                }
                d = docs[pointer];
        }
        doc = d;
}

} // namespace Lucene

