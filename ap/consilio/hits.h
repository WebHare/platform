#ifndef blex_consilio_search_hits
#define blex_consilio_search_hits

//#include "query.h"
#include "filter.h"
#include "topdocs.h"
#include "document.h"

namespace Lucene
{

class Searcher;                 // Forward declaration for searcher.h
struct HitDoc;                  // Forward declaration

/** One retrieved matched Document.
    After a search, only Document id's are returned. When a user requests the
    Document itself, it is retrieved by Hits and stored as a HitDoc. */
struct HitDoc
{
        /** Create a HitDoc for a given Document.
            @param s The score for the Document
            @param i The id of the Document */
        HitDoc(float s, uint32_t i);
        HitDoc(const HitDoc & org) = default;
        HitDoc operator= (const HitDoc & org);

        /// Document score
        float score;
        /// Document id
        uint32_t id;
        /// The Document itself
        std::shared_ptr<Document> doc;

        /// Pointer to the next HitDoc in the list
        HitDoc * next;
        /// Pointer to the previous HitDoc in the list
        HitDoc * prev;
};

/** A class to store Document%s that matched a Query. */
class Hits
{
    public:
        /** Store matched Document%s for a Query on a Searcher with a Filter.
            @param s The Searcher that runs the Query
            @param q The Query that is run on the index
            @param f A Filter that filters out Document%s */
        Hits(Searcher * s, QueryPtr q, FilterPtr f);

        /** The number of hits. */
        uint32_t size();

        /** Get the stored Field%s for a matched Document.
            @param n The Document to retrieve (i.e. its position in the results
                     list) */
        Document * Doc(uint32_t n);
        /** Get the score for a matched Document.
            @param n The Document to retrieve the score for (i.e. its position in
                     the results list) */
        float Score(uint32_t n);
        /** Get the id for a matched Document.
            @param n The Document to retrieve the id for (i.e. its position in
                     the results list) */
        uint32_t Id(uint32_t n);

    private:
        /** Retrieve more results.
            @param min The hit number that should at least be retrieved */
        void GetMoreDocs(uint32_t min);

        /** Get the HitDoc for a matched Document.
            @param n The Document to retrieve the HitDoc for (i.e. its position
                     in the results list) */
        HitDoc * GetHitDoc(uint32_t n);

        /** Add a HitDoc to the front of the list of HitDoc%s.
            @param hitdoc The HitDoc to add */
        void AddToFront(HitDoc * hitdoc);
        /** Remove a HitDoc from the list of HitDoc%s.
            @param hitdoc The HitDoc to remove */
        void Remove(HitDoc * hitdoc);

        /// The Query that is run on the index
        QueryPtr query;
        /// The Searcher that runs the Query
        Searcher * searcher;
        /// A Filter that filters out Document%s
        FilterPtr filter;

        /// The total number of hits
        uint32_t length;
        /// A store for HitDoc%s (the HitDoc list is maintained as a linked list
        /// by ::first, ::last, HitDoc::next and HitDoc::prev)
        std::vector<HitDoc> hitdocs;

        /// Pointer to the first HitDoc
        HitDoc * first;
        /// Pointer to the last HitDoc
        HitDoc * last;
        /// The number of retrieved HitDoc%s
        uint32_t numdocs;
};

/** Collector for Hits. */
class HitCollector
{
    public:
        virtual ~HitCollector();

        /** Called once for every non-zero scoring document, with the document
            number and its score.
            @note
            This is called in an inner search loop. For good search performance,
            implementations of this method should not call Searcher::Doc or
            IndexReader::GetDocument on every document number encountered. Doing
            so can slow searches by an order of magnitude or more.
            @par
            The @c score passed to this method is a raw score. In other words, the
            score will not necessarily be a float whose value is between 0 and 1.
            @param doc Id of the matched Document
            @param score The score for the Document */
        virtual void Collect(uint32_t doc, float score) = 0;
};

/** A set of ScoreDoc%s. */
typedef std::set<ScoreDoc> HitQueue;

} // namespace Lucene

#endif

