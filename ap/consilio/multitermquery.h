#ifndef blex_consilio_search_multitermquery
#define blex_consilio_search_multitermquery

#include "query.h"
#include "term.h"
#include "filteredtermenum.h"

namespace Lucene
{

/** A Query that matches documents containing a subset of terms provided by a
    FilteredTermEnum enumeration.
    MultiTermQuery is not designed to be used by itself. The reason being that it
    is not intialized with a FilteredTermEnum enumeration. A FilteredTermEnum
    enumeration needs to be provided. For example, WildcardQuery extends
    MultiTermQuery to provide WildcardTermEnum. */
class MultiTermQuery : public Query
{
    public:
        /** Create a MultiTermQuery for terms matching @c term.
            @param term The Term to match */
        MultiTermQuery(const Term & term);

        MultiTermQuery()
        {}

        bool operator==(const Query & other) const;

        /** The Term other terms must match.
            @return The Term to match */
        Term GetTerm();

        virtual QueryPtr Rewrite(QueryPtr thisquery, IndexReader * reader);
        virtual std::string ToStringWithField(const std::string & field);
        virtual FieldSet GetQueryFields();

    protected:
        /** Get the FilteredTermEnum that matches terms to ::term.
            @param reader The IndexReader to read terms from */
        virtual std::shared_ptr<FilteredTermEnum> GetEnum(IndexReader * reader) = 0;

        /// The Term to match
        Term term;

        friend class MultiTermQueryWrapperFilter;
};

} // namespace Lucene

#endif
