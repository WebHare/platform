#include <blex/blexlib.h>


#include "dispat_impl.h"
#include "logfile.h"
#include <iostream>
#include <iomanip>
#include <sstream>
#include <errno.h>
#include <sys/uio.h>
#include <climits>

/* GLOBAL LOCK ORDERING:

   posixdata  BEFORE itcqueue
   posixdata  BEFORE shareddata
   posixdata  BEFORE statemutex
   shareddata BEFORE statemutex
   statemutex BEFORE itcqueue
   statemutex BEFORE timerdata
*/

///Minimum # of free connection structures
unsigned const MinimumFreeConnections = 10;

/// Connection accept backlog
unsigned const ConnectionAcceptBacklog = 512;

namespace Blex {

/* ADDME: An efficient DISPAT_POLL implementation requires a reverse map in the FD scnaning phase */
void Poller::UpdateFDWaitMask(int fd, bool update_read, bool want_read, bool update_write, bool want_write)
{
        //DEBUGDISPATCHPRINT("<D:" << fd << "> Update FD wait mask: read: " << (update_read?want_read?"set":"clear":"-") << " write: " << (update_write?want_write?"set":"clear":"-"));

        std::map<int,unsigned>::iterator it = posmask.find(fd);
        unsigned pos;
        if (it == posmask.end())
        {
                pos = posmask.size();
                it = posmask.insert(std::make_pair(fd, pos)).first;

                poll_data.resize(pos+1);
                poll_data.back().fd=fd;
                poll_data.back().events=0;
        }
        else
            pos = it->second;

        pollfd &toupdate = poll_data[pos];

        if (update_read)
        {
                if (want_read)
                    toupdate.events |= POLLIN;
                else
                    toupdate.events &= ~POLLIN;
        }

        if (update_write)
        {
                if (want_write)
                    toupdate.events |= POLLOUT;
                else
                    toupdate.events &= ~POLLOUT;
        }

        if (toupdate.events == 0)
        {
                unsigned last = poll_data.size() - 1;
                if (pos != last)
                {
                        poll_data[pos] = poll_data[last];
                        posmask[poll_data[pos].fd] = pos;
                }

                poll_data.erase(poll_data.begin() + last);
                posmask.erase(fd);
        }
}
bool Poller::IsReadable(int fd)
{
        std::map<int,unsigned>::iterator it = posmask.find(fd);
        if (it == posmask.end())
            return false;

        if(poll_data[it->second].revents & POLLNVAL)
        {
                Blex::ErrStream() << "Poller::IsReadable requested for invalid file descriptor " << fd;
                Blex::FatalAbort();
        }
        return poll_data[it->second].revents & (POLLIN|POLLHUP|POLLERR);
}
bool Poller::IsHup(int fd)
{
        std::map<int,unsigned>::iterator it = posmask.find(fd);
        if (it == posmask.end())
            return false;

        if(poll_data[it->second].revents & POLLNVAL)
        {
                Blex::ErrStream() << "Poller::IsHup requested for invalid file descriptor " << fd;
                Blex::FatalAbort();
        }
        return poll_data[it->second].revents & POLLHUP;
}
bool Poller::IsWritable(int fd)
{
        std::map<int,unsigned>::iterator it = posmask.find(fd);
        if (it == posmask.end())
            return false;

        if(poll_data[it->second].revents & POLLNVAL)
        {
#ifdef __APPLE__
                //It looks like OSX returns NVAL if the other side closed the pipe
                return true;
#else
                Blex::ErrStream() << "Poller::IsWritable requested for invalid file descriptor " << fd;
                Blex::FatalAbort();
#endif
        }
        return poll_data[it->second].revents & (POLLOUT|POLLHUP|POLLERR);
}

int Poller::DoPoll(Blex::DateTime until)
{
        int retval;

        while(true)
        {
                int delay;
                if (until == Blex::DateTime::Max()) //infinite wait
                {
                        delay=-1;
                }
                else
                {
                        Blex::DateTime now = Blex::DateTime::Now();
                        if (now>=until)
                        {
                                delay=0 /*no timeout*/;
                        }
                        else
                        {
                                Blex::DateTime towait = until-now;
                                delay = towait.GetDays() ? 86400*1000 : towait.GetMsecs();
                        }
                }

                retval = poll(&poll_data[0], poll_data.size(),delay);
#ifdef DEBUGPOLL
                for (unsigned i=0; i<poll_data.size(); ++i)
                {
                        DEBUGPRINT("Poll fd: " << poll_data[i].fd << " events: " << poll_data[i].events << " revents: " << poll_data[i].revents);
                }
#endif

#ifdef __APPLE__
                /* Guard against spurious wakeups */
                bool any_awake = false;
                if(retval>0)
                {
                        for (unsigned i=0;!any_awake && i<poll_data.size();++i)
                          if(poll_data[i].revents)
                            any_awake=true;
                        if (!any_awake)
                            continue;
                }
#endif
                if(retval>=0 || errno != EINTR)
                    break;
        }

#ifdef DEBUG
        if (retval<0)
        {
                int old_errno = errno;
                DEBUGPRINT("Poll error: " << strerror(old_errno) << "\n");
                for (unsigned i=0;i<poll_data.size();++i)
                  if (poll_data[i].revents & POLLNVAL)
                    DEBUGPRINT("  Invalid descriptor: " << poll_data[i].fd);
                errno = old_errno;
        }
#endif

        return retval;
}

void Poller::ExportSignalled(std::vector< SignalledFd > *signalled)
{
        for (std::vector< pollfd >::iterator it = poll_data.begin(), end = poll_data.end(); it != end; ++it)
        {
                if (!(it->revents & (POLLOUT|POLLIN|POLLHUP|POLLERR)))
                    continue;

                SignalledFd sfd;
                sfd.fd = it->fd;
                sfd.is_readable = it->revents & (POLLIN|POLLHUP|POLLERR);
                sfd.is_writable = it->revents & (POLLOUT|POLLHUP|POLLERR);
                sfd.is_hup = it->revents & POLLHUP;

                signalled->push_back(sfd);
        }
}


namespace Dispatcher {
namespace Detail {

typedef std::vector<ListenAddress> ListenAddressList;

//Locks: takes none
ListenAddressList::iterator FindPort(ListenAddressList &ports,ListenAddress const &address)
{
        for (ListenAddressList::iterator itr=ports.begin();itr!=ports.end();++itr)
          if (itr->sockaddr == address.sockaddr)
            return itr;

        return ports.end();
}

//Locks: takes none
void State::Clear()
{
        DEBUGDISPATCHPRINT("State " << this << " reset");

        pending_signals = 0;
        flags = 0;
        inbuflen=0;
        blockssent = 0;
        ssl_blockssent = 0;
        wakeup = Blex::DateTime::Invalid();
        queueddata.clear();
        ssl_queueddata.clear();
        ssl_queuedsize = 0;

        for (std::list< Task * >::iterator it = pending_tasks.begin(), end = pending_tasks.end(); it != end; ++it)
            delete *it;
        pending_tasks.clear();
        for (std::list< Task * >::iterator it = running_tasks.begin(), end = running_tasks.end(); it != end; ++it)
            delete *it;
        running_tasks.clear();
        signalled_events.clear();
}

//Locks: takes none
std::ostream& operator <<(std::ostream &out,State const &rhs)
{
        out << "DC(";
        if (rhs.queueddata.size())
            out << rhs.queueddata.size() << " outbufs;";
        if (rhs.ssl_queueddata.size())
            out << rhs.ssl_queueddata.size() << " SSL outbufs;";
        if (rhs.blockssent)
            out << rhs.blockssent << " blocks sent;";
        if (rhs.ssl_blockssent)
            out << rhs.ssl_blockssent << " SSL blocks sent;";
        if (rhs.inbuflen)
            out << rhs.inbuflen << " inbytes;";
        if (rhs.wakeup != Blex::DateTime::Invalid())
            out << (rhs.wakeup-Blex::DateTime::Now()).GetMsecs() << " sleep;";
        if (rhs.pending_signals & Signals::Hangup)
            out << "tell_hangup;";
        if (rhs.pending_signals & Signals::ConnectionClosed)
            out << "tell_connectionclosed;";
        if (rhs.pending_signals & Signals::Signalled)
            out << "tell_signalled;";
        if (rhs.pending_signals & Signals::TimerElapsed)
            out << "tell_timerelapsed;";
        if (rhs.pending_signals & Signals::GracePeriodElapsed)
            out << "tell_graceperiodelapsed;";
        if (rhs.pending_signals & Signals::NewConnection)
            out << "tell_newconnection;";
        if (rhs.pending_signals & Signals::GotEOF)
            out << "tell_goteof;";

        if (rhs.flags & State::Closed)
            out << "closed;";
        if (rhs.flags & State::Running)
            out << "running;";
        if (rhs.flags & State::POSIXInputReady)
            out << "posix_inputready;";
        if (rhs.flags & State::POSIXOutputReady)
            out << "posix_outputready;";
        if (rhs.flags & State::StopIncomingData)
            out << "stop_incoming_data;";
        if (rhs.flags & State::POSIXSleeping)
            out << "posix_sleeping;";
        if (rhs.flags & State::WaitingForRemoteTask)
            out << "waiting_for_remote_task;";
        if (rhs.flags & State::ToldHangup)
            out << "told_hangup;";

        if (!rhs.pending_tasks.empty())
        {
                out << " tasks:";
                for (std::list< Task * >::const_iterator it = rhs.pending_tasks.begin(); it != rhs.pending_tasks.end(); ++it)
                {
                        switch ((*it)->GetState())
                        {
                        case TaskState::Waiting:        out << " waiting"; break;
                        case TaskState::Running:        out << " running"; break;
                        case TaskState::Completed :     out << " completed"; break;
                        case TaskState::Failed:         out << " failed"; break;
                        }
                }
        }
        out << ")";
        return out;
}

//Locks: requires this->StateMutex
// this is the only function to enable State::Running, eg - if it's enabled, someone is running FinishHandlingConnection
bool Conn::FinishHandlingConnection(StateMutex::ScopedLock *statelock) //locks: statemutex < itcqueue
{
        using Detail::State;
        bool went_to_sleep = false;

        assert(statelock->IsLocked());
        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Enter dispatch, conn = " << (void*)this);

        if (! (state.flags & (State::Running | State::Closed) )) //if not running or closed
        {
                state.flags |= State::Running;
                bool wait_ssl_data = false;

                while (! (state.flags & State::Closed) )
                {
#ifdef DISPATCHER_DEBUGDISPATCH
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> HandleEvents: " << state << ", conn = " << (void*)this);
                        if(ssl_conn.get())
                                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> SSL state: wantsread " << ssl_conn->ssl_wants_read
                                                    << " canwrite " << ssl_conn->ssl_can_write
                                                    << " inbuflen " << ssl_conn->GetIncomingDataLen()
                                                    << " outbuflen " << ssl_conn->GetOutgoingDataLen());
#endif

                        //signals must come first
                        if (state.pending_signals)
                        {
                                // Walk through signals
                                for (unsigned i=0;i<sizeof(state.pending_signals)*CHAR_BIT;++i)
                                  if (state.pending_signals & (1<<i))
                                {
                                        DoSignal(Signals::SignalType(1<<i),statelock); //locks: ~scopedlock > shareddata, ~scopedlock > itcqueue, ~scopedlock > timerdata
                                        break; //abort after handling to properly pick up 'Disconnect'
                                }
                        }
                        else if (!state.signalled_events.empty())
                        {
                                DoEventSignalled(statelock);
                        }
                        else if (state.ssl_blockssent || state.blockssent)
                        {
                                DoBlocksSent(statelock);
                        }
                        else if (ssl_conn.get() && ssl_conn->GetOutgoingDataLen() > 0 && state.queueddata.empty())
                        {
                                // SSL has generated output data, schedule it for sending. Only one buffer at a time!
                                DoSSLPrepareOutputForSending();
                        }
                        else if (!state.ssl_queueddata.empty() && !wait_ssl_data)
                        {
                                // Try to send the data from the ssl queue (unencrypted) through the SSL layer
                                if (!DoSSLOutput())
                                {
                                        /* DoSSLOutput returned false, so nothing was pushed to SSL. We assume that
                                           SSL needed a read, so we set wait_ssl_data, so no output is sent to SSL
                                           until we actually had a read.
                                        */
                                        wait_ssl_data = true;
                                }
                        }
                        else if (ssl_conn.get() && !ssl_conn->ssl_broken_error.empty())
                        {
                                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Aborting broken SSL connection (" << ssl_conn->ssl_broken_error << ")");
                                state.pending_signals |= Signals::Hangup;
                        }
                        else if (ssl_conn.get()
                                 && ssl_conn->GetOutgoingDataLen() == 0 //we have no outgoing data waiting
                                 && ssl_conn->GetIncomingDataLen() > 0 //we have incoming data to process
                                 && !(state.flags & (State::StopIncomingData | State::WaitingForRemoteTask)))
                        {
                                // The SSL layer has given us unencrypted data, call HookIncomingData
                                ParseSSLInboundData(statelock);
                        }
                        else if (state.queueddata.empty() && AnyReadyTask(statelock))
                        {
                                // Execute ready tasks
                                DoTask(statelock);
                        }
                        else if (state.inbuflen>0
                                 && (state.queueddata.empty() || wait_ssl_data)
                                 && (ssl_conn.get() || !(state.flags & (State::StopIncomingData | State::WaitingForRemoteTask))))
                        {
                                /* Incoming raw data. For normal connections, call HookIncomingData, for SSL signal
                                   the data is pushed into the SSL layer (so DoSSLOutput might now succeed if failing first)
                                */
                                wait_ssl_data = false;
                                DoParse(statelock); //locks: ~scopedlock > timerdata, ~scopedlock > itcqueue
                        }
                        else
                        {
                                //Unless the OS-specific handler has anything to do, quit!
                                if (!OS_HandleEvents(statelock)) //locks: itcqueue
                                    break;
                        }
                }

                if(state.flags & State::POSIXSleeping)
                    went_to_sleep=true;

                state.flags &= ~(State::Running|State::POSIXSleeping);
        }
        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Finished dispatch: " << state);

        //if socket is closed, and nothing is pending, then kill it
        if ((state.flags & (State::Closed | State::WaitingForRemoteTask | State::Running)) == State::Closed)
        {
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Returning socket to free queue");
                state.flags |= State::Running;
                ssl_conn.reset();
                statelock->Unlock();

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Signalling that the connection has closed (conn: " << this);
                callbacks.HookSignal(Signals::ConnectionClosed);

                DEBUGDISPATCHPRINT("Conn: " << this << " ConnectionClosed executed");

                /// Remove all events. Signalled list is cleared when state is cleared.
                RemoveAllEvents();

                // Finally, clear the state (including any pending signals)
                statelock->Lock();
                state.Clear();
                statelock->Unlock();

                // Mark as free when state is fully cleared
                dispmain.MarkAsFree(this);
        }

        return !went_to_sleep;
}

Conn::Conn(Main &disp, Connection &conn)
: socket(Socket::Stream)
, dispmain(disp)
, callbacks(conn)
, registered_timer(Blex::DateTime::Invalid())
{
        DEBUGDISPATCHPRINT("Connection " << this << " constructing");

#ifdef DISPATCHER_MUTEXCHECKING
        std::string mutexname = "Conn::StateMutex ";
        Blex::EncodeNumber(long(this),16,std::back_inserter(mutexname));
        statemutex.SetupDebugging(mutexname);
#endif
#if defined(DISPATCHER_SOCKETCHECKING_ALL)
        socket.SetDebugMode(Blex::DebugSocket::All);
#elif defined(DISPATCHER_SOCKETCHECKING)
        socket.SetDebugMode(Blex::DebugSocket::Calls);
#endif
        state.Clear();

        OS_Construct();
}

Conn::~Conn() //locks: timerdata
{
        DEBUGDISPATCHPRINT("Connection " << this << " destroying");

        Blex::Detail::EventWaiterBase *base = this;

        for (std::vector< Event * >::iterator it = waitevents.begin(); it != waitevents.end(); ++it)
        {
                Event::LockedData::WriteRef lock((*it)->data);
                lock->waiters.erase(std::find(lock->waiters.begin(), lock->waiters.end(), base));
        }

        // Resetting a timer is relatively cheap, so don't keep a variable if a timer is set.
        SetTimer(Blex::DateTime::Invalid(), false); //remove this connection from the timer list

        // Delete al task structures
        state.Clear();
}

bool Conn::LockedDoSend() //locks:itcqueue
{
        unsigned numblocks = OS_TryOutgoingSend(); //locks: itcqueue;
        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> " << numblocks << " blocks sent (in LockedDoSend)");
        state.blockssent += numblocks;
        //we must return 'true' if we think our caller should wake this Conn (pending_signals to catch Disconnet too)
        return !(state.flags & State::Running) && (numblocks > 0 || state.pending_signals);
}

void Conn::CopyToQueuedData(unsigned numbufs, SendData const *data, QueuedSendData *out)
{
        out->reserve(out->size() + numbufs);
        for (unsigned i=0;i<numbufs;++i)
        {
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Queuing buffer of size " << data[i].buflen << " at " << data[i].buffer);
                if (data[i].buflen>0) //DON'T add empty segments, they confuse the later code
                    out->push_back(data[i]);
        }

}

void Conn::DoSSLPrepareOutputForSending()
{
        if(ssl_conn->GetOutgoingDataLen() > 0 && state.queueddata.empty()) //there is data for transmission
        {
                state.ssl_queuedsize = ssl_conn->GetOutgoingDataLen();
                state.queueddata.push_back(SendData(ssl_conn->GetOutgoingDataPtr(), ssl_conn->GetOutgoingDataLen()));
                if(LockedDoSend())
                    dispmain.os.WakeUpConnection(this); //locks: itcqueue
        }
}

bool Conn::DoSSLOutput() //have locks: statemutex
{
        bool done_something = false;
        while(true)
        {
                bool anyaction = false;
                ssl_conn->PollIncomingData();

                while(!state.ssl_queueddata.empty() && !ssl_conn->MustWaitWithFeedOutgoingData())
                {
                        int bytesfed = ssl_conn->FeedOutgoingData(state.ssl_queueddata[0].buffer, state.ssl_queueddata[0].buflen);
                        //FIXME FeedOutgoingData can return <0
                        if(bytesfed>0)
                        {
                                anyaction=true;
                                state.ssl_blockssent += ::Blex::Dispatcher::DequeueOutgoingBytes(state.ssl_queueddata, bytesfed);
                                continue;
                        }

                        if(bytesfed<0) //SSL error condition.
                        {
                                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Write error from SSL");
                                GotDisconnection(false); //locks:none
                        }
                        break; //nothing more to feed...
                }
                if(state.blockssent) //These are our generated blocks
                {
                        //FIXME release mylock?

                        // Only dequeue as many bytes as queued for this block
                        unsigned bytessent = state.ssl_queuedsize;
                        state.ssl_queuedsize = 0;

                        if (bytessent != 0)
                            ssl_conn->DiscardOutgoingBytes(bytessent);
                        state.blockssent=0;
                }
                if(ssl_conn->GetOutgoingDataLen() > 0 && state.queueddata.empty()) //there is data for transmission
                {
                        anyaction=true;
                        DoSSLPrepareOutputForSending();
                }
                if(!anyaction)
                    break;
                done_something = true;
        }
//        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> "
        return done_something;
}

void Conn::AsyncQueueSend(unsigned numbufs, SendData const *data) //locks: statemutex > itcqueue
{
        //assert(dispatcher->shared.IsOwned());
        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> " << numbufs << " buffers offered for queuing");

        bool must_wake_up = false;

        { // lock the connection state
                StateMutex::AutoLock statelock(statemutex);

                if(ssl_conn.get())
                {
                        // Simply schedule the data, but DON'T immediately send it
                        must_wake_up = state.ssl_queueddata.empty();
                        CopyToQueuedData(numbufs, data, &state.ssl_queueddata);
                }
                else
                {
                        // Is there already a write going on?
                        bool must_try_send = state.queueddata.empty();
                        CopyToQueuedData(numbufs, data, &state.queueddata);

                        if (must_try_send && !state.queueddata.empty()) //we haven't tried yet?
                            must_wake_up = LockedDoSend(); //locks: itcqueue
                }
        }

        if (must_wake_up)
            dispmain.os.WakeUpConnection(this); //locks: itcqueue
}

void Conn::EnableIncomingData(bool enable) //locks: statemutex
{
        StateMutex::AutoLock statelock(statemutex);
        if (enable)
            state.flags &= ~State::StopIncomingData;
        else
            state.flags |= State::StopIncomingData;
}

//Locks: takes none. Relies on AsyncHookSignal not taking out any locks
void Conn::GotDisconnection(bool graceful_close) //locks: none
{
        if ((state.pending_signals & Signals::Hangup) || (state.flags & State::Closed || state.flags & State::ToldHangup))
            return;

        callbacks.AsyncHookSignal(graceful_close ? Signals::GotEOF: Signals::Hangup);
        state.pending_signals |= graceful_close ? Signals::GotEOF: Signals::Hangup;
}

bool Conn::AsyncSignal(Signals::SignalType signal) //locks: statemutex, itcqueue
{
        //Try to deliver the signal asynchrously first
        {
                StateMutex::AutoLock statelock(statemutex);
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> State: " << state << " got signal " << signal);

                if(state.pending_signals & (Signals::Hangup | signal))
                    return false; //dupe signal, or unable to deliver because connection is going away

                state.pending_signals |= signal;
                if (state.flags & State::Running)
                {
                        callbacks.AsyncHookSignal(signal); //only send an async signal if it was running
                        return true;
                }
        }
        //wake up!
        dispmain.os.WakeUpConnection(this); //locks: itcqueue
        return true;
}

//Locks: Conn::StateMutex should be taken
void Conn::DoSignal(Signals::SignalType signal, StateMutex::ScopedLock *mylock) //locks: ~scopedlock > shareddata, ~scopedlock > itcqueue, ~scopedlock > timerdata
{
        //Clear signal and do preparations for those signal that require it..
        state.pending_signals &= ~signal;

        // List of tasks that must be cancelled. Has ownership of tasks
        std::vector< Task * > cancel_tasks;
        try
        {
                //If this connection is already closed, do not bother sending a Disconnect signal (ADDME: And perhaps no other signals either?)
                if (signal == Signals::Hangup)
                {
                        state.flags |= State::ToldHangup;

                        // Transfer running tas
                        cancel_tasks.assign(state.running_tasks.begin(), state.running_tasks.end());
                        state.running_tasks.clear();

                        for (std::list< Task * >::iterator it = state.pending_tasks.begin(); it != state.pending_tasks.end();)
                        {
                                Task *task = *it;
                                /* Can't expect a waiting task to complete, but we can safely
                                   ignore the responses (can't return those to sender either)
                                */
                                if (task->state == TaskState::Waiting)
                                {
                                        // erase never fails, so do that last.
                                        cancel_tasks.push_back(task);
                                        state.pending_tasks.erase(it++);
                                }
                                else
                                    ++it;
                        }
                }

                //Execute the connection's handler
                mylock->Unlock();

                // Move all cancelled tasks back to their sender
                for (std::vector< Task * >::iterator it = cancel_tasks.begin(); it != cancel_tasks.end(); ++it)
                {
                        // Transfer the task into an auto_ptr: it will be killed then
                        std::unique_ptr< Task > task(*it);
                        *it = 0;
                        TryReturnTaskToSender(task, TaskState::Failed);
                }
        }
        catch (std::exception &)
        {
                for (std::vector< Task * >::iterator it = cancel_tasks.begin(), end = cancel_tasks.begin(); it != end; ++it)
                    if (*it)
                        delete *it;
                throw;
        }

        //Remove this socket from the dispatcher's check list
        if (signal == Signals::Hangup)
        {
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Disconnecting: " << state);
                dispmain.RemoveConnectionFd(socket.GetFd()); //locks: shareddata
                OS_CancelRequests(mylock); //locks: itcqueue
                //not interested in elapsed timers on a disconnected connection
                SetTimer(Blex::DateTime::Invalid(), false); //locks: timerdata
        }
        //Translate 'grace' signals
        if (signal == Signals::TimerElapsed && curtimerisgrace)
        {
                signal = Signals::GracePeriodElapsed;
        }

        DEBUGPRINT("Call hooksignal " << signal);
        callbacks.HookSignal(signal);
        mylock->Lock();

        //Finish up those signals that require it
        if (signal == Signals::Hangup)
        {
                //Close the socket itself
                OS_CloseSocket(); //locks:itcqueue
                state.flags |= State::Closed;
        }
}

uint8_t const *Conn::ClearIncomingData(unsigned numbytes)
{
        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Clearing " << numbytes << " incoming bytes");
        if(ssl_conn.get())
        {
                if(numbytes > ssl_conn->GetIncomingDataLen())
                    throw std::runtime_error("ClearIncomingData tried to clear more bytes than there were available (SSL)");

                if (numbytes < ssl_conn->GetIncomingDataLen())
                    DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Only " << numbytes << " decrypted bytes parsed (" << (ssl_conn->GetIncomingDataLen() - numbytes) << " left)");
                else
                    DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> All input parsed (" << numbytes << " decrypted bytes)");
                ssl_conn->DiscardIncomingBytes(numbytes);
                // See if SSL has more data in its buffers
                ssl_conn->PollIncomingData();

/* FIXME needed ?
                //see if more data is available to process (ADDME: this is an ugly hack)
                connection.ssl_conn->FeedIncomingData(NULL,0);
*/
                return ssl_conn->GetIncomingDataPtr();
        }
        else
        {
                return ClearIncomingDataFromInbuf(numbytes);
        }
}

uint8_t const *Conn::ClearIncomingDataFromInbuf(unsigned numbytes)
{
        StateMutex::ScopedLock statelock(statemutex,true);

        if (numbytes > state.inbuflen)
        {
              ErrStream() << "ClearIncomingData tried to clear more bytes than there were available " << numbytes << "/" << state.inbuflen;
              FatalAbort();
              //throw std::runtime_error("ClearIncomingData tried to clear more bytes than there were available " + AnyToString(numbytes) + "/" + AnyToString(state.inbuflen));
        }

        state.inbuflen -= numbytes;
        if (state.inbuflen > 0)
        {
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Only " << numbytes << " bytes parsed (state: " << &state << "), now " << state.inbuflen);
                std::memmove(inbuf, inbuf + numbytes, state.inbuflen);
        }
        else
        {
                /* ADDME: Although life would be cooler if we could OS_PostNewRead
                          even with a non-empty buffer, you run into the problems
                          because your data appears at 'inbuf + inbuflen' and
                          have to move it backwards (but not at I/O completion,
                          but at pre-HookIncomingdata).

                          Too complex if we're still unsure whether the IOCP
                          dispatcher will actually stay... */
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> All input parsed (state: " << &state << ")");
                state.inbuflen=0;
                OS_PostNewRead(&statelock); //locks:itcqueue
        }
        return inbuf;
}

void Conn::DoEventSignalled(StateMutex::ScopedLock *mylock) //locks: none
{
        Event *event = state.signalled_events[0];
        mylock->Unlock();

        callbacks.HookEventSignalled(event);
        mylock->Lock();
}

void Conn::DoBlocksSent(StateMutex::ScopedLock *mylock) //locks: ~scopedlock > timerdata, ~scopedlock > itcqueue
{
        unsigned num_to_report = 0;

        if(ssl_conn.get()) //blockssent = encrypted blocks sent, ssl_blockssent = to-be-encrypted blocks sent
        {
                if(state.blockssent) //These are our generated blocks
                {
                        //FIXME release mylock?
                        assert(state.blockssent==1);

                        // Only dequeue as many bytes as queued for this block
                        unsigned bytessent = state.ssl_queuedsize;
                        state.ssl_queuedsize = 0;

                        ssl_conn->DiscardOutgoingBytes(bytessent);
                        state.blockssent=0;
                        DoSSLOutput();
                }

                if(state.ssl_blockssent) //Might as well inform the user
                {
                        num_to_report = state.ssl_blockssent;
                        state.ssl_blockssent = 0;
                }
        }
        else
        {
                num_to_report = state.blockssent;
                state.blockssent = 0;
        }

        /* FIXME: when the conn is SSL, don't send (0 blocks sent) reports originating from tcp conn. But because the webserver
           uses AnySendsPending to detect whether the connection may be zapped the using Hangup signal it needs to detect changes
           of the return value AnySendsPending. And because of that Hangup signal, any data in state.queueddata will be zapped on
           connection close. So, AnySendsPending must return true when state.queueddata isn't empty, and we must call
           HooDataBlocksSent(0) when if becomes empty to enable the webserver to detect that. Sigh.
        */
//        if (num_to_report == 0)
//            return;

        mylock->Unlock();
        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Reporting " << num_to_report << " blocks sent");
        callbacks.HookDataBlocksSent(num_to_report);
        mylock->Lock();
}

//FIXME Just expose socket.cpp's version to us
void DumpPacket(unsigned len,void  const *buf)
{
        for (unsigned i=0;i<len;i+=16)
        {
                std::ostringstream line;
                line << std::hex << std::setw(4) << i << " ";

                for (unsigned j=0;j<16;++j)
                {
                        if (i+j<len)
                            line << std::hex << std::setw(2) << (int)static_cast<const uint8_t*>(buf)[i+j];
                        else
                            line << "  ";

                        if (j==7)
                            line << " ";
                }
                line << " ";

                for (unsigned j=0;j<16;++j)
                {
                        if (i+j<len)
                            line << char( static_cast<const uint8_t*>(buf)[i+j]>=32 && static_cast<const uint8_t*>(buf)[i+j]<=127 ? static_cast<const uint8_t*>(buf)[i+j] : '.');

                        if (j==7)
                            line << " ";
                }
                DEBUGPRINT(line.str());
            }
}

void Conn::ParseSSLInboundData(StateMutex::ScopedLock *mylock)
{
        if (in_idle_grace) //disable the grace period
            SetTimer(Blex::DateTime::Invalid(), false); //locks: timerdata

        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Offering " << ssl_conn->GetIncomingDataLen() << " decrypted bytes");
#if defined(DISPATCHER_SOCKETCHECKING_ALL) && defined(DEBUG)
        DumpPacket(ssl_conn->GetIncomingDataLen(), ssl_conn->GetIncomingDataPtr());
#endif

        mylock->Unlock();
        callbacks.HookIncomingData(ssl_conn->GetIncomingDataPtr(), ssl_conn->GetIncomingDataLen());
        mylock->Lock();
}

void Conn::DoParse(StateMutex::ScopedLock *mylock) //locks: ~scopedlock > timerdata, ~scopedlock > itcqueue
{
        if (ssl_conn.get())
        {
                mylock->Unlock();

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> SSL received " << state.inbuflen << " encrypted incoming bytes");
                unsigned ssl_bytes_parsed = ssl_conn->FeedIncomingData(inbuf, state.inbuflen);
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> SSL processed " << ssl_bytes_parsed << " encrypted bytes. " << (state.inbuflen - ssl_bytes_parsed) << " left in buffer");
                ClearIncomingDataFromInbuf(ssl_bytes_parsed);
                ssl_conn->PollIncomingData();

                //ParseSSLInboundData(mylock);

                /* Only parse data when we are in the process of parsing a request (the
                   browser may be sending in requests too quick, eg Opera) */
                //DoSSLOutput();

                mylock->Lock();
        }
        else
        {
                mylock->Unlock();

                if (in_idle_grace) //disable the grace period
                    SetTimer(Blex::DateTime::Invalid(), false); //locks: timerdata

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Offering " << state.inbuflen << " bytes for parse");

#if defined(DISPATCHER_SOCKETCHECKING_ALL) && defined(DEBUG)
                DumpPacket(state.inbuflen, inbuf);
#endif
                callbacks.HookIncomingData(inbuf,state.inbuflen);
                mylock->Lock();
        }
}

bool Conn::AnyReadyTask(StateMutex::ScopedLock *) //locks: ~scopedlock
{
        if (state.pending_tasks.empty())
            return false;

        std::list< Task * >::iterator it = state.pending_tasks.begin();

        // If we are explictly waiting for an answer, fish it out of the task queue
        if (state.flags & State::WaitingForRemoteTask)
        {
                while (it != state.pending_tasks.end() && (*it)->sender != &callbacks)
                    ++it;
                if (it == state.pending_tasks.end())
                    return false;
        }
        return true;
}

void Conn::DoTask(StateMutex::ScopedLock *mylock) //locks: ~scopedlock
{
        std::list< Task * >::iterator it = state.pending_tasks.begin();

        // If we are explictly waiting for an answer, fish it out of the task queue
        if (state.flags & State::WaitingForRemoteTask)
        {
                while (it != state.pending_tasks.end() && (*it)->sender != &callbacks)
                    ++it;
                if (it == state.pending_tasks.end())
                    return;
        }

        // Transfer ownership of task to auto_ptr
        std::unique_ptr< Task > task(*it);
        state.pending_tasks.erase(it);

        mylock->Unlock();

        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Executing task " << task.get());

        TaskState::Type start_state = task->state;
        switch (start_state)
        {
        case TaskState::Waiting:
                {
                        try
                        {
                                bool is_finished = callbacks.HookExecuteTask(task.get());

                                if (task->state == TaskState::Waiting && is_finished)
                                    task->state = TaskState::Completed;

                                TaskState::Type new_state = task->state;
                                switch (new_state)
                                {
                                case TaskState::Waiting:
                                        {
                                                task->state = TaskState::Running;

                                                mylock->Lock();
                                                state.running_tasks.push_back(0);
                                                state.running_tasks.back() = task.release();
                                                return;
                                        }
                                case TaskState::Completed:
                                case TaskState::Failed:
                                        {
                                                TryReturnTaskToSender(task, new_state);

                                                mylock->Lock();
                                                return;
                                        }
                                default:
                                    throw std::logic_error("Dispatcher: Illegal task return state encountered in DoTask (" + GetName(new_state) + ")");
                                }
                        } // Break not needed here
                        catch (std::runtime_error &)
                        {
                                TryReturnTaskToSender(task, TaskState::Failed);
                                throw;
                        }
                }

        case TaskState::Completed:
        case TaskState::Failed:
                // This callback may delete the task; make sure NOT to reference it after this
                callbacks.HookExecuteTask(task.get());
                break;

        default:
            throw std::runtime_error("Dispatcher: Illegal task state encountered in DoTask (" + GetName(start_state) + ")");
        }

        // We're in the context of the sender of the task (&callbacks == task->sender)
        mylock->Lock();

        // Not waiting anymore for blocking task
        state.flags &= ~State::WaitingForRemoteTask;
}

void Conn::SetTimer(Blex::DateTime signal_at, bool grace_period) //locks: timerdata
{
        DEBUGDISPATCHPRINT(this << " Timer set " << signal_at << " tp " << grace_period);
        //NOTE: we need to set _both_ flags, as a Timer event might be queued
        //      whilst we are receiving incoming data. incoming data resets
        //      in_idle_grace to false, but we still need to recognize the
        //      incoming timer as a grace period expiration.
        in_idle_grace = grace_period;
        curtimerisgrace = grace_period;
        dispmain.RequestSignal(signal_at, socket.GetFd(), this); //locks: timerdata
}

void Conn::QueueRemoteTask(Connection *receiver, std::unique_ptr< Task > &task, bool blocking) //locks: statemutex
{
        assert(task.get());

        // Fill in needed data in task
        task->state = TaskState::Waiting;
        if (blocking)
            task->sender = &callbacks;
        else
            task->sender = 0;
        task->queueingtime = DateTime::Now();

        {
                StateMutex::AutoLock statelock(statemutex);

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Sending message from " << this << "(" << this->state << ")");

                if (state.flags & State::WaitingForRemoteTask)
                {
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Already waiting for remote task completion");
                        throw std::runtime_error("Trying to queue remote task when already waiting for completion of another one");
                }
                if (blocking)
                    state.flags |= State::WaitingForRemoteTask;
        }
        bool success = false;
        {
                StateMutex::AutoLock receiver_statelock(receiver->conn->statemutex);

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> to " << receiver << " (" << receiver->conn->state << ")");

                if (!(receiver->conn->state.flags & State::Closed) && !(receiver->conn->state.flags & State::ToldHangup))
                {
                        // Give ownership to receiver. Work around bad_alloc exception.
                        receiver->conn->state.pending_tasks.push_back(0);
                        receiver->conn->state.pending_tasks.back() = task.release();

                        success = true;
                }
        }

        if (success)
            dispmain.os.WakeUpConnection(receiver->conn); //locks: itcqueue
        else
            TryReturnTaskToSender(task, TaskState::Failed);
}

void Conn::TryReturnTaskToSender(std::unique_ptr< Task > &task, TaskState::Type new_state) // locks task->sender->statelock, task->sender->itcqueue
{
        // Returns a blocking task to its sender
        assert(new_state == TaskState::Failed || new_state == TaskState::Completed);
        assert(task.get());

        if (!task->sender) // No response needed? Okay.
        {
                task.reset();
                return;
        }

        // Update the state before we relinguish control of the task structure
        task->state = new_state;

        // Get the sender
        Conn *sender = task->sender->conn;
        {
                StateMutex::AutoLock statelock(sender->statemutex);

                assert(sender->state.flags & State::WaitingForRemoteTask);

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Sending task " << task.get() << " back to sender (" << sender->state << ")");

                // If not closed, queue the task
                if (!(sender->state.flags & State::Closed) && !(sender->state.flags & State::ToldHangup))
                {
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Task " << task.get() << " sender has already closed");

                        // Give ownership to sender. Work around bad_alloc exception.
                        sender->state.pending_tasks.push_back(0);
                        sender->state.pending_tasks.back() = task.release();
                }
                else
                {
                        // Else notify the sender that it can stop waiting.
                        sender->state.flags &= ~State::WaitingForRemoteTask;

                        // Kill the task.
                        task.reset();
                }
        }

        // Always wakeup
        dispmain.os.WakeUpConnection(sender); //locks: itcqueue
}

void Conn::MarkTaskFinished(Task *task, bool success)
{
        if (task->state != TaskState::Waiting && task->state != TaskState::Running)
            throw std::runtime_error("Only waiting or running tasks may be marked as finished");

        TaskState::Type oldstate = task->state;

        task->state = success ? TaskState::Completed : TaskState::Failed;

        // Erase the task from the list of running tasks of needed (if state is 'pending', hookexecutetask will take care of it)
        if (oldstate == TaskState::Running)
        {
                std::unique_ptr< Task > task_ptr;
                {
                        StateMutex::AutoLock statelock(statemutex);

                        // Remove the task from the running_tasks list.
                        std::list< Task * >::iterator it = std::find(state.running_tasks.begin(), state.running_tasks.end(), task);
                        if (it == state.running_tasks.end())
                            throw std::runtime_error("Marking a task as finished that isn't running at all!");

                        // Transfer ownership
                        task_ptr.reset(*it);
                        state.running_tasks.erase(it);
                }

                // Send the reply back to the sender
                TryReturnTaskToSender(task_ptr, task->state);
        }
}

bool Conn::AnySendsPending()
{
        StateMutex::AutoLock statelock(statemutex);

        /* FIXME: when the conn is SSL, ignore normal queueddata. But the webserver doesn't use nr of sent blocks, but uses
           this function instead, and shuts down a connection when it returns false and it hasn't any data to send.
           When data is present in the normal queueddata then and webserver kills the connection with signal Hangup,
           that data will depart to the great bitbucket in the sky. Similar problem with HookDataBlocksSent.
        */
        return !state.ssl_queueddata.empty() || !state.queueddata.empty();
}

void Conn::AddEvent(Event *event) //locks: itcqueue
{
        waitevents.push_back(event);

        {
                // Add to locked waiters list in event: callbacks after here
                Event::LockedData::WriteRef lock(event->data);
                lock->waiters.push_back(this);
        }

        // Get current signalled status
        SetEventSignalled(*event, event->IsSignalled());  //locks: itcqueue
}

void Conn::RemoveEvent(Event *event)  //locks: itcqueue
{
        Blex::Detail::EventWaiterBase *base = this;

        std::vector< Event * >::iterator it = std::find(waitevents.begin(), waitevents.end(), event);
        if (it != waitevents.end())
        {
                {
                        // Removed from locked waiters list in event: no more callbacks after here
                        Event::LockedData::WriteRef lock((*it)->data);
                        lock->waiters.erase(std::find(lock->waiters.begin(), lock->waiters.end(), base));
                }

                waitevents.erase(it);
        }

        // Unconditional remove from signalled list
        SetEventSignalled(*event, false);  //locks: itcqueue
}

void Conn::RemoveAllEvents()
{
        for (std::vector< Event * >::iterator it = waitevents.begin(); it != waitevents.end(); ++it)
        {
                // Removed from locked waiters list in event: no more callbacks after here
                Event::LockedData::WriteRef lock((*it)->data);
                lock->waiters.erase(std::find(lock->waiters.begin(), lock->waiters.end(), this));
        }
}

void Conn::SetEventSignalled(Event &event, bool signalled) //locks: itcqueue
{
        bool must_wake = false;
        {
                StateMutex::AutoLock statelock(statemutex);

                std::vector< Event * >::iterator it = std::find(state.signalled_events.begin(), state.signalled_events.end(), &event);
                if (it == state.signalled_events.end())
                {
                        if (signalled)
                            state.signalled_events.push_back(&event);
                }
                else if (!signalled)
                    state.signalled_events.erase(it);

                // When still running, the events will be picked up in the running loop.
                if (!state.signalled_events.empty() && !(state.flags & State::Running))
                    must_wake = true;
        }
        if (must_wake)
            dispmain.os.WakeUpConnection(this); //locks: itcqueue
}

void Conn::SetNagle(bool newvalue)
{
        socket.SetNagle(newvalue);
}


Main::Main(Dispatcher::CreateConnectionCallback const &callback)
: os(*this)
, connectioncallback(callback)
, timerthread(std::bind(&Main::TimerThreadCode, this))
{
#ifdef DISPATCHER_MUTEXCHECKING
        shareddata.SetupDebugging("Main::SharedData");
        timerdata.SetupDebugging("Main::TimerData");
#endif

        LockedTimerData::WriteRef lock(timerdata);
        lock->must_abort=false;
        lock->next_checks=Blex::DateTime::Min();
}

Main::~Main()
{
        AsyncStopTimerThread();
        timerthread.WaitFinish(); //let's close it before destructing OS-specific stuff
}

void Main::Start(unsigned numworkers, int _idlegrace, bool _signalnewconnection)
{
        DEBUGDISPATCHPRINT("Launching " << (numworkers-1) << " extra workers");
        idlegrace = _idlegrace;
        signalnewconnection = _signalnewconnection;
        timerthread.Start();

        /** Create worker structures */
        for (unsigned i=0;i<numworkers-1;++i)
        {
                std::shared_ptr<Blex::Thread> worker;
                worker.reset(new Blex::Thread(std::bind(&OSData::WorkerThreadCode,&os)));

                if (!worker->Start())
                   throw std::runtime_error("Cannot launch dispatcher worker threads");

                workers.push_back(worker);
        }

        DEBUGDISPATCHPRINT("The dispatcher has been started!");

        //We'll be a worker ourselves too!
        os.WorkerThreadCode();

        DEBUGDISPATCHPRINT("The dispatcher has stopped!");

        /* now that all workers _should_ have terminated, close their threads */
        for (unsigned i=0;i<workers.size();++i)
          if (workers[i].get())
            workers[i]->WaitFinish();
        workers.clear();

        /* get other threads to cease as well */
        os.Stop();
        AsyncStopTimerThread();
        timerthread.WaitFinish();

        LockedSharedData::WriteRef lock(shareddata);
        lock->conn_structures.clear();
        lock->free_conns.clear();
        lock->openports.clear();
}

Conn* Main::PrepareAcceptIncoming(LockedSharedData::WriteRef &lock) //locks: statemutex > timerdata
{
        if (lock->shutting_down)
            return NULL;

        Conn *conn;
        if (lock->free_conns.empty())
        {
                DEBUGDISPATCHPRINT("Creating new connection structure to accept connection");
                conn=CreateConnectionStructure(lock); //locks: none
        }
        else
        {
                conn=lock->free_conns.back();
                lock->free_conns.erase(lock->free_conns.end()-1);

                DEBUGDISPATCHPRINT("Allocated connection structure from free list: " << conn);
        }

        return conn;
}

bool Main::CompleteAcceptIncoming(ListenPort &accepter, Conn *conn) //called with statelock held
{
        bool signalme=false;

        if(signalnewconnection)
        {
                conn->state.pending_signals |= Signals::NewConnection;
                signalme=true;
        }

        //Prepare a timer for the socket
        if (idlegrace>0)
        {
                DEBUGPRINT("Setting idle grace to " << idlegrace << " seconds");
                conn->SetTimer(Blex::DateTime::Now() + Blex::DateTime::Seconds(idlegrace), true); //locks: timerdata
        }
        else
        {
                conn->in_idle_grace=false;
        }

        if(accepter.ssl.get())
        {
                conn->ssl_conn.reset(new SSLConnection(*accepter.ssl));
        }
        conn->listening_address = accepter.bindaddress.sockaddr;

        return signalme;
}

Conn* Main::AcceptIncomingTCP(ListenPort &accepter, LockedSharedData::WriteRef &lock) //locks: statemutex > timerdata
{
        /* NOTE: This function may NOT call back into the OS specific code (it might deadlock the POSIX bosspipe) */
        Conn *conn = PrepareAcceptIncoming(lock);
        if(!conn)
            return NULL;

        DEBUGDISPATCHPRINT("Allocate conn " << conn);

        if (accepter.acceptsocket.Accept(&conn->socket)!=SocketError::NoError)
        {
                DEBUGDISPATCHPRINT("Failed to accept connection on " << conn << ", place on free list");
                lock->free_conns.push_back(conn);
                return NULL;
        }
        //conn->socket.SetDebugMode(Debug::Socket::All);

        //NTPORTS: The socket inherits the FD_CLOSE watch from the acceptor' WSAAsyncSelect
        lock->openports.insert(std::make_pair(conn->socket.GetFd(), OpenPort(conn->socket.GetFd(),conn)));

        DEBUGDISPATCHPRINT("<D:" << conn->socket.GetFd()
                           << "> Accepted " << conn->socket.GetRemoteAddress()
                           << " conn " << conn
                           << " " << conn->state
                           << "," << lock->free_conns.size() << " free, "
                           << lock->openports.size() << " active, "
                           << lock->conn_structures.size() << " total" );

        //ADDME: This preparation should have already been done when the socket was created/closed!
        bool signal=false;
        {
                Conn::StateMutex::ScopedLock statelock(conn->statemutex,true);
                conn->state.inbuflen=0;

                DEBUGDISPATCHPRINT("State " << &conn->state << " accepted connection, reset inbuf");

                //Switch socket to nonblocking
                if (conn->socket.SetBlocking(false) != SocketError::NoError)
                    throw std::runtime_error("Dispatcher is unable to unblock socket");

                signal = CompleteAcceptIncoming(accepter, conn);
        }

        if(signal)
            os.WakeUpConnection(conn); //locks: itcqueue
        return conn;
}

unsigned Main::CountListeningPorts() const
{
        unsigned countports = 0;
        LockedSharedData::ReadRef datalock(shareddata);

        for (unsigned i=0;i<datalock->accepts.size();++i)
          if (datalock->accepts[i]->listening)
            ++countports;

        return countports;
}

void Main::UpdateListenPorts(unsigned numports, ListenAddress const ports[])
{
        DEBUGDISPATCHPRINT("UpdateListenPorts " << numports << " ports");
        ListenAddressList create_ports(ports,ports+numports);
        LockedSharedData::WriteRef datalock(shareddata);

        //ADDME: Deal with situations where port is the same, but SSL settings changed

        //Walk in reverse order to avoid referring deleted elements
        for (unsigned i=datalock->accepts.size();i>0;--i)
        {
                ListenPort &checkport=*datalock->accepts[i-1];
                ListenAddressList::iterator itr=FindPort(create_ports, checkport.bindaddress);

                if (itr==create_ports.end())
                {
                        //this port must be closed, since it doesn't exist in the new port list
                        if (checkport.listening)
                            os.CloseDispatchSocket(checkport.acceptsocket);

                        datalock->accepts.erase(datalock->accepts.begin()+i-1);
                }
                else
                {       //maintain this port

                        // SSL settings changed? Replace the SSL context
                        if (itr->privatekey != checkport.bindaddress.privatekey
                              || itr->certificatechain != checkport.bindaddress.certificatechain
                              || itr->ciphersuite != checkport.bindaddress.ciphersuite)
                        {
                                std::shared_ptr< SSLContext > new_ssl;

                                if (!itr->privatekey.empty() && !itr->certificatechain.empty())
                                {
                                        DEBUGPRINT("UpdateListenPorts setup ssl for existing port");

                                        //Try to open a keyfile - FIXME restore errors but how?
                                        new_ssl.reset(new SSLContext(true, itr->ciphersuite));

                                        if (!new_ssl->LoadPrivateKey(&itr->privatekey[0], itr->privatekey.size()))
                                        {
                                                Blex::ErrStream() << "Cannot load private key for existing port " << itr->sockaddr;
                                                DEBUGPRINT("Cannot load private key for existing port" << std::endl << itr->privatekey);
                                                //errorlog.StampedLog("Cannot read key file " + keypath);

                                                // Destroy the port, don't recreate it
                                                datalock->accepts.erase(datalock->accepts.begin()+i-1);
                                                create_ports.erase(itr);
                                                continue; //close the port!
                                        }
                                        else if (!new_ssl->LoadCertificateChain(&itr->certificatechain[0], itr->certificatechain.size()))
                                        {
                                                Blex::ErrStream() << "Cannot load certificate chain for existing port " << itr->sockaddr;
                                                DEBUGPRINT("Cannot load certificate chain for existing port" << std::endl << itr->certificatechain);
                                                //errorlog.StampedLog("Cannot read certificate file " + certpath);

                                                // Destroy the port, don't recreate it
                                                datalock->accepts.erase(datalock->accepts.begin()+i-1);
                                                create_ports.erase(itr);
                                                continue; //close the port!
                                        }
                                }

                                // Update SSL connection and save new SSL settings
                                checkport.ssl = new_ssl;
                                checkport.bindaddress = *itr;
                        }

                        // No need to create a new port anymore.
                        create_ports.erase(itr);
                }
        }

        //Now create the new ports
        for (ListenAddressList::iterator itr=create_ports.begin();itr!=create_ports.end();++itr)
        {
                ListenPortPtr newport(new ListenPort(*itr));
                if(!itr->privatekey.empty() && !itr->certificatechain.empty())
                {
                        DEBUGPRINT("UpdateListenPorts setup ssl for new port");
                        //Try to open a keyfile - FIXME restore errors but how?
                        newport->ssl.reset(new SSLContext(true, itr->ciphersuite));

                        if (!newport->ssl->LoadPrivateKey(&itr->privatekey[0], itr->privatekey.size()))
                        {
                                DEBUGPRINT("Cannot read private key for new port" << std::endl << itr->privatekey);
                                //errorlog.StampedLog("Cannot read key file " + keypath);
                                continue; //don't open the port!
                        }

                        if (!newport->ssl->LoadCertificateChain(&itr->certificatechain[0], itr->certificatechain.size()))
                        {
                                DEBUGPRINT("Cannot read certificate chain for new port" << std::endl << itr->certificatechain);
                                //errorlog.StampedLog("Cannot read certificate file " + certpath);
                                continue; //don't open the port!
                        }
                }
                datalock->accepts.push_back(newport);
        }

        DEBUGDISPATCHPRINT("UpdateListenPorts: AsyncBindingChange()");
        AsyncBindingChange();
}

Conn* Main::CreateConnectionStructure(LockedSharedData::WriteRef &writeref)
{
        //As we always generate this in the main thread, no real need to handle exceptions?
        Connection *newconn = connectioncallback(this);
        writeref->conn_structures.Adopt(newconn);
        return newconn->conn;
}

void Main::RemoveConnectionFd(int fd)
{
        DEBUGDISPATCHPRINT("Freeing fd " << fd);

        LockedSharedData::WriteRef datalock(shareddata);
        OpenPorts::iterator it = datalock->openports.find(fd);
        if (it != datalock->openports.end())
        {
                datalock->openports.erase(it);
                return;
        }
        DEBUGDISPATCHPRINT("\aFreeing fd " << fd << " twice?!");
}

void Main::MarkAsFree(Conn *connection)
{
        DEBUGDISPATCHPRINT("Mark conn " << connection << " as free");

        LockedSharedData::WriteRef datalock(shareddata);

        datalock->free_conns.push_back(connection);
}
void Main::RequestSignal(Blex::DateTime signal_at, int fd, Conn *receiver) //locks: timerdata
{
        // Requesting a signal at the end of times is the same as not setting it at all
        if (signal_at == Blex::DateTime::Max())
            signal_at = Blex::DateTime::Invalid();

        bool require_signal = false;

        // Update the timer data
        if (receiver->registered_timer != signal_at)
        {
                DEBUGDISPATCHPRINT("<D:" << receiver->socket.GetFd() << "> Requestsignal " << receiver << " from " << AnyToString(receiver->registered_timer) << " -> " << AnyToString(signal_at));

                LockedTimerData::WriteRef lock(timerdata);

                if (receiver->registered_timer != Blex::DateTime::Invalid())
                    lock->warn_connections.erase(std::make_pair(receiver->registered_timer, std::make_pair(fd, receiver)));

                receiver->registered_timer = signal_at;
                if (receiver->registered_timer != Blex::DateTime::Invalid())
                {
                        // Only need a signal when this will be the new first timer
                        if (lock->warn_connections.empty())
                            require_signal = true;
                        else
                            require_signal = lock->warn_connections.begin()->first > signal_at;

                        lock->warn_connections.insert(std::make_pair(signal_at, std::make_pair(fd, receiver)));
                }
        }

        //Inform the timer thread only when we have a new head of the list
        if (require_signal)
            timerdata.SignalOne();
}

void Main::GetNextTodo(Main::TodoItems &to_do) //locks: timerdata
{
        to_do.Reset();

        LockedTimerData::WriteRef lock(timerdata);
        while (true)
        {
                DateTime now = DateTime::Now();
                DateTime sleep_till = now + DateTime::Days(1);

                to_do.rebind_check = lock->next_checks < now;
                to_do.abort = lock->must_abort;

                //Check for a re-bind event
                if (to_do.rebind_check)
                {
                        lock->next_checks = now + DateTime::Seconds(5);
                }
                sleep_till = std::min(sleep_till, lock->next_checks);

//                DEBUGPRINT("Waits");
//                for (std::set< std::pair< DateTime, Conn* > >::iterator it = lock->warn_connections.begin(); it != lock->warn_connections.end(); ++it)
//                        DEBUGPRINT(" wait " << it->second << " " << AnyToString(it->first));

                //See if any connection wants a signal
                std::pair< DateTime, std::pair< int, Conn * > > searchlimit(now + DateTime::Msecs(1), std::make_pair(0, (Blex::Dispatcher::Detail::Conn*)0));
                std::set< std::pair< DateTime, std::pair< int, Conn* > > >::iterator warnlimit = lock->warn_connections.lower_bound(searchlimit);

                for (std::set< std::pair< DateTime, std::pair< int, Conn* > > >::iterator it = lock->warn_connections.begin(); it != warnlimit; ++it)
                {
                        Main::TodoItems::Warning warning;
                        warning.fd = it->second.first;
                        warning.conn = it->second.second;
                        warning.date = it->first;

                        to_do.to_warn.push_back(warning);
                }

                if (warnlimit != lock->warn_connections.end())
                    sleep_till = std::min(sleep_till, warnlimit->first);

                //Should we wait?
                if (to_do.abort || to_do.rebind_check || !to_do.to_warn.empty())
                    return;
                //Wait!
                lock.TimedWait(sleep_till);
        }
}

void Main::TimerThreadCode()
{
        TodoItems todo;
        while (true)
        {
                GetNextTodo(todo); //locks: timerdata
                if (todo.abort)
                    break;
                if (todo.rebind_check)
                {
                        MaintainConnections(); //locks: shareddata
                        RebindSockets(NULL); //locks: shareddata > itcqueue
                }

                for (std::vector< TodoItems::Warning >::iterator it = todo.to_warn.begin(), end = todo.to_warn.end(); it != end; ++it)
                {
                        DEBUGDISPATCHPRINT("<D:" << it->fd << "> Sending timerelapsed to " << it->conn);

                        LockedSharedData::ReadRef lock(shareddata);

                        OpenPorts::const_iterator pit = lock->openports.find(it->fd);
                        if (pit != lock->openports.end() && pit->second.conn == it->conn)
                        {
                                // Port still exists
                                LockedTimerData::WriteRef lock(timerdata);
                                if (it->conn->registered_timer == it->date)
                                    it->conn->AsyncSignal(Signals::TimerElapsed);
                        }
                }
        }
}

bool Main::RebindSockets(std::vector<ListenAddress> *broken_listeners) //locks: shareddata > itcqueue
{
        bool allbound=true;
        if(broken_listeners)
            broken_listeners->clear();

        //Add all accepting sockets to the list, and rebind those we can
        LockedSharedData::WriteRef datalock(shareddata);
        for (unsigned i=0;i<datalock->accepts.size();++i)
        {
                if (!datalock->accepts[i]->listening)
                {
                        //Attempt to rebind
                        SocketError::Errors error = BindPort(*datalock->accepts[i]);
                        if (error == SocketError::NoError) //locks: itcqueue
                        {
                                DEBUGDISPATCHPRINT("<D> RebindSockets: Succesfully bound accepter " << datalock->accepts[i]->bindaddress.sockaddr);
                        }
                        else
                        {
                                DEBUGDISPATCHPRINT("<D> RebindSockets: Still failed to bind accepter " << datalock->accepts[i]->bindaddress.sockaddr);
                                allbound=false;
                                if(broken_listeners)
                                {
                                        broken_listeners->push_back(datalock->accepts[i]->bindaddress);
                                        broken_listeners->back().lasterror = error;
                                }
                        }
                }
        }

        return allbound;
}

void Main::AsyncBindingChange()
{
        LockedTimerData::WriteRef(timerdata)->next_checks=Blex::DateTime::Min();
        timerdata.SignalAll();
}

void Main::AsyncStopTimerThread()
{
        LockedTimerData::WriteRef(timerdata)->must_abort=true;
        timerdata.SignalAll();
}

SocketError::Errors Main::BindPort(ListenPort &port) //locks: itcqueue, locked; shareddata
{
        SocketError::Errors binderror = port.acceptsocket.Bind(port.bindaddress.sockaddr);
        if(binderror != SocketError::NoError)
        {
                DEBUGPRINT("Could not bind to port " << port.bindaddress.sockaddr << ": " << SocketError::GetErrorText(binderror));
                return binderror;

        }

        SocketError::Errors listenerror = port.acceptsocket.Listen(ConnectionAcceptBacklog);
        if(listenerror != SocketError::NoError)
        {
                DEBUGPRINT("Could not listen to port " << port.bindaddress.sockaddr << ": " << SocketError::GetErrorText(listenerror));
                return listenerror;

        }

        os.AddListeningFd(port.acceptsocket.GetFd()); //locks: itcqueue
        port.acceptsocket.SetBlocking(false);
        port.listening = true;
        //port.acceptsocket.SetDebugMode(Debug::Socket::All);
        return SocketError::NoError;
}

void Main::MaintainConnections() //locks: shareddata
{
        LockedSharedData::WriteRef datalock(shareddata);
        while (datalock->free_conns.size() < MinimumFreeConnections)
        {
                Conn* conn=CreateConnectionStructure(datalock);
                datalock->free_conns.push_back(conn);
                DEBUGDISPATCHPRINT("Added spare connection " << conn << ", "
                                   << datalock->free_conns.size() << " free, "
                                   << datalock->openports.size() << " active, "
                                   << datalock->conn_structures.size() << " total");
        }
}

void Main::AbortAllConnections() //locks: shareddata > statemutex
{
        LockedSharedData::WriteRef datalock(shareddata);
        datalock->shutting_down = true;
        for (OpenPorts::iterator it = datalock->openports.begin(), end = datalock->openports.end(); it != end; ++it)
        {
                Conn::StateMutex::AutoLock statelock(it->second.conn->statemutex);
                it->second.conn->GotDisconnection(false);
        }
}

PosixData::PosixData(Main &main)
: main(main)
{
#ifdef DISPATCHER_MUTEXCHECKING
        posixdata.SetupDebugging("Main::PosixData");
        itcqueue.SetupDebugging("Main::ITCQueue");
#endif
        posix_bosspipe.GetReadEnd().SetBlocking(false);
        posix_bosspipe.GetWriteEnd().SetBlocking(false);

        poller.UpdateFDWaitMask(posix_bosspipe.GetReadEnd().GetPosixFd(), true, true, false, false);
}

PosixData::~PosixData()
{
}

void PosixData::Stop()
{
}

void PosixData::POSIX_SendCommand(IntraThreadCommand const &cmd) //locks: itcqueue
{
        DEBUGDISPATCHPRINT("<D> Send " << int(cmd.code) << " fd " << cmd.data.fd << " conn " << cmd.data.conn);

        bool must_signal=false;
        {
                LockedITCQueue::WriteRef itc(itcqueue);
                must_signal=itc->the_queue.empty();

                itc->the_queue.push(cmd);
        }
        if(must_signal)
        {
                uint8_t signal=1;
                if(posix_bosspipe.GetWriteEnd().Write(&signal,sizeof(signal))!=sizeof(signal))
                {
                        std::cerr << "Dispatcher subthread unable to communicate with main thread\n";
                }
        }
}

Conn* PosixData::POSIX_GetTask(Conn *last_task, bool last_conn_slept) //last_task: the task to put back on the queue
{
        bool must_select=false;
        std::vector< Poller::SignalledFd > signalled;
        while (true)
        {
                //Figure out what we can do!
                do
                { //sleep and lock posixdata
                        LockedSharedData::WriteRef lock(posixdata);

                        if (must_select) //go back to non-selecting phase
                        {
                                must_select=false;
                                lock->thread_in_select=false;
                        }
                        if (last_task)
                        {
                                if (!last_conn_slept)
                                    --lock->running_threads;

                                last_task=NULL;
                        }

                        while (true)
                        {
                                if (lock->abort)
                                {
                                        posixdata.SignalOne();
                                        return NULL;
                                }

                                if (lock->running_threads < lock->max_running_threads) //there is a chance to do soemthing?
                                {
                                        if (!lock->waiting_conns.empty())
                                        {
                                                Conn *conn = lock->waiting_conns.front();
                                                DEBUGDISPATCHPRINT("<D:" << conn->socket.GetFd() << "> Going to handle connection");
                                                lock->waiting_conns.pop();
                                                ++lock->running_threads;
                                                posixdata.SignalOne(); //prolly shouldn't signal if no running_thread available AND no more events?
                                                return conn;
                                        }
                                        if (!lock->thread_in_select) //we can start a select!
                                        {
                                                lock->thread_in_select=true;
                                                must_select=true; //start SELECTing
                                                break;
                                        }
                                }
                                //We may not select, and we may not pop off a connection, so go to sleep
                                DEBUGDISPATCHPRINT("<D> Can't do a thing, must sleep, " << lock->running_threads << " running");
                                lock.Wait();
                        }
                }
                while (!must_select); //end sleep on posixdata

                DEBUGDISPATCHPRINT("<D> Going to poll");
                int retval = poller.DoPoll(Blex::DateTime::Max());
                if (retval<0)
                {
#ifdef DISPATCHER_DEBUGERRORS
                        perror("Poll:");
#endif
                        if (errno != EINTR)
                        {
                                std::cerr << "Dispatcher abort after error: " << strerror(errno) << "\n";
                                LockedSharedData::WriteRef (posixdata)->abort=true;
                                posixdata.SignalAll();
                                return NULL;
                        }
                }

                signalled.clear();
                poller.ExportSignalled(&signalled);

                //hmm.. does it make sense to leave the select() loop if there are still events worth listening to, and running threads available?
                DEBUGDISPATCHPRINT("<D> Poll returned "  << retval);
                CheckDispatchables(signalled); //Clears the bosspipe signal
                ProcessITCQueue(); //Process the itc queue (bosspipe is cleared, so it's now safe to pop entries)
        }
}

void PosixData::WakeUpConnection(Conn *conn) //locks: itcqueue
{
        POSIX_SendCommand(IntraThreadCommand(Wakeup, conn));
}

void PosixData::CancelNextWorker()
{
        POSIX_SendCommand(IntraThreadCommand(Abort, (int)0));
}

void PosixData::AddListeningFd(int fd) //locks: itcqueue
{
        POSIX_SendCommand(IntraThreadCommand(AddReader,fd));
}

void PosixData::RemoveListeningFd(int fd)
{
        POSIX_SendCommand(IntraThreadCommand(RemoveReader,fd));
}

void PosixData::CloseDispatchSocket(DispatchSocket &socket)
{
        POSIX_SendCommand(IntraThreadCommand(CloseSocket, socket.ShutdownAndReleaseFd()));
}

void PosixData::ProcessITCQueue()
{
        bool wanted_abort=false;

        {
                LockedSharedData::WriteRef lock(posixdata);
                LockedITCQueue::WriteRef itc(itcqueue);

                while (! itc->the_queue.empty() && !wanted_abort)
                {
                        IntraThreadCommand cmd = itc->the_queue.front();
                        itc->the_queue.pop();

                        switch(cmd.code)
                        {
                        case AddReader:
                                poller.UpdateFDWaitMask(cmd.data.fd,true,true,false,false);
                                break;
                        case AddWriter:
                                poller.UpdateFDWaitMask(cmd.data.fd,false,false,true,true);
                                break;
                        case RemoveReader:
                                poller.UpdateFDWaitMask(cmd.data.fd,true,false,false,false);
                                break;
                        case RemoveWriter:
                                poller.UpdateFDWaitMask(cmd.data.fd,false,false,true,false);
                                break;
                        case CloseSocket:
                                close(cmd.data.fd);
                                poller.UpdateFDWaitMask(cmd.data.fd,true,false,true,false);
                                break;
                        case Wakeup:
                                lock->waiting_conns.push(cmd.data.conn);
                                break;
                        case Abort:
                                {
                                        lock->abort=true;
                                        wanted_abort=true;
                                }
                                break;
                        }
                }
        }

        if(wanted_abort)
            main.AbortAllConnections();
}

void PosixData::CheckDispatchables_Bosspipe() //we no longer use the pipe itself for the ITC queue (still cleanup the code!)
{
        uint8_t commandbytes[1024];
        posix_bosspipe.GetReadEnd().Read(commandbytes,sizeof commandbytes);
}

//Locks: Takes posixdata BEFORE main.shareddata
void PosixData::CheckDispatchables(std::vector< Poller::SignalledFd > const &signalled)
{
        {
                LockedSharedData::WriteRef lock(posixdata);
                //Handle commands first.
                if (poller.IsReadable(posix_bosspipe.GetReadEnd().GetPosixFd()))
                    CheckDispatchables_Bosspipe();

                Main::LockedSharedData::WriteRef datalock(main.shareddata);
                for (unsigned i=0;i<datalock->accepts.size();++i)
                  if (datalock->accepts[i]->listening)
                {
                        if (poller.IsReadable(datalock->accepts[i]->acceptsocket.GetFd()))
                        {
                                DEBUGDISPATCHPRINT("<D> Accepter " << i << " got something");
                                while (Conn *newconn = main.AcceptIncomingTCP(*datalock->accepts[i],datalock)) //locks: statemutex > timerdata
                                {
                                        /* ADDME:newconn->OS_PostNewRead(); but this is unsafe, we may flood the bosspipe (NOTE: No longer a real concern, bosspipe is deadlock-free) */
                                        //this is the effect of PostNewRead
                                        poller.UpdateFDWaitMask(newconn->socket.GetFd(),true,true,false,false);  //locks: itcqueue
                                        DEBUGDISPATCHPRINT("<D> Accepter " << i << " handled a connection - try one more!");
                                }
                        }
                }

                for (std::vector< Poller::SignalledFd >::const_iterator sit = signalled.begin(), send = signalled.end(); sit != send; ++sit)
                {
                        Main::OpenPorts::iterator it = datalock->openports.find(sit->fd);
                        if (it == datalock->openports.end())
                            continue;

                        bool input_ready = sit->is_readable;
                        bool output_ready = sit->is_writable;
                        bool is_hup = input_ready && sit->is_hup;

                        if (!input_ready&&!output_ready)
                            continue;

                        Conn &conn=*it->second.conn;

                        if (input_ready) //Remove from inbound set
                        {
                                DEBUGDISPATCHPRINT("<D:" << it->second.fd << "> Connection " << &it->second << " has incoming data");
                                poller.UpdateFDWaitMask(it->second.fd,true,false,false,false);
                        }
                        if (output_ready) //Remove from outbound set
                        {
                                DEBUGDISPATCHPRINT("<D:" << it->second.fd << "> Connection " << &it->second << " has permission to write");
                                poller.UpdateFDWaitMask(it->second.fd,false,false,true,false);
                        }
                        //Get a worker on it
                        {
                                Conn::StateMutex::ScopedLock statelock(conn.statemutex,true);
                                if (input_ready)
                                    conn.state.flags |= State::POSIXInputReady;
                                if (output_ready)
                                    conn.state.flags |= State::POSIXOutputReady;
                                if (is_hup) //HUP is not a graceful disconnect! that would be RDHUP
                                    conn.GotDisconnection(false);
                        }
                        lock->waiting_conns.push(&conn);
                }
        }
}

bool PosixData::InterruptHandler(int)
{
        //Called from a signal, so only async-safe functions may be called!
        CancelNextWorker();
        return true; //handled
}

PosixData::LockedData::LockedData()
{
        abort=false;
        running_threads=0;
        max_running_threads=40;//Blex::GetSystemCPUs(true) * 2; //ADDME: what's a good algo for this?
        thread_in_select=false;
}


//---------------------------------------------------------------------------
//
// Dispatch Connection
//
//---------------------------------------------------------------------------
void Conn::OS_MarkAsSleeping()
{
        {
                Conn::StateMutex::ScopedLock statelock(statemutex,true);
                if (state.flags & State::POSIXSleeping)
                {
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Requested to go to sleep, but already sleeping!");
                        return;
                }
                if (!(state.flags & State::Running))
                    throw std::runtime_error("Cannot mark as sleeping a non-running thread");

                state.flags |= State::POSIXSleeping;
        }

        {
                PosixData::LockedSharedData::WriteRef lock(dispmain.os.posixdata);
                --lock->running_threads;

                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Going to sleep, now running: " << lock->running_threads);
        }
        dispmain.os.posixdata.SignalOne();
}

void Conn::OS_PostNewRead(StateMutex::ScopedLock */*mylock*/) //locks:itcqueue
{
        dispmain.os.AddListeningFd(socket.GetFd()); //locks:itcqueue
}

void Conn::OS_Construct()
{
}

void Conn::OS_CloseSocket() //locks:itcqueue
{
        dispmain.os.CloseDispatchSocket(socket);
}

void Conn::OS_CancelRequests(StateMutex::ScopedLock */*mylock*/) //locks: itcqueue
{
        dispmain.os.POSIX_SendCommand(PosixData::IntraThreadCommand(PosixData::RemoveReader,socket.GetFd()));
        dispmain.os.POSIX_SendCommand(PosixData::IntraThreadCommand(PosixData::RemoveWriter,socket.GetFd()));
}

unsigned Conn::OS_TryOutgoingSend() //locks: itcqueue
{
        Blex::SemiStaticPodVector< struct iovec, 256 > out_buffers;
        ssize_t totalsize=0;
        bool skippedbuffers = false;
        for (std::vector<SendData>::const_iterator itr=state.queueddata.begin();itr!=state.queueddata.end();++itr)
        {
                //FIXME: Portability: itr->buffer must be unsigned char* on linux, char* on BSD???
                struct iovec newbuf = { (char*)itr->buffer, itr->buflen };
                out_buffers.push_back(newbuf);
                totalsize += itr->buflen;

                // Don't overflow the max nr of buffers to writev, and don't queue too much data
                if (totalsize >= 1024 * 1024 || out_buffers.size() == IOV_MAX)
                {
                        skippedbuffers = true;
                        break;
                }
        }

        int bytessent=writev(socket.GetFd(),&out_buffers[0],out_buffers.size());
        if (bytessent==-1)
        {
                if (errno == EAGAIN)
                {
                        //blocked, retry later
                        dispmain.os.POSIX_SendCommand(PosixData::IntraThreadCommand(PosixData::AddWriter,socket.GetFd())); //locks: itcqueue
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Write blocked");
                }
                else
                {
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Write error (from writev(), errno: " << errno << ")");
                        GotDisconnection(false); //locks:none
                }
                return 0;
        }
        else
        {
                DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Write completed (" << bytessent << " of " << totalsize << " bytes sent)");
                unsigned blocks = DequeueOutgoingBytes(state.queueddata,bytessent); //locks:none

                if (bytessent < totalsize || skippedbuffers)
                {
                        dispmain.os.POSIX_SendCommand(PosixData::IntraThreadCommand(PosixData::AddWriter,socket.GetFd())); //locks: itcqueue
                }
                return blocks;
        }
}

bool Conn::OS_HandleEvents(StateMutex::ScopedLock *mylock) //locks: itcqueue
{
        if (state.flags & State::POSIXInputReady && state.inbuflen < sizeof(inbuf))
        {
                int rcvd=socket.Receive(inbuf+state.inbuflen, sizeof(inbuf)-state.inbuflen);

                if (rcvd<0 && rcvd != Blex::SocketError::WouldBlock)
                {
                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Disconnecting Read on " << socket.GetFd() << " error " << rcvd << ":" << errno);
                        if (!state.queueddata.empty())
                        {
                                //std::cerr << "Client closed connection with outstanding writes\n";
                        }
                        state.flags &= ~State::POSIXInputReady;
                        // SocketError::Closed means a graceful close of the read channel (though not so graceful when we have a SSL connection)
                        bool is_graceful = rcvd == Blex::SocketError::Closed && !ssl_conn.get();
                        GotDisconnection(is_graceful); //locks: none
                }
                else
                {
                        if (rcvd<0) //would block
                            rcvd=0;

                        DEBUGDISPATCHPRINT("<D:" << socket.GetFd() << "> Received " << rcvd << " bytes for " << socket.GetFd());
                        if (rcvd < int(sizeof(inbuf)-state.inbuflen)) //we got too little, system receive buffer is empty
                        {
                                state.flags &= ~State::POSIXInputReady;
                        }
                        state.inbuflen += rcvd;

                        DEBUGDISPATCHPRINT("State " << &state << " add " << rcvd << " bytes, now " << state.inbuflen);

                        //keep an eye out for more data
                        OS_PostNewRead(mylock); //locks:itcqueue
                }
                return true;
        }
        else if (state.flags & State::POSIXOutputReady)
        {
                state.flags &= ~State::POSIXOutputReady;
                LockedDoSend(); //locks:itcqueue
                return true;
        }
        else
        {
                return false;
        }
}
//---------------------------------------------------------------------------
//
// Dispatch Worker
//
//---------------------------------------------------------------------------
void PosixData::WorkerThreadCode() //ADDME: Integrate into NTData/PosixData!
{
        //FIXME: On exception, kill the connection, not the thread!
        try
        {
                //Obtain safe access..
                Conn *conn = NULL;
                bool last_conn_slept=false;
                while (true)
                {
                        conn = POSIX_GetTask(conn, last_conn_slept);
                        if (!conn)
                            return; //we're aborting

                        Conn::StateMutex::ScopedLock statelock(conn->statemutex,true);
                        last_conn_slept = !conn->FinishHandlingConnection(&statelock);
                }
        }
        catch (std::exception &e)
        {
                std::cerr << e.what() << "\n";
                std::abort();
        }
}

} //end namespace Blex::Dispatcher::Detail
} //end namespace Blex::Dispatcher
} //end namespace Blex
