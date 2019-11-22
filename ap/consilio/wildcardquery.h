#ifndef blex_consilio_search_wildcardquery
#define blex_consilio_search_wildcardquery

#include "multitermquery.h"
#include "filteredtermenum.h"
#include "term.h"

namespace Lucene
{

/** A Query for matching terms against a wildcard pattern.
    Supported wildcard characters are:
    - <tt>*</tt>, which matches any sequence of characters, including an empty string;
    - and <tt>?</tt>, which matches exactly one character.
    .
    Patterns that start with a wildcard character are not supported. */
class WildcardQuery : public MultiTermQuery
{
    public:
        /** Create a WildcardQuery for a given wildcard @c term.
            @param term The wildcard Term to use; the Term::Field() value is the
                        field that is being searched through, while Term::Text()
                        holds the wildcard pattern to look for */
        WildcardQuery(const Term & term);

        bool operator==(const Query & other) const;

        virtual QueryPtr Clone();

    protected:
        virtual std::shared_ptr<FilteredTermEnum> GetEnum(IndexReader * reader);
};

/** Enumerate over a subset of Term%s conforming to a wildcard pattern. */
class WildcardTermEnum : public FilteredTermEnum
{
    public:
        /** Create a new WildcardTermEnum.
            @param reader The IndexReader to read from
            @param term The wildcard Term to use; the Term::Field() value is the
                        field that is being searched through, while Term::Text()
                        holds the wildcard pattern to look for */
        WildcardTermEnum(IndexReader * reader, const Term & term);

        virtual float Difference();
        virtual bool EndEnum();

        /** Check if (a part of) a string value matches (a part of) a wildcard
            pattern.
            @param pat The wildcard pattern
            @param patidx The position within the pattern to start checking
            @param str The string value to check
            @param stridx The position within the string value to start checking
            @return If the string value matches the wildcard pattern */
        bool WildcardEquals(const std::string & pat, int32_t patidx,
                            const std::string & str, int32_t stridx);

    protected:
        virtual bool TermCompare(const Term & term);

    private:
        /// The wildcard term to match
        Term searchterm;
        /// The Term field to match
        std::string field;
        /// The wildcard part of the searchterm to match
        std::string text;
        /// The common text part of the searchterm to match
        std::string pre;
        /// The size of the pre part
        int32_t prelen;
        /// Did the fields match?
        bool fieldmatch;
        /// Is the end of the enum reached?
        bool endenum;
};

} // namespace Lucene

#endif

