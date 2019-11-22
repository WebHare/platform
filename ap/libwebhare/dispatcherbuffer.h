#ifndef blex_webhare_ap_libwebhare_dispatcherbuffer
#define blex_webhare_ap_libwebhare_dispatcherbuffer

#include <blex/dispat.h>
#include "whrpc.h"

/** Class that keeps buffer data
*/
class DispatcherDataBufferSegment
{
    public:
        DispatcherDataBufferSegment() : fill(0) {}

        static const unsigned Size = 16*1024; //size of each buffer

        /// Data
        uint8_t data[Size];

        /// Number of bytes present in the data
        unsigned fill;
};


/** Buffer allocater
*/
class DispatcherDataBufferAllocator
{
    public:
        void AllocBuffer(std::shared_ptr< DispatcherDataBufferSegment > *buffer);
        void ReleaseBuffer(std::shared_ptr< DispatcherDataBufferSegment > const &buffer);

    private:
        struct Data
        {
                std::deque< std::shared_ptr< DispatcherDataBufferSegment > > free;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        LockedData data;
};


/** Buffer allocater
*/
class BLEXLIB_PUBLIC DispatcherDataBuffer
{
    public:
        /// Constructor
        explicit DispatcherDataBuffer(DispatcherDataBufferAllocator *allocator);

        ///Add data to buffer
        void StoreData(const void* start, unsigned length);
        void Store(std::string const &str) { StoreData(&str[0],str.size()); }
        void Store(const char *str)        { StoreData(str,strlen(str)); }

        ///Add not yet added buffers to a senddata queue
        void AddToQueue(Blex::Dispatcher::QueuedSendData *queue);

        /// Mark (previously added) buffers as sent. Those buffers can be discarded.
        void MarkBuffersSent(unsigned bufcount);

        /// Return total number of bytes stored
        unsigned GetTotalSize();

        bool HasUnaddedBuffers() { return buffers.size() != addedbuffers; }

    private:
        DispatcherDataBufferAllocator *allocator;

        typedef std::deque< std::shared_ptr< DispatcherDataBufferSegment > > BufferList;

        /// List of buffers
        BufferList buffers;

        /// Number of added buffers
        unsigned addedbuffers;
};

#endif
