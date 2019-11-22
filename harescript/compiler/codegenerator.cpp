#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "debugprints.h"

#include "../vm/hsvm_constants.h"
#include "il.h"
#include "codegenerator.h"
#include "compiler.h"
#include "utilities.h"


//#define SHOWCODEGEN


/** The codegenerator takes the IL code, and transforms it into Virtal Machine code

    It works on basic block level, creates a dependency graph for all instructions
    within that block and then transforms the instructions to the code.

    It could be worth while to split the transformation into dependency graphs
    and the code generation; dependency graphs are GREAT optimizers for dead code.
    After the transformation dead-code optimilizations can be done over the whole
    function (inter basic-block). (but, do we NEED that optimalization?)

    The SSA form is kept by this transformation. */

#ifdef SHOWCODEGEN
 #define CODEGENPRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define CODEGENPRINT(a)
#endif


namespace HareScript
{
namespace Compiler
{
using namespace Code;

CodeGenerator::CodeGenerator(CompilerContext &context)
: context(context)
, translator(context)
{
}

CodeGenerator::~CodeGenerator()
{
}

Code::Instruction CodeGenerator::GetLOAD(LineColumn position, IL::SSAVariable *var, signed lowstacksize)
{
        Instruction i(position, lowstacksize);
        if (!var->variable)
            Blex::ErrStream() << var;
        if (var->variable->storagetype == IL::Variable::Stack)
            i.type = InstructionSet::LOADS;
        else
            i.type = InstructionSet::LOADG;
        i.data.var = var;
        i.varpositions.push_back(VarPosition(var, lowstacksize, VarPosition::PushPos | VarPosition::PostInstr));
        return i;
}

void CodeGenerator::Execute(IL::Module *mdl, ILLiveAnalyzer *_liveanalyzer)
{
        liveanalyzer = _liveanalyzer;
        curmodule = mdl;

        std::vector<IL::BasicBlock *> worklist;

        /* This function translates all basic blocks of an IL-function */
        for (std::vector<IL::CodedFunction *>::iterator it = mdl->functions.begin(); it != mdl->functions.end(); ++it)
        {
                IL::CodedFunction &curfunction = **it;

                worklist.push_back(curfunction.block);

                while (!worklist.empty())
                {
                        IL::BasicBlock *back = worklist.back();
                        worklist.pop_back();

//                        std::cout << "Translating: " << *back << std::endl;
                        DoBasicBlock(mdl, back);

                        /* The data about which global variables are used and
                           defined must also be imported into the new code block */
                        CodeBlock *translatedblock = translatedblocks[back];
                        for (std::set<IL::ILInstruction *>::iterator it2 = translatedblock->ilinstrs.begin(); it2 != translatedblock->ilinstrs.end(); ++it2)
                        {
                                curfunction.defs_globals = curfunction.defs_globals || (*it2)->DefinesGlobals();
                                curfunction.uses_globals = curfunction.uses_globals || (*it2)->UsesGlobals();
                        }

                        worklist.insert(worklist.end(), back->dominees.begin(), back->dominees.end());
                }
        }
}

std::pair<bool, bool> CodeGenerator::TryMergeBlocks(CodeBlock *pre, CodeBlock *to, bool loadstorematch)
{
        CODEGENPRINT("TryMerge: ");
        CODEGENPRINT(" Pre: " << *pre);
        CODEGENPRINT(" To: " << *to);

        bool modified_loads = false;

        /* FIXME: in some situations, the blockmerge is not optimal (leaves some unnecessary store-load pairs). It is
            not fatal, but should be investigated! */

        /* if someone is dependent on pre, it must be the to block! This merger is not complicated enough to handle
           merges of other kinds */
        if (!pre->reverse_dependencies.empty() && pre->reverse_dependencies != Utilities::make_set(to))
        {
                CODEGENPRINT("Someone else depends on pre besides to");
                CODEGENPRINT("Pre rdeps: " << pre->reverse_dependencies);
                for (std::set<CodeBlock *>::iterator it = pre->reverse_dependencies.begin(); it != pre->reverse_dependencies.end(); ++it)
                    CODEGENPRINT(**it);
                return std::make_pair(false, modified_loads);
        }

        /* If pre defines or uses another version of a global variable than we use concatenation is forbidden; only
           one version of a global may be alive at a given time! (a use hidden by a def is ok) */
        for (std::set<IL::SSAVariable *>::iterator it = to->var_uses.begin(); it != to->var_uses.end(); ++it)
            if ((*it)->variable->storagetype == IL::Variable::Global)
            {
                    bool isdefined = false;
                    for (std::set<IL::SSAVariable *>::iterator it2 = pre->var_defs.begin(); it2 != pre->var_defs.end(); ++it2)
                        if ((*it)->variable == (*it2)->variable)
                        {
                              if (*it != *it2)
                              {
                                      CODEGENPRINT("To uses " << *it << ", interferes with define of " << *it2 << " in pre");
                                      return std::make_pair(false, modified_loads);
                              }
                              else
                              {
                                      isdefined = true;
                                      break;
                              }
                        }
                    if (!isdefined)
                    {
                            for (std::set<IL::SSAVariable *>::iterator it2 = pre->var_uses.begin(); it2 != pre->var_uses.end(); ++it2)
                                if ((*it)->variable == (*it2)->variable && *it != *it2)
                                {
                                        CODEGENPRINT("To uses " << *it << ", interferes with use of " << *it2 << " in pre");
                                        return std::make_pair(false, modified_loads);
                                }
                    }
            }

        /* We must look out when 'pre' modifies :outsidestate, and a load of 'to' contains an imported variable; these MUST
           be ordered pre -> to. */
        bool pre_modifies_outsidestate = false;
        for (std::set<IL::SSAVariable *>::iterator it = pre->var_defs.begin(); it != pre->var_defs.end(); ++it)
            pre_modifies_outsidestate = pre_modifies_outsidestate || (*it)->variable == curmodule->outsidestate;

        std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::iterator it = to->loads.begin();
        while (it != to->loads.end())
        {
                // Emit this load when it is of an import, and pre modifies outsidestate
                if (pre_modifies_outsidestate && it->first->variable->symbol && it->first->variable->symbol->flags & SymbolFlags::Imported)
                    break;

                // Emit this load if it is defined by pre, but not stored
                if (pre->var_defs.count(it->first) && std::find(pre->stores.begin(), pre->stores.end(), it->first) == pre->stores.end())
                    break;

                ++it;
        }

        if (it != to->loads.end())
        {
                signed lowstacksize = std::distance(to->loads.begin(), it);

                std::vector< Code::Instruction > loads;
                for (std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::iterator it2 = it; it2 != to->loads.end(); ++it2)
                    loads.insert(loads.begin(), GetLOAD(it2->second->position, it2->first, lowstacksize++));

                reverse_copy(loads.begin(), loads.end(), std::inserter(to->elements, to->elements.begin()));
                to->loads.erase(it, to->loads.end());

                modified_loads = true;

                CODEGENPRINT("Modified to: " << *to);
        }

        /* We must find the first element in to->loads that is also in to->stores.
            That one, and all loads AFTER that one must be emitted. */
        bool foundmatch = false;
        for (std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::iterator it = to->loads.begin(); it != to->loads.end(); ++it)
            if (std::find(pre->stores.begin(), pre->stores.end(), it->first) != pre->stores.end())
            {
                    foundmatch = true;

                    if (loadstorematch)
                    {
                            // If we must have an exact load-store match, the loads and reverse stores MUST match from here on
                            if (std::distance(it, to->loads.end()) < static_cast<signed>(pre->stores.size()))
                            {
                                    foundmatch = false;
                                    break;
                            }

                            // If the loads do not match the stores, return false
                            std::vector<IL::SSAVariable *>::reverse_iterator store_it = pre->stores.rbegin();
                            for (std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::iterator it2 = it; it2 != to->loads.end() && store_it != pre->stores.rend(); ++it2, ++store_it)
                                if (it2->first != *store_it)
                                {
                                        foundmatch = false;
                                        break;
                                }

                            if (!foundmatch)
                                break;
                    }

//                    CODEGENPRINT("Block: " << *to);

                    if (it != to->loads.end())
                    {
                            modified_loads = true;

                            signed lowstacksize = std::distance(to->loads.begin(), it);

                            std::vector<Code::Instruction> loads;
                            for (std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::iterator it2 = it; it2 != to->loads.end(); ++it2)
                                loads.insert(loads.begin(), GetLOAD(it2->second->position, it2->first, lowstacksize++));

                            reverse_copy(loads.begin(), loads.end(), std::inserter(to->elements, to->elements.begin()));
                            to->loads.erase(it, to->loads.end());
                    }

                    break;
            }

        // Return if we needed a match, but did not get one
        if (loadstorematch && !foundmatch)
        {
                CODEGENPRINT("No match found when requiring one");
                return std::make_pair(false, modified_loads);
        }

        signed stackposchange = to->loads.size();

        to->loads.insert(to->loads.end(), pre->loads.begin(), pre->loads.end());
        for (std::map<IL::SSAVariable *, unsigned>::iterator it = pre->load_counts.begin(); it != pre->load_counts.end(); ++it)
            to->load_counts[it->first] += it->second;

        // Correct lowstacksize of pre block instructions for added loads from to
        for (auto &itr: pre->elements)
        {
                if (itr.lowstacksize >= 0)
                    itr.lowstacksize += stackposchange;
        }

        // Update the dependencies
        to->dependencies.insert(pre->dependencies.begin(), pre->dependencies.end());
        to->dependencies.erase(pre);

        for (std::set<CodeBlock *>::const_iterator it = pre->dependencies.begin(); it != pre->dependencies.end(); ++it)
        {
                (*it)->reverse_dependencies.erase(pre);
                (*it)->reverse_dependencies.insert(to);
        }

        // Copy the instructions
        to->elements.insert(to->elements.begin(), pre->elements.begin(), pre->elements.end());
        to->ilinstrs.insert(pre->ilinstrs.begin(), pre->ilinstrs.end());

        // Copy the defs
        to->var_defs.insert(pre->var_defs.begin(), pre->var_defs.end());
        // The new to->var_uses are pre->var_uses + (to->var_uses - pre->var_defs)

        std::set<IL::SSAVariable *> temp;
        std::set_difference(to->var_uses.begin(), to->var_uses.end(),
                        pre->var_defs.begin(), pre->var_defs.end(),
                        Utilities::associative_inserter(pre->var_uses));
        pre->var_uses.swap(to->var_uses);

        std::copy(pre->var_throwuses.begin(), pre->var_throwuses.end(),
                        Utilities::associative_inserter(to->var_throwuses));

        CODEGENPRINT("Final to: " << *to);

        return std::make_pair(true, modified_loads);
}

void CodeGenerator::DoBasicBlock(IL::Module *mdl, IL::BasicBlock *block)
{
        CODEGENPRINT ("Translating " << *block);

        Blex::GenericOwner tempowner;

        /* This works by taking the last code-instruction of the basic block, adding all reverse dependencies of
           the basic block to that code-block, and then merging all other instructions that are needed to the
           begin of that block. Minimizing unnecessary store-load pairs is the main idea here */

        std::set<CodeBlock *> cblocks;
        std::map<IL::ILInstruction *, CodeBlock *> imapping;

        // Translate all instructions, and build the mapping
        for (std::vector<IL::ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
        {
                CodeBlock *block = new CodeBlock;
                tempowner.Adopt(block);

                translator.Translate(*it, block, liveanalyzer);
                imapping[*it] = block;
                cblocks.insert(block);

                CODEGENPRINT ("Translated " << **it << " to \n" << *block);
        }

        // Create a mapping from variables to the block where they are stored
        std::map<IL::SSAVariable *, CodeBlock *> vardefineblock;
        for (std::set<CodeBlock *>::iterator it = cblocks.begin(); it != cblocks.end(); ++it)
            for (std::set<IL::SSAVariable *>::iterator it2 = (*it)->var_defs.begin(); it2 != (*it)->var_defs.end(); ++it2)
                vardefineblock[*it2] = *it;

        // Build the exit dependencies
        std::set<IL::SSAVariable *> exitvardeps;
        std::set_difference(liveanalyzer->exitlivedata[block].begin(), liveanalyzer->exitlivedata[block].end(),
                            liveanalyzer->entrylivedata[block].begin(), liveanalyzer->entrylivedata[block].end(),
                            std::inserter(exitvardeps, exitvardeps.begin()) );

        // Build the intra-codeblock dependencies, and
        for (std::set<CodeBlock *>::iterator it = cblocks.begin(); it != cblocks.end(); ++it)
            for (std::set<IL::SSAVariable *>::iterator it2 = (*it)->var_uses.begin(); it2 != (*it)->var_uses.end(); ++it2)
                if (vardefineblock.count(*it2))
                {
                        (*it)->dependencies.insert(vardefineblock[*it2]);
                        vardefineblock[*it2]->reverse_dependencies.insert(*it);
                }

        // build list of instructions that MUST be added (a return, a conditional jump or a definition of a exitdep)
        std::set<CodeBlock *> exitdeps;
        CodeBlock *last(0);
        for (std::set<CodeBlock *>::iterator it = cblocks.begin(); it != cblocks.end(); ++it)
        {
                // Add to worklist if it defines at least one of the exitdeps
                if (Utilities::intersects((*it)->var_defs.begin(), (*it)->var_defs.end(), exitvardeps.begin(), exitvardeps.end()))
                    exitdeps.insert(*it);

                for (std::set<IL::ILInstruction *>::iterator it2 = (*it)->ilinstrs.begin(); it2 != (*it)->ilinstrs.end(); ++it2)
                {
                        IL::ILConditionalJump *jmp = dynamic_cast<IL::ILConditionalJump *>(*it2);
                        IL::ILReturn *ret = dynamic_cast<IL::ILReturn *>(*it2);
                        if (ret || jmp)
                            last = *it;
                }
        }

        CODEGENPRINT("Exit dependencies: " << exitdeps);
        CODEGENPRINT("Endblock: " << last);

        // Construct the endblock, if it hasn't been assigned to yet
        CodeBlock *endblock = last;
        if (!endblock)
        {
                endblock = new CodeBlock;
                tempowner.Adopt(endblock);
                CODEGENPRINT("Constructed new, empty endblock: " << *endblock);
        }

        // Add dependencies on exitvalues to endblock (also reversedeps!)
        endblock->dependencies.insert(exitdeps.begin(), exitdeps.end());
        endblock->var_uses.insert(exitvardeps.begin(), exitvardeps.end());
        for (std::set<CodeBlock *>::iterator it = exitdeps.begin(); it != exitdeps.end(); ++it)
            (*it)->reverse_dependencies.insert(endblock);

        // Enumerate all needed blocks
        std::set<CodeBlock *> needed_nodes;
        std::set<CodeBlock *> worklist;
        worklist.insert(endblock);
        while (!worklist.empty())
        {
                CodeBlock *current = *worklist.begin();
                worklist.erase(worklist.begin());
                needed_nodes.insert(current);
                for (std::set<CodeBlock *>::iterator it = current->dependencies.begin(); it != current->dependencies.end(); ++it)
                    if (!needed_nodes.count(*it))
                        worklist.insert(*it);
        }

        // Erase all unneeded blocks
        for (std::set<CodeBlock *>::iterator it = needed_nodes.begin(); it != needed_nodes.end(); ++it)
        {
                for (std::set<CodeBlock *>::iterator it2 = (*it)->reverse_dependencies.begin(); it2 != (*it)->reverse_dependencies.end();)
                {
                        if (!needed_nodes.count(*it2))
                            (*it)->reverse_dependencies.erase(it2++);
                        else
                            ++it2;
                }
        }

        // Merge all blocks into endblock
        std::set<IL::SSAVariable *> eliminable;
        while (!endblock->dependencies.empty())
        {
                CODEGENPRINT("\nCurrent dependencies: " << endblock->dependencies);

                bool did_merge = false;

                /* Here, we try to match the blocks. We'll start at the last load, trying to generate as little load/stores
                   as possible. However, if a variable is loaded multiple times (LOAD a, LOAD b, LOAD a), we'll use the first
                   load of A for ordering (so, we'll try B first, then A)
                */

                // For every loaded variable, calc the defining block and the ordering position for trying merges
                std::map< CodeBlock *, unsigned > block_merge_positions;
                unsigned pos = 0;
                for (auto &it: Utilities::reverse_range(endblock->loads))
                    if (vardefineblock.count(it.first))
                        block_merge_positions[vardefineblock[it.first]] = pos++;

                // Switch the map, the switched map's iterator contains the ordering to follow
                auto block_order_map = Utilities::switch_map(block_merge_positions);

                for (auto itr: block_order_map)
                {
                        CodeBlock *mergeblock = itr.second;

                        std::pair<bool, bool> res = TryMergeBlocks(mergeblock, endblock, true);
                        if (res.first)
                        {
                                // try to determine which STORES - LOADS pairs we can eliminate
                                // Peephole & registeralloc combined do the same, but this here is easy and removes strain on the next passes.
                                for (std::vector<IL::SSAVariable *>::iterator it2 = mergeblock->stores.begin(); it2 != mergeblock->stores.end(); ++it2)
                                {
                                        // after this load, the variable must be dead (not loaded again, not live on exit)
                                        if (endblock->load_counts[*it2] != 1 || exitvardeps.count(*it2) || endblock->var_throwuses.count(*it2))
                                            continue;

                                        // the variable may not be global
                                        if (mdl->globalvars.count((*it2)->variable))
                                            continue;

                                        eliminable.insert(*it2);
                                }
                                did_merge = true;
                                break;
                        }
                        else
                        {
                                CODEGENPRINT("Direct merge fails");

                                // Enumerate the block we need for loads
                                std::set< CodeBlock * > loadblocks;
                                for (std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::iterator it2 = endblock->loads.begin(); it2 != endblock->loads.end(); ++it2)
                                    if (vardefineblock.count(it2->first))
                                        loadblocks.insert(vardefineblock[it2->first]);

                                for (std::set<CodeBlock *>::iterator it2 = endblock->dependencies.begin(); it2 != endblock->dependencies.end(); ++it2)
                                    if (!loadblocks.count(*it2))
                                    {
                                            // Block needed for deps, but not for loads. Try and merge one of those
                                            CODEGENPRINT("Trying non-load dependency");

                                            CODEGENPRINT("Ili " << *it2 << ": " << (*it2)->ilinstrs);
                                            CODEGENPRINT("Deps of " << *it2 << ": " << (*it2)->dependencies);
                                            CODEGENPRINT("RDeps of " << *it2 << ": " << (*it2)->reverse_dependencies);

                                            if (TryMergeBlocks(*it2, endblock, false).first)
                                            {
                                                    did_merge = true;
                                                    break;
                                            }
                                    }

                                if (did_merge)
                                  break;
                        }
                        if (res.second) // to->loads has been modified -> break from this loop
                            break;
                }

                if (!did_merge)
                    for (std::set<CodeBlock *>::iterator it = endblock->dependencies.begin(); it != endblock->dependencies.end(); ++it)
                    {
                        CODEGENPRINT("Ili " << *it << ": " << (*it)->ilinstrs);
                        CODEGENPRINT("Deps of " << *it << ": " << (*it)->dependencies);
                        CODEGENPRINT("RDeps of " << *it << ": " << (*it)->reverse_dependencies);

                        if (TryMergeBlocks(*it, endblock, false).first)
                        {
                                did_merge = true;
                                break;
                        }
                        else
                        {
                                CODEGENPRINT("Indirect merge fails");
                        }
                    }
                if (!did_merge)
                    throw std::logic_error("Circular dependency in local block");
        }

        signed lowstacksize = endblock->loads.size();
        for (std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> >::reverse_iterator it = endblock->loads.rbegin(); it != endblock->loads.rend(); ++it)
            endblock->elements.insert(endblock->elements.begin(), GetLOAD(it->second->position, it->first, --lowstacksize));

        CODEGENPRINT("Eliminating: " << eliminable);
        // Eliminate all STORES - LOADS pairs that are not needed anymore.
        for (std::vector<Code::Instruction>::iterator it = endblock->elements.begin(); it != endblock->elements.end();)
        {
                if ((it->type == InstructionSet::LOADS || it->type == InstructionSet::STORES) &&
                        eliminable.count(it->data.var))
                {
                        // Place def of this var on next instruction (first on the current, then move with the erase)
                        if (it->type == InstructionSet::STORES && it->lowstacksize >= 0)
                              it->varpositions.push_back(VarPosition(it->data.var, it->lowstacksize, VarPosition::PushPos));

                        it = endblock->EraseInstruction(it);
                }
                else
                    ++it;
        }

        CODEGENPRINT(*endblock);

        // Return a copy that is owned by the general object owner (the endblock itself will be destroyed by the tempowner)
        translatedblocks[block] = Adopt(new CodeBlock(*endblock));
}

// -----------------------------------------------------------------------------
// --
// -- Special functions inlining
// --

void CodeGenerator::InstructionTranslator::InlineSpecialFunction(IL::ILFunctionCall *obj, CodeBlock *block)
{
        if ("__HS_SQL_GETSOURCESBASELIST" == obj->function->name)
        {
                Instruction i(obj->position, -1);
                i.type = InstructionSet::LOADC;
                i.constant.type = VariableTypes::RecordArray;
                block->elements.push_back(i);

                EmitStore(obj, obj->target, block);
        }
        if ("__HS_SQL_ADDTABLESOURCE" == obj->function->name || "__HS_SQL_ADDRECORDARRAYSOURCE" == obj->function->name)
        {
                // LOAD parameter 0 (RECORD ARRAY sources)
                EmitLoad(obj, obj->values[0], block);

                // LOAD parameter 2 (INTEGER typeinfo)
                EmitLoad(obj, obj->values[2], block);

                // LOAD parameter 1 (TABLE tbl / RECORD ARRAY expr)
                EmitLoad(obj, obj->values[1], block);

                Instruction i(obj->position, -1);

                // stack: typeinfo, source, sources

                // INITVAR RECORD (rec)
                i.type = InstructionSet::INITVAR;
                i.constant = IL::Constant(VariableTypes::Record, 0);
                block->elements.push_back(i);

                // LOADC TRUE
                i.type = InstructionSet::LOADC;
                i.constant = IL::Constant(context.stackm, "__HS_SQL_ADDTABLESOURCE" == obj->function->name);
                block->elements.push_back(i);

                // rec := CellInsert(rec, "ISDB", TRUE)
                i.type = InstructionSet::RECORDCELLSET;
                i.constant = IL::Constant(context.stackm, "ISDB");
                block->elements.push_back(i);

                i.type = InstructionSet::SWAP;
                i.constant = IL::Constant();
                block->elements.push_back(i);

                // rec := CellInsert(rec, "SOURCE", source)
                i.type = InstructionSet::RECORDCELLSET;
                i.constant = IL::Constant(context.stackm, "SOURCE");
                block->elements.push_back(i);

                i.type = InstructionSet::SWAP;
                i.constant = IL::Constant();
                block->elements.push_back(i);

                // rec := CellInsert(rec, "TYPEINFO", typeinfo)
                i.type = InstructionSet::RECORDCELLSET;
                i.constant = IL::Constant(context.stackm, "TYPEINFO");
                block->elements.push_back(i);

                // INSERT rec INTO sources AT END
                i.type = InstructionSet::ARRAYAPPEND;
                i.constant = IL::Constant();
                block->elements.push_back(i);

                EmitStore(obj, obj->target, block);
        }
}

// -----------------------------------------------------------------------------
// --
// -- IL to code generator
// --

void CodeGenerator::InstructionTranslator::Translate(IL::ILInstruction *instr, CodeBlock *block, ILLiveAnalyzer *liveanalyzer)
{
        // Only called on live instructions!
        current = instr;
        stacksize = 0;
        Visit(instr, block);

        block->ilinstrs.insert(instr);

        instr->InsertUsed(&block->var_uses);
        instr->InsertDefined(&block->var_defs);

        if (instr->on_exception)
        {
                std::set<IL::SSAVariable *> &except_vars = liveanalyzer->entrylivedata[instr->on_exception];
//                block->var_uses.insert(except_vars.begin(), except_vars.end());

                CODEGENPRINT("Translating except ili " << *instr);
                CODEGENPRINT("Live in entry except doc: " << except_vars);

                std::set_difference(except_vars.begin(), except_vars.end(),
                        block->var_defs.begin(), block->var_defs.end(),
                        Utilities::associative_inserter(block->var_throwuses));

                block->var_uses.insert(block->var_throwuses.begin(), block->var_throwuses.end());

                CODEGENPRINT("New throwuses: " << block->var_throwuses);
                CODEGENPRINT("New uses: " << block->var_uses);
        }
}

void CodeGenerator::InstructionTranslator::EmitLoad(IL::ILInstruction *instr, IL::SSAVariable *var, CodeBlock *block)
{
        block->loads.push_back(std::make_pair(var, instr));
        ++block->load_counts[var];
        ++stacksize;
}
void CodeGenerator::InstructionTranslator::EmitStore(IL::ILInstruction *instr, IL::SSAVariable *var, CodeBlock *block)
{
        Instruction i(instr->position, --stacksize);
        if (var->variable->storagetype == IL::Variable::Stack)
            i.type = InstructionSet::STORES;
        else
            i.type = InstructionSet::STOREG;
        i.data.var = var;

        // ADDME: try enabling this: We treat the stored var as being defined at the start of this instruction
        //   It generates a lot more varpositions, are they worth it?
        //i.varpositions.push_back(VarPosition(var, stacksize, VarPosition::PushPos));

        block->elements.push_back(i);

        block->stores.push_back(var);
}

void CodeGenerator::InstructionTranslator::V_ILInstruction(IL::ILInstruction *, CodeBlock *)
{
}
void CodeGenerator::InstructionTranslator::V_ILConstant(IL::ILConstant *obj, CodeBlock *block)
{
        Instruction i(obj->position, stacksize++);
        i.constant = obj->constant;
        if (obj->constant.type == VariableTypes::TypeInfo)
            i.type = InstructionSet::LOADTYPEID;
        else
            i.type = InstructionSet::LOADC;
        block->elements.push_back(i);

        EmitStore(obj, obj->target, block);
}
void CodeGenerator::InstructionTranslator::V_ILAssignment(IL::ILAssignment *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->rhs, block);
        EmitStore(obj, obj->target, block);
}
void CodeGenerator::InstructionTranslator::V_ILCast(IL::ILCast *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->rhs, block);
        Instruction i(obj->position, stacksize - 1);
        i.type = obj->is_explicit ? InstructionSet::CASTF : obj->function ? InstructionSet::CASTPARAM : InstructionSet::CAST;
        i.constant = IL::Constant(obj->to_type, 0);
        i.data.functionsymbol = obj->function;
        block->elements.push_back(i);
        EmitStore(obj, obj->target, block);
}
void CodeGenerator::InstructionTranslator::V_ILBinaryOperator(IL::ILBinaryOperator *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->lhs, block);
        EmitLoad(obj, obj->rhs, block);

        Instruction i(obj->position, --stacksize - 1);
        switch (obj->operation)
        {
        case BinaryOperatorType::OpAnd:         {
                                                        i.type = InstructionSet::AND;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpOr:          {
                                                        i.type = InstructionSet::OR;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpXor:         {
                                                        i.type = InstructionSet::XOR;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpAdd:         {
                                                        i.type = InstructionSet::ADD;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpSubtract:    {
                                                        i.type = InstructionSet::SUB;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpMultiply:    {
                                                        i.type = InstructionSet::MUL;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpDivide:      {
                                                        i.type = InstructionSet::DIV;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpModulo:      {
                                                        i.type = InstructionSet::MOD;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpLess:        {
                                                        i.type = InstructionSet::LOADC;
                                                        i.constant = IL::Constant(context.stackm, (int32_t)ConditionCode::Less);
                                                        i.lowstacksize += 2;
                                                        block->elements.push_back(i);
                                                        i.type = InstructionSet::CMP2;
                                                        i.lowstacksize -= 2;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpLessEqual:   {
                                                        i.type = InstructionSet::LOADC;
                                                        i.constant = IL::Constant(context.stackm, (int32_t)ConditionCode::LessEqual);
                                                        i.lowstacksize += 2;
                                                        block->elements.push_back(i);
                                                        i.type = InstructionSet::CMP2;
                                                        i.lowstacksize -= 2;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpEqual:       {
                                                        i.type = InstructionSet::LOADC;
                                                        i.constant = IL::Constant(context.stackm, (int32_t)ConditionCode::Equal);
                                                        i.lowstacksize += 2;
                                                        block->elements.push_back(i);
                                                        i.type = InstructionSet::CMP2;
                                                        i.lowstacksize -= 2;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpUnEqual:     {
                                                        i.type = InstructionSet::LOADC;
                                                        i.constant = IL::Constant(context.stackm, (int32_t)ConditionCode::UnEqual);
                                                        i.lowstacksize += 2;
                                                        block->elements.push_back(i);
                                                        i.type = InstructionSet::CMP2;
                                                        i.lowstacksize -= 2;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpGreater:     {
                                                        i.type = InstructionSet::LOADC;
                                                        i.constant = IL::Constant(context.stackm, (int32_t)ConditionCode::Bigger);
                                                        i.lowstacksize += 2;
                                                        block->elements.push_back(i);
                                                        i.type = InstructionSet::CMP2;
                                                        i.lowstacksize -= 2;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpGreaterEqual: {
                                                        i.type = InstructionSet::LOADC;
                                                        i.constant = IL::Constant(context.stackm, (int32_t)ConditionCode::BiggerEqual);
                                                        i.lowstacksize += 2;
                                                        block->elements.push_back(i);
                                                        i.type = InstructionSet::CMP2;
                                                        i.lowstacksize -= 2;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpBitAnd:      {
                                                        i.type = InstructionSet::BITAND;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpBitOr:       {
                                                        i.type = InstructionSet::BITOR;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpBitXor:      {
                                                        i.type = InstructionSet::BITXOR;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpBitLShift:   {
                                                        i.type = InstructionSet::BITLSHIFT;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpBitRShift:   {
                                                        i.type = InstructionSet::BITRSHIFT;
                                                        block->elements.push_back(i);
                                                }; break;

        case BinaryOperatorType::OpMerge:       {
                                                        i.type = InstructionSet::MERGE;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpIn:          {
                                                        i.type = InstructionSet::ISIN;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpLike:        {
                                                        i.type = InstructionSet::LIKE;
                                                        block->elements.push_back(i);
                                                }; break;
        case BinaryOperatorType::OpConcat:      {
                                                        i.type = InstructionSet::CONCAT;
                                                        block->elements.push_back(i);
                                                }; break;
        default:
            throw std::logic_error("Erroneous BinaryOperator type");
        };
        EmitStore(obj, obj->target, block);
}
void CodeGenerator::InstructionTranslator::V_ILUnaryOperator(IL::ILUnaryOperator *obj, CodeBlock *block)
{
        Instruction i(obj->position, stacksize);

        switch (obj->operation)
        {
        case UnaryOperatorType::OpBitNeg:       i.type = InstructionSet::BITNEG; break;
        case UnaryOperatorType::OpMakeExisting: i.type = InstructionSet::RECORDMAKEEXISTING; break;
        case UnaryOperatorType::OpNeg:          i.type = InstructionSet::NEG; break;
        case UnaryOperatorType::OpNot:          i.type = InstructionSet::NOT; break;
        case UnaryOperatorType::OpPlus:         return; // Ignore OpPlus (it is a no-op)
        }

        EmitLoad(obj, obj->rhs, block);
        block->elements.push_back(i);
        EmitStore(obj, obj->target, block);
}
void CodeGenerator::InstructionTranslator::V_ILFunctionCall(IL::ILFunctionCall *obj, CodeBlock *block)
{
        /** Also translates array upcalls */
        signed org_stacksize = stacksize;
        Instruction i(obj->position, stacksize);
        i.on_exception = current->on_exception;
        i.type = InstructionSet::CALL;
        if (":ARRAYSET" == obj->function->name) i.type = InstructionSet::ARRAYSET;
        if (":ARRAYSIZE" == obj->function->name) i.type = InstructionSet::ARRAYSIZE;
        if (":ARRAYINDEX" == obj->function->name) i.type = InstructionSet::ARRAYINDEX;
        if (":ARRAYINSERT" == obj->function->name) i.type = InstructionSet::ARRAYINSERT;
        if (":ARRAYAPPEND" == obj->function->name) i.type = InstructionSet::ARRAYAPPEND;
        if (":ARRAYDELETE" == obj->function->name) i.type = InstructionSet::ARRAYDELETE;
        if (":ARRAYDELETEALL" == obj->function->name) i.type = InstructionSet::ARRAYDELETEALL;
        if (":RECORDMAKEEXISTING" == obj->function->name) i.type = InstructionSet::RECORDMAKEEXISTING;
        if (":DEEPSET" == obj->function->name) i.type = InstructionSet::DEEPSET;
        if (":DEEPSETTHIS" == obj->function->name) i.type = InstructionSet::DEEPSETTHIS;
        if (":DEEPARRAYAPPEND" == obj->function->name) i.type = InstructionSet::DEEPARRAYAPPEND;
        if (":DEEPARRAYAPPENDTHIS" == obj->function->name) i.type = InstructionSet::DEEPARRAYAPPENDTHIS;
        if (":DEEPARRAYDELETE" == obj->function->name) i.type = InstructionSet::DEEPARRAYDELETE;
        if (":DEEPARRAYDELETETHIS" == obj->function->name) i.type = InstructionSet::DEEPARRAYDELETETHIS;
        if (":DEEPARRAYINSERT" == obj->function->name) i.type = InstructionSet::DEEPARRAYINSERT;
        if (":DEEPARRAYINSERTTHIS" == obj->function->name) i.type = InstructionSet::DEEPARRAYINSERTTHIS;
        if (":THROWERROR" == obj->function->name) i.type = InstructionSet::THROW2;
        if (":INITFUNCTIONPTR" == obj->function->name) i.type = InstructionSet::INITFUNCTIONPTR;
        if (":INVOKEFPTR" == obj->function->name) i.type = InstructionSet::INVOKEFPTR;
        if (":INVOKEFPTRNM" == obj->function->name) i.type = InstructionSet::INVOKEFPTRNM;
        if (":OBJECTNEW" == obj->function->name) i.type = InstructionSet::OBJNEW;
        if (":OBJECTSETTYPE" == obj->function->name) i.type = InstructionSet::OBJSETTYPE;
        if (":OBJECTMAKEPRIVREF" == obj->function->name) i.type = InstructionSet::OBJMAKEREFPRIV;
        if (":OBJECTMEMBERISSIMPLE" == obj->function->name) i.type = InstructionSet::OBJMEMBERISSIMPLE;
        if (":OBJECTTESTNONSTATIC" == obj->function->name) i.type = InstructionSet::OBJTESTNONSTATIC;
        if (":OBJECTTESTNONSTATICTHIS" == obj->function->name) i.type = InstructionSet::OBJTESTNONSTATICTHIS;
        if (":ISDEFAULTVALUE" == obj->function->name) i.type = InstructionSet::ISDEFAULTVALUE;
        if (":ISVALUESET" == obj->function->name) i.type = InstructionSet::ISVALUESET;
        if (":YIELD" == obj->function->name) i.type = InstructionSet::YIELD;

        if ("__HS_SQL_GETSOURCESBASELIST" == obj->function->name ||
            "__HS_SQL_ADDTABLESOURCE"  == obj->function->name ||
            "__HS_SQL_ADDRECORDARRAYSOURCE" == obj->function->name)
        {
                InlineSpecialFunction(obj, block);
                return;
        }

        // For instructions emit loads in parameter order, for functions in reversed order
        bool reversed_load_order = i.type == InstructionSet::CALL;

        // Special functions - translated to instructions, but with loads in reversed order
        if (obj->function->symbol && obj->function->symbol->functiondef->flags & FunctionFlags::IsSpecial)
        {
                if ("CALLMACROPTRVA" == obj->function->name) i.type = InstructionSet::INVOKEFPTR;
                if ("CALLFUNCTIONPTRVA" == obj->function->name) i.type = InstructionSet::INVOKEFPTRNM;
                if ("ISDEFAULTVALUE" == obj->function->name) i.type = InstructionSet::ISDEFAULTVALUE;
                if ("ISVALUESET" == obj->function->name) i.type = InstructionSet::ISVALUESET;
        }

        // Emit loads in specified order
        if (reversed_load_order)
            for (std::vector<IL::SSAVariable *>::reverse_iterator it = obj->values.rbegin(); it != obj->values.rend(); ++it)
                EmitLoad(obj, *it, block);
        else
            for (std::vector<IL::SSAVariable *>::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
                EmitLoad(obj, *it, block);

        i.data.function = obj->function;
        block->elements.push_back(i);

        if (obj->target)
        {
                stacksize = org_stacksize + 1;
                EmitStore(obj, obj->target, block);
        }
        else
            stacksize = org_stacksize;
}
void CodeGenerator::InstructionTranslator::V_ILColumnOperator(IL::ILColumnOperator *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->rhs, block);

        std::string name(obj->columnname);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, stacksize - 1);
        i.type = InstructionSet::RECORDCELLGET;
        i.constant = IL::Constant(context.stackm, name);
        block->elements.push_back(i);

        EmitStore(obj, obj->target, block);
}
void CodeGenerator::InstructionTranslator::V_ILConditionalJump(IL::ILConditionalJump *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->rhs, block);
        // Defer the setting of tha jump
//        Instruction i;
//        i.type = InstructionSet::JUMPC2;
//        block->elements.push_back(i);
}
void CodeGenerator::InstructionTranslator::V_ILReturn(IL::ILReturn *obj, CodeBlock *block)
{
        Instruction i(obj->position, stacksize);
        if (obj->returnvalue)
        {
                EmitLoad(obj, obj->returnvalue, block);
                --stacksize;
        }
        i.type = InstructionSet::RET;
        block->elements.push_back(i);
}

void CodeGenerator::InstructionTranslator::V_ILMethodCall(IL::ILMethodCall *obj, CodeBlock *block)
{
        std::string name(obj->membername);
        Blex::ToUppercase(name.begin(), name.end());

        signed org_stacksize = stacksize;
        Instruction i(obj->position, stacksize);
        i.on_exception = current->on_exception;
        i.type = obj->allow_macro ?
                (obj->via_this ? InstructionSet::OBJMETHODCALLTHIS : InstructionSet::OBJMETHODCALL) :
                (obj->via_this ? InstructionSet::OBJMETHODCALLTHISNM : InstructionSet::OBJMETHODCALLNM);
        i.constant = IL::Constant(context.stackm, name);
        i.data.paramcount = obj->values.size();

        // Emit loads for functioncalls in reversed order, with normal instructions in parameter order
        for (std::vector<IL::SSAVariable *>::reverse_iterator it = obj->values.rbegin(); it != obj->values.rend(); ++it)
            EmitLoad(obj, *it, block);
        EmitLoad(obj, obj->object, block);

        block->elements.push_back(i);
        if (obj->target)
            EmitStore(obj, obj->target, block);

        stacksize = org_stacksize;
}

void CodeGenerator::InstructionTranslator::V_ILFunctionPtrCall(IL::ILFunctionPtrCall *, CodeBlock *)
{
        throw std::runtime_error("Not supported just yet");
/*
        Instruction i(obj->position);
        i.on_exception = current->on_exception;
        i.type = obj->allow_macro ? InstructionSet::INVOKEFPTR2 : InstructionSet::INVOKEFPTR2NM;
        i.data.paramcount = obj->values.size();

        // Emit loads for functioncalls in reversed order, with normal instructions in parameter order
        for (std::vector<IL::SSAVariable *>::reverse_iterator it = obj->values.rbegin(); it != obj->values.rend(); ++it)
            EmitLoad(obj, *it, block);
        EmitLoad(obj, obj->object, block);

        block->elements.push_back(i);
        if (obj->target)
            EmitStore(obj, obj->target, block);
*/
}

void CodeGenerator::InstructionTranslator::V_ILRecordCellSet(IL::ILRecordCellSet *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->rhs, block);
        EmitLoad(obj, obj->value, block);

        std::string name(obj->columnname);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, --stacksize - 1);
        i.type = obj->check_type
            ? obj->allow_create
                  ? InstructionSet::RECORDCELLCREATE
                  : InstructionSet::RECORDCELLUPDATE
            : InstructionSet::RECORDCELLSET;
        i.constant = IL::Constant(context.stackm, name);
        block->elements.push_back(i);

        EmitStore(obj, obj->target, block);
}

void CodeGenerator::InstructionTranslator::V_ILRecordCellDelete(IL::ILRecordCellDelete *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->rhs, block);

        std::string name(obj->columnname);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, --stacksize - 1);
        i.type = InstructionSet::RECORDCELLDELETE;
        i.constant = IL::Constant(context.stackm, name);
        block->elements.push_back(i);

        EmitStore(obj, obj->target, block);
}

void CodeGenerator::InstructionTranslator::V_ILObjectMemberGet(IL::ILObjectMemberGet *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->object, block);

        std::string name(obj->membername);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, stacksize - 1);
        i.on_exception = current->on_exception;
        i.type = obj->via_this
            ? InstructionSet::OBJMEMBERGETTHIS
            : InstructionSet::OBJMEMBERGET;
        i.constant = IL::Constant(context.stackm, name);
        block->elements.push_back(i);

        EmitStore(obj, obj->target, block);
}

void CodeGenerator::InstructionTranslator::V_ILObjectMemberSet(IL::ILObjectMemberSet *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->object, block);
        EmitLoad(obj, obj->value, block);

        std::string name(obj->membername);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, --stacksize - 1);
        i.on_exception = current->on_exception;
        i.type = obj->via_this
            ? InstructionSet::OBJMEMBERSETTHIS
            : InstructionSet::OBJMEMBERSET;
        i.constant = IL::Constant(context.stackm, name);
        block->elements.push_back(i);
}

void CodeGenerator::InstructionTranslator::V_ILObjectMemberDelete(IL::ILObjectMemberDelete *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->object, block);

        std::string name(obj->membername);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, stacksize - 1);
        i.on_exception = current->on_exception;
        i.type = obj->via_this
            ? InstructionSet::OBJMEMBERDELETETHIS
            : InstructionSet::OBJMEMBERDELETE;
        i.constant = IL::Constant(context.stackm, name);
        block->elements.push_back(i);
}

void CodeGenerator::InstructionTranslator::V_ILObjectMemberInsert(IL::ILObjectMemberInsert *obj, CodeBlock *block)
{
        EmitLoad(obj, obj->object, block);
        EmitLoad(obj, obj->value, block);

        std::string name(obj->membername);
        Blex::ToUppercase(name.begin(), name.end());

        Instruction i(obj->position, --stacksize - 1);
        i.on_exception = current->on_exception;
        i.type = obj->via_this
            ? InstructionSet::OBJMEMBERINSERTTHIS
            : InstructionSet::OBJMEMBERINSERT;
        i.constant = IL::Constant(context.stackm, name);
        i.data.is_private = obj->is_private;
        block->elements.push_back(i);
}

// -----------------------------------------------------------------------------
// --
// -- Codeblock stuff
// --

std::vector< Code::Instruction >::iterator CodeGenerator::CodeBlock::EraseInstruction(std::vector< Code::Instruction >::iterator it)
{
        auto next = it + 1;

        VarPositions &target = next != elements.end() ? next->varpositions : endpositions;

        for (auto &itr: it->varpositions)
        {
                itr.position &= ~VarPosition::PostInstr;
                target.insert(target.begin(), itr);
        }

        return elements.erase(it);
}

std::ostream & Code::operator <<(std::ostream &out, VarPosition const &pos)
{
      signed masked = pos.position & VarPosition::Mask;
      if (masked & VarPosition::SignBit)
          masked -= VarPosition::SignBit + VarPosition::SignBit;

      out << "(" << pos.ssavar << " " << masked
          << ((pos.position & VarPosition::PostInstr) ? "/post" : "")
          << ((pos.position & VarPosition::PushPos) ? "/pushpos" : "")
          << ((pos.position & VarPosition::Erase) ? "/erase" : "")
          << ((pos.position & VarPosition::LocOnly) ? "/loconly" : "")
          << ")";
      return out;
}




} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
