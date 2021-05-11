//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_debugger.h"
#include "baselibs.h"

// Print communication with whmanager process
//#define PRINT_DBG

#ifdef PRINT_DBG
 #define DBG_PRINT(x) DEBUGPRINT(x)
#else
 #define DBG_PRINT(x) (void)0
#endif


namespace HareScript
{

void GetVMStackTrace(VirtualMachine *vm, HSVM_VariableId var_stacktrace, VirtualMachine *testvm, bool full);
void GetVMLibraries(VirtualMachine *vm, HSVM_VariableId var_resultlibs, VirtualMachine *testvm);

inline Debugger::JobData::PauseReason & operator |=(Debugger::JobData::PauseReason &lhs, Debugger::JobData::PauseReason rhs)
{
        lhs = static_cast< Debugger::JobData::PauseReason >(static_cast< unsigned >(lhs) | static_cast< unsigned >(rhs));
        return lhs;
}

inline Debugger::Rule::Site operator |(Debugger::Rule::Site lhs, Debugger::Rule::Site rhs)
{
        return static_cast< Debugger::Rule::Site >(static_cast< unsigned >(lhs) | static_cast< unsigned >(rhs));
}

namespace Baselibs
{
void EncodeFunctionProfileData(ProfileData const &profiledata, VirtualMachine *vm, VarId id_set);
void EncodeObjectWeb(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set, bool included_unreferenced);
void EncodeBlobReferences(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set, bool included_unreferenced);
void EncodeHandleList(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set);

//void GetFunctionProfileDataExt(VarId id_set, VirtualMachine *vm, VirtualMachine *profiled);
} // End of namespace baselibs

// -----------------------------------------------------------------------------
//
// Debugger locked data
//

Debugger::CommData::CommData(Environment &environment)
: dummy_vmgroup(environment, environment.GetContextReg(), false)
, vm(&dummy_vmgroup, environment, environment.GetContextReg(), dummy_vm_errorhandler, dummy_callstack)
, msgid(0)
, stopthread(false)
, threadstopped(false)
{
}

Debugger::CommData::~CommData()
{
        // Reset the VM the same way the VM groups delete their VMs
        vm.sqlsupport.Cleanup();
//         vm.contextkeeper.Reset();
        vm.stackmachine.Reset();
        vm.contextkeeper.Reset();
}

Debugger::ConfigData::ConfigData()
: have_config(false)
, keep_errorterminated_msecs(0)
{
}

void Debugger::ConfigData::Reset()
{
        have_config = false;
        keep_errorterminated_msecs = 0;
        rules.clear();
}

Debugger::Data::Data(Environment &environment)
: comm(environment)
{
}

Debugger::RuleResult::RuleResult()
: inform(false)
, connect_and_stop(false)
{
}

// -----------------------------------------------------------------------------
//
// Debugger
//

Debugger::Debugger(Environment &_environment, JobManager &_jobmgr)
: environment(_environment)
, jobmgr(_jobmgr)
, data(environment)
{
        LockedData::WriteRef lock(data);

        lock->comm.msgvar = HSVM_AllocateVariable(lock->comm.vm);
        lock->comm.composevar = HSVM_AllocateVariable(lock->comm.vm);
        lock->comm.authrecvar = HSVM_AllocateVariable(lock->comm.vm);
}

Debugger::~Debugger()
{
        StopThread();
}

void Debugger::ClearData()
{
        LockedData::WriteRef lock(data);

        lock->comm.link.reset();
        lock->state.jobs.clear();
        lock->config.Reset();
}

void Debugger::StopThread()
{
        if (listenthread.get())
        {
                LockedData::WriteRef(data)->comm.stopthread = true;
                data.SignalAll();

                listenthread->WaitFinish();
        }
}

void Debugger::Shutdown()
{
        StopThread();
        ClearData();
}

void Debugger::SetDebugLink(std::shared_ptr< IPCLinkEndPoint > const &link, uint64_t processcode, std::string const &clientname)
{
        {
                LockedData::WriteRef lock(data);

                // Stop the debugger thread. Thread depends on this!
                if (listenthread.get())
                {
                        lock->comm.stopthread = true;
                        data.SignalAll();
                        while (!lock->comm.threadstopped)
                            lock.Wait();
                        listenthread->WaitFinish();
                        listenthread.reset();
                        lock->comm.stopthread = false;
                }

                // place the new link
                lock->comm.link = link;

                if (link.get())
                {
                        SendGreeting(lock, processcode, clientname);
                        if (!listenthread.get())
                        {
                                lock->comm.threadstopped = false;
                                listenthread.reset(new Blex::Thread(std::bind(&Debugger::Thread, this)));
                                listenthread->Start();
                        }
                }
        }
        data.SignalAll();
}

bool Debugger::WaitForConfiguration(Blex::DateTime until)
{
        DBG_PRINT("DBG: External wait for configuration: start, wait until " << Blex::AnyToString(until));

        LockedData::WriteRef lock(data);
        while (lock->comm.link.get() && !lock->config.have_config)
            if (!lock.TimedWait(until))
            {
                    DBG_PRINT("DBG: External wait for configuration: timeout");
                    return false;
            }

        DBG_PRINT("DBG: External wait for configuration: done, " << (lock->config.have_config ? "have config" : "no debugger link"));
        return lock->config.have_config;
}

void Debugger::Thread()
{
        DBG_PRINT("DBG: thread start");

        Blex::PipeWaiter waiter;

        // Can do this, while the thread is running the link won't change
        LockedData::WriteRef(data)->comm.link->AddToWaiterRead(waiter);

        // Destroy the grouprefs outside the debugger lock
        std::vector< VMGroupRef > destroy_grouprefs;

        while (true)
        {
                std::shared_ptr< IPCMessage2 > msg;

                bool need_stop = false;
                {
                        LockedData::WriteRef lock(data);

                        while (true)
                        {
                                  // Check if we need to stop. Copy into need_stop to make it accessible outside the lock
                                  need_stop = lock->comm.stopthread;
                                  if (need_stop)
                                      break;

                                  // Handle timed out jobs (zombies that need removing). If those are found, break out to destroy
                                  // them outside the lock
                                  Blex::DateTime next_timeout = HandleTimeouts(lock, Blex::DateTime::Now(), &destroy_grouprefs);
                                  if (!destroy_grouprefs.empty())
                                      break;

                                  DBG_PRINT("DBG: Entering wait for messages");
                                  waiter.ConditionMutexWait(lock, next_timeout);

                                  // Wakeup without a message? (might be stop signal)
                                  if (lock->comm.link->IsReadSignalled(&waiter) != OutputObject::Signalled)
                                      continue;

                                  // Receive the message
                                  bool have_message = lock->comm.link->ReceiveMessage(&msg);
                                  if (!have_message)
                                  {
                                          if (lock->comm.link->IsBroken())
                                          {
                                                  DBG_PRINT("DBG: Debug link is broken, deleting");
                                                  lock->comm.stopthread = true;
                                                  need_stop = true;
                                                  break;
                                          }
                                          DBG_PRINT("DBG: spurious link wakeup");
                                          continue;
                                  }

                                  // Handle the message outside the lock. The jobmgr lock needs to be taken
                                  // before the debugger lock, so we can't lock it from inside here
                                  break;
                        }
                }

                // First clear the jobs before breaking out of the loop
                destroy_grouprefs.clear();

                if (need_stop)
                    break;

                if (msg.get())
                    ProcessIPCMessage(msg);
        }

        DBG_PRINT("DBG: thread shutdown");
        ContinueStoppedJobs();

        {
                LockedData::WriteRef lock(data);
                lock->config.have_config = false;
                lock->comm.threadstopped = true;
        }

        data.SignalAll();
}

Blex::DateTime Debugger::HandleTimeouts(LockedData::WriteRef &lock, Blex::DateTime now, std::vector< VMGroupRef > *to_destroy)
{
        Blex::DateTime keeptime = Blex::DateTime::Msecs(lock->config.keep_errorterminated_msecs);
        Blex::DateTime cutoff = now - keeptime;
        Blex::DateTime first_terminate = Blex::DateTime::Max();

        for (auto it = lock->state.jobs.begin(), end = lock->state.jobs.end(); it != end;)
        {
                if (it->second.is_zombie && !it->second.is_connected)
                {
                        if (it->second.termination_time <= cutoff)
                        {
                                // Inform when any informing rule is present. Can't do full rule matches here, because
                                // the jobmgr lock can't be taken here due to lock ordering issues (jobmgr lock > debugger lock)
                                bool inform = false;
                                if (lock->config.have_config)
                                {
                                        for (auto &itr: lock->config.rules)
                                            if (itr.inform_start_stop)
                                            {
                                                    inform = true;
                                                    break;
                                            }
                                }

                                if (inform)
                                {
                                        lock->comm.msgid = 0;
                                        SendJobAndTypeOnlyResponse(lock, "job-removed", it->first);
                                }
                                else
                                {
                                        DBG_PRINT("DBG: Remove non-connected zombie job " << it->first);
                                }


                                // Make sure the last groupref is destroyed outside the debugger lock
                                to_destroy->push_back(it->second.vmgroup);

                                it->second.vmgroup->finishevent.SetSignalled(true);
                                lock->state.jobs.erase(it++);
                        }
                        else
                        {
                                if (it->second.termination_time < first_terminate)
                                    first_terminate = it->second.termination_time;
                                ++it;
                        }
                }
                else
                    ++it;
        }

        Blex::DateTime next_timeout = first_terminate == Blex::DateTime::Max()
            ? first_terminate
            : first_terminate + keeptime;

        DBG_PRINT("DBG: Calculated next timeout: " << next_timeout);
        return next_timeout;
}

bool Debugger::IsRuleMatch(LockedData::WriteRef &lock, JobManager::LockedJobData::WriteRef &/*jobdatalock*/, Rule const &rule, VMGroup &vmgroup, Rule::Site site)
{
        if (rule.sites && !(rule.sites & site))
            return false;

        if (!Blex::StrLike(vmgroup.mainscript, rule.script))
            return false;

        for (std::vector< std::string >::const_iterator it = rule.script_exclude.begin(), end = rule.script_exclude.end(); it != end; ++it)
            if (Blex::StrLike(vmgroup.mainscript, *it))
                return false;

        if (!rule.authrecordrules.empty())
        {
                VirtualMachine *vm = jobmgr.GetGroupMainVM(vmgroup);

                // Get and decode the authentication record
                std::unique_ptr< MarshalPacket > copy;
                {
                        VirtualMachine::LockedProtectedData::ReadRef vm_lock(vm->protected_data);
                        if (vm_lock->authenticationrecord.get())
                            vm_lock->authenticationrecord->TryClone(&copy);
                }

                // Just bail out if we couldn't get the record
                if (!copy.get())
                    return false;

                lock->comm.vm.authrec_marshaller.ReadMarshalPacket(lock->comm.authrecvar, &copy);

                StackMachine &stackm = lock->comm.vm.GetStackMachine();

                std::string value;
                for (auto &authrule: rule.authrecordrules)
                {
                        VarId var = lock->comm.authrecvar;

                        for (auto &itr: authrule.path)
                        {
                                if (stackm.GetType(var) != VariableTypes::Record)
                                    return false;

                                var = stackm.RecordCellGetByName(var, itr);
                                if (!var)
                                    return false;
                        }

                        switch (stackm.GetType(var))
                        {
                        case VariableTypes::Boolean:
                            {
                                    value = stackm.GetBoolean(var) ? "1" : "0";
                            } break;
                        case VariableTypes::Integer:
                            {
                                    value = Blex::AnyToString(stackm.GetInteger(var));
                            } break;
                        case VariableTypes::Integer64:
                            {
                                    value = Blex::AnyToString(stackm.GetInteger64(var));
                            } break;
                        case VariableTypes::String:
                            {
                                    value = stackm.GetSTLString(var);
                            } break;
                        default:
                            return false;
                        }

                        if (!Blex::StrLike(value, authrule.mask))
                            return false;
                }
        }

        DBG_PRINT("DBG: Match rule " << rule.tag << " with sitemask " << rule.sites << " at site " << site << ", script " << vmgroup.mainscript);

        return true;
}

void Debugger::ContinueStoppedJobs()
{
        DBG_PRINT("DBG: continue all stopped jobs");

        std::vector< VMGroupRef > grouprefs;

        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);

                for (std::map< std::string, JobData >::iterator it = lock->state.jobs.begin(), end = lock->state.jobs.end(); it != end;)
                {
                        if (!it->second.is_zombie)
                        {
                                if (it->second.vmgroup->jmdata.state == RunningState::DebugStopped)
                                    jobmgr.SetVMGroupState(jobmgrlock, it->second.vmgroup.get(), it->second.vmgroup->jmdata.oldstatedebug);

                                it->second.reset();
                                ++it;
                        }
                        else // non-running app, must be connected: remove from job list
                        {
                                DBG_PRINT("DBG: Continue stopped zombie job, erase from state.jobs " << it->first);

                                // Destroy grouprefs outside the jobmgr lock
                                grouprefs.push_back(it->second.vmgroup);

                                it->second.vmgroup->finishevent.SetSignalled(true);
                                lock->state.jobs.erase(it++);
                        }
                }
        }

        // Signal the jobmgr to rescan for runnable processes
        jobmgr.jobdata.SignalAll();
}

void Debugger::TestRuleMatches(LockedData::WriteRef &lock, JobManager::LockedJobData::WriteRef &jobmgrlock, VMGroup &vmgroup, JobData &jobdata, Rule::Site site, RuleResult &res)
{
        if (lock->config.have_config)
        {
                for (std::vector< Rule >::iterator rit = lock->config.rules.begin(); rit != lock->config.rules.end(); ++rit)
                {
                        if (!IsRuleMatch(lock, jobmgrlock, *rit, vmgroup, site))
                            continue;

                        if (rit->inform_start_stop)
                            res.inform = true;

                        if (rit->connect_on_match)
                        {
                                if (std::find(jobdata.matched_rules.begin(), jobdata.matched_rules.end(), rit->tag) != jobdata.matched_rules.end())
                                    continue;

                                jobdata.matched_rules.push_back(rit->tag);
                                jobdata.connect_rules.push_back(rit->tag);

                                jobdata.is_connected = true;

                                res.inform = true;
                                res.connect_and_stop = true;
                        }
                }
        }
}

void Debugger::OnScriptStarted(JobManager::LockedJobData::WriteRef &jobmgrlock, VMGroupRef &vmgroup)
{
        // Register job in jobs list
        LockedData::WriteRef lock(data);
        JobData &jobdata = lock->state.jobs[vmgroup->jmdata.groupid];
        jobdata.vmgroup = vmgroup;

        DBG_PRINT("DBG: script started: " << vmgroup->jmdata.groupid);

        if (!lock->config.have_config)
            return;

        RuleResult ruleres;
        TestRuleMatches(lock, jobmgrlock, *vmgroup, jobdata, Rule::SiteStart, ruleres);

        if (!ruleres.inform)
            return;

        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        if (ruleres.connect_and_stop)
        {
                // When we exit, the reqstate will become the job state immediately
                vmgroup->jmdata.oldstatedebug = vmgroup->jmdata.reqstate;
                vmgroup->jmdata.reqstate = RunningState::DebugStopped;

                jobdata.is_connected = true;
        }

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_type), "job-started");
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_connected), jobdata.is_connected);
        StoreVMStatus(jobmgrlock, lock, composevar, vmgroup.get(), false, false, true, Blex::DateTime::Now());

        HSVM_VariableId var_tags = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "CONNECT_TAGS"));
        HSVM_SetDefault(vm, var_tags, HSVM_VAR_StringArray);
        for (auto &tag: jobdata.connect_rules)
            HSVM_StringSetSTD(vm, HSVM_ArrayAppend(vm, var_tags), tag);
        jobdata.connect_rules.clear();

        SendComposeVar(lock, 0);
}

void Debugger::OnScriptWaitEnded(JobManager::LockedJobData::WriteRef &jobmgrlock, VMGroup &vmgroup, bool forced_abort)
{
        (void)forced_abort; // FIXME

        LockedData::WriteRef lock(data);

        DBG_PRINT("DBG: OnScriptWaitEnded for job " << vmgroup.jmdata.groupid << ", forced: " << forced_abort);

        if (!vmgroup.dbg_async.inform_next_suspend && !vmgroup.dbg_async.reset_breakpoints)
        {
                DBG_PRINT("DBG:  no inform was requested");
                return;
        }

        vmgroup.dbg_async.inform_next_suspend = false;
        vmgroup.dbg_async.reset_breakpoints = false;

        *vmgroup.GetAbortFlag() = HSVM_ABORT_DONT_STOP;

        // If this was a yield forced by a RPC, we want to go back to WaitForMultiple if not picking this script up
        if (forced_abort)
            vmgroup.jmdata.reqstate = RunningState::WaitForMultiple;

        if (!lock->config.have_config)
        {
                DBG_PRINT("DBG:  no config present");
                return;
        }

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
        if (it != lock->state.jobs.end())
        {
                if (!it->second.is_connected)
                {
                        DBG_PRINT("DBG:  disconnected script returned from wait after requested break, ignoring");
                        it->second.want_pause = false;
                        it->second.pause_reasons = JobData::None;
                        return;
                }

                DBG_PRINT("DBG:  script returned from wait after requested break, stopping");

                this->ApplyBreakpoints(*it->second.vmgroup);
                *vmgroup.GetAbortFlag() = HSVM_ABORT_DONT_STOP;

                if (it->second.want_pause)
                {
                        // Ignore reqstate - we need to go back to WFM because we need to finish the wait after continuing
                        vmgroup.jmdata.oldstatedebug = forced_abort ? RunningState::WaitForMultiple : vmgroup.jmdata.reqstate;
                        vmgroup.jmdata.reqstate = RunningState::DebugStopped;
                        it->second.want_pause = false;

                        // ADDME: do we need to send forced_abort?
                        SendJobStatus(jobmgrlock, lock, &vmgroup, "job-paused", true, 0); // The script is sync at the moment
                }
        }
        else
        {
                DBG_PRINT("DBG:  could not find job");
        }

}

void Debugger::OnScriptReturnToJobMgr(JobManager::LockedJobData::WriteRef &jobmgrlock, VMGroup &vmgroup, bool forced_abort)
{
        (void)forced_abort;

        LockedData::WriteRef lock(data);

        DBG_PRINT("DBG: OnScriptReturnToJobMgr for job " << vmgroup.jmdata.groupid << ", reqstate: " << vmgroup.jmdata.reqstate);

        vmgroup.dbg_async.inform_next_suspend = false;
        vmgroup.dbg_async.reset_breakpoints = false;

        if (!lock->config.have_config)
            return;

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
        if (it != lock->state.jobs.end() && it->second.want_pause && vmgroup.jmdata.reqstate == RunningState::Runnable)
        {
                if (!it->second.is_connected)
                {
                        DBG_PRINT("DBG: disconnected script yielded after requested break, ignoring");

                        it->second.want_pause = false;
                        it->second.pause_reasons = JobData::None;
                        return;
                }

                DBG_PRINT("DBG: script yielded after requested break, stopping");

                vmgroup.jmdata.oldstatedebug = vmgroup.jmdata.reqstate;
                vmgroup.jmdata.reqstate = RunningState::DebugStopped;
                it->second.want_pause = false;

                SendJobStatus(jobmgrlock, lock, &vmgroup, "job-paused", true, 0); // The script is sync at the moment
        }

        // ADDME: do we need to send forced_abort?
}

void Debugger::OnScriptTerminated(JobManager::LockedJobData::WriteRef &jobmgrlock, VMGroup &vmgroup)
{
        DBG_PRINT("DBG: script terminated: " << vmgroup.jmdata.groupid);

        RuleResult ruleres;
        bool signal_timeoutchange = false;

        {
                LockedData::WriteRef lock(data);

                // Should have reference to the job. If not, ignore
                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
                if (it == lock->state.jobs.end())
                    return;

                // Set termination time
                it->second.termination_time = Blex::DateTime::Now();
                signal_timeoutchange = true;

                // Already connected?
                if (it->second.is_connected)
                {
                        ruleres.inform = true;
                        ruleres.connect_and_stop = true;
                }

                // Check for rule matches
                Rule::Site site = vmgroup.errorhandler.AnyErrors() ? Rule::SiteTerminate | Rule::SiteTerminateErrors : Rule::SiteTerminate;
                TestRuleMatches(lock, jobmgrlock, vmgroup, it->second, site, ruleres);

                bool keep_unconnected_zombie = vmgroup.errorhandler.AnyErrors() && lock->config.keep_errorterminated_msecs != 0;

                if (it->second.is_connected)
                    it->second.is_zombie = true;

                if (ruleres.connect_and_stop)
                {
                        vmgroup.jmdata.oldstatedebug = vmgroup.jmdata.reqstate;
                        vmgroup.jmdata.reqstate = RunningState::DebugStopped;
                }

                if (ruleres.inform)
                {
                        vmgroup.mainvm->DisableFunctionProfiling();
                        vmgroup.mainvm->DisableMemoryProfiling();

                        HSVM *vm = lock->comm.vm;
                        HSVM_VariableId composevar = lock->comm.composevar;
                        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                        // Send script-started message over link
                        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

                        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_type), "job-terminated");
                        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_connected), ruleres.connect_and_stop);
                        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_removed), !ruleres.connect_and_stop && !keep_unconnected_zombie);
                        StoreVMStatus(jobmgrlock, lock, composevar, &vmgroup, true, true, true, Blex::DateTime::Now());

                        HSVM_VariableId var_tags = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "CONNECT_TAGS"));
                        HSVM_SetDefault(vm, var_tags, HSVM_VAR_StringArray);
                        for (auto &tag: it->second.connect_rules)
                            HSVM_StringSetSTD(vm, HSVM_ArrayAppend(vm, var_tags), tag);
                        it->second.connect_rules.clear();

                        DBG_PRINT("DBG: Send message 'job-terminated', groupid: " << vmgroup.jmdata.groupid);

                        SendComposeVar(lock, 0);
                }

                if (!ruleres.connect_and_stop)
                {
                        // Remove job data record
                        if (it != lock->state.jobs.end())
                        {
                                if (!keep_unconnected_zombie)
                                {
                                        // Jobmgr has reference, so we can safely destroy ours. No need to signal for timeout changes
                                        DBG_PRINT("DBG: Not connecting to terminated job, erase from state.jobs " << it->first);
                                        lock->state.jobs.erase(it);
                                        signal_timeoutchange = false;
                                }
                                else
                                {
                                        DBG_PRINT("DBG: Not connecting to terminated job, keep as zombie for " << lock->config.keep_errorterminated_msecs << "ms: " << it->first);
                                        it->second.is_zombie = true;
                                }
                        }
                }
        }

        if (signal_timeoutchange)
            data.SignalAll();
}

void Debugger::OnScriptBreakpointHit(VMGroup &vmgroup, bool manualbreakpoint)
{
        JobManager::LockedJobData::WriteRef jobmgrlock(vmgroup.jobmanager->jobdata);
        LockedData::WriteRef lock(data);

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
        if (it == lock->state.jobs.end())
            return;

        if (!it->second.is_connected)
        {
                  DBG_PRINT("DBG: disconnected script hit breakpoint, ignoring");

                  vmgroup.dbg.breakpoints.clear();
                  vmgroup.dbg.min_stack = 0;
                  vmgroup.dbg.max_stack = -1;

                  return;
        }

        DBG_PRINT("DBG: script hit breakpoint, pausing");

        it->second.want_pause = true;
        it->second.pause_reasons |= manualbreakpoint ? JobData::ManualBreakpoint : JobData::Breakpoint;

        *vmgroup.abortflag = HSVM_ABORT_YIELD;
        vmgroup.dbg_async.inform_next_suspend = true;
}

void Debugger::RunningScriptRuleTest(JobManager::LockedJobData::WriteRef &jobmgrlock, LockedData::WriteRef &lock, VMGroup &vmgroup, JobData &jobdata, Rule::Site site)
{
        if (jobdata.is_connected)
            return;

        RuleResult ruleres;
        TestRuleMatches(lock, jobmgrlock, vmgroup, jobdata, site, ruleres);

        if (!ruleres.connect_and_stop)
            return;

        DBG_PRINT("DBG: script matched rule, pausing");

        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        jobdata.is_connected = true;
        jobdata.want_pause = true;
        jobdata.pause_reasons |= JobData::Rule;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_type), "job-rulehit");
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_connected), jobdata.is_connected);
        StoreVMStatus(jobmgrlock, lock, composevar, &vmgroup, false, false, false, Blex::DateTime::Now());

        HSVM_VariableId var_tags = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "CONNECT_TAGS"));
        HSVM_SetDefault(vm, var_tags, HSVM_VAR_StringArray);
        for (auto &tag: jobdata.connect_rules)
            HSVM_StringSetSTD(vm, HSVM_ArrayAppend(vm, var_tags), tag);
        jobdata.connect_rules.clear();

        SendComposeVar(lock, 0);

        *vmgroup.abortflag = HSVM_ABORT_YIELD;
        vmgroup.dbg_async.inform_next_suspend = true;
}

void Debugger::OnScriptAuthenticationRecordChanged(VMGroup &vmgroup)
{
        JobManager::LockedJobData::WriteRef jobmgrlock(vmgroup.jobmanager->jobdata);
        LockedData::WriteRef lock(data);

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
        if (it == lock->state.jobs.end())
            return;

        RunningScriptRuleTest(jobmgrlock, lock, vmgroup, it->second, Rule::SiteAuthenticationRecord);
}

void Debugger::OnScriptNewLibrariesLoaded(VMGroup &vmgroup)
{
        JobManager::LockedJobData::WriteRef jobmgrlock(vmgroup.jobmanager->jobdata);
        LockedData::WriteRef lock(data);

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
        if (it == lock->state.jobs.end())
            return;

        if (!it->second.is_connected)
        {
                  DBG_PRINT("DBG: disconnected script loaded new library, ignoring");
                  return;
        }

        DBG_PRINT("DBG: script loaded new library, pausing");

        it->second.want_pause = true;
        it->second.pause_reasons |= JobData::NewLibraries;

        *vmgroup.abortflag = HSVM_ABORT_YIELD;
        vmgroup.dbg_async.inform_next_suspend = true;
}

void Debugger::OnScriptDebuggerTrap(VMGroup &vmgroup)
{
        JobManager::LockedJobData::WriteRef jobmgrlock(vmgroup.jobmanager->jobdata);
        LockedData::WriteRef lock(data);

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup.jmdata.groupid);
        if (it == lock->state.jobs.end())
            return;


        if (it->second.is_connected)
        {
                DBG_PRINT("DBG: connected script hit debugger trap, pausing");

                it->second.want_pause = true;
                it->second.pause_reasons |= JobData::DebuggerTrap;

                *vmgroup.abortflag = HSVM_ABORT_YIELD;
                vmgroup.dbg_async.inform_next_suspend = true;
                return;
        }

        it->second.pause_reasons |= JobData::DebuggerTrap;
        RunningScriptRuleTest(jobmgrlock, lock, vmgroup, it->second, Rule::SiteDebuggerTrap);
}


void Debugger::StoreVMStatus(JobManager::LockedJobData::WriteRef &, LockedData::WriteRef &lock, HSVM_VariableId status, VMGroup *vmgroup, bool extended, bool islocked, bool usestatereq, Blex::DateTime const &now)
{
        HSVM *vm = lock->comm.vm;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        // Calculate total running time
        Blex::DateTime total_running = vmgroup->jmdata.total_running;
        if (vmgroup->jmdata.current_run_start != Blex::DateTime::Min())
        {
                Blex::DateTime diff = now;
                diff -= vmgroup->jmdata.current_run_start;
                total_running += diff;
        }

        DBG_PRINT("Store VM status state: " << vmgroup->jmdata.state << " reqstate: " << vmgroup->jmdata.reqstate << " olddebug: " << vmgroup->jmdata.oldstatedebug << " usestatereq: " << usestatereq);

        RunningState::Type usestate = usestatereq ? vmgroup->jmdata.reqstate : vmgroup->jmdata.state;
        std::stringstream state_str, realstate_str;

        if (usestate == RunningState::Locked)
            usestate = vmgroup->jmdata.oldstate;

        realstate_str << usestate;

        if (usestate == RunningState::DebugStopped)
            usestate = vmgroup->jmdata.oldstatedebug;

        state_str << usestate;

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, status, cn_cache.col_groupid), vmgroup->jmdata.groupid);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, status, cn_cache.col_script), vmgroup->mainscript);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, status, cn_cache.col_realstatus), realstate_str.str());
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, status, cn_cache.col_status), state_str.str());
        HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, status, cn_cache.col_creationdate), vmgroup->jmdata.creationdate.GetDays(), vmgroup->jmdata.creationdate.GetMsecs());
        HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, status, cn_cache.col_total_running), total_running.GetDays(), total_running.GetMsecs());

        // Pause reason(s)
        unsigned reason = 0;
        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(vmgroup->jmdata.groupid);
        if (it != lock->state.jobs.end())
            reason = it->second.pause_reasons;
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, status, cn_cache.col_pausereason), reason);

        HSVM_VariableId var_authenticationrecord = HSVM_RecordCreate(vm, status, cn_cache.col_authenticationrecord);
        HSVM_SetDefault(vm, var_authenticationrecord, HSVM_VAR_Record);

        // Got jobmgr lock, so this is safe
        VirtualMachine *jobvm = jobmgr.GetGroupMainVM(*vmgroup);
        std::unique_ptr< MarshalPacket > copy;
        {
                VirtualMachine::LockedProtectedData::ReadRef lock(jobvm->protected_data);
                if (lock->authenticationrecord.get())
                    lock->authenticationrecord->TryClone(&copy);
        }
        if (copy.get())
            lock->comm.vm.authrec_marshaller.ReadMarshalPacket(var_authenticationrecord, &copy);

        if (extended)
        {
                HSVM_VariableId var_stacktrace = HSVM_RecordCreate(vm, status, cn_cache.col_stacktrace);
                HSVM_VariableId var_statistics = HSVM_RecordCreate(vm, status, cn_cache.col_statistics);
                HSVM_VariableId var_errors = HSVM_RecordCreate(vm, status, cn_cache.col_errors);
                HSVM_VariableId var_stacksize = HSVM_RecordCreate(vm, status, cn_cache.col_stacksize);

                HSVM_SetDefault(vm, var_stacktrace, HSVM_VAR_RecordArray);
                HSVM_SetDefault(vm, var_statistics, HSVM_VAR_Record);
                HSVM_SetDefault(vm, var_errors, HSVM_VAR_RecordArray);
                HSVM_SetDefault(vm, var_stacksize, HSVM_VAR_Integer);

                if (islocked)
                {
                        HSVM_IntegerSet(vm, var_stacksize, vmgroup->callstack.size());

                        GetVMStackTrace(&lock->comm.vm, var_stacktrace, vmgroup->currentvm, true);

                        HSVM_GetVMStatistics(vm, var_statistics, *vmgroup->mainvm);

                        GetMessageList(vm, var_errors, vmgroup->GetErrorHandler(), true);
                }
        }
}

void Debugger::HandleMessage(std::string const &type)
{
        DBG_PRINT("DBG: incoming message, type: " << type);
        if (type == "configure")                    { RPC_Configure(); }
        else if (type == "getjobmgrstatus")         { RPC_GetJobMgrStatus(); }
        //else if (type == "subscribelivejoblist")    { RPC_SubscribeLiveJoblist(); } // too much problems with remoting.shtml
        else if (type == "getjobstatus")            { RPC_GetJobStatus(); }
        else if (type == "terminatejob")            { RPC_TerminateJob(); }
        else if (type == "connectjob")              { RPC_ConnectJob(); }
        else if (type == "disconnectjob")           { RPC_DisconnectJob(); }
        else if (type == "pausejob")                { RPC_PauseJob(); }
        else if (type == "continuejob")             { RPC_ContinueJob(); }
        else if (type == "getvariables")            { RPC_GetVariables(); }
        else if (type == "getlibraries")            { RPC_GetLibraries(); }
        else if (type == "setbreakpoints")          { RPC_SetBreakpoints(); }
        else if (type == "setprofiling")            { RPC_SetProfiling(); }
        else if (type == "getprofile")              { RPC_GetProfile(); }
        else if (type == "getmemorysnapshot")       { RPC_GetMemorySnapshot(); }
        else if (type == "getblobreferences")       { RPC_GetBlobReferences(); }
        else if (type == "gethandlelist")           { RPC_GetHandleList(); }
        else
            throw std::runtime_error(("Unknown message type '" + type + "'").c_str());
}

void Debugger::RPC_Configure()
{
        /* @param msg
           @cell(string) msg.type 'configure'
           @cell(record array) msg.rules
           @cell(string) msg.rules.tag
           @cell(integer) msg.rules.site
           @cell(string) msg.rules.hosttype
           @cell(string) msg.rules.script
           @cell(string array) msg.rules.script_exclude
           @cell(boolean) msg.rules.stop_on_match
           @cell(boolean) msg.rules.inform_start_stop
           @return
           @cell(string) return.type 'configure-response'
        */

//        std::string current_hosttype = JobManager::LockedJobData::ReadRef(jobmgr.jobdata)->hosttype;

        {
                LockedData::WriteRef lock(data);
                HSVM *vm = lock->comm.vm;
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM_VariableId msgvar = lock->comm.msgvar;

                HSVM_ColumnId col_addrules = HSVM_GetColumnId(vm, "ADDRULES");
                HSVM_ColumnId col_reset = HSVM_GetColumnId(vm, "RESET");
                HSVM_ColumnId col_tag = HSVM_GetColumnId(vm, "TAG");
                HSVM_ColumnId col_sites = HSVM_GetColumnId(vm, "SITES");
//                HSVM_ColumnId col_hosttype = HSVM_GetColumnId(vm, "HOSTTYPE");
                HSVM_ColumnId col_script = HSVM_GetColumnId(vm, "SCRIPT");
                HSVM_ColumnId col_script_exclude = HSVM_GetColumnId(vm, "SCRIPT_EXCLUDE");
                HSVM_ColumnId col_connect_on_match = HSVM_GetColumnId(vm, "CONNECT_ON_MATCH");
                HSVM_ColumnId col_inform_start_stop = HSVM_GetColumnId(vm, "INFORM_START_STOP");
                HSVM_ColumnId col_deleterules = HSVM_GetColumnId(vm, "DELETERULES");
                HSVM_ColumnId col_keep_errorterminated_msecs = HSVM_GetColumnId(vm, "KEEP_ERRORTERMINATED_MSECS");
                HSVM_ColumnId col_authrecordrules = HSVM_GetColumnId(vm, "AUTHRECORDRULES");
                HSVM_ColumnId col_path = HSVM_GetColumnId(vm, "PATH");
                HSVM_ColumnId col_mask = HSVM_GetColumnId(vm, "MASK");

                bool reset = stackm.GetBoolean(stackm.RecordCellTypedGetByName(msgvar, col_reset, VariableTypes::Boolean, true));
                HSVM_VariableId var_addrules = stackm.RecordCellTypedGetByName(msgvar, col_addrules, VariableTypes::RecordArray, true);

                lock->config.keep_errorterminated_msecs = stackm.GetInteger(stackm.RecordCellTypedGetByName(msgvar, col_keep_errorterminated_msecs, VariableTypes::Integer, true));

                if (reset)
                    lock->config.rules.clear();

                unsigned addrulecount = HSVM_ArrayLength(vm, var_addrules);
                for (unsigned idx = 0; idx < addrulecount; ++idx)
                {
                        HSVM_VariableId var_rule = stackm.ArrayElementGet(var_addrules, idx);

                        Rule rule;
//                        std::string hosttype = stackm.GetSTLString(stackm.RecordCellTypedGetByName(var_rule, col_hosttype, VariableTypes::String, true));

//                        if (!Blex::StrLike(current_hosttype, rule.hosttype))
//                            continue;

                        rule.tag = stackm.GetSTLString(stackm.RecordCellTypedGetByName(var_rule, col_tag, VariableTypes::String, true));
                        rule.sites = static_cast< Rule::Site >(stackm.GetInteger(stackm.RecordCellTypedGetByName(var_rule, col_sites, VariableTypes::Integer, true)));
                        rule.script = stackm.GetSTLString(stackm.RecordCellTypedGetByName(var_rule, col_script, VariableTypes::String, true));
                        rule.connect_on_match = stackm.GetBoolean(stackm.RecordCellTypedGetByName(var_rule, col_connect_on_match, VariableTypes::Boolean, true));
                        rule.inform_start_stop = stackm.GetBoolean(stackm.RecordCellTypedGetByName(var_rule, col_inform_start_stop, VariableTypes::Boolean, true));

                        HSVM_VariableId var_script_exclude = stackm.RecordCellTypedGetByName(var_rule, col_script_exclude, VariableTypes::StringArray, true);
                        unsigned script_exclude_count = stackm.ArraySize(var_script_exclude);
                        for (unsigned sn_idx = 0; sn_idx < script_exclude_count; ++sn_idx)
                            rule.script_exclude.push_back(stackm.GetSTLString(stackm.ArrayElementGet(var_script_exclude, sn_idx)));

                        HSVM_VariableId var_authrecordrules = stackm.RecordCellTypedGetByName(var_rule, col_authrecordrules, VariableTypes::RecordArray, true);
                        unsigned authrecordrules_count = stackm.ArraySize(var_authrecordrules);
                        for (unsigned arr_idx = 0; arr_idx < authrecordrules_count; ++arr_idx)
                        {
                                HSVM_VariableId var_ar_rule = stackm.ArrayElementGet(var_authrecordrules, arr_idx);

                                Rule::AuthRecordRule ar_rule;

                                HSVM_VariableId var_path = stackm.RecordCellTypedGetByName(var_ar_rule, col_path, VariableTypes::StringArray, true);
                                unsigned path_count = stackm.ArraySize(var_path);
                                for (unsigned path_idx = 0; path_idx < path_count; ++path_idx)
                                    ar_rule.path.push_back(lock->comm.vm.columnnamemapper.GetMapping(stackm.GetSTLString(stackm.ArrayElementGet(var_path, path_idx))));
                                ar_rule.mask = stackm.GetSTLString(stackm.RecordCellTypedGetByName(var_ar_rule, col_mask, VariableTypes::String, true));

                                if (!ar_rule.path.empty())
                                    rule.authrecordrules.push_back(ar_rule);
                        }

                        lock->config.rules.push_back(rule);
                }

                HSVM_VariableId var_deleterules = stackm.RecordCellTypedGetByName(msgvar, col_deleterules, VariableTypes::StringArray, true);
                unsigned deleterulecount = HSVM_ArrayLength(vm, var_deleterules);
                for (unsigned idx = 0; idx < deleterulecount; ++idx)
                {
                        std::string tag = stackm.GetSTLString(stackm.ArrayElementGet(var_deleterules, idx));

                        // Lookup the rule and erase it
                        auto it = lock->config.rules.begin();
                        for (; it != lock->config.rules.end() && it->tag != tag; ++it) { }
                        if (it != lock->config.rules.end())
                            lock->config.rules.erase(it);
                }


//                SendTypeOnlyResponse(lock, lock->comm.msgid, "configure-response");
                lock->config.have_config = true;
        }

        DBG_PRINT("DBG: Configure complete, signalling waiters");
        data.SignalAll();
}

void Debugger::RPC_GetJobMgrStatus()
{
        /* @param msg
           @cell(string) msg.type 'getjobmgrstatus'
           @return
           @cell(string) return.type 'getjobmgrstatus-response'
           @cell(boolean) return.connected
           @cell(record array) return.jobs
           @cell(integer64) return.jobs.jobid
           @cell(string) return.jobs.status
           @cell(string) return.jobs.script
        */

        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "TYPE")), "getjobmgrstatus-response");
        HSVM_VariableId var_jobs = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "JOBS"));
        HSVM_SetDefault(vm, var_jobs, HSVM_VAR_RecordArray);

        Blex::DateTime now = Blex::DateTime::Now();

        for (std::map< std::string, JobData >::iterator it = lock->state.jobs.begin(), end = lock->state.jobs.end(); it != end; ++it)
        {
                HSVM_VariableId var_job = HSVM_ArrayAppend(vm, var_jobs);
                HSVM_SetDefault(vm, var_job, HSVM_VAR_Record);

                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var_job, cn_cache.col_connected), it->second.is_connected);
                StoreVMStatus(jobmgrlock, lock, var_job, it->second.vmgroup.get(), false, false, false, now);
        }

        DBG_PRINT("DBG: Send message 'getjobmgrstatus-response'");

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}


void Debugger::RPC_GetJobStatus()
{
        /* @param msg
           @cell(string) msg.type 'getjobstatus'
           @cell(integer64) msg.jobid
           @return
           @cell(string) return.type 'getjobstatus-response' / 'getjobstatus-gone'
           @cell(integer64) return.jobs.jobid
           @cell(string) return.jobs.status
           @cell(string) return.jobs.script
           @cell(record) return.jobs.authenticationrecord
           @cell(record array) return.jobs.stacktrace
           @cell(string) return.jobs.stacktrace.filename
           @cell(string) return.jobs.stacktrace.func
           @cell(integer) return.jobs.stacktrace.line
           @cell(integer) return.jobs.stacktrace.col
        */
        Callbacks callbacks;

        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it == lock->state.jobs.end())
                {
                        SendJobAndTypeOnlyResponse(lock, "getjobstatus-gone", groupid);
                        return;
                }

                SendJobStatus(jobmgrlock, lock, it->second.vmgroup.get(), "job-status", false, &callbacks);
        }

        for (Callbacks::iterator it = callbacks.begin(); it != callbacks.end(); ++it)
        {
                jobmgr.CallUnlockCallbacks(&it->first, it->second);
        }
}

void Debugger::RPC_TerminateJob()
{
        /* @param msg
           @cell(string) msg.type 'getjobstatus'
           @cell(integer64) msg.jobid
           @return
           @cell(string) return.type 'getjobstatus-response' / 'getjobstatus-gone'
           @cell(integer64) return.jobs.jobid
           @cell(string) return.jobs.status
           @cell(string) return.jobs.script
           @cell(record) return.jobs.authenticationrecord
           @cell(record array) return.jobs.stacktrace
           @cell(string) return.jobs.stacktrace.filename
           @cell(string) return.jobs.stacktrace.func
           @cell(integer) return.jobs.stacktrace.line
           @cell(integer) return.jobs.stacktrace.col
        */
        Callbacks callbacks;


        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
//                HSVM_VariableId composevar = lock->comm.composevar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it != lock->state.jobs.end())
                    jobmgr.AbortVMGroup(it->second.vmgroup.get(), HSVM_ABORT_MANUALLY);
        }
}

void Debugger::RPC_ConnectJob()
{
        /* @param msg
           @cell(string) msg.type 'getjobstatus'
           @cell(integer64) msg.jobid
           @return
           @cell(string) return.type 'getjobstatus-response' / 'getjobstatus-gone'
           @cell(integer64) return.jobs.jobid
           @cell(string) return.jobs.status
           @cell(string) return.jobs.script
           @cell(record) return.jobs.authenticationrecord
           @cell(record array) return.jobs.stacktrace
           @cell(string) return.jobs.stacktrace.filename
           @cell(string) return.jobs.stacktrace.func
           @cell(integer) return.jobs.stacktrace.line
           @cell(integer) return.jobs.stacktrace.col
        */
        Callbacks callbacks;


        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
                HSVM_VariableId composevar = lock->comm.composevar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it == lock->state.jobs.end())
                {
                        SendJobAndTypeOnlyResponse(lock, "connectjob-gone", groupid);
                        return;
                }
                if (it->second.is_connected)
                {
                        SendJobAndTypeOnlyResponse(lock, "connectjob-alreadyconnected", groupid);
                        return;
                }

                it->second.is_connected = true;
                SendJobStatus(jobmgrlock, lock, it->second.vmgroup.get(), "connectjob-ack", false, &callbacks);
        }

        for (Callbacks::iterator it = callbacks.begin(); it != callbacks.end(); ++it)
        {
                jobmgr.CallUnlockCallbacks(&it->first, it->second);
        }

}

void Debugger::RPC_DisconnectJob()
{
        // Destroy the ref outside the lock
        VMGroupRef groupref;

        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it == lock->state.jobs.end() || !it->second.is_connected)
                {
                        SendJobAndTypeOnlyResponse(lock, "disconnectjob-alreadydisconnected", groupid);
                        return;
                }

                it->second.is_connected = false;
                it->second.want_pause = false;
                it->second.pause_reasons = JobData::None;

                if (!it->second.is_zombie)
                {
                        DBG_PRINT("DBG: Disconnect non-zombie " << it->second.vmgroup->jmdata.state << " " << it->second.vmgroup->jmdata.oldstatedebug);
                        if (it->second.vmgroup->jmdata.state == RunningState::DebugStopped)
                             jobmgr.SetVMGroupState(jobmgrlock, it->second.vmgroup.get(), it->second.vmgroup->jmdata.oldstatedebug);

                        it->second.vmgroup->dbg_async.inform_next_suspend = false;
                        it->second.vmgroup->dbg_async.reset_breakpoints = false;

                        DBG_PRINT("DBG: Post-disconnect " << it->second.vmgroup->jmdata.state);
                }
                else
                {
                        DBG_PRINT("DBG: Disconnect zombie job, erase from state.jobs " << it->first);

                        jobmgr.SetVMGroupState(jobmgrlock, it->second.vmgroup.get(), RunningState::Terminated);

                        it->second.vmgroup->finishevent.SetSignalled(true);

                        // Destroy (last) group reference outside the jobmgr lock
                        groupref = it->second.vmgroup;
                        lock->state.jobs.erase(it);
                }

                // Send synchronous response
                SendJobAndTypeOnlyResponse(lock, "disconnectjob-ack", groupid);
        }

        // Signal the jobmgr to rescan for runnable processes
        jobmgr.jobdata.SignalAll();
}

void Debugger::RPC_PauseJob()
{
        Callbacks callbacks;

        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it == lock->state.jobs.end() || !it->second.is_connected)
                {
                        SendJobAndTypeOnlyResponse(lock, "pause-notconnected", groupid);
                        return;
                }

                JobData &jobdata = it->second;
                jobdata.pause_reasons |= JobData::Request;

                switch (jobdata.vmgroup->jmdata.state)
                {
                case RunningState::WaitForMultiple:
                case RunningState::Running:
                    {
                            // Running & WaitForMultiple must be switched by abortflags & such. For WFM we need the waits to be cleared
                            jobdata.want_pause = true;
                            *jobdata.vmgroup->abortflag = HSVM_ABORT_YIELD;
                            jobdata.vmgroup->dbg_async.inform_next_suspend = true;

                            // Fallthrough to signal jobmanager to scan WFM results
                    } break;
                case RunningState::Suspending:
                    {
                            jobdata.want_pause = true;
                            jobdata.vmgroup->dbg_async.inform_next_suspend = true;
                            return;
                    } break;
                case RunningState::DebugStopped:
                    {
                            // Already stopped, send immediate notification
                            SendJobStatus(jobmgrlock, lock, jobdata.vmgroup.get(), "job-paused", false, &callbacks);
                            return;
                    } break;
                case RunningState::InitialRunnable:
                case RunningState::Runnable:
                case RunningState::Terminated:
                    {
                            // Runnable & WaitForMultiple can be switched to debugstopped immediately
                            jobdata.vmgroup->jmdata.oldstatedebug = jobdata.vmgroup->jmdata.state;
                            jobmgr.SetVMGroupState(jobmgrlock, jobdata.vmgroup.get(), RunningState::DebugStopped);

                            SendJobStatus(jobmgrlock, lock, jobdata.vmgroup.get(), "job-paused", false, &callbacks);
                            // Fallthrough to run callbacks
                    } break;
                default:
                    {
                            // FIXME: send state?
                            Blex::ErrStream() << "Cannot pause state " << GetRunningStateName(jobdata.vmgroup->jmdata.state);
                            SendJobAndTypeOnlyResponse(lock, "pause-unsupportedstate", groupid);
                            //throw std::runtime_error(std::string("error: cannot break state ") + GetRunningStateName(jobdata.vmgroup->jmdata.state));
                    }
                }
        }

        for (Callbacks::iterator it = callbacks.begin(); it != callbacks.end(); ++it)
        {
                jobmgr.CallUnlockCallbacks(&it->first, it->second);
        }

        jobmgr.jobdata.SignalAll();
}

void Debugger::RPC_ContinueJob()
{
        Callbacks callbacks;

        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it == lock->state.jobs.end() || !it->second.is_connected)
                {
                        SendJobAndTypeOnlyResponse(lock, "continue-notconnected", groupid);
                        return;
                }

                JobData &jobdata = it->second;

                // break is cancelled
                jobdata.want_pause = false;
                jobdata.pause_reasons = JobData::None;

                if (jobdata.vmgroup->jmdata.state == RunningState::DebugStopped)
                    jobmgr.SetVMGroupState(jobmgrlock, jobdata.vmgroup.get(), jobdata.vmgroup->jmdata.oldstatedebug);

                // Send synchronous response.
                SendJobStatus(jobmgrlock, lock, jobdata.vmgroup.get(), "job-running", false, &callbacks);
        }

        jobmgr.jobdata.SignalAll();
}

void Debugger::RPC_GetVariables()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_type), "job-variables");
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);

        HSVM_VariableId var_resultvars = HSVM_RecordCreate(vm, composevar, cn_cache.col_variables);
        HSVM_SetDefault(vm, var_resultvars, HSVM_VAR_RecordArray);


        HSVM_VariableId var_variables = stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_variables, VariableTypes::RecordArray, true);
        uint32_t len = HSVM_ArrayLength(vm, var_variables);
        DBG_PRINT("DBG: Variable request " << len << " vars");
        for (unsigned i = 0; i < len; ++i)
        {
                  HSVM_VariableId var_var = stackm.ArrayElementGet(var_variables, i);
                  HSVM_VariableId var_result = HSVM_ArrayAppend(vm, var_resultvars);

                  int32_t vm_id = HSVM_IntegerGet(vm, stackm.RecordCellTypedGetByName(var_var, cn_cache.col_vm, VariableTypes::Integer, true));
                  VirtualMachine *target_vm = it->second.vmgroup->GetVMById(vm_id);

                  uint32_t id = HSVM_IntegerGet(vm, stackm.RecordCellTypedGetByName(var_var, cn_cache.col_id, VariableTypes::Integer, true));

                  if (!target_vm)
                  {
                          DBG_PRINT("DBG:  invalid");
                          HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_result, cn_cache.col_type), -1);
                          HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_result, cn_cache.col_id), id);
                          HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_result, cn_cache.col_vm), vm_id);
                          continue;
                  }

                  StackMachine &target_stackm = target_vm->GetStackMachine();

                  HSVM_VariableId toget;
                  if (id & 0x80000000)
                      toget = target_stackm.UnmapHeapId(id & 0x7FFFFFFF);
                  else
                      toget = target_stackm.StackStart() + id;

                  if (!target_stackm.CheckVarId(toget))
                  {
                          DBG_PRINT("DBG:  invalid");
                          HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_result, cn_cache.col_type), -1);
                          HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_result, cn_cache.col_id), id);
                          HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_result, cn_cache.col_vm), vm_id);
                          continue;
                  }

                  DBG_PRINT("DBG:  Req var " << id << " = " << toget);

                  RetrieveVariable(&lock->comm.vm, var_result, vm_id, target_vm, toget, var_var, 1);
        }

        DBG_PRINT("DBG: Send variables, replyto " << lock->comm.msgid);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

std::pair< int64_t, int64_t > Debugger::GetMinMax(StackMachine &stackm, ColumnNameCache const &cn_cache, VarId id_set, VarId req, int64_t defaultmax, int64_t len)
{
        VarId var_min = req ? stackm.RecordCellTypedGetByName(req, cn_cache.col_min, VariableTypes::Integer64, false) : 0;
        VarId var_max = req ? stackm.RecordCellTypedGetByName(req, cn_cache.col_max, VariableTypes::Integer64, false) : 0;

        int64_t min = var_min ? stackm.GetInteger64(var_min) : 0;
        int64_t max = var_max ? stackm.GetInteger64(var_max) : defaultmax;

        // Allow -1 as shortcut for 'all'
        if (max == -1)
            max = len;

        if (min < 0)
            min = 0;
        else if (min > len)
            min = len;
        if (max > len)
            max = len;
        else if (max < min)
            max = min;

        stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_length), len);
        stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_min), min);
        stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_max), max);

        return std::make_pair(min, max);
}

void Debugger::RetrieveVariable(VirtualMachine *vm, VarId id_set, int32_t vm_id, VirtualMachine *source_vm, VarId source_id, VarId req, unsigned depth)
{
        ColumnNameCache const &cn_cache = vm->cn_cache;
        StackMachine &stackm = vm->GetStackMachine();

        StackMachine &source_stackm = source_vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::Record);

        stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_vm), vm_id);

        VariableTypes::Type type = source_stackm.GetType(source_id);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_type), type);

        if (source_stackm.IsOnHeap(source_id))
            stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_id), source_stackm.MapHeapId(source_id) | 0x80000000);
        else
            stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_id), source_stackm.MapStackId(source_id));

        // Undefined? We're done
        if (!type)
            return;

        if (type & VariableTypes::Array)
        {
                unsigned len = source_stackm.ArraySize(source_id);
                auto minmax = GetMinMax(stackm, cn_cache, id_set, req, depth ? 10 : 0, len);

                VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                stackm.InitVariable(var_value, VariableTypes::RecordArray);

                for (int32_t idx = minmax.first; idx < minmax.second; ++idx)
                    RetrieveVariable(vm, stackm.ArrayElementAppend(var_value), vm_id, source_vm, source_stackm.ArrayElementGet(source_id, idx), 0, depth - 1);

                return;
        }

        switch (type)
        {
        // Simple types
        case VariableTypes::Integer:
        case VariableTypes::Boolean:
        case VariableTypes::Float:
        case VariableTypes::Money:
        case VariableTypes::Integer64:
        case VariableTypes::DateTime:
            {
                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.CopyFromOtherVM(vm, var_value, source_vm, source_id, false);
            } break;

        case VariableTypes::String:
            {
                    Blex::StringPair data = source_stackm.GetString(source_id);

                    auto minmax = GetMinMax(stackm, cn_cache, id_set, req, depth < 2 ? 100 : 0, data.size());

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.SetString(var_value, data.begin + minmax.first, data.begin + minmax.second);
            } break;

        case VariableTypes::Record:
            {
                    bool exists = !source_stackm.RecordNull(source_id);
                    stackm.SetBoolean(stackm.RecordCellCreate(id_set, cn_cache.col_exists), exists);

                    unsigned cellcount = exists ? source_stackm.RecordSize(source_id) : 0;

                    auto minmax = GetMinMax(stackm, cn_cache, id_set, req, depth ? cellcount : 0, cellcount);

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.InitVariable(var_value, VariableTypes::RecordArray);

                    for (int32_t idx = minmax.first; idx < minmax.second; ++idx)
                    {
                            VarId cell = stackm.ArrayElementAppend(var_value);
                            stackm.InitVariable(cell, VariableTypes::Record);

                            ColumnNameId nameid = source_stackm.RecordCellNameByNr(source_id, idx);
                            Blex::StringPair name = source_stackm.columnnamemapper.GetReverseMapping(nameid);

                            stackm.SetString(stackm.RecordCellCreate(cell, cn_cache.col_name), name);
                            RetrieveVariable(vm, stackm.RecordCellCreate(cell, cn_cache.col_value), vm_id, source_vm, source_stackm.RecordCellGetByName(source_id, nameid), 0, depth - 1);
                    }
            } break;

        case VariableTypes::Object:
        case VariableTypes::WeakObject:
            {
                    bool exists = source_stackm.WeakObjectExists(source_id);
                    stackm.SetBoolean(stackm.RecordCellCreate(id_set, cn_cache.col_exists), exists);

                    unsigned cellcount = exists ? source_stackm.ObjectSize(source_id) : 0;

                    auto minmax = GetMinMax(stackm, cn_cache, id_set, req, depth ? cellcount : 0, cellcount);

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.InitVariable(var_value, VariableTypes::RecordArray);

                    stackm.SetBoolean(stackm.RecordCellCreate(id_set, cn_cache.col_privileged), source_stackm.ObjectIsPrivilegedReference(source_id));
                    stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_objectid), source_stackm.GetObjectId(source_id));

                    VarId var_objecttypes = stackm.RecordCellCreate(id_set, cn_cache.col_objecttypes);
                    stackm.InitVariable(var_objecttypes, VariableTypes::StringArray);

                    if (exists)
                    {
                            Blex::SemiStaticPodVector< LinkedLibrary::LinkedObjectDef const *, 16 > objdefs;

                            if (source_vm->GetObjectDefinitions(source_id, &objdefs))
                            {
                                    for (auto &itr: objdefs)
                                        stackm.SetString(stackm.ArrayElementAppend(var_objecttypes), itr->name.begin(), itr->name.end());
                            }
                    }

                    for (int32_t idx = minmax.first; idx < minmax.second; ++idx)
                    {
                            VarId cell = stackm.ArrayElementAppend(var_value);
                            stackm.InitVariable(cell, VariableTypes::Record);

                            ColumnNameId nameid = source_stackm.ObjectMemberNameByNr(source_id, idx);
                            if (!nameid)
                                continue;

                            Blex::StringPair name = source_stackm.columnnamemapper.GetReverseMapping(nameid);

                            stackm.SetString(stackm.RecordCellCreate(cell, cn_cache.col_name), name);
                            RetrieveVariable(vm, stackm.RecordCellCreate(cell, cn_cache.col_value), vm_id, source_vm, source_stackm.ObjectMemberGet(source_id, nameid, true), 0, depth - 1);
                    }
            } break;

        case VariableTypes::Blob:
            {
                    BlobRefPtr blobref = source_stackm.GetBlob(source_id);

                    std::string data;
                    std::unique_ptr< OpenedBlob > openblob(blobref.OpenBlob());

                    int64_t len = openblob ? blobref.GetLength() : 0;
                    auto minmax = GetMinMax(stackm, cn_cache, id_set, req, depth ? len : 0, len);

                    if (openblob)
                    {
                            data.resize(minmax.second - minmax.first);

                            for (int64_t idx = minmax.first; idx < minmax.second;)
                            {
                                    unsigned toread = std::min< int64_t >(minmax.second - idx, 16384);
                                    std::size_t read = openblob->DirectRead(idx, toread, &data[idx - minmax.first]);
                                    if (!read)
                                        break;

                                    idx += read;
                            }
                    }

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.SetString(var_value, data.begin(), data.end());
            } break;

        // TODO
        case VariableTypes::FunctionRecord:
        case VariableTypes::VMRef:
        default: ; // not handled;
        }
}

void Debugger::RPC_GetLibraries()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_ColumnId col_libraries = HSVM_GetColumnId(vm, "LIBRARIES");
        HSVM_ColumnId col_vms = HSVM_GetColumnId(vm, "VMS");

        unsigned vmcount = it->second.vmgroup->GetVMCount();

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_type), "job-libraries");
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);

        HSVM_VariableId var_vms = HSVM_RecordCreate(vm, composevar, col_vms);
        HSVM_SetDefault(vm, var_vms, HSVM_VAR_RecordArray);

        for (unsigned vid = 0; vid < vmcount; ++vid)
        {
                VirtualMachine *target_vm = it->second.vmgroup->GetVMById(vid);

                VarId var_vm = HSVM_ArrayAppend(vm, var_vms);

                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_vm, cn_cache.col_vm), vid);

                HSVM_VariableId var_resultlibs = HSVM_RecordCreate(vm, var_vm, col_libraries);
                GetVMLibraries(&lock->comm.vm, var_resultlibs, target_vm);
        }

        DBG_PRINT("DBG: Send libraries, replyto " << lock->comm.msgid);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

void Debugger::RPC_SetBreakpoints()
{
        {
                JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
                LockedData::WriteRef lock(data);
                StackMachine &stackm = lock->comm.vm.GetStackMachine();
                HSVM *vm = lock->comm.vm;
                HSVM_VariableId msgvar = lock->comm.msgvar;
                ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

                std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
                if (it == lock->state.jobs.end() || !it->second.is_connected)
                {
                        SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                        return;
                }

                HSVM_ColumnId col_breakpoints = HSVM_GetColumnId(vm, "BREAKPOINTS");
                HSVM_ColumnId col_minstacksize = HSVM_GetColumnId(vm, "MINSTACKSIZE");
                HSVM_ColumnId col_maxstacksize = HSVM_GetColumnId(vm, "MAXSTACKSIZE");

                it->second.vmgroup->dbg_async.min_stack = stackm.GetInteger(stackm.RecordCellTypedGetByName(msgvar, col_minstacksize, VariableTypes::Integer, true));
                it->second.vmgroup->dbg_async.max_stack = stackm.GetInteger(stackm.RecordCellTypedGetByName(msgvar, col_maxstacksize, VariableTypes::Integer, true));

                VarId var_breakpoints = stackm.RecordCellTypedGetByName(msgvar, col_breakpoints, VariableTypes::RecordArray, true);
                unsigned len = stackm.ArraySize(var_breakpoints);

                // Get breakpoints list
                it->second.vmgroup->dbg_async.breakpoints.clear();
                for (unsigned i = 0; i < len; ++i)
                {
                        VMBreakPoint bp;

                        VarId var_breakpoint = stackm.ArrayElementGet(var_breakpoints, i);

                        bp.vm_id = HSVM_IntegerGet(vm, stackm.RecordCellTypedGetByName(var_breakpoint, cn_cache.col_vm, VariableTypes::Integer, true));
                        bp.liburi = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(var_breakpoint, cn_cache.col_liburi, VariableTypes::String, true));
                        bp.compile_id = stackm.GetDateTime(stackm.RecordCellTypedGetByName(var_breakpoint, cn_cache.col_compile_id, VariableTypes::DateTime, true));
                        bp.codeptr = HSVM_IntegerGet(vm, stackm.RecordCellTypedGetByName(var_breakpoint, cn_cache.col_codeptr, VariableTypes::Integer, true));
                        bp.stacksize = HSVM_IntegerGet(vm, stackm.RecordCellTypedGetByName(var_breakpoint, cn_cache.col_stacksize, VariableTypes::Integer, true));
                        bp.manual = HSVM_BooleanGet(vm, stackm.RecordCellTypedGetByName(var_breakpoint, cn_cache.col_manual, VariableTypes::Boolean, true));

                        it->second.vmgroup->dbg_async.breakpoints.push_back(bp);
                }

                switch (it->second.vmgroup->jmdata.state)
                {
                case RunningState::DebugStopped:
                case RunningState::InitialRunnable:
                case RunningState::Runnable:
                    {
                            this->ApplyBreakpoints(*it->second.vmgroup); break;
                            return;
                    }

                case RunningState::WaitForMultiple:
                case RunningState::Running:
                case RunningState::Suspending:
                    {
                            // Running & WaitForMultiple must be switched by abortflags & such. For WFM we need the waits to be cleared
                            *it->second.vmgroup->abortflag = HSVM_ABORT_YIELD;
                            it->second.vmgroup->dbg_async.reset_breakpoints = true;
                    }
                default: ;// Meh, ignore for now. ADDME: what about Locked & Startup?
                }

                SendJobAndTypeOnlyResponse(lock, "job-setbreakpoints", groupid);
        }
        jobmgr.jobdata.SignalAll();
}

void Debugger::ApplyBreakpoints(VMGroup &vmgroup)
{
        vmgroup.dbg.breakpoints.clear();
        vmgroup.dbg.min_stack = vmgroup.dbg_async.min_stack;
        vmgroup.dbg.max_stack = vmgroup.dbg_async.max_stack;

        DBG_PRINT("ApplyBreakpoints, stack: " << vmgroup.dbg.min_stack << " - " << vmgroup.dbg.max_stack << ", " << vmgroup.dbg_async.breakpoints.size() << " breakpoints");

        for (auto &itr: vmgroup.dbg_async.breakpoints)
        {
                VirtualMachine *target_vm = vmgroup.GetVMById(itr.vm_id);
                if (!target_vm)
                    continue;

                Library const *lib = target_vm->GetLibraryLoader().GetWHLibrary(itr.liburi);
                if (!lib)
                    continue;

                if (lib->clib_ids.clib_id != itr.compile_id)
                    continue;

                std::vector< uint8_t > const &code = lib->GetWrappedLibrary().resident.code;

                if (itr.codeptr >= code.size())
                    continue;

                vmgroup.dbg.breakpoints.insert(std::make_pair(&code[itr.codeptr], std::make_pair(itr.stacksize, itr.manual)));
        }
}


void Debugger::RPC_SetProfiling()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_ColumnId col_reset = HSVM_GetColumnId(vm, "RESET");
        HSVM_ColumnId col_profiletype = HSVM_GetColumnId(vm, "PROFILETYPE");

        bool enable = HSVM_BooleanGet(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_value, VariableTypes::Boolean, true));
        bool reset = HSVM_BooleanGet(vm, stackm.RecordCellTypedGetByName(msgvar, col_reset, VariableTypes::Boolean, true));
        std::string profiletype = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, col_profiletype, VariableTypes::String, true));

        // Allow disable 'all'
        if (profiletype != "function" && profiletype != "memory" && (profiletype != "all" || enable))
            throw std::runtime_error(("Unknown profile type '" + profiletype + "'").c_str());

        if (!enable || profiletype != "function")
        {
                it->second.vmgroup->mainvm->DisableFunctionProfiling();
                DEBUGPRINT("Disabled function profiling");
        }
        if (!enable || profiletype != "memory")
        {
                it->second.vmgroup->mainvm->DisableMemoryProfiling();
                DEBUGPRINT("Disabled memory profiling");
        }
        if (reset)
        {
                DEBUGPRINT("Reset all profiles");
                it->second.vmgroup->mainvm->ResetFunctionProfile();
                it->second.vmgroup->mainvm->ResetMemoryProfile();
        }
        if (enable && profiletype == "function")
        {
                DEBUGPRINT("Enabled function profiling");
                it->second.vmgroup->mainvm->EnableFunctionProfiling();
        }
        if (enable && profiletype == "memory")
        {
                DEBUGPRINT("Enabled memory profiling");
            it->second.vmgroup->mainvm->EnableMemoryProfiling();
        }

        DBG_PRINT("DBG: Set " << profiletype << " profiling to " << (enable?"on":"off") << ", reset: " << (reset?"yes":"no") << ", replyto " << lock->comm.msgid);

        SendJobAndTypeOnlyResponse(lock, "job-setprofiling", groupid);
}

void Debugger::RPC_GetProfile()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        HSVM_ColumnId col_profiletype = HSVM_GetColumnId(vm, "PROFILETYPE");

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));
        std::string profiletype = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, col_profiletype, VariableTypes::String, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "TYPE")), "job-getprofile-response");
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);
        HSVM_VariableId var_rawdata = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "RAWDATA"));
        HSVM_SetDefault(vm, var_rawdata, HSVM_VAR_Record);

        if (profiletype == "function")
        {
                DEBUGPRINT("Send function profile");
                Baselibs::EncodeFunctionProfileData(it->second.vmgroup->mainvm->GetProfileData(), &lock->comm.vm, var_rawdata);
        }
        else if (profiletype == "memory")
        {
                DEBUGPRINT("Send memory profile");

                ProfileData const &profiledata = it->second.vmgroup->mainvm->GetProfileData();
                profiledata.calltree.StoreTree(&lock->comm.vm, var_rawdata, it->second.vmgroup->mainvm);
        }
        else
            throw std::runtime_error(("Unknown profile type '" + profiletype + "'").c_str());

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

void Debugger::RPC_GetMemorySnapshot()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        HSVM_ColumnId col_include_unreferenced = HSVM_GetColumnId(vm, "INCLUDE_UNREFERENCED");

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));
        bool include_unreferenced = HSVM_BooleanGet(vm, stackm.RecordCellTypedGetByName(msgvar, col_include_unreferenced, VariableTypes::Boolean, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "TYPE")), "job-getmemorysnapshot-response");
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);

        HSVM_VariableId var_rawdata = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "RAWDATA"));
        HSVM_SetDefault(vm, var_rawdata, HSVM_VAR_Record);
        HSVM_VariableId var_items = HSVM_RecordCreate(vm, var_rawdata, HSVM_GetColumnId(vm, "ITEMS"));

        Baselibs::EncodeObjectWeb(it->second.vmgroup->mainvm, &lock->comm.vm, var_items, include_unreferenced);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

void Debugger::RPC_GetBlobReferences()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        HSVM_ColumnId col_include_unreferenced = HSVM_GetColumnId(vm, "INCLUDE_UNREFERENCED");

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));
        bool include_unreferenced = HSVM_BooleanGet(vm, stackm.RecordCellTypedGetByName(msgvar, col_include_unreferenced, VariableTypes::Boolean, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "TYPE")), "job-getmemorysnapshot-response");
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);

        HSVM_VariableId var_rawdata = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "RAWDATA"));
        HSVM_SetDefault(vm, var_rawdata, HSVM_VAR_Record);

        Baselibs::EncodeBlobReferences(it->second.vmgroup->mainvm, &lock->comm.vm, var_rawdata, include_unreferenced);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

void Debugger::RPC_GetHandleList()
{
        JobManager::LockedJobData::WriteRef jobmgrlock(jobmgr.jobdata);
        LockedData::WriteRef lock(data);
        StackMachine &stackm = lock->comm.vm.GetStackMachine();
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId msgvar = lock->comm.msgvar;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        std::string groupid = HSVM_StringGetSTD(vm, stackm.RecordCellTypedGetByName(msgvar, cn_cache.col_groupid, VariableTypes::String, true));

        std::map< std::string, JobData >::iterator it = lock->state.jobs.find(groupid);
        if (it == lock->state.jobs.end() || !it->second.is_connected)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notconnected", groupid);
                return;
        }

        if (it->second.vmgroup->jmdata.state != RunningState::DebugStopped)
        {
                SendJobAndTypeOnlyResponse(lock, "error-notstopped", groupid);
                return;
        }

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "TYPE")), "job-gethandellist-response");
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), groupid);

        HSVM_VariableId var_rawdata = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "RAWDATA"));
        HSVM_SetDefault(vm, var_rawdata, HSVM_VAR_Record);

        Baselibs::EncodeHandleList(it->second.vmgroup->mainvm, &lock->comm.vm, var_rawdata);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

bool Debugger::ProcessIPCMessage(std::shared_ptr< IPCMessage2 > const &msg)
{
        try
        {
                std::string type;

                {
                        LockedData::WriteRef lock(data);

                        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

                        HSVM_VariableId msgvar = lock->comm.msgvar;
                        lock->comm.vm.GetIPCMarshaller().ReadMarshalPacket(msgvar, &msg->data);
                        lock->comm.msgid = msg->msgid;
                        lock->comm.groupid.clear();
                        HSVM *vm = lock->comm.vm;

                        HSVM_VariableId var_type = HSVM_RecordGetRef(vm, msgvar, cn_cache.col_type);
                        if (!var_type || HSVM_GetType(vm, var_type) != HSVM_VAR_String)
                        {
                                DBG_PRINT("DBG: type var missing! " << var_type);
                                return false;
                        }

                        HSVM_VariableId var_groupid = HSVM_RecordGetRef(vm, msgvar, lock->comm.vm.cn_cache.col_groupid);
                        if (var_groupid && HSVM_GetType(vm, var_groupid) == HSVM_VAR_String)
                            lock->comm.groupid = HSVM_StringGetSTD(vm, var_groupid);

                        type = HSVM_StringGetSTD(vm, var_type);
                }

                DBG_PRINT("DBG: incoming IPC message, type '" << type << "'");

                HandleMessage(type);
                return true;
        }
        catch (std::exception &e)
        {
                DBG_PRINT("DBG: sending exception " << e.what());
                LockedData::WriteRef lock(data);
                SendException(lock, msg->msgid, e.what());
                return false;
        }
}

void Debugger::SendGreeting(LockedData::WriteRef &lock, uint64_t processcode, std::string const &clientname)
{
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_VariableId var_type = HSVM_RecordCreate(vm, composevar, col_type);
        HSVM_StringSetSTD(vm, var_type, "greeting");

        HSVM_ColumnId col_clientname = HSVM_GetColumnId(vm, "CLIENTNAME");
        HSVM_VariableId var_clientname = HSVM_RecordCreate(vm, composevar, col_clientname);
        HSVM_StringSetSTD(vm, var_clientname, clientname);

        HSVM_ColumnId col_processcode = HSVM_GetColumnId(vm, "PROCESSCODE");
        HSVM_VariableId var_processcode = HSVM_RecordCreate(vm, composevar, col_processcode);
        HSVM_Integer64Set(vm, var_processcode, processcode);

        SendComposeVar(lock, 0);
}

void Debugger::SendTypeOnlyResponse(LockedData::WriteRef &lock, uint64_t replyto, std::string const &type)
{
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_VariableId var_type = HSVM_RecordCreate(vm, composevar, col_type);
        HSVM_StringSetSTD(vm, var_type, type);

        DBG_PRINT("DBG: Send message '" << type << "'");

        SendComposeVar(lock, replyto);
}

void Debugger::SendJobAndTypeOnlyResponse(LockedData::WriteRef &lock, std::string const &type, std::string const &groupid)
{
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_VariableId var_type = HSVM_RecordCreate(vm, composevar, cn_cache.col_type);
        HSVM_StringSetSTD(vm, var_type, type);

        HSVM_VariableId var_groupid = HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid);
        HSVM_StringSetSTD(vm, var_groupid, groupid);

        DBG_PRINT("DBG: Send message '" << type << "', groupid " << groupid);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

void Debugger::SendJobStatus(JobManager::LockedJobData::WriteRef &jobmgrlock, LockedData::WriteRef &lock, VMGroup *vmgroup, std::string const &type, bool usestatereq, Callbacks *callbacks)
{
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_VariableId var_type = HSVM_RecordCreate(vm, composevar, col_type);
        HSVM_StringSetSTD(vm, var_type, type);

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), vmgroup->jmdata.groupid);

        Blex::DateTime now = Blex::DateTime::Now();

        if (callbacks)
        {
                if (jobmgr.LockedTryLockVMGroup(jobmgrlock, vmgroup, 0))
                {
                        StoreVMStatus(jobmgrlock, lock, composevar, vmgroup, true, true, usestatereq, now);

                        std::pair< UnlockCallbacks, RunningState::Type > unlock;
                        jobmgr.LockedUnlockVMGroup(jobmgrlock, vmgroup, &unlock.first, &unlock.second);
                        callbacks->push_back(unlock);
                }
                else
                    StoreVMStatus(jobmgrlock, lock, composevar, vmgroup, true, false, usestatereq, now);
        }
        else
            StoreVMStatus(jobmgrlock, lock, composevar, vmgroup, true, true, usestatereq, now);

        DBG_PRINT("DBG: Send job status with message '" << type << "', groupid " << vmgroup->jmdata.groupid);

        SendComposeVar(lock, lock->comm.msgid);
        lock->comm.msgid = 0;
}

void Debugger::SendException(LockedData::WriteRef &lock, uint64_t replyto, std::string const &what)
{
        ColumnNameCache const &cn_cache = lock->comm.vm.cn_cache;
        HSVM *vm = lock->comm.vm;
        HSVM_VariableId composevar = lock->comm.composevar;

        HSVM_SetDefault(vm, composevar, HSVM_VAR_Record);

        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_VariableId var_type = HSVM_RecordCreate(vm, composevar, col_type);
        HSVM_StringSetSTD(vm, var_type, lock->comm.groupid.empty() ? "error" : "job-error");

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_groupid), lock->comm.groupid);

        HSVM_ColumnId col_msg = HSVM_GetColumnId(vm, "MSG");
        HSVM_VariableId var_msg = HSVM_RecordCreate(vm, composevar, col_msg);
        HSVM_StringSetSTD(vm, var_msg, what);

        DBG_PRINT("DBG: Send exception, msg '" << what << "'");

        SendComposeVar(lock, replyto);
}

void Debugger::SendComposeVar(LockedData::WriteRef &lock, uint64_t replyto)
{
        std::unique_ptr< IPCMessage2 > packet;
        packet.reset(new IPCMessage2);
        packet->replyto = replyto;
        packet->data.reset(lock->comm.vm.GetIPCMarshaller().WriteToNewPacket(lock->comm.composevar));

        lock->comm.link->SendMessage(&packet, false);
}

Debugger::JobData::JobData()
: is_zombie(false)
, is_connected(false)
, want_pause(false)
, pause_reasons(None)
, termination_time(Blex::DateTime::Max())
{
}

void Debugger::JobData::reset()
{
        is_connected = false;
        want_pause = false;
        pause_reasons = None;

        matched_rules.clear();
        connect_rules.clear();
}


} // End of namespace HareScript
//---------------------------------------------------------------------------

