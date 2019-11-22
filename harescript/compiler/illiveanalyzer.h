#ifndef blex_webhare_compiler_illiveanalyzer
#define blex_webhare_compiler_illiveanalyzer
//---------------------------------------------------------------------------

#include "il.h"

/** This file contains a class that builds the live data for variables */

namespace HareScript
{
namespace Compiler
{

// idea's: look at variables that are local to their basic block, and don't do anything with them!

class ILLiveAnalyzer
{
    public:
        typedef AttributeStorage<IL::BasicBlock, std::set<IL::SSAVariable *> > LiveData;
        LiveData entrylivedata;         ///< List of variables live at entry
        LiveData exitlivedata;          ///< List of variables live at entry

        void Execute(IL::Module *module);

    private: // non-functional!
        LiveData reaches;
        LiveData visibleatend;

    protected:
        void DoFunction(IL::CodedFunction *obj);

        /** Calculates for all basic blocks which variables can reach them. This data will be stored
            in reaches
            @param module Module where this must be done for */
        void CalculateReaches(IL::Module *module);

        /** Calculates for a basic block, and his dominated blocks which variables reach them
            @param obj Basic block */
        void CalculateReachesIterate(IL::BasicBlock *obj, std::set<IL::SSAVariable *> const &reach);

        /** Fills exits with all basic blocks dominated by obj that have no successors
            @param obj Basic block to start with
            @param exits Returns set of basic blocks that have no successors */
        void IterateForExits(IL::BasicBlock *obj, std::set<IL::BasicBlock *> &exits);

        /** Fills blocks with all basic blocks dominated by obj
            @param obj Basic block to start with
            @param exits Returns set of basic blocks dominated by obj
            @param visited List of blocks that don't need to be returned (when .second is true) */
        void IterateForAll(IL::BasicBlock *obj, std::set< IL::BasicBlock * > &blocks, std::map< IL::BasicBlock *, bool > const &visited);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
