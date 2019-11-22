#ifndef blex_webhare_compiler_opt_il_deadcodeeliminator
#define blex_webhare_compiler_opt_il_deadcodeeliminator
//---------------------------------------------------------------------------

#include "il.h"
#include "illiveanalyzer.h"

/** This file contains a class that handles loop invariant code motion */

namespace HareScript
{
namespace Compiler
{

class OptILDeadCodeEliminator
{
    private:
        CompilerContext &context;
        ILLiveAnalyzer &livedata;

        void Optimize(IL::BasicBlock *block);

    public:
        OptILDeadCodeEliminator(CompilerContext &context, ILLiveAnalyzer &livedata);
        ~OptILDeadCodeEliminator();

        void Execute(IL::Module *module);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
