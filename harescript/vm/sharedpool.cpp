//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

/*-----------------------------------------------------------------------------
ADDME: The current shared-pool implementation does not offer stable storage.
   Upon reallocation, all pointers are invalidated, which causes us to check
   pointer usage in the rest of the VM very strictly. But, because no
   defragmentation support is present, this constant reallocation doesn't offer
   any advantages. A rewrite that offers a C-heap-like interface would be very
   nice.
-----------------------------------------------------------------------------*/

/*
The free list:

The free lists are maintained per group.
The first 8 group are for buffer sizes 0-31, 32-63, ... 224-255
The 20 other group for buffer sizes 256-511, 512-1023, 1024-2047 etc.

Blocks are grouped by size. One block of every (free) size is linked into
the main free list. The first element is @a freeblocks[storage group].

If there is more than one free block of a particular buffer size, these blocks
are put into a linked list. The child link in the main free list points to the
first block in this list, while the prev link in the first element points to the
block in the main free list.

                  +-> size320-2 <-> size320-3
                  |
  size256 <-> size320-1 <-> size352

Links are stored in the data part of a block
offset 0: next node (AllocationUnused if none)
offset 4: previous node/parent node (AllocationUnused if none)
offset 8: child node.

In the example, the values are as follows (- = AllocationUnused)
              prev       next      child
size256        -       size320-1    -
size320-1   size256    size356    size320-1
size320-2   size320-1  size320-2    -
size320-3   size320-2     -         -
size356     size320-1     -         -

ADDME: searching for the first node of the right size is now O(category-size),
   maybe the main free list should be a tree...
*/

#include "sharedpool.h"
#include "errors.h"

//---------------------------------------------------------------------------
//
//              SHARED BUFFER
//
//---------------------------------------------------------------------------

namespace HareScript
{

SharedPool::Allocation const SharedPool::AllocationUnused;
using Blex::putu32lsb;
using Blex::getu32lsb;
using Blex::puts32lsb;
using Blex::gets32lsb;

SharedPool::SharedPool()
{
        lastblockpointer=0;
        std::fill(freeblocks, freeblocks + TotalStorageGroups, AllocationUnused);

        pool.reserve(16*1024);
}

SharedPool::~SharedPool()
{
}

unsigned SharedPool::GetBigStorageGroupId(unsigned store_size)
{
        store_size >>= 9; // 256-511 is the first group, set store_size to 0 for them and non-0 for 512+
        unsigned id = SimpleStorageGroups;
        while (store_size != 0)
        {
                if (id >= TotalStorageGroups-1)
                    break;
                ++id;
                store_size >>= 1; // group size *2 per group
        }
        return id;
}

SharedPool::Allocation SharedPool::Allocate(unsigned size, unsigned reserve)
{
        Allocation newpos = AllocateExistingFreeBlock (reserve);

        if (newpos == AllocationUnused)
        {
                //there was no free block, so append one
                newpos=pool.size();
                pool.resize(pool.size() + RequiredStoreSize(reserve));
                putu32lsb(&pool[newpos+PredOffset], lastblockpointer);

                RelinkForward(newpos, pool.size());
        }

        //set single-reference, and store the block's size
        putu32lsb(&pool[newpos+RefCountOffset], 1);
        putu32lsb(&pool[newpos+SizeOffset], size);

        return newpos;
}

SharedPool::Allocation SharedPool::AllocateExistingFreeBlock(unsigned want_size)
{
        unsigned exp_want_size = RequiredStoreSize(want_size);
        unsigned storage_group_id = GetStorageGroupId(exp_want_size);

        while (true)
        {
                Allocation first_freeblock = freeblocks[storage_group_id];
                if (first_freeblock != AllocationUnused)
                {
                        Allocation curfreeblock = first_freeblock;

                        /* ADDME: this is a linear algorithm, that does not scale. The storage_group
                           does help a bit, but still, it should be done better. Preferrably when shared_pool
                           is rewritten :-) */
                        do
                        {
                                if (GetBufferCapacity(curfreeblock) >= want_size)
                                {
                                        //This buffer matches! Remove it from the free list
                                        RemoveFromFreeList(curfreeblock);

                                        //Shrink the buffer if it is way too big..
                                        if (exp_want_size < GetBufferCapacity(curfreeblock)+DataOffset)
                                            ReduceBlockSize(curfreeblock, want_size );

                                        return curfreeblock;
                                }
                                curfreeblock = getu32lsb(GetReadPtr(curfreeblock));
                        }
                        while (curfreeblock != AllocationUnused); //We tried _all_ the free blocks...
                }

                if (++storage_group_id >= TotalStorageGroups)
                    return AllocationUnused;
        }
}

void SharedPool::RelinkForward(Allocation ourpos, Allocation successor)
{
        puts32lsb(&pool[ourpos + SuccOffset], successor);

        if (successor == pool.size())
            lastblockpointer = ourpos;
        else
            puts32lsb(&pool[successor + PredOffset], ourpos);
}

void SharedPool::ReduceBlockSize(Allocation buffer_pos,uint32_t new_size)
{
        //divides a block in 2, the 1st part is begin used, the second is made free. If the next block is free to, then merge
        //the input_sizes are already expanded
        unsigned exp_new_size=RequiredStoreSize(new_size);
        Allocation newpos=buffer_pos+exp_new_size; //the location at which the new free block will appear
        Allocation nextblock=GetSuccPos(buffer_pos);

        //Create and configure the NEW, FREE block.
        putu32lsb(&pool[newpos+RefCountOffset], 0); //set it to Free

        if (nextblock != pool.size() && GetRefcount(nextblock)==0) //merge with next!
        {
                RemoveFromFreeList(nextblock);
                RelinkForward(newpos, GetSuccPos(nextblock));
        }
        else
            RelinkForward(newpos, nextblock);

        //Re-configure the existing block.
        RelinkForward(buffer_pos, newpos);
        AddToFreeList(newpos);
}

void SharedPool::DestroyBlock(Allocation buffer_pos)
{
        Allocation nextblock = GetSuccPos(buffer_pos);
        Allocation prevblock = GetPredPos(buffer_pos);

        bool merge_with_prev = buffer_pos != 0 && GetRefcount(prevblock) == 0;
        bool merge_with_next = nextblock != pool.size() && GetRefcount(nextblock) == 0;

        if (merge_with_prev)
        {
                RemoveFromFreeList(prevblock);
                if (merge_with_next) //Yeay, two merges!
                {
                        RemoveFromFreeList(nextblock);
                        RelinkForward(prevblock, GetSuccPos(nextblock));
                }
                else
                {
                        RelinkForward(prevblock, nextblock);
                }
                AddToFreeList(prevblock);
        }
        else
        {
                if (merge_with_next) //just eat 'next'.
                {
                        Allocation next = GetSuccPos(nextblock);
                        RemoveFromFreeList(nextblock);
                        RelinkForward(buffer_pos, next);
                }
                AddToFreeList(buffer_pos);

                putu32lsb( &pool[buffer_pos + RefCountOffset], 0);
        }
}

SharedPool::Allocation SharedPool::MakePrivate(Allocation buffer_pos, unsigned new_size, bool preserve_contents)
{
        CHECK_AP_ONLY(CheckIsValidUsedBlock(buffer_pos));

        //Are we the only reference?
        unsigned refcount = GetRefcount(buffer_pos);
        if (refcount == 1)
        {
                unsigned exp_new_size = RequiredStoreSize(new_size);
                unsigned exp_original_size = GetBufferCapacity(buffer_pos)+DataOffset;

                if (exp_new_size<=exp_original_size) //it still fits
                {
                        if (exp_new_size <= exp_original_size / 4) //apparently we have way too much capacity
                            ReduceBlockSize(buffer_pos, new_size);
                        putu32lsb(&pool[buffer_pos+SizeOffset], new_size);
                        return buffer_pos;
                }
        }

        //Reallocate..
        unsigned oldsize = GetBufferSize(buffer_pos);

        unsigned to_reserve = oldsize * 2;
        if (to_reserve < new_size)
            to_reserve = new_size;
        else if (to_reserve > new_size * 2)
            to_reserve = new_size * 2;

        Allocation newpos = Allocate(new_size, to_reserve);
        if (preserve_contents)
            std::memcpy(GetWritePtr(newpos), GetReadPtr(buffer_pos), std::min(oldsize, new_size));

        ReleaseReference(buffer_pos);
        return newpos;
}

void SharedPool::AddToFreeList(Allocation buffer_pos)
{
        unsigned buffer_size = GetBufferCapacity(buffer_pos) + DataOffset;
        unsigned storage_group_id = GetStorageGroupId(buffer_size);

        Allocation prev,next,child;
        child=AllocationUnused;

        Allocation curr = freeblocks[storage_group_id];
        if (curr == AllocationUnused) //this will be the first free block!
        {
                // This is the first block of this group. Record it as such.
                prev = AllocationUnused;
                next = AllocationUnused;
                freeblocks[storage_group_id] = buffer_pos;
        }
        else
        {
                // More in this group
                Allocation last = AllocationUnused;
                unsigned curr_buffer_size;

                // Find the first block in the main free list that is equal or larger in size
                do
                {
                        curr_buffer_size = GetBufferCapacity(curr) + DataOffset;
                        if (curr_buffer_size >= buffer_size) // Equal or larger
                            break;
                        last = curr;

                        // Get the next block
                        curr = getu32lsb((uint8_t*)GetReadPtr(curr));        //curr = curr->next
                }
                while (curr != AllocationUnused); // Don't forget to stop at the end of the linked list!

                // Curr is valid and of exactly the same size?
                if (curr != AllocationUnused && curr_buffer_size == buffer_size)
                {
                        // Yes, exact match. Insert this node in the child linked list at the front.
                        Allocation curr_child = getu32lsb((uint8_t*)GetReadPtr(curr)+8); // curr_child = curr->child

                        // Build the new links
                        next = curr_child;    //next = curr->child
                        prev = curr;
                        if (curr_child != AllocationUnused)
                            putu32lsb((uint8_t*)GetWritePtr(curr_child)+4, buffer_pos); //curr->child->prev = buffer_pos

                        // And re-point the list start to the newly freed node
                        putu32lsb((uint8_t*)GetWritePtr(curr)+8, buffer_pos); //curr->child = buffer_pos
                }
                else
                {
                        // No other block of this size found
                        // Link us in with the other blocks (order: last, this block, curr)

                        if (last == AllocationUnused)
                            freeblocks[storage_group_id] = buffer_pos; // First node!
                        else
                            putu32lsb((uint8_t*)GetWritePtr(last), buffer_pos);  //last->next = buffer_pos

                        if (curr != AllocationUnused) // Not last node?
                            putu32lsb((uint8_t*)GetWritePtr(curr)+4, buffer_pos); //curr->prev = buffer_pos

                        // And register our changes
                        prev = last;
                        next = curr;
                }
        }

        putu32lsb((uint8_t*)GetWritePtr(buffer_pos)+0, next);  //buffer_pos->next = next
        putu32lsb((uint8_t*)GetWritePtr(buffer_pos)+4, prev);  //buffer_pos->prev = prev
        putu32lsb((uint8_t*)GetWritePtr(buffer_pos)+8, child);  //buffer_pos->child = child
}

void SharedPool::RemoveFromFreeList(Allocation buffer_pos)
{
        unsigned buffer_size = GetBufferCapacity(buffer_pos) + DataOffset;
        unsigned storage_group_id = GetStorageGroupId(buffer_size);

        Allocation prev=getu32lsb((uint8_t const*)GetReadPtr(buffer_pos)+4);
        Allocation next=getu32lsb((uint8_t const*)GetReadPtr(buffer_pos));
        Allocation child=getu32lsb((uint8_t const*)GetReadPtr(buffer_pos)+8);

        // Do this block have children?
        if (child != AllocationUnused)
        {
                // Get the second block in the children linked list
                Allocation child_next = getu32lsb((uint8_t const*)GetReadPtr(child));

                // Put the first child in the main list, instead of us
                putu32lsb((uint8_t*)GetWritePtr(child), next); //child->next = next
                putu32lsb((uint8_t*)GetWritePtr(child)+4, prev); //child->prev = prev
                putu32lsb((uint8_t*)GetWritePtr(child)+8, child_next); //child->child = (old)child->next

                // Register the re-linking in the neighbour nodes
                if (prev != AllocationUnused)
                    putu32lsb((uint8_t*)GetWritePtr(prev), child); //prev->next = child
                else
                    freeblocks[storage_group_id] = child;
                if (next != AllocationUnused)
                    putu32lsb((uint8_t*)GetWritePtr(next)+4, child); //next->prev = child
        }
        else
        {
                // There is no child. Remove us in the previous node
                if (prev != AllocationUnused)
                {
                        // The previous node main be in the main list (in that case prev->child == this block, else prev->next == this block)
                        Allocation prev_child = getu32lsb((uint8_t const*)GetReadPtr(prev)+8);
                        if (prev_child == buffer_pos)
                            putu32lsb((uint8_t*)GetWritePtr(prev)+8, next); //prev->child = next
                        else
                            putu32lsb((uint8_t*)GetWritePtr(prev), next); //prev->next = next
                }
                else // We were the first block: relink to our next block
                    freeblocks[storage_group_id] = next;

                // And relink the next block to our previous.
                if (next != AllocationUnused)
                    putu32lsb((uint8_t*)GetWritePtr(next)+4, prev); //next->prev = prev
        }
}

void SharedPool::CheckIsValidUsedBlock(Allocation buffer_pos)
{
        if (buffer_pos >= pool.size())
            throw VMRuntimeError(Error::InternalError, "Illegal buffer position (past end of pool)");

        Allocation first = 0;
        while (first < buffer_pos)
        {
                first = GetSuccPos(first);
                if (first > buffer_pos)
                    throw VMRuntimeError(Error::InternalError, "Illegal buffer position #" + Blex::AnyToString(buffer_pos) + " (block does not exist)");
        }
        if (GetRefcount(first) == 0)
            throw VMRuntimeError(Error::InternalError, "Illegal buffer position #" + Blex::AnyToString(buffer_pos) + " (block has already been freed)");
}

DebugSharedPool::DebugSharedPool()
{
        AllocationRec rec;
        rec.ptr = 0;
        allocations.push_back(rec);
}

DebugSharedPool::~DebugSharedPool()
{
}

DebugSharedPool::Allocation DebugSharedPool::Allocate(unsigned size, unsigned reserve)
{
        if (reserve < size)
            reserve = size;
        AllocationRec rec;

        rec.ptr = malloc(reserve);
        rec.reserve = reserve;
        rec.size = size;
        rec.refs = 1;

        Allocation buffer_pos = allocations.size();

        uint8_t *data = static_cast< uint8_t * >(rec.ptr);
        std::fill(data, data + size, 0);

        if (size != reserve)
            VALGRIND_MAKE_MEM_NOACCESS(data + size, reserve - size);

        allocations.push_back(rec);

        //Blex::ErrStream() << "Allocated " << buffer_pos << ", size " << size << "/" << reserve;
        return buffer_pos;
}

void DebugSharedPool::ValidateAllocation(Allocation buffer_pos) const
{
        if (!buffer_pos || buffer_pos >= allocations.size())
            throw std::logic_error("Illegal buffer_pos used");

        if (!allocations[buffer_pos].ptr)
            throw std::logic_error("Freed buffer_pos used");
}

void DebugSharedPool::DuplicateReference(Allocation buffer_pos)
{
        ValidateAllocation(buffer_pos);
        ++allocations[buffer_pos].refs;
}

void DebugSharedPool::ReleaseReference(Allocation buffer_pos)
{
        ValidateAllocation(buffer_pos);
        if (--allocations[buffer_pos].refs == 0)
        {
                VALGRIND_ONLY(uint8_t *data = static_cast< uint8_t * >(allocations[buffer_pos].ptr));
                VALGRIND_MAKE_MEM_UNDEFINED(data, allocations[buffer_pos].reserve);

                free(allocations[buffer_pos].ptr);
                allocations[buffer_pos].ptr = 0;

                VALGRIND_ONLY(uint8_t *size_ptr = static_cast< uint8_t * >(static_cast< void * >(&allocations[buffer_pos].size)));
                VALGRIND_MAKE_MEM_NOACCESS(size_ptr, 1);
        }
}

bool DebugSharedPool::IsShared (Allocation buffer_pos) const
{
        ValidateAllocation(buffer_pos);
        return allocations[buffer_pos].refs > 1;
}

void const * DebugSharedPool::GetReadPtr (Allocation buffer_pos) const
{
        ValidateAllocation(buffer_pos);
        return allocations[buffer_pos].ptr;
}

void * DebugSharedPool::GetWritePtr (Allocation buffer_pos)
{
        ValidateAllocation(buffer_pos);
        return allocations[buffer_pos].ptr;
}

DebugSharedPool::Allocation DebugSharedPool::MakePrivate(Allocation buffer_pos, unsigned size, bool preserve_contents)
{
        ValidateAllocation(buffer_pos);
        if (allocations[buffer_pos].refs == 1)
        {
                if (allocations[buffer_pos].reserve >= size && size >= allocations[buffer_pos].reserve / 4)
                {
                        if (size > allocations[buffer_pos].size)
                        {
                                uint8_t *data = static_cast< uint8_t * >(allocations[buffer_pos].ptr);
                                VALGRIND_MAKE_MEM_DEFINED(data, size);

                                std::fill(data + allocations[buffer_pos].size, data + size, 0);
                        }
                        else if (size < allocations[buffer_pos].size)
                        {
                                VALGRIND_ONLY(uint8_t *data = static_cast< uint8_t * >(allocations[buffer_pos].ptr));
                                VALGRIND_MAKE_MEM_NOACCESS(data + size, allocations[buffer_pos].reserve - size);
                        }

                        allocations[buffer_pos].size = size;
                        return buffer_pos;
                }
        }

        unsigned to_reserve = allocations[buffer_pos].size * 2;
        if (to_reserve < size)
            to_reserve = size;
        else if (to_reserve > size * 2)
            to_reserve = size * 2;

        unsigned new_pos = Allocate(size, to_reserve);
        if (preserve_contents)
        {
                unsigned copy_size = size;
                if (copy_size > allocations[buffer_pos].size)
                    copy_size = allocations[buffer_pos].size;

                uint8_t const *old_data = static_cast< uint8_t const * >(allocations[buffer_pos].ptr);

                std::copy(old_data, old_data + copy_size, static_cast< uint8_t * >(allocations[new_pos].ptr));
        }

        ReleaseReference(buffer_pos);
        return new_pos;

}

unsigned DebugSharedPool::GetBufferSize(Allocation buffer_pos) const
{
        ValidateAllocation(buffer_pos);
        return allocations[buffer_pos].size;
}

unsigned DebugSharedPool::GetCapacity() const
{
        unsigned total = 0;
        for (auto &rec: allocations)
            total += rec.reserve;
        return total;
}


} // End of namespace HareScript
