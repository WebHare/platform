//---------------------------------------------------------------------------
#ifndef blex_webhare_compiler_opt_constantsarithmatic
#define blex_webhare_compiler_opt_constantsarithmatic
//---------------------------------------------------------------------------

#include "ast.h"
#include "astvisitors.h"
#include "astcoder.h"
//#include "hs_lexer.h"
#include "semanticcheck.h"

namespace HareScript
{
namespace Compiler
{
namespace Opt_ConstantsArithmatic
{

enum Optimizable
{
        Single,         // One object with constant outcome in visited tree; do not replace with another constant
        Multiple,       // Multiple objects with total constant outcome in visited tree; replace with constant
        None            // No constant value
};

/** Optimizer for constant arithmatic

    Uses the varmemory for computations. Visit functions for expressions can return
    None, Single, Multiple, meaning:
    None     : this expression or statement is not optimizable. The visit function has not changed the stack
    Single   : this is a constant, the constant has been pushed onto the stack.
    Multiple : this is a constant expression, the result has been pushed onto the stack
    Visitor functions do NOT change the object pointer they are called on. Use
    Optimize instead to optimize an expression, and replace it with a optimized
    version. */
class Opt_ConstantsArithmatic: public AST::NodeVisitor<Optimizable, Empty>
{
        ErrorHandler &errorhandler;
        AstCoder *coder;
        TypeStorage &typestorage;
        CompilerContext &context;
        StackMachine &stackm;
        bool forceconstexpr;

    public:
        Opt_ConstantsArithmatic(AstCoder *coder, TypeStorage &typestorage, CompilerContext &context);
        ~Opt_ConstantsArithmatic();

        void Execute(AST::Node* node) { Visit(node, Empty()); }

        /** Optimizes the Rvalue in obj; replaces it with a constant if possible
            @param obj Rvalue to optimize
            @return Returns the constant if obj is a constant after calling this function. */
        AST::Constant * Optimize(AST::Rvalue* & obj);

        /** Forced optimization, issue an error when an non-constant expression is encountered
            @param obj Rvalue to optimize
            @return Returns the constant if obj is a constant after calling this function. */
        AST::Constant * ForceOptimize(AST::Rvalue* & obj);

    private:
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

        AST::Constant *last_single;

        void Execute(AST::Module module);

        /** Replaces the Rvalue ptr with value on the top of the stack (which is then popped)
            @param obj Rvalue to replace */
        AST::Constant * Replace(AST::Rvalue* & obj);

        /** Pops the value on top of the evaluation stack */
        void Pop();

        /** Returns the idx'th value from the top if the stack */
        VarId Argument(unsigned idx);

        /** Creates a new variable on top of the stack */
        VarId Push();

        /** Swaps the values on the evaluation stack */
        void Swap();

        bool BinaryOp(LineColumn pos, void (StackMachine::* stack_op)());
        bool UnaryOp(LineColumn pos, void (StackMachine::* stack_op)());
        int32_t Compare(LineColumn pos);
        bool CastOp(LineColumn pos, VariableTypes::Type totype, bool is_explicit);

        AST::ExpressionBlock * MergeSimpleCells(LineColumn position, VarId var, std::vector< std::pair< std::string, AST::Rvalue * > > const &unopt);

        virtual Optimizable V_ArrayDelete (AST::ArrayDelete *obj, Empty);
        virtual Optimizable V_ArrayElementConst (AST::ArrayElementConst *obj, Empty);
        virtual Optimizable V_ArrayElementModify (AST::ArrayElementModify *obj, Empty);
        virtual Optimizable V_ArrayInsert (AST::ArrayInsert *obj, Empty);
        virtual Optimizable V_Assignment (AST::Assignment *obj, Empty);
        virtual Optimizable V_BinaryOperator (AST::BinaryOperator *obj, Empty);
        virtual Optimizable V_Block (AST::Block *obj, Empty);
        virtual Optimizable V_BreakStatement (AST::BreakStatement *obj, Empty);
        virtual Optimizable V_BuiltinInstruction (AST::BuiltinInstruction *obj, Empty);
        virtual Optimizable V_Cast (AST::Cast *obj, Empty);
        virtual Optimizable V_ConditionalOperator (AST::ConditionalOperator *obj, Empty);
        virtual Optimizable V_ConditionalStatement (AST::ConditionalStatement *obj, Empty);
        virtual Optimizable V_Constant (AST::Constant *obj, Empty);
        virtual Optimizable V_ConstantRecord (AST::ConstantRecord *obj, Empty);
        virtual Optimizable V_ConstantArray (AST::ConstantArray *obj, Empty);
        virtual Optimizable V_ContinueStatement (AST::ContinueStatement *obj, Empty);
        virtual Optimizable V_DeepOperation (AST::DeepOperation *obj, Empty);
        virtual Optimizable V_DeepArrayDelete (AST::DeepArrayDelete *obj, Empty);
        virtual Optimizable V_DeepArrayInsert (AST::DeepArrayInsert *obj, Empty);
        virtual Optimizable V_End (AST::End*obj, Empty);
        virtual Optimizable V_ExpressionBlock (AST::ExpressionBlock *obj, Empty);
        virtual Optimizable V_ForEveryStatement(AST::ForEveryStatement *obj, Empty);
        virtual Optimizable V_Function (AST::Function *obj, Empty);
        virtual Optimizable V_FunctionCall (AST::FunctionCall *obj, Empty);
        virtual Optimizable V_FunctionPtr (AST::FunctionPtr *obj, Empty);
        virtual Optimizable V_FunctionPtrCall (AST::FunctionPtrCall *obj, Empty);
        virtual Optimizable V_FunctionPtrRebind (AST::FunctionPtrRebind *obj, Empty);
        virtual Optimizable V_InitializeStatement (AST::InitializeStatement *obj, Empty);
        virtual Optimizable V_LoopStatement (AST::LoopStatement *obj, Empty);
        virtual Optimizable V_Lvalue (AST::Lvalue *obj, Empty);
        virtual Optimizable V_LvalueSet (AST::LvalueSet *obj, Empty);
        virtual Optimizable V_Module (AST::Module *obj, Empty);
        virtual Optimizable V_Node (AST::Node *obj, Empty);
        virtual Optimizable V_RecordCellSet (AST::RecordCellSet *obj, Empty);
        virtual Optimizable V_RecordCellDelete (AST::RecordCellDelete *obj, Empty);
        virtual Optimizable V_RecordColumnConst (AST::RecordColumnConst *obj, Empty);
        virtual Optimizable V_ObjectExtend(AST::ObjectExtend *obj, Empty);
        virtual Optimizable V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty);
        virtual Optimizable V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty);
        virtual Optimizable V_ObjectMemberSet (AST::ObjectMemberSet *obj, Empty);
        virtual Optimizable V_ObjectMemberConst (AST::ObjectMemberConst*obj, Empty);
        virtual Optimizable V_ObjectMethodCall (AST::ObjectMethodCall*obj, Empty);
        virtual Optimizable V_ObjectTypeUID (AST::ObjectTypeUID*obj, Empty);
        virtual Optimizable V_ReturnStatement (AST::ReturnStatement *obj, Empty);
        virtual Optimizable V_Rvalue (AST::Rvalue *obj, Empty);
        virtual Optimizable V_SchemaTable (AST::SchemaTable *obj, Empty);
        virtual Optimizable V_SingleExpression (AST::SingleExpression *obj, Empty);
        virtual Optimizable V_Statement (AST::Statement *obj, Empty);
        virtual Optimizable V_SwitchStatement (AST::SwitchStatement *obj, Empty);
        virtual Optimizable V_TryCatchStatement(AST::TryCatchStatement *obj, Empty);
        virtual Optimizable V_TryFinallyStatement(AST::TryFinallyStatement *obj, Empty);
        virtual Optimizable V_TypeInfo (AST::TypeInfo *obj, Empty);
        virtual Optimizable V_UnaryOperator (AST::UnaryOperator *obj, Empty);
        virtual Optimizable V_Variable (AST::Variable *obj, Empty);
        virtual Optimizable V_Yield (AST::Yield *obj, Empty);

        virtual Optimizable V_SQL (AST::SQL *obj, Empty);
        virtual Optimizable V_SQLDataModifier (AST::SQLDataModifier *obj, Empty);
        virtual Optimizable V_SQLDelete (AST::SQLDelete *obj, Empty);
        virtual Optimizable V_SQLInsert (AST::SQLInsert *obj, Empty);
        virtual Optimizable V_SQLSource (AST::SQLSource *obj, Empty);
        virtual Optimizable V_SQLSources (AST::SQLSources *obj, Empty);
        virtual Optimizable V_SQLSelect (AST::SQLSelect *obj, Empty);
        virtual Optimizable V_SQLUpdate (AST::SQLUpdate *obj, Empty);
};



} // end of namespace Opt_ConstantsArithmatic
} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
