//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/zstream.h>
#include "debugprints.h"
#include "codelibrarywriter.h"

//#define SHOWCODEEMIT

#ifdef SHOWCODEEMIT
 #define CODEEMITPRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define CODEEMITPRINT(a)
#endif


namespace HareScript
{
namespace Compiler
{

namespace
{
void pushbyte(std::vector<uint8_t> &code, uint8_t byte)
{
        code.push_back(byte);
}
void pushdword(std::vector<uint8_t> &code, uint32_t value)
{
        uint8_t tempstore[sizeof value];
        Blex::putu32lsb(tempstore,value);
        code.insert(code.end(),tempstore,tempstore + sizeof tempstore);
}
void setdword(std::vector<uint8_t> &code, unsigned at, uint32_t value)
{
        Blex::putu32lsb(&code[at],value);
}
uint32_t getdword(std::vector<uint8_t> &code, unsigned at)
{
        return Blex::getu32lsb(&code[at]);
}

std::string EncodeJSONString(std::string const &str)
{
        std::string retval = "\"";
        Blex::EncodeJava(str.begin(), str.end(), std::back_inserter(retval));
        return retval + "\"";
}

} //end anonymous namespace

CodeLibraryWriter::CodeLibraryWriter(CompilerContext &context)
: context(context)
{
}

CodeLibraryWriter::~CodeLibraryWriter()
{
}

void CodeLibraryWriter::Execute(IL::Module *_module, CodeBlockLinker *_cblinker, CodeRegisterAllocator *_callocator, std::string const &/*libname*/, Blex::DateTime sourcetime, Blex::RandomStream &outlib)
{
        module = _module;
        cblinker = _cblinker;
        callocator = _callocator;

        HareScript::WrappedLibrary wrapper;

        wrapper.resident.initfunction = -1;
        wrapper.resident.deinitfunction = -1;
        wrapper.resident.sourcetime = sourcetime;
        wrapper.resident.scriptproperty_fileid = _module->scriptproperty_fileid;
        wrapper.resident.scriptproperty_filecreationdate = _module->scriptproperty_filecreationdate;
        wrapper.resident.scriptproperty_systemredirect = _module->scriptproperty_systemredirect;

        std::set< std::tuple< LineColumn, std::string > > unusedloadlibs;

        for (std::vector<SymbolDefs::Library *>::iterator it = module->loadlibs.begin(); it != module->loadlibs.end(); ++it)
        {
                AddLibrary(wrapper, *it);
                if (!(*it)->indirect && !(*it)->referred)
                    unusedloadlibs.insert(std::make_tuple((*it)->loadlibposition, (*it)->liburi));
        }

        // Emit unused library warnings in positional order
        for (auto &itr: unusedloadlibs)
            context.errorhandler.AddWarningAt(std::get<0>(itr), Warning::UnusedLoadlib, std::get<1>(itr));

        std::map< unsigned, unsigned > imapping;

        std::vector<std::string> columnnames;
        Marshaller marshaller(context.stackm, MarshalMode::SimpleOnly);
        marshaller.SetLibraryColumnNameEncoder(std::bind(&CodeLibraryWriter::GetColumnIdByNameId, this, &columnnames, std::placeholders::_1));

        AddGlobals(wrapper, marshaller);
        AddCodedFunctions(wrapper, marshaller, columnnames, &imapping);
        ProcessTypeInfo(wrapper);
        AddDebugInfo(wrapper, &imapping);

        for (std::vector<std::string>::iterator it = columnnames.begin(); it != columnnames.end(); ++it)
        {
                uint32_t colname_index = wrapper.linkinfo.SetName(*it);
                wrapper.linkinfo.columnidx.push_back(colname_index);
        }

        /** ADDME: We are now probably copying from MemoryRWStream to MemoryRWStream
            inside the librarywrapper. Do we REALLY need to do that? */
        Blex::MemoryRWStream str;
        wrapper.WriteLibrary(module->orgsrcname, &str);
        str.SetOffset(0);
        str.SendAllTo(outlib);
}

signed CodeLibraryWriter::AddLibrary(HareScript::WrappedLibrary &wrapper, SymbolDefs::Library *library)
{
        if (library == 0)
            return -1;
        if (!addedlibs.count(library))
        {
                for (std::map<SymbolDefs::Library *, unsigned>::iterator it = addedlibs.begin(); it != addedlibs.end(); ++it)
                    if (it->first->liburi == library->liburi)
                        return addedlibs[library] = std::distance(addedlibs.begin(), it);

                addedlibs[library] = wrapper.linkinfo.libraries.size();
                LoadedLibraryDef lib;
                lib.liburi_index = wrapper.linkinfo.SetName(library->liburi);
                lib.indirect = library->indirect;
                lib.clib_id = library->clib_id;
                lib.sourcetime = library->sourcetime;
                wrapper.linkinfo.libraries.push_back(lib);
        }
        return addedlibs[library];
}

void CodeLibraryWriter::PrepareSymbolDef(HareScript::WrappedLibrary &wrapper, SymbolDef *out, Symbol const &in)
{
        out->deprecation_index = wrapper.linkinfo.SetName(in.deprecation_message);
        out->symbolflags = in.flags;
        out->library = AddLibrary(wrapper, in.importlibrary);
}

void CodeLibraryWriter::AddGlobal(HareScript::WrappedLibrary &wrapper, HareScript::Marshaller &marshaller, Symbol *symbol)
{
        SectionResident &resident=wrapper.resident;
        SectionLinkInfo &linkinfo=wrapper.linkinfo;

        DBTypeInfo typeinfo;
        typeinfo.type = symbol->variabledef->type;
        for (SymbolDefs::TableDef::ColumnsDef::const_iterator it = symbol->variabledef->tabledef.columnsdef.begin(); it != symbol->variabledef->tabledef.columnsdef.end(); ++it)
            typeinfo.columnsdef.push_back(*it);
        for (SymbolDefs::TableDef::ViewColumnsDef::const_iterator it = symbol->variabledef->tabledef.viewcolumnsdef.begin(); it != symbol->variabledef->tabledef.viewcolumnsdef.end(); ++it)
            typeinfo.viewcolumnsdef.push_back(*it);
        for (SymbolDefs::SchemaDef::TablesDef::const_iterator it = symbol->variabledef->schemadef.tablesdef.begin(); it != symbol->variabledef->schemadef.tablesdef.end(); ++it)
        {
                DBTypeInfo::Table table;
                table.name = it->name;
                table.dbase_name = it->dbase_name;
                for (SymbolDefs::TableDef::ColumnsDef::const_iterator it2 = it->tabledef.columnsdef.begin(); it2 != it->tabledef.columnsdef.end(); ++it2)
                    table.columnsdef.push_back(*it2);
                for (SymbolDefs::TableDef::ViewColumnsDef::const_iterator it2 = it->tabledef.viewcolumnsdef.begin(); it2 != it->tabledef.viewcolumnsdef.end(); ++it2)
                    table.viewcolumnsdef.push_back(*it2);
                typeinfo.tablesdef.push_back(table);
        }

        addedvars[symbol] = linkinfo.variables.size();

        VariableDef vardef;
        PrepareSymbolDef(wrapper, &vardef, *symbol);
        vardef.name_index = linkinfo.SetName(symbol->name);
        vardef.resulttype = symbol->variabledef->type;
        vardef.typeinfo = resident.types.size();
        if (!(vardef.symbolflags & SymbolFlags::Imported))
            vardef.globallocation = resident.globalareasize++;
        else
            vardef.globallocation = 0xFFFFFFFF;
        vardef.is_constref = symbol->variabledef->is_constref;
        if (symbol->variabledef->is_constant)
        {
                AST::Constant *c = dynamic_cast< AST::Constant * >(symbol->variabledef->constexprvalue);
                if (!c)
                    throw Message(true, Error::InternalError, "Found constant expression variable without calculated expression value");

                unsigned len = marshaller.Analyze(c->var);
                std::pair<int32_t, uint8_t*> constant = wrapper.SetConstantBuffer(len);
                marshaller.Write(c->var, constant.second, constant.second + len);
                vardef.constantexprid = constant.first;
        }
        else
            vardef.constantexprid = -1;

        linkinfo.variables.push_back(vardef);
        resident.types.push_back(typeinfo);
}

void CodeLibraryWriter::AddGlobals(HareScript::WrappedLibrary &wrapper, HareScript::Marshaller &marshaller)
{
        wrapper.resident.globalareasize = 0;

        std::set<Symbol *> done;

        for (std::set<IL::Variable *>::iterator it = module->globalvars.begin(); it != module->globalvars.end(); ++it)
        {
                if ((*it)->symbol->variabledef)
                {
                        IL::Variable *var = *it;

                        AddGlobal(wrapper, marshaller, var->symbol);
                        done.insert(var->symbol);
                }
        }
        // Make sure all public variables are really made public
        for (std::vector<Symbol *>::iterator it = module->exportedvars.begin(); it != module->exportedvars.end(); ++it)
            if (!done.count(*it))
            {
                    AddGlobal(wrapper, marshaller, *it);
                    done.insert(*it);
            }
}

void CodeLibraryWriter::GatherObjectFields(SymbolDefs::ObjectDef *objdef, std::map< std::string, SymbolDefs::ObjectField * > *fields)
{
        for (SymbolDefs::ObjectDef::Fields::iterator it = objdef->fields.begin(), end = objdef->fields.end(); it != end; ++it)
            (*fields)[it->name] = &*it;
}

uint32_t CodeLibraryWriter::GetColumnIdByNameId(std::vector< std::string > *columnnames, ColumnNameId nameid)
{
        std::string str = context.stackm.columnnamemapper.GetReverseMapping(nameid).stl_str();
        std::vector<std::string>::iterator it2 = std::find(columnnames->begin(), columnnames->end(), str);
        if (it2 == columnnames->end())
        {
                columnnames->push_back(str);
                return columnnames->size() - 1;
        }
        else
            return std::distance(columnnames->begin(), it2);
}

void CodeLibraryWriter::AddCodedFunctions(HareScript::WrappedLibrary &wrapper, HareScript::Marshaller &marshaller, std::vector<std::string> &columnnames, std::map< unsigned, unsigned > *imapping)
{
        std::vector<uint8_t> &code = wrapper.resident.code;
        Blex::MapVector<uint32_t, LineColumn> *debugentries = &wrapper.debug.debugentries;
        std::map<unsigned, unsigned> codetranslation;
        std::vector<unsigned> jump_fixups;
        std::map<Symbol *, unsigned> functions;                 // All called functions
        unsigned functioncounter = 0;
        std::map<Symbol *, unsigned> objects;                   // All referenced objects
        unsigned objectcounter = 0;

//        std::vector<TypeInfo> types;                 // All used types

        std::map< uint32_t, uint32_t > exception_targets;

        LineColumn lastposition;
        for (std::vector<Code::Instruction>::iterator it = cblinker->codes.begin(); it != cblinker->codes.end(); ++it)
        {
                codetranslation[std::distance(cblinker->codes.begin(), it)] = code.size();

                /** Only set the location when the last location isn't the same. We can use debugentries.end()
                    because code.size() only increases */
                if (debugentries->Size() == 0 || lastposition != it->position)
                {
                        debugentries->Insert(std::make_pair(code.size(), it->position));
                        lastposition = it->position;
                }

                code.push_back(static_cast<uint8_t>(it->type));

                DEBUGONLY(
                std::string iname = "??? ("+Blex::AnyToString<int>(it->type) +")";
                if (GetInstructionCodeNameMap().find(it->type) != GetInstructionCodeNameMap().end())
                    iname = GetInstructionCodeNameMap().find(it->type)->second;
                CODEEMITPRINT("Pushed i " << iname));

                switch (it->type)
                {
                case InstructionSet::CALL:
                        {
                                if (it->data.function->name[0] == ':')
                                    throw std::logic_error("Untranslated internal function "+it->data.function->name+" encountered during library writing"); // fix this in CodeGenerator::InstructionTranslator::V_ILFunctionCall
                                if (!functions.count(it->data.function->symbol))
                                    functions[it->data.function->symbol] = functioncounter++;
                                pushdword(code, functions[it->data.function->symbol]);
                        }; break;
                case InstructionSet::JUMP:
                case InstructionSet::JUMPC:
                case InstructionSet::JUMPC2:
                case InstructionSet::JUMPC2F:
                        {
                                jump_fixups.push_back(code.size());
                                pushdword(code, it->data.jumplocation);
                        }; break;
                case InstructionSet::INITVAR:
                        {
                                pushdword(code, it->constant.type);
                                CODEEMITPRINT("Pushed t " << it->constant.type);
                        }; break;
                case InstructionSet::LOADC:
                        {
                                if (it->constant.var == 0)
                                {
                                        // Replace with LOADC with INITVAR
                                        code.back() = InstructionSet::INITVAR;
                                        pushdword(code, it->constant.type);
                                        CODEEMITPRINT("Pushed t " << it->constant.type);
                                }
                                else if (context.stackm.GetType(it->constant.var) == VariableTypes::Boolean)
                                {
                                        code.back() = InstructionSet::LOADCB;
                                        pushbyte(code, context.stackm.GetBoolean(it->constant.var) ? 1 : 0);
                                }
                                else if (context.stackm.GetType(it->constant.var) == VariableTypes::Integer)
                                {
                                        code.back() = InstructionSet::LOADCI;
                                        pushdword(code, context.stackm.GetInteger(it->constant.var));
                                }
                                else
                                {
                                        unsigned len = marshaller.Analyze(it->constant.var);
                                        std::pair<int32_t, uint8_t*> constant = wrapper.SetConstantBuffer(len);
                                        marshaller.Write(it->constant.var, constant.second, constant.second + len);
                                        pushdword(code, constant.first);
                                        CODEEMITPRINT("Pushed con " << constant.first);
                                }
                        }; break;
                case InstructionSet::RECORDCELLGET:
                case InstructionSet::RECORDCELLSET:
                case InstructionSet::RECORDCELLUPDATE:
                case InstructionSet::RECORDCELLCREATE:
                case InstructionSet::RECORDCELLDELETE:
                case InstructionSet::OBJMEMBERGET:
                case InstructionSet::OBJMEMBERGETTHIS:
                case InstructionSet::OBJMEMBERSET:
                case InstructionSet::OBJMEMBERSETTHIS:
                case InstructionSet::OBJMEMBERDELETE:
                case InstructionSet::OBJMEMBERDELETETHIS:
                        {
                                std::string const &str = context.stackm.GetSTLString(it->constant.var);
                                std::vector<std::string>::iterator it2 = std::find(columnnames.begin(), columnnames.end(), str);
                                if (it2 == columnnames.end())
                                {
                                        pushdword(code, columnnames.size());
                                        columnnames.push_back(str);
                                        CODEEMITPRINT("Pushed col " << columnnames.size() << ": '" << str << "'");
                                }
                                else
                                {
                                        pushdword(code, std::distance(columnnames.begin(), it2));
                                        CODEEMITPRINT("Pushed col " << std::distance(columnnames.begin(), it2) << ": '" << str << "'");
                                }
                        }; break;
                case InstructionSet::OBJMEMBERINSERT:
                case InstructionSet::OBJMEMBERINSERTTHIS:
                        {
                                std::string const &str = context.stackm.GetSTLString(it->constant.var);
                                std::vector<std::string>::iterator it2 = std::find(columnnames.begin(), columnnames.end(), str);
                                if (it2 == columnnames.end())
                                {
                                        pushdword(code, columnnames.size());
                                        columnnames.push_back(str);
                                        CODEEMITPRINT("Pushed col " << columnnames.size() << ": '" << str << "'");
                                }
                                else
                                {
                                        pushdword(code, std::distance(columnnames.begin(), it2));
                                        CODEEMITPRINT("Pushed col " << std::distance(columnnames.begin(), it2) << ": '" << str << "'");
                                }
                                pushbyte(code, it->data.is_private);
                        }; break;
                case InstructionSet::LOADG:
                case InstructionSet::STOREG:
                case InstructionSet::LOADGD:
                        {
                                pushdword(code, callocator->global_variable_positions[it->data.var->variable]);
                                CODEEMITPRINT("Pushed g " << callocator->global_variable_positions[it->data.var->variable]);
                        }; break;
                case InstructionSet::COPYS:
                case InstructionSet::DESTROYS:
                case InstructionSet::LOADS:
                case InstructionSet::STORES:
                case InstructionSet::LOADSD:
                        {
                                pushdword(code, callocator->local_variable_positions[it->data.var]);
                                CODEEMITPRINT("Pushed s " << callocator->local_variable_positions[it->data.var]);
                        }; break;
                case InstructionSet::LOADTYPEID:
                        {
                                pushdword(code, wrapper.resident.types.size());
                                wrapper.resident.types.push_back(*it->constant.typeinfovalue);
                                CODEEMITPRINT("Pushed ti " << *it->constant.typeinfovalue);
                        }; break;
                case InstructionSet::CAST:
                case InstructionSet::CASTF:
                        {
                                pushdword(code, it->constant.type);
                                CODEEMITPRINT("Pushed t " << it->constant.type);
                        }; break;
                case InstructionSet::CASTPARAM:
                        {
                                pushdword(code, it->constant.type);
                                assert(it->data.functionsymbol);
                                if (!functions.count(it->data.functionsymbol))
                                    functions[it->data.functionsymbol] = functioncounter++;
                                pushdword(code, functions[it->data.functionsymbol]);
                                CODEEMITPRINT("Pushed f " << functions[it->data.functionsymbol]);
                        }; break;
                case InstructionSet::OBJMETHODCALL:
                case InstructionSet::OBJMETHODCALLTHIS:
                case InstructionSet::OBJMETHODCALLNM:
                case InstructionSet::OBJMETHODCALLTHISNM:
                        {
                                std::string const &str = context.stackm.GetSTLString(it->constant.var);
                                std::vector<std::string>::iterator it2 = std::find(columnnames.begin(), columnnames.end(), str);
                                if (it2 == columnnames.end())
                                {
                                        pushdword(code, columnnames.size());
                                        columnnames.push_back(str);
                                        CODEEMITPRINT("Pushed col " << columnnames.size() << ": '" << str << "'");
                                }
                                else
                                {
                                        pushdword(code, std::distance(columnnames.begin(), it2));
                                        CODEEMITPRINT("Pushed col " << std::distance(columnnames.begin(), it2) << ": '" << str << "'");
                                }
                                pushdword(code, it->data.paramcount);
                                CODEEMITPRINT("Pushed pc " << it->data.paramcount);
                        }; break;
                default: ;
                }

                if (it->on_exception)
                {
                        std::map<IL::BasicBlock *, unsigned>::const_iterator it2 = cblinker->locations.find(it->on_exception);
                        if (it2 == cblinker->locations.end())
                        {
                                DEBUGPRINT("Untranslated basic block: " << it->on_exception);
                                throw Message(true, Error::InternalError, "Encountered untranslated basic block as target of exception catch");
                        }
                        exception_targets.insert(std::make_pair(code.size(), it2->second));
                }
        }
        for (std::vector<unsigned>::iterator it = jump_fixups.begin(); it != jump_fixups.end(); ++it)
             setdword(code, *it, codetranslation[getdword(code, *it)] - *it - 4);
        for (std::map< uint32_t, uint32_t >::iterator it = exception_targets.begin(); it != exception_targets.end(); ++it)
        {
                IL::CodedFunction *func = cblinker->GetFunctionByPosition(it->second);
                SectionExceptions::UnwindInfo info;
                info.target = codetranslation[it->second];
                info.stacksize = callocator->local_variable_count[func];
                wrapper.exceptions.unwindentries.Insert(std::make_pair(it->first, info));
        }

        // Add all public functions (or bound to a function-ptr) (except the ones never declared. This is ok, semantic checker has not given errors)
        for (Scope::Symbols::const_iterator it = context.symboltable->GetRootScope()->symbols.begin(); it != context.symboltable->GetRootScope()->symbols.end(); ++it)
        {
                if (it->second->type == SymbolType::Function)
                {
                        if( ((it->second->flags & SymbolFlags::Public) || it->second->force_export) && it->second->state != SymbolState::Forward)
                          if (!functions.count(it->second))
                            functions[it->second] = functioncounter++;
                }
                if (it->second->type == SymbolType::ObjectType && (it->second->flags & SymbolFlags::Public || !(it->second->flags & SymbolFlags::Imported) || it->second->force_export))
                {
                        // export this objecttype and its parents
                        Symbol *symbol = it->second;
                        while (symbol && !objects.count(symbol))
                        {
                                objects[symbol] = objectcounter++;
                                symbol = symbol->objectdef->base;
                        }
                }
        }

        // Add all reexported functions and objects
        for (Scope::Symbols::const_iterator it = context.symboltable->GetLibraryScope()->symbols.begin(); it != context.symboltable->GetLibraryScope()->symbols.end(); ++it)
        {
                Symbol *symbol = it->second;
                if (symbol->type == SymbolType::Function && (symbol->flags & SymbolFlags::Public || it->second->force_export))
                    if (!functions.count(symbol))
                        functions[symbol] = functioncounter++;
                if (symbol->type == SymbolType::ObjectType && (it->second->flags & SymbolFlags::Public || !(it->second->flags & SymbolFlags::Imported) || it->second->force_export))
                {
                        // export this objecttype and its parents
                        while (symbol && !objects.count(symbol))
                        {
                                objects[symbol] = objectcounter++;
                                symbol = symbol->objectdef->base;
                        }
                }
        }

        std::map<unsigned, Symbol *> robjects;
        for (std::map<Symbol *, unsigned>::iterator it = objects.begin(); it != objects.end(); ++it)
            robjects[it->second] = it->first;

        // Add all object types
        for (std::map< unsigned, Symbol * >::iterator it = robjects.begin(); it != robjects.end(); ++it)
        {
                Symbol *symbol = it->second;
                if (symbol->flags & SymbolFlags::Public)
                    symbol->objectdef->constructor->flags |= SymbolFlags::Public;
                if (!functions.count(symbol->objectdef->constructor))
                {
                        // Export constructor too
                        functions[symbol->objectdef->constructor] = functioncounter++;
                }

                ObjectTypeDef objtypedef;
                PrepareSymbolDef(wrapper, &objtypedef, *symbol);
                objtypedef.resulttype = VariableTypes::Object;
                objtypedef.name_index = wrapper.linkinfo.SetName(symbol->name);
                objtypedef.constructor = functions[symbol->objectdef->constructor];
                objtypedef.has_base = symbol->objectdef->base != 0;
                objtypedef.base = -1;
                objtypedef.flags = symbol->objectdef->flags;
                for (std::vector< std::string >::iterator it2 = symbol->objectdef->uids.begin(); it2 != symbol->objectdef->uids.end(); ++it2)
                    objtypedef.uid_indices.push_back(wrapper.linkinfo.SetName(*it2));

                if (symbol->objectdef->base && objects.count(symbol->objectdef->base))
                    objtypedef.base = objects[symbol->objectdef->base];

                SymbolDefs::ObjectDef *objdef = symbol->objectdef;

                std::map< std::string, SymbolDefs::ObjectField * > fields;
                GatherObjectFields(objdef, &fields);

                std::map< std::string, unsigned > name_map;
                std::map< unsigned,  SymbolDefs::ObjectField * > field_map;

                //Refer all member functions as well to prevent them being kicked out
                for (std::map< std::string, SymbolDefs::ObjectField * >::iterator it2 = fields.begin(), end = fields.end(); it2 != end; ++it2)
                {
                        // Skip the constructor
                        if (it2->second->type == ObjectCellType::Method && symbol->objectdef->constructor && it2->second->method == symbol->objectdef->constructor)
                            continue;

                        SymbolDefs::ObjectField *field = it2->second;

                        name_map[ it2->first ] = objtypedef.cells.size();
                        field_map[ objtypedef.cells.size() ] = field;

                        ObjectCellDef celldef;
                        celldef.symbolflags = SymbolFlags::None;
                        celldef.name_index =  wrapper.linkinfo.SetName(field->name);
                        celldef.deprecation_index = 0;
                        celldef.library = 0;
                        celldef.is_private = field->is_private;
                        celldef.is_update = field->is_update;
                        celldef.is_toplevel = field->object == symbol;
                        celldef.type = field->type;
                        celldef.resulttype = field->var_type;
                        celldef.method = -1;
                        celldef.getter_name_index = 0;
                        celldef.setter_name_index = 0;

                        switch (field->type)
                        {
                        case ObjectCellType::Method:
                                {
                                        if (field->method)
                                        {
                                                for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it3 = field->method->functiondef->arguments.begin(); it3 != field->method->functiondef->arguments.end(); ++it3)
                                                {
                                                        FunctionDef::Parameter p;
                                                        p.name_index = wrapper.linkinfo.SetName(it3->symbol->name);
                                                        p.type = it3->symbol->variabledef->type;
                                                        if (it3->value)
                                                        {
                                                                AST::Constant *c = dynamic_cast<AST::Constant *>(it3->value);
                                                                if (!c)
                                                                    throw Message(true, Error::InternalError, "Encountered non-constant expression as default parameter!");

                                                                unsigned len = marshaller.Analyze(c->var);
                                                                std::pair<int32_t, uint8_t*> constant = wrapper.SetConstantBuffer(len);
                                                                marshaller.Write(c->var, constant.second, constant.second + len);

//                                                                unsigned len = context.stackm.MarshalCalculateLength(c->var);
//                                                                std::pair<int32_t, uint8_t*> constant = wrapper.SetConstantBuffer(len);
//                                                                context.stackm.MarshalWrite(c->var, constant.second);
                                                                p.defaultid = constant.first;
                                                        }
                                                        else
                                                            p.defaultid = -1;
                                                        celldef.parameters.push_back(p);
                                                }

                                                if (!functions.count(field->method))
                                                    functions[field->method] = functioncounter++;
                                                field->method->flags |= SymbolFlags::Public;
                                                celldef.method = functions[field->method];
                                        }
                                } break;
                        case ObjectCellType::Property:
                                {
                                        celldef.getter_name_index = wrapper.linkinfo.SetName(field->getter);
                                        celldef.setter_name_index = wrapper.linkinfo.SetName(field->setter);
                                }
                                break;
                        default: ;
                        }
                        objtypedef.cells.push_back(celldef);
                }
                wrapper.linkinfo.objecttypes.push_back(objtypedef);
        }

        //FIXME? This simply includes ALL functions with code that weren't included anywhere yet, even private never called functions. is this right? I think only :INITFUNCTION needs this treatment....
        for (std::vector<IL::CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            if (!functions.count((*it)->symbol))
                functions[(*it)->symbol] = functioncounter++;

        std::map<unsigned, Symbol *> rfunctions;
        for (std::map<Symbol *, unsigned>::iterator it = functions.begin(); it != functions.end(); ++it)
            rfunctions[it->second] = it->first;

        for (std::map<unsigned, Symbol *>::iterator it = rfunctions.begin(); it != rfunctions.end(); ++it)
        {
                std::string funcname = GetMangledFunctionName(it->second);
                FunctionDef funcdef;
                PrepareSymbolDef(wrapper, &funcdef, *it->second);

                funcdef.name_index = wrapper.linkinfo.SetName(funcname);
                if (cblinker->symbolstarts.count(it->second))
                    funcdef.codelocation = codetranslation[cblinker->symbolstarts[it->second]];
                else
                    funcdef.codelocation = -1;
                funcdef.flags = it->second->functiondef->flags;
                funcdef.dllname_index = wrapper.linkinfo.SetName(it->second->functiondef->dllmodule); //ADDME: storing a dllname per function is probably unnecessary
                funcdef.definitionposition = it->second->definitionposition;

                if (cblinker->symbolfunctionmap.count(it->second))
                {
                        IL::CodedFunction *func = cblinker->symbolfunctionmap[it->second];
                        funcdef.localvariablecount = callocator->local_variable_count[func];
                        if (!func->defs_globals && !func->uses_globals)
                            funcdef.flags |= FunctionFlags::Constant;
                }
                else
                {
                        funcdef.localvariablecount = 0;
                }

                funcdef.resulttype = it->second->functiondef->returntype;

                for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it2 = it->second->functiondef->arguments.begin(); it2 != it->second->functiondef->arguments.end(); ++it2)
                {
                        FunctionDef::Parameter p;
                        p.name_index = wrapper.linkinfo.SetName(it2->symbol->name);
                        p.type = it2->symbol->variabledef->type;
                        if (it2->value)
                        {
                                AST::Constant *c = dynamic_cast<AST::Constant *>(it2->value);
                                if (!c)
                                    throw Message(true, Error::InternalError, "Encountered non-constant expression as default parameter!");

                                unsigned len = marshaller.Analyze(c->var);
                                std::pair<int32_t, uint8_t*> constant = wrapper.SetConstantBuffer(len);
                                marshaller.Write(c->var, constant.second, constant.second + len);
//                                unsigned len = context.stackm.MarshalCalculateLength(c->var);
//                                std::pair<int32_t, uint8_t*> constant = wrapper.SetConstantBuffer(len);
//                                context.stackm.MarshalWrite(c->var, constant.second);

                                p.defaultid = constant.first;
                        }
                        else
                            p.defaultid = -1;
                        funcdef.parameters.push_back(p);
                }

                if (funcname == ":INITFUNCTION:::")
                    wrapper.resident.initfunction = wrapper.linkinfo.functions.size();
                if (module->deinitmacro == it->second)
                    wrapper.resident.deinitfunction = wrapper.linkinfo.functions.size();
                wrapper.linkinfo.functions.push_back(funcdef);
        }

        *imapping = std::move(codetranslation);
}

void CodeLibraryWriter::AddDebugInfo(HareScript::WrappedLibrary &wrapper, std::map< unsigned, unsigned > *imapping)
{
        unsigned scopectr = 0;
        unsigned varctr = 0;
        std::map< Scope const *, unsigned > scopes;
        std::map< Symbol const *, std::pair< unsigned, unsigned > > variables;

        auto &scoperanges = context.symboltable->GetScopeRanges();

        // Enumerate all refd scopes
        for (auto &itr: scoperanges)
        {
                auto sit = scopes.find(itr.scope);
                if (sit == scopes.end())
                    scopes[itr.scope] = scopectr++;
        }

        std::stringstream str;
        str << "{\"version\":1\n";
        str << ",\"scopecount\":" << scopectr << "\n";
        str << ",\"scoperanges\":\n";
        bool first = true;
        for (auto itr: scoperanges)
        {
                str << (first? "  [":"  ,");
                first = false;
                str << "{\"id\":" << scopes[itr.scope];
                str << ",\"begin\":{\"line\":" << itr.begin.line << ",\"col\":" << itr.begin.column << "}";
                str << ",\"end\":{\"line\":" << itr.end.line << ",\"col\":" << itr.end.column << "}}\n";
        }
        if (first)
            str << "  [\n";
        str << "  ]\n";

        std::map< unsigned, Scope const * > scopes_rev;
        for (auto &itr: scopes)
            scopes_rev.insert(std::make_pair(itr.second, itr.first));

        str << ",\"variables\":\n";
        first = true;
        for (auto &itr: scopes_rev)
        {
              for (auto &sitr: itr.second->symbols)
              {
                      if (sitr.second->type != SymbolType::Variable)
                          continue;
                      if (sitr.second->name[0] == ':' && sitr.second->name != ":THIS")
                          continue;

                      variables[sitr.second] = std::make_pair(itr.first, varctr++);

                      int32_t global_id = -1;
                      auto global_itr = addedvars.find(sitr.second);
                      if (global_itr != addedvars.end())
                          global_id = global_itr->second;

                      str << (first? "  [":"  ,");
                      first = false;
                      str << "{\"scope\":" << itr.first << ",\"name\":\"" << sitr.second->name << "\",\"globalvar\":" << global_id << "}\n";
              }
        }
        if (first)
            str << "  [\n";
        str << "  ]\n";

        str << ",\"codesize\":" << cblinker->codes.size() << "\n";
        str << ",\"basicblockpositions\":\n";
        first = true;
        for (auto &itr: cblinker->basicblockstarts)
        {
                str << (first? "  [":",");
                first = false;
                str << (*imapping)[itr];
        }
        if (first)
            str << "  [\n";
        str << "]\n";

        str << ",\"variablepositions\":\n";
        first = true;
        unsigned itr_pos = 0;
        for (auto &itr: cblinker->codes)
        {
                unsigned cpos = itr_pos++;
                if (!itr.varpositions.size())
                    continue;

                for (auto &pitr: itr.varpositions)
                {
                        auto vit = variables.find(pitr.ssavar->variable->symbol);
                        if (vit == variables.end())
                            continue;

                        signed masked = pitr.position & Code::VarPosition::Mask;
                        if (masked & Code::VarPosition::SignBit)
                            masked -= Code::VarPosition::SignBit + Code::VarPosition::SignBit;

                        // Compose needed flags
                        unsigned flags = 0;
                        if (pitr.position & Code::VarPosition::Erase)
                            flags |= 1;
                        if (pitr.position & Code::VarPosition::LocOnly)
                            flags |= 2;
                        if (pitr.ssavar->variable->storagetype == IL::Variable::Global)
                            flags |= 4;

//                        unsigned flags = pitr.position / (Code::VarPosition::SignBit * 2);
//                        if (pitr.ssavar->variable->storagetype == IL::Variable::Global)
//                            flags |= 0x80;

                        // Flags:
                        // 0x01           unused
                        // 0x02           unused
                        // 0x04           unused
                        // 0x08 PostInstr: takes effect after instruction (not used)
                        // 0x10 PushPos:  Pushed variable (ignore)
                        // 0x20 Erase:    if true, erase variable
                        // 0x40 LocOnly:  location change only, no value change
                        // 0x80 Global:   global variable

                        str << (first? "  [":"  ,");
                        first = false;
                        str << "{\"variable\":" << vit->second.second
                            << ",\"codeptr\":" << (*imapping)[cpos]
                            << ",\"position\":" << masked
                            << ",\"flags\":" << flags
                            << "}\n";
                }
        }
        if (first)
            str << "  [\n";
        str << "]\n";
        str << ",\"warnings\":\n";
        first = true;
        for (auto &itr: context.errorhandler.GetWarnings())
        {
            str << (first? "  [":"  ,");
            first = false;
            str << "{\"code\":" << itr.code <<
                   ",\"line\":" << itr.position.line <<
                   ",\"col\":" << itr.position.column <<
                   ",\"filename\":" << EncodeJSONString(itr.filename) <<
                   ",\"func\":" << EncodeJSONString(itr.func) <<
                   ",\"msg1\":" << EncodeJSONString(itr.msg1) <<
                   ",\"msg2\":" << EncodeJSONString(itr.msg2) <<
                   "}\n";
        }
        if (first)
            str << "  [\n";
        str << "  ]\n";
        str << "}\n";

        std::string stl_str = str.str();

        Blex::MemoryRWStream targetstream;

        std::unique_ptr< Blex::ZlibCompressStream > compressed(new Blex::ZlibCompressStream(targetstream, Blex::ZlibCompressStream::Gzip, 9));
        unsigned datalen = stl_str.size(), pos = 0;
        while (pos != datalen)
        {
              unsigned written = compressed->Write(&stl_str[pos], datalen - pos > 32768 ? 32768 : datalen - pos);
              if (written == 0)
                  throw std::runtime_error("Could not write debuginfo section");
              pos += written;
        }

        compressed.reset();

        wrapper.debuginfo.data.resize(targetstream.GetFileLength());
        targetstream.DirectRead(0, &wrapper.debuginfo.data[0], targetstream.GetFileLength());
}

void CodeLibraryWriter::ProcessTypeInfo(HareScript::WrappedLibrary &wrapper)
{
        std::vector<DBTypeInfo> &types=wrapper.resident.types;

        for (auto it = types.begin(); it != types.end(); ++it)
            for (auto it2 = it->columnsdef.begin(); it2 != it->columnsdef.end(); ++it2)
            {
                    Blex::ToUppercase(it2->name.begin(), it2->name.end());
            }
}


} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
