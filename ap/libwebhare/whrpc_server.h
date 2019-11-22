#ifndef blex_webhare_ap_libwebhare_rpcserver
#define blex_webhare_ap_libwebhare_rpcserver

#include <blex/threads.h>
#include <blex/dispat.h>
#include "whrpc.h"
//#include "../libwebhare/dbase.h"
//#include "dbase_types.h"

namespace Database
{

class RPCTask;
class RPCConnection;
//class RPCRawConnection;

namespace RPCResponse
{
/// Types of response on a received RPC message
enum Type
{
Respond,                ///< Normal responce is available
RespondAsync,           ///< Async response is available (only used now at places where plain Respond would be expected)
DontRespond,            ///< Action went ok, but no response available
Disconnect,             ///< We're done, disconnect the transaction
Retry                   ///< Action cannot be completed right now, retry when signalled
};
} // End of namespace RPCResponse

namespace AbortReason
{
enum Type
{
Disconnect =            0x01,
Timeout =               0x02
};
} // End of namespace AbortReason

/** Base class for a task that must be executed on another connection
*/
class BLEXLIB_PUBLIC RPCTask : public Blex::Dispatcher::Task
{
    public:
        /// Virtual destructor, this class is inherited from
        virtual ~RPCTask();

    protected:
        /** This function is called in the context of the called connection.
            @param iobuf Buffer which can be used to construct a reply
            @param is_finished Boolean which MUST be set with whether the
               task has been completed. If not completed, the called connection
               must call @a MarkTaskCompleted on the task when it has completed
            @return The needed type of response to the client of the called
                connection. If @a Respond, iobuf must contain the message to send.
        */
        virtual RPCResponse::Type HookExecuteTask(IOBuffer *iobuf, bool *is_finished) = 0;

        /** Called when the task has finished, in the context of the sending connection
            @param iobuf Buffer which can be used to construct a reply
            @param success Whether the task was successfully completed
            @return The needed type of response. If @a Respond, iobuf must contain
                the message to send.
        */
        virtual RPCResponse::Type HookTaskFinished(IOBuffer *iobuf, bool success) = 0;

    private:
        bool is_rpcconn_owned;

//        friend class RPCRawConnection;
        friend class RPCConnection;
};

/** Base class to implement a connection on an RPC server. Every function in
    this class must be called synchronously (no two threads at the same time),
    unless they are explicitly marked as asynchronous.
    The entry points HookXXX are guaranteed to be called only synchronously.

    Users of this class may NOT invoke any of the virtual functions by themselves.
*/
class BLEXLIB_PUBLIC RPCConnection : public Blex::Dispatcher::Connection
{
    public:
        /** Constructs a new RPC connection.
        */
        RPCConnection(void *dispatcher);

        /// Virtual destructor, this class is inherited from
        virtual ~RPCConnection();

        /** Returns the pointer to the abortflag for this connection
        */
        int32_t * GetAbortFlag();

    protected:
        /** \defgroup hooks Functions that need to be overridden in a server
                implementation */
        /*\@{*/

        /** Function called when the other side has closed the connection, either
            an eof or a hangup. Use this to signal other connections that this connection
            has disappeared.
        */
        virtual void HookDisconnectReceived(Blex::Dispatcher::Signals::SignalType signal) = 0;

        /** Function called when a new connection has arrived. Use for initialization and registration
            of new connections.
        */
        virtual void HookIncomingConnection() = 0;

        /** Function called before a new connection arrives (except for the first),
            and the connection must be reset to accept it. Use it to release all
            associated resources, and initialize all data.
            All hook functions that called after this are associated with the new
            connection.
        */
        virtual void HookPrepareForUse() = 0;

        /** Function called when the connection has been signalled
            @param iobuf Buffer that can be used to construct a reply
            @return The needed type of response. If @a Respond, iobuf must contain
                the message to send.
        */
        virtual RPCResponse::Type HookSignalled(IOBuffer *iobuf) = 0;

        /** This function is called when the timout has expired.
            @param iobuf Buffer that can be used to construct a reply
            @param fatal Fatal parameter that was originally set with the timer
            @return The needed type of response. If @a Respond, iobuf must contain
                the message to send.
        */
        virtual RPCResponse::Type HookTimeOut(IOBuffer *iobuf, bool fatal) = 0;

        /** Function called when an RPC has been received
            @param iobuf IO buffer containing the message
            @return The needed type of response. If @a Respond, iobuf must contain
                the message to send.
        */
        virtual RPCResponse::Type HookHandleMessage(IOBuffer *iobuf) = 0;

        /** Function called in debugging environents, to get the name of a request opcode
            @param code Request code
            @return Name of request type
        */
        virtual std::string GetRequestOpcodeName(uint8_t code);

        /** Function called in debugging environents, to get the name of a response opcode
            @param code response code
            @return Name of response code
        */
        virtual std::string GetResponseOpcodeName(uint8_t code);

        /*\@}*/

    public:
        /** This function may be called to indicate that the the dispatcher may
            safely disregard this thread when counting the number of active threads
        */
        void MarkAsSleeping();

        /** This function can be called (aysnchronously) to signal the current
            connection. If called, some time later HookSignal will be called
            synchronously
        */
        void AsyncSignal();

        /** Sets a timeout. If the timeout is reached the function HookTimeOut
            is called. Replaces the current timeout.
            @param timeout Time after which @a HookTimeout must be called, or
                Blex::DateTime::Invalid() for cancelling the timeout
            @param fatal Upon asynchronous detection of the timeout, must the
                current RPC be aborted as soon as possible? (done by setting the
                abortflag)
        */
        void SetTimeOut(Blex::DateTime timeout, bool fatal);

        /** Marks a task as finished
            @param task Task that has been completed
            @param success Whether the task was successfully completed
        */
        void MarkTaskFinished(RPCTask *task, bool success);

        /** Queues a remote task on another connection
            @param receiver Receiving connection; MUST exist while this function
                is running
            @param task Task to execute. Declare it in the server class inherited
                from this class, as the task structure may not disappear while it
                hasn't been completed; the server class won't be destroyed until
                all tasks have been finished or aborted
            @param blocking Block all other incoming data and tasks until this
               task has been finished.
        */
        void QueueRemoteTask(RPCConnection *receiver, std::unique_ptr< RPCTask > &task, bool blocking);

        /** Event might be signalled
            @param event Event that might be signalled
        */
        void HookEventSignalled(Blex::Event *event);

        /** Returns a string with the remote address in it
        */
        std::string GetRemoteAddress() const;

    private:

        /// implements dispatcher virtual
        void HookIncomingData(uint8_t const *start, unsigned numbytes);

        /** Acts upon the receipt of an AsyncSignal or internal event.
            @param signal Signal that was raised
        */
        void HookSignal(Blex::Dispatcher::Signals::SignalType signal);

        /** Acts upon the receipt of an AsyncSignal or internal event.
            @param signal Signal that was raised
        */
        bool HookExecuteTask(Blex::Dispatcher::Task *task);

        /** Acts upon the completion of a number of blocks that have been sent
            @param blocks_sent Number of blocks that have been sent
        */
        void HookDataBlocksSent(unsigned blocks_sent);

        /** Called immediately when it is discovered that a signal has been
            queued, asynchronously.
            @param signal Signal number of the raised signal
        */
        void AsyncHookSignal(Blex::Dispatcher::Signals::SignalType signal);

        /** Queues the main io-buffer @a io for sending
        */
        void QueueMainBuffer();

        /** Queues the task io-buffer @a taskio for sending.
        */
        void QueueTaskBuffer();

        /** Clears all state of the connection objects after a connection has
            been broken off
            @param from_constructor Set to true if called from the constructor
                (can't call pure virtuals from there)
        */
        void PrepareForConnection(bool may_call_virtuals);

        /// Data describing the last set timer
        struct TimerData
        {
                Blex::DateTime timeout;
                bool fatal;
        };

        typedef Blex::InterlockedData< TimerData, Blex::Mutex> LockedTimerData;

        LockedTimerData timerdata;

        /// Main io buffer for messages
        IOBuffer io;

        /// Main io buffer for task messages
        IOBuffer taskio;

        /// Number of bytes received for current incoming message
        unsigned bytesreceived;

        /// Storage for length bytes of current incoming message
        uint8_t lengthbytes[4];

        /// Sends currently pending
        std::deque< IOBuffer > pending_sends;

        /** This flag is used to signal aborts. If non-0, the transaction has
            been aborted, otherwise it contains a value of AbortReason::Type.
            Use this variable by reading its value every now and then and abort
            when it's not 0.
        */
        int32_t abortflag;
};

} // End of namespace Database

//------------------------------------------------------------------------------
#endif
