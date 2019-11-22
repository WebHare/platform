#ifndef blex_webhare_schedule_processmgr
#define blex_webhare_schedule_processmgr

#include <blex/pipestream.h>
#include <blex/logfile.h>
#include <iostream>

class SubProcess;
class ProcessManager;

namespace ProcessEvents
{
        ///Subprocess events
        enum Event
        {
                ///A full line of output was pared
                Output,
                ///A full line of errors was parsed
                Error,
                ///A process-related timeout
                TimerExpired,
                ///Process died
                ProcessDied,
                ///Process manager is shutting down, please terminate the process
                AllShuttingDown
        };
}

typedef std::function< void(SubProcess*, ProcessEvents::Event, std::string) > ProcessCallback;

class SubProcess
{
public:
        /** @short Set a process timeout. Resets any previous timeout
            @param seconds Relative time in seconds when the timeout is triggered. 0 to clear any timeout. */
        void SetTimeout(unsigned seconds);

        /** @short Send a command to the process */
        void SendCommand(std::string const &cmdline);

        ~SubProcess();

private:
        SubProcess(std::string const &tag);

        /** @short Try to flush output buffer */
        void TryFlushOutput();

        ///The stream from which we receive status reports
        Blex::PipeReadStream *results;
        ///The stream from which we receive errors
        Blex::PipeReadStream *errors;
        ///The stream to which we need to send commands
        Blex::PipeWriteStream *control;
        ///The actual hare process
        Blex::Process process;

        /// Current read result line
        std::string resultline;
        /// Current read error line
        std::string errorline;
        /// Current warning timer
        Blex::DateTime warntimer;
        /// Output buffer
        std::vector<char> outputbuffer;
        /// End process flag (handling this is delayed until the main loop runs again)
        bool end_process;
        /// Process name tag
        std::string const tag;

        /// Process event callback
        ProcessCallback callback;

        friend class ProcessManager;
};

class ProcessManager
{
public:
        typedef std::function< void() > SynchronizedFunction;

        ProcessManager();

        ~ProcessManager();

        /** Shutdown the process manager. This function is safe to call asynchronously
            @param error_message Error message, if any (reason for shutdown request). The process manager will
                   ignore this message if it was already shutting down (as a shutdown causes many errors) */
        void Shutdown(std::string const &error_message);

        /** Do a synchronous call inside the process manager thread.This function is safe to call asynchronously */
        void CallSynchronized(SynchronizedFunction const &tocall);

        /** Do a synchronous call inside the process manager thread.
            This function is safe to call asynchronously, and will place the
            command at the frond of the queue (for interactive requests) */
        void CallSynchronizedInteractive(SynchronizedFunction const &tocall);

        /** Run the process manager, letting it invoking callbacks until its
            shutdown function is called */
        void Run();

        /** Start a new process
            @param tag A tag to identify the process (mostly used for debugging)
            @param processname Name of the process binary
            @param arguments Arguments for the process binary
            @param callback Callback function for process events (required)
            @param at_idle_priority Run this task at a lower priority
            @return A pointer to the subprocess, or NULL if it could not be started
        */
        SubProcess *StartProcess(std::string const &tag
                                ,std::string const &processname
                                ,std::vector<std::string> const &arguments
                                ,ProcessCallback const &callback
                                ,bool at_idle_priority
                                );

        /** End an existing process and delete the object (deletion is delayed until the Run() is finished, if the processmgr is shutting down) */
        void EndProcess(SubProcess *process);

        /** Are we shutting down? */
        bool IsShuttingDown() const { return processmgr_shutdown != Blex::DateTime::Max(); }
private:
        /** Add a synchronized call
            @param interactive If true, put on the interactive list */
        void AddSyncCall(SynchronizedFunction const &tocall, bool interactive);

        typedef std::list< std::shared_ptr<SubProcess> > SubProcessList;
        SubProcessList subprocesses;
        Blex::PipeWaiter waiter;

        typedef std::shared_ptr<SynchronizedFunction> FunctionPtr;
        typedef std::queue<FunctionPtr> FunctionCallQueue;

        struct FunctionQueues
        {
                ///High priority (interactive usage) calls
                FunctionCallQueue interactive_calls;
                ///Normal calls (no real hurry)
                FunctionCallQueue normal_calls;
        };

        typedef Blex::InterlockedData<FunctionQueues,Blex::Mutex> LockedQueue;

        Blex::DateTime BuildWaitList(Blex::PipeWaiter &waiter, Blex::DateTime shutdowntime);

        FunctionPtr PopCommand();

        /** @short Shutdown function */
        void SyncShutdown(std::string const &errormessage);

        /** @short Handle incoming data for a proces */
        void ProcessIncomingData(SubProcess *subproc, bool is_output);
        ///Send a command to the queue
        void SendCommand(unsigned code, unsigned data);

        void InnerLoop();
        ///Are there any non-ended processes?
        bool AnyUnendedProcesses() const;

        /// shared data for async commands
        LockedQueue functioncallqueue;

        /// Our command pipe
        Blex::PipeSet commpipe;

        /// When do we have to shut down
        Blex::DateTime processmgr_shutdown;

};

#endif

