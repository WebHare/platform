#include <harescript/vm/allincludes.h>

#include <blex/path.h>
#include <blex/docfile.h>
#include "hsvm_dllinterface_blex.h"
#include "baselibs.h"

namespace HareScript {
namespace Baselibs {

std::string LibraryPath(WrappedLibrary const &wlib, int32_t id)
{
        if (id >= static_cast<signed>(wlib.LibraryList().size()) || id < 0)
                return "__LIBRARY CORRUPT__";

        return wlib.linkinfo.GetNameStr(wlib.LibraryList()[id].liburi_index);
}

void DoLibdump(HSVM *vm, VarId id_set, HareScript::WrappedLibrary const &wlib)
{
        HSVM_ColumnId col_code         = HSVM_GetColumnId(vm, "CODE");
        HSVM_ColumnId col_codeptr      = HSVM_GetColumnId(vm, "CODEPTR");
        HSVM_ColumnId col_col          = HSVM_GetColumnId(vm, "COL");
        HSVM_ColumnId col_compile_id   = HSVM_GetColumnId(vm, "COMPILE_ID");
        HSVM_ColumnId col_debuginfo    = HSVM_GetColumnId(vm, "DEBUGINFO_COMPRESSED");
        HSVM_ColumnId col_deprecated   = HSVM_GetColumnId(vm, "DEPRECATED");
        HSVM_ColumnId col_external     = HSVM_GetColumnId(vm, "EXTERNAL");
        HSVM_ColumnId col_funcs        = HSVM_GetColumnId(vm, "FUNCS");
        HSVM_ColumnId col_func         = HSVM_GetColumnId(vm, "FUNC");
        HSVM_ColumnId col_globallocation = HSVM_GetColumnId(vm, "GLOBALLOCATION");
        HSVM_ColumnId col_importfrom   = HSVM_GetColumnId(vm, "IMPORTFROM");
        HSVM_ColumnId col_indirect     = HSVM_GetColumnId(vm, "INDIRECT");
        HSVM_ColumnId col_isconstant   = HSVM_GetColumnId(vm, "ISCONSTANT");
        HSVM_ColumnId col_isconstref   = HSVM_GetColumnId(vm, "ISCONSTREF");
        HSVM_ColumnId col_isdeprecated = HSVM_GetColumnId(vm, "ISDEPRECATED");
        HSVM_ColumnId col_ispublic     = HSVM_GetColumnId(vm, "ISPUBLIC");
        HSVM_ColumnId col_line         = HSVM_GetColumnId(vm, "LINE");
        HSVM_ColumnId col_loadlibs     = HSVM_GetColumnId(vm, "LOADLIBS");
        HSVM_ColumnId col_name         = HSVM_GetColumnId(vm, "NAME");
        HSVM_ColumnId col_objs         = HSVM_GetColumnId(vm, "OBJS");
        HSVM_ColumnId col_onexception  = HSVM_GetColumnId(vm, "ONEXCEPTION");
        HSVM_ColumnId col_paramcount   = HSVM_GetColumnId(vm, "PARAMCOUNT");
        HSVM_ColumnId col_position     = HSVM_GetColumnId(vm, "POSITION");
        HSVM_ColumnId col_sourcemap    = HSVM_GetColumnId(vm, "SOURCEMAP");
        HSVM_ColumnId col_sourcetime   = HSVM_GetColumnId(vm, "SOURCETIME");
        HSVM_ColumnId col_stacksize    = HSVM_GetColumnId(vm, "STACKSIZE");
        HSVM_ColumnId col_target       = HSVM_GetColumnId(vm, "TARGET");
        HSVM_ColumnId col_type         = HSVM_GetColumnId(vm, "TYPE");
        HSVM_ColumnId col_value        = HSVM_GetColumnId(vm, "VALUE");
        HSVM_ColumnId col_vars         = HSVM_GetColumnId(vm, "VARS");

        HSVM_VariableId var_funcs      = HSVM_RecordCreate(vm, id_set, col_funcs);
        HSVM_VariableId var_loadlibs   = HSVM_RecordCreate(vm, id_set, col_loadlibs);
        HSVM_VariableId var_objs       = HSVM_RecordCreate(vm, id_set, col_objs);
        HSVM_VariableId var_vars       = HSVM_RecordCreate(vm, id_set, col_vars);
        HSVM_VariableId var_code       = HSVM_RecordCreate(vm, id_set, col_code);
        HSVM_VariableId var_sourcemap  = HSVM_RecordCreate(vm, id_set, col_sourcemap);

        HSVM_SetDefault(vm, var_funcs,    HSVM_VAR_RecordArray);
        HSVM_SetDefault(vm, var_loadlibs, HSVM_VAR_RecordArray);
        HSVM_SetDefault(vm, var_objs,     HSVM_VAR_RecordArray);
        HSVM_SetDefault(vm, var_vars,     HSVM_VAR_RecordArray);
        HSVM_SetDefault(vm, var_code,     HSVM_VAR_RecordArray);
        HSVM_SetDefault(vm, var_sourcemap,HSVM_VAR_RecordArray);

        HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, id_set, col_compile_id), wlib.resident.compile_id.GetDays(), wlib.resident.compile_id.GetMsecs());
        HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, id_set, col_sourcetime), wlib.resident.sourcetime.GetDays(), wlib.resident.sourcetime.GetMsecs());

        for (std::vector<VariableDef>::const_iterator it = wlib.linkinfo.variables.begin(); it != wlib.linkinfo.variables.end(); ++it)
        {
                HSVM_VariableId varrec = HSVM_ArrayAppend(vm, var_vars);

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, varrec, col_name),         wlib.linkinfo.GetNameStr(it->name_index));
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, varrec, col_isdeprecated), it->symbolflags & SymbolFlags::Deprecated);
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, varrec, col_ispublic),     it->symbolflags & SymbolFlags::Public);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, varrec, col_deprecated),   wlib.linkinfo.GetNameStr(it->deprecation_index));
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, varrec, col_isconstant),   it->constantexprid != -1);
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, varrec, col_isconstref),   it->is_constref);

                if (it->symbolflags & SymbolFlags::Imported)
                {
                        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, varrec, col_importfrom), LibraryPath(wlib, it->library));
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, varrec, col_globallocation), -1);
                }
                else
                {
                        HSVM_SetDefault(vm, HSVM_RecordCreate(vm, varrec, col_importfrom), HSVM_VAR_String);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, varrec, col_globallocation), it->globallocation);
                }

        };

        for (std::vector<LoadedLibraryDef>::const_iterator it = wlib.linkinfo.libraries.begin(); it != wlib.linkinfo.libraries.end(); ++it)
        {
                HSVM_VariableId librec = HSVM_ArrayAppend(vm, var_loadlibs);

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, librec, col_name),         wlib.linkinfo.GetNameStr(it->liburi_index));
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, librec, col_indirect),     it->indirect);
        };

        for (std::vector<FunctionDef>::const_iterator it = wlib.linkinfo.functions.begin(); it != wlib.linkinfo.functions.end(); ++it)
        {
                HSVM_VariableId funcrec = HSVM_ArrayAppend(vm, var_funcs);

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, funcrec, col_name),         wlib.linkinfo.GetNameStr(it->name_index));
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, funcrec, col_isdeprecated), it->symbolflags & SymbolFlags::Deprecated);
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, funcrec, col_ispublic),     it->symbolflags & SymbolFlags::Public);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, funcrec, col_deprecated),   wlib.linkinfo.GetNameStr(it->deprecation_index));

                if (it->symbolflags & SymbolFlags::Imported)
                    HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, funcrec, col_importfrom), LibraryPath(wlib, it->library));
                else
                    HSVM_SetDefault(vm, HSVM_RecordCreate(vm, funcrec, col_importfrom), HSVM_VAR_String);

                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, funcrec, col_external), it->flags & FunctionFlags::External);

                if (!(it->symbolflags & SymbolFlags::Imported) && !(it->flags & FunctionFlags::External))
                    HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, funcrec, col_codeptr), it->codelocation);
                else
                    HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, funcrec, col_codeptr), -1);

                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, funcrec, col_line), it->definitionposition.line);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, funcrec, col_col), it->definitionposition.column);

                /* ADDME
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
                */
        };

        for (std::vector< ObjectTypeDef >::const_iterator it = wlib.linkinfo.objecttypes.begin(); it != wlib.linkinfo.objecttypes.end(); ++it)
        {
                HSVM_VariableId objrec = HSVM_ArrayAppend(vm, var_objs);

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, objrec, col_name),         wlib.linkinfo.GetNameStr(it->name_index));
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, objrec, col_isdeprecated), it->symbolflags & SymbolFlags::Deprecated);
                HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, objrec, col_ispublic),     it->symbolflags & SymbolFlags::Public);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, objrec, col_deprecated),   wlib.linkinfo.GetNameStr(it->deprecation_index));

                if (it->symbolflags & SymbolFlags::Imported)
                        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, objrec, col_importfrom), LibraryPath(wlib, it->library));
                else
                        HSVM_SetDefault(vm, HSVM_RecordCreate(vm, objrec, col_importfrom), HSVM_VAR_String);
/* ADDME
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
*/
        }

        // Resolve the column names
        std::vector< ColumnNameId > resolvedcolumnnames;
        for (auto columnidx: wlib.linkinfo.columnidx)
        {
                Blex::StringPair name = wlib.linkinfo.GetName(columnidx);
                resolvedcolumnnames.push_back(HSVM_GetColumnIdRange(vm, name.begin, name.end));
        }

        // Get marshaller with the decoded columnnames
        Marshaller var_marshaller(GetVirtualMachine(vm), MarshalMode::DataOnly);
        var_marshaller.SetLibraryColumnNameDecoder(&resolvedcolumnnames);

        for (unsigned idx = 0; idx < wlib.resident.code.size();++idx)
        {
                HSVM_VariableId coderec = HSVM_ArrayAppend(vm, var_code);

                InstructionSet::_type icode = static_cast<InstructionSet::_type>(wlib.resident.code[idx]);
                std::string iname = "??? ("+Blex::AnyToString<int>(icode) +")";
                if (GetInstructionCodeNameMap().find(icode) != GetInstructionCodeNameMap().end())
                    iname = GetInstructionCodeNameMap().find(icode)->second;

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, coderec, col_code), iname);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_codeptr), idx);

                switch (icode)
                {
                case InstructionSet::CALL:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_func), id);
                        }; break;
                case InstructionSet::JUMP:
                case InstructionSet::JUMPC:
                case InstructionSet::JUMPC2:
                case InstructionSet::JUMPC2F:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_position), idx + 1 + id);
                        }; break;
                case InstructionSet::LOADS:
                case InstructionSet::STORES:
                case InstructionSet::LOADSD:
                case InstructionSet::DESTROYS:
                case InstructionSet::COPYS:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_position), id);
                        }; break;
                case InstructionSet::LOADG:
                case InstructionSet::STOREG:
                case InstructionSet::LOADGD:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_position), id);
                        }; break;
                case InstructionSet::LOADC:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;

                                uint8_t const *buf = wlib.GetConstantBuffer(id);
                                uint8_t const *limit = buf + wlib.GetConstantBufferLength(id);
                                var_marshaller.Read(HSVM_RecordCreate(vm, coderec, col_value), buf, limit);
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
                                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, coderec, col_name), wlib.linkinfo.GetNameStr(wlib.linkinfo.columnidx[id]));
                        }
                        break;
                case InstructionSet::OBJMEMBERINSERT:
                case InstructionSet::OBJMEMBERINSERTTHIS:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                bool is_private = wlib.resident.code[idx+5];
                                idx+=5;
                                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, coderec, col_name), wlib.linkinfo.GetNameStr(wlib.linkinfo.columnidx[id]));
                                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, coderec, col_ispublic), !is_private);
                        }
                        break;
                case InstructionSet::OBJMETHODCALL:
                case InstructionSet::OBJMETHODCALLTHIS:
                case InstructionSet::OBJMETHODCALLNM:
                case InstructionSet::OBJMETHODCALLTHISNM:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, coderec, col_name), wlib.linkinfo.GetNameStr(wlib.linkinfo.columnidx[id]));
                                int32_t pcount = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_paramcount), pcount);
                        }
                        break;
                case InstructionSet::LOADTYPEID:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_position), id);
                        }
                        break;
                case InstructionSet::INITVAR:
                case InstructionSet::CAST:
                case InstructionSet::CASTF:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, coderec, col_type), HareScript::GetTypeName((VariableTypes::Type)id));
                        }
                        break;
                case InstructionSet::CASTPARAM:
                        {
                                int32_t id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, coderec, col_type), HareScript::GetTypeName((VariableTypes::Type)id));
                                id = Blex::GetLsb<int32_t>(&wlib.resident.code[idx+1]);
                                idx+=4;
                                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_func), id);
                        }
                        break;
                default: ;
                }

                // Should this go before reading instruction?
                auto uit = wlib.exceptions.unwindentries.Find(idx + 1);
                if (uit != wlib.exceptions.unwindentries.End())
                {
                        HSVM_VariableId var_onexception = HSVM_RecordCreate(vm, coderec, col_onexception);
                        HSVM_SetDefault(vm, var_onexception, HSVM_VAR_Record);

                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_onexception, col_target), uit->second.target);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_onexception, col_stacksize), uit->second.stacksize);
                }
        }

        for (auto it = wlib.debug.debugentries.Begin(); it != wlib.debug.debugentries.End(); ++it)
        {
                HSVM_VariableId coderec = HSVM_ArrayAppend(vm, var_sourcemap);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_codeptr), it->first);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_line), it->second.line);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, coderec, col_col), it->second.column);
        }

        HSVM_MakeBlobFromMemory(vm, HSVM_RecordCreate(vm, id_set, col_debuginfo), wlib.debuginfo.data.size(), wlib.debuginfo.data.size() ? &*wlib.debuginfo.data.begin() : 0);
}

void HS_Libdump(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId success = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "SUCCESS"));
        HSVM_VariableId errors =  HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERRORS"));

        HSVM_BooleanSet(*vm, success, false);
        HSVM_SetDefault(*vm, errors, HSVM_VAR_RecordArray);

        std::string toload = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        vm->GetFileSystem().ResolveAbsoluteLibrary(vm->GetContextKeeper(), vm->GetExecuteLibrary(), &toload);

        ErrorHandler errorhandler;
        Library const *lib = 0;

        try
        {
                lib = vm->GetEnvironment().GetLibRef(vm->GetContextKeeper(), toload, errorhandler);
                DoLibdump(*vm, id_set, lib->GetWrappedLibrary());
                HSVM_BooleanSet(*vm, success, true);
        }
        catch (VMRuntimeError &e)
        {
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "SUCCESS")), false);

                ErrorHandler errorhandler;
                errorhandler.AddMessage(e);
                GetMessageList(*vm, errors, errorhandler, false);
        }
        catch(std::exception &)
        {
                if(lib)
                        vm->GetEnvironment().ReleaseLibRef(lib);
                throw;
        }
        if(lib)
                vm->GetEnvironment().ReleaseLibRef(lib);
}


void InitLibdumper(BuiltinFunctionsRegistrator &bifreg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_LIBDUMP::R:S",HS_Libdump));
}

} // End of namespace Baselibs
} // End of namespace HareScript
