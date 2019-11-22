#ifndef blex_webhare_compiler_opt_blockmerger
#define blex_webhare_compiler_opt_blockmerger
//---------------------------------------------------------------------------

#include "il.h"

namespace HareScript
{
namespace Compiler
{


class Opt_BlockMerger
{
    public:
        Opt_BlockMerger(CompilerContext &context) : context(context) {}

        void Execute (IL::Module* module);

    private:
        CompilerContext &context;

        void ExecuteFunction (IL::CodedFunction* function);
        void MergeBlocks (IL::CodedFunction* func, IL::BasicBlock *block1, IL::BasicBlock *block2);
        void CheckStructure(IL::BasicBlock *block);

        /** Removes double link from pred to its successor */
        void RemoveSuperflousLink(IL::BasicBlock *pre);
};

} // end of namespace HareScript
} // end of namespace Compiler

//---------------------------------------------------------------------------
#endif
