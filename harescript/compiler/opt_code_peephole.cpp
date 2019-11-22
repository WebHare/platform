//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "opt_code_peephole.h"
#include "utilities.h"
#include "debugprints.h"

//#define SHOWPEEPHOLE


#ifdef SHOWPEEPHOLE
 #define PHPRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define PHPRINT(a)
#endif

namespace HareScript
{
namespace Compiler
{
using namespace IL;

OptCodePeephole::OptCodePeephole(CompilerContext &_context, CodeGenerator &_generator, ASTVariabeleUseAnalyzer &_useanalyzer)
: context(_context)
, generator(_generator)
, useanalyzer(_useanalyzer)
{
}

void OptCodePeephole::Execute(Module *module)
{
        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            Optimize((*it)->block);
}

bool OptCodePeephole::UsesGlobalSymbol(Code::Instruction const &instr, Symbol *symbol)
{
        if ((instr.type == InstructionSet::STOREG || instr.type == InstructionSet::LOADG || instr.type == InstructionSet::LOADGD) &&
                symbol == instr.data.var->variable->symbol)
            return true;

        switch (instr.type)
        {
        case InstructionSet::INVOKEFPTR:
        case InstructionSet::INVOKEFPTRNM:
        case InstructionSet::OBJMEMBERGET:
        case InstructionSet::OBJMEMBERGETTHIS:
        case InstructionSet::OBJMEMBERSET:
        case InstructionSet::OBJMEMBERSETTHIS:
        case InstructionSet::OBJMETHODCALL:
        case InstructionSet::OBJMETHODCALLTHIS:
        case InstructionSet::OBJMETHODCALLNM:
        case InstructionSet::OBJMETHODCALLTHISNM:
            return true;
        case InstructionSet::CALL:
            {
                    // Don't destruct if (possibly) used by a function
                    if (instr.data.function->symbol &&
                            std::binary_search(useanalyzer.data[instr.data.function->symbol].usedsymbols.begin(),
                                useanalyzer.data[instr.data.function->symbol].usedsymbols.end(), symbol))
                        return true;
            } break;
        default: ;
        }
        return false;
}

void OptCodePeephole::Optimize(BasicBlock *baseblock)
{
        std::vector<BasicBlock *> worklist;
        worklist.push_back(baseblock);
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back();
                worklist.pop_back();

                CodeGenerator::CodeBlock &code = *generator.translatedblocks[block];

                typedef std::vector<Code::Instruction>::iterator iterator;

                PHPRINT("Peephole for block " << block);

                for (iterator it = code.elements.begin(); it != code.elements.end();)
                {
                        PHPRINT(" " << *it);

                        unsigned left = std::distance(it, code.elements.end());

                        // Change loadg to loagd's when the stored value can't be used
                        if (it->type == InstructionSet::LOADG && left >= 3)
                        {
                                Symbol *symbol = it->data.var->variable->symbol;

                                iterator curr = it + 1;
                                while (curr != code.elements.end())
                                {
                                        if (UsesGlobalSymbol(*curr, symbol))
                                        {
                                                // Next access to the same global
                                                if (curr->type == InstructionSet::STOREG)
                                                {
                                                        PHPRINT(" > Modified to LOADGD");
                                                        it->type = InstructionSet::LOADGD;
                                                }
                                                break;
                                        }
                                        PHPRINT("  next: " << *curr);
                                        ++curr;
                                }
                                ++it;
                                continue;
                        }

                        // Convert STORES x / LOADS x -> COPYS x
                        if (it->type == InstructionSet::STORES && left >= 2 && (it+1)->type == InstructionSet::LOADS && it->data.var == (it+1)->data.var)
                        {
                                // Save the var
                                IL::SSAVariable *var = it->data.var;

                                // Replace the STORE with COPYS, erase the LOADS
                                it->type = InstructionSet::COPYS;
                                ++it;

                                PHPRINT(" " << *it);
                                PHPRINT(" > STORES x + LOADS x -> COPYS x");

                                it = code.EraseInstruction(it);

                                // Replace all following LOADS x to DUP
                                while (it != code.elements.end() && it->type == InstructionSet::LOADS && it->data.var == var)
                                {
                                        PHPRINT(" " << *it);
                                        PHPRINT(" > LOADS x -> DUP");

                                        it->type = InstructionSet::DUP;
                                        ++it;
                                }
                                continue;
                        }

                        // Convert LOADS x n -> LOADS, DUP x n-1
                        // Convert LOADS x n LOADSD x -> LOADSD, DUP x n

                        if (it->type == InstructionSet::LOADS && left >= 2)
                        {
                                // Save the var
                                IL::SSAVariable *var = it->data.var;

                                iterator test = it + 1;
                                for (; test != code.elements.end(); ++test)
                                {
                                        if ((test->type != InstructionSet::LOADS && it->type != InstructionSet::LOADSD) || test->data.var != var)
                                            break;
                                        it->type = test->type;
                                        test->type = InstructionSet::DUP;
                                }
                                it = test;
                        }

                        ++it;
                }

                std::copy(block->dominees.begin(), block->dominees.end(), std::back_inserter(worklist));
        }
}

} // end of namespace Compiler
} // end of namespace HareScript


//---------------------------------------------------------------------------



