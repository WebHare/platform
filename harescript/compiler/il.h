#ifndef blex_webhare_compiler_il
#define blex_webhare_compiler_il
//---------------------------------------------------------------------------

/** This file defines the structure of the IL objects

    This intermediate language is based on SSA, and is strict (that is,
    every use of a variable MUST be preceded by an assignment (in the
    dominator tree).

    Restrictions:
    - Variables with storage type 'Global' may NEVER have two concurrent
      existing versions! With stack variables, that's no problem.
      (Only public variables and variables in the global scope, used by
      a function (other than :INITFUNCTION) have global storage).
*/

#include "compiler.h"
#include "../vm/hsvm_constants.h"
#include "symboltable.h"
#include "visitors.h"
#include "utilities.h"

namespace HareScript
{
namespace Compiler
{
class ILDotPrinter;
class ILGenerator;
class SSAFixupper;

namespace IL
{

struct BasicBlock;
struct Function;

#undef ACTION
#define ACTION(name) FORWARD(name)

ACTION(ILInstruction);
ACTION(ILConstant);
ACTION(ILAssignment);
ACTION(ILBinaryOperator);
ACTION(ILCast);
ACTION(ILUnaryOperator);
ACTION(ILFunctionCall);
ACTION(ILColumnOperator);
ACTION(ILConditionalJump);
ACTION(ILReturn);
ACTION(ILMethodCall);
ACTION(ILFunctionPtrCall);
ACTION(ILRecordCellSet);
ACTION(ILRecordCellDelete);
ACTION(ILObjectMemberGet);
ACTION(ILObjectMemberSet);
ACTION(ILObjectMemberDelete);
ACTION(ILObjectMemberInsert);

#undef ACTION
#define ACTION NODEBASEACCEPTER
struct BaseILVisitor
{
        virtual ~BaseILVisitor() = 0;

        ACTION(ILInstruction)
        ACTION(ILConstant)
        ACTION(ILCast)
        ACTION(ILAssignment)
        ACTION(ILBinaryOperator)
        ACTION(ILUnaryOperator)
        ACTION(ILFunctionCall)
        ACTION(ILColumnOperator)
        ACTION(ILConditionalJump)
        ACTION(ILReturn)
        ACTION(ILMethodCall)
        ACTION(ILFunctionPtrCall)
        ACTION(ILRecordCellSet)
        ACTION(ILRecordCellDelete)
        ACTION(ILObjectMemberGet)
        ACTION(ILObjectMemberSet)
        ACTION(ILObjectMemberDelete)
        ACTION(ILObjectMemberInsert)
};

/** Structure representing a constant. */
struct Constant
{
        VariableTypes::Type type;
        VarId var;
        DBTypeInfo *typeinfovalue;

        explicit Constant() : type(VariableTypes::Uninitialized), var(0), typeinfovalue(0) {}
        explicit Constant(VariableTypes::Type type, VarId var) : type(type), var(var), typeinfovalue(0) {}
        explicit Constant(DBTypeInfo *value) : type(VariableTypes::TypeInfo), var(0), typeinfovalue(value) {}
        explicit Constant(StackMachine &stackm, int32_t val) : type(VariableTypes::Integer), var(stackm.NewHeapVariable()), typeinfovalue(0) { stackm.SetInteger(var, val); }
        explicit Constant(StackMachine &stackm, std::string const &val) : type(VariableTypes::String), var(stackm.NewHeapVariable()), typeinfovalue(0) { stackm.SetSTLString(var, val); }
        explicit Constant(StackMachine &stackm, const char *val) : type(VariableTypes::String), var(stackm.NewHeapVariable()), typeinfovalue(0) { stackm.SetSTLString(var, val); }
        explicit Constant(StackMachine &stackm, bool val) : type(VariableTypes::Boolean), var(stackm.NewHeapVariable()), typeinfovalue(0) { stackm.SetBoolean(var, val); }

        Constant(Constant const &rhs) : type(rhs.type), var(rhs.var), typeinfovalue(rhs.typeinfovalue) {}
        Constant & operator =(Constant const &) = default;
};

// The address of a variable object uniquely identifies that variable
struct Variable
{
        enum StorageType
        {
                Global,         ///< Variable is a global variable
                Stack,          ///< Variable is allocated on stack (and can be eliminated)
                None            ///< Variable a dummy
        };
        StorageType storagetype;

        VariableTypes::Type type;

        /** Temporary members, later to build a better one */
        std::string name;
        Symbol *symbol;

        Variable (VariableTypes::Type _type) : type(_type) {}
        Variable & operator =(Variable const &) = default;
};

/** An SSAVariable represents a static single assignment from a variable. It is
    identified by it's address; if lhs==rhs -> &lhs == &rhs, except when id is 0.
    Id can only be zero during code generation, outside code generation no SSAVariable
    object with id 0 may be reachable! */
struct SSAVariable
{
        Variable *variable;

        /// Id is really unneccessary now.
        const unsigned id;

        SSAVariable(Variable *variable) : variable(variable), id(0) {}
    protected:
        SSAVariable(Variable *variable, unsigned id) : variable(variable), id(id) {}
};

// This is just a rename for a SSA variable that has an id other than 0. (only used in for code generation)
struct AssignSSAVariable: public SSAVariable
{
        AssignSSAVariable(Variable *variable, unsigned id) : SSAVariable(variable, id)
        {
                if (id == 0) throw std::logic_error("AssignSSAVariable constructor called with an id of 0!");
        }
};

struct PhiFunction
{
        AssignSSAVariable *variable;
        std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> > params;

        PhiFunction(AssignSSAVariable *variable) : variable(variable) { }
};

/** The flowstate is computed during code generation, it carries information
    about which definition can reach the current location. It is only applicable
    during code generation; after optimization a variable can have two SSAVariables
    alive at the same point.
    Flowstates are also (a bit) filtered on scope rules; variables that have gone
    out of scope are removed. This to keep the flowstate smaller. */
struct FlowState
{
        /** During code generation, a variable is NEVER live after it has a phi-function
            applied to it; this because of the form of the AST. Therefore, we can keep
            a map from variables to their current SSAVariable. */
        typedef std::map<IL::Variable *, IL::AssignSSAVariable *> VisibleAssignmentsMap;
        VisibleAssignmentsMap visibleassignments;

        /** Exports the list of visbible variables */
        void ExportVariables(std::set<Variable *> *vars);

        /** Removes all variables not in vars */
        void FilterByVariables(std::set<Variable *> const &vars);
};

struct UseDefTracker
{
        private:
        std::vector< AssignSSAVariable * > defs;
        std::vector< SSAVariable * > uses;

        public:
        void AddUse(SSAVariable *var);
        void AddDef(AssignSSAVariable *var);

        /** Replace all variables in 'uses' by there corresponding versions in the flowstate */
        void ReplaceUses(FlowState const &flowstate);

        /** Updated the flowstate will all the definitions in 'defs' */
        void UpdateFlowState(FlowState &flowstate);

        /** Adds a use for every defined global */
        void AddUsesForDefinedGlobals(FlowState const &flowstate);

        /** Returns whether this instruction modifies a global variable */
        bool DefinesGlobals() const;

        /** Returns whether this instruction uses a global variable */
        bool UsesGlobals() const;

        /** Insert all defined variables into a set
            @param varlist Pointer to variable list in which to insert (ADDME: hmm.. why isn't it a Variable* set ? ) */
        void InsertDefined(std::set<SSAVariable*> *varlist) const;
        void AppendDefined(std::vector<SSAVariable*> *varlist) const;

        /** Insert all used variables into a set
            @param varlist Pointer to variable list in which to insert (ADDME: hmm.. why isn't it a Variable* set ? ) */
        void InsertUsed(std::set<SSAVariable*> *varlist) const;
        void AppendUsed(std::vector<SSAVariable*> *varlist) const;

        void DumpObject(CCostream &out) const;
};

/** The base class for all intermediate language instructions.
    ADDME: Rob, should this perhaps be an ABC ? */
struct ILInstruction
{
        private:
        UseDefTracker usedefs;
//        std::set<AssignSSAVariable *> defs;          ///< Variables defined (or modified) by this instruction
//        std::set<SSAVariable *> uses;                ///< Variables (possibly) used by this instruction (direct or indirect by function)

        public:
        LineColumn position;                         ///< Location in the source file this instruction is relevant to

        /// Basic block to execute upon exception
        BasicBlock *on_exception;

        // Constructor
        ILInstruction(LineColumn const &_position, const std::set<AssignSSAVariable *> &_defs, const std::set<SSAVariable *> &_uses);

        // Virtual destructor to keep compilers from complaining
        virtual ~ILInstruction() {}

        /// Adds a variable to the list of used variables
        void AddUse(SSAVariable *var) { usedefs.AddUse(var); }

        /// Adds a variable to the list of defined variables
        void AddDef(AssignSSAVariable *var) { usedefs.AddDef(var); }

        /** Returns whether this instruction modifies a global variable */
        bool DefinesGlobals() const { return usedefs.DefinesGlobals(); }

        /** Returns whether this instruction uses a global variable */
        bool UsesGlobals() const { return usedefs.UsesGlobals(); }

        /** Insert all defined variables into a set
            @param varlist Pointer to variable list in which to insert */
        void InsertDefined(std::set<SSAVariable*> *varlist) const { usedefs.InsertDefined(varlist); }
        void AppendDefined(std::vector<SSAVariable*> *varlist) const { usedefs.AppendDefined(varlist); }

        /** Insert all used variables into a set
            @param varlist Pointer to variable list in which to insert */
        void InsertUsed(std::set<SSAVariable*> *varlist) const { usedefs.InsertUsed(varlist); }
        void AppendUsed(std::vector<SSAVariable*> *varlist) const { usedefs.AppendUsed(varlist); }

        void DumpObject(CCostream &out) const;

        DEFINE_NODE_FUNCTIONS1(ILInstruction, IL)

        protected:
        /** ADDME: Comments said 'needed by macros' but I'd think it would
            be for functions?
            Add the target ?? variable to the definition list */
        void AddTarget(AssignSSAVariable *_target);

        friend class Compiler::ILGenerator; //Compiler:: is necessarywith gcc4
        friend class Compiler::SSAFixupper;
};

// Type 1: var <- constant
struct ILConstant: public ILInstruction
{
        SSAVariable *target;
        Constant constant;

        ILConstant(LineColumn _position, AssignSSAVariable *_target, VariableTypes::Type _type, VarId _constant)
        : ILInstruction(_position, Utilities::make_set(_target), std::set<SSAVariable *>())
        , target(_target)
        , constant(_type, _constant)
        {
        }

        ILConstant(LineColumn _position, AssignSSAVariable *_target, Constant const &_constant)
        : ILInstruction(_position, Utilities::make_set(_target), std::set<SSAVariable *>())
        , target(_target)
        , constant(_constant)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILConstant, IL)
};

// Type 2: var <- var
struct ILAssignment: public ILInstruction
{
        AssignSSAVariable *target;
        SSAVariable* rhs;

        ILAssignment(LineColumn _position, AssignSSAVariable *_target, SSAVariable *_rhs)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_rhs))
        , target(_target)
        , rhs(_rhs)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILAssignment, IL)
};

// Type 3: var <- var CASTED TO type
struct ILCast: public ILInstruction
{
        AssignSSAVariable *target;
        SSAVariable* rhs;
        VariableTypes::Type to_type;
        Symbol *function; // If casting a parameter: this function.
        bool is_explicit;

        ILCast(LineColumn _position, AssignSSAVariable *_target, SSAVariable *_rhs, VariableTypes::Type _to_type, Symbol *_function, bool _is_explicit)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_rhs))
        , target(_target)
        , rhs(_rhs)
        , to_type(_to_type)
        , function(_function)
        , is_explicit(_is_explicit)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILCast, IL)
};

// Type 4: var <- var op var
struct ILBinaryOperator: public ILInstruction
{
        SSAVariable *target;
        BinaryOperatorType::Types operation;
        SSAVariable *lhs;
        SSAVariable *rhs;

        ILBinaryOperator(LineColumn _position, AssignSSAVariable *_target, BinaryOperatorType::Types _operation,
                SSAVariable *_lhs, SSAVariable *_rhs)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_lhs, _rhs))
        , target(_target)
        , operation(_operation)
        , lhs(_lhs)
        , rhs(_rhs)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILBinaryOperator, IL)
};

// Type 5: var <- op var
struct ILUnaryOperator: public ILInstruction
{
        UnaryOperatorType::Types operation;
        SSAVariable *target;
        SSAVariable *rhs;

        ILUnaryOperator(LineColumn _position, AssignSSAVariable *_target, UnaryOperatorType::Types _operation, SSAVariable *_rhs)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_rhs))
        , operation(_operation)
        , target(_target)
        , rhs(_rhs)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILUnaryOperator, IL)
};

// Type 6: var <- var .columnname
struct ILColumnOperator: public ILInstruction
{
        SSAVariable *target;
        SSAVariable *rhs;
        std::string columnname;

        ILColumnOperator(LineColumn _position, AssignSSAVariable *_target, SSAVariable *_rhs, std::string const &_name)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_rhs))
        , target(_target)
        , rhs(_rhs)
        , columnname(_name)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILColumnOperator, IL)
};

// Type 7: var <- functioncall ( var* )
struct ILFunctionCall: public ILInstruction
{
        AssignSSAVariable *target;
        IL::Function *function;
        std::vector<SSAVariable *> values;

        // Do NOT directly call this! Function calls need postprocessing to set dependencies ok.
        ILFunctionCall(LineColumn const &_position, AssignSSAVariable *_target, Function *_function, std::vector<SSAVariable *> const &_values);

        DEFINE_NODE_FUNCTIONS1(ILFunctionCall, IL)
};

// Type 8: conditional jump( var )
struct ILConditionalJump: public ILInstruction
{
        SSAVariable *rhs;
        ILConditionalJump(LineColumn _position, SSAVariable *_rhs)
        : ILInstruction(_position, std::set<AssignSSAVariable *>(), Utilities::make_set(_rhs))
        , rhs(_rhs)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILConditionalJump, IL)
};

// Type 9: return var*
struct ILReturn: public ILInstruction
{
        SSAVariable * returnvalue;
        explicit ILReturn(LineColumn _position)
        : ILInstruction(_position, std::set<AssignSSAVariable *>(), std::set<SSAVariable *>())
        , returnvalue(NULL)
        {
        }
        ILReturn(LineColumn _position, SSAVariable &returnvalue)
        : ILInstruction(_position, std::set<AssignSSAVariable *>(), Utilities::make_set(&returnvalue))
        , returnvalue(&returnvalue)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILReturn, IL)
};

// Type 10: var <- obj->member( var* )
struct ILMethodCall: public ILInstruction
{
        AssignSSAVariable *target;
        SSAVariable *object;
        std::string membername;
        bool via_this;
        std::vector<SSAVariable *> values;
        bool allow_macro;

        // Do NOT directly call this! Function calls need postprocessing to set dependencies ok.
        ILMethodCall(LineColumn const &_position, AssignSSAVariable *_target, SSAVariable *_object, std::string _membername, bool _via_this, std::vector<SSAVariable *> const &_values, bool allow_macro);

        DEFINE_NODE_FUNCTIONS1(ILMethodCall, IL)
};

// Type 11: var <- obj->member( var* )
struct ILFunctionPtrCall: public ILInstruction
{
        AssignSSAVariable *target;
        SSAVariable *functionptr;
        std::vector<SSAVariable *> values;
        bool allow_macro;

        // Do NOT directly call this! Function calls need postprocessing to set dependencies ok.
        ILFunctionPtrCall(LineColumn const &_position, AssignSSAVariable *_target, SSAVariable *_functiontr, std::vector<SSAVariable *> const &_values, bool allow_macro);

        DEFINE_NODE_FUNCTIONS1(ILFunctionPtrCall, IL)
};

// Type 12: var <- rhs with rhs.columnname := value
struct ILRecordCellSet: public ILInstruction
{
        AssignSSAVariable *target;
        SSAVariable *rhs;
        std::string const &columnname;
        SSAVariable *value;
        bool allow_create;
        bool check_type;

        ILRecordCellSet(LineColumn const &_position, AssignSSAVariable *_target, SSAVariable *_rhs, std::string const &_columnname, SSAVariable *_value, bool _allow_create, bool _check_type)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_rhs, _value))
        , target(_target)
        , rhs(_rhs)
        , columnname(_columnname)
        , value(_value)
        , allow_create(_allow_create)
        , check_type(_check_type)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILRecordCellSet, IL)
};

// Type 13: var <- rhs with rhs.columnname deleted
struct ILRecordCellDelete: public ILInstruction
{
        AssignSSAVariable *target;
        SSAVariable *rhs;
        std::string const &columnname;

        ILRecordCellDelete(LineColumn const &_position, AssignSSAVariable *_target, SSAVariable *_rhs, std::string const &_columnname)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_rhs))
        , target(_target)
        , rhs(_rhs)
        , columnname(_columnname)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILRecordCellDelete, IL)
};

// Type 14: var <- var->columnname
struct ILObjectMemberGet: public ILInstruction
{
        SSAVariable *target;
        SSAVariable *object;
        std::string membername;
        bool via_this;

        ILObjectMemberGet(LineColumn _position, AssignSSAVariable *_target, SSAVariable *_object, std::string const &_name, bool _via_this)
        : ILInstruction(_position, Utilities::make_set(_target), Utilities::make_set(_object))
        , target(_target)
        , object(_object)
        , membername(_name)
        , via_this(_via_this)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILObjectMemberGet, IL)
};

// Type 15: var->columnname := var
struct ILObjectMemberSet: public ILInstruction
{
        SSAVariable *object;
        std::string membername;
        bool via_this;
        SSAVariable *value;

        ILObjectMemberSet(LineColumn _position, SSAVariable *_object, SSAVariable *_value, std::string const &_name, bool _via_this)
        : ILInstruction(_position, std::set<AssignSSAVariable *>(), Utilities::make_set(_object, _value))
        , object(_object)
        , membername(_name)
        , via_this(_via_this)
        , value(_value)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILObjectMemberSet, IL)
};

// Type 17: DELETE MEMBER columnname FROM var
struct ILObjectMemberDelete: public ILInstruction
{
        SSAVariable *object;
        std::string membername;
        bool via_this;

        ILObjectMemberDelete(LineColumn _position, SSAVariable *_object, std::string const &_name, bool _via_this)
        : ILInstruction(_position, std::set<AssignSSAVariable *>(), Utilities::make_set(_object))
        , object(_object)
        , membername(_name)
        , via_this(_via_this)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILObjectMemberDelete, IL)
};

// Type 18: INSERT public/private MEMBER columnname := var INTO var
struct ILObjectMemberInsert: public ILInstruction
{
        SSAVariable *object;
        std::string membername;
        bool is_private;
        bool via_this;
        SSAVariable *value;

        ILObjectMemberInsert(LineColumn _position, SSAVariable *_object, SSAVariable *_value, std::string const &_name, bool _is_private, bool _via_this)
        : ILInstruction(_position, std::set<AssignSSAVariable *>(), Utilities::make_set(_object, _value))
        , object(_object)
        , membername(_name)
        , is_private(_is_private)
        , via_this(_via_this)
        , value(_value)
        {
        }

        DEFINE_NODE_FUNCTIONS1(ILObjectMemberInsert, IL)
};


struct BasicBlock
{
        static const int start_frequency = 256;
        unsigned frequency;                             ///< Frequency of entrancy. 50% for ifs, x10 in loops. Starts at start_frequency, 0 is just a low frequency, not a 'will never be called'!

        LineColumn position;                            ///< Position in source file where this block starts

        std::vector<PhiFunction *> phifunctions;        ///< Phi functions (defined during IL generation)
        std::vector<ILInstruction *> instructions;      ///< ordered list of instructions (defined during IL generation)
        std::vector<BasicBlock *> successors;           ///< successors of this node (defined during IL generation)
        std::vector<BasicBlock *> throwcatchers;        ///< throw-successors of this node (defined during IL generation)
        std::vector<BasicBlock *> predecessors;         ///< successors of this node (defined during IL generation)

        BasicBlock *dominator;                          ///< Strict dominator, or 0 if none (defined during IL generation)
        std::vector<BasicBlock *> dominees;             ///< inverse relation of dominator (defined during IL generation)

        std::vector<SSAVariable *> locals;              ///< Variables local to this block (defined during register allocation)
        bool is_exception_target;                       ///< Whether this is a exception target (referenced in an on_exception)

        BasicBlock(LineColumn _position) : frequency(start_frequency), position(_position), dominator(0), is_exception_target(false) { }
};

struct CodedFunction
{
        std::vector<AssignSSAVariable *> parameters;    ///< Assigned SSAVariables representing the parameters of this function (defined during IL generation)
        std::vector<AssignSSAVariable *> globalvars;    ///< Assigned SSAVariables representing the Global variables on entry (defined during IL generation)
        bool uses_globals;                              ///< True if this function uses globals (local or imported)
        bool defs_globals;                              ///< True if this function defines globals (local or imported)

        Symbol *symbol;
        BasicBlock *block;

        inline CodedFunction() : uses_globals(false), defs_globals(false), symbol(0), block(0) {}
};

struct Function
{
        /** Temporary members, later to build a better one when needed */
        std::string name;

        /// Symbol of this function (0 for builtins)
        Symbol *symbol;

        /// Whether this function modifies outsidestate (only for builtinds)
        bool modifies_outsidestate;

        inline Function() : symbol(0), modifies_outsidestate(false) {}
};

struct Module
{
        std::string orgsrcname;                         ///< Name of original source file
        Variable *outsidestate;                         ///< Variable representing the world outside the language. Used to model const functions.
        int32_t scriptproperty_fileid;
        Blex::DateTime scriptproperty_filecreationdate;
        bool scriptproperty_systemredirect;
        Symbol *deinitmacro;
        std::set<Variable *> globalvars;                ///< Global variables
        std::vector<CodedFunction *> functions;
        std::vector<Symbol *> exportedvars;
        std::vector<SymbolDefs::Library *> loadlibs;

        inline Module()
        : outsidestate(0)
        , scriptproperty_fileid(0)
        , scriptproperty_filecreationdate(0,0)
        , scriptproperty_systemredirect(false)
        , deinitmacro(0)
        {
        }
};

#undef ACTION
#define ACTION(name) VISITOR_PERCLASSDEFS(VisitorType, name)
template <class ReturnType, class ParameterType>
 struct ILVisitor : public BaseILVisitor
{
        typedef ILVisitor<ReturnType, ParameterType> VisitorType;
        VISITOR_VISITORFUNC(ILInstruction, ILVisitor, VisitorType)

        ACTION(ILInstruction)
        ACTION(ILConstant)
        ACTION(ILAssignment)
        ACTION(ILBinaryOperator)
        ACTION(ILCast)
        ACTION(ILUnaryOperator)
        ACTION(ILFunctionCall)
        ACTION(ILColumnOperator)
        ACTION(ILConditionalJump)
        ACTION(ILReturn)
        ACTION(ILMethodCall)
        ACTION(ILFunctionPtrCall)
        ACTION(ILRecordCellSet)
        ACTION(ILRecordCellDelete)
        ACTION(ILObjectMemberGet)
        ACTION(ILObjectMemberSet)
        ACTION(ILObjectMemberDelete)
        ACTION(ILObjectMemberInsert)
};

std::ostream & operator <<(std::ostream &out, Variable const &rhs);
std::ostream & operator <<(std::ostream &out, Variable * const rhs);
std::ostream & operator <<(std::ostream &out, SSAVariable const &rhs);
std::ostream & operator <<(std::ostream &out, SSAVariable * const rhs);
std::ostream & operator <<(std::ostream &out, AssignSSAVariable const &rhs);
std::ostream & operator <<(std::ostream &out, AssignSSAVariable * const rhs);
//std::ostream & operator <<(std::ostream &out, Constant const &rhs);
CCostream & operator <<(CCostream &out, ILInstruction const &rhs);
CCostream & operator <<(CCostream &out, BasicBlock const &rhs);
std::ostream & operator <<(std::ostream &out, PhiFunction const &rhs);
std::ostream & operator <<(std::ostream &out, FlowState const &state);

} // end of namespace IL
} // end of namespace Compiler
} // end of namespace HareScript

#endif
