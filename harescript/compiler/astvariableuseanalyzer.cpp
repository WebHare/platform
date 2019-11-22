//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

/** Analyzes uses and definitions of global variables in functions.

    Every redefinition of a global variable is also a use of that variable. This
    is done to make sure that no two SSA versios of a global can exist at the
    same time. */

#include "astvariableuseanalyzer.h"
#include "utilities.h"
#include "debugprints.h"

namespace HareScript
{
namespace Compiler
{
using namespace AST;

ASTVariabeleUseAnalyzer::ASTVariabeleUseAnalyzer(CompilerContext &context)
: context(context)
{
}

ASTVariabeleUseAnalyzer::~ASTVariabeleUseAnalyzer()
{
}

void ASTVariabeleUseAnalyzer::Execute(AST::Module *module)
{
        GatherPrivateSymbolData(module);

        // Make sure every def in the initdata is also flagged as a use (we need that for the filtering)
        initdata->internal_usedsymbols.insert(initdata->internal_defdsymbols.begin(), initdata->internal_defdsymbols.end());

        // Get list of all globals
        FindAllGlobals();

        // Filter variable use-defs by the list of globals
        FilterRawVariableUseDefs();

        // Constructs call relation
        ConstructCallsRelation();

        // Propagate function-ptr call data to parent functions
        AnalyseFunctionPtrData();

        // Sets the uses and defs for all external functions
        SetExternalUseDefs();

        // Set the uses and defines for the initfunction
        std::set< Symbol * > globalsymbols_set(globalsymbols.begin(), globalsymbols.end());
        initdata->internal_usedsymbols = globalsymbols_set;
        initdata->internal_defdsymbols = globalsymbols_set;

        // Propagate all uses and defs to external functions
        WalkGraphBreadthFirst();

        // Copy all data from sets to vectors; those are speedier
        CopyDataToVectors();
}

void ASTVariabeleUseAnalyzer::SetDepths(Symbol *start)
{
        // First initfunction
        std::list<Symbol *> worklist(1, start);
        data[start].depth = 1;
        SetDepthsIterate(worklist);

        // Then the rest of the toplevel functions that are not called themselves (FIXME: is initfunction not one of these cases already? Then remove above code.)
        for (std::map<Symbol *, FunctionData>::iterator it = data.begin(); it != data.end(); ++it)
            if (it->second.is_coded && it->second.callers.empty())
            {
                    it->second.depth = 1;
                    worklist.insert(worklist.end(), it->first);
            }

        // Iterate and set the depths
        SetDepthsIterate(worklist);
}

void ASTVariabeleUseAnalyzer::SetDepthsIterate(std::list<Symbol *> &worklist)
{
        // Set the depths (one deeper for every nested call)
        while (!worklist.empty())
        {
                Symbol *symbol = worklist.front();
                worklist.pop_front();

                FunctionData &fdata = data[symbol];
                signed depth = fdata.depth;

                for (std::set<Symbol *>::const_iterator it = fdata.calledfunctions.begin(); it != fdata.calledfunctions.end(); ++it)
                    if (data[*it].depth == 0)
                    {
                            // Only initialize once.
                            data[*it].depth = depth + 1;
                            worklist.insert(worklist.end(), *it);
                    }
        }
}

void ASTVariabeleUseAnalyzer::FindAllGlobals()
{
        // Begin with current globals
        globalsymbols.clear();
        std::vector< Symbol * > imports;
        for(Scope::Symbols::const_iterator itr = context.symboltable->GetLibraryScope()->symbols.begin(), end = context.symboltable->GetLibraryScope()->symbols.end();
            itr != end;
            ++itr)
            imports.push_back(itr->second);

        std::sort(imports.begin(), imports.end());

        // Create a sorted vector of all variable symbols defined in the initfunction (created from set, so already sorted)
        std::vector< Symbol * > filter;
        filter.reserve(imports.size() + initdata->internal_defdsymbols.size());
        std::set_union(imports.begin(), imports.end(),
                initdata->internal_defdsymbols.begin(), initdata->internal_defdsymbols.end(),
                std::back_inserter(filter));

        // Filter all functions (except initfunction)
        for (std::map<Symbol *, FunctionData>::iterator fit = data.begin(); fit != data.end(); ++fit)
        {
                if (&fit->second != initdata)
                {
                        // Copy all symbols that also exist in the initfunction back into globalsymbols
                        std::set_intersection(fit->second.internal_usedsymbols.begin(), fit->second.internal_usedsymbols.end(),
                                filter.begin(), filter.end(),
                                std::back_inserter(globalsymbols));
                }
        }

        // Add all public and imported variables from initfunction
        for (std::set< Symbol * >::iterator it = initdata->internal_usedsymbols.begin(); it != initdata->internal_usedsymbols.end(); ++it)
            if ((*it)->flags & (SymbolFlags::Public | SymbolFlags::Imported))
                globalsymbols.push_back(*it);

        // Also add outsidestate
        globalsymbols.push_back(mdl->outsidestate);

        // Sort and remove duplicates
        std::sort(globalsymbols.begin(), globalsymbols.end());
        globalsymbols.erase(std::unique(globalsymbols.begin(), globalsymbols.end()), globalsymbols.end());
}

void ASTVariabeleUseAnalyzer::FilterRawVariableUseDefs()
{
        // Now filter every uses and defs by the defs of the initfunctions + imports (they can't be global otherwise)
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
        {
                currentdata = &it->second;
                currentdata->is_coded = true;

                if (currentdata != initdata)
                {
                        std::set<Symbol *> s;
                        s.swap(currentdata->internal_usedsymbols);

                        // Copy only the globals back
                        std::set_intersection(s.begin(), s.end(),
                                              globalsymbols.begin(), globalsymbols.end(),
                                              Utilities::associative_inserter(currentdata->internal_usedsymbols));

                        // The same for internal_defdsymbols
                        s.clear();
                        s.swap(currentdata->internal_defdsymbols);
                        std::set_intersection(s.begin(), s.end(),
                                              globalsymbols.begin(), globalsymbols.end(),
                                              Utilities::associative_inserter(currentdata->internal_defdsymbols));
                }
        }
}

void ASTVariabeleUseAnalyzer::ConstructCallsRelation()
{
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
        {
                Symbol *symbol = it->first;
                FunctionData &fdata = data[symbol];
                for (std::set<Symbol *>::iterator it2 = fdata.calledfunctions.begin(); it2 != fdata.calledfunctions.end(); ++it2)
                {
                        FunctionData &ifdata = data[*it2];
                        ifdata.callers.insert(symbol);
                        ++fdata.unprocessed_calledfncs;
                }
        }
}

void ASTVariabeleUseAnalyzer::AnalyseFunctionPtrData()
{
        std::vector< Symbol * > worklist;
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
            if (it->first->functiondef->flags & FunctionFlags::ExecutesHarescript)
                worklist.push_back(it->first);

        // Copy ExecutesHarescript flag to callers; process them if their flag was not set
        while (!worklist.empty())
        {
                Symbol *current = worklist.back();
                worklist.pop_back();

                FunctionData &fdata = data[current];

                for (std::set< Symbol * >::iterator it2 = fdata.callers.begin(); it2 != fdata.callers.end(); ++it2)
                    if (!((*it2)->functiondef->flags & FunctionFlags::ExecutesHarescript))
                    {
                            (*it2)->functiondef->flags |= FunctionFlags::ExecutesHarescript;
                            worklist.push_back(*it2);
                    }
        }
}

void ASTVariabeleUseAnalyzer::SetExternalUseDefs()
{
        std::set< Symbol * > globalsymbols_set(globalsymbols.begin(), globalsymbols.end());
        std::set< Symbol * > imported_globalsymbols_set;
        for (std::vector< Symbol * >::iterator it = globalsymbols.begin(); it != globalsymbols.end(); ++it)
            if (((*it)->flags & SymbolFlags::Imported) || *it == mdl->outsidestate)
                imported_globalsymbols_set.insert(*it);

        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
        {
//                if (!functionsymbolmappings.count(it->first))
//                {
                        // This is not a local function. add all imported global variables, and :outsidestate
                        if (!(it->first->functiondef->flags & FunctionFlags::Constant))
                        {
                                if (it->first->functiondef->flags & FunctionFlags::ExecutesHarescript)
                                {
                                        Utilities::append_all_from(it->second.internal_defdsymbols, globalsymbols_set);
                                        Utilities::append_all_from(it->second.internal_usedsymbols, globalsymbols_set);
                                }
                                else
                                {
                                        if (!(it->first->functiondef->flags & FunctionFlags::NoStateModify))
                                            Utilities::append_all_from(it->second.internal_defdsymbols, imported_globalsymbols_set);
                                        Utilities::append_all_from(it->second.internal_usedsymbols, imported_globalsymbols_set);
                                }
                        }
//                }
                // Always use outside state for macros that terminate (for safety). Also do :THROWERROR, that doesn't have the TERMINATE flag set
                // (for flow-analysis, to determine whether a function doesn't return a value).
                if (it->first->functiondef->flags & FunctionFlags::Terminates || it->first->name == ":THROWERROR")
                {
                        it->second.internal_usedsymbols.insert(mdl->outsidestate);
                        it->second.internal_defdsymbols.insert(mdl->outsidestate);
                }
        }
}

void ASTVariabeleUseAnalyzer::WalkGraphBreadthFirst()
{
        /** Walk breadth first; process all functions that do not call unprocessed
            functions */
        std::deque< Symbol * > worklist;
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
            if (it->second.unprocessed_calledfncs == 0)
                worklist.push_back(it->first);

        // Process all functions that not have unprocessed callees.
        while (!worklist.empty())
        {
                Symbol *current = worklist.front();
                worklist.pop_front();

                FunctionData &currentdata = data[current];

                PropagateToCallers(currentdata);
                currentdata.is_processed = true;

                for (std::set< Symbol * >::iterator cit = currentdata.callers.begin(); cit != currentdata.callers.end(); ++cit)
                {
                        FunctionData &callerdata = data[*cit];

                        // Process the caller if it does not have unprocessed callees left
                        if (--callerdata.unprocessed_calledfncs == 0)
                            worklist.push_back(*cit);
                }
        }

        // Check if there are any functions left; if so we have recursive calls (and thus a cycle in the graph).
        std::multimap< signed, Symbol * > worklist2;
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
            if (!it->second.is_processed)
                 worklist2.insert(std::make_pair(it->second.depth, it->first));

        if (worklist2.empty())
            return;

        /* Visit all non-processed functions; take the deepest in the hierarchy first
           ADDME: hierarchy based is not the best; there are cases that will go wrong here and give
                  very bad performance (A->B->C->B + A->D->E->F->G->B, B getting at place 2, with G at place 6) */
        while (!worklist2.empty())
        {
                std::multimap< signed, Symbol * >::iterator last = worklist2.end(); --last;
                Symbol *symbol = last->second;
                worklist2.erase(last);

                FunctionData &currentdata = data[symbol];
                currentdata.is_processed = true;

                for (std::set< Symbol * >::iterator cit = currentdata.callers.begin(); cit != currentdata.callers.end(); ++cit)
                {
                        FunctionData &callerdata = data[*cit];

                        if (PropagateToCaller(currentdata, *cit) || !callerdata.is_processed)
                             worklist2.insert(std::make_pair(callerdata.depth, *cit));
                }
        }
}

bool ASTVariabeleUseAnalyzer::PropagateToCaller(FunctionData &fdata, Symbol *caller)
{
        bool has_change = false;
        FunctionData &cfdata = data[caller];

        for (std::set<Symbol *>::iterator it2 = fdata.internal_usedsymbols.begin(); it2 != fdata.internal_usedsymbols.end(); ++it2)
            has_change = cfdata.internal_usedsymbols.insert(*it2).second || has_change; // Don't switch! || is a sequence point
        for (std::set<Symbol *>::iterator it2 = fdata.internal_defdsymbols.begin(); it2 != fdata.internal_defdsymbols.end(); ++it2)
            has_change = cfdata.internal_defdsymbols.insert(*it2).second || has_change; // Don't switch! || is a sequence point

        return has_change;
}

bool ASTVariabeleUseAnalyzer::PropagateToCallers(FunctionData &fdata)
{
        bool has_change = false;
        for (std::set< Symbol * >::iterator it = fdata.callers.begin(); it != fdata.callers.end(); ++it)
            has_change = PropagateToCaller(fdata, *it) || has_change;

        return has_change;
}

void ASTVariabeleUseAnalyzer::CopyDataToVectors()
{
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
        {
                it->second.usedsymbols.assign(it->second.internal_usedsymbols.begin(), it->second.internal_usedsymbols.end());
                it->second.defdsymbols.assign(it->second.internal_defdsymbols.begin(), it->second.internal_defdsymbols.end());

                // ADDME: clear all internal fields if they hold lots of memory
        }
}

// *****************************************************************************
//
//    AST walker
//
//

void ASTVariabeleUseAnalyzer::GatherPrivateSymbolData(AST::Module *module)
{
        assignment_lvalue = false;
        initdata = 0;
        initsymbol = 0;
        mdl = module;

        // Build all the uses and defs for the invidual functions
        for (std::vector<AST::Function *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
        {
                currentdata = &data[(*it)->symbol];
                if ((*it)->symbol->name == ":INITFUNCTION")
                {
                        initdata = currentdata;
                        initsymbol = (*it)->symbol;
                }
//                else if ((*it)->symbol->name == "__HS_CALL_INTERNAL_FUNCTION_REF")
//                {
//                        functionptrcalldata = currentdata;
//                }
                Visit(*it, Empty());
        }

        // Build data structures for all called functions
        for (std::map< Symbol *, FunctionData >::iterator it = data.begin(); it != data.end(); ++it)
            for (std::set< Symbol * >::iterator cit = it->second.calledfunctions.begin(); cit != it->second.calledfunctions.end(); ++cit)
                data[*cit];

        assert(initdata && initsymbol);
}

void ASTVariabeleUseAnalyzer::V_ArrayDelete(AST::ArrayDelete *obj, Empty)
{
        assignment_lvalue = true;
        Visit(obj->array, Empty());
        assignment_lvalue = false;
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
}
void ASTVariabeleUseAnalyzer::V_ArrayElementModify(AST::ArrayElementModify *obj, Empty)
{
        assignment_lvalue = true;
        Visit(obj->array, Empty());
        assignment_lvalue = false;
        Visit(obj->index, Empty());
        Visit(obj->value, Empty());
}
void ASTVariabeleUseAnalyzer::V_ArrayInsert(AST::ArrayInsert *obj, Empty)
{
        assignment_lvalue = true;
        Visit(obj->array, Empty());
        assignment_lvalue = false;
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
        Visit(obj->value, Empty());
}
void ASTVariabeleUseAnalyzer::V_Assignment(AST::Assignment *obj, Empty)
{
        // Array ref: the array is assigned to, the source is only used
        assignment_lvalue = true;
        Visit(obj->target, Empty());
        assignment_lvalue = false;
        Visit(obj->source, Empty());
}
void ASTVariabeleUseAnalyzer::V_BuiltinInstruction(AST::BuiltinInstruction *obj, Empty)
{
        if (obj->calls_harescript)
        {
                current_function->functiondef->flags |= FunctionFlags::ExecutesHarescript;
        }
        else if (obj->modifies_outsidestate)
        {
                currentdata->internal_usedsymbols.insert(mdl->outsidestate);
                currentdata->internal_defdsymbols.insert(mdl->outsidestate);
        }
        AllNodeVisitor::V_BuiltinInstruction(obj, Empty());
}
void ASTVariabeleUseAnalyzer::V_DeepOperation(AST::DeepOperation *obj, Empty)
{
        if (!obj->clvalue.basevar)
            throw std::runtime_error("No basevar in deep operation!");

        currentdata->internal_usedsymbols.insert(obj->clvalue.basevar);
        currentdata->internal_defdsymbols.insert(obj->clvalue.basevar);

        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr) Visit(it->expr, Empty());
}
void ASTVariabeleUseAnalyzer::V_DeepArrayDelete(AST::DeepArrayDelete *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
}
void ASTVariabeleUseAnalyzer::V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
        Visit(obj->value, Empty());
}
void ASTVariabeleUseAnalyzer::V_Function(AST::Function *obj, Empty)
{
        current_function = obj->symbol;
        Visit(obj->block, Empty());
        functionsymbolmappings[obj->symbol] = obj;
}
void ASTVariabeleUseAnalyzer::V_FunctionCall(AST::FunctionCall *obj, Empty)
{
        currentdata->calledfunctions.insert(obj->symbol);
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, Empty()));
}
void ASTVariabeleUseAnalyzer::V_LvalueSet(AST::LvalueSet *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        Visit(obj->value, Empty());
}
void ASTVariabeleUseAnalyzer::V_InitializeStatement(AST::InitializeStatement *obj, Empty)
{
        currentdata->internal_defdsymbols.insert(obj->symbol);
        // Imported symbols can never be initialized, so we don't need to add :outsidestate
}
void ASTVariabeleUseAnalyzer::V_RecordCellDelete(AST::RecordCellDelete *obj, Empty)
{
        assignment_lvalue = true;
        Visit(obj->record, Empty());
        assignment_lvalue = false;
}
void ASTVariabeleUseAnalyzer::V_RecordCellSet(AST::RecordCellSet *obj, Empty)
{
        assignment_lvalue = true;
        Visit(obj->record, Empty());
        assignment_lvalue = false;
        Visit(obj->value, Empty());
}
void ASTVariabeleUseAnalyzer::V_ObjectMemberConst(AST::ObjectMemberConst *obj, Empty e)
{
        AllNodeVisitor::V_ObjectMemberConst(obj, e);

        // Can't see the side-effects
        currentdata->internal_usedsymbols.insert(mdl->outsidestate);
        currentdata->internal_defdsymbols.insert(mdl->outsidestate);

        // Treat this as a function ptr call (it might be a property, calling a getter function)
        current_function->functiondef->flags |= FunctionFlags::ExecutesHarescript;
}

void ASTVariabeleUseAnalyzer::V_ObjectMethodCall(AST::ObjectMethodCall *obj, Empty e)
{
        Visit(obj->object, e);
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetVisitorFunctor(this, e));

        // Can't see the side-effects
        currentdata->internal_usedsymbols.insert(mdl->outsidestate);
        currentdata->internal_defdsymbols.insert(mdl->outsidestate);

        // Treat this as a function ptr call
        current_function->functiondef->flags |= FunctionFlags::ExecutesHarescript;
}
void ASTVariabeleUseAnalyzer::V_ObjectMemberSet(AST::ObjectMemberSet *obj, Empty)
{
        // Can't see the side-effects
        currentdata->internal_usedsymbols.insert(mdl->outsidestate);
        currentdata->internal_defdsymbols.insert(mdl->outsidestate);

        // Treat this as a function ptr call (it might be a property, calling a setter function)
        current_function->functiondef->flags |= FunctionFlags::ExecutesHarescript;

//      Not really an assignment of an object here.
//        assignment_lvalue = true;
        Visit(obj->object, Empty());
//        assignment_lvalue = false;
        Visit(obj->value, Empty());
}
void ASTVariabeleUseAnalyzer::V_Variable(AST::Variable *variable, Empty)
{
        ///ADDME: If this is an assignment_lvalue, use this variable only when it is a global. Modify FindAllGlobals also!
        currentdata->internal_usedsymbols.insert(variable->symbol);
        if (variable->symbol->flags & SymbolFlags::Imported)
            currentdata->internal_usedsymbols.insert(mdl->outsidestate);

        if (assignment_lvalue)
        {
                currentdata->internal_defdsymbols.insert(variable->symbol);
                if (variable->symbol->flags & SymbolFlags::Imported)
                    currentdata->internal_defdsymbols.insert(mdl->outsidestate);
        }
}

} // end of namespace Compiler
} // end of namespace HareScript

