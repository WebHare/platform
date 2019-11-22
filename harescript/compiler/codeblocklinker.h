#ifndef blex_webhare_compiler_codeblocklinker
#define blex_webhare_compiler_codeblocklinker
//---------------------------------------------------------------------------

#include "codegenerator.h"
#include "coderegisterallocator.h"

namespace HareScript
{
namespace Compiler
{

class CodeDebugInfoBuilder;

/** The codeblock linker takes all basic blocks built by the codegenerator and
    links them into one big list of instructions. It also handles the transition
    from SSA form. */
class CodeBlockLinker
{
        CompilerContext &context;

        Code::Instruction GetLOADSD(LineColumn position, IL::SSAVariable *var, signed lowstacksize);
        Code::Instruction GetJUMPC2F(LineColumn position, signed lowstacksize);
        Code::Instruction GetJUMP(LineColumn position);
        Code::Instruction GetSTORES(LineColumn position, IL::SSAVariable *var, signed lowstacksize);

        CodeGenerator *generator;
        CodeRegisterAllocator *allocator;
        CodeDebugInfoBuilder *debuginfobuilder;

        IL::BasicBlock* SpliceLink(IL::BasicBlock *from, IL::BasicBlock *to);

        std::map<IL::CodedFunction *, std::vector<IL::BasicBlock *> > orderings;

        // Builds an basic block ordering (for code building). This can be moved to a seperate step later.
        void BuildBlockOrderings(IL::Module *mdl);

        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }
    public:
        CodeBlockLinker(CompilerContext &context, CodeDebugInfoBuilder *debuginfobuilder);
        ~CodeBlockLinker();

        // Translated codes
        std::vector<Code::Instruction> codes;
        std::map<IL::CodedFunction *, unsigned> functionstarts;
        std::map<unsigned, IL::CodedFunction *> functionstarts_rev;
        std::map<Symbol *, unsigned> symbolstarts;
        std::map<Symbol *, IL::CodedFunction *> symbolfunctionmap;
        std::map<IL::BasicBlock *, unsigned> locations;
        std::set< unsigned > basicblockstarts;
        std::map< unsigned, Code::VarPositions * > varpositions;

        IL::CodedFunction * GetFunctionByPosition(unsigned position);

        /** Builds linear code from IL form. It completely destroys the IL's SSA form for it's own purposes */
        void Execute(IL::Module *module, CodeGenerator *_generator, CodeRegisterAllocator *_allocator);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
