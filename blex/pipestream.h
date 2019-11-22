#ifndef blex_pipestream
#define blex_pipestream

#include "stream.h"
#include "threads.h"
#include "socket.h"

namespace Blex
{
class PipeReadStream;
class PipeWriteStream;
class Socket;
class AsyncSocketTrigger;
class PipeWaiter;
class Event;

namespace Dispatcher
{
namespace Detail
{

class Conn;

} // End of namespace Detail
} // End of namespace Dispatcher

namespace Detail
{
class PipeImpl;

/** Base class for event waiters
*/
class BLEXLIB_PUBLIC EventWaiterBase
{
    public:
        virtual ~EventWaiterBase();
        virtual void SetEventSignalled(Event &event, bool signalled) = 0;
};

/** Pipe basics (characteristics shared by both reading and writing pipes*/
class BLEXLIB_PUBLIC PipeBasics
{
        public:
        /// Out-of-line destructor so that impl gets deleted properly
        ~PipeBasics();

        /** Release this pipe's handle to the caller, and disable this pipe */
        FileHandle ReleasePipe();

        /** Is this handle blocking? */
        bool IsBlocking();

        /** Set the blocking mode for the pipe */
        void SetBlocking(bool block);

        protected:
        PipeBasics();

        PipeImpl* impl;
};

} // End of namespace Detail

/** Event, used for waiting. MT-safe. */
class BLEXLIB_PUBLIC Event
{
    public:
        virtual ~Event();

        /** Function that returns whether this event is signalled. Needs to be overridden
            @return Returns whether this event is signalled
        */
        virtual bool IsSignalled();

        /** Function that must be called when the signalled state of this event has (or might have)
            changed.
        */
        virtual void StateChanged();

    protected:

        struct Data
        {
                inline Data() : signalled(false) { }

                // Whether this event is signalled (only used in StatefulEvent class, not in Event class)
                bool signalled;

                // List of waiters
                std::vector< Detail::EventWaiterBase * > waiters;
        };
        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        LockedData data;

        /** Update the signalled state in all waiters
        */
        void InternalStateChanged(LockedData::WriteRef &lock, bool is_signalled);

        friend class PipeWaiter;
        friend class Dispatcher::Detail::Conn;
};

/** A StatefulEvent is an MT-safe event that keeps it own signalled state.
    Use where locking issues prevent the use of a normal event. Default state is not signalled.
*/
struct BLEXLIB_PUBLIC StatefulEvent : public Event
{
    public:
        /// Manually set the signalled state of the event
        void SetSignalled(bool signalled);

        /// IsSignalled now returns the current signalled state of the event
        virtual bool IsSignalled();

        /// Needs to be overridden due to locking issues
        virtual void StateChanged();
};


/** Create a unidirectional pipe */
struct BLEXLIB_PUBLIC PipeSet
{
        /** Create a pipe, throw bad_alloc if pipe creation fails */
        PipeSet();

        /** Get the read end of the pipe */
        PipeReadStream & GetReadEnd() const { return *readend; }

        /** Get the write end of the pipe */
        PipeWriteStream & GetWriteEnd() const { return *writeend; }

        /** Release the read end of the pipe. The caller becomes responsible for deleting the pipe */
        PipeReadStream*  ReleaseReadEnd() { return readend.release(); }

        /** Release the write end of the pipe. The caller becomes responsible for deleting the pipe */
        PipeWriteStream*  ReleaseWriteEnd() { return writeend.release(); }

        private:
        /** The write end of the pipe */
        std::unique_ptr<PipeWriteStream> writeend;
        /** The read end of the pipe */
        std::unique_ptr<PipeReadStream> readend;

        PipeSet(PipeSet const &); //not implemented
        PipeSet& operator=(PipeSet const &); //not implemented
};

/** The read end of a unidirectional pipe */
class BLEXLIB_PUBLIC PipeReadStream : public Stream, public Detail::PipeBasics
{
        public:
        virtual std::size_t Read(void *buf, std::size_t maxbufsize);
        virtual bool EndOfStream();
        virtual std::size_t Write(const void *buf, std::size_t bufsize);


        /** For POSIX, get the file fd, required for some direct use of POSIX apis */
        int GetPosixFd();

        private:
        PipeReadStream(): Stream(true) {}

        void ScheduleRead();

        friend struct PipeSet;
};

/** The write end of a unidirectional pipe */
class BLEXLIB_PUBLIC PipeWriteStream : public Stream, public Detail::PipeBasics
{
        public:
        virtual std::size_t Read(void *buf, std::size_t maxbufsize);
        virtual bool EndOfStream();
        /** Send data to the pipe. One single write, up to 512 bytes (PIPEBUF),
            is guaranteed to complete immediately, even on blocking sockets,
            without blocking. The second write, or any writer larger than 512
            bytes, may block */
        virtual std::size_t Write(const void *buf, std::size_t bufsize);

        bool IsPipeBroken();

        /** For POSIX, get the file fd, required for some direct use of POSIX apis */
        int GetPosixFd();

        private:
        PipeWriteStream(): Stream(true) {}

        friend struct PipeSet;
};

/** A waiter object to allow waiting on one or more pipes. The waiter is limited
    to waiting on 32 pipes */
class BLEXLIB_PUBLIC PipeWaiter : public Detail::EventWaiterBase
{
        public:
        PipeWaiter() : events_active(false)
        {
                Reset();
        }

        ~PipeWaiter();


        ///Wait for console readability
        void AddConsoleRead()
        {
                want_console_read=true;
        }

        ///Add a new pipe to wait for readability
        void AddReadPipe(PipeReadStream &pipe);

        ///Add a new pipe to wait for writability
        void AddWritePipe(PipeWriteStream &pipe);

        ///Add a new socket to wait for
        void AddSocket(Socket &sock, bool read, bool write);

        ///Add a new event to wait for
        void AddEvent(Event &cond);

        /** Remove a pipe from the waiting list
            @return False if pipe was not on the list */
        bool RemoveReadPipe(PipeReadStream &pipe);

        /** Remove a pipe from the write  waiting list
            @return False if pipe was not on the list */
        bool RemoveWritePipe(PipeWriteStream &pipe);

        /** Remove a pipe from the socket waiting list
            @return False if pipe was not on the list */
        bool RemoveSocket(Socket &sock);

        /** Remove a event from the socket waiting list
            @return False if event was not on the list */
        bool RemoveEvent(Event &event);

        ///Remove all pipes, sockets and events from the waiting list
        void Reset();

        /** Get the state of the console
            @return True if the console was on the list and readable */
        bool GotConsoleRead() const
        {
                return want_console_read && got_console_read;
        }

        /** Get the state of the waited-for pipes
            @return True if the pipe was on the list and readable */
        bool GotRead(PipeReadStream &pipe) const;

        /** Get the state of the waited-for pipes
            @return True if the pipe was on the list and writable */
        bool GotWrite(PipeWriteStream &pipe) const;

        /** Get the state of the waited-for socket
            @return True if the socket was on the list and readable */
        bool GotRead(Socket &pipe) const;

        /** Get the state of the waited-for socket
            @return True if the socket was on the list and writable */
        bool GotWrite(Socket &pipe) const;

        /** Get the state of the waited-for event
            @return True if the event was on the list and signalled */
        bool GotSignalled(Event &event) const;

        /** Wait on a pipe to activate
            @param until Time to wait until
            @return True if data came in, false if we had a time out*/
        inline bool Wait(Blex::DateTime until) { return WaitInternal(0, until); }

        /** Wait simultaneously on a signal in a conditionmutex and on a pipe.
            @param until Time to wait until
            @return True if data or a signal came in, false if we had a time out */
        inline bool ConditionMutexWait(CoreConditionMutex &mutex, Blex::DateTime until) { return WaitInternal(&mutex, until); }

        inline bool ConditionMutexWait(ConditionMutex::AutoLock &lock, Blex::DateTime until) { return WaitInternal(&lock.conmutex.corecv, until); }
        bool ConditionMutexWait(DebugConditionMutex::AutoLock &lock, Blex::DateTime until);

        private:

        bool WaitInternal(CoreConditionMutex *conditionmutex, Blex::DateTime until);
        bool InitEventWait();
        void FinishEventWait();
        void SetEventSignalled(Event &event, bool signalled);
        void ClearSelfFromEventWaiters();

        struct SocketInfo
        {
                bool want_read, got_read;
                bool want_write, got_write;
                Socket *socket;
        };

        struct PipeReadInfo
        {
                PipeReadStream *read_stream;
                bool got_read;
        };

        struct PipeWriteInfo
        {
                PipeWriteStream *write_stream;
                bool got_write;
        };

        struct EventInfo
        {
                Event *event;
                bool got_signalled;
        };

        bool want_console_read;
        bool got_console_read;
        std::vector<PipeReadInfo> waitreadpipes;
        std::vector<PipeWriteInfo> waitwritepipes;
        std::vector<EventInfo> waitevents;
        std::map<Socket::SocketFd, SocketInfo> waitsockets;
        bool events_active;

        struct EventData
        {
                EventData() : signalled(0), waiting(false), pipe_signalled(false) {}

                std::unique_ptr< PipeReadStream > comm_read;
                std::unique_ptr< PipeWriteStream > comm_write;

                std::vector< Event * > signalled;
                bool waiting;
                bool pipe_signalled;
        };

        typedef Blex::InterlockedData< EventData, Blex::Mutex > LockedEventData;
        LockedEventData eventdata;

        friend class Event;
};

} //end of namespace Blex

#endif //Sentry
