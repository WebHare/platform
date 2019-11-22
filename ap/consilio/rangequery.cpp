#include <ap/libwebhare/allincludes.h>


#include "rangequery.h"

namespace Lucene
{

TermRangeQuery::TermRangeQuery(const std::string &_fieldname,
                               const std::string &_lowertermtext, const std::string &_uppertermtext,
                               bool _includelower, bool _includeupper)
: fieldname(_fieldname)
, lowertermtext(_lowertermtext)
, uppertermtext(_uppertermtext)
, includelower(_includelower)
, includeupper(_includeupper)
{
}

std::shared_ptr<FilteredTermEnum> TermRangeQuery::GetEnum(IndexReader * reader)
{
        return std::shared_ptr<FilteredTermEnum>(new TermRangeTermEnum(reader, fieldname, lowertermtext, uppertermtext, includelower, includeupper));
}

TermRangeTermEnum::TermRangeTermEnum(IndexReader *reader, const std::string &_fieldname,
                                     const std::string &_lowertermtext, const std::string &_uppertermtext,
                                     bool _includelower, bool _includeupper)
: endenum(false)
, fieldname(_fieldname)
, lowertermtext(_lowertermtext)
, uppertermtext(_uppertermtext)
, includelower(_includelower)
, includeupper(_includeupper)
{
        // Open-ended range queries should always be inclusive
        if (lowertermtext.empty())
            includelower = true;
        if (uppertermtext.empty())
            includeupper = true;

        SetEnum(std::shared_ptr<TermEnum>(reader->Terms(Term(fieldname, lowertermtext))));
}

float TermRangeTermEnum::Difference()
{
        return 1.0;
}

bool TermRangeTermEnum::TermCompare(const Term & term)
{
        bool checklower = includelower ? false : true;

        if (term.Valid() && !fieldname.compare(term.Field()))
        {
                if (!checklower || lowertermtext.empty() || term.Text().compare(lowertermtext) > 0)
                {
                        checklower = false;
                        if (!uppertermtext.empty())
                        {
                                int compare = uppertermtext.compare(term.Text());
                                if ((compare < 0) || (!includeupper && compare == 0))
                                {
                                        endenum = true;
                                        return false;
                                }
                        }
                        return true;
                }
        }
        else
            endenum = true; // Break
        return false;
}

bool TermRangeTermEnum::EndEnum()
{
        return endenum;
}

} // namespace Lucene
