#ifndef blex_consilio_search_filteredtermenum
#define blex_consilio_search_filteredtermenum

#include "term.h"
#include "indexreader.h"

namespace Lucene
{

/** Enumerate over a subset of Term%s. */
class FilteredTermEnum : public TermEnum
{
    public:
        FilteredTermEnum();

        virtual bool Next();
        virtual Term GetTerm();
        virtual int32_t DocFreq();

        /** Return a difference measure for the current Term.
            @return Difference for the current Term */
        virtual float Difference() = 0;

    protected:
        /** Compare a @c term against another term or pattern.
            Derived filtered enumerations must provide this function to check if
            the @c term should be included in the enumeration.
            @param term The Term to check
            @return If the Term should be included in the enumeration */
        virtual bool TermCompare(const Term & term) = 0;
        /** Are there any terms left?
            @return If the end of the enumerator is reached */
        virtual bool EndEnum() = 0;

        /** Set the TermEnum to read Term%s from.
            @param actualenum The TermEnum to read from */
        void SetEnum(std::shared_ptr<TermEnum> actualenum);

    private:
        /// The current Term
        Term currentterm;
        /// The TermEnum Term%s are read from
        std::shared_ptr<TermEnum> actualenum;
};

} // namespace Lucene

#endif

