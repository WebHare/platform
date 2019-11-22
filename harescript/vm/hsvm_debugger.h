#ifndef blex_webhare_harescript_hsvm_debugger
#define blex_webhare_harescript_hsvm_debugger

#include "hsvm_context.h"

namespace HareScript
{

class Debugger
{
    private:
        Environment &environment;
        JobManager &jobmgr;

        typedef std::vector< std::pair< UnlockCallbacks, RunningState::Type > > Callbacks;

        // Debugger communication stuff
        struct CommData
        {
                CommData() = delete;
                explicit CommData(Environment &environment);
                ~CommData();

                VMGroup dummy_vmgroup;
                ErrorHandler dummy_vm_errorhandler;
                CallStack dummy_callstack;

                VirtualMachine vm;

                HSVM_VariableId msgvar;
                uint64_t msgid;
                std::string groupid;
                HSVM_VariableId composevar;
                HSVM_VariableId authrecvar; // ADDME: used for rule testing, not for communicating, move to own struct?

                /// Current active connection
                std::shared_ptr< IPCLinkEndPoint > link;

                /// Link that is listened on
                std::shared_ptr< IPCLinkEndPoint > listenlink;

                bool stopthread; // if true: stop debugger thread
                bool threadstopped;
        };

        struct RuleResult
        {
                RuleResult();

                bool inform;
                bool connect_and_stop;
        };

        struct JobData
        {
                JobData();

                enum PauseReason // Keep synced with module::system/internal/debugger/connector.whlib
                {
                None =          0,
                Request =       1,
                Breakpoint =    2,
                ManualBreakpoint = 4, // Breakpoint provided manually by user
                Rule =          8,
                NewLibraries =  16,
                DebuggerTrap =  32
                };

                /// VM group
                VMGroupRef vmgroup;

                /// Is the job zobie (not running in the jobmgr, kept because it is connected)
                bool is_zombie;

                /// Is someone connected to this job (if not, don't throw it away after finish)
                bool is_connected;

                bool want_pause;
                PauseReason pause_reasons;

                Blex::DateTime termination_time;

                /// Previously hit connect rules
                std::vector< std::string > matched_rules;

                /// Current connect rules
                std::vector< std::string > connect_rules;

                /// Reset debug admin data (for when debugger disconnects)
                void reset();
        };

        struct StateData
        {
                /// List of currently running jobs
                std::map< std::string, JobData > jobs;
        };

        struct Rule
        {
                enum Site
                {
                SiteStart =                 1,
                SiteTerminate =             2,
                SiteTerminateErrors =       4,
                SiteAuthenticationRecord =  8,
                SiteDebuggerTrap =          16
                };

                struct AuthRecordRule
                {
                        // dot-separated path to cell within authentication record
                        Blex::PodVector< HSVM_ColumnId > path;

                        // mask to match (glob). Integer values from the authentication record are converted to strings
                        std::string mask;
                };

                // Rule tag
                std::string tag;

                // Script name, wildcards allowed
                std::string script;

                /// Excluded script names, wildcards allowed
                std::vector< std::string > script_exclude;

                /// Authentication record rules
                std::vector< AuthRecordRule > authrecordrules;

                /// Bitmask for allowed sites
                Site sites;

                bool connect_on_match;
                bool inform_start_stop;


//                bool stop_on_throw;
//                bool stop_on_abort;
        };

        // Debugger configuration
        struct ConfigData
        {
                ConfigData();

                void Reset();

                /// Is a configuration present?
                bool have_config;

                /// How long to keep unconnected jobs that terminated with errors around
                unsigned keep_errorterminated_msecs;

                /// Connect rules
                std::vector< Rule > rules;
        };

        struct Data
        {
                Data(Environment &environment);

                CommData comm;
                ConfigData config;
                StateData state;
        };

        typedef Blex::InterlockedData< Data, Blex::ConditionMutex > LockedData;
        LockedData data;

        std::unique_ptr< Blex::Thread > listenthread;

        void ClearData();
        Blex::DateTime HandleTimeouts(LockedData::WriteRef &lock, Blex::DateTime now, std::vector< VMGroupRef > *to_destroy);
        void ContinueStoppedJobs();
        void Thread();
        void StopThread();

        /// Test if any rule matches
        void TestRuleMatches(LockedData::WriteRef &lock, JobManager::LockedJobData::WriteRef &jobmgrlock, VMGroup &vmgroup, JobData &jobdata, Rule::Site site, RuleResult &res);
        bool IsRuleMatch(LockedData::WriteRef &lock, JobManager::LockedJobData::WriteRef &jobdatalock, Rule const &rule, VMGroup &vmgroup, Rule::Site site);

        /// Test of rule matches on running script, issue 'rule-hit' message and pausing script when so
        void RunningScriptRuleTest(JobManager::LockedJobData::WriteRef &jobmgrlock, LockedData::WriteRef &lock, VMGroup &vmgroup, JobData &jobdata, Rule::Site site);

        bool ProcessIPCMessage(std::shared_ptr< IPCMessage2 > const &msg);

        void SendGreeting(LockedData::WriteRef &vm, uint64_t processcode, std::string const &clientname);
        void SendException(LockedData::WriteRef &lock, uint64_t replyto, std::string const &what);
        void SendComposeVar(LockedData::WriteRef &lock, uint64_t replyto);
        void SendTypeOnlyResponse(LockedData::WriteRef &lock, uint64_t replyto, std::string const &type);

        void SendJobAndTypeOnlyResponse(LockedData::WriteRef &lock, std::string const &type, std::string const &jobid);
        void SendJobStatus(JobManager::LockedJobData::WriteRef &jobmgrlock, LockedData::WriteRef &lock, VMGroup *vmgroup, std::string const &type, bool usestatereq, Callbacks *callbacks);
        void StoreVMStatus(JobManager::LockedJobData::WriteRef &jobmgrlock, LockedData::WriteRef &lock, HSVM_VariableId status, VMGroup *vmgroup, bool extended, bool islocked, bool usestatereq, Blex::DateTime const &now);

        std::pair< int64_t, int64_t > GetMinMax(StackMachine &stackm, ColumnNameCache const &cn_cache, VarId id_set, VarId req, int64_t defaultmax, int64_t len);
        void RetrieveVariable(VirtualMachine *vm, VarId id_set, int32_t vm_id, VirtualMachine *source_vm, VarId source_id, VarId req, unsigned depth);
        void ApplyBreakpoints(VMGroup &vmgroup);

        void HandleMessage(std::string const &type);
        void RPC_Configure();
        void RPC_GetJobMgrStatus();
        void RPC_TerminateJob();
        void RPC_ConnectJob();
        void RPC_DisconnectJob();

        void RPC_GetJobStatus();
        void RPC_PauseJob();
        void RPC_ContinueJob();

        void RPC_GetVariables();
        void RPC_GetLibraries();
        void RPC_SetBreakpoints();
        void RPC_SetProfiling();
        void RPC_GetProfile();
        void RPC_GetMemorySnapshot();
        void RPC_GetBlobReferences();

    public:
        Debugger(Environment &environment, JobManager &jobmgr);
        ~Debugger();

        void OnScriptStarted(JobManager::LockedJobData::WriteRef &jobdatalock, VMGroupRef &vmgroup);
        void OnScriptTerminated(JobManager::LockedJobData::WriteRef &jobdatalock, VMGroup &vmgroup);
        void OnScriptReturnToJobMgr(JobManager::LockedJobData::WriteRef &jobdatalock, VMGroup &vmgroup, bool forced_abort);
        void OnScriptWaitEnded(JobManager::LockedJobData::WriteRef &jobdatalock, VMGroup &vmgroup, bool forced_abort);
        void OnScriptBreakpointHit(VMGroup &vmgroup, bool manualbreakpoint);
        void OnScriptAuthenticationRecordChanged(VMGroup &vmgroup);
        void OnScriptNewLibrariesLoaded(VMGroup &vmgroup);
        void OnScriptDebuggerTrap(VMGroup &vmgroup);

        void SetDebugLink(std::shared_ptr< IPCLinkEndPoint > const &link, uint64_t processcode, std::string const &clientname);

        /// Waits for the configuration to arive (only if there is a link)
        bool WaitForConfiguration(Blex::DateTime until);

        void Shutdown();

        friend inline JobData::PauseReason & operator |=(JobData::PauseReason &lhs, JobData::PauseReason rhs);
        friend inline Rule::Site operator |(Rule::Site lhs, Rule::Site rhs);
};

} // End of namespace HareScript

#endif
