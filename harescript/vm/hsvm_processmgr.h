#ifndef blex_webhare_harescript_hsvm_processmgr
#define blex_webhare_harescript_hsvm_processmgr

#include <blex/threads.h>
#include <blex/context.h>
#include <blex/podvector.h>
#include <blex/pipestream.h>
#include <blex/socket.h>
#include "hsvm_constants.h"
#include "hsvm_marshalling.h"

namespace HareScript
{

class Debugger;
class VirtualMachine;
class VMGroup;
class Environment;
class BuiltinFunctionsRegistrator;
//class IPCPort;
class IPCNamedPort;
class IPCLinkEndPoint;
class JobManager;
class OutputObject;
class BroadcastManager;

/** WebHare input/output object */
class BLEXLIB_PUBLIC OutputObject
{
    private:
        int id;

    protected:
        HSVM *vm;

        // If true, this object must ignore the readbuffer when determining its signalled status
        bool wait_ignores_readbuffer;

    public:
        inline int GetId() { return id; }

        /// Signalled status
        enum SignalledStatus
        {
                Unknown,
                Signalled,
                NotSignalled
        };

        static const unsigned MaxReadChunkSize = 32768;

        ///Read buffer (used for line reading functions)
        std::vector<char> readbuffer;

        /// Set new value of wait_ignores_readbuffer flag
        void SetWaitIgnoresReadBuffer(bool newwait);

        /** Reader function for this object..
            @return false on I/O error */
        virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
        /** Writer function for this object..
            @return false on I/O error */
        virtual std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);

        virtual bool IsAtEOF();

        virtual bool ShouldYieldAfterWrite();

        /** Add to waiter for waiting; return TRUE if already ready
            @param waiter Waiter to add this object to (for read signalling only)
            @return Returns whether the object is already signalled, if that can
                be determined cheaply.
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &/*waiter*/) { return true; }

        /** Check if an object is read-signalled, optionally with a waiter that waited on it
            If no waiter is specified, the object returns whether it is signalled, but
            only when that can be done without kernel calls.
            @param waiter Optional waiter
            @return Signalled status. May be Unknown only if waiter is null and signalled status could not be determined.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter * /*waiter*/) { return Signalled; }

        /** Add to waiter for writing; return TRUE if already ready
            @param waiter Waiter to add this object to (for write signalling only)
            @return Returns whether the object is already signalled, if that can
                be determined cheaply.
        */
        virtual bool AddToWaiterWrite(Blex::PipeWaiter &/*waiter*/) { return true; }

        /** Check if an object is write-signalled, optionally with a waiter that waited on it
            If no waiter is specified, the object returns whether it is signalled, but
            only when that can be done without kernel calls.
            @param waiter Optional waiter
            @return Signalled status. May be Unknown only if waiter is null and signalled status could not be determined.
        */
        virtual SignalledStatus IsWriteSignalled(Blex::PipeWaiter * /*waiter*/) { return Signalled; }

        OutputObject(HSVM *vm);
        virtual ~OutputObject();

        int Register(HSVM *vm);
        void Unregister();
};

class IPCMessage2
{
    public:
        inline IPCMessage2()
        : msgid(0), replyto(0)
        { }

        ~IPCMessage2();

        void Reset();

        /// Id of this message (globally unique)
        uint64_t msgid;

        /// Id of message this message is a reply to
        uint64_t replyto;

        /// Marshalled data
        std::unique_ptr< MarshalPacket > data;
};

class BLEXLIB_PUBLIC IPCNamedPort : public OutputObject
{
    private:
        JobManager &jobmgr;

        IPCNamedPort(JobManager &_jobmgr);

    public:
        /// Backlog of connections
        typedef std::list< std::shared_ptr< IPCLinkEndPoint > > BackLog;
        BackLog backlog;

        /// Name of the port
        std::string name;

        /// Event to support waiting on this object
        Blex::StatefulEvent event;

        ~IPCNamedPort();

        /// Create a new connection to this port
        std::shared_ptr< IPCLinkEndPoint > Connect();

        /// Accept a new connection on this port
        std::shared_ptr< IPCLinkEndPoint > Accept();

        /** Adds this port to a waiter
            @param waiter Waiter to add to
            @return Returns whether connection requests are pending
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);

        /** Checks whether the port is read-signalled (if any messages are in queue, or
            the port this port was connected to has disappeared)
            @return Returns whether any message is in queue, or the port is broken.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        /** Removes this port from a waiter
            @param waiter Waiter to remove from
        */
        virtual void RemoveFromWaiterRead(Blex::PipeWaiter &waiter);

        inline Blex::Event & GetEvent() { return event; }

        friend class JobManager;
};


/** Shared data for an IPC link
*/
class IPCLinkData
{
    public:
        typedef std::list< std::shared_ptr< IPCMessage2 > > MessageQueue;

        class Data;

        /** Custom event, becomes signalled when the corresponding endpoint is
            signalled (message in queue or endpoint gone)

            The event doesn't automatically broadcast state changes to its waiters,
            that must be done manually by calling StateChanged when an action is done
            that might have changed the signalled state.
        */
        class IPCLinkEvent : public Blex::Event
        {
            private:
                /// Link of this event
                IPCLinkData &link;

                /// Endpoint of this event
                bool endpoint_side;

            public:
                IPCLinkEvent(IPCLinkData &_link, bool endpoint_side);

                /** Calculates whether the event is signalled (queue for this endpoint isn't
                    empty, or an endpoint is gone
                */
                virtual bool IsSignalled();
        };

        class Data
        {
            public:
                Data() : refcount(0), gen_id(0) { }

                unsigned refcount;

                IPCLinkEndPoint *endpoints[2];

                MessageQueue queues[2];

                uint64_t gen_id;
        };

        /// Constructor
        IPCLinkData();

        /// Returns the event for a specific endpoint
        inline IPCLinkEvent & GetEvent(bool endpoint_side) { return endpoint_side ? event_true : event_false; }

        // Events for both endpoints
        IPCLinkEvent event_false;
        IPCLinkEvent event_true;

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData data;
};

namespace SendResult
{
enum Type
{
        Sent,
        LinkFull,
        Gone
};
}

class BLEXLIB_PUBLIC IPCLinkEndPoint : public OutputObject
{
    private:
        /// Jobmanager (for msgid generation)
        JobManager &jobmgr;

        /// Link data
        std::shared_ptr< IPCLinkData > link;

        /// Endpoint side
        bool endpoint_side;

    private:
        IPCLinkEndPoint(JobManager &_jobmgr, std::shared_ptr< IPCLinkData > const &_link, bool _endpoint_side);

    public:
        ~IPCLinkEndPoint();

        /** Returns whether this link is broken. Returns TRUE when other endpoint is gone
            and no messages are left in the queue
            @return Whether the ipc link is broken
        */
        bool IsBroken();

        /** Sends a messsage to the other endpoint. Generates a message id, puts it in the message and returns
            that id if succesfull.
            @param msg Message to send. SendMessage takes ownership and clears the contents of this parameter.
            @return Assigned id of the message. 0 if the other endpoint is gone.
        */
        std::pair< SendResult::Type, uint64_t > SendMessage(std::unique_ptr< IPCMessage2 > *msg, bool allow_flowcontrol);

        /** Sends a messsage to the other endpoint. Generates a message id, puts it in the message and returns
            that id if succesfull. It is recommended to allocate messages by using
            @param msg Message to send. SendMessage clears the contents of this parameter.
            @return Assigned id of the message. 0 if the other endpoint is gone.
        */
        std::pair< SendResult::Type, uint64_t > SendMessage(std::shared_ptr< IPCMessage2 > *msg, bool allow_flowcontrol);

        /** Tries to receive a message from the other endpoint. If succesfull, returns true, and puts the message
            in @a msg. It is recommended to discard the message in a call to DiscardMessage in the jobmanager.
            @param msg Shared pointer in which the message is placed.
            @return Returns true when a message has been received, false otherwise.
        */
        bool ReceiveMessage(std::shared_ptr< IPCMessage2 > *msg);

        /** Adds this port to a waiter
            @param waiter Waiter to add to
            @return Returns whether this port is already signalled (
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);

        /** Checks whether the port is read-signalled (if any messages are in queue, or
            the port this port was connected to has disappeared)
            @return Returns whether any message is in queue, or the port is broken.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        /** Removes this port from a waiter
            @param waiter Waiter to remove from
        */
        virtual void RemoveFromWaiterRead(Blex::PipeWaiter &waiter);

        /** Returns the event for this endpoint. This event becomes signalled when messages are in queue, or the
            other endpoint is gone
        */
        inline Blex::Event & GetEvent() { return link->GetEvent(endpoint_side); }

        friend class JobManager;
        friend class IPCNamedPort;
};

class HSLockManager;

class HSLock : public OutputObject
{
        /// Lockmanager
        HSLockManager &lockmanager;

        /// Name of the lock
        std::string const name;

        /// Event to support waiting on this object
        Blex::StatefulEvent event;

    public:
        HSLock(HSVM *vm, HSLockManager &lockmanager, std::string const &name);
        ~HSLock();

        /** Adds this port to a waiter
            @param waiter Waiter to add to
            @return Returns whether connection requests are pending
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);

        /** Checks whether the port is read-signalled (if any messages are in queue, or
            the port this port was connected to has disappeared)
            @return Returns whether any message is in queue, or the port is broken.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        /** Removes this port from a waiter
            @param waiter Waiter to remove from
        */
        virtual void RemoveFromWaiterRead(Blex::PipeWaiter &waiter);

        inline Blex::Event & GetEvent() { return event; }

        VMGroup const * GetVMGroup();

        friend class JobManager;
        friend class HSLockManager;
};

class HSLockManager
{
    private:
        struct ProcessData;
        struct LockData;

        struct LockQueueEntry
        {
                LockData *lockdata;
                HSLock *lock;
                ProcessData *processdata;
                unsigned maxconcurrent;
                bool locked;
                Blex::DateTime waitstart;
                Blex::DateTime lockstart;
        };

        struct LockData
        {
                std::string name;
                std::list< LockQueueEntry > lockqueue;
        };

        struct ProcessData
        {
                ProcessData() : waitfor(0) {}

                /// VM group of this process
                VMGroup const *vmgroup;

                /// Lock this group is currently waiting for
                LockData *waitfor;

                /// List of all requested locks
                std::vector< std::list< LockQueueEntry >::iterator > locks;

                /// Whether this group cannot cause deadlock if it doesn't take extra locks. Used in semaphore deadlock detection algorithm.
                bool no_deadlock;
        };

        struct Data
        {
                std::map< std::string, LockData > locks;
                std::map< VMGroup const *, ProcessData > processes;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        LockedData data;

        bool EnableLockEvents(LockedData::WriteRef &lock, LockData &lockdata);
        void RemoveQueueEntryLocked(LockedData::WriteRef &lock, HSLock *hslock);
        bool IsDeadlockPresent(LockedData::WriteRef &lock);

    public:
        /** Add a lock to the lock queue
            @param lock Name of the lock
            @param maxconcurrent Nr of concurrent locks this lock allows (1 for mutex, 1+ for semaphore)
            @param fail_on_queuing Fail if not locked immediately
            @return True if locked now, false if queued (or failed when fail_on_queuing is true)
         */
        bool AddQueueEntry(HSLock *lock, unsigned maxconcurrent, bool fail_on_queuing);

        /** Remove a lock from the lock queue
        */
        void RemoveQueueEntry(HSLock *lock);

        /** Fill id_set with the current lock status
        */
        void GetLockStatus(JobManager *jobmgr, HSVM *vm, HSVM_VariableId id_set);
};


/** Class to keep (MT-safe) references to a VM group
*/
class BLEXLIB_PUBLIC VMGroupRef
{
    private:
        /// Group that is referenced
        VMGroup *group;

    public:
        explicit VMGroupRef(VMGroup *group = 0, bool addref = false);
        ~VMGroupRef();
        VMGroupRef(VMGroupRef const &rhs);
        VMGroupRef & operator =(VMGroupRef const &rhs);
        void reset(VMGroup *group = 0, bool addref = false);

        inline bool operator<(VMGroupRef const &rhs) const { return group < rhs.group; }

        inline VMGroup * get() { return group; }
        inline VMGroup * operator->() { return group; }
        inline VMGroup & operator*() { return *group; }

        friend class JobManager;
};

/// List of unlock callback functions
typedef std::function< void(int) > UnlockCallback;
typedef std::vector< UnlockCallback > UnlockCallbacks;
typedef std::function< void() > TerminationCallback;
typedef std::map< int32_t, TerminationCallback > TerminationCallbacks;

/// VM group info
struct VMGroupInfo
{
        /// Main script of this group
        std::string mainscript;

        /// Creationdate of this group
        Blex::DateTime creationdate;

        /// Group id of this VM group (should be globally unique)
        std::string groupid;

        /// Current running state
        RunningState::Type state;

        /// Whether the job is high priority
        bool highpriority;

        /// Running timeout
        Blex::DateTime running_timeout;

        /// Total running
        Blex::DateTime total_running;

        /// Running timeout
        Blex::DateTime current_run_start;

        /// External session data
        std::string externalsessiondata;
};

struct FinishedVMGroupInfo
{
        /// Base group info
        VMGroupInfo info;

        /// VM statistics
        VMStats stats;

        /// Finished at
        Blex::DateTime finishdate;

        /// Error handler
        ErrorHandler errorhandler;

        /// Authentication record
        std::shared_ptr< MarshalPacket > authenticationrecord;
};

/** The job manager manages the HareScript VM groups, runs them and handles
    the inter-job communication
*/
class BLEXLIB_PUBLIC JobManager
{
    public:
        /// Constructor
        JobManager(Environment &env);

        /// Destructor
        ~JobManager();

        /** Start the job manager. Starts a number of worker threads. This function must be called
            to be able to run scripts.
            @param numworkers Number of worker threads that will be started
            @param reserved_highpriority Number of worker threads reserved for highpriority threads
        */
        void Start(unsigned numworkers, unsigned reserved_highpriority);

        /** Shuts the job manager down. Stops all worker threads, and won't be able to run
            jobs/pass messages, but services (like locks) are still available for
            destruction purposes.
        */
        void Shutdown();

        /** Create a new VM group. The VM group is returned in state Startup, so it may be edited. The
            VM group must be released by calling @a ReleaseVMGroup when it has stopped executing.
            @param highpriority Set to TRUE if this job must have priority over low-priority jobs
        */
        VMGroup * CreateVMGroup(bool highpriority);

        /** Create a new VM group, and registers it as a job. The VM group is returned in state Startup, so it mey be edited. The
            VM group must be released by calling @a ReleaseVMGroup when it has stopped executing. Priority is inherited.
        */
        std::pair< VMGroup *, int32_t > CreateVMGroupInVM(HSVM *vm);

        /** Erases the job by id, doesn't delete the vmgroup if there are still references to it
        */
        void EraseJobById(HSVM *vm, int32_t id);

        /** Sends a specific termination signal to a VMGroup
        */
        void AbortVMGroup(VMGroup *group, unsigned reason = HSVM_ABORT_SILENTTERMINATE);

        /** Aborts the vmgroup, but only when it has been marked cancellable
        */
        bool TryCancel(VMGroup *group);

        /** Releases the specified VM group. If it running, it will be permitted to run until it is ready
        */
        void ReleaseVMGroup(VMGroup *group);

        /** Reset the termination function of a group
            @param group VM group to add the termination callback for
        */
        int32_t AddTerminationCallback(VMGroup *group, TerminationCallback const &async_termination_callback);

        /** Remove a termination function of a group
        */
        void RemoveTerminationCallback(VMGroup *group, int32_t id);

        /** FIXME: sets pretermination callback*/
        void SetPreterminationCallback(VMGroup *group, TerminationCallback const &preterm);

        /** Starts execution of a vm group. The group must be in state Startup. After this call, the
            data of the VM group may not be accessed from the outside.
            @param group Group to start executing
            @param async_termination_function Function that will be called (asynchronously) when the vm group
                has finished
        */
        void StartVMGroup(VMGroup *group);

        /** Returns whether a VM group has finished.
            @param group Group to determine termination status
        */
        bool IsFinished(VMGroup *group);

        /** Waits until a VM group has finished. When this fucntion returns, the VM group is in state Terminated,
            and may be accessed from the outside again
            @param group Group to wait for
        */
        void WaitFinished(VMGroup *group);

        /** Try to lock a VM group. If successfull, the group will be in state Locked when returned.
            If a callback is given, it is called when the group is unlocked and another lock attempt can
            be tried. When locked, the VM group must be unlocked by @a UnlockVMGroup.
            @param group Group to lock
            @param unlock_callback Function that will be called when the group is unlocked from its
                current lock (with current state as parameter)
            @return Returns whether lock succeeded
        */
        bool TryLockVMGroup(VMGroup *group, UnlockCallback const &unlock_callback);

        /// Unlocks a VM group after locking it
        void UnlockVMGroup(VMGroup *group);

        /** Returns whether a vmgroup is cancellable
        */
        bool GetCancellable(VMGroup const *group) const;

        /** Get the GroupId for a vmgroup
        */
        std::string GetGroupId(VMGroup const *group) const;

        /** Get the external session id for a vmgroup
        */
        std::string GetGroupExternalSessionData(VMGroup const *group) const;

        /** Get the environment override for a vmgroup
        */
        std::shared_ptr< const Blex::Process::Environment > GetGroupEnvironmentOverride(VMGroup const *group) const;

        /** Set whether a vmgroup is running (for the running timeout)
        */
        void SetRunningStatus(VMGroup *group, bool isrunning);

        /** Set the running timeout for a group
        */
        void SetRunningTimeout(VMGroup *group, unsigned secs);

        /** Set the cancellable flag of a vmgroup
            @return Whether setting was successfull. If not, the job has been cancelled already
        */
        bool SetCancellable(VMGroup *group, bool newcancellable);

        /** Sets group priority
        */
        void SetGroupPriority(VMGroup *group, bool highpriority);

        HSVM * GetJobFromId(HSVM *vm, int id);

        /// Get main group vm, group must be locked
        VirtualMachine * GetGroupMainVM(VMGroup &group);

        /// Get VMGroup info
        void GetGroupInfo(VMGroup const &group, VMGroupInfo *info);

        /// Overwrite group id
        void SetGroupId(VMGroup &group, std::string const &newgroupid);

        /// Overwrite group external session data
        void SetGroupExternalSessionData(VMGroup &group, std::string const &sessiondata);

        /// Overwrite the environment override for a vmgroup
        void SetGroupEnvironmentOverride(VMGroup &group, std::shared_ptr< const Blex::Process::Environment > environment);

        /// Returns whether the jobmanager is still running (if not, it is shutting down)
        bool IsRunning();

        unsigned GetNumRunningJobs();

        /** Allocate a new message (or satisfied from cache, if possible). Doesn't fail, except when bad_alloc.
            @param msg Pointer to message pointer, will be filled by a message.
        */
        void AllocateMessage(std::shared_ptr< IPCMessage2 > *msg);

        /** Discard an unused message (adds to cache)
            @param msg Pointer to message pointer, will be cleared after this call.
        */
        void DiscardMessage(std::shared_ptr< IPCMessage2 > *msg);

        /** Get runningjobs list
        */
        void GetStatus(std::vector< VMGroupRef > *groups, std::vector< FinishedVMGroupInfo > *finished, uint32_t *keep_finish_history);

        /** Set debug manager link
        */
        void SetDebugLink(std::shared_ptr< IPCLinkEndPoint > const &debuglink, std::string const &hosttype, uint64_t processcode, std::string const &clientname);

        /** Wait for debug configuration to arive (only if debuglink has been set, 3sec max)
        */
        void WaitForDebugConfiguration();

        /** Get info about finished vm by groupid
        */
        bool GetFinishedVMInfo(std::string const &groupid, FinishedVMGroupInfo *dest);

        /// Nr of msecs to keep the finish history
        void SetKeepFinishHistory(uint32_t msecs);

        /** Get group reference by groupid
        */
        VMGroupRef GetGroupRefByGroupId(std::string const &groupid);

        /** Recheck all vmgroups in wait after one has been aborted, usually by a signal handler. Signal-safe.
        */
        void HandleAsyncAbortBySignal();

        /** Get the error context info of a vm group
        */
        std::string GetGroupErrorContextInfo(VMGroup *group);

    private:
        Environment &env;

        /// Unique ID for this jobmgr, based on host IP addresses, processid and memory location.
        std::string jobmgr_id;

    public: // Public to allow createport and the like access to the job lock
        /// Job data
        struct JobData
        {
                inline JobData()
                : abort(false)
                , any_waiting_worker(false)
                , keep_finish_history(Blex::DateTime::Minutes(5))
                , running_lowp(0)
                , max_running_lowp(0)
                {
                }

                /// Flag set when all threads need to abort
                bool abort;

                /// Is any worker executing a wait()?
                bool any_waiting_worker;

                /// List of currently running jobs
                std::vector< VMGroupRef > jobs;

                /// List of all runnable jobs, in LIFO order.
                std::vector< VMGroup * > runnable;

                /// List of all low-priority runnable jobs, in LIFO order.
                std::vector< VMGroup * > runnable_lowp;

                std::map< std::string, IPCNamedPort * > namedports;

                /// Time to keep history (default: 5 minutes)
                Blex::DateTime keep_finish_history;

                /// List of finished groups
                std::list< FinishedVMGroupInfo > finished;

                // Nr of low priority jobs marked as running
                uint32_t running_lowp;

                uint32_t max_running_lowp;

                /// Rough estimation of current time
                Blex::DateTime roughnow;
        };

        typedef Blex::InterlockedData< JobData, Blex::ConditionMutex > LockedJobData;
        LockedJobData jobdata;

        /// Messaging data
        struct MessagingData
        {
                inline MessagingData()
                : gen_id(0)
                {
                }

                // Message id generator. FIXME: build a good unique id generator
                uint64_t gen_id;
        };

        typedef Blex::InterlockedData< MessagingData, Blex::Mutex > LockedMessagingData;
        LockedMessagingData messagingdata;

        /// Lock manager
        HSLockManager lockmanager;

    private:
        /// Generates the jobmgr_id for this JobManager.
        void GenerateJobManagerId();

        /// Main function for the timer thread
        void TimerThreadFunction();

        /// Main function for the worker threads
        void WorkerThreadFunction(unsigned id);

        /// Aborts all worker threads
        void AbortWorkerThreads();

        /// Clear all jobs (worker threads must already be terminated!)
        void ClearAllJobs();

        bool DoRun(VMGroup *group);

        /** Sets the running state of a VM group. Also manages the @a runnable queue.
            @param lock Lock on the job data of the jobmanager (needs to be taken to manipulate group running state)
            @param group Group to change the running state of
            @param newstate New running state for the group
        */
        void SetVMGroupState(LockedJobData::WriteRef &lock, VMGroup *group, RunningState::Type newstate);

        bool LockedTryLockVMGroup(LockedJobData::WriteRef &lock, VMGroup *group, UnlockCallback const &callback);
        void LockedUnlockVMGroup(LockedJobData::WriteRef &lock, VMGroup *group, UnlockCallbacks *unlock_callbacks, RunningState::Type *newstate);

        void GetGroupInfoUnlocked(VMGroup const &group, VMGroupInfo *info);

    public:
        /** Sets a simple error status in a return variable
            @param vm VM to set the return variable in
            @param id_set Variable that is going to contain the return status
            @param status Status to set
        */
        void SetSimpleErrorStatus(VirtualMachine *vm, VarId id_set, const char *status);

        /** Sets a success status in a return variable, including a message
            @param vm VM to set the status in
            @param id_set Variable that is going to contain the return status
            @param msgid Relevant id of a message
        */
        void SetOkStatus(VirtualMachine *vm, VarId id_set, uint64_t msgid);
        void SetOkStatus2(VirtualMachine *vm, VarId id_set, uint64_t msgid);
    private:
        /** Calls all the unlock callbacks in the list
            @param callbacks List of callbacks to execute
            @param state New state of the job that was just unlocked
        */
        void CallUnlockCallbacks(UnlockCallbacks *callbacks, RunningState::Type state);

        /// List of used worker threads
        std::vector< std::shared_ptr< Blex::Thread > > workers;

        /// Event to get the pipewaiter out of its waiting loop (when a new WaitForMultiple has arrived)
        Blex::StatefulEvent wfm_event;

        /** Checks wether a job is on the road to a specific state
            This means either
            - The actual running state of the job is equal to @a state
            - The state is 'Suspending', and the requested state is @a state
            - The state is 'Locked', and the original state is @a state
            @param lock Job data lock, needed to access running status
            @param group Group to check the status for
            @param state State that must be reached
        */
        static bool WillReachState(LockedJobData::WriteRef &lock, VMGroup *group, RunningState::Type state);

        /** Gathers all the current waits in jobs in the WaitForMultiple running state, and adds them to a pipewaiter.
            Sets running state of signalled jobs to Runnable.
            @param lock Job data lock, needed
            @param waiter Pipewaiter the waits must be added to
            @param timeout Will be filled with the min. timeout that has been set (the first that will expire)
            @param vmgroups Will be filled with all waiting vm groups
            @return First: if any job is already signalled (output object detected signalled when added to the pipewaiter,
                        running state has been switched to Runnable)
                    Second: Whether currently any job is waiting on any output object or with non-max timeout
        */
        std::pair< bool, bool > GatherWaitFors(LockedJobData::WriteRef &lock, Blex::PipeWaiter *waiter, Blex::DateTime *timeout, std::vector< VMGroupRef > *vmgroups);

        /** Checks all current waits in jobs if that are signalled after a pipe waiter has returned. Sets running state of
            signalled jobs to Runnable.
            @param lock Job data lock, needed
            @param waiter Pipewaiter whose wait has finished
            @param got_timeout Whether the pipewaiter returned timeout (if false, an object was signalled)
            @return Returns whether a job was found to be signalled (its running state has been changed to Runnable)
        */
        bool CheckWaitFors(LockedJobData::WriteRef &lock, Blex::PipeWaiter *waiter, bool got_timeout);

    public:
        /** Structure that describes a signal output object a VM is waiting on
        */
        struct OutputObjectWait
        {
                /** Handle that needs to be returned for this object (needed for redirection, the id returned by the
                    output object may not be the same as the id it was added with. We need to return the latter.
                */
                int32_t handle;

                /// Output object to wait for
                OutputObject *object;

                /// TRUE: wait for write, FALSE: wait for read
                bool write;
        };

        /// Get blob manager
        GlobalBlobManager & GetBlobManager();

        // ---------------------------------------------------------------------
        //
        // New ports mech
        //

        std::shared_ptr< IPCNamedPort > CreateNamedPort(std::string const &name);
        std::shared_ptr< IPCLinkEndPoint > ConnectToNamedPort(std::string const &name);

        /** Creates a IPC link (by building 2 endpoints and linking them)
            @param endpoint_1
            @param endpoint_2
        */
        void CreateIPCLink(std::shared_ptr< IPCLinkEndPoint > *endpoint_1, std::shared_ptr< IPCLinkEndPoint > *endpoint_2);

        // ---------------------------------------------------------------------
        //
        // Locks
        //

        HSLockManager & GetLockManager() { return lockmanager; }

        /** Waits until an object is signalled. This function is called from the HS function wrapper, and implements all its behaviour.
            @param vm VM that wants to wait
            @param id_set Return variable for the waitformultiple function
            @param waits List of objects to wait on
            @param timeout Wait until this time for signalled objects, otherwise return timeout.
        */
        void WaitForMultiple(VirtualMachine *vm, VarId id_set, std::vector< OutputObjectWait > const &waits, Blex::DateTime timeout);

        /** Yields the current running VM, giving other VMs a chance to run. The scheduling is done in a LIFO order.
            @param vm VM that wants to wait
        */
        void YieldVMWithoutSuspend(VirtualMachine *vm);

        inline Debugger & GetDebugger() { return *debugger; }
    private:

        /// Cache for messages etc, to avoid allocations
        struct Cache
        {
                /// Messages (max 64)
                std::vector< std::shared_ptr< IPCMessage2 > > messages;
        };

        typedef Blex::InterlockedData< Cache, Blex::Mutex > LockedCache;
        LockedCache cache;

        std::unique_ptr< Debugger > debugger;

        friend class Debugger;
};

/** Data that the job manager needs to put into VM groups.
*/
struct JobManagerGroupData
{
        JobManagerGroupData();

        /// Registration date for this group (JobManager.jobdata lock)
        Blex::DateTime creationdate;

        /// Unique group id for this group (JobManager.jobdata lock)
        std::string groupid;

        /// Current running state (managed by JobManager.jobdata lock)
        RunningState::Type state;

        /// Old state before vm group was locked
        RunningState::Type oldstate;

        /// Old state before vm was stopped by debugger
        RunningState::Type oldstatedebug;

        /// Requested state (set when state transition from running is requested)
        RunningState::Type reqstate;

        /// Pretermination (before closing ports) callback. FIXME: UGLY HACK!
        TerminationCallback pretermination_callback;

        /// Functions called when this group terminates.
        TerminationCallbacks termination_callbacks;

        /// List of functions to be called when this vm group can be locked
        UnlockCallbacks unlock_callbacks;

        /// VM that is currently waiting
        VirtualMachine *waitingvm;

        /// Result variable for suspending functions
        VarId id_set;

        /// Timeout for suspending function
        Blex::DateTime wait_timeout;

        /// List of output objects this VM is waiting for (read)
        std::vector< JobManager::OutputObjectWait > waits;

        /// Whether this group is cancellable (managed by JobManager.jobdata lock)
        bool iscancellable;

        /// Whether this blob has been cancelled
        bool iscancelled;

        /// Max nr of seconds this script is allowed to run (0 for no timeout)
        unsigned run_timeout_seconds;

        /// Whether this script is running for the timeout
        bool is_running_for_timeout;

        /// Timeout when script must be aborted
        Blex::DateTime running_timeout;

        /// Time this script started running last
        Blex::DateTime current_run_start;

        /// Time this script has been running
        Blex::DateTime total_running;

        /// Whether the script has high priority
        bool highpriority;

        /// External session data
        std::string externalsessiondata;

        /// Environment override
        std::shared_ptr< const Blex::Process::Environment > environment;
};

void InitIPC(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg);

/** A job object.
*/
class Job: public OutputObject
{
    private:
        /// Main group
        VMGroup *group;

        /// Is this object owner?
        bool must_delete;

    public:
        explicit Job(VirtualMachine *_vm, VMGroup *_group);
        ~Job();

        VMGroup * GetVMGroup() const { return group; }

        /// IPC link to child (cleared when registered as actual outputobject)
        std::shared_ptr< IPCLinkEndPoint > childipclink;

        void Release();

        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        /// Handles for captured output/handles + their breaking function
        std::map< int32_t, std::function< void() > > capture_handles;
};


/** Context data for the job manager, keeps all ports and jobs
    DON'T EVER MODIFY THOSE OUTSIDE 'RUNNING' STATE!
*/
struct JobManagerContextData
{
        inline JobManagerContextData() : inited_cols(false) { }
        /// List of named ports
        std::map< int32_t, std::shared_ptr< IPCNamedPort > > namedports;

        /// List of link endpoints
        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > > linkendpoints;

        /// List of jobs
        std::map< int32_t, std::shared_ptr< Job > > jobs;

        /// List of locks
        std::map< int32_t, std::shared_ptr< HSLock > > locks;

        bool inited_cols;
        inline void CheckColumnMappings(VirtualMachine *vm) { if (!inited_cols) InitColumnMappings(vm); }
        void InitColumnMappings(VirtualMachine *vm);

        HSVM_ColumnId col_status;       // "STATUS"
        HSVM_ColumnId col_msg;          // "MSG"
        HSVM_ColumnId col_msgid;        // "MSGID"
        HSVM_ColumnId col_replyto;      // "REPLYTO"
};
const int JobManagerContextId = 16;

typedef Blex::Context< JobManagerContextData, JobManagerContextId, void> JobManagerContext;

} // End of namespace HareScript

#endif
