#include <ap/libwebhare/allincludes.h>


#include "hits.h"
#include "searcher.h"

namespace Lucene
{

Hits::Hits(Searcher * s, QueryPtr q, FilterPtr f)
{
        searcher = s;
        query = q;
        filter = f;

        first = NULL;
        last = NULL;
        numdocs = 0;

        GetMoreDocs(50);
}

uint32_t Hits::size()
{
        return length;
}

Document * Hits::Doc(uint32_t n)
{
        HitDoc & hitdoc = hitdocs[n];

        Remove(&hitdoc);
        AddToFront(&hitdoc);
        if (numdocs > MAX_CACHE_DOCS)
        {
                HitDoc * oldlast = last;
                Remove(last);
                oldlast->doc.reset();
        }

        if (!hitdoc.doc.get())
            hitdoc.doc.reset(searcher->Doc(hitdoc.id));

        return hitdoc.doc.get();
}

float Hits::Score(uint32_t n)
{
        return GetHitDoc(n)->score;
}

uint32_t Hits::Id(uint32_t n)
{
        return GetHitDoc(n)->id;
}

void Hits::GetMoreDocs(uint32_t min)
{
        if (hitdocs.size() > min)
            min = hitdocs.size();

        uint32_t n = min * 2;
        TopDocs topdocs = searcher->SearchTopDocs(query, filter, n);
        length = topdocs.totalhits;
        std::vector<ScoreDoc> & scoredocs = topdocs.scoredocs;

        float scorenorm = 1.0;
        if ((length > 0) && (scoredocs[0].score > 1.0))
            scorenorm = 1.0 / scoredocs[0].score;

        uint32_t end = (scoredocs.size() < length) ? scoredocs.size() : length;
        for (uint32_t i = 0; i < end; ++i)
            hitdocs.push_back(HitDoc(scoredocs[i].score * scorenorm, scoredocs[i].doc));
}

HitDoc * Hits::GetHitDoc(uint32_t n)
{
        if (n >= length)
            return NULL;

        if (n >= hitdocs.size())
            GetMoreDocs(n);

        return &hitdocs[n];
}

void Hits::AddToFront(HitDoc * hitdoc)
{
        if (first == NULL)
            last = hitdoc;
        else
            first->prev = hitdoc;

        hitdoc->next = first;
        first = hitdoc;
        hitdoc->prev = NULL;

        numdocs++;
}

void Hits::Remove(HitDoc * hitdoc)
{
        if (hitdoc->doc == NULL)
            return;

        if (hitdoc->next == NULL)
            last = hitdoc->prev;
        else
            hitdoc->next->prev = hitdoc->prev;

        if (hitdoc->prev == NULL)
            first = hitdoc->next;
        else
            hitdoc->prev->next = hitdoc->next;

        numdocs--;
}

HitDoc::HitDoc(float s, uint32_t i)
{
        score = s;
        id = i;
        doc.reset();
        next = NULL;
        prev = NULL;
}

HitDoc HitDoc::operator=(const HitDoc & org)
{
        HitDoc hitdoc = HitDoc(org.score, org.id);
        hitdoc.doc = org.doc;
        hitdoc.next = org.next;
        hitdoc.prev = org.prev;
        return hitdoc;
}

HitCollector::~HitCollector()
{
}

} // namespace Lucene

