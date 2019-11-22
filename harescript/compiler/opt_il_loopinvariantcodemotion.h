#ifndef blex_webhare_compiler_opt_il_loopinvariantcodemotion
#define blex_webhare_compiler_opt_il_loopinvariantcodemotion
//---------------------------------------------------------------------------

#include "il.h"
#include "illiveanalyzer.h"

/** This file contains a class that handles loop invariant code motion */

namespace HareScript
{
namespace Compiler
{

class OptILLoopInvariantCodeMotion
{
    private:
        CompilerContext &context;
        ILLiveAnalyzer &livedata;

        typedef std::map<IL::SSAVariable *, std::set<IL::SSAVariable *> > VarDeps;

        void GetDepthFirstBlockList(IL::BasicBlock *baseblock, std::vector<IL::BasicBlock *> &blocks);
        void Optimize(IL::BasicBlock *block, VarDeps &deps);

        // Returns wether baseblock is a postdominator or baseblock->dominator
        bool GetBlocksAtPathFromDominator(IL::BasicBlock *baseblock, std::set<IL::BasicBlock *> &blocks);
        void CalculateVariableDependencies(IL::BasicBlock *baseblock, VarDeps &deps);
        void CalculateHazards(IL::BasicBlock *dominator, std::set<IL::BasicBlock *> const &blocks, VarDeps &deps, std::set<IL::SSAVariable *> &hazards, bool ignorecontrol);
    public:
        OptILLoopInvariantCodeMotion(CompilerContext &context, ILLiveAnalyzer &livedata);

        void Execute(IL::Module *module);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
