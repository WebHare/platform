#ifndef blex_harescript_shared_hs_lexer
#define blex_harescript_shared_hs_lexer

#include "errors.h"
#include <blex/lexer.h>
#include <blex/decimalfloat.h>

namespace HareScript
{

/** The HareScriptLexer maintains the symbol table, and does tokenization */
class BLEXLIB_PUBLIC Lexer
{
        public:
        ///Token subclasses
        enum Type
        {
                //All closure types (grouped before anything else for the benefit of EatTillClosure)
                FakeStartClosures,
                Eof,                    //end of file
                ExternalData,           //unembbedded data
                Semicolon,              // ';'
                OpenBlock,              // '{'
                CloseBlock,             // '}'
                FakeEndFinalClosures,      //last closure that ends _any_ command line
                Comma,                  // ','
                CloseParenthesis,       // ')'
                CloseSubscript,         // ']'
                FakeEndClosures,           //last closure that ends _any_ expression

                //Comment types
                Comment,                //< Webhare comment

                //General types
                Identifier,             //an identifier
                UnknownToken,           //an unknown (but definately invalid) token

                //Operator types
                ConstantString,         //string enclosed in "s or 's
//                ConstantInteger,        //integer value
//                ConstantMoney,          //money value
//                ConstantFloat,          //floating-point value
                ConstantNumber,         //number value
                OpenParenthesis,        // '('
                OpenSubscript,          // '['
                ScopeResolution,        // '::'
                FunctionArrow,          // '=>'

                //Unary types
                Not,
                OpCount,                  // '#'
                OpInc,                    // '++'
                OpDec,                    // '--'
                OpHat,                    // '^'

                //Ternary types - operators
                OpCond,                   // ?
                OpColon,                  // :

                //Compiler directives
                CompStart,                // (*
                CompEnd,                  // *) end compiler directive

                //Binary types - operators
                In,
                Like,
                Concat,
                OpAdd,                    // '+'
                OpSubtract,               // '-'
                OpMultiply,               // '*'
                OpDivide,                 // '/'
                OpDivideRemainder,        // '%'
                OpDot,                    // '.'
                OpArrow,                  // '->'
                OpMerge,                  // ||
                OpAssignment,             // :=
                OpEquality,               // =
                OpGreaterThan,            // >
                OpLessThan,               // <
                OpGreaterThanOrEqual,     // >=
                OpLessThanOrEqual,        // <=
                OpInequality,             // != or <>

                FakeReservedWordsStart,

                BitNeg,
                BitAnd,
                BitOr,
                BitXor,
                BitLShift,
                BitRShift,

                //Typenames
                FakeTypenamesStart,

                Variant,                // Only allowed as external function return and parameter
                Boolean,
                String,
                Integer,
                Integer64,
                Money,
                Float,
                Record,
                Blob,
                DateTime,
                Table,
                Schema,
                Object,
                WeakObject,

                FakeTypenamesEnd,

                //Modifiers
                Public,
                Private,

                //Binary types - keywords
                And,
                Xor,
                Or,
                OpNullCoalesce,           // ??

                // Spread/destructuring
                OpEllipsis,               // '...'

                //Statements
                If,
                Forevery,
                For,
                While,
                Function,
                Macro,
                Return,
                Break,
                Continue,
                Else,
                Loadlib,
                Switch,

                //Keywords
                True,
                From,           //also used by SQL
                False,
                Export,
                Extend,
                Case,
                DefaultsTo,

                //SQL Statements
                Select,
                Update,
                Insert,
                Delete,      //also an operator

                //SQL Keywords
                As,
                Where,
                Order,
                By,
                Desc,
                Asc,
                Set,
                Temporary,
                Column,
                Into,
                Values,
                Var,
                Default,
                Null,
                Array,
                At,
                End,
                Key,

                //Reserved words, just to be sure that we can use them in the future
                New,
                Aggregate,
                Index,
                FixedPoint,
                Distinct,
                All,
                Unique,
                Intersect,
                Except,
                Limit,
                Offset,
                Group,
                Having,
                Using,
                Only,
                Join,
                Inner,
                Full,
                Outer,
                Cross,
                Goto,
                __Attributes__,
                Cell,
                TypeId,
                Ptr,
                Ref,
                Nvl,
                ClassType,
                ObjectType,
                VarType,
                Try,
                Catch,
                Property,
                Sealed,
                Static,
                This,
                Throw,
                Member,
                Finally,
                ExtendsFrom,
                Yield,
                Async,
                Await,
                __WithAsyncContext,
                ForEach,
                Const,
                Constant,
                Constexpr,
                __Constref,
                Constref,

                TemplateString,           //string enclosed in `s
                TemplatePlaceholderBlock  // '${'
        };

        ///Lexer read states
        enum TokenReadState
        {
                ///First byte of the script, inside unembedded data (outside <?wh ?> tags)
                TRSScriptStart,
                ///Inside unembedded data (outside <?wh ?> tags)
                TRSUnembedded,
                ///Just hit the start of a harescript block (tokenstart+length -> "<?wh ")
                TRSStartHareScript,
                ///Parsing harescript code statements
                TRSHareScriptCode,
                ///End of file
                TRSEndOfFile
        };

        struct State
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
                ///State of the token generator
                TokenReadState tokenreadstate;
                ///Lexer's current position
                Blex::Lexer::LineColumn parse_curpos;
                ///Position of last parsed token
                Blex::Lexer::LineColumn parse_lastpos;
                ///Position of start of whitespace before last parsed token
                Blex::Lexer::LineColumn parse_lastwsstartpos;
                ///Position of start of whitespace before last parsed non-comment token
                Blex::Lexer::LineColumn parse_lastcommentwsstartpos;
                ///Pending (fake) semicolon token?
                bool pending_semicolon;
                ///Did we emit an unexpected eof?
                bool emitted_unexpected_eof;

                int templatelevel;
                bool parsing_templatestring;

                friend class Lexer;
        };

        /** Lexer constructor */
        Lexer(ErrorHandler *_errhandler);

        /** Lexer destructor */
        ~Lexer();

        /** Start the lexer and have it read its first token */
        void StartLexer(const uint8_t *_bufferstart,unsigned _bufferlength);

        /** Obtains a workable representation of the number
            @return
                .first  : value
                .second : Uppercase suffix, '.' (nu suffix, but a dot present), ' ' no suffix, no dot. */
        std::pair<Blex::DecimalFloat, char> GetTokenNumber();

        /** Save the current lexer state (needed when wanting to peak-ahead) */
        void SaveState(State *stateobject);

        /** Restore a saved lexer state (needed when wanting to peak-ahead) */
        void RestoreState(State *stateobject);

        /** Instruct the lexer to read the next token */
        void MovetoNextToken();

        /** Record error on current cursor position */
        void AddError(Error::Codes error,
                               const std::string &msg1=std::string(),
                               const std::string &msg2=std::string());

        /** Positioned error recorder */
        void AddErrorAt(Blex::Lexer::LineColumn const &pos,
                                 Error::Codes error,
                                 const std::string &msg1=std::string(),
                                 const std::string &msg2=std::string());

        /** Record warning on current cursor position */
        void AddWarning(Warning::Codes warning,
                               const std::string &msg1=std::string(),
                               const std::string &msg2=std::string());

        /** Positioned warning recorder */
        void AddWarningAt(Blex::Lexer::LineColumn const &pos,
                                 Warning::Codes warning,
                                 const std::string &msg1=std::string(),
                                 const std::string &msg2=std::string());

        /** Record warning on current cursor position */
        void AddMessageAt(Blex::Lexer::LineColumn const &pos,
                                   Message const &message);

        /** Record current token as an Unknown variable error */
        void AddErrorUnknown();

        /** Get the current token */
        inline Type GetToken() const
        {
                return state.tokentype;
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

        /** Is token of a type? */
        inline bool IsTokenVarType() const
        {
                return GetToken()>Lexer::FakeTypenamesStart && GetToken()<Lexer::FakeTypenamesEnd;
        }

        /** Get the position of whitespace before token */
        inline Blex::Lexer::LineColumn GetWhitespacePosition() const
        {
                return state.parse_lastwsstartpos;
        }

        /** Get the startposition of all comments/whitespace before token */
        inline Blex::Lexer::LineColumn GetWhitespaceCommentPosition() const
        {
                return state.parse_lastcommentwsstartpos;
        }

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

        /** At end of file (this token is last token) ? */
        inline bool AtEndOfFile() const
        {
                return state.tokenreadstate == TRSEndOfFile;
        }

        /** Is the given string a valid identifier? */
        bool IsValidIdentifier(std::string const &str) const;

        void DumpState() const;

        private:
        /** Move the internal cursor one byte, updating parse_curline if necessary */
        inline void MoveByte();

        ///Current parser state
        State state;

        ///Pointer to the start of the current template file in memory (which is termianted by a NUL byte)
        const uint8_t *bufferstart;
        ///Pointer past the end of the buffer
        const uint8_t *bufferend;

        ///Current errorhandler (the one containing AddError)
        ErrorHandler *errorhandler;

        //std::vector<const SymbolTable*> additionaltables;

        typedef std::map<std::string,Type > TokenList;

        TokenList hardcoded_tokens;

        friend struct FuncArg;
};

} // end of namespace HareScript

#endif /*sentry */
