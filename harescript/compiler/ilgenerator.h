#ifndef blex_webhare_compiler_ilgenerator
#define blex_webhare_compiler_ilgenerator
//---------------------------------------------------------------------------

#include "ast.h"
#include "astvisitors.h"
#include "astvariableuseanalyzer.h"
#include "symboltable.h"
#include "semanticcheck.h"

#include "il.h"

/*  The IL generator builds the intermediate language from the AST.
    Due to the special form of the AST (no goto's) we can immediately
    build the IL in SSA form. This structuredness also helps us in
    building the dominator tree very cheaply.

    Because HareScript is a typed language, a variable must be declared
    before use. Every declaration must be an assignment to that variable
    (with a default value or so). Therefore, the resulting IL is strict;
    every use of a variable is dominated by an assignment to that variable.
    This MUST be preserved this way during optimization; the storage allocation
    step depends on it. */

/* define this if you want the numbering of ssavariables to be unique per
   variable, instead of global. Useful for visualisation, but more expensive
   in computation. */
//#define DEBUG_SSA_ID_NUMBERING

namespace HareScript
{
namespace Compiler
{

/** The ILGenerator is the base class for IL code generation. It accepts an
    AST Module; and generates IL code in SSA form.
    It also builds the dominator tree. */
class ILGenerator: public AST::NodeVisitor<IL::SSAVariable *, Empty>
{
    private:
        CompilerContext &context;
        ASTVariabeleUseAnalyzer *vuanalyzer;
        TypeStorage &typestorage;

        /// List of exception catchers
        struct CatchBlock
        {
                IL::BasicBlock *block;
                IL::FlowState flowstate;
        };

        /** The loopstack keeps administration for loops (where breakpoints and
            continuepoints are; and which flowstates flow to them. Also the source is administered */
        struct LoopStackElement
        {
                IL::BasicBlock *breakpoint;
                IL::BasicBlock *continuepoint;
                std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> > breaks;
                std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> > continues;
                std::vector< CatchBlock > *finally_catchers;
        };

        /// current Loopstack
        std::stack<LoopStackElement> loopstack;

        /// Current flowstate
        IL::FlowState flowstate;

        /// Current basic block (can be NULL after Visit(), usually result of break/return statements)
        IL::BasicBlock *current;

        /// Current function that is translated
        IL::CodedFunction *currentfunc;

        /// Current observability variable (analog to outsidestate, but deps on state X may be placed after def of state X + 1)
        IL::AssignSSAVariable *extstate;

        /// True if current function is initfunction
        bool is_initfunction;

        /// Positions to use for ret instructions
        LineColumn retpos;

        /// List of blocks that have been built during IL generation
        std::vector<IL::BasicBlock *> builtblocks;

        /// Current module
        IL::Module *mdl;

        /// Current mapping from symbol to a anonymous SSAVariable
        std::map<Symbol *, IL::SSAVariable *> variablemappings;

        std::vector< CatchBlock > *exception_catchers;

        AST::TryFinallyStatement *finally_statement;
        std::vector< CatchBlock > *finally_catchers;

//        IL::BasicBlock *current_catch;

        /// Counter to name temporary variables and SSAVariable id's
        unsigned tempcounter;
#ifdef DEBUG_SSA_ID_NUMBERING
        /// Counter to name SSAVariable id's
        std::map<IL::Variable *, unsigned> ssacounter;
#endif

        /** Returns a new assign id. Per variable, every id is only returned once.
            @return A unique (per variable) id. */
        unsigned GetAssignId(IL::Variable *var);

        /** Returns the corresponding ssavariable for this symbol (initialized to an anonymous SSAVariable, with id 0)
            All calls with the same symbol will return the same SSAVariable object
            @param symbol Symbol to look up
            @return Corresponding SSAVariable */
        IL::SSAVariable * GetVariable(Symbol *symbol);

        /** Returns an temporarary, assigned ssavariable.
            @return SSAVariable */
        IL::AssignSSAVariable * GetAssignedTemporary(VariableTypes::Type type);

        /** Returns a copy of a SSAVariable object. This one has it's id set to an unique one.
            @param var Variable to get an assignable SSAVariable from
            @return SSAVariable */
        IL::AssignSSAVariable * GetAssignCopy(IL::SSAVariable *var);

        /** Adds an instruction. If the defined variables are anonymous SSAVariables, they are replaced by an
            assigned one.
            @param ili Instruction
            @param can_cause_undef Whether this instruction can cause undefined behaviour (eg aborts due to access to missing cell)
            @param is_observable Whether this instruction causes observable behaviour
        */
        void AddInstruction(IL::ILInstruction *ili, bool can_cause_undef, bool is_observable);

        void AddThrowingInstruction(IL::ILInstruction *ili);

        /** Merges the flowstates of tho control flows flowing to the same block
            @param block Block where the flows converge (the necessary phi-functions are added in that block)
            @param state The merged flowstates are written to this state
            @param mergeparams The different flowstates, with the blocks they are coming from */
        void MergeFlowStates(IL::BasicBlock *block, IL::FlowState &state, std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> > const &mergeparams);

        /** Builds a functioncall, using current flowstate */
        IL::ILFunctionCall * CreateFunctionCall(LineColumn _position, IL::AssignSSAVariable *_target, IL::Function *_function, std::vector<IL::SSAVariable *> const &_values);

        /** Builds a return, using current flowstate */
        IL::ILReturn * CreateReturn(LineColumn _position, IL::SSAVariable *_returnvalue);

        /** Get a target SSA variable for an lvalue */
        IL::AssignSSAVariable * GetLValueTarget(AST::Lvalue *lvalue);

        // Object owner function
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

        AST::Variable* GetLvalueVar(AST::Lvalue* val);

        /** Encodes a deep operation
            @param obj Deep operation object
            @param params Additional parameters
            @param funcname Deep operation type to call
            @param funcnamethis Deep operation type to call when basevar is :THIS variable.
            @return Result variable (only if the operation wasn't done on an object)
        */
        IL::AssignSSAVariable * EncodeDeepOperation(AST::DeepOperation *obj, std::vector< IL::SSAVariable * > const &params, std::string const &funcname, std::string const &funcnamethis);

    public:
        inline ILGenerator(CompilerContext &context, TypeStorage &_typestorage) : context(context), typestorage(_typestorage), tempcounter(0) {}
        inline ~ILGenerator() {}

        /// Translated AST module to an IL module
        IL::Module * Execute(IL::Module *&ilmodule, AST::Module* node, ASTVariabeleUseAnalyzer *_vuanalyzer);

    private:
        /** Links two blocks together. Takes care of restructuring of dominator relations. Links are stored in the order
            in which they are built (so for a conditional jump, FIRST build the link to the true-block, THEN to the
            false-block
            @param from Block where link originates
            @param to Block where link points to */
        void LinkBlocks(IL::BasicBlock *from, IL::BasicBlock *to, bool is_throw);

        /** Individual translation functions.

            FIXME: Methodology description */
        virtual IL::SSAVariable * V_ArrayDelete (AST::ArrayDelete *obj, Empty);
        virtual IL::SSAVariable * V_ArrayElementConst (AST::ArrayElementConst *obj, Empty);
        virtual IL::SSAVariable * V_ArrayElementModify (AST::ArrayElementModify *obj, Empty);
        virtual IL::SSAVariable * V_ArrayInsert (AST::ArrayInsert *obj, Empty);
        virtual IL::SSAVariable * V_Assignment (AST::Assignment *obj, Empty);
        virtual IL::SSAVariable * V_BinaryOperator (AST::BinaryOperator *obj, Empty);
        virtual IL::SSAVariable * V_Block (AST::Block *obj, Empty);
        virtual IL::SSAVariable * V_BreakStatement (AST::BreakStatement *obj, Empty);
        virtual IL::SSAVariable * V_BuiltinInstruction (AST::BuiltinInstruction *obj, Empty);
        virtual IL::SSAVariable * V_Cast(AST::Cast *obj, Empty);
        virtual IL::SSAVariable * V_ConditionalOperator (AST::ConditionalOperator *obj, Empty);
        virtual IL::SSAVariable * V_ConditionalStatement (AST::ConditionalStatement *obj, Empty);
        virtual IL::SSAVariable * V_Constant (AST::Constant *obj, Empty);
        virtual IL::SSAVariable * V_ConstantRecord (AST::ConstantRecord *obj, Empty);
        virtual IL::SSAVariable * V_ConstantArray (AST::ConstantArray *obj, Empty);
        virtual IL::SSAVariable * V_ContinueStatement (AST::ContinueStatement *obj, Empty);
        virtual IL::SSAVariable * V_DeepOperation (AST::DeepOperation *obj, Empty);
        virtual IL::SSAVariable * V_DeepArrayDelete (AST::DeepArrayDelete *obj, Empty);
        virtual IL::SSAVariable * V_DeepArrayInsert (AST::DeepArrayInsert *obj, Empty);
        virtual IL::SSAVariable * V_End(AST::End*obj, Empty);
        virtual IL::SSAVariable * V_ExpressionBlock (AST::ExpressionBlock *obj, Empty);
        virtual IL::SSAVariable * V_ForEveryStatement(AST::ForEveryStatement *obj, Empty);
        virtual IL::SSAVariable * V_Function (AST::Function *obj, Empty);
        virtual IL::SSAVariable * V_FunctionCall (AST::FunctionCall *obj, Empty);
        virtual IL::SSAVariable * V_FunctionPtr (AST::FunctionPtr *obj, Empty);
        virtual IL::SSAVariable * V_FunctionPtrCall (AST::FunctionPtrCall *obj, Empty);
        virtual IL::SSAVariable * V_FunctionPtrRebind (AST::FunctionPtrRebind *obj, Empty);
        virtual IL::SSAVariable * V_InitializeStatement (AST::InitializeStatement *obj, Empty);
        virtual IL::SSAVariable * V_LoopStatement (AST::LoopStatement *obj, Empty);
        virtual IL::SSAVariable * V_Lvalue (AST::Lvalue *obj, Empty);
        virtual IL::SSAVariable * V_LvalueSet (AST::LvalueSet *obj, Empty);
        virtual IL::SSAVariable * V_Module (AST::Module *obj, Empty);
        virtual IL::SSAVariable * V_Node (AST::Node *obj, Empty);
        virtual IL::SSAVariable * V_ObjectExtend(AST::ObjectExtend *obj, Empty);
        virtual IL::SSAVariable * V_ObjectMemberConst (AST::ObjectMemberConst *obj, Empty);
        virtual IL::SSAVariable * V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty);
        virtual IL::SSAVariable * V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty);
        virtual IL::SSAVariable * V_ObjectMemberSet (AST::ObjectMemberSet *obj, Empty);
        virtual IL::SSAVariable * V_ObjectMethodCall (AST::ObjectMethodCall *obj, Empty);
        virtual IL::SSAVariable * V_ObjectTypeUID (AST::ObjectTypeUID *obj, Empty);
        virtual IL::SSAVariable * V_RecordCellSet (AST::RecordCellSet *obj, Empty);
        virtual IL::SSAVariable * V_RecordCellDelete (AST::RecordCellDelete *obj, Empty);
        virtual IL::SSAVariable * V_RecordColumnConst (AST::RecordColumnConst *obj, Empty);
        virtual IL::SSAVariable * V_ReturnStatement (AST::ReturnStatement *obj, Empty);
        virtual IL::SSAVariable * V_Rvalue (AST::Rvalue *obj, Empty);
        virtual IL::SSAVariable * V_SchemaTable(AST::SchemaTable *obj, Empty);
        virtual IL::SSAVariable * V_SingleExpression (AST::SingleExpression *obj, Empty);
        virtual IL::SSAVariable * V_Statement (AST::Statement *obj, Empty);
        virtual IL::SSAVariable * V_SwitchStatement (AST::SwitchStatement *obj, Empty);
        virtual IL::SSAVariable * V_TryCatchStatement(AST::TryCatchStatement *obj, Empty);
        virtual IL::SSAVariable * V_TryFinallyStatement(AST::TryFinallyStatement *obj, Empty);
        virtual IL::SSAVariable * V_TypeInfo (AST::TypeInfo *obj, Empty);
        virtual IL::SSAVariable * V_UnaryOperator (AST::UnaryOperator *obj, Empty);
        virtual IL::SSAVariable * V_Variable (AST::Variable *obj, Empty);
        virtual IL::SSAVariable * V_Yield (AST::Yield *obj, Empty);

        virtual IL::SSAVariable * V_SQL (AST::SQL *obj, Empty);
        virtual IL::SSAVariable * V_SQLDataModifier (AST::SQLDataModifier *obj, Empty);
        virtual IL::SSAVariable * V_SQLDelete (AST::SQLDelete *obj, Empty);
        virtual IL::SSAVariable * V_SQLInsert (AST::SQLInsert *obj, Empty);
        virtual IL::SSAVariable * V_SQLSource (AST::SQLSource *obj, Empty);
        virtual IL::SSAVariable * V_SQLSources (AST::SQLSources *obj, Empty);
        virtual IL::SSAVariable * V_SQLSelect (AST::SQLSelect *obj, Empty);
        virtual IL::SSAVariable * V_SQLUpdate (AST::SQLUpdate *obj, Empty);

        // Friend declarations; to be able to print flowstates and loopstackelements
        friend CCostream & operator <<(CCostream &out, ILGenerator::LoopStackElement const &lse);

        friend class SSAFixupper;
        friend class VariableReplacer;
};

CCostream & operator <<(CCostream &out, ILGenerator::LoopStackElement const &lse);

/** The variable replaces replaces a SSAVariable that has possibly not been renamed to a SSA version to
    the variable version currently visible in a flowstate */
class VariableReplacer
{
    protected:
        SSAFixupper &fixupper;
    public:
        explicit VariableReplacer(SSAFixupper &fixupper) : fixupper(fixupper){}

        /** Renames a variable to the current visible version
            @param state Flowstate (mapping from variables to the current visible SSA version
            @param ssavar Variable to rename */
        void operator()(IL::FlowState *state, IL::SSAVariable *&ssavar);
};

/** The SSAFixupper replaces every anonymous SSA variable with it's
    current definition. It may not be used outside il code generation; it operates
    with FlowState's and uses it's assumptions.
    (btw, all ILGenerator:: prefixes are unnecessary in gcc 3, but borland just wants them...)
     */
class SSAFixupper: public IL::ILVisitor<void, IL::FlowState *>
{
        public:
        CompilerContext &context;
        VariableReplacer replacer;
        IL::Module *module;

        typedef AttributeStorage<IL::BasicBlock, IL::FlowState > ReachData;
        ReachData afterphi;
        ReachData afterblock;
        std::map< IL::BasicBlock *, bool > visited;

        void CalculateReachesIterate(IL::BasicBlock *block, IL::FlowState const &in_state);
        void ReplaceIterate(IL::BasicBlock *block);

        SSAFixupper(CompilerContext &_context, IL::Module *module) : context(_context), replacer(*this), module(module) {}

        void Execute(IL::CodedFunction *func, IL::FlowState const &state);

        virtual void V_ILInstruction(IL::ILInstruction *, IL::FlowState *);
        virtual void V_ILConstant(IL::ILConstant *, IL::FlowState *);
        virtual void V_ILAssignment(IL::ILAssignment *, IL::FlowState *);
        virtual void V_ILBinaryOperator(IL::ILBinaryOperator *, IL::FlowState *);
        virtual void V_ILCast(IL::ILCast *, IL::FlowState *);
        virtual void V_ILUnaryOperator(IL::ILUnaryOperator *, IL::FlowState *);
        virtual void V_ILFunctionCall(IL::ILFunctionCall *, IL::FlowState *);
        virtual void V_ILColumnOperator(IL::ILColumnOperator *, IL::FlowState *);
        virtual void V_ILConditionalJump(IL::ILConditionalJump *, IL::FlowState *);
        virtual void V_ILReturn(IL::ILReturn *, IL::FlowState *);
        virtual void V_ILMethodCall(IL::ILMethodCall *, IL::FlowState *);
        virtual void V_ILFunctionPtrCall(IL::ILFunctionPtrCall *, IL::FlowState *);
        virtual void V_ILRecordCellSet(IL::ILRecordCellSet *, IL::FlowState *block);
        virtual void V_ILRecordCellDelete(IL::ILRecordCellDelete *, IL::FlowState *block);
        virtual void V_ILObjectMemberGet(IL::ILObjectMemberGet *, IL::FlowState *block);
        virtual void V_ILObjectMemberSet(IL::ILObjectMemberSet *, IL::FlowState *block);
        virtual void V_ILObjectMemberDelete(IL::ILObjectMemberDelete *, IL::FlowState *block);
        virtual void V_ILObjectMemberInsert(IL::ILObjectMemberInsert *, IL::FlowState *block);
};

} // end of namespace HareScript
} // end of namespace Compiler

//---------------------------------------------------------------------------
#endif
