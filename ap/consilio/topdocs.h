#ifndef blex_consilio_search_topdocs
#define blex_consilio_search_topdocs

#include "consilio.h"

namespace Lucene
{

/** The id and score for a single, matched Document. */
struct ScoreDoc
{
        /** Create a scored document.
            @param doc Id of the matched Document
            @param score Score for the matched Document */
        ScoreDoc(uint32_t doc, float score);

        /// Score for the matched Document
        float score;
        /// Id of the matched Document
        uint32_t doc;
};

/** Structure to store matched Document%s, returned by some low-level search
    functions. */
struct TopDocs
{
        /** Create a TopDocs structure.
            @param totalhits The total number of matched Document%s
            @param scoredocs The matched Document%s with their scores */
        TopDocs(uint32_t totalhits, const std::vector<ScoreDoc> & scoredocs);

        /// Total number of matched Document%s
        uint32_t totalhits;
        /// Matched Document%s with their scores
        std::vector<ScoreDoc> scoredocs;
};

bool operator< (const ScoreDoc & a, const ScoreDoc & b);

} // namespace Lucene

#endif

