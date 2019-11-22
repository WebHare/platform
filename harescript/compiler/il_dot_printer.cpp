//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "il_dot_printer.h"
#include "ast_dot_printer.h"
#include "debugprints.h"
#include "../vm/hsvm_constants.h"
#include "compiler.h"
#include <cstdio>

namespace HareScript
{
namespace Compiler
{

using namespace IL;


template <class A>
 std::string ILDotPrinter::GetNodeName(A *a)
{
        return "\"" + GetUnstringedNodeName(a) + "\"";
}

template <class A>
 std::string ILDotPrinter::GetUnstringedNodeName(A *a)
{
//        return Blex::AnyToString(reinterpret_cast<long>(a));
        return Blex::AnyToString((void *)a);
}

void ILDotPrinter::PrintBasicBlock(BasicBlock *block, bool entry)
{
        visited[block] = true;
        stream->WriteString(GetNodeName(block) + " [label = \"{");

        stream->WriteString("basic block "+GetUnstringedNodeName(block));
        std::string s;
        stream->WriteString(entry?(std::string(" ENTRY of ") + currfunc->symbol->name) : s);
        stream->WriteString(" freq: " + Blex::AnyToString(block->frequency));

        for (std::vector<PhiFunction *>::iterator it = block->phifunctions.begin(); it != block->phifunctions.end(); ++it)
        {
                stream->WriteString(" | "+VariableName((*it)->variable) + " := phi(");
                for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::iterator it2 = (*it)->params.begin();
                        it2 != (*it)->params.end(); ++it2)
                {
                        if (it2 != (*it)->params.begin())
                            stream->WriteString(", ");
                        stream->WriteString(VariableName(it2->first));
                        stream->WriteString("-"+GetUnstringedNodeName(it2->second));
                }
                stream->WriteString(")");
        }

        if (liveanalyzer)
        {
                std::set<IL::SSAVariable *> &data = liveanalyzer->entrylivedata[block];
                stream->WriteString("| live: ");
                for (std::set<IL::SSAVariable *>::iterator it = data.begin(); it != data.end(); ++it)
                {
                        if (it != data.begin()) stream->WriteString(", ");
                        stream->WriteString(VariableName(*it));
                }
        }


        switch (printsort)
        {
        case PrintIntermediateLanguage:
                {
                        for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
                        {
                                stream->WriteString(" | ");
                                Visit(*it, Empty());

                                std::set<SSAVariable*> varlist;
                                stream->WriteString(" (uses: ");
                                (*it)->InsertUsed(&varlist);

                                if (varlist.empty())
                                    stream->WriteString("none");
                                else
                                    for (std::set<SSAVariable *>::iterator it2 = varlist.begin(); it2 != varlist.end(); ++it2)
                                    {
                                            if (it2 != varlist.begin()) stream->WriteString(", ");
                                            stream->WriteString(VariableName(*it2));
                                    }
                                stream->WriteString(", defs: ");
                                varlist.clear();
                                (*it)->InsertDefined(&varlist);

                                if (varlist.empty())
                                    stream->WriteString("none");
                                else
                                    for (std::set<SSAVariable *>::iterator it2 = varlist.begin(); it2 != varlist.end(); ++it2)
                                    {
                                            if (it2 != varlist.begin()) stream->WriteString(", ");
                                            stream->WriteString(VariableName(*it2));
                                    }
                                stream->WriteString(")");
                        }
                }; break;
        case PrintCode:
                {
                        CodeGenerator::CodeBlock *code = generator->translatedblocks[block];
                        if (code != 0)
                        for (std::vector<Code::Instruction>::iterator it = code->elements.begin(); it != code->elements.end(); ++it)
                        {
                                stream->WriteString(" | ");
                                const InstructionCodeNameMap &mapper = GetInstructionCodeNameMap();
                                stream->WriteString(mapper.find(it->type)->second + " ");
                                switch (it->type)
                                {
                                case InstructionSet::CALL:
                                        stream->WriteString(it->data.function->name); break;
                                case InstructionSet::LOADS:
                                case InstructionSet::STORES:
                                case InstructionSet::LOADG:
                                case InstructionSet::STOREG:
                                case InstructionSet::LOADSD:
                                case InstructionSet::LOADGD:
                                case InstructionSet::DESTROYS:
                                case InstructionSet::COPYS:
                                        stream->WriteString(VariableName(it->data.var));
                                        break;
                                case InstructionSet::LOADC:
                                case InstructionSet::RECORDCELLGET:
                                case InstructionSet::RECORDCELLSET:
                                case InstructionSet::RECORDCELLUPDATE:
                                case InstructionSet::RECORDCELLCREATE:
                                case InstructionSet::RECORDCELLDELETE:
                                case InstructionSet::OBJMEMBERGET:
                                case InstructionSet::OBJMEMBERGETTHIS:
                                case InstructionSet::OBJMEMBERSET:
                                case InstructionSet::OBJMEMBERSETTHIS:
                                        {
                                                stream->WriteString(Compiler::EncodeConstant(&context, it->constant));
                                        }; break;
                                case InstructionSet::OBJMETHODCALL:
                                case InstructionSet::OBJMETHODCALLTHIS:
                                case InstructionSet::OBJMETHODCALLNM:
                                case InstructionSet::OBJMETHODCALLTHISNM:
                                        {
                                                stream->WriteString(Compiler::EncodeConstant(&context, it->constant));
                                                stream->WriteString(" (params: " + Blex::AnyToString(it->data.paramcount) + ")");
                                        }; break;
                                case InstructionSet::CAST:
                                        stream->WriteString(HareScript::GetTypeName(it->constant.type));
                                        break;
                                case InstructionSet::LOADTYPEID:
                                        {
                                                stream->WriteString(" (");
                                                for (auto cit = it->constant.typeinfovalue->columnsdef.begin(); cit != it->constant.typeinfovalue->columnsdef.end(); ++cit)
                                                    stream->WriteString(" " + cit->dbase_name + ":" + Blex::AnyToString<int>(cit->flags));
                                                stream->WriteString(" )");
                                        }
                                default: ;
                                }
                                stream->WriteString(" (ls:" + Blex::AnyToString(it->lowstacksize) + ")");
                        }
                }
        }


        if (liveanalyzer)
        {
                std::set<IL::SSAVariable *> &data = liveanalyzer->exitlivedata[block];
                stream->WriteString("| live: ");
                for (std::set<IL::SSAVariable *>::iterator it = data.begin(); it != data.end(); ++it)
                {
                        if (it != data.begin()) stream->WriteString(", ");
                        stream->WriteString(VariableName(*it));
                }
        }

        stream->WriteString("}\"];\n");

        switch (printtype)
        {
        case PrintNormal:
                {
                        std::vector<std::string> colors;
                        if (block->successors.size() == 2)
                        {
                                colors.push_back("TRUE");
                                colors.push_back("FALSE");
                        }
                        for (std::vector<BasicBlock *>::iterator it = block->successors.begin(); it != block->successors.end(); ++it)
                        {
                                if (!visited[*it]) PrintBasicBlock(*it);
                                stream->WriteString(GetNodeName(block));
                                stream->WriteString(" -> ");
                                stream->WriteString(GetNodeName(*it));
                                stream->WriteString("[");
                                if (!colors.empty())
                                {
                                        stream->WriteString("taillabel = " + colors.front());
                                        colors.erase(colors.begin());
                                }
                                stream->WriteString("]\n");
                        }
                        for (std::vector<BasicBlock *>::iterator it = block->throwcatchers.begin(); it != block->throwcatchers.end(); ++it)
                        {
                                if (!visited[*it]) PrintBasicBlock(*it);
                                stream->WriteString(GetNodeName(block));
                                stream->WriteString(" -> ");
                                stream->WriteString(GetNodeName(*it));
                                stream->WriteString("[");
                                stream->WriteString("taillabel = exception");
                                stream->WriteString("]\n");
                        }
                }; break;
        case PrintDominator:
                {
                        for (std::vector<BasicBlock *>::iterator it = block->dominees.begin(); it != block->dominees.end(); ++it)
                        {
                                stream->WriteString(GetNodeName(block));
                                stream->WriteString(" -> ");
                                stream->WriteString(GetNodeName(*it));
                                PrintBasicBlock(*it);
                        }
                }
        }
}

std::string ILDotPrinter::VariableName(IL::SSAVariable *var)
{
        if (!var) return "CORRUPT: NULL";

        std::string s;
        if (allocator)
        {
                if (allocator->global_variable_positions.find(var->variable) != allocator->global_variable_positions.end())
                {
                        if (allocator->global_variable_positions.find(var->variable) != allocator->global_variable_positions.end())
                            s = "%G:"+Blex::AnyToString(allocator->global_variable_positions[var->variable]);
                        else
                            s = "%G: -";
                }
                else
                {
                        if (allocator->local_variable_positions.count(var))
                            s = "%L:"+Blex::AnyToString(allocator->local_variable_positions[var]);
                        else
                            s = "%unknown";
                }
        }

        if (var->variable->type != VariableTypes::Uninitialized)
            s += "[" + HareScript::GetTypeName(var->variable->type) + "]";

        if (var->id == 0)
            return var->variable->name+s;
        else
            return var->variable->name + "("+Blex::AnyToString(var->id)+")"+s;
}

void ILDotPrinter::VisitAllFunctionEntries(Module *module, Blex::Stream &file)
{
        stream.reset(NULL);

        visited.clear();

        stream.reset(new Blex::BufferedStream(file, 65536));

        stream->WriteString("digraph structs {\nnode [shape=record,fontname=\"timr____\",fontsize=10];\n");
        stream->WriteString("edge [labelfontname=\"timr____\",labelfontsize=10];\n");

        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
        {
                currfunc = *it;
                PrintBasicBlock((*it)->block, true);
        }

        stream->WriteString("}\n");
}

void ILDotPrinter::PrintStructure(Module *module, Blex::Stream &file, PrintSort sort, PrintType type)
{
        printtype = type;
        printsort = sort;
        VisitAllFunctionEntries(module, file);
}

void ILDotPrinter::V_ILInstruction(ILInstruction *, Empty)
{
        stream->WriteString("Unknown instruction");
}
void ILDotPrinter::V_ILConstant(ILConstant *obj, Empty)
{
        stream->WriteString(VariableName(obj->target) + " := " + EncodeConstant(&context, obj->constant));
}
void ILDotPrinter::V_ILAssignment(ILAssignment *obj, Empty)
{
        stream->WriteString(VariableName(obj->target) + " := " + VariableName(obj->rhs));
}
void ILDotPrinter::V_ILBinaryOperator(ILBinaryOperator *obj, Empty)
{
        std::string s = EncodeString(BinaryOperatorType::ToSTLStr(obj->operation));
        stream->WriteString(VariableName(obj->target) + " := " + VariableName(obj->lhs) + " " + s + " " + VariableName(obj->rhs));
}
void ILDotPrinter::V_ILCast(ILCast *obj, Empty)
{
        stream->WriteString(VariableName(obj->target) + " := " + VariableName(obj->rhs) + " casted to " + HareScript::GetTypeName(obj->to_type));
}
void ILDotPrinter::V_ILUnaryOperator(ILUnaryOperator *obj, Empty)
{
        std::string s = UnaryOperatorType::ToSTLStr(obj->operation);
        stream->WriteString(VariableName(obj->target) + " := " + s + " " + VariableName(obj->rhs));
}
void ILDotPrinter::V_ILFunctionCall(ILFunctionCall *obj, Empty)
{
        if (obj->target)
            stream->WriteString(VariableName(obj->target) + " := " + obj->function->name + " (");
        else
            stream->WriteString(obj->function->name + " (");
        for (std::vector<SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
        {
                if (it != obj->values.begin()) stream->WriteString(", ");
                stream->WriteString(VariableName(*it));
        }
        stream->WriteString(")");
}
void ILDotPrinter::V_ILColumnOperator(ILColumnOperator *obj, Empty)
{
        stream->WriteString(VariableName(obj->target) + " := " + VariableName(obj->rhs) + "." + obj->columnname);
}
void ILDotPrinter::V_ILConditionalJump(ILConditionalJump *obj, Empty)
{
        stream->WriteString("conditional " + VariableName(obj->rhs));
}
void ILDotPrinter::V_ILReturn(ILReturn *obj, Empty)
{
        stream->WriteString("RETURN ");
        if (obj->returnvalue)
            stream->WriteString(VariableName(obj->returnvalue));
}
void ILDotPrinter::V_ILMethodCall(IL::ILMethodCall *obj, Empty)
{
        if (obj->target)
            stream->WriteString(VariableName(obj->target) + " := ");
        stream->WriteString(VariableName(obj->object) + " call " + obj->membername + "(");
        for (std::vector<SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
        {
                if (it != obj->values.begin()) stream->WriteString(", ");
                stream->WriteString(VariableName(*it));
        }
        stream->WriteString(")");
}

void ILDotPrinter::V_ILFunctionPtrCall(ILFunctionPtrCall *obj, Empty)
{
        if (obj->target)
            stream->WriteString(VariableName(obj->target) + " := ");
        stream->WriteString(VariableName(obj->functionptr) + "(");
        for (std::vector<SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
        {
                if (it != obj->values.begin()) stream->WriteString(", ");
                stream->WriteString(VariableName(*it));
        }
        stream->WriteString(")");
}

void ILDotPrinter::V_ILRecordCellSet(IL::ILRecordCellSet *obj, Empty)
{
        std::string type = obj->check_type
            ? obj->allow_create
                  ? "CREATE"
                  : "UPDATE"
            : "SET";
        stream->WriteString(VariableName(obj->target) + " := CELLSET("+type+")(" + VariableName(obj->rhs) + ", '" + obj->columnname + "', " + VariableName(obj->value) + ")");
}

void ILDotPrinter::V_ILRecordCellDelete(IL::ILRecordCellDelete *obj, Empty)
{
        stream->WriteString(VariableName(obj->target) + " := CELLDELETE(" + VariableName(obj->rhs) + ", '" + obj->columnname + "')");
}

void ILDotPrinter::V_ILObjectMemberGet(IL::ILObjectMemberGet *obj, Empty)
{
        stream->WriteString(VariableName(obj->target) + " := " + VariableName(obj->object) + " -\\> '" + obj->membername + "'' " + (obj->via_this ? "" : " (via this)"));
}

void ILDotPrinter::V_ILObjectMemberSet(IL::ILObjectMemberSet *obj, Empty)
{
        stream->WriteString(VariableName(obj->object) + " -\\> '" + obj->membername + "'' := " + VariableName(obj->value) + " " + (obj->via_this ? "" : " (via this)"));
}

void ILDotPrinter::V_ILObjectMemberDelete(IL::ILObjectMemberDelete *obj, Empty)
{
        stream->WriteString("MEMBERDELETE(" +
                VariableName(obj->object) + ", " +
                "'" + obj->membername + "')" +
                (obj->via_this ? "" : " (via this)"));
}

void ILDotPrinter::V_ILObjectMemberInsert(IL::ILObjectMemberInsert *obj, Empty)
{
        stream->WriteString("MEMBERINSERT(" +
                VariableName(obj->object) + ", " +
                "'" + obj->membername + "', " +
                VariableName(obj->value) + ", " +
                (obj->is_private ? "PRIVATE" : "PUBLIC") + ")" +
                (obj->via_this ? "" : " (via this)"));
}

void PrintIntermediateStructure(CompilerContext &context, IL::Module *module, Blex::Stream &outfile, PrintType type, ILLiveAnalyzer *liveanalyzer)
{
        ILDotPrinter printer(context);
        if (liveanalyzer) printer.RegisterLiveAnalyzer(liveanalyzer);
        printer.PrintStructure(module,outfile,PrintIntermediateLanguage,type);
}
void PrintCodeStructure(CompilerContext &context, IL::Module *module, Blex::Stream &outfile, PrintType type, ILLiveAnalyzer&il, CodeRegisterAllocator&ca, CodeGenerator&cg)
{
        ILDotPrinter printer(context);
        printer.RegisterLiveAnalyzer(&il);
        printer.RegisterRegisterAllocator(&ca);
        printer.RegisterCodeGenerator(&cg);
        printer.PrintStructure(module,outfile,PrintCode,type);
}


} // end of namespace HareScript
} // end of namespace Compiler

//---------------------------------------------------------------------------

