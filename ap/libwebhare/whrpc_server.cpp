#include <ap/libwebhare/allincludes.h>


#include "whrpc_server.h"
#include <blex/logfile.h>

//#define RPCCONN_DEBUGDISPATCH           //Define to enable debugging


#if defined(RPCCONN_DEBUGDISPATCH) && defined(DEBUG)
#define DEBUGRPCPRINT(x) DEBUGPRINT(x)
#else
#define DEBUGRPCPRINT(x)
#endif

namespace Database
{

//------------------------------------------------------------------------------
//
// RPCTask
//
//------------------------------------------------------------------------------

RPCTask::~RPCTask()
{
}

//------------------------------------------------------------------------------
//
// RPCConnection
//
//------------------------------------------------------------------------------

typedef RPCConnection RPCConnection;

RPCConnection::RPCConnection(void *dispatcher)
: Blex::Dispatcher::Connection(dispatcher)
, abortflag(0)
{
        DEBUGRPCPRINT("Created conn " << this);
        PrepareForConnection(false);
}

RPCConnection::~RPCConnection()
{
        PrepareForConnection(false);
        DEBUGRPCPRINT("Destroyed " << this);
}

int32_t * RPCConnection::GetAbortFlag()
{
        return &abortflag;
}

void RPCConnection::AsyncSignal()
{
        Blex::Dispatcher::Connection::AsyncSignal(Blex::Dispatcher::Signals::Signalled);
}

void RPCConnection::MarkAsSleeping()
{
        Blex::Dispatcher::Connection::MarkAsSleeping();
}

void RPCConnection::SetTimeOut(Blex::DateTime timeout, bool fatal)
{
        if (timeout == Blex::DateTime::Invalid())
            timeout = Blex::DateTime::Max();

        // Update the timer data in the lock
        {
                LockedTimerData::WriteRef lock(timerdata);
                lock->timeout = timeout;
                lock->fatal = fatal;
        }
        Blex::Dispatcher::Connection::SetTimer(timeout);
}

void RPCConnection::MarkTaskFinished(RPCTask *task, bool success)
{
        Blex::Dispatcher::Connection::MarkTaskFinished(task, success);
}

std::string RPCConnection::GetRemoteAddress() const
{
        return Blex::Dispatcher::Connection::GetRemoteAddress().ToString();
}

void RPCConnection::HookIncomingData(uint8_t const *start, unsigned numbytes)
{
//        //Ignore all data when shutting down
//        if (negotiationphase == ShuttingDown)
//            return limit;

        //Transfer as much to our buffer as we can.

        //Note that we must either
        // 1) disconnnect
        // 2) parse _all_ available data
        // 3) send something to the client
        //otherwise the dispatcher may immediately reinvoke this handler (ADDME: Perhaps modify dispatcher to permit us to leave partial data in buffers)
        try
        {
                //ADDME: Bit ugly, we force a memove with the extra ClearIncomingData.
                if (bytesreceived<4) //handle length
                {
                        unsigned tocopy=std::min<unsigned>(4-bytesreceived,numbytes);
                        std::copy(start,
                                  start+tocopy,
                                  lengthbytes+bytesreceived);

                        start = ClearIncomingData(tocopy);
                        bytesreceived+=tocopy;
                        numbytes-=tocopy;

                        if (bytesreceived==4) //allocate space for incoming data
                            io.ResetForIncoming(lengthbytes);
                }
                if (bytesreceived>=4) //we got a length!
                {
                        unsigned tocopy=std::min<unsigned>(io.GetClaimedLength()-bytesreceived,numbytes);
                        std::copy(start,start+tocopy,io.GetRawBegin()+bytesreceived);

                        /*start = */ClearIncomingData(tocopy);
                        bytesreceived+=tocopy;

                        if (bytesreceived==io.GetClaimedLength()) //got a complete packet!
                        {
                                DEBUGRPCPRINT("RPC conn " << this << " Received " << GetRequestOpcodeName(io.GetOpcode()) << ", len " << io.GetRawLength());
                                DEBUGRPCPRINT("RPC conn " << this << " Calling HookHandleMessage");

                                switch (HookHandleMessage(&io))
                                {
                                case RPCResponse::Respond:
                                case RPCResponse::RespondAsync:
                                        QueueMainBuffer();
                                        break;
                                case RPCResponse::DontRespond:
                                        //FIXME: Timeout when reply doesn't come in fast enough (dispatcher must still implement it)
                                        //       (but only do that for Transact connection, not for listeners!)
                                        //SetTimer(std::time(0) + 30); //warn us in 30 seconds
                                        break;
                                case RPCResponse::Disconnect:
                                        // Try to send the response; but we aren't too bothered if it fails
                                        QueueMainBuffer();
                                        AsyncCloseConnection();
                                        break;
                                case RPCResponse::Retry:
                                        break;
                                default:
                                        throw std::logic_error("Unknown message response encountered");
                                }
                                bytesreceived=0;
                        }
                }
        }
        catch (std::exception &e)
        {
                Blex::ErrStream() << "Connection " << this << " caused exception: " << e.what() << std::endl;
                AsyncCloseConnection();
        }
}

void RPCConnection::HookSignal(Blex::Dispatcher::Signals::SignalType signal)
{
        try
        {
                DEBUGRPCPRINT("RPC conn " << this << " Receive signal " << Blex::Dispatcher::Signals::GetName(signal));
                switch (signal)
                {
                case Blex::Dispatcher::Signals::GracePeriodElapsed:
                        break; //ADDME kill incommunicado clients

                case Blex::Dispatcher::Signals::GotEOF:
                        HookDisconnectReceived(signal);
                        AsyncCloseConnection();
                        break;
                case Blex::Dispatcher::Signals::Hangup:
                        HookDisconnectReceived(signal);
                        break;
                case Blex::Dispatcher::Signals::NewConnection:
                        /* For RPC servers, we want the packets to go out as quick as possible, so
                           we'll disable nagle
                        */
                        SetNagle(false);
                        HookIncomingConnection();
                        break;
                case Blex::Dispatcher::Signals::ConnectionClosed:
                        PrepareForConnection(true);
                        break;
                case Blex::Dispatcher::Signals::Signalled:
                case Blex::Dispatcher::Signals::TimerElapsed:
                        {
                                /// Execute the hook signal on the connection
                                RPCResponse::Type respond;

                                if (signal == Blex::Dispatcher::Signals::Signalled)
                                {
                                        DEBUGRPCPRINT("RPC conn " << this << " calling HookSignal");
                                        respond = HookSignalled(&io);
                                }
                                else
                                {
                                        bool valid_timeout;
                                        bool fatal;
                                        Blex::DateTime now = Blex::DateTime::Now();
                                        {
                                                LockedTimerData::WriteRef lock(timerdata);
                                                fatal = lock->fatal;
                                                valid_timeout = now >= lock->timeout;
                                        }
                                        if (valid_timeout)
                                        {
                                                DEBUGRPCPRINT("RPC conn " << this << " calling HookTimeOut");
                                                respond = HookTimeOut(&io, fatal);
                                        }
                                        else
                                        {
                                                DEBUGRPCPRINT("RPC conn " << this << " ignoring timeout (timer now set to " << Blex::AnyToString(LockedTimerData::WriteRef(timerdata)->timeout) << " but it is now " << Blex::AnyToString(now));
                                                respond = RPCResponse::DontRespond;
                                        }
                                }

                                switch (respond)
                                {
                                case RPCResponse::Respond:
                                        QueueMainBuffer();
                                        break;
                                case RPCResponse::Disconnect:
                                        // Try to send the response; but we aren't too bothered if it fails
                                        QueueMainBuffer();
                                        AsyncCloseConnection();
                                        break;
                                case RPCResponse::DontRespond:
                                        // Hooktimeout may return DontRespond
                                        // HookSignalled also, when having got a spurious signal
                                        break;
                                case RPCResponse::Retry:
                                        break;
                                default:
                                        //RespondAsync not handled here, because no RPC uses it
                                        throw std::logic_error("Encountered unknown signal response type");
                                }
                        } break;
                }
        }
        catch (std::exception &e)
        {
                Blex::ErrStream() << "Connection " << this << " caused exception: " << e.what() << std::endl;
                AsyncCloseConnection();
                return;
        }
}

bool RPCConnection::HookExecuteTask(Blex::Dispatcher::Task *_task)
{
        bool is_finished = true;
        try
        {
                RPCTask *task = dynamic_cast< RPCTask * >(_task);
                if (!task)
                    throw std::logic_error(std::string() + "Got unexpected type of task in RPCConnection (type name: " + typeid(*_task).name() + ")");

                DEBUGRPCPRINT("RPC conn " << this << " Receive task " << task << " (type: " << typeid(*task).name() << "), state: " << Blex::Dispatcher::TaskState::GetName(task->GetState()));

                RPCResponse::Type respond;
                switch (task->GetState())
                {
                case Blex::Dispatcher::TaskState::Waiting:
                        {
                                DEBUGRPCPRINT("RPC conn " << this << " Calling HookExecuteTask");
                                respond = task->HookExecuteTask(&taskio, &is_finished);
                                DEBUGRPCPRINT("RPC conn " << this << " Task is " << (is_finished ? "" : "not ") << "finished");
                        } break;

                case Blex::Dispatcher::TaskState::Completed:
                case Blex::Dispatcher::TaskState::Failed:
                        {
                                DEBUGRPCPRINT("RPC conn " << this << " Calling HookTaskFinished (success: " << (task->GetState() == Blex::Dispatcher::TaskState::Completed ? "yes" : "no") << ")");
                                respond = task->HookTaskFinished(&taskio, task->GetState() == Blex::Dispatcher::TaskState::Completed);

/*                                if (task->is_rpcconn_owned)
                                {
                                        assert(running_tasks.count(task));

                                        running_tasks.erase(task);
                                        delete task;
                                }*/
                        } break;

                default:
                    throw std::logic_error("Got unexpected taskstate in RPCConnection (state: " + Blex::Dispatcher::TaskState::GetName(task->GetState()) + ")");
                }

                switch (respond)
                {
                case RPCResponse::Respond:
                        QueueTaskBuffer();
                        break;
                case RPCResponse::DontRespond:
                        //FIXME: Timeout when reply doesn't come in fast enough (dispatcher must still implement it)
                        //       (but only do that for Transact connection, not for listeners!)
                        //SetTimer(std::time(0) + 30); //warn us in 30 seconds
                        break;
                case RPCResponse::Disconnect:
                        // Try to send the response; but we aren't too bothered if it fails
                        QueueTaskBuffer();
                        AsyncCloseConnection();
                        break;
                case RPCResponse::Retry:
                        break;
                default:
                        //RespondAsync not handled here, because no RPC uses it
                        throw std::logic_error("Unknown task response type encountered");
                }
        }
        catch (std::exception &e)
        {
                Blex::ErrStream() << "Connection " << this << " caused exception: " << e.what() << std::endl;
                AsyncCloseConnection();
                return true;
        }
        return is_finished;
}


void RPCConnection::AsyncHookSignal(Blex::Dispatcher::Signals::SignalType signal)
{
        DEBUGPRINT("Connection " << this << " AsyncHookSignal " << Blex::Dispatcher::Signals::GetName(signal));

        // Abortflag already set? If so, we don't need to bother.
        if (abortflag)
            return;

        if (signal == Blex::Dispatcher::Signals::Hangup || signal == Blex::Dispatcher::Signals::GotEOF)
            abortflag = AbortReason::Disconnect;
        else if (signal == Blex::Dispatcher::Signals::TimerElapsed)
        {
                LockedTimerData::WriteRef lock(timerdata);
                if (Blex::DateTime::Now() >= lock->timeout && lock->fatal)
                    abortflag = AbortReason::Timeout;
        }
        DEBUGPRINT("Connection " << this << " set abortflag " << &abortflag << " to " << abortflag);
}

void RPCConnection::PrepareForConnection(bool may_call_virtuals)
{
        DEBUGRPCPRINT("Connection " << this << " reset, clearing list of pending sends");
        bytesreceived=0;
        abortflag = 0;

        pending_sends.clear();
        if (may_call_virtuals)
            HookPrepareForUse();
}

void RPCConnection::HookDataBlocksSent(unsigned numblocks)
{
        DEBUGRPCPRINT("Connection " << this << " notified of " << numblocks << " sent blocks, while " << pending_sends.size() << " sends were pending");
        if (numblocks > pending_sends.size())
            throw std::logic_error("Dispatcher notified more completed blocks than were sent in total");

        pending_sends.erase(pending_sends.begin(), pending_sends.begin() + numblocks);
}

void RPCConnection::QueueMainBuffer()
{
        // FIXME: don't copy the data, but swap or so.
        pending_sends.push_back(io);

        Blex::Dispatcher::SendData send_data(pending_sends.back().GetRawBegin(),pending_sends.back().GetRawLength());
        AsyncQueueSend(1, &send_data);

        DEBUGRPCPRINT("RPC conn " << this << " Sent " << GetResponseOpcodeName(io.GetOpcode()) << ", len " << io.GetRawLength() << " (pending sends: " << pending_sends.size() << ")");
}

void RPCConnection::QueueTaskBuffer()
{
        // FIXME: don't copy the data, but swap or so.
        pending_sends.push_back(taskio);

        Blex::Dispatcher::SendData send_data(pending_sends.back().GetRawBegin(),pending_sends.back().GetRawLength());
        AsyncQueueSend(1, &send_data);

        DEBUGRPCPRINT("RPC conn " << this << " Sent " << GetResponseOpcodeName(io.GetOpcode()) << ", len " << io.GetRawLength() << " from task (pending sends: " << pending_sends.size() << ")");
}

void RPCConnection::QueueRemoteTask(RPCConnection *receiver, std::unique_ptr< RPCTask > &_task, bool blocking)
{
        std::unique_ptr< Blex::Dispatcher::Task > task;
        task.reset(_task.release());

        Blex::Dispatcher::Connection::QueueRemoteTask(receiver, task, blocking);
}

void RPCConnection::HookEventSignalled(Blex::Event *)
{
}

std::string RPCConnection::GetRequestOpcodeName(uint8_t code)
{
        return Database::RequestOpcode::GetName(Database::RequestOpcode::Type(code));
}

std::string RPCConnection::GetResponseOpcodeName(uint8_t code)
{
        return Database::ResponseOpcode::GetName(Database::ResponseOpcode::Type(code));
}

} // End of namespace Database
