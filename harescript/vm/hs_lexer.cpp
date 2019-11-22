//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/lexer.h>
#include "hs_lexer.h"
#include "hsvm_constants.h"

using namespace Blex;

namespace HareScript
{

namespace /*anonymous*/
{

struct HardcodedKeyword
{
        const char *name;
        Lexer::Type type;
};

#define HCPARSER(name) { #name, Lexer::name },
#define HCPARSER_DU(name) { "__" #name, Lexer::DU_ ## name },
const HardcodedKeyword hardcodedkeywords[]={

/* Statements */
HCPARSER(Break)
HCPARSER(Case)
HCPARSER(Continue)
HCPARSER(Default)
HCPARSER(Delete)
HCPARSER(Else)
HCPARSER(For)
HCPARSER(Forevery)
HCPARSER(Function)
HCPARSER(If)
HCPARSER(Insert)
HCPARSER(Loadlib)
HCPARSER(Macro)
HCPARSER(Return)
HCPARSER(Select)
HCPARSER(Switch)
HCPARSER(Update)
HCPARSER(While)

/* Types */
HCPARSER(Array)
HCPARSER(Blob)
HCPARSER(Boolean)
HCPARSER(DateTime)
HCPARSER(FixedPoint)
HCPARSER(Float)
HCPARSER(Integer)
HCPARSER(Integer64)
HCPARSER(Money)
HCPARSER(Object)
HCPARSER(WeakObject)
HCPARSER(ObjectType)
HCPARSER(Private)
HCPARSER(Ptr)
HCPARSER(Public)
HCPARSER(Record)
HCPARSER(Ref)
HCPARSER(Schema)
HCPARSER(String)
HCPARSER(Table)
HCPARSER(Variant)

/* Other */

HCPARSER(Aggregate)
HCPARSER(All)
HCPARSER(And)
HCPARSER(As)
HCPARSER(Asc)
HCPARSER(At)
HCPARSER(__Attributes__)
HCPARSER(BitAnd)
HCPARSER(BitLShift)
HCPARSER(BitNeg)
HCPARSER(BitOr)
HCPARSER(BitRShift)
HCPARSER(BitXor)
HCPARSER(By)
HCPARSER(Catch)
HCPARSER(Cell)
HCPARSER(Column)
HCPARSER(Concat)
HCPARSER(ClassType)
HCPARSER(Cross)
HCPARSER(DefaultsTo)
HCPARSER(Desc)
HCPARSER(Distinct)
HCPARSER(End)
HCPARSER(Except)
HCPARSER(Export)
HCPARSER(Extend)
HCPARSER(False)
HCPARSER(Finally)
HCPARSER(From)
HCPARSER(Full)
HCPARSER(Goto)
HCPARSER(Group)
HCPARSER(Having)
HCPARSER(In)
HCPARSER(Index)
HCPARSER(Inner)
HCPARSER(Intersect)
HCPARSER(Into)
HCPARSER(Join)
HCPARSER(Key)
HCPARSER(Like)
HCPARSER(Limit)
HCPARSER(Member)
HCPARSER(New)
HCPARSER(Not)
HCPARSER(Null)
HCPARSER(Nvl)
HCPARSER(Offset)
HCPARSER(Only)
HCPARSER(Or)
HCPARSER(Order)
HCPARSER(Outer)
HCPARSER(Property)
HCPARSER(Sealed)
HCPARSER(Set)
HCPARSER(Static)
HCPARSER(Temporary)
HCPARSER(This)
HCPARSER(Throw)
HCPARSER(True)
HCPARSER(Try)
HCPARSER(TypeId)
HCPARSER(Unique)
HCPARSER(Using)
HCPARSER(Values)
HCPARSER(Var)
HCPARSER(VarType)
HCPARSER(Where)
HCPARSER(Xor)
HCPARSER(ExtendsFrom)
HCPARSER(Yield)
HCPARSER(Await)
HCPARSER(Async)
HCPARSER(__WithAsyncContext)
HCPARSER(ForEach)
HCPARSER(Const)
HCPARSER(Constant)
HCPARSER(Constexpr)
HCPARSER(__Constref)
HCPARSER(Constref)


{ 0, Lexer::Identifier } };

} /* end of anonymous namespace */

//---------------------------------------------------------------------------//
//                                                                           //
// HareScript Lexer                                                          //
//                                                                           //
//---------------------------------------------------------------------------//

///\todo A static MapVector of hardcodedkeywords is probably faster...

Lexer::Lexer(ErrorHandler *_errhandler)
{
        errorhandler=_errhandler;

        //Initialize symbol table
        for (const HardcodedKeyword *keyword=hardcodedkeywords;keyword->name;++keyword)
        {
                std::string name = keyword->name;
                Blex::ToUppercase(name.begin(),name.end());
                hardcoded_tokens.insert(std::make_pair(name,keyword->type));
        }
}

Lexer::~Lexer()
{
}

/* FIXME: StartLexer shouldn't just assume _bufferstart ends in a NUL byte and hope parsing stops there */
void Lexer::StartLexer(const uint8_t *_bufferstart,unsigned _bufferlength)
{
        //Setup reader variables
        bufferstart=_bufferstart;
        bufferend=_bufferstart+_bufferlength;

        //Is there a BOM at the front of the file (UTF-8 marker: ADDME: recognize other encodings as well)
        if(bufferend-bufferstart>=3 && bufferstart[0]==0xEF && bufferstart[1]==0xBB && bufferstart[2]==0xBF)
            bufferstart += 3; //skip the BOM

        //Initialize lexer state
        state.parse_curpos.line = 1;
        state.parse_curpos.column = 1;
        state.parse_lastpos.line = 1;
        state.parse_lastpos.column = 1;
        state.parse_lastwsstartpos.line = 1;
        state.parse_lastwsstartpos.column = 1;
        state.parse_lastcommentwsstartpos.line = 1;
        state.parse_lastcommentwsstartpos.column = 1;
        state.tokenstart=reinterpret_cast<const char*>(bufferstart);
        state.tokenlimit=state.tokenstart;
        state.tokenreadstate=TRSScriptStart;
        state.tokentype=FakeStartClosures;
        state.pending_semicolon=false;
        state.emitted_unexpected_eof=false;
        state.templatelevel=0;
        state.parsing_templatestring=false;
}

inline void Lexer::MoveByte()
{
        if (*state.tokenlimit=='\n')
        {
            ++state.parse_curpos.line;
            state.parse_curpos.column = 0;
        }
        //No more special treating of tabs: only the editor knows the tab width, so have the editor re-calculate columnn positions
        ++state.parse_curpos.column;
        ++state.tokenlimit;
}

/* ADDME: Shouldn't parsers like this be in Blexlib (espec. considering the bignum support and sharing with dbserver?) */
std::pair<DecimalFloat, char> Lexer::GetTokenNumber()
{
        DecimalFloat value;
        char postfix = ' ';
        const char *finish = state.tokenlimit;
        DecimalFloat::ParseResult res = value.ParseNumberString(state.tokenstart, state.tokenlimit, &postfix, &finish);

        std::string val = std::string(state.tokenstart, state.tokenlimit);

        switch (res)
        {
        case DecimalFloat::PR_FloatingPoint:
                {
                        if (postfix == ' ')
                            postfix = value.inaccurate ? 'F' : '.';
                } // Fallthrough
        case DecimalFloat::PR_Integer:
                {
                        return std::make_pair(value, postfix);
                }
        case DecimalFloat::PR_Error_ExpectedReal:
                {
                        AddError(Error::ExpectedReal);
                        return std::make_pair(value, postfix);
                }
        case DecimalFloat::PR_Error_IllegalIntegerConstant:
                {
                        AddError(Error::IllegalIntegerConstant);
                        return std::make_pair(value, postfix);
                }
        case DecimalFloat::PR_Error_IllegalExponent:
                {
                        AddError(Error::IllegalFloatExponent);
                        return std::make_pair(value, postfix);
                }
        default:
            throw std::runtime_error("Unknown parse result");
        }
}

//Handle a standard singlebyte token, which cannot be part of a multibyte token
#define SIMPLE_SINGLECHAR_TOKEN(c,type) case c: MoveByte(); state.tokentype=type; goto parser_return

//Handle a standard doublebyte token, which is not ambiguous with any other token that starts with the same character
#define SIMPLE_DOUBLECHAR_TOKEN(c,d,type) case c: MoveByte(); if (*state.tokenlimit!=d) { --state.tokenlimit; goto unexpected_token; } MoveByte(); state.tokentype=type; goto parser_return

//Handle standard doublebyte tokens, that can be ambiguous with a singlebyte token
//Call start_doublechar_token with the first character of the ambiguous token
#define START_DOUBLECHAR_TOKEN(c) case c: MoveByte(); switch (*state.tokenlimit) {
//Call doublechar_token for every doublebyte version of the token, with the seperate bytes as argument
#define DOUBLECHAR_TOKEN(c,d,type) case d: MoveByte(); state.tokentype=type; goto parser_return
//Call end_doublechar_token with the token that is represented by the singlebyte version of the token
#define END_DOUBLECHAR_TOKEN(c,type) default: state.tokentype=type; goto parser_return; }
//Or call it this version if there is no token represented by the singlebyte version
#define END_DOUBLECHAR_NOTOKEN default: goto unexpected_token; }

/* NextToken is our lexer. It is implemented as a state machine, using
   a switch() on tokenreadstate for the current state. To avoid a while()
   loop and continously reentering the state-switch, we use goto s to
   shortcut state-switching.

   ADDME: Pretty dirty code: we need a goto and always assign to tokenstring
          even though we don't need that 90%+ of the time */
void Lexer::MovetoNextToken()
{
        if (state.pending_semicolon)
        {
                state.tokentype=Semicolon; //return a ';'
                state.pending_semicolon=false;
                state.tokenstring=";";
                return;
        }

        bool open_templatestring_start = false, open_templatestring_limit = false;

        state.parse_lastwsstartpos = state.parse_curpos;
        if (state.tokentype != Comment)
            state.parse_lastcommentwsstartpos = state.parse_curpos;

        switch (state.tokenreadstate)
        {
        case TRSScriptStart:
                if (state.tokenlimit[0]=='#' && state.tokenlimit[1]=='!')
                {
                        // #! at start of file is a line comment
                        state.tokentype = Comment;

                        //Look for line end
                        while(true)
                        {
                                if (state.tokenlimit[0]=='\n')
                                {
                                        MoveByte();
                                        break;
                                }
                                if (!*state.tokenlimit) //EOF!
                                    break;
                                MoveByte();
                        }
                        state.tokenreadstate = TRSUnembedded;
                        goto parser_return;
                }
                //fallthrough
        case TRSUnembedded:
                //Skip over the last token
                state.tokenstart=state.tokenlimit;

                //Read as much unembedded data as we can
                /* (perhaps a small speed up is possible here using memstr s?) */
                while (*state.tokenlimit
                       && ! (state.tokenlimit[0]=='<'
                             && state.tokenlimit[1]=='?'
                             && state.tokenlimit[2]=='w'
                             && state.tokenlimit[3]=='h'
                             && Blex::IsWhitespace(state.tokenlimit[4])))
                {
                        MoveByte();
                }

                if (*state.tokenlimit) //switching to embedded harescript
                {
                        if (state.tokenstart==state.tokenlimit) //nothing to parse yet?
                            goto case_TRSStartHareScript;
                        //will do that later - first handle current code
                        state.tokenreadstate=TRSStartHareScript;
                }
                else
                {
                        if (state.tokenstart==state.tokenlimit) //nothing to parse yet
                            goto case_TRSHareScriptCode;
                        //will do that later - first handle current code
                        state.tokenreadstate=TRSEndOfFile;
                }
                state.tokentype=ExternalData;
                break;

        case_TRSStartHareScript:
        case TRSStartHareScript:
                //Skip over the harescript start bytes
                for (unsigned i=0;i<5;++i)
                    MoveByte();

                state.tokenreadstate=TRSHareScriptCode;

                //Parse harescript lines
                goto case_TRSHareScriptCode;

        case_TRSHareScriptCode:
        case TRSHareScriptCode:
                if (state.parsing_templatestring)
                {
                        open_templatestring_start = true;
                        state.parse_lastpos=state.parse_curpos;
                        state.tokenstart=state.tokenlimit;                          //Skip the last command
                        goto case_StringToken;
                }

                while (Blex::IsWhitespace(*state.tokenlimit))
                   MoveByte();

                state.parse_lastpos=state.parse_curpos;
                state.tokenstart=state.tokenlimit;                          //Skip the last command

                //Is this an endtag?
                switch (*state.tokenlimit)
                {
                case 0: //EOF
                        goto case_TRSEndOfFile;

                case '?': //Possible Harescript tag end
                        MoveByte(); //skip over '?'
                        if (*state.tokenlimit=='>')
                        {
                                MoveByte(); //skip over >
                                state.tokentype=Semicolon; //return a ';'
                                state.tokenreadstate=TRSUnembedded;
                                goto parser_return;
                        }
                        if (*state.tokenlimit=='?')
                        {
                                MoveByte(); //skip over '?'
                                state.tokentype=OpNullCoalesce;
                                goto parser_return;
                        }
                        state.tokentype=OpCond;
                        goto parser_return;

                case '/': //Possible comment start
                        MoveByte();
                        if (*state.tokenlimit=='/')
                        {
                                MoveByte();
                                state.tokentype = Comment;

                                //Look for comment end, or harescript code end
                                while(true)
                                {
                                        if (state.tokenlimit[0]=='\n')
                                        {
                                                MoveByte();
                                                goto parser_return;
                                        }
                                        if (!*state.tokenlimit) //EOF!
                                            goto parser_return;
                                        MoveByte();
                                }
                        }
                        else if (*state.tokenlimit=='*')
                        {
                                MoveByte();
                                state.tokentype = Comment;

                                //This starts a multi-line comment. Look for
                                //end of comment or end of harescript code
                                while(true)
                                {
                                        //Comment termination
                                        if (state.tokenlimit[0]=='*' && state.tokenlimit[1]=='/')
                                        {
                                                MoveByte();
                                                MoveByte();
                                                goto parser_return;
                                        }
                                        if (!*state.tokenlimit) //EOF!
                                        {
                                                AddWarning(Warning::UnterminatedComment);
                                                goto parser_return;
                                        }

                                        MoveByte();
                                }
                        }
                        //It's not a comment, so just make it a divider
                        state.tokentype=OpDivide;
                        goto parser_return;

                //Handle all unambiguous singlebyte tokens
                SIMPLE_SINGLECHAR_TOKEN(';',Semicolon);
                SIMPLE_SINGLECHAR_TOKEN('{',OpenBlock);
                SIMPLE_SINGLECHAR_TOKEN(',',Comma);
                SIMPLE_SINGLECHAR_TOKEN(')',CloseParenthesis);
                SIMPLE_SINGLECHAR_TOKEN('[',OpenSubscript);
                SIMPLE_SINGLECHAR_TOKEN(']',CloseSubscript);
                SIMPLE_SINGLECHAR_TOKEN('%',OpDivideRemainder);
                SIMPLE_SINGLECHAR_TOKEN('#',OpCount);
                SIMPLE_SINGLECHAR_TOKEN('^',OpHat);

                START_DOUBLECHAR_TOKEN('='); //handle = and =>
                  DOUBLECHAR_TOKEN('=','>',FunctionArrow);
                END_DOUBLECHAR_TOKEN('=',OpEquality);

                SIMPLE_DOUBLECHAR_TOKEN('|','|',OpMerge);         //handle ||
                SIMPLE_DOUBLECHAR_TOKEN('!','=',OpInequality); //handle !=

                SIMPLE_SINGLECHAR_TOKEN('(',OpenParenthesis);
                SIMPLE_SINGLECHAR_TOKEN('*',OpMultiply);

                START_DOUBLECHAR_TOKEN(':'); //handle :, :: and :=
                  DOUBLECHAR_TOKEN(':','=',OpAssignment);    //handle :=
                  DOUBLECHAR_TOKEN(':',':',ScopeResolution); //handle ::
                END_DOUBLECHAR_TOKEN(':',OpColon);

                START_DOUBLECHAR_TOKEN('<'); //handle <, <= and <>
                  DOUBLECHAR_TOKEN('<','=',OpLessThanOrEqual);
                  DOUBLECHAR_TOKEN('<','>',OpInequality);
                END_DOUBLECHAR_TOKEN('<',OpLessThan);

                START_DOUBLECHAR_TOKEN('>'); //handle > and >=
                  DOUBLECHAR_TOKEN('>','=',OpGreaterThanOrEqual);
                END_DOUBLECHAR_TOKEN('>',OpGreaterThan);

                START_DOUBLECHAR_TOKEN('+');
                  DOUBLECHAR_TOKEN('+','+',OpInc);
                END_DOUBLECHAR_TOKEN('+',OpAdd);

                START_DOUBLECHAR_TOKEN('-');
                  DOUBLECHAR_TOKEN('-','-',OpDec);
                  DOUBLECHAR_TOKEN('-','>',OpArrow);
                END_DOUBLECHAR_TOKEN('-',OpSubtract);

                SIMPLE_DOUBLECHAR_TOKEN('$','{',TemplatePlaceholderBlock); //handle ${ template string placeholder

                case '}': //Close block
                        MoveByte();
                        state.tokentype=CloseBlock;
                        // Close template placeholder
                        if (state.templatelevel)
                            state.parsing_templatestring = true; // Start parsing the rest of the template string
                        goto parser_return;

                case '`': //Template string token
                        ++state.templatelevel;
                        state.parsing_templatestring = true;
                        MoveByte();
                        // fallthrough

                case_StringToken:
                case '\"': //String token
                case '\'': //String token
                        if (!state.parsing_templatestring)
                            MoveByte();
                        while (true)
                        {
                                //ADDME: Record 'true' string length as well?
                                //ADDME: Don't allow strings longer than WH_HS_STRINGMAX
                                //ADDME: Convert broken strings into harmless tokens
                                //Find the end of the string, avoiding quoted characters
                                if (*state.tokenlimit==0
                                    || (!state.parsing_templatestring
                                        && (*state.tokenlimit=='\n'
                                            || *state.tokenlimit=='\r'))
                                    )
                                {
                                        AddError(Error::UnexpectedEndOfString);
                                        break;
                                }
                                //string end?
                                //start quote is end quote, or end quote is '`' after end of template placeholder

                                // End of normal string? (start quote is end quote)
                                if (!state.parsing_templatestring && *state.tokenlimit==*state.tokenstart)
                                {
                                        MoveByte();
                                        break;
                                }

                                if (state.parsing_templatestring && *state.tokenlimit == '`')
                                {
                                       --state.templatelevel;
                                        MoveByte();
                                        break;
                                }

                                //escape next character?
                                bool escaped = false;
                                if (state.tokenlimit[0]=='\\'
                                    && state.tokenlimit[1]!=0)
                                {
                                        MoveByte();
                                        escaped = true;
                                }
                                //template string placeholder start?
                                if (state.parsing_templatestring
                                    && state.tokenlimit[0]=='$')
                                {
                                        if (escaped)
                                            MoveByte();
                                        else if (state.tokenlimit[1]=='{')
                                        {
                                                open_templatestring_limit = true;
                                                break;
                                        }
                                }
                                MoveByte();
                        }
                        state.tokentype=state.parsing_templatestring ? TemplateString : ConstantString;
                        state.parsing_templatestring = false;
                        goto parser_return;

                default: // A number: just parse it loosely; don't bother about correctness
                        if ((*state.tokenlimit >= '0' && *state.tokenlimit <= '9') || *state.tokenlimit == '.')
                        {
                                bool isreal = false;

                                state.tokentype = ConstantNumber;

                                // Accept binary/decimal modifiers
                                if (*state.tokenlimit == '0')
                                {
                                        ++state.tokenlimit;

                                        if ((*state.tokenlimit & 0xDF) == 'B')
                                        {
                                                ++state.tokenlimit;
                                                while (*state.tokenlimit == '0' || *state.tokenlimit == '1')
                                                    ++state.tokenlimit;
                                                goto parser_return;
                                        } else if ((*state.tokenlimit & 0xDF) == 'X')
                                        {
                                                ++state.tokenlimit;
                                                while ((*state.tokenlimit >= '0' && *state.tokenlimit <= '9')
                                                        || ((*state.tokenlimit & 0xDF) >= 'A' && (*state.tokenlimit & 0xDF) <= 'F'))
                                                    ++state.tokenlimit;
                                                goto parser_return;
                                        }
                                        --state.tokenlimit;
                                }
                                else if (*state.tokenlimit == '.')
                                {
                                        MoveByte();
                                        if (*state.tokenlimit < '0' || *state.tokenlimit > '9')
                                        {
                                                if (*state.tokenlimit == '.')
                                                {
                                                        MoveByte();
                                                        if (*state.tokenlimit == '.')
                                                        {
                                                                MoveByte();
                                                                state.tokentype = OpEllipsis;
                                                                goto parser_return;
                                                        }
                                                        --state.tokenlimit;
                                                }

                                                state.tokentype = OpDot;
                                                goto parser_return;
                                        }
                                        isreal = true;
                                }

                                //ADDME: Could already start parsing the number
                                do
                                {
                                        isreal = isreal || (*state.tokenlimit == '.');
                                        MoveByte();
                                }
                                while ((*state.tokenlimit >= '0' && *state.tokenlimit <= '9') || *state.tokenlimit == '.');

                                if (*state.tokenlimit == 'i' || *state.tokenlimit == 'I')
                                {
                                        MoveByte();
                                        if (*state.tokenlimit == '6' && state.tokenlimit[1] == '4')
                                        {
                                                MoveByte();
                                                MoveByte();
                                        }
                                }
                                else if (*state.tokenlimit == 'm' || *state.tokenlimit == 'M')
                                    MoveByte();
                                else if (*state.tokenlimit == 'f' || *state.tokenlimit == 'F')
                                    MoveByte();
                                else if (*state.tokenlimit == 'e' || *state.tokenlimit == 'E')
                                {
                                        MoveByte();
                                        if (*state.tokenlimit == '-' || *state.tokenlimit == '+')
                                        {
                                                MoveByte();
                                                while (*state.tokenlimit >= '0' && *state.tokenlimit <= '9')
                                                    MoveByte();
                                        }
                                        else
                                        {
                                                while (*state.tokenlimit >= '0' && *state.tokenlimit <= '9')
                                                    MoveByte();
                                        }
                                }

                                goto parser_return;
                        }
                        //Attempt to parse a token
                        if (Blex::Lexer::ValidKeywordStart(*state.tokenlimit))
                        {
                                //This is some sort of word. Skip 'templatevalidchars'
                                do MoveByte();
                                while (Blex::Lexer::ValidKeywordChar(*state.tokenlimit));

                                if (RawTokenLength() > IdentifierMax)
                                {
                                        AddError(Error::IdentifierTooLong);
                                        state.tokenlimit=state.tokenstart+IdentifierMax;
                                        //ADDME: better resynch code (now we lose Lexer synch)
                                }
                                ///\todo mapvector would allow directly passing 'state.tokenstart,state.tokenlimit'
                                state.tokenstring.assign(state.tokenstart,state.tokenlimit);
                                state.tokenuppercase.assign(state.tokenstart,state.tokenlimit);
                                Blex::ToUppercase(state.tokenuppercase.begin(),state.tokenuppercase.end());

                                TokenList::const_iterator tokenitr=hardcoded_tokens.find(state.tokenuppercase);
                                if (tokenitr == hardcoded_tokens.end()) //not found..
                                {
                                        state.tokentype = Identifier;
                                }
                                else
                                {
                                        state.tokentype = tokenitr->second;
                                }
                                return;
                        }
                        goto unexpected_token;
                }
                unexpected_token:
                //This must be an unknown token
                if (!Blex::IsWhitespace(*state.tokenlimit))
                    MoveByte();
                state.tokentype=UnknownToken;
                goto parser_return;

        case TRSEndOfFile:
                // Make sure the last token is removed
                state.tokenstart=state.tokenlimit;
        case_TRSEndOfFile:
                state.tokentype=Eof;
                break;
        }

        parser_return:
        state.tokenstring.assign(state.tokenstart,state.tokenlimit);

        // If parsing a (partial) template string, make sure it's enclosed in `s
        // Also, normalize newlines
        if (state.tokentype==TemplateString)
        {
                if (open_templatestring_start)
                    state.tokenstring.insert(state.tokenstring.begin(), '`');
                if (open_templatestring_limit)
                    state.tokenstring.push_back('`');

                // We'll convert "\r\n" to "\n", then "\r" to "\n"
                size_t pos;
                while ((pos = state.tokenstring.find("\r\n")) != std::string::npos)
                    state.tokenstring.erase(pos, 1);
                while ((pos = state.tokenstring.find("\r")) != std::string::npos)
                    state.tokenstring.replace(pos, 1, "\n");
        }
}

void Lexer::AddError(Error::Codes error,
                              const std::string &msg1,
                              const std::string &msg2)
{
        LineColumn pos = (error == Error::ExpectedSemicolon) ? state.parse_lastcommentwsstartpos : state.parse_lastpos;

        if (!state.emitted_unexpected_eof)
            AddErrorAt(pos, error, msg1, msg2);
}

void Lexer::AddErrorAt(LineColumn const &pos,
                                Error::Codes error,
                                const std::string &msg1,
                                const std::string &msg2)
{
        if (!state.emitted_unexpected_eof)
            errorhandler->AddErrorAt(pos, error, msg1, msg2);
}

void Lexer::AddWarning(Warning::Codes warning,
                              const std::string &msg1,
                              const std::string &msg2)
{
        AddWarningAt(state.parse_lastpos, warning, msg1, msg2);
}

void Lexer::AddWarningAt(LineColumn const &pos,
                                Warning::Codes warning,
                                const std::string &msg1,
                                const std::string &msg2)
{
        errorhandler->AddWarningAt(pos, warning, msg1, msg2);
}

void Lexer::AddMessageAt(Blex::Lexer::LineColumn const &pos,
                                  Message const &message)
{
        errorhandler->AddMessageAt(pos, message);
}

void Lexer::AddErrorUnknown()
{
        switch (state.tokentype)
        {
        case Lexer::Identifier:
                AddError(Error::UnknownVariable,GetTokenIdentifier());
                return;
        case Lexer::UnknownToken:
                {
                        // This token could be invalid UTF-8
                        std::string encoded_token;
                        Blex::EncodeJSON(state.tokenstring.begin(), state.tokenstring.end(), std::back_inserter(encoded_token));

                        AddError(Error::UnknownToken, encoded_token);
                        return;
                }
        case Lexer::Eof:
                if (!state.emitted_unexpected_eof)
                    AddError(Error::UnexpectedEOF);
                state.emitted_unexpected_eof = true;
                return;
        default:
                AddError(Error::UnexpectedToken,state.tokenstring);
                return;
        }
}

void Lexer::SaveState(State *savestate)
{
        *savestate=state;
}

void Lexer::RestoreState(State *savestate)
{
        state=*savestate;
}

bool Lexer::IsValidIdentifier(std::string const &str) const
{
        if (str.empty() || str.size() > IdentifierMax || !Blex::Lexer::ValidKeywordStart(str[0]))
            return false;

        for (std::string::const_iterator it = str.begin() + 1; it != str.end(); ++it)
            if (!Blex::Lexer::ValidKeywordChar(*it))
                return false;

        std::string ustr(str);
        Blex::ToUppercase(ustr.begin(), ustr.end());

        // Search in list of hardcoded tokens
        TokenList::const_iterator tokenitr=hardcoded_tokens.find(ustr);
        return tokenitr == hardcoded_tokens.end();
}

void Lexer::DumpState() const
{
        char const *casted_bufferstart = reinterpret_cast< char const * >(bufferstart);
        char const *casted_bufferend = reinterpret_cast< char const * >(bufferend);

        const char *linestart = std::find(std::reverse_iterator< const char * >(state.tokenstart), std::reverse_iterator< const char * >(casted_bufferstart), '\n').base();
        const char *lineend = std::find(linestart, casted_bufferend, '\n');
        if (lineend != linestart && lineend[-1] == '\r')
            --lineend;

        unsigned offset = std::distance(reinterpret_cast<const char*>(linestart), state.tokenstart);

        std::string pos = Blex::AnyToString(state.parse_lastpos.line) + ": ";

        Blex::ErrStream() << pos + std::string(linestart, lineend);
        Blex::ErrStream() << std::string(pos.size() + offset, ' ') + "^" + (state.pending_semicolon ? " (inject Semicolon)" : "");
}

} // end of namespace HareScript
