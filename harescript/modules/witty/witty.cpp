//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>
#include <harescript/vm/baselibs.h>
#include <blex/logfile.h>

//---------------------------------------------------------------------------
#include "witty.h"


//#define WITTY_DEBUG

#if defined(DEBUG) && defined(WITTY_DEBUG)
 #define WTE_PRINT(x) DEBUGPRINT(x)
#else
 #define WTE_PRINT(x) (void)0
#endif


/** Schedule a callback. Scheduled operations will be executied in a LIFO order.
    @param call Callback to call
*/
void BLEXLIB_PUBLIC HSVM_ScheduleCallback_cpp(struct HSVM *vm, std::function< void(bool) > const &callback) ;

namespace HareScript
{
namespace Witty
{

static const char *WittyMessages[]=
{ "Unterminated instruction" // 1
, "Linefeed appears inside instruction"
, "Unknown data follows the value: '%0'"
, "Unknown encoding '%0' requested"
, "Reserved word '%0' cannot be used as print data"
, "An ELSE or ELSEIF must be inside an IF-block"
, "Duplicate ELSE in IF-block"
, "/IF must be inside an IF-block"
, "Duplicate component name"
, "/COMPONENT must be inside a COMPONENT-block" // 10
, "Parameter passed must be a cell name" // 11
, "/FOREVERY must be inside a FOREVERY-block"
, "Unterminated block"
, "Unterminated comment"
, "No such cell '%0'"
, "Cell '%0' did not evaluate to an array"
, "Requesting '%0' outside a FOREVERY-block or a REPEAT-block"
, "Don't know how to print cell '%0' of type '%1'"
, "Don't know how to evaluate the truth value of cell '%0' of type '%1'"
, "No such component '%0'" // 20
, "Empty command" // 21
, "/REPEAT must be inside a REPEAT-block"
, "Cell '%0' did not evaluate to an INTEGER"
, "Invalid closing tag '%0'"
, "Missing encoding after ':'"
, "Missing required parameter"
, "/RAWCOMPONENT must be inside a RAWCOMPONENT-block" // 27
};

WittyExecutionState::WittyExecutionState(ParsedFile &file, HSVM *hsvm, int32_t scriptid, bool newwitty)
: file(file)
, hsvm(hsvm)
, gettidfunc(0)
, gethtmltidfunc(0)
, scriptid(scriptid)
, newwitty(newwitty)
{
}

Encoding GetESStyle(std::string const &name)
{
        Encoding retval;
        retval.noindent = Blex::StrLike(name,"*-NI");

        if (name == "HTML" || name == "HTML-NI")
            retval.style=ES_HTML;
        else if (name == "XML" || name == "XML-NI")
            retval.style=ES_XML;
        else if (name == "TEXT" || name == "TEXT-NI")
            retval.style=ES_Text;
        else
            retval.style=ES_Invalid;

        return retval;
}

inline ContentEncoding GetNonquoteEncoding(EncodingStyles encodingstyle)
{
        if(encodingstyle==ES_HTML)
            return CE_Html;
        else if(encodingstyle==ES_XML)
            return CE_Value;
        else
            return CE_None;
}

Commands ReadCommand(char const *start, char const *limit)
{
        static const char instr_if[]={"if"};
        static const char instr_else[]={"else"};
        static const char instr_elseif[]={"elseif"};
        static const char instr_endif[]={"/if"};
        static const char instr_forevery[]={"forevery"};
        static const char instr_endforevery[]={"/forevery"};
        static const char instr_repeat[]={"repeat"};
        static const char instr_endrepeat[]={"/repeat"};
        static const char instr_component[]={"component"};
        static const char instr_endcomponent[]={"/component"};
        static const char instr_embed[]={"embed"};
        static const char instr_gettid[]={"gettid"};
        static const char instr_gethtmltid[]={"gethtmltid"};
        static const char instr_rawcomponent[]={"rawcomponent"};
        static const char instr_endrawcomponent[]={"/rawcomponent"};

        if (limit-start == (sizeof instr_if-1) && Blex::MemCaseCompare(start,instr_if,sizeof instr_if-1)==0)
            return C_If;
        if (limit-start == (sizeof instr_else-1) && Blex::MemCaseCompare(start,instr_else,sizeof instr_else-1)==0)
            return C_Else;
        if (limit-start == (sizeof instr_elseif-1) && Blex::MemCaseCompare(start,instr_elseif,sizeof instr_elseif-1)==0)
            return C_ElseIf;
        if (limit-start == (sizeof instr_endif-1) && Blex::MemCaseCompare(start,instr_endif,sizeof instr_endif-1)==0)
            return C_EndIf;
        if (limit-start == (sizeof instr_forevery-1) && Blex::MemCaseCompare(start,instr_forevery,sizeof instr_forevery-1)==0)
            return C_Forevery;
        if (limit-start == (sizeof instr_endforevery-1) && Blex::MemCaseCompare(start,instr_endforevery,sizeof instr_endforevery-1)==0)
            return C_EndForevery;
        if (limit-start == (sizeof instr_repeat-1) && Blex::MemCaseCompare(start,instr_repeat,sizeof instr_repeat-1)==0)
            return C_Repeat;
        if (limit-start == (sizeof instr_endrepeat-1) && Blex::MemCaseCompare(start,instr_endrepeat,sizeof instr_endrepeat-1)==0)
            return C_EndRepeat;
        if (limit-start == (sizeof instr_component-1) && Blex::MemCaseCompare(start,instr_component,sizeof instr_component-1)==0)
            return C_Component;
        if (limit-start == (sizeof instr_endcomponent-1) && Blex::MemCaseCompare(start,instr_endcomponent,sizeof instr_endcomponent-1)==0)
            return C_EndComponent;
        if (limit-start == (sizeof instr_rawcomponent-1) && Blex::MemCaseCompare(start,instr_rawcomponent,sizeof instr_rawcomponent-1)==0)
            return C_RawComponent;
        if (limit-start == (sizeof instr_endrawcomponent-1) && Blex::MemCaseCompare(start,instr_endrawcomponent,sizeof instr_endrawcomponent-1)==0)
            return C_EndRawComponent;
        if (limit-start == (sizeof instr_embed-1) && Blex::MemCaseCompare(start,instr_embed,sizeof instr_embed-1)==0)
            return C_Embed;
        if (limit-start == (sizeof instr_gettid-1) && Blex::MemCaseCompare(start,instr_gettid,sizeof instr_gettid-1)==0)
            return C_GetTid;
        if (limit-start == (sizeof instr_gethtmltid-1) && Blex::MemCaseCompare(start,instr_gethtmltid,sizeof instr_gethtmltid-1)==0)
            return C_GetHtmlTid;
        if (limit != start && *start == '/')
            return C_InvalidClosingTag;
        return C_NotACommand;
}

bool IsNot(char const *start, unsigned len)
{
        static const char cond_not[]={"not"};
        if (len == 3 && Blex::MemCaseCompare(start, cond_not, 3) == 0)
            return true;
        return false;
}

DataType ReadDataType(char const *start, char const *limit)
{
        static const char instr_first[]={"first"};
        static const char instr_last[]={"last"};
        static const char instr_odd[]={"odd"};
        static const char instr_even[]={"even"};
        static const char instr_seqnr[]={"seqnr"};

        if (limit-start == (sizeof instr_first-1) && Blex::MemCaseCompare(start,instr_first,sizeof instr_first-1)==0)
            return DT_First;
        if (limit-start == (sizeof instr_last-1) && Blex::MemCaseCompare(start,instr_last,sizeof instr_last-1)==0)
            return DT_Last;
        if (limit-start == (sizeof instr_odd-1) && Blex::MemCaseCompare(start,instr_odd,sizeof instr_odd-1)==0)
            return DT_Odd;
        if (limit-start == (sizeof instr_even-1) && Blex::MemCaseCompare(start,instr_even,sizeof instr_even-1)==0)
            return DT_Even;
        if (limit-start == (sizeof instr_seqnr-1) && Blex::MemCaseCompare(start,instr_seqnr,sizeof instr_seqnr-1)==0)
            return DT_Seqnr;
        return DT_Cell;
}

ContentEncoding ReadEncoding(char const *start, char const *limit)
{
        static const char ec_none[]={"none"};
        static const char ec_java[]={"java"};
        static const char ec_xml[]={"xml"};
        static const char ec_value[]={"value"};
        static const char ec_html[]={"html"};
        static const char ec_xhtml[]={"xhtml"};
        static const char ec_url[]={"url"};
        static const char ec_base16[]={"base16"};
        static const char ec_base64[]={"base64"};
        static const char ec_cdata[]={"cdata"};
        static const char ec_json[]={"json"};
        static const char ec_jsonvalue[]={"jsonvalue"};

        if (limit-start == (sizeof ec_none-1) && Blex::MemCaseCompare(start,ec_none,sizeof ec_none-1)==0)
            return CE_None;
        if (limit-start == (sizeof ec_java-1) && Blex::MemCaseCompare(start,ec_java,sizeof ec_java-1)==0)
            return CE_Java;
        if (limit-start == (sizeof ec_xml-1) && Blex::MemCaseCompare(start,ec_xml,sizeof ec_xml-1)==0)
            return CE_Value;
        if (limit-start == (sizeof ec_value-1) && Blex::MemCaseCompare(start,ec_value,sizeof ec_value-1)==0)
            return CE_Value;
        if (limit-start == (sizeof ec_html-1) && Blex::MemCaseCompare(start,ec_html,sizeof ec_html-1)==0)
            return CE_Html;
        if (limit-start == (sizeof ec_xhtml-1) && Blex::MemCaseCompare(start,ec_xhtml,sizeof ec_xhtml-1)==0)
            return CE_Html;
        if (limit-start == (sizeof ec_url-1) && Blex::MemCaseCompare(start,ec_url,sizeof ec_url-1)==0)
            return CE_Url;
        if (limit-start == (sizeof ec_base16-1) && Blex::MemCaseCompare(start,ec_base16,sizeof ec_base16-1)==0)
            return CE_Base16;
        if (limit-start == (sizeof ec_base64-1) && Blex::MemCaseCompare(start,ec_base64,sizeof ec_base64-1)==0)
            return CE_Base64;
        if (limit-start == (sizeof ec_cdata-1) && Blex::MemCaseCompare(start,ec_cdata,sizeof ec_cdata-1)==0)
            return CE_CData;
        if (limit-start == (sizeof ec_json-1) && Blex::MemCaseCompare(start,ec_json,sizeof ec_json-1)==0)
            return CE_Json;
        if (limit-start == (sizeof ec_jsonvalue-1) && Blex::MemCaseCompare(start,ec_jsonvalue,sizeof ec_jsonvalue-1)==0)
            return CE_JsonValue;

        return CE_Invalid;
}

Context::Context()
: globalgettid(0)
, globalgethtmltid(0)
{
}
Context::~Context()
{
}

SM_Continuation::~SM_Continuation()
{
}

ParsedFile::ParsedFile(std::string const &gettidmodule, EncodingStyles es)
: es(es)
, gettidmodule(gettidmodule)
{
        parts.push_back(ParsedPart(0,0,ParsedPart::Content));
}
ParsedFile::~ParsedFile()
{
}

/* A simple stateful template parser, suitable for parsing Text, HTML, XHTML and XML contexts */
int32_t Context::ParseXmlTemplate(char const *data, unsigned datalen, Encoding encoding, std::string const &gettidmodule)
{
        static const char instr_endrawcomponent[]={"/rawcomponent"};
        EncodingStyles encodingstyle = encoding.style;
        bool stripindent = encoding.noindent;
        ParsedFilePtr newfile(new ParsedFile(gettidmodule, encodingstyle));
        ParserStates state = encodingstyle==ES_Text ? PS_Text : PS_Content;


        bool incomment = false;
        bool droppingwhitespace = false;
        char const *enddata = data+datalen;
        unsigned linenum=1,columnnum=1;
        errors.clear();
        while (data != enddata)
        {
                //Remove all BOMs
                if (data[0]=='\xEF' && ((enddata-data) > 2) && data[1]=='\xBB' && data[2]=='\xBF')
                {
                        data += 3;
                        continue;
                }

                ++columnnum;
                if (*data=='[' && !incomment) //A template entity may start here!
                {
                        if(droppingwhitespace)
                                droppingwhitespace = false;

                        char const *end_instruction;
                        ++data;
                        if (state == PS_RawComponent)
                        {
                                if(static_cast<unsigned>(std::distance(data,enddata)) >= sizeof(instr_endrawcomponent)
                                   && data[sizeof(instr_endrawcomponent)-1] == ']'
                                   && Blex::MemCaseCompare(data, instr_endrawcomponent, sizeof instr_endrawcomponent-1) == 0)
                                {
                                        end_instruction = data + sizeof(instr_endrawcomponent) - 1;
                                }
                                else
                                {
                                        newfile->AddContentChar(linenum, columnnum, '[');
                                        continue;
                                }
                        }
                        else
                        {
                                if (data!=enddata && *data=='[') //it was just an escaped '{'
                                {
                                        newfile->AddContentChar(linenum, columnnum, *data);
                                        ++data;
                                        ++columnnum;
                                        continue;
                                }
                                if (*data == '!')
                                {
                                        ++data;
                                        ++columnnum;
                                        incomment = true;
                                        continue;
                                }

                                bool inquote = false;
                                char quote_char = ' ';
                                end_instruction = data;
                                bool have_error = false;
                                while (true)
                                {
                                        if (end_instruction == enddata)
                                        {
                                                AddError(Error(linenum,columnnum,1,""));
                                                return 0;
                                        }
                                        if (*end_instruction == '\n')
                                        {
                                                AddError(Error(linenum,columnnum,2,""));
                                                have_error = true;
                                                break;
                                        }
                                        if (*end_instruction == '\\')
                                        {
                                                ++end_instruction;
                                                if (end_instruction != enddata)
                                                    ++end_instruction;
                                        }
                                        if (!inquote)
                                        {
                                                if (*end_instruction == '"' || *end_instruction == '\'')
                                                {
                                                        inquote = true;
                                                        quote_char = *end_instruction;

                                                        ++end_instruction;
                                                        continue;
                                                }
                                                if (*end_instruction == ']')
                                                    break;
                                        }
                                        else
                                        {
                                                if (*end_instruction == quote_char)
                                                {
                                                        inquote = false;
                                                        ++end_instruction;
                                                        continue;
                                                }
                                        }

                                        ++end_instruction;
                                }
                                if (have_error)
                                    continue;
                        }

                        try
                        {
                                newfile->AddInstruction(linenum, columnnum, data, end_instruction, state == PS_TagSquote || state == PS_TagDquote || state == PS_Tag ? CE_Value : GetNonquoteEncoding(encodingstyle), &state);
                        }
                        catch(Error const &e)
                        {
                                AddError(e);
                        }
                        columnnum += end_instruction+1-data;
                        data=end_instruction+1;
                }
                else
                {
                        //note: code below will never switch state in ES_Text mode, because initial state is PS_Text then
                        switch(*data)
                        {
                        case '<':
                                if (state==PS_Content)
                                    state=PS_Tag;
                                break;
                        case '>':
                                if (state==PS_Tag)
                                    state=PS_Content;
                                break;
                        case '\'':
                                if (state==PS_Tag)
                                    state=PS_TagSquote;
                                else if (state==PS_TagSquote)
                                    state=PS_Tag;
                                break;
                        case '\"':
                                if (state==PS_Tag)
                                    state=PS_TagDquote;
                                else if (state==PS_TagDquote)
                                    state=PS_Tag;
                                break;
                        case '!':
                                if (incomment && data+1 != enddata && data[1]==']')
                                {
                                        data += 2; //skip both ! and ]
                                        ++columnnum; //skip the ]
                                        incomment=false;
                                        continue;
                                }
                        }

                        //ADDME: Don't do character by character parse, slow!
                        if (!incomment)
                        {
                                //ADDME also drop whitespace when parsing '>    \n    ' - ie everything before the \n
                                if(stripindent && state != PS_RawComponent && (*data=='\n' || *data=='\r') && !droppingwhitespace)
                                {
                                        droppingwhitespace = true;
                                        if(state == PS_Tag || state == PS_TagSquote || state == PS_TagDquote) //we're inside a tag, so keep ONE whitespcae
                                            newfile->AddContentChar(linenum, columnnum, ' ');
                                }
                                else if(droppingwhitespace && !Blex::IsWhitespace(*data))
                                        droppingwhitespace = false;

                                if(!droppingwhitespace)
                                    newfile->AddContentChar(linenum, columnnum, *data);
                        }

                        // Process \n location consequences after character emit, to ensure correct location
                        if (*data == '\n')
                        {
                                linenum=linenum+1;
                                columnnum=1;
                        }

                        ++data;
                }
        }

        if (!newfile->blockstack.empty())
           AddError(Error(linenum, columnnum, 13, ""));
        if (incomment)
           AddError(Error(linenum, columnnum, 14, ""));

        if (!errors.empty())
            return 0;

        parsedfiles.push_back(newfile);
        return parsedfiles.size();
}

bool ParsedFile::ParseParameter(unsigned linenum, unsigned columnnum, const char *last_end, const char *limit, std::string *data, DataType *datatype, const char **param_end, bool stop_at_colon, bool required)
{
        // Skip leading spaces
        while (last_end != limit && Blex::IsWhitespace(*last_end))
            ++last_end;

        const char *data_start = last_end;
        bool have_param = data_start != limit && (!stop_at_colon || *data_start != ':');

        if (have_param)
        {
                std::string parsed_data;
                parsed_data.reserve(unsigned(limit - data_start));

                const char *data_start = last_end;

                bool quoted = *data_start == '"' || *data_start == '\'';
                char quote_char = *data_start;

                if (quoted)
                {
                        // Disable stop at colon, skip quote char
                        stop_at_colon = false;
                        ++last_end;
                }

                while (last_end != limit && (quoted || !Blex::IsWhitespace(*last_end)))
                {
                        if (*last_end == '\\')
                        {
                                if (++last_end != limit)
                                {
                                        if (*last_end != ':' && *last_end != ']')
                                            parsed_data.push_back('\\');

                                        parsed_data.push_back(*last_end);
                                        ++last_end;
                                }
                        }
                        else if (stop_at_colon && *last_end == ':') // Encoding start, end of parameters
                            break;
                        else if (quoted && *last_end == quote_char)
                        {
                                // Skip last quote char
                                ++last_end;
                                break;
                        }
                        else
                        {
                                parsed_data.push_back(*last_end);
                                ++last_end;
                        }
                }

                // If quoted, ReadDataType will not recognize it, no extra handling needed
                if (datatype)
                   *datatype = ReadDataType(data_start, last_end);

                Blex::DecodeJava(parsed_data.begin(), parsed_data.end(), std::back_inserter(*data));
        }
        else if (required)
            throw Error(linenum, columnnum, 26 , "");

        // Write out end of parameter
        *param_end = last_end;

        return have_param;
}

bool ParsedFile::ParseEncoding(unsigned linenum, unsigned columnnum, const char *last_end, const char *limit, ContentEncoding *encoding, const char **param_end)
{
        while (last_end != limit && Blex::IsWhitespace(*last_end))
            ++last_end;

        if (last_end == limit)
            return false;

        if (*last_end != ':')
            throw Error(linenum, columnnum, 3, std::string(last_end, limit));

        const char *encoding_start = ++last_end;

        // Skip whitespace following ':'
        while (encoding_start != limit && Blex::IsWhitespace(*encoding_start))
            ++encoding_start;

        // Parse encoding until first whitespace
        last_end = encoding_start;
        while (last_end != limit && !Blex::IsWhitespace(*encoding_start))
            ++last_end;

        *encoding = ReadEncoding(encoding_start, last_end);
        if (*encoding == CE_Invalid)
            throw Error(linenum, columnnum, 4, std::string(encoding_start, last_end));

        *param_end = last_end;

        return true;
}


void ParsedFile::AddInstruction(unsigned linenum, unsigned columnnum, char const *start, char const *limit, ContentEncoding suggested_encoding, ParserStates *state)
{
        //Trim whitespace
        while (start!=limit && Blex::IsWhitespace(*start))
            ++start;
        while (start!=limit && Blex::IsWhitespace(limit[-1]))
            --limit;

        // No empty tags!
        if (start==limit)
            throw Error(linenum, columnnum, 21, std::string());

        // Parse initial command (ignores '\ ', but that doesn't matter, that will come out as C_NotACommand
        char const *command_end = start;
        while (command_end != limit && !Blex::IsWhitespace(*command_end))
            ++command_end;

        Commands cmd = ReadCommand(start,command_end);
        //FIXME: Support overwriting encoding (?????)
        switch(cmd)
        {
        case C_InvalidClosingTag:
                {
                        throw Error(linenum, columnnum, 24, std::string(start, limit));
                }
        case C_NotACommand:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Data));

                        const char *param_end = start;
                        ParseParameter(
                              linenum,
                              columnnum,
                              param_end,
                              limit,
                              &parts.back().content,
                              &parts.back().datatype,
                              &param_end,
                              true,
                              true);

                        parts.back().encoding = suggested_encoding;
                        ParseEncoding(linenum, columnnum, param_end, limit, &parts.back().encoding, &param_end);

                        if (parts.back().datatype != DT_Seqnr && parts.back().datatype != DT_Cell)
                            throw Error(linenum,columnnum, 5, parts.back().content);

                        Blex::ToUppercase(parts.back().content.begin(), parts.back().content.end());

                        start = param_end;
                } break;

        case C_If:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::If));

                        const char *param_end;
                        ParseParameter(linenum, columnnum, command_end, limit, &parts.back().content, &parts.back().datatype, &param_end, true, true);
                        parts.back().ifnot = IsNot(parts.back().content.c_str(), parts.back().content.size());
                        if(parts.back().ifnot) // 'not' was present, parse following required parameter
                        {
                                parts.back().content.clear();
                                ParseParameter(linenum, columnnum, param_end, limit, &parts.back().content, &parts.back().datatype, &param_end, true, true);
                        }

                        Blex::ToUppercase(parts.back().content.begin(), parts.back().content.end());
                        blockstack.push(&parts.back());

                        start = param_end;
                } break;

        case C_ElseIf:
                //[elseif XXX] = [else][if XXX].....   and an extra endif layer at the end.....
                {
                        if (blockstack.empty() || (blockstack.top()->type != ParsedPart::If && blockstack.top()->type != ParsedPart::ElseIf))
                            throw Error(linenum, columnnum, 6,"");
                        if (blockstack.top()->cmd_limit != 0)
                            throw Error(linenum, columnnum, 7,"");

                        blockstack.top()->cmd_limit = parts.size();

                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::ElseIf));

                        const char *param_end;
                        ParseParameter(linenum, columnnum, command_end, limit, &parts.back().content, &parts.back().datatype, &param_end, true, true);
                        parts.back().ifnot = IsNot(parts.back().content.c_str(), parts.back().content.size());
                        if(parts.back().ifnot) // 'not' was present, parse following required parameter
                        {
                                parts.back().content.clear();
                                ParseParameter(linenum, columnnum, param_end, limit, &parts.back().content, &parts.back().datatype, &param_end, true, true);
                        }

                        Blex::ToUppercase(parts.back().content.begin(), parts.back().content.end());
                        blockstack.push(&parts.back());

                        start = param_end;
                } break;

        case C_Else:
                {
                        if (blockstack.empty() || (blockstack.top()->type != ParsedPart::If && blockstack.top()->type != ParsedPart::ElseIf))
                            throw Error(linenum, columnnum, 6,"");
                        if (blockstack.top()->cmd_limit != 0)
                            throw Error(linenum, columnnum, 7,"");
                        //Start a new content block
                        blockstack.top()->cmd_limit = parts.size();
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Content));
                        start = command_end;
                } break;

        case C_EndIf:
                {
                        while(true)
                        {
                                if (blockstack.empty())
                                    throw Error(linenum, columnnum, 8,"");

                                ParsedPart::Type thistype = blockstack.top()->type;
                                if(thistype != ParsedPart::If && thistype != ParsedPart::ElseIf)
                                    throw Error(linenum, columnnum, 8,"");

                                if (blockstack.top()->cmd_limit == 0)
                                    blockstack.top()->cmd_limit = parts.size();
                                blockstack.top()->else_limit = parts.size();
                                parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Content));
                                blockstack.pop();

                                if(thistype == ParsedPart::If) //reached the outer [IF]
                                    break;
                        }
                        start = command_end;
                } break;

        case C_Forevery:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Forevery));

                        const char *param_end;
                        ParseParameter(linenum, columnnum, command_end, limit, &parts.back().content, &parts.back().datatype, &param_end, true, true);
                        if (parts.back().datatype != DT_Cell)
                            throw Error(linenum, columnnum, 11,"");

                        Blex::ToUppercase(parts.back().content.begin(), parts.back().content.end());
                        blockstack.push(&parts.back());
                        start = param_end;
                } break;

        case C_EndForevery:
                {
                        if (blockstack.empty() || blockstack.top()->type != ParsedPart::Forevery)
                            throw Error(linenum, columnnum, 12,"");
                        blockstack.top()->cmd_limit = parts.size();
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Content));
                        blockstack.pop();
                        start = command_end;
                } break;

        case C_Repeat:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Repeat));

                        const char *param_end;
                        ParseParameter(linenum, columnnum, command_end, limit, &parts.back().content, &parts.back().datatype, &param_end, false, true);
                        if (parts.back().datatype != DT_Cell)
                            throw Error(linenum, columnnum, 11,"");

                        Blex::ToUppercase(parts.back().content.begin(), parts.back().content.end());
                        blockstack.push(&parts.back());
                        start = param_end;
                } break;

        case C_EndRepeat:
                {
                        if (blockstack.empty() || blockstack.top()->type != ParsedPart::Repeat)
                            throw Error(linenum, columnnum, 22,"");
                        blockstack.top()->cmd_limit = parts.size();
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Content));
                        blockstack.pop();
                        start = command_end;
                } break;

        case C_Component:
        case C_RawComponent:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Component));

                        const char *param_end;
                        ParseParameter(linenum, columnnum, command_end, limit, &parts.back().content, &parts.back().datatype, &param_end, true, true);
                        if (parts.back().datatype != DT_Cell)
                            throw Error(linenum, columnnum, 11,"");

                        Blex::ToUppercase(parts.back().content.begin(), parts.back().content.end());
                        if (start_positions.find(parts.back().content) != start_positions.end())
                            throw Error(linenum, columnnum, 9,"");

                        start_positions.insert(std::make_pair(parts.back().content, parts.size()));
                        blockstack.push(&parts.back());
                        start = param_end;

                        if(cmd == C_RawComponent)
                                *state=PS_RawComponent;
                        else if (*state==PS_Tag || *state == PS_TagSquote || *state == PS_TagDquote) //assume a tag ended when hitting a component definition
                                *state=PS_Content;
                } break;

        case C_EndComponent:
        case C_EndRawComponent:
                {
                        if (cmd==C_EndComponent && (blockstack.empty() || blockstack.top()->type != ParsedPart::Component || *state==PS_RawComponent))
                            throw Error(linenum, columnnum, 10,"");
                        if (cmd==C_EndRawComponent && (blockstack.empty() || blockstack.top()->type != ParsedPart::Component || *state!=PS_RawComponent))
                            throw Error(linenum, columnnum, 27,"");

                        blockstack.top()->cmd_limit = parts.size();
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Content));
                        blockstack.pop();
                        start = command_end;
                        if(*state == PS_RawComponent)
                                *state = es == ES_Text ? PS_Text : PS_Content;
                        else if (*state==PS_Tag || *state == PS_TagSquote || *state == PS_TagDquote) //assume a tag ended when hitting a component definition
                                *state=PS_Content;
                } break;

        case C_Embed:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Embed));

                        const char *param_end;
                        ParseParameter(linenum, columnnum, command_end, limit, &parts.back().content, &parts.back().datatype, &param_end, false, true);
                        if (parts.back().datatype != DT_Cell)
                            throw Error(linenum, columnnum, 11,"");

                        start = param_end;
                } break;

        case C_GetTid:
        case C_GetHtmlTid:
                {
                        parts.push_back(ParsedPart(linenum, columnnum, cmd == C_GetTid ? ParsedPart::GetTid : ParsedPart::GetHtmlTid));

                        bool have_param = false;
                        const char *param_end = command_end;
                        DataType datatype;
                        std::string param;
                        while (true)
                        {
                                param.clear();

                                bool found_param = ParseParameter(
                                    linenum,
                                    columnnum,
                                    param_end,
                                    limit,
                                    &param,
                                    &datatype,
                                    &param_end,
                                    true,
                                    !have_param);

                                if (!found_param)
                                    break;

                                parts.back().parameters.push_back(param);

                                if (datatype != DT_Cell)
                                    throw Error(linenum, columnnum, 11,"");

                                have_param = true;
                        }

                        if(parts.back().parameters.size() > 0 && !gettidmodule.empty() && !Blex::StrLike(parts.back().parameters.front(),"*:*"))
                                parts.back().parameters.front() = gettidmodule + ":" + parts.back().parameters.front();

                        parts.back().datatype = DT_Cell;
                        parts.back().encoding = cmd == C_GetTid ? suggested_encoding : CE_None;
                        ParseEncoding(linenum, columnnum, param_end, limit, &parts.back().encoding, &param_end);

                        start = param_end;
                } break;

        default:
                throw std::runtime_error("Unsupported command");
        }

        if (start != limit)
            throw Error(linenum, columnnum, 3, std::string(start, limit));
}

void Context::AddError(Error const &err)
{
        errors.push_back(err);
}

//INTEGER FUNCTION PARSEWTEDATA (STRING data, STRING encding) ATTRIBUTES(EXTERNAL "WH_WTE")
void Parse(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        Encoding encoding = GetESStyle(HSVM_StringGetSTD(hsvm, HSVM_Arg(1)));
        std::string gettidmodule  = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));
        if (encoding.style == ES_Invalid)
        {
                HSVM_ReportCustomError(hsvm, "Invalid encoding style");
                return;
        }

        Blex::StringPair content;
        HSVM_StringGet(hsvm, HSVM_Arg(0), &content.begin, &content.end);
        HSVM_IntegerSet(hsvm, id_set, context.ParseXmlTemplate(content.begin, content.size(), encoding, gettidmodule));
}

void ParseBlob(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        Encoding encoding = GetESStyle(HSVM_StringGetSTD(hsvm, HSVM_Arg(1)));
        std::string gettidmodule  = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));
        if (encoding.style == ES_Invalid)
        {
                HSVM_ReportCustomError(hsvm, "Invalid encoding style");
                return;
        }

        std::vector<char> content(HSVM_BlobLength(hsvm, HSVM_Arg(0)));
        int handle = HSVM_BlobOpen(hsvm, HSVM_Arg(0));
        HSVM_BlobRead(hsvm, handle, content.size(), &content[0]);
        HSVM_BlobClose(hsvm, handle);

        HSVM_IntegerSet(hsvm, id_set, context.ParseXmlTemplate(&content[0], content.size(), encoding, gettidmodule));
}

void GetWittyLibraryBlob(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_ColumnId col_success = HSVM_GetColumnId(hsvm,"SUCCESS");
        HSVM_ColumnId col_data = HSVM_GetColumnId(hsvm,"DATA");

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        bool success = HSVM_MakeBlobFromFilesystem(hsvm, HSVM_RecordCreate(hsvm, id_set, col_data), HSVM_StringGetSTD(hsvm,HSVM_Arg(0)).c_str(), 2/*witty*/) == 0;
        HSVM_BooleanSet(hsvm, HSVM_RecordCreate(hsvm, id_set, col_success), success);
}

void GetWittyMessage(Error const &in, std::string *error)
{
        std::string msg;
        unsigned numerrors = sizeof(WittyMessages) / sizeof(*WittyMessages);
        if (in.errorcode>=1 && in.errorcode<=numerrors)
        {
                msg = WittyMessages[in.errorcode-1];
                std::string::size_type subst = msg.find("%0");
                if (subst != std::string::npos)
                    msg.replace(subst, 2, in.arg);
                subst = msg.find("%1");
                if (subst != std::string::npos)
                    msg.replace(subst, 2, in.arg2);
        }
        *error += msg;
}

void ErrorToRecord(HSVM *hsvm, Error const &in, HSVM_VariableId out)
{
        HSVM_ColumnId col_line = HSVM_GetColumnId(hsvm,"LINE");
        HSVM_ColumnId col_col = HSVM_GetColumnId(hsvm,"COL");
        HSVM_ColumnId col_errortext = HSVM_GetColumnId(hsvm,"TEXT");
        HSVM_ColumnId col_errorcode = HSVM_GetColumnId(hsvm,"CODE");
        HSVM_ColumnId col_errorarg = HSVM_GetColumnId(hsvm,"ARG");

        std::string error;
        GetWittyMessage(in, &error);

        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, out, col_line), in.linenum);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, out, col_col), in.columnnum);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, out, col_errorcode), in.errorcode);
        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, out, col_errortext), error);
        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, out, col_errorarg), in.arg);
}

void GetWittyParseErrors(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        for (std::vector<Error>::const_iterator itr = context.errors.begin();itr != context.errors.end();++itr)
        {
                HSVM_VariableId err_rec = HSVM_ArrayAppend(hsvm,id_set);
                ErrorToRecord(hsvm, *itr, err_rec);
        }
}

HSVM_VariableId FindGetTidInStack(WittyExecutionState *mywes, bool htmlversion)
{
        HSVM *hsvm = mywes->hsvm;
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));

        for (Context::SMWitties::reverse_iterator itr = context.sm_witties.rbegin();
             itr != context.sm_witties.rend();
             ++itr)
        {
                if(htmlversion && (*itr)->gethtmltidfunc)
                    return (*itr)->gethtmltidfunc;
                if(!htmlversion && (*itr)->gettidfunc)
                    return (*itr)->gettidfunc;
                if((*itr)->newwitty)
                    break; //give up, we may not access a different RunWitty context
        }
        return htmlversion ? context.globalgethtmltid : context.globalgettid;
}

StackElement* FindForeveryInStack(WittyExecutionState *mywes)
{
        HSVM *hsvm = mywes->hsvm;
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));

        for (Context::SMWitties::reverse_iterator itr = context.sm_witties.rbegin();
             itr != context.sm_witties.rend();
             ++itr)
        {
                std::list< StackElement >::reverse_iterator it = (*itr)->stack.rbegin();
                while (it != (*itr)->stack.rend() && it->forevery_elt_limit == -1)
                    ++it;
                if(it != (*itr)->stack.rend())
                    return &*it;

                if((*itr)->newwitty)
                    break; //give up, we may not access a different RunWitty context
                continue; //keep trying
        }
        return 0;
}

HSVM_VariableId FindCellInStack(WittyExecutionState *wes, std::string const &cellname)
{
        HSVM *hsvm=wes->hsvm;
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));

        std::string::const_iterator dot = std::find(cellname.begin(), cellname.end(), '.');

        for (Context::SMWitties::reverse_iterator itr = context.sm_witties.rbegin();
             itr != context.sm_witties.rend();
             ++itr)
        {
                HSVM_VariableId colvar = 0;

                //Look up the first cell name in ALL cells.
                HSVM_ColumnId colid = HSVM_GetColumnIdRange(hsvm, &cellname[0], &*dot);
                for (unsigned i=(*itr)->varstack.size();i>0 && colvar == 0;--i)
                {
                        VarStackElement *elem = &(*itr)->varstack[i-1];
                        if(dot==cellname.end() && elem->forevery_nonra) //a non-record forevery can never match a name with dots..
                        {
                                //Get the last dot in the name
                                std::string::const_iterator lastdot = std::find(elem->forevery_nonra->content.rbegin(), elem->forevery_nonra->content.rend(),'.').base();

                                if(Blex::StrCaseCompare(lastdot, elem->forevery_nonra->content.end(),cellname.begin(), cellname.end()) == 0)
                                {
                                      colvar = elem->var;
                                }
                        }
                        else
                        {
                                colvar = HSVM_RecordGetRef(hsvm, elem->var, colid);
                        }
                }

                if (colvar == 0) //no match
                {
                        if((*itr)->newwitty)
                            break; //give up, we may not access a different RunWitty context
                        continue; //keep trying
                }

                //Iteratively find any subcell names
                while (colvar != 0 && dot != cellname.end())
                {
                        std::string::const_iterator namestart = dot+1;

                        if (HSVM_GetType(hsvm, colvar) != HSVM_VAR_Record)
                                return 0;

                        //Look up the next cell
                        dot = std::find(namestart, cellname.end(), '.');
                        colid = HSVM_GetColumnIdRange(hsvm, &*namestart, &*dot);
                        colvar = HSVM_RecordGetRef(hsvm, colvar, colid);
                }
                return colvar;
        }
        return 0;
}

void WittyExecutionState::PrintEncoded(Blex::StringPair data,ContentEncoding encoding)
{
        if (encoding==CE_None)
        {
                HSVM_Print(hsvm, data.size(), data.begin);
        }
        else
        {
                //FIXME: Use a scratchpad to cut down on allocation costs
                scratchpad.clear();
                scratchpad.reserve(data.size());
                switch(encoding)
                {
                case CE_Base16:
                        Blex::EncodeBase16(data.begin, data.end, std::back_inserter(scratchpad));
                        break;
                case CE_Base64:
                        Blex::EncodeBase64(data.begin, data.end, std::back_inserter(scratchpad));
                        break;
                case CE_Url:
                        Blex::EncodeUrl(data.begin, data.end, std::back_inserter(scratchpad));
                        break;
                case CE_Html:
                        Blex::EncodeHtml(data.begin, data.end, std::back_inserter(scratchpad));
                        break;
                case CE_Value:
                        Blex::EncodeValue(data.begin, data.end, std::back_inserter(scratchpad));
                        break;
                case CE_Java:
                        Blex::EncodeJava(data.begin, data.end, std::back_inserter(scratchpad));
                        break;
                case CE_CData:
                        {
                                const char cdata_start[] = "<![CDATA[";
                                const char cdata_end[] = "]]>";
                                const char *it = data.begin;
                                while (it != data.end)
                                {
                                        scratchpad.insert(scratchpad.end(), cdata_start, cdata_start + sizeof cdata_start - 1);
                                        const char *esc = std::search(it, data.end, cdata_end, cdata_end + sizeof cdata_end - 1);
                                        if (esc != data.end)
                                           esc += 2;
                                        scratchpad.insert(scratchpad.end(), it, esc);
                                        scratchpad.insert(scratchpad.end(), cdata_end, cdata_end + 3);
                                        it = esc;
                                }
                        } break;
                default:
                        break;
                }
                HSVM_Print(hsvm, scratchpad.size(), &scratchpad[0]);
        }
}

void WittyExecutionState::Clear()
{
        for (auto it = stack.rbegin(); it != stack.rend(); ++it)
        {
                if (it->has_variable)
                {
                        if (it->var_is_alloced)
                            HSVM_DeallocateVariable(hsvm, varstack.back().var);
                        varstack.pop_back();
                }
        }
        stack.clear();
}

void ParsedPart::GetWittyData(HSVM_VariableId store, WittyExecutionState *wes, HSVM_VariableId var) const
{
        HSVM *hsvm=wes->hsvm;
        switch(datatype)
        {
/*        case DT_Seqnr:
                {
                        StackElement &elt = wes->stack.back();
                        StackElement *forevery = FindForeveryInStack(wes);
                        if(!forevery)
                                throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"seqnr");

                        signed forevery_elt_nr = forevery->forevery_elt_nr;

                        char buf[32];
                        char *endptr = Blex::EncodeNumber<int32_t>(forevery_elt_nr, 10, buf);
                        HSVM_StringSet(hsvm, store, buf, endptr);
                }
                return;*/
        case DT_Cell:
                switch(HSVM_GetType(hsvm,var))
                {
                case HSVM_VAR_Integer:
                        {
                                char buf[32];
                                char *endptr = Blex::EncodeNumber<int32_t>(HSVM_IntegerGet(hsvm,var), 10, buf);
                                HSVM_StringSet(hsvm, store, buf, endptr);
                        }
                        return;
                case HSVM_VAR_String:
                        {
                                HSVM_CopyFrom(hsvm, store, var);
                                return;
                        }
                default:
                        throw Error(linenum, columnnum, 18, content, GetTypeName(static_cast< HareScript::VariableTypes::Type >(HSVM_GetType(hsvm,var))));
                }
        default:
                throw std::runtime_error("Unexpected datatype in gettid statement");
        }
}

void WittyExecutionState::SM_Init(HSVM_VariableId var)
{
        HSVM_ColumnId colgettid = HSVM_GetColumnId(hsvm, "GETTID");
        HSVM_ColumnId colgethtmltid = HSVM_GetColumnId(hsvm, "GETHTMLTID");

        gettidfunc = HSVM_RecordGetRef(hsvm, var, colgettid);
        if(!gettidfunc || (HSVM_GetType(hsvm, gettidfunc) != HSVM_VAR_FunctionPtr || !HSVM_FunctionPtrExists(hsvm, gettidfunc)))
           gettidfunc = 0;

        gethtmltidfunc = HSVM_RecordGetRef(hsvm, var, colgethtmltid);
        if(!gethtmltidfunc || (HSVM_GetType(hsvm, gethtmltidfunc) != HSVM_VAR_FunctionPtr || !HSVM_FunctionPtrExists(hsvm, gethtmltidfunc)))
           gethtmltidfunc = 0;
}

void ReturnHSResult(HSVM *hsvm, Error const *error)
{
        HSVM_OpenFunctionCall(hsvm, 1);
        HSVM_SetDefault(hsvm, HSVM_CallParam(hsvm, 0), HSVM_VAR_Record);
        ErrorToRecord(hsvm, *error, HSVM_CallParam(hsvm, 0));

        static HSVM_VariableType args[1] = { HSVM_VAR_Record };
        HSVM_CallFunction(hsvm, "wh::witty.whlib", "__WITTY_ERRORCALLBACK", 0, 1, args);
        HSVM_CloseFunctionCall(hsvm);
}

// -----------------------------------------------------------------------------
//
// New state machine
//

void ParsedFile::SM_Push(WittyExecutionState *wes, bool new_invocation, ParsedFile::PartItr itr, ParsedFile::PartItr limit, HSVM_VariableId var, bool root_invocation, ParsedPart const *forevery_nonra)
{
        StackElement elt;
        elt.iv_depth = wes->stack.empty() ? 1 : wes->stack.back().iv_depth + (new_invocation ? 1 : 0);
        elt.itr = itr;
        elt.limit = limit;
        elt.has_variable = var != 0 && (HSVM_GetType(wes->hsvm, var) == HSVM_VAR_Record || forevery_nonra);

        if (elt.has_variable && root_invocation)
        {
                HSVM_VariableId copy = HSVM_AllocateVariable(wes->hsvm);
                HSVM_CopyFrom(wes->hsvm, copy, var);
                var = copy;
                elt.var_is_alloced = true;
        }
        if (elt.has_variable)
                wes->varstack.push_back(VarStackElement(forevery_nonra, var));

        elt.must_return = root_invocation;
        wes->stack.push_back(elt);
}

void ParsedFile::SM_PushComponent(unsigned linenum, unsigned columnnum, WittyExecutionState *wes, bool new_invocation, std::string const &componentname)
{
        Components::const_iterator component = start_positions.find(componentname);
        if (component == start_positions.end())
            throw Error(linenum, columnnum, 20, componentname);
        SM_Push(wes, new_invocation, parts.begin()+component->second, parts.begin()+parts[component->second-1].cmd_limit, 0, false, NULL);
}


bool ParsedFile::SM_EvaluateIf(HSVM *hsvm, WittyExecutionState *wes, HSVM_VariableId varid) const
{
        StackElement &elt = wes->stack.back();
        if(elt.itr->datatype == DT_Cell)
        {
                HSVM_VariableType vartype = HSVM_GetType(hsvm,varid);
                switch(vartype)
                {
                case HSVM_VAR_Boolean:
                        return HSVM_BooleanGet(hsvm, varid);
                case HSVM_VAR_Integer:
                        return HSVM_IntegerGet(hsvm, varid);
                case HSVM_VAR_String:
                        {
                                Blex::StringPair str;
                                HSVM_StringGet(hsvm, varid, &str.begin, &str.end);
                                return str.begin != str.end;
                        }
                case HSVM_VAR_FunctionPtr:
                        return HSVM_FunctionPtrExists(hsvm, varid);
                case HSVM_VAR_Record:
                        return HSVM_RecordExists(hsvm, varid);
                default:
                        if (vartype & HSVM_VAR_Array)
                        {
                                return HSVM_ArrayLength(hsvm,varid)>0;
                        }
                        else
                        {
                                throw Error(elt.itr->linenum, elt.itr->columnnum, 19, elt.itr->content, GetTypeName(static_cast< HareScript::VariableTypes::Type >(vartype)));
                        }
                }
        }
        else
        {
                StackElement *forevery = FindForeveryInStack(wes);
//                vartype = HSVM_VAR_Boolean;
                switch(elt.itr->datatype)
                {
                case DT_First:
                        if (!forevery)
                            throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"first");
                        return forevery->forevery_elt_nr == 0;
                case DT_Last:
                        if (!forevery)
                            throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"last");
                        return forevery->forevery_elt_nr == forevery->forevery_elt_limit - 1;
                case DT_Odd:
                        if (!forevery)
                            throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"odd");
                        return (forevery->forevery_elt_nr % 2) == 1;
                case DT_Even:
                        if (!forevery)
                            throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"even");
                        return (forevery->forevery_elt_nr % 2) == 0;
                case DT_Seqnr:
                        if (!forevery)
                            throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"seqnr");
                        return forevery->forevery_elt_nr != 0; //mimick the integer!=0 evaluation
                default:
                        throw std::runtime_error("Unknown datatype for IF statement");
                }
        //        return false;
        }
}

struct SM_CallFinishGetTidCall : public SM_Continuation
{
        ParsedFile *pf;
        WittyExecutionState *wes;
        HSVM_VariableId retval;

        SM_CallFinishGetTidCall(ParsedFile *pf, WittyExecutionState *wes, HSVM_VariableId retval);
        virtual bool Execute();
};

SM_CallFinishGetTidCall::SM_CallFinishGetTidCall(ParsedFile *pf, WittyExecutionState *wes, HSVM_VariableId retval)
: pf(pf)
, wes(wes)
, retval(retval)
{}

bool SM_CallFinishGetTidCall::Execute()
{
        return pf->SM_FinishGetTidCall(wes, retval);
}


bool ParsedFile::SM_FinishGetTidCall(WittyExecutionState *wes, HSVM_VariableId retval)
{
        HSVM *hsvm=wes->hsvm;
        StackElement &elt = wes->stack.back();
        if(!retval)
            return false;
        if (HSVM_GetType(hsvm, retval) != HSVM_VAR_String)
            throw std::runtime_error("GETTID incorrect return type");

        Blex::StringPair str;
        HSVM_StringGet(hsvm, retval, &str.begin, &str.end);
        if(str.begin!=str.end)
            wes->PrintEncoded(str, elt.itr->encoding);

        HSVM_CloseFunctionCall(hsvm);
        ++wes->stack.back().itr;

        return true;
}

std::pair< bool/*finished*/, bool/*success*/ > ParsedFile::SM_Run(WittyExecutionState *wes, std::function< void(bool) > const &reschedule)
{
        if (wes->stack.empty())
            throw std::runtime_error("Running on empty witty stack!");

        if (wes->stack.back().continuation != 0)
        {
                if (!wes->stack.back().continuation->Execute())
                    return std::make_pair(true, false); // Direct exit SM_Run, we won't continue on error

                wes->stack.back().continuation.reset();
        }

        HSVM *hsvm=wes->hsvm;

        while (!wes->stack.empty())
        {
                StackElement &elt = wes->stack.back();
                if (elt.itr == elt.limit)
                {
                        if (elt.has_variable)
                        {
                                if (elt.var_is_alloced)
                                    HSVM_DeallocateVariable(hsvm, wes->varstack.back().var);
                                wes->varstack.pop_back();
                        }
                        bool must_return = wes->stack.back().must_return;
                        wes->stack.pop_back();
                        if (must_return)
                            return std::make_pair(true, true);
                        continue;
                }

                HSVM_VariableId varid = 0;
                bool ishtml = false;
                if (elt.itr->type != ParsedPart::Content && elt.itr->type != ParsedPart::Component && elt.itr->type != ParsedPart::Embed && elt.itr->type != ParsedPart::GetTid && elt.itr->type != ParsedPart::GetHtmlTid && elt.itr->datatype == DT_Cell)
                {
                        varid = FindCellInStack(wes, elt.itr->content);
                        if (!varid)
                            throw Error(elt.itr->linenum, elt.itr->columnnum, 15, elt.itr->content);
                }

                switch(elt.itr->type)
                {
                case ParsedPart::Content:
                        if (elt.itr->content_len)
                            HSVM_Print(hsvm, elt.itr->content_len, &printdata[elt.itr->content_pos]);
                        ++elt.itr;
                        break;
                case ParsedPart::Data:
                        {
                                std::pair< bool, bool > res = elt.itr->SM_PrintCell(wes, elt, varid, reschedule);
                                if (res.first != true || res.second != true)
                                     return res;
                                ++elt.itr;
                        } break;
                case ParsedPart::If:
                case ParsedPart::ElseIf:
                        if (SM_EvaluateIf(hsvm, wes, varid) ^ elt.itr->ifnot)
                        {
                                HSVM_VariableId recid = varid && HSVM_GetType(hsvm,varid) == HSVM_VAR_Record && !elt.itr->ifnot ? varid : 0;
                                SM_Push(wes, false, elt.itr+1, parts.begin()+elt.itr->cmd_limit, recid, false, NULL);
                        }
                        else
                        {
                                SM_Push(wes, false, parts.begin()+elt.itr->cmd_limit, parts.begin()+elt.itr->else_limit, 0, false, NULL);
                        }
                        elt.itr = parts.begin()+elt.itr->else_limit;
                        break;
                case ParsedPart::Component: //just skip it
                        elt.itr = parts.begin()+elt.itr->cmd_limit;
                        break;
                case ParsedPart::Embed: //just skip it
                        /* ADDME: Guard against stack overflow! (still needed with HS callbacks?) */
                        {
                                std::pair<bool, bool> res = elt.itr->SM_Embed(wes, elt, reschedule);
                                if (res.first != true || res.second != true)
                                     return res;
                                ++elt.itr;
                        }
                        break;

                case ParsedPart::GetHtmlTid:
                        ishtml=true;
                        //fallthrough

                case ParsedPart::GetTid:
                        /* ADDME: Guard against stack overflow! */
                        {
                                HSVM_VariableId gettidfunc = FindGetTidInStack(wes, ishtml);
                                if (gettidfunc==0)
                                     throw std::runtime_error(ishtml ? "No GETHTMLTID function provided" : "No GETTID function provided");

                                HSVM_OpenFunctionCall(hsvm, elt.itr->parameters.size());

                                HSVM_StringSetSTD(hsvm, HSVM_CallParam(hsvm, 0), elt.itr->parameters[0]);

                                unsigned paramnr = 0;
                                for (std::vector< std::string >::const_iterator it = elt.itr->parameters.begin() + 1; it != elt.itr->parameters.end(); ++it)
                                {
                                        HSVM_VariableId dataid = FindCellInStack(wes, *it);
                                        if (!dataid)
                                        {
                                                HSVM_CancelFunctionCall(hsvm);
                                                throw Error(elt.itr->linenum, elt.itr->columnnum, 15, *it);
                                        }

                                        elt.itr->GetWittyData(HSVM_CallParam(hsvm, ++paramnr), wes, dataid);
                                }

                                HSVM_ScheduleCallback_cpp(hsvm, reschedule);

                                HSVM_VariableId retval = HSVM_ScheduleFunctionPtrCall(hsvm, gettidfunc, false);
                                elt.continuation.reset(new SM_CallFinishGetTidCall(this, wes, retval));

                                return std::make_pair(false, true);
                        }

                case ParsedPart::Forevery:
                        if (!(HSVM_GetType(hsvm, varid) & HSVM_VAR_Array))
                        {
                                throw Error(elt.itr->linenum, elt.itr->columnnum, 16, elt.itr->content);
                        }
                        else
                        {
                                if (elt.forevery_elt_limit == -1)
                                {
                                        elt.forevery_elt_limit = HSVM_ArrayLength(hsvm,varid);
                                        elt.forevery_elt_nr = 0;
                                }
                                else
                                    ++elt.forevery_elt_nr;

                                if (elt.forevery_elt_nr == elt.forevery_elt_limit)
                                {
                                        elt.itr = parts.begin()+elt.itr->cmd_limit;
                                        elt.forevery_elt_nr = -1;
                                        elt.forevery_elt_limit = -1;
                                }
                                else
                                {
                                        HSVM_VariableId rec = HSVM_ArrayGetRef(hsvm, varid, elt.forevery_elt_nr);
                                        SM_Push(wes, false, elt.itr+1, parts.begin()+elt.itr->cmd_limit, rec, false, HSVM_GetType(hsvm,varid)==HSVM_VAR_RecordArray ? NULL : &*elt.itr);
                                }
                        }
                        break;

                case ParsedPart::Repeat:
                        if (HSVM_GetType(hsvm, varid) != HSVM_VAR_Integer)
                        {
                                throw Error(elt.itr->linenum, elt.itr->columnnum, 23, elt.itr->content);
                        }
                        else
                        {
                                if (elt.forevery_elt_limit == -1)
                                {
                                        elt.forevery_elt_limit = HSVM_IntegerGet(hsvm,varid);
                                        elt.forevery_elt_nr = 0;
                                }
                                else
                                    ++elt.forevery_elt_nr;

                                if (elt.forevery_elt_nr == elt.forevery_elt_limit)
                                {
                                        elt.itr = parts.begin()+elt.itr->cmd_limit;
                                        elt.forevery_elt_nr = -1;
                                        elt.forevery_elt_limit = -1;
                                }
                                else
                                {
                                        SM_Push(wes, false, elt.itr+1, parts.begin()+elt.itr->cmd_limit, 0, false, NULL);
                                }
                        }
                        break;
                default:
                        throw std::runtime_error("Unknown WTE bytecode");
                }
        }
        return std::make_pair(true, true);
}

struct SM_CallFinishPrintCellCall : public SM_Continuation
{
        ParsedPart const *pp;
        WittyExecutionState *wes;

        SM_CallFinishPrintCellCall(ParsedPart const *pp, WittyExecutionState *wes);
        virtual bool Execute();
};

SM_CallFinishPrintCellCall::SM_CallFinishPrintCellCall(ParsedPart const *pp, WittyExecutionState *wes)
: pp(pp)
, wes(wes)
{}

bool SM_CallFinishPrintCellCall::Execute()
{
        return pp->SM_FinishPrintCellCall(wes);
}

bool ParsedPart::SM_FinishPrintCellCall(WittyExecutionState *wes) const
{
        HSVM *hsvm=wes->hsvm;
        HSVM_CloseFunctionCall(hsvm);
        ++wes->stack.back().itr;
        return true;
}

std::pair< bool/*finished*/, bool/*success*/ > ParsedPart::SM_PrintCell(WittyExecutionState *wes, StackElement &elt, HSVM_VariableId var, std::function< void(bool) > const &reschedule) const
{
        HSVM *hsvm=wes->hsvm;
        switch(datatype)
        {
        case DT_Seqnr:
                {
                        StackElement &elt = wes->stack.back();
                        StackElement *forevery = FindForeveryInStack(wes);
                        if(!forevery)
                                throw Error(elt.itr->linenum, elt.itr->columnnum, 17,"seqnr");

                        signed elt_nr = forevery->forevery_elt_nr;

                        char buf[32];
                        char *endptr = Blex::EncodeNumber<int32_t>(elt_nr, 10, buf);
                        HSVM_Print(hsvm, endptr-buf, buf);
                        return std::make_pair(true, true);
                }
        case DT_Cell:
                if (encoding==CE_Json || encoding==CE_JsonValue)
                {
                        HSVM_VariableId temp = HSVM_AllocateVariable(hsvm);
                        HareScript::JHSONEncode(hsvm, var, temp, false);
                        if(!HSVM_IsUnwinding(hsvm)) //check if JHSONEncode failed
                        {
                                Blex::StringPair data;
                                HSVM_StringGet(hsvm, temp, &data.begin, &data.end);

                                if(encoding==CE_Json)
                                        wes->PrintEncoded(data, CE_None);
                                else
                                        wes->PrintEncoded(data, CE_Value);
                        }
                        HSVM_DeallocateVariable(hsvm, temp);
                        return std::make_pair(true, true);
                }

                switch(HSVM_GetType(hsvm,var))
                {
                case HSVM_VAR_Integer:
                        {
                                char buf[32];
                                char *endptr = Blex::EncodeNumber<int32_t>(HSVM_IntegerGet(hsvm,var), 10, buf);
                                HSVM_Print(hsvm, endptr-buf, buf);
                                return std::make_pair(true, true);
                        }
                case HSVM_VAR_String:
                        {
                                Blex::StringPair data;
                                HSVM_StringGet(hsvm, var, &data.begin, &data.end);
                                wes->PrintEncoded(data, encoding);
                                return std::make_pair(true, true);
                        }
                case HSVM_VAR_FunctionPtr:
                        if (HSVM_FunctionPtrExists(hsvm, var))
                        {
                                HSVM_OpenFunctionCall(hsvm, 0);

                                HSVM_ScheduleCallback_cpp(hsvm, reschedule);

                                HSVM_VariableId retval = HSVM_ScheduleFunctionPtrCall(hsvm, var, true);
                                elt.continuation.reset(new SM_CallFinishPrintCellCall(this, wes));

                                return std::make_pair(false, retval != 0);
                        }
                        return std::make_pair(true, true);
                default:
                        throw Error(linenum, columnnum, 18, content, GetTypeName(static_cast< HareScript::VariableTypes::Type >(HSVM_GetType(hsvm,var))));
                }
        default:
                throw std::runtime_error("Unexpected datatype in data print statement");
        }
//        return std::make_pair(true, true); //continue
}

bool ParsedFile::SM_ScheduleRunComponent(unsigned linenum, unsigned columnnum, WittyExecutionState *wes, std::string const &componentname, HSVM_VariableId var)
{
        Components::const_iterator component = start_positions.find(componentname);
        if (component == start_positions.end())
            throw Error(linenum, columnnum, 20, componentname);
        SM_Push(wes, true, parts.begin()+component->second, parts.begin()+parts[component->second-1].cmd_limit, var, true, NULL);
        return true;
}

std::pair< bool/*finished*/, bool/*success*/ > ParsedPart::SM_Embed(WittyExecutionState *wes, StackElement &elt, std::function< void(bool) > const &reschedule) const
{
        HSVM *hsvm=wes->hsvm;

        HSVM_OpenFunctionCall(hsvm, 2);
        HSVM_StringSetSTD(hsvm, HSVM_CallParam(hsvm, 0), content);
        HSVM_SetDefault(hsvm, HSVM_CallParam(hsvm, 1), HSVM_VAR_Record);
        HSVM_ScheduleCallback_cpp(hsvm, reschedule);

        HSVM_VariableId callbackid = HSVM_AllocateVariable(hsvm);

        static HSVM_VariableType args[2] = { HSVM_VAR_String, HSVM_VAR_Record };

        int fptr_result = HSVM_MakeFunctionPtr(
            hsvm,
            callbackid,
            "wh::witty.whlib",
            "EMBEDWITTYCOMPONENT",
            0,
            2,
            args,
            0);
        if (fptr_result <= 0)
        {
                HSVM_DeallocateVariable(hsvm, callbackid);
                if (fptr_result == -1)
                    HSVM_ReportCustomError(hsvm, "Cannot load EMBEDWITTYCOMPONENT");
                return std::make_pair(true, false); // error out immediately
        }

        elt.continuation.reset(new SM_CallFinishPrintCellCall(this, wes));

        HSVM_VariableId retval = HSVM_ScheduleFunctionPtrCall(hsvm, callbackid, true);
        HSVM_DeallocateVariable(hsvm, callbackid);

        return std::make_pair(false, retval != 0);
//        SM_PushComponent(elt.itr->linenum, elt.itr->columnnum, wes, false, elt.itr->content);
}

// -----------------------------------------------------------------------------
//
// Harescript access functions
//

void RunContinue(HSVM *hsvm, ParsedFile *parsedfile, bool is_unwinding)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));

        if (context.sm_witties.empty())
        {
                HSVM_ReportCustomError(hsvm, "Witty is still running, but no witties left to execute!");
                return;
        }

        if (is_unwinding)
        {
                WittyExecutionState *wes = context.sm_witties.back().get();
                while (!wes->stack.empty())
                {
                        StackElement &elt = wes->stack.back();
                        if (elt.has_variable)
                        {
                                if (elt.var_is_alloced)
                                    HSVM_DeallocateVariable(hsvm, wes->varstack.back().var);
                                wes->varstack.pop_back();
                        }
                        bool must_return = wes->stack.back().must_return;
                        wes->stack.pop_back();
                        if (must_return)
                            break;
                }
                return;
        }

        WTE_PRINT("Runcontinue is_unwinding:" << (is_unwinding?"Y":"N") << " " << context.sm_witties.size() << ":" << context.sm_witties.back()->stack.size());
        try
        {
                std::pair< bool, bool > retval = parsedfile->SM_Run(context.sm_witties.back().get(), std::bind(&RunContinue, hsvm, parsedfile, std::placeholders::_1));

                WTE_PRINT("Runcontinue finish " << retval.first << ":" << retval.second << " " << context.sm_witties.size() << ":" << context.sm_witties.back()->stack.size());

                // Still running, or HS error thrown?
                if (!retval.first || !retval.second)
                    return;

                if (context.sm_witties.back()->stack.empty())
                    context.sm_witties.pop_back();
        }
        catch(Error &e)
        {
                WTE_PRINT("Runcontinue error " << context.sm_witties.size() << ":" << context.sm_witties.back()->stack.size());

                // Clean up the stack
                bool must_pop_more = true;
                while (must_pop_more)
                {
                        must_pop_more = !context.sm_witties.back()->stack.back().must_return;
                        if (context.sm_witties.back()->stack.back().has_variable)
                        {
                                if (context.sm_witties.back()->stack.back().var_is_alloced)
                                    HSVM_DeallocateVariable(hsvm, context.sm_witties.back()->varstack.back().var);
                                context.sm_witties.back()->varstack.pop_back();
                        }
                        context.sm_witties.back()->stack.pop_back();
                }
                if (context.sm_witties.back()->stack.empty())
                    context.sm_witties.pop_back();

                WTE_PRINT("Runcontinue after error clean " << context.sm_witties.size() << ":" << (context.sm_witties.size() ? context.sm_witties.back()->stack.size() : -1));
                ReturnHSResult(hsvm, &e);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

void SetWittyGettidFallback(HSVM *hsvm)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        if(context.globalgettid == 0)
            context.globalgettid = HSVM_AllocateVariable(hsvm);
        if(context.globalgethtmltid == 0)
            context.globalgethtmltid = HSVM_AllocateVariable(hsvm);

        HSVM_CopyFrom(hsvm, context.globalgettid, HSVM_Arg(0));
        HSVM_CopyFrom(hsvm, context.globalgethtmltid, HSVM_Arg(1));
}

void ExecuteComponent(HSVM *hsvm)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        int32_t parsedid = HSVM_IntegerGet(hsvm,HSVM_Arg(0));
        if (parsedid<1 || (unsigned)parsedid>context.parsedfiles.size() || context.parsedfiles[parsedid-1].get()==NULL)
        {
                HSVM_ReportCustomError(hsvm, "Invalid Witty handle");
                return;
        }

        std::string component = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        bool newwitty = HSVM_BooleanGet(hsvm, HSVM_Arg(3));

        WTE_PRINT("Executecomponent " << parsedid << " " << component << " new:" << newwitty);

        Blex::ToUppercase(component.begin(), component.end());

        ParsedFile &parsedfile = *context.parsedfiles[parsedid-1];
        std::deque<ParsedPart>::const_iterator itr = parsedfile.parts.begin(), end = parsedfile.parts.end();

        std::shared_ptr< WittyExecutionState > wes;
        wes.reset(new WittyExecutionState(parsedfile, hsvm, parsedid, newwitty));
        wes->SM_Init(HSVM_Arg(2));

        context.sm_witties.push_back(wes);

        try
        {
                if(component.empty())
                {
                        parsedfile.SM_Push(wes.get(), true, itr, end, HSVM_Arg(2), true, NULL);
                }
                else
                {
                        parsedfile.SM_ScheduleRunComponent(itr->linenum, itr->columnnum, wes.get(), component, HSVM_Arg(2));
                }
        }
        catch (Error &e)
        {
                context.sm_witties.back()->Clear();
                context.sm_witties.pop_back();
                ReturnHSResult(hsvm, &e);
                return;
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
                return;
        }

        try
        {
                RunContinue(hsvm, &parsedfile, false);
        }
        catch(Error &e)
        {
                ReturnHSResult(hsvm, &e);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

void HasWittyComponent(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        int32_t parsedid = HSVM_IntegerGet(hsvm,HSVM_Arg(0));
        if (parsedid<1 || (unsigned)parsedid>context.parsedfiles.size() || context.parsedfiles[parsedid-1].get()==NULL)
        {
                HSVM_ReportCustomError(hsvm, "Invalid Witty handle");
                return;
        }
        std::string componentname = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));

        ParsedFile &parsedfile = *context.parsedfiles[parsedid-1];
        ParsedFile::Components::const_iterator component = parsedfile.start_positions.find(componentname);
        HSVM_BooleanSet(hsvm, id_set, component != parsedfile.start_positions.end());

}

void GetWittyVariable(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        if (context.sm_witties.empty())
        {
                HSVM_ReportCustomError(hsvm, "Not inside a Witty execution");
                return;
        }
        std::string cellname = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));
        HSVM_VariableId varid = FindCellInStack(context.sm_witties.back().get(), cellname);
        if (varid)
            HSVM_CopyFrom(hsvm, id_set, varid);
        else
            HSVM_ReportCustomError(hsvm, ("No such cell " + cellname).c_str());
}

namespace
{

struct CallIntoVars
{
        HSVM_VariableId id_set;
        HSVM_VariableId func_result;
};

}//End of anonymous namespace

void FinishAfterCallWithWittyContext(HSVM *hsvm, std::shared_ptr< CallIntoVars > const &vars, unsigned sm_witties_count, bool is_unwinding)
{
        // Remove witty context
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        while (context.sm_witties.size() > sm_witties_count)
        {
                context.sm_witties.back()->Clear();
                context.sm_witties.pop_back();
        }

        if (is_unwinding)
            return;

        HSVM_CopyFrom(hsvm, vars->id_set, vars->func_result);
        HSVM_CloseFunctionCall(hsvm);
}

void CallWithWittyContext(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        int32_t parsedid = HSVM_IntegerGet(hsvm,HSVM_Arg(0));
        if (parsedid<1 || (unsigned)parsedid>context.parsedfiles.size() || context.parsedfiles[parsedid-1].get()==NULL)
        {
                HSVM_ReportCustomError(hsvm, "Invalid Witty handle");
                return;
        }

        //std::string component = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        bool newwitty = false;

        WTE_PRINT("CallWithWittyContext " << parsedid << " new:" << newwitty);

//        Blex::ToUppercase(component.begin(), component.end());

        ParsedFile &parsedfile = *context.parsedfiles[parsedid-1];
        std::deque<ParsedPart>::const_iterator itr = parsedfile.parts.begin();

        std::shared_ptr< WittyExecutionState > wes;
        wes.reset(new WittyExecutionState(parsedfile, hsvm, parsedid, newwitty));
        wes->SM_Init(HSVM_Arg(2));

        unsigned sm_witties_count = context.sm_witties.size();
        context.sm_witties.push_back(wes);

        try
        {
                // Push a dummy part with the context
                parsedfile.SM_Push(wes.get(), true, itr, itr, HSVM_Arg(2), true, NULL);
        }
        catch (Error &e)
        {
                while (context.sm_witties.size() > sm_witties_count)
                {
                        context.sm_witties.back()->Clear();
                        context.sm_witties.pop_back();
                }

                ReturnHSResult(hsvm, &e);
                return;
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
                return;
        }

        std::shared_ptr< CallIntoVars > vars(new CallIntoVars);
        vars->id_set = id_set;

        HSVM_OpenFunctionCall(hsvm, 0);

        HSVM_ScheduleCallback_cpp(hsvm, std::bind(&FinishAfterCallWithWittyContext, hsvm, vars, sm_witties_count, std::placeholders::_1));
        vars->func_result = HSVM_ScheduleFunctionPtrCall(hsvm, HSVM_Arg(1), true);
}

void GetWittyTidRawData(HSVM *hsvm, HSVM_VariableId id_set)
{
        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId, true));
        int32_t parsedid = HSVM_IntegerGet(hsvm,HSVM_Arg(0));
        if (parsedid<1 || (unsigned)parsedid>context.parsedfiles.size() || context.parsedfiles[parsedid-1].get()==NULL)
        {
                HSVM_ReportCustomError(hsvm, "Invalid Witty handle");
                return;
        }

        ParsedFile const &parsedfile = *context.parsedfiles[parsedid-1];


        HSVM_ColumnId col_col = HSVM_GetColumnId(hsvm, "COL");
        HSVM_ColumnId col_line = HSVM_GetColumnId(hsvm, "LINE");
        HSVM_ColumnId col_data = HSVM_GetColumnId(hsvm, "DATA");
        HSVM_ColumnId col_type = HSVM_GetColumnId(hsvm, "TYPE");

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        for (auto &itr: parsedfile.parts)
        {
                bool ishtmltid = itr.type == ParsedPart::GetHtmlTid;
                bool istid = ishtmltid || itr.type == ParsedPart::GetTid;
                bool isembed = itr.type == ParsedPart::Embed;
                bool iscomponent = itr.type == ParsedPart::Component;
                bool iscontent = itr.type == ParsedPart::Content && itr.content_len > 0;

                if(!istid && !isembed && !iscomponent && !iscontent)
                    continue;

                HSVM_VariableId rec = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, rec, col_line), itr.linenum);
                HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, rec, col_col), itr.columnnum);

                if (istid)
                {
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, rec, col_type), ishtmltid ? "htmltid" : "tid");
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, rec, col_data), itr.parameters[0]);
                }
                else if(iscontent)
                {
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, rec, col_type), "content");

                        Blex::StringPair content = Blex::StringPair(&parsedfile.printdata[itr.content_pos], &parsedfile.printdata[itr.content_pos] + itr.content_len);
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, rec, col_data), content.stl_stringview());
                }
                else
                {
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, rec, col_type), isembed ? "embed" : "component");
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, rec, col_data), itr.content);
                }
        }
}


} // End of namespace Wte
} // End of namespace HareScript

//---------------------------------------------------------------------------

extern "C" {

static void* CreateContext(void *)
{
        return new HareScript::Witty::Context;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::Witty::Context*>(context_ptr);
}

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterContext (regdata, HareScript::Witty::ContextId, NULL, &CreateContext, &DestroyContext);

        //HSVM_RegisterFunction(regdata, "PARSEWTEDATAFILE:WH_XML:I:X", HareScript::Wte::ParseWTEDataFile);
        HSVM_RegisterFunction(regdata, "__PARSEWITTY:WH_WITTY:I:SSS", HareScript::Witty::Parse);
        HSVM_RegisterFunction(regdata, "__PARSEWITTYBLOB:WH_WITTY:I:XSS", HareScript::Witty::ParseBlob);
        HSVM_RegisterFunction(regdata, "__GETWITTYPARSEERRORS:WH_WITTY:RA:", HareScript::Witty::GetWittyParseErrors);
        HSVM_RegisterFunction(regdata, "__HASWITTYCOMPONENT:WH_WITTY:B:IS", HareScript::Witty::HasWittyComponent);
        HSVM_RegisterFunction(regdata, "GETWITTYLIBRARYBLOB:WH_WITTY:R:S", HareScript::Witty::GetWittyLibraryBlob);
        HSVM_RegisterFunction(regdata, "GETWITTYVARIABLE:WH_WITTY:V:S", HareScript::Witty::GetWittyVariable);
        HSVM_RegisterFunction(regdata, "__CALLWITHWITTYCONTEXT:WH_WITTY:V:IPR", HareScript::Witty::CallWithWittyContext);
        HSVM_RegisterFunction(regdata, "__GETWITTYTIDSRAWDATA:WH_WITTY:RA:I", HareScript::Witty::GetWittyTidRawData);

        HSVM_RegisterMacro(regdata, "__RUNWITTYCOMPONENT:WH_WITTY::ISRB", HareScript::Witty::ExecuteComponent);
        HSVM_RegisterMacro(regdata, "__SETWITTYGETTIDFALLBACK:WH_WITTY::PP", HareScript::Witty::SetWittyGettidFallback);
        return 1;
}

} //end extern "C"
