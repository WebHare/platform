#include <ap/libwebhare/allincludes.h>


//---------------------------------------------------------------------------
#include "backend_sql_lexer.h"
#include "dbase_types.h"
#include <blex/lexer.h>
#include <ap/libwebhare/dbase.h>
#include <sstream>

namespace Database {
namespace SQL {

namespace /*anonymous*/
{

struct HardcodedKeyword
{
        const char *name;
        Lexer::Type type;
};

#define HCPARSER(name) { #name, Lexer::name },
const HardcodedKeyword hardcodedkeywords[]={
//Typenames
HCPARSER(Money)
HCPARSER(DateTime)
HCPARSER(Integer64)

HCPARSER(Absolute) HCPARSER(Action) HCPARSER(Add) HCPARSER(Admin) HCPARSER(After) HCPARSER(Aggregate)
HCPARSER(Alias) HCPARSER(All) HCPARSER(Allocate) HCPARSER(Alter) HCPARSER(And) HCPARSER(Any) HCPARSER(Are) HCPARSER(Array) HCPARSER(As) HCPARSER(Asc)
HCPARSER(Assertion) HCPARSER(At) HCPARSER(Authorization)
HCPARSER(Before) HCPARSER(Begin) HCPARSER(Binary) HCPARSER(Bit) HCPARSER(Blob) HCPARSER(Boolean) HCPARSER(Both) HCPARSER(Breadth) HCPARSER(By)
HCPARSER(Call) HCPARSER(Cascade) HCPARSER(Cascaded) HCPARSER(Case) HCPARSER(Cast) HCPARSER(Catalog) HCPARSER(Char) HCPARSER(Character)
HCPARSER(Check) HCPARSER(Class) HCPARSER(Clob) HCPARSER(Close) HCPARSER(Collate) HCPARSER(Collation) HCPARSER(Column) HCPARSER(Commit)
HCPARSER(Completion) HCPARSER(Connect) HCPARSER(Connection) HCPARSER(Constraint) HCPARSER(Constraints)
HCPARSER(Constructor) HCPARSER(Continue) HCPARSER(Corresponding) HCPARSER(Create) HCPARSER(Cross) HCPARSER(Cube) HCPARSER(Current)
HCPARSER(Current_Date) HCPARSER(Current_Path) HCPARSER(Current_Role) HCPARSER(Current_Time) HCPARSER(Current_Timestamp)
HCPARSER(Current_User) HCPARSER(Cursor) HCPARSER(Cycle)
HCPARSER(Data) HCPARSER(Date) HCPARSER(Day) HCPARSER(Deallocate) HCPARSER(Dec) HCPARSER(Decimal) HCPARSER(Declare) HCPARSER(Default)
HCPARSER(Deferrable) HCPARSER(Deferred) HCPARSER(Delete) HCPARSER(Depth) HCPARSER(Deref) HCPARSER(Desc) HCPARSER(Describe) HCPARSER(Descriptor)
HCPARSER(Destroy) HCPARSER(Destructor) HCPARSER(Deterministic) HCPARSER(Dictionary) HCPARSER(Diagnostics) HCPARSER(Disconnect)
HCPARSER(Distinct) HCPARSER(Domain) HCPARSER(Double) HCPARSER(Drop) HCPARSER(Dynamic)
HCPARSER(Each) HCPARSER(Else) HCPARSER(End) /*HCPARSER(End-Exec)*/ HCPARSER(Equals) HCPARSER(Escape) HCPARSER(Every) HCPARSER(Except)
HCPARSER(Exception) HCPARSER(Exec) HCPARSER(Execute) HCPARSER(External)
HCPARSER(False) HCPARSER(Fetch) HCPARSER(First) HCPARSER(Float) HCPARSER(For) HCPARSER(Foreign) HCPARSER(Found) HCPARSER(From) HCPARSER(Free) HCPARSER(Full)
HCPARSER(Function)
HCPARSER(General) HCPARSER(Get) HCPARSER(Global) HCPARSER(Go) HCPARSER(Goto) HCPARSER(Grant) HCPARSER(Group) HCPARSER(Grouping)
HCPARSER(Having) HCPARSER(Host) HCPARSER(Hour)
HCPARSER(Identity) HCPARSER(Ignore) HCPARSER(Immediate) HCPARSER(In) HCPARSER(Indicator) HCPARSER(Initialize) HCPARSER(Initially)
HCPARSER(Inner) HCPARSER(Inout) HCPARSER(Input) HCPARSER(Insert) HCPARSER(Int) HCPARSER(Integer) HCPARSER(Intersect) HCPARSER(Interval)
HCPARSER(Into) HCPARSER(Is) HCPARSER(Isolation) HCPARSER(Iterate)
HCPARSER(Join)
HCPARSER(Key)
HCPARSER(Language) HCPARSER(Large) HCPARSER(Last) HCPARSER(Lateral) HCPARSER(Leading) HCPARSER(Left) HCPARSER(Less) HCPARSER(Level) HCPARSER(Like)
HCPARSER(Limit)
HCPARSER(Local) HCPARSER(Localtime) HCPARSER(Localtimestamp) HCPARSER(Locator) HCPARSER(Map) HCPARSER(Match) HCPARSER(Minute) HCPARSER(Modifies) HCPARSER(Modify) HCPARSER(Module) HCPARSER(Month)
HCPARSER(Names) HCPARSER(National) HCPARSER(Natural) HCPARSER(Nchar) HCPARSER(Nclob) HCPARSER(New) HCPARSER(Next) HCPARSER(No) HCPARSER(None)
HCPARSER(Not) HCPARSER(Null) HCPARSER(Numeric)
HCPARSER(Object) HCPARSER(Of) HCPARSER(Off) HCPARSER(Old) HCPARSER(On) HCPARSER(Only) HCPARSER(Open) HCPARSER(Operation) HCPARSER(Option)
HCPARSER(Or) HCPARSER(Order) HCPARSER(Ordinality) HCPARSER(Out) HCPARSER(Outer) HCPARSER(Output) HCPARSER(Owner)
HCPARSER(Pad) HCPARSER(Parameter) HCPARSER(Parameters) HCPARSER(Partial) HCPARSER(Path) HCPARSER(Postfix) HCPARSER(Precision) HCPARSER(Prefix)
HCPARSER(Preorder) HCPARSER(Prepare) HCPARSER(Preserve) HCPARSER(Primary)
HCPARSER(Prior) HCPARSER(Privileges) HCPARSER(Procedure) HCPARSER(Public)
HCPARSER(Read) HCPARSER(Reads) HCPARSER(Real) HCPARSER(Recursive) HCPARSER(Ref) HCPARSER(References) HCPARSER(Referencing) HCPARSER(Relative)
HCPARSER(Restrict) HCPARSER(Result) HCPARSER(Return) HCPARSER(Returns) HCPARSER(Revoke) HCPARSER(Right)
HCPARSER(Role) HCPARSER(Rollback) HCPARSER(Rollup) HCPARSER(Routine) HCPARSER(Row) HCPARSER(Rows)
HCPARSER(Savepoint) HCPARSER(Schema) HCPARSER(Scroll) HCPARSER(Scope) HCPARSER(Search) HCPARSER(Second) HCPARSER(Section) HCPARSER(Select)
HCPARSER(Sequence) HCPARSER(Session) HCPARSER(Session_User) HCPARSER(Set) HCPARSER(Sets) HCPARSER(Size) HCPARSER(Smallint) HCPARSER(Some) HCPARSER(Space)
HCPARSER(Specific) HCPARSER(Specifictype) HCPARSER(Sql) HCPARSER(Sqlexception) HCPARSER(Sqlstate) HCPARSER(Sqlwarning) HCPARSER(Start)
HCPARSER(State) HCPARSER(Statement) HCPARSER(Static) HCPARSER(Structure) HCPARSER(System_User)
HCPARSER(Table) HCPARSER(Temporary) HCPARSER(Terminate) HCPARSER(Than) HCPARSER(Then) HCPARSER(Time) HCPARSER(Timestamp)
HCPARSER(Timezone_Hour) HCPARSER(Timezone_Minute) HCPARSER(To) HCPARSER(Trailing) HCPARSER(Transaction) HCPARSER(Translation)
HCPARSER(Treat) HCPARSER(Trigger) HCPARSER(True)
HCPARSER(Under) HCPARSER(Union) HCPARSER(Unique) HCPARSER(Unknown)
HCPARSER(Unnest) HCPARSER(Update) HCPARSER(Usage) HCPARSER(User) HCPARSER(Using)
HCPARSER(Value) HCPARSER(Values) HCPARSER(Varchar) HCPARSER(Variable) HCPARSER(Varying) HCPARSER(View)
HCPARSER(When) HCPARSER(Whenever) HCPARSER(Where) HCPARSER(With) HCPARSER(Without) HCPARSER(Work) HCPARSER(Write)
HCPARSER(Year)
HCPARSER(Zone)

//Unreserved words
HCPARSER(_system)
HCPARSER(Autonumber)
HCPARSER(ReadAccessManager)
HCPARSER(WriteAccessManager)
HCPARSER(NoUpdate)
HCPARSER(NoCirculairs)
HCPARSER(Maxlength)
HCPARSER(Index)
HCPARSER(Internal)
HCPARSER(Uppercase)
HCPARSER(Granted)
HCPARSER(Rename)
HCPARSER(Wait)
HCPARSER(Show)
HCPARSER(Move)
HCPARSER(Refresh_Metadata)
HCPARSER(NoNullStores)

{ 0, Lexer::Identifier } };

} /* end of anonymous namespace */

//---------------------------------------------------------------------------//
//                                                                           //
// HareScript Lexer                                                          //
//                                                                           //
//---------------------------------------------------------------------------//

///\todo A static MapVector of hardcodedkeywords is probably faster...

Lexer::Lexer()
{
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

        //Initialize lexer state
        state.parse_curpos.line = 1;
        state.parse_curpos.column = 1;
        state.parse_lastpos.line = 1;
        state.parse_lastpos.column = 1;
        state.tokenstart=reinterpret_cast<const char*>(bufferstart);
        state.tokenlimit=state.tokenstart;
        state.tokentype = Bof;
}

inline void Lexer::MoveByte()
{
        if (*state.tokenlimit=='\n')
        {
            ++state.parse_curpos.line;
            state.parse_curpos.column = 0;
        }
        if (*state.tokenlimit=='\t')
            state.parse_curpos.column += 8; // We assume a tab is 8 spaces FIXME 8?? WHY 8??
        else
            ++state.parse_curpos.column;
        ++state.tokenlimit;
}

uint32_t Lexer::GetTokenInteger()
{
        uint32_t value=0;
        const char *ptr=reinterpret_cast<const char*>(state.tokenstart);
        while (*ptr>='0' && *ptr<='9')
        {
                uint32_t newvalue=value * 10 + unsigned(*ptr-'0');
                if (newvalue<value || newvalue>0x7FFFFFFFL) /* Overflow? */
                {
                        AddError("Integer overflow");
                        return 0;
                }
                value=newvalue;
                ++ptr;
        }
        return value;
}
/*
Blex::DecimalFloat Lexer::GetTokenReal()
{
        Blex::DecimalFloat value={0, 0};
        int64_t digits=0;
        short exp=0;
        short expd=0;
        bool dot=false;
        const char *ptr=reinterpret_cast<const char*>(state.tokenstart);
        while ((*ptr>='0' && *ptr<='9') || *ptr=='.')
        {
                if (*ptr=='.')
                {
                        if (!dot)
                        {
                                dot=true;
                                if (digits==0)
                                    expd=-1;
                                else
                                    expd=0;
                        }
                        else
                        {
                                AddError("Expected a numeric (real) value");
                                value.digits=0;
                                value.exponent=0;
                                return value;
                        }
                }
                else
                {
                        digits=digits * 10 + unsigned(*ptr-'0');
                        exp+=expd;
                        if (!dot && expd==0)
                            expd=1;
                        else if (expd<0 && digits!=0)
                            expd=0;
                }
                ++ptr;
        }
        value.digits=digits;
        value.exponent=exp;
        return value;
}
*/

//Handle a standard singlebyte token, which cannot be part of a multibyte token
#define SIMPLE_SINGLECHAR_TOKEN(c,type) case c: MoveByte(); state.tokentype=type; goto parser_return

//Handle a standard doublebyte token, which is not ambiguous with any other token that starts with the same character
#define SIMPLE_DOUBLECHAR_TOKEN(c,d,type) case c: MoveByte(); if (*state.tokenlimit!=d) goto unexpected_token; MoveByte(); state.tokentype=type; goto parser_return

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

   FIXME: Pretty dirty code: we need a goto and always assign to tokenstring
          even though we don't need that 90%+ of the time */
void Lexer::MovetoNextToken()
{
        if (state.tokentype==Lexer::Eof)
            return;

        while (Blex::IsWhitespace(*state.tokenlimit))
           MoveByte();

        state.parse_lastpos=state.parse_curpos;
        state.tokenstart=state.tokenlimit;                          //Skip the last command

        //Is this an endtag?
        switch (*state.tokenlimit)
        {
        case 0: //EOF
                state.tokentype=Eof;
                return;

        //Handle all unambiguous singlebyte tokens
        SIMPLE_SINGLECHAR_TOKEN(';',Semicolon);
        SIMPLE_SINGLECHAR_TOKEN('/',OpDivide);
        SIMPLE_SINGLECHAR_TOKEN('{',OpenBlock);
        SIMPLE_SINGLECHAR_TOKEN('}',CloseBlock);
        SIMPLE_SINGLECHAR_TOKEN(',',Comma);
        SIMPLE_SINGLECHAR_TOKEN('(',OpenParenthesis);
        SIMPLE_SINGLECHAR_TOKEN(')',CloseParenthesis);
        SIMPLE_SINGLECHAR_TOKEN('[',OpenSubscript);
        SIMPLE_SINGLECHAR_TOKEN(']',CloseSubscript);
        SIMPLE_SINGLECHAR_TOKEN('*',OpMultiply);
        SIMPLE_SINGLECHAR_TOKEN('%',OpDivideRemainder);
        SIMPLE_SINGLECHAR_TOKEN('#',OpCount);
        SIMPLE_SINGLECHAR_TOKEN('+',OpAdd);
        SIMPLE_SINGLECHAR_TOKEN('-',OpSubtract);
//                SIMPLE_SINGLECHAR_TOKEN('.',OpDot);
        SIMPLE_SINGLECHAR_TOKEN('=',OpEquality);

        SIMPLE_DOUBLECHAR_TOKEN('|','|',OpMerge);         //handle ||
        SIMPLE_DOUBLECHAR_TOKEN('!','=',OpInequality); //handle !=

        START_DOUBLECHAR_TOKEN(':'); //handle : and :=
          DOUBLECHAR_TOKEN(':','=',OpAssignment);    //handle :=
        END_DOUBLECHAR_TOKEN(':',OpColon);

        START_DOUBLECHAR_TOKEN('<'); //handle <, <= and <>
          DOUBLECHAR_TOKEN('<','=',OpLessThanOrEqual);
          DOUBLECHAR_TOKEN('<','>',OpInequality);
        END_DOUBLECHAR_TOKEN('<',OpLessThan);

        START_DOUBLECHAR_TOKEN('>'); //handle > and >=
          DOUBLECHAR_TOKEN('>','=',OpGreaterThanOrEqual);
        END_DOUBLECHAR_TOKEN('>',OpGreaterThan);


        case '\"': //String token
        case '\'': //String token
                MoveByte();
                while (true)
                {
                        //ADDME: Record 'true' string length as well?
                        //ADDME: Don't allow strings longer than WH_HS_STRINGMAX
                        //ADDME: Convert broken strings into harmless tokens
                        //Find the end of the string, avoiding quoted characters
                        if (*state.tokenlimit==0
                            || *state.tokenlimit=='\n'
                            || *state.tokenlimit=='\r')
                        {
                                AddError("Unexpected end of string");
                                break;
                        }
                        //string end?
                        if (*state.tokenlimit==*state.tokenstart)
                        {
                                MoveByte();
                                break;
                        }
                        //escape next character?
                        if (state.tokenlimit[0]=='\\'
                            && state.tokenlimit[1]!=0)
                        {
                                MoveByte();
                        }
                        MoveByte();
                }
                state.tokentype=ConstantString;
                goto parser_return;

        default:
                if ((*state.tokenlimit >= '0' && *state.tokenlimit <= '9') || *state.tokenlimit == '.')
                {
                        bool isreal;
                        if (*state.tokenlimit == '.')
                        {
                                MoveByte();
                                if (*state.tokenlimit < '0' || *state.tokenlimit > '9')
                                {
                                        state.tokentype = OpDot;
                                        goto parser_return;
                                }
                                isreal = true;
                        }
                        else
                        {
                                isreal = false;
                        }
                        //ADDME: Could already start parsing the number
                        do
                        {
                                isreal = isreal || (*state.tokenlimit == '.');
                                MoveByte();
                        }
                        while ((*state.tokenlimit >= '0' && *state.tokenlimit <= '9') || *state.tokenlimit == '.');
                        state.tokentype = isreal ? ConstantReal : ConstantInteger;
                        goto parser_return;
                }
                //Attempt to parse a token
                if (Blex::Lexer::ValidKeywordStart(*state.tokenlimit))
                {
                        //This is some sort of word. Skip 'templatevalidchars'
                        do MoveByte();
                        while (Blex::Lexer::ValidKeywordChar(*state.tokenlimit));

                        if (RawTokenLength() > Database::MaxNameLen)
                        {
                                AddError("Identifier too long");
                                state.tokenlimit=state.tokenstart+MaxNameLen;
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

        parser_return:
        state.tokenstring.assign(state.tokenstart,state.tokenlimit);
}

void Lexer::AddError(std::string const &error)
{
        std::ostringstream err;
        err << error << " at position " << state.parse_lastpos.column;
        throw Database::Exception(ErrorIllegalSQLCommand,err.str());
}

void Lexer::SaveState(LState *savestate)
{
        *savestate=state;
}

void Lexer::RestoreState(LState *savestate)
{
        state=*savestate;
}

std::string Lexer::GetKeyWord(Type type) const
{
        for (TokenList::const_iterator it = hardcoded_tokens.begin(); it != hardcoded_tokens.end(); ++it)
            if (it->second == type)
                return it->first;
        return std::string();
}


} // end of namespace SQL
} // end of namespace Database
