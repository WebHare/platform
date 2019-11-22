#include <harescript/vm/allincludes.h>


#include "bufferedpipes.h"

//#define SHOW_BUFFERPIPES


#ifdef SHOW_BUFFERPIPES
 #define BP_PRINT(x) DEBUGPRINT(x)
#else
 #define BP_PRINT(x) (void)0
#endif

namespace Blex
{

namespace Detail
{

bool BufferedPipeReadEvent::IsSignalled()
{
        Detail::BufferedPipeData::LockedData::WriteRef lock(data.data);
        bool is_signalled = lock->data.size() > lock->signal_threshold || lock->closed;
        BP_PRINT("BPRE."<<this<<"::IsSignalled: " << is_signalled << " (size: "<< lock->data.size() << ", closed: " << (lock->closed?"yes":"no")<<")");
        return is_signalled;
}

BufferedPipeData::Data::Data()
: refcount(2)
, closed(false)
, signal_threshold(0)
, yield_threshold(-1)
{
}

BufferedPipeBasics::BufferedPipeBasics(BufferedPipeData *_buffer)
: buffer(_buffer)
, closed(false)
{
}

BufferedPipeBasics::~BufferedPipeBasics()
{
        BreakPipe();

        // Decrease the reference counter after signalling the events, so simultaneous
        // delete of other end won't delete the buffer when we are still signalling
        bool must_delete;
        {
                BufferedPipeData::LockedData::WriteRef lock(buffer->data);
                must_delete = --lock->refcount == 0;
        }

        if (must_delete)
            delete buffer;
}

void BufferedPipeBasics::BreakPipe()
{
        BP_PRINT("BPS."<<this<<": Breaking pipe");
        if (!closed)
        {
                bool must_signal;
                {
                        BufferedPipeData::LockedData::WriteRef lock(buffer->data);
                        must_signal = !lock->closed;
                        lock->closed = true;
                }

                if (must_signal)
                {
                        // Other references still exist: signal read event (write event is always signalled)
                        buffer->read_event.StateChanged();
                }
                closed = true;
        }
}

} // End of namespace Detail

BufferedPipeSet::BufferedPipeSet()
{
        std::unique_ptr< Detail::BufferedPipeData > buffer;
        buffer.reset(new Detail::BufferedPipeData);

        readend.reset(new BufferedPipeReadStream(buffer.get()));
        writeend.reset(new BufferedPipeWriteStream(buffer.release()));
}

BufferedPipeReadStream::BufferedPipeReadStream(Detail::BufferedPipeData *buffer)
: Stream(false)
, Detail::BufferedPipeBasics(buffer)
{
}

std::size_t BufferedPipeReadStream::Read(void *buf, std::size_t maxbufsize)
{
        bool state_changed;
        unsigned to_copy;
        {
                Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
                if (lock->data.empty())
                    return 0;
                to_copy = std::min(maxbufsize, lock->data.size());
                std::copy(lock->data.begin(), lock->data.begin() + to_copy, (uint8_t *)buf);
                lock->data.erase(lock->data.begin(), lock->data.begin() + to_copy);

                state_changed = lock->data.empty() && !lock->closed;
        }
        if (state_changed)
            buffer->read_event.StateChanged();

        BP_PRINT("BPRS."<<this<<": Read " << to_copy << " bytes, (requested " << maxbufsize << ")");
        return to_copy;
}

bool BufferedPipeReadStream::EndOfStream()
{
        Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
        return lock->data.empty() && lock->closed;
}

std::size_t BufferedPipeReadStream::Write(const void *, std::size_t)
{
        return 0;
}

Blex::Event & BufferedPipeReadStream::GetEvent()
{
        return buffer->read_event;
}

void BufferedPipeReadStream::SetReadSignalThreshold(unsigned size)
{
        {
                Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
                lock->signal_threshold = size;
        }
        buffer->read_event.StateChanged();
}



BufferedPipeWriteStream::BufferedPipeWriteStream(Detail::BufferedPipeData *buffer)
: Stream(false)
, Detail::BufferedPipeBasics(buffer)
{
}

std::size_t BufferedPipeWriteStream::Read(void *, std::size_t)
{
        return 0;
}

bool BufferedPipeWriteStream::EndOfStream()
{
  return false;
}

std::size_t BufferedPipeWriteStream::Write(const void *buf, std::size_t bufsize)
{
        bool state_changed;
        {
                Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
                if (lock->closed)
                    return 0;
                //state changes if we will cross the threshold with this write
                state_changed = lock->data.size() < lock->signal_threshold
                                && lock->data.size() + bufsize >= lock->signal_threshold;
                lock->data.insert(lock->data.end(), (uint8_t*)buf, ((uint8_t*)buf) + bufsize);
        }
        if (state_changed)
            buffer->read_event.StateChanged();
        BP_PRINT("BPWS."<<this<<": Written " << bufsize << " bytes, " << "size now " << Detail::BufferedPipeData::LockedData::WriteRef(buffer->data)->data.size());
        return bufsize;
}
bool BufferedPipeWriteStream::IsPipeBroken()
{
        Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
        return lock->closed;
}

bool BufferedPipeWriteStream::IsYieldThresholdReached()
{
        Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
        return lock->yield_threshold >=0 && signed(lock->data.size()) >= lock->yield_threshold;
}

void BufferedPipeWriteStream::SetWriteYieldThreshold(signed size)
{
        Detail::BufferedPipeData::LockedData::WriteRef lock(buffer->data);
        lock->yield_threshold = size;
}

Blex::Event & BufferedPipeWriteStream::GetEvent()
{
        return buffer->write_event;
}


} // End of namespace Blex

