#include <ap/libwebhare/allincludes.h>



#include "document.h"

//Kind of a hack to be able to return an empty string by reference (needed by Get())
//FIXME: Is there some other way?
const std::string empty_value("");

namespace Lucene
{

Document::Document()
: boost(1.0)
{
}

Document::~Document()
{
}

void Document::SetBoost(float _boost)
{
        boost = _boost;
}

float Document::GetBoost() const
{
        return boost;
}

void Document::Add(const Field & field)
{
        fieldlist.push_back(field);
}

const Field * Document::GetField(const std::string & name) const
{
        for (DocumentFieldList::const_iterator it = fieldlist.begin(); it != fieldlist.end(); ++it)
            if (it->Name() == name)
                return &*it;
        return NULL;
}

const std::string & Document::Get(const std::string & name) const
{
        const Field * field = GetField(name);
        if (field)
            return field->StringValue();
        else
            return empty_value;
}

const DocumentFieldList & Document::Fields() const
{
        return fieldlist;
}

DocumentFieldList Document::GetFields(const std::string & name) const
{
        DocumentFieldList tempfieldlist;
        for (DocumentFieldList::const_iterator it = fieldlist.begin(); it != fieldlist.end(); ++it)
            if (it->Name() == name)
                tempfieldlist.push_back(*it);
        return tempfieldlist;
}

std::vector<std::string> Document::GetValues(const std::string & name) const
{
        DocumentFieldList namedfields = GetFields(name);
        std::vector<std::string> values;
        for (DocumentFieldList::const_iterator it = namedfields.begin(); it != namedfields.end(); ++it)
            values.push_back(it->StringValue());
        return values;
}

std::string Document::ToString() const
{
        std::string buffer("");
        buffer.append("Document<");
        for (DocumentFieldList::const_iterator it = fieldlist.begin(); it != fieldlist.end(); ++it)
        {
                if (it != fieldlist.begin())
                    buffer.append(" ");
                buffer.append(it->ToString());
        }
        buffer.append(">");
        return buffer;
}

} // namespace Lucene

