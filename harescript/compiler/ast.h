#ifndef blex_webhare_compiler_ast
#define blex_webhare_compiler_ast

#include "symboltable.h"
#include "../vm/errors.h"
#include "visitors.h"

/** In this file all the AST structures are defined.

    Make sure that every object is used only once in the tree; copies can be
    made with the TreeCopyingVisitor; Variable-objects can be copied by using
    ImVariable(oldobj->position, oldobj->symbol) */

namespace HareScript
{
namespace Compiler
{

struct CompilerContext;

namespace AST
{

#undef ACTION
#define ACTION(name) FORWARD(name)

// Forward defines of ALL used structures
//ACTION(Argument)
ACTION(ArrayDelete);
ACTION(ArrayElementConst);
ACTION(ArrayElementModify);
ACTION(ArrayInsert);
ACTION(Assignment);
ACTION(BinaryOperator);
ACTION(Block);
ACTION(BreakStatement);
ACTION(BuiltinInstruction);
ACTION(Cast);
ACTION(ConditionalOperator);
ACTION(ConditionalStatement);
ACTION(Constant);
ACTION(ConstantRecord);
ACTION(ConstantArray);
ACTION(ContinueStatement);
ACTION(DeepOperation);
ACTION(DeepArrayDelete);
ACTION(DeepArrayInsert);
ACTION(ExpressionBlock);
ACTION(End);
ACTION(ForEveryStatement);
ACTION(Function);
ACTION(FunctionCall);
ACTION(FunctionPtr);
ACTION(FunctionPtrCall);
ACTION(FunctionPtrRebind);
ACTION(InitializeStatement);
ACTION(LoopStatement);
ACTION(Lvalue);
ACTION(LvalueSet);
ACTION(Module);
ACTION(Node);
ACTION(RecordColumnConst);
ACTION(ObjectMemberConst);
ACTION(ObjectMethodCall);
ACTION(ObjectTypeUID);
ACTION(RecordCellSet);
ACTION(ObjectMemberInsert);
ACTION(ObjectMemberDelete);
ACTION(ObjectExtend);
ACTION(ObjectMemberSet);
ACTION(RecordCellDelete);
ACTION(ReturnStatement);
ACTION(Rvalue);
ACTION(SchemaTable);
ACTION(SingleExpression);
ACTION(Statement);
ACTION(SwitchStatement);
ACTION(TypeInfo);
ACTION(TryCatchStatement);
ACTION(TryFinallyStatement);
ACTION(UnaryOperator);
ACTION(Variable);
ACTION(Yield);

ACTION(SQL);
ACTION(SQLDataModifier);
ACTION(SQLDelete);
ACTION(SQLInsert);
ACTION(SQLSource);
ACTION(SQLSources);
ACTION(SQLSelect);
ACTION(SQLUpdate);

#define ERRORRETURN { throw (Error(HSERR_INTERNALERROR, "Undefined visit function called in AST visitor")); }

typedef std::vector<Rvalue*> RvaluePtrs;

// -----------------------------------------------------------------------------
//
//      Misc stuff
//
struct LvalueLayer
{
        LineColumn position;
        enum Type { Array, Record, Object } type;
        Rvalue* expr;
        std::string name;
        bool via_this;
        bool is_member;
        LineColumn next_token;
        LvalueLayer (LineColumn _position, Rvalue* _expr) : position(_position), type(Array), expr(_expr), via_this(false), is_member(false) {}
        LvalueLayer (LineColumn _position, std::string const &_name) : position(_position), type(Record), expr(0), name(_name), via_this(false), is_member(false) {}
        LvalueLayer (LineColumn _position, std::string const &_name, bool via_this, bool is_member, LineColumn next_token) : position(_position), type(Object), expr(0), name(_name), via_this(via_this), is_member(is_member), next_token(next_token) {}
};
typedef std::vector< LvalueLayer > LvalueLayers;


/** Represents an directly modifyable expression that has the [arrayidx], .recordcell and ->objectmember stuff peeled off.
    Can only contain a ->objectmember as first layer above the base.
    The base expression is a variable, except when the first layer is an ->objectmember, then it can be an expression.
    The basevar is only set when the base expression is a variable.
*/
struct ConvertedLvalue
{
        // Expression position (top of original expression)
        LineColumn exprpos;

        /// Base lvalue to update. Can be an expression of type OBJECT when the first layer is type ->objectmember, else it is an AST::Variable.
        Rvalue *base;

        /// Base variable symbol (only set then base is a AST::Variable). Type: X ARRAY or RECORD: NOT FULLY CHECKED! Does not exist with base isn't a variable.
        Symbol *basevar;

        /// Is the first layer of the form object->member (and if so, the base expression should be of type OBJECT)
        bool first_layer_is_objectref;

        /// Lvalue layers, list of subscripts and column names. (begin() operates on base, begin()+1 on that, etc)
        LvalueLayers layers;
};


struct ArrayLocation
{
        enum Type { Missing, Index, End, All, Where } type;
        Rvalue* expr;
        explicit inline ArrayLocation(Type _type, Rvalue* _expr = 0) : type(_type), expr(_expr) {}
};

// -----------------------------------------------------------------------------
//
// Base visitors
//
#undef ACTION
#define ACTION NODEBASEACCEPTER
struct BaseDeepOperationVisitor
{
        virtual ~BaseDeepOperationVisitor() = 0;

        ACTION(DeepOperation)
        ACTION(LvalueSet)
        ACTION(DeepArrayDelete)
        ACTION(DeepArrayInsert)
};
struct BaseStatementVisitor: public BaseDeepOperationVisitor
{
        virtual ~BaseStatementVisitor() = 0;

        ACTION(ArrayDelete)
        ACTION(ArrayInsert)
        ACTION(Block)
        ACTION(BreakStatement)
        ACTION(ConditionalStatement)
        ACTION(ContinueStatement)
        ACTION(InitializeStatement)
        ACTION(ForEveryStatement)
        ACTION(LoopStatement)
        ACTION(ObjectMemberSet)
        ACTION(ObjectMemberInsert)
        ACTION(ObjectMemberDelete)
        ACTION(ObjectExtend)
        ACTION(ReturnStatement)
        ACTION(SingleExpression)
        ACTION(Statement)
        ACTION(SwitchStatement)
        ACTION(TryCatchStatement)
        ACTION(TryFinallyStatement)

        ACTION(SQLDelete)
        ACTION(SQLInsert)
        ACTION(SQLUpdate)
};
struct BaseExpressionVisitor
{
        virtual ~BaseExpressionVisitor() = 0;

        ACTION(ArrayElementConst)
        ACTION(ArrayElementModify)
        ACTION(Assignment)
        ACTION(BinaryOperator)
        ACTION(BuiltinInstruction)
        ACTION(Cast)
        ACTION(ConditionalOperator)
        ACTION(Constant)
        ACTION(ConstantRecord)
        ACTION(ConstantArray)
        ACTION(End)
        ACTION(ExpressionBlock)
        ACTION(FunctionPtr)
        ACTION(FunctionPtrCall)
        ACTION(FunctionPtrRebind)
        ACTION(FunctionCall)
        ACTION(Lvalue)
        ACTION(RecordCellSet)
        ACTION(RecordCellDelete)
        ACTION(RecordColumnConst)
        ACTION(ObjectMemberConst)
        ACTION(ObjectMethodCall)
        ACTION(ObjectTypeUID)
        ACTION(Rvalue)
        ACTION(SchemaTable)
        ACTION(SQLSelect)
        ACTION(TypeInfo)
        ACTION(UnaryOperator)
        ACTION(Variable)
        ACTION(Yield)
};
struct BaseSQLVisitor
{
        virtual ~BaseSQLVisitor() = 0;

        ACTION(SQL)
        ACTION(SQLSource)
        ACTION(SQLSources)
        ACTION(SQLDataModifier)
};
struct BaseNodeVisitor: public BaseSQLVisitor, public BaseExpressionVisitor, public BaseStatementVisitor
{
        ACTION(Function)
        ACTION(Module)
        ACTION(Node)
};

// -----------------------------------------------------------------------------
//
//      Node + module organisation
//
/// A node is the base type for all AST types
struct Node
{
        /// Position within the current script this node most relates to
        LineColumn position;

        DEFINE_NODE_FUNCTIONS1(Node, Node)
        virtual ~Node() {}
    protected:
        Node(LineColumn const &position) : position(position) {}
};

/** A module contains a HareScript script */
struct Module: public Node
{
        /// Original uri used to name the script file.
        std::string orgsrcname;

        /// Symbol that names ':outsidestate' variable; has no variabledef!!
        Symbol *outsidestate;

        /// List of functions defined in this library
        std::vector<Function *> functions;

        /// List of external functions defined in this library
        std::vector<Function *> external_functions;

        /// List of variables that are reexported (can be functions and variables)
        std::vector<Symbol *> exportedvars;

        /// List of loaded libraries (direct and indirect)
        std::vector<SymbolDefs::Library *> loadlibs;

        /// All object types
        std::vector<Symbol *> objecttypes;

        /// Script property file id (ADDME: Generalize)
        int32_t scriptproperty_fileid;
        Blex::DateTime scriptproperty_filecreationdate;
        bool scriptproperty_systemredirect;

        DEFINE_NODE_FUNCTIONS1(Module, Node)

        Module(LineColumn const &position)
        : Node(position)
        , scriptproperty_fileid(0)
        , scriptproperty_filecreationdate(0,0)
        , scriptproperty_systemredirect(false)
        {
        }
};

/// A Function node contains a function or a macro
struct Function: public Node
{
        /// Function symbol (has functiondef, which contains function type
        Symbol *symbol;

        /// Block with statements of this function
        Block* block;

        /// Position of clising bracket
        LineColumn blockcloseposition;

        DEFINE_NODE_FUNCTIONS1(Function, Node)

        Function(LineColumn const &position) : Node(position), symbol(0), block(0), blockcloseposition(position) { }
};

// -----------------------------------------------------------------------------
//
//      Statements
//

/// Base node for statements
struct Statement: public Node
{
        DEFINE_NODE_FUNCTIONS2(Statement, Node, Statement)

    protected:
        Statement(LineColumn const &position) : Node(position) {}
};

/** A block contains a list of statements that are executed as one statement.
    Used to translate { ... }. */
struct Block: public Statement
{
        /// List of statements within the block
        std::vector<Statement*> statements;

        DEFINE_NODE_FUNCTIONS2(Block, Node, Statement)

        Block(LineColumn const &position) : Statement(position) {}
};

/// A return statement returns from a function or a macro, in functions it must return a value of the type specified by the function
struct ReturnStatement: public Statement
{
        /// List of values returned (size() can be 0 or 1, depending on function type). Types are checked.
        Rvalue* returnvalue;

        DEFINE_NODE_FUNCTIONS2(ReturnStatement, Node, Statement)

        ReturnStatement(LineColumn const &position, Rvalue* value)
        : Statement(position), returnvalue(value)
        {
        }
};

/** A conditional statement is the translation of the IF <cond> <statement> [ELSE <statement>] */
struct ConditionalStatement: public Statement
{
        /// Condition of the statement. Type BOOLEAN, checked.
        Rvalue* condition;

        /// Statement that must be executed when condition evaluates to TRUE
        Statement* stat_true;

        /// Optional statement that must be executed when condition evaluates to FALSE. Can be 0.
        Statement* stat_false; // Can be 0!

        DEFINE_NODE_FUNCTIONS2(ConditionalStatement, Node, Statement)

        ConditionalStatement(LineColumn const &position) : Statement(position), condition(0), stat_true(0), stat_false(0) { }
};

/// Translation of the FOREVERY ([TYPE] <iteratevar> FROM <source>) <statement> statement. Translated in 'sqltranslator' to simpler statements.
struct ForEveryStatement: public Statement
{
        /// Expression containing the source. Type is ( type_of(<iteratevar>) + ARRAY ), checked.
        Rvalue* source;

        /// Iteration variable. Type is guaranteed.
        Variable* iteratevar;

        /// Block that is executed in every iteration
        Block* loop;

        /// Variable containing current position in the forevery expression. Type INTEGER, checked.
        Variable* positionvar;

        DEFINE_NODE_FUNCTIONS2(ForEveryStatement, Node, Statement)

        ForEveryStatement(LineColumn const &position) : Statement(position), source(0), iteratevar(0), loop(0) { }
};

/// Contains a loop with a precondition, an incrementer and a block to execute
struct LoopStatement: public Statement
{
        /// Optional expression that is evaluated before a loop. If it evaluates to FALSE, the loop is terminated. Can be 0. Type: BOOLEAN, checked.
        Rvalue* precondition; // Can be 0!

        /// Optional expression executed after a loop iteration hase finished (by walking out of the block, or by CONTINUE). Can be 0. Type: unknown, check not needed!
        Rvalue* loopincrementer; // Can be 0!

        /// Block that is executed in every iteration
        Block* loop;

        DEFINE_NODE_FUNCTIONS2(LoopStatement, Node, Statement)

        LoopStatement(LineColumn const &position) : Statement(position), precondition(0), loopincrementer(0), loop(0) { }
};

/// Jumps out of the the innermost loop
struct BreakStatement: public Statement
{
        DEFINE_NODE_FUNCTIONS2(BreakStatement, Node, Statement)

        BreakStatement(LineColumn const &position) : Statement(position) {}
};

/// Jumps to the next iteration within the innermost loop (the precondition of that loop will be checked.
struct ContinueStatement: public Statement
{
        DEFINE_NODE_FUNCTIONS2(ContinueStatement, Node, Statement)

        ContinueStatement(LineColumn const &position) : Statement(position) {}
};

/// Executes an expression as a statement
struct SingleExpression: public Statement
{
        /// Expression to execute. Type: unknown, no check needed!
        Rvalue* expr;

        DEFINE_NODE_FUNCTIONS2(SingleExpression, Node, Statement)

        SingleExpression(LineColumn const &position, Rvalue* expr) : Statement(position), expr(expr) {}
};

/// Initializes a variable with its default contents
struct InitializeStatement: public Statement
{
        /// Type of variable; symbol->variabledef is available
        Symbol *symbol;

        DEFINE_NODE_FUNCTIONS2(InitializeStatement, Node, Statement)

        InitializeStatement(LineColumn const &position, Symbol *symbol) : Statement(position), symbol(symbol) {}
};

/** Base node for array modifying statements */
struct ArrayModify: public Statement
{
        /// Variable specifying array (direct Variable of ExpressionBlock with a Variable). Type: X + ARRAY, NOT FULLY CHECKED!
        Lvalue* array; // Type not fully checked!

        /// Index where the modifying operation takes place.
        ArrayLocation location;

    protected:
        ArrayModify(LineColumn const &position, Lvalue* array, ArrayLocation loc) : Statement(position), array(array), location(loc) {}
};

/// Inserts an element into an array
struct ArrayInsert: public ArrayModify
{
        /// Value to insert. Type: type of array ~ !ARRAY, NOT FULLY CHECKED
        Rvalue* value; // Type not fully checked!

        DEFINE_NODE_FUNCTIONS2(ArrayInsert, Node, Statement)

        ArrayInsert(LineColumn const &position, Lvalue* array, ArrayLocation location, Rvalue* value) : ArrayModify(position, array, location), value(value) {}
};

/// Deletes an element from an array
struct ArrayDelete: public ArrayModify
{
        DEFINE_NODE_FUNCTIONS2(ArrayDelete, Node, Statement)

        ArrayDelete(LineColumn const &position, Lvalue* array, ArrayLocation location) : ArrayModify(position, array, location) {}
};

/** Do an operation deep within arrays within records, etc. */
struct DeepOperation: public Statement
{
        DEFINE_NODE_FUNCTIONS2(DeepOperation, Node, Statement)

        /// Converted lvalue (with layers peeled off, etc)
        ConvertedLvalue clvalue;

        /// Whether this node has been expanded (shortcuts looked at, object sets wrapped in objectmemberissimple if)
        bool is_rewritten;

        DeepOperation(LineColumn const &position, ConvertedLvalue const &_clvalue) : Statement(position),
                clvalue(_clvalue), is_rewritten(false) {}

        virtual bool RequireOldValue();
};


/** Sets a variable deep within arrays within records, etc. */
struct LvalueSet: public DeepOperation
{
        DEFINE_NODE_FUNCTIONS3(LvalueSet, Node, Statement, DeepOperation)

        // New value to insert. Type: depends on last layer, NOT FULLY CHECKED!
        Rvalue* value; // Type not fully checked!

        LvalueSet(LineColumn const &position, ConvertedLvalue const &clvalue, Rvalue* _value)
        : DeepOperation(position, clvalue)
        , value(_value)
        {}

        virtual bool RequireOldValue();
};

/** Deletes an element from an array deep within arrays within records, etc. */
struct DeepArrayDelete: public DeepOperation
{
        DEFINE_NODE_FUNCTIONS3(DeepArrayDelete, Node, Statement, DeepOperation)

        // Index where the modifying operation takes place.
        ArrayLocation location;

        DeepArrayDelete(LineColumn const &position, ConvertedLvalue const &clvalue, ArrayLocation _location)
        : DeepOperation(position, clvalue)
        , location(_location)
        {}
};

/** Appends a variable to an array deep within arrays within records, etc. */
struct DeepArrayInsert: public DeepOperation
{
        DEFINE_NODE_FUNCTIONS3(DeepArrayInsert, Node, Statement, DeepOperation)

        // New value to append. Type: depends on last layer, NOT FULLY CHECKED!
        Rvalue* value; // Type not fully checked!

        // Index where the modifying operation takes place.
        ArrayLocation location;

        DeepArrayInsert(LineColumn const &position, ConvertedLvalue const &clvalue, ArrayLocation _location, Rvalue* _value)
        : DeepOperation(position, clvalue)
        , value(_value)
        , location(_location)
        {}
};

struct ObjectExtend : public Statement
{
        Rvalue *object;
        Symbol *extendwith;
        RvaluePtrs parameters;
        bool via_this;

        DEFINE_NODE_FUNCTIONS2(ObjectExtend, Node, Statement)

        ObjectExtend(LineColumn const &position, Rvalue *object, Symbol *extendwith, RvaluePtrs const &parameters, bool via_this) : Statement(position), object(object), extendwith(extendwith), parameters(parameters), via_this(via_this) {}
};

struct ObjectMemberSet : public Statement
{
        Rvalue* object;
        std::string name;
        Rvalue* value;
        bool via_this;
        bool is_member;

        DEFINE_NODE_FUNCTIONS2(ObjectMemberSet, Node, Statement)

        ObjectMemberSet(LineColumn const &position, Rvalue *object, std::string const &name, Rvalue* value, bool via_this) : Statement(position), object(object), name(name), value(value), via_this(via_this), is_member(false) {}
};

struct ObjectMemberInsert : public Statement
{
        Rvalue* object;
        std::string name;
        Rvalue* value;
        bool via_this;
        bool is_private;

        DEFINE_NODE_FUNCTIONS2(ObjectMemberInsert, Node, Statement)

        ObjectMemberInsert(LineColumn const &position, Rvalue *object, std::string const &name, Rvalue* value, bool is_private, bool via_this) : Statement(position), object(object), name(name), value(value), via_this(via_this), is_private(is_private) {}
};

struct ObjectMemberDelete : public Statement
{
        Rvalue* object;
        std::string name;
        bool via_this;

        DEFINE_NODE_FUNCTIONS2(ObjectMemberDelete, Node, Statement)

        ObjectMemberDelete(LineColumn const &position, Rvalue *object, std::string const &name, bool via_this) : Statement(position), object(object), name(name), via_this(via_this) {}
};

struct SwitchStatement: public Statement
{
        DEFINE_NODE_FUNCTIONS2(SwitchStatement, Node, Statement)

        Rvalue* value;
        typedef std::vector< std::pair< RvaluePtrs , Block * > > CaseList;
        CaseList cases;
        Block *defaultcase;

        SwitchStatement(LineColumn const &position) : Statement(position), value(0), defaultcase(0) {}
};

struct TryCatchStatement: public Statement
{
        DEFINE_NODE_FUNCTIONS2(TryCatchStatement, Node, Statement)

        Block *tryblock;
        Block *catchblock;
        bool can_reach_try_end; // whether the end of the TRY-block can be reached

        TryCatchStatement(LineColumn const &position) : Statement(position), tryblock(0), catchblock(0), can_reach_try_end(true) {}
};

struct TryFinallyStatement: public Statement
{
        DEFINE_NODE_FUNCTIONS2(TryFinallyStatement, Node, Statement)

        TryCatchStatement *tryblock;
        Block *finallyblock;
        Block *finallycodeblock; // for user code

        Symbol *type; // 1: throw, 2: return, 3: break, 4: continue
        Symbol *value; // value to throw or return
        Symbol *var; // Exception when type = 1

        TryFinallyStatement(LineColumn const &position) : Statement(position), tryblock(0), finallyblock(0), finallycodeblock(0), type(0), value(0), var(0) {}
};

// -----------------------------------------------------------------------------
//
//      Single values
//
/// Base node for a non-modifyable expression
struct Rvalue: public Node
{
        DEFINE_NODE_FUNCTIONS2(Rvalue, Node, Expression)

    protected:
        Rvalue(LineColumn const &position) : Node(position) { }
};

/// Base node for a modifyable expression
struct Lvalue: public Rvalue
{
        DEFINE_NODE_FUNCTIONS2(Lvalue, Node, Expression)

        Lvalue(LineColumn const &position) : Rvalue(position) { }
};

/// Contains a modifyable variable
struct Variable: public Lvalue
{
        /// Symbol for this variable. Contains symbol->variabledef
        Symbol *symbol;

        DEFINE_NODE_FUNCTIONS2(Variable, Node, Expression)

        Variable(LineColumn position, Symbol *symbol) : Lvalue(position), symbol(symbol) { assert(symbol->variabledef); }
};

/// Contains a Constant
struct Constant: public Rvalue
{
        /// Type of this constant
        VariableTypes::Type type;

        /// Varmemory variable containing the value
        VarId var;

        DEFINE_NODE_FUNCTIONS2(Constant, Node, Expression)

        Constant(LineColumn const &position, VariableTypes::Type _type, VarId _var) : Rvalue(position), type(_type), var(_var) { }
};

/// Contains a constant record
struct ConstantRecord: public Rvalue
{
        enum EltType
        {
            Item =          0,
            Ellipsis =      1,
            Delete =        2
        };

        std::vector< std::tuple< EltType, std::string, Rvalue* > > columns;

        DEFINE_NODE_FUNCTIONS2(ConstantRecord, Node, Expression)

        ConstantRecord(LineColumn const &position) : Rvalue(position) { }
};

/// Contains a constant array
struct ConstantArray: public Rvalue
{
        std::vector< std::tuple< LineColumn, Rvalue *, bool > > values;
        VariableTypes::Type type;

        DEFINE_NODE_FUNCTIONS2(ConstantArray, Node, Expression)

        ConstantArray(LineColumn const &position, VariableTypes::Type _type) : Rvalue(position), type(_type) { }
};

/// Contains a function pointer
struct FunctionPtr : public Rvalue
{
        Symbol *function;
        ///Hold the input parameter number for passthrough parameters. 0 if a constant
        std::vector<int32_t> passthrough_parameters;
        RvaluePtrs bound_parameters;
        bool parameters_specified;
        bool outside_ptr;
        bool inhibit_aggregate;
        VariableTypes::Type excessargstype;
        int32_t firstunusedsource;

        DEFINE_NODE_FUNCTIONS2(FunctionPtr, Node, Expression);

        FunctionPtr(LineColumn const &position) : Rvalue(position), outside_ptr(true), inhibit_aggregate(false), excessargstype(VariableTypes::Uninitialized), firstunusedsource(1) { }

};

struct FunctionPtrCall : public Rvalue
{
        Rvalue *functionptr;
        RvaluePtrs params;
        bool allow_macro;

        DEFINE_NODE_FUNCTIONS2(FunctionPtrCall, Node, Expression)

        FunctionPtrCall (LineColumn const &position, Rvalue *_functionptr, const RvaluePtrs &parameters) : Rvalue(position), functionptr(_functionptr), params(parameters), allow_macro(true) {}
};

struct FunctionPtrRebind : public Rvalue
{
        Rvalue *orgptr;
        bool outside_ptr;

        ///Hold the input parameter number for passthrough parameters. 0 if a constant
        std::vector< int32_t > passthrough_parameters;
        RvaluePtrs bound_parameters;

        DEFINE_NODE_FUNCTIONS2(FunctionPtrRebind, Node, Expression);

        FunctionPtrRebind(LineColumn const &position, bool _outside_ptr) : Rvalue(position), outside_ptr(_outside_ptr) { }
};

/// Identifies the typeinfo attached to a specific variable
struct TypeInfo: public Rvalue
{
        Symbol *symbol;
        HareScript::DBTypeInfo *typeinfo;

        DEFINE_NODE_FUNCTIONS2(TypeInfo, Node, Expression)

        TypeInfo(LineColumn const &position, Symbol *symbol, HareScript::DBTypeInfo *_typeinfo) : Rvalue(position), symbol(symbol), typeinfo(_typeinfo) { }

        void BuildTypeInfoFromSymbol(CompilerContext &context);
};

/// Casts an expression of unknown type to a known type
struct Cast: public Rvalue
{
        /// Expression which must be checked. Type: VARIANT, checked.
        Rvalue* expr;

        /// Type to which the expression must be casted (VARIANT not allowed!)
        VariableTypes::Type to_type;

        /// If used for parameter casting, this is the relevant function
        Symbol *function;

        /// Is this an explicit cast by the user?
        bool is_explicit;

        /// Allow this cast to be treated as parameter cast
        bool allow_parameter_cast;

        DEFINE_NODE_FUNCTIONS2(Cast, Node, Expression)

        Cast(LineColumn const &position, Rvalue* expr, VariableTypes::Type const to_type, bool _is_explicit, bool _allow_parameter_cast) : Rvalue(position), expr(expr), to_type(to_type), function(0), is_explicit(_is_explicit), allow_parameter_cast(_allow_parameter_cast) { }
};

// -----------------------------------------------------------------------------
//
//      Composite expression
//

/// Contains an unary operator and the expression it operates on.
struct UnaryOperator: public Rvalue
{
        UnaryOperatorType::Types operation;
        Rvalue* lhs;

        DEFINE_NODE_FUNCTIONS2(UnaryOperator, Node, Expression)

        UnaryOperator(LineColumn const &position, UnaryOperatorType::Types operation, Rvalue* lhs) : Rvalue(position), operation(operation), lhs(lhs) {}
};

struct BinaryOperator: public Rvalue
{
        BinaryOperatorType::Types operation;
        Rvalue* lhs;
        Rvalue* rhs;

        DEFINE_NODE_FUNCTIONS2(BinaryOperator, Node, Expression)

        BinaryOperator(LineColumn const &position, BinaryOperatorType::Types operation, Rvalue* lhs, Rvalue* rhs) : Rvalue(position), operation(operation), lhs(lhs), rhs(rhs) {}
};

struct ConditionalOperator: public Rvalue
{
        Rvalue* condition;
        Rvalue* expr_true;
        Rvalue* expr_false;

        DEFINE_NODE_FUNCTIONS2(ConditionalOperator, Node, Expression)

        ConditionalOperator(LineColumn const &position, Rvalue* condition, Rvalue* expr_true, Rvalue* expr_false)
        : Rvalue(position), condition(condition), expr_true(expr_true), expr_false(expr_false) {}
};

struct RecordColumnConst: public Rvalue
{
        Rvalue* record;
        std::string name;

        DEFINE_NODE_FUNCTIONS2(RecordColumnConst, Node, Expression)

        RecordColumnConst(LineColumn const &position, Rvalue* const & record, std::string const &name) : Rvalue(position), record(record), name(name) {}
};

struct ObjectMemberConst: public Rvalue
{
        Rvalue* object;
        std::string name;
        bool via_this;
        bool is_member;
        LineColumn next_token;

        DEFINE_NODE_FUNCTIONS2(ObjectMemberConst, Node, Expression)

        ObjectMemberConst(LineColumn const &position, Rvalue* const & record, std::string const &name, bool via_this, LineColumn const &next_token) : Rvalue(position), object(record), name(name), via_this(via_this), is_member(false), next_token(next_token) {}
};

struct ObjectMethodCall : public Rvalue
{
        Rvalue* object;
        std::string membername;
        bool via_this;
        RvaluePtrs parameters;

        bool has_passthroughs;
        std::vector< int32_t > passthrough_parameters;

        bool allow_macro;

        DEFINE_NODE_FUNCTIONS2(ObjectMethodCall, Node, Expression)

        ObjectMethodCall(LineColumn const &position, Rvalue *_object, std::string const &_membername, bool _via_this, const RvaluePtrs &_parameters, bool _has_passthroughs, std::vector< int32_t > const &_passthrough_parameters);
};

/// Contains a objectype UID
struct ObjectTypeUID : public Rvalue
{
        Symbol *objtype;

        DEFINE_NODE_FUNCTIONS2(ObjectTypeUID, Node, Expression)

        ObjectTypeUID(LineColumn const &position, Symbol *_objecttype) : Rvalue(position), objtype(_objecttype) { }
};

struct RecordModify: public Rvalue
{
        Lvalue* record;
        std::string name;

    protected:
        RecordModify(LineColumn const &position, Lvalue* record, std::string const &name) : Rvalue(position), record(record), name(name) {}
};

struct RecordCellSet: public RecordModify
{
        Rvalue* value;
        bool cancreate;
        bool check_type;

        DEFINE_NODE_FUNCTIONS2(RecordCellSet, Node, Expression)

        RecordCellSet(LineColumn const &position, Lvalue* record, std::string const &name, Rvalue* value, bool cancreate, bool check_type) : RecordModify(position, record, name), value(value), cancreate(cancreate), check_type(check_type) {}
};

struct RecordCellDelete: public RecordModify
{
        DEFINE_NODE_FUNCTIONS2(RecordCellDelete, Node, Expression)

        RecordCellDelete(LineColumn const &position, Lvalue* record, std::string const &name) : RecordModify(position, record, name) {}
};

struct End : public Rvalue
{
        DEFINE_NODE_FUNCTIONS2(End, Node, Expression)
        End(LineColumn const &position) : Rvalue(position) {}
};

struct ArrayElementConst: public Rvalue
{
        Rvalue* array;
        Rvalue* index;

        DEFINE_NODE_FUNCTIONS2(ArrayElementConst, Node, Expression)

        ArrayElementConst(LineColumn const &position, Rvalue* array, Rvalue* index) : Rvalue(position), array(array), index(index) {}
};

struct ArrayElementModify: public Rvalue
{
        Rvalue* array;
        Rvalue* index;
        Rvalue* value;

        DEFINE_NODE_FUNCTIONS2(ArrayElementModify, Node, Expression)

        ArrayElementModify(LineColumn const &position, Rvalue* variable, Rvalue* index, Rvalue* value) : Rvalue(position), array(variable), index(index), value(value) {}
};

struct Assignment: public Rvalue
{
        Variable* target;
        Rvalue* source;
        bool is_initial_assignment;

        DEFINE_NODE_FUNCTIONS2(Assignment, Node, Expression)

        Assignment(LineColumn const &position, Variable* target, Rvalue* source, bool is_initial_assignment) : Rvalue(position), target(target), source(source), is_initial_assignment(is_initial_assignment) { }
};

struct FunctionCall : public Rvalue
{
        Symbol *symbol;
        RvaluePtrs parameters;
        bool as_aggregate;
        bool inhibit_aggregate;
        bool generated;

        DEFINE_NODE_FUNCTIONS2(FunctionCall, Node, Expression)

        FunctionCall (LineColumn const &position, Symbol *symbol, const RvaluePtrs &parameters, bool _generated) : Rvalue(position), symbol(symbol), parameters(parameters), as_aggregate(false), inhibit_aggregate(false), generated(_generated) {}
};

struct BuiltinInstruction: public Rvalue
{
        VariableTypes::Type result_type;
        std::string name;
        RvaluePtrs parameters;
        bool modifies_outsidestate;
        bool calls_harescript;

        DEFINE_NODE_FUNCTIONS2(BuiltinInstruction, Node, Expression)

        BuiltinInstruction(LineColumn const &_position, VariableTypes::Type _result_type, std::string const &_name, const RvaluePtrs &_parameters, bool mod_outsidestate, bool calls_harescript) : Rvalue(_position), result_type(_result_type), name(_name), parameters(_parameters), modifies_outsidestate(mod_outsidestate), calls_harescript(calls_harescript) {}
};

struct ExpressionBlock : public Lvalue
{
        Block *block;
        Variable* returnvar;

        DEFINE_NODE_FUNCTIONS2(ExpressionBlock, Node, Expression)

        ExpressionBlock (LineColumn const &position, Block *block, Variable* returnvar) : Lvalue(position), block(block), returnvar(returnvar) {}
};

struct SchemaTable : public Rvalue
{
        Variable* schema;
        std::string name;

        DEFINE_NODE_FUNCTIONS2(SchemaTable, Node, Expression)

        SchemaTable(LineColumn const &position, Variable* const & schema, std::string const &name) : Rvalue(position), schema(schema), name(name) {}
};

struct Yield: public Rvalue
{
        Rvalue* generator;
        Rvalue* yieldexpr;
        bool isasync;
        bool isawait;
        bool wrapped;
        bool star;

        DEFINE_NODE_FUNCTIONS2(Yield, Node, Expression)

        Yield(LineColumn const &position, Rvalue* generator, Rvalue* yieldexpr, bool isasync, bool isawait, bool wrapped, bool star) : Rvalue(position), generator(generator), yieldexpr(yieldexpr), isasync(isasync), isawait(isawait), wrapped(wrapped), star(star) {}
};

// -----------------------------------------------------------------------------
//
//      SQL
//

struct SQL : public Node
{
        DEFINE_NODE_FUNCTIONS2(SQL, Node, SQL)
    protected:
        SQL(LineColumn const &position) : Node(position) {}
};

struct SQLDataModifier: public SQL
{
        std::vector<std::string> columns; // "" for '*'
        RvaluePtrs values;
        SQLSource* source; // Source, can be 0

        DEFINE_NODE_FUNCTIONS2(SQLDataModifier, Node, SQL)

        SQLDataModifier (LineColumn const &position) : SQL(position), source(0) {}
};

struct SQLDelete: public Statement
{
        SQLSource* sources;
        ArrayLocation location;

        DEFINE_NODE_FUNCTIONS2(SQLDelete, Node, Statement)

        SQLDelete (LineColumn const &position, SQLSource* sources, ArrayLocation pos) : Statement(position), sources(sources), location(pos) {}
};

struct SQLInsert: public Statement
{
        SQLSource* source;
        SQLDataModifier* modifier;
        ArrayLocation location;

        DEFINE_NODE_FUNCTIONS2(SQLInsert, Node, Statement)

        SQLInsert (LineColumn const &position, SQLSource* source, SQLDataModifier* modifier, ArrayLocation pos) : Statement(position), source(source), modifier(modifier), location(pos) {}
};

struct SQLSelect: public Rvalue
{
        struct SelectItem
        {
                Rvalue *expr;
                std::string name;
                bool is_delete;
                bool is_spread;
                bool is_star;
                bool from_star;
                LineColumn deletecolumnpos;
        };

        struct Temporary
        {
                Symbol *symbol;
                Rvalue *expr;
                LineColumn assignpos;
        };

        VariableTypes::Type result_type;
        std::vector< Temporary > temporaries;
        std::vector< SelectItem > namedselects;
        std::vector< Rvalue* > groupings;
        bool is_grouped;
        bool is_grouped_afterall; // Used when things like COUNT(*) is found in select
        Rvalue *having_expr;
        SQLSources* sources;
        ArrayLocation location;
        std::vector<std::pair<Rvalue*, bool> > orderings;
        Rvalue *limit_expr;
        bool has_distinct;

        DEFINE_NODE_FUNCTIONS2(SQLSelect, Node, Expression)

        SQLSelect (LineColumn const &position) : Rvalue(position), result_type(VariableTypes::Uninitialized), is_grouped(false), is_grouped_afterall(false), having_expr(0), sources(0), location(ArrayLocation::Missing), limit_expr(0) {}
};

struct SQLSource : public SQL
{
        // Symbol that represents this source (substitution variable)
        Symbol *symbol;

        // Substitution variable name
        std::string subst_name;

        // Source expression
        Rvalue* expression;

        // Original source expression
        Rvalue* org_expression;

        // Variable to return result array to (may be 0)
        Variable* reassign;

        // Sequence nr of this table
        unsigned tablenr;

        // Typeinfo for this source
        TypeInfo *typeinfo;

        DEFINE_NODE_FUNCTIONS2(SQLSource, Node, SQL)

        SQLSource(LineColumn const &position, std::string const &subst_name, Rvalue* expression, Rvalue* org_expression, Variable* _reassign) : SQL(position), symbol(0), subst_name(subst_name), expression(expression), org_expression(org_expression), reassign(_reassign), tablenr(0), typeinfo(0) {}
};

struct SQLSources: public SQL
{
        // List of SQL relations from which is selected, including a symbol that represents it
        std::vector<SQLSource*> sources;
        // Return true if the specified symbol is any of the sources in our sources list
        bool IsASource(Symbol const *symbol) const;

        DEFINE_NODE_FUNCTIONS2(SQLSources, Node, SQL)

        SQLSources(LineColumn const &position) : SQL(position) {}
};

struct SQLUpdate: public Statement
{
        SQLSource* source;
        SQLDataModifier* modifier;
        ArrayLocation location;

        DEFINE_NODE_FUNCTIONS2(SQLUpdate, Node, Statement)

        SQLUpdate (LineColumn const &position, SQLSource* source, SQLDataModifier* modifier, ArrayLocation location)
        : Statement(position), source(source), modifier(modifier), location(location) {}
};

} // end of namespace AST
} // end of namespace Compiler
} // end of namespace HareScript

#endif
