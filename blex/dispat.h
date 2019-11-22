#ifndef blex_dispat
#define blex_dispat

#ifndef blex_socket
#include "socket.h"
#endif
#include <ctime>
#include <vector>

namespace Blex
{

class Event;

namespace Dispatcher
{

struct ListenAddress
{
        ListenAddress()
        : lasterror(SocketError::NoError)
        {
        }

        SocketAddress sockaddr;
        std::string privatekey;
        std::string certificatechain;
        std::string ciphersuite;
        SocketError::Errors lasterror;
};


namespace Detail
{
        class Main;
        class Conn;
}

class Dispatcher;
class Connection;

///Dispatcher supported signals
namespace Signals
{
        enum SignalType
        {
                /** We must tell the client he has been signalled. This must
                    be the highest priority - any signalled client must be
                    able to deal with it before disconnect (which kills the
                    signalled state) so that it can 'pass along' the signal
                    if necessary to another connection */
                Signalled          = 0x00000001,
                /** We must tell the client he has been hung upon  */
                Hangup             = 0x00000002,
                /** We must tell the client he is being disconnected  */
                ConnectionClosed   = 0x00000004,
                ///A new connection arrived. This signal is only reported if enabled with Start()
                NewConnection      = 0x00000008,
                ///We must tell the client the timer has elapsed
                TimerElapsed       = 0x00000010,
                ///We must tell the client the grace period has elapsed
                GracePeriodElapsed = 0x00000020,
                ///EOF received (graceful close of reading channel)
                GotEOF             = 0x00000040
        };
        std::string BLEXLIB_PUBLIC GetName(SignalType type);
} //end namespace Blex::Dispatcher::Signals

/// States in which a task can be
namespace TaskState
{
        enum Type
        {
        Waiting,        ///< This task is waiting to be executed (seen in context of receiver)
        Running,        ///< This task was offered for execution, but wasn't completed immediately (never externally visible)
        Completed,      ///< The task has completed succesfully (seen in context of sender)
        Failed          ///< The task has failed (receiver threw or disappeared)  (seen in context of sender)
        };
        std::string BLEXLIB_PUBLIC GetName(Type type);
} //end namespace Blex::Dispatcher::TaskState

/** Structure holding one or more data blocks we wish to send */
struct SendData
{
        SendData(void const *buffer, unsigned buflen)
        : buffer(buffer),buflen(buflen)
        {
        }

        ///Pointer to buffer to send
        void const *buffer;
        ///Length of the bufer to send
        unsigned buflen;
};

/** List of pending outbut buffers */
typedef std::vector<SendData> QueuedSendData;

/** Unqueue already sent bytes
    @param data Buffers sent
    @param numbytes Number of bytes to deque
    @return Number of complete blocks dequeued*/
unsigned DequeueOutgoingBytes(QueuedSendData &data,unsigned numbytes);


/** DispatcherTask are sent from connection to connection, to execute tasks in
    the context of the receiving connection. It can be used by deriving a
    class which executes the needed task, which can used the receiver connection
    in which context it is executed.
    The GetState function can be used to determine whether this task is invoked
    in the context of the called task or in the sending task.
*/
class BLEXLIB_PUBLIC Task
{
    public:
        /** Virtual destructor; this class is inherited from
        */
        virtual ~Task();

        /// Retrieve the current state of the task
        inline TaskState::Type GetState() const { return state; }

        /// Return the time of the original queueing of the task
        inline DateTime GetQueueingTime() const { return queueingtime; }

    private:
        /// Current state
        TaskState::Type state;

        /// Sender of this task
        Connection *sender;

        /// Is this task blocking the sender?
        bool is_blocking;

        /// When was this task queued?
        DateTime queueingtime;

        friend class Detail::Conn; //needed?
        friend class Detail::Main; //needed?
};


/** DispatchConnections are used to hold connection structures and manage
    the connections created by a DispatchAccepter. The Dispatcher will
    synchronize all its calls to Hook* functions, ensuring that only one will
    be called at any time on a connection.

    No hook is provided for connection acceptance. The subclass is expected
    to always be in a 'ready to process' state, so the constructor and
    HookSignal(DispatchSignal::Disconnected) should take care of preparing
    for a new connection.

    Users of this class may NOT invoke any of the virtual functions. All
    protected member functions are MT-safe, they can be called from any thread
    at any moment.
*/
class BLEXLIB_PUBLIC Connection
{
    protected:
        /** Connection constructor
            @param dispatcher Reference to the dispatcher, as was passed to the creation callback */
        Connection(void *dispatcher);

        /** Mark connection as 'sleeping', so that the dispatcher will not
            consider it running, and will be able to allow other threads to work.
            This function is necessary when a thread will be doing
            non-CPU-intensive work. Threads will loose their 'sleeping' state
            as soon as they return from their current Hook* function */
        void MarkAsSleeping();

        /** Clear 'x' bytes of incoming data
            @param numbytes Number of bytes to clear
            @return New data starting pointer */
        uint8_t const *ClearIncomingData(unsigned numbytes);

        /** HookIncomingData should be overriden by a function that reads
            the bytes in the buffer [start,limit[, and processes them as
            a request. It will only be called if the connection is in Receive mode,
            ie: there are no outstanding sends

            @param start Start of the data bytes
            @param bufferlen Number of data bytes
            @return Pointer to the limit of the parsed range (return limit if all was parsed) */
        virtual void HookIncomingData(uint8_t const *start, unsigned bufferlen)=0;

        /** HookSignal should be replaced by a function that acts upon the
            receipt of an AsyncSignal or internal event.

            @param signal Signal that was raised
            */
        virtual void HookSignal(Signals::SignalType signal) = 0;

        /** HookDataBlocksSent should be replaced by a function that handles send
            completion.
            @param numbuffers Number of buffers sent. Only complete blocks
            as passed to AsyncQueueSend will be reported, and their memory can
            be reused after HookDataSent reports their completion
            */
        virtual void HookDataBlocksSent(unsigned numbuffers) = 0;

        /** HookExecuteTask should be replaced by a function that acts upon the
            receipt of an task. There are no different functions for normal execution
            and for replies, use task->GetState() to determine in which context
            this task is executed.
            @param task Task that has to be executed
            @return Whether the task was completed (only valid when task state
                is TaskState::Waiting.
            */
        virtual bool HookExecuteTask(Task *task) = 0;

        /** HookEventSignalled should be replaced by a function that acts upon
            the possibility that a registered event is signalled. This function
            will be called *while* any registered event might be signalled.
            @param event Signalled event
        */
        virtual void HookEventSignalled(Event *event) = 0;

        /** AsyncHookSignal allows a client to directly discover that a signal
            has been queued. AsyncHookSignal is called immediately when the
            signal is set, and does not suffer from coalescing of events.
            \warning This function can be called concurrently with any Hook* function!

            @param signal Signal number of the raised signal */
        virtual void AsyncHookSignal(Signals::SignalType signal);

        /** Get the binding that received this connection. This may differ
            from GetLocalAddress when socketlistener ports are used */
        SocketAddress const& GetListeningAddress() const;

        /** Get the local (server side) address of the connection. */
        SocketAddress const& GetLocalAddress() const;

        /** Get the remote (connecting side) address of the connection.  */
        SocketAddress const& GetRemoteAddress() const;

    public:
        /** Destructor */
        virtual ~Connection();

        /** Queue data for sending over the socket. The dispatcher will ensure
            that HookIncomingData will not be called anymore until all queued
            data is sent and no task is executed. The caller must guarantee that
            the buffer remains intact until HookDataSent() is called.
            QueueSend supports asynchronous calls
        */
        void AsyncQueueSend(unsigned numbufs, SendData const data[]);

        /** AsyncSignal can be called by any thread asynchronously to force
            a synchronized HookSignal call to be done on this connection. Signals are
            guaranteed to be delivered, unless false is returned.
            @param Signal to send
            @return Whether signal will be delivered. */
        bool AsyncSignal(Signals::SignalType signal);

        /** Queues a task for another connection, and returns immediately. The
            receiving connection structure MUST exist while this function is executed.
            The current connection will continue to exist until a completion function on
            the task has been called; make sure that the task structure is not destroyed
            before that.
            HookIncomingData will not be called on this connection until the task has completed.
            ADDME: cycle detection?
            @param receiver Receiving connection structure
            @param task Task to execute.
            @param blocking Must all other tasks and data be blocked during execution of this task?
        */
        void QueueRemoteTask(Connection *receiver, std::unique_ptr< Task > &task, bool blocking);

        /** Marks a task as finished
            @param task Task to mark
            @param success Whether the task was successfully completed
        */
        void MarkTaskFinished(Task *task, bool success);

        /** Schedule a connection close. The actual close will be serialised,
            after any current Hook* function exits */
        void AsyncCloseConnection()
        {
                AsyncSignal(Signals::Hangup);
        }

        /** Start/stop incoming data events. Use for flow control */
        void EnableIncomingData(bool enable);

        /** Set or reset a timer, after which we demand to be woken up. No timer signal
            will be sent before the wakeup time; but it might be somewhat later.
            @param wakeup (absolute) wake up time, or 0 to disable the timer */
        void SetTimer(Blex::DateTime wakeup);

        /** Returns whether any sends are still pending
        */
        bool AnySendsPending();

        /** Is this connection secure? */
        bool IsConnectionSecure() const;

        /** Add an event to the list of events that are waited for */
        void AddEvent(Event *event);
        /** Remove an event from the list of events that are waited for */
        void RemoveEvent(Event *event);
        /** Enable/disable the nagle algorithm */
        void SetNagle(bool newvalue);

        private:
        Detail::Conn *const conn;

        friend class Detail::Main;
        friend class Detail::Conn;
};

/** A general dispatcher, which implements a select() (or similair) loop
    and multiplexes several objects doing socket I/O.
    Multithreading considerations: Dispatcher function calls are not thread-safe. */
class BLEXLIB_PUBLIC Dispatcher
{
        public:
        /** Callback that creates your connection type */
        typedef std::function< Connection*(void*) > CreateConnectionCallback;

        /** Initialize the dispatcher
            @param create_connection Callback function that provides us with connection structures */
        Dispatcher(const CreateConnectionCallback &create_connection);

        /** Destroy dispatcher data */
        ~Dispatcher();

        /** Start the dispatcher. It will continue running until it is asynchronously aborted
            @param numworkers Number of worker threads to start (keep this higher than 2*reasonable CPUs, it is not the maximum number of _parallel_ threads)
            @param idlegrace Number of seconds a connection may stay idle after being opened.
                             After this time, a GracePeriodElapsed event will be fired for any
                             idle connection.
            @param signalnewconnection Send a signal when a new connection comes in
        */
        void Start (unsigned numworkers, int idlegrace, bool signalnewconnection);

        /** Get the number of listening ports actually open. Used to check whether we actually bound to any port */
        unsigned CountListeningPorts() const;

        /** Asynchronous interrupt call - intended to be called form SIGINT handler */
        bool InterruptHandler(int sig);

        /** Configure the dispatcher's listening ports */
        void UpdateListenPorts(unsigned numports, ListenAddress const ports[]);

        /** Try to rebind any unbound sockets.
            @param broken_listeners If not NULL, a vector that is filled with a list of failing ListenAddress
            @return True if all sockets are succesfully bound*/
        bool RebindSockets(std::vector<ListenAddress> *broken_listeners);

        private:
        Detail::Main *const impl;

        friend class Connection;
};

} //end namespace Blex::Dispatcher

} //end namespace Blex

#endif
