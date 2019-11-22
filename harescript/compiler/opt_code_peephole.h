#ifndef blex_webhare_compiler_opt_code_peephole
#define blex_webhare_compiler_opt_code_peephole
//---------------------------------------------------------------------------

#include "il.h"
#include "illiveanalyzer.h"
#include "codegenerator.h"
#include "astvariableuseanalyzer.h"

/** This file contains a class that handles loop invariant code motion */

namespace HareScript
{
namespace Compiler
{

class OptCodePeephole
{
    private:
        CompilerContext &context;
        CodeGenerator &generator;
        ASTVariabeleUseAnalyzer &useanalyzer;

        void Optimize(IL::BasicBlock *block);
        bool UsesGlobalSymbol(Code::Instruction const &instr, Symbol *symbol);

    public:
        OptCodePeephole(CompilerContext &context, CodeGenerator &generator, ASTVariabeleUseAnalyzer &useanalyzer);

        void Execute(IL::Module *module);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
