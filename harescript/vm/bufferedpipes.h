#ifndef blex_harescript_vm_bufferedpipes
#define blex_harescript_vm_bufferedpipes

#include <blex/pipestream.h>
#include <blex/podvector.h>
#include <blex/threads.h>

namespace Blex
{

class BufferedPipeReadStream;
class BufferedPipeWriteStream;

namespace Detail
{

struct BufferedPipeData;

struct BufferedPipeReadEvent : public Blex::Event
{
        inline explicit BufferedPipeReadEvent(BufferedPipeData &_data) : data(_data) { }
        BufferedPipeData &data;

        virtual bool IsSignalled();
};

struct BufferedPipeData
{
        BufferedPipeData() : read_event(*this) { write_event.SetSignalled(true); }
        struct Data
        {
                Data();

                unsigned refcount;
                bool closed;
                unsigned signal_threshold;
                signed yield_threshold;

                std::deque< uint8_t > data;
        };

        BufferedPipeReadEvent read_event;
        Blex::StatefulEvent write_event;

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        LockedData data;
};

class /*BLEXLIB*/ BufferedPipeBasics
{
    public:
        explicit BufferedPipeBasics(BufferedPipeData *_buffer);
        ~BufferedPipeBasics();

        void BreakPipe();

    protected:
        BufferedPipeBasics(BufferedPipeBasics const &); // not implemented
        BufferedPipeBasics & operator =(BufferedPipeBasics const &); // not implemented

        BufferedPipeData *buffer;
        bool closed;
};

} // End of namespace Detail

/** Create a unidirectional pipe */
class /*BLEXLIB*/ BufferedPipeSet
{
    public:
        /** Create a pipe, throw bad_alloc if pipe creation fails */
        BufferedPipeSet();

        /** Get the read end of the pipe */
        BufferedPipeReadStream & GetReadEnd() const { return *readend; }

        /** Get the write end of the pipe */
        BufferedPipeWriteStream & GetWriteEnd() const { return *writeend; }

        /** Release the read end of the pipe. The caller becomes responsible for deleting the pipe */
        BufferedPipeReadStream*  ReleaseReadEnd() { return readend.release(); }

        /** Release the write end of the pipe. The caller becomes responsible for deleting the pipe */
        BufferedPipeWriteStream*  ReleaseWriteEnd() { return writeend.release(); }

    private:
        /** The write end of the pipe */
        std::unique_ptr< BufferedPipeWriteStream > writeend;
        /** The read end of the pipe */
        std::unique_ptr< BufferedPipeReadStream > readend;

        BufferedPipeSet(BufferedPipeSet const &); //not implemented
        BufferedPipeSet & operator=(PipeSet const &); //not implemented
};

class /*BLEXLIB*/ BufferedPipeReadStream : public Stream, public Detail::BufferedPipeBasics
{
    public:
        virtual std::size_t Read(void *buf, std::size_t maxbufsize);
        virtual bool EndOfStream();
        virtual std::size_t Write(const void *buf, std::size_t bufsize);

        Blex::Event & GetEvent();

        /// Set the minimum number of bytes that must be in a buffer to signal (or it must have been broken)
        void SetReadSignalThreshold(unsigned size);

    private:
        BufferedPipeReadStream(Detail::BufferedPipeData *buffer);

        friend class BufferedPipeSet;
};

class /*BLEXLIB*/ BufferedPipeWriteStream : public Stream, public Detail::BufferedPipeBasics
{
    public:
        virtual std::size_t Read(void *buf, std::size_t maxbufsize);
        virtual bool EndOfStream();
        virtual std::size_t Write(const void *buf, std::size_t bufsize);

        bool IsPipeBroken();
        bool IsYieldThresholdReached();
        void SetWriteYieldThreshold(signed size); // <0 to disable, default

        Blex::Event & GetEvent();

    private:
        BufferedPipeWriteStream(Detail::BufferedPipeData *buffer);

        friend class BufferedPipeSet;
};


} // End of namespace Blex

#endif

