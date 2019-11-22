#include <ap/libwebhare/allincludes.h>




#include "phrasequery.h"
#include "termquery.h"

namespace Lucene
{

PhraseQuery::PhraseQuery()
{
        slop = 0;
}

bool PhraseQuery::operator==(const Query & other) const
{
        if (typeid(other) != typeid(PhraseQuery))
            return false;
        const PhraseQuery & otherphrase = (const PhraseQuery &)other;
        return (GetBoost() == otherphrase.GetBoost())
            && (slop == otherphrase.slop)
            && (terms == otherphrase.terms);
}

void PhraseQuery::SetSlop(uint32_t s)
{
        slop = s;
}

uint32_t PhraseQuery::GetSlop()
{
        return slop;
}

void PhraseQuery::Add(const Term & term)
{
        if (terms.size() == 0)
            field = term.Field();
        else if (term.Field() != field)
            throw LuceneException("Term " + term.ToString() + " not of field " + field,false);

        terms.push_back(term);
}

const std::vector<Term> & PhraseQuery::GetTerms()
{
        return terms;
}

QueryPtr PhraseQuery::Clone()
{
        return QueryPtr(new PhraseQuery(*this));
}

std::string PhraseQuery::ToStringWithField(const std::string & _field)
{
        std::string str;
        if (_field.compare(field))
        {
                str.append(field);
                str.append(":");
        }
        str.append("\"");
        for (std::vector<Term>::iterator it = terms.begin(); it != terms.end(); ++it)
        {
                if (it != terms.begin())
                    str.append(" ");
                str.append(it->Text());
        }
        str.append("\"");
        if (slop != 0)
        {
                str.append("~");
                str.append(Blex::AnyToString(slop));
        }
        if (GetBoost() != 1.0)
        {
                str.append("^");
                str.append(ConvertFloat(GetBoost()));
        }
        return str;
}

FieldSet PhraseQuery::GetQueryFields()
{
        FieldSet fields;
        fields.insert(field);
        return fields;
}

Weight * PhraseQuery::CreateWeight(QueryPtr thisquery, Searcher * searcher)
{
        if (terms.size() == 1)
        {
                QueryPtr termquery(new TermQuery(terms[0]));
                termquery->SetBoost(GetBoost());
                return termquery->GetWeight(termquery, searcher);
        }
        return new PhraseWeight(thisquery, searcher);
}

PhraseQuery::PhraseWeight::PhraseWeight(QueryPtr _query, Searcher * _searcher)
{
        query = _query;
        searcher = _searcher;
        value = 0;
        idf = 0;
        querynorm = 0;
        queryweight = 0;
}

PhraseQuery::PhraseWeight::~PhraseWeight()
{
}

QueryPtr PhraseQuery::PhraseWeight::GetQuery()
{
        return query;
}

float PhraseQuery::PhraseWeight::GetValue()
{
        return value;
}

float PhraseQuery::PhraseWeight::SumOfSquaredWeights()
{
        idf = searcher->GetSimilarity().Idf(((PhraseQuery *)query.get())->terms, searcher);
        queryweight = idf * query->GetBoost();
        return queryweight * queryweight;
}

void PhraseQuery::PhraseWeight::Normalize(float _querynorm)
{
        querynorm = _querynorm;
        queryweight *= querynorm;
        value = queryweight * idf;
}

Scorer * PhraseQuery::PhraseWeight::GetScorer(IndexReader * reader)
{
        PhraseQuery *phrasequery = (PhraseQuery*)query.get();
        std::vector<Term> & terms = phrasequery->terms;
        if (terms.size() == 0)
            return NULL;

        std::vector<std::shared_ptr<TermDocs> > tps;
        for (uint32_t i = 0; i < terms.size(); i++)
        {
                std::shared_ptr<TermDocs> p = reader->GetTermPositionsPtr(terms[i]);
                if (!p.get())
                    return NULL;
                tps.push_back(p);
        }

        if (phrasequery->slop == 0)
            return new ExactPhraseScorer(this, tps, searcher->GetSimilarity(), reader->Norms(phrasequery->field));
        else
            return new SloppyPhraseScorer(this, tps, searcher->GetSimilarity(), phrasequery->slop, reader->Norms(phrasequery->field));
}

PhrasePositions::PhrasePositions(std::shared_ptr<TermDocs> t, uint32_t o)
: offset(o)
{
        tp = t;
        Next();
}

void PhrasePositions::Next()
{
        if (!tp->Next())
        {
                tp.reset();
                doc = 0xFFFFFFFF;
                position = 0;
                return;
        }
        doc = tp->Doc();
        position = 0;
}

void PhrasePositions::FirstPosition()
{
        count = tp->Freq();
        NextPosition();
}

bool PhrasePositions::NextPosition()
{
        if (count-- > 0)
        {
                position = tp->NextPosition();
                position -= offset;
                return true;
        }
        else
            return false;
}

bool PhrasePositions::operator< (const PhrasePositions & other) const
{
        if (doc == other.doc)
            return position < other.position;
        else
            return doc < other.doc;
}

PhraseScorer::PhraseScorer(Weight * _weight, const std::vector<std::shared_ptr<TermDocs> > & tps, Similarity &similarity, const Blex::PodVector<uint8_t> & _norms)
: Scorer(similarity)
{
        weight = _weight;
        norms.assign(_norms.begin(), _norms.end());
        weightvalue = weight->GetValue();

        for (uint32_t i = 0; i < tps.size(); ++i)
            pq.push_back(std::shared_ptr<PhrasePositions>(new PhrasePositions(tps[i],i)));
        std::sort(pq.begin(), pq.end(), less_PP());
        PqToList();
}

PhraseScorer::~PhraseScorer()
{
}

void PhraseScorer::Score(HitCollector * results, uint32_t end)
{
        while (last->doc < end)
        {
                while (first->doc < last->doc)
                {
                        do
                            first->Next();
                        while (first->doc < last->doc);
                        FirstToLast();
                        if (last->doc >= end)
                            return;
                }

                freq = PhraseFreq();

                if (freq > 0)
                {
                        float score = GetSimilarity().Tf(freq) * weightvalue;
                        score *= GetSimilarity().DecodeNorm(norms[first->doc]);
                        results->Collect(first->doc, score);
                }
                last->Next();
        }
}

void PhraseScorer::PqToList()
{
        first.reset();
        last.reset();
        while (pq.size() > 0)
        {
                if (last.get())
                    last->next = pq.front();
                else
                    first = pq.front();
                last = pq.front();
                last->next.reset();
                pq.erase(pq.begin());
        }
}

void PhraseScorer::FirstToLast()
{
        last->next = first;
        last = first;
        first = first->next;
        last->next.reset();
}

float ExactPhraseScorer::PhraseFreq()
{
        pq.clear();
        for (std::shared_ptr<PhrasePositions> pp = first; pp.get(); pp = pp->next)
        {
                pp->FirstPosition();
                pq.push_back(pp);
        }
        std::sort(pq.begin(), pq.end(), less_PP());
        PqToList();

        uint32_t freq = 0;
        do
        {
                while (first->position < last->position)
                {
                        do
                        {
                                if (!first->NextPosition())
                                    return (F64)freq;
                        }
                        while (first->position < last->position);
                        FirstToLast();
                }
                freq++;
        }
        while (last->NextPosition());

        return (F64)freq;
}

SloppyPhraseScorer::SloppyPhraseScorer(Weight * weight, const std::vector<std::shared_ptr<TermDocs> > & tps, Similarity &similarity, uint32_t _slop, Blex::PodVector< uint8_t > const& norms)
: PhraseScorer(weight, tps, similarity, norms)
, slop(_slop)
{}

float SloppyPhraseScorer::PhraseFreq()
{
        pq.clear();
        int32_t end = 0;
        for (std::shared_ptr<PhrasePositions> pp = first; pp.get(); pp = pp->next)
        {
                pp->FirstPosition();
                if (pp->position > end)
                    end = pp->position;
                pq.push_back(pp);
        }
        std::sort(pq.begin(), pq.end(), less_PP());

        float freq = 0;
        bool done = false;
        do
        {
                std::shared_ptr<PhrasePositions> pp = pq.front();
                pq.erase(pq.begin());
                int32_t start = pp->position;
                int32_t next = pq.front()->position;
                for (int32_t pos = start; pos <= next; pos = pp->position)
                {
                        start = pos;
                        if (!pp->NextPosition())
                        {
                                done = true;
                                break;
                        }
                }

                int32_t matchlength = end - start;
                if (matchlength <= (int32_t)slop)
                    freq += GetSimilarity().SloppyFreq(matchlength);

                if (pp->position > end)
                    end = pp->position;

                pq.push_back(pp);
                std::sort(pq.begin(), pq.end(), less_PP());
        }
        while (!done);

        return freq;
}

} // namespace Lucene

