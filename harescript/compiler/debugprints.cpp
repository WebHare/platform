//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "debugprints.h"

namespace HareScript
{
namespace Compiler
{

std::ostream & operator <<(std::ostream &out, Symbol const &rhs)
{
        return out << rhs.name;
}

std::ostream & operator <<(std::ostream &out, Symbol * const rhs)
{
        if (rhs)
            return out << *rhs << "(" << (void *)rhs << ")";
        else
            return out << "NULL";
}

CCostream & operator <<(CCostream &out, DBTypeInfo const &rhs)
{
        out << "[";
        for (auto it = rhs.columnsdef.begin(); it != rhs.columnsdef.end(); ++it)
        {
                if (it != rhs.columnsdef.begin()) out << ", ";
                out << it->dbase_name;
                if (it->name != it->dbase_name)
                    out << " as " << it->name;
                unsigned count(0);
                if (it->flags & ColumnFlags::InternalFase1)
                    out << (count++?", ":" (") << "Fase1";
                if (it->flags & ColumnFlags::InternalFase2)
                    out << (count++?", ":" (") << "Fase2";
                if (it->flags & ColumnFlags::InternalUpdates)
                    out << (count++?", ":" (") << "Updated";
                if (it->flags & ColumnFlags::Key)
                    out << (count++?", ":" (") << "Key";
                if (it->flags & ColumnFlags::TranslateNulls)
                    out << (count++?", ":" (") << "TransNULLs";
                if (count) out << ")";
        }
        out << "]";
        return out;
}

CCostream & operator <<(CCostream &out, Code::Instruction const &rhs)
{
        const InstructionCodeNameMap &mapper = GetInstructionCodeNameMap();
        out << (mapper.find(rhs.type)->second);
        switch (rhs.type)
        {
        case InstructionSet::CALL:
                out << " " << (rhs.data.function->name); break;
        case InstructionSet::LOADS:
        case InstructionSet::STORES:
        case InstructionSet::LOADG:
        case InstructionSet::STOREG:
        case InstructionSet::LOADSD:
        case InstructionSet::LOADGD:
        case InstructionSet::DESTROYS:
        case InstructionSet::COPYS:
                out << " " << *rhs.data.var; break;
        case InstructionSet::LOADC:
        case InstructionSet::RECORDCELLGET:
        case InstructionSet::RECORDCELLSET:
        case InstructionSet::RECORDCELLCREATE:
        case InstructionSet::RECORDCELLDELETE:
        case InstructionSet::RECORDCELLUPDATE:
                out << " " << rhs.constant; break;
        case InstructionSet::JUMP:
        case InstructionSet::JUMPC:
        case InstructionSet::JUMPC2:
        case InstructionSet::JUMPC2F:
                out << " " << rhs.data.jumplocation; break;
        case InstructionSet::INITVAR:
        case InstructionSet::CAST:
                {
                        out << HareScript::GetTypeName(rhs.constant.type);
                } break;
        default: ;
        }
        out << " (ls:" << rhs.lowstacksize << ")";
        return out;
}

std::ostream & operator <<(std::ostream &out, VariableWrapper const &var)
{
        return out << EncodeVariable(var.context, var.var, false);
}

CCostream & operator <<(CCostream &out, IL::Constant const &constant)
{
        if (constant.var == 0)
           out << "type: " << HareScript::GetTypeName(constant.type);
        else
           out << /*HareScript::GetTypeName(constant.type) << ": " << */WrapVar(out.context, constant.var);
        return out;
}

namespace
{
std::string EncodeVariableInternal(CompilerContext &context, VarId var, bool in_code)
{
        StackMachine &stackm = context.stackm;
        switch (stackm.GetType(var))
        {
        case VariableTypes::Boolean:     return stackm.GetBoolean(var) ? "TRUE" : "FALSE";
        case VariableTypes::Integer:     return Blex::AnyToString(stackm.GetInteger(var));
        case VariableTypes::Integer64:   return Blex::AnyToString(stackm.GetInteger64(var));
        case VariableTypes::Money:
                {
                        int64_t value = stackm.GetMoney(var);
                        std::string str = Blex::AnyToString(value % 100000);
                        while (str.size() < 5)
                           str = "0" + str;
                        return Blex::AnyToString(value / 100000) + "." + str;
                }
        case VariableTypes::String:
                {
                        if (in_code)
                            return "\"" + Compiler::EncodeString(stackm.GetSTLString(var)) + "\"";
                        else
                            return "\\\"" + Compiler::EncodeString(stackm.GetSTLString(var)) + "\\\"";
                }
        case VariableTypes::Float:      return Blex::AnyToString(stackm.GetFloat(var));
        case VariableTypes::FunctionRecord:
        case VariableTypes::Record:
                {
                        std::string str;
                        for (unsigned idx = 0; idx < stackm.RecordSize(var); ++idx)
                        {
                                if (idx != 0) str += ", ";
                                ColumnNameId name = stackm.RecordCellNameByNr(var, idx);
                                str += context.columnmapper.GetReverseMapping(name).stl_str();
                                str += " := ";
                                str += Compiler::EncodeVariable(context, stackm.RecordCellRefByName(var, name), in_code);
                        }

                        if (stackm.RecordNull(var))
                            return "DEFAULT RECORD";

                        return (stackm.RecordSize(var) != 0 ? "[" : "CELL[") + str + "]";
                }
        case VariableTypes::Blob:
                {
                        BlobRefPtr blob = stackm.GetBlob(var);
                        return "BLOB: " + Blex::AnyToString(blob.GetLength());
                }
        case VariableTypes::DateTime:   return Blex::AnyToString(stackm.GetDateTime(var));
        case VariableTypes::Table:      return Blex::AnyToString(stackm.GetInteger(var));
        case VariableTypes::Object:     return "DEFAULT OBJECT";
        case VariableTypes::WeakObject: return "DEFAULT WEAKOBJECT";
        default:
            if (!(stackm.GetType(var) & VariableTypes::Array))
                return "???";

            std::string str;
            for (unsigned idx = 0; idx < stackm.ArraySize(var); ++idx)
            {
                    if (idx != 0)
                        str += ", ";
                    str += EncodeVariableInternal(context, stackm.ArrayElementRef(var, idx), in_code);
            }
            return HareScript::GetTypeName(ToNonArray(context.stackm.GetType(var))) + "[" + str + "]";
        }
}
} // End of anonymous namespace

std::string EncodeVariable(CompilerContext &context, VarId var, bool code)
{
        if (!code)
            return HareScript::GetTypeName(context.stackm.GetType(var)) + ": " + EncodeVariableInternal(context, var, false);
        else
            return EncodeVariableInternal(context, var, true);
}

std::string EncodeConstant(CompilerContext *context, IL::Constant const &constant)
{
        std::string s;
        if (constant.var == 0)
           s =  "type: " + HareScript::GetTypeName(constant.type);
        else
        {
               if (!context)
                   s = "NO CONTEXT";
               else
                   s = EncodeVariable(*context, constant.var, false);
        }
        return s;
}

std::string EncodeString(const std::string &str)
{
        std::string s;
        for (std::string::const_iterator it = str.begin(); it != str.end(); ++it)
        {
                if (*it != '\n' && *it != '\r')
                {
                        //escape dangerous characters
                        if (std::strchr("<>|{}'\"\\", *it))
                            s.push_back('\\');
                        s.push_back(*it);
                }
                else if (*it != '\r')
                    s += "\\\\n";
        }
        return s;
}

CCostream & operator <<(CCostream &out, CodeGenerator::CodeBlock const &block)
{
        out << "Codeblock " << &block << std::endl;
        out << "  Uses " << block.var_uses << std::endl;
        out << "  Throwuses " << block.var_throwuses << std::endl;
        out << "  Defs " << block.var_defs << std::endl;
        out << "  Loads " << block.loads << std::endl;
        out << "  Stores " << block.stores << std::endl;
        out << "  Instrs " << block.elements << std::endl;
        return out;
}

} // end of namespace Compiler
} // end of namespace HareScript


