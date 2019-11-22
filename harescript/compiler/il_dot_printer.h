#ifndef blex_webhare_compiler_il_dot_printer
#define blex_webhare_compiler_il_dot_printer
//---------------------------------------------------------------------------

#include <blex/stream.h>
#include "il.h"

#include "coderegisterallocator.h"
#include "illiveanalyzer.h"
#include "codegenerator.h"

/** Printer of the IL code */

namespace HareScript
{
namespace Compiler
{

class ILDotPrinter : public IL::ILVisitor<void, Empty>
{
    public:
    private:
        template <class A>
         std::string GetNodeName(A *a);
        template <class A>
         std::string GetUnstringedNodeName(A *a);

        CompilerContext &context;
        ILLiveAnalyzer *liveanalyzer;
        CodeRegisterAllocator *allocator;
        CodeGenerator *generator;

        PrintType printtype;
        PrintSort printsort;

        std::unique_ptr<Blex::BufferedStream> stream;
        std::map<IL::BasicBlock *, bool> visited;

        IL::CodedFunction *currfunc;

        std::string VariableName(IL::SSAVariable *var);
        void PrintBasicBlock(IL::BasicBlock *block, bool entry = false);
        void VisitAllFunctionEntries(IL::Module *module, Blex::Stream &file);
    public:
        ILDotPrinter(CompilerContext &context) : context(context), liveanalyzer(0), allocator(0), generator(0) {}

        void PrintStructure(IL::Module *module, Blex::Stream &file, PrintSort sort, PrintType type);

        void RegisterLiveAnalyzer(ILLiveAnalyzer *_liveanalyzer) { liveanalyzer = _liveanalyzer; }
        void RegisterRegisterAllocator(CodeRegisterAllocator *_allocator) { allocator = _allocator; }
        void RegisterCodeGenerator(CodeGenerator *_generator) { generator = _generator; }

        virtual void V_ILInstruction(IL::ILInstruction *, Empty);
        virtual void V_ILConstant(IL::ILConstant *, Empty);
        virtual void V_ILAssignment(IL::ILAssignment *, Empty);
        virtual void V_ILBinaryOperator(IL::ILBinaryOperator *, Empty);
        virtual void V_ILCast(IL::ILCast *, Empty);
        virtual void V_ILUnaryOperator(IL::ILUnaryOperator *, Empty);
        virtual void V_ILFunctionCall(IL::ILFunctionCall *, Empty);
        virtual void V_ILColumnOperator(IL::ILColumnOperator *, Empty);
        virtual void V_ILConditionalJump(IL::ILConditionalJump *, Empty);
        virtual void V_ILReturn(IL::ILReturn *, Empty);
        virtual void V_ILMethodCall(IL::ILMethodCall *, Empty);
        virtual void V_ILFunctionPtrCall(IL::ILFunctionPtrCall *, Empty);
        virtual void V_ILRecordCellSet(IL::ILRecordCellSet *obj, Empty);
        virtual void V_ILRecordCellDelete(IL::ILRecordCellDelete *obj, Empty);
        virtual void V_ILObjectMemberGet(IL::ILObjectMemberGet *obj, Empty);
        virtual void V_ILObjectMemberSet(IL::ILObjectMemberSet *obj, Empty);
        virtual void V_ILObjectMemberDelete(IL::ILObjectMemberDelete *obj, Empty);
        virtual void V_ILObjectMemberInsert(IL::ILObjectMemberInsert *obj, Empty);

};


} // end of namespace HareScript
} // end of namespace Compiler

//---------------------------------------------------------------------------
#endif
