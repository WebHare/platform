#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "debugprints.h"

#include "../vm/hsvm_constants.h"
#include "il.h"
#include "codedebuginfobuilder.h"
#include "compiler.h"
#include "utilities.h"

//#define SHOWDEBUGINFOCREATION

/** This class computes the variable location debuginfo */

#ifdef SHOWDEBUGINFOCREATION
 #define DBI_PRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define DBI_PRINT(a)
#endif

namespace HareScript
{
namespace Compiler
{

using namespace Code;



CodeDebugInfoBuilder::CodeDebugInfoBuilder(CompilerContext &_context)
: context(_context)
{
}

void CodeDebugInfoBuilder::CalcNewVarPos()
{
        for (auto &vitr: pos)
        {
                if (!vitr.second.changed)
                    continue;

                vitr.second.newcurrent = 0;
                vitr.second.newvar = 0;

                for (auto &sitr: vitr.second.ssavars)
                {
                        if (!vitr.second.newvar || *sitr.second.begin() > vitr.second.newcurrent)
                        {
                                  vitr.second.newcurrent = *sitr.second.begin();
                                  vitr.second.newvar = sitr.first;
                        }
                }

//                DBI_PRINT("       TC " << vitr.first << " (" << vitr.second.currentvar << " " << vitr.second.current << ")->(" << vitr.second.newvar << " " << vitr.second.newcurrent << ")");
//                DBI_PRINT("         from " << vitr.second.ssavars);

                vitr.second.changed = vitr.second.current != vitr.second.newcurrent || vitr.second.currentvar != vitr.second.newvar;
        }
}


void CodeDebugInfoBuilder::EraseFromLowStackSize(unsigned lowstacksize)
{
        for (auto &vitr: pos)
        {
                for (auto sitr = vitr.second.ssavars.begin(); sitr != vitr.second.ssavars.end();)
                {
                        auto oitr = sitr->second.lower_bound(lowstacksize | VarPosition::PushPos);
                        if (oitr != sitr->second.end())
                        {
                                sitr->second.erase(oitr, sitr->second.end());
                                vitr.second.changed = true;

                                DBI_PRINT("Lowstack erase " << *sitr << " " << *oitr);

                                if (sitr->second.empty())
                                    vitr.second.ssavars.erase(sitr++);
                                else
                                    ++sitr;
                        }
                        else
                            ++sitr;
                }
        }
}

void CodeDebugInfoBuilder::AddVarPosition(IL::SSAVariable *var, unsigned varpos)
{
        // Ignore internal variables
        if (!var->variable->symbol || (var->variable->symbol->name[0] == ':' && var->variable->symbol->name != ":THIS"))
            return;

        DBI_PRINT("Adding " << var << " " << varpos);
        VarData &vardata = pos[var->variable];
        auto &pos_set = vardata.ssavars[var];
        pos_set.insert(varpos);
        vardata.changed = true;
}

void CodeDebugInfoBuilder::EraseVarPosition(IL::SSAVariable *var, unsigned varpos)
{
        DBI_PRINT("Erasing " << var << " " << varpos);
        auto pitr = pos.find(var->variable);
        if (pitr == pos.end())
            return;

        auto sitr = pitr->second.ssavars.find(var);
        if (sitr == pitr->second.ssavars.end())
            return;

        auto oitr = sitr->second.find(varpos);
        if (oitr == sitr->second.end())
            return;

        sitr->second.erase(oitr);
        if (sitr->second.empty())
            pitr->second.ssavars.erase(sitr);

        pitr->second.changed = true;
}


void CodeDebugInfoBuilder::ProcessVarPositionInstructions(Code::VarPositions &positions, bool postinstr)
{
        for (auto &itr: positions)
        {
                if (!(itr.position & VarPosition::PostInstr) == postinstr)
                    continue;

                if (!(itr.position & VarPosition::Erase)
                      && ((itr.position & VarPosition::PushPos) || itr.ssavar->variable->storagetype == IL::Variable::Stack))
                    AddVarPosition(itr.ssavar, itr.position & (VarPosition::Mask | VarPosition::PushPos));
                else
                    EraseVarPosition(itr.ssavar, itr.position & (VarPosition::Mask | VarPosition::PushPos));
        }
}

void CodeDebugInfoBuilder::StoreNewInstructions(Code::VarPositions *target, unsigned localvarcount)
{
        CalcNewVarPos();

        target->clear();
        for (auto pitr = pos.begin(); pitr != pos.end();)
        {
                  DBI_PRINT("P " << pitr->first << " " << pitr->second.currentvar << " " << pitr->second.current << " " << pitr->second.newvar << " " << pitr->second.newcurrent);
                  if (!pitr->second.changed)
                  {
                          ++pitr;
                          continue;
                  }

                  if (pitr->second.newvar)
                  {
                          signed position = pitr->second.newcurrent;
                          if (pitr->second.currentvar && pitr->second.newvar && pitr->second.currentvar == pitr->second.newvar)
                              position |= VarPosition::LocOnly;
//                          else DBI_PRINT("P " << pitr->first << " " << pitr->second.currentvar << " " << pitr->second.current << " " << pitr->second.newvar << " " << pitr->second.newcurrent);

                          if (position & VarPosition::PushPos)
                          {
                                  position += localvarcount;
                                  position &= ~VarPosition::PushPos;
                          }

                          DBI_PRINT(" X " << pitr->second.newvar << " " << pitr->second.newcurrent);
                          target->push_back(VarPosition(pitr->second.newvar, position));
                          pitr->second.currentvar = pitr->second.newvar;
                          pitr->second.current = pitr->second.newcurrent;
                          pitr->second.changed = false;
                          ++pitr;
                  }
                  else if (pitr->second.currentvar)
                  {
                          signed position = pitr->second.current | VarPosition::Erase;
                          if (position & VarPosition::PushPos)
                          {
                                  position += localvarcount;
                                  position &= ~VarPosition::PushPos;
                          }

                          DBI_PRINT(" R " << pitr->second.currentvar << " " << pitr->second.current);
                          target->push_back(VarPosition(pitr->second.currentvar, position));
                          pos.erase(pitr++);
                  }
                  else
                  {
                          DBI_PRINT(" N");
                          pos.erase(pitr++);
                  }
        }
}

void CodeDebugInfoBuilder::ProcessCodeBlock(CodeGenerator::CodeBlock *code, unsigned localvarcount)
{
          // per ssavariable: take lowest stackpos (more stable)
          // per variable: take highest stackpos
          // record all changes in these set

          /* lowstacksize
             remove all ssavariables with position lower than stackpos
             calc variable with highest pos? Is other or removed?
             y: schedule change

             varinfo handling:
                ssavariable present
                y:  new has higher pos: ignore
                    new has lower pos: replace pos, calc variable with highest pos. Is other?
                    y: schedule change
                n:  calc variable with highest pos. Is new or other?
                    y: schedule change

             emit all changes
          */

        // Clear current state
        pos.clear();

        DBI_PRINT("Start code block");

        // Add the current state at the beginning of the block
        DBI_PRINT("B< " << code->beginpositions);
        ProcessVarPositionInstructions(code->beginpositions, false);
        ProcessVarPositionInstructions(code->beginpositions, true);

        VarPositions saved;

        for (auto &itr: code->elements)
        {
                DBI_PRINT("");

//                for (auto pitr: pos) DBI_PRINT("*1 " << pitr.first << " " << pitr.second.currentvar);

                DBI_PRINT(" < " << itr.varpositions);
                ProcessVarPositionInstructions(itr.varpositions, false);

//                for (auto pitr: pos) DBI_PRINT("*2 " << pitr.first << " " << pitr.second.currentvar);

                // Save the current varpositions for adding the postinstruction stuff
                std::swap(saved, itr.varpositions);

//                for (auto pitr: pos) DBI_PRINT("*3 " << pitr.first << " " << pitr.second.currentvar);

                StoreNewInstructions(&itr.varpositions, localvarcount);

                for (auto pitr: pos) DBI_PRINT("*4 " << pitr.first << " " << pitr.second.currentvar);

                DBI_PRINT(" > " << itr.varpositions);
                DBI_PRINT(itr);

                //DBI_PRINT("Erase lowstacksize " << itr.lowstacksize);

                if (itr.lowstacksize != -1)
                    EraseFromLowStackSize(itr.lowstacksize);

                for (auto pitr: pos) DBI_PRINT("*5 " << pitr.first << " " << pitr.second.currentvar);

                ProcessVarPositionInstructions(saved, true);

                for (auto pitr: pos) DBI_PRINT("*6 " << pitr.first << " " << pitr.second.currentvar);
        }

        DBI_PRINT("CE " << code->endpositions);
        ProcessVarPositionInstructions(code->endpositions, false);
        ProcessVarPositionInstructions(code->endpositions, true);

        StoreNewInstructions(&code->endpositions, localvarcount);

        DBI_PRINT("Done code block");
}

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
