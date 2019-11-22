//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

//#define SHOWDCE


#ifdef SHOWDCE
 #define DCEPRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define DCEPRINT(a)
#endif


#include "opt_il_deadcodeeliminator.h"
#include "utilities.h"

namespace HareScript
{
namespace Compiler
{
using namespace IL;

OptILDeadCodeEliminator::OptILDeadCodeEliminator(CompilerContext &_context, ILLiveAnalyzer &_livedata)
: context(_context)
, livedata(_livedata)
{
}

OptILDeadCodeEliminator::~OptILDeadCodeEliminator()
{
}

void OptILDeadCodeEliminator::Execute(Module *module)
{
        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            Optimize((*it)->block);
}

void OptILDeadCodeEliminator::Optimize(BasicBlock *baseblock)
{
        // All variables really used by instructions
        std::set< IL::SSAVariable * > real_uses;

        // All phi functions, and all used phi functions
        std::map< IL::SSAVariable *, IL::PhiFunction * > all_phis;
        std::set< IL::PhiFunction * > used_phis;

        std::vector<BasicBlock *> worklist;
        worklist.push_back(baseblock);
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back();
                worklist.pop_back();

                std::set<IL::SSAVariable *> blockuses = livedata.exitlivedata[block]; // The variables used in this block

                DCEPRINT("DCE for basic block " << *block);

                for (std::vector<ILInstruction *>::reverse_iterator it = block->instructions.rbegin(); it != block->instructions.rend();)
                {
                        std::set<IL::SSAVariable *> instrdefs;
                        (*it)->InsertDefined(&instrdefs);

                        if (!(Utilities::intersects(instrdefs.begin(),instrdefs.end(),blockuses.begin(),blockuses.end())) &&
                            !(dynamic_cast<ILConditionalJump *>(*it)) && !(dynamic_cast<ILReturn *>(*it)) && !(*it)->on_exception)
                        // If none of the defines of the instruction are used further in this block, then erase this instruction; it is not necessary
                        // Don's skip possibly throwing instructions though
                        {
                                std::vector<ILInstruction *>::iterator baseit = it.base() - 1;
                                std::vector<ILInstruction *>::iterator newit = block->instructions.erase(baseit);
                                it = std::vector<ILInstruction *>::reverse_iterator(newit);
                        }
                        else
                        // The defines (or at least one of them) are used in this block, so the uses of this instruction are added to this blocks uses
                        {
                                if ((*it)->on_exception)
                                {
                                        // Get the variables used in the exception block
                                        std::set<IL::SSAVariable *> &except_vars = livedata.entrylivedata[(*it)->on_exception];
                                        blockuses.insert(except_vars.begin(), except_vars.end());
                                }

                                (*it)->InsertUsed(&blockuses);
                                (*it)->InsertUsed(&real_uses);
                                ++it;
                        }
                }

                for (std::vector< IL::PhiFunction * >::iterator it = block->phifunctions.begin(); it != block->phifunctions.end(); ++it)
                    all_phis[ (*it)->variable ] = *it;

                std::copy(block->dominees.begin(), block->dominees.end(), std::back_inserter(worklist));
        }

        // Determina all phi functions that are actually used
        std::vector< IL::SSAVariable * > vworklist(real_uses.begin(), real_uses.end());
        while (!vworklist.empty())
        {
                IL::SSAVariable *var = vworklist.back();
                vworklist.pop_back();

                std::map< IL::SSAVariable *, IL::PhiFunction * >::iterator it = all_phis.find(var);
                if (it != all_phis.end())
                {
                        for (std::vector< std::pair< IL::AssignSSAVariable *, BasicBlock * > >::iterator it2 = it->second->params.begin(),
                                end = it->second->params.end(); it2 != end; ++it2)
                        {
                                if (real_uses.insert(it2->first).second)
                                    vworklist.push_back(it2->first);
                        }

                        used_phis.insert(it->second);
                }
        }

        // Erase all unused phi functions
        worklist.push_back(baseblock);
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back();
                worklist.pop_back();

                for (std::vector< IL::PhiFunction * >::iterator it = block->phifunctions.begin(); it != block->phifunctions.end();)
                {
                        if (used_phis.count(*it))
                            ++it;
                        else
                            it = block->phifunctions.erase(it);
                }

                std::copy(block->dominees.begin(), block->dominees.end(), std::back_inserter(worklist));
        }
}

} // end of namespace Compiler
} // end of namespace HareScript


//---------------------------------------------------------------------------


