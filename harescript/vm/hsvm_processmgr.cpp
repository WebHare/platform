//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_processmgr.h"
#include "hsvm_context.h"
#include "hsvm_debugger.h"
#include "hsvm_events.h"
#include "baselibs.h"
#include <blex/logfile.h>
#include <limits>

// Show all job manager/port/message stuff
//#define SHOW_JOBMANAGER
//#define SHOW_PORTS
//#define SHOW_PORTS_EVENTS
//#define SHOW_GROUPREFS
//#define SHOW_LOCKS
//#define SHOW_WFM

#if defined(SHOW_JOBMANAGER) && defined(DEBUG)
 #define PM_PRINT(x) DEBUGPRINT(x)
 #define PM_ONLY(x) x
#else
 #define PM_PRINT(x)
 #define PM_ONLY(x)
#endif

#if defined(SHOW_PORTS) && defined(DEBUG)
 #define PO_PRINT(x) DEBUGPRINT(x)
 #define PO_ONLY(x) x
#else
 #define PO_PRINT(x)
 #define PO_ONLY(x)
#endif

#if defined(SHOW_PORTS_EVENTS) && defined(DEBUG)
 #define POE_PRINT(x) DEBUGPRINT(x)
 #define POE_ONLY(x) x
#else
 #define POE_PRINT(x)
 #define POE_ONLY(x)
#endif

#if defined(SHOW_GROUPREFS) && defined(DEBUG)
 #define GR_PRINT(x) DEBUGPRINT(x)
 #define GR_ONLY(x) DEBUGONLY(x)
#else
 #define GR_PRINT(x)
 #define GR_ONLY(x)
#endif

#if defined(SHOW_LOCKS) && defined(DEBUG)
 #define LOCK_PRINT(x) DEBUGPRINT(x)
 #define LOCK_ONLY(x) x
#else
 #define LOCK_PRINT(x)
 #define LOCK_ONLY(x)
#endif

#if defined(SHOW_WFM) && defined(DEBUG)
 #define WFM_PRINT(x) DEBUGPRINT("WFM: " << x)
 #define WFM_ONLY(x) x
#else
 #define WFM_PRINT(x)
 #define WFM_ONLY(x)
#endif



namespace HareScript
{

/* Locks: (top locks: no other locks may be taken when these are locked)
   - VMGroup reference mutex (top)            Only for keeping vmgroup references
   - Job manager jobdata lock (top)   For everything, and signalling the workers
   - Timer lock                               Signalling for the timer thread

   Lock order: timer > jobdata > groupref

   VM access:
     Startup: access at own risk (make sure you're the only one)
     Running: only access within VM is allowed
     InitialRunnable, Runnable, WaitMsg, SendMsg, Terminated, WaitMsgSync, SendMsgSync: only allowed with job lock
     Locked: allowed for locking thread only

     More important stuff
     - WaitForMultiple has a fragile construction concerning references and locking. Currently, only
       ONE worker thread may do a pipewait at a time, and no other worker may touch data of jobs
       in WaitForMultiple running state.

     FIXME: Enable security measures for port mechanism
*/


// ----------------------------------------------------------------------------_
//
// JobManagerContextData
//

void JobManagerContextData::InitColumnMappings(VirtualMachine *vm)
{
        col_status = HSVM_GetColumnId(*vm, "STATUS");
        col_msg = HSVM_GetColumnId(*vm, "MSG");
        col_msgid = HSVM_GetColumnId(*vm, "MSGID");
        col_replyto = HSVM_GetColumnId(*vm, "REPLYTO");
        inited_cols = true;
}

// ----------------------------------------------------------------------------_
//
// VMGroupRef
//

/// Mutex to serialize modifying vm group reference counts
Blex::Mutex grouprefmutex;

VMGroupRef::VMGroupRef(VMGroup *_group, bool addref)
: group(_group)
{
        if (group && addref)
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                ++group->refcount;
                GR_PRINT("^ref add " << this << " " << group << ":" << group->refcount - 1 << " -> " << group->refcount);
        }
}

VMGroupRef::VMGroupRef(VMGroupRef const &rhs)
: group(rhs.group)
{
        if (group)
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                ++group->refcount;
                GR_PRINT("^ref add " << this << " " << group << ":" << group->refcount - 1 << " -> " << group->refcount);
        }
}

VMGroupRef::~VMGroupRef()
{
        VMGroup *delete_group(0);
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                assert(!group || group->refcount != 0);
                if (group && --group->refcount == 0)
                    delete_group = group;
                GR_ONLY(if (group) GR_PRINT("^ref del " << this << " " << group << ":" << group->refcount + 1 << " -> " << group->refcount));
        }
        if (delete_group) // Delete outside lock
            delete delete_group;
}

VMGroupRef & VMGroupRef::operator =(VMGroupRef const &rhs)
{
        if (group == rhs.group)
            return *this;
        VMGroup *delete_group(0);
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                if (group && --group->refcount == 0)
                    delete_group = group;
                GR_ONLY(if (group) GR_PRINT("^ref del " << this << " " << group << ":" << group->refcount + 1 << " -> " << group->refcount));
                group = rhs.group;
                if (group)
                    ++group->refcount;
                GR_ONLY(if (group) GR_PRINT("^ref add " << this << " " << group << ":" << group->refcount - 1 << " -> " << group->refcount));
        }
        if (delete_group) // Delete outside lock
            delete delete_group;
        return *this;
}
void VMGroupRef::reset(VMGroup *_group, bool addref)
{
        if (group != _group || !addref)
            *this = VMGroupRef(_group, addref);
}

// -----------------------------------------------------------------------------
//
// JobManager
//

JobManagerGroupData::JobManagerGroupData()
: creationdate(Blex::DateTime::Now())
, state(RunningState::Startup)
, oldstate(RunningState::Locked)
, oldstatedebug(RunningState::Startup)
, reqstate(RunningState::Startup)
, waitingvm(0)
, id_set(0)
, iscancellable(false)
, iscancelled(false)
, run_timeout_seconds(0)
, is_running_for_timeout(true)
, running_timeout(Blex::DateTime::Max())
, current_run_start(Blex::DateTime::Min())
, total_running(Blex::DateTime::Min())
, highpriority(false)
{
}

// -----------------------------------------------------------------------------
//
// JobManager
//

JobManager::JobManager(Environment &_env)
: env(_env)
//, timerthread(std::bind(&JobManager::TimerThreadFunction, this))
, debugger(new Debugger(env, *this))
{
}

JobManager::~JobManager()
{
        Shutdown();
        PM_PRINT("Destroying job manager");
}

void JobManager::GenerateJobManagerId()
{
        std::vector< Blex::SocketAddress > localips;
        Blex::GetLocalIPs(&localips);

        std::string data = "JobManager_" + Blex::AnyToString(Blex::GetProcessId()) + "_" + Blex::AnyToString((void*)this) + "_";
        for (std::vector< Blex::SocketAddress >::iterator it = localips.begin(); it != localips.end(); ++it)
        {
                data += "_";
                data += it->ToString();
        }

        Blex::MD5 md5;
        md5.Process(data.c_str(), data.size());
        uint8_t const *hash = md5.Finalize();

        Blex::EncodeUFS(hash, hash + 16, std::back_inserter(jobmgr_id));
}

void JobManager::Shutdown()
{
        PM_PRINT("Shutting down debugger");
        debugger->Shutdown();
        PM_PRINT("Shutting down job manager");
        AbortWorkerThreads();
        ClearAllJobs();
}

unsigned JobManager::GetNumRunningJobs()
{
        return LockedJobData::ReadRef(jobdata)->jobs.size();
}

bool JobManager::IsRunning()
{
        return !LockedJobData::ReadRef(jobdata)->abort;
}

void JobManager::ClearAllJobs()
{
        PM_PRINT("Clearing all jobs");

        std::vector< VMGroupRef > jobs;
        {
                // Can't delete jobs within lock, because port destruction takes this lock too
                LockedJobData::WriteRef lock(jobdata);
                std::swap(jobs, lock->jobs);
        }
        jobs.clear();
}

void JobManager::Start(unsigned numworkers, unsigned reserved_highpriority)
{
        // Create the workers
        for (unsigned i = 0; i < numworkers; ++i)
        {
                std::shared_ptr< Blex::Thread > worker;
                worker.reset(new Blex::Thread(std::bind(&JobManager::WorkerThreadFunction, this, i)));
                worker->Start();
                workers.push_back(worker);
        }

        LockedJobData::WriteRef lock(jobdata);
        lock->max_running_lowp = numworkers - reserved_highpriority;
}

void JobManager::AbortWorkerThreads()
{
        {
                // Abort all running jobs
                LockedJobData::WriteRef lock(jobdata);

                // This will abort all workers that are not running a job
                lock->abort = true;

                // This will abort all running jobs
                for (std::vector< VMGroupRef >::iterator it = lock->jobs.begin(); it != lock->jobs.end(); ++it)
                {
                        switch (it->group->jmdata.state)
                        {
                        case RunningState::Running:
                        case RunningState::Suspending:
                            {
                                    volatile unsigned *flag = it->group->GetAbortFlag();
                                    if (!flag)
                                    {
                                            it->group->SetAbortFlag(0); // Sets the default flag
                                            flag = it->group->GetAbortFlag();
                                    }
                                    if (flag)
                                    {
                                            PM_PRINT("Aborting running vmgroup " << it->group);
                                            *flag = HSVM_ABORT_SILENTTERMINATE;
                                    }
                            } break;
                        default: ;
                        }
                }
        }
        // Go and signal all workers something has happened, and wait until they have terminated
        jobdata.SignalAll();
        for (std::vector< std::shared_ptr< Blex::Thread > >::iterator it = workers.begin(); it != workers.end(); ++it)
            (*it)->WaitFinish();
}

bool JobManager::DoRun(VMGroup *group)
{
        group->is_run_by_jobmgr = true;

        if (group->TestMustAbort())
        {
                group->mainvm->HandleAbortFlagErrors();
                return false;
        }

        bool retval = false;
        try
        {
                PM_PRINT("Running VM group " << group << " (vm: " << group->mainvm << ")");
                //HSVM_StartProfileTimer(*group->mainvm);
                group->Run(true, true);
                HSVM_FlushOutputBuffer(*group->mainvm);
                //HSVM_StopProfileTimer(*group->mainvm);
                if (group->mainvm->is_unwinding)
                    group->mainvm->AbortForUncaughtException();
                if (group->TestMustAbort())
                {
                        group->mainvm->HandleAbortFlagErrors();
                        return false;
                }

                retval = true;
                assert((LockedJobData::WriteRef(jobdata),group->jmdata.state == RunningState::Running || group->jmdata.state == RunningState::Suspending));
        }
        catch (VMRuntimeError &e)
        {
                PM_PRINT("Script generated VMRuntime exception: " << e.what());
                group->GetCurrentVM()->PrepareStackTrace(&e);
                group->GetCurrentVM()->GetErrorHandler().AddMessage(e);
        }
        catch(std::exception &e)
        {
                PM_PRINT("Script generated exception: " << e.what());
                VMRuntimeError msg(Error::CustomError,std::string("Exception in HareScript internal call: " ) + e.what(),"");
                group->GetCurrentVM()->PrepareStackTrace(&msg);
                group->GetCurrentVM()->GetErrorHandler().AddMessage(msg);
        }
        PM_PRINT("Finished running VM group " << group << " (vm: " << group->mainvm << ")");

        group->is_run_by_jobmgr = false;
        return retval;
}

std::pair< bool, bool > JobManager::GatherWaitFors(LockedJobData::WriteRef &lock, Blex::PipeWaiter *waiter, Blex::DateTime *timeout, std::vector< VMGroupRef > *vmgroups)
{
        *timeout = Blex::DateTime::Max();
        bool any_signalled = false;
        bool any_waiting = false;
        for (std::vector< VMGroupRef >::iterator it = lock->jobs.begin(); it != lock->jobs.end(); ++it)
        {
                // Record the running timeout for all scripts
                if (*timeout > it->group->jmdata.running_timeout)
                    *timeout = it->group->jmdata.running_timeout;

                if (it->group->jmdata.state != RunningState::WaitForMultiple)
                    continue;

                JobManagerGroupData &data = it->group->jmdata;
                if (it->group->TestMustYield())
                {
                        PM_PRINT("Group " << it->group << " must yield in GatherWaitFors: " << *it->group->GetAbortFlag());

                        it->group->jmdata.reqstate = RunningState::Runnable;
                        if (it->group->dbg_async.inform_next_suspend || it->group->dbg_async.reset_breakpoints)
                            debugger->OnScriptWaitEnded(lock, *it->group, true);

                        PM_PRINT("Abort flag now: " << *it->group->GetAbortFlag());

                        SetVMGroupState(lock, it->group, it->group->jmdata.reqstate);
                        any_signalled = true;
                        continue;
                }

                vmgroups->push_back(*it);

                bool this_signalled = false;
                for (std::vector< OutputObjectWait >::iterator it2 = data.waits.begin(); it2 != data.waits.end(); ++it2)
                {
                        if (it2->write ? it2->object->AddToWaiterWrite(*waiter) : it2->object->AddToWaiterRead(*waiter))
                        {
                                PM_PRINT("Marking VM group " << it->group << " runnable due to signalled (at adding) handle " << it2->handle);

                                HSVM_VariableId var_array = HSVM_RecordCreate(*data.waitingvm, data.id_set, it2->write ? data.waitingvm->cn_cache.col_write : data.waitingvm->cn_cache.col_read);
                                HSVM_IntegerSet(*data.waitingvm, HSVM_ArrayAppend(*data.waitingvm, var_array), it2->handle);
                                this_signalled = true;
                        }
                }

                if (data.wait_timeout < *timeout)
                    *timeout = data.wait_timeout;

                if (this_signalled)
                {
                        it->group->jmdata.reqstate = RunningState::Runnable;
                        if (it->group->dbg_async.inform_next_suspend || it->group->dbg_async.reset_breakpoints)
                            debugger->OnScriptWaitEnded(lock, *it->group, false);

                        SetVMGroupState(lock, it->group, it->group->jmdata.reqstate);
                        any_signalled = true;
                }
                else if (!data.waits.empty() || data.wait_timeout != Blex::DateTime::Max())
                    any_waiting = true;
        }
        return std::make_pair(any_signalled, any_waiting);
}

bool JobManager::CheckWaitFors(LockedJobData::WriteRef &lock, Blex::PipeWaiter *waiter, bool got_timeout)
{
        bool any_signalled = false;
        Blex::DateTime now = got_timeout ? lock->roughnow : Blex::DateTime::Min();
        for (std::vector< VMGroupRef >::iterator it = lock->jobs.begin(); it != lock->jobs.end(); ++it)
        {
                // Abort all scripts that have a running timeout
                if (got_timeout && it->group->jmdata.running_timeout < now)
                    AbortVMGroup(it->get(), HSVM_ABORT_TIMEOUT);

                if (it->group->jmdata.state != RunningState::WaitForMultiple)
                    continue;

                JobManagerGroupData &data = it->group->jmdata;
                if (got_timeout)
                {
                        if (data.wait_timeout <= now)
                        {
                                PM_PRINT("Marking VM group " << it->group << " runnable due to timeout " << data.wait_timeout);
                                SetVMGroupState(lock, it->group, RunningState::Runnable);
                                any_signalled = true;

                                HSVM_BooleanSet(*data.waitingvm, HSVM_RecordCreate(*data.waitingvm, data.id_set, data.waitingvm->cn_cache.col_timeout), true);
                        }
                }
                else
                {
                        bool this_signalled = false;
                        for (std::vector< OutputObjectWait >::iterator it2 = data.waits.begin(); it2 != data.waits.end(); ++it2)
                        {
                                if (it2->write ? it2->object->IsWriteSignalled(waiter) == OutputObject::Signalled : it2->object->IsReadSignalled(waiter) == OutputObject::Signalled)
                                {
                                        PM_PRINT("Marking VM group " << it->group << " runnable due to signalled handle " << it2->handle);

                                        HSVM_VariableId var_array = HSVM_RecordCreate(*data.waitingvm, data.id_set, it2->write ? data.waitingvm->cn_cache.col_write : data.waitingvm->cn_cache.col_read);
                                        HSVM_IntegerSet(*data.waitingvm, HSVM_ArrayAppend(*data.waitingvm, var_array), it2->handle);

                                        this_signalled = true;
                                }
                        }
                        if (this_signalled)
                        {
                                SetVMGroupState(lock, it->group, RunningState::Runnable);
                                any_signalled = true;
                        }
                }
        }
        return any_signalled;
}

void JobManager::WorkerThreadFunction(unsigned PM_ONLY(id))
{
        PM_PRINT("Started worker thread " << this << ":" << id);
        std::vector< VMGroupRef > wait_groups;
        Blex::PipeWaiter waiter;
        while (true)
        {
                VMGroup *group;
                bool other_must_pipewait;
                bool more_runnable = false;
                bool allow_lowpriority = false; // Allow running lowpriority jobs
                {
                        LockedJobData::WriteRef lock(jobdata);

                        // Is any group in wait mode?
                        bool any_waiting;

                        allow_lowpriority = lock->running_lowp < lock->max_running_lowp;

                        // Wait until a thread becomes runnable
                        bool abort = false;
                        while (true)
                        {
                                any_waiting = true; // Just assume a group is waiting
                                if (lock->abort)
                                {
                                        abort = lock->abort;
                                        break;
                                }
                                // Is noone pipe-waiting? If se, we must do it now.
                                bool my_pipewait = !lock->any_waiting_worker;
                                if (my_pipewait)
                                {
                                        PM_PRINT("Worker thread " << this << ":" << id << " going pipewait");
                                        wfm_event.SetSignalled(false);
                                        lock->any_waiting_worker = true;

                                        // Gather the objects we need to wait for in out pipewaiter
                                        Blex::DateTime timeout;
                                        std::pair< bool, bool > res = GatherWaitFors(lock, &waiter, &timeout, &wait_groups);
                                        if (!res.first)
                                        {
                                                // No one is signalled: go into wait if anyone is waiting, or none are runnable
                                                if (res.second || lock->runnable.empty())
                                                {
                                                        // If any is runnable, don't wait, just test for signals
                                                        if (!lock->runnable.empty())
                                                            timeout = Blex::DateTime::Min();

                                                        waiter.AddEvent(wfm_event);
                                                        bool signalled = waiter.ConditionMutexWait(lock, timeout);
                                                        PM_PRINT("Worker thread " << this << ":" << id << " out of pipewait, signalled: " << (signalled?"yes":"no") << ", now runnables: " << (lock->runnable.empty()?"no":"yes"));
                                                        lock->roughnow = Blex::DateTime::Now();

                                                        // Job the output of the waiter
                                                        CheckWaitFors(lock, &waiter, !signalled);

                                                        // Recalc allow_lowpriority after wait
                                                        allow_lowpriority = lock->running_lowp < lock->max_running_lowp;
                                                }
                                        }
                                        else
                                        {
                                                PM_PRINT("Worker thread " << this << ":" << id << " not pipewaiting, already signalled");
                                                any_waiting = res.second;
                                        }
                                        // Reset the waiter, we don't want it to have any lingering references outside the pipewaiter
                                        // wait_groups keeps references to waiting vms
                                        waiter.Reset();
                                        wait_groups.clear();
                                        lock->any_waiting_worker = false;
                                        if (!lock->runnable.empty() || (allow_lowpriority && !lock->runnable_lowp.empty()))
                                            break;
                                }
                                else
                                {
                                        if (!lock->runnable.empty() || (allow_lowpriority && !lock->runnable_lowp.empty()))
                                            break;

                                        PM_PRINT("Worker thread " << this << ":" << id << " in normal wait");
                                        lock.Wait();
                                        PM_PRINT("Worker thread " << this << ":" << id << " got signal");
                                        lock->roughnow = Blex::DateTime::Now();

                                        // Recalc allow_lowpriority after wait
                                        allow_lowpriority = lock->running_lowp < lock->max_running_lowp;
                                }
                                PM_PRINT("Jobs state");
                                for (std::vector< VMGroupRef >::iterator it = lock->jobs.begin(); it != lock->jobs.end(); ++it)
                                {
                                        PM_PRINT(" " << it->group->jmdata.groupid << " " << it->group << " " << it->group->jmdata.state);
                                }
                        }
                        if (abort)
                            break;

                        // Invariant: !lock->runnable.empty() || (allow_lowpriority && !lock->runnable_lowp.empty())
                        // Make the first job running
                        if (!lock->runnable.empty())
                            group = *lock->runnable.begin();
                        else
                            group = *lock->runnable_lowp.begin();

                        group->jmdata.reqstate = RunningState::Running;
                        group->jmdata.current_run_start = lock->roughnow;
                        SetVMGroupState(lock, group, RunningState::Running);

                        // See if more jobs are currently runnable and eligable for running
                        allow_lowpriority = lock->running_lowp < lock->max_running_lowp;
                        more_runnable = !lock->runnable.empty() || (allow_lowpriority && !lock->runnable_lowp.empty());

                        // Record wether another worker thread must go pipewaiting,
                        other_must_pipewait = !lock->any_waiting_worker && any_waiting;
                }
                if (other_must_pipewait || more_runnable)
                {
                        // If a pipewaiter is needed or more groups are runnable, signal another worker.
                        jobdata.SignalOne();
                }

                if (!group->mainvm)
                {
                        Blex::SafeErrorPrint("Running a vmgroup without vm!\n");
                        Blex::FatalAbort();
                }

                PM_PRINT("Worker thread " << this << ":" << id << " running group " << group << " (" << group->jmdata.groupid << ")");
                bool has_terminated_forcefully = !DoRun(group);
                bool has_terminated_normally = false;

                UnlockCallbacks callbacks;
                RunningState::Type callback_state = RunningState::Terminated;

                if (!has_terminated_forcefully)
                {
                        // If DoRun returned normally with in Running state, it terminated normally
                        LockedJobData::WriteRef lock(jobdata);
                        has_terminated_normally = group->jmdata.reqstate == RunningState::Running;

                        if (group->dbg_async.inform_next_suspend)
                            debugger->OnScriptReturnToJobMgr(lock, *group, has_terminated_forcefully);

                        if (!has_terminated_normally)
                        {
                                // Running state was 'Suspending'. Switch to the requested state
                                callback_state = group->jmdata.reqstate;
                                std::swap(callbacks, group->jmdata.unlock_callbacks);
                                SetVMGroupState(lock, group, group->jmdata.reqstate);

                                lock->roughnow = Blex::DateTime::Now();
                                group->jmdata.total_running += lock->roughnow - group->jmdata.current_run_start;
                                group->jmdata.current_run_start = Blex::DateTime::Min();
                        }
                }
                CallUnlockCallbacks(&callbacks, callback_state);

                // Has the script terminated
                if (has_terminated_forcefully || has_terminated_normally)
                {
                        // Make sure the group exists during execution of the termination function
                        VMGroupRef ref(group, true);

                        TerminationCallback pretermination_callback;
                        {
                                LockedJobData::WriteRef lock(jobdata);
                                pretermination_callback = group->jmdata.pretermination_callback;
                                group->jmdata.pretermination_callback = 0;

                                lock->roughnow = Blex::DateTime::Now();
                                group->jmdata.total_running += lock->roughnow - group->jmdata.current_run_start;
                                group->jmdata.current_run_start = Blex::DateTime::Min();

                                // Record group data into list of finished groups
                                FinishedVMGroupInfo data;
                                data.finishdate = lock->roughnow;
                                GetGroupInfoUnlocked(*group, &data.info);
                                group->mainvm->GetVMStats(&data.stats);
                                data.errorhandler = group->errorhandler;
                                std::unique_ptr< MarshalPacket > authrec_copy;
                                {
                                        VirtualMachine::LockedProtectedData::ReadRef lock(group->mainvm->protected_data);
                                        if (lock->authenticationrecord.get())
                                            lock->authenticationrecord->TryClone(&authrec_copy);
                                }
                                data.authenticationrecord.reset(authrec_copy.release());

                                lock->finished.push_back(data);

                                while (lock->roughnow - lock->finished.front().finishdate > lock->keep_finish_history)
                                {
                                        lock->finished.pop_front();
                                        if (lock->finished.empty())
                                            break;
                                }
                        }
                        if (pretermination_callback)
                            pretermination_callback();

                        // Job is terminated, close its handles right away (don't wait for destruction)
                        group->CloseHandles();

                        bool signal_finish;
                        TerminationCallbacks termination_callbacks;
                        {
                                LockedJobData::WriteRef lock(jobdata);

                                group->jmdata.reqstate = RunningState::Terminated;
                                debugger->OnScriptTerminated(lock, *group);

                                std::swap(termination_callbacks, group->jmdata.termination_callbacks);
                                std::swap(callbacks, group->jmdata.unlock_callbacks);
                                SetVMGroupState(lock, group, group->jmdata.reqstate);
                                signal_finish = group->jmdata.reqstate == RunningState::Terminated;
                        }

                        CallUnlockCallbacks(&callbacks, RunningState::Terminated);

                        // Call the termination functions (outside the lock)
                        for (TerminationCallbacks::iterator it = termination_callbacks.begin(), end = termination_callbacks.end(); it != end; ++it)
                        {
                                if (it->second)
                                    it->second();
                        }

                        if (signal_finish)
                        {
                                PM_PRINT("Signalling vmgroup finish_event");
                                group->finishevent.SetSignalled(true);
                        }
                }
        }
        PM_PRINT("Stopped worker thread " << this << ":" << id);
}

void JobManager::StartVMGroup(VMGroup *group)
{
        UnlockCallbacks callbacks;
        RunningState::Type newstate;
        {
                LockedJobData::WriteRef lock(jobdata);

                if (group->jmdata.state != RunningState::Startup)
                    throw VMRuntimeError(Error::InternalError, "Can only start a vmgroup once");

                if (!group->mainvm)
                    throw VMRuntimeError(Error::InternalError, "VMGroup has no vm yet");

                VMGroupRef groupref(group, true);
                lock->jobs.push_back(groupref);

                group->jmdata.reqstate = RunningState::InitialRunnable;
                debugger->OnScriptStarted(lock, groupref);

                newstate = group->jmdata.reqstate;
                std::swap(callbacks, group->jmdata.unlock_callbacks);
                SetVMGroupState(lock, group, newstate);
        }
        CallUnlockCallbacks(&callbacks, newstate);

        // Signal a worker thread to start executing
        PM_PRINT("Started new VM group, signalling a worker");
        jobdata.SignalOne();
}

int32_t JobManager::AddTerminationCallback(VMGroup *group, TerminationCallback const &async_termination_callback)
{
        LockedJobData::WriteRef lock(jobdata);
        int32_t id = 1;
        if (!group->jmdata.termination_callbacks.empty())
        {
                TerminationCallbacks::iterator it = group->jmdata.termination_callbacks.end();
                --it;
                id = it->first + 1;
        }

        PM_PRINT("Added termination callback for group " << group << ", id is " << id);

        group->jmdata.termination_callbacks.insert(std::make_pair(id, async_termination_callback));
        return id;
}

void JobManager::RemoveTerminationCallback(VMGroup *group, int32_t id)
{
        PM_PRINT("Removing termination callback for group " << group << ", id is " << id);

        LockedJobData::WriteRef lock(jobdata);
        group->jmdata.termination_callbacks.erase(id);
}

void JobManager::SetPreterminationCallback(VMGroup *group, TerminationCallback const &preterm)
{
        PM_PRINT("Setting pretermination callback for group " << group);

        LockedJobData::WriteRef lock(jobdata);
        group->jmdata.pretermination_callback = preterm;

}

bool JobManager::IsFinished(VMGroup *group)
{
        PM_PRINT("Querying if group " << group << " is finished");
        LockedJobData::WriteRef lock(jobdata);
        return group->jmdata.state == RunningState::Terminated ||
            group->jmdata.oldstate == RunningState::Terminated;
}

void JobManager::WaitFinished(VMGroup *group)
{
        PM_PRINT("Waiting for group " << group << " to finish");

        Blex::Event &event = group->GetFinishEvent();

        Blex::PipeWaiter waiter;
        waiter.AddEvent(event);

        while (!event.IsSignalled())
            waiter.Wait(Blex::DateTime::Max());

        PM_PRINT("VM group " << group << " (vm: " << group->mainvm << ") has terminated");
}

VMGroup * JobManager::CreateVMGroup(bool highpriority)
{
        VMGroupRef ref(env.ConstructVMGroup(highpriority), true);
        ++ref.group->refcount; // No lock needed just after creation
        GR_PRINT("^ref add " << this << " " << ref.group << ":" << ref.group->refcount - 1 << " -> " << ref.group->refcount);
        ref.group->jobmanager = this;

        std::string newgroupid = Blex::GenerateUFS128BitId();

        LockedJobData::WriteRef lock(jobdata);
        ref.group->jmdata.groupid = newgroupid;
        return ref.group;
}

std::pair< VMGroup *, int32_t > JobManager::CreateVMGroupInVM(HSVM *_vm)
{
        VirtualMachine *vm = GetVirtualMachine(_vm);

        // Inherit priority & external session data
        bool highpriority;
        std::string externalsessiondata;
        {
                LockedJobData::WriteRef lock(jobdata);
                highpriority = vm->GetVMGroup()->jmdata.highpriority;
                externalsessiondata = vm->GetVMGroup()->jmdata.externalsessiondata;
        }

        VMGroup *group = CreateVMGroup(highpriority);
        {
                LockedJobData::WriteRef lock(jobdata);
                group->jmdata.externalsessiondata = externalsessiondata;
        }

        JobManagerContext context(vm->GetContextKeeper());

        std::shared_ptr< Job > job;
        job.reset(new Job(vm, group));
        CreateIPCLink(&job->childipclink, &group->parentipclink);

        context->jobs.insert(std::make_pair(job->GetId(), job));

        return std::make_pair(group, job->GetId());
}

void JobManager::EraseJobById(HSVM *vm, int32_t id)
{
        JobManagerContext context(GetVirtualMachine(vm)->GetContextKeeper());

        context->jobs.erase(id);
}

void JobManager::AbortVMGroup(VMGroup *group, unsigned reason)
{
        volatile unsigned *flag = group->GetAbortFlag();
        if (!flag)
        {
                group->SetAbortFlag(0); // Sets the default flag
                flag = group->GetAbortFlag();
        }
        if (flag)
            *flag = reason;

        jobdata.SignalAll();
}

bool JobManager::TryCancel(VMGroup *group)
{
        {
                LockedJobData::WriteRef lock(jobdata);
                if (!group->jmdata.iscancellable)
                    return false;

                group->jmdata.iscancelled = true;
        }
        AbortVMGroup(group, HSVM_ABORT_SILENTTERMINATE);
        return true;
}

void JobManager::ReleaseVMGroup(VMGroup *group)
{
        VMGroup *delete_group(0);
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                if (--group->refcount == 0)
                    delete_group = group;
                GR_PRINT("^ref del " << this << " " << group << ":" << group->refcount);
        }
        if (delete_group)
            delete delete_group;
}

void JobManager::SetVMGroupState(LockedJobData::WriteRef &lock, VMGroup *group, RunningState::Type newstate)
{
        if (group->jmdata.state == newstate)
            return;

        PM_PRINT("Going to set state of group " << group << " (vm " << group->mainvm << ") from " << group->jmdata.state << " to " << newstate << " (req: " << group->jmdata.reqstate << ")");

        if (group->jmdata.state == RunningState::Runnable || group->jmdata.state == RunningState::InitialRunnable)
        {
                // Remove the group from the runnable queue if needed
                if (newstate != RunningState::Runnable && newstate != RunningState::InitialRunnable)
                {
                        std::vector< VMGroup * > *queue = group->jmdata.highpriority ? &lock->runnable : &lock->runnable_lowp;

                        PM_PRINT("Remove group " << group << " from runnable queue");

                        for (std::vector< VMGroup * >::iterator it = queue->begin(); it != queue->end(); ++it)
                            if (*it == group)
                            {
                                    queue->erase(it);
                                    break;
                            }
                }
        }
        else if (newstate == RunningState::Runnable || newstate == RunningState::InitialRunnable)
        {
                // Add the group to the end of the runnable queue (removes are from the front, thus LIFO ordering)
                std::vector< VMGroup * > *queue = group->jmdata.highpriority ? &lock->runnable : &lock->runnable_lowp;
                queue->push_back(group);

                PM_PRINT("Add group " << group << " to runnable queue");
        }

        if (!group->jmdata.highpriority)
        {
                if (newstate == RunningState::Running)
                    ++lock->running_lowp;
                else if (group->jmdata.state == RunningState::Running)
                    --lock->running_lowp;
        }

        PM_PRINT("Set state of group " << group << " (vm " << group->mainvm << ") from " << group->jmdata.state << " to " << newstate << " (req: " << group->jmdata.reqstate << ")");
        group->jmdata.state = newstate;

        if (newstate == RunningState::Terminated)
        {
                for (std::vector< VMGroupRef >::iterator it = lock->jobs.begin(); it != lock->jobs.end(); ++it)
                    if (it->group == group)
                    {
                            // May delete VM group!
                            lock->jobs.erase(it);
                            break;
                    }
        }
        else if (newstate == RunningState::WaitForMultiple)
        {
                // If reentering WFM state, a new wait loop must be entered (the current script is probably not waited on)
                wfm_event.SetSignalled(true);
        }
}

bool JobManager::TryLockVMGroup(VMGroup *group, UnlockCallback const &callback)
{
        LockedJobData::WriteRef lock(jobdata);
        return LockedTryLockVMGroup(lock, group, callback);
}

bool JobManager::LockedTryLockVMGroup(LockedJobData::WriteRef &lock, VMGroup *group, UnlockCallback const &callback)
{
        PM_PRINT("Trying to locking vmgroup " << group);
        if (group->jmdata.state != RunningState::Running
                && group->jmdata.state != RunningState::Suspending
                && group->jmdata.state != RunningState::Locked
                )
        {
                // Group is lockable!
                group->jmdata.oldstate = group->jmdata.state;
                SetVMGroupState(lock, group, RunningState::Locked);

                PM_PRINT("Locked vmgroup " << group);
                return true;
        }

        // Group is not lockable
        PM_PRINT("Vmgroup " << group << " cannot be locked");
        if (callback)
            group->jmdata.unlock_callbacks.push_back(callback);
        return false;
}

void JobManager::UnlockVMGroup(VMGroup *group)
{
        PM_PRINT("Unlocking vmgroup " << group);
        UnlockCallbacks unlock_callbacks;
        RunningState::Type newstate;
        {
                LockedJobData::WriteRef lock(jobdata);
                LockedUnlockVMGroup(lock, group, &unlock_callbacks, &newstate);
        }
        CallUnlockCallbacks(&unlock_callbacks, newstate);
}

void JobManager::LockedUnlockVMGroup(LockedJobData::WriteRef &lock, VMGroup *group, UnlockCallbacks *unlock_callbacks, RunningState::Type *newstate)
{
        *newstate = group->jmdata.oldstate;

        if (*newstate == RunningState::Locked)
            throw std::runtime_error("Cannot unlock an unlocked vm group");

        std::swap(*unlock_callbacks, group->jmdata.unlock_callbacks);

        SetVMGroupState(lock, group, *newstate);
        group->jmdata.oldstate = RunningState::Locked;
}

bool JobManager::GetCancellable(VMGroup const *group) const
{
        LockedJobData::ReadRef lock(jobdata);
        return group->jmdata.iscancellable;
}

std::string JobManager::GetGroupId(VMGroup const *group) const
{
        LockedJobData::ReadRef lock(jobdata);
        return group->jmdata.groupid;
}

std::string JobManager::GetGroupExternalSessionData(VMGroup const *group) const
{
        LockedJobData::ReadRef lock(jobdata);
        return group->jmdata.externalsessiondata;
}

std::shared_ptr< const Blex::Process::Environment > JobManager::GetGroupEnvironmentOverride(VMGroup const *group) const
{
        LockedJobData::ReadRef lock(jobdata);
        return group->jmdata.environment;
}

void JobManager::SetRunningStatus(VMGroup *group, bool isrunning)
{
        LockedJobData::WriteRef lock(jobdata);
        group->jmdata.is_running_for_timeout = isrunning;
        group->jmdata.running_timeout = group->jmdata.run_timeout_seconds != 0 && group->jmdata.is_running_for_timeout
            ? Blex::DateTime::Now() + Blex::DateTime::Seconds(group->jmdata.run_timeout_seconds)
            : Blex::DateTime::Max();
}

void JobManager::SetRunningTimeout(VMGroup *group, unsigned secs)
{
        LockedJobData::WriteRef lock(jobdata);
        group->jmdata.run_timeout_seconds = secs;
        group->jmdata.running_timeout = group->jmdata.run_timeout_seconds != 0 && group->jmdata.is_running_for_timeout
            ? Blex::DateTime::Now() + Blex::DateTime::Seconds(group->jmdata.run_timeout_seconds)
            : Blex::DateTime::Max();
}

bool JobManager::SetCancellable(VMGroup *group, bool newcancellable)
{
        PM_PRINT("Set cancellable of vmgroup " << group << " to " << (newcancellable ? "yes" : "no"));

        bool throw_error = false;

        {
                LockedJobData::WriteRef lock(jobdata);
                throw_error = group->jmdata.iscancelled && !newcancellable;
                if (!throw_error)
                    group->jmdata.iscancellable = newcancellable;
        }

        return !throw_error;
}

void JobManager::SetGroupPriority(VMGroup *group, bool highpriority)
{
        PM_PRINT("Set priority of vmgroup " << group << " to " << (highpriority ? "high" : "normal"));

        LockedJobData::WriteRef lock(jobdata);
        group->jmdata.highpriority = highpriority;
}

void JobManager::SetSimpleErrorStatus(VirtualMachine *vm, VarId id_set, const char *status)
{
        PM_PRINT("*Set error status " << status << " in " << vm->GetVMGroup() << " (vm: " << vm << ", state: " << vm->GetVMGroup()->jmdata.state << ")");

        StackMachine &stackm = vm->GetStackMachine();
        JobManagerContext jmcontext(vm->GetContextKeeper());
        jmcontext->CheckColumnMappings(vm);

        stackm.InitVariable(id_set, VariableTypes::Record);
//        ColumnNameId col_status = vm->columnnamemapper.GetMapping("STATUS");
        VarId var_status = stackm.RecordCellCreate(id_set, jmcontext->col_status);
        stackm.SetString(var_status, Blex::StringPair::FromStringConstant(status));
}

void JobManager::SetOkStatus(VirtualMachine *vm, VarId id_set, uint64_t msgid)
{
        PM_PRINT("*Set ok status in " << vm->GetVMGroup() << " (vm: " << vm << ", state: " << vm->GetVMGroup()->jmdata.state << ")");

        SetSimpleErrorStatus(vm, id_set, "OK");

        StackMachine &stackm = vm->GetStackMachine();
        JobManagerContext jmcontext(vm->GetContextKeeper());
        jmcontext->CheckColumnMappings(vm);
//        ColumnNameId col_msgid = vm->columnnamemapper.GetMapping("MSGID");
        VarId var_msgid = stackm.RecordCellCreate(id_set, jmcontext->col_msgid);
        stackm.SetInteger64(var_msgid, msgid);
}

void JobManager::SetOkStatus2(VirtualMachine *vm, VarId id_set, uint64_t msgid)
{
        PM_PRINT("*Set ok status in " << vm->GetVMGroup() << " (vm: " << vm << ", state: " << vm->GetVMGroup()->jmdata.state << ")");

        SetSimpleErrorStatus(vm, id_set, "ok");

        StackMachine &stackm = vm->GetStackMachine();
        JobManagerContext jmcontext(vm->GetContextKeeper());
        jmcontext->CheckColumnMappings(vm);
//        ColumnNameId col_msgid = vm->columnnamemapper.GetMapping("MSGID");
        VarId var_msgid = stackm.RecordCellCreate(id_set, jmcontext->col_msgid);
        stackm.SetInteger64(var_msgid, msgid);
}

std::shared_ptr< IPCNamedPort > JobManager::CreateNamedPort(std::string const &name)
{
        // Declare result var BEFORE lock, so destroy won't take the lock too (and deadlock)
        std::shared_ptr< IPCNamedPort > result;

        result.reset(new IPCNamedPort(*this));

        JobManager::LockedJobData::WriteRef lock(jobdata);
        if (!name.empty() && !lock->namedports.insert(std::make_pair(name, result.get())).second)
        {
                PO_PRINT("Could not create named IPC port '" << name << "': name already registered");
                return std::shared_ptr< IPCNamedPort >();
        }
        else
            result->name = name;

        PO_PRINT("Created named IPC port '" << name << "': " << result.get());

        return result;
}

std::shared_ptr< IPCLinkEndPoint > JobManager::ConnectToNamedPort(std::string const &name)
{
        // Declare the smart ptr outside of the lock, destroy takes the lock too
        std::shared_ptr< IPCLinkEndPoint > result;
        std::shared_ptr< IPCLinkEndPoint > other;

        CreateIPCLink(&result, &other);

        JobManager::LockedJobData::WriteRef lock(jobdata);

        std::map< std::string, IPCNamedPort * >::iterator it = lock->namedports.find(name);
        if (it != lock->namedports.end())
        {
                PO_PRINT("Connecting to port " << it->second << " ('" << name << "')");
                if (it->second->backlog.empty())
                {
                        PO_PRINT("Signalling event " << &it->second->event << " of port " << it->second << ", it is the first connection in the backlog");
                        it->second->event.SetSignalled(true);
                }

                it->second->backlog.push_back(other);

                PO_PRINT("Result link endpoint: " << result.get() << ", pushed into backlog: " << other.get());
                return result;
        }
        else
        {
                PO_PRINT("Cannot connect to named port '" << name << "', it is not registered");
        }

        return std::shared_ptr< IPCLinkEndPoint >();
}

void JobManager::CreateIPCLink(std::shared_ptr< IPCLinkEndPoint > *endpoint_1, std::shared_ptr< IPCLinkEndPoint > *endpoint_2)
{
        std::shared_ptr< IPCLinkData > link;
        link.reset(new IPCLinkData);

        IPCLinkData::LockedData::WriteRef lock(link->data);
        lock->refcount = 2;

        endpoint_1->reset(new IPCLinkEndPoint(*this, link, false));
        endpoint_2->reset(new IPCLinkEndPoint(*this, link, true));

        lock->endpoints[false] = endpoint_1->get();
        lock->endpoints[true] = endpoint_2->get();
}

void JobManager::WaitForMultiple(VirtualMachine *vm, VarId id_set, std::vector< OutputObjectWait > const &waits, Blex::DateTime timeout)
{
        PM_PRINT("Suspending for WaitForMultiple, until " << Blex::AnyToString(timeout));
        LockedJobData::WriteRef lock(jobdata);

        VMGroup *group = vm->GetVMGroup();
        JobManagerGroupData &data = group->jmdata;

        data.id_set = id_set;
        data.waitingvm = vm;
        data.waits = waits;
        data.wait_timeout = timeout;

        data.reqstate = RunningState::WaitForMultiple;
        SetVMGroupState(lock, group, RunningState::Suspending);
        vm->Suspend();
/*
        std::vector< StackTraceElement > elements;
        vm->GetStackTrace(&elements);
        for (std::vector< StackTraceElement >::iterator it = elements.begin(); it != elements.end(); ++it)
            PM_PRINT(it->file << ":" << it->position.line << ":" << it->position.column);
*/
}

void JobManager::YieldVMWithoutSuspend(VirtualMachine *vm)
{
        LockedJobData::WriteRef lock(jobdata);

        VMGroup *group = vm->GetVMGroup();
        JobManagerGroupData &data = group->jmdata;

        data.reqstate = RunningState::Runnable;
        SetVMGroupState(lock, group, RunningState::Suspending);
}

void JobManager::CallUnlockCallbacks(UnlockCallbacks *callbacks, RunningState::Type state)
{
        if (!callbacks->empty())
        {
                for (UnlockCallbacks::const_iterator it = callbacks->begin(); it != callbacks->end(); ++it)
                    (*it)(state);
                callbacks->clear();
        }
}

HSVM * JobManager::GetJobFromId(HSVM *vm, int id)
{
        JobManagerContext context(GetVirtualMachine(vm)->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(id);
        if (it == context->jobs.end())
            return 0;

        return *it->second->GetVMGroup()->mainvm;
}

VirtualMachine * JobManager::GetGroupMainVM(VMGroup &group)
{
        return group.mainvm;
}

void JobManager::GetGroupInfo(VMGroup const &group, VMGroupInfo *info)
{
        LockedJobData::ReadRef lock(jobdata);
        GetGroupInfoUnlocked(group, info);
}

void JobManager::GetGroupInfoUnlocked(VMGroup const &group, VMGroupInfo *info)
{
        info->creationdate = group.jmdata.creationdate;
        info->groupid = group.jmdata.groupid;
        info->mainscript = group.mainscript;
        info->state = group.jmdata.state;
        info->highpriority = group.jmdata.highpriority;
        info->running_timeout = group.jmdata.running_timeout;
        info->total_running = group.jmdata.total_running;
        info->current_run_start = group.jmdata.current_run_start;
        info->externalsessiondata = group.jmdata.externalsessiondata;
}

/// Overwrite group id
void JobManager::SetGroupId(VMGroup &group, std::string const &newgroupid)
{
        LockedJobData::ReadRef lock(jobdata);
        group.jmdata.groupid = newgroupid;
}

void JobManager::SetGroupExternalSessionData(VMGroup &group, std::string const &sessiondata)
{
        LockedJobData::ReadRef lock(jobdata);
        group.jmdata.externalsessiondata = sessiondata;
}

void JobManager::SetGroupEnvironmentOverride(VMGroup &group, std::shared_ptr< const Blex::Process::Environment > env)
{
        LockedJobData::ReadRef lock(jobdata);
        group.jmdata.environment = env;
}

bool JobManager::WillReachState(LockedJobData::WriteRef &, VMGroup *group, RunningState::Type state)
{
        return group->jmdata.state == state
            || (group->jmdata.state == RunningState::Locked && group->jmdata.oldstate == state)
            || (group->jmdata.state == RunningState::Suspending && group->jmdata.reqstate == state);
}

void JobManager::AllocateMessage(std::shared_ptr< IPCMessage2 > *msg)
{
        // Try to get from cache first
        {
                LockedCache::WriteRef lock(cache);

                if (!lock->messages.empty())
                {
                        *msg = lock->messages.back();
                        (*msg)->msgid = 0;
                        lock->messages.pop_back();
                        return;
                }
        }

        // Not from cache: allocate new
        msg->reset(new IPCMessage2);
}

void JobManager::DiscardMessage(std::shared_ptr< IPCMessage2 > *msg)
{
        // Reset the message
        (*msg)->Reset();

        {
                // Add to cache only if less than 64 msgs are in the cache.
                LockedCache::WriteRef lock(cache);

                if (lock->messages.size() < 64)
                {
                        lock->messages.push_back(std::shared_ptr< IPCMessage2 >());
                        lock->messages.back().swap(*msg);
                }
        }
        msg->reset();
}

void JobManager::GetStatus(std::vector< VMGroupRef > *groups, std::vector< FinishedVMGroupInfo > *finished, uint32_t *keep_finish_history)
{
        // Clear the references already present
        groups->clear();

        LockedJobData::ReadRef lock(jobdata);
        *groups = lock->jobs;
        finished->assign(lock->finished.begin(), lock->finished.end());
        *keep_finish_history = lock->keep_finish_history.GetMsecs();
}

bool JobManager::GetFinishedVMInfo(std::string const &groupid, FinishedVMGroupInfo *dest)
{
        LockedJobData::ReadRef lock(jobdata);
        for (std::list< FinishedVMGroupInfo >::const_iterator it = lock->finished.begin(); it != lock->finished.end(); ++it)
            if (it->info.groupid == groupid)
            {
                    *dest = *it;
                    return true;
            }
        return false;
}

void JobManager::SetDebugLink(std::shared_ptr< IPCLinkEndPoint > const &debuglink, std::string const &hosttype, uint64_t processcode, std::string const &clientname)
{
        DEBUGPRINT("JobManager::SetDebugLink " << hosttype << " " << processcode << " " << clientname);
        //(void)debuglink;
        //LockedJobData::WriteRef(jobdata)->hosttype = hosttype;
        (void)hosttype; // FIXME: is this in use?
        debugger->SetDebugLink(debuglink, processcode, clientname);
}

void JobManager::WaitForDebugConfiguration()
{
        Blex::DateTime until = Blex::DateTime::Now() + Blex::DateTime::Seconds(3);
        debugger->WaitForConfiguration(until);
}

void JobManager::SetKeepFinishHistory(uint32_t keep_finish_history)
{
        LockedJobData::WriteRef lock(jobdata);
        lock->keep_finish_history = Blex::DateTime::Msecs(keep_finish_history);
}

VMGroupRef JobManager::GetGroupRefByGroupId(std::string const &groupid)
{
        LockedJobData::WriteRef lock(jobdata);

        for (std::vector< VMGroupRef >::iterator it = lock->jobs.begin(), end = lock->jobs.end(); it != end; ++it)
            if ((*it)->jmdata.groupid == groupid)
                return *it;

        return VMGroupRef();
}

std::string JobManager::GetGroupErrorContextInfo(VMGroup *group)
{
        VirtualMachine *target = GetGroupMainVM(*group);

        std::unique_ptr< MarshalPacket > copy;
        {
                VirtualMachine::LockedProtectedData::WriteRef lock(target->protected_data);

                if (lock->authenticationrecord.get())
                    lock->authenticationrecord->TryClone(&copy);
        }

        if (!copy.get())
            return "";

        ColumnNames::LocalMapper mapper(env.GetColumnNameMapper());
        StackMachine stackm(mapper);
        Marshaller authrec_marshaller(stackm, MarshalMode::SimpleOnly); // converts blobs and objects to default
        VarId rec = stackm.NewHeapVariable();
        authrec_marshaller.ReadMarshalPacket(rec, &copy);
        ColumnNameId col_contextinfo = mapper.GetMapping("CONTEXTINFO");
        VarId var_contextinfo = stackm.RecordCellGetByName(rec, col_contextinfo);
        if (!var_contextinfo)
            return "";
        if (stackm.GetType(var_contextinfo) != VariableTypes::String)
            return "";
        return stackm.GetSTLString(var_contextinfo);
}

void JobManager::HandleAsyncAbortBySignal()
{
        jobdata.SignalAll();
}


GlobalBlobManager & JobManager::GetBlobManager()
{
        return env.GetBlobManager();
}

// -----------------------------------------------------------------------------
//
// IPCMessage2
//

IPCMessage2::~IPCMessage2()
{
}

void IPCMessage2::Reset()
{
        msgid = 0;
        replyto = 0;
        data.reset();
}

// -----------------------------------------------------------------------------
//
// IPCNamedPort
//

IPCNamedPort::IPCNamedPort(JobManager &_jobmgr)
: OutputObject(0)
, jobmgr(_jobmgr)
{
}

IPCNamedPort::~IPCNamedPort()
{
        PO_PRINT("Destroying named port " << this << " (name: " << name << ")");

        BackLog backlog_erase;

        {
                JobManager::LockedJobData::WriteRef lock(jobmgr.jobdata);
                if (!name.empty())
                    lock->namedports.erase(name);

                backlog_erase.swap(backlog);
        }
}

bool IPCNamedPort::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        PM_PRINT("Adding named port " << this << " (name: " << name << ") to waiter (vm: " << vm << ") signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        if (event.IsSignalled())
            return true;

        waiter.AddEvent(event);
        return false;
}

OutputObject::SignalledStatus IPCNamedPort::IsReadSignalled(Blex::PipeWaiter * /*waiter*/)
{
        PM_PRINT("Named port " << this << " (name: " << name << ") checking signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        return event.IsSignalled() ? Signalled : NotSignalled;
}

void IPCNamedPort::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        waiter.RemoveEvent(event);
        PM_PRINT("Removed name port " << this << " (name: " << name << ") from waiter (vm: " << vm << ") event: " << &event);
}

std::shared_ptr< IPCLinkEndPoint > IPCNamedPort::Accept()
{
        /// Endpoint from backlog. Keep the destruction out of the lock
        std::shared_ptr< IPCLinkEndPoint > endpoint;

        while (true)
        {
                // Get the first link from the backlog
                {
                        JobManager::LockedJobData::WriteRef lock(jobmgr.jobdata);
                        if (backlog.empty())
                        {
                                PO_PRINT("Port " << this << ": connection backlog is empty");
                                return endpoint;
                        }

                        endpoint = backlog.front();

                        PO_PRINT("Port " << this << ": accepting connection " << endpoint.get());

                        backlog.pop_front();
                        if (backlog.empty())
                            event.SetSignalled(false);
                }

                // If invalid: skip it (deletion is automagically, not registered as outputobj anyway)
                if (endpoint->IsBroken())
                {
                        // Keep destruction out of the lock
                        PO_PRINT("Port " << this << ": connection " << endpoint.get() << " has errors, dropping it");
                        endpoint.reset();
                        continue;
                }

                return endpoint;
        }
}


std::shared_ptr< IPCLinkEndPoint > IPCNamedPort::Connect()
{
        std::shared_ptr< IPCLinkEndPoint > result;
        std::shared_ptr< IPCLinkEndPoint > other;

        jobmgr.CreateIPCLink(&result, &other);

        JobManager::LockedJobData::WriteRef lock(jobmgr.jobdata);

        if (backlog.empty())
            event.SetSignalled(true);

        backlog.push_back(other);
        return result;
}

// -----------------------------------------------------------------------------
//
// IPCLinkData
//

IPCLinkData::IPCLinkData()
: event_false(*this, false)
, event_true(*this, true)
{
}

// -----------------------------------------------------------------------------
//
// IPCLinkData :: IPCLinkEvent
//

IPCLinkData::IPCLinkEvent::IPCLinkEvent(IPCLinkData &_link, bool _endpoint_side)
: link(_link)
, endpoint_side(_endpoint_side)
{
}

bool IPCLinkData::IPCLinkEvent::IsSignalled()
{
        bool is_signalled;
        POE_ONLY(IPCLinkEndPoint *ep;)
        {
                IPCLinkData::LockedData::WriteRef lock(link.data);

                is_signalled = lock->refcount != 2 || !lock->queues[endpoint_side].empty();
                POE_ONLY(ep = lock->endpoints[endpoint_side];)
        }
        POE_PRINT("Checking signalled for endpoint " << ep << ": " << is_signalled);

        return is_signalled;
}


// -----------------------------------------------------------------------------
//
// IPCLinkEndPoint
//

IPCLinkEndPoint::IPCLinkEndPoint(JobManager &_jobmgr, std::shared_ptr< IPCLinkData > const &_link, bool _endpoint_side)
: OutputObject(0)
, jobmgr(_jobmgr)
, link(_link)
, endpoint_side(_endpoint_side)
{
        POE_PRINT("Create endpoint " << this << ", event: " << &GetEvent());
}

IPCLinkEndPoint::~IPCLinkEndPoint()
{
        PO_PRINT("Destroying endpoint " << this);
        POE_ONLY(IPCLinkEndPoint *ep;);

        bool signal_other;
        {
                IPCLinkData::LockedData::WriteRef lock(link->data);

                signal_other = lock->refcount == 2 && lock->queues[!endpoint_side].empty();
                --lock->refcount;

                // Remove self from endpoint list
                lock->endpoints[endpoint_side] = 0;

                POE_ONLY(ep = lock->endpoints[!endpoint_side];)
        }

        // Set the other end to signalled if its queue was empty
        if (signal_other)
        {
                POE_ONLY(bool is_signalled = link->GetEvent(!endpoint_side).IsSignalled());
                link->GetEvent(!endpoint_side).StateChanged();
                POE_PRINT("Link endpoint closed, signalling endpoint " << ep << " to " << is_signalled);
        }
}


bool IPCLinkEndPoint::IsBroken()
{
        IPCLinkData::LockedData::WriteRef lock(link->data);

        // Link is broken when an endpoint is gone and no messages left in queue
        // FIXME: should we check the queue for expired messaged?
        return lock->refcount != 2 && lock->queues[endpoint_side].empty();
}

bool IPCLinkEndPoint::ReceiveMessage(std::shared_ptr< IPCMessage2 > *msg)
{
        // Reset the message ptr, so we won't return a valid msg when none was in queue.
        msg->reset();

        bool signal_change = false; ///< Whether the event changed state, and a StateChanged call is needed.
        bool got_message = false; ///< Whether we found a valid message
        bool have_other; ///< Whether the other link is still present

        POE_ONLY(unsigned pre_in_queue;)
        POE_ONLY(int nowqueue = 0;)

        // Signalling is done out of link lock, so the link lock must be contained in own scope.
        {
                IPCLinkData::LockedData::WriteRef lock(link->data);
                IPCLinkData::MessageQueue &queue = lock->queues[endpoint_side];

                PO_PRINT("Receiving message at endpoint " << this << " from " << lock->endpoints[!endpoint_side]);
                POE_ONLY(pre_in_queue = queue.size();)

                // Check if the other link is still present
                have_other = lock->refcount == 2;

                if (!queue.empty())
                {
                        // Pop the first message in the queue
                        msg->swap(queue.front());
                        queue.pop_front();

                        POE_PRINT("POP MSG ON " << this << " (queue: " << &queue << ")");
                        POE_ONLY(nowqueue = queue.size();)

                        // If that was the last message, and the other endpoint is still present, our event just got unsignalled.
                        if (queue.empty() && have_other)
                            signal_change = true;

                        got_message = true;
                }
        }

        if (signal_change)
        {
                // If the queue is now empty, broadcast the state-change of the event to the waiters
                POE_ONLY(bool is_signalled = link->GetEvent(endpoint_side).IsSignalled();)

                link->GetEvent(endpoint_side).StateChanged();
                POE_PRINT("Last message received, signalling endpoint " << this << " to " << is_signalled << ", got msg: " << (msg->get() ? "yes" : "no") << " " << got_message << " nq:" << nowqueue << " ha: " << have_other << " id: " << (*msg)->msgid);
        }
        POE_ONLY(else
        {
                if (msg->get())
                    POE_PRINT("Got message on endpoint " << this << ", more pending, id: " << (*msg)->msgid);
                else
                    POE_PRINT("Check for messages: none present on " << this << " pre: " << pre_in_queue);
        })

        return got_message;
}

std::pair< SendResult::Type, uint64_t > IPCLinkEndPoint::SendMessage(std::unique_ptr< IPCMessage2 > *msg, bool allow_flowcontrol)
{
        std::shared_ptr< IPCMessage2 > ptr;
        ptr.reset(msg->release());

        return SendMessage(&ptr, allow_flowcontrol);
}

std::pair< SendResult::Type, uint64_t > IPCLinkEndPoint::SendMessage(std::shared_ptr< IPCMessage2 > *ptr, bool allow_flowcontrol)
{
        bool was_empty;

        // Get a globally unique message id from the jobmanager if not pre-set
        uint64_t msgid = (*ptr)->msgid;
        if (!msgid)
        {
                JobManager::LockedMessagingData::WriteRef lock(jobmgr.messagingdata);
                msgid = ++lock->gen_id;
        }

        POE_ONLY(IPCLinkEndPoint *ep;)
        {
                IPCLinkData::LockedData::WriteRef lock(link->data);

                PO_PRINT("Sending message from endpoint " << this << " to " << lock->endpoints[!endpoint_side]);
                POE_ONLY(ep = lock->endpoints[!endpoint_side];)

                if (lock->refcount != 2)
                {
                        POE_PRINT("Refcount != 2, not sending message on " << this);
                        return std::make_pair(SendResult::Gone, 0);
                }

                (*ptr)->msgid = msgid;//++lock->gen_id;

                // Record if the queue was empty, the event will change state if so.
                was_empty = lock->queues[!endpoint_side].empty();

                if (allow_flowcontrol && lock->queues[!endpoint_side].size() >= 64)
                    return std::make_pair(SendResult::LinkFull, 0);

                // Insert the message into the queue. Avoid locks by swapping ptr to back of
                // queue. Has nice side effect that *ptr is cleared.
                lock->queues[!endpoint_side].push_back(std::shared_ptr< IPCMessage2 >());
                lock->queues[!endpoint_side].back().swap(*ptr);

                PO_PRINT(" Messages in queue at " << lock->endpoints[!endpoint_side] << ": " << lock->queues[!endpoint_side].size());
        }

        if (was_empty)
        {
                // The queue of the other was empty, so the event has become signalled now.
                // Call StateChanged now, out of the link-lock to avoid as much lock-contention as possible
                // (though StateChanged notifies waiters within a lock of its own, creating a contentionpoint again)

                POE_ONLY(bool is_signalled = link->GetEvent(!endpoint_side).IsSignalled();)
                link->GetEvent(!endpoint_side).StateChanged();
                POE_PRINT("First message sent, id: " << msgid << " signalling endpoint " << ep << " to " << is_signalled << " (from: " << this << ")");
        }
        else
        {
                POE_PRINT("Put message on endpoint " << ep << ", others pending, id: " << msgid);
        }

        return std::make_pair(SendResult::Sent, msgid);
}

bool IPCLinkEndPoint::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        Blex::Event &event = link->GetEvent(endpoint_side);

        // First add to event: signalled state can change.
        waiter.AddEvent(event);

        bool is_signalled = event.IsSignalled();

        PM_PRINT("Added endpoint " << this << " to waiter (vm: " << vm << ") signalled " << (is_signalled ? "yes" : "no") << " event: " << &event);

        if (is_signalled)
            return true;

        return false;
}

OutputObject::SignalledStatus IPCLinkEndPoint::IsReadSignalled(Blex::PipeWaiter *)
{
        Blex::Event &event = link->GetEvent(endpoint_side);

        bool is_signalled = event.IsSignalled();

        PM_PRINT("Endpoint " << this << " checking signalled " << (is_signalled ? "yes" : "no") << " event: " << &event);
        return is_signalled ? Signalled : NotSignalled;
}

void IPCLinkEndPoint::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        Blex::Event &event = link->GetEvent(endpoint_side);
        waiter.RemoveEvent(event);

        PM_PRINT("Removed endpoint " << this << " from waiter (vm: " << vm << ") event: " << &event);
}


// -----------------------------------------------------------------------------
//
// Job
//

Job::Job(VirtualMachine *_vm, VMGroup *_group)
: OutputObject(*_vm)
, group(_group)
, must_delete(true)
{
}

Job::~Job()
{
        while (!capture_handles.empty())
            capture_handles.begin()->second();

        if (must_delete)
            group->GetJobManager()->AbortVMGroup(group);
        group->GetJobManager()->ReleaseVMGroup(group);
}

void Job::Release()
{
        must_delete = false;
}

bool Job::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        Blex::StatefulEvent &event = group->GetFinishEvent();

        if (event.IsSignalled())
            return true;

        waiter.AddEvent(event);
        return false;
}

OutputObject::SignalledStatus Job::IsReadSignalled(Blex::PipeWaiter * /*waiter*/)
{
        Blex::StatefulEvent &event = group->GetFinishEvent();

        PM_PRINT("Job " << this << " checking signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        return event.IsSignalled() ? Signalled : NotSignalled;
}

// -----------------------------------------------------------------------------
//
// HSLockData
//

bool HSLockManager::EnableLockEvents(LockedData::WriteRef &, LockData &lockdata)
{
        unsigned maxconcurrent = std::numeric_limits< unsigned >::max();
        Blex::DateTime now = Blex::DateTime::Invalid();

        unsigned count = 0;
        bool reached_end = true;
        for (std::list< LockQueueEntry >::iterator it = lockdata.lockqueue.begin(); it != lockdata.lockqueue.end(); ++it)
        {
                ++count;
                if (it->maxconcurrent < maxconcurrent)
                    maxconcurrent = it->maxconcurrent;
                if (count > maxconcurrent)
                {
                        reached_end = false;
                        break;
                }

                if (!it->locked)
                {
                        if (now == Blex::DateTime::Invalid())
                            now = Blex::DateTime::Now();

                        it->lock->event.SetSignalled(true);
                        it->lockstart = now;
                        it->locked = true;
                        it->processdata->waitfor = 0;
                }
        }

        return reached_end;
}

bool HSLockManager::AddQueueEntry(HSLock *hslock, unsigned maxconcurrent, bool fail_on_queuing)
{
        assert(maxconcurrent > 0);

        Blex::DateTime now = Blex::DateTime::Now();

        LockedData::WriteRef lock(data);

        ProcessData &processdata = lock->processes[hslock->GetVMGroup()];
        LOCK_PRINT("Create processdata for " << hslock->GetVMGroup());
        processdata.vmgroup = hslock->GetVMGroup();
        if (processdata.waitfor)
        {
                HSVM_ThrowException(hslock->vm, ("Process is already waiting on lock '" + processdata.waitfor->name + "', can only wait on one at a time").c_str());
                return false;
        }

        std::map< std::string, LockData >::iterator it = lock->locks.find(hslock->name);
        if (it == lock->locks.end())
        {
                LockData data;
                data.name = hslock->name;
                it = lock->locks.insert(std::make_pair(hslock->name, data)).first;
        }

        LockQueueEntry entry;
        entry.lockdata = &it->second;
        entry.lock = hslock;
        entry.maxconcurrent = maxconcurrent;
        entry.locked = false;
        entry.processdata = &processdata;
        entry.waitstart = now;
        entry.lockstart = Blex::DateTime::Invalid();

        it->second.lockqueue.push_back(entry);
        bool result = EnableLockEvents(lock, it->second);
        if (!result)
        {
                if (fail_on_queuing)
                {
                        it->second.lockqueue.pop_back();
                        return false;
                }
        }

        std::list< LockQueueEntry >::iterator lit = --it->second.lockqueue.end();
        processdata.locks.push_back(lit);
        if (!result)
        {
                processdata.waitfor = &it->second;

                LOCK_PRINT("Entering deadlock detection, for group lockdata " << &processdata);

                unsigned maxiter = lock->processes.size() + 1;
                LockData *waitlock = &it->second;
                bool with_semaphores = false;
                while (maxiter)
                {
                        LOCK_PRINT(" considering lock " << waitlock->name << " iter " << maxiter);

                        LockQueueEntry *front = &waitlock->lockqueue.front();
                        if (front->maxconcurrent != 1)
                        {
                                with_semaphores = true;
                                LOCK_PRINT("  detected semaphore lock, skip rest of mutex-only-deadlock check");
                                break;
                        }
                        LOCK_PRINT("  mutex held by " << front->processdata);
                        if (front->processdata == &processdata)
                        {
                                LOCK_PRINT("   that's the current process, deadlock");
                                maxiter = 0;
                                break;
                        }
                        waitlock = front->processdata->waitfor;
                        if (!waitlock)
                        {
                                LOCK_PRINT("   Process not waiting, break");
                                break;
                        }
                        --maxiter;
                }

                if (with_semaphores && IsDeadlockPresent(lock))
                    maxiter = 0;

                if (!maxiter)
                {
                        RemoveQueueEntryLocked(lock, hslock);
                        HSVM_ThrowException(hslock->vm, ("Deadlock detected when waiting on lock '" + hslock->name + "'").c_str());
                        return false;
                }
        }
        return result;
}

bool HSLockManager::IsDeadlockPresent(LockedData::WriteRef &lock)
{
        /* Ignore locks for processes that aren't waiting, see what processes get the lock after that one.
           Thus simulate the entire unlocking/locking process for the rest of the locks
        */
        LOCK_PRINT("Entering heavy deadlock detection");
        LOCK_PRINT(" Processes:");
        for (std::map< VMGroup const *, ProcessData >::iterator it = lock->processes.begin(); it != lock->processes.end(); ++it)
        {
                it->second.no_deadlock = it->second.waitfor == 0;
                LOCK_PRINT("  " << it->first << ", no_deadlock: " << it->second.no_deadlock);
        }

        bool all_reached_end;
        while (true)
        {
                bool any_change = false;
                all_reached_end = true;

                LOCK_PRINT(" Loop through locks");
                for (std::map< std::string, LockData >::iterator lockit = lock->locks.begin(); lockit != lock->locks.end(); ++lockit)
                {
                        LockData &lockdata = lockit->second;

                        unsigned maxconcurrent = std::numeric_limits< unsigned >::max();
                        unsigned count = 0;

                        for (std::list< LockQueueEntry >::iterator qit = lockdata.lockqueue.begin(), qend = lockdata.lockqueue.end(); qit != qend; ++qit)
                        {
                                if (qit->processdata->no_deadlock)
                                    continue;

                                ++count;
                                if (qit->maxconcurrent < maxconcurrent)
                                    maxconcurrent = qit->maxconcurrent;
                                if (count > maxconcurrent)
                                {
                                        all_reached_end = false;
                                        break;
                                }

                                if (qit->processdata->waitfor == &lockdata)
                                {
                                        LOCK_PRINT("  " << qit->processdata->vmgroup << " mark as no_deadlock");
                                        qit->processdata->no_deadlock = true;
                                        any_change = true;
                                }
                        }
                }
                if (!any_change)
                    break;
        }
        LOCK_PRINT("Finalized heavy deadlock detection: " << (all_reached_end ? "no deadlock" : "deadlock"));
        return !all_reached_end;
}

void HSLockManager::RemoveQueueEntry(HSLock *hslock)
{
        LockedData::WriteRef lock(data);

        RemoveQueueEntryLocked(lock, hslock);
}

void HSLockManager::RemoveQueueEntryLocked(LockedData::WriteRef &lock, HSLock *hslock)
{
        std::map< std::string, LockData >::iterator it = lock->locks.find(hslock->name);
        std::map< VMGroup const *, ProcessData >::iterator pit = lock->processes.find(hslock->GetVMGroup());

        if (it != lock->locks.end() && pit != lock->processes.end())
        {
                for (std::vector< std::list< LockQueueEntry >::iterator >::reverse_iterator lit = pit->second.locks.rbegin(); lit != pit->second.locks.rend(); ++lit)
                    if ((*lit)->lock == hslock)
                    {
                            LockData *lockdata = (*lit)->lockdata;

                            lockdata->lockqueue.erase(*lit);
                            pit->second.locks.erase(--lit.base()); // erase from reverse_iterator, base() diffs by 1 from normal itr to elt
                            if (pit->second.waitfor == &it->second)
                                pit->second.waitfor = 0;

                            if (pit->second.locks.empty())
                            {
                                    LOCK_PRINT("Erase process data for " << pit->first << ", no more locks taken");
                                    lock->processes.erase(pit);
                            }

                            EnableLockEvents(lock, *lockdata);
                            break;
                    }
        }

        hslock->event.SetSignalled(false);
}

void HSLockManager::GetLockStatus(JobManager *jobmgr, HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        LockedData::WriteRef lock(data);

        LOCK_PRINT("Lock status");
        for (std::map< std::string, LockData >::iterator lockit = lock->locks.begin(); lockit != lock->locks.end(); ++lockit)
        {
                LockData &lockdata = lockit->second;

                unsigned maxconcurrent = std::numeric_limits< unsigned >::max();
                unsigned count = 0;

                for (std::list< LockQueueEntry >::iterator qit = lockdata.lockqueue.begin(), qend = lockdata.lockqueue.end(); qit != qend; ++qit)
                {
                        HSVM_VariableId var_lock = HSVM_ArrayAppend(vm, id_set);

                        ++count;
                        if (qit->maxconcurrent < maxconcurrent)
                            maxconcurrent = qit->maxconcurrent;

                        std::vector< std::list< LockQueueEntry >::iterator > const &process_locks = qit->processdata->locks;
                        unsigned lockorder = std::distance(process_locks.begin(), std::find(process_locks.begin(), process_locks.end(), qit));

                        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "NAME")), lockdata.name);
                        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "GROUPID")), jobmgr->GetGroupId(qit->processdata->vmgroup));
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "MAXCONCURRENT")), qit->maxconcurrent);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "LOCKPOSITION")), count - 1);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "GROUPLOCKPOSITION")), lockorder);
                        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "WAITING")), count > maxconcurrent);
                        HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "WAITSTART")), qit->waitstart.GetDays(), qit->waitstart.GetMsecs());
                        HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, var_lock, HSVM_GetColumnId(vm, "LOCKSTART")), qit->lockstart.GetDays(), qit->lockstart.GetMsecs());

                        LOCK_PRINT(" "  << lockdata.name << " gid: " << jobmgr->GetGroupId(qit->processdata->vmgroup) << " cnt: " << count << " mc: " << qit->maxconcurrent << " lo: " << lockorder);
                }
        }
}


// -----------------------------------------------------------------------------
//
// HSLock
//

HSLock::HSLock(HSVM *vm, HSLockManager &_lockmanager, std::string const &_name)
: OutputObject(vm)
, lockmanager(_lockmanager)
, name(_name)
{
}

HSLock::~HSLock()
{
        LOCK_PRINT("LOCK VMGroup " << HareScript::GetVirtualMachine(vm)->GetVMGroup() << " destroy lock object " << name);
        lockmanager.RemoveQueueEntry(this);
}

/** Adds this port to a waiter
    @param waiter Waiter to add to
    @return Returns whether connection requests are pending
*/
bool HSLock::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        LOCK_PRINT("Adding lock " << this << " (name: " << name << ") to waiter (vm: " << vm << ") signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        if (event.IsSignalled())
            return true;

        waiter.AddEvent(event);
        return false;
}

/** Checks whether the port is read-signalled (if any messages are in queue, or
    the port this port was connected to has disappeared)
    @return Returns whether any message is in queue, or the port is broken.
*/
OutputObject::SignalledStatus HSLock::IsReadSignalled(Blex::PipeWaiter *)
{
        LOCK_PRINT("Lock " << this << " (name: " << name << ") checking signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        return event.IsSignalled() ? Signalled : NotSignalled;
}


/** Removes this port from a waiter
    @param waiter Waiter to remove from
*/
void HSLock::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        waiter.RemoveEvent(event);
        LOCK_PRINT("Removed lock " << this << " (name: " << name << ") from waiter (vm: " << vm << ") event: " << &event);
}

VMGroup const * HSLock::GetVMGroup()
{
        return GetVirtualMachine(vm)->GetVMGroup();
}

// -----------------------------------------------------------------------------
//
// Harescript functions
//

// Temporary function to fire another script
void CreateJob(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        HSVM_VariableId jobid_var = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "JOBID"));
        HSVM_VariableId errors_var = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERRORS"));
        HSVM_VariableId groupid_var = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "GROUPID"));
        HSVM_SetDefault(*vm, errors_var, HSVM_VAR_RecordArray);
        HSVM_IntegerSet(*vm, jobid_var, 0);
        HSVM_SetDefault(*vm, groupid_var, HSVM_VAR_String);

        int jobid = HSVM_CreateJob(*vm, name.c_str(), errors_var);
        if (jobid >= 0)
        {
                HSVM_IntegerSet(*vm, jobid_var, jobid);
                HSVM_StringSetSTD(*vm, groupid_var, HSVM_GetVMGroupIdSTD(HSVM_GetVMFromJobId(*vm, jobid)));
        }

}

void StartJob(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t procid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        JobManagerContext context(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(procid);
        if (it == context->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        jobmgr->StartVMGroup(it->second->GetVMGroup());
}

void ReleaseJob(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t procid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManagerContext context(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(procid);
        if (it == context->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        // Release the job, so it won't be terminated when we delete the job variable
        it->second->Release();
        context->jobs.erase(it);
}

void TerminateJob(VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t procid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManagerContext context(vm->GetContextKeeper());
        Baselibs::SystemContext scontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(procid);
        if (it == context->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        // Don't release, so it'll get killed after the last reference dies
        jobmgr->AbortVMGroup(it->second->GetVMGroup());

        while (!it->second->capture_handles.empty())
            it->second->capture_handles.begin()->second();
}

void DeleteJob(VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t procid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManagerContext context(vm->GetContextKeeper());
        Baselibs::SystemContext scontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(procid);
        if (it == context->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        // Don't release, so it'll get killed after the last reference dies
        jobmgr->AbortVMGroup(it->second->GetVMGroup());

        while (!it->second->capture_handles.empty())
            it->second->capture_handles.begin()->second();

        context->jobs.erase(it);
}

void TryCancelJob(VarId id_set, VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t procid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManagerContext context(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(procid);
        if (it == context->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        HSVM_BooleanSet(*vm, id_set, jobmgr->TryCancel(it->second->GetVMGroup()));
}

void GetJobErrors(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");
        int32_t procid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        JobManagerContext context(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = context->jobs.find(procid);
        if (it == context->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        bool islocked = jobmgr->TryLockVMGroup(it->second->GetVMGroup(), 0);
        if (!islocked)
        {
                HSVM_ThrowException(*vm, "Cannot request job errors of a running job");
                return;
        }

        try
        {
                GetMessageList(*vm, id_set, it->second->GetVMGroup()->GetErrorHandler(), true);
        }
        catch (std::exception &)
        {
                jobmgr->UnlockVMGroup(it->second->GetVMGroup());
                throw;
        }
        jobmgr->UnlockVMGroup(it->second->GetVMGroup());
}

namespace
{

struct WaitableOutputObject
{
        int32_t handle;
        OutputObject *obj;
        bool checklocal;
};

} // End of anonymous namespace

void DoWaitForMultiple(VarId id_set, VirtualMachine *vm, Blex::DateTime until)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        bool can_suspend = vm->IsSafeToSuspend() && vm->GetVMGroup()->IsRunByJobMgr(); // FIXME: remove the latter when all suspendable scripts are run through job manager (webserver is the current culprit)

        unsigned num_reads = HSVM_ArrayLength(*vm, HSVM_Arg(0));
        unsigned num_writes = HSVM_ArrayLength(*vm, HSVM_Arg(1));

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_read = HSVM_RecordCreate(*vm, id_set, vm->cn_cache.col_read);
        HSVM_VariableId var_timeout = HSVM_RecordCreate(*vm, id_set, vm->cn_cache.col_timeout);
        HSVM_VariableId var_write = HSVM_RecordCreate(*vm, id_set, vm->cn_cache.col_write);
        HSVM_SetDefault(*vm, var_read, HSVM_VAR_IntegerArray);
        HSVM_SetDefault(*vm, var_write, HSVM_VAR_IntegerArray);

        /* First, we do an immediate signalled check - if the objects are signalled NOW.
           If any object can't determine that (it needs a select/poll or so), we go into a PipeWaiter loop
        */
        bool have_signal = false;

        // List of <handles,OutputObject*> pairs which didn't return a definite immediate result
        Blex::SemiStaticPodVector< WaitableOutputObject, 8 > waitable_reads;
        Blex::SemiStaticPodVector< WaitableOutputObject, 8 > waitable_writes;

        Blex::DateTime now = Blex::DateTime::Now();

        // Do we have immediate timeout?
        bool have_timeout = until <= now;
        HSVM_BooleanSet(*vm, var_timeout, have_timeout);

        WFM_PRINT("Start, have timeout: " << have_timeout << " can_suspend: " << can_suspend);

        // If we're not going to wait locally for a longer time, we don't need to check outputobjects that say they're not signalled now.
        bool local_check_all = !have_timeout && !can_suspend;
        bool have_locally_waitables = false;

        // Resolve output object ptrs, check for cheap signalled status
        for (unsigned i = 0; i < num_reads; ++i)
        {
                WaitableOutputObject obj;

                // Get handle and outputobject (throws if not found)
                obj.handle = HSVM_IntegerGet(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(0), i));
                if (!obj.handle && !context->os.console_support)
                    throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);
                obj.obj = obj.handle ? vm->GetOutputObject(obj.handle, false) : &context->os.console;

                // Check cheap signalled status, see if we can get a definite result
                // returns (is_signalled, valid_result)
                OutputObject::SignalledStatus sig_res = obj.obj->IsReadSignalled(0);
                WFM_PRINT(" Got read handle " << obj.handle << " " << sig_res);
                if (sig_res == OutputObject::Signalled)
                {
                        // Is signalled, no need to wait for it
                        have_signal = true;
                        HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_read), obj.handle);
                        continue;
                }

                // Only need to check in the local loop when signalled state is unknown or waiting for a longer time
                obj.checklocal = (sig_res == OutputObject::Unknown) || local_check_all;
                waitable_reads.push_back(obj);

                if (obj.checklocal)
                    have_locally_waitables = true;
        }

        for (unsigned i = 0; i < num_writes; ++i)
        {
                WaitableOutputObject obj;

                // Get handle and outputobject (throws if not found)
                obj.handle = HSVM_IntegerGet(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(1), i));
                if (!obj.handle && !context->os.console_support)
                    throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);
                obj.obj = obj.handle ? vm->GetOutputObject(obj.handle, false) : &context->os.console;

                // Check cheap signalled status, see if we can get a definite result
                OutputObject::SignalledStatus sig_res = obj.obj->IsWriteSignalled(0);
                WFM_PRINT(" Got write handle " << obj.handle << " " << sig_res);
                if (sig_res == OutputObject::Signalled)
                {
                        have_signal = true;
                        HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_write), obj.handle);
                        continue;
                }

                // Only need to check in the local loop when signalled state is unknown or waiting for a longer time
                obj.checklocal = (sig_res == OutputObject::Unknown) || local_check_all;
                waitable_writes.push_back(obj);

                if (obj.checklocal)
                    have_locally_waitables = true;
        }

        // Any handles we need to wait on locally?
        WFM_PRINT(" have_locally_waitables: " << have_locally_waitables);

        /* Possible scenarios, based on 'have_locally_waitables' (hlw), 'can_suspend' (susp) and 'have_timeout'
           Suspending = stopping execution of the current job and allowing the scheduler to select a different job (ie: yield)
           Normally disallowed when running from within a C++ call, or scripts that are run directly (like access scripts)
             # hlw susp tim
            S1 f   f    f     Wait locally (until timeout)
            S2 f   f    t     Done
            S3 f   t    f     Suspend
            S4 f   t    t     Done
            S5 t   f    f     Wait locally (until timeout)
            S6 t   f    t     Wait locally (one turn/until timeout), then return
            S7 t   t    f     Wait locally (one turn), then suspend
            S8 t   t    t     Wait locally (one turn/until timeout), then return

            When signalled, do one turn in the local wait when locally waitables are present, otherwise return immediately.
        */

        if (!have_locally_waitables)
        {
                // If we already have a timeout, and no handles to check within a waiter, we're done. (S2 and S4)
                if (have_timeout)
                {
                        WFM_PRINT(" No waitable handles, got timeout: returning");
                        return;
                }
                // If we don't need to wait on handles locally, everything that can become signalled now is already marked as such
                if (have_signal)
                {
                        WFM_PRINT(" No waitable handles, got signal: returning");
                        return;
                }
        }

        // Left: S1, S3, S5, S6, S7, S8. Don't need to locally wait for S3
        if (have_locally_waitables || !can_suspend) // S1, S5, S6, S7, S8 (would catch S2, but we already returned for that one)
        {
                WFM_PRINT(" Adding locally waitable handles to waiter");

                Blex::PipeWaiter waitlist;
                bool have_any_waiter = false;

                // Add to the waiter. Might also give back a signalled status, reset outputobject ptr so we know not to query from the pipewaiter
                for (auto &itr: waitable_reads)
                {
                        if (!itr.checklocal)
                            continue;
                        if (itr.obj->AddToWaiterRead(waitlist))
                        {
                                WFM_PRINT(" Handle read " << itr.handle << " now signalled");
                                have_signal = true;
                                itr.checklocal = false;
                                HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_read), itr.handle);
                        }
                        else
                            have_any_waiter = true;
                }

                for (auto &itr: waitable_writes)
                {
                        if (!itr.checklocal)
                            continue;
                        if (itr.obj->AddToWaiterWrite(waitlist))
                        {
                                WFM_PRINT(" Handle write " << itr.handle << " now signalled");
                                have_signal = true;
                                itr.checklocal = false;
                                HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_write), itr.handle);
                        }
                        else
                            have_any_waiter = true;
                }

                bool run_waitloop = true;
                if (!have_any_waiter)
                {
                        WFM_PRINT(" No objects added to waiter");

                        // No waiters left - effectively have_waitable_handles turned false
                        // S5->S1, S6->S2, S7->S3, S8->S4
                        if (have_timeout) // S6, S8
                        {
                                WFM_PRINT(" Returning");
                                return;
                        }
                        if (can_suspend) // S7
                            run_waitloop = false;
                }

                while (run_waitloop)
                {
                        if (can_suspend || have_signal)
                        {
                                // S7, S8 - only one turn, so with quick timeout
                                waitlist.Wait(now);
                        }
                        else
                        {
                                // S1, S5, S6: wait until timeout (will be immediate for S6)
                                while (true)
                                {
                                        // Wait in increments of 100ms, so we catch aborts reasonably fast
                                        Blex::DateTime nextwait = std::min(now + Blex::DateTime::Msecs(100), until);
                                        bool have_signalled_waiter = waitlist.Wait(nextwait);
                                        if (have_signalled_waiter)
                                            break;

                                        if (nextwait == until || HSVM_TestMustAbort(*vm))
                                        {
                                                HSVM_BooleanSet(*vm, var_timeout, true);
                                                return;
                                        }

                                        now = Blex::DateTime::Now();
                                }
                        }

                        // Determine signalled status for all objects
                        for (auto &itr: waitable_reads)
                        {
                                if (itr.checklocal && itr.obj->IsReadSignalled(&waitlist) == OutputObject::Signalled)
                                {
                                        WFM_PRINT(" Handle read " << itr.handle << " signalled from waiter");
                                        have_signal = true;
                                        HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_read), itr.handle);
                                }
                        }
                        for (auto &itr: waitable_writes)
                        {
                                if (itr.checklocal && itr.obj->IsWriteSignalled(&waitlist) == OutputObject::Signalled)
                                {
                                        WFM_PRINT(" Handle write " << itr.handle << " signalled from waiter");
                                        have_signal = true;
                                        HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_write), itr.handle);
                                }
                        }

                        // Recheck the timeout
                        if (!have_timeout)
                        {
                                now = Blex::DateTime::Now();
                                have_timeout = until <= now;
                                if (have_timeout)
                                {
                                        WFM_PRINT(" Got timeout in local loop");
                                        HSVM_BooleanSet(*vm, var_timeout, true);
                                }
                        }

                        // At this moment, we have checked ALL outputobjects, so we can return now
                        if (have_timeout || have_signal)
                        {
                                WFM_PRINT(" Exiting local wait loop due to timeout or signals");
                                return;
                        }

                        // If we can suspend, do so
                        if (can_suspend)
                            break;
                }
        }

        // INV: can_suspend, !have_signal
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        Baselibs::SystemContext sys_context(vm->GetContextKeeper());

        // Set group wait data
        std::vector< JobManager::OutputObjectWait > waits;
        JobManager::OutputObjectWait wait;
        for (auto &itr: waitable_reads)
        {
                WFM_PRINT(" Add handle read " << itr.handle << " to central event loop wait");

                wait.handle = itr.handle;
                wait.object = itr.obj;
                wait.write = false;
                waits.push_back(wait);
        }
        for (auto &itr: waitable_writes)
        {
                WFM_PRINT(" Add handle write " << itr.handle << " to central event loop wait");

                wait.handle = itr.handle;
                wait.object = itr.obj;
                wait.write = true;
                waits.push_back(wait);
        }

        WFM_PRINT(" Suspending for central event loop wait");
        jobmgr->WaitForMultiple(vm, id_set, waits, until);
}

void WaitForMultipleUntil(VarId id_set, VirtualMachine *vm)
{
        Blex::DateTime until = vm->GetStackMachine().GetDateTime(HSVM_Arg(2));

        DoWaitForMultiple(id_set, vm, until);
}

void CaptureJobOutput(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        bool islocked = jobmgr->TryLockVMGroup(it->second->GetVMGroup(), 0);
        if (!islocked)
        {
                HSVM_IntegerSet(*vm, id_set, 0);
                return;
        }

        Baselibs::SystemContext context(vm->GetContextKeeper());

        std::pair< int32_t, int32_t > pipes = context->os.CreatePipeSet(*vm, false);
        VirtualMachine *receiver = jobmgr->GetGroupMainVM(*it->second->GetVMGroup());

        int32_t newid = context->os.MovePipeToOtherVM(*receiver, pipes.second);
        HSVM_RedirectJobOutputTo(*receiver, newid);
        context->os.SetPipeJob(pipes.first, it->second.get());

        jobmgr->UnlockVMGroup(it->second->GetVMGroup());

        HSVM_IntegerSet(*vm, id_set, pipes.first);
}

void SetArguments(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        unsigned numargs = HSVM_ArrayLength(*vm, HSVM_Arg(1));

        std::vector<std::string> args;
        args.reserve(numargs);
        for(unsigned i=0;i<numargs;++i)
            args.push_back(HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(1), i)));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        bool islocked = jobmgr->TryLockVMGroup(it->second->GetVMGroup(), 0);
        if (!islocked)
            throw VMRuntimeError(Error::InternalError, "Unable to lock target job");

        VirtualMachine *target = jobmgr->GetGroupMainVM(*it->second->GetVMGroup());
        std::vector<const char*> argsptrs(numargs);
        for(unsigned i=0;i<numargs;++i)
            argsptrs[i] = args[i].c_str();

        HSVM_SetConsoleArguments(*target, numargs, &argsptrs[0]);
        jobmgr->UnlockVMGroup(it->second->GetVMGroup());
}
void GetExitCode(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        bool islocked = jobmgr->TryLockVMGroup(it->second->GetVMGroup(), 0);
        if (!islocked)
            throw VMRuntimeError(Error::InternalError, "Unable to lock target job");

        VirtualMachine *target = jobmgr->GetGroupMainVM(*it->second->GetVMGroup());
        int32_t retval = HSVM_GetConsoleExitCode(*target);
        jobmgr->UnlockVMGroup(it->second->GetVMGroup());

        HSVM_IntegerSet(*vm, id_set, retval);
}

void SetGroupPriority(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        bool highpriority = HSVM_BooleanGet(*vm, HSVM_Arg(1));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        jobmgr->SetGroupPriority(it->second->GetVMGroup(), highpriority);
}

void GetJobExternalSessionData(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        HSVM_StringSetSTD(*vm, id_set, jobmgr->GetGroupExternalSessionData(it->second->GetVMGroup()));
}

void SetJobExternalSessionData(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        jobmgr->SetGroupExternalSessionData(*it->second->GetVMGroup(), HSVM_StringGetSTD(*vm, HSVM_Arg(1)));
}

void GetJobAuthenticationRecord(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        VirtualMachine *target = jobmgr->GetGroupMainVM(*it->second->GetVMGroup());

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        std::unique_ptr< MarshalPacket > copy;
        {
                VirtualMachine::LockedProtectedData::WriteRef lock(target->protected_data);

                if (lock->authenticationrecord.get())
                    lock->authenticationrecord->TryClone(&copy);
        }
        if (copy.get())
            vm->authrec_marshaller.ReadMarshalPacket(id_set, &copy);
}

void SetJobAuthenticationRecord(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        VirtualMachine *target = jobmgr->GetGroupMainVM(*it->second->GetVMGroup());

        std::unique_ptr< MarshalPacket > rec(vm->authrec_marshaller.WriteToNewPacket(HSVM_Arg(1)));

        VirtualMachine::LockedProtectedData::WriteRef lock(target->protected_data);
        lock->authenticationrecord.reset(rec.release());
}

void GetJobEnvironment(VarId id_set, VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));


        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        Blex::Process::Environment env;
        std::shared_ptr< const Blex::Process::Environment > override = jobmgr->GetGroupEnvironmentOverride(it->second->GetVMGroup());

        Blex::Process::Environment const *useenv;
        if (override)
            useenv = override.get();
        else
        {
                useenv = &env;
                Blex::ParseEnvironment(&env);
        }

        HSVM_ColumnId col_name =   HSVM_GetColumnId(*vm, "NAME");
        HSVM_ColumnId col_value =  HSVM_GetColumnId(*vm, "VALUE");

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_RecordArray);
        for (auto itr : *useenv)
        {
                HSVM_VariableId newrec = HSVM_ArrayAppend(*vm, id_set);

                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, newrec, col_name), itr.first);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, newrec, col_value), itr.second);
        }
}

void SetJobEnvironment(VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        HSVM_ColumnId col_name =   HSVM_GetColumnId(*vm, "NAME");
        HSVM_ColumnId col_value =  HSVM_GetColumnId(*vm, "VALUE");

        auto override = std::make_shared< Blex::Process::Environment >();
        unsigned numvars = HSVM_ArrayLength(*vm, HSVM_Arg(1));
        for (unsigned i = 0; i < numvars; ++i)
        {
                HSVM_VariableId rec = HSVM_ArrayGetRef(*vm, HSVM_Arg(1), i);

                HSVM_VariableId var_name = HSVM_RecordGetRequiredTypedRef(*vm, rec, col_name, HSVM_VAR_String);
                HSVM_VariableId var_value = HSVM_RecordGetRequiredTypedRef(*vm, rec, col_value, HSVM_VAR_String);
                if (!var_name || !var_value)
                    return;

                (*override)[HSVM_StringGetSTD(*vm, var_name)] = HSVM_StringGetSTD(*vm, var_value);
        }

        jobmgr->SetGroupEnvironmentOverride(*it->second->GetVMGroup(), override);
}

void CreateNamedIPCPort(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        if (name.empty())
            throw VMRuntimeError(Error::InternalError, "Name of an IPC port may not be empty");

        std::shared_ptr< IPCNamedPort > port;
        port = jobmgr->CreateNamedPort(name);

        if (port.get())
        {
                port->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, port->GetId());
                jmcontext->namedports.insert(std::make_pair(port->GetId(), port));
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void CloseNamedIPCPort(VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t portid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if (jmcontext->namedports.find(portid) == jmcontext->namedports.end())
            throw VMRuntimeError(Error::InternalError, "Cannot close an IPC port that does not exist");

        jmcontext->namedports.erase(portid);
}

void ConnectToIPCPort(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        std::shared_ptr< IPCLinkEndPoint > endpoint;
        endpoint = jobmgr->ConnectToNamedPort(name);
        if (endpoint.get())
        {
                PO_PRINT("Connecting to named port " << name << ", created link " << endpoint.get());
                endpoint->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, endpoint->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(endpoint->GetId(), endpoint));
        }
        else
        {
                PO_PRINT("Tried to connecting to named port " << name << ", but it didn't exist");
                HSVM_IntegerSet(*vm, id_set, 0);
        }
}

void AcceptIPCConnection(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        int32_t namedport = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        std::map< int32_t, std::shared_ptr< IPCNamedPort > >::iterator it = jmcontext->namedports.find(namedport);

        if (it == jmcontext->namedports.end())
        {
                HSVM_IntegerSet(*vm, id_set, 0);
                return;
        }

        std::shared_ptr< IPCLinkEndPoint > endpoint;
        endpoint = it->second->Accept();

        if (endpoint.get())
        {
                endpoint->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, endpoint->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(endpoint->GetId(), endpoint));
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void CloseIPCEndPoint(VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t portid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if (jmcontext->linkendpoints.find(portid) == jmcontext->linkendpoints.end())
            throw VMRuntimeError(Error::InternalError, "Cannot close an IPC link endpoint that does not exist");

        jmcontext->linkendpoints.erase(portid);
}


void SendIPCMessage2(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        StackMachine &stackm = vm->GetStackMachine();

        int32_t endpointid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        VarId msgvar = HSVM_Arg(1);
        uint64_t replyto = stackm.GetInteger64(HSVM_Arg(2));

        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > >::iterator it = jmcontext->linkendpoints.find(endpointid);

        if (it == jmcontext->linkendpoints.end())
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "error");
                return;
        }

        std::shared_ptr< IPCMessage2 > msg;
        jobmgr->AllocateMessage(&msg);

        msg->replyto = replyto;
        msg->data.reset(vm->GetIPCMarshaller().WriteToNewPacket(msgvar));
        std::pair< SendResult::Type, uint64_t > res = it->second->SendMessage(&msg, true);

        if (res.first == SendResult::Gone)
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "gone");
                return;
        }
        if (res.first == SendResult::LinkFull)
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "linkfull");
                return;
        }

        jobmgr->SetOkStatus2(vm, id_set, res.second);
}

void ReceiveIPCMessage2(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        StackMachine &stackm = vm->GetStackMachine();

        int32_t endpointid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > >::iterator it = jmcontext->linkendpoints.find(endpointid);

        if (it == jmcontext->linkendpoints.end())
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "error");
                return;
        }

        std::shared_ptr< IPCMessage2 > msg;
        if (!it->second->ReceiveMessage(&msg))
        {
                if (!it->second->IsBroken())
                    jobmgr->SetSimpleErrorStatus(vm, id_set, "none");
                else
                    jobmgr->SetSimpleErrorStatus(vm, id_set, "gone");
                return;
        }

        jmcontext->CheckColumnMappings(vm);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        stackm.SetString(HSVM_RecordCreate(*vm, id_set, jmcontext->col_status), Blex::StringPair::FromStringConstant("ok"));
        stackm.SetInteger64(HSVM_RecordCreate(*vm, id_set, jmcontext->col_msgid), msg->msgid);
        stackm.SetInteger64(HSVM_RecordCreate(*vm, id_set, jmcontext->col_replyto), msg->replyto);
        vm->GetIPCMarshaller().ReadMarshalPacket(HSVM_RecordCreate(*vm, id_set, jmcontext->col_msg), &msg->data);

        jobmgr->DiscardMessage(&msg);
}

void IsIPCLinkValid(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t endpointid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > >::iterator it = jmcontext->linkendpoints.find(endpointid);

        if (it == jmcontext->linkendpoints.end())
        {
                HSVM_BooleanSet(*vm, id_set, false);
                return;
        }

        HSVM_BooleanSet(*vm, id_set, !it->second->IsBroken());
}

void GetIPCLinkToParent(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
        {
                HSVM_IntegerSet(*vm, id_set, 0);
                return;
//            throw VMRuntimeError(Error::InternalError, "Job management not available");
        }

        JobManagerContext jmcontext(vm->GetContextKeeper());

        VMGroup *group = vm->GetVMGroup();

        if (group->parentipclink.get())
        {
                group->parentipclink->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, group->parentipclink->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(group->parentipclink->GetId(), group->parentipclink));
                group->parentipclink.reset();
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void GetIPCLinkToJob(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        if (it->second->childipclink.get())
        {
                std::shared_ptr< IPCLinkEndPoint > &endpoint = it->second->childipclink;

                endpoint->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, endpoint->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(endpoint->GetId(), endpoint));

                it->second->childipclink.reset();
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void SetJobCancellable(VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        bool newcancellable = HSVM_BooleanGet(*vm, HSVM_Arg(0));

        if (!jobmgr->SetCancellable(vm->GetVMGroup(), newcancellable))
            HSVM_ReportCustomError(*vm, "Can't set cancellability to false anymore, because this job has already been cancelled");
}

void GetJobCancellable(VarId id_set, VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        HSVM_BooleanSet(*vm, id_set, jobmgr->GetCancellable(vm->GetVMGroup()));
}

void GetVMStackTraceFromElements(VirtualMachine *vm, HSVM_VariableId var_stacktrace, std::vector< StackTraceElement > const &elements, VirtualMachine *testvm, bool full)
{
        assert(!full || testvm);
        HSVM_SetDefault(*vm, var_stacktrace, HSVM_VAR_RecordArray);

        for (auto it2 = elements.begin(); it2 != elements.end(); ++it2)
        {
                HSVM_VariableId var_elt = HSVM_ArrayAppend(*vm, var_stacktrace);
                HSVM_SetDefault(*vm, var_elt, HSVM_VAR_Record);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_filename), it2->filename);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_func), it2->func);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_line), it2->position.line);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_col), it2->position.column);
                if (full)
                {
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_codeptr), it2->codeptr);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_baseptr), it2->baseptr);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var_elt, vm->cn_cache.col_vm), testvm->GetVMGroup()->GetVMId(it2->vm));
                }
        }
}

void GetVMStackTrace(VirtualMachine *vm, HSVM_VariableId var_stacktrace, VirtualMachine *testvm, bool full)
{
        std::vector< StackTraceElement > elements;
        testvm->GetStackTrace(&elements, true, full);

        GetVMStackTraceFromElements(vm, var_stacktrace, elements, testvm, full);
}

void GetVMLibraries(VirtualMachine *vm, HSVM_VariableId var_resultlibs, VirtualMachine *testvm)
{
        HSVM_ColumnId col_globalvarlocation = HSVM_GetColumnId(*vm, "GLOBALVARLOCATION");
        StackMachine &target_stackm = testvm->GetStackMachine();

        HSVM_SetDefault(*vm, var_resultlibs, HSVM_VAR_RecordArray);
        LibraryConstPtrs libs = testvm->libraryloader.GetAllLibraries();
        for (auto itr: libs)
        {
                HSVM_VariableId var_lib = HSVM_ArrayAppend(*vm, var_resultlibs);
                LibraryCompileIds const &clib_ids = itr->GetLibraryCompileIds();

                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_lib, vm->cn_cache.col_liburi), itr->GetLibURI());
                HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_lib, vm->cn_cache.col_compile_id), clib_ids.clib_id.GetDays(), clib_ids.clib_id.GetMsecs());
                HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_lib, vm->cn_cache.col_sourcetime), clib_ids.sourcetime.GetDays(), clib_ids.sourcetime.GetMsecs());
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var_lib, col_globalvarlocation), target_stackm.GetMappingAddress(itr->GetId()));
        }
}

void GetSingleJobStatus(JobManager *jobmgr, VirtualMachine *vm, HSVM_VariableId var_job, VMGroup &vmgroup, Blex::DateTime const &now, Blex::DateTime const &max_datetime)
{
        HSVM_SetDefault(*vm, var_job, HSVM_VAR_Record);

        bool is_self = vm->GetVMGroup() == &vmgroup;
        VMGroupInfo info;
        jobmgr->GetGroupInfo(vmgroup, &info);

        std::stringstream state_str;
        state_str << info.state;

        // Calculate total running time
        Blex::DateTime total_running = info.total_running;
        if (info.current_run_start != Blex::DateTime::Min())
        {
                Blex::DateTime diff = now;
                diff -= info.current_run_start;
                total_running += diff;
        }

        HSVM_VariableId var_running = HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_running);
        HSVM_VariableId var_stacktrace = HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_stacktrace);
        HSVM_VariableId var_statistics = HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_statistics);
        HSVM_VariableId var_authenticationrecord = HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_authenticationrecord);

        HSVM_SetDefault(*vm, var_stacktrace, HSVM_VAR_RecordArray);
        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_script), info.mainscript);
        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_groupid), info.groupid);
        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_creationdate), info.creationdate.GetDays(), info.creationdate.GetMsecs());
        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_finishdate), max_datetime.GetDays(), max_datetime.GetMsecs());
        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_running_timeout), info.running_timeout.GetDays(), info.running_timeout.GetMsecs());
        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_total_running), total_running.GetDays(), total_running.GetMsecs());
        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_status), state_str.str());
        HSVM_SetDefault(*vm, var_statistics, HSVM_VAR_Record);
        HSVM_SetDefault(*vm, var_authenticationrecord, HSVM_VAR_Record);
        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_highpriority), info.highpriority);

        VirtualMachine *jobvm = jobmgr->GetGroupMainVM(vmgroup);

        std::unique_ptr< MarshalPacket > copy;
        {
                VirtualMachine::LockedProtectedData::ReadRef lock(jobvm->protected_data);
                if (lock->authenticationrecord.get())
                    lock->authenticationrecord->TryClone(&copy);
        }
        if (copy.get())
            vm->authrec_marshaller.ReadMarshalPacket(var_authenticationrecord, &copy);

        bool locked = is_self || jobmgr->TryLockVMGroup(&vmgroup, 0);
        if (locked)
        {
                HSVM_BooleanSet(*vm, var_running, is_self);

                GetVMStackTrace(vm, var_stacktrace, jobvm, false);

                HSVM_GetVMStatistics(*vm, var_statistics, *jobvm);

                if (!is_self)
                    jobmgr->UnlockVMGroup(&vmgroup);
        }
        else
            HSVM_BooleanSet(*vm, var_running, true);

}


void GetJobManagerStatusInternal(JobManager *jobmgr, VarId id_set, VirtualMachine *vm)
{
        bool gethistory = HSVM_BooleanGet(*vm, HSVM_Arg(0));

        HSVM_ColumnId col_finished = HSVM_GetColumnId(*vm, "FINISHED");
        HSVM_ColumnId col_jobs = HSVM_GetColumnId(*vm, "JOBS");
        HSVM_ColumnId col_keep_finish_history = HSVM_GetColumnId(*vm, "KEEP_FINISH_HISTORY");
        /*
        //HSVM_ColumnId col_running = HSVM_GetColumnId(*vm, "RUNNING");
        //HSVM_ColumnId col_status = HSVM_GetColumnId(*vm, "STATUS");
        HSVM_ColumnId col_script = HSVM_GetColumnId(*vm, "SCRIPT");
        HSVM_ColumnId col_stacktrace = HSVM_GetColumnId(*vm, "STACKTRACE");
        HSVM_ColumnId col_statistics = HSVM_GetColumnId(*vm, "STATISTICS");
        HSVM_ColumnId col_authenticationrecord = HSVM_GetColumnId(*vm, "AUTHENTICATIONRECORD");
        HSVM_ColumnId col_creationdate = HSVM_GetColumnId(*vm, "CREATIONDATE");
        HSVM_ColumnId col_finishdate = HSVM_GetColumnId(*vm, "FINISHDATE");
        HSVM_ColumnId col_groupid = HSVM_GetColumnId(*vm, "GROUPID");
        HSVM_ColumnId col_highpriority = HSVM_GetColumnId(*vm, "HIGHPRIORITY");
        HSVM_ColumnId col_running_timeout = HSVM_GetColumnId(*vm, "RUNNINGTIMEOUT");
        HSVM_ColumnId col_total_running = HSVM_GetColumnId(*vm, "TOTALRUNNING");
        HSVM_ColumnId col_messages = HSVM_GetColumnId(*vm, "MESSAGES");
*/
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_jobs = HSVM_RecordCreate(*vm, id_set, col_jobs);
        HSVM_SetDefault(*vm, var_jobs, HSVM_VAR_RecordArray);
        HSVM_VariableId var_finished = HSVM_RecordCreate(*vm, id_set, col_finished);
        HSVM_SetDefault(*vm, var_finished, HSVM_VAR_RecordArray);

        Blex::DateTime max_datetime = Blex::DateTime::Max();
        Blex::DateTime now = Blex::DateTime::Now();

        std::vector< VMGroupRef > jobs;
        std::vector< FinishedVMGroupInfo > finished;
        uint32_t keep_finish_history;
        jobmgr->GetStatus(&jobs, &finished, &keep_finish_history);

        for (std::vector< VMGroupRef >::iterator it = jobs.begin(), end = jobs.end(); it != end; ++it)
        {
                HSVM_VariableId var_job = HSVM_ArrayAppend(*vm, var_jobs);
                GetSingleJobStatus(jobmgr, vm, var_job, *it->get(), now, max_datetime);
        }

        if (gethistory)
        {
                HSVM_VariableId var_keep_finish_history = HSVM_RecordCreate(*vm, id_set, col_keep_finish_history);
                HSVM_IntegerSet(*vm, var_keep_finish_history, keep_finish_history);

                for (std::vector< FinishedVMGroupInfo >::iterator it = finished.begin(), end = finished.end(); it != end; ++it)
                {
                        HSVM_VariableId var_job = HSVM_ArrayAppend(*vm, var_finished);
                        HSVM_SetDefault(*vm, var_job, HSVM_VAR_Record);

        //                HSVM_VariableId var_running = HSVM_RecordCreate(*vm, var_job, col_running);
        //                HSVM_VariableId var_stacktrace = HSVM_RecordCreate(*vm, var_job, col_stacktrace);
                        HSVM_VariableId var_statistics = HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_statistics);
                        HSVM_VariableId var_authenticationrecord = HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_authenticationrecord);
        //                HSVM_SetDefault(*vm, var_stacktrace, HSVM_VAR_RecordArray);
                        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_script), it->info.mainscript);
                        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_groupid), it->info.groupid);
                        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_creationdate), it->info.creationdate.GetDays(), it->info.creationdate.GetMsecs());
                        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_finishdate), it->finishdate.GetDays(), it->finishdate.GetMsecs());
                        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_running_timeout), it->info.running_timeout.GetDays(), it->info.running_timeout.GetMsecs());
                        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_total_running), it->info.total_running.GetDays(), it->info.total_running.GetMsecs());
        //                HSVM_SetDefault(*vm, var_statistics, HSVM_VAR_Record);

                        std::unique_ptr< MarshalPacket > copy;
                        if (it->authenticationrecord.get())
                            it->authenticationrecord->TryClone(&copy);
                        if (copy.get())
                            vm->authrec_marshaller.ReadMarshalPacket(var_authenticationrecord, &copy);
                        else
                            HSVM_SetDefault(*vm, var_authenticationrecord, HSVM_VAR_Record);

                        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_highpriority), it->info.highpriority);
                        vm->EncodeVMStats(var_statistics, it->stats);
                        GetMessageList(*vm, HSVM_RecordCreate(*vm, var_job, vm->cn_cache.col_messages), it->errorhandler, true);
                }
        }
}

void GetJobManagerStatus(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        HSVM_ColumnId col_jobs = HSVM_GetColumnId(*vm, "JOBS");

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_jobs = HSVM_RecordCreate(*vm, id_set, col_jobs);
        HSVM_SetDefault(*vm, var_jobs, HSVM_VAR_RecordArray);

        GetJobManagerStatusInternal(jobmgr, id_set, vm);
}

void GetErrorsByGroupId(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        std::string groupid = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        FinishedVMGroupInfo info;
        if (jobmgr->GetFinishedVMInfo(groupid, &info))
        {
                HSVM_ColumnId col_messages = HSVM_GetColumnId(*vm, "MESSAGES");

                GetMessageList(*vm, HSVM_RecordCreate(*vm, id_set, col_messages), info.errorhandler, true);
        }
}

void SetRunningStatus(VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        bool newrunningstatus = HSVM_BooleanGet(*vm, HSVM_Arg(0));

        jobmgr->SetRunningStatus(vm->GetVMGroup(), newrunningstatus);
}

void GetCurrentGroupId(VarId id_set, VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        HSVM_StringSetSTD(*vm, id_set, jobmgr->GetGroupId(vm->GetVMGroup()));
}

void OpenLocalLock(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        HSVM_ColumnId col_lockid = HSVM_GetColumnId(*vm, "LOCKID");
        HSVM_ColumnId col_locked = HSVM_GetColumnId(*vm, "LOCKED");


        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        int32_t maxconcurrent = HSVM_IntegerGet(*vm, HSVM_Arg(1));
        bool fail_if_queued = HSVM_BooleanGet(*vm, HSVM_Arg(2));

        if (name.empty())
            throw VMRuntimeError(Error::InternalError, "Name of a lock may not be empty");

        std::shared_ptr< HSLock > lock(new HSLock(*vm, jobmgr->GetLockManager(), name));

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_lockid = HSVM_RecordCreate(*vm, id_set, col_lockid);
        HSVM_VariableId var_locked = HSVM_RecordCreate(*vm, id_set, col_locked);

        bool result = jobmgr->GetLockManager().AddQueueEntry(lock.get(), maxconcurrent, fail_if_queued);
        HSVM_BooleanSet(*vm, var_locked, result);
        LOCK_PRINT("LOCK VMGroup " << vm->GetVMGroup() << " tried locking '" << name << "', mc " << maxconcurrent << ", fiq: " << fail_if_queued << " result: " << result << ", id: " << lock->GetId());

        if (!result && fail_if_queued)
        {
                lock.reset();
                HSVM_IntegerSet(*vm, var_lockid, 0);
                return;
        }

        jmcontext->locks.insert(std::make_pair(lock->GetId(), lock));
        HSVM_IntegerSet(*vm, var_lockid, lock->GetId());
}

void CloseLocalLock(VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        LOCK_PRINT("LOCK VMGroup " << vm->GetVMGroup() << " unlock " << id);

        jmcontext->locks.erase(id);
}

void GetLocalLockStatus(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        jobmgr->GetLockManager().GetLockStatus(jobmgr, *vm, id_set);
}

void AbortJobByGroupId(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        std::string groupid = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        VMGroupRef ref = jobmgr->GetGroupRefByGroupId(groupid);
        if (ref.get())
        {
                DEBUGPRINT("Aborting VM process by id: " << groupid);
                jobmgr->AbortVMGroup(ref.get(), HSVM_ABORT_MANUALLY);
        }

        HSVM_BooleanSet(*vm, id_set, bool(ref.get()));
}

void GetExternalSessionData(VarId id_set, VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        HSVM_StringSetSTD(*vm, id_set, jobmgr->GetGroupExternalSessionData(vm->GetVMGroup()));
}

void SetExternalSessionData(VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        jobmgr->SetGroupExternalSessionData(*vm->GetVMGroup(), HSVM_StringGetSTD(*vm, HSVM_Arg(0)));
}

void TrapDebugger(VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        jobmgr->GetDebugger().OnScriptDebuggerTrap(*vm->GetVMGroup());
}

void GetSignalIntPipe(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        if (!context->os.console_support)
            throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);

        if(!context->os.signalinputpipe.get())
        {
                if(vm->GetVMGroup()->fd_signal_pipe >= 0)
                        throw VMRuntimeError(Error::InternalError, "fd_signal_pipe already set?");

                Blex::PipeSet pipes;
                pipes.GetReadEnd().SetBlocking(false);
                pipes.GetWriteEnd().SetBlocking(false);
                std::unique_ptr<Blex::PipeReadStream> readstream(pipes.ReleaseReadEnd());
                context->os.signalinputpipe.reset(new Baselibs::OSContext::ProcessOutputPipe(*vm, readstream));
                //ADDME avoiding the dup would be nicer, but then we'd need pipes that can give up their FD
                vm->GetVMGroup()->fd_signal_pipe = dup(pipes.GetWriteEnd().GetPosixFd());
        }
        HSVM_IntegerSet(*vm, id_set, context->os.signalinputpipe->GetId());
}

void InitIPC(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg)
{
        JobManagerContext::Register(creg);

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CREATEJOB::R:S", CreateJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_STARTJOB:::I", StartJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_RELEASEJOB:::I", ReleaseJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TERMINATEJOB:::I", TerminateJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_DELETEJOB:::I", DeleteJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TRYCANCELJOB::B:I", TryCancelJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBERRORS::RA:I", GetJobErrors));
        //bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("WAITFORMULTIPLE::I:IAIAI",WaitForMultiple));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_WAITFORMULTIPLEUNTIL::R:IAIAD",WaitForMultipleUntil));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CAPTUREJOBOUTPUT::I:I",CaptureJobOutput));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETJOBARGUMENTS:::ISA", SetArguments));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBEXITCODE::I:I", GetExitCode));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETGROUPPRIORITY:::IB", SetGroupPriority));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBEXTERNALSESSIONDATA::S:I", GetJobExternalSessionData));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETJOBEXTERNALSESSIONDATA:::IS", SetJobExternalSessionData));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBAUTHENTICATIONRECORD::R:I", GetJobAuthenticationRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETJOBAUTHENTICATIONRECORD:::IR", SetJobAuthenticationRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBENVIRONMENT::RA:I", GetJobEnvironment));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETJOBENVIRONMENT:::IRA", SetJobEnvironment));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CREATENAMEDIPCPORT::I:S", CreateNamedIPCPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CLOSENAMEDIPCPORT:::I", CloseNamedIPCPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CONNECTTOIPCPORT::I:S", ConnectToIPCPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_ACCEPTIPCCONNECTION::I:I", AcceptIPCConnection));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CLOSEIPCENDPOINT:::I", CloseIPCEndPoint));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SENDIPCMESSAGE::R:IV6", SendIPCMessage2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_RECEIVEIPCMESSAGE::R:I", ReceiveIPCMessage2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_ISIPCLINKVALID::B:I", IsIPCLinkValid));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETIPCLINKTOPARENT::I:", GetIPCLinkToParent));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETIPCLINKTOJOB::I:I", GetIPCLinkToJob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETJOBCANCELLABLE:::B", SetJobCancellable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBCANCELLABLE::B:", GetJobCancellable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETJOBMANAGERSTATUS::R:B", GetJobManagerStatus));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETRUNNINGSTATUS:::B", SetRunningStatus));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETCURRENTGROUPID::S:", GetCurrentGroupId));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_ERRORSBYGROUPID::R:S", GetErrorsByGroupId));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_ABORTJOBBYGROUPID::B:S", AbortJobByGroupId));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_OPENLOCALLOCK::R:SIB", OpenLocalLock));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CLOSELOCALLOCK:::I", CloseLocalLock));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETLOCALLOCKSTATUS::RA:", GetLocalLockStatus));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETSIGNALINTPIPE::I:", GetSignalIntPipe));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETEXTERNALSESSIONDATA::S:", GetExternalSessionData));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETEXTERNALSESSIONDATA:::S", SetExternalSessionData));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DEBUGGER:::VA", TrapDebugger));
}

} // End of namespace HareScript
