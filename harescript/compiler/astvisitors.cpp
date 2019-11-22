//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "astvisitors.h"

namespace HareScript
{
namespace Compiler
{
namespace AST
{

void AllNodeVisitor::V_ArrayDelete(AST::ArrayDelete *obj, Empty)
{
        Visit(obj->array, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}

void AllNodeVisitor::V_ArrayElementConst(AST::ArrayElementConst *obj, Empty)
{
        Visit(obj->array, Empty());
        Visit(obj->index, Empty());
}

void AllNodeVisitor::V_ArrayElementModify(AST::ArrayElementModify *obj, Empty)
{
        Visit(obj->array, Empty());
        Visit(obj->index, Empty());
        Visit(obj->value, Empty());
}

void AllNodeVisitor::V_ArrayInsert(AST::ArrayInsert *obj, Empty)
{
        Visit(obj->array, Empty());
        Visit(obj->value, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}

void AllNodeVisitor::V_Assignment(AST::Assignment *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->target, Empty());
}

void AllNodeVisitor::V_BinaryOperator(AST::BinaryOperator *obj, Empty)
{
        Visit(obj->lhs, Empty());
        Visit(obj->rhs, Empty());
}

void AllNodeVisitor::V_Block(AST::Block *obj, Empty)
{
        std::for_each(obj->statements.begin(), obj->statements.end(), GetVisitorFunctor(this, Empty()));
}

void AllNodeVisitor::V_BreakStatement(AST::BreakStatement *, Empty)
{
}

void AllNodeVisitor::V_BuiltinInstruction(AST::BuiltinInstruction *obj, Empty)
{
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}

void AllNodeVisitor::V_Cast(AST::Cast *obj, Empty)
{
        Visit(obj->expr, Empty());
}
void AllNodeVisitor::V_ConditionalOperator(AST::ConditionalOperator *obj, Empty)
{
        Visit(obj->condition, Empty());
        Visit(obj->expr_true, Empty());
        Visit(obj->expr_false, Empty());
}
void AllNodeVisitor::V_ConditionalStatement(AST::ConditionalStatement *obj, Empty)
{
        Visit(obj->condition, Empty());
        Visit(obj->stat_true, Empty());
        if (obj->stat_false) Visit(obj->stat_false, Empty());
}
void AllNodeVisitor::V_Constant(AST::Constant *, Empty)
{
}
void AllNodeVisitor::V_ConstantRecord(AST::ConstantRecord *obj, Empty)
{
        for (auto &itr: obj->columns)
            Visit(std::get<2>(itr), Empty());
}
void AllNodeVisitor::V_ConstantArray(AST::ConstantArray *obj, Empty)
{
        for (auto &itr: obj->values)
            Visit(std::get<1>(itr), Empty());
}
void AllNodeVisitor::V_ContinueStatement(AST::ContinueStatement *, Empty)
{
}
void AllNodeVisitor::V_DeepOperation(AST::DeepOperation *obj, Empty)
{
        Visit(obj->clvalue.base, Empty());
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr) Visit(it->expr, Empty());
}
void AllNodeVisitor::V_DeepArrayDelete(AST::DeepArrayDelete *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
}
void AllNodeVisitor::V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
        Visit(obj->value, Empty());
}
void AllNodeVisitor::V_End(AST::End *, Empty)
{
}
void AllNodeVisitor::V_ExpressionBlock(AST::ExpressionBlock *obj, Empty)
{
        if (obj->block)
            Visit(obj->block, Empty());
        Visit(obj->returnvar, Empty());
}
void AllNodeVisitor::V_ForEveryStatement(AST::ForEveryStatement *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->iteratevar, Empty());
        Visit(obj->loop, Empty());
        Visit(obj->positionvar, Empty());
}
void AllNodeVisitor::V_Function(AST::Function *obj, Empty)
{
        for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it = obj->symbol->functiondef->arguments.begin();
                it != obj->symbol->functiondef->arguments.end(); ++it)
        {
                if (it->value) Visit(it->value, Empty());
        }
        Visit(obj->block, Empty());
}
void AllNodeVisitor::V_FunctionCall(AST::FunctionCall *obj, Empty)
{
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}
void AllNodeVisitor::V_FunctionPtr(AST::FunctionPtr *obj, Empty)
{
        for (RvaluePtrs::iterator itr = obj->bound_parameters.begin(); itr != obj->bound_parameters.end(); ++itr)
          if (*itr)
            Visit(*itr, Empty());
}
void AllNodeVisitor::V_FunctionPtrCall(AST::FunctionPtrCall *obj, Empty)
{
        Visit(obj->functionptr, Empty());
        for (RvaluePtrs::iterator itr = obj->params.begin(); itr != obj->params.end(); ++itr)
          if (*itr)
            Visit(*itr, Empty());
}
void AllNodeVisitor::V_FunctionPtrRebind(AST::FunctionPtrRebind *obj, Empty)
{
        Visit(obj->orgptr, Empty());
        for (RvaluePtrs::iterator itr = obj->bound_parameters.begin(); itr != obj->bound_parameters.end(); ++itr)
          if (*itr)
            Visit(*itr, Empty());
}
void AllNodeVisitor::V_InitializeStatement(AST::InitializeStatement *, Empty)
{
}
void AllNodeVisitor::V_LoopStatement(AST::LoopStatement *obj, Empty)
{
        if (obj->precondition) Visit(obj->precondition, Empty());
        if (obj->loopincrementer) Visit(obj->loopincrementer, Empty());
        Visit(obj->loop, Empty());
}
void AllNodeVisitor::V_Lvalue(AST::Lvalue *, Empty)
{
}
void AllNodeVisitor::V_LvalueSet(AST::LvalueSet *obj, Empty empty)
{
        V_DeepOperation(obj, empty);
        Visit(obj->value, Empty());
}
void AllNodeVisitor::V_Module(AST::Module *obj, Empty)
{
        std::for_each(obj->functions.begin(), obj->functions.end(), GetVisitorFunctor(this, Empty()));
}
void AllNodeVisitor::V_Node(AST::Node *, Empty)
{
}
void AllNodeVisitor::V_RecordCellSet(AST::RecordCellSet *obj, Empty)
{
        Visit(obj->record, Empty());
        Visit(obj->value, Empty());
}
void AllNodeVisitor::V_ObjectExtend(AST::ObjectExtend *obj, Empty)
{
        Visit(obj->object, Empty());

        for (auto &itr: obj->parameters)
            Visit(itr, Empty());
}
void AllNodeVisitor::V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty)
{
        Visit(obj->object, Empty());
}
void AllNodeVisitor::V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty)
{
        Visit(obj->object, Empty());
        Visit(obj->value, Empty());
}
void AllNodeVisitor::V_ObjectMemberSet(AST::ObjectMemberSet *obj, Empty)
{
        Visit(obj->object, Empty());
        Visit(obj->value, Empty());
}
void AllNodeVisitor::V_RecordCellDelete(AST::RecordCellDelete *obj, Empty)
{
        Visit(obj->record, Empty());
}
void AllNodeVisitor::V_RecordColumnConst(AST::RecordColumnConst *obj, Empty)
{
        Visit(obj->record, Empty());
}
void AllNodeVisitor::V_ObjectMemberConst(AST::ObjectMemberConst *obj, Empty)
{
        Visit(obj->object, Empty());
}
void AllNodeVisitor::V_ObjectMethodCall(AST::ObjectMethodCall *obj, Empty)
{
        Visit(obj->object, Empty());
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}
void AllNodeVisitor::V_ObjectTypeUID(AST::ObjectTypeUID *, Empty)
{
}
void AllNodeVisitor::V_ReturnStatement(AST::ReturnStatement *obj, Empty)
{
        if (obj->returnvalue)
            Visit(obj->returnvalue,Empty());
}
void AllNodeVisitor::V_Rvalue(AST::Rvalue *, Empty)
{
}
void AllNodeVisitor::V_SchemaTable(AST::SchemaTable *obj, Empty)
{
        Visit(obj->schema, Empty());
}
void AllNodeVisitor::V_SQL(AST::SQL *, Empty)
{
}
void AllNodeVisitor::V_SQLDataModifier(AST::SQLDataModifier *obj, Empty)
{
        std::for_each(obj->values.begin(), obj->values.end(), GetVisitorFunctor(this, Empty()));
}
void AllNodeVisitor::V_SQLDelete(AST::SQLDelete *obj, Empty)
{
        Visit(obj->sources, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
}
void AllNodeVisitor::V_SQLSelect(AST::SQLSelect *obj, Empty)
{
        if (obj->limit_expr)
            Visit(obj->limit_expr, Empty());
        Visit(obj->sources, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
        for(std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin();
            it != obj->temporaries.end(); ++it)
            Visit(it->expr, Empty());
        for(std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin();
            it != obj->namedselects.end(); ++it)
            if (it->expr)
                Visit(it->expr, Empty());
        for(std::vector<std::pair<Rvalue*, bool> >::iterator it = obj->orderings.begin();
            it != obj->orderings.end(); ++it)
            Visit(it->first, Empty());
        if (obj->having_expr)
            Visit(obj->having_expr, Empty());
        for (std::vector< Rvalue * >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it)
            Visit(*it, Empty());
}
void AllNodeVisitor::V_SQLSource(AST::SQLSource *obj, Empty)
{
        Visit(obj->expression, Empty());
        if (obj->reassign)
            Visit(obj->reassign, Empty());
}
void AllNodeVisitor::V_SQLSources(AST::SQLSources *obj, Empty)
{
        std::for_each(obj->sources.begin(), obj->sources.end(), GetVisitorFunctor(this, Empty()));
}
void AllNodeVisitor::V_SQLInsert(AST::SQLInsert *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->modifier, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}
void AllNodeVisitor::V_SQLUpdate(AST::SQLUpdate *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->modifier, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}
void AllNodeVisitor::V_SingleExpression(AST::SingleExpression *obj, Empty)
{
        Visit(obj->expr, Empty());
}
void AllNodeVisitor::V_Statement(AST::Statement *, Empty)
{
}
void AllNodeVisitor::V_SwitchStatement(AST::SwitchStatement *obj, Empty)
{
        Visit(obj->value, Empty());
        if (obj->defaultcase) Visit(obj->defaultcase, Empty());
        for (AST::SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                    Visit(*it2, Empty());
                Visit(it->second, Empty());
        }
}

void AllNodeVisitor::V_TryCatchStatement(AST::TryCatchStatement *obj, Empty)
{
        Visit(obj->tryblock, Empty());
        Visit(obj->catchblock, Empty());
}
void AllNodeVisitor::V_TryFinallyStatement(AST::TryFinallyStatement *obj, Empty)
{
        Visit(obj->tryblock, Empty());
        Visit(obj->finallyblock, Empty());
}
void AllNodeVisitor::V_TypeInfo(AST::TypeInfo *, Empty)
{
}
void AllNodeVisitor::V_UnaryOperator(AST::UnaryOperator *obj, Empty)
{
        Visit(obj->lhs, Empty());
}
void AllNodeVisitor::V_Variable(AST::Variable *, Empty)
{
}
void AllNodeVisitor::V_Yield(AST::Yield *obj, Empty)
{
        Visit(obj->generator, Empty());
        Visit(obj->yieldexpr, Empty());
}


// ---

void TreeCopyingVisitor::V_ArrayDelete(AST::ArrayDelete *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->array, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}

void TreeCopyingVisitor::V_ArrayElementConst(AST::ArrayElementConst *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->array, Empty());
        Visit(obj->index, Empty());
}

void TreeCopyingVisitor::V_ArrayElementModify(AST::ArrayElementModify *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->array, Empty());
        Visit(obj->index, Empty());
        Visit(obj->value, Empty());
}

void TreeCopyingVisitor::V_ArrayInsert(AST::ArrayInsert *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->array, Empty());
        Visit(obj->value, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}

void TreeCopyingVisitor::V_Assignment(AST::Assignment *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->source, Empty());
        Visit(obj->target, Empty());
}

void TreeCopyingVisitor::V_BinaryOperator(AST::BinaryOperator *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->lhs, Empty());
        Visit(obj->rhs, Empty());
}

void TreeCopyingVisitor::V_Block(AST::Block *obj, Empty)
{
        obj = Clone(obj);

        std::for_each(obj->statements.begin(), obj->statements.end(), GetVisitorFunctor(this, Empty()));
}

void TreeCopyingVisitor::V_BreakStatement(AST::BreakStatement *obj, Empty)
{
        Clone(obj);
}

void TreeCopyingVisitor::V_BuiltinInstruction(AST::BuiltinInstruction *obj, Empty)
{
        obj = Clone(obj);

        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}

void TreeCopyingVisitor::V_Cast(AST::Cast *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->expr, Empty());
}
void TreeCopyingVisitor::V_ConditionalOperator(AST::ConditionalOperator *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->condition, Empty());
        Visit(obj->expr_true, Empty());
        Visit(obj->expr_false, Empty());
}
void TreeCopyingVisitor::V_ConditionalStatement(AST::ConditionalStatement *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->condition, Empty());
        Visit(obj->stat_true, Empty());
        if (obj->stat_false) Visit(obj->stat_false, Empty());
}
void TreeCopyingVisitor::V_Constant(AST::Constant *obj, Empty)
{
        AST::Constant *oldobj(obj);
        obj = Clone(obj);
        obj->var = context.stackm.NewHeapVariable();
        context.stackm.CopyFrom(obj->var, oldobj->var);
}
void TreeCopyingVisitor::V_ConstantRecord(AST::ConstantRecord *obj, Empty)
{
        obj = Clone(obj);
        for (auto &itr: obj->columns)
            Visit(std::get<2>(itr), Empty());

}
void TreeCopyingVisitor::V_ConstantArray(AST::ConstantArray *obj, Empty)
{
        obj = Clone(obj);
        for (auto &itr: obj->values)
            Visit(std::get<1>(itr), Empty());
}

void TreeCopyingVisitor::V_ContinueStatement(AST::ContinueStatement *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_DeepOperation(AST::DeepOperation *, Empty)
{
        throw std::runtime_error("Cannot clone base class DeepOperation");
}

void TreeCopyingVisitor::V_DeepArrayDelete(AST::DeepArrayDelete *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->clvalue.base, Empty());
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr) Visit(it->expr, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
}

void TreeCopyingVisitor::V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->clvalue.base, Empty());
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr) Visit(it->expr, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
        Visit(obj->value, Empty());
}
void TreeCopyingVisitor::V_End(AST::End *obj, Empty)
{
        obj = Clone(obj);
}
void TreeCopyingVisitor::V_ExpressionBlock(AST::ExpressionBlock *obj, Empty)
{
        obj = Clone(obj);

        if (obj->block)
            Visit(obj->block, Empty());
        Visit(obj->returnvar, Empty());
}
void TreeCopyingVisitor::V_ForEveryStatement(AST::ForEveryStatement *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->source, Empty());
        Visit(obj->iteratevar, Empty());
        Visit(obj->loop, Empty());
        Visit(obj->positionvar, Empty());
}
void TreeCopyingVisitor::V_Function(AST::Function *obj, Empty)
{
        obj = Clone(obj);

        for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it = obj->symbol->functiondef->arguments.begin();
                it != obj->symbol->functiondef->arguments.end(); ++it)
        {
                if (it->value) Visit(it->value, Empty());
        }
        Visit(obj->block, Empty());
}
void TreeCopyingVisitor::V_FunctionCall(AST::FunctionCall *obj, Empty)
{
        obj = Clone(obj);

        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}
void TreeCopyingVisitor::V_FunctionPtr(AST::FunctionPtr *obj, Empty)
{
        obj = Clone(obj);
        for (RvaluePtrs::iterator itr = obj->bound_parameters.begin(); itr != obj->bound_parameters.end(); ++itr)
          if (*itr)
            Visit(*itr, Empty());
}
void TreeCopyingVisitor::V_FunctionPtrCall(AST::FunctionPtrCall *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->functionptr, Empty());
        for (RvaluePtrs::iterator itr = obj->params.begin(); itr != obj->params.end(); ++itr)
          if (*itr)
            Visit(*itr, Empty());
}

void TreeCopyingVisitor::V_FunctionPtrRebind(AST::FunctionPtrRebind *obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->orgptr, Empty());
        for (RvaluePtrs::iterator itr = obj->bound_parameters.begin(); itr != obj->bound_parameters.end(); ++itr)
          if (*itr)
            Visit(*itr, Empty());
}

void TreeCopyingVisitor::V_InitializeStatement(AST::InitializeStatement *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_LoopStatement(AST::LoopStatement *obj, Empty)
{
        obj = Clone(obj);

        if (obj->precondition) Visit(obj->precondition, Empty());
        if (obj->loopincrementer) Visit(obj->loopincrementer, Empty());
        Visit(obj->loop, Empty());
}
void TreeCopyingVisitor::V_Lvalue(AST::Lvalue *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_LvalueSet(AST::LvalueSet *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->clvalue.base, Empty());
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr) Visit(it->expr, Empty());
        Visit(obj->value, Empty());
}
void TreeCopyingVisitor::V_Module(AST::Module *obj, Empty)
{
        obj = Clone(obj);

        std::for_each(obj->functions.begin(), obj->functions.end(), GetVisitorFunctor(this, Empty()));
}
void TreeCopyingVisitor::V_Node(AST::Node *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_RecordCellSet(AST::RecordCellSet *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->record, Empty());
        Visit(obj->value, Empty());
}

void TreeCopyingVisitor::V_ObjectExtend(AST::ObjectExtend *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->object, Empty());
        for (auto &itr: obj->parameters)
            Visit(itr, Empty());
}

void TreeCopyingVisitor::V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->object, Empty());
}

void TreeCopyingVisitor::V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->object, Empty());
        Visit(obj->value, Empty());
}

void TreeCopyingVisitor::V_ObjectMemberSet(AST::ObjectMemberSet*obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->object, Empty());
        Visit(obj->value, Empty());
}

void TreeCopyingVisitor::V_RecordCellDelete(AST::RecordCellDelete *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->record, Empty());
}
void TreeCopyingVisitor::V_RecordColumnConst(AST::RecordColumnConst *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->record, Empty());
}
void TreeCopyingVisitor::V_ObjectMemberConst(AST::ObjectMemberConst*obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->object, Empty());
}
void TreeCopyingVisitor::V_ObjectMethodCall(AST::ObjectMethodCall *obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->object, Empty());
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}
void TreeCopyingVisitor::V_ObjectTypeUID(AST::ObjectTypeUID *obj, Empty)
{
        obj = Clone(obj);
}
void TreeCopyingVisitor::V_ReturnStatement(AST::ReturnStatement *obj, Empty)
{
        obj = Clone(obj);
        if (obj->returnvalue)
            Visit(obj->returnvalue,Empty());
}
void TreeCopyingVisitor::V_Rvalue(AST::Rvalue *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_SchemaTable(AST::SchemaTable *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->schema, Empty());
}
void TreeCopyingVisitor::V_SQL(AST::SQL *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_SQLDataModifier(AST::SQLDataModifier *obj, Empty)
{
        obj = Clone(obj);

        std::for_each(obj->values.begin(), obj->values.end(), GetVisitorFunctor(this, Empty()));
}
void TreeCopyingVisitor::V_SQLDelete(AST::SQLDelete *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->sources, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}
void TreeCopyingVisitor::V_SQLSelect(AST::SQLSelect *obj, Empty)
{
        obj = Clone(obj);

        if (obj->limit_expr) Visit(obj->limit_expr, Empty());
        Visit(obj->sources, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
        for(std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin();
            it != obj->temporaries.end(); ++it)
            Visit(it->expr, Empty());
        for(std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin();
            it != obj->namedselects.end(); ++it)
            if (it->expr)
                Visit(it->expr, Empty());
        for(std::vector<std::pair<Rvalue*, bool> >::iterator it = obj->orderings.begin();
            it != obj->orderings.end(); ++it)
            Visit(it->first, Empty());
        for(std::vector<std::pair<Rvalue*, bool> >::iterator it = obj->orderings.begin();
            it != obj->orderings.end(); ++it)
            Visit(it->first, Empty());
        for(std::vector< Rvalue * >::iterator it = obj->groupings.begin();
            it != obj->groupings.end(); ++it)
            Visit(*it, Empty());
        if (obj->having_expr) Visit(obj->having_expr, Empty());

}
void TreeCopyingVisitor::V_SQLSource(AST::SQLSource *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->expression, Empty());
        if (obj->reassign)
            Visit(obj->reassign, Empty());
}
void TreeCopyingVisitor::V_SQLSources(AST::SQLSources *obj, Empty)
{
        obj = Clone(obj);

        std::for_each(obj->sources.begin(), obj->sources.end(), GetVisitorFunctor(this, Empty()));
}
void TreeCopyingVisitor::V_SQLInsert(AST::SQLInsert *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->source, Empty());
        Visit(obj->modifier, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}
void TreeCopyingVisitor::V_SQLUpdate(AST::SQLUpdate *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->source, Empty());
        Visit(obj->modifier, Empty());
        if (obj->location.expr) Visit(obj->location.expr, Empty());
}
void TreeCopyingVisitor::V_SingleExpression(AST::SingleExpression *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->expr, Empty());
}
void TreeCopyingVisitor::V_Statement(AST::Statement *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_SwitchStatement(AST::SwitchStatement *obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->value, Empty());
        if (obj->defaultcase) Visit(obj->defaultcase, Empty());
        for (AST::SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                    Visit(*it2, Empty());
                Visit(it->second, Empty());
        }
}
void TreeCopyingVisitor::V_TryCatchStatement(AST::TryCatchStatement *obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->tryblock, Empty());
        Visit(obj->catchblock, Empty());
}
void TreeCopyingVisitor::V_TryFinallyStatement(AST::TryFinallyStatement *obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->tryblock, Empty());
        Visit(obj->finallyblock, Empty());
}
void TreeCopyingVisitor::V_TypeInfo(AST::TypeInfo *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_UnaryOperator(AST::UnaryOperator *obj, Empty)
{
        obj = Clone(obj);

        Visit(obj->lhs, Empty());
}
void TreeCopyingVisitor::V_Variable(AST::Variable *obj, Empty)
{
        Clone(obj);
}
void TreeCopyingVisitor::V_Yield(AST::Yield *obj, Empty)
{
        obj = Clone(obj);
        Visit(obj->generator, Empty());
        Visit(obj->yieldexpr, Empty());
}


} // End of namespace AST
} // End of namespace Compiler
} // End of namespace HareScript
