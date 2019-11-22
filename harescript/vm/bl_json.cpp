#include <harescript/vm/allincludes.h>

#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hs_lexer.h>
#include <harescript/vm/hsvm_context.h>

#include <cmath>

namespace HareScript
{

class JSONParser
{
    public:
        enum TokenState
        {
                TS_Initial, // Allow BOM
                TS_Default,
                TS_LongToken,
                TS_QString,
                TS_QStringEsc,
                TS_DQString,
                TS_DQStringEsc,
                TS_NumberPrefix,
                TS_Number,
                TS_Error
        };

        enum TokenType
        {
                JTT_SpecialToken,
                JTT_Token,
                JTT_String,
                JTT_Number
        };

        enum ParseState
        {
                PS_RootValue,
                PS_ObjectWantName,
                PS_ObjectWantColon,
                PS_ObjectWantValue,
                PS_ObjectWantComma,
                PS_ArrayWantValue,
                PS_ArrayWantComma,
                PS_Finished,
                PS_Error,

                PS_HSONStart,
                PS_HSONStartColon,
                PS_HSONWantArray,
                PS_HSONWantTypedValue
        };

    private:
        struct Level
        {
                Level(HSVM_VariableId _var, ParseState _restorestate) : var(_var), lastarrayelt(0), restorestate(_restorestate), arrayelttype(0) {}
                HSVM_VariableId var;
                HSVM_VariableId lastarrayelt;
                ParseState restorestate;
                HSVM_VariableType arrayelttype;
        };

        HSVM *vm;

        /// Tokenizer state
        TokenState state;

        /// Current token
        std::string currenttoken;

        Blex::UTF8DecodeMachine decoder;
        Blex::UTF8Encoder< std::back_insert_iterator< std::string > > encoder;

        /// Current parse state
        ParseState parsestate;

        /// State before hson type specifier
        ParseState hsonrestorestate;
        std::string lastname;
        HSVM_VariableType lasttype;

        HSVM_VariableId root;
        std::vector< Level > levels;

        typedef std::map< std::string, HSVM_ColumnId > Translations;
        Translations translations;

        unsigned line;
        unsigned column;

        unsigned errorline;
        unsigned errorcolumn;

        std::string errormessage;

        /// Whether decoding HSON (if not, decoding HSON)
        bool hson;

        bool HandleToken(std::string const &token, TokenType tokentype);
        bool ParseSimpleValue(HSVM_VariableId target, std::string const &token, TokenType tokentype);
        bool ParseHSONTypedValue(HSVM_VariableId target, std::string const &token, TokenType tokentype);

    public:
        JSONParser(HSVM *_vm, bool _hson, HSVM_VariableId _translations);

        bool HandleByte(uint8_t byte);
        bool Finish(HSVM_VariableId target);
        inline bool HaveError() { return state == TS_Error; }

        std::string GetErrorMessage() const;
}; // End of class JSONParser

std::ostream & operator <<(std::ostream &out, JSONParser::TokenType tokentype)
{
        switch (tokentype)
        {
        case JSONParser::JTT_SpecialToken:  return out << "JTT_SpecialToken"; break;
        case JSONParser::JTT_Token:         return out << "JTT_Token"; break;
        case JSONParser::JTT_String:        return out << "JTT_String"; break;
        case JSONParser::JTT_Number:        return out << "JTT_Number"; break;
        }
        return out;
}

std::ostream & operator <<(std::ostream &out, JSONParser::ParseState parsestate)
{
        switch (parsestate)
        {
        case JSONParser::PS_RootValue:       return out << "PS_RootValue";
        case JSONParser::PS_ObjectWantName:  return out << "PS_ObjectWantName";
        case JSONParser::PS_ObjectWantColon: return out << "PS_ObjectWantColon";
        case JSONParser::PS_ObjectWantValue: return out << "PS_ObjectWantValue";
        case JSONParser::PS_ObjectWantComma: return out << "PS_ObjectWantComma";
        case JSONParser::PS_ArrayWantValue:  return out << "PS_ArrayWantValue";
        case JSONParser::PS_ArrayWantComma:  return out << "PS_ArrayWantComma";
        case JSONParser::PS_Finished:        return out << "PS_Finished";
        case JSONParser::PS_Error:           return out << "PS_Error";
        case JSONParser::PS_HSONStart:       return out << "PS_HSONStart";
        case JSONParser::PS_HSONStartColon:  return out << "PS_HSONStartColon";
        case JSONParser::PS_HSONWantArray:   return out << "PS_HSONWantArray";
        case JSONParser::PS_HSONWantTypedValue: return out << "PS_HSONWantTypedValue";
        };
        return out;
}


JSONParser::JSONParser(HSVM *_vm, bool _hson, HSVM_VariableId _translations)
: vm(_vm)
, state(TS_Default)
, encoder(std::back_inserter(currenttoken))
, parsestate(_hson ? PS_HSONStart : PS_RootValue)
, line(1)
, column(1)
, errorline(1)
, errorcolumn(1)
, hson(_hson)
{
        root = HSVM_AllocateVariable(vm);
        if (_translations)
        {
                int numcells = HSVM_RecordLength(vm, _translations);
                for (int i = 0; i < numcells; ++i)
                {
                        HSVM_ColumnId colid = HSVM_RecordColumnIdAtPos(vm, _translations, i);
                        HSVM_VariableId name = HSVM_RecordGetRef(vm, _translations, colid);
                        if (HSVM_GetType(vm, name) == HSVM_VAR_String)
                            translations[HSVM_StringGetSTD(vm, name)] = colid;
                }
        }

        HSVM_SetDefault(vm, root, HSVM_VAR_Record);
        levels.push_back(Level(root, PS_Error));
}

bool JSONParser::HandleByte(uint8_t byte)
{
        /* First level: tokenizer

           First: UTF8-decorder (ignore BOM and invalid UTF-8)
           specialtoken: any of '{}[]:,'
           whitespace: any of ' \r\n\t'
           tokenchar: all utf - whitespace - specialtoken

           longtoken: tokenchar+
           number: ('+' | '-' [whitespace])+ tokenchar* | [0-9\.] tokenchar* # whitespace not included in parsed token
           dqstring: ('"' ([^\"] | '\' char)* '"') |
           qstring: '\'' ([^\'] | '\' char)* '\'') # parser extension

           document: ( [whitespace] (longtoken | number | specialtoken | qstring | dqstring) )* [ whitespace ]
        */

        uint32_t val = decoder(byte);
        if (val == Blex::UTF8DecodeMachine::NoChar)
            return true;
        if (val == Blex::UTF8DecodeMachine::InvalidChar) // ignore? Throw error?
            return true;
        if (val == 0xFEFF && state == TS_Initial) // BOM, ignore if at start of document
            return true;

        if (val == '\n')
        {
                ++line;
                column = 1;
        }
        else
            ++column;

        bool is_whitespace = val == ' ' || val == '\r' || val == '\n' || val == '\t';
        bool is_tokenchar = val == '{' || val == '}' || val == '[' || val ==  ']' || val == ':' || val == ',';
        bool is_specialchar = val == '\'' || val == '\"' || val == '-' || val ==  '+' || val == '.';

        // First process tokens that are terminated by a token outside their class (that still needs to be processed afterwards)

        if (state == TS_LongToken)
        {
                // long token ends by whitespace or tokenchar or specialchar
                if (is_whitespace || is_tokenchar || is_specialchar)
                {
                        // Process the long token
                        if (!HandleToken(currenttoken, JTT_Token))
                            return false;
                        // Continue to process the current character too
                        state = TS_Default;
                }
                else
                {
                        // Add character to current token
                        encoder(val);
                        return true;
                }
        }

        if (state == TS_Number || state == TS_NumberPrefix)
        {
                // Number ends with whitespace after first non-prefix character ('+'/'-')
                if (is_tokenchar)
                {
                        // Token character, ends number. Process the number
                        if (!HandleToken(currenttoken, JTT_Number))
                        {
                                state = TS_Error;
                                return false;
                        }

                        // Continue to process the current character too
                        state = TS_Default;
                }
                else
                {
                        if (state == TS_NumberPrefix)
                        {
                                // Only seen prefixes, skip whitespace
                                if (!is_whitespace)
                                {
                                        // Check if other than prefix
                                        if (val != '+' && val != '-')
                                            state = TS_Number;

                                        // Add to token
                                        encoder(val);
                                }
                        }
                        else if (is_whitespace)
                        {
                                // Whitespace, ends the number
                                if (!HandleToken(currenttoken, JTT_Number))
                                {
                                        state = TS_Error;
                                        return false;
                                }

                                // Set the state. No need to continue, whitespace is ignored anyway
                                state = TS_Default;
                        }
                        else
                        {
                                // Add to token (this adds also non-number charactes, but don't care now)
                                encoder(val);
                        }

                        return true;
                }
        }

        if (state == TS_Default || state == TS_Initial)
        {
                // Set start of current token
                errorline = line;
                errorcolumn = column - 1;

                // Ignore whitespace
                if (is_whitespace)
                    return true;

                currenttoken.clear();
                if (is_tokenchar)
                {
                        // token character, process immediately
                        encoder(val);
                        if (!HandleToken(currenttoken, JTT_SpecialToken))
                        {
                                state = TS_Error;
                                return false;
                        }
                        return true;
                }
                // Detect strings. No need to add them to token, they are decoded immediately
                if (val == '"')
                {
                        state = TS_DQString;
                        return true;
                }
                if (val == '\'')
                {
                        state = TS_QString;
                        return true;
                }
                // Detect number
                if (val == '+' || val == '-')
                {
                        encoder(val);
                        state = TS_NumberPrefix;
                        return true;
                }
                if ((val >= '0' && val <= '9') || val == '.')
                {
                        encoder(val);
                        state = TS_Number;
                        return true;
                }

                // No special char, string or number, tread as long token
                encoder(val);
                state = TS_LongToken;
                return true;
        }

        if (state == TS_DQString || state == TS_QString)
        {
                // End of string?
                if (val == (state == TS_DQString ? '"' : '\''))
                {
                        std::string currentstring;
                        std::swap(currentstring, currenttoken);
                        Blex::DecodeJava(currentstring.begin(), currentstring.end(), std::back_inserter(currenttoken));
                        state = TS_Default;
                        if (!HandleToken(currenttoken, JTT_String))
                        {
                                state = TS_Error;
                                return false;
                        }
                        return true;
                }
                else if (val == '\\') // String escape?
                {
                        encoder(val);
                        state = state == TS_DQString ? TS_DQStringEsc : TS_QStringEsc;
                }
                else if (val < ' ' && val != '\t')
                {
                        // Found a control character in a string, do not like that
                        errormessage = "Control characters not allowed in strings";
                        errorline = line;
                        errorcolumn = column - 1;
                        state = TS_Error;
                        return false;
                }
                else
                    encoder(val);
                return true;
        }

        if (state == TS_DQStringEsc || state == TS_QStringEsc)
        {
                encoder(val);
                state = state == TS_DQStringEsc ? TS_DQString : TS_QString;
                return true;
        }

        if (state != TS_Error)
        {
                currenttoken.clear();
                encoder(val);
                errormessage = "Unexpected character '" + currenttoken + "' encountered";
                errorline = line;
                errorcolumn = column - 1;
                state = TS_Error;
        }

        // INV: state = TS_Error
        return false;
}

bool JSONParser::Finish(HSVM_VariableId target)
{
        if (state == TS_LongToken)
        {
                HandleToken(currenttoken, JTT_Token);
                state = TS_Default;
        }
        if (state == TS_Number)
        {
                HandleToken(currenttoken, JTT_Number);
                state = TS_Default;
        }
        if (state != TS_Default && state != TS_Error)
        {
                errorline = line;
                errorcolumn = column;
                errormessage = "JSON token not complete";
                state = TS_Error;
        }
        else if (parsestate != PS_Finished)
        {
                errorline = line;
                errorcolumn = column;
                switch (parsestate)
                {
                case PS_Error: break;
                case PS_ObjectWantName:
                        {
                                errormessage = "Expected a cellname";
                        } break;
                case PS_ObjectWantColon:
                case PS_HSONStartColon:
                        {
                                errormessage = "Expected a ':'";
                        } break;
                case PS_ObjectWantComma:
                        {
                                errormessage = "Expected a ',' or a '}'";
                        } break;
                case PS_ArrayWantComma:
                        {
                                errormessage = "Expected a ',' or a ']'";
                        } break;
                case PS_RootValue:
                case PS_ArrayWantValue:
                case PS_ObjectWantValue:
                case PS_HSONStart:
                case PS_HSONWantArray:
                case PS_HSONWantTypedValue:
                        {
                                errormessage = "Expected a value";
                        } break;

                default: ;
                        errormessage = "Internal error";
                        // fallthrough
                }
                state = TS_Error;
        }

        HSVM_SetDefault(vm, target, HSVM_VAR_Record);

        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, target, HSVM_GetColumnId(vm, "SUCCESS")), state != TS_Error);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, target, HSVM_GetColumnId(vm, "MSG")), GetErrorMessage());

        HSVM_VariableId value = HSVM_RecordCreate(vm, target, HSVM_GetColumnId(vm, "VALUE"));
        if (state != TS_Error)
            HSVM_CopyFrom(vm, value, root);
        else
            HSVM_SetDefault(vm, value, HSVM_VAR_Record);

        HSVM_DeallocateVariable(vm, root);
        return state != TS_Error;
}

bool JSONParser::HandleToken(std::string const &token, TokenType tokentype)
{
        /* value ::= object | array | number | string | boolean | null

           object ::= '{' 1( ps_object_wantname string ps_object_wantcolon ':' ps_object_wantvalue value ps_object_wantcomma ( , \1 )? ) '}'
           array ::= [ 1( ps_array_wantvalue value ps_array_wantcomma ( , \1 )? ) ]
        */

        switch (parsestate)
        {
        case PS_HSONStart:
            {
                    if (tokentype != JTT_Token || (token != "hson" && token != "json"))
                    {
                            errormessage = "Unrecognized data format";
                            parsestate = PS_Error;
                            return false;
                    }

                    // Switch back to legacy JSON if starts with 'json:'
                    if (token == "json")
                        hson = false;

                    parsestate = PS_HSONStartColon;
                    return true;
            }
        case PS_HSONStartColon:
            {
                    if (tokentype != JTT_SpecialToken || token[0] != ':')
                    {
                            errormessage = "Expected a ':'";
                            parsestate = PS_Error;
                            return false;
                    }
                    parsestate = PS_RootValue;
                    return true;
            }
        case PS_ObjectWantName:
            {
                    // End of object (this handles empty objects and extra ',' after last member)
                    if (tokentype == JTT_SpecialToken && token[0] == '}')
                    {
                            parsestate = levels.back().restorestate;
                            levels.pop_back();
                            return true;
                    }

                    if ((tokentype != JTT_String && tokentype != JTT_Token) || token.empty())
                    {
                            errormessage = "Expected a cellname";
                            parsestate = PS_Error;
                            return false;
                    }
                    lastname = token;
                    parsestate = PS_ObjectWantColon;
                    return true;
            }
        case PS_ObjectWantColon:
            {
                    if (tokentype != JTT_SpecialToken || token[0] != ':')
                    {
                            errormessage = "Expected a ':'";
                            parsestate = PS_Error;
                            return false;
                    }
                    parsestate = PS_ObjectWantValue;
                    return true;
            }
        case PS_ObjectWantComma:
            {
                    if (tokentype != JTT_SpecialToken || (token[0] != ',' && token[0] != '}'))
                    {
                            errormessage = "Expected a ',' or a '}'";
                            parsestate = PS_Error;
                            return false;
                    }
                    if (token[0] == ',')
                    {
                            parsestate = PS_ObjectWantName;
                    }
                    else
                    {
                            parsestate = levels.back().restorestate;
                            levels.pop_back();
                    }
                    return true;
            }
        case PS_ArrayWantComma:
            {
                    if (tokentype != JTT_SpecialToken || (token[0] != ',' && token[0] != ']'))
                    {
                            errormessage = "Expected a ',' or a ']'";
                            parsestate = PS_Error;
                            return false;
                    }
                    if (token[0] == ',')
                    {
                            parsestate = PS_ArrayWantValue;
                    }
                    else
                    {
                            // Convert arrays that are all integers, strings or records to their equivalent XXXArray
                            HSVM_VariableType type = levels.back().arrayelttype;
                            if (type == HSVM_VAR_IntegerArray || type == HSVM_VAR_StringArray || type == HSVM_VAR_RecordArray)
                                GetVirtualMachine(vm)->stackmachine.ForcedCastTo(levels.back().var, static_cast< VariableTypes::Type >(type));

                            parsestate = levels.back().restorestate;
                            levels.pop_back();
                    }
                    return true;
            }
        case PS_HSONWantArray:
            {
                    if (tokentype != JTT_SpecialToken || token[0] != '[') // new array
                    {
                            errormessage = "Expected array start token '[']";
                            parsestate = PS_Error;
                            return false;
                    }

                    parsestate = PS_ArrayWantValue;
                    return true;
            }
        case PS_ArrayWantValue:
            {
                    if (tokentype == JTT_SpecialToken && token[0] == ']')
                    {
                            // Convert arrays that are all integers, strings or records to their equivalent XXXArray
                            HSVM_VariableType type = levels.back().arrayelttype;
                            if (type == HSVM_VAR_IntegerArray || type == HSVM_VAR_StringArray || type == HSVM_VAR_RecordArray)
                                GetVirtualMachine(vm)->stackmachine.ForcedCastTo(levels.back().var, static_cast< VariableTypes::Type >(type));

                            parsestate = levels.back().restorestate;
                            levels.pop_back();
                            return true;
                    }
            }
            // Fallthrough
        case PS_RootValue:
        case PS_ObjectWantValue:
        case PS_HSONWantTypedValue:
            {
                    HSVM_VariableId target;
                    ParseState restorestate;

                    bool is_hsontypedvalue = parsestate == PS_HSONWantTypedValue;
                    if (is_hsontypedvalue)
                        parsestate = hsonrestorestate;

                    switch (parsestate)
                    {
                    case PS_RootValue:
                        {
                                target = levels.back().var;
                                restorestate = PS_Finished;
                        } break;
                    case PS_ArrayWantValue:
                         {
                                if (!is_hsontypedvalue)
                                {
                                        target = HSVM_ArrayAppend(vm, levels.back().var);
                                        levels.back().lastarrayelt = target;
                                }
                                else
                                    target = levels.back().lastarrayelt;
                                restorestate = PS_ArrayWantComma;
                         } break;
                    case PS_ObjectWantValue:
                        {
                                HSVM_ColumnId colid = 0;
                                if (!translations.empty())
                                {
                                        Translations::const_iterator itr = translations.find(lastname);
                                        if (itr != translations.end())
                                            colid = itr->second;
                                }
                                if (colid == 0)
                                    colid = HSVM_GetColumnIdRange(vm, &*lastname.begin(), &*lastname.end());
                                target = HSVM_RecordCreate(vm, levels.back().var, colid);
                                restorestate = PS_ObjectWantComma;
                        } break;
                    default:
                        throw std::runtime_error("Unhandled parserstate #1");
                    }

                    if (!target)
                    {
                            errormessage = "Internal error - don't have a target variable available";
                            parsestate = PS_Error;
                            return false;
                    }

                    if (is_hsontypedvalue)
                    {
                            if (!ParseHSONTypedValue(target, token, tokentype))
                            {
                                    HSVM_BooleanSet(vm, target, false);
                                    return false;
                            }

                            parsestate = restorestate;
                            return true;
                    }

                    if (tokentype == JTT_SpecialToken)
                    {
                            if (token[0] == '{') // new object
                            {
                                    if (levels.back().arrayelttype == 0)
                                        levels.back().arrayelttype = HSVM_VAR_RecordArray;
                                    else if (levels.back().arrayelttype != HSVM_VAR_RecordArray)
                                        levels.back().arrayelttype = HSVM_VAR_VariantArray;
                                    levels.push_back(Level(target, restorestate));

                                    if (levels.size() >= 2048)
                                    {
                                            errormessage = "Too many levels of recursion (" + Blex::AnyToString(levels.size()) + ")";
                                            parsestate = PS_Error;
                                            return false;
                                    }

                                    HSVM_RecordSetEmpty(vm, target);
                                    parsestate = PS_ObjectWantName;
                                    return true;
                            }
                            else if (token[0] == '[') // new array
                            {
                                    if (hson)
                                    {
                                            errormessage = "Expected HSON type before '[' token";
                                            parsestate = PS_Error;
                                            return false;
                                    }

                                    levels.back().arrayelttype = HSVM_VAR_VariantArray;
                                    levels.push_back(Level(target, restorestate));

                                    if (levels.size() >= 2048)
                                    {
                                            errormessage = "Too many levels of recursion (" + Blex::AnyToString(levels.size()) + ")";
                                            parsestate = PS_Error;
                                            return false;
                                    }

                                    HSVM_SetDefault(vm, target, HSVM_VAR_VariantArray);
                                    parsestate = PS_ArrayWantValue;
                                    return true;
                            }
                            else
                            {
                                    errormessage = "Unexpected character encountered";
                                    parsestate = PS_Error;
                                    return false;
                            }
                    }

                    if (hson && tokentype == JTT_Token) // Either type specifier, '*', 'true' or 'false'
                    {
                            if (token.size() == 1)
                            {
                                    switch (token[0])
                                    {
                                    case 'm':   lasttype = HSVM_VAR_Money; break;
                                    case 'f':   lasttype = HSVM_VAR_Float; break;
                                    case 'd':   lasttype = HSVM_VAR_DateTime; break;
                                    case 'b':   lasttype = HSVM_VAR_Blob; break;
                                    case 'o':   lasttype = HSVM_VAR_Object; break;
                                    case 'w':   lasttype = HSVM_VAR_WeakObject; break;
                                    case 'p':   lasttype = HSVM_VAR_FunctionPtr; break;
                                    case '*':
                                        {
                                                HSVM_SetDefault(vm, target, HSVM_VAR_Record);
                                                parsestate = restorestate;
                                                return true;
                                        }
                                    default:
                                        {
                                                errormessage = "Illegal variable type encoding '" + token + "'";
                                                parsestate = PS_Error;
                                                return false;
                                        }
                                    }

                                    hsonrestorestate = parsestate;
                                    parsestate = PS_HSONWantTypedValue;
                                    return true;
                            }
                            else if (token.size() == 2)
                            {
                                    if (token[1] != 'a')
                                    {
                                            errormessage = "Illegal variable type encoding '" + token + "'";
                                            parsestate = PS_Error;
                                            return false;
                                    }

                                    switch (token[0])
                                    {
                                    case 'v':   lasttype = HSVM_VAR_VariantArray; break;
                                    case 'b':   lasttype = HSVM_VAR_BooleanArray; break;
                                    case 'd':   lasttype = HSVM_VAR_DateTimeArray; break;
                                    case 'm':   lasttype = HSVM_VAR_MoneyArray; break;
                                    case 'f':   lasttype = HSVM_VAR_FloatArray; break;
                                    case 's':   lasttype = HSVM_VAR_StringArray; break;
                                    case 'x':   lasttype = HSVM_VAR_BlobArray; break;
                                    case 'i':   lasttype = HSVM_VAR_IntegerArray; break;
                                    case 'r':   lasttype = HSVM_VAR_RecordArray; break;
                                    case 'o':   lasttype = HSVM_VAR_ObjectArray; break;
                                    case 'w':   lasttype = HSVM_VAR_WeakObjectArray; break;
                                    case 'p':   lasttype = HSVM_VAR_FunctionPtrArray; break;
                                    default:
                                        {
                                                errormessage = "Illegal variable type encoding '" + token + "'";
                                                parsestate = PS_Error;
                                                return false;
                                        }
                                    }

                                    levels.back().arrayelttype = HSVM_VAR_VariantArray;
                                    levels.push_back(Level(target, restorestate));
                                    levels.back().arrayelttype = lasttype;

                                    if (levels.size() >= 2048)
                                    {
                                            errormessage = "Too many levels of recursion (" + Blex::AnyToString(levels.size()) + ")";
                                            parsestate = PS_Error;
                                            return false;
                                    }

                                    HSVM_SetDefault(vm, target, lasttype);
                                    parsestate = PS_HSONWantArray;
                                    return true;
                            }
                            else if (token.size() > 2) //i64, i64a
                            {
                                    if (token.size() == 3 || (token.size() == 4 && token[3] == 'a'))
                                    {
                                            const char *str_i64a = "i64a";
                                            bool is_array = token.size() == 4;

                                            if (!(token == Blex::StringPair(str_i64a, str_i64a + (is_array ? 4 : 3))))
                                            {
                                                    errormessage = "Illegal variable type encoding '" + token + "'";
                                                    parsestate = PS_Error;
                                                    return false;
                                            }

                                            if (!is_array)
                                                hsonrestorestate = parsestate;
                                            else
                                            {
                                                    levels.back().arrayelttype = HSVM_VAR_Integer64Array;
                                                    levels.push_back(Level(target, restorestate));

                                                    if (levels.size() >= 2048)
                                                    {
                                                            errormessage = "Too many levels of recursion (" + Blex::AnyToString(levels.size()) + ")";
                                                            parsestate = PS_Error;
                                                            return false;
                                                    }

                                                    HSVM_SetDefault(vm, target, HSVM_VAR_Integer64Array);
                                            }


                                            lasttype = is_array ? HSVM_VAR_Integer64Array : HSVM_VAR_Integer64;
                                            parsestate = is_array ? PS_HSONWantArray : PS_HSONWantTypedValue;
                                            return true;
                                    }
                            }
                    }

                    if (!ParseSimpleValue(target, token, tokentype))
                    {
                            HSVM_BooleanSet(vm, target, false);
                            return false;
                    }

                    HSVM_VariableType type = HSVM_GetType(vm, target) | HSVM_VAR_Array;
                    if (levels.back().arrayelttype == 0)
                        levels.back().arrayelttype = type;
                    else if (levels.back().arrayelttype != type)
                        levels.back().arrayelttype = HSVM_VAR_VariantArray;

                    parsestate = restorestate;
                    return true;
            }
        case PS_Finished:
            {
                    errormessage = "Extra character encountered";
                    parsestate = PS_Error;
                    return false;
            }
        default: ;
            // Fallthrough
        }
        return false;
}

bool JSONParser::ParseSimpleValue(HSVM_VariableId target, std::string const &token, TokenType tokentype)
{
        switch (tokentype)
        {
        case JTT_String:
            {
                    HSVM_StringSetSTD(vm, target, token);
                    return true;
            }

        case JTT_Token:
            {
                    const char *str_null = "null";
                    const char *str_false = "false";
                    const char *str_true = "true";

                    if (token == Blex::StringPair(str_null, str_null + 4) && !hson)
                    {
                            HSVM_SetDefault(vm, target, HSVM_VAR_Record);
                            return true;
                    }
                    if (token == Blex::StringPair(str_false, str_false + 5))
                    {
                            HSVM_BooleanSet(vm, target, false);
                            return true;
                    }
                    if (token == Blex::StringPair(str_true, str_true + 4))
                    {
                            HSVM_BooleanSet(vm, target, true);
                            return true;
                    }

                    errormessage = "Unexpected token '" + token + "'";
                    parsestate = PS_Error;
                    return false;
            }

        case JTT_Number:
            {
                    bool negate = false;

                    Blex::DecimalFloat value;
                    const char *data = token.c_str();
                    const char *limit = data + token.size();

                    while (*data == '+' || *data == '-')
                    {
                            negate = negate ^ (*data == '-');
                            ++data;
                    }

                    char postfix = ' ';
                    const char *finish = limit;
                    Blex::DecimalFloat::ParseResult res = value.ParseNumberString(data, limit, &postfix, &finish);
                    if (negate)
                        value.Negate();

                    if (finish != limit)
                    {
                            errormessage = "Illegal integer constant '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                    }
                    switch (res)
                    {
                    case Blex::DecimalFloat::PR_Error_IllegalIntegerConstant:
                        {
                                errormessage = "Illegal integer constant '" + token + "'";
                                parsestate = PS_Error;
                                return false;
                        }
                    case Blex::DecimalFloat::PR_Error_ExpectedReal:
                        {
                                errormessage = "Expected a real value, got '" + token + "'";
                                parsestate = PS_Error;
                                return false;
                        }
                    case Blex::DecimalFloat::PR_Error_IllegalExponent:
                        {
                                errormessage = "Expected a valid float exponent value, got '" + token + "'";
                                parsestate = PS_Error;
                                return false;
                        }
                    default: ;
                    }

                    if (postfix == ' ')
                    {
                            // For JSON, we don't auto-convert to MONEY, but immediately to FLOAT
                            if (value.ConvertableToS32())
                                postfix = 'I';
                            else
                                postfix = 'F';
                    }

                    switch (postfix)
                    {
                    case 'I':
                        {
                                if (!value.ConvertableToS32())
                                {
                                        errormessage = "Integer overflow in token '" + token + "'";
                                        parsestate = PS_Error;
                                        return false;
                                }
                                HSVM_IntegerSet(vm, target, value.ToS32());
                        } break;
                    case '6':
                        {
                                if (!value.ConvertableToS64())
                                {
                                        errormessage = "Integer64 overflow in token '" + token + "'";
                                        parsestate = PS_Error;
                                        return false;
                                }
                                HSVM_Integer64Set(vm, target, value.ToS64());
                        } break;
                    case 'M':
                        {
                                if (!value.ConvertableToMoney(false))
                                {
                                        errormessage = "Money overflow in token '" + token + "'";
                                        parsestate = PS_Error;
                                        return false;
                                }
                                HSVM_MoneySet(vm, target, value.ToMoney());
                        } break;
                    case 'F':
                        {
                                if (!value.ConvertableToFloat())
                                {
                                        errormessage = "Float overflow in token '" + token + "'";
                                        parsestate = PS_Error;
                                        return false;
                                }
                                HSVM_FloatSet(vm, target, value.ToFloat());
                        } break;
                    default:
                        errormessage = "Unknown postfix '" + std::string(1, postfix) + "' encountered";
                        parsestate = PS_Error;
                        return false;
                    }
                    return true;
            } break;

        default:
            errormessage = "Unexpected token '" + token + "' encountered";
            parsestate = PS_Error;
            return false;
        }
}

bool JSONParser::ParseHSONTypedValue(HSVM_VariableId target, std::string const &token, TokenType tokentype)
{
        switch (lasttype)
        {
        case HSVM_VAR_Integer64:
        case HSVM_VAR_Money:
        case HSVM_VAR_Float:
            {
                    if (tokentype != JTT_Number)
                    {
                            errormessage = "Illegal money/float value '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                    }

                    bool negate = false;

                    Blex::DecimalFloat value;
                    const char *data = token.c_str();
                    const char *limit = data + token.size();

                    while (*data == '+' || *data == '-')
                    {
                            negate = negate ^ (*data == '-');
                            ++data;
                    }

                    char postfix = ' ';
                    const char *finish = limit;
                    Blex::DecimalFloat::ParseResult res = value.ParseNumberString(data, limit, &postfix, &finish);
                    if (negate)
                        value.Negate();

                    switch (res)
                    {
                    case Blex::DecimalFloat::PR_Error_IllegalIntegerConstant:
                        {
                                errormessage = "Illegal integer constant '" + token + "'";
                                parsestate = PS_Error;
                                return false;
                        }
                    case Blex::DecimalFloat::PR_Error_ExpectedReal:
                        {
                                errormessage = "Expected a real value, got '" + token + "'";
                                parsestate = PS_Error;
                                return false;
                        }
                    case Blex::DecimalFloat::PR_Error_IllegalExponent:
                        {
                                errormessage = "Expected a valid float exponent value, got '" + token + "'";
                                parsestate = PS_Error;
                                return false;
                        }
                    default: ;
                    }

                    // FIXME: range checks
                    if (lasttype == HSVM_VAR_Money)
                    {
                            if (!value.ConvertableToMoney(false))
                            {
                                    errormessage = "Money overflow in token '" + token + "'";
                                    parsestate = PS_Error;
                                    return false;
                            }
                            HSVM_MoneySet(vm, target, value.ToMoney());
                    }
                    else if (lasttype == HSVM_VAR_Integer64)
                    {
                            if (!value.ConvertableToS64())
                            {
                                    errormessage = "Integer64 overflow in token '" + token + "'";
                                    parsestate = PS_Error;
                                    return false;
                            }
                            HSVM_Integer64Set(vm, target, value.ToS64());
                    }
                    else
                    {
                            if (!value.ConvertableToFloat())
                            {
                                    errormessage = "Float overflow in token '" + token + "'";
                                    parsestate = PS_Error;
                                    return false;
                            }
                            HSVM_FloatSet(vm, target, value.ToFloat());
                    }
                    return true;
            } break;
        case HSVM_VAR_Blob:
            {
                    if (tokentype != JTT_String)
                    {
                            errormessage = "Illegal blob value '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                    }

                    // base64 decode the token
                    int stream = HSVM_CreateStream(vm);

                    char buf[16383];
                    for (uint32_t i = 0; i < token.size(); i += 21844)
                    {
                            uint64_t len = std::min<uint64_t>(token.size() - i, 21844);
                            char *bufend = Blex::DecodeBase64(token.begin() + i, token.begin() + i + len, buf);
                            HSVM_PrintTo(vm, stream, bufend - buf, buf);
                    }

                    HSVM_MakeBlobFromStream(vm, target, stream);
                    return true;
            } break;
        case HSVM_VAR_DateTime:
            {
                    if (tokentype != JTT_String)
                    {
                            errormessage = "Illegal datetime value '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                    }

                    Blex::DateTime value = Blex::DateTime::Invalid();
                    if (!token.empty())
                    {
                            const char *str_max = "MAX";
                            if (token == Blex::StringPair(str_max, str_max + 3))
                                value = Blex::DateTime::Max();
                            else if (token[0] == 'T')
                            {
                                    std::pair< uint64_t, std::string::const_iterator > res = Blex::DecodeUnsignedNumber<uint64_t>(token.begin() + 1, token.end());
                                    if (res.second != token.end())
                                    {
                                            errormessage = "Illegal datetime value '" + token + "'";
                                            parsestate = PS_Error;
                                            return false;
                                    }

                                    uint64_t msecs = res.first;
                                    value = Blex::DateTime(0, msecs);
                            }
                            else
                            {
                                    std::string::const_iterator it_t = std::find(token.begin(), token.end(), 'T');
                                    if (it_t == token.end())
                                        value = Blex::DateTime::FromText(token + "T000000");
                                    else
                                    {
                                            unsigned datelen = std::distance(token.begin(), it_t);
                                            if (datelen == 8) // normal
                                                value = Blex::DateTime::FromText(token);
                                            else if (datelen > 8) // year overflow
                                            {
                                                    std::string::const_iterator normal_it = it_t - 8;
                                                    Blex::DateTime partvalue = Blex::DateTime::FromText(std::string(normal_it, token.end()));

                                                    std::pair< unsigned, std::string::const_iterator > res = Blex::DecodeUnsignedNumber< unsigned >(token.begin(), normal_it);
                                                    if (res.second == normal_it)
                                                    {
                                                            std::tm unpacked = partvalue.GetTM();
                                                            unpacked.tm_year += res.first * 10000;
                                                            value = Blex::DateTime::FromTM(unpacked);
                                                            value += Blex::DateTime::Msecs(partvalue.GetMsecs() % 1000);
                                                    }
                                            }
                                    }

                                    if (value == Blex::DateTime::Invalid())
                                    {
                                            errormessage = "Illegal datetime value '" + token + "'";
                                            parsestate = PS_Error;
                                            return false;
                                    }
                            }
                    }

                    HSVM_DateTimeSet(vm, target, value.GetDays(), value.GetMsecs());
                    return true;
            }
        case HSVM_VAR_Object:
        case HSVM_VAR_WeakObject:
        case HSVM_VAR_FunctionPtr:
            {
                    if (tokentype != JTT_Token || token.size() != 1 || token[0] != '*')
                    {
                            errormessage = "Illegal value '" + token + "' for " + GetTypeName(static_cast< VariableTypes::Type >(lasttype));
                            parsestate = PS_Error;
                            return false;
                    }

                    HSVM_SetDefault(vm, target, lasttype);
                    return true;
            }
        default:
            throw std::runtime_error("Unhandled variabletype in HSON typed decoder" + Blex::AnyToString(lasttype));
        }
}


std::string JSONParser::GetErrorMessage() const
{
        if (!errormessage.empty())
            return "At (" + Blex::AnyToString(errorline) + "," + Blex::AnyToString(errorcolumn) + "): " + errormessage;
        return "";
}

class JSONEncoder
{
    public:
        enum LevelType
        {
        LT_Root,
        LT_Array,
        LT_Object
        };

        struct Level
        {
                Level(HSVM_VariableId _var, LevelType _type) : var(_var), type(_type), pos(0) { }
                HSVM_VariableId var;
                LevelType type;
                unsigned pos;
                unsigned len;
                Blex::PodVector< HSVM_ColumnId > columns;
        };

    private:
        void PushNr(int64_t nr, int decimals, Blex::PodVector< char > *dest);

        HSVM *vm;
        HSVM_VariableId translations;

    public:
        void Encode(HSVM_VariableId id_set, HSVM_VariableId source, bool make_blob, bool hson);
        void Close();

        JSONEncoder(HSVM *vm, HSVM_VariableId id_translations);
};

JSONEncoder::JSONEncoder(HSVM *vm, HSVM_VariableId id_translations)
: vm(vm)
, translations(0)
{
        if (id_translations && HSVM_RecordExists(vm, id_translations))
        {
                translations = HSVM_AllocateVariable(vm);
                HSVM_CopyFrom(vm, translations, id_translations);
        }
}
void JSONEncoder::Close()
{
        if (translations)
            HSVM_DeallocateVariable(vm, translations);
        translations=0;
}

void JSONEncoder::PushNr(int64_t nr, int decimals, Blex::PodVector< char > *dest)
{
        // 24 zeros for padding
        char buffer[48];
        memset(buffer, '0', 24);

        uint64_t unr = nr;
        if (nr < 0)
        {
                dest->push_back('-');
                unr = 0 - uint64_t(nr);
        }
        char *start = buffer + 24;
        char *end = Blex::EncodeNumber(unr, 10, start);
        if (end - start < decimals)
            start = end - decimals;

        dest->insert(dest->end(), start, end);
}

namespace
{

bool TranslatedColumnLess(HSVM *vm, HSVM_VariableId translations, HSVM_ColumnId left, HSVM_ColumnId right)
{
        Blex::StringPair str_left = Blex::StringPair::ConstructEmpty();
        Blex::StringPair str_right = Blex::StringPair::ConstructEmpty();

        if (translations)
        {
                HSVM_VariableId mapped_left = HSVM_RecordGetRef(vm, translations, left);
                if (mapped_left && HSVM_GetType(vm, mapped_left) == HSVM_VAR_String)
                    HSVM_StringGet(vm, mapped_left, &str_left.begin, &str_left.end);

                HSVM_VariableId mapped_right = HSVM_RecordGetRef(vm, translations, right);
                if (mapped_right && HSVM_GetType(vm, mapped_right) == HSVM_VAR_String)
                    HSVM_StringGet(vm, mapped_right, &str_right.begin, &str_right.end);
        }
        if (!str_left.begin)
                str_left = GetVirtualMachine(vm)->columnnamemapper.GetReverseMapping(left);
        if (!str_right.begin)
                str_right = GetVirtualMachine(vm)->columnnamemapper.GetReverseMapping(right);

        return Blex::StrCompare(str_left.begin, str_left.end, str_right.begin, str_right.end) < 0;
}

std::string GetErrorLocationFromLevels(HSVM *vm, std::vector< JSONEncoder::Level > const &levels)
{
        std::string errormsg = ", at DATA";

        for (auto &itr: levels)
        {
                if (itr.type == JSONEncoder::LT_Array)
                    errormsg += "[" + Blex::AnyToString(itr.pos - 1) + "]";
                else if (itr.type == JSONEncoder::LT_Object)
                {
                    errormsg += ".";
                    char colname_buffer[HSVM_MaxColumnName];
                    unsigned colname_len = HSVM_GetColumnName(vm, itr.columns[itr.pos - 1], colname_buffer);
                    errormsg += std::string(colname_buffer, colname_buffer + colname_len);
                }
        }

        return errormsg;
}

void ThrowCannotEncodeType(HSVM *vm, HSVM_VariableType type, bool hson, std::vector< JSONEncoder::Level > const &levels, bool onlynondefault)
{
        std::string errormsg = std::string("Cannot encode ") + (onlynondefault ? "type " : "a non-default ")
            + GetTypeName(static_cast< VariableTypes::Type >(type))
            + " in " + std::string(hson?"HSON":"JSON")
            + GetErrorLocationFromLevels(vm, levels);

        HSVM_ThrowException(vm, errormsg.c_str());
}


} // End of anonymous namespace

void JSONEncoder::Encode(HSVM_VariableId id_set, HSVM_VariableId source, bool make_blob, bool hson)
{
        std::vector< Level > levels;
        levels.reserve(256);

        Blex::PodVector< char > dest;
        Level root_level(source, LT_Root);
        root_level.len = 1;
        levels.push_back(root_level);

        int stream = 0;
        if (make_blob)
            stream = HSVM_CreateStream(vm);

        if (hson)
        {
                const char *str_hson = "hson:";
                dest.insert(dest.end(), str_hson, str_hson + 5);
        }

        while (true)
        {
                if (make_blob && dest.size() > 16384)
                {
                        HSVM_PrintTo(vm, stream, dest.size(), &dest[0]);
                        dest.clear();
                }

                Level &current = levels.back();

                if (current.pos == current.len)
                {
                        switch (current.type)
                        {
                        case LT_Array:
                            {
                                    dest.push_back(']');
                                    levels.pop_back();
                                    continue;
                            }
                        case LT_Object:
                            {
                                    dest.push_back('}');
                                    levels.pop_back();
                                    continue;
                            }
                        default: ;
                            // fallthrough
                        }
                        break;
                }

                HSVM_VariableId to_encode;
                switch (current.type)
                {
                case LT_Array:
                    {
                            if (current.pos != 0)
                                dest.push_back(',');
                            to_encode = HSVM_ArrayGetRef(vm, current.var, current.pos);
                    } break;
                case LT_Object:
                    {
                            if (current.pos != 0)
                                dest.push_back(',');
                            HSVM_ColumnId colid = current.columns[current.pos];
                            dest.push_back('"');

                            bool didtranslation=false;
                            if (translations)
                            {
                                    HSVM_VariableId mapped_colid = HSVM_RecordGetRef(vm, translations, colid);
                                    if (mapped_colid && HSVM_GetType(vm, mapped_colid) == HSVM_VAR_String)
                                    {
                                            Blex::StringPair colname = Blex::StringPair::ConstructEmpty();
                                            HSVM_StringGet(vm, mapped_colid, &colname.begin, &colname.end);
                                            Blex::EncodeJSON(colname.begin, colname.end, std::back_inserter(dest));
                                            didtranslation = true;
                                    }
                            }
                            if(!didtranslation)
                            {
                                    char colname_buffer[HSVM_MaxColumnName];

                                    unsigned colname_len = HSVM_GetColumnName(vm, colid, colname_buffer);
                                    Blex::ToLowercase(colname_buffer, colname_buffer + colname_len);
                                    Blex::EncodeJSON(colname_buffer, colname_buffer + colname_len, std::back_inserter(dest));
                            }

                            dest.push_back('"');
                            dest.push_back(':');

                            to_encode = HSVM_RecordGetRef(vm, current.var, colid);
                    } break;
                case LT_Root:
                    {
                            to_encode = current.var;
                    } break;
                default:
                    throw std::runtime_error("Illegal encodejson level type");
                }
                ++current.pos;

                HSVM_VariableType type = HSVM_GetType(vm, to_encode);
                if (type & HSVM_VAR_Array)
                {
                        if (hson)
                        {
                                switch (type)
                                {
                                case HSVM_VAR_VariantArray:     dest.push_back('v'); break;
                                case HSVM_VAR_BooleanArray:     dest.push_back('b'); break;
                                case HSVM_VAR_DateTimeArray:    dest.push_back('d'); break;
                                case HSVM_VAR_MoneyArray:       dest.push_back('m'); break;
                                case HSVM_VAR_FloatArray:       dest.push_back('f'); break;
                                case HSVM_VAR_StringArray:      dest.push_back('s'); break;
                                case HSVM_VAR_BlobArray:        dest.push_back('x'); break;
                                case HSVM_VAR_Integer64Array:   dest.push_back('i'); dest.push_back('6'); dest.push_back('4'); break;
                                case HSVM_VAR_IntegerArray:     dest.push_back('i'); break;
                                case HSVM_VAR_RecordArray:      dest.push_back('r'); break;
                                case HSVM_VAR_ObjectArray:      dest.push_back('o'); break;
                                case HSVM_VAR_WeakObjectArray:  dest.push_back('w'); break;
                                case HSVM_VAR_FunctionPtrArray: dest.push_back('p'); break;
                                }
                                dest.push_back('a');
                        }
                        Level level(to_encode, LT_Array);
                        level.len = HSVM_ArrayLength(vm, to_encode);
                        levels.push_back(level);
                        dest.push_back('[');
                        continue;
                }

                switch (type)
                {
                case HSVM_VAR_Record:
                    {
                            if (!HSVM_RecordExists(vm, to_encode))
                            {
                                    if (hson)
                                        dest.push_back('*');
                                    else
                                    {
                                          const char *str_null = "null";
                                          unsigned oldsize = dest.size();
                                          dest.resize(oldsize + 4);
                                          std::copy(str_null, str_null + 4, dest.begin() + oldsize);
                                    }
                                    continue;
                            }
                            else
                            {
                                    Level new_level(to_encode, LT_Object);
                                    new_level.len = HSVM_RecordLength(vm, to_encode);
                                    levels.push_back(new_level);

                                    Level &level = levels.back();
                                    level.columns.resize(level.len);

                                    for (unsigned idx = 0; idx < level.len; ++idx)
                                        level.columns[idx] = HSVM_RecordColumnIdAtPos(vm, to_encode, idx);

                                    std::sort(level.columns.begin(), level.columns.end(), std::bind(TranslatedColumnLess, vm, translations, std::placeholders::_1, std::placeholders::_2));
                                    dest.push_back('{');
                                    continue;
                            }
                    }
                case HSVM_VAR_Integer:
                    {
                            int32_t val = HSVM_IntegerGet(vm, to_encode);
                            Blex::EncodeNumber(val, 10, std::back_inserter(dest));
                    } break;
                case HSVM_VAR_Integer64:
                    {
                            if (hson)
                            {
                                    const char *str_i64 = "i64 ";
                                    dest.insert(dest.end(), str_i64, str_i64 + 4);
                            }

                            int64_t val = HSVM_Integer64Get(vm, to_encode);
                            Blex::EncodeNumber(val, 10, std::back_inserter(dest));
                    } break;
                case HSVM_VAR_String:
                    {
                            Blex::StringPair str;
                            HSVM_StringGet(vm, to_encode, &str.begin, &str.end);
                            dest.push_back('"');
                            if (hson)
                                Blex::EncodeHSON(str.begin, str.end, std::back_inserter(dest));
                            else
                                Blex::EncodeJSON(str.begin, str.end, std::back_inserter(dest));
                            dest.push_back('"');
                    } break;
                case HSVM_VAR_Boolean:
                    {
                            const char *str_false = "false";
                            const char *str_true = "true";
                            unsigned oldsize = dest.size();

                            if (HSVM_BooleanGet(vm, to_encode))
                            {
                                    dest.resize(oldsize + 4);
                                    std::copy(str_true, str_true + 4, dest.begin() + oldsize);
                            }
                            else
                            {
                                    dest.resize(oldsize + 5);
                                    std::copy(str_false, str_false + 5, dest.begin() + oldsize);
                            }
                    } break;
                case HSVM_VAR_Money:
                    {
                            if (hson)
                            {
                                    const char *str_m = "m ";
                                    dest.insert(dest.end(), str_m, str_m + 2);
                            }

                            int64_t signed_val = HSVM_MoneyGet(vm, to_encode);
                            uint64_t unsigned_val;

                            if (signed_val < 0)
                            {
                                    dest.push_back('-');
                                    unsigned_val = -uint64_t(signed_val);
                            }
                            else
                                unsigned_val = signed_val;

                            char buffer[26];
                            std::fill(buffer, buffer + sizeof(buffer), '0');
                            char *middle = &buffer[5];
                            char *limit = Blex::EncodeNumber(unsigned_val, 10, middle);
                            char *firstdecimal = limit - 5;
                            char *lastinteger = limit - 6;

                            char *number_start = middle < lastinteger ? middle : lastinteger;

                            std::copy(number_start, firstdecimal, std::back_inserter(dest));
                            while (limit > firstdecimal && limit[-1] == '0')
                                --limit;
                            if (limit != firstdecimal)
                            {
                                    dest.push_back('.');
                                    std::copy(firstdecimal, limit, std::back_inserter(dest));
                            }
                    } break;
                case HSVM_VAR_Float:
                    {
                            signed decimals = 6; // ADDME: what precision do whe want to use?

                            if (hson)
                            {
                                    const char *str_m = "f ";
                                    dest.insert(dest.end(), str_m, str_m + 2);
                                    decimals = 20;
                            }

                            double val = HSVM_FloatGet(vm, to_encode);
                            bool neg = false;
                            int pointpos = 1;
                            if (val != 0)
                            {
                                    //check if it's negative
                                    neg = val < 0;
                                    if (neg)
                                        val = -val;

                                    //round up the number
                                    val += (5 / Blex::FloatPow10(decimals+1.0));

                                    //get position of the decimal point
                                    double logval = std::log10(val);
                                    pointpos = std::floor(logval) + 1;

                            }

                            if (neg)
                                dest.push_back('-');

                            if (pointpos < 15)
                            {
                                    uint64_t intval = std::floor(val);
                                    val = (val - intval) * 10;

                                    Blex::EncodeNumber(intval, 10, std::back_inserter(dest));
                                    pointpos = 0;
                            }
                            else
                                val = val / Blex::FloatPow10(pointpos - 1);

                            for (int i = 0; i < decimals+pointpos; ++i)
                            {
                                    if (val == 0 && i >= pointpos)
                                        break;

                                    if (i == pointpos)
                                        dest.push_back('.');
                                    //get one digit (there is only one digit before the decimal point)
                                    int decimal = std::floor(val);
                                    //add digit to output
                                    Blex::EncodeNumber(decimal, 10, std::back_inserter(dest));
                                    //shift next digit before the decimal point
                                    val = (val-decimal)*10;
                            }
                    } break;
                case HSVM_VAR_DateTime:
                    {
                            if(hson)
                                    dest.push_back('d');
                            dest.push_back('"');

                            int daysvalue, msecsvalue;
                            HSVM_DateTimeGet(vm, to_encode, &daysvalue, &msecsvalue);

                            if (daysvalue == 0)
                            {
                                    if (msecsvalue != 0)
                                    {
                                            dest.push_back('T');
                                            Blex::EncodeNumber(msecsvalue, 10, std::back_inserter(dest));
                                    }
                            }
                            else if (daysvalue == 2147483647 && msecsvalue == 86399999)
                            {
                                    const char *str_max = "MAX";
                                    dest.insert(dest.end(), str_max, str_max + 3);
                            }
                            else
                            {
                                    long long int year =
                                                      ((daysvalue/146097)       *400) //400 years take 146097 days
                                                    +(((daysvalue%146097)/36524)*100) //100 years take 36524 days inside a period of 400 years (eg 1601-2000)
                                                    +(((daysvalue%146097%36524) /1461) *4);  //4 years take 3*365+1 days inside a period of 100 years (eg 1701-1800)
                                    year = year + (daysvalue%146097%36524%1461+364)/365;

                                    std::tm tm = Blex::DateTime(daysvalue, msecsvalue).GetTM();

                                    PushNr(year, 4, &dest);
                                    if(!hson)
                                            dest.push_back('-');
                                    PushNr(tm.tm_mon + 1, 2, &dest);
                                    if(!hson)
                                            dest.push_back('-');
                                    PushNr(tm.tm_mday, 2, &dest);

                                    if (msecsvalue || !hson)
                                    {
                                            dest.push_back('T');
                                            PushNr(tm.tm_hour, 2, &dest);
                                            if(!hson)
                                                    dest.push_back(':');
                                            PushNr(tm.tm_min, 2, &dest);
                                            if(!hson)
                                                    dest.push_back(':');
                                            PushNr(tm.tm_sec, 2, &dest);
                                            uint64_t msecs = msecsvalue % 1000;
                                            if (msecs || !hson)
                                            {
                                                  dest.push_back('.');
                                                  PushNr(msecs, 3, &dest);
                                            }
                                    }
                                    if(!hson)
                                            dest.push_back('Z');
                            }
                            dest.push_back('"');
                    } break;

                case HSVM_VAR_Object:
                    {
                            // Allow DEFAULT OBJECT in HSON mode
                            if (hson)
                            {
                                    if (!HSVM_ObjectExists(vm, to_encode))
                                    {
                                            dest.push_back('o');
                                            dest.push_back(' ');
                                            dest.push_back('*');
                                            break;
                                    }

                                    ThrowCannotEncodeType(vm, type, hson, levels, true);
                                    return;
                            }

                            ThrowCannotEncodeType(vm, type, hson, levels, false);
                            return;
                    } break;

                case HSVM_VAR_WeakObject:
                    {
                            // Allow DEFAULT OBJECT in HSON mode
                            if (hson)
                            {
                                    if (!HSVM_WeakObjectExists(vm, to_encode))
                                    {
                                            dest.push_back('w');
                                            dest.push_back(' ');
                                            dest.push_back('*');
                                            break;
                                    }

                                    ThrowCannotEncodeType(vm, type, hson, levels, true);
                                    return;
                            }

                            ThrowCannotEncodeType(vm, type, hson, levels, false);
                            return;
                    } break;

                case HSVM_VAR_FunctionPtr:
                    {
                            // Allow DEFAULT OBJECT in HSON mode
                            if (hson)
                            {
                                    if (!HSVM_FunctionPtrExists(vm, to_encode))
                                    {
                                            dest.push_back('p');
                                            dest.push_back(' ');
                                            dest.push_back('*');
                                            break;
                                    }

                                    ThrowCannotEncodeType(vm, type, hson, levels, true);
                                    return;
                            }

                            ThrowCannotEncodeType(vm, type, hson, levels, false);
                            return;
                    } break;

                case HSVM_VAR_Blob:
                    {
                            if(hson)
                                    dest.push_back('b');
                            dest.push_back('"');

                            int blobhandle = HSVM_BlobOpen(vm, to_encode);
                            uint8_t buffer[16383 + 2];
                            int bufend = 0;

                            while (true)
                            {
                                    int readlen = HSVM_BlobRead(vm, blobhandle, 16383, buffer + bufend);
                                    bufend += readlen;

                                    if (readlen == 0)
                                    {
                                            Blex::EncodeBase64(buffer, buffer + bufend, std::back_inserter(dest));
                                            break;
                                    }
                                    else
                                    {
                                            int encodelen = (readlen / 3) * 3;
                                            Blex::EncodeBase64(buffer, buffer + encodelen, std::back_inserter(dest));

                                            std::copy(buffer + encodelen, buffer + bufend, buffer);
                                            bufend = bufend - encodelen;
                                    }
                            }
                            HSVM_BlobClose (vm, blobhandle);

                            dest.push_back('"');
                            break;
                    }

                default:
                    {
                            ThrowCannotEncodeType(vm, type, hson, levels, false);
                            return;
                    }
                }
        }

        if (make_blob)
        {
                HSVM_PrintTo(vm, stream, dest.size(), &dest[0]);
                dest.clear();
                HSVM_MakeBlobFromStream(vm, id_set, stream);
        }
        else
        {
                const char *start = dest.empty() ? 0 : &dest[0];
                HSVM_StringSet(vm, id_set, start, start + dest.size());
        }
}

struct JSONContextData
{
    public:

        struct Parser : public HareScript::OutputObject
        {
                Parser(HSVM *_vm, bool _hson, HSVM_VariableId translations) : OutputObject(_vm), jsonparser(_vm, _hson, translations) {}

                JSONParser jsonparser;

                std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);
        };

        typedef std::shared_ptr< Parser > ParserPtr;
        typedef std::map< int, ParserPtr > Parsers;
        Parsers parsers;
};

std::pair< Blex::SocketError::Errors, unsigned > JSONContextData::Parser::Write(unsigned numbytes, const void *data, bool /*allow_partial*/)
{
        if (!jsonparser.HaveError())
        {
                for (unsigned idx = 0; idx < numbytes; ++idx)
                    if (!jsonparser.HandleByte(static_cast< uint8_t const * >(data)[idx]))
                        break;
        }
        return std::make_pair(Blex::SocketError::NoError, numbytes);
}

const int JSONContextId = 20;
typedef Blex::Context< JSONContextData, JSONContextId, void> JSONContext;


void JSONDecoderAllocate(HSVM_VariableId id_set, VirtualMachine *vm)
{
        JSONContext context(vm->GetContextKeeper());

        bool is_hson = HSVM_BooleanGet(*vm, HSVM_Arg(0));

        JSONContextData::ParserPtr parser(new JSONContextData::Parser(*vm, is_hson, HSVM_Arg(1)));
        context->parsers[parser->GetId()] = parser;

        HSVM_IntegerSet(*vm, id_set, parser->GetId());
}

void JSONDecoderProcess(HSVM_VariableId id_set, VirtualMachine *vm)
{
        JSONContext context(vm->GetContextKeeper());

        int32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(1));

        bool success = false;
        JSONContextData::ParserPtr parser = context->parsers[id];
        if (parser.get())
        {
                success = !parser->jsonparser.HaveError();
                for (std::string::iterator it = data.begin(); it != data.end(); ++it)
                    if (!parser->jsonparser.HandleByte(static_cast< uint8_t >(*it)))
                    {
                            success = false;
                            break;
                    }
        }

        HSVM_BooleanSet(*vm, id_set, success);
}

void JSONDecoderFinish(HSVM_VariableId id_set, VirtualMachine *vm)
{
        JSONContext context(vm->GetContextKeeper());

        int32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JSONContextData::ParserPtr parser = context->parsers[id];
        if (parser.get())
            parser->jsonparser.Finish(id_set);
        else
            HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        context->parsers.erase(id);
}

void JSONDecoderQuick(HSVM_VariableId id_set, VirtualMachine *vm)
{
        JSONContext context(vm->GetContextKeeper());

        std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        bool is_hson = HSVM_BooleanGet(*vm, HSVM_Arg(1));

        JSONParser jsonparser(*vm, is_hson, HSVM_Arg(2));
        for (std::string::iterator it = data.begin(); it != data.end(); ++it)
            if (!jsonparser.HandleByte(static_cast< uint8_t >(*it)))
                break;

        jsonparser.Finish(id_set);
}

HSVM_PUBLIC void JHSONEncode(HSVM *vm, HSVM_VariableId input, HSVM_VariableId output, bool is_hson)
{
        JSONEncoder encoder(vm, 0);
        encoder.Encode(output, input, false, is_hson);
        encoder.Close();
}

void JSONEncodeToString(HSVM_VariableId id_set, VirtualMachine *vm)
{
        JSONEncoder encoder(*vm, HSVM_Arg(2));

        bool is_hson = HSVM_BooleanGet(*vm, HSVM_Arg(1));
        encoder.Encode(id_set, HSVM_Arg(0), false, is_hson);
        encoder.Close();
}

void JSONEncodeToBlob(HSVM_VariableId id_set, VirtualMachine *vm)
{
        JSONEncoder encoder(*vm, HSVM_Arg(2));

        bool is_hson = HSVM_BooleanGet(*vm, HSVM_Arg(1));
        encoder.Encode(id_set, HSVM_Arg(0), true, is_hson);
        encoder.Close();
}


namespace Baselibs
{

void InitJSON(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg)
{
        JSONContext::Register(creg);

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("JSONDECODERALLOCATE::I:BR", JSONDecoderAllocate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("JSONDECODERPROCESS::B:IS", JSONDecoderProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("JSONDECODERFINISH::R:I", JSONDecoderFinish));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("JSONDECODERQUICK::R:SBR", JSONDecoderQuick));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("JSONENCODETOSTRING::S:VBR", JSONEncodeToString));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("JSONENCODETOBLOB::X:VBR", JSONEncodeToBlob));
}

} // End of namespace Baselibs
} // End of namespace HareScript
