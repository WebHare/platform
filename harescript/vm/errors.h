#ifndef blex_harescript_shared_errors
#define blex_harescript_shared_errors

#include <blex/lexer.h>

#include <stack>
#include <set>
#include <list>

#include "hsvm_constants.h"

namespace HareScript
{

typedef Blex::Lexer::LineColumn LineColumn;

struct BLEXLIB_PUBLIC Message
{
    public:
        Message(
                bool iserror,
                int32_t code,
                const std::string &msg1 = std::string(),
                const std::string &msg2 = std::string());

        ~Message();

        bool iserror;
        std::string filename;
        std::string func;
        Blex::Lexer::LineColumn position;
        int32_t code;
        std::string msg1, msg2;

        bool operator != (Message const & rhs) const;
        bool operator == (Message const & rhs) const { return !(*this != rhs); }
        bool IsIdentical(Message const & rhs) const;
};

namespace Error
{
        enum Codes
        {
                InternalError              =   0,
                CannotFindLibrary          =   1,
                CannotFindCompiledLibrary  =   2,
                CannotWriteCompiledLibrary =   3,
                AlreadyGloballyDefined     =   4,
                CompilationFailed          =   5,
                DuplicateArgumentName      =   6,
                ModuleInternalError        =   7,
                ExpectedForeveryFrom       =   8,
                UnknownVariable            =   9,
                UnexpectedEndOfString      =  10,
                EndWithoutArray            =  11,
                AggregateInWhereUsesOwnSelect = 12,
                VarAlreadyDefinedInScope   =  13,
                NoFunctionsInComplicatedProperties =  14,
                VariantNotAllowed          =  15,
                LoadlibNeedsLibraryName    =  16,
                ExpectedOpeningParenthesis =  17,
                NoTemporaryStorage         =  18,
                NoUseTemporaryWithinAggregate = 19,
                ImproperDeinitMacro        =  20,
                MultipleDeinitMacros       =  21,
                ExpectedFunctionMacroName  =  22,
                CallingDefaultFunctionPtr  =  23,
                InvalidCompilerDirective   =  24,
                InvalidAttributes          =  25,
                ExpectedClosingParenthesis =  26,
                ExpectedLikeOrInAfterNot   =  27,
                ExpectedClosingBracket     =  28,
                ExpectedGreaterThan        =  29,
                AttributeTerminatesOnlyForMacro = 30,
                ModuleLoadFailed           =  31,
                MacroDidntTerminateScript  =  32,
                CalledVMGone               =  33,
                ExpectedColumnName         =  34,
                ScriptAbortedDisconnect    =  35,
                ScriptAbortedTimeout       =  36,
                ExpectedSchemaDef          =  37,
                ExpectedTable              =  38,
                CannotCastSchema           =  39,
                NoSchemaArray              =  40,
                TypeSchemaNotAllowed       =  41,
                TypeSchemaNotInCell        =  42,
                TableDoesNotExistInSchema  =  43,
                ExpectedTableName          =  44,
                DuplicateCase              =  45,
                ArrayIndexOutOfBounds      =  46,
                RecordDoesNotExist         =  47,
                TableColNameAlreadyUsed    =  48,
                ExpectSchemaName           =  49,
                ExpectLike                 =  50,
                ColumnDeleteOnlyFromStar   =  51,
                OnlyColumnsAllowedInGroupBy = 52,
                NonGroupedNotAllowedOutsideAggregate = 53,
                AggregateOnlyInsideSelect  =  54,
                AggregateSignatureWrong    =  55,
                CannnotAggregateArrays     =  56,
                DivisionByZero             =  57,
                FunctionAsTableSource      =  58,
                ExpectedAsterisk           =  59,
                CircularReference          =  60,
                NoSelectStarWhenGrouped    =  61,
                CannotConvertType          =  62,
                NoTypeDefaultValue         =  63,
                FunctionsTopLevelOnly      =  64,
                TooManyMessages            =  65,
                IndependentWhere           =  66,
                MayNotBeUsedAsName         =  67,
                IntegerOverflow            =  68,
                ThisOnlyInMemberFunctions  =  69,
                ExpectedSemicolon          =  70,
                ExpectedClosingCurlyBrace  =  71,
                UnknownToken               =  72,
                UnexpectedToken            =  73,
                ThisIsConstant             =  74,
                ExpectedObjectDef          =  75,
                UnknownObjectType          =  76,
                FunctionIsNotAMember       =  77,
                MemberSignatureWrong       =  78,
                SelectExprMustHaveName     =  79,
                SelectStarMayHaveNoName    =  80,
                NoDefaultsInMemberDefinition = 81,
                ExpectedArrowOperator      = 82,
                ExpectedSQLClause          =  83,
                ExpectedDotOperator        = 84,
                MisspelledVariable         =  85,
                MisspelledColumn           =  86,
                ExpectedOpeningCurlyBrace  =  87,
                MisspelledFunction         =  88,
                NowDeclaringVariable       =  89,
                NoObjectTypeHere           =  90,
                DereferencedDefaultObject  =  91,
                UnknownColumn              =  92,
                AmbiguousColumnColumn      =  93,
                InvalidDefault             =  94,
                ExpectedVariable           =  95,
                ExpectedObjectType         =  96,
                MacroDoesNotReturnValue    =  97,
                MacroNoReturnValue         =  98,
                FunctionMustReturnValue    =  99,
                ScriptNoReturnCode         = 100,
                ExpectedIntoAfterInsert    = 101,
                MemberDeclaredTwice        = 102,
                MemberDoesNotExist         = 103,
                MethodNotDefined           = 104,
                PrivateMemberOnlyThroughThis = 105,
                NoPropertyAsGetterSetter   = 106,
                NoCounterForTable          = 107,
                ExpectedLvalue             = 108,
                LengthWrongType            = 109,
                MemberAlreadyExists        = 110,
                NotObjectMethod            = 111,
                UnexpectedCloseCurlyBrace  = 112,
                IdentifierTooLong          = 113,
                AmbiguousSymbol            = 114,
                NoUpdateForVarMembers      = 115,
                MemberNeededForUpdate      = 116,
                ColumnsMustBeExplicit      = 117,
                NeedCompatibleSignatures   = 118,
                GetterSignatureWrong       = 119,
                SetterSignatureWrong       = 120,
                UpdateReqForFieldOverride  = 121,
                IOError                    = 122,
                ConditionMustBeBoolean     = 123,
                OverrideMemberTypeChange   = 124,
                ParentCallOnlyInMemberFunctions = 125,
                RadixOutOfRange            = 126,
                DecimalsOutOfRange         = 127,
                BaseMemberOnlyForFunctions = 128,
                MemberFunctionWriteDisallowed = 129,
                TypeNotArray               = 130,
                ExpectedColon              = 131,
                MemberDeleteNotAllowed     = 132,
                ConditionEqualTypes        = 133,
                TypenameExpected           = 134,
                MemberNewMustBeMacro       = 135,
                InvalidTransaction         = 136,
                CannotGetMethodValue       = 137,
                VarColumnOnlyOnce          = 138,
                UnknownFunction            = 139,
                ParameterCountWrong        = 140,
                CannotOverrideDynamicMember = 141,
                MethodDefinitionInWrongFile = 142,
                ExpectedComma              = 143,
                UnexpectedBreakContinue    = 144,
                ColumnDefsOnlyWithTable    = 145,
                RelevantFunction           = 146,
                IsNotBaseClass             = 147,
                PropertyMustHaveGetOrSet   = 148,
                InsertSizeMismatch         = 149,
                ReadingWriteOnlyProperty   = 150,
                WritingReadOnlyProperty    = 151,
                ExpectedFunctionOpenParen  = 152,
                NoUpdateOnMacroNew         = 153,
                BuiltinSymbolNotFound      = 154,
                BuiltinTypeMismatch        = 155,
                ParentCallToKnownBaseOnly  = 156,
                InvalidLibrary             = 157,
                NoPrivatePublicInMethodDef = 158,
                NoReservedWordAsColumnName = 159,
                TableNotBound              = 160,
                NoPassthroughOutsideBind   = 161,
                IllegalBindExpression      = 162,
                MustBeOneTable             = 163,
                DatabaseException          = 164,
                UnknownFilePrefix          = 165,
                RebindingDefaultPtr        = 166,
                IllegalLog                 = 167,
                ExpectedReal               = 168,
                ExpectedNumeric            = 169,
                LibraryUpdatedDuringRun    = 170,
                OldObjectTypeDefFound      = 171,
                SqrtNotNegative            = 172,
                ArgumentNotInDomain        = 173,
                LogNotNegative             = 174,
                FloatingPointOverflow      = 175,
                IllegalBlobStream          = 176,
                IllegalArchive             = 177,
                MisspelledObjectType       = 178,
                RecursiveLoadlib           = 179,
                NonEllipsisValueRequired   = 180,
                NoCounterAvailable         = 181,
                CustomError                = 182,
                NoConsoleAvailable         = 183,
                InvalidLoadlib             = 184,
                InvalidFileId              = 185,
                InvalidFunctionDeclaration = 186,
                IllegalUseOfPublicPrivate  = 187,
                PublicPrivateNoMix         = 188,
                ExpectedExportName         = 189,
                NoVariantArray             = 190,
                IllegalModuleName          = 191,
                CantFindModule             = 192,
                NoModuleRegistration       = 193,
                NoMultiLevelArrays         = 194,
                ExpectedKeyword            = 195,
                WriteToReadonlyColumn      = 196,
                UncaughtException          = 197,
                IllegalIntegerConstant     = 198,
                ExpectedAssignmentOperator = 199,
                ExpectedCellOrFrom         = 200,
                ExpectedAtOrAll            = 201,
                ExpectedAtOrEnd            = 202,
                UncaughtExceptionWithMsg   = 203,
                ColumnNameAlreadyExists    = 204,
                EmptyStatementNotAllowedHere = 205,
                InvalidRedirectedFileId    = 206,
                UnexpectedEOF              = 207,
                OneNonEllipsisElementRequired = 208,
                IndependentOrderBy         = 209,
                NoTableArray               = 210,
                AbortError                 = 211,
                ModuleInitFailed           = 212,
                NoOrderingDefined          = 213,
                IllegalLibraryName         = 214,
                StackOverflow              = 215,
                FirstElementUnknownType    = 216,
                NoATInTableQuery           = 217,
                FunctionForwardDeclAsVar   = 218,
                ExpectedInteger            = 219,
                TransReadOnly              = 220,
                ExpectedCatchOrFinallyAfterTry = 221,
                ExpectedConstantExpression = 222,
                ExpectedTableDef           = 223,
                TypeTableNotAllowed        = 224,
                CompareNotAllowed          = 225,
                CannotExtendDefaultObject  = 226,
                ConstantOnlyAllowedForVars = 227,
                ExpectedClosingSquareBracket = 228,
                NoSubscriptForNonAggregates = 229,
                ThisNotAllowedInBaseConstructorParameters = 230,
                VarArgIncorrectSignature   = 231,
                MissingDefaultArgument     = 232,
                SetRecordNoDependents      = 233,
                CellWrongType              = 234,
                IndependentGroupBy         = 235,
                IndependentHaving          = 236,
                ScriptAbortedManually      = 237,
                NoContentWithSystemRedirect = 238,
                TemporaryOnlyInSelectPhase = 239,
                IndependentTemporary       = 240,
                EqualityMayBeAssignment    = 241,
                CompilerDirectiveNotClosed = 242,
                UnexpectedCompilerDirectiveElse = 243,
                UnexpectedCompilerDirectiveEnd = 244,
                OnlyObjectGeneratorFunctions = 245,
                YieldOnlyInGeneratorFunction = 246,
                YieldNotInThisContext      = 247,
                AwaitOnlyInAsyncFunction   = 248,
                CannotAccessProtectedObjectType = 249,
                NoContentBeforeLoadLibs    = 250,
                Exception                  = 251,
                IndependentSelect          = 252,
                IllegalFloatExponent       = 253,
                MoneyOverflow              = 254,
                FloatOverflow              = 255,
                Integer64Overflow          = 256,
                ExpectedToken              = 257,
                CannotDynamicallyModifyStaticObjectType = 258,
                DynamicExtendOnlyThroughThis = 259,
                ExpectedTemplateExpression = 260,
                CannotModifyAConstantVariable = 261,
                RelativePathMayNotEscape =   262,
                ErrorId =                    263,
                PrefixDoesNotAllowRelativeAddressing = 264,
                MisspelledMember =           265,
                /* Please reuse free error codes instead of adding more of them */
        };
}

namespace Warning
{
        enum Codes
        {
                IgnoringToken              = 1,

                BoundToLibrarySymbol       = 4,
                VarOverridesTableBind      = 5,
                UnterminatedComment        = 6,

                PartlyUnoptimizedWhere     = 9,
//                IndependentWhere           = 10,
                SuggestParentheses         = 15,
                TooManyWarnings            = 17,
                DeprecatedIdentifier       = 18,
                DeprecatedIdentifierWithMsg= 19,
                VarOverridesAnonymousBind  = 20,
                HidingDefinition           = 21,
                UpdateMakesFieldPrivate    = 22,
                OnlyUnindexedColumnsUsed   = 23,
                ConditionAlwaysTrue        = 24,
                ConditionAlwaysFalse       = 25,
                RecordArrayUsedAsRecord    = 26,
                ShadowingVariable          = 27,
                ShadowedVariable           = 28

                /* Please reuse free error codes instead of adding more of them */
        };
}

/** Stack trace element */
struct StackTraceElement
{
        /// Source file
        std::string filename;

        /// Optional position within the file ( (0,0) if not present)
        Blex::Lexer::LineColumn position;

        std::string func;

        // Codeptr
        unsigned codeptr;

        // Stack base pointer
        unsigned baseptr;

        /// Virtual Machine
        VirtualMachine *vm;
};

/** Error handler - keeps track of current file and all reported errors.

    When it receives a position for an error, it will assign it to the current
    file. ADDME: It may be cleaner to store filename information inside Position,
    making any Position a unique pointer inside the whole compilation process?
    Or, PushFile seems to be used only once, so why not get rid of it ?
*/
class BLEXLIB_PUBLIC ErrorHandler
{
        public:
        typedef std::list<Message> MessageList;
        typedef std::vector<StackTraceElement> StackTrace;

        ErrorHandler();
        ~ErrorHandler();

        /** Add a parsing or running error
            @param e Error object */
        void AddErrorAt(const Blex::Lexer::LineColumn &position,
                                 Error::Codes error,
                                 const std::string &msg1=std::string(),
                                 const std::string &msg2=std::string());

        /** Add an internal compilation error (at 1,1) */
        void AddInternalError(std::string const &msg)
        {
                AddErrorAt(Blex::Lexer::LineColumn(1,1), Error::InternalError, msg);
        }

        /** Add a parsing or running error
            @param w Warning object */
        void AddWarningAt(const Blex::Lexer::LineColumn &position,
                                   Warning::Codes error,
                                   const std::string &msg1=std::string(),
                                   const std::string &msg2=std::string());

        void AddMessage(Message const &message);

        void AddMessageAt(const Blex::Lexer::LineColumn &position, Message const &message);

        /** Sets current file (where errors and warnings must be attributed to) */
        void SetCurrentFile(const std::string &filename);

        /** Get the list of errors */
        const MessageList& GetErrors() const
        { return errors; }

        /** Have any errors occured? */
        bool AnyErrors() const
        { return !errors.empty(); }

        /** Get the list of warnings */
        const MessageList& GetWarnings() const
        { return warnings; }

        /** Any warnings present? */
        bool AnyWarnings() const
        { return !warnings.empty(); }

        /** Get the stack trace */
        const StackTrace& GetStackTrace() const
        { return stacktrace; }

        /** Add a file-position to the stack trace */
        void AddFilePositionToStackTrace(StackTraceElement const &pos);

        /** Reset errorhandler (cleans it totally) */
        void Reset();

        /** Get permission to prepare the stack trace for a specific VM.
            Will return true only first call per vm, until Reset is called */
        bool TryStartStacktracePrepare(VirtualMachine *vm);

        /// Set the list of loaded resources
        void SetLoadedResources(std::vector< std::string > const &resources);

        /// Returns list of loaded resources
        std::vector< std::string > const & GetLoadedResources() const
        {
                return loadedresources;
        }

        private:
        ///Currently encountered errors
        MessageList errors;

        ///Currently encountered warnings
        MessageList warnings;

        ///Number of errors skipped
        unsigned errors_skipped;

        StackTrace stacktrace;

        /** List of converted pointers of vms that have their trace made
            Won't keep the pointers, because they are invalidated */
        bool executed_trace;

        ///File where errors and warnings must be assigned to
        std::string currentfile;

        ///List of loaded resources
        std::vector< std::string > loadedresources;
};

///A single record of data for an error message
struct MessageData
{
        ///Error number
        unsigned number;
        ///Error text
        const char *text;
};

///List of all error messages
extern const MessageData errors[];
///List of all warning messages
extern const MessageData warnings[];

std::string BLEXLIB_PUBLIC GetMessageString(Message const &errmsg);

class BLEXLIB_PUBLIC VMRuntimeError : public std::runtime_error, public Message
{
        public:
        VMRuntimeError (Error::Codes errorcode
                                     ,const std::string &msg1 = std::string()
                                     ,const std::string &msg2 = std::string());

        ~VMRuntimeError() throw();

        Error::Codes GetErrorCode() const { return static_cast<Error::Codes>(code); }
};

void ThrowInternalError(const char *error) FUNCTION_NORETURN;
void ThrowInternalError(std::string const &error) FUNCTION_NORETURN;
void ThrowVMRuntimeError(Error::Codes errorcode, const char *msg1 = "", const char *msg2 = "") FUNCTION_NORETURN;

} // End of namespace HareScript

#endif
