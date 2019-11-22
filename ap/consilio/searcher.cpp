#include <ap/libwebhare/allincludes.h>


#include "searcher.h"

namespace Lucene
{

Searcher::Searcher()
: similarity(Similarity::GetDefault())
{
}

Searcher::~Searcher()
{
}

Hits * Searcher::Search(QueryPtr query)
{
        return Search(query, FilterPtr());
}

Hits * Searcher::Search(QueryPtr query, FilterPtr filter)
{
        if (!query.get())
            throw LuceneException("No query to search for",false);

        return new Hits(this, query, filter);
}

Similarity& Searcher::GetSimilarity()
{
        return similarity;
}

IndexSearcher::IndexSearcher(Blex::Mutex &commit_lock, Blex::ComplexFileSystem &directory, SegmentsCache &cache)
{
        reader = IndexReader::Open(commit_lock, directory, cache);
}

IndexSearcher::IndexSearcher(IndexReader * r)
{
        reader = r;
}

IndexSearcher::~IndexSearcher()
{
        delete reader;
}

int32_t IndexSearcher::DocFreq(const Term & term)
{
        return reader->DocFreq(term);
}

Document * IndexSearcher::Doc(uint32_t i)
{
        return reader->GetDocument(i);
}

uint32_t IndexSearcher::MaxDoc()
{
        return reader->MaxDoc();
}

TopDocs IndexSearcher::SearchTopDocs(QueryPtr query, FilterPtr filter, uint32_t)
{
        const std::unique_ptr<Weight> weight(query->GetWeight(query, this));
        const std::unique_ptr<Scorer> scorer(weight->GetScorer(reader));
        if (!scorer.get())
            return TopDocs(0, std::vector<ScoreDoc>());

        uint32_t totalhits = 0;
        std::shared_ptr<BitVector> bits;
        if (filter)
            bits = filter->Bits(reader);
        HitQueue hq;
        const std::unique_ptr<HitCollector> hc(new Collector(bits, &hq, &totalhits));
        scorer->Score(hc.get(), reader->MaxDoc());

        std::vector<ScoreDoc> scoredocs;
        scoredocs.reserve(hq.size());
        for (std::set<ScoreDoc>::iterator it = hq.begin(); it != hq.end(); ++it)
            scoredocs.push_back(*it);

        return TopDocs(totalhits, scoredocs);
}

QueryPtr IndexSearcher::Rewrite(QueryPtr original)
{
        QueryPtr query = original;
        QueryPtr rewritten = query->Rewrite(query, reader);
        while (*rewritten.get() != *query.get())
        {
                query = rewritten;
                rewritten = query->Rewrite(query, reader);
        }
        return query;
}

IndexSearcher::Collector::Collector(std::shared_ptr<BitVector> _bits, HitQueue * _hq, uint32_t * _totalhits)
: hq(_hq)
, totalhits(_totalhits)
{
        bits = _bits;
}

void IndexSearcher::Collector::Collect(uint32_t doc, float score)
{
        if ((score > 0.0) && (!bits.get() || bits->Get(doc)))
        {
                (*totalhits)++;
                hq->insert(ScoreDoc(doc, score));
        }
}

} // namespace Lucene

