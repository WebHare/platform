#include <ap/libwebhare/allincludes.h>



#include "field.h"

namespace Lucene
{

std::string DateTimeToString(const Blex::DateTime & value)
{
        uint64_t v = value.GetDays();
        v = (v << 32) + value.GetMsecs();
        std::string s;
        Blex::EncodeNumber(v, 16, std::back_inserter(s));
        while (s.size() < 16)
          s = "0" + s;
        s = "d" + s; // Prepend a 'd', because the format changed and d is sorted lexicographically after any number (so the new 'd' dates come always after the old dates)
        return s;
}

Blex::DateTime StringToDateTime(const std::string & value)
{
        if (value.size() != 17 || value[0] != 'd')
            return Blex::DateTime::Invalid();

        uint64_t v = Blex::DecodeUnsignedNumber<uint64_t>(value.begin()+1, value.end(), 16).first;
        return Blex::DateTime(v >> 32, v & 0xFFFF);
}

Field::Field(const std::string & _name, const std::string & string,
             bool store, bool index, bool token)
: name(_name)
, stringvalue(string)
, isstored(store)
, isindexed(index)
, istokenized(token)
, boost(1.0)
{
        if (name.empty())
            throw LuceneException("Empty field name",false);
        if (stringvalue.empty())
            throw LuceneException("Empty field value for '"+name+"' field",false);
}

Field::Field(const std::string & _name, std::shared_ptr<Blex::RandomStream> & reader)
: name(_name)
, isstored(false)
, isindexed(true)
, istokenized(true)
, boost(1.0)
{
        if (name.empty())
            throw LuceneException("Empty field name",false);
        if (!reader.get())
            throw LuceneException("Empty field value for '"+name+"' field",false);
        readervalue = reader;
}

Field Field::Keyword(const std::string & name, const std::string & string)
{
        return Field(name, string, true, true, false);
}

//Field Field::Keyword(const std::string & name, const Blex::DateTime & datetime)
//{
//        return Field(name, DateTimeToString(datetime), true, true, false);
//}

Field Field::Indexed(const std::string & name, const std::string & string)
{
        return Field(name, string, false, true, false);
}

//Field Field::Indexed(const std::string & name, const Blex::DateTime & datetime)
//{
//        return Field(name, DateTimeToString(datetime), false, true, false);
//}

Field Field::UnIndexed(const std::string & name, const std::string & string)
{
        return Field(name, string, true, false, false);
}

Field Field::Text(const std::string & name, const std::string & string)
{
        return Field(name, string, false, true, true);
}

Field Field::Text(const std::string & name, std::shared_ptr<Blex::RandomStream> & reader)
{
        return Field(name, reader);
}

void Field::SetBoost(float _boost)
{
        boost = _boost;
}

float Field::GetBoost() const
{
        return boost;
}

const std::string & Field::Name() const
{
        return name;
}

const std::string & Field::StringValue() const
{
        return stringvalue;
}

const std::shared_ptr<Blex::RandomStream> & Field::ReaderValue() const
{
        return readervalue;
}

bool Field::IsStored() const
{
        return isstored;
}

bool Field::IsIndexed() const
{
        return isindexed;
}

bool Field::IsTokenized() const
{
        return istokenized;
}

std::string Field::ToString() const
{
        if (isstored && isindexed && !istokenized)
            return "Keyword<" + name + ":" + stringvalue + ">";
        else if (isstored && !isindexed && !istokenized)
            return "Unindexed<" + name + ":" + stringvalue + ">";
        else if (isstored && isindexed && istokenized && (stringvalue != ""))
            return "Text<" + name + ":" + stringvalue + ">";
        else if (!isstored && isindexed && istokenized && (readervalue.get()))
            return "Text<" + name + ":" + "Stream" + ">";
        else
            return "";
}

bool IsTokenizedField(const std::string &field)
{
        return field.compare("indexid")
               && field.compare("groupid")
               && field.compare("objectid")
               && field.compare("initialfilter")
               && field.compare(0,5,"date_")
               && field.find(".date_") == std::string::npos;
}

} // namespace Lucene

