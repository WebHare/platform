//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "opt_il_loopinvariantcodemotion.h"
#include "debugprints.h"


/** The loop invariant code motion has been disabled, because it didn't
    work too well. It did not take into account that instructions and operations
    can cause errors, which are worked around by if's.

    Example:
        FUNCTION T(RECORD A)
          FOR (INTEGER I := 0; I < I := I + 1)
            IF (CellExists(A, "B"))
              PRINT(A.B);

    This would get optimized to
        FUNCTION T(RECORD A)
          VARIANT C := A.B;
          FOR (INTEGER I := 0; I < I := I + 1)
            IF (CellExists(A, "B"))
              PRINT(C);
    And die when A didn't have a B cell...

    It really needs redesigning, that is if it can be used at all... All functions
    and lots of operators can cause this kind of errors, and I am really not sure
    if this pass will help anything. Rob.*/

// Enable for much mumbo-jumbo
//#define DEBUGPRINTS

namespace HareScript
{
namespace Compiler
{
using namespace IL;

#ifdef DEBUGPRINTS
 #define PRINT(x) CONTEXT_DEBUGPRINT(x)
#else
 #define PRINT(x)
#endif

void OptILLoopInvariantCodeMotion::GetDepthFirstBlockList(IL::BasicBlock *baseblock, std::vector<BasicBlock *> &blocks)
{
        std::deque<BasicBlock *> worklist(1, baseblock);
        blocks.clear();
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.front();
                worklist.pop_front();

                blocks.push_back(block);

                std::copy(block->dominees.begin(), block->dominees.end(), std::back_inserter(worklist));
        };
}

void OptILLoopInvariantCodeMotion::CalculateVariableDependencies(BasicBlock *baseblock, VarDeps &deps)
{
        deps.clear();

        std::vector<BasicBlock *> worklist(1, baseblock);
        std::set<SSAVariable*> defs;
        std::set<SSAVariable*> uses;

        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back();
                worklist.pop_back();

                for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
                {
                        defs.clear();
                        uses.clear();

                        (*it)->InsertDefined(&defs);
                        (*it)->InsertUsed(&uses);

                        for (std::set<SSAVariable*>::iterator it2 = defs.begin(); it2 != defs.end(); ++it2)
                        {
                                PRINT("Variable " << *it2 << " depends on " << uses);
                                deps[*it2] = uses;
                        }
                }
                for (std::vector<BasicBlock *>::iterator it = block->dominees.begin(); it != block->dominees.end(); ++it)
                    worklist.push_back(*it);
        }
}

bool OptILLoopInvariantCodeMotion::GetBlocksAtPathFromDominator(BasicBlock *baseblock, std::set<BasicBlock *> &blocks)
{
        /* This function returns in deps all the blocks that lie on all possible paths from
           the dominator of baseblock to baseblock, not counting the paths that pass through baseblock

           It works by returning the intersection of the closure of predecessors of baseblock and the
           closure of the successors of baseblock->dominator */

        std::vector<BasicBlock *> worklist;
        std::set<BasicBlock *> predecessors;

        worklist.push_back(baseblock);
        predecessors.insert(baseblock->dominator);
        predecessors.insert(baseblock);

        // Recursively find all predecessors of the baseblock (stopping at dominator, and the baseblock)
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back();
                worklist.pop_back();

                for (std::vector<BasicBlock *>::iterator it = block->predecessors.begin(); it != block->predecessors.end(); ++it)
                    if (predecessors.insert(*it).second)
                        worklist.push_back(*it);
        }

        blocks.clear();

        PRINT ("Recursive predecessors: " << predecessors);

        bool postdom = true;
        // Add all recursive successors of the dominator that recursive predecessors of the baseblock to deps
        worklist.push_back(baseblock->dominator);
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back();
                worklist.pop_back();

                if (block == baseblock)
                    continue;

                if (!blocks.insert(block).second)
                    continue;

                for (std::vector<BasicBlock *>::iterator it = block->successors.begin(); it != block->successors.end(); ++it)
                    if (predecessors.count(*it))
                        worklist.push_back(*it);
                    else
                        postdom = false;
        }

        return postdom;
}

void OptILLoopInvariantCodeMotion::CalculateHazards(BasicBlock *dominator, std::set<BasicBlock *> const &blocks, VarDeps &deps, std::set<SSAVariable *> &hazards, bool ignorecontrol)
{
        hazards.clear();
        std::set<SSAVariable *> tempworklist;
        std::set<SSAVariable *> uses;
        for (std::set<BasicBlock *>::const_iterator it = blocks.begin(); it != blocks.end(); ++it)
            if (*it != dominator)
                for (std::vector<ILInstruction *>::iterator it2 = (*it)->instructions.begin(); it2 != (*it)->instructions.end(); ++it2)
                {
                        if (dynamic_cast<ILConditionalJump *>(*it2) && !ignorecontrol)
                        {
                                (*it2)->InsertUsed(&tempworklist);
                                (*it2)->InsertUsed(&hazards);
                        }
                        else
                        {
                                uses.clear();
                                (*it2)->InsertUsed(&uses);
                                for (std::set<SSAVariable *>::iterator it3 = uses.begin(); it3 != uses.end(); ++it3)
                                    if ((*it3)->variable->storagetype == Variable::Global)
                                        hazards.insert(*it3);
                        }
                 }
            else
                for (std::vector<ILInstruction *>::iterator it2 = (*it)->instructions.begin(); it2 != (*it)->instructions.end(); ++it2)
                {
                        ILConditionalJump *jmp =dynamic_cast<ILConditionalJump *>(*it2);
                        if (jmp)
                        {
                                uses.clear();
                                jmp->InsertUsed(&uses);
                                for (std::set<SSAVariable *>::iterator it3 = uses.begin(); it3 != uses.end(); ++it3)
                                    if ((*it3)->variable->storagetype == Variable::Global)
                                        hazards.insert(*it3);
                                if (!ignorecontrol)
                                {
                                        jmp->InsertUsed(&tempworklist);
                                        jmp->InsertUsed(&hazards);
                                }
                        }
                }

        std::vector<SSAVariable *> worklist(tempworklist.begin(), tempworklist.end());
        while (!worklist.empty())
        {
                SSAVariable *var = worklist.back();
                worklist.pop_back();

                PRINT ("Hazard " << var << " depends on " << deps[var]);

                for (std::set<IL::SSAVariable *>::const_iterator it = deps[var].begin(); it != deps[var].end(); ++it)
                    if (hazards.insert(*it).second)
                        worklist.push_back(*it);
        }
}


void OptILLoopInvariantCodeMotion::Optimize(BasicBlock *baseblock, VarDeps &deps)
{
        std::vector<BasicBlock *> blocks;
        GetDepthFirstBlockList(baseblock, blocks);
        for (std::vector<BasicBlock *>::reverse_iterator blockit = blocks.rbegin(); blockit != blocks.rend(); ++blockit)
        {
                BasicBlock *block = *blockit;

                if (block->dominator)
                {
                        PRINT("Optimizing " << *block << " dominated by " << block->dominator);
                }
                else
                {
                        PRINT("Optimizing " << *block);
                }

                if (!block->dominator || block->dominator->frequency > block->frequency)
                    continue;

                // Figure out which variables are candidates for moving
                std::set<IL::SSAVariable *> tempexitlivedata = livedata.exitlivedata[block->dominator];

                std::vector<ILInstruction *> candidates;
                std::set<SSAVariable*> uses;
                for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
                {
                        // No motion of conditional jumps or returns!
                        ILConditionalJump *jmp = dynamic_cast<ILConditionalJump *>(*it);
                        if (jmp)
                            continue;

                        ILReturn *ret = dynamic_cast<ILReturn *>(*it);
                        if (ret)
                            continue;

                        // Motion is possible when the dominator has all the used variables live at exit
                        uses.clear();
                        (*it)->InsertUsed(&uses);
                        if (std::includes(tempexitlivedata.begin(), tempexitlivedata.end(), uses.begin(), uses.end()))
                        {
                                candidates.push_back(*it);
                                (*it)->InsertDefined(&tempexitlivedata);
                        }
                }

                if (candidates.empty())
                    continue;

                // Get better data over what can and what can't be moved
                std::set<BasicBlock *> pathblocks;
                std::set<SSAVariable *> hazards;

                bool pdom = GetBlocksAtPathFromDominator(block, pathblocks);
                if (pdom) { PRINT("Postdominates dominator"); } else { PRINT("Does NOT postdominate dominator"); }
                if (!pdom)
                    continue;

                CalculateHazards(block->dominator, pathblocks, deps, hazards, pdom);

                std::set<Variable *> globalhazards;
                for (std::set<SSAVariable *>::iterator it = hazards.begin(); it != hazards.end(); ++it)
                    if ((*it)->variable->storagetype == Variable::Global)
                        globalhazards.insert((*it)->variable);

                PRINT("Hazards: " << hazards);

                std::set<Variable *> gdefs;

                std::set<IL::SSAVariable *> &exitlivedata = livedata.exitlivedata[block->dominator];
                for (std::vector<ILInstruction *>::iterator it = candidates.begin(); it != candidates.end(); ++it)
                {
                        uses.clear();
                        gdefs.clear();

// FIXME: Disabled because this interface needed to go. Replace with equivalent code
//                        (*it)->InsertUsed(&uses);
//                        (*it)->InsertDefinedGlobals(&gdefs);

                        PRINT("Considering " << **it);
                        PRINT("dominator exitlivedata: " << exitlivedata);
                        PRINT("uses: " << uses);
                        PRINT("gdefs: " << gdefs);

                        if (std::includes(exitlivedata.begin(), exitlivedata.end(), uses.begin(), uses.end()) &&
                                !Utilities::intersects(hazards.begin(), hazards.end(), uses.begin(), uses.end())&&
                                !Utilities::intersects(globalhazards.begin(), globalhazards.end(), gdefs.begin(), gdefs.end()))
                        {
                                PRINT("moved");
                                ILConditionalJump *jmp(0);
                                if (!block->dominator->instructions.empty()) jmp = dynamic_cast<ILConditionalJump *>(block->dominator->instructions.back());
                                if (jmp) block->dominator->instructions.pop_back();

                                block->dominator->instructions.push_back(*it);
                                block->instructions.erase(std::find(block->instructions.begin(), block->instructions.end(), *it));

                                if (jmp) block->dominator->instructions.push_back(jmp);

                                (*it)->InsertDefined(&exitlivedata);
                        }
                        else
                        {
                                PRINT("not moved");
                        }
                }
        }
}

OptILLoopInvariantCodeMotion::OptILLoopInvariantCodeMotion(CompilerContext &_context, ILLiveAnalyzer &_livedata)
: context(_context)
, livedata (_livedata)
{
}

void OptILLoopInvariantCodeMotion::Execute(Module *module)
{
        VarDeps deps;
        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
        {
                CalculateVariableDependencies((*it)->block, deps);
                Optimize((*it)->block, deps);
        }
        livedata.Execute(module);
}


} // end of namespace Compiler
} // end of namespace HareScript


//---------------------------------------------------------------------------
