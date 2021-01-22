#ifndef blex_webhare_harescript_hsvm_context
#define blex_webhare_harescript_hsvm_context

#include <signal.h>

#include <blex/context.h>
#include <blex/pipestream.h>
#include <blex/objectowner.h>

#include "hsvm_dllinterface.h"
#include "hsvm_constants.h"
#include "hsvm_stackmachine.h"
#include "hsvm_sqllib.h"
#include "hsvm_environment.h"
#include "hsvm_idmapstorage.h"
#include "hsvm_processmgr.h"
#include "hsvm_functioncalltree.h"
#include <blex/utils.h>
#include <unordered_map>
#include <unordered_set>

/*  The context contains the Environment and the Virtual Machine. Context is
    the wrong name for this, this has to be corrected.

    Status:
    - The virtual machine is up and running.
    - The environment is up and running.
    - Loading of library (by external request) while that library is already (de-)initializing
      has not been implemented.
    - ADDME: build interface for builtin functions

    FIXME: check definition order for components (which relies on which)
*/

/* Component dependencies and initialiation order of components in the VM:
        1. TypeInfoMapper typeinfomapper
                Usable in times of destruction
                Relies on: none
        2. ColumnNames::LocalMapper columnnamemapper
                Some contexts may need the localmapper on destruction.
                Relies on: none
        3. Output objects
                The various contexts might create output objects
        3. Blex::ContextKeeper contextkeeper
                Contexts are needed in almost all following components
                Contexts may NOT access any VM object upon destruction!
                Relies on: Output objects (dllinterface, systemcontext)
        4. LocalBlobHandler blobhandler
                Relies on: contextkeeper
        5. StackMachine stackmachine
                The stackmachine frees blobs on destruction, need localblobhandler for that
                Relies on: contextkeeper, localblobhandler
        6. SQLSupport sqlsupport
                Relies on: contextkeeper
*/

namespace HareScript
{

class VirtualMachine;
class Environment;
class Library;
class JobManager;

inline VirtualMachine* GetVirtualMachine(HSVM *vm_ptr)
{
        return (VirtualMachine*)vm_ptr;
}

typedef std::pair< LinkedLibrary::ResolvedFunctionDef const *, LinkedLibrary::ResolvedFunctionDef const * > FunctionProfileKey;

struct FunctionProfileKeyHash
{
    public:
        std::size_t operator()(const FunctionProfileKey &x) const
        {
          return std::hash< LinkedLibrary::ResolvedFunctionDef const * >()(x.first) * 13 + std::hash< LinkedLibrary::ResolvedFunctionDef const * >()(x.second);
        }
};

/** Profiledata contains profile data about the execution of a script. This
    information is very limited for now, ths can extended later */
struct ProfileData
{
        //we need our own verison of Less for resolved functions, because there may be more Defs for a single function
        struct UniqueFunctionLess
        {
                bool operator()(LinkedLibrary::ResolvedFunctionDef const*lhs, LinkedLibrary::ResolvedFunctionDef const*rhs) const
                {
                        return lhs->lib < rhs->lib || (lhs->lib==rhs->lib && lhs->id<rhs->id);
                }
        };

        /// Set to true for function profile
        bool profile_functions;

        /// Set to true for memory profile
        bool profile_memory;

        /// Set to true for coverage profile
        bool profile_coverage;

        /// Profile per function
        struct FunctionProfile
        {
                /// Call count (recursion count for when second function is null)
                uint32_t callcount;

                /// Total time (callprofile)
                int64_t totaltime;

                /// Self time
                int64_t selftime;

                /// Total time (function profile by callee, corrected for recursion)
                int64_t totaltime_callee_nr;

                FunctionProfile() : callcount(0), totaltime(0), selftime(0), totaltime_callee_nr(0) {}
        };

        /// Function profiles
        typedef std::unordered_map< FunctionProfileKey, FunctionProfile, FunctionProfileKeyHash > FunctionProfiles;
        FunctionProfiles function_profiles;

        /// Number of instructions executed
        uint64_t instructions_executed;

        /// Total time elapsed
        uint64_t totaltime;

        /// Function call tree
        FunctionCallTree calltree;

        typedef std::unordered_map< Library const *, std::shared_ptr< Blex::PodVector< uint8_t > > > CoverageData;
        CoverageData coverage_data;

        /// Coverage map for current library code
        uint8_t *library_coverage_map;

        ProfileData()
        {
                instructions_executed = 0;
                totaltime = 0;
                profile_functions = false;
                profile_memory = false;
                profile_coverage = false;
                library_coverage_map = nullptr;
        };

        void Reset();
};

class IPCLinkEndPoint;

/// Element of the call stack. Contains all information to restore the state after a call.
struct CallStackElement
{
        /// Old base pointer
        BasePointer baseptr;

        /// VM to switch back to
        VirtualMachine *vm;

        /// Old Library
        Library const *library;

        /// Old function-id
        FunctionId function;

        /// Old code-ptr
        CodePtr codeptr;

        /// Creation time of this stack element
        uint64_t createtime;

        /// Total time spent in children functions
        uint64_t childtime;

        /// Type of stack element
        StackElementType::Type type;
};

typedef Blex::PodVector< CallStackElement > CallStack;

struct VMBreakPoint
{
        unsigned vm_id;
        std::string liburi;
        Blex::DateTime compile_id;
        unsigned codeptr;
        signed stacksize;
        bool manual;
};

/// Debugger admin async data, protected by debugger lock
struct VMGroupDebuggerAsyncData
{
        VMGroupDebuggerAsyncData()
        : inform_start_stop(false)
        , inform_next_suspend(false)
        , reset_breakpoints(false)
        , min_stack(0)
        , max_stack(-1)
        {}

        bool inform_start_stop;
        bool inform_next_suspend;
        bool reset_breakpoints;

        unsigned min_stack;
        unsigned max_stack;

        std::vector< VMBreakPoint > breakpoints;
};

struct VMGroupDebuggerData
{
        VMGroupDebuggerData() : min_stack(0), max_stack(-1) { }
        // List of breakpoints (uint8_t* to instructions) - second is pair (first: required callstacksize, -1 for ignore, second: manual breakpoint)
        std::unordered_multimap< uint8_t const *, std::pair< signed, bool > > breakpoints;
        unsigned min_stack;
        unsigned max_stack;

        inline bool IsDebugging() { return !breakpoints.empty() || min_stack != 0 || max_stack != (unsigned)-1; }
};

struct AsyncStackTraceElt
{
        /// Old Library
        Library const *library;

        /// Old function-id
        FunctionId function;

        /// Old code-ptr
        CodePtr codeptr;
};

struct AsyncStackTrace
{
        /// Whether this trace is pushed on the current async stack
        bool active;

        /// Nr of segments preceding this one
        uint64_t depth;

        /// Parent segment (not set when depth%10 = 0)
        std::shared_ptr< AsyncStackTrace > parent;

        /// Weak ptr to parent segment (only used when depth%10 = 0)
        std::weak_ptr< AsyncStackTrace > parent_weak;

        /// Stack trace elements
        Blex::SemiStaticPodVector< AsyncStackTraceElt, 32 > trace;

        AsyncStackTrace(): active(false), depth(0) {}
};

struct AsyncContext
{
        unsigned callstack_depth;

        /// Trace for this context
        std::shared_ptr< AsyncStackTrace > trace;

        /// Strong ptr to last segment
        std::shared_ptr< AsyncStackTrace > prev_segment;
};

/** The ControlInterface is returned to the application that wishes to execute
    a script. It publicises all usefull functions, and hides the VM to the rest
    of the world.

    This object is threadsafe only when calls are serialized */
class BLEXLIB_PUBLIC VMGroup
{
    private:
        Environment &librarian;
        Blex::ContextRegistrator &creg;

        /// Group contextkeeper
        Blex::ContextKeeper contextkeeper;

        /// Virtual machines in this group
        Blex::ObjectOwner<VirtualMachine> vms;

        /// Error handler for the vmgroup
        ErrorHandler errorhandler;

        /// Indicator whether script execution must be aborted
        volatile unsigned *abortflag;
        unsigned defaultabortflag;

        /// References to abortflag objects
        std::vector< std::shared_ptr< void > > abortflag_refs;

        /// Main VM for this vm group
        VirtualMachine *mainvm;

        /// Currently running vm
        VirtualMachine *currentvm;

        // --- Jobmgr stuff
        JobManager *jobmanager;

        /// Event that will be set to signalled when the group has finished
        Blex::StatefulEvent finishevent;

        /// Process manager data
        JobManagerGroupData jmdata;

        /// Reference counter  (managed by grouprefmutex in hsvm_processmgr.cpp)
        unsigned refcount;

        /// Main script (protected by grouprefmutex in hsvm_processmgr.cpp)
        std::string mainscript;

        /// External session id (protected by grouprefmutex in hsvm_processmgr.cpp)
        std::string externalsessionid;

        /** Current execution stack. Shared in vmgroup to ease stack trace analysis
        */
        CallStack callstack;

        bool is_run_by_jobmgr; // FIXME: remove when webserver auth scripts are rewritten to use jobmgr

        /// Creation date (set when created through jobmgr)
        //Blex::DateTime creationdate;

        /// Async debug data. Used a bit unsafe, but they are only booleans
        VMGroupDebuggerAsyncData dbg_async;

        // Debug data (breakpoints & such)
        VMGroupDebuggerData dbg;

        /// Asynchrone call contexts
        std::vector< AsyncContext > asynccontexts;

        void SetMainScript(std::string const &script);

    public:
        VMGroup(Environment &librarian, Blex::ContextRegistrator &creg, bool highpriority);

        ~VMGroup();

        inline JobManager * GetJobManager() const { return jobmanager; }

        /** Return our abort flag pointer */
        volatile unsigned * GetAbortFlag() const { return abortflag; }

        /** Tests if the VM should abort (errors pending or abort flag set).
           If calling from dllinterface, returns whether an error was pending, if aborted a pending exception is created.
           If calling from C++, pending errors are thrown, aborts are also thrown.
           @param from_dllinterface Flag if exception should be put into dllinterface_error (instead of being thrown)
           @return Returns if vm should be aborted when calling from dllinterface (C++ throws in that case) */
        inline bool TestMustAbort() { return *abortflag != HSVM_ABORT_DONT_STOP && *abortflag != HSVM_ABORT_YIELD; }

        /** Tests if the VM should yield (errors pending or abort flag set, or must yield).
           If calling from dllinterface, returns whether an error was pending, if aborted a pending exception is created.
           If calling from C++, pending errors are thrown, aborts are also thrown.
           @param from_dllinterface Flag if exception should be put into dllinterface_error (instead of being thrown)
           @return Returns if vm should be aborted when calling from dllinterface (C++ throws in that case) */
        inline bool TestMustYield() { return *abortflag != HSVM_ABORT_DONT_STOP; }

        /** Create a new virtual machine
            @param environmentname Name for the VM's environment */
        HSVM *CreateVirtualMachine();

        /** Setup console support for this instance. Enables the use of INPUTLINE
            GETARGUMENTS and other console functions. Useful for run and runscript
            @param args Arguments to be returned by GETARGUMENTS */
        void SetupConsole(HSVM *vm, std::vector<std::string> const &args);

        /** If console support is enabled, get the return value */
        uint8_t GetConsoleExitCode(HSVM *vm);

        /** Set our abort flag pointer */
        void SetAbortFlag(volatile unsigned *flaglocation);

        /** Add a reference to an abortflag; reference is kept until the vmgroup dies or the abortflag is reset */
        void AddAbortFlagReference(std::shared_ptr< void > const &ref);

        /** Returns current code location of execution. (Only valid when state of the machine is running)
            @return Pair of library-name, and code-location within that library */
        std::pair<std::string, unsigned> GetCodeLocation(HSVM *vm) const;

        /** Returns the profile data of the virtual machine */
        const ProfileData& GetProfileData(HSVM *vm) const;

        Blex::ContextKeeper& GetContextKeeper(HSVM *vm);

        ErrorHandler const & GetErrorHandler() const { return errorhandler; }

        /** Returns event that will become signalled when the vmgroup finishes execution
        */
        Blex::StatefulEvent & GetFinishEvent() { return finishevent; }

        Blex::ContextKeeper & GetContextKeeper() { return contextkeeper; }

        inline bool IsRunByJobMgr() { return is_run_by_jobmgr; }

        /// Link to parent IPC endpoint (access by own VM only). (cleared when registered as actual outputobject)
        std::shared_ptr< IPCLinkEndPoint > parentipclink;

        void Run(bool suspendable, bool allow_deinit);

        void GetListOfVMs(std::vector< VirtualMachine * > *vms);

        inline unsigned GetVMCount() const { return vms.size(); }

        int32_t GetVMId(VirtualMachine *vm) const;

        VirtualMachine * GetVMById(int32_t id);

        VirtualMachine * GetCurrentVM() { return currentvm; }

        /// Closes all handles of VMs in this group (after termination)
        void CloseHandles();

        /// process environment for jobs
        std::unique_ptr< Blex::Process::Environment > env;

        ///If >= 0, the pipe that will receive signals
        volatile sig_atomic_t fd_signal_pipe;

        friend class Tests;
        friend class VirtualMachine;
        friend class JobManager;
        friend class VMGroupRef;
        friend class Debugger;
};

/// Cache for column names
class ColumnNameCache
{
    public:
        ColumnNameCache(ColumnNames::LocalMapper &columnnamemapper);

        ColumnNameId col_allowcomments;
        ColumnNameId col_authenticationrecord;
        ColumnNameId col_baseptr;
        ColumnNameId col_casesensitive;
        ColumnNameId col_code;
        ColumnNameId col_codeptr;
        ColumnNameId col_col;
        ColumnNameId col_columnid;
        ColumnNameId col_columnname;
        ColumnNameId col_columns;
        ColumnNameId col_compile_id;
        ColumnNameId col_condition;
        ColumnNameId col_conditions;
        ColumnNameId col_connected;
        ColumnNameId col_creationdate;
        ColumnNameId col_dayofmonth;
        ColumnNameId col_dayofweek;
        ColumnNameId col_dayofyear;
        ColumnNameId col_dbase_name;
        ColumnNameId col_done;
        ColumnNameId col_errors;
        ColumnNameId col_excessargstype;
        ColumnNameId col_exists;
        ColumnNameId col_fase;
        ColumnNameId col_filename;
        ColumnNameId col_finishdate;
        ColumnNameId col_firstunusedsource;
        ColumnNameId col_fixed;
        ColumnNameId col_flags;
        ColumnNameId col_found;
        ColumnNameId col_func;
        ColumnNameId col_functionid;
        ColumnNameId col_groupid;
        ColumnNameId col_handled;
        ColumnNameId col_has_hs_code;
        ColumnNameId col_hat;
        ColumnNameId col_highpriority;
        ColumnNameId col_hour;
        ColumnNameId col_id;
        ColumnNameId col_isdb;
        ColumnNameId col_iserror;
        ColumnNameId col_istable;
        ColumnNameId col_istrace;
        ColumnNameId col_iswarning;
        ColumnNameId col_join_conditions;
        ColumnNameId col_length;
        ColumnNameId col_libid;
        ColumnNameId col_liburi;
        ColumnNameId col_limit;
        ColumnNameId col_limitblocksize;
        ColumnNameId col_line;
        ColumnNameId col_manual;
        ColumnNameId col_match_double_null;
        ColumnNameId col_match_null;
        ColumnNameId col_max;
        ColumnNameId col_max_block_rows;
        ColumnNameId col_message;
        ColumnNameId col_messages;
        ColumnNameId col_min;
        ColumnNameId col_minute;
        ColumnNameId col_month;
        ColumnNameId col_msecond;
        ColumnNameId col_name;
        ColumnNameId col_nulldefault;
        ColumnNameId col_nulldefault_valid;
        ColumnNameId col_objectid;
        ColumnNameId col_objecttypes;
        ColumnNameId col_param1;
        ColumnNameId col_param2;
        ColumnNameId col_param;
        ColumnNameId col_parameters;
        ColumnNameId col_pausereason;
        ColumnNameId col_pointer;
        ColumnNameId col_position;
        ColumnNameId col_privileged;
        ColumnNameId col_query_limit;
        ColumnNameId col_querytype;
        ColumnNameId col_read;
        ColumnNameId col_realstatus;
        ColumnNameId col_removed;
        ColumnNameId col_result;
        ColumnNameId col_returntype;
        ColumnNameId col_running;
        ColumnNameId col_running_timeout;
        ColumnNameId col_script;
        ColumnNameId col_second;
        ColumnNameId col_single;
        ColumnNameId col_single_conditions;
        ColumnNameId col_source;
        ColumnNameId col_sourcetime;
        ColumnNameId col_stack;
        ColumnNameId col_stacksize;
        ColumnNameId col_stacktrace;
        ColumnNameId col_statistics;
        ColumnNameId col_status;
        ColumnNameId col_t1_columnid;
        ColumnNameId col_t1_columnname;
        ColumnNameId col_t2_columnid;
        ColumnNameId col_t2_columnname;
        ColumnNameId col_table1_id;
        ColumnNameId col_table2_id;
        ColumnNameId col_table_sources;
        ColumnNameId col_tableid;
        ColumnNameId col_tablenr1;
        ColumnNameId col_tablenr2;
        ColumnNameId col_tablenr;
        ColumnNameId col_timeout;
        ColumnNameId col_total_running;
        ColumnNameId col_type;
        ColumnNameId col_typeinfo;
        ColumnNameId col_typeinfonr1;
        ColumnNameId col_typeinfonr2;
        ColumnNameId col_typeinfonr;
        ColumnNameId col_updatecolumnlist;
        ColumnNameId col_value;
        ColumnNameId col_variables;
        ColumnNameId col_vm;
        ColumnNameId col_week;
        ColumnNameId col_wrapobjects;
        ColumnNameId col_write;
        ColumnNameId col_year;
        ColumnNameId col_yearofweek;
};

struct ObjectTypeDefinition
{
        Blex::PodVector< LinkedLibrary::LinkedObjectDef const * > objdefs;
        std::unordered_map< ColumnNameId, LinkedLibrary::ObjectVTableEntry > entries;
        Blex::PodVector< LinkedLibrary::ObjectVTableEntry > new_entries;
};

struct ObjectTypeDefinitionTreeHash
{
        size_t operator()(std::pair< ObjectTypeDefinition const *, LinkedLibrary::LinkedObjectDef const * > data) const
        {
                return std::hash< ObjectTypeDefinition const * >()(data.first) ^ std::hash< LinkedLibrary::LinkedObjectDef const * >()(data.second);
        }
};

/** Contains a fully functional Virtual Machine. This is the object that does execution
    of libraries.

    This object is threadsafe only when calls are serialized */
class BLEXLIB_PUBLIC VirtualMachine
{
    public:
        typedef std::map< std::pair< Library const *, unsigned >, unsigned > TypeInfoIds;
        TypeInfoIds typeinfo_ids;

        typedef IdMapStorage<DBTypeInfo const *> TypeInfoMapper;
        TypeInfoMapper typeinfomapper;

        /// Local column name mapper
        ColumnNames::LocalMapper columnnamemapper;

        //This class must come before classes that contain OutputObjects (which includes contexts!)
        typedef IdMapStorage<OutputObject*> OutputObjects;
        OutputObjects outobjects;

        /** Returns the pointer to a loaded library, loads it if necessary. Throws on error. If throwing, fatal_error
            is true when the error is non-recoverable.
            @param uri URI of library
            @param fatal_error
            @return Pointer to loaded library */
        //FIXME: Should be private
        Library const * GetLoadedLibrary(std::string const &uri, bool *fatal_error);

        void GetLibraryInfo(std::string const &uri, LibraryInfo *info);

        void GetLoadedLibrariesInfo(std::vector< LibraryInfo > *info);

        void GetAllLibrariesInfo(std::vector< LibraryInfo > *info);

        void GetAllLibrariesUris(std::vector< std::string > *uris);

        void GetHSVMStats(struct HSVM_Stats *dest, int destlen);

    private:
        /** This struct holds some rest-variables that define the state of the VM */
        struct ExecutionState
        {
                /// Id of current function (relative within library)
                FunctionId function;

                /// Current codeptr, relative within library
                CodePtr codeptr;

                /// Current library
                Library const *library;

                /// Pointer to start of code (copy of code pointer in library's librarywrapper)
                const uint8_t* code;
        };

        /// Profile data about the current execution
        ProfileData profiledata;

    public:
        /// Column name cache
        ColumnNameCache const cn_cache;

    public:
        /// List of registered idmapstorages for handle purposes. Needs to be alive while contextkeeper is alive
        std::set< IdMapStorageRapporter * > idmapstorages;

        // The contextkeeper is increadibly important, we need it to be the first service to init and the last to deinit (except for idmapstorages)
        Blex::ContextKeeper contextkeeper;

        /// Local blob handler (must be initialized before stackmachine, due to blobs!)
//        BlobSpaceManager blobhandler;
        GlobalBlobManager &blobmanager;

        /// File system
        FileSystem &filesystem;

        /// Object type definitions
        std::unordered_map<
            std::pair< ObjectTypeDefinition const *, LinkedLibrary::LinkedObjectDef const * >,
            std::shared_ptr< ObjectTypeDefinition >,
            ObjectTypeDefinitionTreeHash > objtypetree;

        /// Memory store
        StackMachine stackmachine;

        /// Environment
        Environment &environment;

        /// Marshaller for reading vars by loadc, library is auto-set in stestateshortcuts. Must be placed AFTER environment!
        Marshaller var_marshaller;

        /// Marshaller for reading params. Must be placed AFTER environment!
        Marshaller param_marshaller;

        /// Marshaller for IPC communication. Must be placed AFTER environment!
        Marshaller ipc_marshaller;

        /// Marshaller for IPC communication. Must be placed AFTER environment!
        Marshaller cache_marshaller;

        /// Marshaller for authentication records. Must be placed AFTER environment!
        Marshaller authrec_marshaller;

        /// Marshaller for event records. Must be placed AFTER environment!
        Marshaller event_marshaller;

        /// SQL support
        SQLSupport sqlsupport;

        /// Library loader, holds all loaded libraries
        LibraryLoader libraryloader;

        /// Call stack
        CallStack &callstack;

        /// Rest of execution-state
        ExecutionState executionstate;

        /// List of tail calls
        std::vector< std::function< void(bool) > > tailcalls;

        struct ProtectedData
        {
                /// Authentication record
                std::unique_ptr< MarshalPacket > authenticationrecord;
        };

        typedef Blex::InterlockedData< ProtectedData, Blex::Mutex > LockedProtectedData;

        LockedProtectedData protected_data;

        /** Sets the members codelocation from the rest of the
            information in the executionstate struct. */
        void SetStateShortcuts(bool is_hit);

        // Call-stack control

        /** Pushes a stack frame with the execution state */
        CallStackElement & PushFrameRaw(StackElementType::Type type);

        /** Pushes a stack frame, and allocates a new stackmachine stackframe
            @param locals Number of locals that has to be pushed below the new frame */
        void PushFrame(unsigned locals);

        void PushStopExecuteFrame();

        void PushReturnToOtherVMFrame(VirtualMachine *vm);

        /** Pops a stack frame, and sets state back based on info found in top callstack element. */
        void PopFrameRaw();

        /** Pops a stack frame, and sets state back based on info found in top callstack element.
            Also removes stackmachine stackframe, and sets profile information. */
        void PopFrame();

        /** Pops a frame, returns whether execution should be stopped (encountered a StopExecute frame)
            @param vm Filled with VM to switch to (0 of no switch needed)
        */
        bool PopFrameEx(VirtualMachine **vm);

        /** Currently loaded execution library */
        std::string executelibrary;

        // Functions to access code

        /// Moves code pointer by diff.
        void MoveCodePtr(signed diff);
        /// Reads an uint8_t from the code, and increases the codeptr by 1
        uint8_t inline ReadByteFromCode();
        /// Reads a signed int32_t from the code, and increases the codeptr by 4
        int32_t inline ReadIdFromCode();
        /// Reads a instruction from the code, and increases the codeptr by 1
        template< bool debug >
          InstructionSet::_type inline ReadInstructionFromCode();

        /** Returns whether a DoLibsInitialize() call is needed */
        bool MustLibsInitialize();

        /** Library initialization function. A InitHolder frame must be on top of the call stack.
            If there are libraries to initialize, this function will call DoCall for their initialization
            functions (if needed). If one of these functions is a normal function, this function will return
            false. The InitHolder frame is the top of the stack, so the DoRet() for this function will try to
            pop the InitHolder frame. This function must then be called again.
            @return TRUE if all libraries are initialized. InitHolder frame can then be popped.
                    Returns FALSE if DoCall for an initialization function has returned false. (return frame for that function is the InitHolder frame). Initholder frame may NOT be popped! */
        void DoLibsInitialize();

        public: //ADDME private?
        /** Library deinitialization function. A DeinitHolder frame must be on top of the call stack.
            If there are libraries to deinitialize, this function will call DoCall for their deinitialization
            functions (if needed). If one of these functions is a normal function, this function will return
            false. The DeinitHolder frame is the top of the stack, so the DoRet() for this function will try to
            pop the DeinitHolder frame. This function must then be called again.
            @return TRUE if all libraries are initialized. DeinitHolder frame can then be popped.
                    Returns FALSE if DoCall for an initialization function has returned false. (return frame for that function is the DeinitHolder frame). DeinitHolder frame may NOT be popped!
        */
//        void DoLibsDeInitialize(); // Replaced by allow_deinit parameter on Run(...)

        /// Add error 'when calling function signature'
        void AddRelevantFunctionError(std::string const &signature);

        /// Set errors based on the abort flag
        void HandleAbortFlagErrors();

        private:
        // Helper functions for execution
        /** Executes a call. If the call is to an external function, it may
            be completed immediately.
            @param lib Library where the function is defined
            @param func Function-id of function in library lib
            @param frametype Type of frame to push on the stack */
        void PrepareCall(Library const &lib, FunctionId func);

        void PrepareCallInternal(LinkedLibrary::ResolvedFunctionDefList::value_type const &resolvedfunc);
        void PrepareObjMethodCallByEntry(LinkedLibrary::ObjectVTableEntry const *entry, unsigned parameters, bool this_access, bool allow_macro);

        /** Executes a return. Restores the executionstate to the info in the op frame on the call stack.
            When a special frame (InitHolder/DeInitHolder) frame is encounter StartLibraryInitialize() or
            StartLibraryDeInitialize() is called. A special frame is popped when the corresponding function returns
            true., after which the next frame on the stack is looked upon.
            @return Returns wether the call stack is empty after the ret*/
        void DoRet();
        void DoJumpC(int32_t diff);
        void DoJumpC2(int32_t diff);
        void DoJumpC2F(int32_t diff);

        void DoDup();
        void DoPop();
        void DoSwap();

        void DoLoadC(int32_t id);
        void DoLoadCB(int8_t id);
        void DoLoadCI(int32_t id);
        void DoLoadS(int32_t id);
        void DoStoreS(int32_t id);
        void DoLoadG(int32_t id);
        void DoStoreG(int32_t id);
        void DoLoadSD(int32_t id);
        void DoLoadGD(int32_t id);
        void DoDestroyS(int32_t id);
        void DoCopyS(int32_t id);

        void DoCastParam(VariableTypes::Type type, int32_t funcid);

        void DoPrint();

        void DoLoadBlob();
        void DoEmptyLoad(VariableTypes::Type type);

        void DoInc();
        void DoDec();

        void DoArrayIndex();
        void DoArraySize();
        void DoArrayInsert();
        void DoArraySet();
        void DoArrayDelete();
        void DoArrayAppend();
        void DoArrayDeleteAll();

        void DoDeepOperation(DeepOperation::Type type, bool this_access);

        void DoRecordCellGet(int32_t id);
        void DoRecordCellSet(int32_t id, bool with_check, bool cancreate);
        void DoRecordCellDelete(int32_t id);
        void DoRecordMakeExisting();

        void DoCmp();
        void DoCmp2();

        void DoLoadTypeId(int32_t id);

        void DoThrow2();

        void DoInitFunctionPtr();
        VirtualMachine * DoInvokeFptr(bool allow_macro);

        void DoObjNew();
        void DoObjMemberGet(int32_t id, bool this_access);
        void DoObjMemberSet(int32_t id, bool this_access);
        void DoObjMemberInsert(int32_t id, bool is_private, bool this_access);
        void DoObjMemberDelete(int32_t id, bool this_access);
        void DoObjMethodCall(int32_t id, int32_t paramcount, bool this_access, bool allow_macro);
        void DoObjSetType();
        void DoObjMakeRefPrivileged();
        void DoObjMemberIsSimple();
        void DoObjTestNonStatic(bool this_access);

        void DoYield();

        bool HandleAbortFlag();
        bool FillStackTraceElement(CallStackElement const &callstackelt, StackTraceElement *element, bool atinstr, bool full, VirtualMachine **currentvm);

    public:
        /** Fills the stack trace of the error handler with the current state
            @param error Optional VMRuntimeError to set file location in. */
        void PrepareStackTrace(VMRuntimeError *error); //FIXME private

        /// Register a loaded resource, that will be reported back in the errorhandler together with the loaded libraries
        void RegisterLoadedResource(std::string const &toinsert);

        void ObjectThrowMemberNotFound(VarId obj, ColumnNameId nameid);
        bool ObjectMemberInsert(VarId obj, ColumnNameId nameid, bool this_access, bool is_private, VarId new_value);
        bool ObjectMemberDelete(VarId obj, ColumnNameId nameid, bool this_access);
        bool ObjectMemberCopy(VarId obj, ColumnNameId nameid, bool this_access, VarId storeto);
        bool ObjectMemberSet(VarId obj, ColumnNameId nameid, bool this_access, VarId new_value);
        VarId ObjectMemberRef(VarId obj, ColumnNameId nameid, bool this_access);
        ObjectCellType::_type ObjectMemberType(VarId obj, ColumnNameId nameid);
        bool ObjectMemberExists(VarId obj, ColumnNameId nameid);
        bool ObjectMemberAccessible(VarId obj, ColumnNameId nameid, bool this_access);

        ObjectTypeDefinition * ExtendObjectType(ObjectTypeDefinition const *type, LinkedLibrary::LinkedObjectDef const *def);

        std::string GetObjectTypeName(VarId obj);
        void GetStackTrace(std::vector< StackTraceElement > *elements, bool atinstr, bool full);
        void GetRawAsyncStackTrace(AsyncStackTrace *trace, unsigned skip_items, std::shared_ptr< AsyncStackTrace > *prev_segment) const;
        void BuildAsyncStackTrace(AsyncStackTrace const &trace, std::vector< StackTraceElement > *elements);
        void GetObjectExtendNames(VarId obj, std::vector< std::string > *objecttypelist);
        void GetObjectExtendUids(VarId obj, std::vector< std::string > *objecttypelist);
        bool ObjectHasExtendUid(VarId obj, std::string const &uid);
        LinkedLibrary::ObjectVTableEntry const * ResolveVTableEntry(VarId obj, ColumnNameId nameid); // FIXME: make this internal
        bool GetObjectInternalProtected(VarId obj);

        bool is_suspended;//FIXME: Private, of misschien de suspended flag door DLLInterface zelf laten afhandelen?
        VarId throwvar;

        void UnwindToNextCatch(bool need_frame);

        std::string GenerateFunctionSignature(LinkedLibrary::ResolvedFunctionDef const *funcdef);
        std::string GenerateFunctionPTRSignature(HSVM_VariableId functionptr, LinkedLibrary::ResolvedFunctionDef const *funcdef);

        bool GetObjectDefinitions(HSVM_VariableId object, Blex::PodVector< LinkedLibrary::LinkedObjectDef const * > *objdefs);

    private:
        static void * CreateGeneratorContext(void *opaque_ptr);
        static void DestroyGeneratorContext(void *opaque_ptr, void *context_ptr);
        static void * CreateAsyncCallContext(void *opaque_ptr);
        static void DestroyAsyncCallContext(void *opaque_ptr, void *context_ptr);

        //not implemented
        VirtualMachine(const VirtualMachine&);
        VirtualMachine& operator=(const VirtualMachine&);

        public:
        //Blex::FastTimer profile_timer; //FIXME private
        private:

        ///Currently initializing library
        Library const *current_init_lib;
        ///Currently executed library
        Library const *execute_lib;

        ///Extra resources to report as loaded in errorhandler
        std::vector< std::string > loadedresources;

        bool is_suspendable;

        ///VM group we belong to
        VMGroup *vmgroup;

    public:
        // Whether the VM is unwinding for a thrown exception. FIXME: make private
        bool is_unwinding;

        /// For rethrows, don't put first item into trace. FIXME: make private
        bool skip_first_traceitem;

        /** Constructor.
            @param owner Environment which this VM must use for resolving of built-in functions. */
        VirtualMachine(VMGroup *vmgroup, Environment &librarian, Blex::ContextRegistrator &creg, ErrorHandler &vm_errorhandler, CallStack &_callstack);

        /** Destructor */
        ~VirtualMachine();

        // Debug functions: FIXME: make private after hs-processes is done
        void ShowStackState(bool debug);

        operator HSVM*()
        {
                return reinterpret_cast<HSVM*>(this);
        }

        VMGroup * GetVMGroup() const
        {
                return vmgroup;
        }

        /** Loads the main library. Must be called before an interface is obtained
            @param path Path to library*/
        void SetExecuteLibrary(const std::string &path);
        /** Get the path to the current execution library */
        std::string const& GetExecuteLibrary() const;
        /** Override the path of the execution library */
        void OverrideExecuteLibrary(std::string const &path);
        /** Get the path to the calling library */
        const char* GetCallingLibrary(unsigned to_skip, bool skip_system, Blex::DateTime *clib_modtime) const;

        StackMachine& GetStackMachine() { return stackmachine; }
        Marshaller& GetIPCMarshaller() { return ipc_marshaller; }
        Marshaller& GetCacheMarshaller() { return cache_marshaller; }

        LibraryLoader const & GetLibraryLoader() const { return libraryloader; }

        /** Set up a 'return to C++ code' frame. Code should invoke this
            function before doing a function call which they want to Run()
            to completion
            @param vm Virtual machine to switch back to
        */
        void SetupReturnStackframe();

        /// cancel the stack frame and parameters set up by setupreturnstackframe
        void CancelReturnStackframe();

        /// Push a frame that switches execution to another VM in the same VM group
        void PushSwitchToOtherVMFrame(VirtualMachine *vm);

        void PushDummyFrame();
        void PushTailcallFrame(std::function< void(bool) > const &tailcall);

        void PrepareCallFunctionById(LibraryId libraryid, unsigned functionid);

        /** Prepare a function ptr call. Put first values then functionptr on stack, leaves return value
            @return Virtual machine to switch to (only filled when @a suspendable is true)
        */
        VirtualMachine * PrepareCallFunctionPtr(bool suspendable, bool allow_macro);

        /** Prepare a function ptr call. Put first values then functionptr on stack, leaves return value */
        void PrepareObjMethodCall(ColumnNameId nameid, unsigned parameters, bool this_access, bool allow_macro);

        /** Starts execution of the code. Runs until it finds a return to C++
            stack frame (it will still pop that frame), or must switch to another VM
            If switch is needed, the VM to switch to is returned.
             Throws upon encountered errors or abort
        */
        template< bool debug >
          VirtualMachine * RunInternal(bool allow_deinit);

        void Run(bool suspendable, bool allow_deinit);

        /** Can we safely suspend this VM */
        bool IsSafeToSuspend() const { return is_suspendable; }

        /** Suspend the VM */
        void Suspend();

        /** Unloads all libraries, returns when a deinit function has been prepared or all libraries
            have been unloaded
            @return Returns TRUE when a deinit function has been prepared, false when all libraries have been unloaded.
        */
        bool AddCallToNextDeinitFunction();

        void AbortForUncaughtException();

        int32_t GetScriptParameter_FileId();
        Blex::DateTime GetScriptParameter_FileCreationDate();
        bool HasSystemRedirect();

        FileSystem & GetFileSystem() { return filesystem; }
        Environment& GetEnvironment() { return environment; }
  //      BlobSpaceManager& GetLocalBlobHandler() { return blobhandler; }
        inline GlobalBlobManager & GetBlobManager() { return blobmanager; }
        SQLSupport & GetSQLSupport() { return sqlsupport; }

        ErrorHandler &vm_errorhandler; /* ADDME: Try to get rid of this one, we're only using it for stack trace storage */

        ErrorHandler& GetErrorHandler() { return vm_errorhandler; }
        ProfileData& GetProfileData() { return profiledata; }

        void EnableFunctionProfiling();
        void DisableFunctionProfiling();
        void ResetFunctionProfile();

        void EnableMemoryProfiling();
        void DisableMemoryProfiling();
        void ResetMemoryProfile();

        void EnableCoverageProfiling();
        void DisableCoverageProfiling();
        void ResetCoverageProfile();

        /** Load a harescript module.
            @return Handle to the module if the load was succesful, or NULL if
                    the load failed. */
        void* LoadHarescriptModule(std::string const &name);

        /** @short Get the specified output object
            @long This function retrieves the specified output object, and throws a HareScript error if the id is no longer valid
            @param id Output object id to look up
            @param through_redirect Set to true if this object was requested through ID 0 (changes the error code, if any, to warn about the redirected source)
            @return A pointer to the output object */
        HareScript::OutputObject * GetOutputObject(int id, bool through_redirect);

        Blex::ContextKeeper& GetContextKeeper() { return contextkeeper; }

        void GetVMStats(VMStats *stats);
        void EncodeVMStats(VarId id_set, VMStats const &stats);

        struct GeneratorContext;
        GeneratorContext * GetGeneratorContext(VarId obj);

        struct AsyncCallContext;
        AsyncCallContext * GetAsyncCallContext(VarId obj, bool autocreate);

        void PushAsyncTraceContext(std::shared_ptr< AsyncStackTrace > const &trace, std::shared_ptr< AsyncStackTrace > const &prev_segment, unsigned skipframes);
        void PopAsyncTraceContext();

        void RegisterHandleKeeper(IdMapStorageRapporter *rapporter);
        void UnregisterHandleKeeper(IdMapStorageRapporter *rapporter);

        friend class VMGroup;
        friend class Tests;
        friend class OutputObject;
        friend class LocalVMRemoteInterface;
};

void BLEXLIB_PUBLIC GetMessageList(HSVM *vm, HSVM_VariableId errorstore, HareScript::ErrorHandler const &errhandler, bool with_trace);

struct VirtualMachine::GeneratorContext
{
        GeneratorContext();

        CallStackElement el;

        enum State
        {
        NotAGenerator,
        SuspendedStart,
        Executing,
        SuspendedYield,
        Completed
        } state;
};

struct VirtualMachine::AsyncCallContext
{
        /// Stack trace
        std::shared_ptr< AsyncStackTrace > trace;

        /// Reference to keep previous segment alive
        std::shared_ptr< AsyncStackTrace > prev_segment;
};

} // End of namespace HareScript

/** Set a variable of type HSVM_VAR_STRING from a std::string type
    @param vm Virtual machine
    @param id ID of the variable
    @return Value stored in the variable */
inline void HSVM_StringSetStringPair(struct HSVM *vm, HSVM_VariableId id, Blex::StringPair const &value)
{
        HSVM_StringSet(vm, id, value.begin, value.end);
}


#endif
