//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "il_dot_printer.h"

#include "opt_blockmerger.h"
#include "debugprints.h"

//#define BM_PRINTS
#define BM_STRONG_CHECKS


#ifdef BM_PRINTS
 #define BMPRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define BMPRINT(a)
#endif

#ifdef BM_STRONG_CHECKS
 #define BMSC_PRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define BMSC_PRINT(a)
#endif



namespace HareScript
{
namespace Compiler
{
using namespace IL;

#if defined(DEBUG) && defined(BM_STRONG_CHECKS)
void Opt_BlockMerger::CheckStructure(BasicBlock *block)
{
        // Find the start block
        while (block->dominator)
            block = block->dominator;

        BasicBlock *top_block = block;

        std::map< BasicBlock *, BasicBlock * > dominators;
        dominators[top_block] = 0;

        std::list< BasicBlock * > worklist;
        worklist.push_back(top_block);
        while (!worklist.empty())
        {
                block = worklist.front();
                worklist.pop_front();

                for (std::vector<BasicBlock *>::iterator it = block->dominees.begin(); it != block->dominees.end(); ++it)
                {
                        std::map< BasicBlock *, BasicBlock * >::iterator it2 = dominators.find(*it);
                        if (it2 != dominators.end())
                        {
                                BMSC_PRINT("Block " << *it << " is dominated twice, by " << block << " and " << it2->second);
                                assert(false);
                        }
                        else
                            dominators.insert(std::make_pair(*it, block));
                        worklist.push_back(*it);
                        if ((*it)->dominator != block)
                        {
                                BMSC_PRINT("Block " << *it << " has wrong dominator, got " << (*it)->dominator << ", watned " << block);
                                assert(false);
                        }
                }
        }

        std::map< BasicBlock *, std::vector< BasicBlock * > > preds;
        std::set< BasicBlock * > visited;
        preds[top_block];

        worklist.push_back(top_block);
        while (!worklist.empty())
        {
                block = worklist.front();
                worklist.pop_front();

                if (visited.count(block))
                    continue;
                visited.insert(block);

                for (std::vector<BasicBlock *>::iterator it = block->successors.begin(); it != block->successors.end(); ++it)
                {
                        if (!dominators.count(*it))
                        {
                                BMSC_PRINT("Block " << *it << " lies outside the dominator tree, successor of " << block);
                                assert(false);
                        }
                        preds[*it].push_back(block);
                        worklist.push_back(*it);
                }

                for (std::vector<BasicBlock *>::iterator it = block->throwcatchers.begin(); it != block->throwcatchers.end(); ++it)
                {
                        if (!dominators.count(*it))
                        {
                                BMSC_PRINT("Block " << *it << " lies outside the dominator tree, successor of " << block);
                                assert(false);
                        }
                        preds[*it].push_back(block);
                        worklist.push_back(*it);
                }
        }

        for (std::map< BasicBlock *, std::vector< BasicBlock * > >::iterator it = preds.begin(); it != preds.end(); ++it)
        {
                std::vector< BasicBlock * > a = it->second;
                std::sort(a.begin(), a.end());

                std::vector< BasicBlock * > b = it->first->predecessors;
                std::sort(b.begin(), b.end());

                if (a != b)
                {
                        BMSC_PRINT("Block " << *it << " has inconsistent succ/throw/pred relations, wanted " << a << ", got " << b);

                        BMSC_PRINT(*it->first);
                        assert(false);
                }
        }

//        std::cout << "Dominator relations:" << std::endl << dominators << std::endl;
//        std::cout << "Predecessor relations:" << std::endl << preds << std::endl;

        for (std::map< BasicBlock *, BasicBlock * >::iterator it = dominators.begin(); it != dominators.end(); ++it)
        {
                if (it->second && !preds.count(it->first))
                {
                        BMSC_PRINT("Block " << it->first << " has a dominator, but no predecessors");
                        BMSC_PRINT(*it->first);
                        BMSC_PRINT(preds[it->first]);
                        assert(false);
                }
        }
}
#else
void Opt_BlockMerger::CheckStructure(BasicBlock *)
{
}
#endif


void Opt_BlockMerger::MergeBlocks (IL::CodedFunction* func, BasicBlock *block1, BasicBlock *block2)
{
        // PRE: (all links from block 1 point to block2), and ((all links to block2 point to block1) or (block1 is empty))

#if defined(DEBUG) && defined(BM_PRINTS)
        BMPRINT("****************************");
        BMPRINT("Merging " << *block1 << std::endl << "to " << *block2);

        BMPRINT("Merging " << *block1 << std::endl << "to " << *block2);
#endif

        // precondition: All links from block 1 point to block2
        assert(std::find_if(block1->successors.begin(), block1->successors.end(), std::bind(std::not_equal_to<BasicBlock *>(), block2, std::placeholders::_1)) == block1->successors.end());

        // If the last element of block1 is a conditional jump, remove it; the need for it is completely eliminated after the merge
        if (!block1->instructions.empty() && dynamic_cast<IL::ILConditionalJump *>(block1->instructions.back()))
        {
                block1->instructions.pop_back();
        }

        // Copy all instructions from block1 in front of block2
        block2->instructions.insert( block2->instructions.begin(), block1->instructions.begin(), block1->instructions.end() );

        // Remove predecessor references to block1 from block2
        block2->predecessors.erase(std::remove(block2->predecessors.begin(), block2->predecessors.end(), block1), block2->predecessors.end());

        // precondition: All links to block 2 come from 1 OR block 1 is empty
        assert(block2->predecessors.empty() || block1->instructions.empty());

        // Store if this is a simple concatenation
#ifdef DEBUG
        bool concatenation = block2->predecessors.empty();
#endif

        // Add predecessors to block2
        std::copy(block1->predecessors.begin(), block1->predecessors.end(), std::back_inserter(block2->predecessors));

        // Move throwcatchers to block2
        for (std::vector<BasicBlock *>::iterator it = block1->throwcatchers.begin(); it != block1->throwcatchers.end(); ++it)
        {
                block2->throwcatchers.push_back(*it);

                // Replace predecessor for exception block, also in phi functions
                std::replace((*it)->predecessors.begin(), (*it)->predecessors.end(), block1, block2);

                for (std::vector<PhiFunction *>::iterator it2 = (*it)->phifunctions.begin(); it2 != (*it)->phifunctions.end(); ++it2)
                    for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::iterator it3 = (*it2)->params.begin(); it3 != (*it2)->params.end(); ++it3)
                        if (it3->second == block1)
                            it3->second = block2;
        }

        // Let all predecessors point to block2 instead of block1
        for (std::vector<BasicBlock *>::iterator it = block1->predecessors.begin(); it != block1->predecessors.end(); ++it)
        {
                std::replace((*it)->successors.begin(), (*it)->successors.end(), block1, block2);

                // exception targets are never merged, so no need to update the throwcatchers or on_exception stuff.
        }

        // Unify the phi functions
        // A phi-function exists: replace variable created in block1 phi-function by parameters, IF it exists as parameter
        // No phi-function exists: copy block1 phi function to block2, but only when block1 is the only predecessor of block2
        for (std::vector<PhiFunction *>::iterator it = block1->phifunctions.begin(); it != block1->phifunctions.end(); ++it)
        {
                bool done = false;
                for (std::vector<PhiFunction *>::iterator it2 = block2->phifunctions.begin(); it2 != block2->phifunctions.end(); ++it2)
                {
                        if ((*it)->variable->variable == (*it2)->variable->variable)
                        {
                                done = true;
                                for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::iterator it3 = (*it2)->params.begin(); it3 != (*it2)->params.end(); ++it3)
                                {
                                        if (it3->first == (*it)->variable)
                                        {
                                                (*it2)->params.erase(it3);
                                                std::copy((*it)->params.begin(), (*it)->params.end(), std::back_inserter((*it2)->params));
                                                break;
                                        }
                                }
                        }
                }

                if (!done)
                {
#ifdef DEBUG
                        /** This MUST be a concatenation; we cannot find out the variable versions that come
                            from another predecessor */
                        assert(concatenation);
#endif
                        block2->phifunctions.push_back(*it);
                }
        }

        // Redirect all phi parameters pointing from a phi-function in block2 to the predecessors of block1, if not replaced yet
        for (std::vector<PhiFunction *>::iterator it = block2->phifunctions.begin(); it != block2->phifunctions.end(); ++it)
        {
                for (std::vector<std::pair<AssignSSAVariable *, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end();)
                    if (it2->second == block1)
                    {
                            // this is the only one; replace this entry with entries to all the predecessors of block1.
                            unsigned it2dist = std::distance((*it)->params.begin(), it2);

                            AssignSSAVariable *ssavar = it2->first;
                            (*it)->params.erase(it2);

                            for (std::vector<BasicBlock *>::iterator it3 = block1->predecessors.begin(); it3 != block1->predecessors.end(); ++it3)
                                (*it)->params.push_back(std::make_pair(ssavar, *it3));

                            it2 = (*it)->params.begin() + it2dist;
                    }
                    else
                        ++it2;
        }

        // Update the dominator tree.

        // block1 will be removed, so remove it from the dominees list of its dominator.
        if (block1->dominator)
        {
#if defined(DEBUG) && defined(BM_PRINTS)
                BMPRINT("Dominator of from");
                BMPRINT(*block1->dominator);
#endif

                std::vector<BasicBlock *>::iterator it =
                        std::find(block1->dominator->dominees.begin(), block1->dominator->dominees.end(), block1);

                assert(it != block1->dominator->dominees.end());

                block1->dominator->dominees.erase(it);

        }

        // If block1 was the dominator of block2, the dominator of block1 is now the dominator of block2.
        if (block2->dominator == block1)
        {
                if (block1->dominator)
                    block1->dominator->dominees.push_back(block2);
                block2->dominator = block1->dominator;
        }
        /*else:    All links from block1 flow to block2, so the only block that block1 can dominate is block2.
                   But block2 isn't dominated by block1, so the strict dominator of block2 must already be in the list of dominators of block1. Thus, no action neccesary */

        // Add all other blocks dominated by block1 to block2
        for (std::vector<BasicBlock *>::iterator it = block1->dominees.begin(); it != block1->dominees.end(); ++it)
            if (*it != block2)
            {
                    block2->dominees.push_back(*it);
                    (*it)->dominator = block2;
            }

        // If this was the entry block, replace the entry block
        if (block1 == func->block)
            func->block = block2;

#ifdef DEBUG
        // invariant: all params from the phifunction come from the successors
        for (std::vector<PhiFunction *>::iterator it = block2->phifunctions.begin(); it != block2->phifunctions.end(); ++it)
            for (std::vector<std::pair<AssignSSAVariable *, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                if (std::find(block2->predecessors.begin(), block2->predecessors.end(), it2->second) == block2->predecessors.end())
                {
                        DEBUGPRINT("Error: phi-parameter " << it2->first <<  " comes from a block that is not a predecessor (" << it2->second << ")");
                        DEBUGPRINT("Valid predecessors: " << block2->predecessors);
                        assert(false);
                }
#endif

#if defined(DEBUG) && defined(BM_PRINTS)
        BMPRINT("Result: " << *block2);
        BMPRINT("Predecessors: ");
        for (std::vector<BasicBlock *>::iterator it = block2->predecessors.begin(); it !=  block2->predecessors.end(); ++it)
            BMPRINT(**it);
#endif

#if defined(DEBUG) && defined(BM_STRONG_CHECKS)
        CheckStructure(block2);
#endif
}

void Opt_BlockMerger::RemoveSuperflousLink(IL::BasicBlock *pre)
{
        assert(pre->successors.size() == 2 && pre->successors[0] == pre->successors[1]);
        assert(!pre->instructions.empty() && dynamic_cast<IL::ILConditionalJump *>(pre->instructions.back()));

        IL::BasicBlock *succ = pre->successors[0];

        // Kill conditional jump
        pre->instructions.pop_back();

        // Kill a link
        pre->successors.pop_back();
        succ->predecessors.erase(std::find(succ->predecessors.begin(), succ->predecessors.end(), pre));

        // Update phi-functions
        for (std::vector<PhiFunction *>::iterator it = succ->phifunctions.begin(); it != succ->phifunctions.end(); ++it)
            for (std::vector<std::pair<AssignSSAVariable *, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                if (it2->second == pre)
                {
                        (*it)->params.erase(it2);
                        break;
                }
                else
                    ++it2;
}

Module *moduleX;
void Opt_BlockMerger::Execute (Module* module)
{
        moduleX = module;
        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            ExecuteFunction(*it);
}

void Opt_BlockMerger::ExecuteFunction (IL::CodedFunction* function)
{
        std::vector<BasicBlock *> remainingblocks;
        std::set<BasicBlock *> visitedblocks;
        std::vector<BasicBlock *> todolist;
        todolist.push_back(function->block);

        while (!todolist.empty())
        {
                BasicBlock *current = todolist.back();
                todolist.erase(todolist.end() - 1);
                if (visitedblocks.count(current) == 1)
                    continue; //aready did this block

                visitedblocks.insert(current);
                todolist.insert(todolist.end(), current->successors.begin(), current->successors.end());
                todolist.insert(todolist.end(), current->throwcatchers.begin(), current->throwcatchers.end());

                /* Test if blocks are mergable. Mergable blocks have only one
                   successor (that may not be the same block). The initial function
                   block also may not be merged, and no block may be merged with
                   the initial block.
                   A block may not be merged with it's successor if it is not the
                   only predecessor (except when it's empty, so no instructions
                   or phi-functions). Also, an exception target may not be merged to its successor.
                    */
                if (current->successors.size() == 1
                        && current->successors.front() != current
                        && current != function->block
                        && current->successors.front() != function->block
                        && !current->is_exception_target
                        && ( (current->successors.front()->predecessors.size() == 1)
                            || (current->instructions.empty() && current->phifunctions.empty())))
/* Old uncommented code that worked before
                if ( (current->instructions.empty()
                      && current->phifunctions.empty()
                      && (current->successors.empty() || current->successors.front() != current)
                      && current != function->block)
                   || (current->successors.size() == 1
                       && current->successors.front()->predecessors.size() == 1)
                       && current->successors.front() != function->block) */
                {
                        BasicBlock *succ = current->successors.front();
                        MergeBlocks(function, current, succ);

                        /* ADDME: Disabled deep printer
                        ILDotPrinter printer;
                        printer.PrintStructure(moduleX, "z:/1/compiler/test.dot", ILDotPrinter::IntermediateLanguage, ILDotPrinter::Normal);
                        */

                }
                else
                {
                        remainingblocks.push_back(current);
                }
        }

        // Sort for quick access to find nodes
        std::sort(remainingblocks.begin(), remainingblocks.end());

        // Kill unneeded conditionals, and dead predecessors
        for (std::vector<BasicBlock *>::iterator it = remainingblocks.begin(); it != remainingblocks.end(); ++it)
        {
                BasicBlock *current = *it;

                // All outgoing edges point to thesame node: kill conditional jump
                if ((current->successors.size() == 2) && (current->successors.front() == current->successors.back()))
                {
                        RemoveSuperflousLink(current);

                        BasicBlock *succ = current->successors.front();
                        if (succ->predecessors.size() == 1 && current != succ)
                            MergeBlocks(function, current, succ);         // Merge blocks
                }

                // Kill all non-remaining nodes from predecessors of remaining nodes
                for (std::vector<BasicBlock *>::iterator it2 = current->predecessors.begin(); it2 != current->predecessors.end();)
                {
                        if (!std::binary_search(remainingblocks.begin(), remainingblocks.end(), *it2))
                            it2 = current->predecessors.erase(it2);
                        else
                            ++it2;
                }
        }
}

} // end of namespace HareScript
} // end of namespace Compiler
