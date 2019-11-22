#include <ap/libwebhare/allincludes.h>


#include "filteredtermenum.h"

namespace Lucene
{

FilteredTermEnum::FilteredTermEnum()
{
        currentterm = Term();
}

int32_t FilteredTermEnum::DocFreq()
{
        if (!actualenum.get())
            return -1;
        return actualenum->DocFreq();
}

bool FilteredTermEnum::Next()
{
        if (!actualenum.get())
            return false;

        currentterm = Term();
        while (!currentterm.Valid())
        {
                if (EndEnum())
                    return false;
                if (actualenum->Next())
                {
                        Term term = actualenum->GetTerm();
                        if (TermCompare(term))
                        {
                                currentterm = term;
                                return true;
                        }
                }
                else
                    return false;
        }
        currentterm = Term();
        return false;
}

Term FilteredTermEnum::GetTerm()
{
        return currentterm;
}

void FilteredTermEnum::SetEnum(std::shared_ptr<TermEnum> _actualenum)
{
        if (!_actualenum.get())
            throw LuceneException("Invalid TermEnum for FilteredTermEnum",false);

        actualenum = _actualenum;
        Term term = actualenum->GetTerm();
        if (term.Valid() && TermCompare(term))
            currentterm = term;
        else
            Next();
}

} // namespace Lucene

