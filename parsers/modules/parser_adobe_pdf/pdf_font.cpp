#include <ap/libwebhare/allincludes.h>


#include "pdf.h"
#include "pdf_font.h"
#include "pdf_name2unicode.h"

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

//std::string Font::GetName()
//{
//        return name;
//}

Blex::UTF16String CMap::UnicodeConversion::GetUnicode(std::string const &thisstring) const
{
        Blex::UTF16String output;

        for (std::vector<CharacterConversion>::const_iterator it = char_conversion.begin();
                it != char_conversion.end(); ++it)
        {
                if (thisstring >= it->start && thisstring <= it->end)
                {
                        // Determine the difference between thisstring and the start (only last byte)
                        // FIXME: what is happening here? why only last byte? seems bogus to me.
                        uint8_t difference = uint8_t((uint8_t)thisstring[it->start.size()-1] - (uint8_t)it->start[it->start.size()-1]);

                        // Add this to the offset and return
                        std::string result = it->offset;
                        result[result.size()-1] += difference;

                        // Format it to a Unicode String
                        for (unsigned i=0; i<it->offset.size()/2; i++)
                                output.push_back(Blex::getu16msb(&result[i*2]));

                        // And return
                        return output;
                }
        }

        DEBUGPRINT("No character found for unicode conversion: " << thisstring);
        return output;
}

CMap::CommandLine CMap::ReadCommandLine(Lexer &lexer) const
{
        CommandLine result;

        ObjectPtr object = lexer.GetNextObject(0,0);
        while(object->GetType() != type_keyword && object->GetType() != type_null)
        {
                result.arguments.push_back(object);
                object = lexer.GetNextObject(0,0);

        }

        result.keyword = object;
        return result;
}

CMap::CMap(PDFfile *file, StreamObject const &object)
{
        Blex::MemoryRWStream stream;
        object.GetUncompressedData()->SendAllTo(stream);
        stream.SetOffset(0);

        Lexer lexer(stream);
        lexer.SetVersion(file->GetVersion());

        while(true)
        {
                CommandLine line = ReadCommandLine(lexer);
                if(line.keyword->GetType() == type_null)
                        break;

                std::string op = line.keyword->GetKeyword();
                DEBUGPRINT("Operator: " << op);
                if(op == "begincodespacerange")
                {
                        int ranges = line.arguments[0]->GetNumericInt();

                        for(int i = 0; i < ranges; ++i)
                        {
                                std::string start = lexer.GetNextObject(0, 0)->GetString();
                                std::string end = lexer.GetNextObject(0, 0)->GetString();
                                unicode_conversion.push_back(UnicodeConversion(start, end));
                        }

                        ObjectPtr object = lexer.GetNextObject(0,0);
                        if(object->GetType() != type_keyword || object->GetKeyword() != "endcodespacerange")
                                throw std::runtime_error("Corrupt PDF File: UnicodeMapping corrupt (no endcodespacerange found)");;
                }
                else if(op == "beginbfrange")
                {
                        int ranges = line.arguments[0]->GetNumericInt();

                        for(int i = 0; i < ranges; ++i)
                        {
                                std::string start = lexer.GetNextObject(0, 0)->GetString();
                                std::string end = lexer.GetNextObject(0, 0)->GetString();
                                ObjectPtr value = lexer.GetNextObject(0,0);

                                UnicodeConversion *conversion = GetUnicodeConversion(start);
                                if(conversion)
                                {
                                         // This can be an array, or a string
                                         if (value->GetType() == type_string)
                                                 conversion->char_conversion.push_back(CharacterConversion(start, end, value->GetString()));
                                         else // It's an array
                                                 for (unsigned i=0;i<value->GetArray().GetLength();++i)
                                                 {
                                                         conversion->char_conversion.push_back(CharacterConversion(start, end, value->GetArray()[i].GetString()));
                                                         // Increment the last byte
                                                         start[start.size()-1]++;
                                                 }
                                }
                        }

                        ObjectPtr object = lexer.GetNextObject(0,0);
                        if(object->GetType() != type_keyword || object->GetKeyword() != "endbfrange")
                                throw std::runtime_error("Corrupt PDF File: UnicodeMapping corrupt (no endbfrange found)");;

                }
                else if(op == "beginbfchar")
                {
                        int ranges = line.arguments[0]->GetNumericInt();

                        for(int i = 0; i < ranges; ++i)
                        {
                                std::string code = lexer.GetNextObject(0, 0)->GetString();
                                std::string value = lexer.GetNextObject(0, 0)->GetString();

                                UnicodeConversion *conversion = GetUnicodeConversion(code);
                                if(conversion)
                                    conversion->char_conversion.push_back(CharacterConversion(code, code, value));
                        }
                }
        }
}

CMap::UnicodeConversion *CMap::GetUnicodeConversion(std::string const &thisstring)
{
        for (std::vector<UnicodeConversion>::iterator it = unicode_conversion.begin();
                it != unicode_conversion.end(); ++it)
        {
                if (thisstring >= it->begin_codespace_range && thisstring <= it->end_codespace_range)
                        return &*it;
        }
        DEBUGPRINT("Invalid character!");
        return NULL;
}

bool CMap::ConvertCharacter(std::string const &input, Blex::UTF16String *output)
{
        for (std::vector<UnicodeConversion>::iterator it = unicode_conversion.begin();
                it != unicode_conversion.end(); ++it)
        {
                if (input >= it->begin_codespace_range && input <= it->end_codespace_range)
                {
                        *output = it->GetUnicode(input);
                        return !output->empty();
                }
        }

        return false;
}

Font::Font(PDFfile *file, ObjectPtr object, Lexer &/*lexer*/, std::map<std::string, std::vector<uint16_t> > const &encodings)
{
        encoding = None;

        // 1. Check if the ToUnicode field exists
        if(object->GetDictionary().KeyExists("ToUnicode"))
        {
                cmap.reset(new CMap(file, object->GetDictionary()["ToUnicode"].GetStream()));
                encoding = ToUnicodeCMap;
        } else if(object->GetDictionary().KeyExists("Encoding"))
        {
                Object const &encoding_object = object->GetDictionary()["Encoding"];

                if (encoding_object.GetType() == type_name)
                {
                        if (encoding_object.GetName() == "Identity-H")
                        {
                                encoding = IdentityUnicode;
                        } else {
                                encoding = LookupTable;
                                std::string encoding_name = encoding_object.GetName();
                                if (encodings.find(encoding_name) != encodings.end())
                                {
                                        unsigned idx=0;
                                        for (std::vector<uint16_t>::const_iterator it = encodings.find(encoding_name)->second.begin();
                                                it != encodings.find(encoding_name)->second.end(); ++it, ++idx)
                                                lookup_table[idx] = *it;
                                }
                                else
                                        throw std::runtime_error("Unsupported encoding: " + encoding_name);
                        }
                }
                else if (encoding_object.GetType() == type_dictionary)
                {
                        encoding = LookupTable;

                        //FIXME: This might not be the correct encoding
                        std::string base_encoding = "StandardEncoding";

                        // Read the base encoding
                        unsigned idx=0;
                        for (std::vector<uint16_t>::const_iterator it = encodings.find(base_encoding)->second.begin();
                                it != encodings.find(base_encoding)->second.end(); ++it, ++idx)
                                lookup_table[idx] = *it;

                        // Now read the differences table
                        ArrayObject const& differences = encoding_object.GetDictionary()["Differences"].GetArray();
                        for (unsigned i=0;i<differences.GetLength();)
                        {
                                // Apply each difference
                                uint8_t char_nr = differences[i].GetNumericInt();
                                ++i;
                                while (i<differences.GetLength() && differences[i].GetType() == type_name)
                                {
                                        // Look through all names
                                        unsigned j;
                                        std::string name_to_find = differences[i].GetName();
                                        for (j=0; nameToUnicodeTab[j].u != 0; ++j)
                                                if (name_to_find.compare(nameToUnicodeTab[j].name)==0)
                                                        break;
                                        lookup_table[char_nr] = nameToUnicodeTab[j].u;
                                        ++char_nr;
                                        ++i;
                                }
                        }
                }
        }
}

Font_Type1::Font_Type1(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings)
        : Font(file, object, lexer, encodings)
{ }

Font_Type0::Font_Type0(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings)
        : Font(file, object, lexer, encodings)
{ }

Font_TrueType::Font_TrueType(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings)
        : Font(file, object, lexer, encodings)
{ }

Font *Font::LoadFont(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings)
{
        std::string subtype = object->GetDictionary()["Subtype"].GetName();
        if(subtype == "Type0")
                return new Font_Type0(file, object, lexer, encodings);
        else if(subtype == "Type1")
                return new Font_Type1(file, object, lexer, encodings);
        else if(subtype == "TrueType")
                return new Font_TrueType(file, object, lexer, encodings);

        DEBUGPRINT("Unknown font type: " << subtype);
        return NULL;
}

std::string Font::ConvertText(std::string const &input) const
{
        std::string output;
        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > utf8encoder(std::back_inserter(output));

        if(encoding == ToUnicodeCMap)
        {
                if(cmap.get() == NULL)
                        return std::string();

                // FIXME: Some pdf's still result in certain character codes
                // not being converted.

                // Convert character codes to UTF-8 using cmap
                std::string str = input;
                while(!str.empty())
                {
                        size_t length = 1;

                        while(length <= str.size())
                        {
                                Blex::UTF16String substr_utf16;

                                // Try to find a conversion for this character
                                if(cmap->ConvertCharacter(str.substr(0, length), &substr_utf16))
                                {
                                        utf8encoder(substr_utf16[0]);
                                        break;
                                }

                                ++length;
                        }

                        str = str.substr(std::min(str.size(), length));
                }
        } else if(encoding == LookupTable)
        {
                // Convert character codes to UTF-8  using Lookup Table
                for (std::string::const_iterator i = input.begin(); i != input.end(); ++i)
                        utf8encoder(lookup_table[(uint8_t)(*i)]);
        } else if(encoding == IdentityUnicode)
        {
                if(input.size() % 2 != 0)
                        DEBUGPRINT("Text size: " << input.size());
                for(size_t i = 0; i + 1 < input.size(); i += 2)
                        utf8encoder(Blex::getu16lsb(&input[i]));
        } else
        {
                output = input;
        }

        return output;

}


}

}

}
