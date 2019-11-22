//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "debugprints.h"
#include "codeblocklinker.h"
#include "codedebuginfobuilder.h"

namespace HareScript
{
namespace Compiler
{
using namespace Code;

CodeBlockLinker::CodeBlockLinker(CompilerContext &context, CodeDebugInfoBuilder *_debuginfobuilder)
: context(context)
, debuginfobuilder(_debuginfobuilder)
{
}

CodeBlockLinker::~CodeBlockLinker()
{
}

Code::Instruction CodeBlockLinker::GetLOADSD(LineColumn position, IL::SSAVariable *var, signed lowstacksize)
{
        Code::Instruction i(position, -1);
        i.type = InstructionSet::LOADSD;
        i.data.var = var;
        i.varpositions.push_back(VarPosition(var, lowstacksize, VarPosition::PushPos | VarPosition::PostInstr));
        return i;
}

Code::Instruction CodeBlockLinker::GetSTORES(LineColumn position, IL::SSAVariable *var, signed lowstacksize)
{
        Code::Instruction i(position, lowstacksize);
        i.type = InstructionSet::STORES;
        i.data.var = var;
        return i;
}

Code::Instruction CodeBlockLinker::GetJUMPC2F(LineColumn position, signed lowstacksize)
{
        Code::Instruction i(position, lowstacksize);
        i.type = InstructionSet::JUMPC2F;
        return i;
}
Code::Instruction CodeBlockLinker::GetJUMP(LineColumn position)
{
        Code::Instruction i(position, -1);
        i.type = InstructionSet::JUMP;
        return i;
}

IL::BasicBlock* CodeBlockLinker::SpliceLink(IL::BasicBlock *from, IL::BasicBlock *to)
{
        IL::BasicBlock* newblock = Adopt(new IL::BasicBlock(to->position));

        // Set predecessors and successors to new values
        newblock->successors.push_back(to);
        newblock->predecessors.push_back(from);
        std::replace(from->successors.begin(), from->successors.end(), to, newblock);
        std::replace(to->predecessors.begin(), to->predecessors.end(), from, newblock);

        // Set dominator relations to what they should be
        newblock->dominator = from;    // from dominates newblock
        if (to->dominator == from)
        {
                std::replace(from->dominees.begin(), from->dominees.end(), to, newblock);
                newblock->dominees.push_back(to);
                to->dominator = newblock;
        }
        else
            from->dominees.push_back(newblock);

        CodeGenerator::CodeBlock *codeblock = Adopt(new CodeGenerator::CodeBlock);
        generator->translatedblocks[newblock] = codeblock;

        return newblock;
}

void CodeBlockLinker::Execute(IL::Module *module, CodeGenerator *_generator, CodeRegisterAllocator *_allocator)
{
        generator = _generator;
        allocator = _allocator;

        std::vector<IL::BasicBlock *> worklist;
        for (std::vector<IL::CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            worklist.push_back((*it)->block);
        while (!worklist.empty())
        {
                // Visit all blocks; depth first in dominator tree
                IL::BasicBlock *block = worklist.back();
                worklist.pop_back();
                worklist.insert(worklist.end(), block->dominees.begin(), block->dominees.end());

                CodeGenerator::CodeBlock *code = generator->translatedblocks[block];

                // Erase all phi functions for global variables and stack variables with all the same location
                for (std::vector<IL::PhiFunction *>::iterator it = block->phifunctions.begin(); it != block->phifunctions.end();)
                {
//                        DEBUGPRINT((*it)->variable<< " " << (*it)->params);
                        bool remove = (*it)->variable->variable->storagetype == IL::Variable::Global;
                        if (!remove)
                        {
                                signed location = allocator->local_variable_positions[(*it)->variable];
                                bool all_thesame = true;
                                for (std::vector<std::pair<IL::AssignSSAVariable *, IL::BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end();++it2)
                                    all_thesame = all_thesame && allocator->local_variable_positions[it2->first] == location;
                                remove = all_thesame;
                        }
//                        DEBUGPRINT(allocator->local_variable_positions);
//                        DEBUGPRINT((*it)->variable << ": " << (*it)->params);
//                        DEBUGPRINT((remove?"MOVE!":"STAY!"));
                        if (remove)
                            it = block->phifunctions.erase(it);
                        else
                            ++it;
                }

                // Emit stores for all relevant phi-functions
                signed lowstacksize = block->phifunctions.size();
                for (std::vector<IL::PhiFunction *>::reverse_iterator it = block->phifunctions.rbegin(); it != block->phifunctions.rend();++it)
                    code->elements.insert(code->elements.begin(), GetSTORES(block->position, (*it)->variable, --lowstacksize));
        }

        // Splice ALL links that need phi variables pushed
        for (std::vector<IL::CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            worklist.push_back((*it)->block);
        while (!worklist.empty())
        {
                // Visit all blocks; depth first in dominator tree
                IL::BasicBlock *block = worklist.back();
                worklist.pop_back();
                worklist.insert(worklist.end(), block->dominees.begin(), block->dominees.end());

//                DEBUGPRINT("Translating PHI of block " << block);

                std::vector<IL::BasicBlock *> successors = block->successors;

                for (std::vector<IL::BasicBlock *>::iterator it = successors.begin(); it != successors.end();++it)
                    if (!(*it)->phifunctions.empty())
                    {
                            IL::BasicBlock *newblock = SpliceLink(block, *it); // Invalidates block->successors!
                            CodeGenerator::CodeBlock *newcode = generator->translatedblocks[newblock];

                            // This assumes all phi functions have a param for block!
                            signed lowstacksize = (*it)->phifunctions.size();
                            for (std::vector<IL::PhiFunction *>::iterator it2 = (*it)->phifunctions.begin(); it2 != (*it)->phifunctions.end();++it2)
                            {
//                                    DEBUGPRINT((*it2)->params);
                                    for (std::vector< std::pair<IL::AssignSSAVariable *, IL::BasicBlock *> >::iterator it3 = (*it2)->params.begin(); it3 != (*it2)->params.end();++it3)
                                        if (it3->second == block)
                                            newcode->elements.insert(newcode->elements.begin(), GetLOADSD(block->position, it3->first, --lowstacksize));
                            }

                            // Copy over variable positions after block to first instruction of new block
                            // Insert at begin to signify they have low prio (our LOADSD should overwrite them)
                            CodeGenerator::CodeBlock *blockcode = generator->translatedblocks[block];
                            newcode->beginpositions = blockcode->endpositions;

                            // Won't set endpositions, don't need those anymore
                    }
        }

        BuildBlockOrderings(module);

        codes.clear();
        std::map<unsigned, IL::BasicBlock *> fixups;
        for (std::vector<IL::CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
        {
                std::vector<IL::BasicBlock *> &ordering = orderings[*it];

//                DEBUGPRINT("Ordering: " << ordering);

                functionstarts[*it] = codes.size();
                functionstarts_rev[codes.size()] = *it;
                symbolstarts[(*it)->symbol] = codes.size();
                symbolfunctionmap[(*it)->symbol] = *it;

//                        DEBUGPRINT(functionstarts);

                unsigned localvarcount = allocator->local_variable_count[*it];

                for (std::vector<IL::BasicBlock *>::iterator it2 = ordering.begin(); it2 != ordering.end(); ++it2)
                {
                        IL::BasicBlock *block = *it2;
                        locations[*it2] = codes.size();
                        basicblockstarts.insert(codes.size());

//                        DEBUGPRINT(codes.size() << ":- " <<locations);
                        CodeGenerator::CodeBlock *code = generator->translatedblocks[block];

                        debuginfobuilder->ProcessCodeBlock(code, localvarcount);

                        codes.insert(codes.end(), code->elements.begin(), code->elements.end());

//                        if (it2 != ordering.end())
//                            DEBUGPRINT("next block: " << *(it2+1));
//                        DEBUGPRINT("succs: " << block->successors);

                        if (block->successors.size() == 2)
                        {
                                fixups[codes.size()] = block->successors[1];
                                Code::Instruction i = GetJUMPC2F(block->successors[1]->position, 1);
                                i.varpositions = code->endpositions;
                                if (!code->elements.empty())
                                    i.position = code->elements.back().position;
                                codes.push_back(i);
                        }
                        if ((block->successors.size() >= 1) && (it2 + 1 == ordering.end() || *(it2+1) != block->successors[0]))
                        {
                                fixups[codes.size()] = block->successors[0];
                                Code::Instruction i = GetJUMP(block->successors[0]->position);
                                i.varpositions = code->endpositions;
                                if (!code->elements.empty())
                                    i.position = code->elements.back().position;
                                codes.push_back(i);
                        }
//                        DEBUGPRINT(codes);
                }
        }
//        DEBUGPRINT("locs: "<< locations);
//        DEBUGPRINT("fixs: "<< fixups);

        for (std::map<unsigned, IL::BasicBlock *>::iterator it = fixups.begin(); it != fixups.end(); ++it)
            codes[it->first].data.jumplocation = locations[it->second];

//        for (std::vector<Code::Instruction>::iterator it = codes.begin(); it != codes.end(); ++it)
//            CONTEXT_DEBUGPRINT(std::distance(codes.begin(), it) << ": " << *it);
//        CONTEXT_DEBUGPRINT(codes);
}

void CodeBlockLinker::BuildBlockOrderings(IL::Module *mdl)
{
        orderings.clear();
        for (std::vector<IL::CodedFunction *>::iterator it = mdl->functions.begin(); it != mdl->functions.end(); ++it)
        {
                std::vector<IL::BasicBlock *> &ordering = orderings[*it];

                /** This is just an algorithm... it uses the assumption that if's are often true */
                std::set<IL::BasicBlock *> doneblocks;
                std::deque<IL::BasicBlock *> worklist;
                worklist.push_back((*it)->block);

                while (!worklist.empty())
                {
                        IL::BasicBlock *block = worklist.front();
                        worklist.pop_front();
                        if (doneblocks.insert(block).second)
                        {
                                ordering.push_back(block);
                                if (block->successors.size() == 1)
                                {
                                        worklist.push_front(block->successors.front());
                                } else if (block->successors.size() == 2)
                                {
                                        worklist.push_front(block->successors.front());
                                        worklist.push_back(block->successors.back());
                                }
                                worklist.insert(worklist.end(), block->throwcatchers.begin(), block->throwcatchers.end());
                        }
                }
        }
}

IL::CodedFunction * CodeBlockLinker::GetFunctionByPosition(unsigned position)
{
        std::map<unsigned, IL::CodedFunction *>::iterator it = functionstarts_rev.upper_bound(position);
        assert(it != functionstarts_rev.begin());
        --it;
        return it->second;
}

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------

