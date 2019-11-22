#include <ap/libwebhare/allincludes.h>



#include "multitermquery.h"
#include "booleanquery.h"
#include "termquery.h"

namespace Lucene
{

MultiTermQuery::MultiTermQuery(const Term & _term)
{
        term = _term;
}

bool MultiTermQuery::operator==(const Query & other) const
{
        if (typeid(other) != typeid(MultiTermQuery))
            return false;
        const MultiTermQuery & othermulti = (const MultiTermQuery &)other;
        return (GetBoost() == othermulti.GetBoost())
            && term.Equals(othermulti.term);
}

Term MultiTermQuery::GetTerm()
{
        return term;
}

QueryPtr MultiTermQuery::Rewrite(QueryPtr/*thisquery*/, IndexReader * reader)
{
        std::shared_ptr<FilteredTermEnum> enumerator = GetEnum(reader);
        QueryPtr query(new BooleanQuery());
        do
        {
                const Term & t = enumerator->GetTerm();
                if (t.Valid())
                {
                        QueryPtr tq(new TermQuery(t));
                        tq->SetBoost(GetBoost() * enumerator->Difference());
                        ((BooleanQuery *)query.get())->Add(tq, false, false);
                }
        }
        while (enumerator->Next());
        return query;
}

std::string MultiTermQuery::ToStringWithField(const std::string & field)
{
        std::string str;
        if (field.compare(term.Field()))
        {
                str.append(term.Field());
                str.append(":");
        }
        str.append(term.Text());
        if (GetBoost() != 1.0)
        {
                str.append("^");
                str.append(ConvertFloat(GetBoost()));
        }
        return str;
}

FieldSet MultiTermQuery::GetQueryFields()
{
        FieldSet fields;
        fields.insert(term.Field());
        return fields;
}

} // namespace Lucene

