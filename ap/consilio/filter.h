#ifndef blex_consilio_search_filter
#define blex_consilio_search_filter

#include "bitvector.h"
#include "indexreader.h"
#include "multitermquery.h"
#include "query.h"
#include "term.h"

namespace Lucene
{

/** The Filter filters out certain Document%s from a results set.
    A Filter is implemented using a BitVector. In this BitVector, bits are set for
    each Document that is permitted and cleared for each Document that has to be
    filtered out.
    Thus, Document @c n is kept if <tt>bits.Get(n) == true</tt>. */
class Filter
{
    public:
        virtual ~Filter();
        /** Get the Filter bits.
            @return A BitVector containing the Filter bits */
        virtual std::shared_ptr<BitVector> Bits(IndexReader *reader) = 0;

        /** Get a string representation of the Filter */
        virtual std::string ToString();
};

typedef std::shared_ptr<Filter> FilterPtr;

/** A Filter that applies multiple Filter%s and filters out Document%s that are
    filtered out by any one, all or none of the Filter%s. */
class MultiFilter : public Filter
{
    public:
        /** Create a MultiFilter. It is invalid for a MultiFilter to match both
            all and no terms.
            @param all Set to true if Document%s must match all Filter%s
            @param none Set to true if Document%s must not match any of the Filter%s */
        MultiFilter(bool all, bool none);
        /** Add a Filter.
            @param filter The Filter to add */
        void Add(FilterPtr filter);

        virtual std::shared_ptr<BitVector> Bits(IndexReader *reader);
        virtual std::string ToString();

    private:
        /// The list of Filter%s
        std::vector<FilterPtr> filters;
        /// All Filter%s must be matched
        bool all;
        /// No Filter may be matched
        bool none;
};

/** Filter out Document%s that do not contain a Term that starts with a given Term. */
class InitialValueFilter : public Filter
{
    public:
        /** Create a Filter that filters out Document%s that do not contain a Term
            that starts with @c initialterm.
            @param initialterm The Term that some Document Term should begin with */
        InitialValueFilter(Term const &initialterm);

        virtual std::shared_ptr<BitVector> Bits(IndexReader *reader);
        virtual std::string ToString();

    private:
        /// The initial Term part to look for
        Term initialterm;
};

/** Filter out Document%s that do not match a given MultiTermQuery. This class is
    not used directly, but subclassed for a MultiTermQuery descendant. */
class MultiTermQueryWrapperFilter : public Filter
{
    public:
        MultiTermQueryWrapperFilter(QueryPtr query);

        virtual std::shared_ptr<BitVector> Bits(IndexReader *reader);

    protected:
        QueryPtr query;
        MultiTermQuery *multitermquery; // The 'query' pointer, casted to MultiTermQuery *
};

/** Filter out Document%s that do not fall within a given field range. */
class RangeFilter : public MultiTermQueryWrapperFilter
{
    public:
        RangeFilter(const std::string &fieldname,
                    const std::string &lowerterm, const std::string &upperterm,
                    bool includelower, bool includeupper);

        virtual std::string ToString();
};

} // namespace Lucene

#endif

