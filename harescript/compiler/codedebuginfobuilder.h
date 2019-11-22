#ifndef blex_webhare_compiler_codedebuginfobuilder
#define blex_webhare_compiler_codedebuginfobuilder
//---------------------------------------------------------------------------

#include "codegenerator.h"
#include "codedebuginfobuilder.h"

/** This file contains the class builds debuginfo in basic blocks
    Used by codeblocklinker to debuginfo in instructions
*/

namespace HareScript
{
namespace Compiler
{

class CodeDebugInfoBuilder
{
        CompilerContext &context;

        /** Tracks the current position of a variable
        */
        struct VarData
        {
                  inline VarData() : current(0), currentvar(0), changed(true), newcurrent(0), newvar(0){ }

                  /// Current position of the variable
                  unsigned current;

                  /// Current selected SSA assignment for this variable
                  IL::SSAVariable *currentvar;

                  /// Whether there is a possible change in location
                  bool changed;

                  /// New position for the variable
                  unsigned newcurrent;

                  /// New selected SSA assignment fot this variable
                  IL::SSAVariable *newvar;

                  /// List of store positions for all SSA assignments of this variable
                  std::map< IL::SSAVariable *, std::set< unsigned > > ssavars;
        };

        /** Stack position tracking data for all variables
        */
        std::map< IL::Variable *, VarData > pos;

        /** Calculate newcurrent and newvar for all variables that had their ssavars changed
        */
        void CalcNewVarPos();

        /** Registers an extra position for an SSA assignment into pos
        */
        void AddVarPosition(IL::SSAVariable *var, unsigned pos);

        /** Removes a position of an SSA assignment into pos
        */
        void EraseVarPosition(IL::SSAVariable *var, unsigned pos);

        /** Process the instructions from a VarPositions of an instruction
            @param positions Variable position instructions
            @param postinstr If false, process only pre-instruction data, otherwise only post-instruction data
        */
        void ProcessVarPositionInstructions(Code::VarPositions &positions, bool postinstr);

        /** Erase all removed variable positions based on new stack size
        */
        void EraseFromLowStackSize(unsigned lowstacksize);

        /** Caculcate and store all variable position changes to the target varpositions
        */
        void StoreNewInstructions(Code::VarPositions *target, unsigned localvarcount);

    public:
        CodeDebugInfoBuilder(CompilerContext &context);


        void ProcessCodeBlock(CodeGenerator::CodeBlock *code, unsigned localvarcount);

};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
