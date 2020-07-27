//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_constants.h"

namespace HareScript
{

// Requirements for quick casting
static_assert(VariableTypes::Money > VariableTypes::Integer, "Variabletype Money must order after Integer, for quick casting");
static_assert(VariableTypes::Float > VariableTypes::Money, "Variabletype Float must order after Money, for quick casting");

std::string GetTypeName(VariableTypes::Type type)
{
        std::string x;
        switch (type & ~VariableTypes::Array)
        {
        case VariableTypes::Uninitialized:
                x = "UNINITIALIZED";
                break;
        case VariableTypes::Variant:
                x = "VARIANT";
                break;
        case VariableTypes::NoReturn:
                x = "*NORETURN*";
                break;
        case VariableTypes::TypeInfo:
                x = "*TYPEINFO*";
                break;

        case VariableTypes::Integer:
                x = "INTEGER";
                break;
        case VariableTypes::Integer64:
                x = "INTEGER64";
                break;
        case VariableTypes::Money:
                x = "MONEY";
                break;
        case VariableTypes::Float:
                x = "FLOAT";
                break;
        case VariableTypes::Boolean:
                x = "BOOLEAN";
                break;
        case VariableTypes::String:
                x = "STRING";
                break;
        case VariableTypes::Record:
                x = "RECORD";
                break;
        case VariableTypes::FunctionRecord:
                x = "FUNCTION PTR"; // This is a prettier name for the outside world
                break;
        case VariableTypes::Blob:
                x = "BLOB";
                break;
        case VariableTypes::DateTime:
                x = "DATETIME";
                break;
        case VariableTypes::Table:
                x = "TABLE";
                break;
        case VariableTypes::Schema:
                x = "SCHEMA";
                break;
        case VariableTypes::VMRef:
                x = "VMREF";
                break;
        case VariableTypes::Object:
                x = "OBJECT";
                break;
        case VariableTypes::WeakObject:
                x = "WEAKOBJECT";
                break;
        default:
                x = "unknown type #" + Blex::AnyToString((unsigned)type);
                break;
        }
        if (type & VariableTypes::Array)
            x += " ARRAY";
        return x;
}

std::string DBConditionCode::GetName(_type type)
{
        switch(type)
        {
        case Less:        return "<";
        case LessEqual:   return "<=";
        case Equal:       return "=";
        case Bigger:      return ">";
        case BiggerEqual: return ">=";
        case UnEqual:     return "!=";
        case Like:        return "LIKE";
        case In:          return "IN";
        }
        return "???";
}


namespace
{
InstructionCodeNamePair instructioncodenames[] = {
        { InstructionSet::ILLEGAL, "ILLEGAL" },
        { InstructionSet::CALL, "CALL" },
        { InstructionSet::JUMP, "JUMP" },
        { InstructionSet::JUMPC, "JUMPC" },
        { InstructionSet::JUMPC2, "JUMPC2" },
        { InstructionSet::JUMPC2F, "JUMPC2F" },
        { InstructionSet::NOP, "NOP" },
        { InstructionSet::RET, "RET" },
        { InstructionSet::DUP, "DUP" },
        { InstructionSet::POP, "POP" },
        { InstructionSet::SWAP, "SWAP" },
        { InstructionSet::CMP, "CMP" },
        { InstructionSet::CMP2, "CMP2" },
        { InstructionSet::LOADC, "LOADC" },
        { InstructionSet::LOADCB, "LOADCB" },
        { InstructionSet::LOADCI, "LOADCI" },
        { InstructionSet::RECORDCELLGET, "RECORDCELLGET" },
        { InstructionSet::RECORDCELLSET, "RECORDCELLSET" },
        { InstructionSet::RECORDCELLDELETE, "RECORDCELLDELETE" },
        { InstructionSet::RECORDCELLCREATE, "RECORDCELLCREATE" },
        { InstructionSet::RECORDCELLUPDATE, "RECORDCELLUPDATE" },
        { InstructionSet::RECORDMAKEEXISTING, "RECORDMAKEEXISTING" },
        { InstructionSet::LOADG, "LOADG" },
        { InstructionSet::LOADS, "LOADS" },
        { InstructionSet::LOADSD, "LOADSD" },
        { InstructionSet::LOADGD, "LOADGD" },
        { InstructionSet::STOREG, "STOREG" },
        { InstructionSet::STORES, "STORES" },
        { InstructionSet::INITVAR, "INITVAR" },
        { InstructionSet::DESTROYS, "DESTROYS" },
        { InstructionSet::COPYS, "COPYS" },
        { InstructionSet::LOADTYPEID, "LOADTYPEID" },
        { InstructionSet::ADD, "ADD" },
        { InstructionSet::SUB, "SUB" },
        { InstructionSet::MUL, "MUL" },
        { InstructionSet::DIV, "DIV" },
        { InstructionSet::MOD, "MOD" },
        { InstructionSet::NEG, "NEG" },
        { InstructionSet::INC, "INC" },
        { InstructionSet::DEC, "DEC" },
        { InstructionSet::AND, "AND" },
        { InstructionSet::OR, "OR" },
        { InstructionSet::XOR, "XOR" },
        { InstructionSet::NOT, "NOT" },
        { InstructionSet::ARRAYINDEX, "ARRAYINDEX" },
        { InstructionSet::ARRAYSIZE, "ARRAYSIZE" },
        { InstructionSet::ARRAYINSERT, "ARRAYINSERT" },
        { InstructionSet::ARRAYSET, "ARRAYSET" },
        { InstructionSet::ARRAYDELETE, "ARRAYDELETE" },
        { InstructionSet::ARRAYAPPEND, "ARRAYAPPEND" },
        { InstructionSet::ARRAYDELETEALL, "ARRAYDELETEALL" },
        { InstructionSet::BITAND, "BITAND"},
        { InstructionSet::BITOR, "BITOR"},
        { InstructionSet::BITXOR, "BITXOR"},
        { InstructionSet::BITNEG, "BITNEG"},
        { InstructionSet::BITLSHIFT, "BITLSHIFT"},
        { InstructionSet::BITRSHIFT, "BITRSHIFT"},
        { InstructionSet::MERGE, "MERGE" },
        { InstructionSet::CAST, "CAST" },
        { InstructionSet::ISIN, "ISIN" },
        { InstructionSet::LIKE, "LIKE" },
        { InstructionSet::CONCAT, "CONCAT" },
        { InstructionSet::CASTPARAM, "CASTPARAM" },
        { InstructionSet::CASTF, "CASTF" },
        { InstructionSet::INITFUNCTIONPTR, "INITFUNCTIONPTR" },
        { InstructionSet::YIELD, "YIELD" },
        { InstructionSet::THROW2, "THROW2" },
        { InstructionSet::THROW, "THROW" },
        { InstructionSet::PRINT, "PRINT" },
        { InstructionSet::INVOKEFPTR, "INVOKEFPTR" },
        { InstructionSet::INVOKEFPTRNM, "INVOKEFPTRNM" },
        { InstructionSet::OBJNEW, "OBJNEW" },
        { InstructionSet::OBJMEMBERGET, "OBJMEMBERGET" },
        { InstructionSet::OBJMEMBERGETTHIS, "OBJMEMBERGETTHIS" },
        { InstructionSet::OBJMEMBERSET, "OBJMEMBERSET" },
        { InstructionSet::OBJMEMBERSETTHIS, "OBJMEMBERSETTHIS" },
        { InstructionSet::OBJMEMBERINSERT, "OBJMEMBERINSERT" },
        { InstructionSet::OBJMETHODCALL, "OBJMETHODCALL" },
        { InstructionSet::OBJSETTYPE, "OBJSETTYPE" },
        { InstructionSet::OBJMETHODCALLTHIS, "OBJMETHODCALLTHIS" },
        { InstructionSet::OBJMAKEREFPRIV, "OBJMAKEREFPRIV" },
        { InstructionSet::OBJMETHODCALLNM, "OBJMETHODCALLNM" },
        { InstructionSet::OBJMETHODCALLTHISNM, "OBJMETHODCALLTHISNM" },
        { InstructionSet::OBJMEMBERISSIMPLE, "OBJMEMBERISSIMPLE" },
        { InstructionSet::DEEPSET, "DEEPSET" },
        { InstructionSet::DEEPSETTHIS, "DEEPSETTHIS" },
        { InstructionSet::DEEPARRAYAPPEND, "DEEPARRAYAPPEND" },
        { InstructionSet::DEEPARRAYAPPENDTHIS, "DEEPARRAYAPPENDTHIS" },
        { InstructionSet::DEEPARRAYDELETE, "DEEPARRAYDELETE" },
        { InstructionSet::DEEPARRAYDELETETHIS, "DEEPARRAYDELETETHIS" },
        { InstructionSet::DEEPARRAYINSERT, "DEEPARRAYINSERT" },
        { InstructionSet::DEEPARRAYINSERTTHIS, "DEEPARRAYINSERTTHIS" },
        { InstructionSet::ISDEFAULTVALUE, "ISDEFAULTVALUE" },
        { InstructionSet::ISVALUESET, "ISVALUESET" },
        { InstructionSet::OBJTESTNONSTATIC, "OBJTESTNONSTATIC" },
        { InstructionSet::OBJTESTNONSTATICTHIS, "OBJTESTNONSTATICTHIS" },
        { InstructionSet::OBJMEMBERDELETE, "OBJMEMBERDELETE" },
        { InstructionSet::OBJMEMBERINSERTTHIS, "OBJMEMBERINSERTTHIS" },
        { InstructionSet::OBJMEMBERDELETETHIS, "OBJMEMBERDELETETHIS" },
        };
} //end anonymous namespace

InstructionCodeNameMap cachedmap;
InstructionCodeNameReverseMap cachedreversemap;

const InstructionCodeNamePair* GetInstructionCodeNameList(unsigned &len)
{
        len = sizeof(instructioncodenames)/ sizeof(instructioncodenames[0]);
        return instructioncodenames;
}

const InstructionCodeNameReverseMap & GetInstructionCodeNameReverseMap()
{
        if (cachedreversemap.empty())
        {
                unsigned len;
                const InstructionCodeNamePair* list = GetInstructionCodeNameList(len);
                for (unsigned idx = 0; idx < len; ++idx)
                    cachedreversemap.insert(std::make_pair(list[idx].name, list[idx].id));
        }
        return cachedreversemap;
}

const InstructionCodeNameMap & GetInstructionCodeNameMap()
{
        if (cachedmap.empty())
        {
                unsigned len;
                const InstructionCodeNamePair* list = GetInstructionCodeNameList(len);
                for (unsigned idx = 0; idx < len; ++idx)
                    cachedmap.insert(std::make_pair(list[idx].id, list[idx].name));
        }
        return cachedmap;
}

std::ostream & operator << (std::ostream &out, IPCMessageState::Type type)
{
        switch (type)
        {
        case IPCMessageState::None:             out << "None";break;
        case IPCMessageState::SentMessage:      out << "SentMessage";  break;
        case IPCMessageState::SentRequest:      out << "SentRequest";  break;
        case IPCMessageState::Processing:       out << "Processing"; break;
        case IPCMessageState::SentReply:        out << "SentReply"; break;
        case IPCMessageState::Cancelled:        out << "Cancelled"; break;
        default:
           out << "???";
        }
        return out;
}

const char * GetRunningStateName(RunningState::Type type)
{
        switch (type)
        {
        case RunningState::Startup:         return "Startup";
        case RunningState::InitialRunnable: return "InitialRunnable";
        case RunningState::Runnable:        return "Runnable";
        case RunningState::DebugStopped:    return "DebugStopped";
        case RunningState::Running:         return "Running";
        case RunningState::Suspending:      return "Suspending";
        case RunningState::WaitForMultiple: return "WaitForMultiple";
        case RunningState::Locked:          return "Locked";
        case RunningState::Terminated:      return "Terminated";
        default:
           return "???";
        }
}

std::ostream & operator << (std::ostream &out, RunningState::Type type)
{
        return out << GetRunningStateName(type);
}

DBTypeInfo::DBTypeInfo()
{
}

DBTypeInfo::~DBTypeInfo()
{
}

signed DBTypeInfo::FindColumn(ColumnNameId nameid) const
{
        for (ColumnsDef::const_iterator it = columnsdef.begin(); it != columnsdef.end(); ++it)
            if (it->nameid == nameid)
                return std::distance<ColumnsDef::const_iterator>(columnsdef.begin(), it);
        return -1;
}

DBTypeInfo::Column::Column()
: type (VariableTypes::Uninitialized)
, flags (ColumnFlags::None)
{
}


bool DBTypeInfo::Column::operator ==(Column const &rhs) const
{
        if (name != rhs.name) return false;
        if (dbase_name != rhs.dbase_name) return false;
        if (type != rhs.type) return false;
        if (flags != rhs.flags) return false;
        if (null_default != rhs.null_default) return false;
        return true;
}

VarMemRefCounted::~VarMemRefCounted()
{
}
void VarMemRefCounted::InternalAddReference()
{
        ++refcount;
}

void VarMemRefCounted::InternalRemoveReference()
{
        if (--refcount == 0)
            delete this;
}

std::ostream & operator <<(std::ostream &out, StackElementType::Type type)
{
        switch (type)
        {
        case StackElementType::Return:          out << "Return"; break;
        case StackElementType::StopExecute:     out << "StopExecute"; break;
        case StackElementType::TailCall:        out << "TailCall"; break;
        case StackElementType::Dummy:           out << "Dummy"; break;
        case StackElementType::PopVariable:     out << "PopVariable"; break;
        case StackElementType::ReturnToOtherVM: out << "ReturnToOtherVM"; break;
        case StackElementType::SwitchToOtherVM: out << "SwitchToOtherVM"; break;
        default: out << "???";
        }
        return out;
}

bool CanAlwaysCastTo(VariableTypes::Type from, VariableTypes::Type to)
{
        if (to == VariableTypes::Variant)
            return true;
        if (from == to)
            return true;
        switch (to)
        {
        case VariableTypes::Record:       return from == VariableTypes::RecordArray;
        case VariableTypes::Integer64:    return from == VariableTypes::Integer;
        case VariableTypes::Money:        return from == VariableTypes::Integer;
        case VariableTypes::Float:        return from == VariableTypes::Integer || from == VariableTypes::Money || from == VariableTypes::Integer64;
        case VariableTypes::VariantArray: return from & VariableTypes::Array;
        default: ;
        }
        return false;
}

bool CanCastTo(VariableTypes::Type from, VariableTypes::Type to)
{
        if (from == VariableTypes::Variant)
            return true;
        return CanAlwaysCastTo(from, to);
}

} // End of namespace HareScript
