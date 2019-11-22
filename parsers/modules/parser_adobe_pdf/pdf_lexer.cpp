//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------

#include <harescript/vm/hsvm_dllinterface.h>
#include "pdf.h"
#include "pdf_streams.h"

#include <cmath>
#include <algorithm>
#include <cstdlib>

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

Version::Version(std::string const &version)
{
        size_t dot_pos = version.find('.');

        if(dot_pos != std::string::npos)
        {
                major_nr = Blex::DecodeSignedNumber<int>(version.substr(0, dot_pos));
                minor_nr = Blex::DecodeSignedNumber<int>(version.substr(dot_pos + 1));
        } else
        {
                major_nr = Blex::DecodeSignedNumber<int>(version);
                minor_nr = 0;
        }
}

Lexer::Lexer(Blex::RandomStream &_stream)
        : current_parser_ctxt(ParserContext())
        , version(1, 0)
{
        SetupParserContext(&_stream, 0);

        memset(char_type_lookup, 0, sizeof(char_type_lookup));
        char_type_lookup[0]     = char_whitespace;
        char_type_lookup['\t']  = char_whitespace;
        char_type_lookup['\r']  = char_whitespace;
        char_type_lookup[0xC]   = char_whitespace;
        char_type_lookup['\n']  = char_whitespace;
        char_type_lookup[' ']   = char_whitespace;

        char_type_lookup['(']   = char_delimiter;
        char_type_lookup[')']   = char_delimiter;
        char_type_lookup['<']   = char_delimiter;
        char_type_lookup['>']   = char_delimiter;
        char_type_lookup['[']   = char_delimiter;
        char_type_lookup[']']   = char_delimiter;
        char_type_lookup['{']   = char_delimiter;
        char_type_lookup['}']   = char_delimiter;
        char_type_lookup['/']   = char_delimiter;
        char_type_lookup['%']   = char_delimiter;

        char_type_lookup['0']   = char_number;
        char_type_lookup['1']   = char_number;
        char_type_lookup['2']   = char_number;
        char_type_lookup['3']   = char_number;
        char_type_lookup['4']   = char_number;
        char_type_lookup['5']   = char_number;
        char_type_lookup['6']   = char_number;
        char_type_lookup['7']   = char_number;
        char_type_lookup['8']   = char_number;
        char_type_lookup['9']   = char_number;
}


Version Lexer::ParseVersion()
{
        std::string buffer;
        buffer.resize(1024);
        current_parser_ctxt.stream->DirectRead(0, &buffer[0], buffer.size());

        size_t version_begin = buffer.find("PDF-");
        if (version_begin == std::string::npos)
                throw std::runtime_error("Corrupt PDF File: No version information found");
        size_t version_end = buffer.find_first_of("\r\n", version_begin + 1);
        if (version_end == std::string::npos)
                throw std::runtime_error("Corrupt PDF File: No version information found");

        std::string sub_str = buffer.substr(version_begin + 4, version_end - 5);
        return Version(sub_str);
}

Blex::FileOffset Lexer::GetLastCrossRef()
{
        // Try to find the end of file marker in the last 1024 bytes
        size_t buffer_size = (size_t)current_parser_ctxt.stream->GetFileLength();
        if (buffer_size > 2048)
            buffer_size = 2048;
//        size_t buffer_size = (size_t)std::min(stream.GetFileLength(), (Blex::FileOffset)2048);

        std::string buffer(buffer_size, ' ');
        current_parser_ctxt.stream->DirectRead(current_parser_ctxt.stream->GetFileLength() - buffer_size, &buffer[0], buffer_size);

        size_t eof_str_offset = buffer.rfind("%%EOF");
        if(eof_str_offset == std::string::npos)
                throw std::runtime_error("Corrupt PDF File: Could not find eof marker");

        --eof_str_offset;
        if(buffer[eof_str_offset] == '\n' || buffer[eof_str_offset] == '\r')
                --eof_str_offset;
        if(buffer[eof_str_offset] == '\n' || buffer[eof_str_offset] == '\r')
                --eof_str_offset;

        size_t trailer_ptr_offset = buffer.find_last_of("\r\n", eof_str_offset);
        if(trailer_ptr_offset == std::string::npos)
                return 0;

        std::string line = buffer.substr(trailer_ptr_offset + 1, eof_str_offset - trailer_ptr_offset);
        return std::atoi(line.c_str());
}

unsigned Lexer::GetKey(uint8_t *output_key, unsigned objnum, unsigned objgen)
{
        uint8_t key[21];
        memcpy(key, &filekey[0], filekey.size());
        Blex::putu32lsb(&key[filekey.size()], objnum);
        Blex::putu16lsb(&key[filekey.size()]+3, uint16_t(objgen)); //intentional overlap between bytes!

        Blex::GetMD5Hash(&key[0], filekey.size()+5, output_key);
        return std::min<unsigned>(16,filekey.size()+5);
}


void Lexer::SkipWhite()
{
        while (!Eof() && isWhiteSpace(PeekChar()))
            MoveNext();
}

std::string Lexer::GetNextLine()
{
        std::vector<char> str;

        while(!Eof() && PeekChar() != '\r' && PeekChar() != '\n')
            str.push_back(GetChar());

        while(!Eof() && (PeekChar() == '\r' || PeekChar() == '\n'))
            MoveNext();

        return std::string(str.begin(), str.end());
}

///////////////////////////////////////////////////////
//
// The Object parse functions
//

ObjectPtr Lexer::ParseCrossRefStream(Blex::FileOffset offset)
{
        // PDF 32000-1:2008 7.5.8
        SetOffset(offset);

        int objectnum = ParseNumeric()->value.int_value;
        int objectgen = ParseNumeric()->value.int_value;
        if (ParsePlainString() != "obj")
                throw std::runtime_error("Corrupt PDF File: Invalid indirect object reference or wrong crosslink offset");

        DEBUGPRINT("CrossRefStream found: " << objectnum << " " << objectgen);

        // Now read the actual object
        SkipWhite();
        ObjectPtr new_object = GetNextObject(objectnum, objectgen);

        if (ParsePlainString() != "endobj")
                DEBUGPRINT("End object tag of indirect object is missing");

        ArrayObject const &widths = new_object->GetDictionary()["W"].GetArray();
        if(widths.GetLength()!=3)
            throw std::runtime_error("Corrupt PDF File: Crossref stream widths array has " + Blex::AnyToString(widths.GetLength()) + " elements");

        int fieldlen_1 = widths[0].GetNumericInt();
        int fieldlen_2 = widths[1].GetNumericInt();
        int fieldlen_3 = widths[2].GetNumericInt();
        DEBUGPRINT("CrossRefStream data widths "  << fieldlen_1 << " " << fieldlen_2 << " " << fieldlen_3);

        if(fieldlen_1<0 || fieldlen_2<0 || fieldlen_3<0
           || fieldlen_1>8 || fieldlen_2>8 || fieldlen_3>8
           || (fieldlen_1+fieldlen_2+fieldlen_3)<=0)
            throw std::runtime_error("Corrupt PDF File: Invalid/confusing fieldlengths in crossref stream widths array");

        StreamObject const &stream = new_object->GetStream();
        std::shared_ptr<Blex::Stream> str = stream.GetUncompressedData();

        unsigned crossrefsize = new_object->GetDictionary()["Size"].GetNumericInt();

        std::vector< std::pair<unsigned,unsigned> > loadranges;
        if(new_object->GetDictionary().KeyExists("Index"))
        {
                ArrayObject const &indices = new_object->GetDictionary()["Index"].GetArray();
                if(indices.GetLength()>0)
                {
                        for(unsigned i=0;i<indices.GetLength()-1;i+=2)
                            loadranges.push_back(std::make_pair(indices[i].GetNumericInt(), indices[i+1].GetNumericInt()));
                }
        }
        if(loadranges.empty())
            loadranges.push_back(std::make_pair(0u, crossrefsize));

        //Read the actual xrefs
        uint8_t buf[8];
        for (unsigned i=0;i<loadranges.size() && !str->EndOfStream();++i) //contains .second objects starting with objectid .first
        {
                unsigned curobj=loadranges[i].first;
                for(unsigned j=0;j<loadranges[i].second; ++j, ++curobj)
                {
                        uint64_t value_1=0, value_2=0, value_3=0;

                        //Read fields
                        if(fieldlen_1 != 0)
                        {
                                memset(buf,0,sizeof buf);
                                str->Read(&buf[sizeof buf - fieldlen_1], fieldlen_1);
                                value_1 = Blex::getu64msb(buf);
                        }
                        else
                        {
                                value_1 = 1; //If the first element is zero, the type field shall not be present, and shall default to type 1.
                        }
                        if(fieldlen_2 != 0)
                        {
                                memset(buf,0,sizeof buf);
                                str->Read(&buf[sizeof buf - fieldlen_2], fieldlen_2);
                                value_2 = Blex::getu64msb(buf);
                        }
                        if(fieldlen_3 != 0)
                        {
                                memset(buf,0,sizeof buf);
                                str->Read(&buf[sizeof buf - fieldlen_3], fieldlen_3);
                                value_3 = Blex::getu64msb(buf);
                        }
                        if(str->EndOfStream())
                            break;

                        if(value_1 == 0) //free object
                        {
                                ObjectNumGen key = ObjectNumGen(curobj, /*generation*/value_3);
                                crossrefs[key] = ObjectLocation(0,0);
                                DEBUGPRINT("Object " << curobj << " gen " << value_3 << " is free");
                        }
                        else if(value_1 == 1) //crossref offset
                        {
                                ObjectNumGen key = ObjectNumGen(curobj, /*generation*/value_3);
                                crossrefs[key] = ObjectLocation(0,value_2);
                                DEBUGPRINT("Object " << curobj << " gen " << value_3 << " is at offset " << value_2);
                        }
                        else if(value_1 == 2)
                        {
                                ObjectNumGen key = ObjectNumGen(curobj, 0);
                                DEBUGPRINT("Object " << curobj << " is in " << value_2 << " at " << value_3);
                                DEBUGPRINT(key.first << " " << key.second);
                                crossrefs[key] = ObjectLocation(value_2,value_3);
                        }
                }
        }

        return new_object;
}

ObjectPtr Lexer::ParseCrossRef(Blex::FileOffset offset)
{
        SetOffset(offset);

        // Read the first 'xref' word
        std::string xref_word = GetNextLine();

        // Trim whitespace (have seen that happen?)
        while(xref_word.length() && xref_word[0]==32)
            xref_word.erase(xref_word.begin());
        while(xref_word.length() && xref_word[xref_word.size()-1]==32)
            xref_word.erase(xref_word.end()-1);

        if (xref_word != "xref")
        {
                DEBUGPRINT("xref is not a <= PDF1.4 crossref, got line [" << xref_word << "]");
                return ParseCrossRefStream(offset);
        }

        // Start reading sections
        std::string line;
        for (line = GetNextLine(); ! Blex::StrCaseLike(line,"*trailer*") && !Eof(); line = GetNextLine())
        {
                // Read the first number
                unsigned end_pos = line.find_first_of(" ");
                uint32_t start_section = std::atoi(line.substr(0,end_pos).c_str());

                // Read the second number
                uint32_t length_section = std::atoi(line.substr(end_pos+1,line.length()-(end_pos+1)).c_str());

                // Now start reading the section
                for (uint32_t entry = start_section; entry < start_section+length_section; entry++)
                {
                        std::string section_line = GetNextLine();
                        unsigned first_stop = section_line.find_first_of(" ");
                        uint32_t offset = std::atoi(section_line.substr(0, first_stop).c_str());

                        unsigned second_stop = section_line.find_first_of(" ", first_stop + 1);
                        uint16_t generation = uint16_t(std::atoi(section_line.substr(first_stop + 1,second_stop - (first_stop + 1)).c_str()));

                        bool in_use = (section_line.substr(second_stop + 1, 1) == "n");

                        std::pair<uint32_t,uint16_t> key = std::make_pair(entry, generation);

                        if (crossrefs.find(key) == crossrefs.end())
                                crossrefs[key] = ObjectLocation(0,in_use ? offset : 0);
                }
        }

        // Got a line starting with "trailer": Set offset back if the trailer
        // dictionary starts on the same line; ParseDictionary expects "<<" at
        // the current offset.
        if (line.size() > 7)
        {
                SetOffset(current_parser_ctxt.offset-(line.size()-7));
        }

        return ParseDictionary(0, 0);
}

std::string Lexer::ParsePlainString()
{
        SkipWhite();

        std::vector<char> str;
        str.reserve(10);
        while(!Eof())
        {
                char c = PeekChar();
                if(isWhiteSpace(c) || isDelimiter(c))
                    break;

                str.push_back(c);
                MoveNext();
        }

        return std::string(str.begin(), str.end());
}

/* Numeric */
NumObjectPtr Lexer::ParseNumeric()
{
        NumObjectPtr numobject(new NumObject());

        std::string text = ParsePlainString();
        if(text.find('.') != std::string::npos)
        {
                numobject->num_type = NumObject::num_float;
                numobject->value.float_value = std::atof(text.c_str());
        } else
        {
                numobject->num_type = NumObject::num_int;
                numobject->value.int_value = std::atoi(text.c_str());
        }

        return numobject;
}

/* String */
StringObjectPtr Lexer::ParseString(unsigned obj, unsigned gen)
{
        StringObjectPtr string = ParseLowlevelString();
        if (obj != 0 && !filekey.empty())
        {
                Blex::RC4 decryptor;

                uint8_t key[16];
                unsigned keylen = GetKey(key, obj, gen);
                decryptor.InitKey(key, keylen);

                decryptor.CryptBuffer(&string->value[0], string->value.size());
        }

        return string;
}

StringObjectPtr Lexer::ParseLowlevelString()
{
        StringObjectPtr stringobject(new StringObject);

        SkipWhite();

        char c = GetChar();
        if(c == '<')
        {
                // String is a hexadecimal value
                std::string hex_value;
                while(PeekChar() != '>')
                {
                        char c = GetChar();
                        if(!isWhiteSpace(c))
                            hex_value += c;
                }

                MoveNext();

                for(std::string::iterator i = hex_value.begin(); i != hex_value.end(); i += 2)
                {
                        std::pair<uint8_t, std::string::iterator> decoded_char = Blex::DecodeUnsignedNumber<uint8_t>(i, i + 2, 16);
                        if (decoded_char.second != i + 2)
                            throw std::runtime_error("Corrupt PDF File: Wrong character in literal string");

                        stringobject->value += decoded_char.first;
                }

        }
        else if(c == '(')
        {
                // String is a literal string
                std::string str_value;

                unsigned parentheses_nesting = 1;
                while(parentheses_nesting > 0)
                {
                        char c = GetChar();
                        if(c == '\\')
                        {
                                c = GetChar();
                                if(c == 'n')
                                    stringobject->value += '\n';
                                else if(c == 'r')
                                    stringobject->value += '\r';
                                else if(c == 't')
                                    stringobject->value += '\t';
                                else if(c == 'b')
                                    stringobject->value += '\b';
                                else if(c == 'f')
                                    stringobject->value += '\f';
                                else if(c == '(')
                                    stringobject->value += '(';
                                else if(c == ')')
                                    stringobject->value += ')';
                                else if(c == '\\')
                                    stringobject->value += '\\';
                                else if(isNumber(c))
                                {
                                        std::string octal_char_code;
                                        octal_char_code += c;

                                        if(isNumber(PeekChar()))
                                            octal_char_code += GetChar();
                                        if(isNumber(PeekChar()))
                                            octal_char_code += GetChar();

                                        std::pair<uint8_t, std::string::iterator> decoded_char =
                                            Blex::DecodeUnsignedNumber<uint8_t>(octal_char_code.begin(), octal_char_code.end(), 8);
                                        if (decoded_char.second != octal_char_code.end())
                                            throw std::runtime_error("Corrupt PDF File: Wrong character in literal string");

                                        stringobject->value += decoded_char.first;
                                }
                        }
                        else if(c == ')')
                            --parentheses_nesting;
                        else if(c == '(')
                            ++parentheses_nesting;
                        else
                            stringobject->value += c;
                }
        }
        else
            throw std::runtime_error("Corrupt PDF File: Object is not a valid string");

        return stringobject;
}

/* Name */
NameObjectPtr Lexer::ParseName(unsigned /*obj*/, unsigned /*gen*/)
{
        NameObjectPtr nameobject(new NameObject);

        // The name has to start with a leading slash
        if(GetChar() != '/')
                throw std::runtime_error("Corrupt PDF File: Name did not start with slash");

        // After the slash, we can encode the name
        // A whitespace character means the end of this name
        while(!isWhiteSpace(PeekChar()) && !isDelimiter(PeekChar()))
        {
                char c = GetChar();

                // # character has a special meaning since version 1.2
                if (c == '#' && version >= Version(1, 2))
                {
                        std::string hex_number = std::string() + GetChar() + GetChar();

                        std::pair<uint8_t, std::string::iterator> decoded_char =
                                Blex::DecodeUnsignedNumber<uint8_t>(hex_number.begin(), hex_number.end(), 16);
                        if (decoded_char.second != hex_number.end())
                                throw std::runtime_error("Corrupt PDF File: # is not followed by correct hex number in name");

                        nameobject->value += decoded_char.first;
                }
                else
                {
                        // All other characters are just added to the name
                        nameobject->value += c;
                }
        }

        return nameobject;
}

/* Array */
ArrayObjectPtr Lexer::ParseArray(unsigned obj, unsigned gen)
{
        ArrayObjectPtr arrayobject(new ArrayObject);

        if(GetChar() != '[')
                throw std::runtime_error("Corrupt PDF File: Wrong character in array");

        SkipWhite();

        while(PeekChar() != ']')
        {
                arrayobject->value.push_back(GetNextObject(obj, gen));

                SkipWhite();
        }

        if(GetChar() != ']')
                throw std::runtime_error("Corrupt PDF File: Wrong character in array");

        return arrayobject;
}

/* Dictionary */
DictObjectPtr Lexer::ParseDictionary(unsigned obj, unsigned gen)
{
        DictObjectPtr dictobject(new DictObject);

        // Try to find the start of the dictionary, marked by '<<'
        SkipWhite();

        if(GetChar() != '<' || GetChar() != '<')
                throw std::runtime_error("Unexpected character in dictionary");

        SkipWhite();

        while(PeekChar() != '>')
        {
                SkipWhite();

                if (PeekChar() != '/')
                        throw std::runtime_error("Unexpected character in dictionary");

                // Let the Name parser decode the name
                NameObjectPtr name = ParseName(obj, gen);
                std::string key = name->value;

                SkipWhite();

                // Now read the value
                dictobject->value[key] = GetNextObject(obj, gen);

                SkipWhite();

        }

        if(GetChar() != '>' || GetChar() != '>')
                throw std::runtime_error("Unexpected character in dictionary");

        return dictobject;
}

StreamObjectPtr Lexer::ParseStream(DictObjectPtr const &dict, unsigned objnum, unsigned objgen)
{
        StreamObjectPtr stream_object(new StreamObject(*this));

        // Let the file pointer point to the first character in the stream
        std::string stream_word = ParsePlainString();

        if (stream_word != "stream")
                throw std::runtime_error("Corrupt PDF File: Stream didn't start with stream keyword");

        // Go on untill the first line feed
        while(GetChar() != '\n')
                /* loop */;

        // Determine the size of the encoded stream
        size_t size = (size_t)dict->GetDictionary()["Length"].GetNumericInt();

        // Calculate the boundaries of the stream
        stream_object->dict = dict;
        stream_object->objnum = objnum;
        stream_object->objgen = objgen;
        stream_object->filekey = filekey;

        stream_object->input_offset = current_parser_ctxt.offset;
        stream_object->input_end_offset = stream_object->input_offset + size;
        stream_object->input_stream = current_parser_ctxt.stream;

        DEBUGPRINT("stream " << objnum << " " << objgen << " start " << stream_object->input_offset << " end " << stream_object->input_end_offset);

        //Make sure the we are correctly positioned
        SetOffset(stream_object->input_end_offset);

        SkipWhite();

        if (ParsePlainString() != "endstream")
                throw std::runtime_error("Corrupt PDF file: Stream does not end with the endstream marker");

        return stream_object;
}

ObjectPtr Lexer::ResolveIndirect(std::pair<uint32_t, uint32_t> object)
{
        DEBUGPRINT("ResolveIndirect " << object.first << " " << object.second << " " << crossrefs.size());
        ObjectNumGen key = ObjectNumGen(object.first, object.second);
        if (key.first==0&&key.second==0)
        {
                DEBUGPRINT("Key=0, returning null object");
                return ObjectPtr(new NullObject);
        }

        // When this referenced object does not exist, we should return a null object
        CrossRefIndex::const_iterator res = crossrefs.find(key);
        if (res == crossrefs.end())
        {
                DEBUGPRINT("Key does not exist, returning null object");
                return ObjectPtr(new NullObject);
        }
        if(res->second.first == 0 && res->second.second == 0)
        {
                DEBUGPRINT("Key refers to freed object, returning null object");
                return ObjectPtr(new NullObject);
        }

        ObjectPtr new_object;
        if(res->second.first == 0) //raw position
        {
                // Look it up
                PushParserContext();
                SetOffset(res->second.second);
                DEBUGPRINT("ResolveIndirect " << object.first << " " << object.second << " is at " << current_parser_ctxt.offset);

                // Now verify the object number
                NumObjectPtr numobject = ParseNumeric();
                if (numobject->value.int_value != object.first)
                        throw std::runtime_error("Corrupt PDF File: Invalid indirect object expected " + Blex::AnyToString(object.first) +  " got " + Blex::AnyToString(numobject->value.int_value));

                // Verify the generation number
                numobject = ParseNumeric();
                if (numobject->value.int_value != object.second)
                        throw std::runtime_error("Corrupt PDF File: Invalid indirect object reference");

                // Read the obj tag
                if (ParsePlainString() != "obj")
                        throw std::runtime_error("Corrupt PDF File: Invalid indirect object reference");

                SkipWhite();

                // Now read the actual object
                new_object = GetNextObject(object.first, object.second);

                SkipWhite();

                // End read the endobj tag
                if (ParsePlainString() != "endobj")
                        DEBUGPRINT("End object tag of indirect object is missing");

                // Restore position in the stream
                RestoreParserContext();
                PopParserContext();
                return new_object;
        }
        else //embedded into another object
        {
                DEBUGPRINT("ResolveIndirect " << object.first << " " << object.second << " is in object " << res->second.first << " entry " << res->second.second);

                //FIXME Cache Object Streams
                ObjectPtr objstream = ResolveIndirect(ObjectNumGen(res->second.first, 0));

                //lexer requires seekable stream..
                Blex::MemoryRWStream objseekablestream;
                objstream->GetStream().GetUncompressedData()->SendAllTo(objseekablestream);

                objseekablestream.SetOffset(0);

                //Get the stream start offsets
                std::vector<uint8_t> streamoffsetdata;
                unsigned datastart = objstream->GetDictionary()["First"].GetNumericInt();
                streamoffsetdata.resize(datastart);
                streamoffsetdata.resize(objseekablestream.Read(&streamoffsetdata[0], streamoffsetdata.size()));

                //Tokenize the integers
                uint8_t *parsepos = &streamoffsetdata[0];
                uint8_t *parseend = &streamoffsetdata[streamoffsetdata.size()];

                std::vector< std::pair<unsigned, unsigned> > streamoffsets;
                while(parsepos < parseend)
                {
                        uint8_t *lastparsepos = parsepos;

                        //Decode streamid
                        std::pair<unsigned, uint8_t*> objnum = Blex::DecodeUnsignedNumber<unsigned>(parsepos, parseend, 10);
                        //Decode stream start position
                        parsepos = objnum.second;
                        while(parsepos < parseend && Blex::IsWhitespace(*parsepos))
                           ++parsepos;
                        //Decode objpos
                        std::pair<unsigned, uint8_t*> objpos = Blex::DecodeUnsignedNumber<unsigned>(parsepos, parseend, 10);
                        parsepos = objpos.second;

                        while(parsepos < parseend && Blex::IsWhitespace(*parsepos))
                           ++parsepos;
                        streamoffsets.push_back(std::make_pair(objnum.first, objpos.first));

                        if(lastparsepos == parsepos)
                              break; //no forward progress, so just give up parsing this
                }

                DEBUGPRINT("Got " << streamoffsets.size() << " offsets, looking for " << object.first << " " << object.second);
                //Now find the requested stream
                if(res->second.second >= streamoffsets.size())
                    throw std::runtime_error("Requested object does not exist in the object stream (pos >= offsets.size())");
                if(streamoffsets[res->second.second].first != key.first)
                    throw std::runtime_error("Object is not at expected position #" + Blex::AnyToString(res->second.second) + " expected " + Blex::AnyToString(key.first) + " actual " + Blex::AnyToString(res->second.second));

                unsigned streamstart = datastart + streamoffsets[res->second.second].second;
                unsigned streamlimit = res->second.second == streamoffsets.size() -1 ? objseekablestream.GetFileLength() : datastart + streamoffsets[res->second.second+1].second;

                Blex::LimitedStream objectsubdata(streamstart, streamlimit, objseekablestream);

                PushParserContext();
                SetupParserContext(&objectsubdata, 0);

                DEBUGPRINT("Trying to create object, objstream start " << streamstart << " limit " << streamlimit);
                ObjectPtr obj = GetNextObject(key.first, key.second);

                RestoreParserContext();
                PopParserContext();
                return obj;



/*
                std::vector<uint8_t> streamdata;

                unsigned datastart = objstream->GetDictionary()["First"].GetNumericInt();
                if(datastart > streamdata.size())
                    throw std::runtime_error("Truncated object stream");

                //Tokenize the integers
                uint8_t *parsepos = &streamdata[0];
                uint8_t *parseend = &streamdata[datastart];

                std::vector< std::pair<unsigned, unsigned> > streamoffsets;
                while(parsepos < parseend)
                {
                        //Decode streamid
                        std::pair<unsigned, uint8_t*> objnum = Blex::DecodeUnsignedNumber(parsepos, parseend, 10);
                        //Decode stream start position
                        parsepos = objnum.second;
                        while(parsepos < parseend && *parsepos==32)
                           ++parsepos;
                        //Decode objpos
                        std::pair<unsigned, uint8_t*> objpos = Blex::DecodeUnsignedNumber(parsepos, parseend, 10);
                        parsepos = objnum.second;

                        while(parsepos < parseend && *parsepos==32)
                           ++parsepos;
                        streamoffsets.insert(std::make_pair(objnum.first, objpos.first));
                }

                //Now find the requested stream
                if(res->second.second >= streamoffsets.size())
                    throw std::runtime_error("Requested object does not exist in the object stream (pos >= offsets.size())");
                if(streamoffsets[res->second.second].first != key.first)
                    throw std::runtime_error("Object is not at expected position #" + Blex::AnyToString(res->second.second)] + " expected " + Blex::AnyToString(key.first) + " actual " + Blex::AnyToString(res->second.second));

                unsigned streamstart = streamoffsets[res->second.second].second;
                unsigned streamlimit = res->second.second==streamoffsets.size() -1 ? streamdata.size() : streamoffsets[res->second.second+1].second;
                if(streamstart>startlimit || startlimit > streamdata.size())
                    throw std::runtime_error("Object lies (partially) outside its containing stream");

                ///
                throw std::runtime_error("FIXME");
*/
        }
}

ObjectPtr Lexer::GetNextObject(unsigned objnum, unsigned objgen)
{
        SkipWhite();

        if(Eof())
                return NullObjectPtr(new NullObject());

        char c = PeekChar();
        if(c == '-' || c == '+' || c == '.')
        {
                /** Numeric */
                return ParseNumeric();
        }
        else if(isNumber(c))
        {
                /** Might be number or indirect reference */
                NumObjectPtr number = ParseNumeric();

                // Skip all white spaces
                while(!Eof() && isWhiteSpace(PeekChar()) && PeekChar() != '\n' && PeekChar() != '\r')
                    MoveNext();

                // It's just a number
                if(Eof() || !isNumber(PeekChar()))
                    return number;

                // There is another number, it might be an indirect reference
                // Store the context first, so we can go back if it's not an indirect reference
                PushParserContext();

                IndirectObjectKey key;

                // Read the object number
                key.first = (uint32_t)number->value.int_value;

                // Read the generation number
                NumObjectPtr numobject = ParseNumeric();
                key.second = (uint32_t)numobject->value.int_value;

                SkipWhite();

                if(ParsePlainString() != "R")
                {
                        // We made a mistake, it was just a number, restore the parser
                        // and return the number;
                        RestoreParserContext();
                        PopParserContext();
                        return number;
                }

                PopParserContext();

                //Did we already get this object in this lexer session?
                IndirectObjectCache::const_iterator itr = indobjcache.find(key);
                if (itr == indobjcache.end())
                {
                        IndirectObjectPtr indobj(new IndirectObject(*this, key.first, key.second));
                        indobjcache.insert(std::make_pair(key,indobj));
                        return indobj;
                }
                else
                {
                        return itr->second;
                }
        } else if (c == '(')
        {
                /** literal String */
                return ParseString(objnum, objgen);
        } else if (c == '/')
        {
                /** Name */
                return ParseName(objnum, objgen);
        } else if (c == '[')
        {
                /** Array */
                return ParseArray(objnum, objgen);
        }
        else if(c == '<')
        {
               /** Dictionary, Stream or Hexadecimal String */
                /*char first_char = */GetChar();
                char second_char = PeekChar();
                MoveBack(); // Set stream pointer back to first character

                if(second_char != '<')
                        return ParseString(objnum, objgen);

               // First parse the dictionary
               DictObjectPtr dict = ParseDictionary(objnum, objgen);

               SkipWhite();

               // Store the parser first, if it's not a stream, we have to go back
               PushParserContext();

               bool is_stream = (ParsePlainString() == "stream");

               RestoreParserContext();
               PopParserContext();

               // It is not a stream, just a dictionary, return now
               if(!is_stream)
                        return dict;

               return ParseStream(dict, objnum, objgen);
        }

        // FIXME: This seems to be an error in an old version of acrobat
        // distiller?
        if(isDelimiter(c))
        {
                MoveNext();
                return NullObjectPtr(new NullObject);
        }


        std::string keyword = ParsePlainString();
        /** Null */
        if (keyword.empty() || keyword == "null")
                return NullObjectPtr(new NullObject);

        /** Boolean */
        if (keyword == "true")
        {
                BooleanObjectPtr booleanobject(new BooleanObject());
                booleanobject->value = true;
                return booleanobject;
        }

        if(keyword == "false")
        {
                BooleanObjectPtr booleanobject(new BooleanObject());
                booleanobject->value = false;
                return booleanobject;
        }

        /** Otherwise, we assume it's a keyword */
        KeywordObjectPtr keywordobject(new KeywordObject);
        keywordobject->value = keyword;
        return keywordobject;
}

void Lexer::PastEofException()
{
        throw std::runtime_error("Reading past EOF in PDF file - file corrupted or misunderstood?");
}


}

}

}
