//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/stream.h>

#include "ast_dot_printer.h"
#include "../vm/hsvm_constants.h"
#include "debugprints.h"
#include <cstdio>


namespace HareScript
{
namespace Compiler
{

using namespace AST;

void AstDotPrinter::Visit(AST::Node* node)
{
        AST::NodeVisitor<void, Empty>::Visit(node, Empty());
}

std::string GetUnStringedNodeName(void *a)
{
        std::string name = "0x";
        Blex::EncodeNumber(reinterpret_cast<long>(a), 16, std::back_inserter(name));
        return name;
        //return Blex::AnyToString(reinterpret_cast<long>(a));
}

std::string GetNodeName(void *a)
{
        return "\"" + GetUnStringedNodeName(a) + "\"";
}

void AstDotPrinter::OutputStartCode(Blex::Stream *stream, AST::Node *addr, const char *name)
{
        stream->WriteString(GetNodeName(addr) + " [label = \"{<base>" + name + "-"+GetUnStringedNodeName(addr)+" ");

        if (typestorage.Exists(static_cast<Rvalue*>(addr)))
            stream->WriteString(": " + HareScript::GetTypeName(typestorage[static_cast<Rvalue*>(addr)]));

        stream->WriteString(" (" + Blex::AnyToString(addr->position.line) + "," + Blex::AnyToString(addr->position.column) + ") ");
}
void AstDotPrinter::OutputEndCode(Blex::Stream *stream)
{
        stream->WriteString("}\"];\n");
}

#define STARTCODE(name)  OutputStartCode(&*stream, name, #name);
#define ENDCODE  OutputEndCode(&*stream);

void AstDotPrinter::BuildLink(AST::Node* from, AST::Node* to, signed id)
{
        if (to != 0)
        {
                std::string toname = GetNodeName(to);
                stream->WriteString(GetNodeName(from));
                if (id>=0) stream->WriteString(":f"+Blex::AnyToString(id));
                stream->WriteString(" -> "+ toname +";\n");
                if (visited.find(toname) == visited.end())
                {
                        visited.insert(toname);
                        Visit(to);
                }
        }
}

namespace
{

std::string EncodeLocationString(AST::ArrayLocation const &loc)
{
        switch (loc.type)
        {
        case AST::ArrayLocation::Missing: return "missing";
        case AST::ArrayLocation::End: return "at end";
        case AST::ArrayLocation::All: return "all";
        case AST::ArrayLocation::Index: return "at index";
        case AST::ArrayLocation::Where: return "where";
        default: ;
        }
        return "???";
}

} // End of anonymous namespace

AstDotPrinter::AstDotPrinter(CompilerContext &_context)
: context(_context)
{
}

AstDotPrinter::~AstDotPrinter()
{
}

void AstDotPrinter::OutputASTNormal(AST::Node *node, Blex::Stream &output, TypeStorage const &tstorage)
{
        showtype = ASTNormal;
        typestorage = tstorage;
        stream.reset(new Blex::BufferedStream(output, 65536));
        stream->WriteString("digraph structs {\nnode [shape=record,fontname=\"timr____\",fontsize=10];\n");
        Visit(node);
        stream->WriteString("}\n");
        stream.reset(NULL);
}

void AstDotPrinter::V_ArrayDelete(ArrayDelete *arraydelete, Empty)
{
        STARTCODE(arraydelete);
        stream->WriteString(" | {<f0>array | <f1> " + EncodeLocationString(arraydelete->location) + "} ");
        ENDCODE
        BuildLink(arraydelete, arraydelete->array, 0);
        if (arraydelete->location.expr)
            BuildLink(arraydelete, arraydelete->location.expr, 1);
}

void AstDotPrinter::V_ArrayElementConst(ArrayElementConst *arrayelementconst, Empty)
{
        STARTCODE(arrayelementconst);
        stream->WriteString("|{<f0>array | <f1>}");
        ENDCODE
        BuildLink(arrayelementconst, arrayelementconst->array, 0);
        BuildLink(arrayelementconst, arrayelementconst->index, 1);
}
void AstDotPrinter::V_ArrayElementModify(ArrayElementModify *arrayelementmodify, Empty)
{
        STARTCODE(arrayelementmodify);
        stream->WriteString("|{<f0>array |<f1>index |<f2>value}");
        ENDCODE
        BuildLink(arrayelementmodify, arrayelementmodify->array, 0);
        BuildLink(arrayelementmodify, arrayelementmodify->index, 1);
        BuildLink(arrayelementmodify, arrayelementmodify->value, 2);
}
void AstDotPrinter::V_ArrayInsert(ArrayInsert *arrayinsert, Empty)
{
        STARTCODE(arrayinsert);
        stream->WriteString(" | {<f0>array | <f1>" + EncodeLocationString(arrayinsert->location) + " | <f2> value }");
        ENDCODE
        BuildLink(arrayinsert, arrayinsert->array, 0);
        if (arrayinsert->location.expr)
            BuildLink(arrayinsert, arrayinsert->location.expr, 1);
        BuildLink(arrayinsert, arrayinsert->value, 2);
}

void AstDotPrinter::V_Assignment(Assignment *assignment, Empty)
{
        STARTCODE(assignment);
        stream->WriteString("|{<f0>target | <f1>source}");
        ENDCODE
        BuildLink(assignment, assignment->target, 0);
        BuildLink(assignment, assignment->source, 1);
}

void AstDotPrinter::V_BinaryOperator(BinaryOperator *binaryoperator, Empty)
{
        STARTCODE(binaryoperator);
        std::string s = EncodeString(BinaryOperatorType::ToSTLStr(binaryoperator->operation));
        stream->WriteString("|"+s);
        stream->WriteString("|{<f0>lhs | <f1>rhs}");
        ENDCODE
        BuildLink(binaryoperator, binaryoperator->lhs, 0);
        BuildLink(binaryoperator, binaryoperator->rhs, 1);
}
void AstDotPrinter::V_Block(Block *block, Empty)
{
        STARTCODE(block);
        unsigned i = 0;
        stream->WriteString(" | {");
        for (std::vector<Statement*>::iterator it = block->statements.begin(); it != block->statements.end(); ++it)
        {
                if (it != block->statements.begin())
                    stream->WriteString(" |");
                ++i;
                stream->WriteString(" <f"+Blex::AnyToString(i)+">"+Blex::AnyToString(i));
        }
        stream->WriteString(" } ");
        ENDCODE;
        i = 0;
        for (std::vector<Statement*>::iterator it = block->statements.begin(); it != block->statements.end(); ++it)
            BuildLink(block, *it, ++i);
}
void AstDotPrinter::V_BreakStatement(BreakStatement *breakstatement, Empty)
{
        STARTCODE(breakstatement);
        ENDCODE
}

void AstDotPrinter::V_BuiltinInstruction(BuiltinInstruction *builtininstruction, Empty)
{
        STARTCODE(builtininstruction);
        stream->WriteString("|"+builtininstruction->name + "|{");
        for (unsigned i = 0; i<builtininstruction->parameters.size(); ++i)
        {
                if (i!=0) stream->WriteString(" |");
                stream->WriteString(" <f"+Blex::AnyToString(i)+">");
        }
        stream->WriteString("}");
        ENDCODE
        for (unsigned i = 0; i<builtininstruction->parameters.size(); ++i)
            BuildLink(builtininstruction, builtininstruction->parameters[i], i);
}

void AstDotPrinter::V_Cast(Cast *cast, Empty)
{
        STARTCODE(cast);
        stream->WriteString("|{<f0>}");
        ENDCODE
        BuildLink(cast, cast->expr, 0);
}
void AstDotPrinter::V_ConditionalOperator(ConditionalOperator *conditionaloperator, Empty)
{
        STARTCODE(conditionaloperator);
        stream->WriteString("|{<f0>cond | <f1>true |<f2>false}");
        ENDCODE
        BuildLink(conditionaloperator, conditionaloperator->condition, 0);
        BuildLink(conditionaloperator, conditionaloperator->expr_true, 1);
        BuildLink(conditionaloperator, conditionaloperator->expr_false, 2);
}
void AstDotPrinter::V_ConditionalStatement(ConditionalStatement *conditionalstatement, Empty)
{
        STARTCODE(conditionalstatement);
        stream->WriteString("|{<f0>cond | <f1>true |<f2>false}");
        ENDCODE
        BuildLink(conditionalstatement, conditionalstatement->condition, 0);
        if (showtype == ASTNormal)
        {
                BuildLink(conditionalstatement, conditionalstatement->stat_true, 1);
                BuildLink(conditionalstatement, conditionalstatement->stat_false, 2);
        }
}
void AstDotPrinter::V_Constant(Constant *constant, Empty)
{
        STARTCODE(constant);
        stream->WriteString("|" + EncodeVariable(context, constant->var, false));
        ENDCODE
}
void AstDotPrinter::V_ConstantRecord(AST::ConstantRecord *constantrecord, Empty)
{
        STARTCODE(constantrecord);
        stream->WriteString("|{");
        for (unsigned idx = 0; idx < constantrecord->columns.size(); ++idx)
        {
                if (idx != 0) stream->WriteString("|");
                switch (std::get<0>(constantrecord->columns[idx]))
                {
                    case AST::ConstantRecord::Item:         stream->WriteString("<f"+Blex::AnyToString(idx)+">"+std::get<1>(constantrecord->columns[idx])); break;
                    case AST::ConstantRecord::Ellipsis:     stream->WriteString("<f"+Blex::AnyToString(idx)+">..."); break;
                    case AST::ConstantRecord::Delete:       stream->WriteString("DELETE "+std::get<1>(constantrecord->columns[idx])); break;
                    default: ;
                }
        }
        stream->WriteString("}");
        ENDCODE
        for (unsigned idx = 0; idx < constantrecord->columns.size(); ++idx)
            if (std::get<0>(constantrecord->columns[idx]) != AST::ConstantRecord::Delete)
                BuildLink(constantrecord, std::get<2>(constantrecord->columns[idx]), idx);
}
void AstDotPrinter::V_ConstantArray(AST::ConstantArray *constantarray, Empty)
{
        STARTCODE(constantarray);
        stream->WriteString("|{");
        for (unsigned idx = 0; idx < constantarray->values.size(); ++idx)
        {
                if (idx != 0) stream->WriteString("|");
                stream->WriteString("<f"+Blex::AnyToString(idx)+">");
        }
        stream->WriteString("}");
        ENDCODE
        for (unsigned idx = 0; idx < constantarray->values.size(); ++idx)
            BuildLink(constantarray, std::get<1>(constantarray->values[idx]), idx);
}
/*
void AstDotPrinter::V_ConstantBoolean(ConstantBoolean *constantboolean, Empty)
{
        STARTCODE(constantboolean);
        stream->WriteString("|" + std::string(constantboolean->value?"TRUE":"FALSE"));
        ENDCODE
}
void AstDotPrinter::V_ConstantFloat(ConstantFloat *constantfloat, Empty)
{
        STARTCODE(constantfloat);
        char buffer[100]={0}; //initialize to all zeroes
        std::sprintf(buffer, "%f", constantfloat->value);
        stream->WriteString("|");
        stream->WriteString(buffer);
        ENDCODE
}
void AstDotPrinter::V_ConstantInteger(ConstantInteger *constantinteger, Empty)
{
        STARTCODE(constantinteger);
        stream->WriteString("|" + Blex::AnyToString(constantinteger->value));
        ENDCODE
}
void AstDotPrinter::V_ConstantMoney(ConstantMoney *constantmoney, Empty)
{
        STARTCODE(constantmoney);
        stream->WriteString("|" + Blex::AnyToString(constantmoney->value));
        ENDCODE
}
void AstDotPrinter::V_ConstantString(ConstantString *constantstring, Empty)
{
        STARTCODE(constantstring);
        stream->WriteString("|'" + EncodeString(constantstring->value)+"'");
        ENDCODE
} */
void AstDotPrinter::V_ContinueStatement(ContinueStatement *continuestatement, Empty)
{
        STARTCODE(continuestatement);
        ENDCODE
}
void AstDotPrinter::V_DeepOperation(AST::DeepOperation *deepoperation, Empty)
{
        STARTCODE(deepoperation);
        ENDCODE
}
void AstDotPrinter::V_DeepArrayDelete(AST::DeepArrayDelete *deeparraydelete, Empty)
{
        STARTCODE(deeparraydelete);
        stream->WriteString("| { <f0> " + (deeparraydelete->clvalue.basevar ? deeparraydelete->clvalue.basevar->name : ""));
        unsigned idx = 1;
        for (LvalueLayers::iterator it = deeparraydelete->clvalue.layers.begin(); it != deeparraydelete->clvalue.layers.end(); ++it)
        {
                stream->WriteString("|");
                if (it->type == LvalueLayer::Array)
                    stream->WriteString("<f" + Blex::AnyToString(idx++) + "> [ ]");
                else if (it->type == LvalueLayer::Record)
                    stream->WriteString("." + it->name);
                else
                    stream->WriteString(" \\-\\> " + it->name);
        }

        stream->WriteString(" | <f"+Blex::AnyToString(idx)+"> " + EncodeLocationString(deeparraydelete->location) + "}");
        ENDCODE

        BuildLink(deeparraydelete, deeparraydelete->clvalue.base, 0);

        idx = 1;
        for (LvalueLayers::iterator it = deeparraydelete->clvalue.layers.begin(); it != deeparraydelete->clvalue.layers.end(); ++it)
            if (it->type == LvalueLayer::Array)
              BuildLink(deeparraydelete, it->expr, idx++);
        if (deeparraydelete->location.expr)
            BuildLink(deeparraydelete, deeparraydelete->location.expr, idx);
}
void AstDotPrinter::V_DeepArrayInsert(AST::DeepArrayInsert *deeparrayinsert, Empty)
{
        STARTCODE(deeparrayinsert);
        stream->WriteString("| { <f0> " + (deeparrayinsert->clvalue.basevar ? deeparrayinsert->clvalue.basevar->name : ""));
        stream->WriteString("| <f1> value");
        unsigned idx = 2;
        for (LvalueLayers::iterator it = deeparrayinsert->clvalue.layers.begin(); it != deeparrayinsert->clvalue.layers.end(); ++it)
        {
                stream->WriteString("|");
                if (it->type == LvalueLayer::Array)
                    stream->WriteString("<f" + Blex::AnyToString(idx++) + "> [ ]");
                else if (it->type == LvalueLayer::Record)
                    stream->WriteString("." + it->name);
                else
                    stream->WriteString(" \\-\\> " + it->name);
        }

        stream->WriteString(" | <f"+Blex::AnyToString(idx)+"> " + EncodeLocationString(deeparrayinsert->location) + "}");
        ENDCODE

        BuildLink(deeparrayinsert, deeparrayinsert->clvalue.base, 0);
        BuildLink(deeparrayinsert, deeparrayinsert->value, 1);

        idx = 2;
        for (LvalueLayers::iterator it = deeparrayinsert->clvalue.layers.begin(); it != deeparrayinsert->clvalue.layers.end(); ++it)
            if (it->type == LvalueLayer::Array)
              BuildLink(deeparrayinsert, it->expr, idx++);
        if (deeparrayinsert->location.expr)
            BuildLink(deeparrayinsert, deeparrayinsert->location.expr, idx);
}
void AstDotPrinter::V_End(AST::End *end, Empty)
{
        STARTCODE(end);
        stream->WriteString("|END");
        ENDCODE

}
void AstDotPrinter::V_ExpressionBlock(AST::ExpressionBlock *expressionblock, Empty)
{
        STARTCODE(expressionblock);
        stream->WriteString("|{<f0>block | <f1>return}");
        ENDCODE
        BuildLink(expressionblock, expressionblock->block, 0);
        BuildLink(expressionblock, expressionblock->returnvar, 1);
}
void AstDotPrinter::V_ForEveryStatement(AST::ForEveryStatement *foreverystatement, Empty)
{
        STARTCODE(foreverystatement);
        stream->WriteString("|{<f0>var | <f1>source | <f2>loops | <f3>position}");
        ENDCODE
        BuildLink(foreverystatement, foreverystatement->iteratevar, 0);
        BuildLink(foreverystatement, foreverystatement->source, 1);
        BuildLink(foreverystatement, foreverystatement->loop, 2);
        BuildLink(foreverystatement, foreverystatement->positionvar, 3);
}


void AstDotPrinter::V_Function(Function *function, Empty)
{
        if (showtype == ASTNormal)
        {
                STARTCODE(function);
                stream->WriteString(function->symbol->name);
                ENDCODE;
                stream->WriteString(GetNodeName(function)+ " -> "+GetNodeName(function->block)+";\n");
                Visit(function->block);
        }
}
void AstDotPrinter::V_FunctionCall(FunctionCall *functioncall, Empty)
{
        STARTCODE(functioncall);
        stream->WriteString("|"+functioncall->symbol->name + "|{");
        for (unsigned i = 0; i<functioncall->parameters.size(); ++i)
        {
                if (i!=0) stream->WriteString(" |");
                stream->WriteString(" <f"+Blex::AnyToString(i)+">");
        }
        stream->WriteString("}");
        ENDCODE
        for (unsigned i = 0; i<functioncall->parameters.size(); ++i)
            BuildLink(functioncall, functioncall->parameters[i], i);
}
void AstDotPrinter::V_FunctionPtr(FunctionPtr *functionptr, Empty)
{
        STARTCODE(functionptr);
        stream->WriteString("|"+functionptr->function->name + "|{");

        if (functionptr->parameters_specified)
        {
                for (unsigned i = 0; i<functionptr->passthrough_parameters.size(); ++i)
                {
                        if (i!=0) stream->WriteString(" |");
                        if (functionptr->passthrough_parameters[i])
                        {
                                stream->WriteString("#" + Blex::AnyToString(functionptr->passthrough_parameters[i]));
                                if (functionptr->bound_parameters[i])
                                    stream->WriteString(" <f"+Blex::AnyToString(i)+">");
                        }
                        else
                           stream->WriteString(" <f"+Blex::AnyToString(i)+">");
                }
        }
        stream->WriteString("}}");
        ENDCODE

        if (functionptr->parameters_specified)
            for (unsigned i = 0; i<functionptr->passthrough_parameters.size(); ++i)
                if (functionptr->passthrough_parameters[i] == 0)
                    BuildLink(functionptr, functionptr->bound_parameters[i], i);
}
void AstDotPrinter::V_FunctionPtrCall(FunctionPtrCall *functionptrcall, Empty)
{
        STARTCODE(functionptrcall);
        stream->WriteString("| <f0> fptr");

        for (unsigned i = 0; i<functionptrcall->params.size(); ++i)
        {
                stream->WriteString(" |");
                if (functionptrcall->params[i])
                    stream->WriteString("#" + Blex::AnyToString(functionptrcall->params[i]));
        }
        stream->WriteString("}");
        ENDCODE

        BuildLink(functionptrcall, functionptrcall->functionptr, 0);
        for (unsigned i = 0; i<functionptrcall->params.size(); ++i)
            BuildLink(functionptrcall, functionptrcall->params[i], i + 1);
}

void AstDotPrinter::V_FunctionPtrRebind(FunctionPtrRebind *functionptrrebind, Empty)
{
        STARTCODE(functionptrrebind);
        stream->WriteString("| <f0> fptr");

        for (unsigned i = 0; i<functionptrrebind->passthrough_parameters.size(); ++i)
        {
                stream->WriteString(" |");
                if (functionptrrebind->passthrough_parameters[i])
                    stream->WriteString("#" + Blex::AnyToString(functionptrrebind->passthrough_parameters[i]));
                if (functionptrrebind->bound_parameters[i])
                    stream->WriteString(" <f"+Blex::AnyToString(i + 1)+">");
        }
        stream->WriteString("}");
        ENDCODE

        BuildLink(functionptrrebind, functionptrrebind->orgptr, 0);
        for (unsigned i = 0; i<functionptrrebind->passthrough_parameters.size(); ++i)
            if (functionptrrebind->passthrough_parameters[i] == 0)
                BuildLink(functionptrrebind, functionptrrebind->bound_parameters[i], i + 1);
}

void AstDotPrinter::V_InitializeStatement(InitializeStatement *initializestatement, Empty)
{
        STARTCODE(initializestatement);
        stream->WriteString("|"+initializestatement->symbol->name);
        ENDCODE
}

void AstDotPrinter::V_LoopStatement(LoopStatement *loopstatement, Empty)
{
        STARTCODE(loopstatement);
        stream->WriteString("|{ <f0> pre | <f1> block | <f2> inc }");
        ENDCODE
        if (showtype == ASTNormal)
        {
                BuildLink(loopstatement, loopstatement->precondition, 0);
                BuildLink(loopstatement, loopstatement->loop, 1);
                BuildLink(loopstatement, loopstatement->loopincrementer, 2);
        }
}
void AstDotPrinter::V_Lvalue(Lvalue *lvalue, Empty)
{
        STARTCODE(lvalue);
        stream->WriteString("|VISTING ERROR");
        ENDCODE
}
void AstDotPrinter::V_LvalueSet(LvalueSet *lvalueset, Empty)
{
        STARTCODE(lvalueset);
        stream->WriteString("| { <f0> " + (lvalueset->clvalue.basevar ? lvalueset->clvalue.basevar->name : ""));
        stream->WriteString("| <f1> value");
        unsigned idx = 2;
        for (LvalueLayers::iterator it = lvalueset->clvalue.layers.begin(); it != lvalueset->clvalue.layers.end(); ++it)
        {
                stream->WriteString("| <f" + Blex::AnyToString(idx++) + "> ");
                if (it->type == LvalueLayer::Array)
                    stream->WriteString("[ ]");
                else if (it->type == LvalueLayer::Record)
                    stream->WriteString("." + it->name);
                else
                    stream->WriteString("\\-\\> " + it->name);
        }
        stream->WriteString("}");
        ENDCODE

        BuildLink(lvalueset, lvalueset->clvalue.base, 0);
        BuildLink(lvalueset, lvalueset->value, 1);

        idx = 2;
        for (LvalueLayers::iterator it = lvalueset->clvalue.layers.begin(); it != lvalueset->clvalue.layers.end(); ++it)
            BuildLink(lvalueset, it->expr, idx++);
}
void AstDotPrinter::V_Module(Module *module, Empty)
{
        STARTCODE(module);
        unsigned i = 0;
        stream->WriteString(" | {");
        for (std::vector<Function*>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
        {
                if (it != module->functions.begin()) stream->WriteString(" |");
                stream->WriteString(" <f"+Blex::AnyToString(++i)+">" + (*it)->symbol->name);
        }
        stream->WriteString(" } ");
        ENDCODE;
        i = 0;
        for (std::vector<Function*>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            stream->WriteString(GetNodeName(module) +":f"+Blex::AnyToString(++i)+" -> "+GetNodeName(*it)+";\n");
        for (std::vector<Function*>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            Visit(*it);
}
void AstDotPrinter::V_Node(Node *node, Empty)
{
        STARTCODE(node);
        stream->WriteString("|VISTING ERROR");
        ENDCODE
}
void AstDotPrinter::V_RecordCellSet(RecordCellSet *recordcellset, Empty)
{
        STARTCODE(recordcellset);
        stream->WriteString("|{<f0>|" + recordcellset->name + "|<f1>}");
        ENDCODE
        BuildLink(recordcellset, recordcellset->record, 0);
        BuildLink(recordcellset, recordcellset->value, 1);
}
void AstDotPrinter::V_ObjectExtend(AST::ObjectExtend *objectextend, Empty)
{
        STARTCODE(objectextend);
        stream->WriteString("|{<f0>|" + objectextend->extendwith->name);
        for (unsigned idx = 0; idx < objectextend->parameters.size();)
            stream->WriteString("|<f" + Blex::AnyToString(++idx) + ">");
        ENDCODE
        BuildLink(objectextend, objectextend->object, 0);
        unsigned idx = 0;
        for (auto &itr: objectextend->parameters)
            BuildLink(objectextend, itr, ++idx);
}
void AstDotPrinter::V_ObjectMemberDelete(AST::ObjectMemberDelete *objectmemberdelete, Empty)
{
        STARTCODE(objectmemberdelete);
        stream->WriteString("|{<f0>|" + objectmemberdelete->name + (objectmemberdelete->via_this? " (via this)":"") + "}");
        ENDCODE
        BuildLink(objectmemberdelete, objectmemberdelete->object, 0);
}
void AstDotPrinter::V_ObjectMemberInsert(AST::ObjectMemberInsert *objectmemberinsert, Empty)
{
        STARTCODE(objectmemberinsert);
        stream->WriteString(std::string("|{<f0>|") + (objectmemberinsert->is_private ? "PRIVATE " : "PUBLIC ") + objectmemberinsert->name + (objectmemberinsert->via_this? " (via this)":"") + "|<f1>}");
        ENDCODE
        BuildLink(objectmemberinsert, objectmemberinsert->object, 0);
        BuildLink(objectmemberinsert, objectmemberinsert->value, 1);
}

void AstDotPrinter::V_ObjectMemberSet(ObjectMemberSet *objectmemberset, Empty)
{
        STARTCODE(objectmemberset);
        stream->WriteString("|{<f0>|" + objectmemberset->name + "|<f1>}");
        ENDCODE
        BuildLink(objectmemberset, objectmemberset->object, 0);
        BuildLink(objectmemberset, objectmemberset->value, 1);
}
void AstDotPrinter::V_RecordCellDelete(RecordCellDelete *recordcelldelete, Empty)
{
        STARTCODE(recordcelldelete);
        stream->WriteString("|{<f0>|"+recordcelldelete->name+"}");
        ENDCODE
        BuildLink(recordcelldelete, recordcelldelete->record, 0);
//        BuildLink(recordcelldelete, recordcelldelete->name, 1);
}
void AstDotPrinter::V_RecordColumnConst(RecordColumnConst *recordcolumnconst, Empty)
{
        STARTCODE(recordcolumnconst);
        stream->WriteString("|{<f0>|"+recordcolumnconst->name+"}");
        ENDCODE
        BuildLink(recordcolumnconst, recordcolumnconst->record, 0);
}
void AstDotPrinter::V_ObjectMemberConst(ObjectMemberConst*objectmemberconst, Empty)
{
        STARTCODE(objectmemberconst);
        stream->WriteString("|{<f0>|"+objectmemberconst->name+"}");
        ENDCODE
        BuildLink(objectmemberconst, objectmemberconst->object, 0);
}
void AstDotPrinter::V_ObjectMethodCall(ObjectMethodCall *objectmethodcall, Empty)
{
        STARTCODE(objectmethodcall);
        stream->WriteString("|"+objectmethodcall->membername + "|{ <f0> ");
        for (unsigned i = 0; i<objectmethodcall->parameters.size(); ++i)
        {
                stream->WriteString(" |");
                stream->WriteString(" <f"+Blex::AnyToString(i+1)+">");
        }
        stream->WriteString("}");
        ENDCODE
        BuildLink(objectmethodcall, objectmethodcall->object, 0);
        for (unsigned i = 0; i<objectmethodcall->parameters.size(); ++i)
            BuildLink(objectmethodcall, objectmethodcall->parameters[i], i+1);
}
void AstDotPrinter::V_ObjectTypeUID(AST::ObjectTypeUID *objecttypeuid, Empty)
{
        STARTCODE(objecttypeuid);
        stream->WriteString("|{"+objecttypeuid->objtype->name+"}");
        ENDCODE
}
void AstDotPrinter::V_ReturnStatement(ReturnStatement *returnstatement, Empty)
{
        STARTCODE(returnstatement);
        stream->WriteString("|{");
        if (returnstatement->returnvalue)
            stream->WriteString(" <f0>");
        stream->WriteString("}");
        ENDCODE
        if (returnstatement->returnvalue)
            BuildLink(returnstatement, returnstatement->returnvalue, 0);
}
void AstDotPrinter::V_Rvalue(Rvalue *rvalue, Empty)
{
        STARTCODE(rvalue);
        stream->WriteString("|VISTING ERROR");
        ENDCODE
}
void AstDotPrinter::V_SingleExpression(SingleExpression *singleexpression, Empty)
{
        STARTCODE(singleexpression);
        ENDCODE
        stream->WriteString(GetNodeName(singleexpression) + " -> " + GetNodeName(singleexpression->expr)+";\n");
        Visit(singleexpression->expr);
}

void AstDotPrinter::V_SchemaTable(SchemaTable *schematable, Empty)
{
        STARTCODE(schematable);
        stream->WriteString("|{<f0>|"+schematable->name+"}");
        ENDCODE
        BuildLink(schematable, schematable->schema, 0);
}

void AstDotPrinter::V_Statement(Statement *statement, Empty)
{
        STARTCODE(statement);
        ENDCODE
}

void AstDotPrinter::V_SwitchStatement(AST::SwitchStatement *switchstatement, Empty)
{
        unsigned idx = 1;
        STARTCODE(switchstatement);
        stream->WriteString("|{value<f0>");
        for (AST::SwitchStatement::CaseList::iterator it = switchstatement->cases.begin(); it != switchstatement->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                    stream->WriteString("|case<f" + Blex::AnyToString(idx++)+"> ");
                stream->WriteString(": <f" + Blex::AnyToString(idx++)+">");
        }
        if (switchstatement->defaultcase)
        {
                stream->WriteString("|default<f" + Blex::AnyToString(idx)+">");
        }
        stream->WriteString("}");
        ENDCODE
        idx = 0;
        BuildLink(switchstatement, switchstatement->value, idx++);
        for (AST::SwitchStatement::CaseList::iterator it = switchstatement->cases.begin(); it != switchstatement->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                    BuildLink(switchstatement, *it2, idx++);
                BuildLink(switchstatement, it->second, idx++);
        }
        if (switchstatement->defaultcase)
            BuildLink(switchstatement, switchstatement->defaultcase, idx);
}

void AstDotPrinter::V_TryCatchStatement(TryCatchStatement *trycatchstatement, Empty)
{
        STARTCODE(trycatchstatement);
        stream->WriteString("|{<f0>try | <f1>catch}");
        ENDCODE
        BuildLink(trycatchstatement, trycatchstatement->tryblock, 0);
        BuildLink(trycatchstatement, trycatchstatement->catchblock, 1);
}

void AstDotPrinter::V_TryFinallyStatement(TryFinallyStatement *tryfinallystatement, Empty)
{
        STARTCODE(tryfinallystatement);
        stream->WriteString("|{<f0>try | <f1>finally}");
        ENDCODE
        BuildLink(tryfinallystatement, tryfinallystatement->tryblock, 0);
        BuildLink(tryfinallystatement, tryfinallystatement->finallyblock, 1);
}

void AstDotPrinter::V_TypeInfo(TypeInfo *typeinfo, Empty)
{
        STARTCODE(typeinfo);
        if (typeinfo->symbol)
            stream->WriteString("|"+typeinfo->symbol->name);
        ENDCODE
}

void AstDotPrinter::V_UnaryOperator(UnaryOperator *unaryoperator, Empty)
{
        STARTCODE(unaryoperator);
        stream->WriteString("|"+UnaryOperatorType::ToSTLStr(unaryoperator->operation));
        stream->WriteString("|<f0>");
        ENDCODE
        BuildLink(unaryoperator, unaryoperator->lhs, 0);
}

void AstDotPrinter::V_Variable(Variable *variable, Empty)
{
        STARTCODE(variable);
        stream->WriteString(" | " + variable->symbol->name);
        ENDCODE
}

void AstDotPrinter::V_Yield(Yield *yield, Empty)
{
        STARTCODE(yield);
        if (yield->star)
          stream->WriteString("*");
        stream->WriteString("|{<f0>}|{<f1>}");
        ENDCODE
        BuildLink(yield, yield->generator, 0);
        BuildLink(yield, yield->yieldexpr, 1);
}

void AstDotPrinter::V_SQL(SQL *sql, Empty)
{
        STARTCODE(sql);
        ENDCODE
}

void AstDotPrinter::V_SQLDataModifier(SQLDataModifier * sqldatamodifier, Empty)
{
        STARTCODE(sqldatamodifier);
        stream->WriteString(" | {");
        unsigned i = 1;
        for (std::vector<std::string>::iterator it = sqldatamodifier->columns.begin(); it != sqldatamodifier->columns.end(); ++it, ++i)
        {
                if (i != 0)
                    stream->WriteString(" |");
                stream->WriteString(" <f"+Blex::AnyToString(i)+">" + *it);
        }
        stream->WriteString("}");
        ENDCODE
        i = 0;
        for (std::vector<Rvalue*>::iterator it = sqldatamodifier->values.begin(); it != sqldatamodifier->values.end(); ++it)
            BuildLink(sqldatamodifier, *it, ++i);
}

void AstDotPrinter::V_SQLDelete(SQLDelete * sqldelete, Empty)
{
        STARTCODE(sqldelete);
        stream->WriteString(" | {delete from|<f0>source|<f1>" + EncodeLocationString(sqldelete->location) +"}");
        ENDCODE
        BuildLink(sqldelete, &sqldelete->sources[0], 0);
        if (sqldelete->location.expr)
            BuildLink(sqldelete, sqldelete->location.expr, 1);
}

void AstDotPrinter::V_SQLInsert(SQLInsert * sqlinsert, Empty)
{
        STARTCODE(sqlinsert);
        stream->WriteString(" | {insert into|<f0>source|<f1>" + EncodeLocationString(sqlinsert->location) +" |<f2> value}");
        ENDCODE
        BuildLink(sqlinsert, sqlinsert->source, 0);
        if (sqlinsert->location.expr)
            BuildLink(sqlinsert, sqlinsert->location.expr, 1);
        BuildLink(sqlinsert, sqlinsert->modifier, 2);
}

void AstDotPrinter::V_SQLSelect(SQLSelect * sqlselect, Empty)
{
        STARTCODE(sqlselect);
        stream->WriteString(" | {select|<f1>from|");
        unsigned id = 2;
        if (sqlselect->location.expr)
            stream->WriteString("|<f" + Blex::AnyToString(id++) + ">");
        stream->WriteString(EncodeLocationString(sqlselect->location));

        if (!sqlselect->groupings.empty())
        {
                stream->WriteString("|<f" + Blex::AnyToString(id++) + ">GROUP BY ");
                for (std::vector< Rvalue * >::iterator it = sqlselect->groupings.begin(); it != sqlselect->groupings.end(); ++it)
                {
                        if (it != sqlselect->groupings.begin())
                            stream->WriteString("|<f" + Blex::AnyToString(id++) + ">");
                }
        }
        if (sqlselect->having_expr)
            stream->WriteString("| HAVING <f" + Blex::AnyToString(id++) + ">");

        for (std::vector< SQLSelect::Temporary >::iterator it = sqlselect->temporaries.begin(); it != sqlselect->temporaries.end(); ++it)
            stream->WriteString("|<f" + Blex::AnyToString(id++) + ">TEMP " + it->symbol->name);
        for (std::vector< SQLSelect::SelectItem >::iterator it = sqlselect->namedselects.begin(); it != sqlselect->namedselects.end(); ++it)
        {
            if (it->expr)
                stream->WriteString(std::string("|") + (it->is_spread?"..." : "") + "<f" + Blex::AnyToString(id++) + "> " + (it->is_star ? "*" : it->name));
            else
                stream->WriteString("|DELETE " + it->name);
        }
        for (std::vector< std::pair< Rvalue*, bool > >::iterator it = sqlselect->orderings.begin(); it != sqlselect->orderings.end(); ++it)
        {
                stream->WriteString("|<f" + Blex::AnyToString(id++) + ">");
                if (it == sqlselect->orderings.begin())
                    stream->WriteString("ORDER BY ");
                stream->WriteString(it->second?"ASC":"DESC");
        }

        std::vector<std::pair<Rvalue*, bool> > orderings;

        stream->WriteString("}");
        ENDCODE
        BuildLink(sqlselect, sqlselect->sources, 1);
        id = 2;
        if (sqlselect->location.expr)
            BuildLink(sqlselect, sqlselect->location.expr, id++);
        for (std::vector< Rvalue * >::iterator it = sqlselect->groupings.begin(); it != sqlselect->groupings.end(); ++it)
            BuildLink(sqlselect, *it, id++);
        if (sqlselect->having_expr)
            BuildLink(sqlselect, sqlselect->having_expr, id++);

        for (std::vector< SQLSelect::Temporary >::iterator it = sqlselect->temporaries.begin(); it != sqlselect->temporaries.end(); ++it)
            BuildLink(sqlselect, it->expr, id++);
        for (std::vector< SQLSelect::SelectItem >::iterator it = sqlselect->namedselects.begin(); it != sqlselect->namedselects.end(); ++it)
            if (it->expr)
                BuildLink(sqlselect, it->expr, id++);
        for (std::vector< std::pair< Rvalue*, bool > >::iterator it = sqlselect->orderings.begin(); it != sqlselect->orderings.end(); ++it)
            BuildLink(sqlselect, it->first, id++);
}

void AstDotPrinter::V_SQLSource(SQLSource *sqlsource, Empty)
{
        STARTCODE(sqlsource);
        stream->WriteString(" | <f0>as " + sqlsource->subst_name);
        ENDCODE
        BuildLink(sqlsource, sqlsource->expression, 0);
}

void AstDotPrinter::V_SQLSources(SQLSources * sqlsources, Empty)
{
        STARTCODE(sqlsources);
        stream->WriteString("|{");
        for (unsigned i = 0; i<sqlsources->sources.size(); ++i)
        {
                if (i!=0) stream->WriteString(" |");
                stream->WriteString(" <f"+Blex::AnyToString(i)+">");
        }
        stream->WriteString("}");
        ENDCODE
        for (unsigned i = 0; i<sqlsources->sources.size(); ++i)
            BuildLink(sqlsources, sqlsources->sources[i], i);
}

void AstDotPrinter::V_SQLUpdate(SQLUpdate * sqlupdate, Empty)
{
        STARTCODE(sqlupdate);
        stream->WriteString(" | {update |<f0>source|set|<f1>modifier|<f2>" + EncodeLocationString(sqlupdate->location)+"}");
        ENDCODE
        BuildLink(sqlupdate, sqlupdate->source, 0);
        BuildLink(sqlupdate, sqlupdate->modifier, 1);
        if (sqlupdate->location.expr)
            BuildLink(sqlupdate, sqlupdate->location.expr, 2);
}

void OutputASTNormal(CompilerContext &context, AST::Node *node, Blex::Stream &output, TypeStorage const &tstorage)
{
        AstDotPrinter ast_dot_printer(context);
        ast_dot_printer.OutputASTNormal(node,output,tstorage);
}


} // end of namespace HareScript
} // end of namespace Compiler
