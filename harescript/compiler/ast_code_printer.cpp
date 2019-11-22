//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/stream.h>

#include "ast_code_printer.h"
#include "../vm/hsvm_constants.h"
#include "debugprints.h"
#include <cstdio>

//#define OUTPUT_ASTNODENAMES

#ifdef OUTPUT_ASTNODENAMES
#define NODENAMEPRINT(x) stream->WriteString("@" x " ")
#else
#define NODENAMEPRINT(x) (void)0
#endif


namespace HareScript
{
namespace Compiler
{

using namespace AST;

void AstCodePrinter::Visit(AST::Node* node)
{
        if (node)
            AST::NodeVisitor<void, Empty>::Visit(node, Empty());
}

AstCodePrinter::AstCodePrinter(CompilerContext &_context)
: context(_context)
, vuanalyzer(0)
{
}

AstCodePrinter::~AstCodePrinter()
{
}

void AstCodePrinter::SetVUAnalyzer(ASTVariabeleUseAnalyzer const *_vuanalyzer)
{
        vuanalyzer = _vuanalyzer;
}

void AstCodePrinter::OutputLocation(AST::ArrayLocation &location)
{
        switch (location.type)
        {
        case AST::ArrayLocation::Missing:
                return;
        case AST::ArrayLocation::End:
                stream->WriteString(" AT END");
                return;
        case AST::ArrayLocation::All:
                stream->WriteString(" ALL");
                return;
        case AST::ArrayLocation::Index:
                stream->WriteString(" AT ");
                Visit(location.expr);
                return;
        case AST::ArrayLocation::Where:
                stream->WriteString(" WHERE ");
                Visit(location.expr);
                return;
        default: ;
        }
        stream->WriteString("???");
        return;
}

struct OStreamWriter: public Blex::Stream
{
    private:
        std::ostream &ostr;

    public:
        OStreamWriter(std::ostream &ostr) : Stream(true), ostr(ostr) {}

        std::size_t Read(void *, std::size_t) { return 0; }
        bool EndOfStream() { return true; }
        std::size_t Write(void const *buf, std::size_t bufsize)
        {
                ostr.write((const char *)buf, bufsize);
                return bufsize;
        }
};

void AstCodePrinter::DumpExpression(std::ostream &ostr, AST::Rvalue *expr)
{
        OStreamWriter str(ostr);
        indent = 0;
        stream.reset(new Blex::BufferedStream(str, 65536));
        Visit(expr);
        stream.reset();
}

void AstCodePrinter::OutputASTCode(AST::Module *module, Blex::Stream &output, TypeStorage const &tstorage)
{
        typestorage = tstorage;
        stream.reset(new Blex::BufferedStream(output, 65536));
        stream->WriteString("<?wh\n");

        for (std::vector<SymbolDefs::Library *>::iterator it = module->loadlibs.begin(); it != module->loadlibs.end(); ++it)
            if (!(*it)->indirect)
                stream->WriteString("LOADLIB \"" + (*it)->liburi + "\";\n");

        indent = 0;

        Visit(module);
        stream.reset(NULL);
}

void AstCodePrinter::V_ArrayDelete(ArrayDelete *arraydelete, Empty)
{
        NODENAMEPRINT("ArrayDelete");
        stream->WriteString("DELETE FROM ");
        Visit(arraydelete->array);
        OutputLocation(arraydelete->location);
        stream->WriteString(";");
}

void AstCodePrinter::V_ArrayElementConst(ArrayElementConst *arrayelementconst, Empty)
{
        NODENAMEPRINT("ArrayElementConst");
        Visit(arrayelementconst->array);
        stream->WriteString("[");
        Visit(arrayelementconst->index);
        stream->WriteString("]");
}
void AstCodePrinter::V_ArrayElementModify(ArrayElementModify *arrayelementmodify, Empty)
{
        NODENAMEPRINT("ArrayElementModify");
        Visit(arrayelementmodify->array);
        stream->WriteString("[");
        Visit(arrayelementmodify->index);
        stream->WriteString("] := ");
        Visit(arrayelementmodify->value);
        stream->WriteString(";");
}
void AstCodePrinter::V_ArrayInsert(ArrayInsert *obj, Empty)
{
        NODENAMEPRINT("ArrayInsert");
        stream->WriteString("INSERT ");
        Visit(obj->value);
        stream->WriteString(" INTO ");
        Visit(obj->array);
        OutputLocation(obj->location);
        stream->WriteString(";");
}

void AstCodePrinter::V_Assignment(Assignment *obj, Empty)
{
        NODENAMEPRINT("Assignment");
        Visit(obj->target);
        stream->WriteString(" := ");
        Visit(obj->source);
}

void AstCodePrinter::V_BinaryOperator(BinaryOperator *obj, Empty)
{
        NODENAMEPRINT("BinaryOperator");
        Visit(obj->lhs);
        stream->WriteString(" " + EncodeString(BinaryOperatorType::ToSTLStr(obj->operation)) + " ");
        Visit(obj->rhs);
}
void AstCodePrinter::V_Block(Block *block, Empty)
{
        NODENAMEPRINT("Block");
        stream->WriteString("{\n");
        ++indent;
        for (std::vector<Statement*>::iterator it = block->statements.begin(); it != block->statements.end(); ++it)
        {
                for (unsigned i = 0; i != indent; ++i)
                  stream->WriteString("  ");
                Visit(*it);
                stream->WriteString("\n");
        }
        --indent;
        for (unsigned i = 0; i != indent; ++i)
            stream->WriteString("  ");
        stream->WriteString("}");
}
void AstCodePrinter::V_BreakStatement(BreakStatement *, Empty)
{
        NODENAMEPRINT("Break");
        stream->WriteString("BREAK;");
}
void AstCodePrinter::V_BuiltinInstruction(BuiltinInstruction *obj, Empty)
{
        NODENAMEPRINT("BuiltinInstruction");
        stream->WriteString(obj->name + "(");
        for (unsigned i = 0; i<obj->parameters.size(); ++i)
        {
                if (i!=0) stream->WriteString(", ");
                Visit(obj->parameters[i]);
        }
        stream->WriteString(")");
}
void AstCodePrinter::V_Cast(Cast *obj, Empty)
{
        NODENAMEPRINT("Cast");
        stream->WriteString("((" + GetTypeName(obj->to_type) + ")");
        Visit(obj->expr);
        stream->WriteString(")");
}
void AstCodePrinter::V_ConditionalOperator(ConditionalOperator *obj, Empty)
{
        NODENAMEPRINT("ConditionalOperator");
        Visit(obj->condition);
        stream->WriteString("?");
        Visit(obj->expr_true);
        stream->WriteString(":");
        Visit(obj->expr_false);
}
void AstCodePrinter::V_ConditionalStatement(ConditionalStatement *obj, Empty)
{
        NODENAMEPRINT("ConditionalStatement");
        stream->WriteString("IF (");
        Visit(obj->condition);
        stream->WriteString(")\n");
        ++indent;
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        Visit(obj->stat_true);
        if (obj->stat_false)
        {
                stream->WriteString("\n");
                for (unsigned i = 1; i != indent; ++i)
                  stream->WriteString("  ");
                stream->WriteString("ELSE\n");
                for (unsigned i = 0; i != indent; ++i)
                  stream->WriteString("  ");
                Visit(obj->stat_false);
        }
        --indent;
}
void AstCodePrinter::V_Constant(Constant *constant, Empty)
{
        NODENAMEPRINT("Constant");
        stream->WriteString(EncodeVariable(context, constant->var, true));
}
void AstCodePrinter::V_ConstantRecord(AST::ConstantRecord *constantrecord, Empty)
{
        NODENAMEPRINT("ConstantRecord");
        stream->WriteString("CR:[");
        for (unsigned idx = 0; idx < constantrecord->columns.size(); ++idx)
        {
                if (idx != 0) stream->WriteString(", ");
                switch (std::get<0>(constantrecord->columns[idx]))
                {
                    case AST::ConstantRecord::Item:         stream->WriteString(std::get<1>(constantrecord->columns[idx]) + " := "); break;
                    case AST::ConstantRecord::Ellipsis:     stream->WriteString("..."); break;
                    case AST::ConstantRecord::Delete:       stream->WriteString("DELETE " + std::get<1>(constantrecord->columns[idx])); break;
                    default: ;
                }
                if (std::get<0>(constantrecord->columns[idx]) != AST::ConstantRecord::Delete)
                    Visit(std::get<2>(constantrecord->columns[idx]));
        }
        stream->WriteString("]");
}
void AstCodePrinter::V_ConstantArray(AST::ConstantArray *constantarray, Empty)
{
        NODENAMEPRINT("ConstantRecord");
        stream->WriteString("CA:[");
        for (auto it = constantarray->values.begin(); it != constantarray->values.end(); ++it)
        {
                if (it != constantarray->values.begin())
                    stream->WriteString(", ");
                if (std::get<2>(*it))
                    stream->WriteString("...");
                Visit(std::get<1>(*it));
        }
        stream->WriteString("]");
}
void AstCodePrinter::V_ContinueStatement(ContinueStatement *, Empty)
{
        NODENAMEPRINT("ContinueStatement");
        stream->WriteString("CONTINUE;");
}
void AstCodePrinter::V_DeepOperation(AST::DeepOperation *, Empty)
{
}
void AstCodePrinter::V_DeepArrayDelete(AST::DeepArrayDelete *deeparraydelete, Empty)
{
        NODENAMEPRINT("DeepArrayDelete");
        stream->WriteString("DELETE FROM ");

        if (deeparraydelete->clvalue.basevar)
            stream->WriteString("/*" + deeparraydelete->clvalue.basevar->name + "=*/");
        else
            stream->WriteString("/*-nobasevar-*/");
        Visit(deeparraydelete->clvalue.base);
        stream->WriteString("/*baseend*/");

        for (LvalueLayers::iterator it = deeparraydelete->clvalue.layers.begin(); it != deeparraydelete->clvalue.layers.end(); ++it)
        {
                if (it->type == LvalueLayer::Array)
                {
                         stream->WriteString("[");
                         Visit(it->expr);
                         stream->WriteString("]");
                }
                else if (it->type == LvalueLayer::Record)
                    stream->WriteString("." + it->name);
                else
                {
                        if (it->is_member)
                            stream->WriteString("->/*member*/" + it->name);
                        else
                            stream->WriteString("->" + it->name);
                }
        }
        OutputLocation(deeparraydelete->location);
}
void AstCodePrinter::V_DeepArrayInsert(AST::DeepArrayInsert *deeparrayinsert, Empty)
{
        NODENAMEPRINT("DeepArrayInsert");
        stream->WriteString("INSERT ");
        Visit(deeparrayinsert->value);
        stream->WriteString(" INTO ");

        if (deeparrayinsert->clvalue.basevar)
            stream->WriteString("/*" + deeparrayinsert->clvalue.basevar->name + "=*/");
        else
            stream->WriteString("/*-nobasevar-*/");
        Visit(deeparrayinsert->clvalue.base);
        stream->WriteString("/*baseend*/");

        for (LvalueLayers::iterator it = deeparrayinsert->clvalue.layers.begin(); it != deeparrayinsert->clvalue.layers.end(); ++it)
        {
                if (it->type == LvalueLayer::Array)
                {
                         stream->WriteString("[");
                         Visit(it->expr);
                         stream->WriteString("]");
                }
                else if (it->type == LvalueLayer::Record)
                    stream->WriteString("." + it->name);
                else
                    stream->WriteString("->" + it->name);
        }
        OutputLocation(deeparrayinsert->location);
}
void AstCodePrinter::V_End(End *, Empty)
{
        NODENAMEPRINT("End");
        stream->WriteString("END");
}
void AstCodePrinter::V_ExpressionBlock(AST::ExpressionBlock *expressionblock, Empty)
{
        NODENAMEPRINT("ExpressionBlock");
        Visit(expressionblock->block);
        stream->WriteString("(RETURNS ");
        Visit(expressionblock->returnvar);
        stream->WriteString(")");
}
void AstCodePrinter::V_ForEveryStatement(AST::ForEveryStatement *obj, Empty)
{
        NODENAMEPRINT("ForEveryStatement");
        stream->WriteString("FOREVERY (");
        Visit(obj->iteratevar);
        stream->WriteString(" FROM ");
        Visit(obj->source);
        stream->WriteString(")\n");
        ++indent;
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        Visit(obj->loop);
        --indent;
}

void AstCodePrinter::V_Function(Function *function, Empty)
{
        NODENAMEPRINT("Function");
        stream->WriteString("\n");

        SymbolDefs::FunctionDef &functiondef = *function->symbol->functiondef;

        if (functiondef.returntype == VariableTypes::NoReturn)
            stream->WriteString("MACRO ");
        else
            stream->WriteString(GetTypeName(functiondef.returntype)+" FUNCTION ");

        if (functiondef.object)
            stream->WriteString(functiondef.object->name + "::");
        stream->WriteString(function->symbol->name + "(");

        for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it2 = functiondef.arguments.begin(); it2 != functiondef.arguments.end(); ++it2)
        {
                if (it2 != functiondef.arguments.begin())
                    stream->WriteString(", ");

                stream->WriteString(GetTypeName(it2->symbol->variabledef->type)+" "+it2->symbol->name);

                if (it2->value)
                {
                        stream->WriteString(" DEFAULT ");
                        Visit(it2->value);
                }
        }
        stream->WriteString(")\n");

        if (vuanalyzer)
        {
                std::map< Symbol *, ASTVariabeleUseAnalyzer::FunctionData >::const_iterator it = vuanalyzer->data.find(function->symbol);
                if (it != vuanalyzer->data.end())
                {
                        ASTVariabeleUseAnalyzer::FunctionData const &data = it->second;

                        stream->WriteString("// Used symbols: ");
                        for (std::vector<Symbol *>::const_iterator begin = data.usedsymbols.begin(), end = data.usedsymbols.end(), it = begin; it != end; ++it)
                            stream->WriteString((it == begin ? "" : ", ") + (*it)->name);
                        stream->WriteString("\n");

                        stream->WriteString("// Defd symbols: ");
                        for (std::vector<Symbol *>::const_iterator begin = data.defdsymbols.begin(), end = data.defdsymbols.end(), it = begin; it != end; ++it)
                            stream->WriteString((it == begin ? "" : ", ") + (*it)->name);
                        stream->WriteString("\n");
                }
        }

        Visit(function->block);
        stream->WriteString("\n");
}

void AstCodePrinter::V_FunctionCall(FunctionCall *functioncall, Empty)
{
        NODENAMEPRINT("FunctionCall");
        if (functioncall->symbol->functiondef && functioncall->symbol->functiondef->object)
            stream->WriteString(functioncall->symbol->functiondef->object->name + "::");
        stream->WriteString(functioncall->symbol->name + "(");
        for (unsigned i = 0; i<functioncall->parameters.size(); ++i)
        {
                if (i!=0) stream->WriteString(", ");
                Visit(functioncall->parameters[i]);
        }
        stream->WriteString(")");
}
void AstCodePrinter::V_FunctionPtr(FunctionPtr *functionptr, Empty)
{
        NODENAMEPRINT("FunctionPtr");
        stream->WriteString("PTR " + functionptr->function->name);
        if (functionptr->parameters_specified)
        {
                stream->WriteString("(");
                for (unsigned i = 0; i<functionptr->passthrough_parameters.size(); ++i)
                {
                        if (i!=0) stream->WriteString(", ");
                        if (functionptr->passthrough_parameters[i])
                        {
                                stream->WriteString("#" + Blex::AnyToString(functionptr->passthrough_parameters[i]));
                                if (functionptr->bound_parameters[i])
                                {
                                        stream->WriteString(" DEFAULTSTO ");
                                        Visit(functionptr->bound_parameters[i]);
                                }
                        }
                        else
                            Visit(functionptr->bound_parameters[i]);
                }
                stream->WriteString(")");
        }
}

void AstCodePrinter::V_FunctionPtrCall(FunctionPtrCall *functionptrcall, Empty)
{
        NODENAMEPRINT("FunctionPtrCall");
        stream->WriteString("(");
        Visit(functionptrcall->functionptr);
        stream->WriteString(")(");
        for (unsigned i = 0; i<functionptrcall->params.size(); ++i)
        {
                if (i != 0)
                    stream->WriteString(", ");
                Visit(functionptrcall->params[i]);
        }
        stream->WriteString(")");
}
void AstCodePrinter::V_FunctionPtrRebind(FunctionPtrRebind *functionptr, Empty)
{
        NODENAMEPRINT("FunctionPtrRebind");
        stream->WriteString("PTR ");
        Visit(functionptr->orgptr);
        stream->WriteString("(");
        for (unsigned i = 0; i<functionptr->passthrough_parameters.size(); ++i)
        {
                if (i!=0) stream->WriteString(", ");
                if (functionptr->passthrough_parameters[i])
                {
                        stream->WriteString("#" + Blex::AnyToString(functionptr->passthrough_parameters[i]));
                        if (functionptr->bound_parameters[i])
                        {
                                stream->WriteString(" DEFAULTSTO ");
                                Visit(functionptr->bound_parameters[i]);
                        }
                }
                else
                    Visit(functionptr->bound_parameters[i]);
        }
        stream->WriteString(")");
}

void AstCodePrinter::V_InitializeStatement(InitializeStatement *obj, Empty)
{
        NODENAMEPRINT("InitializeStatement");
        stream->WriteString(GetTypeName(obj->symbol->variabledef->type)+" "+obj->symbol->name + ";");
}

void AstCodePrinter::V_LoopStatement(LoopStatement *obj, Empty)
{
        NODENAMEPRINT("LoopStatement");
        stream->WriteString("FOR (;");
        Visit(obj->precondition);
        stream->WriteString(";");
        Visit(obj->loopincrementer);
        stream->WriteString(")\n");

        ++indent;
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        Visit(obj->loop);
        --indent;
}
void AstCodePrinter::V_Lvalue(Lvalue *, Empty)
{
        stream->WriteString("**VISTING ERROR**");
}
void AstCodePrinter::V_LvalueSet(LvalueSet *lvalueset, Empty)
{
        NODENAMEPRINT("LvalueSet");
        if (lvalueset->clvalue.basevar)
            stream->WriteString("/*" + lvalueset->clvalue.basevar->name + "=*/");
        else
            stream->WriteString("/*-nobasevar-*/");
        Visit(lvalueset->clvalue.base);
        stream->WriteString("/*baseend*/");

//        stream->WriteString(lvalueset->var->name);
        for (LvalueLayers::iterator it = lvalueset->clvalue.layers.begin(); it != lvalueset->clvalue.layers.end(); ++it)
        {
                if (it->type == LvalueLayer::Array)
                {
                         stream->WriteString("[");
                         Visit(it->expr);
                         stream->WriteString("]");
                }
                else if (it->type == LvalueLayer::Record)
                    stream->WriteString("." + it->name);
                else
                    stream->WriteString("->" + it->name);
        }
        stream->WriteString(" := ");
        Visit(lvalueset->value);
}
void AstCodePrinter::V_Module(Module *module, Empty)
{
        NODENAMEPRINT("Module");
        for (std::vector<Function*>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            Visit(*it);
}
void AstCodePrinter::V_Node(Node *, Empty)
{
        stream->WriteString("**VISTING ERROR**");
}
void AstCodePrinter::V_RecordCellSet(RecordCellSet *obj, Empty)
{
        NODENAMEPRINT("RecordCellSet");
        stream->WriteString("RECORDCELLSET(");
        Visit(obj->record);
        stream->WriteString(", ");
        stream->WriteString(obj->name);
        stream->WriteString(", ");
        Visit(obj->value);
        stream->WriteString(")");
}
void AstCodePrinter::V_RecordColumnConst(RecordColumnConst*obj, Empty)
{
        NODENAMEPRINT("RecordColumnConst");
        Visit(obj->record);
        stream->WriteString("."+obj->name);
}
void AstCodePrinter::V_ObjectExtend(AST::ObjectExtend *obj, Empty)
{
        NODENAMEPRINT("ObjectExtend");
        stream->WriteString("EXTEND ");
        Visit(obj->object);
        stream->WriteString(" BY ");
        stream->WriteString(obj->extendwith->name+"(");
        for (auto it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
        {
            if (it != obj->parameters.begin())
                stream->WriteString(", ");
            Visit(*it);
        }
}

void AstCodePrinter::V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty)
{
        NODENAMEPRINT("ObjectMemberDelete");
        stream->WriteString("DELETE MEMBER ");
        stream->WriteString(obj->name);
        stream->WriteString(" FROM ");
        Visit(obj->object);
        stream->WriteString(";");
        stream->WriteString(obj->via_this ? " (via this)" : "");
}

void AstCodePrinter::V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty)
{
        NODENAMEPRINT("ObjectMemberInsert");
        stream->WriteString(std::string("INSERT ") + (obj->is_private ? "PRIVATE" : "PUBLIC") + " MEMBER ");
        stream->WriteString(obj->name);
        stream->WriteString(" := ");
        Visit(obj->value);
        stream->WriteString(" INTO ");
        Visit(obj->object);
        stream->WriteString(";");
        stream->WriteString(obj->via_this ? " (via this)" : "");
}

void AstCodePrinter::V_ObjectMemberSet(ObjectMemberSet *obj, Empty)
{
        NODENAMEPRINT("ObjectMemberSet");
        stream->WriteString("OBJECTMEMBERSET(");
        Visit(obj->object);
        stream->WriteString(", " + obj->name + ", ");
        Visit(obj->value);
        stream->WriteString(");");
        stream->WriteString(obj->via_this ? " (via this)" : "");
}
void AstCodePrinter::V_RecordCellDelete(RecordCellDelete *obj, Empty)
{
        NODENAMEPRINT("RecordCellDelete");
        stream->WriteString("RECORDCELLDELETE(");
        Visit(obj->record);
        stream->WriteString(", ");
        stream->WriteString(obj->name);
        stream->WriteString(")");
}
void AstCodePrinter::V_ObjectMemberConst(ObjectMemberConst*obj, Empty)
{
        NODENAMEPRINT("ObjectMemberConst");
        Visit(obj->object);
        stream->WriteString("->"+obj->name);
        stream->WriteString(obj->via_this ? "/*via this*/" : "");
}
void AstCodePrinter::V_ObjectMethodCall(AST::ObjectMethodCall *obj, Empty)
{
        NODENAMEPRINT("ObjectMethodCall");
        Visit(obj->object);
        stream->WriteString("->"+obj->membername+"(");
        for (unsigned i = 0; i<obj->parameters.size(); ++i)
        {
                if (i!=0) stream->WriteString(", ");
                Visit(obj->parameters[i]);
        }
        stream->WriteString(")");
}
void AstCodePrinter::V_ObjectTypeUID(AST::ObjectTypeUID *obj, Empty)
{
        NODENAMEPRINT("ObjectTypeUID");
        stream->WriteString("OBJECTTYPENAME("+obj->objtype->name+")");
}
void AstCodePrinter::V_ReturnStatement(ReturnStatement *returnstatement, Empty)
{
        NODENAMEPRINT("ReturnStatement");
        stream->WriteString("RETURN");
        if (returnstatement->returnvalue)
        {
                stream->WriteString(" ");
                Visit(returnstatement->returnvalue);
        }
        stream->WriteString(";");
}
void AstCodePrinter::V_Rvalue(Rvalue *, Empty)
{
        stream->WriteString("**VISTING ERROR**");
}
void AstCodePrinter::V_SchemaTable(SchemaTable *obj, Empty)
{
        NODENAMEPRINT("SchemaTable");
        Visit(obj->schema);
        stream->WriteString("."+obj->name);
}

void AstCodePrinter::V_SingleExpression(SingleExpression *obj, Empty)
{
        NODENAMEPRINT("SingleExpression");
        Visit(obj->expr);
        stream->WriteString(";");
}

void AstCodePrinter::V_Statement(Statement *, Empty)
{
}

void AstCodePrinter::V_SwitchStatement(AST::SwitchStatement *obj, Empty)
{
        NODENAMEPRINT("SwitchStatement");
        stream->WriteString("SWITCH (");
        Visit(obj->value);
        stream->WriteString(")\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        stream->WriteString("{\n");
        ++indent;
        for (AST::SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (unsigned i = 0; i != indent; ++i)
                    stream->WriteString("  ");
                stream->WriteString("CASE ");

                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                {
                        if (it2 != it->first.begin())
                            stream->WriteString(", ");
                        Visit(*it2);
                }
                stream->WriteString("\n");
                for (unsigned i = 0; i != indent; ++i)
                  stream->WriteString("  ");
                Visit(it->second);
                stream->WriteString("\n");
        }
        if (obj->defaultcase)
        {
                for (unsigned i = 0; i != indent; ++i)
                    stream->WriteString("  ");
                stream->WriteString("DEFAULT:");
                ++indent;
                for (unsigned i = 0; i != indent; ++i)
                  stream->WriteString("  ");
                Visit(obj->defaultcase);
                --indent;
        }
        --indent;
        for (unsigned i = 0; i != indent; ++i)
            stream->WriteString("  ");
        stream->WriteString("}");
}

void AstCodePrinter::V_TryCatchStatement(TryCatchStatement *trycatchstatement, Empty)
{
        NODENAMEPRINT("TryCatchStatement");
        stream->WriteString("TRY\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
//        stream->WriteString("{\n");
//        ++indent;
        Visit(trycatchstatement->tryblock);
//        --indent;
//        for (unsigned i = 0; i != indent; ++i)
//          stream->WriteString("  ");
//        stream->WriteString("}\n");
        stream->WriteString("\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        stream->WriteString("CATCH\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
//        stream->WriteString("{\n");
//        ++indent;
        Visit(trycatchstatement->catchblock);
//        --indent;
//        for (unsigned i = 0; i != indent; ++i)
//          stream->WriteString("  ");
//        stream->WriteString("}");
}

void AstCodePrinter::V_TryFinallyStatement(TryFinallyStatement *tryfinallystatement, Empty)
{
        NODENAMEPRINT("TryFinallyStatement");
        stream->WriteString("TRY\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        Visit(tryfinallystatement->tryblock);
        stream->WriteString("\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        stream->WriteString("FINALLY\n");
        for (unsigned i = 0; i != indent; ++i)
          stream->WriteString("  ");
        Visit(tryfinallystatement->finallyblock);
}

void AstCodePrinter::V_TypeInfo(TypeInfo *typeinfo, Empty)
{
        NODENAMEPRINT("TypeInfo");
        if (typeinfo->symbol)
            stream->WriteString("TYPEINFO("+typeinfo->symbol->name+")");
        else
            stream->WriteString("TYPEINFO(*EMPTY*)");
}

void AstCodePrinter::V_UnaryOperator(UnaryOperator *unaryoperator, Empty)
{
        NODENAMEPRINT("UnaryOperator");
        stream->WriteString(UnaryOperatorType::ToSTLStr(unaryoperator->operation));
        stream->WriteString(" ");
        Visit(unaryoperator->lhs);
}

void AstCodePrinter::V_Variable(Variable *variable, Empty)
{
        NODENAMEPRINT("Variable");
        stream->WriteString("((*");
        stream->WriteString(GetTypeName(variable->symbol->variabledef->type));
        stream->WriteString("*)");
        stream->WriteString(variable->symbol->name);
        stream->WriteString(")");
}

void AstCodePrinter::V_Yield(Yield *obj, Empty)
{
        NODENAMEPRINT("Yield");
        if (obj->isawait)
            stream->WriteString("AWAIT (");
        else
            stream->WriteString(obj->star ? "YIELD* (" : "YIELD (");
        Visit(obj->generator);
        stream->WriteString(", ");
        Visit(obj->yieldexpr);
        stream->WriteString(")");
}

void AstCodePrinter::V_SQL(SQL *, Empty)
{
}

void AstCodePrinter::V_SQLDataModifier(SQLDataModifier * sqldatamodifier, Empty)
{
        NODENAMEPRINT("SQLDataModifier");
        stream->WriteString("(");
        unsigned i = 0;
        for (std::vector<std::string>::iterator it = sqldatamodifier->columns.begin(); it != sqldatamodifier->columns.end(); ++it, ++i)
        {
                if (i != 0)
                    stream->WriteString(", ");
                stream->WriteString(*it + " := ");
                Visit(sqldatamodifier->values[i]);
        }
        stream->WriteString(")");
}

void AstCodePrinter::V_SQLDelete(SQLDelete * sqldelete, Empty)
{
        NODENAMEPRINT("SQLDelete");
        stream->WriteString("DELETE FROM ");
        Visit(sqldelete->sources);
        OutputLocation(sqldelete->location);
        stream->WriteString(";");
}

void AstCodePrinter::V_SQLInsert(SQLInsert * sqlinsert, Empty)
{
        NODENAMEPRINT("SQLInsert");
        stream->WriteString("INSERT INTO ");
        Visit(sqlinsert->source);
        stream->WriteString("(");
        for (std::vector<std::string>::iterator it = sqlinsert->modifier->columns.begin(); it != sqlinsert->modifier->columns.end(); ++it)
        {
                if (it != sqlinsert->modifier->columns.begin())
                    stream->WriteString(", ");
                stream->WriteString(*it);
        }
        stream->WriteString(") VALUES (");
        for (std::vector<Rvalue *>::iterator it = sqlinsert->modifier->values.begin(); it != sqlinsert->modifier->values.end(); ++it)
        {
                if (it != sqlinsert->modifier->values.begin())
                    stream->WriteString(", ");
                Visit(*it);
        }
        stream->WriteString(")");
        OutputLocation(sqlinsert->location);
        stream->WriteString(";");
}

void AstCodePrinter::V_SQLSelect(SQLSelect *obj, Empty)
{
        NODENAMEPRINT("SQLSelect");
        stream->WriteString("SELECT ");
        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin(); it != obj->temporaries.end(); ++it)
        {
                if (it != obj->temporaries.begin())
                    stream->WriteString(", ");
                stream->WriteString("TEMPORARY ");
                stream->WriteString(it->symbol->name);
                stream->WriteString(" := ");
                Visit(it->expr);
        }
        for (std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin(); it != obj->namedselects.end(); ++it)
        {
                if (it != obj->namedselects.begin() || !obj->temporaries.empty())
                    stream->WriteString(", ");
                if (it->is_delete)
                    stream->WriteString("DELETE " + it->name);
                if (it->is_spread)
                {
                        stream->WriteString("...");
                        Visit(it->expr);
                }
                else
                {
                        Visit(it->expr);
                        if (it->is_star)
                            stream->WriteString(".*");
                        if (it->name != "")
                            stream->WriteString(" AS " + it->name);
                }
        }
        if (!obj->namedselects.empty())
            stream->WriteString(" ");

        stream->WriteString("FROM ");
        Visit(obj->sources);
        OutputLocation(obj->location);

        if (!obj->groupings.empty())
        {
                stream->WriteString(" GROUP BY ");
                for (std::vector< Rvalue * >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it)
                {
                        if (it != obj->groupings.begin())
                            stream->WriteString(", ");
                        Visit(*it);
                }
        }
        else if (obj->is_grouped || obj->is_grouped_afterall)
        {
                stream->WriteString(" GROUP BY (1)");
        }

        if (obj->having_expr)
        {
                stream->WriteString(" HAVING ");
                Visit(obj->having_expr);
        }

        if (!obj->orderings.empty())
        {
                stream->WriteString(" ORDER BY ");
                for (std::vector<std::pair<Rvalue*, bool> >::iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
                {
                        if (it != obj->orderings.begin())
                            stream->WriteString(", ");
                        Visit(it->first);
                        if (it->second)
                            stream->WriteString(" ASC");
                        else
                            stream->WriteString(" DESC");
                }
        }
        if (obj->limit_expr)
        {
                stream->WriteString(" LIMIT ");
                Visit(obj->limit_expr);
        }
}

void AstCodePrinter::V_SQLSource(SQLSource *sqlsource, Empty)
{
        NODENAMEPRINT("SQLSource");
        Visit(sqlsource->expression);
        if (sqlsource->subst_name != "")
            stream->WriteString(" AS " + sqlsource->subst_name);
}

void AstCodePrinter::V_SQLSources(SQLSources * sqlsources, Empty)
{
        NODENAMEPRINT("SQLSources");
        for (unsigned i = 0; i<sqlsources->sources.size(); ++i)
        {
                if (i!=0) stream->WriteString(", ");
                Visit(sqlsources->sources[i]);
        }
}

void AstCodePrinter::V_SQLUpdate(SQLUpdate * sqlupdate, Empty)
{
        NODENAMEPRINT("SQLUpdate");
        stream->WriteString("UPDATE ");
        Visit(sqlupdate->source);
        stream->WriteString(" SET ");
        unsigned i = 0;
        for (std::vector<std::string>::iterator it = sqlupdate->modifier->columns.begin(); it != sqlupdate->modifier->columns.end(); ++it, ++i)
        {
                if (i != 0) stream->WriteString(", ");
                stream->WriteString(*it + " := ");
                Visit(sqlupdate->modifier->values[i]);
        }
        OutputLocation(sqlupdate->location);
}

void OutputASTCode(CompilerContext &context, AST::Module *module, Blex::Stream &output, TypeStorage const &tstorage, ASTVariabeleUseAnalyzer const *vuanalyzer)
{
        AstCodePrinter ast_code_printer(context);
        if (vuanalyzer)
            ast_code_printer.SetVUAnalyzer(vuanalyzer);
        ast_code_printer.OutputASTCode(module,output,tstorage);
}


} // end of namespace HareScript
} // end of namespace Compiler
