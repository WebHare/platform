#ifndef blex_webhare_dbase_sql_lexer
#define blex_webhare_dbase_sql_lexer

#include <blex/lexer.h>
//#include <blex/decimalfloat.h>

//ADDME: Try to share code between this and the HareScript lexer

namespace Database {
namespace SQL {

/** The HareScriptLexer maintains the symbol table, and does tokenization */
class Lexer
{
        public:
        ///Token subclasses
        enum Type
        {
                //All closure types (grouped before anything else for the benefit of EatTillClosure)
                _StartClosures,
                Bof,                    //begin of file
                Eof,                    //end of file
                Semicolon,
                OpenBlock,
                CloseBlock,
                _EndFinalClosures,      //last closure that ends _any_ command line
                Comma,                  // ','
                CloseParenthesis,       // ')'
                CloseSubscript,         // ']'
                _EndClosures,           //last closure that ends _any_ expression

                //General types
                Identifier,             //an identifier
                UnknownToken,           //an unknown (but definately invalid) token

                //Operator types
                ConstantString,         //string enclosed in "s or 's
                ConstantInteger,        //integer value
                ConstantReal,           //real value
                OpenParenthesis,        // '('
                OpenSubscript,          // '['

                //Unary types
                OpCount,                // '#'

                //Binary types - operators
                OpAdd,                    // '+'
                OpSubtract,               // '-'
                OpMultiply,               // '*'
                OpDivide,                 // '/'
                OpDivideRemainder,        // '%'
                OpDot,                    // '.'
                OpMerge,                  // ||
                OpAssignment,             // :=
                OpEquality,               // =
                OpGreaterThan,            // >
                OpLessThan,               // <
                OpGreaterThanOrEqual,     // >=
                OpLessThanOrEqual,        // <=
                OpInequality,             // != or <>

                //Ternary types - operators
                OpCond,                   // ?
                OpColon,                  // :

                //Our extensions
                Money,
                DateTime,
                Integer64,

                //SQL-specified reserved words
                  Marker_ReservedWords //Start of reserved words
                , Absolute , Action , Add , Admin , After , Aggregate
                , Alias , All , Allocate , Alter , And , Any , Are , Array , As , Asc
                , Assertion , At , Authorization
                , Before , Begin , Binary , Bit , Blob , Boolean , Both , Breadth , By
                , Call , Cascade , Cascaded , Case , Cast , Catalog , Char , Character
                , Check , Class , Clob , Close , Collate , Collation , Column , Commit
                , Completion , Connect , Connection , Constraint , Constraints
                , Constructor , Continue , Corresponding , Create , Cross , Cube , Current
                , Current_Date , Current_Path , Current_Role , Current_Time , Current_Timestamp
                , Current_User , Cursor , Cycle
                , Data , Date , Day , Deallocate , Dec , Decimal , Declare , Default
                , Deferrable , Deferred , Delete , Depth , Deref , Desc , Describe , Descriptor
                , Destroy , Destructor , Deterministic , Dictionary , Diagnostics , Disconnect
                , Distinct , Domain , Double , Drop , Dynamic
                , Each , Else , End , /*End-Exec, */  Equals , Escape , Every , Except
                , Exception , Exec , Execute , External
                , False , Fetch , First , Float , For , Foreign , Found , From , Free , Full
                , Function
                , General , Get , Global , Go , Goto , Grant , Group , Grouping
                , Having , Host , Hour
                , Identity , Ignore , Immediate , In , Indicator , Initialize , Initially
                , Inner , Inout , Input , Insert , Int , Integer , Intersect , Interval
                , Into , Is , Isolation , Iterate
                , Join
                , Key
                , Language , Large , Last , Lateral , Leading , Left , Less , Level , Like
                , Limit
                , Local , Localtime , Localtimestamp , Locator, Map , Match , Minute , Modifies , Modify , Module , Month
                , Names , National , Natural , Nchar , Nclob , New , Next , No , None
                , Not , Null , Numeric
                , Object , Of , Off , Old , On , Only , Open , Operation , Option
                , Or , Order , Ordinality , Out , Outer , Output, Owner
                , Pad , Parameter , Parameters , Partial , Path , Postfix , Precision , Prefix
                , Preorder , Prepare , Preserve , Primary
                , Prior , Privileges , Procedure , Public
                , Read , Reads , Real , Recursive , Ref , References , Referencing , Relative
                , Restrict , Result , Return , Returns , Revoke , Right
                , Role , Rollback , Rollup , Routine , Row , Rows
                , Savepoint , Schema , Scroll , Scope , Search , Second , Section , Select
                , Sequence , Session , Session_User , Set , Sets , Size , Smallint , Some, Space
                , Specific , Specifictype , Sql , Sqlexception , Sqlstate , Sqlwarning , Start
                , State , Statement , Static , Structure , System_User
                , Table , Temporary , Terminate , Than , Then , Time , Timestamp
                , Timezone_Hour , Timezone_Minute , To , Trailing , Transaction , Translation
                , Treat , Trigger , True
                , Under , Union , Unique , Unknown
                , Unnest , Update , Usage , User , Using
                , Value , Values , Varchar , Variable , Varying , View
                , When , Whenever , Where , With , Without , Work , Write
                , Year
                , Zone

                , Marker_UnreservedWords //Add our extensions here
                , _system //_System is reserved by C++
                , Autonumber
                , Internal
                , ReadAccessManager
                , WriteAccessManager
                , NoUpdate
                , NoCirculairs
                , Maxlength
                , Index
                , Uppercase
                , Granted
                , Rename
                , Wait
                , Show
                , Move
                , Refresh_Metadata
                , NoNullStores
        };

        struct LState
        {
                private:
                ///Start pointer of the current token
                const char *tokenstart;
                ///Limit of the current token
                const char *tokenlimit;
                ///Type of the current token
                Type tokentype;
                ///String contents of the current token
                std::string tokenstring;
                ///Token in uppercase
                std::string tokenuppercase;
                ///Lexer's current position
                Blex::Lexer::LineColumn parse_curpos;
                ///Position of last parsed token
                Blex::Lexer::LineColumn parse_lastpos;

                friend class Lexer;
        };

        /** Lexer constructor */
        Lexer();

        /** Lexer destructor */
        ~Lexer();

        /** Start the lexer and have it read its first token */
        void StartLexer(const uint8_t *_bufferstart,unsigned _bufferlength);

        /** Obtain an integer in range 0-2,147,483,647 from the current token
            @return The integer, or 0 if it was out of range
                   (in which case an HSERR_INTEGEROVERFLOW is also registered) */
        uint32_t GetTokenInteger();

        /** Obtain a real value (double) from the current token
            @return The real value, or 0 if it was out of range
                   (in which case an HSERR_INTEGEROVERFLOW is also registered) */
//        Blex::DecimalFloat GetTokenReal();

        /** Save the current lexer state (needed when wanting to peak-ahead) */
        void SaveState(LState *stateobject);

        /** Restore a saved lexer state (needed when wanting to peak-ahead) */
        void RestoreState(LState *stateobject);

        /** Instruct the lexer to read the next token */
        void MovetoNextToken();

        /** Record error on current cursor position */
        void AddError(std::string const &error);

        /** Get the current token */
        inline Type GetToken() const
        {
                return state.tokentype;
        }
        inline bool IsReservedWord() const
        {
                return GetToken() > Marker_ReservedWords && GetToken() < Marker_UnreservedWords;
        }
        inline bool IsName() const
        {
                return GetToken()==Lexer::Identifier || GetToken()==Lexer::ConstantString || GetToken() > Marker_UnreservedWords;
        }
        inline const std::string& GetTokenSTLString() const
        {
                return state.tokenstring;
        }

        inline const std::string& GetTokenIdentifier() const
        {
                return state.tokenuppercase;
        }

        /** Get the current token length (intended for debugging only) */
        inline unsigned RawTokenLength() const
        {
                return state.tokenlimit-state.tokenstart;
        }

        /** Get the current token data (intended for debugging only) */
        inline const char* RawTokenData() const
        {
                return reinterpret_cast<const char*>(state.tokenstart);
        }

        /** Add an alternative symbol table for function lookups */
        //void AddSymbolTable(const SymbolTable *symtable);

        /** Get the token's position */
        inline Blex::Lexer::LineColumn GetPosition() const
        {
                return state.parse_lastpos;
        }

        /** Get the token's line number */
        inline unsigned GetLineNumber() const
        {
                return state.parse_lastpos.line;
        }

        /** Get the string of a particular keyword */
        std::string GetKeyWord(Type type) const;

        private:
        /** Move the internal cursor one byte, updating parse_curline if necessary */
        inline void MoveByte();

        ///Current parser state
        LState state;

        ///Pointer to the start of the current template file in memory (which is termianted by a NUL byte)
        const uint8_t *bufferstart;
        ///Pointer past the end of the buffer
        const uint8_t *bufferend;

        typedef std::map< std::string, Type > TokenList;

        TokenList hardcoded_tokens;

        friend struct FuncArg;
};

} // end of namespace SQL
} // end of namespace Database

#endif /*sentry */
