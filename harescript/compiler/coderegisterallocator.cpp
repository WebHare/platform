// //---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "coderegisterallocator.h"
#include "debugprints.h"

//#define SHOWRA

/** This allocater allocates storage space for all variables.

    It actively tries to put all parameters to a phi-function at the same
    location, so the phi-function can be eliminated without cost.

    It cannot handle stack variables that cross basic block boundaries.

    For the rest, the allocator works by assigning storage to the
    first free location (counting from the first). Parameter locations
    are not considered as storage location. */

#ifdef SHOWRA
 #define RAPRINT(a) CONTEXT_DEBUGPRINT(a)
#else
 #define RAPRINT(a)
#endif


namespace HareScript
{
namespace Compiler
{

// -----------------------------------------------------------------------------
// --
// -- CodeRegisterAllocator
// --

void CodeRegisterAllocator::Execute(IL::Module *module, ILLiveAnalyzer* _liveanalyzer, CodeGenerator* _generator)
{
        liveanalyzer = _liveanalyzer;
        generator = _generator;

        // Allocate storage for all the global variables (not to :outsidestate)
        signed counter = 0;
        for (std::set<IL::Variable *>::iterator it = module->globalvars.begin(); it != module->globalvars.end(); ++it)
            if ((*it)->symbol->variabledef)
               global_variable_positions[*it] = counter++;

        for (std::vector<IL::CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
        {
                RAPRINT("** Processing function: " << (*it)->symbol->name);
                func = *it;

                unsigned ctr = 0;

                // Add all parameters. 1st at -1, 2nd at -2, etc.
                for (std::vector<IL::AssignSSAVariable *>::iterator it2 = func->parameters.begin(); it2 != func->parameters.end(); ++it2)
                    local_variable_positions[*it2] = --ctr;

                // Set all initial globals
                for (std::vector<IL::AssignSSAVariable *>::iterator it2 = func->globalvars.begin(); it2 != func->globalvars.end(); ++it2)
                    local_variable_positions[*it2] = global_variable_positions[(*it2)->variable];

                RecursiveAssignLocations((*it)->block);

                RAPRINT("Local variable count: " << local_variable_count[*it]);
        }
}

void CodeRegisterAllocator::RecursiveAssignLocations(IL::BasicBlock *obj)
{
        // Pre: if obj has a dominator, than this functions MUST have been called from RecursiveAssignLocations with as parameter that dominator.
        RAPRINT("\nLocation assignment for block " << obj);

        // Get the translated code for this block
        CodeGenerator::CodeBlock *code = generator->translatedblocks[obj];

        /** 1. Determine the current stack contents after the phi. Ignore variables that have no storage location
               yet (the phi targets)
        */
        StackContents &contents(all_stackcontents[obj]);

        std::set<IL::SSAVariable *> &entrylivedata = liveanalyzer->entrylivedata[obj];
        for (std::set<IL::SSAVariable *>::iterator it = entrylivedata.begin(), end = entrylivedata.end(); it != end; ++it)
        {
                if ((*it)->variable->storagetype == IL::Variable::None)
                    continue;

                std::map<IL::SSAVariable *, signed>::iterator lit = local_variable_positions.find(*it);
                if (lit != local_variable_positions.end())
                    contents[lit->second] = *it;
        }

        RAPRINT("Contents before phi: " << contents);

        // Store the before-phi variable positions
        for (auto &sitr: contents)
            if (sitr.second->variable->storagetype == IL::Variable::Stack)
                code->beginpositions.push_back(Code::VarPosition(sitr.second, sitr.first, 0));

        /** 2. Assign storage locations to the phi-function targets
               Try to put them at the place of the parameters, in the hope that the other parameters have the same storage
               location. If that succeeds, set the preferred storage location of the phi parameters to that of the target */
        for (std::vector<IL::PhiFunction *>::iterator it = obj->phifunctions.begin(); it != obj->phifunctions.end(); ++it)
        {
                if ((*it)->variable->variable->storagetype == IL::Variable::Stack)
                {
                        signed location = 0;

                        /* We check if we can trivialize the phi-function (make sure that the targets and the parameters all
                           have the same stack location. For this, we record all locations of the parameters (if determined),
                           and if parameters are live AFTER the phi-function.
                           If there is more than one location, or there is a parameter live afterwards, the phi-function is
                           not trivializable. On the other hand, if it is then for all parameters the preferred storage for
                           all parameters is set. */
                        bool trivializable = true;
                        std::set<signed> locations;
                        for (std::vector< std::pair<IL::AssignSSAVariable *, IL::BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                            if (liveanalyzer->entrylivedata[obj].count(it2->first))
                                trivializable = false;
                            else if (it2->first->variable->storagetype != IL::Variable::None)
                                if (local_variable_positions.count(it2->first))
                                    locations.insert(local_variable_positions[it2->first]);

                        // We can only trivialize if there is only unique location that the parameters have storage */
                        if (locations.size() == 1)
                            location = *locations.begin();
                        else
                            trivializable = false;

                        // Of course, we can only assign storage to a free location!
                        if (!trivializable || contents.count(location) != 0)
                        {
                                for (location = 0; contents.count(location) != 0; ++location) {}
                        }
                        else
                        {
                                for (std::vector< std::pair<IL::AssignSSAVariable *, IL::BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                                    preferredstorage[it2->first] = location;
                        }

                        /** Record the locations and update the size of the local variable storage area */
                        contents[location] = (*it)->variable;
                        local_variable_positions[(*it)->variable] = location;
                        local_variable_count[func] = std::max(local_variable_count[func], location + 1);

                        code->beginpositions.push_back(Code::VarPosition((*it)->variable, location, 0));
                }
                else if ((*it)->variable->variable->storagetype == IL::Variable::Global)
                {
                        /* Check that the target and the parameters of a phi-function which assigns to a global
                           all have the same location, for security reasons. Normally, this will never occur */
                        signed location = global_variable_positions[(*it)->variable->variable];
                        for (std::vector< std::pair<IL::AssignSSAVariable *, IL::BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                            if (global_variable_positions[it2->first->variable] != location)
                                throw std::logic_error("Registerallocator: a phi-function with a global as destination is not trivial");
                }
        }

        // 2a. Store the assigned locations in usedlocations
        for (StackContents::iterator it = contents.begin(); it != contents.end(); ++it)
            usedlocations[it->second->variable] = std::make_pair(it->first, false);

        // 3. Construct data about which stack variable dies where. Adjust LOADS to LOADSD where applicable.
        // Modifies the instruction list, so we can't use pointers to the instructions yet
        std::set<IL::SSAVariable *> livedata = liveanalyzer->exitlivedata[obj];

        if (!code->elements.empty())
        {
                RAPRINT("Converting LOADS to LOADSD, inserting DESTROYS (in reverse order)");

                for (std::vector<Code::Instruction>::iterator it = code->elements.end(); it != code->elements.begin();)
                {
                        --it;
                        RAPRINT(" " << *it);
                        if (it->type == InstructionSet::LOADS)
                        {
                                // Variable might not be alive after this
                                if (livedata.insert(it->data.var).second) // Not alive after this? -> then it dies here
                                {
                                        RAPRINT(" > Converted to LOADSD");
                                        it->type = InstructionSet::LOADSD;
                                }

                                // ADDME: Mark var as on stack after this instruction
                        }
                        else if (it->type == InstructionSet::COPYS)
                        {
                                // Variable might not be alive after this
                                if (livedata.insert(it->data.var).second) // Not alive after this? -> then it dies here
                                {
                                        RAPRINT(" > Deleted unneccesary COPYS");
                                        it = code->EraseInstruction(it);
                                        ++it;
                                }

                                // ADDME: Mark var as on stack after this instruction
                        }
                        else if (it->type == InstructionSet::STORES)
                        {
                                if (!livedata.count(it->data.var)) // Not alive after this? Just discard
                                {
                                        RAPRINT(" > Converted to POP");
                                        it->type = InstructionSet::POP;
                                }
                                else
                                    livedata.erase(it->data.var);
                        }
                        else if (it->on_exception)
                        {
                                std::set<IL::SSAVariable *> &except_live(liveanalyzer->entrylivedata[it->on_exception]);

                                for (std::set< IL::SSAVariable * >::iterator it2 = except_live.begin(), end = except_live.end(); it2 != end; ++it2)
                                {
                                        if (livedata.insert(*it2).second && (*it2)->variable->storagetype == IL::Variable::Stack) // Not alive after this? -> then it dies after this instruction
                                        {
                                                Code::Instruction instr(it->position, -1);
                                                instr.type = InstructionSet::DESTROYS;
                                                instr.data.var = *it2;

                                                RAPRINT(" > Insert DESTROYS for variable " << *it2);

                                                // Insert destroy instruction
                                                it = code->elements.insert(it + 1, instr) - 1;
                                        }
                                }
                        }
                }

                // Get the data for which stack variable dies where
                std::map<Code::Instruction *, std::set<IL::SSAVariable *> > die_data;
                for (std::vector<Code::Instruction>::iterator it = code->elements.begin(); it != code->elements.end(); ++it)
                    if (it->type == InstructionSet::LOADSD || it->type == InstructionSet::DESTROYS)
                        die_data[&*it].insert(it->data.var);

                // 4. Allocate storage to all the stack variables
                RAPRINT("Now allocating storage");
                RAPRINT("Contents after phi: " << contents);
                RAPRINT("Variable locations: " << local_variable_positions);

                RAPRINT(" >BSD " << code->beginpositions);

                for (std::vector<Code::Instruction>::iterator it = code->elements.begin(); it != code->elements.end(); ++it)
                {
                        RAPRINT(" > SD " << it->varpositions);
                        RAPRINT(" " << *it);

                        std::set<IL::SSAVariable *> const &dies = die_data[&*it];

                        if (!dies.empty())
                        {
                                RAPRINT(" > dies now: " << dies);
                        }

                        // Erase all variables that die here from the stack contents
                        for (std::set<IL::SSAVariable *>::const_iterator it2 = dies.begin(); it2 != dies.end(); ++it2)
                        {
                                it->varpositions.push_back(Code::VarPosition(*it2, local_variable_positions[*it2], Code::VarPosition::PostInstr | Code::VarPosition::Erase));
                                contents.erase(local_variable_positions[*it2]);
                        }

                        // Only STORES and COPYS can define a stack based variable
                        if (it->type == InstructionSet::STORES || it->type == InstructionSet::COPYS)
                        {
                                bool have_hint = false;
                                signed location = 0;

                                std::map< IL::Variable *, std::pair< signed, bool > >::iterator uit = usedlocations.end();

                                // Find an empty storage location. If there is a preferred location or a previously used, try to use that
                                // or else allocate a fresh one
                                if (preferredstorage.count(it->data.var))
                                {
                                        location = preferredstorage[it->data.var];
                                        have_hint = true;
                                        RAPRINT(" > has preferred location " << location);
                                }
                                else
                                {
                                        uit = usedlocations.find(it->data.var->variable);
                                        if (uit != usedlocations.end() && !uit->second.second)
                                        {
                                                location = uit->second.first;
                                                have_hint = true;
                                                RAPRINT(" > previously only found at location " << location);
                                        }
                                }

                                // If there is no hint, or that location is already in use, if so, allocate a fresh one
                                if (!have_hint || contents.count(location))
                                {
                                        for (location = 0; contents.count(location) != 0; ++location) {}
                                }

                                /* Record the locations and update the size of the local variable storage area */
                                local_variable_positions[it->data.var] = location;
                                contents[location] = it->data.var;
                                local_variable_count[func] = std::max(local_variable_count[func], location + 1);

                                if (uit == usedlocations.end() || uit->second.first != location)
                                    usedlocations[it->data.var->variable] = std::make_pair(location, uit != usedlocations.end());

                                RAPRINT(" > is store, put at location: " << location);

                                it->varpositions.push_back(Code::VarPosition(it->data.var, location, Code::VarPosition::PostInstr));
                        }
                }
        }

        /* Recursively visit the rest! */
        for (std::vector<IL::BasicBlock *>::iterator it = obj->dominees.begin(); it != obj->dominees.end(); ++it)
            RecursiveAssignLocations(*it);
}

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------

