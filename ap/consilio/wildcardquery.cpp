#include <ap/libwebhare/allincludes.h>


static const char wildcard_string = '*'; ///< Wildcard for 0 or more characters
static const char wildcard_char = '?';   ///< Wildcard for 1 character

#include "wildcardquery.h"

namespace Lucene
{

WildcardQuery::WildcardQuery(const Term & term)
: MultiTermQuery(term)
{
}

bool WildcardQuery::operator==(const Query & other) const
{
        if (typeid(other) != typeid(WildcardQuery))
            return false;
        const WildcardQuery & otherwildcard = (const WildcardQuery &)other;
        return (GetBoost() == otherwildcard.GetBoost())
            && term.Equals(otherwildcard.term);
}

std::shared_ptr<FilteredTermEnum> WildcardQuery::GetEnum(IndexReader * reader)
{
        return std::shared_ptr<FilteredTermEnum>(new WildcardTermEnum(reader, GetTerm()));
}

QueryPtr WildcardQuery::Clone()
{
        return QueryPtr(new WildcardQuery(*this));
}

WildcardTermEnum::WildcardTermEnum(IndexReader * reader, const Term & term)
: FilteredTermEnum()
{
        pre = "";
        prelen = 0;
        fieldmatch = false;
        endenum = false;

        searchterm = term;
        field = searchterm.Field();
        text = searchterm.Text();

        std::string::size_type sidx = text.find(wildcard_string);
        std::string::size_type cidx = text.find(wildcard_char);
        std::string::size_type idx = sidx;
        if (idx == std::string::npos)
            idx = cidx;
        else if (cidx != std::string::npos)
            idx = std::min(sidx, cidx);

        if (idx == std::string::npos)
            throw LuceneException("No wildcard characters in wildcard term",false);

        pre = searchterm.Text().substr(0, idx);
        prelen = pre.size();
        text = text.substr(prelen);

        SetEnum(std::shared_ptr<TermEnum>(reader->Terms(Term(field, pre))));
}

float WildcardTermEnum::Difference()
{
        return 1.0;
}

bool WildcardTermEnum::EndEnum()
{
        return endenum;
}

bool WildcardTermEnum::WildcardEquals(const std::string & pat, int32_t patidx,
                                      const std::string & str, int32_t stridx)
{
        for (std::string::size_type p = patidx; ; ++p)
        {
                for (std::string::size_type s = stridx; ; ++s)
                {
                        bool send = s >= str.size();
                        bool pend = p >= pat.size();

                        if (send)
                        {
                                bool justwildcardsleft = true;

                                std::string::size_type wildcardsearchpos = p;
                                while (wildcardsearchpos < pat.size() && justwildcardsleft)
                                {
                                        char wildchar = pat[wildcardsearchpos];
                                        if (wildchar != wildcard_string && wildchar != wildcard_char)
                                            justwildcardsleft = false;
                                        else
                                            ++wildcardsearchpos;
                                }

                                if (justwildcardsleft)
                                    return true;
                        }

                        if (send || pend)
                            break;

                        if (pat[p] == wildcard_char)
                        {
                                ++p;
                                continue;
                        }

                        if (pat[p] == wildcard_string)
                        {
                                ++p;
                                for (std::string::size_type i = str.size(); i >= s; --i)
                                    if (WildcardEquals(pat, p, str, i))
                                        return true;

                                break;
                        }

                        if (pat[p] != str[s])
                            break;

                        ++p;
                }
                return false;
        }
}

bool WildcardTermEnum::TermCompare(const Term & term)
{
        if (prelen == 0)
            return false; // Don't match if pattern starts with wildcard char

        if (field == term.Field())
        {
                std::string searchtext = term.Text();
                if (searchtext.substr(0,prelen) == pre)
                    return WildcardEquals(text, 0, searchtext, prelen);
        }
        endenum = true;
        return false;
}

} // namespace Lucene

