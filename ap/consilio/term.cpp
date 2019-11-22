#include <ap/libwebhare/allincludes.h>


#include "term.h"

namespace Lucene
{

Term::Term()
{
        valid = false;

        field = "";
        text = "";
}

Term::Term(const std::string & fld, const std::string & txt)
{
        valid = true;

        field = fld;
        text = txt;
}

bool Term::Equals(const Term & y) const
{
        return ((field == y.field) && (text == y.text));
}

int Term::CompareTo(const Term & other) const
{
        int field_eq = field.compare(other.Field());

        if (field_eq == 0)
            return text.compare(other.Text());
        else
            return field_eq;
}

bool Term::StartsWith(const Term &other) const
{
        return other.Field() == field
            && other.Text().size() <= text.size()
            && text.substr(0,other.Text().size()) == other.Text();
}

void Term::Set(const std::string & fld, const std::string & txt)
{
        valid = true;

        field = fld;
        text = txt;
}

void Term::Set(const std::string & fld, const char *txt_begin, const char *txt_end)
{
        valid = true;

        field = fld;
        text.assign(txt_begin, txt_end);
}

void Term::Set(const Term & src)
{
        valid = src.valid;
        field = src.field;
        text = src.text;
}

std::string Term::ToString() const
{
        return field + ":" + text;
}

bool operator== (const Term & x, const Term & y)
{
        return ((x.Text() == y.Text()) && (x.Field() == y.Field()));
}

bool operator< (const Term & x, const Term & y)
{
        if (x.Field() == y.Field())
            return x.Text() < y.Text();
        else
            return x.Field() < y.Field();
}

} // namespace Lucene

