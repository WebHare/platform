#ifndef blex_lib_dispat_impl
#define blex_lib_dispat_impl

//#define DISPATCHER_DEBUGDISPATCH        //Define to enable debugging
//#define DISPATCHER_MUTEXCHECKING        //Define to enable checked mutexes (Debug::Mutex)
//#define DISPATCHER_SOCKETCHECKING       //Define to enable checked sockets (Debug::Socket with errorchecks enabled)
//#define DISPATCHER_SOCKETCHECKING_ALL   //Define to enable checked full debugging sockets (Debug::Socket with errorchecks enabled)

#include <vector>
#include <ctime>
#include <queue>
#include <list>
#include <set>
#include <sys/poll.h>
#include <map>
#include "datetime.h"

#include "crypto.h"
#include "dispat.h"
#include "objectowner.h"
#include "threads.h"
#include "socket.h"
#include "pipestream.h"

namespace Blex {

class Poller
{
        public:

        struct SignalledFd
        {
                int fd;
                bool is_readable;
                bool is_writable;
                bool is_hup;
        };

        void UpdateFDWaitMask(int fd, bool update_read, bool want_read, bool update_write, bool want_write);
        bool IsReadable(int fd);
        bool IsWritable(int fd);
        bool IsHup(int fd);
        int DoPoll(Blex::DateTime until);

        void ExportSignalled(std::vector< SignalledFd > *signalled);

        private:
        std::vector<pollfd> poll_data;
        std::map<int,unsigned> posmask;
};


namespace Dispatcher {
namespace Detail {

#ifdef DISPATCHER_MUTEXCHECKING
  typedef Blex::DebugMutex DispatchMutex;
  typedef Blex::DebugConditionMutex DispatchConditionMutex;
#else
  typedef Blex::Mutex DispatchMutex;
  typedef Blex::ConditionMutex DispatchConditionMutex;
#endif
#ifdef DISPATCHER_SOCKETCHECKING
  typedef Blex::DebugSocket DispatchSocket;
#else
  typedef Blex::Socket DispatchSocket;
#endif

} //end namespace Blex::Dispatcher::Detail
} //end namespace Blex::Dispatcher
} //end namespace Blex

#define DISPAT_POLL

#ifdef PROFILE
#define DISPATCHER_SINGLETHREADED
#endif

#if defined(DISPATCHER_DEBUGDISPATCH) && defined(DEBUG)
#define DEBUGDISPATCHPRINT(x) DEBUGPRINT(x)
#else
#define DEBUGDISPATCHPRINT(x) BLEX_NOOP_STATEMENT
#endif

namespace Blex {
namespace Dispatcher {
namespace Detail {

class Main;

///////////////////////////////////////////////////////////////////////////////
//
// POSIX specific data
//
class PosixData
{
       class IntraThreadCommand;

        public:

        enum CommandCode { Abort, AddReader, AddWriter, RemoveReader, RemoveWriter, CloseSocket, Wakeup };

        void POSIX_SendCommand(IntraThreadCommand const &cmd);

        PosixData(Main &main);

        ~PosixData();

        void CancelNextWorker();

        /** Asynchronous interrupt call - intended to be called form SIGINT handler */
        bool InterruptHandler(int sig);

        /** Activate and 'wake up' a connection structure */
        void WakeUpConnection(Conn *connection);

        /** Check all structures, parsing their events. */
        void CheckDispatchables_Bosspipe();

        void AddListeningFd(int fd);
        void RemoveListeningFd(int fd);

        /// Closes the socket fd
        void CloseDispatchSocket(DispatchSocket &socket);

        void Stop();

        /** Subthread code for worker threads */
        void WorkerThreadCode();

        private:
        Conn* POSIX_GetTask(Conn *last_task, bool last_conn_slept);

        struct LockedData
        {
                LockedData();

                //How many threads are currently active
                unsigned running_threads;
                //How many threads can be active at most (overload prevention)
                unsigned max_running_threads;
                //Is a thread working on select?
                bool thread_in_select;

                std::queue<Conn*> waiting_conns;
                bool abort;
        };
        typedef Blex::InterlockedData<LockedData,DispatchConditionMutex> LockedSharedData;
        LockedSharedData posixdata;

        class IntraThreadCommand
       {
               public:
               IntraThreadCommand(CommandCode _code, int _fd) : code(_code) { DEBUGONLY(data.conn=0); data.fd=_fd; }
               IntraThreadCommand(CommandCode _code, Conn *_conn) : code(_code) {data.conn=_conn; }

               CommandCode code;
               union
               {
                       int fd;
                       Conn *conn;
               } data;
       };

        //ADDME: Can we merge ITCQueue and Lockeddata structures?
        struct ITCQueue
        {
                std::queue< IntraThreadCommand > the_queue;
        };
        typedef Blex::InterlockedData<ITCQueue,DispatchConditionMutex> LockedITCQueue;
        LockedITCQueue itcqueue;

        void ProcessITCQueue();
        void CheckDispatchables(std::vector< Poller::SignalledFd > const &signalled);

        Poller poller;
        PipeSet posix_bosspipe;

        Main &main;

        friend class Conn;
};



/** Shared connection state

    Tasks:
       when a task is sent, it is registered in two places: the sender and the
       receiver.
       The receiver keeps the task in either pending_tasks or running_tasks, until
       it has returned the task to the sender. This sender won't be notified
       for reuse until all tasks are gone.

       Tasks won't be executed anymore after the hangup signal.
*/
struct State
{
        enum Flags
        {
                ///The socket has been completely closed
                Closed                 = 0x00000100,
                ///The connection is being handled
                Running                = 0x00000200,
                ///Input is available!
                POSIXInputReady        = 0x00001000,
                ///Output is available!
                POSIXOutputReady       = 0x00002000,
                ///The connection is waiting for a remote task completion
                WaitingForRemoteTask   = 0x00004000,

                ///This connection does not want to receive any more input
                StopIncomingData       = 0x00008000,
                ///Connection was marked as possibly sleeping
                POSIXSleeping          = 0x00010000,
                ///Has the client been told a hangup is pending
                ToldHangup             = 0x00020000
        };

        void Clear();

        /** Queue of buffers ready for transmission */
        QueuedSendData queueddata;
        /** Queue of to-be-encrypted buffers ready for transmission */
        QueuedSendData ssl_queueddata;
        /** Number of blocks sent out but not reported */
        unsigned blockssent;
        /** Number of SSL data blocks sent out but not reported */
        unsigned ssl_blockssent;
        /** Number of SSL queued in the current outstanding block */
        unsigned ssl_queuedsize;

        /** Inbound data buffer length. Filled in by the dispatcher before
            it calls HookIncomingData. HookIncomingData should not modify this
            value */
        unsigned inbuflen;

        /** When to wake up the client? */
        DateTime wakeup;

        /** Tasks that are waiting to be executed on this connection. State owns the objects
            in these lists, and destroyes them on calling Clear().
        */
        std::list< Task * > pending_tasks;

        /** Tasks that are currently executing on this connection. State owns the objects
            in these lists, and destroyes them on calling Clear().
        */
        std::list< Task * > running_tasks;

        /** List of currently signalled events
        */
        std::vector< Event * > signalled_events;

        unsigned flags;
        unsigned pending_signals;
};
std::ostream& operator <<(std::ostream &out,State const &rhs);

class Conn : public Blex::Detail::EventWaiterBase
{
        public:
        ~Conn();

        Conn(Main &disp, Connection &conn);

        /** Get the listening address of the connection.
            MT-safe: This function is always safe to call, from any thread */
        SocketAddress const& GetListeningAddress() const
        { return listening_address; }

        /** Get the local (server side) address of the connection.
            MT-safe: This function is always safe to call, from any thread */
        SocketAddress const& GetLocalAddress() const
        { return socket.GetLocalAddress(); }

        /** Get the remote (connecting side) address of the connection.
            MT-safe: This function is always safe to call, from any thread */
        SocketAddress const& GetRemoteAddress() const
        { return socket.GetRemoteAddress(); }

        /** Clear 'x' bytes of incoming data
            @param numbytes Number of byte sto clear
            @return New data starting pointer */
        uint8_t const *ClearIncomingData(unsigned numbytes);

        /** Queue data for sending over the socket. The dispatcher will ensure
            that HookIncomingData will not be called anymore until all queued
            data is sent, and the caller must guarantee that the buffer remains
            intact until HookSendQueueEmpty() is called.
            QueueSend supports asynchronous calls */
        void AsyncQueueSend(unsigned numbufs, SendData const *data);

        /** AsyncSignal can be called by any thread asynchronously to force
            a synchronized HookSignal call to be done on this connection.
            @returns Whether the signal will be (or already is) delivered */
        bool AsyncSignal(Signals::SignalType signal);

        /** Set or reset a timer, after which we demand to be woken up
            @param wakeup (absolute) wake up time, or 0 to disable the timer
            @param grace_period It's a grace period timer */
        void SetTimer(DateTime wakeup, bool grace_period);

        /** Queues a task on another connection
            @param receiver Connection to send the task to
            @param task Task that the receiver must execute, dispatcher will take ownership of this task
            @param want_response Is a response required? If so, no tasks or messages
               will be sent to the sender until the task has completed. If yes, HookExecuteTask will
               be called in the context of the sender with this object. Only one blocking task
               may be active at a time.
        */
        void QueueRemoteTask(Connection *receiver, std::unique_ptr< Task > &task, bool want_response);

        /** Marks a running task as finished */
        void MarkTaskFinished(Task *task, bool success);

        /** Mark this connection as sleeping */
        void OS_MarkAsSleeping();

        /** Start/stop incoming data events. Use for flow control */
        void EnableIncomingData(bool enable);

        /** Returns whether any sends are still pending */
        bool AnySendsPending();

        /** Is this connection secure? */
        bool IsConnectionSecure() const
        {
                return ssl_conn.get() != NULL;
        }

        /** Add an event to the list of the events that are check for signalled state
        */
        void AddEvent(Event *event);

        /** Remove an event from the list of the events that are check for signalled state
        */
        void RemoveEvent(Event *event);

        /** Enable/disable nagle algorithm on the socket
        */
        void SetNagle(bool newvalue);

        typedef DispatchMutex StateMutex;

        private:
        DispatchSocket socket;

        static unsigned const InbufferSize = 8192;

        void GotDisconnection(bool graceful_close);

        void ParseSSLInboundData(StateMutex::ScopedLock *mylock);
        void OS_Construct();

        /** Push output data into the SSL layer, schedule SSL encrypted data for sending
            @return Whether any data was fed into SSL. If not, SSL probably waits for incoming data
        */
        bool DoSSLOutput();
        void DoSSLPrepareOutputForSending();



        /** Clear 'x' bytes of incoming data
            @param numbytes Number of byte sto clear
            @return New data starting pointer */
        uint8_t const *ClearIncomingDataFromInbuf(unsigned numbytes);

        /** Indicate that we want to read new incoming data.
             signal the select() that we want read notification */
        void OS_PostNewRead(StateMutex::ScopedLock *mylock);

        /** Connection was cancelled, see if we can stop some outgoing requests */
        void OS_CancelRequests(StateMutex::ScopedLock *mylock);

        /** Close a socket */
        void OS_CloseSocket();

        /** Try to send outgoing data
            @return Number of blocks actually sent (remainder may be async scheduled) */
        unsigned OS_TryOutgoingSend();

        /** Do outgoing send, with a statelock already active */
        bool LockedDoSend();

        /** Copy non-empty senddata buffers to a locked queue
            @param numbufs Number of buffers to queue
            @param data Buffers to add to the queue
            @param out Locked senddata queue
        */
        void CopyToQueuedData(unsigned numbufs, SendData const *data, QueuedSendData *out);

        /** Returns false if the connection went to sleep */
        bool FinishHandlingConnection(StateMutex::ScopedLock *statelock);

        /** Read as much incoming data as possible. Assumes that the sharedlock is active. */
        void OS_ReadIncomingData();

        ///Handle OS specific events, and return false if there was no event to handle
        bool OS_HandleEvents(StateMutex::ScopedLock *mylock);

        ///Parse data and send whatever we can (Worker callback)
        void DoParse(StateMutex::ScopedLock *mylock);

        // Is any task ready for immediate execution?
        bool AnyReadyTask(StateMutex::ScopedLock *mylock);

        // Report event is signalled
        void DoEventSignalled(StateMutex::ScopedLock *mylock);

        ///Report blocks transferred
        void DoBlocksSent(StateMutex::ScopedLock *mylock);

        ///Execute tasks (Worker callback)
        void DoTask(StateMutex::ScopedLock *mylock);

        ///Clear the signal and call the handler (Worker callback)
        void DoSignal(Signals::SignalType signal, StateMutex::ScopedLock *mylock);

        /** Clear bytes from the sent buffer. The number of bytes passed
            will be substracted from send_buffers, using a FIFO method. */
        void DequeueSentBytes(unsigned numbytes);

        /** Returns a finished task to its sender (if the sender wants notification)
            @param task Task to return to the sender (is always destroyed)
            @param new_state New state of task (either TaskState::Complete or TaskState::Failed
        */
        void TryReturnTaskToSender(std::unique_ptr< Task > &task, TaskState::Type new_state);

        /** Sets the current signalled status of an event (callback called when signalled status
            of an event changes
        */
        void SetEventSignalled(Event &event, bool signalled);

        /** Removes all currently registered events. Does not clear the signalled list
        */
        void RemoveAllEvents();


        Blex::SocketAddress listening_address;

        ///State lock object (cannot use InterlockedData here (yet?))
        StateMutex statemutex;

        ///connection state
        Detail::State state;

        ///Reference to the central dispatcher
        Main &dispmain;
        ///Reference to the associated connection
        Connection &callbacks;

        /** Inbound data buffer. Filled in by the dispatcher before it calls
            HookIncomingData. HookIncomingData should not modify this buffer. */
        uint8_t inbuf[InbufferSize];

        /** Is an idle grace timer active for this connection? */
        bool in_idle_grace;

        /** Is the last set timer a grace period timer? */
        bool curtimerisgrace;

        ///SSL structure, if required for this connection
        std::unique_ptr<SSLConnection> ssl_conn;

        std::vector< Event * > waitevents;

        /// Time this connections has a signal pending (in Main::TimerData::warn_connections list)
        Blex::DateTime registered_timer;

        friend class Main;
        friend class PosixData;
        friend class NTData;
        friend class AcceptThread;
};

struct ListenPort
{
        ListenPort(ListenAddress const &address)
        : bindaddress(address)
        , acceptsocket(Socket::Stream)
        , listening(false)
        , isnamedpipe(false)
        {
        #ifdef DISPATCHER_SOCKETDEBUGGING
                acceptsocket.SetDebugMode(Socket::Calls);
        #endif
        }

        ListenAddress bindaddress;
        DispatchSocket acceptsocket;
        bool listening;
        bool isnamedpipe;
        std::shared_ptr<SSLContext> ssl;
};


/** A general dispatcher, which implements a select() (or similair) loop
    and multiplexes several objects doing socket I/O.
    Multithreading considerations: Dispatcher is not thread-safe. */
class Main
{
        public:
        Main(Dispatcher::CreateConnectionCallback const &callback);
        virtual ~Main();

        /** Start the dispatcher. It will continue running until it is asynchronously aborted */
        void Start (unsigned numworkers, int idlegrace, bool signalnewconnection);

        /** Get the number of listening ports actually open. Used to check
            whether we actually bound to any port */
        unsigned CountListeningPorts() const;

        /** Configure the dispatcher's listening ports */
        void UpdateListenPorts(unsigned numports, ListenAddress const ports[]);

        /** Mark a connection structure as Free */
        void MarkAsFree(Conn *connection);

        void RemoveConnectionFd(int fd);

        /** Request a signal at the specified time
            @param signal_at Absolute time for signal, or 0 to disable any running timer */
        void RequestSignal(DateTime signal_at, int fd, Conn *receiver);

        /** Try to rebind any unbound sockets.
            @return True if all sockets are succesfully bound */
        bool RebindSockets(std::vector<ListenAddress> *broken_listeners);

#if defined(DISPAT_POLL)
        typedef PosixData OSData;
#endif
        ///OS-specific dispatcher code
        OSData os;

        private:
        struct OpenPort
        {
                OpenPort(int _fd,Conn*_conn)
                : fd(_fd)
                , conn(_conn)
                {
                }

                int fd;
                Conn *conn;
        };

        typedef std::shared_ptr<ListenPort> ListenPortPtr;

        typedef std::vector<ListenPortPtr> ListenPortList;

        typedef std::map<int, OpenPort> OpenPorts;

        struct SharedData
        {
                inline SharedData() : shutting_down(false) {}

                ListenPortList accepts;
                OpenPorts openports;
                ObjectOwner<Connection> conn_structures;

                bool shutting_down;
                std::vector<Conn*> free_conns;
        };
        typedef InterlockedData<SharedData,DispatchMutex> LockedSharedData;

        /** Create a new connection structure */
        Conn* CreateConnectionStructure(LockedSharedData::WriteRef &writeref);

        /** Handle an incoming connection (datalock must already be held)*/
        Conn* AcceptIncomingTCP(ListenPort &accepter,LockedSharedData::WriteRef &lock);

        Conn* PrepareAcceptIncoming(LockedSharedData::WriteRef &lock);
        bool CompleteAcceptIncoming(ListenPort &accepter, Conn *conn);
        /** List of used worker threads */
        std::vector< std::shared_ptr<Blex::Thread> > workers;

        /** Initial grace period for idle connections */
        int idlegrace;

        /** Signal new connections? */
        bool signalnewconnection;

        Dispatcher::CreateConnectionCallback const connectioncallback;

        ///Asynchronously inform us that bindings have changed
        void AsyncBindingChange();

        class TodoItems
        {
            public:
                struct Warning
                {
                        int fd;
                        Conn *conn;
                        DateTime date;
                };

                bool rebind_check;
                bool abort;
                std::vector< Warning > to_warn;

                void Reset()
                {
                        rebind_check = false;
                        abort = false;
                        to_warn.clear();
                }
        };

        ///TimerData locked
        struct TimerData
        {
                ///Set to true to abort the timer thread
                bool must_abort;
                ///When to do our next round of checking?
                DateTime next_checks;
                ///A list of connections which require a warning at a specific time
                std::set< std::pair< DateTime, std::pair< int, Conn* > > > warn_connections;
        };

        /** Attempt to bind the accepter to the specified address
            @return true if the bind succeeded, false upon failure */
        SocketError::Errors BindPort(ListenPort &port);

        void TimerThreadCode();

        /** Dequeue next thing to do. Waits until 'something' needs to be done */
        void GetNextTodo(TodoItems &to_do);


        /** Maintain connections (Done every 60 seconds) */
        void MaintainConnections();

        ///Asynchronously stop the timer
        void AsyncStopTimerThread();

        ///Send disconnect messages to all connections (for gracefull shutdown)
        void AbortAllConnections();


        typedef Blex::InterlockedData<TimerData, DispatchConditionMutex> LockedTimerData;
        LockedTimerData timerdata;

        /** The total shared data (note: connections may refer to timers, so
            this structure must appear AFTER the timer data) */
        LockedSharedData shareddata;

        Blex::Thread timerthread;

        friend class Conn;
        friend class PosixData;
        friend class AcceptThread;

        Main(Main const &) = delete;
        Main& operator=(Main const &) = delete;
};

} //end namespace Blex::Dispatcher::Detail
} //end namespace Blex::Dispatcher
} //end namespace Blex

#endif
