//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "errors.h"
#include "hs_lexer.h"

#define ERRORDEF(num, code, text) { Error::code, text },
#define WARNINGDEF(num, code, text) { Warning::code, text },

///Maximum number of error messages to generate
const unsigned MaxErrors = 50;
///Maximum number of warnings to generate
const unsigned MaxWarnings = 100;

namespace HareScript
{

const MessageData errors[]={
ERRORDEF(  0, InternalError,             "Internal error '%0' - contact your system operator if this problem persists.")
ERRORDEF(  1, CannotFindLibrary,         "Cannot find library '%0'.")
ERRORDEF(  2, CannotFindCompiledLibrary, "Cannot find compiled version of library '%0'.")
ERRORDEF(  3, CannotWriteCompiledLibrary,"Cannot write compiled version of library '%0'.")
ERRORDEF(  4, AlreadyGloballyDefined,    "A global variable, function or macro with the name '%0' has already been defined in this module.")
ERRORDEF(  5, CompilationFailed,         "Compilation of library failed.")
ERRORDEF(  6, DuplicateArgumentName,     "Duplicate argument name '%0' in function declaration.")
ERRORDEF(  7, ModuleInternalError,       "Internal error in external module: '%0' - contact the module's vendor.")
ERRORDEF(  8, ExpectedForeveryFrom,      "Expected 'FROM' after the variable name in the FOREVERY statement.")
ERRORDEF(  9, UnknownVariable,           "Undefined variable '%0'.")
ERRORDEF( 10, UnexpectedEndOfString,     "Unexpected end of string.")
ERRORDEF( 11, EndWithoutArray,           "'END' can only be used in array subscript expressions or insert positions")
ERRORDEF( 12, AggregateInWhereUsesOwnSelect, "An aggregate function within a WHERE may not use values of the SELECT is it placed in.")
ERRORDEF( 13, VarAlreadyDefinedInScope,  "Variable '%0' is already defined inside the current scope.")
ERRORDEF( 14, NoFunctionsInComplicatedProperties, "Member functions may not be used in a property expression.")
ERRORDEF( 15, VariantNotAllowed,         "Type VARIANT is not allowed here.")
ERRORDEF( 16, LoadlibNeedsLibraryName,   "LOADLIB must be followed by a string containing the library name.")
ERRORDEF( 17, ExpectedOpeningParenthesis,"Expected opening parenthesis '('.")
ERRORDEF( 18, NoTemporaryStorage,        "No temporary storage available.")
ERRORDEF( 19, NoUseTemporaryWithinAggregate, "A SELECT temporary cannot be used within an aggregate function.")
ERRORDEF( 20, ImproperDeinitMacro,       "A deinitialization macro cannot return a value or accept any arguments.")
ERRORDEF( 21, MultipleDeinitMacros,      "A library can have only one deinitialization macro.")
ERRORDEF( 22, ExpectedFunctionMacroName, "Expected a function or macro name.")
ERRORDEF( 23, CallingDefaultFunctionPtr, "Trying to invoke a function pointer that does not point to any function.")
ERRORDEF( 24, InvalidCompilerDirective,  "Invalid compiler directive.")
ERRORDEF( 25, InvalidAttributes,         "Invalid attributes specification.")
ERRORDEF( 26, ExpectedClosingParenthesis,"Missing closing ')'.")
ERRORDEF( 27, ExpectedLikeOrInAfterNot,  "Expected LIKE, IN or EXTENDSFROM.")
ERRORDEF( 28, ExpectedClosingBracket,    "Missing closing ']' in expression.")
ERRORDEF( 29, ExpectedGreaterThan,       "Missing closing '>'.")
ERRORDEF( 30, AttributeTerminatesOnlyForMacro, "Attribute TERMINATES only allowed for a MACRO.")
ERRORDEF( 31, ModuleLoadFailed,          "An error occurred loading the external module '%0': %1.")
ERRORDEF( 32, MacroDidntTerminateScript, "A MACRO with attribute TERMINATES did not terminate, but returned normally.")
ERRORDEF( 33, CalledVMGone,              "Invoking a function pointer that refers to an already terminated script.")
ERRORDEF( 34, ExpectedColumnName,        "Expecting a column name.")
ERRORDEF( 35, ScriptAbortedDisconnect,   "The script was aborted because of a disconnection.")
ERRORDEF( 36, ScriptAbortedTimeout,      "The script was aborted because of a timeout.")
ERRORDEF( 37, ExpectedSchemaDef,         "Expected schema definition, starting with '<'.")
ERRORDEF( 38, ExpectedTable,             "Expected token TABLE.")
ERRORDEF( 39, CannotCastSchema,          "Cannot cast to or from variables of type SCHEMA.")
ERRORDEF( 40, NoSchemaArray,             "SCHEMA ARRAY is not an allowed type.")
ERRORDEF( 41, TypeSchemaNotAllowed,      "Type SCHEMA is not allowed as parameter or return value of a non-external function.")
ERRORDEF( 42, TypeSchemaNotInCell,       "SCHEMA variables cannot be put in record cells.")
ERRORDEF( 43, TableDoesNotExistInSchema, "Table '%0' does not exist in this schema.")
ERRORDEF( 44, ExpectedTableName,         "Expecting a table name.")
ERRORDEF( 45, DuplicateCase,             "Duplicate case.")
ERRORDEF( 46, ArrayIndexOutOfBounds,     "Array index '%0' is out of bounds.")
ERRORDEF( 47, RecordDoesNotExist,        "Record variable does not point to any existing record, while trying to access cell '%0'.")
ERRORDEF( 48, TableColNameAlreadyUsed,   "Table/column name '%0' cannot be used twice inside this declaration.")
ERRORDEF( 49, ExpectSchemaName,          "Expected schema name.")
ERRORDEF( 50, ExpectLike,                "Expected token LIKE.")
ERRORDEF( 51, ColumnDeleteOnlyFromStar,  "A column-DELETE within a SELECT can only delete columns that are selected via SELECT * or a SELECT ...var.")
ERRORDEF( 52, OnlyColumnsAllowedInGroupBy, "Only columns from the currently selected sources are allowed in a GROUP BY.")
ERRORDEF( 53, NonGroupedNotAllowedOutsideAggregate, "Non-grouped columns cannot be used outside an aggregate function here.")
ERRORDEF( 54, AggregateOnlyInsideSelect, "Aggregate function '%0' can only be used inside a SELECT, within the selected data, the HAVING or the ORDER BY clauses, or as a normal function using %0[]")
ERRORDEF( 55, AggregateSignatureWrong,   "An aggregate function must have one argument, and that argument must be an array or VARIANT.")
ERRORDEF( 56, CannnotAggregateArrays,    "Arrays cannot be used as parameters for an aggregate function.")
ERRORDEF( 57, DivisionByZero,            "Division by zero.")
ERRORDEF( 58, FunctionAsTableSource,     "A function returning a TABLE cannot be used as a SQL data source.")
ERRORDEF( 59, ExpectedAsterisk,          "Expected an asterisk.")
ERRORDEF( 60, CircularReference,         "The current library called a function in library '%0', which uses library '%1', that is still initializing.")
ERRORDEF( 61, NoSelectStarWhenGrouped,   "SELECT * not allowed when the select is grouped.")
ERRORDEF( 62, CannotConvertType,         "Cannot convert type '%0' to type '%1'.")
ERRORDEF( 63, NoTypeDefaultValue,        "Type '%0' has no default value.")
ERRORDEF( 64, FunctionsTopLevelOnly,     "FUNCTIONs and MACROs can only be declared at the top-level, never inside a block.")
ERRORDEF( 65, TooManyMessages,           "Too many errors in script.")
ERRORDEF( 66, IndependentWhere,          "Found a WHERE clause whose result does not depend on the selected records.")
ERRORDEF( 67, MayNotBeUsedAsName,        "'%0' cannot be used as a variable or function name.")
ERRORDEF( 68, IntegerOverflow,           "Integer overflow.")
ERRORDEF( 69, ThisOnlyInMemberFunctions, "Keyword THIS is only allowed in OBJECT functions.")
ERRORDEF( 70, ExpectedSemicolon,         "Expected semicolon to separate statements.")
ERRORDEF( 71, ExpectedClosingCurlyBrace, "Expected closing curly brace '}' at the end of statement block.")
ERRORDEF( 72, UnknownToken,              "Unknown token '%0'.")
ERRORDEF( 73, UnexpectedToken,           "Unexpected token '%0'.")
ERRORDEF( 74, ThisIsConstant,            "THIS object variable cannot be modified.")
ERRORDEF( 75, ExpectedObjectDef,         "Expected object type definition.")
ERRORDEF( 76, UnknownObjectType,         "Unknown object type '%0'.")
ERRORDEF( 77, FunctionIsNotAMember,      "Function '%0' is not a member of object type '%1'.")
ERRORDEF( 78, MemberSignatureWrong,      "The signature of this function does not match the signature it was declared with in the object type definition.")
ERRORDEF( 79, SelectExprMustHaveName,    "Selecting a variable or the results of an expression requires using an assignment to name the output column'.")
ERRORDEF( 80, SelectStarMayHaveNoName,   "No name can be specified when selecting the full contents of a record.")
ERRORDEF( 81, NoDefaultsInMemberDefinition, "No default values are allowed in the parameters of the definition of a member function.")
ERRORDEF( 82, ExpectedArrowOperator,     "Expected an arrow operator '->' to access an object member.")
ERRORDEF( 83, ExpectedSQLClause,         "Expected a '%0' clause in a SQL statement.")
ERRORDEF( 84, ExpectedDotOperator,       "Expected a dot operator '.' to access a record member.")
ERRORDEF( 85, MisspelledVariable,        "Unknown variable '%0' - did you mean '%1' ?")
ERRORDEF( 86, MisspelledColumn,          "Column '%0' does not exist - did you mean '%1' ?")
ERRORDEF( 87, ExpectedOpeningCurlyBrace, "Expected an opening curly brace '{'.")
ERRORDEF( 88, MisspelledFunction,        "Undefined function '%0' - did you mean '%1' ?")
ERRORDEF( 89, NowDeclaringVariable,      "You cannot refer to variable '%0' inside its own initialization, as it does not have a value yet.")
ERRORDEF( 90, NoObjectTypeHere,          "Object types cannot be used here.")
ERRORDEF( 91, DereferencedDefaultObject, "Object variable does not point to any existing object.")
ERRORDEF( 92, UnknownColumn,             "Column '%0' does not exist.")
ERRORDEF( 93, AmbiguousColumnColumn,     "Column '%0' is ambiguous because it exists in more than one of the selected tables.")
ERRORDEF( 94, InvalidDefault,            "Invalid default value for function argument '%0'.")
ERRORDEF( 95, ExpectedVariable,          "Expected a variable.")
ERRORDEF( 96, ExpectedObjectType,        "Expected an object type.")
ERRORDEF( 97, MacroDoesNotReturnValue,   "A MACRO cannot be used as a FUNCTION, it has no return value.")
ERRORDEF( 98, MacroNoReturnValue,        "A MACRO cannot return a value.")
ERRORDEF( 99, FunctionMustReturnValue,   "The current function did not return a value.")
ERRORDEF(100, ScriptNoReturnCode,        "The HareScript main code cannot return a value.")
ERRORDEF(101, ExpectedIntoAfterInsert,   "Expecting 'INTO' after INSERT.")
ERRORDEF(102, MemberDeclaredTwice,       "A member with the name '%0' has already been declared.")
ERRORDEF(103, MemberDoesNotExist,        "Member '%0' does not exist.")
ERRORDEF(104, MethodNotDefined,          "No function body has been defined for method '%0'.")
ERRORDEF(105, PrivateMemberOnlyThroughThis, "This private member can only be accessed using the 'this' variable.")
ERRORDEF(106, NoPropertyAsGetterSetter,  "A property cannot be used as get or set member of another property.")
ERRORDEF(107, NoCounterForTable,         "The position of a query within a table cannot be determined with the '#' operator.")
ERRORDEF(108, ExpectedLvalue,            "Expected an expression of which the value can be modified.")
ERRORDEF(109, LengthWrongType,           "Built-in function LENGTH() does not support arguments of type '%0'.")
ERRORDEF(110, MemberAlreadyExists,       "Member '%0' already exists.")
ERRORDEF(111, NotObjectMethod,           "The first argument of an inserted method or property read/write function must be of type OBJECT.")
ERRORDEF(112, UnexpectedCloseCurlyBrace, "Unexpected closing curly brace '}'.")
ERRORDEF(113, IdentifierTooLong,         "Identifier too long.")
ERRORDEF(114, AmbiguousSymbol,           "Symbol '%0' is ambiguous, it appears in more than one loaded library.")
ERRORDEF(115, NoUpdateForVarMembers,     "Updating object member '%0' is not allowed, because it is of type variable.")
ERRORDEF(116, MemberNeededForUpdate,     "Member '%0' cannot be updated in an object of type '%1', because it doesn't exist in that object yet.")
ERRORDEF(117, ColumnsMustBeExplicit,     "The columns to select must be stated explicitly when selecting from more than one source.")
ERRORDEF(118, NeedCompatibleSignatures,  "The signatures of the original function member '%0' and its update are not compatible.")
ERRORDEF(119, GetterSignatureWrong,      "A property read function must return a value and can take only an OBJECT parameter.")
ERRORDEF(120, SetterSignatureWrong,      "The property write function cannot return a value and must take an OBJECT parameter and one other parameter.")
ERRORDEF(121, UpdateReqForFieldOverride, "The use of UPDATE is required when updating member '%0' in an object of type '%1', because this member already exists in the base object.")
ERRORDEF(122, IOError,                   "Local I/O error.")
ERRORDEF(123, ConditionMustBeBoolean,    "A conditional expression must evaluate to TRUE or FALSE.")
ERRORDEF(124, OverrideMemberTypeChange,  "A member can only be updated by a member of the same type.")
ERRORDEF(125, ParentCallOnlyInMemberFunctions, "Calling a function in a base object is only allowed in a function-member of an object.")
ERRORDEF(126, RadixOutOfRange,           "Radix for integer conversion out of range [%0-%1].")
ERRORDEF(127, DecimalsOutOfRange,        "Number of decimals out of range [%0-%1].")
ERRORDEF(128, BaseMemberOnlyForFunctions, "Accessing members in a base object is only allowed for function members.")
ERRORDEF(129, MemberFunctionWriteDisallowed, "Directly modifying a function member is not allowed.")
ERRORDEF(130, TypeNotArray,              "Expected an expression of array type.")
ERRORDEF(131, ExpectedColon,             "Expected colon to separate expressions in a conditional expression.")
ERRORDEF(132, MemberDeleteNotAllowed,    "Deleting this member is not allowed.")
ERRORDEF(133, ConditionEqualTypes,       "Both possible results of a conditional expression must have the same type (now: %0 vs %1).")
ERRORDEF(134, TypenameExpected,          "Typename expected.")
ERRORDEF(135, MemberNewMustBeMacro,      "The constructor of an objecttype must be a MACRO.")
ERRORDEF(136, InvalidTransaction,        "Invalid transaction used.")
ERRORDEF(137, CannotGetMethodValue,      "Cannot get the value of an object member function/macro, please use parentheses to call it.")
ERRORDEF(138, VarColumnOnlyOnce,         "VAR and COLUMN can be applied only once.")
ERRORDEF(139, UnknownFunction,           "Undefined function '%0'.")
ERRORDEF(140, ParameterCountWrong,       "Wrong number of parameters in call to %0.")
ERRORDEF(141, CannotOverrideDynamicMember, "The dynamically inserted member '%0' cannot be updated.")
ERRORDEF(142, MethodDefinitionInWrongFile, "Object functions can only be defined in the file where the object is declared.")
ERRORDEF(143, ExpectedComma,             "Expected a comma.")
ERRORDEF(144, UnexpectedBreakContinue,   "BREAK and CONTINUE statements can only appear inside a loop.")
ERRORDEF(145, ColumnDefsOnlyWithTable,   "Column definitions are only allowed in a table type.")
ERRORDEF(146, RelevantFunction,          "When calling function %0.")
ERRORDEF(147, IsNotBaseClass,            "Object type '%0' does not directly extend object type '%1'.")
ERRORDEF(148, PropertyMustHaveGetOrSet,  "The reader and writer of a property cannot both be ommitted.")
ERRORDEF(149, InsertSizeMismatch,        "Mismatch between number of values and number of fields in INSERT statement.")
ERRORDEF(150, ReadingWriteOnlyProperty,  "Trying to read from write-only property '%0'.")
ERRORDEF(151, WritingReadOnlyProperty,   "Trying to write to read-only property '%0'.")
ERRORDEF(152, ExpectedFunctionOpenParen, "Expected opening parenthesis '(' after function '%0'.")
ERRORDEF(153, NoUpdateOnMacroNew,        "The use of UPDATE on MACRO NEW() is not allowed.")
ERRORDEF(154, BuiltinSymbolNotFound,     "Built-in function '%0' not registered.")
ERRORDEF(155, BuiltinTypeMismatch,       "Built-in function '%0' has the wrong type.")
ERRORDEF(156, ParentCallToKnownBaseOnly, "Calling a function from another object type is only allowed when that object type is a base of the current object type.")
ERRORDEF(157, InvalidLibrary,            "Invalid library '%0': %1.")
ERRORDEF(158, NoPrivatePublicInMethodDef, "PUBLIC and PRIVATE cannot be used in the definition of an object function member, but only at the declaration.")
ERRORDEF(159, NoReservedWordAsColumnName, "Reserved word '%0' cannot be used as column name.")
ERRORDEF(160, TableNotBound,             "Table not bound.")
ERRORDEF(161, NoPassthroughOutsideBind,  "Passthrough parameters (like #1) can only be used in the outermost call of a PTR-expression.")
ERRORDEF(162, IllegalBindExpression,     "A PTR-expression must end with a function, a object function member or a call to one of these (optionally with passthrough parameters).")
ERRORDEF(163, MustBeOneTable,            "Only one table allowed in Deletes and Updates.")
ERRORDEF(164, DatabaseException,         "Database exception '%0'.")
ERRORDEF(165, UnknownFilePrefix,         "Unknown library namespace '%0'.")
ERRORDEF(166, RebindingDefaultPtr,       "A function pointer in a PTR-expression cannot have the default function pointer value.")
ERRORDEF(167, IllegalLog,                "Unknown log referenced.")
ERRORDEF(168, ExpectedReal,              "Expected a floating-point value.")
ERRORDEF(169, ExpectedNumeric,           "Expected a numeric value, got a value of type '%0'.")
ERRORDEF(170, LibraryUpdatedDuringRun,   "Error loading library '%0': library '%1' was updated since it was loaded for the first time.")
ERRORDEF(171, OldObjectTypeDefFound,     "Encountered an old-style object method definition: please convert code to the new style.")
ERRORDEF(172, SqrtNotNegative,           "Cannot take the square root of a negative value.")
ERRORDEF(173, ArgumentNotInDomain,       "Argument out of range for %0.")
ERRORDEF(174, LogNotNegative,            "Cannot take the logarithm of a negative or zero value.")
ERRORDEF(175, FloatingPointOverflow,     "Floating-point overflow.")
ERRORDEF(176, IllegalBlobStream,         "Unknown blobstream referenced.")
ERRORDEF(177, IllegalArchive,            "Unknown archive referenced.")
ERRORDEF(178, MisspelledObjectType,      "Unknown objecttype '%0' - did you mean '%1' ?")
ERRORDEF(179, RecursiveLoadlib,          "Library '%0' recursively LOADLIBs itself.")
ERRORDEF(180, NonEllipsisValueRequired,  "At least one non-ellipsis value is required in a record or array")
ERRORDEF(181, NoCounterAvailable,        "Variable '%0' has no associated loop counter.")
ERRORDEF(182, CustomError,               "Custom error message: '%0'.")
ERRORDEF(183, NoConsoleAvailable,        "No console available.")
ERRORDEF(184, InvalidLoadlib,            "Invalid LOADLIB library name - library names must be absolute.")
ERRORDEF(185, InvalidFileId,             "Invalid output id (%0).")
ERRORDEF(186, InvalidFunctionDeclaration,"Invalid function declaration.")
ERRORDEF(187, IllegalUseOfPublicPrivate, "PUBLIC and PRIVATE can only be used for declarations of FUNCTIONs, MACROs and global variables.")
ERRORDEF(188, PublicPrivateNoMix,        "Only one of PUBLIC and PRIVATE can be used in a declaration.")
ERRORDEF(189, ExpectedExportName,        "Expected the name of a public identifier to export from library '%0'.")
ERRORDEF(190, NoVariantArray,            "VARIANT ARRAY is not an allowed type.")
ERRORDEF(191, IllegalModuleName,         "Illegal module name.")
ERRORDEF(192, CantFindModule,            "Cannot find module '%0'.")
ERRORDEF(193, NoModuleRegistration,      "Module '%0' is not a HareScript module - it does not export a 'HSVM_ModuleEntryPoint' function.")
ERRORDEF(194, NoMultiLevelArrays,        "Multi-level arrays are not allowed.")
ERRORDEF(195, ExpectedKeyword,           "Expected keyword '%0'.")
ERRORDEF(196, WriteToReadonlyColumn,     "Column '%0' is marked as readonly column, and is modified by this SQL operation.")
ERRORDEF(197, UncaughtException,         "Exception %0.")
ERRORDEF(198, IllegalIntegerConstant,    "Illegal INTEGER constant.")
ERRORDEF(199, ExpectedAssignmentOperator,"Expected assignment operator (':=').")
ERRORDEF(200, ExpectedCellOrFrom,        "Expected CELL or FROM.")
ERRORDEF(201, ExpectedAtOrAll,           "Expected AT or ALL.")
ERRORDEF(202, ExpectedAtOrEnd,           "Expected an AT position or 'AT END' when inserting into an array.")
ERRORDEF(203, UncaughtExceptionWithMsg,  "Exception %0: %1.")
ERRORDEF(204, ColumnNameAlreadyExists,   "A cell named '%0' already exists.")
ERRORDEF(205, EmptyStatementNotAllowedHere, "An empty statement (';') is not allowed here.")
ERRORDEF(206, InvalidRedirectedFileId,   "Output is redirected to the now invalid output id %0.")
ERRORDEF(207, UnexpectedEOF,             "Unexpected end of file.")
ERRORDEF(208, OneNonEllipsisElementRequired, "At least one non-ellipsis element is required in a RECORD or ARRAY constant.")
ERRORDEF(209, IndependentOrderBy,        "Found a ORDER BY expression whose result does not depend on the selected records.")
ERRORDEF(210, NoTableArray,              "TABLE ARRAY is not an allowed type.")
ERRORDEF(211, AbortError,                "Explicit ABORT().")
ERRORDEF(212, ModuleInitFailed,          "Module '%0' failed to initialize itself.")
ERRORDEF(213, NoOrderingDefined,         "Cannot order variables of type '%0'.")
ERRORDEF(214, IllegalLibraryName,        "Illegal library name '%0' - control characters are not allowed.")
ERRORDEF(215, StackOverflow,             "Maximum number of nested functions ('%0') reached.")
ERRORDEF(216, FirstElementUnknownType,   "The type of the first element of a constant array must be known at compile-time.")
ERRORDEF(217, NoATInTableQuery,          "Cannot indicate a location in database statements.")
ERRORDEF(218, FunctionForwardDeclAsVar,  "Symbol '%0' has already been used as a function.")
ERRORDEF(219, ExpectedInteger,           "Expected an integer value (INTEGER or INTEGER64), got a value of type '%0'.")
ERRORDEF(220, TransReadOnly,             "Transaction is read-only.")
ERRORDEF(221, ExpectedCatchOrFinallyAfterTry, "Expected a CATCH or FINALLY after a TRY block.")
ERRORDEF(222, ExpectedConstantExpression,"Expected a constant expression.")
ERRORDEF(223, ExpectedTableDef,          "Expected table definition.")
ERRORDEF(224, TypeTableNotAllowed,       "Type TABLE is not allowed as parameter or return value of a non-external function.")
ERRORDEF(225, CompareNotAllowed,         "Type '%0' cannot be used in comparisons.")
ERRORDEF(226, CannotExtendDefaultObject, "Cannot extend a DEFAULT OBJECT.")
ERRORDEF(227, ConstantOnlyAllowedForVars, "Only variable declarations can be marked CONSTANT.")
ERRORDEF(228, ExpectedClosingSquareBracket, "Expected a closing square bracket (']').")
ERRORDEF(229, NoSubscriptForNonAggregates, "Using '[]' is only allowed with aggregate functions.")
ERRORDEF(230, ThisNotAllowedInBaseConstructorParameters, "The keyword THIS is not allowed within the initializer of a base objecttype.")
ERRORDEF(231, VarArgIncorrectSignature,  "The last parameter of a variable-argument function must be a VARIANT ARRAY.")
ERRORDEF(232, MissingDefaultArgument,    "Parameter '%0' requires a default value, because parameter '%1' has one too.")
ERRORDEF(233, SetRecordNoDependents,     "The updaterecord in an UPDATE SET RECORD may not depend on the contents of the table.")
ERRORDEF(234, CellWrongType,             "Cell '%0' must have type %1.")
ERRORDEF(235, IndependentGroupBy,        "Found a GROUP BY expression whose result does not depend on the selected records.")
ERRORDEF(236, IndependentHaving,         "Found a HAVING clause whose result does not depend on the selected records.")
ERRORDEF(237, ScriptAbortedManually,     "The script was aborted by the system administrator.")
ERRORDEF(238, NoContentWithSystemRedirect, "No content is allowed in a script with a system redirect.")
ERRORDEF(239, TemporaryOnlyInSelectPhase,"A SELECT temporary may only be used in the SELECT part (after its declaration) and the ORDER BY part.")
ERRORDEF(240, IndependentTemporary,      "Found a SELECT temporary whose value does not depend on the selected records.")
ERRORDEF(241, EqualityMayBeAssignment,   "An equality check is not allowed at statement-level. Did you mean to write an assignment instead?")
ERRORDEF(242, CompilerDirectiveNotClosed, "Could not find matching (*END*) for this compiler directive.")
ERRORDEF(243, UnexpectedCompilerDirectiveElse, "Found an (*ELSE*) directive without an open (*IFVERSION*) directive.")
ERRORDEF(244, UnexpectedCompilerDirectiveEnd, "Found an (*END*) directive without an open (*IFVERSION*) directive.")
ERRORDEF(245, OnlyObjectGeneratorFunctions, "A generator must be a FUNCTION with return type OBJECT.")
ERRORDEF(246, YieldOnlyInGeneratorFunction, "A YIELD-expression may only be used in a generator function.")
ERRORDEF(247, YieldNotInThisContext,     "A YIELD-expression is not allowed in this context (eg. in SQL loops).")
ERRORDEF(248, AwaitOnlyInAsyncFunction,  "An AWAIT-expression may only be used in an async function.")
ERRORDEF(249, CannotAccessProtectedObjectType, "Cannot unsafely access or extend a protected objecttype.")
ERRORDEF(250, NoContentBeforeLoadLibs,   "No content is allowed before a LOADLIB in a library.")
ERRORDEF(251, Exception,                 "Exception: %1")
ERRORDEF(252, IndependentSelect,         "Found a SELECT clause where the result does not depend on the selected records.")
ERRORDEF(253, IllegalFloatExponent,      "Illegal float exponent.")
ERRORDEF(254, MoneyOverflow,             "Money overflow.")
ERRORDEF(255, FloatOverflow,             "Float overflow.")
ERRORDEF(256, Integer64Overflow,         "Integer64 overflow.")
ERRORDEF(257, ExpectedToken,             "Expected token %0")
ERRORDEF(258, CannotDynamicallyModifyStaticObjectType, "Cannot dynamically modify an object with a STATIC OBJECTTYPE.")
ERRORDEF(259, DynamicExtendOnlyThroughThis, "This object can only be dynamically extended using the 'this' variable.")
ERRORDEF(260, ExpectedTemplateExpression, "Expected a template expression.")
ERRORDEF(261, CannotModifyAConstantVariable, "A constant variable may not be modified.")
ERRORDEF(262, RelativePathMayNotEscape,  "Relative path may not escape the base path")
ERRORDEF(263, ErrorId,                   "Error ID: %0")
ERRORDEF(264, PrefixDoesNotAllowRelativeAddressing, "Relative adressing with respect to an URI with prefix '%0' is not allowed.")
ERRORDEF(265, MisspelledMember,          "Member '%0' does not exist, did you mean '%1'?.")


{ 0,0 }};
const MessageData warnings[]={
WARNINGDEF(  1, IgnoringToken,             "Ignoring token '%0'.")

WARNINGDEF(  4, BoundToLibrarySymbol,      "Using identifier '%0' from library '%1' instead of binding it to a table.")
WARNINGDEF(  5, VarOverridesTableBind,     "Global variable '%0' overrides binding to record or table '%1'.")
WARNINGDEF(  6, UnterminatedComment,       "Unterminated comment.")

WARNINGDEF(  9, PartlyUnoptimizedWhere,    "WHERE clause partly not optimized because of an unoptimizable condition found before optimizable ones.")
//WARNINGDEF( 10, IndependentWhere,          "Found an independent WHERE in an UPDATE or DELETE clause.")
WARNINGDEF( 15, SuggestParentheses,        "Suggest parentheses to clarify operator precedence.")
WARNINGDEF( 17, TooManyWarnings,           "Too many warnings encountered.")
WARNINGDEF( 18, DeprecatedIdentifier,      "Identifier '%0' has been deprecated.")
WARNINGDEF( 19, DeprecatedIdentifierWithMsg,"Identifier '%0' has been deprecated: %1.")
WARNINGDEF( 20, VarOverridesAnonymousBind, "Global variable '%0' overrides binding to anonymous record array.")
WARNINGDEF( 21, HidingDefinition,          "Definition of '%0' hides definition of '%0' from library '%1'.")
WARNINGDEF( 22, UpdateMakesFieldPrivate,   "The update of member '%0' in the object of type '%1' makes it PRIVATE, while it is PUBLIC in the base object.")
WARNINGDEF( 23, OnlyUnindexedColumnsUsed,  "The only optimizable conditions in this WHERE are not indexed; this SQL statement could possibly run very slow.")
WARNINGDEF( 24, ConditionAlwaysTrue,       "Condition is always true.")
WARNINGDEF( 25, ConditionAlwaysFalse,      "Condition is always false.")
WARNINGDEF( 26, RecordArrayUsedAsRecord,   "This RECORD ARRAY is probably used erroneously as a RECORD. Use an explicit RECORD() cast if this is the intention.")
WARNINGDEF( 27, ShadowingVariable,         "Variable '%0' has already been declared in a parent scope")
WARNINGDEF( 28, ShadowedVariable,          "Variable '%0' is redeclared in a child scope")
WARNINGDEF( 29, UnusedLoadlib,             "No symbol from loadlib '%0' is referenced in this library")
{ 0,0 }};


Message::Message(
        bool iserror,
        int32_t code,
        const std::string &_msg1,
        const std::string &_msg2)
   : iserror(iserror)
   , code(code)
   , msg1(_msg1)
   , msg2(_msg2)
{
}

Message::~Message()
{
}

bool Message::operator != (Message const & rhs) const
{
        return iserror != rhs.iserror ||
            code != rhs.code ||
            msg1 != rhs.msg1 ||
            msg2 != rhs.msg2;
}

bool Message::IsIdentical(Message const & rhs) const
{
        if (*this != rhs)
            return false;
        return filename == rhs.filename && position == rhs.position;
}

//---------------------------------------------------------------------------
//
//      ErrorHandler
//
ErrorHandler::ErrorHandler()
{
        Reset();
}

ErrorHandler::~ErrorHandler()
{
}


void ErrorHandler::Reset()
{
        errors.clear();
        warnings.clear();
        loadedresources.clear();
        currentfile = "";
        errors_skipped = 0;
        executed_trace = false;
}

void ErrorHandler::AddErrorAt(const Blex::Lexer::LineColumn &position,
                                 Error::Codes error,
                                 const std::string &msg1,
                                 const std::string &msg2)
{
        if (errors.size()>MaxErrors)
            return;

        Message m(true, error, msg1, msg2);

        if (currentfile != "" && m.filename == "")
            m.filename = currentfile;
        m.position = position;

        AddMessage(m);
}

void ErrorHandler::AddWarningAt(const Blex::Lexer::LineColumn &position,
                                 Warning::Codes error,
                                 const std::string &msg1,
                                 const std::string &msg2)
{
        if (warnings.size()>=MaxWarnings)
            return;

        Message m(false, error, msg1, msg2);

        if (currentfile != "" && m.filename == "")
            m.filename = currentfile;
        m.position = position;

        AddMessage(m);
}

void ErrorHandler::AddMessage(Message const &message)
{
        if (message.iserror)
        {
                if(message.code == Error::CompilationFailed && !errors.empty()) //it's obvious compilation failed if we have errors (exception on compile failure often adds this)
                    return;
                for (std::list< Message >::const_iterator it = errors.begin(); it != errors.end(); ++it)
                    if (message.IsIdentical(*it))
                    {
                            ++errors_skipped;
                            if (errors_skipped >= MaxErrors)
                            {
                                    VMRuntimeError m(Error::TooManyMessages);
                                    m.filename = message.filename;
                                    errors.push_back(m);
                                    throw m;
                            }
                            return;
                    }
                errors_skipped = 0;
                errors.push_back(message);
        }
        else
            warnings.push_back(message);

        // No recursive loops, please!
        if (message.iserror == true && message.code == Error::TooManyMessages)
           return;

        if (warnings.size()==MaxWarnings)
        {
                Message m(message);
                m.iserror = false;
                m.code = Warning::TooManyWarnings;
                m.msg1 = m.msg2 = "";
                warnings.push_back(m);
        }

        if (errors.size()==MaxErrors)
        {
                VMRuntimeError m(Error::TooManyMessages);
                m.filename = message.filename;
                errors.push_back(m);
                throw m;
        }
}

void ErrorHandler::AddMessageAt(const Blex::Lexer::LineColumn &position, Message const &message)
{
        Message m(message);

        if (currentfile != "" && m.filename == "")
            m.filename = currentfile;
        m.position = position;
        AddMessage(m);
}

void ErrorHandler::AddFilePositionToStackTrace(StackTraceElement const &pos)
{
        stacktrace.push_back(pos);
}

bool ErrorHandler::TryStartStacktracePrepare(VirtualMachine *)
{
        if (executed_trace)
            return false;

        executed_trace = true;
        return true;
}

void ErrorHandler::SetCurrentFile(const std::string &filename)
{
        currentfile = filename;
}

void ErrorHandler::SetLoadedResources(std::vector< std::string > const &resources)
{
        loadedresources = resources;
}

std::string GetMessageString(Message const &msg)
{
        //lookup the error message text
        const MessageData *curmsg;
        for (curmsg = msg.iserror ? errors : warnings; curmsg->text; ++curmsg)
          if (curmsg->number == static_cast<unsigned>(msg.code))
            break;

        if (!curmsg->text)
            return "Cannot locate error " + Blex::AnyToString(msg.code);

        std::string receiver;
        for (const char* ptr=curmsg->text;*ptr;++ptr)
        {
                if (*ptr!='%')
                {
                        receiver.push_back(*ptr);
                        continue;
                }
                if(*(++ptr) == '%')
                {
                        receiver.push_back(*ptr);
                        continue;
                }
                if (*ptr=='0')
                        receiver += msg.msg1;
                else if (*ptr=='1')
                        receiver += msg.msg2;
        }
        return receiver;
}

VMRuntimeError::VMRuntimeError (Error::Codes errorcode,
                                         const std::string &msg1,
                                         const std::string &msg2)
  : std::runtime_error("HareScript:" + GetMessageString(Message(true, errorcode, msg1, msg2)))
  , Message(true, errorcode, msg1, msg2)
{
}

void ThrowInternalError(const char *error)
{
        DEBUGPRINT("Internal error:" << error);
        throw VMRuntimeError(Error::InternalError, error);
}

void ThrowInternalError(std::string const &error)
{
        ThrowInternalError(error.c_str());
}

void ThrowVMRuntimeError(Error::Codes errorcode, const char *msg1, const char *msg2)
{
        throw VMRuntimeError(errorcode, msg1, msg2);
}


VMRuntimeError::~VMRuntimeError() throw()
{
}

} // End of namespace HareScript
