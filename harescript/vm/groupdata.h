#ifndef blex_harescript_vm_groupdata
#define blex_harescript_vm_groupdata

#include "hsvm_constants.h"
#include <blex/threads.h>

namespace HareScript
{

class OutputObject;
class VMGroup;

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

/// List of unlock callback functions
typedef std::function< void(int) > UnlockCallback;
typedef std::vector< UnlockCallback > UnlockCallbacks;
typedef std::function< void() > TerminationCallback;
typedef std::map< int32_t, TerminationCallback > TerminationCallbacks;

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
        std::vector< OutputObjectWait > waits;

        /// Whether this group is cancellable (managed by JobManager.jobdata lock)
        bool iscancellable;

        /// Whether this blob has been cancelled
        bool iscancelled;

        /// Report errors via the joberrorreport callback
        bool reporterrors;

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
        std::shared_ptr< const Blex::Environment > environment;
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

        static void RemoveReference(VMGroup *group);

        friend class JobManager;
};

} // namespace HareScript

#endif
