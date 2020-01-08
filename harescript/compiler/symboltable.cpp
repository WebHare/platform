//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "symboltable.h"
#include "../vm/hsvm_constants.h"
#include "../vm/mangling.h"

namespace HareScript
{
namespace Compiler
{

Symbol::Symbol (std::string const &name, SymbolType::Types type)
: did_deprecation_warning(false)
, name(name)
, type(type)
, flags(SymbolFlags::None)
, force_export(false)
, importlibrary(0)
, variabledef(0)
, functiondef(0)
, objectdef(0)
{
}

SymbolTable::SymbolTable(CompilerContext &context)
: context(context)
{
        Reset();
}

void SymbolTable::Reset()
{
        temporarycounter = 0;
        scopestack.clear();
        scoperanges.clear();

        LineColumn position;

        // Push the library scope
        EnterScope(position);
        // Push the root scope
        EnterScope(position);
}

void SymbolTable::CloseScript(LineColumn position)
{
        if (scoperanges.size() >= 2)
        {
                scoperanges[0].end = position;
                scoperanges[1].end = position;
        }
}

Scope* SymbolTable::EnterScope(LineColumn position)
{
        Scope *scope = Adopt(new Scope());
        EnterCustomScope(scope, position);
        return scope;
}

void SymbolTable::EnterCustomScope(Scope *scope, LineColumn position)
{
        scopestack.push_back(scope);

        // Register range. Scope starts are always increasing, unless the start/end position are the same
        scoperanges.push_back(ScopeRange(scope, position, position));
}

void SymbolTable::LeaveScope(LineColumn position)
{
        assert(scopestack.size() > 2);

        Scope *scope = scopestack.back();

        for (auto itr = scoperanges.rbegin(); itr != scoperanges.rend(); ++itr)
        {
                if (itr->scope == scope)
                {
                        itr->end = position;
                        break;
                }
        }

        scopestack.pop_back();
}

Scope * SymbolTable::GetCurrentScope()
{
        return scopestack.back();
}

Scope const * SymbolTable::GetLibraryScope() const
{
        return scopestack.front();
}

/** Returns root scope (scope just above library scope */
Scope const * SymbolTable::GetRootScope() const
{
        std::vector<Scope *>::const_iterator it = scopestack.begin();
        return *++it;
}

Symbol * SymbolTable::AddSymbolInScope(Scope *scope, std::string const &name, SymbolType::Types type)
{
        Symbol *symbol = Adopt(new Symbol(name, type));
        scope->symbols.insert(std::make_pair(name,symbol));

        return symbol;
}

Symbol * SymbolTable::AddSymbolInCurrentScope(std::string const &name, SymbolType::Types type)
{
        return AddSymbolInScope(GetCurrentScope(), name, type);
}

/*ColumnNameId SymbolTable::GetColumnNameId(std:string const &name)
{
        ColumnNameId &id = columnnames[name];
        if (id == 0) id = ++highestnameid;
        return id;
}*/

struct MatchInfo
{
        unsigned distance, scopelevel;
        std::string symbol;
        struct Less
        {
                inline bool operator()(MatchInfo const &lhs, MatchInfo const &rhs) const
                {
                        return lhs.distance<rhs.distance || (lhs.distance==rhs.distance && lhs.scopelevel<rhs.scopelevel);
                }
        };
};

void SymbolTable::AddIsUnknownError(const LineColumn &position, std::string const &name, SymbolLookupType::Types lookuptype) const
{
        std::set<MatchInfo, MatchInfo::Less> matches;
        if (lookuptype != SymbolLookupType::Columns) //ADDME: look for columns too
        {
                unsigned scopelevel=0;
                for(std::vector<Scope *>::const_reverse_iterator scopeitr = scopestack.rbegin(); scopeitr != scopestack.rend();++scopeitr)
                {
                        ++scopelevel;
                        for(Scope::Symbols::const_iterator itr = (*scopeitr)->symbols.begin(); itr!=(*scopeitr)->symbols.end();++itr)
                        {
                                if(itr->first.empty() || itr->first[0]==':' || itr->second->state != SymbolState::Declared)
                                    continue;

                                //Filter unlikely matches immediately (ADDME: Rob, klopt dit enigszins?)
                                switch(lookuptype)
                                {
                                case SymbolLookupType::Variables:
                                case SymbolLookupType::ColumnsAndVars:
                                case SymbolLookupType::Columns:
                                        if(itr->second->type!=SymbolType::Variable)
                                            continue;
                                        break;
                                case SymbolLookupType::Functions:
                                        if(itr->second->type!=SymbolType::Function)
                                            continue;
                                        break;
                                case SymbolLookupType::ObjectTypes:
                                        if(itr->second->type!=SymbolType::ObjectType)
                                            continue;
                                        break;
                                }

                                int distance = Blex::LevenshteinDistance(name, itr->first);
                                if(distance>2)
                                   continue;

                                MatchInfo m;
                                m.distance = distance;
                                m.scopelevel = scopelevel;
                                m.symbol = itr->first;
                                matches.insert(m);
                        }
                }
        }

        switch (lookuptype)
        {
        case SymbolLookupType::Variables:
        case SymbolLookupType::ColumnsAndVars:
                if (matches.empty())
                    context.errorhandler.AddErrorAt(position, Error::UnknownVariable, name);
                else
                    context.errorhandler.AddErrorAt(position, Error::MisspelledVariable, name, matches.begin()->symbol);
                break;
        case SymbolLookupType::Columns:
                if (matches.empty())
                    context.errorhandler.AddErrorAt(position, Error::UnknownColumn, name);
                else
                    context.errorhandler.AddErrorAt(position, Error::MisspelledColumn, name, matches.begin()->symbol);
                break;
        case SymbolLookupType::Functions:
                if (matches.empty())
                    context.errorhandler.AddErrorAt(position, Error::UnknownFunction, name);
                else
                    context.errorhandler.AddErrorAt(position, Error::MisspelledFunction, name, matches.begin()->symbol);
                break;
        case SymbolLookupType::ObjectTypes:
                if (matches.empty())
                    context.errorhandler.AddErrorAt(position, Error::UnknownObjectType, name);
                else
                    context.errorhandler.AddErrorAt(position, Error::MisspelledObjectType, name, matches.begin()->symbol);
                break;
        default:
                 throw std::runtime_error("AddIsUnknownError for unknown type");
        }
}

std::pair<Symbol *, bool> SymbolTable::ResolveSymbolEx(const LineColumn &position, std::string const &name, SymbolLookupType::Types lookuptype, bool is_tryout, bool warn_if_deprecated) const
{
        // Only used to see if we there is a record in scope that contains name as column.

        // Step 1: look up all direct matches (if needed)
        Symbol * symbol_vars = 0;
        switch (lookuptype)
        {
        case SymbolLookupType::Variables:
                symbol_vars = ResolveSymbol(position, name, matchvariables, warn_if_deprecated);
                break;
        case SymbolLookupType::ColumnsAndVars:
                symbol_vars = ResolveSymbol(position, name, matchnotables, warn_if_deprecated);
                break;
        case SymbolLookupType::ObjectTypes:
                symbol_vars = ResolveSymbol(position, name, matchobjects, warn_if_deprecated);
                return std::make_pair(symbol_vars, symbol_vars == 0);
        case SymbolLookupType::Functions:
                throw std::logic_error("Lookuptype SymbolLookupType::Functions not supported with ResolveSymbolEx");
        default: ;
        }

        // Step 2: look up all column matches in ALL substitute records (if needed)
        Symbol * symbol_cols = 0;

        if ((lookuptype == SymbolLookupType::ColumnsAndVars) || (lookuptype == SymbolLookupType::Columns))
            for(std::vector<Scope *>::const_reverse_iterator it = scopestack.rbegin(); it != scopestack.rend(); ++it)
            {
                    bool found_substitutedef = false;
                    for (Scope::Symbols::const_iterator it2 = (*it)->symbols.begin(); it2 != (*it)->symbols.end(); ++it2)
                        if (it2->second->type == SymbolType::Variable && it2->second->state != SymbolState::Declaring)
                        {
                                SymbolDefs::VariableDef &def = *it2->second->variabledef;
                                if (def.is_substitute)
                                {
                                        SymbolDefs::VariableDef &def = *it2->second->variabledef;
    //                                    bool found = !def.substitutedef;

                                        // When found a table: look if we can bind
                                        // When found a record: bind
                                        bool to_bind;
                                        if (!def.substitutedef)
                                            to_bind = true;
                                        else
                                        {
                                                found_substitutedef = true;
                                                to_bind = false;
                                                for (SymbolDefs::TableDef::ColumnsDef::iterator it3 = def.substitutedef->columnsdef.begin();
                                                        it3 != def.substitutedef->columnsdef.end(); ++it3)
                                                    if (Blex::StrCaseCompare(it3->name, name) == 0)
                                                    {
                                                            if (to_bind && !symbol_vars) // Ignore if we already found a variable
                                                            {
                                                                    // Ambiguous symbol !! ADDME: is this check necessary?
                                                                    // ADDME: build better error, the mseesage is not the one we want
                                                                    context.errorhandler.AddErrorAt(position, Error::AmbiguousSymbol, name);
                                                                    return std::make_pair((Symbol *)0, false);
                                                            }
                                                            else
                                                                to_bind = true;
                                                    }
                                        }
                                        if (to_bind)
                                        {
                                                if (symbol_cols && !symbol_vars) // Ignore if we already found a variable
                                                {
                                                        context.errorhandler.AddErrorAt(position, Error::AmbiguousColumnColumn, name);
                                                        return std::make_pair((Symbol *)0, false);
                                                }
                                                symbol_cols = it2->second;
                                        }
                        }
                    }
                    if (symbol_cols || found_substitutedef)
                        break;
            }

        // Check if only 1 of the 2 is defined; otherwise we have ambiguity if the variable didnot come from the root or libscope
        if (symbol_vars)
        {
                if (symbol_cols)
                {
                        Scope const &libscope = *GetLibraryScope();
                        Scope::Symbols::const_iterator itr = libscope.symbols.find(symbol_vars->name);

                        // Emit a warning if from library scope
                        if(itr!=libscope.symbols.end() && itr->second == symbol_vars)
                        {
                          /* ADDME: Reconsider this warning ,triggers to often, eg when using FILE from common-v2.whlib
                                context.errorhandler.AddWarningAt(
                                        position,
                                        Warning::BoundToLibrarySymbol,
                                        name,
                                        symbol_vars->importlibrary->liburi / *,
                                        symbol_cols->name* /);
                                        */
                        }
                        else
                            if (symbol_cols->variabledef && symbol_cols->variabledef->substitutedef)
                            {
                                    if (symbol_cols->name[0] != ':')
                                        context.errorhandler.AddWarningAt(
                                                position,
                                                Warning::VarOverridesTableBind,
                                                name,
                                                symbol_cols->name);
                                    else
                                        context.errorhandler.AddWarningAt(
                                                position,
                                                Warning::VarOverridesAnonymousBind,
                                                name);
                            }

                        return std::make_pair(symbol_vars, false);
                }
                else
                    return std::make_pair(symbol_vars, false);
        }
        else
        {
                if (!symbol_cols)
                {
                        if (!is_tryout)
                            AddIsUnknownError(position, name, lookuptype);

                        return std::make_pair((Symbol *)0, true);
                }
                else
                {
                        if (symbol_cols->variabledef && !symbol_cols->variabledef->allow_substitute_use)
                            context.errorhandler.AddErrorAt(position, Error::SetRecordNoDependents);
                        return std::make_pair(symbol_cols, true);
                }
        }
}

Symbol * SymbolTable::ResolveSymbolInScope(const LineColumn &position, Scope const *scope, std::string const &name) const
{
        if (name.empty())
            return 0;

        Scope::Symbols::const_iterator itr = scope->symbols.find(name);
        if(itr!=scope->symbols.end())
        {
                if (itr->second->state == SymbolState::Declaring)
                {
                        // Symbol is being declared -> we cannot use it now
                        if (itr->second->type == SymbolType::Variable)
                            context.errorhandler.AddErrorAt(position, Error::NowDeclaringVariable, name);
                        else
                            // Our grammer should prevent this
                            context.errorhandler.AddErrorAt(position, Error::InternalError,"Symbol declaration within function arguments definition");
                }
                else if (itr->second->type == SymbolType::Ambiguous)
                {
                        context.errorhandler.AddErrorAt(position, Error::AmbiguousSymbol, itr->second->name);
                        itr->second->type = SymbolType::SignalledAmbiguous;
                        return 0;
                }
                else if (itr->second->type == SymbolType::SignalledAmbiguous)
                    return 0;
                else if (itr->second->state == SymbolState::SelectTemporary)
                {
                        context.errorhandler.AddErrorAt(position, Error::TemporaryOnlyInSelectPhase);
                }

                for (auto &litr: itr->second->exportlibraries)
                    litr->referred = true;
                return itr->second;
        }
        return 0;
}


Symbol * SymbolTable::ResolveSymbol(const LineColumn &position, std::string const &name, symbolmatch match, bool warn_if_deprecated) const
{
        if (name == "")
            return 0;
        std::vector<Scope *>::const_iterator it = scopestack.end();

        while(true)
        {
                if (it == scopestack.begin())
                    break;
                --it;
                Symbol *symbol = ResolveSymbolInScope(position, *it, name);
                if (symbol && (!match || match(*symbol)))
                {
                        if (warn_if_deprecated)
                            AddDeprecationWarnings(position, symbol);

                        return symbol;
                }
        }
        return 0;
}

Symbol * SymbolTable::ResolveVariableInParentScope(const LineColumn &, std::string const &name) const
{
        for (auto itr = scopestack.rbegin(); itr != scopestack.rend(); ++itr)
        {
                if (itr == scopestack.rbegin())
                    continue;

                Scope *scope = *itr;
                Scope::Symbols::const_iterator sitr = scope->symbols.find(name);
                if(sitr != scope->symbols.end() && sitr->second->type == SymbolType::Variable)
                {
                        for (auto &litr: sitr->second->exportlibraries)
                            litr->referred = true;
                        return sitr->second;
                }
        }
        return nullptr;
}

void SymbolTable::AddDeprecationWarnings(LineColumn const &position, Symbol *symbol) const
{
        if ((symbol->flags & SymbolFlags::Deprecated)
            && !symbol->did_deprecation_warning
            && (symbol->flags & SymbolFlags::Imported)) //never warn about local use
        {
                if (symbol->deprecation_message.empty())
                    context.errorhandler.AddWarningAt(position, Warning::DeprecatedIdentifier, symbol->name);
                else
                    context.errorhandler.AddWarningAt(position, Warning::DeprecatedIdentifierWithMsg, symbol->name, symbol->deprecation_message);
                symbol->did_deprecation_warning=true;
        }
}

Symbol * SymbolTable::RetrieveExternalFunction(const LineColumn &position, std::string const &name)
{
        Symbol *symbol = ResolveSymbol(position, name, SymbolTable::matchall, false);
        if (!symbol || !symbol->functiondef || (!(symbol->functiondef->flags & FunctionFlags::External) && !(symbol->functiondef->flags & FunctionFlags::IsSpecial)))
            context.errorhandler.AddErrorAt(position, Error::InternalError,"Builtin function '" + name + "' could not be resolved");
        return symbol;
}

Symbol * SymbolTable::RegisterForwardSymbol(const LineColumn &position, std::string const &name, SymbolType::Types type, bool isargument, bool register_funcs_in_current_scope)
{
        Symbol *symbol = 0;

        // Lookup the symbol. Don't use ResolveSymbolInScope, it gives back usage errors
        Scope::Symbols::const_iterator itr = scopestack.back()->symbols.find(name);
        if (itr != scopestack.back()->symbols.end())
            symbol = itr->second;

        if (symbol != 0)
        {
                // This is not an error when the symbol is declared forward and has the same type
                if (symbol->state != SymbolState::Forward)
                {
                        if (scopestack.size() == 2)
                            context.errorhandler.AddErrorAt(position, Error::AlreadyGloballyDefined, name);
                        else
                            if (!isargument)
                                context.errorhandler.AddErrorAt(position, Error::VarAlreadyDefinedInScope, name);
                        else
                                context.errorhandler.AddErrorAt(position, Error::DuplicateArgumentName, name);
                }
                else
                {
                        if (symbol->type != type)
                        {
                                // Variable forwards are not permitted yet, so this shouldn't happen
                                context.errorhandler.AddErrorAt(position, Error::FunctionForwardDeclAsVar, name);
                        }
                }
                // Use the declared name and type onwards
                symbol->name = name;
                symbol->type = type;
        }
        else
        {
                if (type == SymbolType::Function && !register_funcs_in_current_scope)
                {
                        Symbol *lib_symbol = ResolveSymbolInScope(position, GetLibraryScope(), name);
                        if (lib_symbol)
                        {
                                if (lib_symbol->flags & SymbolFlags::Public)
                                    context.errorhandler.AddErrorAt(position, Error::AlreadyGloballyDefined, name);
                                else if (!lib_symbol->functiondef || !(lib_symbol->functiondef->flags & FunctionFlags::Constructor))
                                    context.errorhandler.AddWarningAt(position, Warning::HidingDefinition, name, lib_symbol->importlibrary->liburi);
                        }
                        symbol = AddSymbolInScope(scopestack[1], name, type); // functions
                }
                else if (type == SymbolType::ObjectType)
                {
                        Symbol *lib_symbol = ResolveSymbolInScope(position, GetLibraryScope(), name);
                        if (lib_symbol)
                        {
                                if (lib_symbol->flags & SymbolFlags::Public)
                                    context.errorhandler.AddErrorAt(position, Error::AlreadyGloballyDefined, name);
                                else
                                    context.errorhandler.AddWarningAt(position, Warning::HidingDefinition, name, lib_symbol->importlibrary->liburi);
                        }
                        symbol = AddSymbolInScope(scopestack[1], name, type); // functions
                }
                else
                    symbol = AddSymbolInCurrentScope(name, type);
        }
        if (type == SymbolType::Variable)
        {
                symbol->variabledef = Adopt(new SymbolDefs::VariableDef);
        }
        else if (type == SymbolType::Function)
        {
                symbol->functiondef = Adopt(new SymbolDefs::FunctionDef);
        }
        else if (type == SymbolType::ObjectType)
        {
                symbol->objectdef = Adopt(new SymbolDefs::ObjectDef);
        }
        symbol->definitionposition = position;
        symbol->type = type;
        symbol->state = SymbolState::Declaring;
        return symbol;
}

Symbol * SymbolTable::RegisterNewCalledFunction (const LineColumn &position, std::string const &name, bool in_object_scope)
{
        Scope *scope =in_object_scope ? scopestack.back() : scopestack[1];
        Symbol *symbol(0);
        if (ResolveSymbolInScope(position, scope, name) != 0)
        {
                // Symbol already exists; caller should have checked that.
                symbol = Adopt(new Symbol(name, SymbolType::Function));
        }
        else
            symbol = AddSymbolInScope(scope, name, SymbolType::Function);
        symbol->state = SymbolState::Forward;
        symbol->definitionposition = position;
        return symbol;
}

void SymbolTable::RegisterDeclaredFunction (const LineColumn &definitionposition, Symbol * symbol, bool is_public)
{
        if(!symbol)
                throw std::runtime_error("RegisterDeclaredFunction called for NULL symbol");
        if (!symbol->functiondef)
                throw std::runtime_error("RegisterDeclaredFunction called for symbol not declared as a function");

        if(is_public)
            symbol->flags |= SymbolFlags::Public;

        symbol->definitionposition = definitionposition;
        symbol->state = SymbolState::Declared;
}

Symbol * SymbolTable::RegisterDeclaredObjectType (const LineColumn &definitionposition, Symbol *symbol, bool is_public)
{
        if(!symbol)
                throw std::runtime_error("RegisterDeclaredObjectType called for NULL symbol");
        if (!symbol->objectdef)
                throw std::runtime_error("RegisterDeclaredObjectType called for symbol not declared as a object type");

        if(is_public)
            symbol->flags |= SymbolFlags::Public;

        symbol->definitionposition = definitionposition;
        symbol->state = SymbolState::Declared;
        return symbol;
}

Symbol * SymbolTable::RegisterDeclaredVariable (const LineColumn &definitionposition, Symbol *symbol, bool is_public, bool is_global, VariableTypes::Type type)
{
        if (symbol == 0)
            symbol = AddSymbolInCurrentScope(":atemp"+Blex::AnyToString(++temporarycounter), SymbolType::Variable);

        //FIXME: Is this code change correct? (Arnold)  - anonymous doesn't seem to receive any uses but mine new one though..
        //WAS: symbol->anonymous = (symbol->name == "");
        if(is_public)
            symbol->flags |= SymbolFlags::Public;

        symbol->state = SymbolState::Declared;
        symbol->type = SymbolType::Variable;
        symbol->definitionposition = definitionposition;
        symbol->importlibrary = 0;

        if (!symbol->variabledef)
            symbol->variabledef = Adopt(new SymbolDefs::VariableDef);
        symbol->variabledef->type = type;
        symbol->variabledef->is_substitute = false;
        symbol->variabledef->substitutedef = 0;
        symbol->variabledef->is_global = is_global;

        if (GetCurrentScope() == GetRootScope())
        {
                Symbol *lib_symbol = ResolveSymbolInScope(definitionposition, GetLibraryScope(), symbol->name);
                if (lib_symbol)
                {
                        if (lib_symbol->flags & SymbolFlags::Public)
                            context.errorhandler.AddErrorAt(definitionposition, Error::AlreadyGloballyDefined, symbol->name);
                        else
                            context.errorhandler.AddWarningAt(definitionposition, Warning::HidingDefinition, symbol->name, lib_symbol->importlibrary->liburi);
                }
        }

        return symbol;
}

Symbol * SymbolTable::RegisterTempVariable(const LineColumn &definitionposition, VariableTypes::Type type)
{
        return context.symboltable->RegisterDeclaredVariable(definitionposition, 0, false, false, type);
}


void SymbolTable::RegisterLibrarySymbol (const LineColumn &, SymbolDefs::Library* lib, Symbol *symbol)
{
        //Look for any reason for the symbol to be ambiguous
        Scope::Symbols::iterator it = scopestack[0]->symbols.find(symbol->name);
        if (it != scopestack[0]->symbols.end())
        {
                //We found an existing version of the symbol!
                if (it->second->importlibrary == symbol->importlibrary)
                    it->second->exportlibraries.push_back(lib);
                else
                    it->second->type = SymbolType::Ambiguous;
                return;
        }

        scopestack[0]->symbols.insert(std::make_pair(symbol->name, symbol));
}

Symbol * SymbolTable::CreateSQLSubstituteRecord (const LineColumn &position, std::string const &name)
{
        Symbol *symbol;

        if (!name.empty())
            symbol = RegisterForwardSymbol(position, name, SymbolType::Variable, false, false);
        else
            symbol = RegisterForwardSymbol(position, ":atemp" + Blex::AnyToString(++temporarycounter), SymbolType::Variable, false, false);

        if (symbol == 0)
            return 0;

        symbol->state = SymbolState::Declared;
        symbol->type = SymbolType::Variable;
        symbol->importlibrary = 0;
        symbol->definitionposition = position;

        symbol->variabledef = Adopt(new SymbolDefs::VariableDef);
        symbol->variabledef->type = VariableTypes::Record;
        symbol->variabledef->is_substitute = true;
        symbol->variabledef->substitutedef = 0;
        return symbol;
}

void SymbolTable::ResetToLibraryScope(SavedState *state)
{
        state->scopestack = scopestack;
        if (scopestack.size() > 2)
            scopestack.erase(scopestack.begin() + 2, scopestack.end());
}

void SymbolTable::RestoreState(SavedState const &state)
{
        scopestack = state.scopestack;
}

std::string GetMangledFunctionName(Symbol *function_symbol)
{
        std::vector< VariableTypes::Type > paramtypes(function_symbol->functiondef->arguments.size());
        for (unsigned i=0;i<function_symbol->functiondef->arguments.size();++i)
            paramtypes[i] = function_symbol->functiondef->arguments[i].symbol->variabledef->type;

        std::string name = function_symbol->name;
        if (function_symbol->functiondef->object && function_symbol != function_symbol->functiondef->object->objectdef->constructor)
            name = function_symbol->functiondef->object->name + "#" + name;

        std::string mangledname;
        Mangling::MangleFunctionName(
                &mangledname,
                name.c_str(),
                function_symbol->functiondef->dllmodule.c_str(),
                function_symbol->functiondef->returntype,
                paramtypes.size(),
                (VariableTypes::Type*)&paramtypes[0]); // BCB bug: automatic cast from enum to unbderlying type...

        return mangledname;
}



namespace SymbolDefs
{

ObjectDef::ObjectDef()
: base(0)
, flags(ObjectTypeFlags::None)
, constructor(0)
, constructor_is_generated(true)
{
}


ObjectField * ObjectDef::FindField(std::string const &name, bool recursive)
{
        for (ObjectDef::Fields::iterator it = fields.begin(), end = fields.end(); it != end; ++it)
            if (it->name == name)
                return &*it;
        if (recursive && base)
            return base->objectdef->FindField(name, true);
        return 0;
}

bool ObjectDef::AddField(ObjectField const &field)
{
        if (FindField(field.name, false) == 0)
        {
                fields.push_back(field);
                return true;
        }
        return false;
}

} // End of namespace SymbolDefs

/** A sanity test */
bool TestSymbolTable()
{
        Symbol *symbol_a;
        Symbol *symbol_b;
        Symbol *symbol_c;
        unsigned errors = 0;

        CompilerContext c;
        SymbolTable test(c);

        symbol_a = test.RegisterForwardSymbol(LineColumn(), "Test1", SymbolType::Variable, false, false);
        test.RegisterDeclaredVariable(LineColumn(), symbol_a, false, false, VariableTypes::Integer);

        symbol_b = test.ResolveSymbol(LineColumn(), "Test1", NULL, false);
        if (symbol_a != symbol_b)
        {
                ++errors;DEBUGPRINT("Resolve Error - not found symbol");
        }
        symbol_b = test.ResolveSymbolInScope(LineColumn(), test.GetCurrentScope(), "Test1");
        if (symbol_a != symbol_b)
        {
                ++errors;DEBUGPRINT("Resolve Error - not found symbol");
        }
        symbol_c = test.ResolveSymbolInScope(LineColumn(), test.GetCurrentScope(), "Test2");
        if (symbol_c != NULL)
        {
                ++errors;DEBUGPRINT("Found symbol that should not have been found");
        }
        // ADDME: test ResolveSymbolEx!

        return (errors == 0) && (!c.errorhandler.AnyErrors());
}

} // End of namespace Compiler
} // End of namespace HareScript
