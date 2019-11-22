#include <blex/blexlib.h>


#include "dispat.h"
#include "dispat_impl.h"

namespace Blex {
namespace Dispatcher {

/** Unqueue already sent bytes */
unsigned DequeueOutgoingBytes(QueuedSendData &data, unsigned numbytes)
{
        /* ADDME: Don't pop off the stack, but erase as much as we can in a single remove */
        unsigned popped_buffers = 0;
        while (numbytes>0 && !data.empty())
        {
                if (data.begin()->buflen<=numbytes)
                {
                        numbytes-=data.begin()->buflen;
                        data.erase(data.begin());
                        ++popped_buffers;
                }
                else
                {
                        data.begin()->buflen-=numbytes;
                        data.begin()->buffer=static_cast<uint8_t const*>(data.begin()->buffer) + numbytes;
                        numbytes=0;
                }
        }
        assert(numbytes==0);
        return popped_buffers;
}

Task::~Task()
{
}

Connection::Connection(void *dispatcher)
: conn( new Detail::Conn(*static_cast<Detail::Main*>(dispatcher),*this) )
{
}

Connection::~Connection()
{
        delete conn;
}

void Connection::MarkAsSleeping()
{
        conn->OS_MarkAsSleeping();
}

SocketAddress const& Connection::GetListeningAddress() const
{
        return conn->GetListeningAddress();
}

SocketAddress const& Connection::GetLocalAddress() const
{
        return conn->GetLocalAddress();
}

SocketAddress const& Connection::GetRemoteAddress() const
{
        return conn->GetRemoteAddress();
}

void Connection::EnableIncomingData(bool enable)
{
        conn->EnableIncomingData(enable);
}

uint8_t const *Connection::ClearIncomingData(unsigned numbytes)
{
        return conn->ClearIncomingData(numbytes);
}
void Connection::AsyncHookSignal(Signals::SignalType)
{
}
void Connection::AsyncQueueSend(unsigned numbufs, SendData const data[])
{
        conn->AsyncQueueSend(numbufs,data);
}

bool Connection::AsyncSignal(Signals::SignalType signal)
{
        return conn->AsyncSignal(signal);
}

void Connection::SetTimer(Blex::DateTime wakeup)
{
        conn->SetTimer(wakeup, false);
}

void Connection::QueueRemoteTask(Connection *receiver, std::unique_ptr< Task > &task, bool blocking)
{
        conn->QueueRemoteTask(receiver, task, blocking);
}

void Connection::MarkTaskFinished(Task *task, bool success)
{
        conn->MarkTaskFinished(task, success);
}

bool Connection::AnySendsPending()
{
        return conn->AnySendsPending();
}

bool Connection::IsConnectionSecure() const
{
        return conn->IsConnectionSecure();
}

void Connection::AddEvent(Event *event)
{
        return conn->AddEvent(event);
}

void Connection::RemoveEvent(Event *event)
{
        return conn->RemoveEvent(event);
}

void Connection::SetNagle(bool newvalue)
{
        return conn->SetNagle(newvalue);
}

Dispatcher::Dispatcher(const CreateConnectionCallback &create_connection)
: impl (new Detail::Main(create_connection))
{
}

Dispatcher::~Dispatcher()
{
        delete impl;
}

void Dispatcher::Start(unsigned numworkers, int idlegrace, bool signalnewconnection)
{
        impl->Start(numworkers, idlegrace, signalnewconnection);
}

unsigned Dispatcher::CountListeningPorts() const
{
        return impl->CountListeningPorts();
}

bool Dispatcher::InterruptHandler(int sig)
{
        return impl->os.InterruptHandler(sig);
}

void Dispatcher::UpdateListenPorts(unsigned numports, ListenAddress const ports[])
{
        impl->UpdateListenPorts(numports,ports);
        DEBUGDISPATCHPRINT("Dispatcher::UpdateListenPorts completed");
}
bool Dispatcher::RebindSockets(std::vector<ListenAddress> *broken_listeners)
{
        return impl->RebindSockets(broken_listeners);
}


std::string Signals::GetName(SignalType type)
{
        std::string result;
        for (unsigned i = 0; i < 7; ++i)
        {
                if (type & (1 << i))
                {
                        if (!result.empty())
                            result += ", ";
                        switch (1 << i)
                        {
                        case Signalled:         result += "Signal"; break;
                        case Hangup:            result += "Hangup"; break;
                        case ConnectionClosed:  result += "ConnectionClosed"; break;
                        case NewConnection:     result += "NewConnection"; break;
                        case GotEOF:            result += "GotEOF"; break;
                        case TimerElapsed:      result += "TimerElapsed"; break;
                        case GracePeriodElapsed: result += "GracePeriodElaped"; break;
                        default:
                           result += "???";
                        }
                }
        }
        return result;
}

std::string TaskState::GetName(Type type)
{
        switch (type)
        {
        case Waiting:   return "Waiting";
        case Running:   return "Running";
        case Completed: return "Completed";
        case Failed:    return "Failed";
        default:
            return "?" + Blex::AnyToString(int(type)) + "?";
        }
}


} //end namespace Blex::Dispatcher
} //end namespace Blex

