//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "il.h"
#include "illiveanalyzer.h"
#include "utilities.h"
#include "debugprints.h"

//#define SHOWLIVEANALYSING


#ifdef SHOWLIVEANALYSING
 #define LAPRINT(a) DEBUGPRINT(a)
 #define LAONLY(a) DEBUGONLY(a)
#else
 #define LAPRINT(a)
 #define LAONLY(a)
#endif


namespace HareScript
{
namespace Compiler
{
using namespace IL;

namespace
{

std::vector<IL::SSAVariable *> GetUses(IL::BasicBlock *block)
{
        std::vector<IL::SSAVariable *> uses;

        /* Reverse iterate over all instructions, because the first used version of a variable is the one we need
           (an assignment in the middle of the block after that use can create a new version, which (if used) would
           hide the first version if not reverse iterating ) */
        for (std::vector<ILInstruction *>::reverse_iterator it = block->instructions.rbegin(); it != block->instructions.rend(); ++it)
            (*it)->AppendUsed(&uses);

        std::sort(uses.begin(), uses.end());

        return uses;
}

std::set<IL::SSAVariable *> GetPhiUses(IL::BasicBlock *block, IL::BasicBlock *from)
{
        std::set<IL::SSAVariable *> uses;

        for (std::vector<PhiFunction *>::reverse_iterator it = block->phifunctions.rbegin(); it != block->phifunctions.rend(); ++it)
            for (std::vector<std::pair<AssignSSAVariable *, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
            {
                if (it2->second == from)
                    uses.insert(it2->first);
            }

        return uses;
}

std::vector<IL::SSAVariable *> GetDefinitions(IL::BasicBlock *block)
{
        std::vector<IL::SSAVariable *> defs;

        for (std::vector<ILInstruction *>::reverse_iterator it = block->instructions.rbegin(); it != block->instructions.rend(); ++it)
            (*it)->AppendDefined(&defs);

        std::sort(defs.begin(), defs.end());

        return defs;
}

std::set<IL::SSAVariable *> GetPhiDefinitions(IL::BasicBlock *block)
{
        std::set<IL::SSAVariable *> defs;

        for (std::vector<PhiFunction *>::reverse_iterator it = block->phifunctions.rbegin(); it != block->phifunctions.rend(); ++it)
            defs.insert((*it)->variable);

        return defs;
}

} //end anonymous namespace

void ILLiveAnalyzer::Execute(IL::Module *module)
{
        entrylivedata.Clear();
        exitlivedata.Clear();
//        reaches.Clear();
//        visibleatend.Clear();
        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            DoFunction(*it);
//        CalculateReaches(module);
}

void ILLiveAnalyzer::IterateForExits(BasicBlock *obj, std::set<BasicBlock *> &exits)
{
        if (obj->successors.empty())
            exits.insert(obj);
        else
            for (std::vector<BasicBlock *>::iterator it = obj->dominees.begin(); it != obj->dominees.end(); ++it)
                IterateForExits(*it, exits);
}

void ILLiveAnalyzer::IterateForAll(BasicBlock *obj, std::set<BasicBlock *> &blocks, std::map<BasicBlock *, bool> const &visited)
{
        std::map<BasicBlock *, bool>::const_iterator it = visited.find(obj);
        if (it == visited.end() || !it->second)
            blocks.insert(obj);

        for (std::vector<BasicBlock *>::iterator it = obj->dominees.begin(); it != obj->dominees.end(); ++it)
            IterateForAll(*it, blocks, visited);
}

void ILLiveAnalyzer::DoFunction(IL::CodedFunction *obj)
{
        // first, we want to know all the exits of the function (blocks with no successors)
        std::map<BasicBlock *, bool> visited;   // We need this to at least visit each block once
        std::set<BasicBlock *> worklist;

        LAPRINT("Live analyzing for function " << obj->symbol->name);

        // Get all exits
        IterateForExits(obj->block, worklist);

        LAPRINT("Inital list:");
        for (std::set<BasicBlock *>::iterator it = worklist.begin(); it != worklist.end(); ++it)
             LAPRINT(" " << *it);

        bool firstpass = true;
        while (true)
        {
                /* The list of live variables at the end of a predecessor is the list of live variables
                   at the end of your own block, plus all variables you have used yourself,
                   minus all variables you have defined yourself. */
                if (worklist.empty() && firstpass)
                {
                        // First pass is done: now go over all blocks to catch never-ending loops
                        IterateForAll(obj->block, worklist, visited);
                        firstpass = false;

                        LAPRINT("Second pass list:");
                        for (std::set<BasicBlock *>::iterator it = worklist.begin(); it != worklist.end(); ++it)
                             LAPRINT(" " << *it);

                }
                if (worklist.empty())
                    break;

                BasicBlock *current = *worklist.begin();
                worklist.erase(worklist.begin());

                /** Get data about uses and defs */
                std::vector<IL::SSAVariable *> uses ( GetUses(current) );
                std::vector<IL::SSAVariable *> defs ( GetDefinitions(current) );

                LAPRINT("Basicblock " << current << ", successors : " << current->successors);
                LAPRINT("uses "<<uses);
                LAPRINT("defs "<<defs);

                /** Calculate set of variables that are live on exit. */
                std::set<IL::SSAVariable *> live_in;
                for (std::vector<BasicBlock *>::iterator it = current->successors.begin(); it != current->successors.end(); ++it)
                {
                        /** The set of variables live from a successor is the entrylivedata (that is, the live data
                            AFTER the phi-functions) plus the phi parameters that come from this block, minus
                            the phi-variables defined in the successor */
                        std::set<IL::SSAVariable *> block_live_in = GetPhiUses(*it, current);
                        std::set<IL::SSAVariable *> block_phi_defs = GetPhiDefinitions(*it);

                        LAPRINT("block_phi_uses       " << *it << ": " << block_live_in);
                        LAPRINT("block_phi_defs       " << *it << ": " << block_phi_defs);
                        LAPRINT("entrylive            " << *it << ": " << entrylivedata[*it]);

                        block_live_in.insert( entrylivedata[*it].begin(), entrylivedata[*it].end() );
                        LAPRINT("block_live_in+phiuse " << *it << ": " << block_live_in);

                        std::set_difference(block_live_in.begin(), block_live_in.end(),
                                            block_phi_defs.begin(), block_phi_defs.end(),
                                            std::inserter(live_in, live_in.begin() ));
                }

                LAPRINT("live_exit of successors "<<live_in);

                for (std::vector<ILInstruction *>::iterator it = current->instructions.begin(); it != current->instructions.end(); ++it)
                {
                        if ((*it)->on_exception)
                        {
                                // Exception blocks don't have phi functions
                                std::set<IL::SSAVariable *> &exception_live = entrylivedata[(*it)->on_exception];

                                std::set_difference(exception_live.begin(), exception_live.end(),
                                                    defs.begin(), defs.end(),
                                                    std::inserter(live_in, live_in.begin() ));
                        }
                }
                LAPRINT("+live_exit of throws "<<live_in);


/*                for (std::vector<BasicBlock *>::iterator it = current->throwcatchers.begin(); it != current->throwcatchers.end(); ++it)
                {
                        // The set of variables live from a successor is the entrylivedata (that is, the live data
                        //    AFTER the phi-functions) plus the phi parameters that come from this block, minus
                        //    the phi-variables defined in the successor * /
                        std::set<IL::SSAVariable *> block_live_in = GetPhiUses(*it, current);
                        std::set<IL::SSAVariable *> block_phi_defs = GetPhiDefinitions(*it);
                        block_live_in.insert( entrylivedata[*it].begin(), entrylivedata[*it].end() );
                        std::set_difference(block_live_in.begin(), block_live_in.end(),
                                            block_phi_defs.begin(), block_phi_defs.end(),
                                            std::inserter(live_in, live_in.begin() ));
                }*/
                exitlivedata[current] = live_in;

                LAPRINT("Exitlivedata: " <<live_in);

                /** Add all variables used in this block, then kill all variables defined in this block
                   (all except the phi-functions! */
                std::set<IL::SSAVariable *> live_entry;
                live_in.insert( uses.begin(), uses.end() );
                std::set_difference(live_in.begin(), live_in.end(),
                        defs.begin(), defs.end(),
                        Utilities::associative_inserter(live_entry));
                // We now have the updated live data (of AFTER the phi-functions) in live_entry.

                LAPRINT("live_entry = live_exit + uses - defs: " <<live_entry);

                // Only iterate if necessary (that is, the entrylivedata is already correct, or this is the first time we visit this block
                if (entrylivedata[current] != live_entry || !visited[current])
                {
                        worklist.insert( current->predecessors.begin(), current->predecessors.end() );
                        entrylivedata[current] = live_entry;
                }
                visited[current] = true;
        }
}

void ILLiveAnalyzer::CalculateReachesIterate(IL::BasicBlock *obj, std::set<IL::SSAVariable *> const &reach)
{
        LAPRINT("CRI " << obj << " input: " << reach);

        /** Add the parameters of all the phi-functions to the set of variables that reach us -> they
            are obviously reachable here too! */
        std::set<IL::SSAVariable *> newreach = reach;
        for (std::vector<PhiFunction *>::iterator it = obj->phifunctions.begin(); it != obj->phifunctions.end(); ++it)
        {
                if ((*it)->variable->variable->storagetype != Variable::Global)
                    std::transform((*it)->params.begin(), (*it)->params.end(), Utilities::associative_inserter(newreach),
                            Utilities::pair_first<AssignSSAVariable *, BasicBlock *>());
                else
                    for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                        newreach.erase(it2->first);
        }

        LAPRINT("CRI " << obj << " -phi: " << newreach);

        /** Store */
        reaches[obj] = newreach;

        std::set<IL::SSAVariable *> newvars;

        /** Add all the defined variables (phi and normal) */
        for (std::vector<PhiFunction *>::iterator it = obj->phifunctions.begin(); it != obj->phifunctions.end(); ++it)
            newvars.insert((*it)->variable);
        for (std::vector<ILInstruction *>::iterator it = obj->instructions.begin(); it != obj->instructions.end(); ++it)
            (*it)->InsertDefined(&newvars);

        newreach.insert(newvars.begin(), newvars.end());

        LAPRINT("CRI " << obj << " +phi&def: " << newreach);

        /** Remove all redefined global variables */
        for (std::set<IL::SSAVariable *>::iterator it = newvars.begin(); it != newvars.end(); ++it)
        {
                if ((*it)->variable->storagetype == Variable::Global)
                    for (std::set<IL::SSAVariable *>::iterator it2 = newreach.begin(); it2 != newreach.end();)
                    {
                        if ((*it2)->variable == (*it)->variable && *it != *it2)
                            newreach.erase(it2++);
                        else
                            ++it2;
                    }
        }

        LAPRINT("CRI " << obj << " -dupglobals: " << newreach);

        visibleatend[obj] = newreach;

        /** Iterate over all the dominated children */
        for (std::vector<BasicBlock *>::iterator it = obj->dominees.begin(); it != obj->dominees.end(); ++it)
             CalculateReachesIterate(*it, newreach);
}

void ILLiveAnalyzer::CalculateReaches(IL::Module *module)
{
        // Build a definition list with all parameters, and all possibly global variables

        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            CalculateReachesIterate((*it)->block, entrylivedata[(*it)->block]);
}

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------

