#ifndef blex_webhare_harescript_sharedpool
#define blex_webhare_harescript_sharedpool

#include "hsvm_constants.h"
#include <blex/podvector.h>

// If enabled, allocations are checked at various points if they still point to valid blocks
//#define CHECK_ALLOCATION_POINTERS

// Impl.
#ifdef CHECK_ALLOCATION_POINTERS
 #define CHECK_AP_ONLY(x) x
#else
 #define CHECK_AP_ONLY(x)
#endif

namespace HareScript
{

/** SharedPool, memory pool of refcounted shared allocations.

This class implements a memory pool in which small, reference-counted shareable
allocations can be done. It is suited for many small allocations which are
duplicated often, but infrequently modified. It does not support multiple
threads, and is much faster (and fragments less) than malloc().

It is only multi-thread safe when serialized. Pointers to data within Shared-
pool storage are ALL invalidated upon calling Allocate or MakeWritable
*/

class BLEXLIB_PUBLIC SharedPool
{
    public:
        /** Allocation index */
        typedef unsigned Allocation;

    private:
        /** Position of the reference counter in an allocation slot */
        static unsigned const RefCountOffset = 0;
        /** Position of the previous block pointer.
            Points to previous block, INVALID if this block is block 0 */
        static unsigned const PredOffset = 4;
        /** Position of the next block pointer.
            Points to next block, points to pool.size() if none exists (last block) */
        static unsigned const SuccOffset = 8;
        /** Position of the allocation size in an allocation slot (invalid for free blocks) */
        static unsigned const SizeOffset = 12;
        /** Position of the data in an allocation slot */
        static unsigned const DataOffset = 16;
        /** expanding size, increase the length of small string, to prevent memory fragmentation */
        static unsigned const DefaultExpSize = 16;
        /** All blocks are a multiple of this size */
        static unsigned const BlockMultiple = DataOffset + DefaultExpSize;
        /** Number of storage groups */
        static unsigned const SimpleStorageGroups = 8; // for sizes 32+ .. 224+ ( +32)
        static unsigned const ExpStorageGroups = 20;  // for 256+, 512+, 1024+, 2048+, 4096+, etc. (*2)
        static unsigned const TotalStorageGroups = SimpleStorageGroups + ExpStorageGroups;

        /** Returns the reference count of the buffer */
        unsigned GetRefcount (Allocation buffer_pos) const
        {
                return Blex::getu32lsb(&pool[buffer_pos+RefCountOffset]);
        }
        Allocation GetSuccPos(Allocation buffer_pos) const
        {
                return Blex::getu32lsb(&pool[buffer_pos+SuccOffset]);
        }
        Allocation GetPredPos(Allocation buffer_pos) const
        {
                return Blex::getu32lsb(&pool[buffer_pos+PredOffset]);
        }

        /** Get the storage group for larger (>=256) sizes) */
        static unsigned GetBigStorageGroupId(unsigned store_size);

        /** Calculates the storage group for a given size (block multiple!) */
        static inline unsigned GetStorageGroupId(unsigned store_size)
        { return store_size < SimpleStorageGroups * BlockMultiple ? store_size / BlockMultiple : GetBigStorageGroupId(store_size); }


        /** Get the capacity of an allocation slot
            @param buffer_pos     the pos of the Buffer to get the length from
            @return               the size of the specified buffer, or 0 is the refcount is 0*/
        unsigned GetBufferCapacity(Allocation buffer_pos) const
        {
                return GetSuccPos(buffer_pos) - buffer_pos - DataOffset;
        }

        /** Establish a proper succesor link, and set the successor's PRED link properly */
        void RelinkForward(Allocation ourpos, Allocation successor);

    public:
        /** Allocation index of an unused buffer */
        static Allocation const AllocationUnused = static_cast<Allocation>(-1);

        /** Construct an empty shared pool*/
        SharedPool ();

        /** Destroy the shared pool*/
        ~SharedPool();

        /** Allocate a new buffer
            @param size Requested size
            @param reserve Size to reserve
            @return Index to the newly allocated bufer */
        Allocation Allocate(unsigned size, unsigned reserve);

        /** Duplicate an allocation (increases its reference count)
            @param buffer_pos    the pos of the Buffer to increase the refcount*/
        void DuplicateReference (Allocation buffer_pos)
        {
                CHECK_AP_ONLY(CheckIsValidUsedBlock(buffer_pos));
                Blex::putu32lsb(&pool[buffer_pos+RefCountOffset],GetRefcount(buffer_pos)+1);
        }

        /** Decreases the refcount of the block, and free the block if its refcount
            reaches zero
            @param buffer_pos    the pos of the Buffer to decrease the refcount*/
        void ReleaseReference(Allocation buffer_pos)
        {
                CHECK_AP_ONLY(CheckIsValidUsedBlock(buffer_pos));

                unsigned newrefcount = GetRefcount(buffer_pos)-1;
                Blex::putu32lsb(&pool[buffer_pos+RefCountOffset],newrefcount);
                if (newrefcount==0)
                    DestroyBlock(buffer_pos);
        }

        /** Checks if the allocation has a reference count of 1 */
        bool IsShared (Allocation buffer_pos) const
        { return GetRefcount(buffer_pos)>1; }

        /** GetReadPtr
            @return A read-only pointer to the requested buffer, aligned for all possible memory sizes */
        void const * GetReadPtr (Allocation buffer_pos) const
        { return &pool[buffer_pos+DataOffset]; }

        /** GetWritePtr
            @return A writable pointer to the requested buffer, aligned for all possible memory sizes */
        void * GetWritePtr (Allocation buffer_pos)
        { return const_cast<void*>(GetReadPtr(buffer_pos)); }

        /** Returns a buffer with refcount 1. If the current buffer already has refcount 1, it is reused.
            Optionally copies the contents of the old buffer to the new buffer.
            @param buffer_id      the pos of the buffer to write to
            @param size           the size   the buffer should be
            @param preserve_contents Copy the contents of the old buffer to the new buffer
            @return               a void-pointer to the writable buffer  */
        Allocation MakePrivate(Allocation buffer_pos, unsigned size, bool preserve_contents);

        /** Get the size of an allocation
            @param buffer_pos     the pos of the Buffer to get the length from
            @return               the size of the specified buffer, or 0 is the refcount is 0*/
        unsigned GetBufferSize     (Allocation buffer_pos) const
        { return GetBufferSizeFromBuf( &pool[buffer_pos+DataOffset] ); }

        /** Get the current buffer size */
        unsigned GetCapacity() const
        { return pool.capacity(); }

        void CheckIsValidUsedBlock(Allocation buffer_pos);

    private:

        /** Get the size of the buffer from its actual pointer
            @param buffer_pos     the pos of the Buffer to get the length from
            @return               the size of the specified buffer, or 0 is the refcount is 0*/
        static unsigned GetBufferSizeFromBuf (void const *dataptr)
        {  return Blex::getu32lsb(static_cast<uint8_t const *>(dataptr)-DataOffset+SizeOffset); }

        /** Free and destroy a block (used by Free() when refcount would reach zero) */
        void DestroyBlock(Allocation buffer_pos);

        /** Given the actual data size, calculate the number of real storage bytes
            required by rounding the total up to the next multiple of SHBUF_BLOCK_MULTIPLE,
            considering both the space for the header, the data and the unused filler bytes
            RequiredStoreSize = k*SHBUF_BLOCK_MULTIPLE, K>=1 */
        unsigned RequiredStoreSize        (unsigned datasize) const
        {
                return ((datasize+DataOffset+BlockMultiple-1)&(~(BlockMultiple-1)));
        }

        /**  Frees "the rest" of a block, when decreasings its size.
             The position given is the beginning position of the "old" block.
             Then, its new size is calculated by old minus new size, and that particular part is freed
             @param buffer_pos  the position of the block to free
             @param new_size    this is the new size of the block, after resizing */
        void      ReduceBlockSize(Allocation buffer_pos, uint32_t new_size);

        /**  Searches for a free block, using First Fit stragety
             @param     want_size, the size that is needed for the block
             @return    the position of the free block, or -1 is none found*/
        Allocation AllocateExistingFreeBlock(unsigned want_size);

        /** Add a block to the free list. Block header must be valid */
        void AddToFreeList(Allocation buffer_pos);

        /** Remove a block from the free list. Block header must be valid, and unchanged (except prev) since last add */
        void RemoveFromFreeList(Allocation buffer_pos);

        /// The data
        Blex::PodVector<uint8_t> pool;

        /** This variable holds the position of the last pointer */
        Allocation lastblockpointer;

        /** This variable holds the position of the first free block per storage group, or AllocationUnused if no free block is around */
        Allocation freeblocks[TotalStorageGroups];
};

class DebugSharedPool
{
        struct AllocationRec
        {
                void *ptr;
                unsigned size;
                unsigned reserve;
                unsigned refs;
        };

        Blex::PodVector< AllocationRec > allocations;

    public:
        /** Allocation index */
        typedef unsigned Allocation;

        /** Allocation index of an unused buffer */
        static Allocation const AllocationUnused = static_cast<Allocation>(-1);

        /** Construct an empty shared pool*/
        DebugSharedPool ();

        /** Destroy the shared pool*/
        ~DebugSharedPool();

        Allocation Allocate(unsigned size, unsigned reserve);
        void DuplicateReference (Allocation buffer_pos);
        void ReleaseReference(Allocation buffer_pos);
        bool IsShared (Allocation buffer_pos) const;
        void const * GetReadPtr (Allocation buffer_pos) const;
        void * GetWritePtr (Allocation buffer_pos);
        Allocation MakePrivate(Allocation buffer_pos, unsigned size, bool preserve_contents);
        unsigned GetBufferSize     (Allocation buffer_pos) const;
        unsigned GetCapacity() const;

    private:
        void ValidateAllocation(Allocation buffer_pos) const;
};

} // End of namespace HareScript
#endif
