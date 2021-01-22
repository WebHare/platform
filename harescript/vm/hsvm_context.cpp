//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_varmemory.h"
#include "hsvm_context.h"
#include "hsvm_debug.h"
#include "baselibs.h"
#include "errors.h"
#include <blex/decimalfloat.h>
#include <iostream>
#include <iomanip>
#include "mangling.h"
#include "hsvm_debugger.h"
#include "hsvm_processmgr.h"
#include "hsvm_dllinterface_blex.h"

//#define SHOWBYTECODES
//#define SHOWSTACK
//#define SHOWCALLSTACK
//#define LIMITCALLSTACK
//#define INDENTBYTECODES

// Trace creation of vmgroups & virtualmachines
//#define TRACECREATION

// Show stack element push/pops
//#define SHOWSTACKPUSHPOP

// Show YIELD
//#define SHOW_GENERATORS

/// Nr of async stack contexts that is kept alive
#define ASYNC_STACK_DEPTH 10


#if defined(DEBUG) && (defined(SHOWSTACK) || defined(SHOWCALLSTACK) || defined(SHOWBYTECODES))
 #define SHOWSTATE ShowStackState(debug);
#else
 #define SHOWSTATE ;
#endif

#if defined(DEBUG) && defined(TRACECREATION)
 #define TC_PRINT(x) DEBUGPRINT(x)
#else
 #define TC_PRINT(x) (void)0
#endif

#if defined(DEBUG) && defined(SHOWSTACKPUSHPOP)
 #define SPP_PRINT(x) DEBUGPRINT(x)
#else
 #define SPP_PRINT(x) (void)0
#endif

#if defined(SHOW_GENERATORS) && defined(DEBUG)
 #define GEN_PRINT(x) DEBUGPRINT(x)
 #define GEN_ONLY(a) DEBUGONLY(a)
#else
 #define GEN_PRINT(x)
 #define GEN_ONLY(a)
#endif


namespace HareScript
{

namespace
{
const unsigned MaxNesting = 1024; // Maximum number of nested functions

const signed SignalCodeptr = -1;

// BCB has overhead in functions with a throw; so we put them in subfunctions
void ThrowStackOverflow()
{
        throw VMRuntimeError(Error::StackOverflow, Blex::AnyToString(MaxNesting));
}
void ThrowUnknownFunction()
{
        throw VMRuntimeError(Error::InternalError, "Illegal function index encountered; library corrupt");
}
void ThrowIllegalOpcode(InstructionSet::_type code)
{
    std::string nr = Blex::AnyToString<int>(code);
    throw VMRuntimeError (Error::InternalError, "Invalid virtual machine instruction '"+nr+"' encountered");
}

} // End of anonymous namespace

const unsigned OutputObject::MaxReadChunkSize;

OutputObject::OutputObject(HSVM *_vm, const char *_type)
: type(_type)
, vm(0)
, wait_ignores_readbuffer(false)
{
        id = Register(_vm);
}

int OutputObject::Register(HSVM *_vm)
{
        if (vm)
            Unregister();

        vm = _vm;
        id = 0;
        if (vm)
            id = GetVirtualMachine(vm)->outobjects.Set(this);

        return id;
}

void OutputObject::Unregister()
{
        if (vm)
            GetVirtualMachine(vm)->outobjects.Erase(id);

        vm = 0;
        id = 0;
}

OutputObject::~OutputObject()
{
        Unregister();
}

void OutputObject::SetWaitIgnoresReadBuffer(bool newwait)
{
        wait_ignores_readbuffer = newwait;
}
std::pair< Blex::SocketError::Errors, unsigned > OutputObject::Read(unsigned , void *)
{
        return std::make_pair(Blex::SocketError::NoError, 0);
}
std::pair< Blex::SocketError::Errors, unsigned > OutputObject::Write(unsigned , const void *, bool /*allow_partial*/)
{
        return std::make_pair(Blex::SocketError::NoError, 0);
}

bool OutputObject::IsAtEOF()
{
        return true;
}

bool OutputObject::ShouldYieldAfterWrite()
{
        return false;
}


void ProfileData::Reset()
{
        function_profiles.clear();
        instructions_executed = 0;
        totaltime = 0;
}



// -----------------------------------------------------------------------------
//              Virtual Machine
// -----------------------------------------------------------------------------
VirtualMachine::VirtualMachine(VMGroup *group, Environment &librarian, Blex::ContextRegistrator &creg, ErrorHandler &vm_errorhandler, CallStack &_callstack)
: columnnamemapper(librarian.GetColumnNameMapper())
, cn_cache(columnnamemapper)
, contextkeeper(creg)
//, blobhandler(librarian.GetFileSystem().GetTempDir())
, blobmanager(librarian.GetBlobManager())
, filesystem(librarian.GetFileSystem())
, stackmachine(columnnamemapper)
, environment(librarian)
, var_marshaller(this, MarshalMode::DataOnly)
, param_marshaller(this, MarshalMode::DataOnly)
, ipc_marshaller(this, MarshalMode::All)
, cache_marshaller(this, MarshalMode::AllClonable)
, authrec_marshaller(this, MarshalMode::DataOnly)
, event_marshaller(this, MarshalMode::SimpleOnly)
, sqlsupport(this)
, libraryloader(librarian, vm_errorhandler) //ADDME: vm_errorhandler should be global to a VM group
, callstack(_callstack)
, throwvar(0)
, current_init_lib(NULL)
, execute_lib(NULL)
, is_suspendable(true)
, vmgroup(group)
, is_unwinding(false)
, skip_first_traceitem(false)
, vm_errorhandler(vm_errorhandler)
{
        TC_PRINT("Created VM " << this << " for vmgroup " << group);
        executionstate.codeptr = 0;
        executionstate.library = NULL;
        executionstate.code = NULL;
        outobjects.SetMinimumId(256);
        throwvar = stackmachine.NewHeapVariable();
        stackmachine.InitVariable(throwvar, VariableTypes::Object);
}

VirtualMachine::~VirtualMachine()
{
        TC_PRINT("Destroyed VM " << this);
}

CallStackElement & VirtualMachine::PushFrameRaw(StackElementType::Type type)
{
        callstack.resize(callstack.size() + 1);
        CallStack::iterator at = callstack.end() - 1;

        SPP_PRINT("Push frame, type: " << type << ", before library: " << (void*)executionstate.library << ", function: " <<  (executionstate.library ?
            executionstate.library->GetWrappedLibrary().linkinfo.GetNameStr(executionstate.library->GetWrappedLibrary().FunctionList()[executionstate.function].name_index) : ""));

        at->library = executionstate.library;
        at->function = executionstate.function;
        at->codeptr = executionstate.codeptr;
        at->type = type;

        if (profiledata.profile_functions && type == StackElementType::Return)
        {
                at->createtime = Blex::GetSystemCurrentTicks();
                at->childtime = 0;

                std::pair< LinkedLibrary::ResolvedFunctionDef const *, LinkedLibrary::ResolvedFunctionDef const * > funcs;
                if (executionstate.library)
                    funcs.first = &executionstate.library->GetLinkedLibrary().functiondefs[executionstate.function];
                else
                    funcs.first = 0;
                funcs.second = 0;

                ProfileData::FunctionProfile &prof = profiledata.function_profiles[funcs];

//                std::cout << "Pushing frame from " << funcs.first->lib->GetLinkinfoNameStr(funcs.first->def->name_index) << ", callcount pre: " << prof.callcount << std::endl;
                ++prof.callcount;
/*
                std::cout << "Current recorded data:" << std::endl;
                for (ProfileData::FunctionProfiles::iterator it = profiledata.function_profiles.begin(); it != profiledata.function_profiles.end(); ++it)
                {
                        std::cout << " " << it->first.first << " " << it->first.second << " " << it->second.callcount << " " << it->second.totaltime << " " << it->second.selftime <<
                                     "  (" << (it->first.first ? it->first.first->lib->GetLinkinfoNameStr(it->first.first->def->name_index).c_str() : "(nil)") <<
                                     " -> " << (it->first.second ? it->first.second->lib->GetLinkinfoNameStr(it->first.second->def->name_index).c_str() : "(nil)") << ")" << std::endl;
                }
//*/
        }

        if (callstack.size() >= MaxNesting)
            ThrowStackOverflow();
        return *at;
}

void VirtualMachine::PushFrame(unsigned locals)
{
        CallStackElement &elt = PushFrameRaw(StackElementType::Return);
        elt.baseptr = stackmachine.EnterStackFrame(locals);
}


void VirtualMachine::SetStateShortcuts(bool is_hit)
{
        executionstate.code = &executionstate.library->GetWrappedLibrary().resident.code[0];
        var_marshaller.SetLibraryColumnNameDecoder(&executionstate.library->GetLinkedLibrary().resolvedcolumnnames);

        if (profiledata.profile_memory)
        {
                CallTreeNode *node = profiledata.calltree.GetCallTreeNode(callstack, executionstate.library, executionstate.function);

                SPP_PRINT("SAS for library: " << (node ? (void*)node->library : "") << ", function: " << (node && node->library ?
                    node->library->GetWrappedLibrary().linkinfo.GetNameStr(node->library->GetWrappedLibrary().FunctionList()[node->function].name_index) : ""));

                stackmachine.SetCurrentAllocStats(&node->stats.allocstats);
                if (is_hit)
                    ++node->stats.hits;
        }

        if (profiledata.profile_coverage)
        {
                auto &map = profiledata.coverage_data[executionstate.library];
                if (!map.get())
                {
                        map.reset(new Blex::PodVector< uint8_t >());
                        map->resize(executionstate.library->GetWrappedLibrary().resident.code.size());
                        std::fill(map->begin(), map->end(), 0);
                }
                profiledata.library_coverage_map = map->size() ? &*map->begin() : nullptr;
        }
}

void VirtualMachine::PopFrameRaw()
{
        CallStackElement &el = callstack.back();

        executionstate.library = el.library;
        executionstate.function = el.function;
        executionstate.codeptr = el.codeptr;

        SPP_PRINT("Pop frame, type: " << el.type << ", after library: " << (void*)executionstate.library << ", function: " << (executionstate.library ?
            executionstate.library->GetWrappedLibrary().linkinfo.GetNameStr(executionstate.library->GetWrappedLibrary().FunctionList()[executionstate.function].name_index) : ""));

        callstack.pop_back();

        if (executionstate.library != NULL)
            SetStateShortcuts(false);
}


void VirtualMachine::PopFrame()
{
        CallStackElement &el = callstack.back();

        std::pair< LinkedLibrary::ResolvedFunctionDef const *, LinkedLibrary::ResolvedFunctionDef const * > funcs;
        funcs.second = &executionstate.library->GetLinkedLibrary().functiondefs[executionstate.function];

        // Don't count on return value being present when throwing.
        stackmachine.LeaveStackFrame(el.baseptr,
                                     funcs.second->def->resulttype == VariableTypes::NoReturn || is_unwinding ?0:1,
                                     funcs.second->def->parameters.size()); //ADDME: Would be prettier to put this info in the RET instruction

        if (profiledata.profile_functions)
        {
                uint64_t childtime = el.childtime;
                uint64_t createtime = el.createtime;

                PopFrameRaw();

                if (executionstate.library)
                    funcs.first = &executionstate.library->GetLinkedLibrary().functiondefs[executionstate.function];
                else
                    funcs.first = 0;

                int64_t totaltime = Blex::GetSystemCurrentTicks() - createtime;
                int64_t selftime = totaltime - childtime;

                std::pair< LinkedLibrary::ResolvedFunctionDef const *, LinkedLibrary::ResolvedFunctionDef const * > callee_funcs;
                callee_funcs.first = funcs.second;
                callee_funcs.second = 0;

                std::pair< LinkedLibrary::ResolvedFunctionDef const *, LinkedLibrary::ResolvedFunctionDef const * > caller_funcs;
                caller_funcs.first = funcs.first;
                caller_funcs.second = 0;

                ProfileData::FunctionProfile &callee_prof = profiledata.function_profiles[callee_funcs];
                ProfileData::FunctionProfile &caller_prof = profiledata.function_profiles[caller_funcs];

                for (CallStack::reverse_iterator it = callstack.rbegin(); it != callstack.rend(); ++it)
                    if (it->type == StackElementType::Return)
                    {
                        it->childtime += totaltime;
                        break;
                    }

//                int64_t old_totaltime = totaltime; // belongs with std::cout logging

                int64_t totaltime_callee_nr = totaltime;

                if (callee_prof.callcount != 0)
                    totaltime_callee_nr = 0;
                if (caller_prof.callcount && --caller_prof.callcount && callee_prof.callcount != 0)
                    totaltime = 0;

//                std::cout << "Popping frame from " << funcs.second->lib->GetLinkinfoNameStr(funcs.second->def->name_index) << " to " << funcs.first->lib->GetLinkinfoNameStr(funcs.first->def->name_index) << " t: " << totaltime << " tcn:" << totaltime_callee_nr << " s: " << selftime << " c: " << childtime << " child-cc: " << callee_prof.callcount << " (old tt: " << old_totaltime << ")" << std::endl;

                ProfileData::FunctionProfile &prof = profiledata.function_profiles[funcs];
                ++prof.callcount;
                prof.selftime  += selftime;
                prof.totaltime += totaltime;
                prof.totaltime_callee_nr += totaltime_callee_nr;
/*
                std::cout << "Current recorded data:" << std::endl;
                for (ProfileData::FunctionProfiles::iterator it = profiledata.function_profiles.begin(); it != profiledata.function_profiles.end(); ++it)
                {
                        std::cout << " " << it->first.first << " " << it->first.second << " " << it->second.callcount << " " << it->second.totaltime << " " << it->second.selftime <<
                                     "  (" << (it->first.first ? it->first.first->lib->GetLinkinfoNameStr(it->first.first->def->name_index).c_str() : "(nil)") <<
                                     " -> " << (it->first.second ? it->first.second->lib->GetLinkinfoNameStr(it->first.second->def->name_index).c_str() : "(nil)") << ")" << std::endl;
                }
//*/
        }
        else
            PopFrameRaw();
}

bool VirtualMachine::PopFrameEx(VirtualMachine **vm)
{
        if (callstack.empty())
            ThrowInternalError("Stack underflow");

        CallStackElement &el = callstack.back();
        switch (el.type)
        {
        case StackElementType::StopExecute:
                {
                        // No VM switch
                        if (vm)
                            *vm = 0;
                        PopFrameRaw();
                        return false;
                }
        case StackElementType::SwitchToOtherVM:
                {
                        bool switch_vm = el.vm != this;
                        if (switch_vm && vm)
                            *vm = el.vm;

                        PopFrameRaw();
                        return !switch_vm;
                }
        case StackElementType::ReturnToOtherVM:
                {
                        if (el.vm == this)
                        {
                                // Request to switch to own vm, ignore,
                                PopFrameRaw();
                                return true;
                        }
                        else
                        {
                                // Return VM to return to
                                if (vm)
                                    *vm = el.vm;

                                /* Don't pop frame if requesting to switch to other VM,
                                   it must be popped in target VM (popped executionstate is
                                   local to target VM)
                                */

                                // Pop function ptr parameters from target VM
                                el.vm->stackmachine.PopVariablesN(2);

                                // Other VM wants our return value; copy it and pop it here
                                el.vm->stackmachine.CopyFromOtherVM(
                                        el.vm,
                                        el.vm->stackmachine.PushVariables(1),
                                        this,
                                        stackmachine.StackPointer() - 1,
                                        true);
                                stackmachine.PopVariablesN(1);

                                return false;
                        }
                }
        case StackElementType::Dummy:
                {
                        PopFrameRaw();
                        return true;
                }
        case StackElementType::PopVariable:
                {
                        PopFrameRaw();
                        stackmachine.PopVariablesN(1);
                        return true;
                }
        case StackElementType::Return:
                {
                        PopFrame();
                        return true;
                }
        case StackElementType::TailCall:
                {
                        if (vm)
                            *vm = 0;

                        PopFrameRaw();
                        std::function< void(bool) > tailcall;
                        std::swap(tailcall, tailcalls.back());
                        tailcalls.pop_back();

                        tailcall(is_unwinding);
                        executionstate.codeptr = SignalCodeptr;
                        return true;
                }
        }
        ThrowInternalError("Illegal stack element type found");
        return false;
}

bool VirtualMachine::FillStackTraceElement(CallStackElement const &callstackelt, StackTraceElement *element, bool atinstr, bool full, VirtualMachine **currentvm)
{
        // Ignore types that have meaning in user-visible stack traces
        if (callstackelt.type == StackElementType::TailCall || callstackelt.codeptr < 0)
            return false;

        Library const *lib = callstackelt.library;
        if (lib)
        {
                SectionDebug const *debug = &lib->GetWrappedLibrary().debug;
                const FunctionDef &fdef = *lib->GetLinkedLibrary().functiondefs[callstackelt.function].def;
                LineColumn pos = fdef.definitionposition;

                if (debug && callstackelt.codeptr >= 0)
                {
                        // Might be at start of scheduled function (startup code does that)
                        if (fdef.codelocation == callstackelt.codeptr)
                            atinstr = true;

                        // Code ptr is increased automatically at bytecode fetch, so it pts to the next instruction (except at top frame!)
                        Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::const_iterator entry = debug->debugentries.UpperBound(callstackelt.codeptr - !atinstr);
                        if (entry != debug->debugentries.Begin())
                        {
                                --entry;
                                pos=entry->second;
                        }
                }

                //Strip mangled part from name (leave initial ':' if present)
                Blex::StringPair fullname = lib->GetLinkinfoName(fdef.name_index);
                fullname.end = std::find(fullname.begin+1,fullname.end,':');

                element->filename = lib->GetLibURI();
                element->position = pos;
                element->func = fullname.stl_str();
                element->codeptr = callstackelt.codeptr - !atinstr;
                element->baseptr = callstackelt.baseptr.GetId();

                if (currentvm)
                {
                        element->vm = *currentvm;
                        if (callstackelt.type == StackElementType::SwitchToOtherVM)
                            *currentvm = callstackelt.vm;
                }
                else
                    element->vm = 0;

                if (!(fdef.flags & FunctionFlags::SkipTrace) || full)
                    return true;
        }
        return false;
}


void VirtualMachine::GetStackTrace(std::vector< StackTraceElement > *elements, bool atinstr, bool full)
{
        bool push_frame = callstack.size() < MaxNesting - 1;
        if (push_frame)
        {
                CallStackElement &elt = PushFrameRaw(StackElementType::Dummy);
                elt.baseptr = stackmachine.GetBasePointer();
        }

        elements->clear();

        // Add the stack positions
        StackTraceElement spos;
        VirtualMachine *currentvm = 0;
        if (full)
            currentvm = vmgroup->currentvm;

        for (CallStack::reverse_iterator it = callstack.rbegin(); it != callstack.rend(); ++it)
        {
                if (FillStackTraceElement(*it, &spos, atinstr && it == callstack.rbegin(), full, full ? &currentvm : 0))
                    elements->push_back(spos);
        }

        // Pop the pushed frame (if it was pushed at all)
        if (push_frame)
            PopFrameRaw();
}

void VirtualMachine::GetRawAsyncStackTrace(AsyncStackTrace *trace, unsigned skipitems, std::shared_ptr< AsyncStackTrace > *prev_segment) const
{
        unsigned stop_elt = -1;

        auto &asynccontexts = vmgroup->asynccontexts;
        if (!asynccontexts.empty())
        {
                auto &context = asynccontexts.back();
                trace->depth = context.trace->depth + 1;
                stop_elt = context.callstack_depth;

                if (prev_segment)
                {
                    if ((trace->depth % ASYNC_STACK_DEPTH) == 0)
                    {
                            trace->parent_weak = context.trace;
                            *prev_segment = context.trace;
                    }
                    else
                    {
                            trace->parent = context.trace;
                            *prev_segment = context.prev_segment;
                    }
                }
                else
                    trace->parent = context.trace;
        }
        else
        {
               trace->parent.reset();
               if (prev_segment)
                    prev_segment->reset();
        }

        trace->trace.clear();
        if (!skipitems)
        {
                if (executionstate.library && executionstate.codeptr != SignalCodeptr && !skipitems)
                {
                        SectionDebug const *debug = &executionstate.library->GetWrappedLibrary().debug;
                        const FunctionDef &fdef = *executionstate.library->GetLinkedLibrary().functiondefs[executionstate.function].def;
                        bool atnextinstr = debug && fdef.codelocation != executionstate.codeptr;

                        AsyncStackTraceElt elt;
                        elt.library = executionstate.library;
                        elt.function = executionstate.function;
                        elt.codeptr = executionstate.codeptr - atnextinstr;
                        trace->trace.push_back(elt);
                }
        }
        else // skip executiionstate
            --skipitems;

        unsigned process_count = callstack.size() - stop_elt;
        for (CallStack::reverse_iterator it = callstack.rbegin(); it != callstack.rend(); ++it)
        {
                if (!process_count--)
                    break;

                if (skipitems)
                {
                        --skipitems;
                        continue;
                }

                // Ignore types that have meaning in user-visible stack traces
                if (it->type == StackElementType::TailCall || !it->library || it->codeptr < 0)
                    continue;


                SectionDebug const *debug = &it->library->GetWrappedLibrary().debug;
                const FunctionDef &fdef = *it->library->GetLinkedLibrary().functiondefs[it->function].def;
                bool atnextinstr = debug && fdef.codelocation != it->codeptr;

                if ((fdef.flags & FunctionFlags::SkipTrace))
                    continue;

                AsyncStackTraceElt elt;
                elt.library = it->library;
                elt.function = it->function;
                elt.codeptr = it->codeptr - atnextinstr;
                trace->trace.push_back(elt);
        }
}

void VirtualMachine::BuildAsyncStackTrace(AsyncStackTrace const &trace, std::vector< StackTraceElement > *elements)
{
        auto curr = &trace;
        bool add_async = false;
        std::shared_ptr< AsyncStackTrace > strong_ref;
        unsigned asynctraces = ASYNC_STACK_DEPTH + 1;
        while (curr && asynctraces)
        {
                --asynctraces;
                if (add_async)
                    elements->back().func += " (async)";

                add_async = false;
                for (auto &elt: curr->trace)
                {
                        SectionDebug const *debug = &elt.library->GetWrappedLibrary().debug;
                        const FunctionDef &fdef = *elt.library->GetLinkedLibrary().functiondefs[elt.function].def;
                        LineColumn pos = fdef.definitionposition;

                        if (debug && elt.codeptr >= 0)
                        {
                                // Code ptr is increased automatically at bytecode fetch, so it pts to the next instruction (except at top frame!)
                                Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::const_iterator entry = debug->debugentries.UpperBound(elt.codeptr);
                                if (entry != debug->debugentries.Begin())
                                {
                                        --entry;
                                        pos=entry->second;
                                }
                        }

                        //Strip mangled part from name (leave initial ':' if present)
                        Blex::StringPair fullname = elt.library->GetLinkinfoName(fdef.name_index);
                        fullname.end = std::find(fullname.begin+1,fullname.end,':');

                        StackTraceElement element;
                        element.filename = elt.library->GetLibURI();
                        element.position = pos;
                        element.func = fullname.stl_str();
                        element.codeptr = 0;
                        element.vm = 0;

                        elements->push_back(element);
                }

                if (!curr->trace.empty() && curr->depth)
                    add_async = true;

                if (!curr->parent.get())
                {
                       strong_ref = curr->parent_weak.lock();
                       curr = strong_ref.get();
                }
                else
                    curr = curr->parent.get();
        }

        if (add_async)
            elements->back().func += " (async)";
}

void VirtualMachine::RegisterLoadedResource(std::string const &toinsert)
{
        auto itr = std::lower_bound(loadedresources.begin(), loadedresources.end(), toinsert);
        if (itr == loadedresources.end() || *itr != toinsert)
            loadedresources.insert(itr, toinsert);
}

void VirtualMachine::PrepareStackTrace(VMRuntimeError *error)
{
        // Only record the stacktrace once per VM
        if (!vm_errorhandler.TryStartStacktracePrepare(this))
            return;

        std::vector< StackTraceElement > elements;
        GetStackTrace(&elements, false, false);
        for (std::vector< StackTraceElement >::const_iterator it = elements.begin(); it != elements.end(); ++it)
            vm_errorhandler.AddFilePositionToStackTrace(*it);

        // Patch up the error with the first (not skipped) position
        if (error)
        {
                ErrorHandler::StackTrace const &trace = vm_errorhandler.GetStackTrace();

                if (!trace.empty())
                {
                        error->func = trace.front().func;
                        error->filename = trace.front().filename;
                        error->position = trace.front().position;
                }
        }

        try
        {
                // Gather loaded libraries, store them in the error handler
                std::vector< std::string > resources = loadedresources;
                GetAllLibrariesUris(&resources);

                // Remove duplicates
                std::sort(resources.begin(), resources.end());
                resources.erase(std::unique(resources.begin(), resources.end()), resources.end());

                vm_errorhandler.SetLoadedResources(resources);
        }
        catch (VMRuntimeError &e)
        {
        }
}

int32_t VirtualMachine::GetScriptParameter_FileId()
{
        return execute_lib->GetWrappedLibrary().resident.scriptproperty_fileid;
}
Blex::DateTime VirtualMachine::GetScriptParameter_FileCreationDate()
{
        return execute_lib->GetWrappedLibrary().resident.scriptproperty_filecreationdate;
}
bool VirtualMachine::HasSystemRedirect()
{
        return execute_lib->GetWrappedLibrary().resident.scriptproperty_systemredirect;
}

Library const * VirtualMachine::GetLoadedLibrary(std::string const &uri, bool *fatal_error)
{
        *fatal_error = false;
        Library const *lib = libraryloader.GetWHLibrary(uri.empty() ? executionstate.library->GetLibURI() : uri);
        if (!lib)
        {
                lib = libraryloader.LoadWHLibrary(contextkeeper, uri.empty() ? executionstate.library->GetLibURI() : uri, current_init_lib);
                *fatal_error = true;
                lib->CheckForLinkErrors();

                if (MustLibsInitialize())
                {
                        if (current_init_lib) /* FIXME: Seems unlikely that this codepath will still do something? */
                        {
                                libraryloader.PushDeferredInitialization(current_init_lib);
                                DoLibsInitialize();
                                libraryloader.PopDeferredInitialization();
                        }
                        else
                            DoLibsInitialize();
                }
                *fatal_error = false;
        }

        return lib;
}

void VirtualMachine::GetLibraryInfo(std::string const &uri, LibraryInfo *info)
{
        libraryloader.GetWHLibraryInfo(contextkeeper, uri, info);
}

void VirtualMachine::GetLoadedLibrariesInfo(std::vector< LibraryInfo > *info)
{
        libraryloader.GetLoadedWHLibrariesInfo(contextkeeper, info);
}

void VirtualMachine::GetAllLibrariesInfo(std::vector< LibraryInfo > *info)
{
        libraryloader.GetAllWHLibrariesInfo(contextkeeper, info);
}

void VirtualMachine::GetAllLibrariesUris(std::vector< std::string > *uris)
{
        libraryloader.GetAllWHLibrariesUris(uris);
}

bool VirtualMachine::MustLibsInitialize()
{
        Library const *next = libraryloader.GetNextUninitializedLibrary();
        if (next != NULL && next != current_init_lib)
            return true;
        return false;
}

void VirtualMachine::DoLibsInitialize()
{
        //ADDME: Instead of the push/pop coordination with libraryloader, just walk the initlist in reverse?
        std::stack<Library const*> toinit;
        while(true)
        {
                Library const *lib = libraryloader.GetNextUninitializedLibrary();
                if(!lib)
                    break; //had them all

                // Initialize the global variables this library needs
                stackmachine.CreateMapping(lib->GetId(), lib->GetWrappedLibrary().resident.globalareasize);
                toinit.push(lib);
                libraryloader.PopUninitializedLibrary();
        }

        //Set up calls to their init functions (push in reverse of required execution order)
        for(;!toinit.empty();toinit.pop())
        {
                //ADDME: PrepareCall only prepares HareScript fuctions, not externals: but I don't think this is currently a problem (external initfunctions ?!)
                int32_t functionid = toinit.top()->GetWrappedLibrary().resident.initfunction;
                if (functionid != -1)
                    PrepareCall(*toinit.top(), functionid);
        }
}

void VirtualMachine::SetExecuteLibrary(const std::string &path)
{
        if (vmgroup)
            vmgroup->SetMainScript(path);

        //ADDME: should probably be a bit more clearer that we probably cna't deal with multiple SetExecuteLibrar calls
        executelibrary = path;
        execute_lib = libraryloader.LoadWHLibrary(contextkeeper, path, NULL);
        execute_lib->CheckForLinkErrors();
        // Set executionstate library to marker that no code is active (for pushing deinitholder frame)
        executionstate.library = NULL;
        //Prepare initializations required by this lib. Shouldn't invoke any startup functions yet (unless initfunctions decide to be external)
        SetupReturnStackframe();
        DoLibsInitialize();
}
std::string const& VirtualMachine::GetExecuteLibrary() const
{
        return executelibrary;
}
void VirtualMachine::OverrideExecuteLibrary(std::string const &path)
{
        executelibrary = path;
}

const char* VirtualMachine::GetCallingLibrary(unsigned to_skip, bool skip_system, Blex::DateTime *clib_modtime) const
{
        CallStack::const_iterator it = callstack.end();
        while (it != callstack.begin())
        {
                --it;
                if(to_skip>0)
                {
                        --to_skip;
                        continue;
                }
                Library const *lib = it->library;
                if(!lib || (skip_system && Blex::StrCaseLike(lib->GetLibURI(), "wh::*")))
                    continue;

                if (clib_modtime)
                    *clib_modtime = it->library->GetWrappedLibrary().resident.compile_id;

                return lib->GetLibURI().c_str();
        }
        return NULL;
}

void VirtualMachine::SetupReturnStackframe()
{
        PushStopExecuteFrame();
}
void VirtualMachine::CancelReturnStackframe() //only for dllinterface because it assumes the number of params is pushed
{
        // Remove stack frame
        PopFrameRaw();
}

std::string VirtualMachine::GenerateFunctionSignature(LinkedLibrary::ResolvedFunctionDef const *funcdef)
{
        std::string result;

        if (funcdef->def->resulttype == VariableTypes::NoReturn)
            result = "MACRO ";
        else
            result = GetTypeName(funcdef->def->resulttype) + " FUNCTION ";

        Blex::StringPair name = Mangling::GetFunctionName(funcdef->lib->GetLinkinfoName(funcdef->def->name_index).begin);
        unsigned hash_pos = std::find(name.begin, name.end, '#') - name.begin;
        bool is_obj = hash_pos != name.size();
        if (is_obj)
        {
                std::string stl_name = name.stl_str();
                stl_name[hash_pos] = ':';
                stl_name.insert(hash_pos, 1, ':');
                result += stl_name;
        }
        else
            result += name.stl_str();
        result += "(";
        bool first = true;
        bool is_vararg = funcdef->def->flags & FunctionFlags::VarArg;
        for (unsigned idx = 0, end = funcdef->def->parameters.size(); idx < end; ++idx)
        {
                if (idx == 0 && is_obj) // Skip :THIS, first parameter in object functions
                    continue;
                if (first)
                    first = false;
                else
                    result += ", ";
                if (is_vararg && idx == end - 1)
                {
                        result += "... ";
                }
                else
                {
                        result += GetTypeName(funcdef->def->parameters[idx].type);
                        result += " ";
                }
                std::string paramname = funcdef->lib->GetLinkinfoName(funcdef->def->parameters[idx].name_index).stl_str();
                Blex::ToLowercase(paramname.begin(), paramname.end());
                result += paramname;
        }
        result += ")";
        return result;
}

std::string VirtualMachine::GenerateFunctionPTRSignature(HSVM_VariableId functionptr, LinkedLibrary::ResolvedFunctionDef const *funcdef)
{
//        ColumnNameId col_parameters = columnnamemapper.GetMapping("PARAMETERS");
//        ColumnNameId col_source = columnnamemapper.GetMapping("SOURCE");
//        ColumnNameId col_type = columnnamemapper.GetMapping("TYPE");
//        ColumnNameId col_rettype = columnnamemapper.GetMapping("RETURNTYPE");
//        ColumnNameId col_excessargstype = columnnamemapper.GetMapping("EXCESSARGSTYPE");

        VarId params = stackmachine.RecordCellGetByName(functionptr, cn_cache.col_parameters);
        int32_t paramcount = stackmachine.ArraySize(params);
        VariableTypes::Type returntype = static_cast< VariableTypes::Type >(stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_returntype)));
        VariableTypes::Type excessargstype = static_cast< VariableTypes::Type >(stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_excessargstype)));
        int32_t first_unused_source = stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_firstunusedsource));

        // See if this a trivial function pointer. If so, we just print the signature of the pointed-to function
        typedef std::map< int32_t, std::tuple< unsigned, VariableTypes::Type, bool > > ArgumentMap;
        ArgumentMap args;

        bool non_trivial_fptr = !funcdef || excessargstype != 0; // No funcdef -> can't use it, show as function ptr
        for (int32_t i = 0; i < paramcount; ++i)
        {
                VarId param = stackmachine.ArrayElementGet(params, i);

                // Get the value to set
                int32_t source = stackmachine.GetInteger(stackmachine.RecordCellGetByName(param, cn_cache.col_source));

                if (source != i + 1)
                    non_trivial_fptr = true;

                if (source == 0)
                    continue;
                else
                {
                        int32_t abs_source = abs(source); // Keep 1-based

                        VariableTypes::Type type = static_cast< VariableTypes::Type >(stackmachine.GetInteger(stackmachine.RecordCellGetByName(param, cn_cache.col_type)));
                        args[abs_source] = std::make_tuple(i, type, abs_source < 0);
                }
        }

        // If we're calling a trivial function ptr (made from PTR function without rebinding) just show the normal function signature
        if (!non_trivial_fptr)
            return GenerateFunctionSignature(funcdef);

        std::string retval = "PTR ";

        // Name of the function
        Blex::StringPair name = Mangling::GetFunctionName(funcdef->lib->GetLinkinfoName(funcdef->def->name_index).begin);
        unsigned hash_pos = std::find(name.begin, name.end, '#') - name.begin;
        bool is_obj = hash_pos != name.size();
        if (is_obj)
        {
                std::string stl_name = name.stl_str();
                stl_name[hash_pos] = ':';
                stl_name.insert(hash_pos, 1, ':');
                retval += stl_name;
        }
        else
            retval += name.stl_str();
        retval += "(";

        for (int32_t i = 0; i < paramcount; ++i)
        {
                if (i)
                    retval += ", ";

                // Get the source for the param. 0 = fixed value, >0 arg nr., without default, <0 arg nr., with default
                VarId param = stackmachine.ArrayElementGet(params, i);
                int32_t source = stackmachine.GetInteger(stackmachine.RecordCellGetByName(param, cn_cache.col_source));

                if (source == 0)
                    retval += "fixed" + Blex::AnyToString(i + 1);
                else
                {
                        int32_t abs_source = abs(source); // Keep 1-based
                        retval += "#" + Blex::AnyToString(abs_source);

                        if (source < 0)
                            retval += " DEFAULTSTO fixed" + Blex::AnyToString(i + 1);
                }
        }

        if (excessargstype != VariableTypes::Uninitialized)
        {
                if (paramcount)
                    retval += ", ";
                retval += "#" + Blex::AnyToString(first_unused_source) + "...";
        }

        retval += "), with signature ";

        if (returntype == VariableTypes::NoReturn)
            retval += "MACRO ";
        else
            retval += GetTypeName(returntype) + " FUNCTION ";

        retval += "function_ptr(";

        bool is_vararg = funcdef->def->flags & FunctionFlags::VarArg;
        unsigned non_vararg_params = funcdef->def->parameters.size() - is_vararg;

        int32_t paramid = 1;
        bool has_param = false;
        for (ArgumentMap::iterator it = args.begin(); it != args.end(); ++it)
        {
                while (it->first > paramid)
                {
                        if (has_param)
                            retval += ", ";

                        retval += "VARIANT param" + Blex::AnyToString(paramid);
                        has_param = true;
                        ++paramid;
                }

                if (has_param)
                    retval += ", ";

                retval += GetTypeName(std::get< 1 >(it->second));
                retval += " ";
                if (std::get< 0 >(it->second) < non_vararg_params)
                {
                        std::string name = funcdef->lib->GetLinkinfoName(funcdef->def->parameters[std::get< 0 >(it->second)].name_index).stl_str();
                        Blex::ToLowercase(name.begin(), name.end());
                        retval += name;
                }
                else
                    retval += "param" + Blex::AnyToString(paramid);
                if (std::get< 2 >(it->second))
                    retval += " DEFAULTSTO <value>";

                has_param = true;
                ++paramid;
        }

        if (excessargstype != VariableTypes::Uninitialized)
        {
                if (has_param)
                    retval += ", ";

                retval += GetTypeName(excessargstype);
                retval += " varargs...";
        }
        retval += ")";

        return retval;
}



VirtualMachine * VirtualMachine::PrepareCallFunctionPtr(bool /*suspendable*/, bool allow_macro)
{
        VarId functionptr = stackmachine.StackPointer() - 1;
        VarId args = stackmachine.StackPointer() - 2;

        if (stackmachine.RecordSize(functionptr) == 0)
            throw VMRuntimeError(Error::CallingDefaultFunctionPtr);

//        ColumnNameId col_vm = columnnamemapper.GetMapping("VM");

        VirtualMachine *remote = stackmachine.GetVMRef(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_vm));
        if (remote != this)
        {
                if (!remote) // Shouldn't happen, but defensive programming.
                    throw VMRuntimeError (Error::InternalError, "Trying to call a function with an invalid VM ptr");

                StackMachine &remote_stackm = remote->stackmachine;

                VarId own_args = remote_stackm.PushVariables(2);
                VarId other_values = stackmachine.StackPointer() - 2;

                remote_stackm.CopyFromOtherVM(remote, own_args, this, other_values, true);
                remote_stackm.CopyFromOtherVM(remote, own_args + 1, this, other_values + 1, true);

                // Setup the stack frame that will return execution to this VM
                PushReturnToOtherVMFrame(this);

                // make sure when the remote VM returns from the called function, it will try to pop the return stack frame
                remote->executionstate.codeptr = SignalCodeptr;
                remote->PrepareCallFunctionPtr(false, allow_macro);
                return remote;
        }

        // FIXME: precalculate
//        ColumnNameId col_functionid = columnnamemapper.GetMapping("FUNCTIONID");
//        ColumnNameId col_libid = columnnamemapper.GetMapping("LIBID");
//        ColumnNameId col_parameters = columnnamemapper.GetMapping("PARAMETERS");
//        ColumnNameId col_source = columnnamemapper.GetMapping("SOURCE");
//        ColumnNameId col_value = columnnamemapper.GetMapping("VALUE");
//        ColumnNameId col_type = columnnamemapper.GetMapping("TYPE");
//        ColumnNameId col_rettype = columnnamemapper.GetMapping("RETURNTYPE");
//        ColumnNameId col_excessargstype = columnnamemapper.GetMapping("EXCESSARGSTYPE");

        LibraryId libid = stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_libid));
        int32_t functionid = stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_functionid));
        VariableTypes::Type excessargstype = static_cast< VariableTypes::Type >(stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_excessargstype)));
        int32_t firstunusedsource = stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_firstunusedsource));

        Library const *lib = libraryloader.GetWHLibraryById(libid);
        if (!lib)
            throw VMRuntimeError (Error::InternalError, "Function called in already unloaded library");

        // Check a little
        LinkedLibrary::ResolvedFunctionDefList const &deflist = lib->GetLinkedLibrary().functiondefs;
        if (functionid >= (signed)deflist.size())
            throw VMRuntimeError (Error::UnknownFunction, "#" + Blex::AnyToString(functionid), lib->GetLibURI());

        VariableTypes::Type returntype = (VariableTypes::Type)stackmachine.GetInteger(stackmachine.RecordCellGetByName(functionptr, cn_cache.col_returntype));
        //A function pointer always returns a value, so if we're executing a macro, just put that returnvalue on the stack ourselves
        if (returntype == VariableTypes::NoReturn)
        {
                if (!allow_macro)
                    throw VMRuntimeError(Error::MacroDoesNotReturnValue);

                stackmachine.SetInteger(stackmachine.PushVariables(1), -1); //translate no-return values to an integer -1 return (FIXME?!!)
        }

        VarId params = stackmachine.RecordCellGetByName(functionptr, cn_cache.col_parameters);

        // Get the arguments count and the function ptr arguments count
        int32_t paramcount = stackmachine.ArraySize(params);
        int32_t argcount = stackmachine.ArraySize(args);

        // See if the function is vararg, and get the real nr of parameters
        bool is_vararg = deflist[functionid].def->flags & FunctionFlags::VarArg;
        std::vector< FunctionDef::Parameter > const &parameters = deflist[functionid].def->parameters;
        unsigned real_paramcount = parameters.size();

        VarId vararg = 0;
        VariableTypes::Type varargtype = VariableTypes::Variant;
        if (is_vararg)
        {
                // Push the vararg array first; the last argument is always pushed first.
                vararg = stackmachine.PushVariables(1);
                stackmachine.InitVariable(vararg, deflist[functionid].def->parameters.back().type);
                varargtype = ToNonArray(parameters[real_paramcount - is_vararg].type);
        }
        else if (paramcount > (signed)real_paramcount)
            ThrowInternalError("Bound a non-vararg function with too many parameters");

        // Walk the fptr parameters from last to first (that is the pushing order)
        for (unsigned i = paramcount; i > 0; --i)
        {
                // Fptr param record
                VarId param = stackmachine.ArrayElementGet(params, i - 1);

                // Value to push
                VarId value = 0;

                // Type in fptr and type of function parameter may differ: keep 'm both
                VariableTypes::Type type = VariableTypes::Variant;
                VariableTypes::Type realtype = VariableTypes::Variant;

                // Is this a vararg param? If so, default value is not required
                bool is_varargparam = i > real_paramcount - is_vararg;

                // Get the value to set
                int32_t source = stackmachine.GetInteger(stackmachine.RecordCellGetByName(param, cn_cache.col_source));
                if (source == 0)
                {
                        // Bound to static value. Copied later, so we won't need a ref
                        value = stackmachine.RecordCellGetByName(param, cn_cache.col_value);
                }
                else
                {
                        // Get source parameter (negative means there is a default)
                        int32_t abs_source = abs(source) - 1;

                        if (abs_source < argcount)
                        {
                                // Using argument directly. Copied later, so we won't need a ref
                                type = static_cast< VariableTypes::Type >(stackmachine.GetInteger(stackmachine.RecordCellGetByName(param, cn_cache.col_type)));
                                value = stackmachine.ArrayElementGet(args, abs_source);
                        }
                        else
                        {
                                // No argument for this param. Is there a default in the fptr? Copied later, so we won't need a ref
                                if (source < 0)
                                    value = stackmachine.RecordCellGetByName(param, cn_cache.col_value);
                                else
                                    throw VMRuntimeError(Error::ParameterCountWrong, GenerateFunctionPTRSignature(functionptr, &deflist[functionid]));

                                if (!value && is_varargparam)
                                    continue;
                        }
                }

                // See where to insert
                VarId newelt;
                if (is_varargparam)
                {
                        // Must be put into vararg (at 0, because we walk back-to-front here)
                        newelt = stackmachine.ArrayElementInsert(vararg, 0);
                        stackmachine.CopyFrom(newelt, value);
                        realtype = varargtype;
                }
                else
                {
                        // Direct parameter, copy
                        newelt = stackmachine.PushCopy(value);
                }

                try
                {
                        // Do the casts (here, because a variable may be used multiple times, with and without a cast).
                        stackmachine.CastTo(newelt, type);
                        if (realtype != type && realtype != VariableTypes::Variant)
                            stackmachine.CastTo(newelt, realtype);
                }
                catch (VMRuntimeError &)
                {
                        AddRelevantFunctionError(GenerateFunctionPTRSignature(functionptr, &deflist[functionid]));
                        throw;
                }
        }

        //DEBUGPRINT("Call argcount " << argcount << " fus " << firstunusedsource << " eat " << excessargstype);

        if (argcount && argcount >= firstunusedsource)
        {
                // More arguments presented that asked for?
                if (!is_vararg || excessargstype == VariableTypes::Uninitialized)
                    throw VMRuntimeError(Error::ParameterCountWrong, GenerateFunctionPTRSignature(functionptr, &deflist[functionid]));

                // Add the last into the vararg
                for (int32_t i = firstunusedsource - 1; i < argcount; ++i)
                {
                        VarId arg = stackmachine.ArrayElementRef(args, i);
                        try
                        {
                                stackmachine.CastTo(arg, excessargstype); // args is VARIANT ARRAY: allowed.
                        }
                        catch (VMRuntimeError &)
                        {
                                AddRelevantFunctionError(GenerateFunctionPTRSignature(functionptr, &deflist[functionid]));
                                throw;
                        }

                        VarId newelt = stackmachine.ArrayElementAppend(vararg);
                        stackmachine.CopyFrom(newelt, arg);
                }
        }

        stackmachine.PopDeepVariables(2, real_paramcount + (returntype == VariableTypes::NoReturn?1:0));

        //ADDME: Proper returntype matching would be easier if the expected return type was passed as a paramter to CallFunctionRef ?
        /* To make sure that Run() terminates after running the new functions
           we save the execution state and set executionstate.library to NULL.
           Otherwise Run() would just keep running.

           I don't think we can use a stackframe for this, as it would mess
           up the base pointer? */

        PrepareCall(*lib, functionid);

        /* OLD RETURN HANDLER
        if (returntype == VariableTypes::NoReturn)
            stackmachine.SetInteger(stackmachine.PushVariables(1), -1); //translate no-return values to an integer -1 return (FIXME!)

        stackmachine.PopDeepVariables(2, 1);
        */
        return 0;
}

uint8_t inline VirtualMachine::ReadByteFromCode()
{
        return executionstate.code[executionstate.codeptr++];
}

int32_t inline VirtualMachine::ReadIdFromCode()
{
        int32_t retval = Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr]);
        executionstate.codeptr += 4;
        return retval;
}

template< bool debug >
  InstructionSet::_type inline VirtualMachine::ReadInstructionFromCode()
{
        InstructionSet::_type code = static_cast<InstructionSet::_type>(executionstate.code[executionstate.codeptr]);
        if (debug && profiledata.library_coverage_map)
            profiledata.library_coverage_map[executionstate.codeptr] = 1;
        ++executionstate.codeptr;
        return code;
}

inline void VirtualMachine::MoveCodePtr(signed diff)
{
//        std::cout << "Jump taken from " << executionstate.codeptr << " to " <<executionstate.codeptr+diff <<"\n";
        executionstate.codeptr+=diff;
}

void VirtualMachine::ShowStackState(bool debugmode)
{
#if defined(SHOWSTACK) || defined(SHOWCALLSTACK)
        std::cerr << "\n";
#endif
        if (debugmode)
            std::cerr << "(debug runtime) ";
#ifdef SHOWCALLSTACK
        std::cerr << "callstack of " << this << "\n";
        unsigned css = callstack.size();
        unsigned plen = css;
#ifdef LIMITCALLSTACK
        plen = std::min(css, 8U);
#endif
        if (plen != css)
            std::cerr << " ...\n";
        for (Blex::PodVector< CallStackElement >::iterator it = callstack.end() - plen, end = callstack.end(); it != end; ++it)
        {
                SectionDebug const *debug = 0;
                if (it->library)
                    debug = &it->library->GetWrappedLibrary().debug;
                if (debug)
                {
                        if (it->codeptr == SignalCodeptr)
                            std::cerr << " " << it->library->GetLibURI() << ":signal";
                        else
                        {
                                LineColumn position = (debug->debugentries.UpperBound(it->codeptr)-1)->second;
                                std::cerr << " " << it->library->GetLibURI() << ":" << position.line << "," << position.column << " (" << it->codeptr << ")";
                        }
                }
                else
                    std::cerr << " (NONE)";
                if ((it->type == StackElementType::ReturnToOtherVM || it->type == StackElementType::SwitchToOtherVM) && it->vm != 0)
                    std::cerr << " type: " << it->type << " (" << it->vm << ")";
                else
                    std::cerr << " type: " << it->type;
                std::cerr << "\n";
        }
#endif
#ifdef SHOWSTACK
        VarId sptr = stackmachine.StackPointer();
        std::cerr << "stack: (bp:" << stackmachine.GetBasePointer().GetId() << ") ";
        for (VarId idx = stackmachine.StackStart(); idx < sptr; ++idx)
            std::cerr << "(" << std::setw(4) << (static_cast<int64_t>(idx)-LocalStackMiddle) << ":" << idx << ")" << VarWrapper<VarPrinterPrintType::Default>(stackmachine, idx, true) << ", ";
        std::cerr << "\n";
#endif
#ifdef INDENTBYTECODES
        std::cerr << std::string(callstack.size(), ' ');
#endif
        if (executionstate.codeptr == SignalCodeptr)
        {
                std::cerr << "Code: SIGNAL";
        }
        else
        {
                InstructionSet::_type code = static_cast<InstructionSet::_type>(executionstate.code[executionstate.codeptr]);
                std::cerr << "Code: (" << (executionstate.codeptr) << ")";
                switch (code){
                case InstructionSet::CALL:
                        {
                                int32_t fid=Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1]);
                                LinkedLibrary::ResolvedFunctionDef const & fdef =
                                        executionstate.library->GetLinkedLibrary().functiondefs[fid];
                                unsigned nid=fdef.def->name_index;
                                std::cerr << code << " " << fid << " (" << fdef.lib->GetLinkinfoName(nid).stl_str() << ")";
                        } break;
        //        std::cerr<<code<<" "<<Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1])<< " ("<<(executionstate.library->GetLinkedLibrary().functiondefs[Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1])].def->name_index)<<")";break;
                case InstructionSet::JUMP:
                case InstructionSet::JUMPC:
                case InstructionSet::JUMPC2:
                case InstructionSet::JUMPC2F:
                case InstructionSet::LOADC:
                case InstructionSet::LOADCI:
                case InstructionSet::LOADS:
                case InstructionSet::STORES:
                case InstructionSet::LOADSD:
                case InstructionSet::LOADG:
                case InstructionSet::LOADGD:
                case InstructionSet::STOREG:
                case InstructionSet::DESTROYS:
                case InstructionSet::COPYS:
                        std::cerr << code << " " << Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1]); break;
                case InstructionSet::LOADCB:
                        std::cerr << code << " " << executionstate.code[executionstate.codeptr+1]; break;
                case InstructionSet::RECORDCELLGET:
                case InstructionSet::RECORDCELLSET:
                case InstructionSet::RECORDCELLDELETE:
                case InstructionSet::RECORDCELLUPDATE:
                case InstructionSet::RECORDCELLCREATE:
                case InstructionSet::OBJMEMBERDELETE:
                case InstructionSet::OBJMEMBERDELETETHIS:
                        {
                                int32_t nameid_lib = Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1]);
                                ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[nameid_lib];
                                std::cerr << code << " " << columnnamemapper.GetReverseMapping(nameid).stl_str();
                        } break;
                case InstructionSet::OBJMEMBERINSERT:
                case InstructionSet::OBJMEMBERINSERTTHIS:
                        {
                                int32_t nameid_lib = Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1]);
                                ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[nameid_lib];
                                bool is_private = executionstate.code[executionstate.codeptr+5];
                                std::cerr << code << (is_private ? " PRIVATE " : " PUBLIC ") << columnnamemapper.GetReverseMapping(nameid).stl_str();
                        } break;
                case InstructionSet::OBJMETHODCALL:
                case InstructionSet::OBJMETHODCALLTHIS:
                case InstructionSet::OBJMETHODCALLNM:
                case InstructionSet::OBJMETHODCALLTHISNM:
                        {
                                int32_t nameid_lib = Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+1]);
                                ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[nameid_lib];
                                std::cerr << code << " " << columnnamemapper.GetReverseMapping(nameid).stl_str() << " params:";
                                std::cerr << Blex::GetLsb<int32_t>(&executionstate.code[executionstate.codeptr+5]);
                        } break;
                default:
                    std::cerr << code;
                };
        }
        SectionDebug const *debug = 0;
        if (executionstate.library)
            debug = &executionstate.library->GetWrappedLibrary().debug;
        if (debug)
        {
                LineColumn position = (debug->debugentries.UpperBound(executionstate.codeptr)-1)->second;
                std::cerr << " " << executionstate.library->GetLibURI() << ":" << position.line << "," << position.column;
        }
        std::cerr << std::endl;
}

bool VirtualMachine::AddCallToNextDeinitFunction()
{
        bool found_deinit = false;
        Library const *lib;
        while (true)
        {
                lib = libraryloader.GetNextInitializedLibrary();
                if (!lib)
                    break;

                //DEBUGPRINT("Deinitializing library " << lib->GetLibURI());
                libraryloader.PopInitializedLibrary();

                int32_t functionid = lib->GetWrappedLibrary().resident.deinitfunction;
                if (functionid != -1)
                {
                        PrepareCall(*lib, functionid);
                        found_deinit = true;
                        break;
                }
        }
        return found_deinit;
}

bool VirtualMachine::HandleAbortFlag()
{
        volatile unsigned *flag = vmgroup->GetAbortFlag();
        if (*flag == HSVM_ABORT_YIELD)
        {
                if (!is_suspendable)
                    return false;
                vmgroup->GetJobManager()->YieldVMWithoutSuspend(this);
                *flag = HSVM_ABORT_DONT_STOP;
        }
        return true;
}

template< bool debug >
  VirtualMachine * VirtualMachine::RunInternal(bool allow_deinit)
{
        assert(executionstate.codeptr >= -2);
        is_suspended = false;
        bool first_item = true;


        try
        {
//                if(executionstate.library!=NULL && executionstate.codeptr==-1 /* returning from suspending function */)
//                    PopFrame();

                while (true) //executing a ..
                {
                        if (executionstate.codeptr == SignalCodeptr)
                        {
                                // Frame pop may place another tailcall on top of the stack, must check if there are errors to avoid endless loops
                                if (vm_errorhandler.AnyErrors() || (vmgroup->TestMustYield() && HandleAbortFlag()))
                                    return 0;

                                if (debug)
                                    first_item = false;

                                SHOWSTATE;

                                VirtualMachine *switch_to;
                                if (!PopFrameEx(&switch_to))
                                {
                                        SHOWSTATE;
                                        if (switch_to)
                                            return switch_to;
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            break;

                                        if (callstack.empty() && allow_deinit)
                                        {
                                                // Not going to run deinit macros on an uncaught exception
                                                if (is_unwinding)
                                                    break;

                                                PushStopExecuteFrame();
                                                if (!AddCallToNextDeinitFunction())
                                                    break;
                                        }
                                        else
                                            break;
                                }
                                else if (is_unwinding) // tailcall may have caused exception
                                    UnwindToNextCatch(false);
                                else
                                    continue; // Check codeptr again for repeated signals
                        }

                        SHOWSTATE;

                        if (debug)
                        {
                                bool manualbreakpoint = false;
                                unsigned callstacksize = callstack.size();
                                bool stop = callstacksize < vmgroup->dbg.min_stack;
                                stop = stop || callstacksize > vmgroup->dbg.max_stack;
                                if (!stop && !first_item)
                                {
                                          uint8_t const *codeptr = &executionstate.code[executionstate.codeptr];
                                          auto it = vmgroup->dbg.breakpoints.find(codeptr);
                                          if (it != vmgroup->dbg.breakpoints.end())
                                          {
                                                  do
                                                  {
                                                          if (it->second.first < 0 || static_cast< unsigned >(it->second.first) == callstacksize)
                                                          {
                                                                  stop = true;
                                                                  manualbreakpoint = manualbreakpoint || it->second.second;
                                                          }
                                                          ++it;
                                                  } while (it != vmgroup->dbg.breakpoints.end() && it->first == codeptr);
                                          }
                                }

                                if (stop)
                                {
                                        vmgroup->jobmanager->GetDebugger().OnScriptBreakpointHit(*vmgroup, manualbreakpoint);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                }
                                first_item = false;
                        }

                        InstructionSet::_type code = ReadInstructionFromCode< debug >();
                        switch (code)
                        {
                        case InstructionSet::NOP:
                                break;
                        case InstructionSet::CALL:
                                PrepareCall(*executionstate.library, ReadIdFromCode());
                                if (vmgroup->TestMustYield() && HandleAbortFlag())
                                    return 0;
                                break;

                        case InstructionSet::RET:
                                //DoRet();
                                executionstate.codeptr = SignalCodeptr;
                                if (vmgroup->TestMustYield() && HandleAbortFlag())
                                    return 0;
                                break;

                        case InstructionSet::JUMP:
                                MoveCodePtr(ReadIdFromCode());
                                if (vmgroup->TestMustYield() && HandleAbortFlag())
                                    return 0;
                                break;

                        case InstructionSet::JUMPC:
                                DoJumpC(ReadIdFromCode());
                                if (vmgroup->TestMustYield() && HandleAbortFlag())
                                    return 0;
                                break;

                        case InstructionSet::JUMPC2:
                                DoJumpC2(ReadIdFromCode());
                                if (vmgroup->TestMustYield() && HandleAbortFlag())
                                    return 0;
                                break;

                        case InstructionSet::JUMPC2F:
                                DoJumpC2F(ReadIdFromCode());
                                if (vmgroup->TestMustYield() && HandleAbortFlag())
                                    return 0;
                                break;

                        case InstructionSet::DUP:               DoDup(); break;
                        case InstructionSet::POP:               DoPop(); break;
                        case InstructionSet::SWAP:              DoSwap(); break;

                        case InstructionSet::CMP:               DoCmp(); break;
                        case InstructionSet::CMP2:              DoCmp2(); break;

                        case InstructionSet::LOADC:             DoLoadC(ReadIdFromCode()); break;
                        case InstructionSet::LOADCB:            DoLoadCB(ReadByteFromCode()); break;
                        case InstructionSet::LOADS:             DoLoadS(ReadIdFromCode()); break;
                        case InstructionSet::STORES:            DoStoreS(ReadIdFromCode()); break;
                        case InstructionSet::LOADG:             DoLoadG(ReadIdFromCode()); break;
                        case InstructionSet::STOREG:            DoStoreG(ReadIdFromCode()); break;
                        case InstructionSet::LOADSD:            DoLoadSD(ReadIdFromCode()); break;
                        case InstructionSet::LOADGD:            DoLoadGD(ReadIdFromCode()); break;
                        case InstructionSet::DESTROYS:          DoDestroyS(ReadIdFromCode()); break;
                        case InstructionSet::COPYS:             DoCopyS(ReadIdFromCode()); break;

                        case InstructionSet::ISDEFAULTVALUE:    stackmachine.Stack_TestDefault(false); break;
                        case InstructionSet::ISVALUESET:        stackmachine.Stack_TestDefault(true); break;
                        case InstructionSet::LOADCI:            DoLoadCI(ReadIdFromCode()); break;

                        case InstructionSet::PRINT:             DoPrint(); break;
                        case InstructionSet::THROW:             DoPrint(); throw VMRuntimeError (Error::CustomError,"THROW instruction");
                        case InstructionSet::THROW2:            DoThrow2(); break;

                        case InstructionSet::INITVAR:           DoEmptyLoad(static_cast<VariableTypes::Type>(ReadIdFromCode())); break;

                        case InstructionSet::ADD:               stackmachine.Stack_Arith_Add(); break;
                        case InstructionSet::SUB:               stackmachine.Stack_Arith_Sub(); break;
                        case InstructionSet::MUL:               stackmachine.Stack_Arith_Mul(); break;
                        case InstructionSet::DIV:               stackmachine.Stack_Arith_Div(); break;
                        case InstructionSet::MOD:               stackmachine.Stack_Arith_Mod(); break;
                        case InstructionSet::NEG:               stackmachine.Stack_Arith_Neg(); break;

                        case InstructionSet::AND:               stackmachine.Stack_Bool_And(); break;
                        case InstructionSet::OR:                stackmachine.Stack_Bool_Or(); break;
                        case InstructionSet::XOR:               stackmachine.Stack_Bool_Xor(); break;
                        case InstructionSet::NOT:               stackmachine.Stack_Bool_Not(); break;

                        case InstructionSet::ARRAYINDEX:        DoArrayIndex(); break;
                        case InstructionSet::ARRAYSIZE:         DoArraySize(); break;
                        case InstructionSet::ARRAYINSERT:       DoArrayInsert(); break;
                        case InstructionSet::ARRAYSET:          DoArraySet(); break;
                        case InstructionSet::ARRAYDELETE:       DoArrayDelete(); break;
                        case InstructionSet::ARRAYAPPEND:       DoArrayAppend(); break;
                        case InstructionSet::ARRAYDELETEALL:    DoArrayDeleteAll(); break;

                        case InstructionSet::BITAND:            stackmachine.Stack_Bit_And(); break;
                        case InstructionSet::BITOR:             stackmachine.Stack_Bit_Or(); break;
                        case InstructionSet::BITXOR:            stackmachine.Stack_Bit_Xor(); break;
                        case InstructionSet::BITNEG:            stackmachine.Stack_Bit_Neg(); break;
                        case InstructionSet::BITLSHIFT:         stackmachine.Stack_Bit_ShiftLeft(); break;
                        case InstructionSet::BITRSHIFT:         stackmachine.Stack_Bit_ShiftRight(); break;

                        case InstructionSet::MERGE:             stackmachine.Stack_String_Merge(); break;
                        case InstructionSet::DEEPSET:           DoDeepOperation(DeepOperation::Set, false); break;
                        case InstructionSet::DEEPSETTHIS:       DoDeepOperation(DeepOperation::Set, true); break;
                        case InstructionSet::DEEPARRAYAPPEND:   DoDeepOperation(DeepOperation::Append, false); break;
                        case InstructionSet::DEEPARRAYAPPENDTHIS: DoDeepOperation(DeepOperation::Append, true); break;
                        case InstructionSet::DEEPARRAYINSERT:   DoDeepOperation(DeepOperation::Insert, false); break;
                        case InstructionSet::DEEPARRAYINSERTTHIS: DoDeepOperation(DeepOperation::Insert, true); break;
                        case InstructionSet::DEEPARRAYDELETE:   DoDeepOperation(DeepOperation::Delete, false); break;
                        case InstructionSet::DEEPARRAYDELETETHIS: DoDeepOperation(DeepOperation::Delete, true); break;
                        case InstructionSet::CAST:              stackmachine.Stack_CastTo(static_cast<VariableTypes::Type>(ReadIdFromCode())); break;
                        case InstructionSet::CASTF:             stackmachine.Stack_ForcedCastTo(static_cast<VariableTypes::Type>(ReadIdFromCode())); break;
                        case InstructionSet::CONCAT:            stackmachine.Stack_Concat(); break;
                        case InstructionSet::ISIN:              stackmachine.Stack_In(); break;
                        case InstructionSet::LIKE:              stackmachine.Stack_Like(); break;
                        case InstructionSet::CASTPARAM:
                                {
                                        VariableTypes::Type type = static_cast<VariableTypes::Type>(ReadIdFromCode()); // Keep them apart with ; (C++ sequence points!)
                                        int32_t id2 = ReadIdFromCode();
                                        DoCastParam(type, id2);
                                } break;

                        case InstructionSet::RECORDCELLGET:     DoRecordCellGet(ReadIdFromCode()); break;
                        case InstructionSet::RECORDCELLSET:     DoRecordCellSet(ReadIdFromCode(), false, false); break;
                        case InstructionSet::RECORDCELLCREATE:  DoRecordCellSet(ReadIdFromCode(), true, true); break;
                        case InstructionSet::RECORDCELLUPDATE:  DoRecordCellSet(ReadIdFromCode(), true, false); break;
                        case InstructionSet::RECORDCELLDELETE:  DoRecordCellDelete(ReadIdFromCode()); break;
                        case InstructionSet::RECORDMAKEEXISTING:DoRecordMakeExisting(); break;

                        case InstructionSet::LOADTYPEID:        DoLoadTypeId(ReadIdFromCode()); break;
                        case InstructionSet::INITFUNCTIONPTR :  DoInitFunctionPtr(); break;
                        case InstructionSet::INVOKEFPTR:
                                {
                                        VirtualMachine *remote = DoInvokeFptr(true);
                                        if (remote) // Need to switch to another VM
                                            return remote;
                                } break;
                        case InstructionSet::INVOKEFPTRNM:
                                {
                                        VirtualMachine *remote = DoInvokeFptr(false);
                                        if (remote) // Need to switch to another VM
                                            return remote;
                                } break;

                        case InstructionSet::YIELD:             DoYield(); break;

                        case InstructionSet::OBJNEW:            DoObjNew(); break;
                        case InstructionSet::OBJMEMBERGET:
                                {
                                        DoObjMemberGet(ReadIdFromCode(), false);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMEMBERGETTHIS:
                                {
                                        DoObjMemberGet(ReadIdFromCode(), true);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMEMBERSET:
                                {
                                        DoObjMemberSet(ReadIdFromCode(), false);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMEMBERSETTHIS:
                                {
                                        DoObjMemberSet(ReadIdFromCode(), true);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMEMBERINSERT:
                                {
                                        int32_t id1 = ReadIdFromCode(); // Keep them apart with ; (C++ sequence points!)
                                        bool bool2 = ReadByteFromCode();
                                        DoObjMemberInsert(id1, bool2, false);
                                } break;
                        case InstructionSet::OBJMEMBERINSERTTHIS:
                                {
                                        int32_t id1 = ReadIdFromCode(); // Keep them apart with ; (C++ sequence points!)
                                        bool bool2 = ReadByteFromCode();
                                        DoObjMemberInsert(id1, bool2, true);
                                } break;
                        case InstructionSet::OBJMEMBERDELETE:       DoObjMemberDelete(ReadIdFromCode(), false); break;
                        case InstructionSet::OBJMEMBERDELETETHIS:   DoObjMemberDelete(ReadIdFromCode(), true); break;
                        case InstructionSet::OBJMETHODCALL:
                                {
                                        int32_t id1 = ReadIdFromCode(); // Keep them apart with ; (C++ sequence points!)
                                        int32_t id2 = ReadIdFromCode();
                                        DoObjMethodCall(id1, id2, false, true);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMETHODCALLTHIS:
                                {
                                        int32_t id1 = ReadIdFromCode(); // Keep them apart with ; (C++ sequence points!)
                                        int32_t id2 = ReadIdFromCode();
                                        DoObjMethodCall(id1, id2, true, true);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMETHODCALLNM:
                                {
                                        int32_t id1 = ReadIdFromCode(); // Keep them apart with ; (C++ sequence points!)
                                        int32_t id2 = ReadIdFromCode();
                                        DoObjMethodCall(id1, id2, false, false);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJMETHODCALLTHISNM:
                                {
                                        int32_t id1 = ReadIdFromCode(); // Keep them apart with ; (C++ sequence points!)
                                        int32_t id2 = ReadIdFromCode();
                                        DoObjMethodCall(id1, id2, true, false);
                                        if (vmgroup->TestMustYield() && HandleAbortFlag())
                                            return 0;
                                } break;
                        case InstructionSet::OBJSETTYPE:        DoObjSetType(); break;
                        case InstructionSet::OBJMAKEREFPRIV:    DoObjMakeRefPrivileged(); break;
                        case InstructionSet::OBJMEMBERISSIMPLE: DoObjMemberIsSimple(); break;
                        case InstructionSet::OBJTESTNONSTATIC:  DoObjTestNonStatic(false); break;
                        case InstructionSet::OBJTESTNONSTATICTHIS:  DoObjTestNonStatic(true); break;

                        default:
                            ThrowIllegalOpcode(code);
                        }
                        ++profiledata.instructions_executed;
                }
        }
        catch (VMRuntimeError &e)
        {
                //Prepare stack trace. Check for handling of calls into weblets and from c-functions!
                PrepareStackTrace(&e);
                throw;
        }
        return 0;
}

void VirtualMachine::UnwindToNextCatch(bool push_frame)
{
        if (push_frame)
            PushFrame(0);

        StackTraceElement spos;
        ColumnNameId trace = 0;
        VarId tracevar = 0;

        ColumnNameId file = 0;
        ColumnNameId func = 0;
        ColumnNameId line = 0;
        ColumnNameId col = 0;

        if (stackmachine.ObjectExists(throwvar))
        {
                trace = columnnamemapper.GetMapping("PVT_TRACE");
                if (ObjectMemberExists(throwvar, trace) &&
                        ObjectMemberType (throwvar, trace) == ObjectCellType::Member &&
                        stackmachine.ObjectMemberType (throwvar, trace) == VariableTypes::RecordArray)
                {
                        tracevar = stackmachine.ObjectMemberRef(throwvar, trace, true);
                        file = columnnamemapper.GetMapping("FILENAME");
                        func = columnnamemapper.GetMapping("FUNC");
                        line = columnnamemapper.GetMapping("LINE");
                        col = columnnamemapper.GetMapping("COL");
                }
        }


        while (!callstack.empty())
        {
                CallStackElement &el = callstack.back();

                // Exception cannot pass VM boundaries
                if (el.type == StackElementType::ReturnToOtherVM || el.type == StackElementType::SwitchToOtherVM)
                    AbortForUncaughtException();

                if (el.type == StackElementType::StopExecute)
                {
                        // Must return to calling function.
                        executionstate.codeptr = SignalCodeptr;
                        return;
                }

                if (!skip_first_traceitem)
                {
                        if (tracevar && FillStackTraceElement(el, &spos, false, false, 0))
                        {
                                VarId elt = stackmachine.ArrayElementAppend(tracevar);
                                stackmachine.RecordInitializeEmpty(elt);

                                stackmachine.SetSTLString(stackmachine.RecordCellCreate(elt, file), spos.filename);
                                stackmachine.SetInteger(stackmachine.RecordCellCreate(elt, line), spos.position.line);
                                stackmachine.SetInteger(stackmachine.RecordCellCreate(elt, col), spos.position.column);
                                stackmachine.SetSTLString(stackmachine.RecordCellCreate(elt, func), spos.func);
                        }
                }
                else
                    skip_first_traceitem = false;

                if (el.library && el.codeptr != SignalCodeptr)
                {
                        SectionExceptions const &exceptions = el.library->GetWrappedLibrary().exceptions;
                        Blex::MapVector<uint32_t, SectionExceptions::UnwindInfo>::const_iterator it = exceptions.unwindentries.Find(el.codeptr);

                        if (it != exceptions.unwindentries.End())
                        {
                                // Pop dummy frames with the right pop function! They're pushed by generator resume by throw.
                                // The variable pops may also cause crashes, and we're correcting the stack position anyway
                                if (el.type == StackElementType::Dummy || el.type == StackElementType::PopVariable)
                                    PopFrameRaw();
                                else
                                    PopFrame();

                                // Redirect code execution to catch block, and restore the stack size
                                executionstate.codeptr = it->second.target;
                                stackmachine.SetLocalStackSize(it->second.stacksize);
                                is_unwinding = false;
                                return;
                        }
                }

                // Ignore suspend frames: function that wanted to suspend is broken off by the exception
                PopFrameEx(0);
        }

        if (callstack.empty())
            AbortForUncaughtException();
}

void VirtualMachine::AbortForUncaughtException()
{
        if (is_unwinding)
        {
                is_unwinding = false;

                bool has_msg = false;
                std::string name;
                std::string msg;

                if (stackmachine.ObjectExists(throwvar))
                {
                        ColumnNameId trace = columnnamemapper.GetMapping("PVT_TRACE");
                        if (ObjectMemberExists(throwvar, trace) &&
                                ObjectMemberType (throwvar, trace) == ObjectCellType::Member &&
                                stackmachine.ObjectMemberType (throwvar, trace) == VariableTypes::RecordArray)
                        {
                                VarId tracevar = stackmachine.ObjectMemberRef(throwvar, trace, true);
                                ColumnNameId file = columnnamemapper.GetMapping("FILENAME");
                                ColumnNameId func = columnnamemapper.GetMapping("FUNC");
                                ColumnNameId line = columnnamemapper.GetMapping("LINE");
                                ColumnNameId col = columnnamemapper.GetMapping("COL");

                                unsigned len = stackmachine.ArraySize(tracevar);

                                StackTraceElement spos;
                                for (unsigned idx = 0; idx != len; ++idx)
                                {
                                        VarId elt = stackmachine.ArrayElementGet(tracevar, idx);

                                        spos.filename = stackmachine.GetSTLString(stackmachine.RecordCellGetByName(elt, file));
                                        spos.position.line = stackmachine.GetInteger(stackmachine.RecordCellGetByName(elt, line));
                                        spos.position.column = stackmachine.GetInteger(stackmachine.RecordCellGetByName(elt, col));
                                        spos.func = stackmachine.GetSTLString(stackmachine.RecordCellGetByName(elt, func));

                                        vm_errorhandler.AddFilePositionToStackTrace(spos);
                                }
                        }

                        ColumnNameId what = columnnamemapper.GetMapping("WHAT");
                        if (ObjectMemberExists(throwvar, what) &&
                                ObjectMemberType (throwvar, what) == ObjectCellType::Member &&
                                stackmachine.ObjectMemberType (throwvar, what) == VariableTypes::String)
                        {
                                msg = stackmachine.GetSTLString(stackmachine.ObjectMemberGet(throwvar, what, true));
                                has_msg = true;
                        }

                        name = GetObjectTypeName(throwvar);
                }
                else
                    name = "DEFAULT OBJECT";

                if (has_msg)
                    throw VMRuntimeError(Error::UncaughtExceptionWithMsg, name, msg);
                else
                    throw VMRuntimeError(Error::UncaughtException, name);
        }
}

VirtualMachine * VirtualMachine::DoInvokeFptr(bool allow_macro)
{
        return PrepareCallFunctionPtr(is_suspendable, allow_macro);
}

void VirtualMachine::DoInitFunctionPtr()
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        VarId arg2 = stackmachine.StackPointer() - 2;
        VarId arg3 = stackmachine.StackPointer() - 3;

        Blex::StringPair name = stackmachine.GetString(arg1);
        std::string uri = stackmachine.GetSTLString(arg2);

        ColumnNameId libid = columnnamemapper.GetMapping("LIBID");
        ColumnNameId functionid = columnnamemapper.GetMapping("FUNCTIONID");
        ColumnNameId vm = columnnamemapper.GetMapping("VM");

        Library const *lib = libraryloader.GetWHLibrary(uri.empty() ? executionstate.library->GetLibURI() : uri);
        if (!lib)
            throw VMRuntimeError(Error::InternalError, "Building function pointer to not yet loaded library '%0'", uri);

        // Lookup the function
        LinkedLibrary::ResolvedFunctionDef const *def = 0;
        for (LinkedLibrary::ResolvedFunctionDefList::const_iterator it = lib->GetLinkedLibrary().functiondefs.begin();
                it != lib->GetLinkedLibrary().functiondefs.end(); ++it)
        {
                //ADDME: Why are we consulting the linked function list? we should probably walk the exported function list?!
                if (it->lib != lib)
                    continue; //this function was not part of this lib, so skip

                Blex::StringPair thisname = lib->GetLinkinfoName(it->def->name_index);
                if (Blex::StrCaseCompare(thisname.begin, thisname.end, name.begin, name.end)==0)
                {
                       def = &*it;
                       break;
                }
        }
        if (def == 0)
            throw VMRuntimeError (Error::UnknownFunction, name.stl_str(), uri);

        stackmachine.ConvertRecordToFunctionRecord(arg3);
        stackmachine.SetInteger(stackmachine.RecordCellCreate(arg3, libid), def->lib->GetId());
        stackmachine.SetInteger(stackmachine.RecordCellCreate(arg3, functionid), def->id);
        stackmachine.SetVMRef(stackmachine.RecordCellCreate(arg3, vm), this);
        stackmachine.PopVariablesN(2);
}

void VirtualMachine::PrepareCall(Library const &lib, FunctionId func)
{
        LinkedLibrary::ResolvedFunctionDefList const &deflist = lib.GetLinkedLibrary().functiondefs;
        if (func >= static_cast<signed>(deflist.size()))
            ThrowUnknownFunction();

        const LinkedLibrary::ResolvedFunctionDefList::value_type& resolvedfunc = deflist[func];

        PrepareCallInternal(resolvedfunc);
}

void VirtualMachine::PrepareCallInternal(LinkedLibrary::ResolvedFunctionDefList::value_type const &resolvedfunc)
{
        // Make sure the 'this' ptr isn't privileged
        if (resolvedfunc.def->flags & FunctionFlags::ObjectMember)
            stackmachine.ObjectSetReferencePrivilegeStatus(stackmachine.StackPointer() - 1, false);

        PushFrame(resolvedfunc.def->localvariablecount);

        SPP_PRINT("Calling into library: " << (void*)resolvedfunc.lib << ", function: " <<
            resolvedfunc.lib->GetWrappedLibrary().linkinfo.GetNameStr(resolvedfunc.lib->GetWrappedLibrary().FunctionList()[resolvedfunc.id].name_index) <<
            " local vars: " << resolvedfunc.def->localvariablecount);

        // Set executionstate info for PopFrame()
        executionstate.library = resolvedfunc.lib;
        executionstate.function = resolvedfunc.id;
        executionstate.codeptr = resolvedfunc.def->codelocation;
        SetStateShortcuts(true);

        if (resolvedfunc.def->flags & FunctionFlags::External)
        {
                switch (resolvedfunc.def->builtindef->type)
                {
                case BuiltinFunctionDefinition::Macro:
                        {
                                (resolvedfunc.def->builtindef->macro)(this);
                        } break;
                case BuiltinFunctionDefinition::Function:
                        {
                                VarId retvalptr = stackmachine.PushVariables(1);

                                (resolvedfunc.def->builtindef->function)(retvalptr, this);

                                // Remove all added variables (for sloppy c-functions)
                                //stackmachine.PopVariablesN(stackmachine.StackPointer() - retvalptr - 1);
                        } break;
                case BuiltinFunctionDefinition::CMacro:
                        {
                                (resolvedfunc.def->builtindef->macro_c)(*this);
                        } break;
                case BuiltinFunctionDefinition::CFunction:
                        {
                                VarId retvalptr = stackmachine.PushVariables(1);

                                (resolvedfunc.def->builtindef->function_c)(*this, retvalptr);

                                // Remove all added variables (for sloppy c-functions)
                                //stackmachine.PopVariablesN(stackmachine.StackPointer() - retvalptr - 1);
                        }
                        break;
                }
                /* Make sure the Run() loop calls popframe immediately after returning,
                   so all different frame types can be handled in one location
                */
                if (is_unwinding)
                    UnwindToNextCatch(false);
                else
                    executionstate.codeptr = SignalCodeptr;
        }
        if(vm_errorhandler.AnyErrors())
            *GetVMGroup()->GetAbortFlag() = HSVM_ABORT_HSERROR;
}

void VirtualMachine::DoRet()
{
        if (callstack.empty())
             throw VMRuntimeError(Error::InternalError, "Stack underflow");

        PopFrame();
}

void VirtualMachine::DoJumpC(int32_t diff)
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = arg1 + 1;
        int32_t value = stackmachine.GetInteger(arg1);
        ConditionCode::_type type = (ConditionCode::_type)stackmachine.GetInteger(arg2);
        stackmachine.PopVariablesN(2);

        switch (type)
        {
        case ConditionCode::Less:           if (value >= 0) return; break;
        case ConditionCode::LessEqual:      if (value > 0) return; break;
        case ConditionCode::Equal:          if (value != 0) return; break;
        case ConditionCode::Bigger:         if (value <= 0) return; break;
        case ConditionCode::BiggerEqual:    if (value < 0) return; break;
        case ConditionCode::UnEqual:        if (value == 0) return; break;
        default:
            std::string nr = Blex::AnyToString<int>(type);
            throw VMRuntimeError (Error::InternalError, "Invalid virtual machine compare type '"+nr+"' encountered");
        }
        MoveCodePtr(diff);
}

void VirtualMachine::DoJumpC2(int32_t diff)
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (stackmachine.GetBoolean(arg1))
           MoveCodePtr(diff);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoJumpC2F(int32_t diff)
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (!stackmachine.GetBoolean(arg1))
           MoveCodePtr(diff);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoDup()
{
        stackmachine.PushCopy(stackmachine.StackPointer() - 1);
}

void VirtualMachine::DoPop()
{
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoSwap()
{
        stackmachine.Swap();
}

void VirtualMachine::DoLoadC(int32_t id)
{
        VarId var = stackmachine.StackPointer();
        stackmachine.PushVariables(1);

        /* ADDME: Validate LoadC id ? Perhaps fixup can do that by range checking all fixed up locations? */
        WrappedLibrary const &wlib = executionstate.library->GetWrappedLibrary();
        uint8_t const *buf = wlib.GetConstantBuffer(id);
        uint8_t const *limit = buf + wlib.GetConstantBufferLength(id);
        var_marshaller.Read(var, buf, limit);
}

void VirtualMachine::DoLoadCB(int8_t id)
{
        VarId var = stackmachine.StackPointer();
        stackmachine.PushVariables(1);
        stackmachine.SetBoolean(var, id != 0);
}

void VirtualMachine::DoLoadCI(int32_t id)
{
        VarId var = stackmachine.StackPointer();
        stackmachine.PushVariables(1);
        stackmachine.SetInteger(var, id);
}

void VirtualMachine::DoLoadS(int32_t id)
{
        stackmachine.PushCopy(LocalStackMiddle + id);
}

void VirtualMachine::DoStoreS(int32_t id)
{
        stackmachine.MoveFrom(LocalStackMiddle + id, stackmachine.StackPointer() - 1);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoLoadG(int32_t id)
{
        // Find the location this variable is stored
        const LinkedLibrary::ResolvedVariableDefList::value_type& varfunc = executionstate.library->GetLinkedLibrary().variabledefs[id];

        VarId location = stackmachine.GetMappingAddress(varfunc.lib->GetId()) + varfunc.def->globallocation;
//        unsigned location = varfunc.lib->GetLinkedLibrary().globalareastart + varfunc.def->globallocation;
//        location = stackmachine.TranslateMappedId(location);

        stackmachine.PushCopy(location);
}

void VirtualMachine::DoStoreG(int32_t id)
{
        // Find the location this variable is stored
        const LinkedLibrary::ResolvedVariableDefList::value_type& varfunc = executionstate.library->GetLinkedLibrary().variabledefs[id];

        VarId location = stackmachine.GetMappingAddress(varfunc.lib->GetId()) + varfunc.def->globallocation;
//        unsigned location = varfunc.lib->GetLinkedLibrary().globalareastart + varfunc.def->globallocation;
//        location = stackmachine.TranslateMappedId(location);

        stackmachine.MoveFrom(location, stackmachine.StackPointer() - 1);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoPrint()
{
        std::cout << Wrap<VarPrinterPrintType::NoQuotes>(stackmachine, stackmachine.StackPointer()-1);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoLoadSD(int32_t id)
{
        stackmachine.PushVariables(1);
        stackmachine.MoveFrom(stackmachine.StackPointer() - 1, LocalStackMiddle + id);
}

void VirtualMachine::DoLoadGD(int32_t id)
{
        // Find the location this variable is stored
        const LinkedLibrary::ResolvedVariableDefList::value_type& varfunc = executionstate.library->GetLinkedLibrary().variabledefs[id];

        VarId location = stackmachine.GetMappingAddress(varfunc.lib->GetId()) + varfunc.def->globallocation;
//        unsigned location = varfunc.lib->GetLinkedLibrary().globalareastart + varfunc.def->globallocation;
//        location = stackmachine.TranslateMappedId(location);

        stackmachine.PushVariables(1);
        stackmachine.MoveFrom(stackmachine.StackPointer() - 1, location);
}

void VirtualMachine::DoDestroyS(int32_t id)
{
        stackmachine.DestroyVariable(LocalStackMiddle + id);
}

void VirtualMachine::DoCopyS(int32_t id)
{
        stackmachine.CopyFrom(LocalStackMiddle + id, stackmachine.StackPointer() - 1);
}


void VirtualMachine::DoCastParam(VariableTypes::Type type, int32_t func)
{
        try
        {
                stackmachine.Stack_CastTo(type);
        }
        catch (VMRuntimeError &e)
        {
                LinkedLibrary::ResolvedFunctionDefList const &deflist = executionstate.library->GetLinkedLibrary().functiondefs;
                if (func >= static_cast<signed>(deflist.size()))
                    ThrowUnknownFunction();

                AddRelevantFunctionError(GenerateFunctionSignature(&deflist[func]));
                throw;
        }
}

void VirtualMachine::DoEmptyLoad(VariableTypes::Type type)
{
        stackmachine.InitVariable(stackmachine.PushVariables(1), type);
}

void VirtualMachine::DoInc()
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (stackmachine.GetType(arg1) != VariableTypes::Integer)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(arg1)), HareScript::GetTypeName(VariableTypes::Integer));

        int32_t arg1val = stackmachine.GetInteger(arg1);
        int64_t val = static_cast<int64_t>(arg1val) + 1;

        if (val > std::numeric_limits<int32_t>::max())
            throw VMRuntimeError (Error::IntegerOverflow);

        stackmachine.SetInteger(arg1, static_cast<int32_t>(val));
}

void VirtualMachine::DoDec()
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (stackmachine.GetType(arg1) != VariableTypes::Integer)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(arg1)), HareScript::GetTypeName(VariableTypes::Integer));

        int32_t arg1val = stackmachine.GetInteger(arg1);
        int64_t val = static_cast<int64_t>(arg1val) - 1;

        if (val < std::numeric_limits<int32_t>::min())
            throw VMRuntimeError (Error::IntegerOverflow);

        stackmachine.SetInteger(arg1, static_cast<int32_t>(val));
}

void VirtualMachine::DoArrayIndex()
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = arg1 + 1;

        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);
        if (stackmachine.GetType(arg2) != VariableTypes::Integer)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(arg2)), HareScript::GetTypeName(VariableTypes::Integer));

        stackmachine.ArrayElementCopy(arg1, stackmachine.GetInteger(arg2), arg1);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoArraySize()
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        stackmachine.SetInteger(arg1, stackmachine.ArraySize(arg1));
}

void VirtualMachine::DoArrayInsert()
{
        VarId arg1 = stackmachine.StackPointer() - 3;
        VarId arg2 = arg1 + 1;
        VarId arg3 = arg1 + 2;

        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);
        stackmachine.CastTo(arg3, static_cast<VariableTypes::Type>(stackmachine.GetType(arg1) & ~(VariableTypes::Array)));

        int32_t idx = stackmachine.GetInteger(arg2);
        if (idx < 0 || (unsigned)idx > stackmachine.ArraySize(arg1))
            throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(idx));

        stackmachine.MoveFrom(stackmachine.ArrayElementInsert(arg1, idx), arg3);
        stackmachine.PopVariablesN(2);
}

void VirtualMachine::DoArraySet()
{
        VarId arg1 = stackmachine.StackPointer() - 3;
        VarId arg2 = arg1 + 1;
        VarId arg3 = arg1 + 2;
        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);
        stackmachine.CastTo(arg3, static_cast<VariableTypes::Type>(stackmachine.GetType(arg1) & ~(VariableTypes::Array)));

        int32_t idx = stackmachine.GetInteger(arg2);
        if (idx < 0 || (unsigned)idx >= stackmachine.ArraySize(arg1))
            throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(idx));

        stackmachine.MoveFrom(stackmachine.ArrayElementRef(arg1, idx), arg3);
        stackmachine.PopVariablesN(2);
}

void VirtualMachine::DoArrayDelete()
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = arg1 + 1;
        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        int32_t idx = stackmachine.GetInteger(arg2);
        if (idx < 0 || (unsigned)idx >= stackmachine.ArraySize(arg1))
            throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(idx));

        stackmachine.ArrayElementDelete(arg1, idx);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoArrayAppend()
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = arg1 + 1;

        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        stackmachine.CastTo(arg2, static_cast<VariableTypes::Type>(stackmachine.GetType(arg1) & ~(VariableTypes::Array)));

        stackmachine.MoveFrom(stackmachine.ArrayElementInsert(arg1, stackmachine.ArraySize(arg1)), arg2);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoArrayDeleteAll()
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (!(stackmachine.GetType(arg1) & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        stackmachine.InitVariable(arg1, stackmachine.GetType(arg1));
}

void VirtualMachine::DoDeepOperation(DeepOperation::Type type, bool thisaccess)
{
        VarId lvalue = stackmachine.StackPointer() - 1;
        VarId description = lvalue - 1;
        VarId extra_params = description - 1;

        unsigned curpos = 0;
        bool root_is_object = false;
        bool require_set_cast = true;
        while(true)
        {
                Blex::StringPair sp = stackmachine.GetString(description); //Cannot cache the string: The *Ref invalidate the memory pool (ADDME: Fix the memory pool moving around)
                if(curpos >= sp.size())
                    break;

                require_set_cast = true;
                if (sp.begin[curpos] == 'O')
                {
                        if (curpos != 0)
                            ThrowInternalError("Objects only allowed as first argument of deep operations");
                        root_is_object = true;

                        ColumnNameId nameid = columnnamemapper.GetMapping(stackmachine.GetString(extra_params - curpos++));

                        VariableTypes::Type type = stackmachine.GetType(lvalue);

                        if (type != VariableTypes::Object)
                            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(type), HareScript::GetTypeName(VariableTypes::Object));

                        if (!stackmachine.ObjectExists(lvalue))
                            throw VMRuntimeError (Error::DereferencedDefaultObject);

                        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(lvalue, nameid);
//                        bool is_simple = false;
                        bool exists = false;
                        if (entry)
                        {
                                exists = true;
                                switch (entry->type)
                                {
                                case ObjectCellType::Member:
                                    {
//                                            is_simple = true;
                                    } break;
                                case ObjectCellType::Method:
                                    throw VMRuntimeError(Error::CannotGetMethodValue);
                                case ObjectCellType::Property:
                                    {
                                            if (!entry->getter_nameid)
                                                throw VMRuntimeError(Error::ReadingWriteOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                                            if (!entry->setter_nameid)
                                                throw VMRuntimeError(Error::WritingReadOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());

                                            if (entry->getter_nameid != entry->setter_nameid)
                                                return;

                                            LinkedLibrary::ObjectVTableEntry const *getter = ResolveVTableEntry(lvalue, entry->getter_nameid);
                                            if (!getter)
                                                ThrowInternalError("Could not locate getter function of property");

                                            // Accessing a member through a property; do it with thisaccess
                                            if (getter->type == ObjectCellType::Member)
                                            {
//                                                    is_simple = true;
                                                    nameid = entry->getter_nameid;
                                                    thisaccess = true;
                                            }
                                    } break;
                                default: ;
                                }
                        }

                        exists = stackmachine.ObjectMemberExists(lvalue, nameid);
//                        is_simple = exists;

                        if (!exists)
                            ObjectThrowMemberNotFound(lvalue, nameid);

                        lvalue = stackmachine.ObjectMemberRef(lvalue, nameid, thisaccess);
                }
                else if (sp.begin[curpos] == 'A')
                {
                        // id must be an integer (checked by compiler
                        int32_t idx = stackmachine.GetInteger(extra_params - curpos++);

                        VariableTypes::Type arraytype = stackmachine.GetType(lvalue);
                        if (!(arraytype & VariableTypes::Array))
                            throw VMRuntimeError (Error::TypeNotArray);

                        require_set_cast = arraytype != VariableTypes::VariantArray;

                        if (idx < 0 || (unsigned)idx >= stackmachine.ArraySize(lvalue))
                            throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(idx));

                        lvalue = stackmachine.ArrayElementRef(lvalue, idx);
                }
                else
                {
                        ColumnNameId nameid = columnnamemapper.GetMapping(stackmachine.GetString(extra_params - curpos++));

                        VariableTypes::Type type = stackmachine.GetType(lvalue);

                        if (type != VariableTypes::Record)
                            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(type), HareScript::GetTypeName(VariableTypes::Record));

                        if (stackmachine.RecordNull(lvalue))
                            throw VMRuntimeError (Error::RecordDoesNotExist, columnnamemapper.GetReverseMapping(nameid).stl_str());

                        VarId oldlvalue = lvalue;
                        lvalue = stackmachine.RecordCellRefByName(lvalue, nameid);

                        if (!lvalue)
                            stackmachine.RecordThrowCellNotFound(oldlvalue, columnnamemapper.GetReverseMapping(nameid).stl_str());
//                            throw VMRuntimeError (Error::UnknownColumn, columnnamemapper.GetReverseMapping(nameid).stl_str());
                }
        }

        switch (type)
        {
        case DeepOperation::Set:
            {
                    VarId newvalue = extra_params - curpos++;

                    if (require_set_cast)
                        stackmachine.CastTo(newvalue, stackmachine.GetType(lvalue));
                    stackmachine.MoveFrom(lvalue, newvalue);
            } break;
        case DeepOperation::Append:
            {
                    VarId newvalue = extra_params - curpos++;

                    if (!(stackmachine.GetType(lvalue) & VariableTypes::Array))
                        throw VMRuntimeError (Error::TypeNotArray);

                    stackmachine.CastTo(newvalue, static_cast<VariableTypes::Type>(stackmachine.GetType(lvalue) & ~(VariableTypes::Array)));
                    stackmachine.MoveFrom(stackmachine.ArrayElementInsert(lvalue, stackmachine.ArraySize(lvalue)), newvalue);
            } break;
        case DeepOperation::Insert:
            {
                    HSVM_VariableId lvaluetype = stackmachine.GetType(lvalue);

                    if (!(lvaluetype & VariableTypes::Array))
                        throw VMRuntimeError (Error::TypeNotArray);

                    // id must be an integer (checked by compiler)
                    int32_t idx = stackmachine.GetInteger(extra_params - curpos++);
                    if (idx < 0 || (unsigned)idx > stackmachine.ArraySize(lvalue))
                        throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(idx));

                    VarId newvalue = extra_params - curpos++;

                    stackmachine.CastTo(newvalue, static_cast<VariableTypes::Type>(lvaluetype & ~(VariableTypes::Array)));
                    stackmachine.MoveFrom(stackmachine.ArrayElementInsert(lvalue, idx), newvalue);
            } break;
        case DeepOperation::Delete:
            {
                    if (!(stackmachine.GetType(lvalue) & VariableTypes::Array))
                        throw VMRuntimeError (Error::TypeNotArray);

                    // id must be an integer (checked by compiler)
                    int32_t idx = stackmachine.GetInteger(extra_params - curpos++);
                    if (idx < 0 || (unsigned)idx >= stackmachine.ArraySize(lvalue))
                        throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(idx));

                    stackmachine.ArrayElementDelete(lvalue, idx);
            } break;
        default:
            ThrowInternalError(("Illegal deep operation encountered #" + Blex::AnyToString((unsigned)type)).c_str());
        }

        if (root_is_object)
            stackmachine.PopVariablesN(curpos + 2);
        else
            stackmachine.PopDeepVariables(curpos + 1, 1);
}

void VirtualMachine::DoRecordCellGet(int32_t id)
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        if (stackmachine.GetType(arg1) != VariableTypes::Record)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(arg1)), HareScript::GetTypeName(VariableTypes::Record));

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];

        if (stackmachine.RecordNull(arg1))
            throw VMRuntimeError (Error::RecordDoesNotExist, columnnamemapper.GetReverseMapping(nameid).stl_str());

        bool found = stackmachine.RecordCellCopyByName(arg1, nameid, arg1);
        if (!found)
            stackmachine.RecordThrowCellNotFound(arg1, columnnamemapper.GetReverseMapping(nameid).stl_str());
            //throw VMRuntimeError (Error::UnknownColumn, columnnamemapper.GetReverseMapping(nameid).stl_str());
}

void VirtualMachine::DoRecordCellSet(int32_t id, bool with_check, bool cancreate)
{
        VarId rec = stackmachine.StackPointer() - 2;
        VarId value = stackmachine.StackPointer() - 1;

        if (stackmachine.GetType(rec) != VariableTypes::Record && stackmachine.GetType(rec) != VariableTypes::FunctionRecord)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(rec)), HareScript::GetTypeName(VariableTypes::Record));

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];

        if (with_check && !cancreate && stackmachine.RecordNull(rec))
            throw VMRuntimeError (Error::RecordDoesNotExist, columnnamemapper.GetReverseMapping(nameid).stl_str());

        VarId dest;
        if (!with_check)
        {
                dest = stackmachine.RecordCellCreate(rec, nameid);
        }
        else if (cancreate)
        {
                dest = stackmachine.RecordCellCreateExclusive(rec, nameid);
        }
        else
        {
                dest = stackmachine.RecordCellRefByName(rec, nameid);
                if (dest == 0)
                    stackmachine.RecordThrowCellNotFound(rec, columnnamemapper.GetReverseMapping(nameid).stl_str());
                    //throw VMRuntimeError (Error::UnknownColumn, columnnamemapper.GetReverseMapping(nameid).stl_str());
                stackmachine.CastTo(value, stackmachine.GetType(dest));
        }

        stackmachine.MoveFrom(dest, value);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoRecordCellDelete(int32_t id)
{
        VarId rec = stackmachine.StackPointer() - 1;

        if (stackmachine.GetType(rec) != VariableTypes::Record)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(rec)), HareScript::GetTypeName(VariableTypes::Record));

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];
        stackmachine.RecordCellDelete(rec, nameid);

// kris: Reference [p. 43]: "If the cell does not exist is rec, nothing happens and no error is generated."
}

void VirtualMachine::DoRecordMakeExisting()
{
        VarId rec = stackmachine.StackPointer() - 1;

        if (stackmachine.GetType(rec) != VariableTypes::Record)
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackmachine.GetType(rec)), HareScript::GetTypeName(VariableTypes::Record));

        if (stackmachine.RecordNull(rec))
            stackmachine.RecordInitializeEmpty(rec);
}

void VirtualMachine::DoObjNew()
{
        VarId newvar = stackmachine.PushVariables(1);
        stackmachine.ObjectInitializeEmpty(newvar);
}

void VirtualMachine::DoObjMemberGet(int32_t id, bool this_access)
{
        VarId arg1 = stackmachine.StackPointer() - 1;

        stackmachine.CastTo(arg1, VariableTypes::Object);

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];

        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(arg1, nameid);
        bool is_hat = nameid == cn_cache.col_hat;

        if (!entry)
        {
                if (stackmachine.ObjectMemberCopy(arg1, nameid, this_access, arg1))
                    return;

                auto namestr = columnnamemapper.GetReverseMapping(nameid);
                if (namestr.size() >= 2 && *namestr.begin == '^')
                {
                        is_hat = true;
                        entry = ResolveVTableEntry(arg1, cn_cache.col_hat);
                }

                if (!entry || entry->type != ObjectCellType::Property)
                    ObjectThrowMemberNotFound(arg1, nameid);
        }

        if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(arg1))
            throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        switch (entry->type)
        {
        case ObjectCellType::Member: break;
        case ObjectCellType::Method:
            throw VMRuntimeError(Error::CannotGetMethodValue);
        case ObjectCellType::Property:
            {
                    this_access = true;

                    if (!entry->getter_nameid)
                        throw VMRuntimeError(Error::ReadingWriteOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                    LinkedLibrary::ObjectVTableEntry const *getter = ResolveVTableEntry(arg1, entry->getter_nameid);
                    if (!getter)
                        ThrowInternalError("Could not locate getter function of property");

                    switch (getter->type)
                    {
                    case ObjectCellType::Member: // redirect to variable
                        {
                                nameid = getter->nameid;
                        } break;
                    case ObjectCellType::Method:
                        {
                                if (is_hat)
                                {
                                        stackmachine.SetString(stackmachine.PushVariables(1), columnnamemapper.GetReverseMapping(nameid));
                                        stackmachine.Swap();
                                }

                                PrepareObjMethodCallByEntry(getter, is_hat ? 2 : 1, this_access, false);
                                return;
                        }
                    default:
                        ThrowInternalError("Found a property as getter for another property");
                    }
            }
        default: ;
        }

        if (!stackmachine.ObjectMemberCopy(arg1, nameid, this_access, arg1))
            ObjectThrowMemberNotFound(arg1, nameid);
}


void VirtualMachine::DoObjMemberSet(int32_t id, bool this_access)
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = stackmachine.StackPointer() - 1;

        stackmachine.CastTo(arg1, VariableTypes::Object);

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];

        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(arg1, nameid);
        bool is_hat = nameid == cn_cache.col_hat;

        if (!entry)
        {
                stackmachine.CastTo(arg2, stackmachine.ObjectMemberType(arg1, nameid));
                if (stackmachine.ObjectMemberSet(arg1, nameid, this_access, arg2))
                {
                        stackmachine.PopVariablesN(2);
                        return;
                }

                auto namestr = columnnamemapper.GetReverseMapping(nameid);
                if (namestr.size() >= 2 && *namestr.begin == '^')
                {
                        is_hat = true;
                        entry = ResolveVTableEntry(arg1, cn_cache.col_hat);
                }

                if (!entry || entry->type != ObjectCellType::Property)
                    ObjectThrowMemberNotFound(arg1, nameid);
        }

        if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(arg1))
            throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        switch (entry->type)
        {
        case ObjectCellType::Member:
            stackmachine.CastTo(arg2, entry->var_type);
            break;
        case ObjectCellType::Method:
            ThrowInternalError("FIXME: may not access the value of a method");
        case ObjectCellType::Property:
            {
                    this_access = true;

                    if (!entry->setter_nameid)
                        throw VMRuntimeError(Error::WritingReadOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                    LinkedLibrary::ObjectVTableEntry const *setter = ResolveVTableEntry(arg1, entry->setter_nameid);
                    if (!setter)
                        ThrowInternalError("Could not locate setter function of property");

                    switch (setter->type)
                    {
                    case ObjectCellType::Member: // redirect to variable
                        {
                                nameid = setter->nameid;
                                stackmachine.CastTo(arg2, setter->var_type);
                        } break;
                    case ObjectCellType::Method:
                        {
                                // opcode and function param order is reversed, so reverse object and param
                                stackmachine.Swap();

                                if (is_hat)
                                {
                                        stackmachine.SetString(stackmachine.PushVariables(1), columnnamemapper.GetReverseMapping(nameid));
                                        stackmachine.Swap();
                                }

                                PushFrameRaw(StackElementType::PopVariable);
                                executionstate.codeptr = SignalCodeptr;
                                PrepareObjMethodCallByEntry(setter, is_hat ? 3 : 2, this_access, true);
                                return;
                        }
                    default:
                        ThrowInternalError("Found a property as setter for another property");
                    }
            }
        default: ;
        }

        if (!stackmachine.ObjectMemberSet(arg1, nameid, this_access, arg2))
            ObjectThrowMemberNotFound(arg1, nameid);

        stackmachine.PopVariablesN(2);
}

void VirtualMachine::DoObjMemberInsert(int32_t id, bool is_private, bool via_this)
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = stackmachine.StackPointer() - 1;

        stackmachine.CastTo(arg1, VariableTypes::Object);

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];

        ObjectMemberInsert(arg1, nameid, via_this, is_private, arg2);

        stackmachine.PopVariablesN(2);
}

void VirtualMachine::DoObjMemberDelete(int32_t id, bool via_this)
{
        VarId arg1 = stackmachine.StackPointer() - 1;

        stackmachine.CastTo(arg1, VariableTypes::Object);

        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];

        ObjectMemberDelete(arg1, nameid, via_this);

        stackmachine.PopVariablesN(1);
}

VirtualMachine::GeneratorContext::GeneratorContext()
: state(NotAGenerator)
{
}

// FIXME: get registered context ids
static unsigned GeneratorContextId = 159998;
static unsigned AsyncCallContextId = 159997;

void * VirtualMachine::CreateGeneratorContext(void * /*opaque_ptr*/)
{
        return new GeneratorContext;
}

void VirtualMachine::DestroyGeneratorContext(void * /*opaque_ptr*/, void *context_ptr)
{
        delete static_cast< GeneratorContext * >(context_ptr);
}

void * VirtualMachine::CreateAsyncCallContext(void * /*opaque_ptr*/)
{
        return new AsyncCallContext;
}

void VirtualMachine::DestroyAsyncCallContext(void * /*opaque_ptr*/, void *context_ptr)
{
        delete static_cast< AsyncCallContext * >(context_ptr);
}


void VirtualMachine::DoYield()
{
        VarId arg1 = stackmachine.StackPointer() - 2;

        GeneratorContext *generatordata = static_cast< GeneratorContext *>(stackmachine.ObjectGetContext(arg1, GeneratorContextId, &CreateGeneratorContext, &DestroyGeneratorContext, NULL, true));
        if (!generatordata)
            throw VMRuntimeError(Error::DereferencedDefaultObject);

/*        Blex::ErrStream() << "********";
        Blex::ErrStream();
        Blex::ErrStream() << "** Processing yield ** " << generatordata;
        ShowStackState();//*/

        GEN_PRINT("Processing yield, saving stack state");

        auto functiondef = &executionstate.library->GetLinkedLibrary().functiondefs[executionstate.function];

        // Don't save the object and the retval, but remove the object
        VarId var_stack = stackmachine.ObjectMemberRef(arg1, cn_cache.col_stack, true);
        stackmachine.SaveStackFrame(2, functiondef->def->parameters.size(), var_stack);
        stackmachine.LeaveStackFrame(callstack.back().baseptr, 1, functiondef->def->parameters.size());

//        generatordata->initialized = true;
//        generatordata->busy = false;
        generatordata->el.library = executionstate.library;
        generatordata->el.function = executionstate.function;
        generatordata->el.codeptr = executionstate.codeptr;

/*        DEBUGPRINT("L " << generatordata->el.library);
        DEBUGPRINT("F " << generatordata->el.function);
        DEBUGPRINT("C " << generatordata->el.codeptr);//*/

        // Raw pop, did our own FIXME: call a version that handles profiling
        PopFrameRaw();

/*        Blex::ErrStream() << "** Processed yield **";
        ShowStackState();
        Blex::ErrStream();
        Blex::ErrStream() << "********";//*/
}

LinkedLibrary::ObjectVTableEntry const * VirtualMachine::ResolveVTableEntry(VarId obj, ColumnNameId nameid)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return nullptr;

        auto it = type->entries.find(nameid);
        if (it == type->entries.end())
            return nullptr;

        return &it->second;
}

std::string VirtualMachine::GetObjectTypeName(VarId obj)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return "";

        return (*(type->objdefs.end() - 1))->name;
}

void VirtualMachine::GetObjectExtendNames(VarId obj, std::vector< std::string > *objecttypelist)
{
        objecttypelist->clear();
        if (!stackmachine.ObjectExists(obj))
            return;

        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return;

        for (Blex::PodVector< LinkedLibrary::LinkedObjectDef const * >::const_iterator it = type->objdefs.begin(); it != type->objdefs.end(); ++it)
            objecttypelist->push_back((*it)->name);
}

void VirtualMachine::GetObjectExtendUids(VarId obj, std::vector< std::string > *objectuidlist)
{
        objectuidlist->clear();
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return;

        for (Blex::PodVector< LinkedLibrary::LinkedObjectDef const * >::const_iterator it = type->objdefs.begin(); it != type->objdefs.end(); ++it)
            for (std::vector< std::string >::const_iterator it2 = (*it)->uids.begin(); it2 != (*it)->uids.end(); ++it2)
                objectuidlist->push_back(*it2);

        // FIXME: is this uniqueing step really necessary?
        std::sort(objectuidlist->begin(), objectuidlist->end());
        objectuidlist->erase(std::unique(objectuidlist->begin(), objectuidlist->end()), objectuidlist->end());
}

bool VirtualMachine::ObjectHasExtendUid(VarId obj, std::string const &uid)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return false;

        for (Blex::PodVector< LinkedLibrary::LinkedObjectDef const * >::const_iterator it = type->objdefs.begin(); it != type->objdefs.end(); ++it)
            for (std::vector< std::string >::const_iterator it2 = (*it)->uids.begin(); it2 != (*it)->uids.end(); ++it2)
                if (*it2 == uid)
                    return true;

        return false;
}

bool VirtualMachine::GetObjectInternalProtected(VarId obj)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return false;

        return type->objdefs.back()->def->flags & ObjectTypeFlags::InternalProtected;
}

void VirtualMachine::PrepareObjMethodCall(ColumnNameId nameid, unsigned parameters, bool this_access, bool allow_macro)
{
        VarId obj = stackmachine.StackPointer() - 1;

        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        if (!entry || entry->type != ObjectCellType::Method)
            ObjectThrowMemberNotFound(obj, nameid);

        PrepareObjMethodCallByEntry(entry, parameters, this_access, allow_macro);
}

bool VirtualMachine::GetObjectDefinitions(HSVM_VariableId obj, Blex::PodVector< LinkedLibrary::LinkedObjectDef const * > *objdefs)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (!type)
            return false;

        objdefs->assign(type->objdefs.begin(), type->objdefs.end());
        return true;
}

void VirtualMachine::AddRelevantFunctionError(std::string const &signature)
{
        VMRuntimeError m(Error::RelevantFunction, signature);

        Library const *lib = executionstate.library;
        CodePtr codeptr = executionstate.codeptr;
        if (!lib || codeptr == SignalCodeptr)
        {
                // We're currently inside an internal function. Find the first valid position on the stack.
                for (CallStack::reverse_iterator it = callstack.rbegin(); it != callstack.rend(); ++it)
                {
                        lib = it->library;
                        codeptr = it->codeptr;

                        if (lib && codeptr != SignalCodeptr)
                            break;
                }
        }
        if (lib && codeptr != SignalCodeptr)
        {
                m.filename = lib->GetLibURI();

                Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::const_iterator pos = (lib->GetWrappedLibrary().debug.debugentries.UpperBound(codeptr - 1));
                if(pos != lib->GetWrappedLibrary().debug.debugentries.Begin())
                {
                        --pos;
                        m.position = pos->second;
                }
        }
        vm_errorhandler.AddMessage(m);
}

void VirtualMachine::HandleAbortFlagErrors()
{
        if(!vmgroup->errorhandler.AnyErrors())
        {
                unsigned flagvalue = *vmgroup->GetAbortFlag();
                if (flagvalue == 0 || flagvalue == HSVM_ABORT_SILENTTERMINATE || flagvalue == HSVM_ABORT_YIELD)
                    return;

                VMRuntimeError msg(Error::InternalError);
                PrepareStackTrace(&msg);

                //Read the abort flag to discover errors
                switch (flagvalue)
                {
                case HSVM_ABORT_TIMEOUT:        msg.code = Error::ScriptAbortedTimeout; break;
                case HSVM_ABORT_DISCONNECT:     msg.code = Error::ScriptAbortedDisconnect; break;
                case HSVM_ABORT_MANUALLY:       msg.code = Error::ScriptAbortedManually; break;
                default:
                        msg.code = Error::InternalError;
                        msg.msg1 = "Script aborted with invalid reason code " + Blex::AnyToString(flagvalue);
                        break;
                }

                //FIXME: Get error location from last code point
                vmgroup->errorhandler.AddMessage(msg);
        }

}


void VirtualMachine::PrepareObjMethodCallByEntry(LinkedLibrary::ObjectVTableEntry const *entry, unsigned argcount, bool this_access, bool allow_macro)
{
        VarId obj = stackmachine.StackPointer() - 1;

        if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(obj))
            throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        bool is_vararg = entry->method->def->flags & FunctionFlags::VarArg;
        unsigned alloc_extra = 0;
        unsigned real_paramcount = entry->method->def->parameters.size();

        // Setup return value space
        if (entry->method->def->resulttype == VariableTypes::NoReturn)
        {
                if (!allow_macro)
                    throw VMRuntimeError(Error::MacroDoesNotReturnValue);
                ++alloc_extra;
        }

        if (is_vararg)
        {
                // Must have room for the vararg parameter
                ++alloc_extra;

                // Alloc extra space for default parameters if needed
                if (argcount < real_paramcount - 1)
                    alloc_extra += (real_paramcount - 1) - argcount;
        }
        else
        {
                // Check if there are not too much arguments
                if (argcount > real_paramcount)
                    throw VMRuntimeError(Error::ParameterCountWrong, GenerateFunctionSignature(entry->method));

                // Alloc extra space for default parameters
                alloc_extra += real_paramcount - argcount;
        }

        VarId top = stackmachine.PushVariables(alloc_extra) + alloc_extra - 1;

        try
        {
                // Do all normal (non-vararg) parameters
                for (unsigned idx = 0; idx < real_paramcount - is_vararg; ++idx)
                {
                        // Do we have an argument for this parameter?
                        if (idx < argcount)
                        {
                                // Yes; cast and move into position
                                stackmachine.CastTo(obj-idx, entry->method->def->parameters[idx].type);
                                if (obj != top)
                                    stackmachine.MoveFrom(top - idx, obj - idx);
                        }
                        else
                        {
                                // No, try to use the default
                                int32_t defaultid = entry->method->def->parameters[idx].defaultid;
                                if (defaultid == -1)
                                    throw VMRuntimeError(Error::ParameterCountWrong, GenerateFunctionSignature(entry->method));

                                param_marshaller.SetLibraryColumnNameDecoder(&entry->method->lib->GetLinkedLibrary().resolvedcolumnnames);
                                WrappedLibrary const &wlib = entry->method->lib->GetWrappedLibrary();
                                uint8_t const *buf = wlib.GetConstantBuffer(defaultid);
                                uint8_t const *limit = buf + wlib.GetConstantBufferLength(defaultid);
                                param_marshaller.Read(top - idx, buf, limit);
                        }
                }
                if (is_vararg)
                {
                        // Do all vararg arguments
                        VarId va = top - real_paramcount + 1;
                        stackmachine.InitVariable(va, VariableTypes::VariantArray);
                        VariableTypes::Type type = ToNonArray(entry->method->def->parameters[real_paramcount - 1].type);

                        for (unsigned idx = real_paramcount - is_vararg; idx < argcount; ++idx)
                        {
                                stackmachine.CastTo(obj - idx, type);
                                stackmachine.MoveFrom(stackmachine.ArrayElementAppend(va), obj - idx);
                        }

                        // And pop the vararg stuff away
                        stackmachine.PopDeepVariables(argcount - (real_paramcount - 1), real_paramcount);
                }
        }
        catch (VMRuntimeError &)
        {
                AddRelevantFunctionError(GenerateFunctionSignature(entry->method));
                throw;
        }

        // It is a method; check parameters!
        PrepareCallInternal(*entry->method);
}


void VirtualMachine::DoObjMethodCall(int32_t id, int32_t paramcount, bool this_access, bool allow_macro)
{
        VarId obj = stackmachine.StackPointer() - 1;
        ColumnNameId nameid = executionstate.library->GetLinkedLibrary().resolvedcolumnnames[id];
        ++paramcount; // FIXME: include the object parameter (shouldn't the compiler do that?)

        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        VarId var;
        bool is_hat = false;

        if (!entry)
        {
                var = stackmachine.PushVariables(1);
                if (!stackmachine.ObjectMemberCopy(obj, nameid, this_access, stackmachine.PushVariables(1)))
                {
                        // Cleanup the pushed variables
                        stackmachine.PopVariablesN(2);

                        auto namestr = columnnamemapper.GetReverseMapping(nameid);
                        if (namestr.size() >= 2 && *namestr.begin == '^')
                        {
                                is_hat = true;
                                entry = ResolveVTableEntry(obj, cn_cache.col_hat);
                        }

                        if (!entry || entry->type != ObjectCellType::Property)
                            ObjectThrowMemberNotFound(obj, nameid);
                }
        }

        if (entry)
        {
                if (entry->type == ObjectCellType::Method)
                {
                        PrepareObjMethodCallByEntry(entry, paramcount, this_access, allow_macro);
                        return;
                }

                if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(obj))
                    throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

                var = stackmachine.PushVariables(1);
                if (entry->type == ObjectCellType::Property)
                {
                        if (!entry->getter_nameid)
                            throw VMRuntimeError(Error::ReadingWriteOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                        entry = ResolveVTableEntry(obj, entry->getter_nameid);
                        if (!entry)
                            ThrowInternalError("Could not locate getter function of property");

                        this_access = true; // no more access checks, property has authority to redirect.
                }

                if (entry->type == ObjectCellType::Method)
                {
                        // It is a property getter, execute it directly; we need its return value
                        if (is_hat)
                            stackmachine.SetString(stackmachine.PushVariables(1), columnnamemapper.GetReverseMapping(nameid));
                        stackmachine.PushCopy(obj);

                        SetupReturnStackframe();
                        PrepareObjMethodCallByEntry(entry, is_hat ? 2 : 1, this_access, allow_macro);
                        Run(false, false);

                        if (is_unwinding)
                        {
                                UnwindToNextCatch(true);
                                return;
                        }

                        if (vmgroup->TestMustAbort())
                            return;
                }
                else
                {
                        // Use nameid from entry, we may be redirected by a property
                        if (!stackmachine.ObjectMemberCopy(obj, entry->nameid, this_access, stackmachine.PushVariables(1)))
                            throw VMRuntimeError(Error::InternalError, "Variable from vtable not found in object");
                }
        }

        stackmachine.CastTo(var + 1, VariableTypes::FunctionRecord);

        // Calling a function-pointer, tracnslate the call
        stackmachine.InitVariable(var, VariableTypes::VariantArray);
        for (signed idx = 1; idx < paramcount; ++idx)
            stackmachine.MoveFrom(stackmachine.ArrayElementAppend(var), obj - idx);

        stackmachine.PopDeepVariables(paramcount, 2);
        DoInvokeFptr(allow_macro);
}

void VirtualMachine::DoObjTestNonStatic(bool this_access)
{
        VarId arg1 = stackmachine.StackPointer() - 1;

        if (!stackmachine.ObjectExists(arg1))
            ThrowVMRuntimeError(Error::CannotExtendDefaultObject);

        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(arg1));

        if (type->objdefs.back()->def->flags & ObjectTypeFlags::Static)
            ThrowVMRuntimeError(Error::CannotDynamicallyModifyStaticObjectType);

        if (!this_access && !stackmachine.ObjectIsPrivilegedReference(arg1))
            ThrowVMRuntimeError(Error::DynamicExtendOnlyThroughThis);

        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoObjSetType()
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = stackmachine.StackPointer() - 1;

        if (!stackmachine.ObjectExists(arg1))
            ThrowVMRuntimeError(Error::CannotExtendDefaultObject);

        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(arg1));

        Blex::StringPair str = stackmachine.GetString(arg2);
        LinkedLibrary::LinkedObjectDef const *def = 0;
        for (LinkedLibrary::LinkedObjectDefs::const_iterator it = executionstate.library->GetLinkedLibrary().localobjects.begin();
                it != executionstate.library->GetLinkedLibrary().localobjects.end(); ++it)
        {
                if (it->name == str && !(it->def->symbolflags & SymbolFlags::Imported))
                {
                        def = &*it;
                        break;
                }
        }
        if (!def)
            ThrowInternalError(("Cannot find object type definition for object type " + str.stl_str()).c_str());

        if (type && !type->objdefs.empty() && type->objdefs.back()->def->flags & ObjectTypeFlags::InternalProtected)
            ThrowVMRuntimeError(Error::CannotAccessProtectedObjectType);

        ObjectTypeDefinition *newtype = ExtendObjectType(type, def);
        if (stackmachine.ObjectHasDeletableMembers(arg1))
        {
                for (auto &itr: newtype->new_entries)
                    if (stackmachine.ObjectMemberExists(arg1, itr.nameid))
                        throw VMRuntimeError(Error::CannotOverrideDynamicMember, columnnamemapper.GetReverseMapping(itr.nameid).stl_str());
        }

        for (auto &itr: newtype->new_entries)
            if (itr.type == ObjectCellType::Member)
                stackmachine.ObjectMemberInsertDefault(arg1, itr.nameid, true, itr.is_private, false, itr.var_type);

        stackmachine.ObjectSetTypeDescriptor(arg1, newtype);

        stackmachine.PopVariablesN(2);
}

void VirtualMachine::DoObjMakeRefPrivileged()
{
        VarId arg1 = stackmachine.StackPointer() - 1;
        stackmachine.ObjectSetReferencePrivilegeStatus(arg1, true);
}

void VirtualMachine::DoObjMemberIsSimple()
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = stackmachine.StackPointer() - 1;

        if (stackmachine.GetType(arg1) != VariableTypes::Object)
        {
                stackmachine.SetBoolean(arg1, false);
                stackmachine.PopVariablesN(1);
                return;
        }

        stackmachine.CastTo(arg1, VariableTypes::Object);
        stackmachine.CastTo(arg2, VariableTypes::String);

        ColumnNameId nameid = columnnamemapper.GetMapping(stackmachine.GetString(arg2));

        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(arg1, nameid);
        bool is_simple = false;
        if (entry)
        {
                switch (entry->type)
                {
                case ObjectCellType::Member:
                    {
                            is_simple = true;
                    } break;
                case ObjectCellType::Method:
                    throw VMRuntimeError(Error::CannotGetMethodValue);
                case ObjectCellType::Property:
                    {
                            if (!entry->getter_nameid)
                                throw VMRuntimeError(Error::ReadingWriteOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                            if (!entry->setter_nameid)
                                throw VMRuntimeError(Error::WritingReadOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());

                            if (entry->getter_nameid != entry->setter_nameid)
                                break;

                            LinkedLibrary::ObjectVTableEntry const *getter = ResolveVTableEntry(arg1, entry->getter_nameid);
                            if (!getter)
                                ThrowInternalError("Could not locate getter function of property");

                            if (getter->type == ObjectCellType::Member)
                                is_simple = true;
                    }
                default: ;
                }
        }
        else
            is_simple = stackmachine.ObjectMemberExists(arg1, nameid);

        stackmachine.SetBoolean(arg1, is_simple);
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::ObjectThrowMemberNotFound(VarId obj, ColumnNameId nameid)
{
        std::string name = columnnamemapper.GetReverseMapping(nameid).stl_str();

        int bestmapping = -1;
        std::string bestname;

        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (type)
        {
                for (auto &itr: type->entries)
                {
                        std::string cellname = columnnamemapper.GetReverseMapping(itr.first).stl_str();
                        int ld = Blex::LevenshteinDistance(name, cellname);
                        if (bestmapping == -1 || ld < bestmapping)
                        {
                                //DEBUGPRINT("Mapping '" << cellname << "' better (" << ld << ") than previous mapping '" << bestname << "' (" << bestmapping << ")");
                                bestmapping = ld;
                                bestname = cellname;
                        }
                }
        }

        unsigned size = stackmachine.ObjectSize(obj);
        for (unsigned i = 0; i < size; ++i)
        {
                std::string cellname = columnnamemapper.GetReverseMapping(stackmachine.ObjectMemberNameByNr(obj, i)).stl_str();
                int ld = Blex::LevenshteinDistance(name, cellname);
                if (bestmapping == -1 || ld < bestmapping)
                {
                        //DEBUGPRINT("Mapping '" << cellname << "' better (" << ld << ") than previous mapping '" << bestname << "' (" << bestmapping << ")");
                        bestmapping = ld;
                        bestname = cellname;
                }
        }

        if (bestmapping == 1 || bestmapping == 2)
            ThrowVMRuntimeError(Error::MisspelledMember, name.c_str(), bestname.c_str());
        else
            ThrowVMRuntimeError(Error::MemberDoesNotExist, name.c_str());
}

bool VirtualMachine::ObjectMemberInsert(VarId obj, ColumnNameId nameid, bool this_access, bool is_private, VarId new_value)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (type->objdefs.back()->def->flags & ObjectTypeFlags::Static)
        {
                Blex::StringPair name = columnnamemapper.GetReverseMapping(nameid);
                if (name.empty() || name.begin[0] != '^')
                    ThrowVMRuntimeError(Error::CannotDynamicallyModifyStaticObjectType);
        }

        if (ResolveVTableEntry(obj, nameid))
            ThrowVMRuntimeError(Error::MemberAlreadyExists, columnnamemapper.GetReverseMapping(nameid).stl_str().c_str());
        if (stackmachine.ObjectMemberExists(obj, nameid))
            ThrowVMRuntimeError(Error::MemberAlreadyExists, columnnamemapper.GetReverseMapping(nameid).stl_str().c_str());

        return stackmachine.ObjectMemberInsert(obj, nameid, this_access, is_private, true, new_value);
}

bool VirtualMachine::ObjectMemberDelete(VarId obj, ColumnNameId nameid, bool this_access)
{
        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackmachine.ObjectGetTypeDescriptor(obj));
        if (type->objdefs.back()->def->flags & ObjectTypeFlags::Static)
        {
                Blex::StringPair name = columnnamemapper.GetReverseMapping(nameid);
                if (name.empty() || name.begin[0] != '^')
                    ThrowVMRuntimeError(Error::CannotDynamicallyModifyStaticObjectType);
        }

        if (ResolveVTableEntry(obj, nameid))
            ThrowVMRuntimeError(Error::MemberDeleteNotAllowed);

        return stackmachine.ObjectMemberDelete(obj, nameid, this_access);
}

bool VirtualMachine::ObjectMemberCopy(VarId obj, ColumnNameId nameid, bool this_access, VarId storeto)
{
        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        bool is_hat = nameid == cn_cache.col_hat;

        if (!entry)
        {
                if (stackmachine.ObjectMemberCopy(obj, nameid, this_access, storeto))
                    return true;

                auto namestr = columnnamemapper.GetReverseMapping(nameid);
                if (namestr.size() >= 2 && *namestr.begin == '^')
                {
                        is_hat = true;
                        entry = ResolveVTableEntry(obj, cn_cache.col_hat);
                }

                if (!entry || entry->type != ObjectCellType::Property)
                    throw VMRuntimeError(Error::MemberDoesNotExist, columnnamemapper.GetReverseMapping(nameid).stl_str());
        }

        if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(obj))
            throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        switch (entry->type)
        {
        case ObjectCellType::Member: break;
        case ObjectCellType::Method:
            throw VMRuntimeError(Error::CannotGetMethodValue);
        case ObjectCellType::Property:
            {
                    this_access = true;

                    if (!entry->getter_nameid)
                        throw VMRuntimeError(Error::ReadingWriteOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                    LinkedLibrary::ObjectVTableEntry const *getter = ResolveVTableEntry(obj, entry->getter_nameid);
                    if (!getter)
                        ThrowInternalError("Could not locate getter function of property");

                    switch (getter->type)
                    {
                    case ObjectCellType::Member: // redirect to variable
                        {
                                nameid = getter->nameid;
                        } break;
                    case ObjectCellType::Method:
                        {
                                if (is_hat)
                                    stackmachine.SetString(stackmachine.PushVariables(1), columnnamemapper.GetReverseMapping(nameid));
                                stackmachine.PushCopy(obj);
                                SetupReturnStackframe();
                                PrepareObjMethodCallByEntry(getter, is_hat ? 2 : 1, this_access, false);
                                Run(false, false);
                                if (vmgroup->TestMustAbort() || is_unwinding)
                                    return false;
                                stackmachine.MoveFrom(storeto, stackmachine.StackPointer() - 1);
                                stackmachine.PopVariablesN(1);
                                return true;
                        }
                    default:
                        ThrowInternalError("Found a property as getter for another property");
                    }
            }
        default: ;
        }

        if (!stackmachine.ObjectMemberCopy(obj, nameid, this_access, storeto))
            ObjectThrowMemberNotFound(obj, nameid);
        return true;
}

VarId VirtualMachine::ObjectMemberRef(VarId obj, ColumnNameId nameid, bool this_access)
{
        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        if (entry)
        {
                if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(obj))
                    throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

                switch (entry->type)
                {
                case ObjectCellType::Member: break;
                case ObjectCellType::Method:
                    throw VMRuntimeError(Error::CannotGetMethodValue);
                case ObjectCellType::Property:
                    throw VMRuntimeError(Error::InternalError, "ObjectMemberRef may NOT be invoked for properties");
                default: ;
                }
        }
        VarId retval = stackmachine.ObjectMemberRef(obj, nameid, this_access);
        if (!retval)
            ObjectThrowMemberNotFound(obj, nameid);
        return retval;
}

ObjectCellType::_type VirtualMachine::ObjectMemberType(VarId obj, ColumnNameId nameid)
{
        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        if (entry) // ADDME: access control?
            return entry->type;

        VarId retval = stackmachine.ObjectMemberGet(obj, nameid, true);
        if (!retval)
            return ObjectCellType::Unknown;
        return ObjectCellType::Member;
}

bool VirtualMachine::ObjectMemberSet(VarId obj, ColumnNameId nameid, bool this_access, VarId new_value)
{
        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        bool is_hat = nameid == cn_cache.col_hat;

        if (!entry)
        {
                stackmachine.CastTo(new_value, stackmachine.ObjectMemberType(obj, nameid));
                if (stackmachine.ObjectMemberSet(obj, nameid, this_access, new_value))
                    return true;

                auto namestr = columnnamemapper.GetReverseMapping(nameid);
                if (namestr.size() >= 2 && *namestr.begin == '^')
                {
                        is_hat = true;
                        entry = ResolveVTableEntry(obj, cn_cache.col_hat);
                }

                if (!entry || entry->type != ObjectCellType::Property)
                    ObjectThrowMemberNotFound(obj, nameid);
        }

        if (entry->is_private && !this_access && !stackmachine.ObjectIsPrivilegedReference(obj))
            throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        switch (entry->type)
        {
        case ObjectCellType::Member:
            stackmachine.CastTo(new_value, entry->var_type);
            break;
        case ObjectCellType::Method:
            ThrowInternalError("FIXME: may not access the value of a method");
        case ObjectCellType::Property:
            {
                    this_access = true;

                    if (!entry->setter_nameid)
                        throw VMRuntimeError(Error::WritingReadOnlyProperty, columnnamemapper.GetReverseMapping(nameid).stl_str());
                    LinkedLibrary::ObjectVTableEntry const *setter = ResolveVTableEntry(obj, entry->setter_nameid);
                    if (!setter)
                        ThrowInternalError("Could not locate setter function of property");

                    switch (setter->type)
                    {
                    case ObjectCellType::Member: // redirect to variable
                        {
                                nameid = setter->nameid;
                                stackmachine.CastTo(new_value, setter->var_type);
                        } break;
                    case ObjectCellType::Method:
                        {
                                // opcode and function param order is reversed, so reverse object and param
                                VarId var = stackmachine.PushVariables(is_hat ? 3 : 2);
                                stackmachine.CopyFrom(var, new_value);
                                if (is_hat)
                                {
                                        stackmachine.SetString(var + 1, columnnamemapper.GetReverseMapping(nameid));
                                        stackmachine.CopyFrom(var + 2, obj);
                                }
                                else
                                    stackmachine.CopyFrom(var + 1, obj);

                                SetupReturnStackframe();
                                PrepareObjMethodCallByEntry(setter, is_hat ? 3 : 2, this_access, true);
                                Run(false, false);
                                if (vmgroup->TestMustAbort() || is_unwinding)
                                    return false;
                                stackmachine.PopVariablesN(1);
                                return true;
                        }
                    default:
                        ThrowInternalError("Found a property as setter for another property");
                    }
            }
        default: ;
        }

        if (!stackmachine.ObjectMemberSet(obj, nameid, this_access, new_value))
            ObjectThrowMemberNotFound(obj, nameid);
        return true;
}

bool VirtualMachine::ObjectMemberExists(VarId obj, ColumnNameId nameid)
{
        return ((stackmachine.ObjectExists(obj) && ResolveVTableEntry(obj, nameid) != 0)
                || stackmachine.ObjectMemberExists(obj, nameid));
}

bool VirtualMachine::ObjectMemberAccessible(VarId obj, ColumnNameId nameid, bool this_access)
{
        bool privileged_ref = this_access || stackmachine.ObjectIsPrivilegedReference(obj);

        LinkedLibrary::ObjectVTableEntry const *entry = ResolveVTableEntry(obj, nameid);
        if (entry)
        {
                if (entry->is_private && !privileged_ref)
                    return false;
                return true;
        }
        return stackmachine.ObjectMemberAccessible(obj, nameid, privileged_ref);
}

void VirtualMachine::DoCmp()
{
        VarId arg1 = stackmachine.StackPointer() - 2;
        VarId arg2 = arg1 + 1;

        stackmachine.SetInteger(arg1, stackmachine.Compare(arg1, arg2, true));
        stackmachine.PopVariablesN(1);
}

void VirtualMachine::DoCmp2()
{
        VarId arg1 = stackmachine.StackPointer() - 3;
        VarId arg2 = arg1 + 1;
        VarId arg3 = arg1 + 2;
        signed value;

        ConditionCode::_type type = static_cast<ConditionCode::_type>(stackmachine.GetInteger(arg3));
        stackmachine.PopVariablesN(1);

        value = stackmachine.Compare(arg1, arg2, true);
        stackmachine.PopVariablesN(1);

        bool istrue;
        switch (type)
        {
        case ConditionCode::Less:           istrue = value < 0; break;
        case ConditionCode::LessEqual:      istrue = value <= 0; break;
        case ConditionCode::Equal:          istrue = value == 0; break;
        case ConditionCode::Bigger:         istrue = value > 0; break;
        case ConditionCode::BiggerEqual:    istrue = value >= 0; break;
        case ConditionCode::UnEqual:        istrue = value != 0; break;
        default:
            std::string nr = Blex::AnyToString<int>(type);
            throw VMRuntimeError (Error::InternalError, "Invalid virtual machine compare type '"+nr+"' encountered");
        }
        stackmachine.SetBoolean(arg1, istrue);
}

void VirtualMachine::DoLoadTypeId(int32_t id)
{
        /* ADDME: How often does this TypeID occur? Isn't thej repeating of Set() every time harmful here? */
        VarId var = stackmachine.StackPointer();
        stackmachine.PushVariables(1);

        std::pair< Library const *, unsigned > lib_id_pair(executionstate.library, id);

        TypeInfoIds::iterator it = typeinfo_ids.find(lib_id_pair);
        if (it != typeinfo_ids.end())
            stackmachine.SetInteger(var, it->second);
        else
        {
                DBTypeInfo const *tabledef =
                    &executionstate.library->GetWrappedLibrary().resident.types[id];
                unsigned tim_id = typeinfomapper.Set(tabledef);

                typeinfo_ids.insert(std::make_pair(lib_id_pair, tim_id));

                stackmachine.SetInteger(var, tim_id);
        }
}

void VirtualMachine::DoThrow2()
{
        VarId arg1 = stackmachine.StackPointer() - 3;
        VarId arg2 = arg1 + 1;
        VarId arg3 = arg1 + 2;

        throw VMRuntimeError (static_cast<Error::Codes>(stackmachine.GetInteger(arg1)), stackmachine.GetSTLString(arg2), stackmachine.GetSTLString(arg3));
}

/*void VirtualMachine::ThrowOnVMReturn(VMRuntimeError const &msg)
{
        if (dllinterface_error.get())
            return;  //already got an error!
        dllinterface_error.reset(new VMRuntimeError(msg));
}

void VirtualMachine::ThrowIfPendingVMError()
{
        if (dllinterface_error.get())
            throw *dllinterface_error;
}
  */
ObjectTypeDefinition * VirtualMachine::ExtendObjectType(ObjectTypeDefinition const *type, LinkedLibrary::LinkedObjectDef const *def)
{
        auto oit = objtypetree.find(std::make_pair(type, def));
        if (oit != objtypetree.end())
            return oit->second.get();

        std::shared_ptr< ObjectTypeDefinition > new_type;
        if (type)
            new_type.reset(new ObjectTypeDefinition(*type));
        else
            new_type.reset(new ObjectTypeDefinition);

        new_type->objdefs.push_back(def);
        new_type->new_entries.clear();

        for (Blex::PodVector< LinkedLibrary::ObjectVTableEntry >::const_iterator it = def->entries.begin(), end = def->entries.end(); it != end; ++it)
        {
                if (!it->is_toplevel)
                    continue;

                auto parent = new_type->entries.find(it->nameid);
                if (parent == new_type->entries.end())
                {
                        new_type->entries.insert(std::make_pair(it->nameid, *it));
                        new_type->new_entries.push_back(*it);
                        continue;
                }

                if (parent->second.type != it->type)
                    throw VMRuntimeError (Error::OverrideMemberTypeChange);

                if (!it->is_update)
                    throw VMRuntimeError (Error::UpdateReqForFieldOverride, columnnamemapper.GetReverseMapping(it->nameid).stl_str(), def->name);

                if (it->type == ObjectCellType::Property)
                {
                        // ADDME: check getter/setter signatures?
                        parent->second = *it;
                        continue;
                }
                else if (it->type == ObjectCellType::Member)
                    throw VMRuntimeError(Error::NoUpdateForVarMembers, columnnamemapper.GetReverseMapping(it->nameid).stl_str());

                // methods; they must have the same returntype
                bool is_ok = true;
                if (it->method->def->resulttype != parent->second.method->def->resulttype)
                    is_ok = false;
                else
                {
                        // Check all parameters
                        unsigned old_pcount = parent->second.method->def->parameters.size();
                        unsigned new_pcount = it->method->def->parameters.size();

                        unsigned old_is_vararg = parent->second.method->def->flags & FunctionFlags::VarArg;
                        unsigned new_is_vararg = it->method->def->flags & FunctionFlags::VarArg;

                        if (old_is_vararg != new_is_vararg)
                            is_ok = false;
                        else if (new_is_vararg)
                        {
                                // Parameter count may not change for vararg function
                                if (old_pcount != new_pcount)
                                    is_ok = false;
                        }
                        else
                        {
                                // New may not have less parameters
                                if (old_pcount > new_pcount)
                                    is_ok = false;
                        }

                        if (is_ok)
                        {
                                FunctionDef::Parameters::const_iterator
                                        o_it = parent->second.method->def->parameters.begin(),
                                        o_end = parent->second.method->def->parameters.end(),
                                        n_it = it->method->def->parameters.begin(),
                                        n_end = it->method->def->parameters.end();

                                for (; o_it != o_end && is_ok; ++o_it, ++n_it)
                                {
                                        // If old has a default, new must have one too
                                        if (o_it->defaultid >= 0 && n_it->defaultid == -1)
                                            is_ok = false;
                                        // types must be the same
                                        if (o_it->type != n_it->type)
                                            is_ok = false;
                                }
                                for (; n_it != n_end && is_ok; ++n_it)
                                {
                                        // if new has more parameters, they must all have a default
                                        if (n_it->defaultid == -1)
                                            is_ok = false;
                                }
                        }
                }
                if (!is_ok)
                    throw VMRuntimeError(Error::NeedCompatibleSignatures, columnnamemapper.GetReverseMapping(it->nameid).stl_str(), def->name);

                parent->second = *it;
        }

        objtypetree.insert(std::make_pair(std::make_pair(type, def), new_type));
        return new_type.get();
}

void VirtualMachine::Suspend()
{
        SetupReturnStackframe();
        is_suspended=true;
}

void VirtualMachine::EnableFunctionProfiling()
{
        profiledata.profile_functions = true;

        // Initialize all stack frames of this VM
        VirtualMachine *current = this;
        uint64_t now = Blex::GetSystemCurrentTicks();
        for (CallStack::reverse_iterator it = callstack.rbegin(); it != callstack.rend(); ++it)
        {
                if (it->type == StackElementType::ReturnToOtherVM || it->type == StackElementType::SwitchToOtherVM)
                    current = it->vm;

                if (current == this)
                {
                        it->createtime = now;
                        it->childtime = 0;
                }
        }
}

void VirtualMachine::DisableFunctionProfiling()
{
        profiledata.profile_functions = false;
}

void VirtualMachine::ResetFunctionProfile()
{
        profiledata.Reset();
}

void VirtualMachine::EnableMemoryProfiling()
{
        profiledata.profile_memory = true;
        stackmachine.SetKeepAllocStats(true);
        SetStateShortcuts(false);
}

void VirtualMachine::DisableMemoryProfiling()
{
        profiledata.profile_memory = false;
        stackmachine.SetCurrentAllocStats(0);

        // FIXME: make configurable
        //stackmachine.SetKeepAllocStats(true);
}

void VirtualMachine::ResetMemoryProfile()
{
        stackmachine.SetCurrentAllocStats(0);
        stackmachine.SetKeepAllocStats(false); // Throws away tracking state
        profiledata.calltree.Reset();

        if (profiledata.profile_memory)
        {
                stackmachine.SetKeepAllocStats(true);
                SetStateShortcuts(false);
        }
}

void VirtualMachine::EnableCoverageProfiling()
{
        profiledata.profile_coverage = true;
        SetStateShortcuts(false);

        // Must switch runinternal to debug variant
        *vmgroup->GetAbortFlag() = HSVM_ABORT_YIELD;
}

void VirtualMachine::DisableCoverageProfiling()
{
        profiledata.profile_coverage = false;
        profiledata.library_coverage_map = nullptr;

        // Must switch runinternal to debug variant
        *vmgroup->GetAbortFlag() = HSVM_ABORT_YIELD;
}

void VirtualMachine::ResetCoverageProfile()
{
        profiledata.library_coverage_map = nullptr;

        profiledata.coverage_data.clear();
        if (profiledata.profile_coverage)
            SetStateShortcuts(false);
}

VMGroup::VMGroup(Environment &_librarian, Blex::ContextRegistrator &_creg, bool _highpriority)
: librarian(_librarian)
, creg(_creg)
, contextkeeper(_creg)
, abortflag(&defaultabortflag)
, defaultabortflag(0)
, mainvm(0)
, currentvm(0)
, jobmanager(0)
, refcount(0)
, is_run_by_jobmgr(false)
, fd_signal_pipe(-1)
{
        TC_PRINT("Creating VM group " << this);
        jmdata.highpriority = _highpriority;
}


VMGroup::~VMGroup()
{
        typedef Blex::ObjectOwner<VirtualMachine>::reverse_iterator VMRItr;
//        for(VMRItr itr = vms.rbegin(); itr!=vms.rend(); ++itr)
//            (*itr)->riftracker.MarkUncallable();
        for(VMRItr itr = vms.rbegin(); itr!=vms.rend(); ++itr)
            (*itr)->sqlsupport.Cleanup();
        for(VMRItr itr = vms.rbegin(); itr!=vms.rend(); ++itr)
            (*itr)->contextkeeper.Reset();
        for(VMRItr itr = vms.rbegin(); itr!=vms.rend(); ++itr)
            (*itr)->stackmachine.Reset();
//        for(VMRItr itr = vms.rbegin(); itr!=vms.rend(); ++itr)
//            itr->blobhandler.Reset();

        // Reset all contexts before destroying the vms and their context keepers
        for(VMRItr itr = vms.rbegin(); itr!=vms.rend(); ++itr)
            (*itr)->contextkeeper.Reset();
        contextkeeper.Reset();
        TC_PRINT("Deleted VM group " << this);
}

HSVM *VMGroup::CreateVirtualMachine()
{
        VirtualMachine *newvm = new VirtualMachine(this, librarian, creg, errorhandler, callstack);
        vms.Adopt(newvm);
        if (!mainvm)
        {
                mainvm = newvm;
                currentvm = newvm;
        }

        librarian.OnNewVM(*newvm);
        return *newvm;
}

void VMGroup::SetupConsole(HSVM *vm, std::vector<std::string> const &args) //ADDME: SHouldn't this be a VMGroup-wide resource?
{
        HareScript::SetupConsole(*GetVirtualMachine(vm));

        std::vector<const char*> argsptrs(args.size());
        for(unsigned i=0;i<args.size();++i)
            argsptrs[i] = args[i].c_str();

        HSVM_SetConsoleArguments(vm, args.size(), &argsptrs[0]);
}

uint8_t VMGroup::GetConsoleExitCode(HSVM *vm)
{
        return HSVM_GetConsoleExitCode(vm);
}

void* VirtualMachine::LoadHarescriptModule(std::string const &name)
{
        return environment.LoadHarescriptModule(name);
}

OutputObject * VirtualMachine::GetOutputObject(int id, bool through_redirect)
{
        OutputObject **myobject = outobjects.Get(id);
        if (!myobject || !*myobject)
        {
                std::string fileid;
                Blex::EncodeNumber(id, 10, std::back_inserter(fileid));
                throw VMRuntimeError(through_redirect ? Error::InvalidRedirectedFileId : Error::InvalidFileId, fileid);
        }
        return *myobject;
}

void VirtualMachine::GetVMStats(VMStats *stats)
{
        stackmachine.GetVMStats(stats);
        stats->executelibrary = executelibrary;
        stats->instructions_executed = profiledata.instructions_executed;
        stats->blobstore = (blobmanager.GetBlobUsage(this) + 1023) / 1024;
}

void VirtualMachine::EncodeVMStats(VarId id_set, VMStats const &stats)
{
        stackmachine.InitVariable(id_set, VariableTypes::Record);
        stackmachine.SetInteger(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("STACK")), stats.stacklength);
        stackmachine.SetInteger(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("HEAP")), stats.heaplength);
        stackmachine.SetInteger(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("BACKINGSTORE")), stats.backingstorelength);
        stackmachine.SetInteger64(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("BLOBSTORE")), stats.blobstore);
        stackmachine.SetInteger(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("OBJECTCOUNT")), stats.objectcount);
        stackmachine.SetInteger64(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("INSTRUCTIONS")), stats.instructions_executed);
        stackmachine.SetSTLString(stackmachine.RecordCellCreate(id_set, stackmachine.columnnamemapper.GetMapping("LIBRARY")), stats.executelibrary);
}

VirtualMachine::GeneratorContext * VirtualMachine::GetGeneratorContext(VarId arg1)
{
        return static_cast< GeneratorContext *>(stackmachine.ObjectGetContext(arg1, GeneratorContextId, &CreateGeneratorContext, &DestroyGeneratorContext, NULL, true));
}

VirtualMachine::AsyncCallContext * VirtualMachine::GetAsyncCallContext(VarId arg1, bool autocreate)
{
        return static_cast< AsyncCallContext *>(stackmachine.ObjectGetContext(arg1, AsyncCallContextId, &CreateAsyncCallContext, &DestroyAsyncCallContext, NULL, autocreate));
}

void VirtualMachine::PushAsyncTraceContext(std::shared_ptr< AsyncStackTrace > const &trace, std::shared_ptr< AsyncStackTrace > const &prev_segment, unsigned skipframes)
{
        AsyncContext context;
        context.callstack_depth = callstack.size() + skipframes;
        context.trace = trace;
        context.prev_segment = prev_segment;
        vmgroup->asynccontexts.push_back(context);
}

void VirtualMachine::PopAsyncTraceContext()
{
        if (!vmgroup->asynccontexts.empty())
            vmgroup->asynccontexts.pop_back();
}

void VirtualMachine::RegisterHandleKeeper(IdMapStorageRapporter *rapporter)
{
        idmapstorages.insert(rapporter);
}

void VirtualMachine::UnregisterHandleKeeper(IdMapStorageRapporter *rapporter)
{
        idmapstorages.erase(rapporter);
}
                                                     /*
void VMGroup::ThrowIfPendingVMError(HSVM *vm)
{
        GetVirtualMachine(vm)->ThrowIfPendingVMError();
}
                                                       */
void VMGroup::SetAbortFlag(volatile unsigned *flaglocation)
{
        abortflag = flaglocation ? flaglocation : &defaultabortflag;
}

void VMGroup::AddAbortFlagReference(std::shared_ptr< void > const &ref)
{
        abortflag_refs.push_back(ref);
}

std::pair<std::string, unsigned> VMGroup::GetCodeLocation(HSVM *vm) const
{
        return std::pair<std::string, unsigned>(GetVirtualMachine(vm)->executionstate.library->GetLibURI(), GetVirtualMachine(vm)->executionstate.codeptr);
}
const ProfileData& VMGroup::GetProfileData(HSVM *vm) const
{
        return GetVirtualMachine(vm)->profiledata;
}

Blex::ContextKeeper& VMGroup::GetContextKeeper(HSVM *vm)
{
        return GetVirtualMachine(vm)->GetContextKeeper();
}

void VirtualMachine::Run(bool suspendable, bool allow_deinit)
{
        VirtualMachine *oldvm = vmgroup->currentvm;
        vmgroup->currentvm = this;
        vmgroup->Run(suspendable, allow_deinit);
        vmgroup->currentvm = oldvm;
}

void VMGroup::Run(bool suspendable, bool allow_deinit)
{
        while (true)
        {
                // Save suspendable state around vm invocation
                bool old_suspendable = currentvm->is_suspendable;
                currentvm->is_suspendable = suspendable;

                VirtualMachine *switchto;

                if (dbg.IsDebugging() || currentvm->profiledata.profile_coverage)
                    switchto = currentvm->RunInternal< true >(allow_deinit);
                else
                    switchto = currentvm->RunInternal< false >(allow_deinit);

                // And restore it
                currentvm->is_suspendable = old_suspendable;

                if (!switchto)
                    break;

                currentvm = switchto;
        }
}

void VMGroup::GetListOfVMs(std::vector< VirtualMachine * > *_vms)
{
        for (Blex::ObjectOwner< VirtualMachine >::iterator it = vms.begin(); it != vms.end(); ++it)
            _vms->push_back(&**it);
}

int32_t VMGroup::GetVMId(VirtualMachine *vm) const
{
        for (auto it = vms.begin(); it != vms.end(); ++it)
            if (&**it == vm)
                return std::distance(vms.begin(), it);
        return -1;
}

VirtualMachine * VMGroup::GetVMById(int32_t id)
{
        if (id < 0 || static_cast< unsigned >(id) >= vms.size())
            return 0;

        return vms[id];
}

void VMGroup::SetMainScript(std::string const &script)
{
        if (jobmanager)
        {
                JobManager::LockedJobData::ReadRef lock(jobmanager->jobdata);
                mainscript = script;
        }
        else
            mainscript = script;
}

void VMGroup::CloseHandles()
{
        typedef Blex::ObjectOwner< VirtualMachine >::reverse_iterator VMRItr;

        parentipclink.reset();

        for(VMRItr itr = vms.rbegin(); itr != vms.rend(); ++itr)
        {
                Baselibs::SystemContext systemcontext((*itr)->GetContextKeeper());
                systemcontext->CloseHandles();

                JobManagerContext jmcontext((*itr)->GetContextKeeper());
                jmcontext->namedports.clear();
                jmcontext->linkendpoints.clear();
                jmcontext->jobs.clear();
                jmcontext->locks.clear();

                (*itr)->sqlsupport.Cleanup();
        }
}

void StoreHSMessage(HSVM *hsvm, HSVM_VariableId toset, HareScript::Message const &msg, bool is_trace, bool is_error)
{
        ColumnNameCache const &cn_cache = GetVirtualMachine(hsvm)->cn_cache;

        HSVM_BooleanSet(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_iserror), is_error && !is_trace);
        HSVM_BooleanSet(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_iswarning), !is_error && !is_trace);
        HSVM_BooleanSet(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_istrace), is_trace);
        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_filename), msg.filename);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_line), msg.position.line);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_col), msg.position.column);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_code), msg.code);
        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_param1), msg.msg1);
        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_param2), msg.msg2);
        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_func), msg.func);
        if (msg.code < 0)
        {
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_message), "");
        }
        else
        {
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, toset, cn_cache.col_message), GetMessageString(msg));
        }
}

void StoreHSMessages(HSVM *hsvm, HSVM_VariableId toset, HareScript::ErrorHandler::MessageList const &msgs, bool is_error)
{
        for (HareScript::ErrorHandler::MessageList::const_iterator it = msgs.begin(); it != msgs.end(); ++it)
            StoreHSMessage(hsvm, HSVM_ArrayAppend(hsvm, toset), *it, false, is_error);
}

//split so eg. selfcompile can directly access the error list converter
void GetMessageList(HSVM *vm, HSVM_VariableId errorstore, HareScript::ErrorHandler const &errhandler, bool with_trace)
{
        HSVM_SetDefault(vm, errorstore, HSVM_VAR_RecordArray);
        StoreHSMessages(vm, errorstore, errhandler.GetWarnings(), false);
        StoreHSMessages(vm, errorstore, errhandler.GetErrors(), true);
        if (with_trace)
        {
                int tracecount = -1;
                for (HareScript::ErrorHandler::StackTrace::const_iterator itr = errhandler.GetStackTrace().begin();
                     itr != errhandler.GetStackTrace().end();
                     ++itr)
                {
                        HareScript::Message tracemsg(true, tracecount, itr->func);
                        tracemsg.func = itr->func;
                        tracemsg.filename = itr->filename;
                        tracemsg.position = itr->position;

                        StoreHSMessage(vm, HSVM_ArrayAppend(vm, errorstore), tracemsg, true, false);
                        --tracecount;
                }
        }
}

void VirtualMachine::PushStopExecuteFrame()
{
        PushFrameRaw(StackElementType::StopExecute);
        executionstate.codeptr = SignalCodeptr;
}

void VirtualMachine::PushReturnToOtherVMFrame(VirtualMachine *vm)
{
        CallStackElement &elt = PushFrameRaw(StackElementType::ReturnToOtherVM);
        elt.vm = vm;
        executionstate.codeptr = SignalCodeptr;
}

void VirtualMachine::PushSwitchToOtherVMFrame(VirtualMachine *vm)
{
        CallStackElement &elt = PushFrameRaw(StackElementType::SwitchToOtherVM);
        elt.vm = vm;
        executionstate.codeptr = SignalCodeptr;
}

void VirtualMachine::PushDummyFrame()
{
        PushFrameRaw(StackElementType::Dummy);
}

void VirtualMachine::PushTailcallFrame(std::function< void(bool) > const &tailcall)
{
        PushFrameRaw(StackElementType::TailCall);
        tailcalls.push_back(tailcall);
        executionstate.codeptr = SignalCodeptr;
}

ColumnNameCache::ColumnNameCache(ColumnNames::LocalMapper &columnnamemapper)
{
        col_allowcomments = columnnamemapper.GetMapping("ALLOWCOMMENTS");
        col_authenticationrecord = columnnamemapper.GetMapping("AUTHENTICATIONRECORD");
        col_baseptr = columnnamemapper.GetMapping("BASEPTR");
        col_casesensitive = columnnamemapper.GetMapping("CASESENSITIVE");
        col_code = columnnamemapper.GetMapping("CODE");
        col_codeptr = columnnamemapper.GetMapping("CODEPTR");
        col_col = columnnamemapper.GetMapping("COL");
        col_columnid = columnnamemapper.GetMapping("COLUMNID");
        col_columnname = columnnamemapper.GetMapping("COLUMNNAME");
        col_columns = columnnamemapper.GetMapping("COLUMNS");
        col_compile_id = columnnamemapper.GetMapping("COMPILE_ID");
        col_condition = columnnamemapper.GetMapping("CONDITION");
        col_conditions = columnnamemapper.GetMapping("CONDITIONS");
        col_connected = columnnamemapper.GetMapping("CONNECTED");
        col_creationdate = columnnamemapper.GetMapping("CREATIONDATE");
        col_dayofmonth = columnnamemapper.GetMapping("DAYOFMONTH");
        col_dayofweek = columnnamemapper.GetMapping("DAYOFWEEK");
        col_dayofyear = columnnamemapper.GetMapping("DAYOFYEAR");
        col_dbase_name = columnnamemapper.GetMapping("DBASE_NAME");
        col_done = columnnamemapper.GetMapping("DONE");
        col_errors = columnnamemapper.GetMapping("ERRORS");
        col_excessargstype = columnnamemapper.GetMapping("EXCESSARGSTYPE");
        col_exists = columnnamemapper.GetMapping("EXISTS");
        col_fase = columnnamemapper.GetMapping("FASE");
        col_filename = columnnamemapper.GetMapping("FILENAME");
        col_finishdate = columnnamemapper.GetMapping("FINISHDATE");
        col_firstunusedsource = columnnamemapper.GetMapping("FIRSTUNUSEDSOURCE");
        col_fixed = columnnamemapper.GetMapping("FIXED");
        col_flags = columnnamemapper.GetMapping("FLAGS");
        col_found = columnnamemapper.GetMapping("FOUND");
        col_func = columnnamemapper.GetMapping("FUNC");
        col_functionid = columnnamemapper.GetMapping("FUNCTIONID");
        col_groupid = columnnamemapper.GetMapping("GROUPID");
        col_handled = columnnamemapper.GetMapping("HANDLED");
        col_has_hs_code = columnnamemapper.GetMapping("HAS_HS_CODE");
        col_hat = columnnamemapper.GetMapping("^");
        col_highpriority = columnnamemapper.GetMapping("HIGHPRIORITY");
        col_hour = columnnamemapper.GetMapping("HOUR");
        col_id = columnnamemapper.GetMapping("ID");
        col_isdb = columnnamemapper.GetMapping("ISDB");
        col_iserror = columnnamemapper.GetMapping("ISERROR");
        col_istable = columnnamemapper.GetMapping("ISTABLE");
        col_istrace = columnnamemapper.GetMapping("ISTRACE");
        col_iswarning = columnnamemapper.GetMapping("ISWARNING");
        col_join_conditions = columnnamemapper.GetMapping("JOINCONDITIONS");
        col_length = columnnamemapper.GetMapping("LENGTH");
        col_libid = columnnamemapper.GetMapping("LIBID");
        col_liburi = columnnamemapper.GetMapping("LIBURI");
        col_limit = columnnamemapper.GetMapping("LIMIT");
        col_limitblocksize = columnnamemapper.GetMapping("LIMITBLOCKSIZE");
        col_line = columnnamemapper.GetMapping("LINE");
        col_manual = columnnamemapper.GetMapping("MANUAL");
        col_match_double_null = columnnamemapper.GetMapping("MATCH_DOUBLE_NULL");
        col_match_null = columnnamemapper.GetMapping("MATCH_NULL");
        col_max = columnnamemapper.GetMapping("MAX");
        col_max_block_rows = columnnamemapper.GetMapping("MAXBLOCKROWS");
        col_message = columnnamemapper.GetMapping("MESSAGE");
        col_messages  = columnnamemapper.GetMapping("MESSAGES");
        col_min = columnnamemapper.GetMapping("MIN");
        col_minute = columnnamemapper.GetMapping("MINUTE");
        col_month = columnnamemapper.GetMapping("MONTH");
        col_msecond = columnnamemapper.GetMapping("MSECOND");
        col_name = columnnamemapper.GetMapping("NAME");
        col_nulldefault = columnnamemapper.GetMapping("NULLDEFAULT");
        col_nulldefault_valid = columnnamemapper.GetMapping("NULLDEFAULT_VALID");
        col_objectid = columnnamemapper.GetMapping("OBJECTID");
        col_objecttypes = columnnamemapper.GetMapping("OBJECTTYPES");
        col_param = columnnamemapper.GetMapping("PARAM");
        col_param1 = columnnamemapper.GetMapping("PARAM1");
        col_param2 = columnnamemapper.GetMapping("PARAM2");
        col_parameters = columnnamemapper.GetMapping("PARAMETERS");
        col_pausereason = columnnamemapper.GetMapping("PAUSEREASON");
        col_pointer = columnnamemapper.GetMapping("POINTER");
        col_position = columnnamemapper.GetMapping("POSITION");
        col_privileged = columnnamemapper.GetMapping("PRIVILEGED");
        col_query_limit = columnnamemapper.GetMapping("QUERY_LIMIT");
        col_querytype = columnnamemapper.GetMapping("QUERYTYPE");
        col_read = columnnamemapper.GetMapping("READ");
        col_realstatus = columnnamemapper.GetMapping("REALSTATUS");
        col_removed = columnnamemapper.GetMapping("REMOVED");
        col_result = columnnamemapper.GetMapping("RESULT");
        col_returntype = columnnamemapper.GetMapping("RETURNTYPE");
        col_running = columnnamemapper.GetMapping("RUNNING");
        col_running_timeout = columnnamemapper.GetMapping("RUNNING_TIMEOUT");
        col_script = columnnamemapper.GetMapping("SCRIPT");
        col_second = columnnamemapper.GetMapping("SECOND");
        col_single = columnnamemapper.GetMapping("SINGLE");
        col_single_conditions = columnnamemapper.GetMapping("SINGLECONDITIONS");
        col_source = columnnamemapper.GetMapping("SOURCE");
        col_sourcetime = columnnamemapper.GetMapping("SOURCETIME");
        col_stack = columnnamemapper.GetMapping("STACK");
        col_stacksize = columnnamemapper.GetMapping("STACKSIZE");
        col_stacktrace = columnnamemapper.GetMapping("STACKTRACE");
        col_statistics = columnnamemapper.GetMapping("STATISTICS");
        col_status = columnnamemapper.GetMapping("STATUS");
        col_t1_columnid = columnnamemapper.GetMapping("T1_COLUMNID");
        col_t1_columnname = columnnamemapper.GetMapping("T1_COLUMNNAME");
        col_t2_columnid = columnnamemapper.GetMapping("T2_COLUMNID");
        col_t2_columnname = columnnamemapper.GetMapping("T2_COLUMNNAME");
        col_table1_id = columnnamemapper.GetMapping("TABLE1_ID");
        col_table2_id = columnnamemapper.GetMapping("TABLE2_ID");
        col_table_sources = columnnamemapper.GetMapping("TABLESOURCES");
        col_tableid = columnnamemapper.GetMapping("TABLEID");
        col_tablenr = columnnamemapper.GetMapping("TABLENR");
        col_tablenr1 = columnnamemapper.GetMapping("TABLENR1");
        col_tablenr2 = columnnamemapper.GetMapping("TABLENR2");
        col_timeout = columnnamemapper.GetMapping("TIMEOUT");
        col_total_running = columnnamemapper.GetMapping("TOTAL_RUNNING");
        col_type = columnnamemapper.GetMapping("TYPE");
        col_typeinfo = columnnamemapper.GetMapping("TYPEINFO");
        col_typeinfonr = columnnamemapper.GetMapping("TYPEINFONR");
        col_typeinfonr1 = columnnamemapper.GetMapping("TYPEINFONR1");
        col_typeinfonr2 = columnnamemapper.GetMapping("TYPEINFONR2");
        col_updatecolumnlist = columnnamemapper.GetMapping("UPDATECOLUMNLIST");
        col_value = columnnamemapper.GetMapping("VALUE");
        col_variables = columnnamemapper.GetMapping("VARIABLES");
        col_vm = columnnamemapper.GetMapping("VM");
        col_week = columnnamemapper.GetMapping("WEEK");
        col_wrapobjects = columnnamemapper.GetMapping("WRAPOBJECTS");
        col_write = columnnamemapper.GetMapping("WRITE");
        col_year = columnnamemapper.GetMapping("YEAR");
        col_yearofweek = columnnamemapper.GetMapping("YEAROFWEEK");
}

void RegisterHandleKeeper(VirtualMachine *vm, IdMapStorageRapporter *rapporter)
{
        vm->RegisterHandleKeeper(rapporter);
}

void UnregisterHandleKeeper(VirtualMachine *vm, IdMapStorageRapporter *rapporter)
{
        vm->UnregisterHandleKeeper(rapporter);
}

} // End of namespace HareScript
