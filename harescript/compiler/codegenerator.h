#ifndef blex_webhare_compiler_codegenerator
#define blex_webhare_compiler_codegenerator
//---------------------------------------------------------------------------

#include "illiveanalyzer.h"

/** This file contains the class that transforms IL code to VM code.

 */


namespace HareScript
{
namespace Compiler
{

namespace Code
{

struct VarPosition
{
        inline VarPosition(IL::SSAVariable *_ssavar, signed _position, unsigned flags)
        : ssavar(_ssavar)
        , position((_position & Mask) | flags)
        {
        }

        inline VarPosition(IL::SSAVariable *_ssavar, unsigned _rawposition)
        : ssavar(_ssavar)
        , position(_rawposition)
        {
        }


        IL::SSAVariable *ssavar;

        /// Signed position, parameters have negative stack offsets
        unsigned position;

        static const signed Erase = 0x40000000;
        static const signed PushPos = 0x20000000;
        static const signed PostInstr = 0x10000000;
        static const signed LocOnly = 0x80000000;
        static const signed Mask = 0x03FFFFFF; // 32m vars should be enough + sign bit
        static const signed SignBit = 0x02000000;
};

std::ostream & operator <<(std::ostream &out, VarPosition const &pos);

typedef std::vector< VarPosition > VarPositions;

/** This type contains a VM instuction */
struct Instruction
{
        /// Position in the source file this instruction is relevant to
        LineColumn position;

        // Low stack size (until where stack arguments are removed). Negative: ignore
        signed lowstacksize;

        /// Type of instruction
        InstructionSet::_type type;

        IL::Constant constant;

        /** Extra data, needed for some instructions (like LOADC, LOADS, CALL, etc) */
        union Data
        {
        IL::SSAVariable *var;
        IL::Function *function;
        Symbol *functionsymbol;
        unsigned paramcount;
        unsigned jumplocation;
        bool is_private;
        } data;

        IL::BasicBlock *on_exception;

        /// Variable positions
        VarPositions varpositions;

        explicit Instruction(LineColumn _position, unsigned _lowstacksize)
        : position(_position)
        , lowstacksize(_lowstacksize)
        , on_exception(0)
        {}

        Instruction & operator =(Instruction const &) = default;
};

struct InstructionBlock
{
        std::vector<Instruction> list;
};

} // end of namespace Code

class CodeGenerator
{
    public:
        Code::Instruction GetLOAD(LineColumn position, IL::SSAVariable *var, signed lowstackpos);

        // Code block, contains all dependency information, code original IL instructions of list of code instructions (from 1 basic block)
        struct CodeBlock
        {
                // Built by InstructionTranslator
                std::set<IL::ILInstruction *> ilinstrs;                 // il instructions that this block contains
                std::vector<Code::Instruction> elements;                // Translated instructions

                std::vector<std::pair<IL::SSAVariable *, IL::ILInstruction *> > loads; // variables that must be on stack before executing this block, and the instruction that needs them
                std::vector<IL::SSAVariable *> stores;                  // variables that this codeblock has placed on the stack after execution

                std::set<IL::SSAVariable *> var_uses;                   // variables that this codeblock uses
                std::set<IL::SSAVariable *> var_throwuses;              // variables that throws in this codeblock use
                std::set<IL::SSAVariable *> var_defs;                   // variables that this codeblock defines

                std::map<IL::SSAVariable *, unsigned> load_counts;      // number of uses of a variable

                // Built by CodeGenerator
                std::set<CodeBlock *> dependencies;             // All instructions this block is dependent of
                std::set<CodeBlock *> reverse_dependencies;     // All instructions this block is dependent of

                // Debuginfo
                Code::VarPositions beginpositions;
                Code::VarPositions endpositions;

                std::vector< Code::Instruction >::iterator EraseInstruction(std::vector< Code::Instruction >::iterator it);
        };
    private:

        /** This class translates IL-instructions to code-instructions. */
        class InstructionTranslator: public IL::ILVisitor<void, CodeBlock *>
        {
                CompilerContext &context;

                // Current instruction that is being translated
                IL::ILInstruction *current;

                // Current stack size
                unsigned stacksize;

                // Object adopter
                template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

                /** Registers a load of a variable. Actual emit of a LOAD instruction is deferred, an is the responsability of blockmerge!
                    @param instr Instruction that needed this load
                    @param var Variable that must be loaded
                    @param block Block where this load must be emitted */
                void EmitLoad(IL::ILInstruction *instr, IL::SSAVariable *var, CodeBlock *block);

                /** Registers a store of a variable, also emits the STORE instruction
                    @param instr Instruction that needed this store
                    @param var Variable that must be stored
                    @param block Block where this store must be emitted */
                void EmitStore(IL::ILInstruction *instr, IL::SSAVariable *var, CodeBlock *block);

                /// Handles inlining of special functions
                void InlineSpecialFunction(IL::ILFunctionCall *obj, CodeBlock *block);

                /** Individual translator functions for all il-instruction types. They must first call
                    EmitLoad's on all variables they need loaded, and EmitStore's on all variables that are
                    stored afterwards. */
                virtual void V_ILInstruction(IL::ILInstruction *obj, CodeBlock *block);
                virtual void V_ILConstant(IL::ILConstant *obj, CodeBlock *block);
                virtual void V_ILAssignment(IL::ILAssignment *obj, CodeBlock *block);
                virtual void V_ILCast(IL::ILCast *obj, CodeBlock *block);
                virtual void V_ILBinaryOperator(IL::ILBinaryOperator *obj, CodeBlock *block);
                virtual void V_ILUnaryOperator(IL::ILUnaryOperator *obj, CodeBlock *block);
                virtual void V_ILFunctionCall(IL::ILFunctionCall *obj, CodeBlock *block);
                virtual void V_ILColumnOperator(IL::ILColumnOperator *obj, CodeBlock *block);
                virtual void V_ILConditionalJump(IL::ILConditionalJump *obj, CodeBlock *block);
                virtual void V_ILReturn(IL::ILReturn *obj, CodeBlock *block);
                virtual void V_ILMethodCall(IL::ILMethodCall *obj, CodeBlock *block);
                virtual void V_ILFunctionPtrCall(IL::ILFunctionPtrCall *, CodeBlock *block);
                virtual void V_ILRecordCellSet(IL::ILRecordCellSet *, CodeBlock *block);
                virtual void V_ILRecordCellDelete(IL::ILRecordCellDelete *, CodeBlock *block);
                virtual void V_ILObjectMemberGet(IL::ILObjectMemberGet *, CodeBlock *block);
                virtual void V_ILObjectMemberSet(IL::ILObjectMemberSet *, CodeBlock *block);
                virtual void V_ILObjectMemberDelete(IL::ILObjectMemberDelete *, CodeBlock *block);
                virtual void V_ILObjectMemberInsert(IL::ILObjectMemberInsert *, CodeBlock *block);

            public:
                InstructionTranslator(CompilerContext &context) : context(context) {}

                void Translate(IL::ILInstruction *instr, CodeBlock *block, ILLiveAnalyzer *liveanalyzer);
        };

        CompilerContext &context;
        InstructionTranslator translator;

        std::map<IL::SSAVariable *, IL::ILInstruction *> defines;
        std::map<IL::SSAVariable *, unsigned> usecount;                 //< usecount for variables defined in current block
        std::map<IL::ILInstruction *, IL::SSAVariable *> value_defs;

        ILLiveAnalyzer *liveanalyzer;
        IL::CodedFunction *curfunc;
        IL::Module *curmodule;


        /** Tries to merge block pre with block2.
            result.first: True if merge has succeeded
            result.second: Tru if to->loads has been modified */
        std::pair<bool, bool> TryMergeBlocks(CodeBlock *pre, CodeBlock *to, bool loadstorematch);

        /** Object adopting function */
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }
    public:
        std::map<IL::BasicBlock *, CodeBlock *> translatedblocks;

        void Execute(IL::Module *mdl, ILLiveAnalyzer *_liveanalyzer);
        void DoBasicBlock(IL::Module *mdl, IL::BasicBlock *block);

        CodeGenerator(CompilerContext &context);
        ~CodeGenerator();

        friend class InstructionTranslator;
};

} // end of namespace Compiler
} // end of namespace HareScript


//---------------------------------------------------------------------------
#endif


