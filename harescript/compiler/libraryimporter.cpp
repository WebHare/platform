#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "libraryimporter.h"
#include "../vm/hsvm_librarywrapper.h"
#include "symboltable.h"

namespace HareScript
{
namespace Compiler
{

SymbolDefs::Library * LibraryImporter::AddLibrary(std::string const &liburi, LineColumn position, bool ispreload, bool indirect, Blex::DateTime clib_id, Blex::DateTime sourcetime, AST::Module *mdl)
{
        for (std::vector<SymbolDefs::Library *>::iterator it = mdl->loadlibs.begin(); it != mdl->loadlibs.end(); ++it)
            if ((*it)->liburi == liburi)
            {
                    (*it)->indirect = (*it)->indirect && indirect;
                    if ((*it)->clib_id != clib_id)
                        throw Message(true, Error::InternalError, "Library modified during compilation process");

                    if (!indirect)
                    {
                            (*it)->loadlibposition = position;
                            (*it)->indirect = false;
                    }
                    if (ispreload)
                        (*it)->referred = true;

                    return *it;
            }

        SymbolDefs::Library *library = Adopt(new SymbolDefs::Library);
        library->liburi = liburi;
        library->loadlibposition = position;
        library->indirect = indirect;
        library->clib_id = clib_id;
        library->sourcetime = sourcetime;
        library->referred = ispreload;
        mdl->loadlibs.push_back(library);
        return library;
}

SymbolDefs::FunctionDef::Argument LibraryImporter::ReadFunctionArgument(LineColumn position, WrappedLibrary const &lib, FunctionDef::Parameter const &src, AstCoder *coder)
{
        Symbol *param = Adopt(new Symbol(lib.linkinfo.GetNameStr(src.name_index), SymbolType::Variable));
        param->definitionposition = position;
        param->state = SymbolState::Declared;
        param->variabledef = Adopt(new SymbolDefs::VariableDef);
        param->variabledef->is_substitute = false;
        param->variabledef->is_global = false;
        param->variabledef->type = src.type;

        SymbolDefs::FunctionDef::Argument a;
        a.symbol = param;

        if (src.defaultid < 0)
            a.value = 0;
        else
        {
                VarId var = context.stackm.NewHeapVariable();
                uint8_t const *buf = lib.GetConstantBuffer(src.defaultid);
                uint8_t const *limit = buf + lib.GetConstantBufferLength(src.defaultid);
                marshaller.Read(var, buf, limit);

                a.value = coder->ImConstant(position, var);
        }
        return a;
}

void LibraryImporter::ReadSymbolDef(Symbol *outsymbol, SymbolDef const &insymbol, WrappedLibrary const &lib, AstCoder *coder)
{
        outsymbol->deprecation_message = lib.linkinfo.GetNameStr(insymbol.deprecation_index);
        if(insymbol.symbolflags & SymbolFlags::Deprecated)
            outsymbol->flags |= SymbolFlags::Deprecated;

        outsymbol->flags |= SymbolFlags::Imported;
        outsymbol->state = SymbolState::Declared;

        if (insymbol.symbolflags & SymbolFlags::Imported) //ADDME: why a separate is_imported - don't we have src.library != -1 or something?
        {
                //FIXME: Range validate src.library!

                //ADDME: speed up by not requiring a tmep std::string all the time..
                //       perhaps just immediately store lib info with the src.library index?
                std::string liburi = lib.linkinfo.GetNameStr(lib.LibraryList()[insymbol.library].liburi_index);
                outsymbol->importlibrary = AddLibrary(liburi,
                                                   outsymbol->definitionposition,
                                                   false,
                                                   true,
                                                   lib.LibraryList()[insymbol.library].clib_id,
                                                   lib.LibraryList()[insymbol.library].sourcetime,
                                                   coder->GetRoot());
        }
        else
        {
                outsymbol->importlibrary = library;
        }
}

Symbol* LibraryImporter::ReadFunctionSymbol(LineColumn position, WrappedLibrary const &lib, FunctionDef const &src, AstCoder *coder)
{
        Blex::StringPair srcname = lib.linkinfo.GetName(src.name_index);
        //Strip mangled part from name
        std::string name(srcname.begin,std::find(srcname.begin,srcname.end,':'));

        Symbol *symbol = Adopt(new Symbol(name, SymbolType::Function));
        ReadSymbolDef(symbol, src, lib, coder);

        symbol->definitionposition = position;
        symbol->state = SymbolState::Declared;
        symbol->exportlibraries.push_back(library);

        symbol->functiondef = Adopt(new SymbolDefs::FunctionDef);
        symbol->functiondef->flags = src.flags;
        symbol->functiondef->dllmodule = lib.linkinfo.GetNameStr(src.dllname_index);
        symbol->functiondef->returntype = src.resulttype;

        for (std::vector<FunctionDef::Parameter>::const_iterator it2 = src.parameters.begin(); it2 != src.parameters.end(); ++it2)
            symbol->functiondef->arguments.push_back(ReadFunctionArgument(position,lib,*it2,coder));

        return symbol;
}

Symbol* LibraryImporter::ReadObjectSymbol(LineColumn position, WrappedLibrary const &lib, ObjectTypeDef const &src, AstCoder *coder, std::map< unsigned, Symbol * > &function_mapping)
{
        Symbol *symbol = Adopt(new Symbol(lib.linkinfo.GetNameStr(src.name_index), SymbolType::ObjectType));

        ReadSymbolDef(symbol, src, lib, coder);
        symbol->definitionposition = position;

        symbol->exportlibraries.push_back(library);

        symbol->objectdef = Adopt(new SymbolDefs::ObjectDef);
        symbol->objectdef->constructor = function_mapping[src.constructor];
        if (!symbol->objectdef->constructor)
            throw VMRuntimeError(Error::InternalError, "Could not locate constructor in import library");

        for (std::vector< ObjectCellDef >::const_iterator it = src.cells.begin(); it != src.cells.end(); ++it)
        {
                SymbolDefs::ObjectField field(symbol);
                field.declpos = position; // FIXME: Set better location
                field.is_private = it->is_private;
                field.is_update = false;
                field.type = it->type;
                field.name = lib.linkinfo.GetNameStr(it->name_index);
                field.var_type = it->resulttype;
                if (it->method != -1)
                    field.method = function_mapping[it->method]; // For illegal id's this becomes 0.
                field.getter = lib.linkinfo.GetNameStr(it->getter_name_index);
                field.setter = lib.linkinfo.GetNameStr(it->setter_name_index);

                symbol->objectdef->fields.push_back(field);
        }

        for (std::vector< uint32_t >::const_iterator it = src.uid_indices.begin(); it != src.uid_indices.end(); ++it)
            symbol->objectdef->uids.push_back(lib.linkinfo.GetNameStr(*it));

        return symbol;
}


void LibraryImporter::Execute(LineColumn position, Blex::Stream &libstream, std::string const &liburi, Blex::DateTime /*clibtime*/, AstCoder *coder, bool ispreload)
{
        WrappedLibrary lib;

        std::vector<uint8_t> data;
        std::map< unsigned, Symbol * > function_mapping;
        std::vector< Symbol * > objectsymbols;

        Blex::ReadStreamIntoVector(libstream,&data);

        Blex::MemoryReadStream mstream(&data[0], data.size());

        lib.ReadLibrary(liburi, &mstream);

        columnnamelist.clear();
        for (unsigned i=0;i<lib.linkinfo.columnidx.size();++i)
        {
                Blex::StringPair colname = lib.linkinfo.GetName(lib.linkinfo.columnidx[i]);
                columnnamelist.push_back(context.stackm.columnnamemapper.GetMapping(colname.size(),colname.begin));
        }
        marshaller.SetLibraryColumnNameDecoder(&columnnamelist);

        // Add a indirect references to the recursively loaded libraries
        for (std::vector<LoadedLibraryDef>::const_iterator it = lib.LibraryList().begin(); it != lib.LibraryList().end(); ++it)
        {
                std::string liburi = lib.linkinfo.GetNameStr(it->liburi_index);
                AddLibrary(liburi, position, false, true, it->clib_id, it->sourcetime, coder->GetRoot());
        }

        // Add a direct reference to the loaded library (after the loaded libraries, for initorder)
        library = AddLibrary(liburi, position, ispreload, false, lib.resident.compile_id, lib.resident.sourcetime, coder->GetRoot());

        unsigned idx = 0;
        for (std::vector<FunctionDef>::const_iterator it = lib.FunctionList().begin(); it != lib.FunctionList().end(); ++it, ++idx)
        {
                Symbol *symbol = ReadFunctionSymbol(position, lib, *it, coder);
                if (it->symbolflags & SymbolFlags::Public)
                    context.symboltable->RegisterLibrarySymbol(position, library, symbol);

                function_mapping[idx] = symbol;
        }
        for (std::vector<VariableDef>::const_iterator it = lib.VariableList().begin(); it != lib.VariableList().end(); ++it)
        {
                if (it->symbolflags & SymbolFlags::Public)
                {
                        Symbol *symbol = Adopt(new Symbol(lib.linkinfo.GetNameStr(it->name_index), SymbolType::Variable));
                        ReadSymbolDef(symbol, *it, lib, coder);

                        symbol->definitionposition = position;
                        symbol->variabledef = Adopt(new SymbolDefs::VariableDef);

                        symbol->exportlibraries.push_back(library);
                        symbol->variabledef->is_substitute = false;
                        symbol->variabledef->is_global = true;
                        symbol->variabledef->type = it->resulttype;
                        symbol->variabledef->is_constref = it->is_constref;
                        if (it->constantexprid != -1)
                        {
                                VarId var = context.stackm.NewHeapVariable();
                                uint8_t const *buf = lib.GetConstantBuffer(it->constantexprid);
                                uint8_t const *limit = buf + lib.GetConstantBufferLength(it->constantexprid);
                                marshaller.Read(var, buf, limit);

                                symbol->variabledef->is_constant = true;
                                symbol->variabledef->constexprvalue = coder->ImConstant(position, var);
                        }

                        if (it->typeinfo != -1)
                        {
                                DBTypeInfo const &typeinfo = lib.TypeList()[it->typeinfo];
                                for (auto it = typeinfo.columnsdef.begin(); it != typeinfo.columnsdef.end(); ++it)
                                {
                                        SymbolDefs::TableDef::Column col(*it);
                                        if (!it->null_default.empty())
                                        {
                                                VarId var = context.stackm.NewHeapVariable();
                                                context.marshaller->Read(var, &it->null_default[0], &it->null_default[0] + it->null_default.size());
                                                col.null_default_value = coder->ImConstant(position, var);
                                        }
                                        symbol->variabledef->tabledef.columnsdef.push_back(col);
                                }
                                for (auto it = typeinfo.viewcolumnsdef.begin(); it != typeinfo.viewcolumnsdef.end(); ++it)
                                {
                                        if (it->view_value.empty())
                                             throw std::runtime_error("Expected non-empty view value");
                                        SymbolDefs::TableDef::ViewColumn col(*it);
                                        VarId var = context.stackm.NewHeapVariable();
                                        context.marshaller->Read(var, &it->view_value[0], &it->view_value[0] + it->view_value.size());
                                        col.view_value_expr = coder->ImConstant(position, var);
                                        symbol->variabledef->tabledef.viewcolumnsdef.push_back(col);
                                }
                                for (auto it = typeinfo.tablesdef.begin(); it != typeinfo.tablesdef.end(); ++it)
                                {
                                        SymbolDefs::SchemaDef::Table tabledef;
                                        tabledef.name = it->name;
                                        tabledef.dbase_name = it->dbase_name;
                                        for (auto it2 = it->columnsdef.begin(); it2 != it->columnsdef.end(); ++it2)
                                        {
                                                SymbolDefs::TableDef::Column col(*it2);
                                                if (!it2->null_default.empty())
                                                {
                                                        VarId var = context.stackm.NewHeapVariable();
                                                        context.marshaller->Read(var, &it2->null_default[0], &it2->null_default[0] + it2->null_default.size());
                                                        col.null_default_value = coder->ImConstant(position, var);
                                                }
                                                tabledef.tabledef.columnsdef.push_back(col);
                                        }
                                        for (auto it2 = it->viewcolumnsdef.begin(); it2 != it->viewcolumnsdef.end(); ++it2)
                                        {
                                                if (it2->view_value.empty())
                                                     throw std::runtime_error("Expected non-empty view value");
                                                SymbolDefs::TableDef::ViewColumn col(*it2);
                                                VarId var = context.stackm.NewHeapVariable();
                                                context.marshaller->Read(var, &it2->view_value[0], &it2->view_value[0] + it2->view_value.size());
                                                col.view_value_expr = coder->ImConstant(position, var);
                                                tabledef.tabledef.viewcolumnsdef.push_back(col);
                                        }

                                        symbol->variabledef->schemadef.tablesdef.push_back(tabledef);
                                }
                        }

                        context.symboltable->RegisterLibrarySymbol(position, library, symbol);
                }
        }

        for (std::vector< ObjectTypeDef >::const_iterator it = lib.ObjectTypeList().begin(); it != lib.ObjectTypeList().end(); ++it)
        {
                Symbol *symbol = ReadObjectSymbol(position, lib, *it, coder, function_mapping);
                if (it->symbolflags & SymbolFlags::Public)
                    context.symboltable->RegisterLibrarySymbol(position, library, symbol);
                objectsymbols.push_back(symbol);
        }
        idx = 0;
        for (std::vector< ObjectTypeDef >::const_iterator it = lib.ObjectTypeList().begin(); it != lib.ObjectTypeList().end(); ++it, ++idx)
        {
                if (it->base != -1 && objectsymbols[idx])
                    objectsymbols[idx]->objectdef->base = objectsymbols[it->base];
        }
}

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
