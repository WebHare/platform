#ifndef blex_threads
#define blex_threads

#include "datetime.h"

#include <pthread.h>
#include <stdexcept>
#include <vector> // needed to implement IsOwnedRead()
#include <map>

namespace Blex
{
class Thread;
class TriggerableSingleSocketWaiter;
class PipeReadStream;
class PipeWriteStream;
class PipeWaiter;

namespace Detail
{

/** The thread starter for POSIX threading. POSIX requires that this is
    declared with "C" linkage, but external callers don't really need
    this function */
extern "C" void *ThreadStarter(void *object);

///Throw on deadlock, instead of FatalAbort
BLEXLIB_PUBLIC void SetThrowOnDeadlock(bool dothrow);

} //end namespace Detail

typedef pthread_t ThreadId;

inline void* GetThreadPointer(ThreadId const &in_thread_id)
{
        return (void*)in_thread_id;
}

class ContextKeeper;
class ContextRegistrator;

/** Return the ThreadId of the thread that called it */
ThreadId CurrentThread();// throw();

/** Get context registrator for thread contexts
    Context id's below 256 are reserved
*/
BLEXLIB_PUBLIC ContextRegistrator & GetThreadContextRegistrator();

/** Get current thread context.
*/
BLEXLIB_PUBLIC ContextKeeper & CurrentThreadContext();

/** Get an environment variable */
BLEXLIB_PUBLIC std::string GetEnvironVariable(std::string const &envname);
/** Set an environment variable */
BLEXLIB_PUBLIC void SetEnvironVariable(std::string const &envname, std::string const &envvalue);

/** The CoreMutex is an abstract class that hides the underlying pthreads/msthreads
    implementation of lockable mutexes. A mutex can be "locked" or "unlocked".
    When a mutex is "locked", no other thread can lock it until the first
    thread to lock it has unlocked it.

    Only B-Lex library internals should use the CoreMutex. Applications should
    only use the standard Mutex class.

    A thread should never lock the same mutex twice, or it might cause
    itself to deadlock.
*/
class BLEXLIB_PUBLIC CoreMutex
{
        public:
        /** CoreMutex constructor, which sets up the OS mutex object
            @param fast Create a fast mutex (linuxthreads only, disables TimedWait support) */
        CoreMutex(bool fast=false);// throw (std::bad_alloc);

        /** Mutex destructor, which frees up the OS mutex object */
        ~CoreMutex();// throw();

        /** Lock the mutex. Does not return until the mutex has been locked */
        void Lock();// throw();

        /** Unlock the mutex. */
        void Unlock();// throw();

        /** Try to lock the mutex
            @param false if mutex lock failed, true if mutex is locked */
        bool TryLock();// throw();

        private:
        CoreMutex(CoreMutex const&); //not implemented
        CoreMutex& operator=(CoreMutex const&); //not implemented

        struct LockData;
        LockData *lockdata;
        friend class CoreConditionMutex;
};

class BLEXLIB_PUBLIC CoreConditionMutex
{
        public:
        /** Condition variable constructor. */
        CoreConditionMutex(CoreMutex &associated_mutex);// throw (std::bad_alloc,std::runtime_error);

        /** Condition variable destructor. It may throw logic_error if there
            are still waiting threads (which will now hang forever) */
        ~CoreConditionMutex();// throw (std::logic_error);

        /** Signal one thread waiting on this condition. Returns immediately if no thread is waiting */
        void SignalOne();// throw();

        /** Signal all threads waiting on this condition (broacast). Returns immediately if no thread is waiting */
        void SignalAll();// throw();

        /** Unlock mutex, wait for a signal, and then relock */
        void Wait();// throw();

        /** Unlock mutex, wait for a signal or for the timer to expire, and then relock
            @param until Maximum wait time
            @return false if the timer expired, true if TimedWait _might_ have been aborted by a signal */
        bool TimedWait(Blex::DateTime until);// throw();

        private:
        CoreConditionMutex(CoreConditionMutex const&); //not implemented
        CoreConditionMutex& operator=(CoreConditionMutex const&); //not implemented

        struct CMData;
        CMData *cmdata;

        CoreMutex &associated_mutex;

        friend class PipeWaiter;
};



/** The Mutex implements extra debugging on top of a core mutex.
    A mutex can be "locked" or "unlocked". When a mutex is "locked", no other
    thread can lock it until the first thread to lock it has unlocked it.

    A thread should never lock the same mutex twice, or it might cause
    itself to deadlock.

    You cannot directly lock the mutex. Instead, you must create a
    Mutex::ScopedLock or Mutex::AutoLock object, and initialize it with
    the mutex. This guarantees exception-safe locking semantics
*/
class BLEXLIB_PUBLIC Mutex
{
        protected:
        ///Platform's implementation of the mutex
        CoreMutex core;

        /** Lock the mutex. Does not return until the mutex has been locked */
        void Lock()
        { core.Lock(); }
        /** Unlock the mutex. */
        void Unlock()
        { core.Unlock(); }

        public:
        /** A lock type that automatically unlocks on destruction, but can be
            locked and unlocked at any chosen moment as well */
        class ScopedLock
        {
                protected:
                Mutex &mutex;
                bool locked;

                public:
                /** Lock the mutex. Does not return until the mutex has been locked */
                void Lock()
                { locked=true; mutex.Lock(); }
                /** Unlock the mutex. */
                void Unlock()
                { mutex.Unlock(); locked=false; }
                ScopedLock(Mutex &_mutex, bool lock) : mutex(_mutex),locked(false)
                {
                        if (lock)
                            Lock();
                }
                ~ScopedLock()
                {
                        if(locked)
                            Unlock();
                }
                bool IsLocked() { return locked; }
        };
        /** A lock type that automatically locks at construction and
            automatically unlocks on destruction */
        class AutoLock
        {
                protected:
                Mutex &mutex;

                public:
                AutoLock(Mutex &_mutex) : mutex(_mutex) { mutex.Lock(); }
                inline ~AutoLock() { mutex.Unlock(); }
        };
        friend class ScopedLock;
        friend class AutoLock;

        /** Define AutoLock as this class's read lock, because there is no
            specific read lock */
        typedef AutoLock AutoReadLock;

        /** Define AutoLock as this class's write lock, because there is no
            specific write lock */
        typedef AutoLock AutoWriteLock;

        /** Mutex constructor, which sets up the OS mutex object
            @param fast Create a fast mutex. Only supported on linuxthreads only,
                        this lock does not support TimedWaits, and has less fair
                        semantics (it does not automatically assign an unlocked
                        mutex to a waiter) */
        Mutex(bool fast=true) : core(fast)
        {
        }

        private:
        Mutex(Mutex const&);//not implemented
        Mutex& operator=(Mutex const&);//not implementd
};

/** A conditionmutex implements a pthread-condition-variable like object that can
    be used to synchronize threads.

    A thread wanting to wait should first Lock the condition, and then Wait.
    Another thread wanting to signal the condition can then call SignalOne.
    Make sure the mutex is locked before checking a condition, and starting to
    wait on it, otherwise one might miss the signal.

    Basically, the waiting lock looks like this:
    conmute.Lock();
    while (!my_condition_protected_by_conmute_mutex)
        conmute.Wait();
    conmute.Unlock();

    And is signalled by this:
    conmute.Lock();
    my_condition_protected_by_conmute_mutex = true;
    conmute.Unlock();
    conmute.SignalOne();

    The mutex is unlocked when Wait() is called by a waiting thread, but it
    is then relocked before Wait() returns.

    WARNING: Beware of spurious wakeups! Wait() might return without the
             delay having expired, or the condition having become true.
*/
class BLEXLIB_PUBLIC ConditionMutex : public Mutex
{
        private:
        CoreConditionMutex corecv;

        /** Unlock mutex, wait for a signal, and then relock */
        void Wait()
        { return corecv.Wait(); }

        /** Unlock mutex, wait for a signal or for the timer to expire, and then relock
            @param delay Time to wait in milliseconds
            @return false if the timer expired, true if TimedWait _might_ have been aborted by a signal */
        bool TimedWait(Blex::DateTime until)
        { return corecv.TimedWait(until); }

        public:
        /** A lock type that automatically unlocks on destruction, but can be
            locked and unlocked at any chosen moment as well */
        class ScopedLock : public Mutex::ScopedLock
        {
                ConditionMutex &conmutex;

                public:
                /** Create the lock
                    @param mymutex Mutex to bind to
                    @param lock Initial lock state (true to lock) */
                ScopedLock(ConditionMutex &mymutex,bool lock)
                  : Mutex::ScopedLock(mymutex,lock), conmutex(mymutex)
                {
                }

                /** Unlock mutex, wait for a signal, and then relock */
                void Wait()
                {
                        conmutex.Wait();
                }

                /** Unlock mutex, wait for a signal or for the timer to expire, and then relock
                    @param until Time to wait until
                    @return false if the timer expired, true if TimedWait _might_ have been aborted by a signal */
                bool TimedWait(Blex::DateTime until)
                { return conmutex.TimedWait(until); }
        };
        /** A lock type that automatically locks at construction and
            automatically unlocks on destruction */
        class AutoLock : public Mutex::AutoLock
        {
                ConditionMutex &conmutex;

                public:
                /** Create the lock and lock the mutex
                    @param mymutex Mutex to bind to */
                AutoLock(ConditionMutex &mymutex)
                  : Mutex::AutoLock(mymutex), conmutex(mymutex)
                {
                }

                /** Unlock mutex, wait for a signal, and then relock */
                void Wait()
                {
                        conmutex.Wait();
                }
                /** Unlock mutex, wait for a signal or for the timer to expire, and then relock
                    @param until Time to wait until
                    @return false if the timer expired, true if TimedWait _might_ have been aborted by a signal */
                bool TimedWait(Blex::DateTime until)
                {
                        return conmutex.TimedWait(until);
                }

                friend class PipeWaiter;
        };
        friend class ScopedLock;
        friend class AutoLock;

        /** Define AutoLock as this class's read lock, because there is no
            specific read lock */
        typedef AutoLock AutoReadLock;

        /** Define AutoLock as this class's write lock, because there is no
            specific write lock */
        typedef AutoLock AutoWriteLock;

        /** Mutex constructor */
        ConditionMutex() : corecv(core)
        {
        }

        /** Signal one thread waiting on this condition. Returns immediately if no thread is waiting */
        void SignalOne() //throw()
        {
                corecv.SignalOne();
        }

        /** Signal all threads waiting on this condition (broacast). Returns immediately if no thread is waiting */
        void SignalAll() //throw()
        {
                corecv.SignalAll();
        }

        friend class PipeWaiter;
};

/** A ReadWriteMutex implements a lock that can be used for objects that
    may be read by multiple threads, but only written by one thread.
*/
class BLEXLIB_PUBLIC ReadWriteMutex
{
        ///Definition of condition mutex to implement the RW lock
        struct LockData : public ConditionMutex
        {
                LockData() : waiting(0),lockcount(0)
                {
                }

                ///Number of threads waiting for write access
                unsigned waiting;
                ///Number of locks currently held (if >0, all locks are RO. if <0, lock is RW)
                int lockcount;
        };

        LockData lockdata;

        protected:
        ///Lock the mutex for reading. Will return immediately unless the mutex is locked for writing.
        void LockRead();

        ///Lock the mutex for writing. Will wait for all readers to release the mutex
        void LockWrite();

        ///Unlock the mutex after a LockRead() or LockWrite();
        void Unlock();

        public:
        /** A read lock type that automatically locks the mutex for reading
            at construction and automatically unlocks on destruction */
        class AutoReadLock
        {
                ReadWriteMutex &mutex;

                public:
                AutoReadLock(ReadWriteMutex &_mutex) : mutex(_mutex)
                { mutex.LockRead(); }
                ~AutoReadLock()
                { mutex.Unlock(); }
        };
        /** A write lock type that automatically locks the mutex for writing
            at construction and automatically unlocks on destruction */
        class AutoWriteLock
        {
                ReadWriteMutex &mutex;

                public:
                AutoWriteLock(ReadWriteMutex &_mutex) : mutex(_mutex)
                { mutex.LockWrite(); }
                ~AutoWriteLock()
                { mutex.Unlock(); }
        };
        /** A lock type that automatically unlocks on destruction, but can be
            locked and unlocked for reading or writing at any chosen moment as well */
        class ScopedLock
        {
                ReadWriteMutex &mutex;
                bool locked;

                public:
                ScopedLock(ReadWriteMutex &_mutex) : mutex(_mutex),locked(false)
                {
                }
                ~ScopedLock()
                {
                        if(locked)
                            Unlock();
                }
                /** Lock the mutex for reading. Does not return until the mutex has been locked */
                void LockRead()
                { locked=true; mutex.LockRead(); }
                /** Lock the mutex for writing. Does not return until the mutex has been locked */
                void LockWrite()
                { locked=true; mutex.LockWrite(); }
                /** Unlock the mutex. */
                void Unlock()
                { locked=false; mutex.Unlock(); }
        };
        friend class ScopedLock;
        friend class AutoReadLock;
        friend class AutoWriteLock;
};

class BLEXLIB_PUBLIC DebugMutex
{
        DebugMutex(const DebugMutex&); //not implemneted
        DebugMutex& operator=(const DebugMutex&); //not implemented

        protected:
        ///Platform's implementation of the mutex
        CoreMutex core;
        ///The name of the mutex, which is used in debugging messages
        std::string mutexname;
        ///The current owner of this mutex
        ThreadId ownerthread;

        void Lock();
        void Unlock();

        public:
        class ScopedLock
        {
                protected:
                DebugMutex &mutex;
                bool locked;

                public:
                void Lock();
                void Unlock();
                ScopedLock(DebugMutex &_mutex, bool lock) : mutex(_mutex),locked(false)
                {
                        if (lock)
                            Lock();
                }
                ~ScopedLock()
                {
                        if(locked)
                            Unlock();
                }
                bool IsLocked() { return locked; }
        };
        class AutoLock
        {
                protected:
                DebugMutex &mutex;

                public:
                AutoLock(DebugMutex &_mutex) : mutex(_mutex) { mutex.Lock(); }
                ~AutoLock() { mutex.Unlock(); }
        };

        friend class ScopedLock;
        friend class AutoLock;

        typedef AutoLock AutoReadLock;
        typedef AutoLock AutoWriteLock;

        DebugMutex(bool fast=true) : core(fast)
        {}

        void SetupDebugging(const std::string &name)
        { mutexname = name; }

        const std::string& GetMutexName() const
        { return mutexname; }

        ///Return true if the mutex is currently locked by the current thread
        bool IsOwned() const;
};

class BLEXLIB_PUBLIC DebugConditionMutex : public DebugMutex
{
        private:
        CoreConditionMutex corecv;

        void Wait();
        bool TimedWait(Blex::DateTime until);

        public:
        class ScopedLock : public DebugMutex::ScopedLock
        {
                DebugConditionMutex &conmutex;

                public:
                ScopedLock(DebugConditionMutex &mymutex,bool lock)
                  : DebugMutex::ScopedLock(mymutex,lock), conmutex(mymutex)
                {
                }
                void Wait();
                bool TimedWait(Blex::DateTime until);
        };
        class AutoLock : public DebugMutex::AutoLock
        {
                DebugConditionMutex &conmutex;

                public:
                AutoLock(DebugConditionMutex &mymutex)
                  : DebugMutex::AutoLock(mymutex), conmutex(mymutex)
                {
                }
                ~AutoLock() {}

                void Wait()
                { conmutex.Wait(); }
                bool TimedWait(Blex::DateTime until)
                { return conmutex.TimedWait(until); }

                friend class PipeWaiter;
        };
        friend class ScopedLock;
        friend class AutoLock;

        typedef AutoLock AutoReadLock;
        typedef AutoLock AutoWriteLock;

        DebugConditionMutex() : corecv(core)
        {
        }

        void SignalOne()
        {
                corecv.SignalOne();
        }

        void SignalAll()
        {
                corecv.SignalAll();
        }

        friend class PipeWaiter;
};

/** A thread encapsulates a different thread of execution.

    Please note that the class has now been designed differently from previous
    versions. Previous versions expected you to derive from Blex::Thread to
    implement a thread - but this caused nasty race conditions (the destructor
    called WaitFinish(), but this wouldn't prevent your derived destructor from
    being invoked, so your code had to insert its own WaitFinish() call - in
    other words, the destructor was worthless and actually caused races) */
class BLEXLIB_PUBLIC Thread
{
        public:
        /** Construct a thread (doesn't start it yet) */
        explicit Thread(std::function< void() > const &threadfunction);

        /** Wait for thread finish, and then destroy the thread object */
        ~Thread();

        /** Start the thread
            @return false if the thread couldn't be started*/
        bool Start();

        /** Wait for the thread to finish */
        void WaitFinish();// throw();

        private:
        Thread(Thread const&); //not implemented
        Thread& operator=(Thread const*); //not implemented

        std::function< void() > threadfunction;

        /** True if the handle is valid (can be joined) */
        bool joinhandle;
        /** The running thread's handle */
        pthread_t handle;

        friend void *::Blex::Detail::ThreadStarter(void *object);// throw();
};

/** A template class that can be wrapped around a structure to ensure
    that no members will be accessed without proper locking. The owner
    of the object can only access the members by creating a lock object,
    and will only get const access if a read lock was created.

    The mutex itself and its lock objects are based on the objects from
    the chosen mutex, so that the SetupDebugging and Wait/Signal functions
    can still be called if the choosen Mutex supports these.

    @param Data The data item to wrap
    @param ProtectMutex The mutex to be used to implement the lock
                        (eg, Mutex, ReadWriteMutex, ConditionMutex) */
template <class Data, class ProtectMutex> class InterlockedData : public ProtectMutex
{
        public:
        /** Obtain a read lock and read-only access to the protected data*/
        class ReadRef : public ProtectMutex::AutoReadLock
        {
                public:
                /** Construct a read-only access lock */
                ReadRef(const InterlockedData<Data,ProtectMutex> &_datasource)
                  : ProtectMutex::AutoReadLock(const_cast< InterlockedData<Data,ProtectMutex>& > (_datasource) )
                  , datasource(_datasource)
                {
                }

                /** Access the protected data */
                const Data& operator*() const { return datasource.protected_data; }
                /** Access the protected data */
                const Data* operator->() const { return &datasource.protected_data; }

                private:
                /** Pointer the protected data structure */
                const InterlockedData<Data,ProtectMutex> &datasource;
        };

        /** Obtain a write lock and read/write access to the protected data*/
        class WriteRef : public ProtectMutex::AutoWriteLock
        {
                public:
                /** Construct a read-write access lock */
                WriteRef(InterlockedData<Data,ProtectMutex> &_datasource)
                  : ProtectMutex::AutoWriteLock(_datasource)
                  , datasource(_datasource)
                {
                }

                /** Access the protected data */
                Data& operator*() { return datasource.protected_data; }
                /** Access the protected data */
                Data* operator->() { return &datasource.protected_data; }

                private:
                /** Pointer to the protected data structure */
                InterlockedData<Data,ProtectMutex> &datasource;
        };

        InterlockedData() {}
        template< class Param > InterlockedData(Param &p) : protected_data(p) {}

        private:

        /** An instance of the data that we are protecting */
        Data protected_data;

        friend class ReadRef;
        friend class WriteRef;
};

/** Yield the remaining timeslice back to the OS */
BLEXLIB_PUBLIC void YieldThread();// throw();

/** Delay for the specified number of millseconds
    @param msecs Time to sleep*/
BLEXLIB_PUBLIC void SleepThread(unsigned msecs);// throw();

/** A process encapsulates a parallel running process */
class BLEXLIB_PUBLIC Process
{
        public:
        typedef std::map<std::string,std::string> Environment;

        /** Construct a process (doesn't start it yet) */
        Process();// throw();

        /** Terminate and destroy the process */
        ~Process();// throw();

        /** Timed wait for the process to finish
            @param until Maximum wait time
            @return True if the process finished, false if the timer (might have) expired */
        bool TimedWaitFinish(Blex::DateTime until);// throw();

        /** Wait for the process to finish */
        void WaitFinish()
        {
                TimedWaitFinish(Blex::DateTime::Max());
        }

        /** Test if the process is already finished
            @return True if the process is finished (returnvalue will then be set as well) */
        bool IsFinished()
        {
                return TimedWaitFinish(Blex::DateTime::Min());
        }

        /** Set up redirections for this process. This function may not be called
            if a process has already been started.

            All pipes are adopted, which means that the classes still need to
            be destroyed, but they cannot be used as pipes anymore (their
            file handle has been taken away). Also, all pipes are restored to
            Blocking mode if necessary

            @param input Stream from which the app will read its data (stdin) */
        void RedirectInput(PipeReadStream &input);
        /** Set up output redirection
            @param output Output stream
            @param errors_too True to redirect the error stream to the output stream as well */
        void RedirectOutput(PipeWriteStream &output, bool errors_too);
        void RedirectErrors(PipeWriteStream &errors);

        /** Override the environment for the process */
        void SetEnvironment(Environment const &newenvironment);

        /** Set the virtual memory limit, negative for no limit */
        void SetVirtualMemoryLimit(int64_t virtualmemorylimit);

        /** Detach from the process, disconnecting any input pipes */
        void Detach();

        /** Start the process.
            @param applicationfilename Name of the application that will be launched (passed as argv[0])
            @param arguments Arguments to pass to the application (passed as argv[1] .. argv[n-1])
            @param working_directory Working directory for the new process (leave empty to keep current directory)
            @param nice Start the process 'nice' (lower priority)
            @param detached Start the process detached (without access to the parent console)
            @return True if the process was succesfully started */
        bool Start(std::string const &applicationfilename,
                            std::vector<std::string> const &arguments,
                            std::string const &working_directory,
                            bool nice);// throw();

        /** Get the return value of a process.
            @return The return value (usually 0 to 255) */
        unsigned GetReturnValue() const
        {
                return returnvalue;
        }

        /** Send an interrupt signal (SIGINT or CTRL+C) */
        void SendInterrupt();
        /** Send a terminate signal (SIGTERM or CTRL+BREAK) */
        void SendTerminate();
        /** Forcibly terminate the process */
        void Kill();

        /** For POSIX, get the process PID, required for some direct use of apis */
        pid_t GetPosixPid() const
        {
                return pid;
        }

        ///Create a separate process group (ie to prevent ctrl+c on terminal to reach this process). defaultsto false
        bool separate_processgroup;
        ///Keep stdin connected to ours
        bool share_stdin;
        ///Keep stdout connected to ours
        bool share_stdout;
        ///Keep stderr connected to ours
        bool share_stderr;

        private:
        Process(Process const&); //not implemented
        Process& operator=(Process const&); //not implemented

        void CloseCurrentPipes();

        ///Process return value
        unsigned returnvalue;

        ///Redirect input stream
        FileHandle input;
        ///Redirect output stream
        FileHandle output;
        ///Redirect errors stream
        FileHandle errors;

        ///Process environment data pointers
        char **environment_ptrs;
        ///Process environment
        char *environment;
        /** PID of the running process */
        pid_t pid;
        /** Max virtual memory size */
        int64_t rlimit_virtualmemory;
};

} //end namespace Blex


#endif
