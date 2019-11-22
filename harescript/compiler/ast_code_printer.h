#ifndef blex_webhare_compiler_ast_code_printer
#define blex_webhare_compiler_ast_code_printer

#include <blex/stream.h>

#include "ast.h"
#include "astvisitors.h"
#include "semanticcheck.h"
#include "astvariableuseanalyzer.h"

namespace HareScript
{

namespace Compiler
{


class AstCodePrinter : public AST::NodeVisitor<void, Empty>
{
    private:
        CompilerContext &context;

        std::unique_ptr<Blex::BufferedStream> stream;

        TypeStorage typestorage;

        void Visit(AST::Node* node);

        unsigned indent;

        void OutputLocation(AST::ArrayLocation &location);

        ASTVariabeleUseAnalyzer const *vuanalyzer;

        AstCodePrinter(AstCodePrinter const &) = delete;
        AstCodePrinter& operator=(AstCodePrinter const &) = delete;

    public:
        AstCodePrinter(CompilerContext &context);
        ~AstCodePrinter();

        void OutputASTCode(AST::Module *module, Blex::Stream &output, TypeStorage const &tstorage);
        void SetVUAnalyzer(ASTVariabeleUseAnalyzer const *vuanalyzer);
        void DumpExpression(std::ostream &str, AST::Rvalue *expr);

        virtual void V_ArrayDelete(AST::ArrayDelete *arraydelete, Empty);
        virtual void V_ArrayElementConst(AST::ArrayElementConst *arrayelementconst, Empty);
        virtual void V_ArrayElementModify(AST::ArrayElementModify *arrayelementmodify, Empty);
        virtual void V_ArrayInsert(AST::ArrayInsert *arrayinsert, Empty);
        virtual void V_Assignment(AST::Assignment *assignment, Empty);
        virtual void V_BinaryOperator(AST::BinaryOperator *binaryoperator, Empty);
        virtual void V_Block(AST::Block *block, Empty);
        virtual void V_BreakStatement(AST::BreakStatement *breakstatement, Empty);
        virtual void V_BuiltinInstruction(AST::BuiltinInstruction *builtininstruction, Empty);
        virtual void V_Cast(AST::Cast *cast, Empty);
        virtual void V_ConditionalOperator(AST::ConditionalOperator *conditionaloperator, Empty);
        virtual void V_ConditionalStatement(AST::ConditionalStatement *conditionalstatement, Empty);
        virtual void V_Constant(AST::Constant *constant, Empty);
        virtual void V_ConstantRecord(AST::ConstantRecord *constantrecord, Empty);
        virtual void V_ConstantArray(AST::ConstantArray *constantarray, Empty);
        virtual void V_ContinueStatement(AST::ContinueStatement *continuestatement, Empty);
        virtual void V_DeepOperation(AST::DeepOperation *deepoperation, Empty);
        virtual void V_DeepArrayDelete(AST::DeepArrayDelete *deeparraydelete, Empty);
        virtual void V_DeepArrayInsert(AST::DeepArrayInsert *deeparrayinsert, Empty);
        virtual void V_End(AST::End *expressionblock, Empty);
        virtual void V_ExpressionBlock(AST::ExpressionBlock *expressionblock, Empty);
        virtual void V_ForEveryStatement(AST::ForEveryStatement *foreverystatement, Empty);
        virtual void V_Function(AST::Function *function, Empty);
        virtual void V_FunctionCall(AST::FunctionCall *functioncall, Empty);
        virtual void V_FunctionPtr(AST::FunctionPtr *functionptr, Empty);
        virtual void V_FunctionPtrCall(AST::FunctionPtrCall *functionptrcall, Empty);
        virtual void V_FunctionPtrRebind(AST::FunctionPtrRebind *functionptrrebind, Empty);
        virtual void V_InitializeStatement(AST::InitializeStatement *initializestatement, Empty);
        virtual void V_LoopStatement(AST::LoopStatement *loopstatement, Empty);
        virtual void V_Lvalue(AST::Lvalue *lvalue, Empty);
        virtual void V_LvalueSet(AST::LvalueSet *lvalueset, Empty);
        virtual void V_Module(AST::Module *module, Empty);
        virtual void V_Node(AST::Node *node, Empty);
        virtual void V_RecordCellDelete(AST::RecordCellDelete *recordcelldelete, Empty);
        virtual void V_RecordCellSet(AST::RecordCellSet *recordcellset, Empty);
        virtual void V_RecordColumnConst(AST::RecordColumnConst *recordcolumnconst, Empty);
        virtual void V_ObjectExtend(AST::ObjectExtend *objectextend, Empty);
        virtual void V_ObjectMemberDelete(AST::ObjectMemberDelete *objectmemberdelete, Empty);
        virtual void V_ObjectMemberInsert(AST::ObjectMemberInsert *objectmemberinsert, Empty);
        virtual void V_ObjectMemberSet(AST::ObjectMemberSet *recordcellset, Empty);
        virtual void V_ObjectMemberConst(AST::ObjectMemberConst *recordcolumnconst, Empty);
        virtual void V_ObjectMethodCall(AST::ObjectMethodCall *objectmethodcall, Empty);
        virtual void V_ObjectTypeUID(AST::ObjectTypeUID *objecttypeuid, Empty);
        virtual void V_ReturnStatement(AST::ReturnStatement *returnstatement, Empty);
        virtual void V_Rvalue(AST::Rvalue *rvalue, Empty);
        virtual void V_SchemaTable(AST::SchemaTable *schematable, Empty);

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
        virtual void V_SwitchStatement(AST::SwitchStatement *switchstatement, Empty);
        virtual void V_TryCatchStatement(AST::TryCatchStatement *trycatchstatement, Empty);
        virtual void V_TryFinallyStatement(AST::TryFinallyStatement *tryfinallystatement, Empty);
        virtual void V_TypeInfo(AST::TypeInfo *typeinfo, Empty);
        virtual void V_UnaryOperator(AST::UnaryOperator *unaryoperator, Empty);
        virtual void V_Variable(AST::Variable *variable, Empty);
        virtual void V_Yield(AST::Yield *yield, Empty);
};  // End of class AstDotPrinter

} // end of namespace HareScript
} // end of namespace Compiler

#endif
