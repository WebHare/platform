//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "ast.h"
#include "ilgenerator.h"
#include "utilities.h"
#include "debugprints.h"

//#define SHOWFLOWSTATES


#ifdef SHOWFLOWSTATES
 #define FSPRINT(a) CONTEXT_DEBUGPRINT(a)
 #define FSONLY(a) DEBUGONLY(a)
#else
 #define FSPRINT(a)
 #define FSONLY(a)
#endif

namespace HareScript
{
namespace Compiler
{
using namespace IL;

CCostream & operator <<(CCostream &out, ILGenerator::LoopStackElement const &lse)
{
        out << "breaks"<<std::endl;
        for (std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> >::const_iterator it = lse.breaks.begin();
                it != lse.breaks.end(); ++it)
            out << " " << (long)it->first << ": " << *it->second;
        out << "continues"<<std::endl;
        for (std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> >::const_iterator it = lse.continues.begin();
                it != lse.continues.end(); ++it)
            out << " " << (long)it->first << ": " << *it->second;
        return out;
}

void ILGenerator::LinkBlocks(BasicBlock *from, BasicBlock *to, bool is_throw)
{
        FSPRINT("Linking from: " << from << " to: " << to << ", throw: " << (is_throw ? "yes" : "no"));

        if (from && to)
        {
                if (is_throw)
                    from->throwcatchers.push_back(to);
                else
                    from->successors.push_back(to);
                to->predecessors.push_back(from);

                // figure out dominator relations
                if (!to->dominator)
                {
                        // 'to' does not have a dominator yet; so from becomes his dominator.
                        to->dominator = from;
                        from->dominees.push_back(to);
                }
                else
                {
                        /* 'to' already has a dominator (lets say X). If 'from' is not dominated by X, then
                           X is not 'to's dominator after adding the link from 'from' to 'to'.
                           We must find the new dominator of 'to', that is the last block that both dominates
                           X and from. */

                        // Get all dominators of 'from'
                        std::set<BasicBlock *> from_dominatorlist;
                        for (BasicBlock *it = from; it; it = it->dominator)
                            from_dominatorlist.insert(it);

                        // Walk to the root of the dominator tree, starting at X. If we find a dominator of 'from', we're done.
                        BasicBlock *newdominator;
                        for (newdominator = to->dominator;newdominator;newdominator = newdominator->dominator)
                            if (from_dominatorlist.count(newdominator) != 0)
                                break;

                        if (!newdominator)
                            throw std::logic_error("Two distinct dominator trees in function!");

                        // Erase the old dominator line, and build the new one.
                        to->dominator->dominees.erase(std::find(to->dominator->dominees.begin(), to->dominator->dominees.end(), to));
                        to->dominator = newdominator;
                        newdominator->dominees.push_back(to);

                        FSPRINT("New dominator of to: " << newdominator);
                }
        }
        else
        {
                // Dead code!
        }
}

#ifdef DEBUG_SSA_ID_NUMBERING
unsigned ILGenerator::GetAssignId(IL::Variable *var)
{
        return ++ssacounter[var];
}
#else
unsigned ILGenerator::GetAssignId(IL::Variable *)
{
        return ++tempcounter;
}
#endif

SSAVariable * ILGenerator::GetVariable(Symbol *symbol)
{
        std::map<Symbol *, SSAVariable *>::iterator it = variablemappings.find(symbol);
        if (it == variablemappings.end())
        {
                //FIXME: symble->variabledef == NULL hits us when we're doing a GetVariable on ":outsidestate"
                //       we'll just assume :outsidestate is Variant, but this code probably needs fixing (Arnold)
                Variable *var = Adopt(new Variable(symbol->variabledef ? symbol->variabledef->type : VariableTypes::Variant));
//                if (currentfunc)
//                    currentfunc->allvariables.insert(var);

                if (std::binary_search(vuanalyzer->globalsymbols.begin(), vuanalyzer->globalsymbols.end(), symbol))
                    var->storagetype = Variable::Global;
                else
                    var->storagetype = Variable::Stack;
                var->name = symbol->name;
                var->symbol = symbol;
                assert(symbol->name == ":outsidestate" || symbol->variabledef);

                SSAVariable *ssavar = Adopt(new SSAVariable(var));
                it = variablemappings.insert(std::make_pair(symbol, ssavar)).first;
        }
        return it->second;
}

AssignSSAVariable * ILGenerator::GetAssignedTemporary(VariableTypes::Type type)
{
        Variable *var = Adopt(new Variable(type));
        var->storagetype = Variable::Stack;
        var->name = ":itemp" + Blex::AnyToString(++tempcounter);
        var->symbol = 0;
        AssignSSAVariable *ssavar = Adopt(new AssignSSAVariable(var, GetAssignId(var)));
        return ssavar;
}

AssignSSAVariable * ILGenerator::GetAssignCopy(SSAVariable *var)
{
        AssignSSAVariable *ssavar = Adopt(new AssignSSAVariable(var->variable, GetAssignId(var->variable)));
        return ssavar;
}

void ILGenerator::MergeFlowStates(BasicBlock *block, IL::FlowState &state, std::vector<std::pair<IL::BasicBlock *, IL::FlowState *> > const &mergeparams)
{
        state.visibleassignments.clear();
        std::set<Variable *> phivars;

        FSONLY(
        FSPRINT("MergeFlowStates: " << block);
        for (std::vector<std::pair<BasicBlock *, IL::FlowState *> >::const_iterator it = mergeparams.begin();
                it != mergeparams.end(); ++it)
          FSPRINT(" In: " << it->first << ": " << *it->second);
        );

        /** Merge the variables in the different flow states to state. Also build
            a set of ssavariables that need a phi function (their variables exist in multiple flowstates) */
        for (std::vector<std::pair<BasicBlock *, IL::FlowState *> >::const_iterator it = mergeparams.begin();
                it != mergeparams.end(); ++it)
        {
                for (std::map<IL::Variable *, IL::AssignSSAVariable *>::const_iterator it2 = it->second->visibleassignments.begin();
                        it2 != it->second->visibleassignments.end(); ++it2)
                {
                        if (state.visibleassignments[it2->first] == 0)
                            state.visibleassignments[it2->first] = it2->second;
                        else
                            if (state.visibleassignments[it2->first]->id != it2->second->id)
                                phivars.insert(it2->first);
                }
        }
        /** In code generation, a variable has (per flowstate) only one SSAVariable; so we can iterate over all variables
            that have to be phi'd. */
        for (std::set<Variable *>::iterator it = phivars.begin(); it != phivars.end(); ++it)
        {
                /* Invariant: there are two ore more flowstates in mergeparam. (otherwise, no phi!) */
                // Get an assigned ssavariable from the ssavariable in the first flowstate
                if (!mergeparams.front().second->visibleassignments.count(*it))
                {
                        // This variable not visible in one of the sources, no phi needed
                        state.visibleassignments.erase(*it);
                        continue;
                }
                AssignSSAVariable *phivar = GetAssignCopy(mergeparams.front().second->visibleassignments[*it]);
                PhiFunction *phi = Adopt(new PhiFunction(phivar));

                bool no_phi_needed = false;
                for (std::vector<std::pair<IL::BasicBlock *, IL::FlowState *> >::const_iterator it2 = mergeparams.begin();
                        it2 != mergeparams.end(); ++it2)
                {
                        std::map<IL::Variable *, IL::AssignSSAVariable *>::const_iterator it3 = it2->second->visibleassignments.find(*it);
                        if (it3 != it2->second->visibleassignments.end())
                            phi->params.push_back(std::make_pair(it3->second, it2->first));
                        else
                        {
                                // This variable is not visible in one of the sources, no phi needed
                                state.visibleassignments.erase(*it);
                                no_phi_needed = true;
                                break;
                        }
                }
                if (no_phi_needed)
                    continue;

                FSPRINT("  Adding PHI to " << block << " for " << phivar);

                block->phifunctions.push_back(phi);
                state.visibleassignments[phivar->variable] = phivar;
        }
        FSPRINT(" Result: " << state);
}

ILFunctionCall * ILGenerator::CreateFunctionCall(LineColumn _position, AssignSSAVariable *_target, Function *_function, std::vector<SSAVariable *> const &_values)
{
        std::vector<SSAVariable *> values(_values);

        // For varags calls, gather the extra arguments into the variant array
        if (_function->symbol && _function->symbol->functiondef->flags & FunctionFlags::VarArg)
        {
                unsigned normal_args = _function->symbol->functiondef->arguments.size() - 1;

                AssignSSAVariable *varargs = GetAssignedTemporary(_function->symbol->functiondef->arguments.back().symbol->variabledef->type);

                Function *arrayappend_func = Adopt(new Function);
                arrayappend_func->name = ":ARRAYAPPEND";

                AddInstruction(Adopt(new ILConstant(_position, varargs, VariableTypes::VariantArray, 0)), false, false);
                for (std::vector<SSAVariable *>::iterator it = values.begin() + normal_args; it != values.end(); ++it)
                {
                        AssignSSAVariable *new_varargs = GetAssignCopy(varargs);

                        std::vector<SSAVariable *> aa_values;
                        aa_values.push_back(varargs);
                        aa_values.push_back(*it);

                        ILFunctionCall *call = Adopt(new ILFunctionCall(_position, new_varargs, arrayappend_func, aa_values));
                        AddInstruction(call, true, true);

                        varargs = new_varargs;
                }
                values.erase(values.begin() + normal_args, values.end());
                values.push_back(varargs);
        }

        ILFunctionCall *call = Adopt(new ILFunctionCall(_position, _target, _function, values));

        // Add all the variables this function uses into the instruction uses
        Symbol *symbol = _function->symbol;
        for (std::vector<Symbol *>::const_iterator it = vuanalyzer->data[symbol].usedsymbols.begin(); it != vuanalyzer->data[symbol].usedsymbols.end(); ++it)
        {
                call->usedefs.AddUse(GetVariable(*it));
        }

        /* Add all the variables this function defines into the instruction defines. We don't need to care that a for
           global variable dependencies; the AstVariableUseAnalyzer has made sure that a definition of a global is also a use
           of that global */
        for (std::vector<Symbol *>::const_iterator it = vuanalyzer->data[symbol].defdsymbols.begin(); it != vuanalyzer->data[symbol].defdsymbols.end(); ++it)
        {
                SSAVariable *var = GetVariable(*it);
                AssignSSAVariable *ssavar = GetAssignCopy(var);
                call->usedefs.AddDef(ssavar);
        }

        if (_function->modifies_outsidestate)
        {
                call->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
                call->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));
        }

        return call;
}

IL::ILReturn * ILGenerator::CreateReturn(LineColumn _position, IL::SSAVariable * const _returnvalue)
{
        ILReturn *obj = Adopt(_returnvalue ? new ILReturn(_position, *_returnvalue) : new ILReturn(_position));

        // We add all modified globals this returns sees into the uses list

        // Get the list of all visible ssavars
        std::set<AssignSSAVariable *> visible_ssavars;
        std::transform(flowstate.visibleassignments.begin(),
                       flowstate.visibleassignments.end(),
                       std::inserter(visible_ssavars, visible_ssavars.begin()),
                       Utilities::pair_second<IL::Variable *, IL::AssignSSAVariable *>());

        std::set<AssignSSAVariable *> function_globals(currentfunc->globalvars.begin(), currentfunc->globalvars.end());

        // Build the list of all modified variables (all unmodified globals are removed)
        std::set<AssignSSAVariable *> modifiedvars;
        std::set_difference(visible_ssavars.begin(), visible_ssavars.end(),
                            function_globals.begin(), function_globals.end(),
                            std::inserter(modifiedvars, modifiedvars.begin()) );

        // Add all variables that are globals
        std::set<AssignSSAVariable *> modifiedglobals;
        for (std::set<IL::AssignSSAVariable *>::iterator it = modifiedvars.begin(); it != modifiedvars.end(); ++it)
        {
            if (mdl->globalvars.count((*it)->variable))
                obj->usedefs.AddUse(*it);
        }

        return obj;
}

AST::Variable* ILGenerator::GetLvalueVar(AST::Lvalue* val)
{
        /* An assigment needs special work done. We cannot just visit a Lvalue object
           for the store because that will not create a correct function.

           The easyest way to do this is put all special code here */

        AST::Variable* var = dynamic_cast<AST::Variable*>(val);
        if (!var)
        {
                AST::ExpressionBlock* eb = dynamic_cast<AST::ExpressionBlock*>(val);
                var = Adopt(new AST::Variable(eb->returnvar->position, eb->returnvar->symbol));
        }
        return var;
}

Module * ILGenerator::Execute(Module *&ilmodule, AST::Module* module, ASTVariabeleUseAnalyzer *_vuanalyzer)
{
        vuanalyzer = _vuanalyzer;
        // Initialize everything to 0
        tempcounter = 0;
        currentfunc = 0;
        current = 0;
        exception_catchers = 0;
        finally_statement = 0;
        finally_catchers = 0;
//        current_catch = 0;
        variablemappings.clear();
        while (!loopstack.empty())
            loopstack.pop();

        mdl = Adopt(new Module);
        ilmodule = mdl;
        mdl->orgsrcname = module->orgsrcname;
        mdl->globalvars.insert(GetVariable(module->outsidestate)->variable);
        mdl->exportedvars = module->exportedvars;
        mdl->loadlibs = module->loadlibs;
        mdl->scriptproperty_fileid = module->scriptproperty_fileid;
        mdl->scriptproperty_filecreationdate = module->scriptproperty_filecreationdate;
        mdl->scriptproperty_systemredirect = module->scriptproperty_systemredirect;
        mdl->deinitmacro = NULL;
        Visit(module, Empty());

        return mdl;
}

void ILGenerator::AddInstruction(ILInstruction *ili, bool can_cause_undef, bool is_observable)
{
        // Don't do anything on dead code
        if (current)
        {
                if (can_cause_undef || is_observable)
                    ili->usedefs.AddUse(extstate);
                if (is_observable)
                {
                        extstate = GetAssignCopy(extstate);
                        ili->usedefs.AddDef(extstate);
                }

                current->instructions.push_back(ili);

                // Update the flowstate with all the defs of this instruction
                ili->usedefs.AddUsesForDefinedGlobals(flowstate);
                ili->usedefs.UpdateFlowState(flowstate);
//                for (std::set<AssignSSAVariable *>::iterator it = ili->defs.begin(); it != ili->defs.end(); ++it)
//                {
//                        if ((*it)->variable->storagetype == Variable::Global)
//                            ili->uses.insert(flowstate.visibleassignments[(*it)->variable]);
//                        flowstate.visibleassignments[(*it)->variable] = (*it);
//                }
#ifdef DEBUG
                // Check for illegal instructions
                std::set<SSAVariable*> varlist;
                ili->InsertDefined(&varlist);
                ili->InsertUsed(&varlist);
                for (std::set<SSAVariable*>::const_iterator it = varlist.begin(); it != varlist.end(); ++it)
                    if (*it == 0)
                        throw Message(true,Error::InternalError, "Invalid variable reference used in bytecode-instruction");
#endif
        }
}

void ILGenerator::AddThrowingInstruction(ILInstruction *ili)
{
        BasicBlock *block = 0;
        if (current && exception_catchers)
        {
                block = Adopt(new BasicBlock(ili->position));
                block->is_exception_target = true;
                LinkBlocks(current, block, true);

                ili->on_exception = block;

                FSPRINT("Going to add throwing instruction, catcher block " << block << ", flowstate: " << flowstate);
                FSPRINT("for instr " << *ili);
        }

        AddInstruction(ili, true, true);

        // Get the flowstate AFTER the instr; global variables may have changed
        if (current && exception_catchers)
        {
                CatchBlock cb;
                cb.block = block;
                cb.flowstate = flowstate;

                FSPRINT("Added exception catcher block " << block << ", flowstate: " << flowstate);
                FSPRINT("for instr " << *ili);

                exception_catchers->push_back(cb);
        }
}

AssignSSAVariable * ILGenerator::GetLValueTarget(AST::Lvalue *lvalue)
{
        /* An assigment needs special work done. We cannot just visit a Lvalue object
           for the store because that will not create a correct function.

           The easyest way to do this is put all special code here */

        AST::Variable *varrr = dynamic_cast<AST::Variable *>(lvalue);
        AST::ExpressionBlock * ebrrr = dynamic_cast<AST::ExpressionBlock *>(lvalue);
        if (!varrr)
            varrr = ebrrr->returnvar;

        if (!varrr)
            throw std::runtime_error(std::string() + "ILGenerator: lvalue type " + lvalue->GetName() +" not supported");

        return GetAssignCopy(Visit(lvalue, Empty()));
}

AssignSSAVariable * ILGenerator::EncodeDeepOperation(AST::DeepOperation *obj, std::vector<SSAVariable *> const &_params, std::string const &funcname, std::string const &funcnamethis)
{
        std::vector<SSAVariable *> params(_params);
        std::string layers;

        if (obj->clvalue.layers.empty())
            throw std::runtime_error("Deep operation without any layers found - not allowed!");

        // The parameter order here is the push order; the top layer needs to be pushed first.
        for (AST::LvalueLayers::reverse_iterator it = obj->clvalue.layers.rbegin(); it != obj->clvalue.layers.rend(); ++it)
        {
                if (it->type == AST::LvalueLayer::Array)
                {
                    layers = "A" + layers;
                    params.push_back(Visit(it->expr, Empty()));
                }
                else
                {
                        if (it->type == AST::LvalueLayer::Object)
                            layers = "O" + layers;
                        else
                            layers = "R" + layers;

                        assert(it->expr);
                        params.push_back(Visit(it->expr, Empty()));
                }
        }
        AssignSSAVariable *layers_var = GetAssignedTemporary(VariableTypes::String);
        AddInstruction(Adopt(new ILConstant(obj->position, layers_var, Constant(context.stackm, layers))), false, false);
        params.push_back(layers_var);

        SSAVariable *lvalue_var = GetVariable(obj->clvalue.basevar);
        params.push_back(lvalue_var);

        Function *func = Adopt(new Function);
        if (obj->clvalue.basevar->name != ":THIS")
            func->name = funcname;
        else
            func->name = funcnamethis;

        AssignSSAVariable *ssavar = 0;
        if (obj->clvalue.layers[0].type != AST::LvalueLayer::Object)
            ssavar = GetAssignCopy(lvalue_var);
        else
            func->modifies_outsidestate = true;

        ILFunctionCall *call = CreateFunctionCall(obj->position, ssavar, func, params);
        AddInstruction(call, true, true);

        return ssavar;
}

SSAVariable * ILGenerator::V_ArrayDelete (AST::ArrayDelete *, Empty)
{
        throw std::runtime_error("this ast type (ArrayDelete) may not reach this stage (run complex node translator!)");
}

SSAVariable * ILGenerator::V_ArrayElementConst (AST::ArrayElementConst *aec, Empty)
{
        throw std::runtime_error("this ast type (ArrayElementConst) at line #" + Blex::AnyToString(aec->position.line) + " may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_ArrayElementModify (AST::ArrayElementModify *, Empty)
{
        throw std::runtime_error("this ast type (ArrayElementModify) may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_ArrayInsert (AST::ArrayInsert *, Empty)
{
        throw std::runtime_error("this ast type (ArrayInsert) may not reach this stage (run complex node translator!)");
}

SSAVariable * ILGenerator::V_Assignment (AST::Assignment *obj, Empty)
{
        AssignSSAVariable *target =  GetLValueTarget(obj->target);

        SSAVariable *source = Visit(obj->source, Empty());
        AddInstruction(Adopt(new ILAssignment(obj->position, target, source)), false, false);
        return target;
}

SSAVariable * ILGenerator::V_BinaryOperator (AST::BinaryOperator *obj, Empty)
{
        if (obj->operation == BinaryOperatorType::OpNullCoalesce)
            throw std::runtime_error("this binary operator type (OpNullCoalesce) may not reach this stage (run complex node translator!)");

        AssignSSAVariable *var = GetAssignedTemporary(typestorage[obj]);
        ILBinaryOperator *il = Adopt(new ILBinaryOperator(obj->position, var, obj->operation, Visit(obj->lhs, Empty()), Visit(obj->rhs, Empty())));
        AddInstruction(il, true, false);
        return var;
}

SSAVariable * ILGenerator::V_Block (AST::Block *obj, Empty)
{
        // Store the list of visible variables
        std::set<Variable *> var;
        flowstate.ExportVariables(&var);

        for (std::vector<AST::Statement *>::iterator it = obj->statements.begin(); it != obj->statements.end(); ++it)
        {
                // Don't visit dead code.
                if (!current)
                    break;

                Visit(*it, Empty());
        }

        // Kill ALL variables not in original flowstate
        flowstate.FilterByVariables(var);

        /* disabled because it does not work. why? don't know...
        // Kill ALL variables not in original flowstate
        IL::FlowState::VisibleAssignmentsMap::iterator it = flowstate.visibleassignments.begin();
        for (std::set<Variable *>::iterator it2 = var.begin(); it2 != var.end(); ++it, ++it2)
            while (it != flowstate.visibleassignments.end() && it->first != *it2)
                flowstate.visibleassignments.erase(it++);
        while (it != flowstate.visibleassignments.end())
            flowstate.visibleassignments.erase(it++);
        */

        FSPRINT ("after block: " << flowstate);

        return 0;
}

SSAVariable * ILGenerator::V_BreakStatement (AST::BreakStatement *obj, Empty)
{
        if (loopstack.top().finally_catchers)
        {
                AssignSSAVariable *type = GetAssignCopy(GetVariable(finally_statement->type));
                AddInstruction(Adopt(new ILConstant(obj->position, type, Constant(context.stackm, 3))), false, false);

                CatchBlock block;
                block.block = current;
                block.flowstate = flowstate;

                loopstack.top().finally_catchers->push_back(block);
        }
        else
        {
                // What to do??? register at breakstack-top all currently visible variables
                // and let them figure out to place phi-thingies
                loopstack.top().breaks.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));
                LinkBlocks(current, loopstack.top().breakpoint, false);
        }
        current = 0;
        return 0;
}

IL::SSAVariable * ILGenerator::V_BuiltinInstruction (AST::BuiltinInstruction *obj, Empty)
{
        AssignSSAVariable *temp(0);
        if (obj->result_type != VariableTypes::NoReturn)
            temp = GetAssignedTemporary(typestorage[obj]);

        std::vector<SSAVariable *> parameters;

        for (std::vector<AST::Rvalue*>::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
            parameters.push_back(Visit(*it, Empty()));

        Function *func = Adopt(new Function);
        func->name = obj->name;
        IL::ILFunctionCall *call = CreateFunctionCall(obj->position, temp, func, parameters);
        if (obj->calls_harescript)
        {
                for (std::vector<Symbol *>::iterator it = vuanalyzer->globalsymbols.begin(); it != vuanalyzer->globalsymbols.end(); ++it)
                {
                        SSAVariable *var = GetVariable(*it);
                        AssignSSAVariable *ssavar = GetAssignCopy(var);
                        call->usedefs.AddUse(var);
                        call->usedefs.AddDef(ssavar);
                }
        }
        else if (obj->modifies_outsidestate)
        {
                call->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
                call->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));
        }

        if (obj->calls_harescript)
            AddThrowingInstruction(call);
        else
            AddInstruction(call, true, true);

        return temp;
}

SSAVariable * ILGenerator::V_Cast(AST::Cast *obj, Empty)
{
        AssignSSAVariable *temp = GetAssignedTemporary(typestorage[obj]);
        AddInstruction(Adopt(new ILCast(obj->position, temp, Visit(obj->expr, Empty()), obj->to_type, obj->function, obj->is_explicit)), true, false);

        return temp;
}
SSAVariable * ILGenerator::V_ConditionalOperator (AST::ConditionalOperator *obj, Empty)
{
        SSAVariable *cond = Visit(obj->condition, Empty());
        BasicBlock *oldcurrent = current;
        AddInstruction(Adopt(new ILConditionalJump(obj->position, cond)), true, false);

        IL::FlowState flowstate_copy = flowstate;

        BasicBlock *expr_true = Adopt(new BasicBlock(obj->expr_true->position));
        expr_true->frequency = oldcurrent->frequency / 2;
        builtblocks.push_back(expr_true);
        current = expr_true;
        AssignSSAVariable *temp_true = GetAssignedTemporary(typestorage[obj]);
        AddInstruction(Adopt(new ILAssignment(obj->position, temp_true, Visit(obj->expr_true, Empty()))), false, false);
        BasicBlock *expr_true_return = current;
        IL::FlowState flowstate_after_true = flowstate;

        flowstate = flowstate_copy;
        BasicBlock *expr_false = Adopt(new BasicBlock(obj->expr_false->position));
        expr_false->frequency = oldcurrent->frequency / 2;
        builtblocks.push_back(expr_false);
        current = expr_false;
        AssignSSAVariable *temp_false = GetAssignCopy(temp_true);
        AddInstruction(Adopt(new ILAssignment(obj->position, temp_false, Visit(obj->expr_false, Empty()))), false, false);
        BasicBlock *expr_false_return = current;
        IL::FlowState flowstate_after_false = flowstate;

        LinkBlocks(oldcurrent, expr_true, false);
        LinkBlocks(oldcurrent, expr_false, false);

        BasicBlock *newcurrent = Adopt(new BasicBlock(obj->position));
        newcurrent->frequency = oldcurrent->frequency;

        builtblocks.push_back(newcurrent);
        current = newcurrent;

        // We cannot transfer control from within an expression
        LinkBlocks(expr_true_return, newcurrent, false);
        LinkBlocks(expr_false_return, newcurrent, false);

        std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> > flows;
        flows.push_back(std::make_pair(expr_true_return, &flowstate_after_true));
        flows.push_back(std::make_pair(expr_false_return, &flowstate_after_false));

        MergeFlowStates(newcurrent, flowstate, flows);

        // No control thingies otherwise, so no further problems
        return flowstate.visibleassignments[temp_true->variable];
}

template <class A, class B>
 bool PairFirstEqual(std::pair<A, B> p1, std::pair<A, B> p2)
{
        return p1.first == p2.first;
}

SSAVariable * ILGenerator::V_ConditionalStatement (AST::ConditionalStatement *obj, Empty)
{
        BasicBlock *stat_true = Adopt(new BasicBlock(obj->stat_true->position));
        stat_true->frequency = current->frequency / 2;
        builtblocks.push_back(stat_true);
        BasicBlock *stat_false = Adopt(new BasicBlock(obj->stat_false ? obj->stat_false->position : LineColumn()));
        stat_false->frequency = current->frequency / 2;
        builtblocks.push_back(stat_false);
        BasicBlock *newcurrent = Adopt(new BasicBlock(obj->position));
        newcurrent->frequency = 0;
        builtblocks.push_back(newcurrent);

        AddInstruction(Adopt(new ILConditionalJump(obj->position, Visit(obj->condition, Empty()))), false, false);
        BasicBlock *oldcurrent = current;

        LinkBlocks(oldcurrent, stat_true, false);
        LinkBlocks(oldcurrent, stat_false, false);

        IL::FlowState flowstate_original = flowstate;
        IL::FlowState flowstate_after_true;
        IL::FlowState flowstate_after_false;

        FSPRINT("Original flowstate: " << flowstate);

        current = stat_true;
        Visit(obj->stat_true, Empty());
        BasicBlock *stat_true_return = 0;
        if (current && current->successors.empty())
        {
                newcurrent->frequency += current->frequency;
                LinkBlocks(current, newcurrent, false);
                stat_true_return = current;
                flowstate_after_true = flowstate;

                FSPRINT("Flowstate after true: " << flowstate_after_true);
        }

        flowstate = flowstate_original;
        current = stat_false;

        if (obj->stat_false)
            Visit(obj->stat_false, Empty());

        BasicBlock *stat_false_return = 0;
        if (current && current->successors.empty())
        {
                newcurrent->frequency += current->frequency;
                LinkBlocks(current, newcurrent, false);
                stat_false_return = current;
                flowstate_after_false = flowstate;

                FSPRINT("Flowstate after false: " << flowstate_after_false);
        }

        current = newcurrent;

        // Current flowstate: flowstate after false.

        if (stat_true_return)
        {
            if (stat_false_return)
            {
                    std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> > states;
                    states.push_back(std::make_pair(stat_true_return, &flowstate_after_true));
                    states.push_back(std::make_pair(stat_false_return, &flowstate_after_false));

                    MergeFlowStates(newcurrent, flowstate, states);

                    FSPRINT("Merged flowstate: " << flowstate);
            }
            else
                flowstate = flowstate_after_true;
        }
        else
            if (!stat_false_return)
                current = 0; // Execution does not flow beyond this instruction!

        // We need phi-functions for every variable visible at end oldcurrent, and
        // assigned to in either stat_true or stat_false.
        return 0;
}
SSAVariable * ILGenerator::V_Constant (AST::Constant *obj, Empty)
{
        AssignSSAVariable *temp = GetAssignedTemporary(typestorage[obj]);
        AddInstruction(Adopt(new ILConstant(obj->position, temp, obj->type, obj->var)), false, false);
        return temp;
}

IL::SSAVariable * ILGenerator::V_ConstantRecord (AST::ConstantRecord *, Empty)
{
        throw std::runtime_error("this ast type (ConstantRecord) may not reach this stage (run constants optimizer!)");
}

IL::SSAVariable * ILGenerator::V_ConstantArray (AST::ConstantArray *, Empty)
{
        throw std::runtime_error("this ast type (ConstantArray) may not reach this stage (run constants optimizer!)");
}
SSAVariable * ILGenerator::V_ContinueStatement (AST::ContinueStatement *obj, Empty)
{
        if (loopstack.top().finally_catchers)
        {
                AssignSSAVariable *type = GetAssignCopy(GetVariable(finally_statement->type));
                AddInstruction(Adopt(new ILConstant(obj->position, type, Constant(context.stackm, 4))), false, false);

                CatchBlock block;
                block.block = current;
                block.flowstate = flowstate;

                loopstack.top().finally_catchers->push_back(block);
        }
        else
        {
                // What to do??? register at continuestack-top all currently visible variables
                // and let them figure out to place phi-thingies
                loopstack.top().continues.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));
                LinkBlocks(current, loopstack.top().continuepoint, false);
        }
        current = 0;
        return 0;
}
SSAVariable * ILGenerator::V_DeepOperation (AST::DeepOperation *, Empty)
{
        throw std::runtime_error("not a accepted node");
}
SSAVariable * ILGenerator::V_DeepArrayDelete (AST::DeepArrayDelete *obj, Empty)
{
        std::vector<SSAVariable *> params;
        std::string funcname, funcnamethis;

        switch (obj->location.type)
        {
        case AST::ArrayLocation::Index:
            {
                    params.push_back(Visit(obj->location.expr, Empty()));
                    funcname = ":DEEPARRAYDELETE";
                    funcnamethis = ":DEEPARRAYDELETETHIS";
            } break;
        default:
            throw std::runtime_error("Only ArrayLocation::End & -Index allowed in DeepArrayInsert");
        }

        return EncodeDeepOperation(obj, params, funcname, funcnamethis);
}
SSAVariable * ILGenerator::V_DeepArrayInsert (AST::DeepArrayInsert *obj, Empty)
{
        std::vector<SSAVariable *> params;
        std::string funcname, funcnamethis;

        params.push_back(Visit(obj->value, Empty()));

        switch (obj->location.type)
        {
        case AST::ArrayLocation::End: //FIXME does END still exist then?
            {
                    funcname = ":DEEPARRAYAPPEND";
                    funcnamethis = ":DEEPARRAYAPPENDTHIS";
            } break;
        case AST::ArrayLocation::Index:
            {
                    params.push_back(Visit(obj->location.expr, Empty()));
                    funcname = ":DEEPARRAYINSERT";
                    funcnamethis = ":DEEPARRAYINSERTTHIS";
            } break;
        default:
            throw std::runtime_error("Only ArrayLocation::End & -Index allowed in DeepArrayInsert");
        }

        return EncodeDeepOperation(obj, params, funcname, funcnamethis);
}
SSAVariable * ILGenerator::V_End (AST::End*, Empty)
{
        throw std::runtime_error("this ast type (End) may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_ExpressionBlock (AST::ExpressionBlock *obj, Empty)
{
        Visit(obj->block, Empty());
        return Visit(obj->returnvar, Empty());
}
SSAVariable * ILGenerator::V_ForEveryStatement(AST::ForEveryStatement *, Empty)
{
        throw std::runtime_error("this ast type (ForEveryStatement) may not reach this stage (run sql translator!)");
}
SSAVariable * ILGenerator::V_Function (AST::Function *obj, Empty)
{
        CodedFunction *func = Adopt(new CodedFunction);
        currentfunc = func;
        retpos = obj->blockcloseposition;
        flowstate.visibleassignments.clear();

        FSPRINT("Doing "<< obj->symbol);

        Variable *var = Adopt(new Variable(VariableTypes::Uninitialized));
        var->storagetype = Variable::None;
        var->name = ":extstate";
        var->symbol = 0;
        extstate = Adopt(new AssignSSAVariable(var, GetAssignId(var)));

        // Initialize variablemappings

        IL::FlowState flowstate_copy;

        flowstate_copy.visibleassignments[extstate->variable] = extstate;

        for (std::vector<Symbol *>::const_iterator it = vuanalyzer->data[obj->symbol].usedsymbols.begin();
                it != vuanalyzer->data[obj->symbol].usedsymbols.end(); ++it)
        {
                AssignSSAVariable *ssavar = GetAssignCopy(GetVariable(*it));
                func->globalvars.push_back(ssavar);
                flowstate_copy.visibleassignments[ssavar->variable] = ssavar;
        }

        for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it = obj->symbol->functiondef->arguments.begin();
                it != obj->symbol->functiondef->arguments.end(); ++it)
        {
                AssignSSAVariable *ssavar = GetAssignCopy(GetVariable(it->symbol));
                func->parameters.push_back(ssavar);
                flowstate_copy.visibleassignments[ssavar->variable] = ssavar;
        }

        flowstate = flowstate_copy;

        BasicBlock *block = Adopt(new BasicBlock(obj->position));
        builtblocks.push_back(block);
        func->symbol = obj->symbol;
        func->block = block;
        current = block;

        mdl->functions.push_back(func);
        if (obj->symbol->functiondef->flags & FunctionFlags::DeinitMacro)
        {
                if (mdl->deinitmacro)
                    context.errorhandler.AddErrorAt(obj->position, Error::MultipleDeinitMacros);
                mdl->deinitmacro = obj->symbol;
        }

        if (is_initfunction)
        {
                // Init all non-imported global variables

                for (std::set< Variable * >::iterator it = mdl->globalvars.begin(); it != mdl->globalvars.end(); ++it)
                {
                        if ((*it)->symbol && ((*it)->symbol->flags & SymbolFlags::Imported))
                            continue;

                        Variable *nvar = *it;
                        IL::SSAVariable *var = GetVariable((*it)->symbol);

                        AssignSSAVariable *ssavar = GetAssignCopy(var);
                        func->globalvars.push_back(ssavar);

                        if (nvar->symbol->variabledef)
                            AddInstruction(Adopt(new ILConstant(LineColumn(), ssavar, (*it)->symbol->variabledef->type, 0)), false, false);

                }
        }

        Visit(obj->block, Empty());

        if (current)
        {
                // There is a normal exit. Emit a warning and a terminatescript when values must be returned
                if (obj->symbol->functiondef->returntype != VariableTypes::NoReturn)
                {
                        context.errorhandler.AddErrorAt(obj->blockcloseposition, Error::FunctionMustReturnValue);

                        /* The last element of the function block could not have been a return, so the semantic checker
                           has already added a :THROWERROR to the end of the block
                           ADDME: we can stop doing that now this is fatal */
                }
                // This return creates no problems when a returnvalue must be emitted; the fatal error has been emitted and execution stopped
                AddInstruction(CreateReturn(retpos, NULL), false, false);
                current = 0;
        }

        SSAFixupper fixupper(context, mdl);
        fixupper.Execute(func, flowstate_copy);

        return 0;
}
SSAVariable * ILGenerator::V_FunctionCall(AST::FunctionCall *obj, Empty)
{
        FSPRINT("Functioncall to " << obj->symbol->name);
        FSPRINT(" Flowstate " << flowstate);

        if (is_initfunction)
        {
                // Check all used globals (if they are initialized yet)
                std::vector<Symbol *> const &usedsymbols = vuanalyzer->data[obj->symbol].usedsymbols;
                for (std::vector<Symbol *>::const_iterator it = usedsymbols.begin(); it != usedsymbols.end(); ++it)
                {
                        IL::SSAVariable *var = GetVariable(*it);
                        IL::AssignSSAVariable *curr_var = flowstate.visibleassignments[var->variable];

                        if ((*it)->variabledef && !((*it)->flags & SymbolFlags::Imported) && std::find(currentfunc->globalvars.begin(), currentfunc->globalvars.end(), curr_var) != currentfunc->globalvars.end())
                        {
                                // This used global doesn't exist here yet; initialize it
                                AddInstruction(Adopt(new ILConstant(obj->position, GetAssignCopy(var), (*it)->variabledef->type, 0)), false, false);
                        }
                }
        }

        if ((obj->symbol->functiondef->flags & FunctionFlags::Aggregate) && !obj->as_aggregate && !obj->inhibit_aggregate)
            throw std::runtime_error("Aggregate function not used as aggregate found in IL stage (translation/check error)");

        AssignSSAVariable *temp = 0;
        if (obj->symbol->functiondef->returntype != VariableTypes::NoReturn)
            temp = GetAssignedTemporary(typestorage[obj]);
        std::vector<SSAVariable *> parameters;

        for (std::vector<AST::Rvalue*>::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
            parameters.push_back(Visit(*it, Empty()));

        Function *func = Adopt(new Function);
        func->name = obj->symbol->name;
        func->symbol = obj->symbol;
        IL::ILFunctionCall *call = CreateFunctionCall(obj->position, temp, func, parameters);

        // Can this function cause observable or undefined behaviour?
        bool undef_or_observable = !(obj->symbol->functiondef->flags & FunctionFlags::NoStateModify);

        if (obj->symbol->functiondef->flags & FunctionFlags::ExecutesHarescript)
            AddThrowingInstruction(call);
        else
            AddInstruction(call, undef_or_observable, undef_or_observable);

        if (obj->symbol->functiondef->flags & FunctionFlags::Terminates)
        {
                // If the function does return (mislabelling, programming error), we have a problem.
                // To solve that, we abort the script. (we trust ABORT, __HS_THROWEXCEPTION and :THROWERROR)
                if (obj->symbol->name != "ABORT" && obj->symbol->name != ":THROWERROR" && obj->symbol->name != "__HS_THROWEXCEPTION")
                {
                        Symbol *symbol = context.symboltable->ResolveSymbol(obj->position, ":THROWERROR", NULL, false);
                        if (!symbol)
                            throw std::runtime_error("Could not find symbol :THROWERROR, which should be defined at this stage");

                        func = Adopt(new Function);
                        func->name = symbol->name;
                        func->symbol = symbol;

                        parameters.clear();
                        IL::AssignSSAVariable *errorid = GetAssignedTemporary(VariableTypes::Integer);
                        AddInstruction(Adopt(new ILConstant(obj->position, errorid, Constant(context.stackm, Error::MacroDidntTerminateScript))), false, false);
                        parameters.push_back(errorid);

                        IL::AssignSSAVariable *str1 = GetAssignedTemporary(VariableTypes::String);
                        AddInstruction(Adopt(new ILConstant(obj->position, str1, Constant(context.stackm, ""))), false, false);
                        parameters.push_back(str1);

                        IL::AssignSSAVariable *str2 = GetAssignedTemporary(VariableTypes::String);
                        AddInstruction(Adopt(new ILConstant(obj->position, str2, Constant(context.stackm, ""))), false, false);
                        parameters.push_back(str2);

                        call = CreateFunctionCall(obj->position, 0, func, parameters);

//                        SSAVariable *outsidestate = GetVariable(mdl->outsidestate->symbol);
//                        call->AddUse(outsidestate);
//                        call->AddDef(GetAssignCopy(outsidestate));

                        AddInstruction(call, true, true);
                }
                // Add return to create dependencies on :extstate; without it the call gets deleted.
                IL::ILReturn *ret = CreateReturn(retpos, 0);
                ret->usedefs.AddUse(extstate);
                AddInstruction(ret, false, false);
                current = 0;
                return 0;
        }

        return temp;
}
SSAVariable * ILGenerator::V_FunctionPtr(AST::FunctionPtr *, Empty)
{
        throw std::runtime_error("this ast type (FunctionPtr) may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_FunctionPtrCall(AST::FunctionPtrCall *, Empty)
{
        throw std::runtime_error("this ast type (FunctionPtrCall) may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_FunctionPtrRebind(AST::FunctionPtrRebind *, Empty)
{
        throw std::runtime_error("this ast type (FunctionPtrRebind) may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_InitializeStatement (AST::InitializeStatement *obj, Empty)
{
        SSAVariable *var = GetVariable(obj->symbol);
        AddInstruction(Adopt(new ILConstant(obj->position, GetAssignCopy(var), obj->symbol->variabledef->type, 0)), false, false);
        return var;
}

SSAVariable * ILGenerator::V_LoopStatement (AST::LoopStatement *obj, Empty)
{
        IL::FlowState flowstate_in = flowstate;
//        BasicBlock *inblock = current;

        BasicBlock *conditionblockentry = Adopt(new BasicBlock(obj->precondition ? obj->precondition->position : LineColumn()));
        BasicBlock *conditionblockloop = Adopt(new BasicBlock(obj->precondition ? obj->precondition->position : LineColumn()));
        BasicBlock *exitblock = Adopt(new BasicBlock(obj->position));
        BasicBlock *header = Adopt(new BasicBlock(obj->precondition ? obj->precondition->position : LineColumn()));
        BasicBlock *incrementblock = Adopt(new BasicBlock(obj->loopincrementer ? obj->loopincrementer->position : LineColumn()));
        BasicBlock *loopblock = Adopt(new BasicBlock(obj->precondition ? obj->precondition->position : LineColumn()));

        conditionblockentry->frequency = current->frequency;
        conditionblockloop->frequency = current->frequency * 10;
        exitblock->frequency = current->frequency;
        header->frequency = current->frequency;
        incrementblock->frequency = current->frequency * 10;
        loopblock->frequency = current->frequency * 10;

        builtblocks.push_back(conditionblockentry);
        builtblocks.push_back(header);

        LinkBlocks(current, conditionblockentry, false);

        loopstack.push(LoopStackElement());
        loopstack.top().breakpoint = exitblock;
        loopstack.top().continuepoint = incrementblock;
        loopstack.top().finally_catchers = 0;

        /* First, we evaluate the condition for the first time. If true, we
           enter the loop at least one time (and the header is executed)

           After the header, the loopblock is executed for the first time */
        current = conditionblockentry;
        if (obj->precondition)
        {
                AddInstruction(Adopt(new ILConditionalJump(obj->position, Visit(obj->precondition, Empty()))), false, false);
                LinkBlocks(current, header, false); // if TRUE
                LinkBlocks(current, exitblock, false); // if FALSE
                loopstack.top().breaks.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));
        }
        else
            LinkBlocks(current, header, false); // always TRUE
        BasicBlock *conditionblockentry_exit = current;

        LinkBlocks(header, loopblock, false);
        current = header;
        std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> > loop_inflows;
        loop_inflows.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));

        // Make sure that all new blocks will be visited by the afterward phi-function correcter
        std::vector<IL::BasicBlock *> builtblockscopy;
        builtblocks.swap(builtblockscopy);

        builtblocks.push_back(conditionblockloop);
        builtblocks.push_back(exitblock);
        builtblocks.push_back(incrementblock);
        builtblocks.push_back(loopblock);

        /* Build the loop block */
        current = loopblock;
        Visit(obj->loop, Empty());

        if (current != 0)
        {
                loopstack.top().continues.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));
                LinkBlocks(current, incrementblock, false);
        }

        /* Build the increment block */
        if (!loopstack.top().continues.empty())
        {
                MergeFlowStates(incrementblock, flowstate, loopstack.top().continues);

                current = incrementblock;
                if (obj->loopincrementer) Visit(obj->loopincrementer, Empty());

                /* If the incrementblock returns, link it to the loop condition block */
                if (current)
                {
                        LinkBlocks(current, conditionblockloop, false);

                        current = conditionblockloop;
                        if (obj->precondition)
                        {
                                AddInstruction(Adopt(new ILConditionalJump(obj->position, Visit(obj->precondition, Empty()))), false, false);
                                LinkBlocks(current, loopblock, false); // if TRUE
                                LinkBlocks(current, exitblock, false); // if FALSE
                                loopstack.top().breaks.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));
                        }
                        else
                            LinkBlocks(current, loopblock, false); // always TRUE

                        loop_inflows.push_back(std::make_pair(current, Adopt(new IL::FlowState(flowstate))));
                }
        }

        /* Merge the 2 flowstates going into the loop block.
           This can create phi-functions for some variables that that have old versions from breaks, and a
           up to date version from the first evaluation of the condition */
        MergeFlowStates(loopblock, flowstate, loop_inflows);

        // Calculate all the variables that need to be replaced
        std::map<AssignSSAVariable *, AssignSSAVariable *> replacelist;
        IL::FlowState &loop_original = *loop_inflows[0].second;
        for (std::vector<PhiFunction *>::iterator it = loopblock->phifunctions.begin();
                it != loopblock->phifunctions.end(); ++it)
            replacelist[loop_original.visibleassignments[(*it)->variable->variable]] = (*it)->variable;

        // Replace the newly phi'd variables in the flowstates
        for (std::vector< std::pair<IL::BasicBlock *, IL::FlowState *> >::iterator it = loopstack.top().breaks.begin(); it != loopstack.top().breaks.end(); ++it)
            if (it->first != conditionblockentry_exit)
                for (IL::FlowState::VisibleAssignmentsMap::iterator it2 = it->second->visibleassignments.begin(); it2 != it->second->visibleassignments.end(); ++it2)
                    if (replacelist.find(it2->second) != replacelist.end())
                        it2->second = replacelist[it2->second];

        // Replace the phi-parameters in all new built blocks
        for (std::vector<BasicBlock *>::iterator it = builtblocks.begin(); it != builtblocks.end(); ++it)
            for (std::vector<PhiFunction *>::iterator it2 = (*it)->phifunctions.begin(); it2 != (*it)->phifunctions.end(); ++it2)
                for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::iterator it3 = (*it2)->params.begin(); it3 != (*it2)->params.end(); ++it3)
                    if ((it3->second != header && it3->second != conditionblockentry_exit) && (replacelist.find(it3->first) != replacelist.end()))
                        it3->first = replacelist[it3->first];

        // If we' don't have explicit breaks (endless loop; user should really call Abort() somewhere) we return now
        if (!loopstack.top().breaks.empty())
        {
                MergeFlowStates(exitblock, flowstate, loopstack.top().breaks);
                current = exitblock;
        }
        else
            current = 0;

        loopstack.pop();
        builtblocks.insert(builtblocks.end(), builtblockscopy.begin(), builtblockscopy.end());

        return 0;
}
SSAVariable * ILGenerator::V_Lvalue (AST::Lvalue *, Empty)
{
        throw std::runtime_error("not an accepted node");
}
SSAVariable * ILGenerator::V_LvalueSet (AST::LvalueSet *obj, Empty)
{
        std::vector<SSAVariable *> params;
        params.push_back(Visit(obj->value, Empty()));

        return EncodeDeepOperation(obj, params, ":DEEPSET", ":DEEPSETTHIS");
}
SSAVariable * ILGenerator::V_Module (AST::Module *obj, Empty)
{
        mdl->outsidestate = GetVariable(obj->outsidestate)->variable;

        // Add all global variables
        for (std::vector<Symbol *>::iterator it = vuanalyzer->globalsymbols.begin(); it != vuanalyzer->globalsymbols.end(); ++it)
            mdl->globalvars.insert(GetVariable(*it)->variable);

        for (std::vector<AST::Function *>::iterator it = obj->functions.begin(); it != obj->functions.end(); ++it)
        {
                is_initfunction = (*it)->symbol->name == ":INITFUNCTION";
                Visit(*it, Empty());
        }

        return 0;
}
SSAVariable * ILGenerator::V_Node (AST::Node *, Empty)
{
        throw std::runtime_error("not a accepted node");
}

IL::SSAVariable * ILGenerator::V_ObjectExtend(AST::ObjectExtend *, Empty)
{
        throw std::runtime_error("this ast type (ObjectExtend) may not reach this stage (run complex node translator!)");
}

SSAVariable * ILGenerator::V_ObjectMemberConst(AST::ObjectMemberConst *obj, Empty)
{
        AssignSSAVariable *temp = GetAssignedTemporary(typestorage[obj]);
        ILObjectMemberGet *omg = Adopt(new ILObjectMemberGet(
            obj->position,
            temp,
            Visit(obj->object, Empty()),
            obj->name,
            obj->via_this));

        omg->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
        omg->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));
        AddThrowingInstruction(omg);

        return temp;
}

SSAVariable * ILGenerator::V_ObjectMemberSet(AST::ObjectMemberSet *obj, Empty)
{
        ILObjectMemberSet *oms = Adopt(new ILObjectMemberSet(
            obj->position,
            Visit(obj->object, Empty()),
            Visit(obj->value, Empty()),
            obj->name,
            obj->via_this));

        oms->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
        oms->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));

        AddThrowingInstruction(oms);
        return 0;
}

SSAVariable * ILGenerator::V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty)
{
        ILObjectMemberDelete *instr = Adopt(new ILObjectMemberDelete(
            obj->position,
            Visit(obj->object, Empty()),
            obj->name,
            obj->via_this));

        instr->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
        instr->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));

        AddThrowingInstruction(instr);
        return 0;
}

SSAVariable * ILGenerator::V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty)
{
        ILObjectMemberInsert *instr = Adopt(new ILObjectMemberInsert(
            obj->position,
            Visit(obj->object, Empty()),
            Visit(obj->value, Empty()),
            obj->name,
            obj->is_private,
            obj->via_this));

        instr->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
        instr->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));

        AddThrowingInstruction(instr);
        return 0;
}
SSAVariable * ILGenerator::V_RecordCellSet(AST::RecordCellSet *obj, Empty)
{
        AssignSSAVariable *target = GetLValueTarget(obj->record);
        AddInstruction(Adopt(new ILRecordCellSet(
            obj->position,
            target,
            Visit(obj->record, Empty()),
            obj->name,
            Visit(obj->value, Empty()),
            obj->cancreate,
            obj->check_type)), true, false);
        return target;
}
SSAVariable * ILGenerator::V_RecordCellDelete(AST::RecordCellDelete *obj, Empty)
{
        AssignSSAVariable *target = GetLValueTarget(obj->record);
        AddInstruction(Adopt(new ILRecordCellDelete(
            obj->position,
            target,
            Visit(obj->record, Empty()),
            obj->name)), true, false);
        return target;
}
SSAVariable * ILGenerator::V_RecordColumnConst (AST::RecordColumnConst *obj, Empty)
{
        AssignSSAVariable *temp = GetAssignedTemporary(typestorage[obj]);
        AddInstruction(Adopt(new ILColumnOperator(obj->position, temp, Visit(obj->record, Empty()), obj->name)), true, false);
        return temp;
}
SSAVariable * ILGenerator::V_ObjectTypeUID(AST::ObjectTypeUID *, Empty)
{
        throw std::runtime_error("this ast type (ObjectTypeUID) may not reach this stage (run complex node translator!)");
}
IL::SSAVariable * ILGenerator::V_ObjectMethodCall (AST::ObjectMethodCall*obj, Empty)
{
        AssignSSAVariable *temp = GetAssignedTemporary(typestorage[obj]);

        SSAVariable *object = Visit(obj->object, Empty());

        std::vector< SSAVariable * > parameters;
        for (std::vector<AST::Rvalue*>::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
            parameters.push_back(Visit(*it, Empty()));

//        Function *func = Adopt(new Function);
//        func->name = obj->name;
//        IL::ILFunctionCall *call = CreateFunctionCall(obj->position, temp, func, parameters);

        ILMethodCall *call = Adopt(new ILMethodCall(obj->position, temp, object, obj->membername, obj->via_this, parameters, obj->allow_macro));
        call->usedefs.AddUse(object);
        call->usedefs.AddUse(GetVariable(mdl->outsidestate->symbol));
//        call->usedefs.AddDef(GetAssignCopy(GetVariable(mdl->outsidestate->symbol)));

        for (std::vector<Symbol *>::iterator it = vuanalyzer->globalsymbols.begin(); it != vuanalyzer->globalsymbols.end(); ++it)
        {
                SSAVariable *var = GetVariable(*it);
                AssignSSAVariable *ssavar = GetAssignCopy(var);
                call->usedefs.AddUse(var);
                flowstate.visibleassignments[var->variable] = ssavar;
                call->usedefs.AddDef(ssavar);
        }

        AddThrowingInstruction(call);
        return temp;
}
SSAVariable * ILGenerator::V_ReturnStatement (AST::ReturnStatement *obj, Empty)
{
        SSAVariable *parameter=NULL;
        if (obj->returnvalue)
            parameter=Visit(obj->returnvalue, Empty());

        if (finally_catchers)
        {
                AssignSSAVariable *type = GetAssignCopy(GetVariable(finally_statement->type));
                AddInstruction(Adopt(new ILConstant(obj->position, type, Constant(context.stackm, 2))), false, false);
                if (parameter)
                {
                        AssignSSAVariable *target = GetAssignCopy(GetVariable(finally_statement->value));
                        AddInstruction(Adopt(new ILAssignment(obj->position, target, parameter)), false, false);
                }

                CatchBlock block;
                block.block = current;
                block.flowstate = flowstate;

                finally_catchers->push_back(block);
        }
        else
        {
                AddInstruction(CreateReturn(retpos, parameter), false, false);
        }
        current = 0;
        return 0;
}
SSAVariable * ILGenerator::V_Rvalue (AST::Rvalue *, Empty)
{
        throw std::runtime_error("not a accepted node");
}
SSAVariable * ILGenerator::V_SchemaTable (AST::SchemaTable *obj, Empty)
{
        AssignSSAVariable *temp = GetAssignedTemporary(typestorage[obj]);
        AddInstruction(Adopt(new ILColumnOperator(obj->position, temp, Visit(obj->schema, Empty()), obj->name)), true, false);
        return temp;
}
SSAVariable * ILGenerator::V_SingleExpression (AST::SingleExpression *obj, Empty)
{
        Visit(obj->expr, Empty());
        return 0;
}
SSAVariable * ILGenerator::V_Statement (AST::Statement *, Empty)
{
        throw std::runtime_error("not a accepted node");
}

SSAVariable * ILGenerator::V_SwitchStatement (AST::SwitchStatement *, Empty)
{
        throw std::runtime_error("this ast type (SwitchStatement) may not reach this stage (run complex node translator!)");
}
SSAVariable * ILGenerator::V_TryCatchStatement(AST::TryCatchStatement *obj, Empty)
{
        // Swap away current catchers, any catchers now built are ours
        std::vector< CatchBlock > *last_exception_catchers = exception_catchers;
        std::vector< CatchBlock > catchblocks;
        exception_catchers = &catchblocks;

        std::vector< std::pair< IL::BasicBlock *, IL::FlowState *> > mergeparams;

        std::set<Variable *> visible_vars;
        flowstate.ExportVariables(&visible_vars);

        Visit(obj->tryblock, Empty());
        BasicBlock *aftertryblock = current;
        flowstate.FilterByVariables(visible_vars);

        FlowState aftertry = flowstate;
        FSPRINT("State after try: " << current << ", fs: " << flowstate);

        // Record if we the end of the try block can be reached. Needed for try..finally
        if (!current)
            obj->can_reach_try_end = false;

        //Put back our parent try's catchers
        exception_catchers = last_exception_catchers;

        if (!catchblocks.empty())
        {
                current = Adopt(new BasicBlock(obj->catchblock->position));
                FSPRINT("New catchblock: " << current);

                std::vector< std::pair< IL::BasicBlock *, IL::FlowState *> > mergecatchblocks;
                for (std::vector< CatchBlock >::iterator it = catchblocks.begin(), end = catchblocks.end(); it != end;++it)
                {
                        it->flowstate.FilterByVariables(visible_vars);

                        mergecatchblocks.push_back(std::make_pair(it->block, &it->flowstate));
                        LinkBlocks(it->block, current, false);
                }
                MergeFlowStates(current, flowstate, mergecatchblocks);

                FSPRINT("State after trycatches: " << current << ", fs: " << flowstate);

                Visit(obj->catchblock, Empty());
                FlowState aftercatch = flowstate;
                BasicBlock *aftercatchblock = current;

                current = Adopt(new BasicBlock(obj->catchblock->position));
                FSPRINT("New block after catch: " << current);

                if (aftertryblock)
                {
                        LinkBlocks(aftertryblock, current, false);
                        mergeparams.push_back(std::make_pair(aftertryblock, &aftertry));
                }
                if (aftercatchblock)
                {
                        LinkBlocks(aftercatchblock, current, false);
                        mergeparams.push_back(std::make_pair(aftercatchblock, &aftercatch));
                }
                if (!mergeparams.empty())
                    MergeFlowStates(current, flowstate, mergeparams);
                else
                    current = 0;
        }

//        current_catch = old_catch;
//        throw std::runtime_error("this ast type (TryCatchStatement) may not reach this stage (not implemented!)");

        return 0;
}

SSAVariable * ILGenerator::V_TryFinallyStatement(AST::TryFinallyStatement *obj, Empty)
{
        //*
        std::vector< CatchBlock > *last_finally_catchers = finally_catchers;
        std::vector< CatchBlock > finallyblocks;
        finally_catchers = &finallyblocks;

        std::vector< CatchBlock > *last_loop_finally_catchers(&finallyblocks);
        if (!loopstack.empty())
            std::swap(last_loop_finally_catchers, loopstack.top().finally_catchers);

        AST::TryFinallyStatement *last_finally_statement = finally_statement;
        finally_statement = obj;

        std::set<Variable *> visible_vars;
        flowstate.ExportVariables(&visible_vars);

        Visit(obj->tryblock, Empty());

        BasicBlock *aftertryblock = current;
        FlowState aftertry = flowstate;

        if (!loopstack.empty())
            std::swap(last_loop_finally_catchers, loopstack.top().finally_catchers);

        finally_catchers = last_finally_catchers;
        finally_statement = last_finally_statement;

        current = Adopt(new BasicBlock(obj->finallyblock->position));
        FSPRINT("New finallyblock: " << current);

        std::vector< std::pair< IL::BasicBlock *, IL::FlowState *> > mergeparams;

        if (aftertryblock)
        {
                aftertry.FilterByVariables(visible_vars);

                mergeparams.push_back(std::make_pair(aftertryblock, &aftertry));
                LinkBlocks(aftertryblock, current, false);
        }

        for (std::vector< CatchBlock >::iterator it = finallyblocks.begin(), end = finallyblocks.end(); it != end;++it)
        {
                it->flowstate.FilterByVariables(visible_vars);

                mergeparams.push_back(std::make_pair(it->block, &it->flowstate));
                LinkBlocks(it->block, current, false);
        }

        if (mergeparams.empty())
        {
                // Flow won't reach finally
                current = 0;
                return 0;
        }

        assert(!mergeparams.empty());
        MergeFlowStates(current, flowstate, mergeparams);

        Visit(obj->finallyblock, Empty());

        if (!aftertryblock || !obj->tryblock->can_reach_try_end)
            current = 0;

        return 0;

        /*/

        (void)obj;throw std::runtime_error("this ast type (TryFinallyStatement) may not reach this stage (not implemented!)");
        //*/
}

SSAVariable * ILGenerator::V_TypeInfo (AST::TypeInfo *obj, Empty)
{
        AssignSSAVariable *var = GetAssignedTemporary(typestorage[obj]);

/*        TypeInfo *typeinfo = Adopt(new TypeInfo);
        if (obj->symbol->variabledef)
        {
                typeinfo->type = obj->symbol->variabledef->type;
                for (SymbolDefs::TableDef::ColumnsDef::const_iterator it = obj->symbol->variabledef->tabledef.columnsdef.begin(); it != obj->symbol->variabledef->tabledef.columnsdef.end(); ++it)
                    typeinfo->columnsdef.push_back(*it);
        }*/

        ILConstant *il = Adopt(new ILConstant(obj->position, var, Constant(obj->typeinfo)));
        AddInstruction(il, false, false);
        return var;
}
SSAVariable * ILGenerator::V_UnaryOperator (AST::UnaryOperator *obj, Empty)
{
        AssignSSAVariable *var = GetAssignedTemporary(typestorage[obj]);
        ILInstruction *il = Adopt(new ILUnaryOperator(obj->position, var, obj->operation, Visit(obj->lhs, Empty())));
        AddInstruction(il, true, false);
        return var;
}
SSAVariable * ILGenerator::V_Variable (AST::Variable *obj, Empty)
{
        return GetVariable(obj->symbol);
}

SSAVariable * ILGenerator::V_Yield (AST::Yield *, Empty)
{
        throw std::runtime_error("this ast type (Yield) may not reach this stage (run complex node translator!)");
}

SSAVariable * ILGenerator::V_SQL (AST::SQL *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLDataModifier (AST::SQLDataModifier *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLDelete (AST::SQLDelete *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLInsert (AST::SQLInsert *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLSource (AST::SQLSource *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLSources (AST::SQLSources *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLSelect (AST::SQLSelect *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}
SSAVariable * ILGenerator::V_SQLUpdate (AST::SQLUpdate *, Empty)
{
        throw std::runtime_error("this ast type may not reach this stage");
}


// -- SSA fixupper
void VariableReplacer::operator()(IL::FlowState *state, SSAVariable *&ssavar)
{
        SSAVariable *newvar = state->visibleassignments[ssavar->variable];
//        DEBUGPRINT(*state);
        if (!ssavar || !newvar)
        {
                SSAVariable *var = ssavar;
                if (!var)
                    var = newvar;
                DEBUGPRINT("IL strictness violation, variable " << var->variable->symbol->name << " without dominating definition");
                throw std::logic_error("IL strictness violation, variable " + var->variable->symbol->name + " without dominating definition");
        }

// * //     Disabled because the new loop code can't correctly assign correct versions to its variables

        if (ssavar->id != 0 && ssavar->id != newvar->id)
        {
                // The ssavar was already filled with an id, but it is not equal to
                // the one it is replaced with. In il generation, this should be impossible * /
                DEBUGPRINT("SSA fixup error, replacing " << ssavar << " with " << newvar);
                throw std::logic_error("SSA fixup error; intermediate language generation invariants violated");
        } //*/

        ssavar = state->visibleassignments[ssavar->variable];
//        fixupper.usedvars.insert(ssavar->variable);
}

/* Set the in-flowstates of all blocks. This is done by starting at the root block
   and per block:
   updating the flowstate with the defs
   copying the exit-flowstate as in-flowstate of all dominees.

   For exception catchers, the in-flowstate is set as the exit-flowstate of the
   throwing instruction.

   The exception catcher is then handled, so that the catch block is first visited
   with the exit state of the target (because the successors of exception targets
   are visited too).
   Otherwise the catch block would be initialized with the exit-flowstate of the
   entire try-block: with the wrong variable defs

   Example:
   x(0) := 0
   a->b; throws
   a->c; throws
   x(1) := 1

   Exit flowstate is x(1), but the catch block MUST see x(0). Btw, this is only
   problematic when a single version is seen at all throw locations, and updated
   after all throws: no correcting phi is generated in the catch-block then.
*/
void SSAFixupper::CalculateReachesIterate(IL::BasicBlock *block, IL::FlowState const &in_state)
{
        FSPRINT("Calculate reaches iterate for block " << block << ", in state:\n" << in_state);
        if (visited[block])
            return;
        visited[block] = true;

        IL::FlowState &aft_phi_state(afterphi[block]);
        aft_phi_state = in_state;

        for (std::vector<PhiFunction *>::iterator it = block->phifunctions.begin(); it != block->phifunctions.end(); ++it)
            aft_phi_state.visibleassignments[(*it)->variable->variable] = (*it)->variable;

        IL::FlowState &exit_state(afterblock[block]);
        exit_state = aft_phi_state;

        std::set< IL::BasicBlock * > ignore_blocks;

        for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
        {
                (*it)->usedefs.UpdateFlowState(exit_state);
                IL::BasicBlock *onexcept = (*it)->on_exception;
                if (onexcept)
                {
                        ignore_blocks.insert(onexcept);
                        CalculateReachesIterate(onexcept, exit_state);
                }
        }

        if (block->is_exception_target)
        {
                // Just copy definition to catch-block, don't need to iterate
                for (std::vector<BasicBlock *>::iterator it = block->successors.begin(); it != block->successors.end(); ++it)
                    CalculateReachesIterate(*it, exit_state);
        }

        for (std::vector<BasicBlock *>::iterator it = block->dominees.begin(); it != block->dominees.end(); ++it)
            if (!ignore_blocks.count(*it))
                CalculateReachesIterate(*it, exit_state);
}

void SSAFixupper::ReplaceIterate(IL::BasicBlock *block)
{
        /* Replace the phi-parameters */
        for (std::vector<PhiFunction *>::iterator it = block->phifunctions.begin(); it != block->phifunctions.end(); ++it)
            for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
            {
                    if (std::find(block->predecessors.begin(), block->predecessors.end(), it2->second) == block->predecessors.end())
                    {
                            std::string s = "CORRUPT: NULL", t = "CORRUPT: NULL";
                            DEBUGPRINT("Error, block: " << block);
                            if ((*it)->variable && (*it)->variable->variable)
                                s = (*it)->variable->variable->name + "(" + Blex::AnyToString((*it)->variable->id) +")";
                            if (it2->first->variable)
                                t = it2->first->variable->name + "(" + Blex::AnyToString(it2->first->id) +")";
                            throw std::logic_error("Phi-parameter for var "+s+" had the block pointer for "+t+" set to a non-predecessor (" + Blex::AnyToString(it2->second) + ")");
                    }

                    IL::FlowState const &afterblockstate = afterblock[it2->second];

                    FlowState::VisibleAssignmentsMap::const_iterator new_var = afterblockstate.visibleassignments.find(it2->first->variable);
                    if (new_var == afterblockstate.visibleassignments.end())
                    {
                            // (*it)->variable is used, but not defined...
                            std::string s = "CORRUPT: NULL";
                            DEBUGPRINT("Error, phi-fixup in block " << block << ", state: " << afterblockstate);
                            if (it2->first && it2->first->variable)
                                s = it2->first->variable->name;
                            throw std::logic_error("Strictness error in fixupper, phi-variable "+s+" used without dominating definition!");
                    }
                    else
                    {
                            it2->first = new_var->second;
                    }
            }

        IL::FlowState state(afterphi[block]);

        FSPRINT("ReplaceIterate for block " << block << ", state after phi: " << state);

        std::set< BasicBlock * > except_blocks;

        for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
        {
                FSPRINT("REPLUSE for: " << **it);
                (*it)->usedefs.ReplaceUses(state);
                Visit(*it, &state);
                (*it)->usedefs.UpdateFlowState(state);
        }

        for (std::vector<BasicBlock *>::iterator it = block->dominees.begin(); it != block->dominees.end(); ++it)
            ReplaceIterate(*it);
}

void SSAFixupper::Execute(IL::CodedFunction *func, IL::FlowState const &state)
{
        CalculateReachesIterate(func->block, state);
        ReplaceIterate(func->block);
}

void SSAFixupper::V_ILInstruction(ILInstruction *, IL::FlowState *)
{
        throw std::runtime_error("this type may not be visited!");
}
void SSAFixupper::V_ILConstant(ILConstant *, IL::FlowState *)
{
}
void SSAFixupper::V_ILAssignment(ILAssignment *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILBinaryOperator(ILBinaryOperator *obj, IL::FlowState *state)
{
        replacer(state, obj->lhs);
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILCast(ILCast *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILUnaryOperator(ILUnaryOperator *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILFunctionCall(ILFunctionCall *obj, IL::FlowState *state)
{
        for (std::vector<SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
            replacer(state, *it);
}
void SSAFixupper::V_ILColumnOperator(ILColumnOperator *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILConditionalJump(ILConditionalJump *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILReturn(ILReturn *obj, IL::FlowState *state)
{
        if (obj->returnvalue)
            replacer(state, obj->returnvalue);
}

void SSAFixupper::V_ILMethodCall(IL::ILMethodCall *obj, IL::FlowState *state)
{
        replacer(state, obj->object);
        for (std::vector<SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
            replacer(state, *it);
}

void SSAFixupper::V_ILFunctionPtrCall(IL::ILFunctionPtrCall *obj, IL::FlowState *state)
{
        replacer(state, obj->functionptr);
        for (std::vector<SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
            replacer(state, *it);
}

void SSAFixupper::V_ILRecordCellSet(IL::ILRecordCellSet *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
        replacer(state, obj->value);
}
void SSAFixupper::V_ILRecordCellDelete(IL::ILRecordCellDelete *obj, IL::FlowState *state)
{
        replacer(state, obj->rhs);
}
void SSAFixupper::V_ILObjectMemberGet(IL::ILObjectMemberGet *obj, IL::FlowState *state)
{
        replacer(state, obj->object);
}
void SSAFixupper::V_ILObjectMemberSet(IL::ILObjectMemberSet *obj, IL::FlowState *state)
{
        replacer(state, obj->object);
        replacer(state, obj->value);
}
void SSAFixupper::V_ILObjectMemberDelete(IL::ILObjectMemberDelete *obj, IL::FlowState *state)
{
        replacer(state, obj->object);
}
void SSAFixupper::V_ILObjectMemberInsert(IL::ILObjectMemberInsert *obj, IL::FlowState *state)
{
        replacer(state, obj->object);
        replacer(state, obj->value);
}

} // end of namespace HareScript
} // end of namespace Compiler

//---------------------------------------------------------------------------
