#include <ap/libwebhare/allincludes.h>


#include "topdocs.h"

namespace Lucene
{

ScoreDoc::ScoreDoc(uint32_t _doc, float _score)
{
        doc = _doc;
        score = _score;
}

TopDocs::TopDocs(uint32_t _totalhits, const std::vector<ScoreDoc> & _scoredocs)
{
        totalhits = _totalhits;
        scoredocs.assign(_scoredocs.begin(), _scoredocs.end());
}

bool operator< (const ScoreDoc & a, const ScoreDoc & b)
{
        if (a.score == b.score)
            return a.doc < b.doc;
        else
            return a.score > b.score;
}

} // namespace Lucene

