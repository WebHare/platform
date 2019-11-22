#ifndef blex_webhare_compiler_coderegisterallocator
#define blex_webhare_compiler_coderegisterallocator
//---------------------------------------------------------------------------

#include "il.h"
#include "illiveanalyzer.h"

#include "codegenerator.h"

/** This file contains the register allocator, this is the component that assigns
    storage locations to all global and local variables. */

namespace HareScript
{
namespace Compiler
{


class CodeRegisterAllocator
{
        CompilerContext &context;
        ILLiveAnalyzer* liveanalyzer;
        CodeGenerator* generator;

        /** Current function */
        IL::CodedFunction *func;

        /** When a phi-parameter without assigned location is found, and the assigned locations of the other
            parameters (and the target) are all the same, that last location is stored here. When storage must
            be assigned to that phi-parameter, this location is preferred, to make phi-function elimination trivial and cheap. */
        std::map<IL::SSAVariable *, signed> preferredstorage;

        /** The last used location is recorded here, to be able to re-use locations (bool for when multiple locations were used) */
        std::map< IL::Variable *, std::pair< signed, bool > > usedlocations;

        /** Typedef for a structure that contains the layout of the stack at a given moment */
        typedef std::map<signed, IL::SSAVariable *> StackContents;

        /** Assigns storage locations to all variables in a specific block, and the block that that one dominates
            @param obj Basic block to process
            @param contents Stack contents on basic block entry. By value for a reason. */
        void RecursiveAssignLocations(IL::BasicBlock* obj);

        /// Stackcontents per basic block, to keep 'm off the stack
        std::map< IL::BasicBlock *, StackContents > all_stackcontents;

    public:
        CodeRegisterAllocator(CompilerContext &_context) : context(_context) { }

        /** Contains total number of local variable locations needed for all local registers
            (typically maximum storage location nr + 1) */
        std::map<IL::CodedFunction *, signed> local_variable_count;

        /** Contains storage locations for all global variables (in the global area)
            :outsidestate is always assigned location 0; an other variable can get that id too, because :outsidestate is never
            written to this is ok. */
        std::map<IL::Variable *, signed> global_variable_positions;

        /** Contains storage locations for local variables (relative to base pointer) */
        std::map<IL::SSAVariable *, signed> local_variable_positions;

        /** Allocates storage for all the registers in a module
            @param module Module to process
            @param _liveanalyzer Liveanalyzer that has been used on this module (only the codegenerator may have been used after that!)
            @param _generator Codegenerator that has been used on this block (the use of the codegenerator must immediately
                precede the call to the registerallocator!) */
        void Execute(IL::Module *module, ILLiveAnalyzer* _liveanalyzer, CodeGenerator* _generator);
};





} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif



