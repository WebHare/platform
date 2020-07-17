#include <harescript/vm/allincludes.h>

#include "../vm/hsvm_librarywrapper.h"
#include "../vm/hsvm_constants.h"
#include "../compiler/debugprints.h"
#include "../vm/hsvm_stackmachine.h"
#include "../vm/hsvm_marshalling.h"
#include <blex/path.h>
#include <blex/zstream.h>

namespace HareScript
{

//using namespace LibraryWrapper;

bool corrupt = false;

std::string StringEncode(std::string str)
{
        for (signed idx = 0; idx < (signed)str.size(); ++idx)
            if (str[idx] == '\r')
               str.erase(str.begin() + idx--);
            else if (str[idx] == '\n')
            {
                    str[idx] = 'n';
                    str.insert(str.begin() + idx, '\\');
            } else if (str[idx] == '"')
            {
                    str.insert(str.begin() + idx++, '\\');
            }
        return "\"" + str + "\"";
}


/// CWrapperPrinter is a wrapper for an ostream to print a constant from the constantssection of a wrapped library
struct CWrapperPrinter
{
        StackMachine * stackm;
        Marshaller *marshaller;
        WrappedLibrary * first;
        int32_t second;
        CWrapperPrinter(StackMachine * _stackm, Marshaller *_marshaller, WrappedLibrary * first, int32_t second) : stackm(_stackm), marshaller(_marshaller), first(first), second(second) {}
};

std::ostream& operator <<(std::ostream &out, VariableTypes::Type type)
{
        return out << GetTypeName(type) << " (" << (unsigned)type << ")";
}

std::ostream& PrintVariable(std::ostream& out, StackMachine &stackm, VarId var)
{
        if (stackm.GetType(var) & VariableTypes::Array)
        {
                out << "[";
                unsigned len = stackm.ArraySize(var);
                for (unsigned idx = 0; idx < len; ++idx)
                {
                        if (idx != 0) out << ", ";
                        PrintVariable(out, stackm, stackm.ArrayElementRef(var, idx));
                }
                return out << "]";
        }
        switch (stackm.GetType(var))
        {
        case VariableTypes::Integer:   return out << (stackm.GetInteger(var));
        case VariableTypes::Boolean:   return out << (stackm.GetBoolean(var) ? "TRUE" : "FALSE");
        case VariableTypes::Money:     return out << (stackm.GetMoney(var) / 10000);
        case VariableTypes::DateTime:  return out << (stackm.GetDateTime(var).GetTimeT());
        case VariableTypes::String:    return out << StringEncode(stackm.GetSTLString(var));
        case VariableTypes::Float:     return out << (stackm.GetFloat(var));
        case VariableTypes::Record:
                {
                        out << "[";
                        unsigned len = stackm.RecordSize(var);
                        for (unsigned idx = 0; idx < len; ++idx)
                        {
                                if (idx != 0) out << ", ";
                                ColumnNameId nameid = stackm.RecordCellNameByNr(var, idx);
                                out << StringEncode(stackm.columnnamemapper.GetReverseMapping(nameid).stl_str());
                                out << " := ";
                                PrintVariable(out, stackm, stackm.RecordCellRefByName(var, nameid));
                        }
                        return out << "]";
                };
        default: ;
            return out << "DEFAULT " << stackm.GetType(var);
        }
//        return out << "UNKNOWN TYPE";
}

std::ostream& operator <<(std::ostream &out, CWrapperPrinter data)
{
        VarId var = data.stackm->NewHeapVariable();
        uint8_t const *buf = data.first->GetConstantBuffer(data.second);
        uint8_t const *limit = buf + data.first->GetConstantBufferLength(data.second);
        data.marshaller->Read(var, buf, limit);

        PrintVariable(out, *data.stackm, var);

        data.stackm->DeleteHeapVariable(var);
        return out << "<" << data.second << ">";
}

std::string FunctionName(WrappedLibrary &wlib, int32_t id)
{
        if (id >= static_cast<signed>(wlib.FunctionList().size()) || id < 0)
        {
                corrupt = true;
                return "__LIBRARY CORRUPT__";
        }
        return wlib.linkinfo.GetNameStr(wlib.FunctionList()[id].name_index);
}
std::string LibraryPath(WrappedLibrary &wlib, int32_t id)
{
        if (id >= static_cast<signed>(wlib.LibraryList().size()) || id < 0)
        {
                corrupt = true;
                return "__LIBRARY CORRUPT__";
        }
        return wlib.linkinfo.GetNameStr(wlib.LibraryList()[id].liburi_index);
}
int32_t ConstantIndex(WrappedLibrary &wlib, int32_t id)
{
        return wlib.resident.c_indexes[id];
}

//---------------------------------------------------------------------------
} // End of namespace HareScript

using namespace HareScript;

void DumpTypeInfoColumn(StackMachine &stackm, Marshaller &marshaller, DBTypeInfo::Column const &column, bool is_view)
{
        if (column.name != column.dbase_name) std::cout << "'" << column.dbase_name << "' AS ";
        std::cout << column.name << ": " << column.type;
        if (column.flags != ColumnFlags::None)
        {
                std::cout << " (Flags:";
                if (column.flags & ColumnFlags::InternalFase1) std::cout << " Fase1";
                if (column.flags & ColumnFlags::InternalFase2) std::cout << " Fase2";
                if (column.flags & ColumnFlags::InternalUpdates) std::cout << " InternalUpdates";
                if (column.flags & ColumnFlags::InternalUsedInCondition) std::cout << " InternalUsedInCondition";
                if (column.flags & ColumnFlags::Key) std::cout << " Key";
                if (column.flags & ColumnFlags::ReadOnly) std::cout << " ReadOnly";
                if (column.flags & ColumnFlags::WarnUnindexed) std::cout << " WarnUnindexed";
                if (column.flags & ColumnFlags::TranslateNulls)
                {
                        if (!column.null_default.empty())
                        {
                                VarId var = stackm.NewHeapVariable();
                                marshaller.Read(var, &column.null_default[0], &column.null_default[0] + column.null_default.size());
                                std::cout << " NULL:=";
                                PrintVariable(std::cout, stackm, var);
                                stackm.DeleteHeapVariable(var);
                        }
                        else
                            std::cout << "** MISSING NULL DEFAULT **";
                }
                std::cout << ")";
        }
        if (is_view)
        {
                std::cout << " := ";
                if (!column.view_value.empty())
                {
                      VarId var = stackm.NewHeapVariable();
                      marshaller.Read(var, &column.view_value[0], &column.view_value[0] + column.view_value.size());
                      PrintVariable(std::cout, stackm, var);
                      stackm.DeleteHeapVariable(var);
                }
                else
                    std::cout << "** MISSING VIEW VALUE **";
        }
}

int UTF8Main(std::vector<std::string> const &args)
{
        if (args.size() < 2 || args.size() > 3 || (args.size() == 3 && (strcmp(args[2].c_str(), "/code") && strcmp(args[2].c_str(), "/all"))))
        {
                std::cout << "Syntax (case sensitive): LibDumper library [/code] " << std::endl;
                return 1;
        };
        bool showcode = (args.size() == 3);
        bool showall = args.size() == 3 && args[2] == "/all";

        std::unique_ptr<Blex::FileStream> x(Blex::FileStream::OpenRead(args[1]));
        if (x.get() == NULL)
        {
                std::cout << "Could not open file " << args[1] << std::endl;
                return 1;
        };

        ColumnNames::GlobalMapper gmapper;
        ColumnNames::LocalMapper mapper(gmapper);
        StackMachine stackm(mapper);
        Marshaller marshaller(stackm, MarshalMode::SimpleOnly);

        WrappedLibrary wlib;
        wlib.ReadLibrary(args[1], &*x);
        std::map<unsigned, std::string> functions;

        std::vector< ColumnNameId > columnnamelist;
        for (unsigned i=0;i<wlib.linkinfo.columnidx.size();++i)
        {
                Blex::StringPair colname = wlib.linkinfo.GetName(wlib.linkinfo.columnidx[i]);
                columnnamelist.push_back(stackm.columnnamemapper.GetMapping(colname.size(),colname.begin));
        }
        marshaller.SetLibraryColumnNameDecoder(&columnnamelist);

        std::cout << "Dumping library '" << args[1] << "'" << std::endl;

        std::cout << std::endl << "Header:"<<std::endl;
        std::cout << " compile_id:              " << wlib.resident.compile_id << std::endl;
        std::cout << " sourcetime:              " << wlib.resident.sourcetime << std::endl;
        if (wlib.resident.initfunction != -1)
                std::cout << " init function:           " << FunctionName(wlib, wlib.resident.initfunction) << std::endl;
        else
                std::cout << " init function:           none" << std::endl;

        if (wlib.resident.deinitfunction != -1)
                std::cout << " deinit function:         " << FunctionName(wlib, wlib.resident.deinitfunction) << std::endl;
        else
                std::cout << " deinit function:         none" << std::endl;

        if (wlib.resident.scriptproperty_fileid != 0)
            std::cout << " scriptproperty fileid:   " << wlib.resident.scriptproperty_fileid << std::endl;
        if (wlib.resident.scriptproperty_filecreationdate != Blex::DateTime::Min())
            std::cout << " scriptproperty filecreationdate: " << wlib.resident.scriptproperty_filecreationdate << std::endl;
        if (wlib.resident.scriptproperty_systemredirect != 0)
            std::cout << " scriptproperty systemredirect: " << (wlib.resident.scriptproperty_systemredirect ? "true" : "false") << std::endl;

        std::cout << std::endl;

        std::cout << "Libraries section"<<std::endl;
        std::cout << " Libraries"<<std::endl;
        for (std::vector<LoadedLibraryDef>::iterator it = wlib.linkinfo.libraries.begin();
                it != wlib.linkinfo.libraries.end(); ++it)
        {
                std::cout<< "  Library " << std::distance(wlib.linkinfo.libraries.begin(), it)<< ": ";
                if (it->indirect)
                        std::cout<< "indirectly ";
//                else
                std::cout << "uses library ";
                std::cout << "'" << wlib.linkinfo.GetNameStr(it->liburi_index) << "'" << " (id: "<<it->clib_id<<") "<< std::endl;
        };
        if (wlib.linkinfo.libraries.begin() == wlib.linkinfo.libraries.end())
            std::cout << "  none" << std::endl;
        std::cout << std::endl;

        std::cout << "Global variable section"<<std::endl;
        std::cout << " size of global area:     " << wlib.resident.globalareasize << std::endl;
        std::cout << " Global variables"<<std::endl;
        for (std::vector<VariableDef>::iterator it = wlib.linkinfo.variables.begin();
                it != wlib.linkinfo.variables.end(); ++it)
        {
                std::cout << "  Variable "<<std::distance(wlib.linkinfo.variables.begin(),it)<<": "<<wlib.linkinfo.GetNameStr(it->name_index)<<" ("<<it->resulttype<<") ";
                if (it->symbolflags & SymbolFlags::Public) std::cout << "PUBLIC ";
                if (it->symbolflags & SymbolFlags::Deprecated) std::cout << "DEPRECATED ";
                if (it->constantexprid != -1) std::cout << "CONSTANT "<<CWrapperPrinter(&stackm, &marshaller, &wlib, it->constantexprid) << " ";
                else if (it->is_constref) std::cout << "__CONSTREF ";
                if (it->symbolflags & SymbolFlags::Imported)
                        std::cout << "IMPORTED from '"<<LibraryPath(wlib, it->library)<<" (lib:"<<it->library<<")";
                else
                {
                        std::cout << "Location: "<<it->globallocation;
                        if (it->globallocation >= wlib.resident.globalareasize)
                        {
                                std::cout << " __LIBRARY CORRUPT__";
                                corrupt = true;
                        }
                }
                std::cout << std::endl;
        };
        if (wlib.linkinfo.variables.begin() == wlib.linkinfo.variables.end())
            std::cout << "  none" << std::endl;
        std::cout << std::endl;

        std::cout << "Function section"<<std::endl;
        std::cout << " Functions"<<std::endl;
        for (std::vector<FunctionDef>::iterator it = wlib.linkinfo.functions.begin();
                it != wlib.linkinfo.functions.end(); ++it)
        {
                std::cout << "  Function "<<std::distance(wlib.linkinfo.functions.begin(),it)<<": "<<wlib.linkinfo.GetNameStr(it->name_index)<<" ";
                if (it->symbolflags & SymbolFlags::Public) std::cout << "PUBLIC ";
                if (it->symbolflags & SymbolFlags::Deprecated) std::cout << "DEPRECATED ";
                if (it->flags & FunctionFlags::Constant) std::cout << "CONSTANT ";
                if (it->flags & FunctionFlags::External) std::cout << "EXTERNAL ";
                if (it->flags & FunctionFlags::Aggregate) std::cout << "AGGREGATE ";
                if (it->flags & FunctionFlags::Terminates) std::cout << "TERMINATES ";
                if (it->flags & FunctionFlags::ExecutesHarescript) std::cout << "EXECUTESHARESCRIPT ";
                if (it->flags & FunctionFlags::IsCount) std::cout << "ISCOUNT ";
                if (it->flags & FunctionFlags::Constructor) std::cout << "CONSTRUCTOR ";
                if (it->flags & FunctionFlags::IsSpecial) std::cout << "ISSPECIAL ";
                if (it->flags & FunctionFlags::ObjectMember) std::cout << "OBJECTMEMBER ";
                if (it->flags & FunctionFlags::NoStateModify) std::cout << "NOSTATEMODIFY ";
                if (it->dllname_index != 0)  std::cout << "\"" << wlib.linkinfo.GetNameStr(it->dllname_index) << "\" ";
                if (it->symbolflags & SymbolFlags::Imported)
                        std::cout << "IMPORTED from '"<<LibraryPath(wlib, it->library)<<"' (lib:"<<it->library<<")";
                std::cout << std::endl;
                std::cout << "   parameters: ";
                for (FunctionDef::Parameters::iterator it2 = it->parameters.begin();
                        it2 != it->parameters.end(); ++it2)
                {
                        if (it2 != it->parameters.begin()) std::cout << ", ";
                        std::cout << it2->type << " " << wlib.linkinfo.GetNameStr(it2->name_index);
                        if (it2->defaultid != -1) std::cout << ":= "<<CWrapperPrinter(&stackm, &marshaller, &wlib, it2->defaultid);
                }
                if (it->parameters.empty())
                    std::cout << "none";
                std::cout << std::endl;
                std::cout << "   returnvalues: " << it->resulttype;
                std::cout << std::endl;
                std::cout << "   number of local variables: " << it->localvariablecount << std::endl;
                if (!(it->symbolflags & SymbolFlags::Imported) && !(it->flags & FunctionFlags::External))
                {
                        std::cout << "   code location: " << it->codelocation;
                        if (it->codelocation >= (signed)wlib.resident.code.size())
                        {
                                std::cout << " __LIBRARY CORRUPT__";
                                corrupt = true;
                        };
                        std::cout << std::endl;
                        functions[it->codelocation] = wlib.linkinfo.GetNameStr(it->name_index);
                }
                std::cout << "   definition position: " << it->definitionposition.line << ":" << it->definitionposition.column << std::endl;
        };
        if (wlib.linkinfo.variables.begin() == wlib.linkinfo.variables.end())
            std::cout << "  none" << std::endl;
        std::cout << std::endl;

        std::cout << "Object types section"<<std::endl;
        std::cout << " Object types"<<std::endl;
        for (std::vector< ObjectTypeDef >::iterator it = wlib.linkinfo.objecttypes.begin();
                it != wlib.linkinfo.objecttypes.end(); ++it)
        {
                std::cout << "  Object type "<<std::distance(wlib.linkinfo.objecttypes.begin(),it)<<": "<<wlib.linkinfo.GetNameStr(it->name_index)<<" ";
                if (it->base != -1)
                    std::cout << "EXTEND " << wlib.linkinfo.GetNameStr(wlib.linkinfo.objecttypes[it->base].name_index) << " ";
                if (it->symbolflags & SymbolFlags::Public) std::cout << "PUBLIC ";
                if (it->symbolflags & SymbolFlags::Deprecated) std::cout << "DEPRECATED ";
                if (it->symbolflags & SymbolFlags::Imported)
                        std::cout << "IMPORTED from '"<<LibraryPath(wlib, it->library)<<"' (lib:"<<it->library<<")";
                std::cout << std::endl;
                std::cout << "   Constructor: ";
                std::cout << "function "<<it->constructor<<": "<<wlib.linkinfo.GetNameStr(wlib.linkinfo.functions[it->constructor].name_index)<<std::endl;
                for (std::vector< ObjectCellDef >::iterator it2 = it->cells.begin();
                        it2 != it->cells.end(); ++it2)
                {
                        switch (it2->type)
                        {
                        case ObjectCellType::Member:   std::cout << "   MEMBER " << it2->resulttype; break;
                        case ObjectCellType::Method:   std::cout << "   METHOD " << it2->resulttype; break;
                        case ObjectCellType::Property: std::cout << "   PROPERTY"; break;
                        default: ;
                        }
                        std::cout << " "<<wlib.linkinfo.GetNameStr(it2->name_index);
                        if (it2->type == ObjectCellType::Method)
                        {
                                std::cout << "(";
                                for (FunctionDef::Parameters::iterator it3 = it2->parameters.begin();
                                        it3 != it2->parameters.end(); ++it3)
                                {
                                        if (it3 != it2->parameters.begin()) std::cout << ", ";
                                        std::cout << it3->type << " " << wlib.linkinfo.GetNameStr(it3->name_index);
                                        if (it3->defaultid != -1) std::cout << ":= "<<CWrapperPrinter(&stackm, &marshaller, &wlib, it3->defaultid);
                                }
                                std::cout << ")";
                        }
                        if (it2->symbolflags & SymbolFlags::Deprecated) std::cout << " DEPRECATED";
                        if (it2->is_update) std::cout << " UPDATE";
                        if (it2->is_private) std::cout << " PRIVATE";
                        if (it2->method != -1) std::cout << " <" << it2->method << ">";
                        if (it2->type == ObjectCellType::Property)
                        {
                                std::cout << " (";
                                std::string getter = wlib.linkinfo.GetNameStr(it2->getter_name_index);
                                std::cout << (getter.empty() ? "-" : getter.c_str());
                                std::cout << ", ";
                                std::string setter = wlib.linkinfo.GetNameStr(it2->setter_name_index);
                                std::cout << (setter.empty() ? "-" : setter.c_str());
                                std::cout << ")";
                        }
                        std::cout << std::endl;
                }
                std::cout << "   Uids:" << std::endl;
                for (std::vector< uint32_t >::iterator it2 = it->uid_indices.begin(); it2 != it->uid_indices.end(); ++it2)
                    std::cout << "    " << wlib.linkinfo.GetNameStr(*it2) << std::endl;
        }
        if (wlib.linkinfo.objecttypes.begin() == wlib.linkinfo.objecttypes.end())
            std::cout << "  none" << std::endl;
        std::cout << std::endl;

        std::cout << "Constants section"<<std::endl;
        std::cout << " Constants"<<std::endl;
        for (unsigned idx = 0; idx < wlib.resident.c_indexes.size() - 1; ++idx)
        {
                std::cout << "  Constant "<<idx<< " value " << CWrapperPrinter(&stackm, &marshaller, &wlib, idx) << " ("<<ConstantIndex(wlib, idx)<<")"<<std::endl;
        };
        if (wlib.resident.c_indexes.empty())
            std::cout << "  none" << std::endl;
        std::cout << std::endl;

        std::cout << "Types section"<<std::endl;
        std::cout << " Types"<<std::endl;
        if (wlib.resident.types.empty())
            std::cout << "  none" << std::endl;
        else
            for (unsigned idx = 0; idx < wlib.resident.types.size(); ++idx)
            {
                    DBTypeInfo const &typeinfo = wlib.resident.types[idx];
                    std::cout << "  Type "<<idx<< ": ";
                    std::cout << typeinfo.type;
                    if (!typeinfo.columnsdef.empty())
                    {
                            std::cout << " <" << std::endl;
                            for (auto it = typeinfo.columnsdef.begin(); it != typeinfo.columnsdef.end(); ++it)
                            {
                                    std::cout << "   ";
                                    DumpTypeInfoColumn(stackm, marshaller, *it, false);
                                    if (it + 1 != typeinfo.columnsdef.end()) std::cout << ", " << std::endl;
                            }
                            if (!typeinfo.viewcolumnsdef.empty())
                            {
                                    std::cout << ";" << std::endl;
                                    for (auto it = typeinfo.viewcolumnsdef.begin(); it != typeinfo.viewcolumnsdef.end(); ++it)
                                    {
                                            std::cout << "   WHERE ";
                                            DumpTypeInfoColumn(stackm, marshaller, *it, true);
                                            if (it + 1 != typeinfo.viewcolumnsdef.end()) std::cout << ", " << std::endl;
                                    }
                            }
                            std::cout << " >";
                    }
                    if (!typeinfo.tablesdef.empty())
                    {
                            std::cout << " <" << std::endl;
                            for (auto it = typeinfo.tablesdef.begin(); it != typeinfo.tablesdef.end(); ++it)
                            {
                                    std::cout << "    TABLE " << it->dbase_name << " AS " << it->name << " < " << std::endl;
                                    for (auto it2 = it->columnsdef.begin(); it2 != it->columnsdef.end(); ++it2)
                                    {
                                            std::cout << "     ";
                                            DumpTypeInfoColumn(stackm, marshaller, *it2, false);
                                            if (it2 + 1 != it->columnsdef.end()) std::cout << ", " << std::endl;
                                    }
                                    if (!it->viewcolumnsdef.empty())
                                    {
                                            std::cout << ";" << std::endl;
                                            for (auto it2 = it->viewcolumnsdef.begin(); it2 != it->viewcolumnsdef.end(); ++it2)
                                            {
                                                    std::cout << "     WHERE ";
                                                    DumpTypeInfoColumn(stackm, marshaller, *it2, true);
                                                    if (it2 + 1 != it->viewcolumnsdef.end()) std::cout << ", " << std::endl;
                                            }
                                    }
                                    std::cout << " >" << std::endl;
                                    if (it + 1 != typeinfo.tablesdef.end()) std::cout << ", " << std::endl;
                            }
                            std::cout << "    >";
                    }
                    std::cout << std::endl;
            };
        std::cout << std::endl;

        std::cout << "Column names section"<<std::endl;
        std::cout << " Column names"<<std::endl;
        if (wlib.linkinfo.columnidx.empty())
            std::cout << "  none" << std::endl;
        else
            for (unsigned idx = 0; idx < wlib.linkinfo.columnidx.size(); ++idx)
            {
                uint32_t nameindex = wlib.linkinfo.columnidx[idx];
                std::cout << "  id "<< idx << ": " << wlib.linkinfo.GetNameStr(nameindex) << std::endl;
            };
        std::cout << std::endl;

        std::cout << "Unwindinfo" << std::endl;
        if (wlib.exceptions.unwindentries.Empty())
            std::cout << " none" << std::endl;
        else
        {
                for (Blex::MapVector<uint32_t, SectionExceptions::UnwindInfo>::iterator it = wlib.exceptions.unwindentries.Begin(), end = wlib.exceptions.unwindentries.End(); it != end; ++it)
                    std::cout << " " << it->first << " -> " << it->second.target << ", new stack size: " << it->second.stacksize << std::endl;
        }
        std::cout << std::endl;

        if (showcode)
        {
/*                std::cout << "Line numbers"<<std::endl;
                for (Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::const_iterator lit = wlib.debug.debugentries.Begin(); lit != wlib.debug.debugentries.End(); ++lit)
                {
                        std::cout.width(5);
                        std::cout << lit->first;
                        std::cout << "(";
                        std::cout.width(4);
                        std::cout << lit->second.line << ",";
                        std::cout.width(2);
                        std::cout << lit->second.column << ")" << std::endl;
                }
                std::cout << std::endl;*/

                std::cout << "Code section"<<std::endl;
                for (unsigned idx = 0; idx < wlib.resident.code.size();++idx)
                {
                        if (functions.find(idx) != functions.end())
                            std::cout << std::endl << "FUNCTION " << functions[idx] << std::endl;
                        std::cout.width(5);
                        std::cout << idx;
                        Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::const_iterator entry = wlib.debug.debugentries.LowerBound(idx + 1);
                        if (entry != wlib.debug.debugentries.Begin())
                            --entry;
                        if (entry != wlib.debug.debugentries.End())
                        {
                                LineColumn it = entry->second;
                                std::cout << "(";
                                std::cout.width(4);
                                std::cout << it.line << ",";
                                std::cout.width(2);
                                std::cout << it.column << ")";
                        }
                        else
                            std::cout << "         ";
                        std::cout << " ";

                        std::cout.width(0);
                        InstructionSet::_type icode = static_cast<InstructionSet::_type>(wlib.resident.code[idx]);
                        std::string iname = "??? ("+Blex::AnyToString<int>(icode) +")";
                        if (GetInstructionCodeNameMap().find(icode) != GetInstructionCodeNameMap().end())
                            iname = GetInstructionCodeNameMap().find(icode)->second;
                        std::cout << " " << iname << " ";
                        switch (icode)
                        {
                        case InstructionSet::CALL:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << wlib.linkinfo.GetNameStr(wlib.FunctionList()[id].name_index) << " ";
                                        if (wlib.FunctionList()[id].symbolflags & SymbolFlags::Imported)
                                            std::cout << " (" << LibraryPath(wlib, wlib.FunctionList()[id].library) << ")";
                                        else if(!(wlib.FunctionList()[id].flags & FunctionFlags::External))
                                            std::cout << " (" << wlib.FunctionList()[id].codelocation << ")";
                                }; break;
                        case InstructionSet::JUMP:
                        case InstructionSet::JUMPC:
                        case InstructionSet::JUMPC2:
                        case InstructionSet::JUMPC2F:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << (idx+1+id);
                                }; break;
                        case InstructionSet::LOADS:
                        case InstructionSet::STORES:
                        case InstructionSet::LOADSD:
                        case InstructionSet::DESTROYS:
                        case InstructionSet::COPYS:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << id;
                                }; break;
                        case InstructionSet::LOADG:
                        case InstructionSet::STOREG:
                        case InstructionSet::LOADGD:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << id << " (" << wlib.linkinfo.GetNameStr(wlib.linkinfo.variables[id].name_index) << ")";
                                }; break;
                        case InstructionSet::LOADC:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << CWrapperPrinter(&stackm, &marshaller, &wlib, id);
                                }
                                break;
                        case InstructionSet::LOADCB:
                                {
                                        int8_t val = wlib.resident.code[idx+1];
                                        ++idx;
                                        std::cout << (val ? "TRUE" : "FALSE");
                                }
                                break;
                        case InstructionSet::LOADCI:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << id;
                                }
                                break;
                        case InstructionSet::RECORDCELLGET:
                        case InstructionSet::RECORDCELLSET:
                        case InstructionSet::RECORDCELLCREATE:
                        case InstructionSet::RECORDCELLDELETE:
                        case InstructionSet::RECORDCELLUPDATE:
                        case InstructionSet::OBJMEMBERGET:
                        case InstructionSet::OBJMEMBERGETTHIS:
                        case InstructionSet::OBJMEMBERSET:
                        case InstructionSet::OBJMEMBERSETTHIS:
                        case InstructionSet::OBJMEMBERDELETE:
                        case InstructionSet::OBJMEMBERDELETETHIS:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << wlib.linkinfo.GetNameStr(wlib.linkinfo.columnidx[id]);
                                }
                                break;
                        case InstructionSet::OBJMEMBERINSERT:
                        case InstructionSet::OBJMEMBERINSERTTHIS:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << wlib.linkinfo.GetNameStr(wlib.linkinfo.columnidx[id]);
                                        bool is_private = wlib.resident.code[idx+1];
                                        ++idx;
                                        std::cout << (is_private ? " PRIVATE" : " PUBLIC");
                                }
                                break;
                        case InstructionSet::OBJMETHODCALL:
                        case InstructionSet::OBJMETHODCALLTHIS:
                        case InstructionSet::OBJMETHODCALLNM:
                        case InstructionSet::OBJMETHODCALLTHISNM:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        int32_t pcount = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << wlib.linkinfo.GetNameStr(wlib.linkinfo.columnidx[id]) << " (" << pcount << " params)";
                                }
                                break;
                        case InstructionSet::LOADTYPEID:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << id;
                                }
                                break;
                        case InstructionSet::INITVAR:
                        case InstructionSet::CAST:
                        case InstructionSet::CASTF:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << HareScript::GetTypeName((VariableTypes::Type)id);
                                }
                                break;
                        case InstructionSet::CASTPARAM:
                                {
                                        int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << HareScript::GetTypeName((VariableTypes::Type)id) << " ";
                                        id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                        idx+=4;
                                        std::cout << wlib.linkinfo.GetNameStr(wlib.FunctionList()[id].name_index) << " ";
                                        if (wlib.FunctionList()[id].symbolflags & SymbolFlags::Imported)
                                            std::cout << " (" << LibraryPath(wlib, wlib.FunctionList()[id].library) << ")";
                                        else if(!(wlib.FunctionList()[id].flags & FunctionFlags::External))
                                            std::cout << " (" << wlib.FunctionList()[id].codelocation << ")";
                                }
                                break;
                        default: ;
                        }
                        std::cout << std::endl;
                        Blex::MapVector<uint32_t, SectionExceptions::UnwindInfo>::iterator uit = wlib.exceptions.unwindentries.Find(idx+1);
                        if (uit != wlib.exceptions.unwindentries.End())
                            std::cout << "                  on exception jump to: " << uit->second.target << ", new stack size: " << uit->second.stacksize << std::endl;
                }
        }
        if (showall)
        {
                std::cout << "DebugInfo section" << std::endl;

                Blex::MemoryRWStream compressed;
                if (!wlib.debuginfo.data.empty())
                {
                        compressed.DirectWrite(0, &wlib.debuginfo.data[0], wlib.debuginfo.data.size());
                        compressed.SetOffset(0);

                        std::unique_ptr< Blex::ZlibDecompressStream > decompressor(Blex::ZlibDecompressStream::OpenGzip(compressed));

                        while (true)
                        {
                                char buffer[1024];
                                unsigned len = decompressor->Read(buffer, 1024);
                                if (!len)
                                    break;
                                std::cout << std::string(buffer, buffer + len);
                        }
                }
        }
        if (corrupt)
        {
                std::cout<<std::endl;
                std::cout<<"This library is corrupt. Be warned!"<<std::endl;
        }
        return 0;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
