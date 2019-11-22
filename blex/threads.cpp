#include <blex/blexlib.h>


#include "threads.h"
#include <iostream>
#include "logfile.h"
#include "dispat_impl.h"
#include "context.h"
#include "pipestream.h"

#include <cerrno>
#include <iostream>
#include <csignal>

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(DEBUGPOLL) && defined(DEBUG)
 #define DEBUGPOLLPRINT(x) DEBUGPRINT(x)
 #define DEBUGPOLLONLY(x) x
#else
 #define DEBUGPOLLPRINT(x) BLEX_NOOP_STATEMENT
 #define DEBUGPOLLONLY(x) BLEX_NOOP_STATEMENT
#endif


/* ADDME: Some debugcode to verify proper mutex-sequencing would be nice.
          It would require specifying the required pre-locked mutex for
          every mutex, and using thread-local storage to verify that
          everything is locked in the proper order. we already do *some*
          of this, but most we don't.
   ADDME: A safer implementation of Async(Socket)Trigger would be
          using a signal system - we flip bits in a bitset and use non-blocking
          writes on the pipe to prevent pipe-full-deadlock. Duplicate triggers
          would be lost, but deadlocks and memory exceptions would be avoided*/

namespace Blex
{
struct CoreConditionMutex::CMData
{
        inline CMData() : pipe_waiters(0), waiter_signalled(0)
        {
        }

        ///Pthread condition object
        pthread_cond_t cond;

        /// Number of pipe waiters (write under mutex lock, read everywhere)
        volatile unsigned pipe_waiters;
        volatile unsigned waiter_signalled;

        void EnterPipeWait(); // must have mutex lock
        void LeavePipeWait(); // must have mutex lock
        void SignalAll();

        std::unique_ptr<Blex::PipeSet> pipe;
};

// Variables
bool throwondeadlock = false;

namespace Detail
{


void SetThrowOnDeadlock(bool dothrow)
{
  throwondeadlock = dothrow;
}

EventWaiterBase::~EventWaiterBase()
{
}

class DisableSigPipe
{
        private:
        static const DisableSigPipe disable_sig_pipe;
        DisableSigPipe()
        {
                //Make sure SIGPIPE is disabled
                std::signal(SIGPIPE,SIG_IGN);
        }
};

class PipeImpl
{
        public:
        PipeImpl();
        ~PipeImpl();

        int fd;
        bool block;
        bool eof;
};

PipeImpl::PipeImpl()
: fd(-1)
, block(true)
, eof(false)
{
}

PipeImpl::~PipeImpl()
{
        if (fd!=-1)
            close(fd);
}

PipeBasics::PipeBasics()
: impl(new Detail::PipeImpl)
{
}

PipeBasics::~PipeBasics()
{
        delete impl;
}

FileHandle PipeBasics::ReleasePipe()
{
        int fd = impl->fd;
        impl->fd=-1;
        return fd;
}

bool PipeBasics::IsBlocking()
{
        return impl->block;
}

void PipeBasics::SetBlocking(bool block)
{
        impl->block=block;

        int options = fcntl(impl->fd,F_GETFL) & ~O_NONBLOCK;
        if (!block)
            options |= O_NONBLOCK;

        fcntl(impl->fd,F_SETFL,options);
}


}

inline pthread_t GetNullThreadId()
{
        pthread_t v;
        v = 0;
        return v;
}

//ADDME: Platform-dependent solutions could probably do this with a native object
void ReadWriteMutex::LockRead()
{
        //Grant the lock only if no writers are waiting or active
        LockData::AutoLock scopedlock(lockdata);

        while (lockdata.lockcount==-1 || lockdata.waiting>0)
            scopedlock.Wait();

        ++lockdata.lockcount;
}

void ReadWriteMutex::LockWrite()
{
        //Grant the lock only if no writers are active
        LockData::AutoLock scopedlock(lockdata);

        ++lockdata.waiting;
        while (lockdata.lockcount!=0)
            scopedlock.Wait();

        lockdata.lockcount=-1;
        --lockdata.waiting;
}

void ReadWriteMutex::Unlock()
{
        //If lockcount==-1, we got here because of a Write unlock, otherwise its a Read unlock
        { //synchronize
                LockData::AutoLock scopedlock(lockdata);

                if (lockdata.lockcount==-1)
                    lockdata.lockcount=0;
                else
                    --lockdata.lockcount;
        }
        lockdata.SignalAll();
}

void DebugMutex::Lock(void)
{
        if (mutexname.empty())
            throw std::runtime_error("Mutexes must be named before they can be locked");

        if (!core.TryLock())
        {
                LOGPRINT("Mutex contention (" <<  mutexname << ") fighting thread " << GetThreadPointer(ownerthread));
                if (ownerthread == CurrentThread())
                {
                    ErrStream() << "DEADLOCK DETECTED (mutex: " << mutexname << ", thread: " << GetThreadPointer(CurrentThread()) << ")";
                    if (throwondeadlock)
                      throw std::logic_error("DEADLOCK DETECTED (mutex: " + mutexname + ", thread: " + Blex::AnyToString(GetThreadPointer(CurrentThread())) + ")");
                    FatalAbort();
                }
                core.Lock();
                LOGPRINT("Got mutex (" <<  mutexname << ")");
        }

        ownerthread=CurrentThread();
}

void DebugMutex::Unlock(void)
{
        if (!pthread_equal(ownerthread,CurrentThread()))
        {
                Blex::ErrStream() << "Unlocking mutex from thread that didn't originally lock the mutex";
                Blex::FatalAbort();
        }

        ownerthread = GetNullThreadId();
        core.Unlock();
}

void DebugMutex::ScopedLock::Lock(void)
{
        if (locked)
        {
                Blex::ErrStream() << "Recursive lock attempted";
                Blex::FatalAbort();
        }

        locked=true;
        mutex.Lock();
}

void DebugMutex::ScopedLock::Unlock(void)
{
        if (!locked)
        {
                Blex::ErrStream() << "Recursive unlock attempted";
                Blex::FatalAbort();
        }

        mutex.Unlock();
        locked=false;
}

bool DebugMutex::IsOwned() const
{
        return pthread_equal(ownerthread,CurrentThread());
}

bool DebugConditionMutex::ScopedLock::TimedWait(Blex::DateTime until)
{
        if (!locked)
            throw std::runtime_error("Mutex " + conmutex.GetMutexName() + " not owned on wait");

        return conmutex.TimedWait(until);
}
void DebugConditionMutex::ScopedLock::Wait()
{
        if (!locked)
            throw std::runtime_error("Mutex " + conmutex.GetMutexName() + " not owned on wait");
        conmutex.Wait();
}

void DebugConditionMutex::Wait()
{
        corecv.Wait();
        ownerthread=CurrentThread(); //reset owner (it may have been unset due to implicit locking)
}

bool DebugConditionMutex::TimedWait(Blex::DateTime until)
{
        bool returnvalue=corecv.TimedWait(until);

        ownerthread=CurrentThread(); //reset owner (it may have been unset due to implicit locking)
        return returnvalue;
}

} //end of namespace Blex



namespace Blex
{

namespace Detail
{

//-----------------------------------------------------------------------------
//
// Core mutex implementation
//
//-----------------------------------------------------------------------------

} //end namespace Detail

struct CoreMutex::LockData
{
        pthread_mutex_t pmutex;
};

#ifdef PTHREAD_ADAPTIVE_INITIALIZER_NP

static pthread_mutexattr_t pmutex_attr;

/* Initialize fast mutex attributes. linuxthread's adaptive mutex does not
   transfer mutex ownership to a waiting thread immediately, avoiding
   alternation, but is unfair and can cause starvation */
class Mutex_pmutex_attr_initialize
{
        public:
        Mutex_pmutex_attr_initialize()
        {
                pthread_mutexattr_init(&pmutex_attr);
                pthread_mutexattr_setkind_np(&pmutex_attr,PTHREAD_MUTEX_ADAPTIVE_NP);
        }
};
static Mutex_pmutex_attr_initialize __mutex_pmutex_attr_initialize;

CoreMutex::CoreMutex(bool fast) //throw (std::bad_alloc)
{
        lockdata=new LockData;

        pthread_mutex_init(&lockdata->pmutex,fast ? &pmutex_attr : NULL);
}
#else
CoreMutex::CoreMutex(bool) //throw (std::bad_alloc)
{
        lockdata=new LockData;

        pthread_mutex_init(&lockdata->pmutex,NULL);
}
#endif

CoreMutex::~CoreMutex() //throw()
{
        pthread_mutex_destroy(&lockdata->pmutex);
        delete lockdata;
}

void CoreMutex::Lock() //throw()
{
        pthread_mutex_lock(&lockdata->pmutex);
}

void CoreMutex::Unlock() //throw()
{
        pthread_mutex_unlock(&lockdata->pmutex);
}

bool CoreMutex::TryLock() //throw()
{
        return pthread_mutex_trylock(&lockdata->pmutex)!=EBUSY;
}


//-----------------------------------------------------------------------------
//
// Condition variable implementation
//
//-----------------------------------------------------------------------------

void CoreConditionMutex::CMData::EnterPipeWait()
{
        // FIXME: Rob: seen the pipe fd going invalid. WHY?
        if (pipe.get() && pipe->GetReadEnd().EndOfStream())
        {
                Blex::ErrStream() << "Pipe has gone invalid";
                pipe.reset();
        }

        // Initialize pipe before increasing pipe_waiters
        if (!pipe.get())
        {
                pipe.reset(new Blex::PipeSet);
                pipe->GetReadEnd().SetBlocking(false);
                pipe->GetWriteEnd().SetBlocking(false);
        }

        waiter_signalled = 0;
        if(++pipe_waiters!=1)
           throw std::runtime_error("EnterPipeWait: Invalid # of waiters: now " + Blex::AnyToString(const_cast<unsigned*>(&pipe_waiters)));
}

void CoreConditionMutex::CMData::LeavePipeWait()
{
        if (--pipe_waiters != 0)
           throw std::runtime_error("LeavePipeWait: Invalid # of waiters: now " + Blex::AnyToString(const_cast<unsigned*>(&pipe_waiters)));

        // Empty the pipe (read 16 bytes to pick up spurious signals)
        uint8_t buf[16];
        pipe->GetReadEnd().Read(buf,16);
}

void CoreConditionMutex::CMData::SignalAll()
{
        if (pipe_waiters && !waiter_signalled)
        {
                waiter_signalled = 1;
                uint8_t const buf[1] = { 0 };
                pipe->GetWriteEnd().Write(buf,1);
        }
}

CoreConditionMutex::CoreConditionMutex(CoreMutex &associated_mutex) //throw (std::bad_alloc,std::runtime_error)
 : associated_mutex(associated_mutex)
{
        cmdata=new CMData;
        pthread_cond_init(&cmdata->cond,NULL);
}

/** Mutex destructor */
CoreConditionMutex::~CoreConditionMutex() //throw (std::logic_error)
{
        bool failure=pthread_cond_destroy(&cmdata->cond)==EBUSY;
        delete cmdata;
        if (failure)
        {
                 Blex::ErrStream() << "Destroying mutex which still has waiters";
                 Blex::FatalAbort();
        }
}

/** Signal one thread waiting on this condition. Returns immediately if no thread is waiting */
void CoreConditionMutex::SignalOne() //throw()
{
        cmdata->SignalAll();
        pthread_cond_signal(&cmdata->cond);
}

void CoreConditionMutex::SignalAll() //throw()
{
        cmdata->SignalAll();
        pthread_cond_broadcast(&cmdata->cond);
}

void CoreConditionMutex::Wait() //throw()
{
        pthread_cond_wait(&cmdata->cond,&associated_mutex.lockdata->pmutex);
}

bool CoreConditionMutex::TimedWait(Blex::DateTime until) //throw()
{
        bool signalled=true;

        if (until==Blex::DateTime::Max())
        {
                Wait();
                return true;
        }

        struct timespec timeout;
        timeout.tv_sec = until.GetTimeT();
        timeout.tv_nsec = (until.GetMsecs()%1000)*1000000;

        if (pthread_cond_timedwait(&cmdata->cond,
                                   &associated_mutex.lockdata->pmutex,
                                   &timeout)==ETIMEDOUT)
            signalled=false;

        return signalled;
}

//-----------------------------------------------------------------------------
//
// Thread local context implementation
//
//-----------------------------------------------------------------------------

pthread_key_t key = 0;

void DestroyContextKeeper(void *ctxt)
{
        delete static_cast< ContextKeeper * >(ctxt);
}

void SetThreadContextKeeper(ContextKeeper *keeper)
{
        pthread_setspecific(key, keeper);
}

void InitThreadContext(ContextKeeper *keeper)
{
        pthread_key_create(&key, NULL);
        pthread_setspecific(key, keeper);
}

ContextRegistrator & GetThreadContextRegistrator()
{
        //FIXME may need pthread_once wrapping to be threadsafe!
        static ContextRegistrator maincontextreg;
        return maincontextreg;
}

ContextKeeper & CurrentThreadContext()
{
        void *ctxt = pthread_getspecific(key);
        if (!ctxt)
            throw new std::runtime_error("Blex thread context not initialized");

        return *static_cast< ContextKeeper * >(ctxt);
}



//-----------------------------------------------------------------------------
//
// Thread object
//
//-----------------------------------------------------------------------------

namespace Detail
{

#ifdef PROFILE
struct profile_data
{
        void *real_object;
        pthread_mutex_t lock;
        pthread_cond_t  wait;
        struct itimerval itimer;
        bool donewaiting;
};
#endif

extern "C" void *ThreadStarter(void *object)
{
#ifdef PROFILE
        //enable the itimer for profiling in this thread
        struct profile_data *prof = (struct profile_data*)object;
        object = prof->real_object;

        /* Set the profile timer value */
        setitimer(ITIMER_PROF, &prof->itimer, NULL);

        /* Tell the calling thread that we don't need its data anymore */
        pthread_mutex_lock(&prof->lock);
        prof->donewaiting=true;
        pthread_cond_signal(&prof->wait);
        pthread_mutex_unlock(&prof->lock);
#endif

        /* The B-Lex libs expect the main thread to handle all signals and use
           the Async calls to inform other threads of events, if necessary. So
           we block all signals in subthreads, so that the main thread can handle
           the signals */
        sigset_t mask;
        sigemptyset(&mask); //Empty mask
        sigaddset(&mask, SIGINT);
        sigaddset(&mask, SIGTERM);
        sigaddset(&mask, SIGHUP);
        sigaddset(&mask, SIGPIPE);
        pthread_sigmask(SIG_BLOCK, &mask, NULL);

        try
        {
                ContextKeeper threadcontextkeeper(GetThreadContextRegistrator());
                SetThreadContextKeeper(&threadcontextkeeper);

                static_cast<Thread*>(object)->threadfunction();
        }
        catch (std::exception &e)
        {
                std::cout << std::endl << "Thread exception: "<< e.what() << std::endl;
                std::abort();
        }
        catch (...)
        {
                std::cout << std::endl << "Thread unknown exception" << std::endl;
                std::abort();
        }
        return NULL;
}

} //end namespace Detail

ThreadId CurrentThread() //throw()
{
        return pthread_self();
}

Thread::Thread(std::function< void() > const &threadfunction)
 : threadfunction(threadfunction)
 , joinhandle(false)
{
}

Thread::~Thread() //throw()
{
        WaitFinish();
}

void Thread::WaitFinish() //throw()
{
        if (!joinhandle)
            return;

        pthread_join(handle,0);
        joinhandle=false;
}

bool Thread::Start() //throw()
{
        if (joinhandle) //thread is already running
            return false;

        pthread_attr_t attrs;
        std::size_t stacksize = 512*1024;
        pthread_attr_init(&attrs);
        pthread_attr_setstacksize(&attrs, stacksize);

        bool success;
#ifdef PROFILE
        struct Detail::profile_data prof;
        prof.real_object = this;
        getitimer(ITIMER_PROF, &prof.itimer);
        prof.donewaiting=false;

        pthread_cond_init(&prof.wait, NULL);
        pthread_mutex_init(&prof.lock, NULL);

        success = pthread_create(&handle,&attrs,&Detail::ThreadStarter,&prof)==0;

 /* If the thread was successfully spawned, wait for the data to be released */
        if (success)
        {
                pthread_mutex_lock(&prof.lock);
                while (!prof.donewaiting)
                    pthread_cond_wait(&prof.wait, &prof.lock);
                pthread_mutex_unlock(&prof.lock);
        }
        pthread_mutex_destroy(&prof.lock);
        pthread_cond_destroy(&prof.wait);
#else
        success = pthread_create(&handle,&attrs,&Detail::ThreadStarter,this)==0;

#endif
        pthread_attr_destroy(&attrs);
        if (!success)
            return false;

        joinhandle=true;
        return true;
}

void YieldThread() //throw()
{
        sched_yield();
}

void SleepThread(unsigned msecs) //throw()
{
        struct timespec wait = {msecs/1000,(msecs%1000)*1000000};

        //nanosleep may be signal-interrupted, so just keep looping then..
        while (nanosleep(&wait,&wait) == -1 && errno==EINTR) ;
}

Event::~Event()
{
        LockedData::ReadRef lock(data);
        if (!lock->waiters.empty())
        {
                ErrStream() << "Event " << this << " destroyed with active waiters";
                for (std::vector< Detail::EventWaiterBase * >::const_iterator it = lock->waiters.begin(); it != lock->waiters.end(); ++it)
                    Blex::ErrStream() << "Waiter: " << *it;
                FatalAbort();
        }
}

bool Event::IsSignalled()
{
        return true;
}

void Event::InternalStateChanged(LockedData::WriteRef &lock, bool is_signalled)
{
        for (std::vector< Detail::EventWaiterBase * >::iterator it = lock->waiters.begin(); it != lock->waiters.end(); ++it)
            (*it)->SetEventSignalled(*this, is_signalled);
}


void Event::StateChanged()
{
        LockedData::WriteRef lock(data);

        bool is_signalled = IsSignalled();
        InternalStateChanged(lock, is_signalled);
}



bool StatefulEvent::IsSignalled()
{
        LockedData::WriteRef lock(data);
        return lock->signalled;
}

void StatefulEvent::SetSignalled(bool signalled)
{
        LockedData::WriteRef lock(data);
        lock->signalled = signalled;
        InternalStateChanged(lock, signalled);
}

void StatefulEvent::StateChanged()
{
        LockedData::WriteRef lock(data);
        InternalStateChanged(lock, lock->signalled);
}

PipeWaiter::~PipeWaiter()
{
        ClearSelfFromEventWaiters();
}

void PipeWaiter::ClearSelfFromEventWaiters()
{
        for (std::vector< EventInfo >::iterator it = waitevents.begin(); it != waitevents.end(); ++it)
        {
                Event::LockedData::WriteRef lock(it->event->data);
                lock->waiters.erase(std::find(lock->waiters.begin(), lock->waiters.end(), this));
        }
}


void PipeWaiter::Reset()
{
        ClearSelfFromEventWaiters();

        want_console_read = false;
        waitreadpipes.clear();
        waitwritepipes.clear();
        waitsockets.clear();

        waitevents.clear();

        if (events_active)
        {
                LockedEventData::WriteRef lock(eventdata);

                lock->signalled.clear();
                lock->waiting = false;

                // Clear the pipe if needed
                if (lock->comm_read.get() && lock->pipe_signalled)
                {
                        uint8_t buf[1];
                        lock->comm_read->Read(buf, 1);
                        lock->pipe_signalled = false;
                }

                events_active = false;
        }
}

void PipeWaiter::AddReadPipe(PipeReadStream &pipe)
{
        if(pipe.IsBlocking())
            throw std::runtime_error("Cannot wait on a blocking pipe");

        unsigned pos;
        for (pos=0;pos<waitreadpipes.size(); ++pos)
          if (waitreadpipes[pos].read_stream == &pipe)
            return;

        PipeReadInfo newpipe;
        newpipe.read_stream = &pipe;
        newpipe.got_read = false;
        waitreadpipes.push_back(newpipe);
}

void PipeWaiter::AddWritePipe(PipeWriteStream &pipe)
{
        if(pipe.IsBlocking())
            throw std::runtime_error("Cannot wait on a blocking pipe");

        unsigned pos;
        for (pos=0;pos<waitwritepipes.size(); ++pos)
          if (waitwritepipes[pos].write_stream == &pipe)
            return;

        PipeWriteInfo newpipe;
        newpipe.write_stream = &pipe;
        newpipe.got_write = false;
        waitwritepipes.push_back(newpipe);
}

bool PipeWaiter::RemoveReadPipe(PipeReadStream &pipe)
{
        unsigned pos;
        for (pos=0;pos<waitreadpipes.size(); ++pos)
          if (waitreadpipes[pos].read_stream == &pipe)
        {
                waitreadpipes.erase(waitreadpipes.begin()+pos);
                return true;
        }
        return false;
}

bool PipeWaiter::RemoveWritePipe(PipeWriteStream &pipe)
{
        unsigned pos;
        for (pos=0;pos<waitwritepipes.size(); ++pos)
          if (waitwritepipes[pos].write_stream == &pipe)
        {
                waitwritepipes.erase(waitwritepipes.begin()+pos);
                return true;
        }
        return false;
}

void PipeWaiter::AddSocket(Socket &sock, bool want_read, bool want_write)
{
        if(sock.IsBlocking())
            throw std::runtime_error("Cannot wait on a blocking socket");

        SocketInfo &info = waitsockets[sock.GetFd()];

        info.socket = &sock;
        info.got_read = false;
        info.got_write = false;
        info.want_read = want_read;
        info.want_write = want_write;
}

bool PipeWaiter::RemoveSocket(Socket &sock)
{
        waitsockets.erase(sock.GetFd());
        return false;
}

void PipeWaiter::AddEvent(Event &event)
{
        unsigned pos, size;
        for (pos=0, size = waitevents.size();pos<size; ++pos)
          if (waitevents[pos].event == &event)
            return;

        waitevents.resize(size + 1);
        EventInfo &info(waitevents[size]);
        info.event = &event;
        info.got_signalled = false;
        events_active = true;

        Event::LockedData::WriteRef lock(event.data);
        lock->waiters.push_back(this);
}

bool PipeWaiter::RemoveEvent(Event &event)
{
        unsigned pos, size;
        for (pos=0, size = waitevents.size();pos<size; ++pos)
            if (waitevents[pos].event == &event)
            {
                    waitevents.erase(waitevents.begin() + pos);

                    // Remove this from the list of waiters inside the event
                    {
                            Event::LockedData::WriteRef lock(event.data);
                            lock->waiters.erase(std::find(lock->waiters.begin(), lock->waiters.end(), this));
                    }

                    // Remove the event from the signalled list, if present there
                    {
                            LockedEventData::WriteRef lock(eventdata);

                            std::vector< Event * >::iterator it = std::find(lock->signalled.begin(), lock->signalled.end(), &event);
                            if (it != lock->signalled.end())
                            {
                                    lock->signalled.erase(it);
                                    if (lock->signalled.empty() && lock->pipe_signalled)
                                    {
                                            uint8_t buf[1];
                                            lock->comm_read->Read(buf, 1);
                                            lock->pipe_signalled = false;
                                    }
                            }

                    }

                    return true;
            }
        return false;
}

bool PipeWaiter::GotRead(PipeReadStream &pipe) const
{
        unsigned pos;
        for (pos=0;pos<waitreadpipes.size(); ++pos)
          if (waitreadpipes[pos].read_stream == &pipe)
            return waitreadpipes[pos].got_read;

        return false;
}

bool PipeWaiter::GotWrite(PipeWriteStream &pipe) const
{
        unsigned pos;
        for (pos=0;pos<waitwritepipes.size(); ++pos)
          if (waitwritepipes[pos].write_stream == &pipe)
            return waitwritepipes[pos].got_write;

        return false;
}

bool PipeWaiter::GotRead(Socket &sock) const
{
        std::map< Socket::SocketFd, SocketInfo >::const_iterator it = waitsockets.find(sock.GetFd());
        if (it == waitsockets.end())
            return false;
        return it->second.got_read;
}

bool PipeWaiter::GotWrite(Socket &sock) const
{
        std::map< Socket::SocketFd, SocketInfo >::const_iterator it = waitsockets.find(sock.GetFd());
        if (it == waitsockets.end())
            return false;
        return it->second.got_write;
/*
        unsigned pos;
        for (pos=0;pos<waitsockets.size(); ++pos)
          if (waitsockets[pos].socket == &sock)
            return waitsockets[pos].got_write;

        return false;
*/
}

bool PipeWaiter::GotSignalled(Event &event) const
{
        unsigned pos, size;
        for (pos=0, size = waitevents.size();pos<size; ++pos)
          if (waitevents[pos].event == &event)
            return waitevents[pos].got_signalled;

        return false;
}

bool PipeWaiter::InitEventWait()
{
        //DEBUGPRINT("Pipewaiter: InitEventWait, events: " << waitevents.size());
        if (waitevents.empty())
            return false;

        // Check if any event is signalled
        bool retval = false;
        unsigned pos, size;
        for (pos=0, size = waitevents.size();pos<size; ++pos)
        {
                bool signalled = waitevents[pos].event->IsSignalled();
                waitevents[pos].got_signalled = signalled;
                retval = retval || signalled;
                //DEBUGPRINT(" Event: " << ((void*)waitevents[pos].event) << " signalled: " << (signalled?"yes":"no"));
        }

        if (retval)
            return true;

        // No events signalled. Create the pipes
        {
                //DEBUGPRINT(" No events signalled, creating pipes");
                LockedEventData::WriteRef lock(eventdata);

                // If any event is signalled, return
                if (!lock->signalled.empty())
                    return true;

                lock->waiting = true;

                if (!lock->comm_read.get())
                {
                        PipeSet set;
                        lock->comm_read.reset(set.ReleaseReadEnd());
                        lock->comm_read->SetBlocking(false);
                        lock->comm_write.reset(set.ReleaseWriteEnd());
                        lock->comm_write->SetBlocking(false);
                        lock->pipe_signalled = false;
                }

                // Always add read pipe, duplicate adds will be ignored.
                AddReadPipe(*lock->comm_read);
        }
        return false;
}

void PipeWaiter::FinishEventWait()
{
//        DEBUGPRINT("Pipewaiter: FinishEventWait, events: " << waitevents.size());
        if (waitevents.empty())
            return;

        LockedEventData::WriteRef lock(eventdata);
        lock->waiting = false;

//        DEBUGPRINT(" Signalled event count: " << lock->signalled.size());

        for (std::vector< Event * >::const_iterator it = lock->signalled.begin(); it != lock->signalled.end(); ++it)
        {
//                DEBUGPRINT(" Event " << ((void*)*it) << " is signalled");
                unsigned pos, size;
                for (pos=0, size = waitevents.size();pos<size; ++pos)
                    if (waitevents[pos].event == *it)
                        waitevents[pos].got_signalled = true;
        }
}

void PipeWaiter::SetEventSignalled(Event &event, bool signalled)
{
        LockedEventData::WriteRef lock(eventdata);

        std::vector< Event * >::iterator it = std::find(lock->signalled.begin(), lock->signalled.end(), &event);
        if (signalled)
        {
                if (it == lock->signalled.end())
                {
                    bool was_empty = lock->signalled.empty();
                    lock->signalled.push_back(&event);
                    if (was_empty && lock->waiting && !lock->pipe_signalled)
                    {
                            uint8_t buf[1] = { 1 };
                            lock->comm_write->Write(buf, 1);
                            lock->pipe_signalled = true;
                    }
                }
        }
        else
        {
                if (it != lock->signalled.end())
                {
                        lock->signalled.erase(it);
                        if (lock->signalled.empty() && (lock->waiting || lock->pipe_signalled))
                        {
                                uint8_t buf[1];
                                lock->comm_read->Read(buf, 1);
                                lock->pipe_signalled = false;
                        }
                }
        }
}

bool PipeWaiter::ConditionMutexWait(DebugConditionMutex::AutoLock &lock, Blex::DateTime until)
{
        bool retval = WaitInternal(&lock.conmutex.corecv, until);
        lock.conmutex.ownerthread=CurrentThread();
        return retval;
}

std::size_t PipeReadStream::Read(void *buf, std::size_t maxbufsize)
{
        if (impl->fd==-1 || impl->eof)
            return 0;

        ssize_t bytes = read(impl->fd,buf,maxbufsize);
        if (bytes>0)
            return bytes;

        if (bytes==-1 && (errno==EAGAIN || errno==EINTR))
            return 0;

        //EOF or I/O error
        impl->eof=true;
        return 0;
}

int PipeReadStream::GetPosixFd()
{
        if (impl->fd==-1)
            throw std::runtime_error("PipeReadStream::GetPosixFd: trying to obtain the file id of a terminated stream");
        return impl->fd;
}

bool PipeReadStream::EndOfStream()
{
        return impl->eof;
}

std::size_t PipeReadStream::Write(const void *, std::size_t )
{
        throw std::runtime_error("PipeReadStream::Write: Trying to write to the read end of a pipe");
}

std::size_t PipeWriteStream::Read(void *, std::size_t )
{
        throw std::runtime_error("PipeWriteStream::Read: Trying to read from the write end of a pipe");
}

bool PipeWriteStream::EndOfStream()
{
        throw std::runtime_error("PipeWriteStream::EndOfStream: Trying to read from the write end of a pipe");
}

std::size_t PipeWriteStream::Write(const void *buf, std::size_t bufsize)
{
        if (impl->fd==-1 || impl->eof)
            return 0;

        ssize_t bytes = write(impl->fd,buf,bufsize);
        if (bytes>0)
            return bytes;

        if (bytes==-1 && (errno==EAGAIN || errno==EINTR))
            return 0;

        //EOF or I/O error
        impl->eof=true;
        return 0;
}

int PipeWriteStream::GetPosixFd()
{
        if (impl->fd==-1)
            throw std::runtime_error("PipeWriteStream::GetPosixFd: trying to obtain the file id of a terminated stream");
        return impl->fd;
}

bool PipeWriteStream::IsPipeBroken()
{
        return impl->fd==-1;
}

PipeSet::PipeSet()
: writeend(new PipeWriteStream)
, readend(new PipeReadStream)
{
        int fds[2];
#ifdef PLATFORM_LINUX
        if (pipe2(fds, O_CLOEXEC)!=0)
            throw std::runtime_error("Cannot allocate handles for a new pipeset");
#else
        if (pipe(fds)!=0)
            throw std::runtime_error("Cannot allocate handles for a new pipeset");
        fcntl(fds[0], F_SETFD, 1);
        fcntl(fds[1], F_SETFD, 1);
#endif
        readend->impl->fd=fds[0];
        writeend->impl->fd=fds[1];
}

bool PipeWaiter::WaitInternal(CoreConditionMutex *conditionmutex, Blex::DateTime until)
{
        bool wait_satisfied=false;
        Poller poller;

        //Has any of the sockets had a succesful send? we can complete that one immediately then!
        for (std::map<Socket::SocketFd, SocketInfo>::iterator itr=waitsockets.begin();itr!=waitsockets.end();++itr)
        {
                /* SSL may actually need to read data, eg. renegotiation, whilst the client thinks it wants to write. If
                   we only checked for writability in this case, we would deadlock as SSL would need to read */
                SocketInfo &info = itr->second;
                bool real_want_read = info.want_read || info.socket->SSLNeedsRead();
                bool real_want_write = (info.want_write || info.socket->SSLNeedsWrite()) && !info.socket->SSLBlockedUntilRead();

                //Peek SSL state, it may already have readable data, or room in the write buffers
                info.got_read = info.want_read && info.socket->SSLHaveRead();
                info.got_write = info.want_write && info.socket->SSLHaveWriteRoom() && !info.socket->SSLBlockedUntilRead();

                if(info.got_read || info.got_write)
                    wait_satisfied=true;

                poller.UpdateFDWaitMask(info.socket->GetFd(),true,real_want_read,true,real_want_write);

                DEBUGPOLLPRINT("PipeWait: Socket fd " << info.socket->GetFd() << " wantread? " << info.want_read << " needsread? " << info.socket->SSLNeedsRead() << " wantwrite? " << info.want_write << " needwrite? " << info.socket->SSLNeedsWrite() << " blockeduntilread?" << info.socket->SSLBlockedUntilRead());
                DEBUGPOLLPRINT("PipeWait: Socket fd " << info.socket->GetFd() << " real_want_read? " << real_want_read << " real_want_write? " << real_want_write << " gotread? " << info.got_read << " gotwrite? " << info.got_write);
        }

        if (InitEventWait())
            wait_satisfied = true;

        for (std::vector<PipeReadInfo>::iterator itr=waitreadpipes.begin(); itr!=waitreadpipes.end(); ++itr)
        {
                poller.UpdateFDWaitMask(itr->read_stream->GetPosixFd(),true,true,false,false);
                itr->got_read=false;
                DEBUGPOLLPRINT("PipeWait: Pipe read fd " << itr->read_stream->GetPosixFd());
        }

        for (std::vector<PipeWriteInfo>::iterator itr=waitwritepipes.begin(); itr!=waitwritepipes.end(); ++itr)
        {
                poller.UpdateFDWaitMask(itr->write_stream->GetPosixFd(),false,false,true,true);
                itr->got_write=false;
                DEBUGPOLLPRINT("PipeWait: Pipe write fd " << itr->write_stream->GetPosixFd());
        }
        if (want_console_read)
        {
                poller.UpdateFDWaitMask(0,true,true,false,false);
                got_console_read = false;
                DEBUGPOLLPRINT("PipeWait: want_console_read!");
        }

        if(wait_satisfied)
                DEBUGPOLLPRINT("PipeWait: wait condition already satisfied by event");

        int retval;
        if (conditionmutex)
        {
                conditionmutex->cmdata->EnterPipeWait();
                conditionmutex->associated_mutex.Unlock();

                poller.UpdateFDWaitMask(conditionmutex->cmdata->pipe->GetReadEnd().GetPosixFd(),true,true,false,false);
                retval = poller.DoPoll(wait_satisfied ? Blex::DateTime::Min() : until);

                conditionmutex->associated_mutex.Lock();
                conditionmutex->cmdata->LeavePipeWait();
        }
        else
        {
                retval = poller.DoPoll(wait_satisfied ? Blex::DateTime::Min() : until);
        }

        FinishEventWait();

        if (retval <= 0) //error or timeout
            return wait_satisfied;

        if (!waitsockets.empty())
        {
                std::vector< Poller::SignalledFd > signalled;
                poller.ExportSignalled(&signalled);

                for (std::vector< Poller::SignalledFd >::const_iterator sit = signalled.begin(), send = signalled.end(); sit != send; ++sit)
                {
                          std::map< Socket::SocketFd, SocketInfo >::iterator it = waitsockets.find(sit->fd);
                          if (it == waitsockets.end())
                              continue;

                          bool real_got_read = sit->is_readable;
                          bool real_got_write = sit->is_writable;

                          // Update got_read/got_write status if needed. Update the 'reversed' status, if SSL needs to go the other way for progress
                          it->second.got_read = real_got_read || (it->second.socket->SSLNeedsWrite() && real_got_write);
                          it->second.got_write = real_got_write || (it->second.socket->SSLNeedsRead() && real_got_read);

                        DEBUGPOLLPRINT("PipeWait: Socket fd " << it->second.socket->GetFd() << " real_got_read?" << real_got_read << " real_got_write?" << real_got_write << " official got_read" << it->second.got_read << " official got_write " << it->second.got_write);
                }
        }
        for (std::vector<PipeReadInfo>::iterator itr=waitreadpipes.begin(); itr!=waitreadpipes.end(); ++itr)
        {
                if (poller.IsReadable(itr->read_stream->GetPosixFd()))
                    itr->got_read=true;
                DEBUGPOLLPRINT("PipeWait: Pipe fd " << itr->read_stream->GetPosixFd() << " got_read?" << itr->got_read);
        }

        for (std::vector<PipeWriteInfo>::iterator itr=waitwritepipes.begin(); itr!=waitwritepipes.end(); ++itr)
        {
                if (poller.IsWritable(itr->write_stream->GetPosixFd()))
                    itr->got_write=true;
                DEBUGPOLLPRINT("PipeWait: Pipe fd " << itr->write_stream->GetPosixFd() << " got_write?" << itr->got_write);
        }
        if(want_console_read)
        {
                if(poller.IsReadable(0))
                    got_console_read = true;
                DEBUGPOLLPRINT("PipeWait: got_console_read? " << got_console_read);
        }

        return true;
}

Process::Process()
  : separate_processgroup(false)
  , share_stdin(false)
  , share_stdout(false)
  , share_stderr(false)
  , input(-1)
  , output(-1)
  , errors(-1)
  , environment_ptrs(NULL)
  , environment(NULL)
  , pid(-1)
  , rlimit_virtualmemory(-1)
{
}

Process::~Process()
{
        if (pid != -1)
        {
                WaitFinish();
                Detach();
        }

        delete[] environment;
        delete[] environment_ptrs;
}

void Process::Detach()
{
        CloseCurrentPipes();
        pid=-1;
}

bool Process::TimedWaitFinish(Blex::DateTime until)
{
        if (pid==-1) //proc already finished
            return true;

        if (until == Blex::DateTime::Min() || until == Blex::DateTime::Max()) //don't timeout at all
        {
                int status;
                pid_t retval = waitpid(pid, &status, until == Blex::DateTime::Min() ? WNOHANG : 0);

                if (retval==0)
                    return false; //process is still running
                if (retval==-1) //it disappeared?!
                {
                        pid = -1;
                        returnvalue = 1024 + errno;
                        return true;
                }

                //by waiting we also picked up its return value (ADDME: support getting 'signalled' stuff)
                if (WIFEXITED(status))
                    returnvalue = WEXITSTATUS(status);
                else if (WIFSIGNALED(status))
                    returnvalue = WTERMSIG(status) + 256;
                else
                    returnvalue = 512;

                pid=-1;
                return true;
        }

        //FIXME: UGLY solution, but I don't know any better yet :-(  (waitpid does not support timeouts)
        while (Blex::DateTime::Now() < until)
        {
                if (TimedWaitFinish(Blex::DateTime::Min()))
                    return true;
                SleepThread(100);
        }
        return false;
}

void Process::RedirectInput(PipeReadStream &_input)
{
        if (pid!=-1)
            throw std::runtime_error("Process::SetRedirects: Cannot change redirections of a running process");

        _input.SetBlocking(true);
        if (input!=-1)
            close(input);

        input=_input.ReleasePipe();
}

void Process::RedirectOutput(PipeWriteStream &_output, bool errors_too)
{
        if (pid!=-1)
            throw std::runtime_error("Process::SetRedirects: Cannot change redirections of a running process");

        if (output!=-1)
            close(output);

        _output.SetBlocking(true);
        output=_output.ReleasePipe();
        if (errors_too)
        {
                if (errors!=-1)
                    close(errors);
                errors=output;
        }
}

void Process::RedirectErrors(PipeWriteStream &_errors)
{
        if (pid!=-1)
            throw std::runtime_error("Process::SetRedirects: Cannot change redirections of a running process");

        _errors.SetBlocking(true);
        if (errors!=-1)
            close(errors);

        errors=_errors.ReleasePipe();
}

void CloseAllFromTheHardWay(int firstfd) //Code here must be async-signal-safe! Locks may be in indeterminate state
{
        struct rlimit lim;
        getrlimit(RLIMIT_NOFILE,&lim);

        for (int fd=(lim.rlim_cur == RLIM_INFINITY ? 1024 : lim.rlim_cur);fd>=firstfd;--fd)
            close(fd);
}

void Process::SetVirtualMemoryLimit(int64_t virtualmemorylimit)
{
        if (pid!=-1)
            throw std::runtime_error("Process::SetVirtualMemoryLimit: Cannot set process limits on a running process");

        rlimit_virtualmemory = virtualmemorylimit;
}

bool Process::Start(std::string const &applicationfilename,
                             std::vector<std::string> const &arguments,
                             std::string const &working_directory,
                             bool benice)
{
        if (pid!=-1)
            return false; //process already running

        //Setup arguments. c_str() is not async-signal-safe, so we must do it here
        const char *path = applicationfilename.c_str();
        const char *workdir = working_directory.empty() ? 0 : working_directory.c_str();

        std::vector<char *> args;
        args.push_back(const_cast<char*>(path));
        for (unsigned i=0;i<arguments.size();++i)
            args.push_back(const_cast<char*>(arguments[i].c_str()));
        args.push_back(NULL); //end of argument list

        pid = vfork();
        if (pid==-1) //startup failed
            return false;

        if (pid == 0)
        {
                /* We are now the *NEW* process! Only async-signal-safe
                   functions may be called until we hit exec...() */

                // Copy the input, output and errors. The changes we make may not be visible in the parent process
                FileHandle local_input(input);
                FileHandle local_output(output);
                FileHandle local_errors(errors);

                //Get /dev/null for unused redirects to ensure proper detached i/o
                if (local_input==-1 /*&& detached*/ && !share_stdin)
                    local_input=open("/dev/null",O_RDONLY);
                if (local_output==-1 /*&& detached*/ && !share_stdout)
                    local_output=open("/dev/null",O_WRONLY);
                if (local_errors==-1 /*&& detached*/ && !share_stderr)
                    local_errors=open("/dev/null",O_WRONLY);

                //Close current i/o and do the redirects
                if (local_input != -1)
                    dup2(local_input,0);
                if (local_output != -1)
                    dup2(local_output,1);
                if (local_errors != -1)
                    dup2(local_errors,2);

#ifndef PLATFORM_LINUX //linux has race-free 'close on exec' facilities, so no need to clean up after it
                CloseAllFromTheHardWay(3);
#endif

                //Accept requests to be nice
                if (benice)
                    nice(1);

                //Change cwd if requested
                if (workdir)
                    chdir(workdir);

                if(separate_processgroup)
                    setpgid(0, getpid());
                    //ADDME __APPLE__ only? bsd = setpgrp();

#ifdef PLATFORM_LINUX
                if (rlimit_virtualmemory >= 0)
                {
                        rlimit r = { rlim_t(rlimit_virtualmemory), rlim_t(rlimit_virtualmemory) };
                        setrlimit(RLIMIT_AS, &r);
                }
#endif

                //Unblock the signal handlers (could be blocked by pthreads)
                sigset_t mask;
                sigemptyset(&mask); //Empty mask
                sigprocmask(SIG_SETMASK, &mask, NULL);

                //Restore signal handlers
                signal(SIGINT,SIG_DFL);
                signal(SIGTERM,SIG_DFL);
                signal(SIGHUP,SIG_DFL);
                signal(SIGSEGV,SIG_DFL);
                signal(SIGILL,SIG_DFL);
                signal(SIGPIPE,SIG_DFL);

                //Now try to boot the new process
                if (environment)
                    execve(path,&args[0],environment_ptrs);
                else
                    execv(path,&args[0]);

                //Failed! :-(
                _exit(255);
        }

        //This is the _current_ process..
        CloseCurrentPipes();
        return true;
}
void Process::CloseCurrentPipes()
{
        if (input!=-1)
            close(input);
        if (output!=-1)
            close(output);
        if (errors!=-1 && output!=errors)
            close(errors);

        input=-1;
        output=-1;
        errors=-1;
}

void Process::SendInterrupt()
{
        if (pid!=-1)
            kill(pid,SIGINT);
}
void Process::SendTerminate()
{
        if (pid!=-1)
            kill(pid,SIGTERM);
}
void Process::Kill()
{
        if (pid!=-1)
            kill(pid,SIGKILL);
}

void Process::SetEnvironment(Environment const &newenvironment)
{
        //Clear existing environment
        delete[] environment;
        environment=NULL;
        delete[] environment_ptrs;
        environment_ptrs=NULL;

        //Calculate the size for the new environment
        unsigned totalvars=1; //null terminator
        unsigned totalsize=1; //null terminator
        for (Environment::const_iterator itr = newenvironment.begin();itr!=newenvironment.end();++itr)
        {
                totalsize += itr->first.size() + itr->second.size() + 2; //variables, = and \0
                ++totalvars;
        }

        //And create the environment
        environment=new char[totalsize];
        environment_ptrs=new char*[totalvars];

        totalsize=0;
        totalvars=0;
        for (Environment::const_iterator itr = newenvironment.begin();itr!=newenvironment.end();++itr)
        {
                //Add pointer to new variable
                environment_ptrs[totalvars++] = &environment[totalsize];

                //Add variable name
                memcpy(&environment[totalsize],&itr->first[0],itr->first.size());
                totalsize += itr->first.size();

                //Add '=' separator
                environment[totalsize++]='=';

                //Add variable contents
                memcpy(&environment[totalsize],&itr->second[0],itr->second.size());
                totalsize += itr->second.size();

                //Add '\0' separator
                environment[totalsize++]='\0';
        }
        //add the final null terminator
        environment[totalsize]='\0';
        environment_ptrs[totalvars]=NULL;
}

void SetEnvironVariable(std::string const &envname, std::string const &envvalue)
{
        setenv(envname.c_str(), envvalue.c_str(), 1);
}
std::string GetEnvironVariable(std::string const &envname)
{
        const char *env = getenv(envname.c_str());
        if(env)
            return env;
        return std::string();
}

} // end of namespace Blex
