#ifndef blex_webhare_harescript_hsvm_debug
#define blex_webhare_harescript_hsvm_debug

#include "hsvm_constants.h"
#include "hsvm_stackmachine.h"

namespace HareScript
{

//---------------------------------------------------------------------------

/// Contains the types of print output that the operator << gives for variables
namespace VarPrinterPrintType
{
        /// List of values
        enum _enum
        {
                Default,        ///< "" around strings
                NoQuotes        ///< No quotes anywhere
        };
}

/// Wrapper that can be used to print variables in a VarMemory class
template <VarPrinterPrintType::_enum printtype> struct VarWrapper
{
        StackMachine &varmemory;
        VarId id;
        bool show_obj_contents;
        VarWrapper(StackMachine &varmemory, VarId id, bool show_obj_contents) : varmemory(varmemory), id(id), show_obj_contents(show_obj_contents) { }
};

/** Wrapper function to print variables by id in a VarMemory class. Usage: ostream << Wrap(varmemory, id)
    @param varmemory VarMemory object where variable is in
    @param id Id of variable. */
template <VarPrinterPrintType::_enum printtype>
 VarWrapper<printtype> Wrap(StackMachine &varmemory, VarId id)
{
        return VarWrapper<printtype>(varmemory, id, true);
}
inline VarWrapper<VarPrinterPrintType::Default> Wrap(StackMachine &varmemory, VarId id)
{
        return VarWrapper<VarPrinterPrintType::Default>(varmemory, id, true);
}

//---------------------------------------------------------------------------

inline std::ostream& operator <<(std::ostream &out, ConditionCode::_type type)
{
        if(type==ConditionCode::Less)             out << "<";
        else if(type==ConditionCode::LessEqual)   out << "<=";
        else if(type==ConditionCode::Equal)       out << "=";
        else if(type==ConditionCode::Bigger)      out << ">";
        else if(type==ConditionCode::BiggerEqual) out << ">=";
        else if(type==ConditionCode::UnEqual)     out << "!=";
        else                                      out << " (UNK. COND) ";
        return out;
}

inline std::ostream& operator <<(std::ostream &out, InstructionSet::_type type)
{
        InstructionCodeNameMap::const_iterator it = GetInstructionCodeNameMap().find(type);
        if (it == GetInstructionCodeNameMap().end())
            out << "(UNK. INSTR)";
        else
            out << it->second;
        return out;
}

inline std::ostream& operator <<(std::ostream &out, VariableTypes::Type type)
{
        return out << GetTypeName(type);
}

template <VarPrinterPrintType::_enum printtype>
 std::ostream& operator <<(std::ostream &out, VarWrapper<printtype> wrapper)
{
        switch (wrapper.varmemory.GetType(wrapper.id))
        {
        case VariableTypes::Uninitialized: out << "---"; break;
        case VariableTypes::Integer:     out << wrapper.varmemory.GetInteger(wrapper.id); break;
        case VariableTypes::Boolean:     out << (wrapper.varmemory.GetBoolean(wrapper.id) ? "TRUE" : "FALSE"); break;
        case VariableTypes::String:
                {
                        out << ((printtype == VarPrinterPrintType::Default)?"\"":"");
                        std::string str = wrapper.varmemory.GetSTLString(wrapper.id);
                        if (str.size() > 32)
                        {
                                str.erase(32, std::string::npos);
                                str += "...";
                        }
                        std::string encoded;
                        Blex::EncodeJava(str.begin(), str.end(), std::back_inserter(encoded));
                        out << encoded;
                        out << ((printtype == VarPrinterPrintType::Default)?"\"":"");
                }; break;
        case VariableTypes::Money:
                {
                        int64_t money = wrapper.varmemory.GetMoney(wrapper.id);
                        out << money / 100000.0;
                }; break;
        case VariableTypes::Integer64:
                {
                        int64_t i = wrapper.varmemory.GetInteger64(wrapper.id);
                        out << i;
                }; break;
        case VariableTypes::Float:
                {
                        F64 flt = wrapper.varmemory.GetFloat(wrapper.id);
                        out << flt;
                }; break;
        case VariableTypes::Integer | VariableTypes::Array:
                {
                        out << "A[";
                        unsigned elts = wrapper.varmemory.ArraySize(wrapper.id);
                        for (unsigned idx = 0; idx < elts; ++idx)
                        {
                                out << VarWrapper<printtype>(wrapper.varmemory, wrapper.varmemory.ArrayElementGet(wrapper.id, idx), wrapper.show_obj_contents);
                                if (idx + 1 != elts)
                                    out << ", ";
                        };
                        out << "]";
                }; break;
        case VariableTypes::FunctionRecord:
        case VariableTypes::Record:
                {
                        VarId copy;// = wrapper.varmemory.PushVariables(1);
                        out << "R[";
                        unsigned x = wrapper.varmemory.RecordSize(wrapper.id);
                        for (unsigned idx = 0; idx < x; ++idx)
                        {
                                out << "(";
                                unsigned name = wrapper.varmemory.RecordCellNameByNr(wrapper.id, idx);
                                out << wrapper.varmemory.columnnamemapper.GetReverseMapping(name).stl_str() << "<" << name << ">";
                                out << ": ";
                                copy = wrapper.varmemory.RecordCellGetByName(wrapper.id, name);
                                out << VarWrapper<printtype>(wrapper.varmemory, copy, wrapper.show_obj_contents);
                                out << ")";
                                if (idx + 1 != x)
                                    out << ", ";
                        }
                        out << "]";
                        //wrapper.varmemory.PopVariablesN(1);
                }; break;
        case VariableTypes::RecordArray:
                {
                        out << "A[";
                        unsigned elts = wrapper.varmemory.ArraySize(wrapper.id);
                        for (unsigned idx = 0; idx < elts; ++idx)
                        {
                                out << VarWrapper<printtype>(wrapper.varmemory, wrapper.varmemory.ArrayElementGet(wrapper.id, idx), wrapper.show_obj_contents);
                                if (idx + 1 != elts)
                                    out << ", ";
                        };
                        out << "]";
                }; break;
        case VariableTypes::VariantArray:
                {
                        out << "VA[";
                        unsigned elts = wrapper.varmemory.ArraySize(wrapper.id);
                        for (unsigned idx = 0; idx < elts; ++idx)
                        {
                                out << VarWrapper<printtype>(wrapper.varmemory, wrapper.varmemory.ArrayElementGet(wrapper.id, idx), wrapper.show_obj_contents);
                                if (idx + 1 != elts)
                                    out << ", ";
                        };
                        out << "]";
                }; break;
        case VariableTypes::Blob:
                {
                        out << "BLOB:" << wrapper.varmemory.GetBlob(wrapper.id).GetLength();
                }; break;
        case VariableTypes::Object:
                {
                        if (wrapper.varmemory.ObjectIsPrivilegedReference(wrapper.id))
                            out << "OBJECT(PRIVILEGED): ";
                        else
                            out << "OBJECT(DEFAULT): ";

                        if (!wrapper.varmemory.ObjectExists(wrapper.id))
                            out << "DEFAULT";
                        else if (!wrapper.show_obj_contents)
                            out << "<HIDDEN>";
                        else
                        {
                                bool first = true;
                                out << "O[";
                                unsigned elts = wrapper.varmemory.ObjectSize(wrapper.id);
                                for (unsigned idx = 0; idx < elts; ++idx)
                                {
                                        ColumnNameId name = wrapper.varmemory.ObjectMemberNameByNr(wrapper.id, idx);
                                        if (name == 0)
                                            continue;
                                        if (!first)
                                            out << ", ";
                                        first = false;
                                        out << wrapper.varmemory.columnnamemapper.GetReverseMapping(name).stl_str() << "<" << name << ">";
                                        out << ":";
                                        VarId var = wrapper.varmemory.ObjectMemberGet(wrapper.id, name, true);
                                        // Don't recurse into objects; infinite recursion aint cool.
                                        out << VarWrapper<printtype>(wrapper.varmemory, var, false);
                                }
                                out << "]";
                        }
                } break;

        default: ;
            out << wrapper.varmemory.GetType(wrapper.id);
        };
//        out << "{0x" << std::hex << wrapper.id << std::dec << "}";
        return out;
}

template <class X> std::ostream&  OutputSharedPtr(std::ostream &out, const std::shared_ptr<X> &ptr)
{
        if (ptr.get() == NULL)
            out << "NULL";
        else
            out << "*" << *ptr;
        return out;
}

template <class X, class Y> std::ostream&  OutputPair(std::ostream &out, const std::pair<X, Y> &pair)
{
        out << "(" << pair.first << ", " << pair.second << ")";
        return out;
}

template <class X> std::ostream&  OutputVector(std::ostream &out, const std::vector<X> &list)
{
        out << "V[";
        typename std::vector<X>::const_iterator it = list.begin();
        while (it != list.end())
        {
                out << *it;
                ++it;
                if (it != list.end())
                        out << ", ";
        }
        out << "]";
        return out;
}

template <class X> std::ostream& OutputList(std::ostream &out, const std::set<X> &list)
{
        out << "{";
        typename std::set<X>::const_iterator it = list.begin();
        while (it != list.end())
        {
                out << *it;
                ++it;
                if (it != list.end())
                        out << ", ";
        }
        out << "}";
        return out;
}

template <class X, class Y> std::ostream& OutputMap(std::ostream &out, const std::map<X, Y> &list)
{
        out << "{";
        typename std::map<X, Y>::const_iterator it = list.begin();
        while (it != list.end())
        {
                out << *it;
                ++it;
                if (it != list.end())
                        out << ", ";
        }
        out << "}";
        return out;
}

} // End of namespace HareScript


#endif

