#ifndef blex_consilio_search_phrasequery
#define blex_consilio_search_phrasequery

#include "query.h"
#include "term.h"

namespace Lucene
{

/** A Query for matching a number of terms in a certain order.
    To use this Query, create a new PhraseQuery and add Term%s in the order they
    should be matched. Additionally a slop factor can be set to make phrase matching
    more sloppy. The slop factor is the number of words that may appear between
    the words in the query phrase. */
class PhraseQuery : public Query
{
    public:
        PhraseQuery();

        bool operator==(const Query & other) const;

        /** Set the slop factor. The default slop factor is 0.
            @param s The new slop factor */
        void SetSlop(uint32_t s);
        /** Get the current slop factor.
            @return The current slop factor */
        uint32_t GetSlop();

        /** Add a phrase Term to the query. Additional terms must match the field
            of the first term (all terms should be of the same field).
            @param term The term to add */
        void Add(const Term & term);
        /** Get the list of Term%s to match.
            @return The current phrase Term%s */
        const std::vector<Term> & GetTerms();

        virtual QueryPtr Clone();
        virtual std::string ToStringWithField(const std::string & field);
        virtual FieldSet GetQueryFields();

    protected:
        virtual Weight * CreateWeight(QueryPtr thisquery, Searcher * searcher);

    private:
        class PhraseWeight;

        /// The field all phrase terms must match
        std::string field;
        /// Phrase Term%s
        std::vector<Term> terms;
        /// Slop factor
        uint32_t slop;

    friend class PhraseWeight;
};

/** Weight for PhraseQuery%s. */
class PhraseQuery::PhraseWeight : public Weight
{
    public:
        /** Create a PhraseWeight for a Searcher.
            @param query The PhraseQuery that creates the PhraseWeight
            @param searcher The Searcher the PhraseWeight is created for */
        PhraseWeight(QueryPtr query, Searcher * searcher);
        ~PhraseWeight();

        virtual QueryPtr GetQuery();
        virtual float GetValue();
        virtual float SumOfSquaredWeights();
        virtual void Normalize(float querynorm);
        virtual Scorer * GetScorer(IndexReader * reader);

    private:
        /// The PhraseQuery that create this PhraseWeight
        QueryPtr query;
        /// The Searcher this PhraseWeight is created for
        Searcher * searcher;
        /// The normalized weight value
        float value;
        /// Inverse document frequency for this phrase
        float idf;
        /// PhraseQuery normalization factor
        float querynorm;
        /// PhraseQuery weight
        float queryweight;
};

/** Structure that holds the Document positions for a Term in the index. */
struct PhrasePositions
{
        /// Current Document
        uint32_t doc;
        /// Position in the current Document, or -1 if no positions left
        int32_t position;
        /// Number of occurrences in the current Document
        uint32_t count;
        /// Position of the Term in the PhraseQuery phrase
        uint32_t offset;
        /// The TermDocs class that holds the positions for a Term
        std::shared_ptr<TermDocs> tp;
        /// Pointer to the next PhrasePositions structure
        std::shared_ptr<PhrasePositions> next;

        /** Create a new PhrasePositions structure.
            @param t The TermDocs class that holds the positions for a Term
            @param o Position of the Term in the PhraseQuery phrase */
        PhrasePositions(std::shared_ptr<TermDocs> t, uint32_t o);

        bool operator< (const PhrasePositions & other) const;

        /** Skip to the next Document. */
        void Next();
        /** Reset to the first position for the current Document. */
        void FirstPosition();
        /** Skip to the next position within the current Document. */
        bool NextPosition();
};

/** A function object to compare PhrasePositions.
    less_PP is used as the sorting criterion for std::sort sorting of a list of
    PhrasePositions.

    PhrasePositions are sorted first by Document number, then by position within
    the Document. */
class less_PP
{
    public:
        bool operator() (const std::shared_ptr<PhrasePositions> &pp1, const std::shared_ptr<PhrasePositions> &pp2)
        {
                return *pp1 < *pp2;
        }
};

/** Scorer for PhraseQuery%s. */
class PhraseScorer : public Scorer
{
    public:
        /** Create a PhraseScorer with a Similarity to use to score Document%s.
            @param weight The PhraseQuery::PhraseWeight this PhraseScorer is
                          created for
            @param tps A list of TermDocs with matching Document%s for the PhraseQuery
                       Term%s
            @param similarity The Similarity to use
            @param norms Normalization factors for the Document%s */
        PhraseScorer(Weight * weight, const std::vector<std::shared_ptr<TermDocs> > & tps, Similarity &similarity, const Blex::PodVector< uint8_t > & norms);
        ~PhraseScorer();

        virtual void Score(HitCollector * results, uint32_t maxdoc);

    protected:
        /// Store for PhrasePositions structures, one for each Term in the PhraseQuery
        std::vector<std::shared_ptr<PhrasePositions> > pq;
        /// Pointer to the first PhrasePositions structure in the linked list
        std::shared_ptr<PhrasePositions> first;
        /// Pointer to the last PhrasePositions structure in the linked list
        std::shared_ptr<PhrasePositions> last;

        /// Make a linked list of all PhrasePositions structures in ::pq
        void PqToList();
        /// Move the first PhrasePositions structure to the end of the linked list
        void FirstToLast();

    private:
        /** Calculate the number of times the phrase occurs in the current document. */
        virtual float PhraseFreq() = 0;

        /// The PhraseQuery::PhraseWeight this Scorer is created for
        Weight * weight;
        /// Normalization factors for the Document%s
        Blex::PodVector< uint8_t > norms;
        /// Weight value of the PhraseQuery::PhraseWeight
        float weightvalue;

        /// The number of occurrences of the PhraseQuery phrase in the current
        /// document.
        float freq;
};

/** Optimized Scorer for exact matches of PhraseQuery%s. */
class ExactPhraseScorer : public PhraseScorer
{
    public:
        /** Create a ExactPhraseScorer with a Similarity to use to score Document%s.
            @param weight The PhraseQuery::PhraseWeight this ExactPhraseScorer
                          is created for
            @param tps A list of TermDocs with matching Document%s for the PhraseQuery
                       Term%s
            @param similarity The Similarity to use
            @param norms Normalization factors for the Document%s */
        ExactPhraseScorer(Weight * weight, const std::vector<std::shared_ptr<TermDocs> > & tps, Similarity &similarity, Blex::PodVector< uint8_t > const& norms)
        : PhraseScorer(weight, tps, similarity, norms)
        {}

    private:
        virtual float PhraseFreq();
};

/** A Scorer for sloppy matches of PhraseQuery%s. */
class SloppyPhraseScorer : public PhraseScorer
{
    public:
        /** Create a SloppyPhraseScorer with a Similarity to use to score Document%s.
            @param weight The PhraseQuery::PhraseWeight this SloppyPhraseScorer
                          is created for
            @param tps A list of TermDocs with matching Document%s for the PhraseQuery
                       Term%s
            @param similarity The Similarity to use
            @param slop The slop factor to use when matching the PhraseQuery
            @param norms Normalization factors for the Document%s */
        SloppyPhraseScorer(Weight * weight, const std::vector<std::shared_ptr<TermDocs> > & tps, Similarity &similarity, uint32_t slop, Blex::PodVector< uint8_t > const& norms);
    private:
        virtual float PhraseFreq();

        /// Slop factor
        uint32_t slop;
};

} // namespace Lucene

#endif

