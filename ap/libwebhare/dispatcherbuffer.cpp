#include <ap/libwebhare/allincludes.h>


#include "dispatcherbuffer.h"

// -----------------------------------------------------------------------------
//
//   DispatcherDataBufferAllocator
//

void DispatcherDataBufferAllocator::AllocBuffer(std::shared_ptr< DispatcherDataBufferSegment > *buffer)
{
        buffer->reset();
        {
                LockedData::WriteRef lock(data);
                if (!lock->free.empty())
                {
                        *buffer = lock->free.front();
                        lock->free.pop_front();
                }
        }
        if (!buffer->get())
            buffer->reset(new DispatcherDataBufferSegment);
        else
            (*buffer)->fill = 0;
}

void DispatcherDataBufferAllocator::ReleaseBuffer(std::shared_ptr< DispatcherDataBufferSegment > const &buffer)
{
        LockedData::WriteRef lock(data);
        lock->free.push_back(buffer);
}

// -----------------------------------------------------------------------------
//
//   DispatcherDataBuffer
//

DispatcherDataBuffer::DispatcherDataBuffer(DispatcherDataBufferAllocator *_allocator)
: allocator(_allocator)
, addedbuffers(0)
{
}


void DispatcherDataBuffer::StoreData(const void* start, unsigned length)
{
        const uint8_t *data=static_cast<const uint8_t*>(start);
        while (length > 0)
        {
                if (buffers.size() == addedbuffers || buffers.back()->fill == DispatcherDataBufferSegment::Size)
                {
                        std::shared_ptr< DispatcherDataBufferSegment > buffer;
                        buffers.push_back(buffer);

                        if (allocator)
                            allocator->AllocBuffer(&buffers.back());
                        else
                            buffers.back().reset(new DispatcherDataBufferSegment);
                }

                DispatcherDataBufferSegment &segment = *buffers.back().get();

                //copy as much as we can
                unsigned to_copy = std::min(length, DispatcherDataBufferSegment::Size - segment.fill);
                memcpy(segment.data + segment.fill, data, to_copy);

                segment.fill += to_copy;
                data += to_copy;
                length -= to_copy;
        }
}

void DispatcherDataBuffer::AddToQueue(Blex::Dispatcher::QueuedSendData *queue)
{
        for (BufferList::iterator it = buffers.begin() + addedbuffers; it != buffers.end(); ++it)
            queue->push_back(Blex::Dispatcher::SendData((*it)->data, (*it)->fill));

        addedbuffers = buffers.size();
}


void DispatcherDataBuffer::MarkBuffersSent(unsigned bufcount)
{
        while (bufcount)
        {
                if (allocator)
                    allocator->ReleaseBuffer(buffers.front());
                buffers.pop_front();
                --addedbuffers;
                --bufcount;
        }
}

unsigned DispatcherDataBuffer::GetTotalSize()
{
        unsigned result = 0;
        for (BufferList::iterator it = buffers.begin() + addedbuffers; it != buffers.end(); ++it)
            result += (*it)->fill;

        return result;
}
