#ifndef blex_webhare_compiler_astvisitors
#define blex_webhare_compiler_astvisitors

/** contains generic visitors */

#include "ast.h"
#include "compiler.h"

namespace HareScript
{
namespace Compiler
{
namespace AST
{

#undef ACTION
#define ACTION(classname) VISITOR_PERCLASSDEFS(VisitorType, classname)

template <class ReturnType, class ParameterType, bool ReturnReferences = false>
 struct NodeVisitor: public BaseNodeVisitor
{
        typedef NodeVisitor<ReturnType, ParameterType> VisitorType;
        VISITOR_VISITORFUNC(Node, NodeVisitor, VisitorType)

        ACTION(ArrayDelete)
        ACTION(ArrayElementConst)
        ACTION(ArrayElementModify)
        ACTION(ArrayInsert)
        ACTION(Assignment)
        ACTION(BinaryOperator)
        ACTION(Block)
        ACTION(BreakStatement)
        ACTION(BuiltinInstruction)
        ACTION(Cast)
        ACTION(ConditionalOperator)
        ACTION(ConditionalStatement)
        ACTION(Constant)
        ACTION(ConstantRecord)
        ACTION(ConstantArray)
        ACTION(ContinueStatement)
        ACTION(DeepOperation)
        ACTION(DeepArrayDelete)
        ACTION(DeepArrayInsert)
        ACTION(End)
        ACTION(ExpressionBlock)
        ACTION(ForEveryStatement)
        ACTION(Function)
        ACTION(FunctionCall)
        ACTION(FunctionPtr)
        ACTION(FunctionPtrCall)
        ACTION(FunctionPtrRebind)
        ACTION(InitializeStatement)
        ACTION(LoopStatement)
        ACTION(Lvalue)
        ACTION(LvalueSet)
        ACTION(Module)
        ACTION(Node)
        ACTION(RecordCellDelete)
        ACTION(RecordCellSet)
        ACTION(RecordColumnConst)
        ACTION(ObjectExtend)
        ACTION(ObjectMemberConst)
        ACTION(ObjectMemberDelete)
        ACTION(ObjectMemberInsert)
        ACTION(ObjectMemberSet)
        ACTION(ObjectMethodCall)
        ACTION(ObjectTypeUID)
        ACTION(ReturnStatement)
        ACTION(Rvalue)
        ACTION(SchemaTable)
        ACTION(SingleExpression)
        ACTION(Statement)
        ACTION(SwitchStatement)
        ACTION(TryCatchStatement)
        ACTION(TryFinallyStatement)
        ACTION(TypeInfo)
        ACTION(UnaryOperator)
        ACTION(Variable)
        ACTION(Yield)

        ACTION(SQL)
        ACTION(SQLDataModifier)
        ACTION(SQLDelete)
        ACTION(SQLInsert)
        ACTION(SQLSource)
        ACTION(SQLSources)
        ACTION(SQLSelect)
        ACTION(SQLUpdate)
};

template <class ReturnType, class ParameterType, bool ReturnReferences = false>
 struct StatementVisitor: public BaseStatementVisitor
{
        typedef StatementVisitor<ReturnType, ParameterType> VisitorType;
        VISITOR_VISITORFUNC(Statement, StatementVisitor, VisitorType)

        ACTION(ArrayDelete)
        ACTION(ArrayInsert)
        ACTION(Block)
        ACTION(BreakStatement)
        ACTION(ConditionalStatement)
        ACTION(ContinueStatement)
        ACTION(DeepOperation)
        ACTION(DeepArrayDelete)
        ACTION(DeepArrayInsert)
        ACTION(InitializeStatement)
        ACTION(ForEveryStatement)
        ACTION(LoopStatement)
        ACTION(LvalueSet)
        ACTION(RecordCellSet)
        ACTION(ObjectExtend)
        ACTION(ObjectMemberDelete)
        ACTION(ObjectMemberInsert)
        ACTION(ObjectMemberSet)
        ACTION(RecordCellDelete)
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

template <class ReturnType, class ParameterType, bool ReturnReferences = false>
 struct DeepOperationVisitor: public BaseDeepOperationVisitor
{
        typedef StatementVisitor<ReturnType, ParameterType> VisitorType;
        VISITOR_VISITORFUNC(DeepOperation, DeepOperationVisitor, VisitorType)

        ACTION(DeepOperation)
        ACTION(LvalueSet)
        ACTION(DeepArrayDelete)
        ACTION(DeepArrayInsert)
};

template <class ReturnType, class ParameterType, bool ReturnReferences = false>
 struct ExpressionVisitor: public BaseExpressionVisitor
{
        typedef ExpressionVisitor<ReturnType, ParameterType> VisitorType;
        VISITOR_VISITORFUNC(Rvalue, ExpressionVisitor, VisitorType)

        ACTION(ArrayElementConst)
        ACTION(ArrayElementModify)
        ACTION(Assignment)
        ACTION(BinaryOperator)
        ACTION(BuiltinInstruction)
        ACTION(Cast)
        ACTION(ConditionalOperator)
        ACTION(Constant)
        ACTION(End)
        ACTION(ExpressionBlock)
        ACTION(FunctionPtr)
        ACTION(FunctionPtrRebind)
        ACTION(FunctionCall)
        ACTION(Lvalue)
        ACTION(RecordColumnConst)
        ACTION(ObjectMemberConst)
        ACTION(ObjectMethodCall)
        ACTION(ObjectTypeUID)
        ACTION(Rvalue)
        ACTION(SchemaTable)
        ACTION(UnaryOperator)
        ACTION(Variable)
        ACTION(Yield)

        ACTION(SQLSelect)
};


// -----------------------------------------------------------------------------
// --
// -- Predefined visitors
// --
struct AllNodeVisitor: public NodeVisitor<void, Empty>
{
        virtual void V_ArrayDelete(AST::ArrayDelete *obj, Empty);
        virtual void V_ArrayElementConst(AST::ArrayElementConst *obj, Empty);
        virtual void V_ArrayElementModify(AST::ArrayElementModify *obj, Empty);
        virtual void V_ArrayInsert(AST::ArrayInsert *obj, Empty);
        virtual void V_Assignment(AST::Assignment *obj, Empty);
        virtual void V_BinaryOperator(AST::BinaryOperator *obj, Empty);
        virtual void V_Block(AST::Block *obj, Empty);
        virtual void V_BreakStatement(AST::BreakStatement *obj, Empty);
        virtual void V_BuiltinInstruction(AST::BuiltinInstruction *obj, Empty);
        virtual void V_Cast(AST::Cast *obj, Empty);
        virtual void V_ConditionalOperator(AST::ConditionalOperator *obj, Empty);
        virtual void V_ConditionalStatement(AST::ConditionalStatement *obj, Empty);
        virtual void V_Constant(AST::Constant *obj, Empty);
        virtual void V_ConstantRecord(AST::ConstantRecord *obj, Empty);
        virtual void V_ConstantArray(AST::ConstantArray *obj, Empty);
        virtual void V_ContinueStatement(AST::ContinueStatement *obj, Empty);
        virtual void V_DeepOperation(AST::DeepOperation *deepoperation, Empty);
        virtual void V_DeepArrayDelete(AST::DeepArrayDelete *deeparraydelete, Empty);
        virtual void V_DeepArrayInsert(AST::DeepArrayInsert *deeparrayinsert, Empty);
        virtual void V_End(AST::End *obj, Empty);
        virtual void V_ExpressionBlock(AST::ExpressionBlock *obj, Empty);
        virtual void V_ForEveryStatement(AST::ForEveryStatement *obj, Empty);
        virtual void V_Function(AST::Function *obj, Empty);
        virtual void V_FunctionCall(AST::FunctionCall *obj, Empty);
        virtual void V_FunctionPtr(AST::FunctionPtr *obj, Empty);
        virtual void V_FunctionPtrCall(AST::FunctionPtrCall *obj, Empty);
        virtual void V_FunctionPtrRebind(AST::FunctionPtrRebind *obj, Empty);
        virtual void V_InitializeStatement(AST::InitializeStatement *obj, Empty);
        virtual void V_LoopStatement(AST::LoopStatement *obj, Empty);
        virtual void V_Lvalue(AST::Lvalue *obj, Empty);
        virtual void V_LvalueSet(AST::LvalueSet *obj, Empty);
        virtual void V_Module(AST::Module *obj, Empty);
        virtual void V_Node(AST::Node *obj, Empty);
        virtual void V_RecordCellDelete(AST::RecordCellDelete *obj, Empty);
        virtual void V_RecordCellSet(AST::RecordCellSet *obj, Empty);
        virtual void V_RecordColumnConst(AST::RecordColumnConst *obj, Empty);
        virtual void V_ObjectExtend(AST::ObjectExtend *obj, Empty);
        virtual void V_ObjectMemberConst(AST::ObjectMemberConst*obj, Empty);
        virtual void V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty);
        virtual void V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty);
        virtual void V_ObjectMemberSet(AST::ObjectMemberSet *obj, Empty);
        virtual void V_ObjectMethodCall(AST::ObjectMethodCall*obj, Empty);
        virtual void V_ObjectTypeUID(AST::ObjectTypeUID*obj, Empty);
        virtual void V_ReturnStatement(AST::ReturnStatement *obj, Empty);
        virtual void V_Rvalue(AST::Rvalue *obj, Empty);
        virtual void V_SchemaTable(AST::SchemaTable *obj, Empty);

        virtual void V_SQL(AST::SQL *sql, Empty);
        virtual void V_SQLDataModifier(AST::SQLDataModifier *sqldatamodifier, Empty);
        virtual void V_SQLDelete(AST::SQLDelete * sqldelete, Empty);
        virtual void V_SQLSelect(AST::SQLSelect * sqlselect, Empty);
        virtual void V_SQLSource(AST::SQLSource * sqlsource, Empty);
        virtual void V_SQLSources(AST::SQLSources * sqlsources, Empty);
        virtual void V_SQLInsert(AST::SQLInsert * sqlinsert, Empty);
        virtual void V_SQLUpdate(AST::SQLUpdate * sqlupdate, Empty);
        virtual void V_SingleExpression(AST::SingleExpression *singleexpression, Empty);
        virtual void V_Statement(AST::Statement *statement, Empty);
        virtual void V_SwitchStatement(AST::SwitchStatement *statement, Empty);
        virtual void V_TryCatchStatement(AST::TryCatchStatement *trycatchstatement, Empty);
        virtual void V_TryFinallyStatement(AST::TryFinallyStatement *tryfinallystatement, Empty);
        virtual void V_TypeInfo(AST::TypeInfo *typeinfo, Empty);
        virtual void V_UnaryOperator(AST::UnaryOperator *unaryoperator, Empty);
        virtual void V_Variable(AST::Variable *variable, Empty);
        virtual void V_Yield(AST::Yield *yield, Empty);
};

class TreeCopyingVisitor: public NodeVisitor<void, Empty>
{
    public:
        TreeCopyingVisitor(CompilerContext &context)
        : context(context)
        {
        }

        template <class Node> inline Node * GetCopy(Node *node) { Visit(node, Empty()); return node; }

    private:
        CompilerContext &context;

        template <class T> T* Clone(T const *node)
        {
                T* newnode = new T(*node);
                context.owner.Adopt(newnode);
                ReplacePtr(newnode);
                return newnode;
        }

        virtual void V_ArrayDelete(AST::ArrayDelete *obj, Empty);
        virtual void V_ArrayElementConst(AST::ArrayElementConst *obj, Empty);
        virtual void V_ArrayElementModify(AST::ArrayElementModify *obj, Empty);
        virtual void V_ArrayInsert(AST::ArrayInsert *obj, Empty);
        virtual void V_Assignment(AST::Assignment *obj, Empty);
        virtual void V_BinaryOperator(AST::BinaryOperator *obj, Empty);
        virtual void V_Block(AST::Block *obj, Empty);
        virtual void V_BreakStatement(AST::BreakStatement *obj, Empty);
        virtual void V_BuiltinInstruction(AST::BuiltinInstruction *obj, Empty);
        virtual void V_Cast(AST::Cast *obj, Empty);
        virtual void V_ConditionalOperator(AST::ConditionalOperator *obj, Empty);
        virtual void V_ConditionalStatement(AST::ConditionalStatement *obj, Empty);
        virtual void V_Constant(AST::Constant *obj, Empty);
        virtual void V_ConstantRecord(AST::ConstantRecord *obj, Empty);
        virtual void V_ConstantArray(AST::ConstantArray *obj, Empty);
        virtual void V_ContinueStatement(AST::ContinueStatement *obj, Empty);
        virtual void V_DeepOperation(AST::DeepOperation *obj, Empty);
        virtual void V_DeepArrayDelete(AST::DeepArrayDelete *deeparraydelete, Empty);
        virtual void V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty);
        virtual void V_End(AST::End *obj, Empty);
        virtual void V_ExpressionBlock(AST::ExpressionBlock *obj, Empty);
        virtual void V_ForEveryStatement(AST::ForEveryStatement *obj, Empty);
        virtual void V_Function(AST::Function *obj, Empty);
        virtual void V_FunctionCall(AST::FunctionCall *obj, Empty);
        virtual void V_FunctionPtr(AST::FunctionPtr *obj, Empty);
        virtual void V_FunctionPtrCall(AST::FunctionPtrCall *obj, Empty);
        virtual void V_FunctionPtrRebind(AST::FunctionPtrRebind *obj, Empty);
        virtual void V_InitializeStatement(AST::InitializeStatement *obj, Empty);
        virtual void V_LoopStatement(AST::LoopStatement *obj, Empty);
        virtual void V_Lvalue(AST::Lvalue *obj, Empty);
        virtual void V_LvalueSet(AST::LvalueSet *obj, Empty);
        virtual void V_Module(AST::Module *obj, Empty);
        virtual void V_Node(AST::Node *obj, Empty);
        virtual void V_RecordCellDelete(AST::RecordCellDelete *obj, Empty);
        virtual void V_RecordCellSet(AST::RecordCellSet *obj, Empty);
        virtual void V_RecordColumnConst(AST::RecordColumnConst *obj, Empty);
        virtual void V_ObjectExtend(AST::ObjectExtend *obj, Empty);
        virtual void V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty);
        virtual void V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty);
        virtual void V_ObjectMemberSet(AST::ObjectMemberSet *obj, Empty);
        virtual void V_ObjectMemberConst(AST::ObjectMemberConst *obj, Empty);
        virtual void V_ObjectMethodCall(AST::ObjectMethodCall*obj, Empty);
        virtual void V_ObjectTypeUID(AST::ObjectTypeUID*obj, Empty);
        virtual void V_ReturnStatement(AST::ReturnStatement *obj, Empty);
        virtual void V_Rvalue(AST::Rvalue *obj, Empty);
        virtual void V_SchemaTable(AST::SchemaTable *obj, Empty);

        virtual void V_SQL(AST::SQL *sql, Empty);
        virtual void V_SQLDataModifier(AST::SQLDataModifier *sqldatamodifier, Empty);
        virtual void V_SQLDelete(AST::SQLDelete * sqldelete, Empty);
        virtual void V_SQLSelect(AST::SQLSelect * sqlselect, Empty);
        virtual void V_SQLSource(AST::SQLSource * sqlsource, Empty);
        virtual void V_SQLSources(AST::SQLSources * sqlsources, Empty);
        virtual void V_SQLInsert(AST::SQLInsert * sqlinsert, Empty);
        virtual void V_SQLUpdate(AST::SQLUpdate * sqlupdate, Empty);

        virtual void V_SingleExpression(AST::SingleExpression *singleexpression, Empty);
        virtual void V_Statement(AST::Statement *statement, Empty);
        virtual void V_SwitchStatement(AST::SwitchStatement *statement, Empty);
        virtual void V_TryCatchStatement(AST::TryCatchStatement *statement, Empty);
        virtual void V_TryFinallyStatement(AST::TryFinallyStatement *tryfinallystatement, Empty);
        virtual void V_TypeInfo(AST::TypeInfo *typeinfo, Empty);
        virtual void V_UnaryOperator(AST::UnaryOperator *unaryoperator, Empty);
        virtual void V_Variable(AST::Variable *variable, Empty);
        virtual void V_Yield(AST::Yield *yield, Empty);
};

} // End of namespace AST
} // End of namespace Compiler
} // End of namespace HareScript

#endif
