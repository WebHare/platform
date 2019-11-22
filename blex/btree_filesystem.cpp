#include <blex/blexlib.h>



#include <iostream>

#include "path.h"
#include "logfile.h"
#include "btree_filesystem.h"

//#pragma option -vi-

//#define EXTENSIVE_DEBUGMESSAGES
//#define IGNORE_DIRTY_MARKINGS

namespace Blex
{
namespace Index
{

static const uint32_t FSVersion = 5;
static const uint32_t FSMagic = 0x23652513;
static const uint32_t BtreeVersion = 2;
static const uint32_t BtreeMagic = 0x734ADE24;


/** Allow shared sections ? (set to FALSE todebug) */
static const bool AllowSharedSections = true;

// FIXME: crash management.

/* ADDME: opslaan free-block data in sectionfile zelf */
/* ADDME: opslaan index-data in mmapped file during operation */
/* FIXME: check begincycle-endcycle-requestindexes concurrency problems */

/* arnold: je hoeft inline functies niet perse in de klasses te definieren, of
           -wanneer ze maar door een file gebruikt worden- zelfs niet in de .h
           file. misschien wel iets om rekening mee te houden omdat werken
           met iterators enzo veel inline functies uitlokken, maar alle inlines
           in de class {..} zelf te zetten er een zootje van kan maken.
*/

#define IndexAssert(cond,err) do { if (!(cond)) FailIndex(err); } while(0)


//////////////////////////////////////////////////////////////////////////////
//
// Index statistics
//
bool Statistics::operator ==(const Statistics &rhs) const
{
        return (duplicates == rhs.duplicates) && (totalblocks == rhs.totalblocks) &&
                (totalentries == rhs.totalentries) && (totalentrysize == rhs.totalentrysize);
}

void Statistics::Read(Blex::Stream &file)
{
        file.ReadLsb(&totalentries);
        file.ReadLsb(&totalblocks);
        file.ReadLsb(&duplicates);

        /* BCB BUG workaround. It screws up code generation for U64s. Of course,
           we cannot really blame this on Borland - it's a known fact the
           parsing of bits to build a 64-bit unsigned value is one of the
           hardest problems to be ever solved by mankind - much more difficult,
           than, say, breaking the speed of light, or finding the end of
           a round-about. */

        uint32_t total_entry_size_low = file.ReadLsb<uint32_t>();
        uint32_t total_entry_size_high = file.ReadLsb<uint32_t>();
        totalentrysize = uint64_t(total_entry_size_low) | (uint64_t(total_entry_size_high)<<32); //yes, i am a rocket scientist!
}

void Statistics::Write(Blex::Stream &file) const
{
        file.WriteLsb(totalentries);
        file.WriteLsb(totalblocks);
        file.WriteLsb(duplicates);
        file.WriteLsb(totalentrysize);
}


//////////////////////////////////////////////////////////////////////////////
//
// DBIndex2
//

BtreeIndex::BtreeIndex(DBIndexFileSystem& _filesystem, std::string const &_name)
: indexname(_name)
, filesystem(_filesystem)
{
        // Create new index
#ifdef DEBUG_RESOURCEMANAGER
        DEBUGONLY(admin.SetupDebugging(indexname + " lock"));
#endif
        DBIndexFileSystem::ReadWriteSession session(filesystem);

        // Lock administration, and allocate a block, and initialise our administration
        LockedAdmin::WriteRef lockedadmin(admin);

        lockedadmin->indexid = filesystem.GetFreeIndexId();
        lockedadmin->statistics.totalblocks = 1;

        lockedadmin->superblockno = session.AllocateBlock(lockedadmin->indexid, BlockId(-1));
        lockedadmin->treedepth = 1;
        // lockedadmin->statistics is initialised ok

#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("A index is born");
#endif
}

BtreeIndex::BtreeIndex(DBIndexFileSystem &_filesystem, Blex::Stream &indata)
: filesystem(_filesystem)
{
        // Create a index object for an existing index on disk
#ifdef DEBUG_RESOURCEMANAGER
        DEBUGONLY(admin.SetupDebugging("Index tree-parameters lock"));
#endif

        if (indata.ReadLsb<uint32_t>() != BtreeMagic || indata.ReadLsb<uint32_t>() != BtreeVersion)
            throw IndexException("Index metadata does not match expected version");
            //Exception(ErrorIO,"Index metadata does not match expected version");

        // Lock administration, and initialise administration
        LockedAdmin::WriteRef lockedadmin(admin);

        uint32_t superblockno = indata.ReadLsb<uint32_t>();
        lockedadmin->indexid = filesystem.GetIndexId(superblockno);
        lockedadmin->superblockno = superblockno;
        lockedadmin->treedepth = indata.ReadLsb<uint32_t>();
        lockedadmin->statistics.Read(indata);

        uint32_t namelen = indata.ReadLsb<uint32_t>();
        indexname.resize(namelen);
        indata.Read(&indexname[0],namelen);

        if (indata.ReadLsb<uint32_t>() != BtreeMagic)
//            throw Exception(ErrorIO,"Index metadata terminator does not match expected version");
            throw IndexException("Index metadata terminator does not match expected version");

#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("A index has been resurrected");
#endif
}

void BtreeIndex::SaveState(Blex::Stream &metadatafile)
{
        LockedAdmin::ReadRef lockedadmin(admin);

        metadatafile.WriteLsb<uint32_t>(BtreeMagic);
        metadatafile.WriteLsb<uint32_t>(BtreeVersion);

        metadatafile.WriteLsb<uint32_t>(lockedadmin->superblockno);
        metadatafile.WriteLsb<uint32_t>(lockedadmin->treedepth);
        lockedadmin->statistics.Write(metadatafile);

        metadatafile.WriteLsb<uint32_t>(indexname.size());
        metadatafile.Write(&indexname[0],indexname.size());

        metadatafile.WriteLsb<uint32_t>(BtreeMagic); //terminator
}

void BtreeIndex::InsertData2(IndexBlockEntry const &entry)
{
//        IndexBlockEntryContainer entry;
//        entry.ConstructDataEntry(data, datalen, recordid);

#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("INSERT " << indexname << ':' << entry << " for record " << entry.GetRecordId());
#endif
        // No recordid 0!
//        assert(recordid != 0);
        assert(entry.GetRecordId() != 0);

        // Make a write session
        WriteSession session(*this);

        session.CheckTreeRoot();

        Stack stack(*session.admin, session.filesession);

        if (!session.MoveUpwardTowardEntry(stack, entry, Insert))
        {
                bool unique = !session.IsDuplicate(stack, entry);

                stack.top().blockptr->InsertAt(stack.top().current, entry);

                ++session.admin->statistics.totalentries;
                session.admin->statistics.totalentrysize += entry.GetEntryLength();
                if (!unique)
                        ++session.admin->statistics.duplicates;
        }
        else // ADDME: debug message. Remove when not needed anymore
        {
                DEBUGPRINT("Index: InsertData: Inserting duplicate entry, aborting");
        }
}

bool BtreeIndex::DeleteData2(IndexBlockEntry const &entry)
{
//        IndexBlockEntryContainer entry;
//        entry.ConstructDataEntry(data, datalen, recordid);

#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("DELETE " << indexname << ':' << entry << " for record " << entry.GetRecordId());
#endif

        // No recordid 0!
//        assert(recordid != 0);
        assert(entry.GetRecordId() != 0);

        WriteSession session(*this);

        session.CheckTreeRoot();

        Stack stack(*session.admin, session.filesession);

        // First, find our entry
        if (!session.MoveUpwardTowardEntry(stack, entry, Delete))
        {
                // Entry does not exist - probably because we are still filling. If not -> it is a BAD thing
                return false;
        }

        if (stack.size() == session.admin->treedepth)
        {
                // We are at a leaf, so delete can be done just by removing the entry
                stack.top().blockptr->DeleteAt(stack.top().current);
        }
        else
        {
                uint32_t oldposition = stack.size();

                // Child fillsize has already been checked.
                stack.followchild();

                // Move to eob in last leaf just before our entry.
                session.MoveUpwardTowardEntry(stack, entry, Delete);

                IndexAssert(stack.size() == session.admin->treedepth, "Searching an insertion location ended in a non-leaf index block"); // We must be in the leaf!

                // Extract and delete entry just before the eob in leaf we did just find
                --stack.top().current;
                IndexBlockEntryContainer temp;
                temp.CopyFrom(*stack.top().current);
                stack.top().blockptr->DeleteAt(stack.top().current);

                // Move back to original level where our entry was. It hasn't changed, size
                // requerements are met.
                while (stack.size() > oldposition)
                        stack.pop();

                // Replace doomed entry with entry we got from leaf.
                BlockId childblockid = stack.top().current->GetChildBlockId();
                stack.top().blockptr->DeleteAt(stack.top().current);
                stack.top().blockptr->InsertAtWithID(stack.top().current, temp, childblockid);

                // Move to the first leaf position after the replaced entry
                ++stack.top().current;
                while (stack.size() < session.admin->treedepth)
                        stack.followchild();
        }


        if (session.IsDuplicate(stack, entry))
                --session.admin->statistics.duplicates;

        --session.admin->statistics.totalentries;
        session.admin->statistics.totalentrysize -= entry.GetEntryLength();
        return true;
}

void BtreeIndex::DestroyIndex()
{
        WriteSession session(*this);

        SmartBlockPtr base(session.filesession, session.admin->superblockno);
        session.DestroySubtree(base, session.admin->treedepth);
        session.admin->treedepth = 0;
}

BtreeIndex::ReadSession::ReadSession(BtreeIndex &_index)
: filesession(_index.filesystem)
, admin(_index.admin)
{
}

BtreeIndex::WriteSession::WriteSession(BtreeIndex &_index)
  : filesession(_index.filesystem)
  , admin(_index.admin)
{
}

//////////////////////////////////////////////////////////////////////////////
//
// BtreeIndex::Stack
//

//ADDME: perhaps a 'short string optimization'-like vector could optimize this?
BtreeIndex::Stack::Stack(const Admin& _admin, DBIndexFileSystem::Session &_filesession)
: admin(_admin)
, filesession(_filesession)
{
        innerstack.reserve(8);
}

BtreeIndex::Stack::~Stack()
{
        for (unsigned i=0;i<innerstack.size();++i)
            delete innerstack[i];
}

void BtreeIndex::Stack::pop()
{
        delete innerstack.back();
        innerstack.pop_back();
}

void BtreeIndex::Stack::followchild()
{
        innerstack.reserve(innerstack.size()+1);

        //ADDME: Clean up: Element doesn't tolerate copying in non-shared mode, but our current implementation doesn't prevent C++ from copying it anyway (I want a non-copying deque/vector! and something much more efficient than cur shared_ptr)
        if (innerstack.size() > 0)
            innerstack.push_back(new Element(filesession, top().current->GetChildBlockId()));
        else
            innerstack.push_back(new Element(filesession, admin.superblockno));
}

//Note:should be in namespace Database::Index
//ADDME: Seems obsolete? not used by dbserver
void BtreeIndex::Stack::MoveToFirstBigger(const IndexBlockEntry& entry)
{
        // Go back to begin of superblock
        while (size() > 0)
                pop();
        // Zoek eerste entry groter dan onze
        do
        {
                followchild();
                top().current = std::upper_bound(top().current, top().blockptr->end(), entry);

        } while (size() < admin.treedepth);

        // Go back to base, while at EOB
        while (top().current->IsEOB() && (size() > 1))
                pop();
}

void BtreeIndex::Stack::MoveToFirstBiggerOrEqual(const IndexBlockEntry& entry)
{
        // Go back to superblock
        while (size() > 0)
                pop();
        // Zoek entry
        do
        {
                followchild();                          //go deeper...
                top().current = std::lower_bound(top().current, top().blockptr->end(), entry);
        } while (size() < admin.treedepth);

        // Go back to base, while at EOB
        while (top().current->IsEOB() && size() > 1)
                pop();
}

//////////////////////////////////////////////////////////////////////////////
//
// BtreeIndex::WriteSession
//
void BtreeIndex::WriteSession::DestroySubtree(SmartBlockPtr const &base, uint32_t depth)
{
        if (depth>1)
        {
                for (IndexBlock::iterator it = base->begin(); it != base->end(); ++it)
                {
                        SmartBlockPtr child(filesession, it->GetChildBlockId());
                        DestroySubtree(child, depth-1);
                }
        }
        filesession.FreeBlock(base.GetBlockId());
        --admin->statistics.totalblocks;
}

bool BtreeIndex::WriteSession::IsDuplicate(Stack &stack, const IndexBlockEntry& entry)
{
        IndexBlockEntryContainer compareentry;
        compareentry.CopyFrom(entry);

        uint32_t duplicate = false;

        // Check the left entry

        // Go to leaf-level
        uint32_t old_size = stack.size();
        while (stack.size() < admin->treedepth)
        {
                stack.followchild();
                stack.top().current = stack.top().blockptr->eob();
        }

        // Check the left entry
        int32_t depth = stack.size()-1;
        while ((depth >= 0) && (stack[depth].current == stack[depth].blockptr->begin()))
                --depth;
        if (depth >= 0)
        {
                compareentry.SetRecordID((stack[depth].current-1)->GetRecordId());
                if (compareentry == *(stack[depth].current-1))
                        duplicate = true;
                if (compareentry < *(stack[depth].current-1))
                {
                        Blex::ErrStream() << "Index ordering constraints violated";
                        throw IndexException("Index ordering constraints violated");
                }
        }

        // And return the stack to it's old position
        while (stack.size() > old_size)
                stack.pop();

        // Check the right neighbour
        depth = stack.size() - 1;
        while ((depth >= 0) && (stack[depth].current == stack[depth].blockptr->eob()))
                --depth;
        if (depth >= 0)
        {
                compareentry.SetRecordID((stack[depth].current)->GetRecordId());
                if (compareentry == *(stack[depth].current))
                    duplicate = true;
                if (compareentry > *(stack[depth].current))
                {
                        Blex::ErrStream() << "Index ordering constraints violated";
                        throw IndexException("Index ordering constraints violated");
                }
        }

        return duplicate;
}

bool BtreeIndex::WriteSession::MoveUpwardTowardEntry(Stack &stack, IndexBlockEntry const &entry, ActionType requester)
{
        // Find: do not check sizes of childblocks.
        // Insert: check childblocks, but not childblock of entry when found
        // Delete: check childblocks, also childblock of found entry

        // Entry found: returns TRUE, stack points to entry
        // Not found: returns FALSE, stack points to place (in leaf) where entry would be placed.

        // Make sure we have a block in the stack
        if (stack.size() == 0)
                stack.followchild();

        while(true)
        {
                Stack::Element &top = stack.top();

                // Find first entry higher then (or equal to) the entry we seek
                top.current = std::lower_bound(top.current, top.blockptr->end(), entry);

                // If requester is Delete, we must check the childblock of the found entry. If not, we can exit
                if ((requester != Delete) && (*top.current == entry))
                        break;

                // Check childblock only if inserting or deleting, and when not at a leaf
                if ((requester != Find) && (stack.size() != admin->treedepth))
                {
                        if (!CheckChildSize(*top.blockptr,top.current))
                        {
                                // Rebalancing has found place, top.current has been put somewhat back. Redo
                                // last piece of search
                                while (*top.current < entry)
                                        ++top.current;
                        }
                }
                // If we have found our entry, exit
                if (*top.current == entry)
                        break;

                // We have found a entry higher, but not equal. Stop if at a leaf, else go one level deeper
                if (stack.size() != admin->treedepth)
                        stack.followchild();
                else
                        break;
        }

        return (*stack.top().current == entry);
}

void BtreeIndex::WriteSession::Redistribute(IndexBlock &base, IndexBlockIterator at, int32_t _balancepoint)
// Border conditions tested, assertions hold.
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Redistribute " << /*base.blockno << */" balance " << _balancepoint);
#endif

        // Get shortcuts for the affected blocks.
        IndexAssert(base.IsContained(at) && !at->IsEOB(), "Redistribution function called with an invalid block element");

        SmartBlockPtr left(filesession,  at[0].GetChildBlockId());
        SmartBlockPtr right(filesession, at[1].GetChildBlockId());

        // Determine the totalsize
        uint32_t totalsize = left->FillSize() + at->GetEntryLength() + right->FillSize();

        // If _balancepoint is negative, convert into positive value. Save it for after-check
        uint32_t balancepoint = _balancepoint < 0 ? _balancepoint + totalsize : _balancepoint;
        uint32_t originalbalancepoint = balancepoint;

        // Precond.: EOBSize <= balancepoint <= totalsize - EOBSize
        // Precond.: baseblock.FillSize() <= MaxBlockSize - MaxEntrySize
        IndexAssert((IndexBlockEntry::EOBSize <= balancepoint) && (balancepoint <= C_Block::MaxData), "Redistribution function called with invalid parameters (1)");
        IndexAssert((totalsize - balancepoint >= IndexBlockEntry::EOBSize) && (totalsize - balancepoint <= C_Block::MaxData), "Redistribution function called with invalid parameters (2)");
        IndexAssert(base.FillSize() - at->GetEntryLength() <= C_Block::MaxData - IndexBlockEntry::MaxEntrySize, "Redistribution function called with a block that is too full");

//        uint32_t TotalSize = curr.FillSize() + at->GetEntryLength() + next.FillSize();
        // Determine place of median.
        if (balancepoint < left->FillSize())
        {
                // Move back balancepoint, to exclude EOB that will always remain in this block
                balancepoint -= IndexBlockEntry::EOBSize;

                // invariant: left.begin().MemDistance(left.eob) < balancepoint
                IndexBlockIterator median = left->IteratorAtPos(balancepoint);
                // invariant: median != eob

                // Calculate new fillsize of next. If overflow, then return
                if (IndexBlock::ByteSizeOfRange(median+1, left->eob()) + at->GetEntryLength() + right->FillSize() > C_Block::MaxData)
                        throw IndexException("Redistribution of index blocks failed");

                // Move 'at' entry to right, with childblockid of EOB of left, plus entries of left after median
                right->InsertAtWithID(right->begin(), *at, left->eob()->GetChildBlockId());
                right->InsertRange(right->begin(), median+1, left->eob());

                // Delete at, and insert median in this block
                base.DeleteAt(at);
                base.InsertAtWithID(at, *median, left.GetBlockId());

                // Set childblockid of eob to the chilblockid of the median
                left->eob()->SetChildBlockID(median->GetChildBlockId());

                // Delete median until eob from curr
                left->DeleteRange(median, left->eob());
        }
        else if (balancepoint > left->FillSize() + at->GetEntryLength())
        {       // Median in right-> Take position at balancepoint - left.FillSize() - at->GetEntryLength(), to get as close as possible to balancepoint
                IndexBlockIterator median = right->IteratorAtPos(balancepoint - left->FillSize() - at->GetEntryLength());

                // Calculate new fillsize of right-> If overflow, then return
                if (left->FillSize() + at->GetEntryLength() + IndexBlock::ByteSizeOfRange(right->begin(), median) > C_Block::MaxData)
                        throw IndexException("Redistribution of index blocks failed");

                // Move 'at' entry to curr, with GetChildBlockId of EOB of curr, plus entries of next before median
                left->InsertAtWithID(left->eob(), *at, left->eob()->GetChildBlockId());
                left->InsertRange(left->eob(), right->begin(), median);

                // Delete at, and insert median in this block
                base.DeleteAt(at);
                base.InsertAtWithID(at, *median, left.GetBlockId());

                // Set childblockid of eob to the chilblockid of the median
                left->eob()->SetChildBlockID(median->GetChildBlockId());

                // Delete median until eob from next
                right->DeleteRange(right->begin(), median+1);
        }
        // if median not in curr or next, median is old parent-entry -> no action needed.

        // Postcond: balancepoint - MaxEntrySize <= left.fillsize <= balancepoint
        // Postcond: (totalsize - balancepoint) - MaxEntrySize <= right->fillsize <= (totalsize - balancepoint)

        // Check guarantees
        IndexAssert(left->FillSize() + IndexBlockEntry::MaxEntrySize >= originalbalancepoint, "Redistribution function did not rebalance blocks properly (1)");
        IndexAssert(left->FillSize() <= originalbalancepoint, "Redistribution function did not rebalance blocks properly (2)");
        IndexAssert(right->FillSize() + IndexBlockEntry::MaxEntrySize >= totalsize - originalbalancepoint, "Redistribution function did not rebalance blocks properly (3)");
        IndexAssert(right->FillSize() <= totalsize - originalbalancepoint, "Redistribution function did not rebalance blocks properly (4)");
}

bool BtreeIndex::WriteSession::Average2(IndexBlock &baseblock, IndexBlockIterator at)
// Border conditions tested, assertions hold.
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Average2 " /*<< baseblock.blockno*/);
#endif

        IndexAssert(baseblock.IsContained(at) && !at->IsEOB(), "Average of 2 blocks called with an invalid block element");
        IndexAssert(baseblock.FillSize() - at->GetEntryLength() <= C_Block::MaxData - IndexBlockEntry::MaxEntrySize, "Average of 2 blocks called with a block that is too full");

        SmartBlockPtr left(filesession,  at[0].GetChildBlockId());
        SmartBlockPtr right(filesession, at[1].GetChildBlockId());

        unsigned totalsize = left->FillSize()
                        + at->GetEntryLength()
                        + right->FillSize();

        unsigned medianpoint = totalsize / 2;

        //WARNING: comparison between signed and unsigned integer expressions
        if ((medianpoint < C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize)
            || ((totalsize - medianpoint) > C_Index::InsertDelete::MaxSize))
                return false;

        // Invariant: 2 * EOBSize <= totalsize -> (totalsize / 2 <= totalsize - EOBSize)
        // Invariant1: totalsize - medianpoint == (totalsize + 1) / 2 <= C_Index::InsertDelete::MaxSize
        Redistribute(baseblock, at, +(totalsize / 2));

        IndexAssert((totalsize / 2 <= left->FillSize() + IndexBlockEntry::MaxEntrySize) && (left->FillSize() <= totalsize / 2),
                "Average of 2 blocks did not rebalance properly (1)");
        IndexAssert(((totalsize+1) / 2 <= right->FillSize() + IndexBlockEntry::MaxEntrySize) && (right->FillSize() <= (totalsize+1) / 2),
                "Average of 2 blocks did not rebalance properly (1)");
        IndexAssert((C_Index::InsertDelete::MinSize <= left->FillSize()) && (left->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Average of 2 blocks did not rebalance properly (3)");
        IndexAssert((C_Index::InsertDelete::MinSize <= right->FillSize()) && (right->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Average of 2 blocks did not rebalance properly (4)");

        return true;
}

bool BtreeIndex::WriteSession::Average2WithLowerBound(IndexBlock &baseblock, IndexBlockIterator at)
// Border conditions tested, assertions hold.
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Average2WithLowerBound "/* << baseblock.blockno*/);
#endif

        // Lays lower bound after averaging at DBIndex_Block_MinData.
        IndexAssert(baseblock.IsContained(at) && !at->IsEOB(), "Special average of 2 blocks called with an invalid block element");
        IndexAssert(baseblock.FillSize() - at->GetEntryLength() <= C_Block::MaxData - IndexBlockEntry::MaxEntrySize, "Special average of 2 blocks called with a block that is too full");

        SmartBlockPtr left(filesession,  at[0].GetChildBlockId());
        SmartBlockPtr right(filesession, at[1].GetChildBlockId());

        unsigned totalsize = left->FillSize()
                        + at->GetEntryLength()
                        + right->FillSize();

        unsigned medianpoint = totalsize / 2;

        //WARNING: comparison between signed and unsigned integer expressions
        if (medianpoint < C_Index::InsertDelete::LowMinSize + IndexBlockEntry::MaxEntrySize
            || unsigned(totalsize - medianpoint) > C_Index::InsertDelete::MaxSize)
                return false;

        // Invariant: 2 * EOBSize <= totalsize -> (totalsize / 2 <= totalsize - EOBSize)
        // Invariant: totalsize - medianpoint == (totalsize + 1) / 2 <= C_Index::InsertDelete::MaxSize
        Redistribute(baseblock, at, +totalsize / 2);

        IndexAssert((totalsize / 2  <= left->FillSize() + IndexBlockEntry::MaxEntrySize) && (left->FillSize() <= totalsize / 2),
                "Special average of 2 blocks did not rebalance properly (1)");
        IndexAssert(((totalsize+1) / 2 <= right->FillSize() + IndexBlockEntry::MaxEntrySize) && (right->FillSize() <= (totalsize+1) / 2),
                "Special average of 2 blocks did not rebalance properly (2)");

        IndexAssert((C_Index::InsertDelete::LowMinSize <= left->FillSize()) && (left->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Special average of 2 blocks did not rebalance properly (3)");
        IndexAssert((C_Index::InsertDelete::LowMinSize <= right->FillSize()) && (right->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Special average of 2 blocks did not rebalance properly (4)");

        return true;
}

bool BtreeIndex::WriteSession::Average3(IndexBlock &baseblock, IndexBlockIterator at)
// Border conditions tested, assertions hold.
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Average3 "/* << baseblock.blockno*/);
#endif

        IndexAssert(!at->IsEOB() && !(at+1)->IsEOB(), "Average of 3 blocks called with an invalid block element");

        SmartBlockPtr left(filesession,  at[0].GetChildBlockId());
        SmartBlockPtr middle(filesession, at[1].GetChildBlockId());
        SmartBlockPtr right(filesession, at[2].GetChildBlockId());

        // Size requirements on parent block. No lower bound, parent can be superblock.
        IndexAssert(baseblock.FillSize() - at->GetEntryLength() - (at+1)->GetEntryLength() +
                2*IndexBlockEntry::MaxEntrySize <= C_Block::MaxData, "Average of 3 blocks called with a block that is too full");

        uint32_t totalsize =
                left->FillSize() + at->GetEntryLength() +
                middle->FillSize() + (at+1)->GetEntryLength() +
                right->FillSize();

        // Set medianpoint so that maximum size of middle is approx thesame as maximum size of left (and right)
        unsigned medianpoint = totalsize / 3;

        // Sizes after distributes:
        // new size of left: medianpoint - C_Entry::MaxSize .. medianpoint
        // new size of middle: totalsize - 2*medianpoint - 2*C_Entry::MaxSize .. totalsize - 2*medianpoint
        // new size of right: medianpoint - C_Entry::MaxSize .. medianpoint

        // Check all sizes for bounds
        if (
            (C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize > medianpoint) ||
            (medianpoint > C_Index::InsertDelete::MaxSize) ||
            (C_Index::InsertDelete::MinSize + 2*IndexBlockEntry::MaxEntrySize > unsigned(totalsize - 2*medianpoint)) ||
            (unsigned(totalsize - 2*medianpoint) > C_Index::InsertDelete::MaxSize))
                return false;

        // do swap. First treat smallest of left and right, to avoid overflow in middle
        if (left->FillSize() < right->FillSize())
        {
                Redistribute(baseblock, at, +(int)medianpoint);
                Redistribute(baseblock, at+1, -(int)medianpoint);
        }
        else
        {
                Redistribute(baseblock, at+1, -(int)medianpoint);
                Redistribute(baseblock, at, +(int)medianpoint);
        }

        IndexAssert((C_Index::InsertDelete::MinSize <= left->FillSize()) && (left->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Average of 3 blocks did not rebalance properly (1)");
        IndexAssert((C_Index::InsertDelete::MinSize <= middle->FillSize()) && (middle->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Average of 3 blocks did not rebalance properly (2)");
        IndexAssert((C_Index::InsertDelete::MinSize <= right->FillSize()) && (right->FillSize() <= C_Index::InsertDelete::MaxSize),
                "Average of 3 blocks did not rebalance properly (3)");

        return true;
}

void BtreeIndex::WriteSession::Splice2(IndexBlock &block, IndexBlockIterator at)
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Splice2 "/* << block.blockno*/);
#endif

        IndexAssert(block.IsContained(at) && !at->IsEOB(), "Split function called with an invalid block element");

        // Determine the point where the block will be spliced. Looks at a virtual block
        // that is comprised of the current block with the entry added.
        SmartBlockPtr left(filesession,  at[0].GetChildBlockId());
        SmartBlockPtr right(filesession, at[1].GetChildBlockId());

        unsigned totalsize = left->FillSize()
                        + at->GetEntryLength()
                        + right->FillSize();

        IndexAssert(totalsize >= 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize,
                "Split function called with blocks that are too small combined");
        IndexAssert(block.FillSize() + 2*IndexBlockEntry::MaxEntrySize - at->GetEntryLength() <= C_Block::MaxData,
                "Split function called with blocks that are too big combined");

        // Make sure right is not empty (splice would not be necessary in that case)
        IndexAssert(right->begin() != right->eob(), "Split function called with a empty block on the right");

        // Make first entry of right the parent of middle, let the EOB
        // of middle point to the old child of that entry
        SmartBlockPtr middle(filesession, filesession.AllocateBlock(admin->indexid, right->begin()->GetChildBlockId()));
        ++admin->statistics.totalblocks;
        block.InsertAtWithID(at+1, *right->begin(), middle.GetBlockId());
        right->DeleteAt(right->begin());

        // Use Average3 to distribute the entries
        bool retval = Average3(block,at);
        IndexAssert(retval, "Averaging 3 blocks failed in split function due to under- or overflow");
}

void BtreeIndex::WriteSession::Splice1(IndexBlock &baseblock, IndexBlockIterator at)
// Border conditions tested, assertions hold.
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Splice1 "/* << baseblock.blockno*/);
#endif

        // Determine the point where the block will be spliced. Looks at a virtual block
        // that is comprised of the current block with the entry added.
        IndexAssert(baseblock.IsContained(at), "Superblock split function called with an invalid block element");

        SmartBlockPtr right(filesession, at[0].GetChildBlockId());

        IndexAssert(right->FillSize() >= 2*C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize,
                "Superblock split function called with too small superblock");

        // Make first entry of right the parent of middle, set its childblockid
        // in the new EOB of left
        SmartBlockPtr left(filesession, filesession.AllocateBlock(admin->indexid, right->begin()->GetChildBlockId()));
        ++admin->statistics.totalblocks;
        baseblock.InsertAtWithID(at, *right->begin(), left.GetBlockId());
        right->DeleteAt(right->begin());

        // No overflow. MaxData < 2 * InsertDelete::MaxSize -> at->child->fillsize < 2 * InsertDelete::MaxSize
        // Use Average2WithLowerBound to distribute the entries
        bool retval = Average2WithLowerBound(baseblock,at);
        IndexAssert(retval, "Averaging 2 blocks failed in superblock split function due to under- or overflow");
}

void BtreeIndex::WriteSession::Recombine2(IndexBlock &baseblock, IndexBlockIterator at)
// Border conditions tested, assertions hold.
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Recombine2 "/* << baseblock.blockno*/);
#endif
        IndexAssert(baseblock.IsContained(at) && !at->IsEOB(), "Superblock recombine function called with an invalid block element");

        // Determine the point where the block will be spliced. Looks at a virtual block
        // that is comprised of the current block with the entry added.
        SmartBlockPtr left(filesession, at[0].GetChildBlockId());
        SmartBlockPtr right(filesession, at[1].GetChildBlockId());

        // Make sure we do not under- or overflow
        IndexAssert(left->FillSize() - IndexBlockEntry::EOBSize + at->GetEntryLength() + right->FillSize() <= C_Index::InsertDelete::MaxSize,
                "Superblock recombine function called with blocks that are too big combined");
        IndexAssert(baseblock.FillSize() - at->GetEntryLength() + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData,
                "Superblock recombine function called with with a superblock that is too big");

        // Move all entries from left into right (make sure only EOB is left in left)
        Redistribute(baseblock, at, IndexBlockEntry::EOBSize);

        // Move parent of left into right, with GetChildBlockId of the eob of left->
        right->InsertAtWithID(right->begin(), *at, left->eob()->GetChildBlockId());
        baseblock.DeleteAt(at);

        IndexAssert(right->FillSize() <= C_Index::InsertDelete::MaxSize,
                "Superblock recombine function resulted in a too big superblock");

        // Last, free the left block.
        filesession.FreeBlock(left.GetBlockId());
        --admin->statistics.totalblocks;
}

void BtreeIndex::WriteSession::Recombine3(IndexBlock &baseblock, IndexBlockIterator at)
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Recombine3 "/* << baseblock.blockno*/);
#endif
        IndexAssert(baseblock.IsContained(at) && !at->IsEOB() && !(at+1)->IsEOB(), "Recombination function called with an invalid block element");

        // Determine the point where the block will be spliced. Looks at a virtual block
        // that is comprised of the current block with the entry added.
        SmartBlockPtr left(filesession, at[0].GetChildBlockId());
        SmartBlockPtr middle(filesession, at[1].GetChildBlockId());
        SmartBlockPtr right(filesession, at[2].GetChildBlockId());

        // Size requirements on parent block
        IndexAssert(baseblock.FillSize() - at->GetEntryLength() - (at+1)->GetEntryLength() + 2*IndexBlockEntry::MaxEntrySize <= C_Block::MaxData,
                "Recombination function called with blocks that are too big combined (1)");

        uint32_t totalsize =
                left->FillSize() + at->GetEntryLength() +
                middle->FillSize() + (at+1)->GetEntryLength() +
                right->FillSize();

        // We can discard the EOB block in middle, because we are going to delete it
        uint32_t medianpoint = (totalsize - IndexBlockEntry::EOBSize) / 2;

        // Check for size bounds
        IndexAssert((totalsize - IndexBlockEntry::EOBSize - medianpoint) <= C_Index::InsertDelete::MaxSize,
                "Recombination function called with blocks that are too big combined (2)");
        IndexAssert(medianpoint >= C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize,
                "Recombination function called with blocks that are too small combined");

        // If middle is too small to fill left, move some from right
        unsigned leftparttotalsize = left->FillSize() + at->GetEntryLength() + middle->FillSize();
        if (leftparttotalsize + IndexBlockEntry::EOBSize < medianpoint)
        {
                // The solution here is expensive. But, because now the guarantee is given
                // that when 3 child-blocks exist they are filled more than C_Block::MaxData / 2
                // left->FillSize() + middle->FillSize() > C_Index::InsertDelete::MaxSize. So,
                // this condition SHOULD never occur. It is, however, not severe enough to cause corruption.
                Redistribute(baseblock, at+1, std::min<unsigned>(totalsize - 2*IndexBlockEntry::EOBSize, C_Block::MaxData));
        }

        // Fill left
        Redistribute(baseblock, at, medianpoint);
        // Fill right
        Redistribute(baseblock, at+1, IndexBlockEntry::EOBSize);

        // Kill middle, move it's parent to right, and kill that parent
        right->InsertAtWithID(right->begin(), *(at+1), middle->eob()->GetChildBlockId());
        baseblock.DeleteAt(at+1);

        // Last, free the middle block.
        filesession.FreeBlock(middle.GetBlockId());
        --admin->statistics.totalblocks;
}

void BtreeIndex::WriteSession::CheckTreeRoot()
{
        SmartBlockPtr superblock (filesession, admin->superblockno);

        // Superblock is not empty.
        if (superblock->begin()+1 == superblock->eob())
        {
                // Only 2 entries in superblock-> Check both the childblocks (if they do not exist, all is ok)
                if (admin->treedepth != 1)
                {
                        SmartBlockPtr left(filesession,  superblock->begin()[0].GetChildBlockId());
                        SmartBlockPtr right(filesession, superblock->begin()[1].GetChildBlockId());

                        // Check if left or right suffers from possible underflow
                        //WARNING: comparison between signed and unsigned integer expressions
                        if ((left->FillSize() < C_Index::InsertDelete::LowMinSize) || (right->FillSize() < C_Index::InsertDelete::LowMinSize))
                        {
                                // Inv: left->FillSize() < C_Index::InsertDelete::LowMinSize || right->FillSize() < C_Index::InsertDelete::LowMinSize
                                // Inv: base.FillSize() <= IndexBlockEntry::MaxEntrySize + IndexBlockEntry::EOBSize


                                if (!Average2WithLowerBound(*superblock,superblock->begin()))
                                {
                                        // Underflow will happen. Recombine the blocks
                                        // Overflow not possible, due to invariants.
                                        Recombine2(*superblock,superblock->begin());

                                        // Superblock now only has one child-> Kill the superblock, make
                                        // the child the new superblock
                                        admin->superblockno = superblock->begin()->GetChildBlockId();
                                        --admin->treedepth;
                                        filesession.FreeBlock(superblock.GetBlockId());
                                        --admin->statistics.totalblocks;
                                }
                                // Inv: left->fs, right->fs >= LowMinSize
                        }
                        else if ((left->FillSize() > C_Index::InsertDelete::MaxSize) || (right->FillSize() > C_Index::InsertDelete::MaxSize))
                        {
                                // Inv: left->FillSize() > C_Index::InsertDelete::MaxSize || right->FillSize() > C_Index::InsertDelete::MaxSize
                                // Inv: left->FillSize() >= 2*IndexBlockEntry::HeaderSize + IndexBlockEntry::EOBSize
                                // Inv: right->FillSize() >= 2*IndexBlockEntry::HeaderSize + IndexBlockEntry::EOBSize

                                // If we can't average (due to overflow), split the blocks.
                                if (!Average2WithLowerBound(*superblock,superblock->begin()))
                                {
                                        // Average2WithLowerBound failed due to overflow
                                        // Inv: totalsize >= 2*(C_Index::InsertDelete::MaxSize)

                                        // Splice2 may NOT fail
                                        Splice2(*superblock,superblock->begin());
                                }
                        }
                        // Invariant: superblock->FillSize() <= MaxSize
                }
        }
        else
        {
                if (superblock->FillSize() > C_Index::InsertDelete::MaxSize)
                {
                        // Build new superblock below old superblock-> Make superblock the only
                        // child of the new superblock->
                        SmartBlockPtr newsuperblock(filesession, filesession.AllocateBlock(admin->indexid, superblock.GetBlockId()));
                        ++admin->statistics.totalblocks;
                        admin->superblockno = newsuperblock.GetBlockId();
                        ++admin->treedepth;

                        // Inv: childblock.FillSize() > C_Index::InsertDelete::MaxSize
                        // Splice1 may not fail.

                        // Now splice the old superblock
                        Splice1(*newsuperblock,newsuperblock->begin());
                }
        }
}

bool BtreeIndex::WriteSession::CheckChildSize(IndexBlock &baseblock, IndexBlockIterator &at)
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("CheckChildSize "/* << baseblock.blockno*/);
#endif
        // Post: returns true if child met requirements, false if not. In that case. at is moved back
        // to first entry whose childblock was messed with.

        SmartBlockPtr child(filesession, at->GetChildBlockId());
        // Check if child matches size requirements. If so, exit.
        if ((child->FillSize() <= C_Index::InsertDelete::MaxSize) && (child->FillSize() >= C_Index::InsertDelete::MinSize))
                return true;

        // If base has only 2 entries (last one a EOB), it is a superblock, check of children already done by CheckSuperBlock
        if (baseblock.begin()+1 == baseblock.eob())
                return true;

        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize
        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize
        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize
        // Inv: child->FillSize() >= MinBlockFill
        // Inv: child->FillSize() <= MaxBlockFill
        // Inv: nr of entries in child > 2

        // We can't do an assertion on the lower bound, because we don't know if this is a superblock (no lower bound)
        // (or maybe one of 2 children of a superblock, with lower bound C_Index::InsertDelete::LowMinSize)
        assert(baseblock.FillSize() <= C_Index::InsertDelete::MaxSize);

        bool leftneigbourexists = at != baseblock.begin();
        bool rightneigbourexists = at != baseblock.eob();

        // There must be one neighbour!
        IndexAssert(rightneigbourexists || leftneigbourexists, "A non-leaf block with only one child encountered");

        // Check if averaging with a neighbour does the trick
        if (leftneigbourexists)
        {
                IndexBlockIterator to_average = at-1;
                if (Average2(baseblock,to_average))
                {
                        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize
                        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxDataSize
                        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxDataSize

                        // Inv: C_Index::InsertDelete::MinSize <= new_left->FillSize() <= C_Index::InsertDelete::MaxSize
                        // Inv: C_Index::InsertDelete::MinSize <= new_right->FillSize() <= C_Index::InsertDelete::MaxSize

                        at=to_average;
                        return false;
                }
        }
        if (rightneigbourexists)
        {
                if (Average2(baseblock,at))
                {
                        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize
                        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxDataSize
                        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxDataSize

                        // Inv: C_Index::InsertDelete::MinSize <= new_left->FillSize() <= C_Index::InsertDelete::MaxSize
                        // Inv: C_Index::InsertDelete::MinSize <= new_right->FillSize() <= C_Index::InsertDelete::MaxSize
                        return false;
                }
        }

        if (child->FillSize() > C_Index::InsertDelete::MaxSize)
        {
                // Child is too big, split with an existing neighbour. Prefer the right one
                if (!rightneigbourexists)
                    --at;


                // totalsize = at->FillSize() + at.GetEntryLength() + (at+1)->FillSize()

                // Inv: child->FillSize() > C_Index::InsertDelete::MaxSize
                // Inv:
                //      totalsize > 2*(C_Index::InsertDelete::MaxSize)


                Splice2(baseblock,at);
                // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize
                // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxEntryData
                //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxEntryData

                // Inv: C_Index::InsertDelete::MinSize
                //              <= left->FillSize(), right->FillSize(), middle->FillSize()
                //                      <= C_Index::InsertDelete::MaxSize
        }
        else
        {
                // Inv: nr of entries in base >= 3
                // C_Index::MinBlockFill <= child->FillSize() < C_Index::InsertDelete::MinSize)
                // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize


                // Child is too small. Are we at an edge? if so, move iterator inward.
                if (!rightneigbourexists)
                        --at;
                if (!leftneigbourexists)
                        ++at;
                // Move iterator 1 to the left to get middle childblock in next entry.
                --at;

                // Inv: totalsize = at->FillSize() + at->GetEntryLength() + (at+1)->FillSize() + (at+1)->GetEntryLength() + (at+2)->FillSize()

                // Inv: totalsize <= 2*(C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize) + C_Block::MaxData
                // Inv: totalsize >= 3*C_Index::MinBlockFill


                if (Average3(baseblock,at))
                {
                        // Inv: C_Index::InsertDelete::MinSize
                        //              <= left->FillSize(), right->FillSize(), middle->FillSize()
                        //                      <= C_Index::InsertDelete::MaxSize

                        // Inv: C_Index::InsertDelete::MinSize
                        //              <= left->FillSize(), middle->FillSize(), right->FillSize()
                        //                      <= C_Index::InsertDelete::MaxSize

                        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + 2*IndexBlockEntry::MaxDataSize
                        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - 2*IndexBlockEntry::MaxDataSize
                        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - 2*IndexBlockEntry::MaxDataSize
                }
                else
                {
                        // Average3 has failed due to underflow
                        //
                        // Inv: 3*C_Index::MinBlockFill <= totalsize <= 3* C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize

                        // recombine3 may not fail now

                        Recombine3(baseblock,at);

                        // Inv: C_Index::InsertDelete::MinSize
                        //              <= left->FillSize(), right->FillSize()
                        //                      <= C_Index::InsertDelete::MaxSize

                        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize - IndexBlockEntry::HeaderSize
                        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize
                        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize
                }

        }

        // Invariants:

        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize
        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize
        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize - IndexBlockEntry::HeaderSize
        // Inv: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + 2*IndexBlockEntry::MaxDataSize

        // worst: baseblock.FillSize() <= C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize

        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxDataSize
        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxDataSize
        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxEntryData
        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxEntryData
        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - 2*IndexBlockEntry::MaxDataSize
        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - 2*IndexBlockEntry::MaxDataSize
        // Inv: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize
        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize

        // worst: baseblock == superblock || baseblock=2sb-child && baseblock.FillSize() >= C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize
        //              || baseblock.FillSize() >= C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize

        // For every block X that contains an entry that was original in the childblock or at (or was entry pointed to by at),
        // the following invariant holds:

        // Inv: ((base is a superblock & has 2 children && (C_Index::InsertDelete::LowMinSize <= X.FillSize() <= C_Index::InsertDelete::MaxSize)) ||
        //              C_Index::InsertDelete::MinSize <= X.FillSize() <= C_Index::InsertDelete::MaxSize

        // A delete that happens replaces an element in base cannot make one of these invariants fail (because the invariants are worst-case).
        // Only in leaves can inserts and deletes overflow bounds. No meddling by a redistribution function has been done, due to the fact that these are leaves

        return false;
}

//////////////////////////////////////////////////////////////////////////////
//
//  BtreeIndex::IndexIterator
//

BtreeIndex::IndexIterator::IndexIterator(const BtreeIndex::Admin &_admin, DBIndexFileSystem::Session &_session, bool atend) :
        admin(_admin), stack(admin, _session)
{
        if (atend)
                MoveToEnd();
        else
                MoveToBegin();
}
                              /*
BtreeIndex::IndexIterator::IndexIterator(const BtreeIndex::Admin &_admin, const Stack &_stack)
: admin(_admin), stack(_stack)
{
}
                                */
void BtreeIndex::IndexIterator::MoveToBegin()
{
        if (stack.size() == 0)
                stack.followchild();
        else
                while (stack.size() > 1)
                        stack.pop();
        stack.top().current = stack.top().blockptr->begin();
        while (stack.size() != admin.treedepth)
                stack.followchild();
}

void BtreeIndex::IndexIterator::MoveToEnd()
{
        if (stack.size() == 0)
                stack.followchild();
        else
                while (stack.size() > 1)
                        stack.pop();
        stack.top().current = stack.top().blockptr->eob();
}

BtreeIndex::IndexIterator& BtreeIndex::IndexIterator::operator ++()
{
        // Current entry's type is end of block means we are at end(), so no ++, please.
        assert(!stack.top().current->IsEOB());

        // Go to next entry in current block
        ++stack.top().current;

        // Does this entry have a childblock? Then follow childblocks
        // until at a leave.
        while (stack.size() != admin.treedepth)
                stack.followchild();

        // Are we at an eob? If so, go back to lower level until we are not. Stop at
        // eob in superblock->
        while (stack.size() > 1 && stack.top().current->IsEOB())
//        while (stack.size() > 1 && stack.top().blockptr->eob() == stack.top().current)
                stack.pop();

        return *this;
}
/*
BtreeIndex::IndexIterator BtreeIndex::IndexIterator::operator ++(int) //post-increment
{
        IndexIterator temp(*this);
        ++*this;
        return temp;
}
  */
BtreeIndex::IndexIterator& BtreeIndex::IndexIterator::operator --()
{
        while (stack.size() != admin.treedepth)
        {
                stack.followchild();
                stack.top().current = stack.top().blockptr->eob();
        }
        while ((stack.size() > 0) && (*stack.top().current == *stack.top().blockptr->begin()))
                stack.pop();

        // No -- while at begin(), please.
        assert(stack.size() != 0);

        --stack.top().current;
        return *this;
}   /*
BtreeIndex::IndexIterator BtreeIndex::IndexIterator::operator --(int) //post-increment
{
        IndexIterator temp(*this);
        --*this;
        return temp;
}
      */
int32_t BtreeIndex::IndexIterator::CompareTo(const IndexIterator& rhs) const
{
        // Iterators use case-insensitive ordering of db to determine their relative position
        return stack.top().current->CompareToEntry(*rhs.stack.top().current);
}

//////////////////////////////////////////////////////////////////////////////
//
//  BtreeIndex::OfflineIterator
//

//////////////////////////////////////////////////////////////////////////////
//
//  BtreeIndex::OnlineIterator
//
BtreeIndex::OnlineIterator::OnlineIterator(Query::OnlineRef &_query, IndexBlockEntry const &position)
: query(_query)
{
//        iterator.reset(new IndexIterator(query.session.begin()));
        iterator.reset(new IndexIterator(*query.session.admin, query.session.filesession, false));
        iterator->MoveToFirstBiggerOrEqual(position);
}

//////////////////////////////////////////////////////////////////////////////
//
//  BtreeIndex::Query
//

BtreeIndex::Query::Query(BtreeIndex &_index)
: index(_index)
, statistics(BtreeIndex::ReadSession(index).admin->statistics)
{
}

void BtreeIndex::Query::ConstructLikeQuery(
        IndexBlockEntryContainer &first_entry,
        IndexBlockEntryContainer &limit_entry,
        uint8_t const *searchdata,
        unsigned searchlen)
{
        // Determine the prefix length
        searchlen = std::min<unsigned>(searchlen, IndexBlockEntry::MaxDataSize);
        for (unsigned idx = 0; idx < searchlen; ++idx)
            if (searchdata[idx] == (uint8_t)'?' || searchdata[idx] == (uint8_t)'*')
            {
                    searchlen = idx;
                    break;
            }
        // No prefix: return all (not very efficient though, shouldn't have sent this to the index)
        if (searchlen == 0)
        {
                first_entry.ConstructNULLEntry(0/*LimitLowestRecordId*/);
                limit_entry.ConstructEOBEntry();
        }
        else
        {
                // Construct the data of the first entry after the prefix
                uint8_t limitdata[IndexBlockEntry::MaxDataSize];
                memcpy(limitdata, searchdata, searchlen);
                ++limitdata[searchlen-1];
                first_entry.ConstructDataEntry(searchdata, searchlen, 0/*LimitLowestRecordId*/);
                limit_entry.ConstructDataEntry(limitdata, searchlen, 0/*LimitLowestRecordId*/);
        }
}


void BtreeIndex::Query::ResetNewQuery(IndexBlockEntry const &start, IndexBlockEntry const &end)
{
        current_begin = start;
        current_end = end;

#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("QUERYRESULT " << std::endl << "start (" << start << "), limit (" << end << ")" << std::endl);
        // << first (" << *cachedbegin->indexiterator << "), last (" << *cachedend->indexiterator << ")");
#endif
}

//////////////////////////////////////////////////////////////////////////////
//
//  BtreeIndex::Query::OnlineRef
//

BtreeIndex::Query::OnlineRef::OnlineRef(Query &_query)
: query(_query)
, session(query.index)
{
}

//////////////////////////////////////////////////////////////////////////////
//
//  DBIndexFileSystem
//

DBIndexFileSystem::DBIndexFileSystem(std::string const &filename, Blex::Stream *metadatafile, bool new_database, bool sync)
{
        assert(Blex::BitmapRequiredSize(C_Indexfile::BlocksPerSection) == sizeof(DBIndexFileSystem::FSData::Cluster::FreeBlocks)/sizeof(Blex::BitmapType));

        unsigned tocache = C_Indexfile::SectionsCached;
        if (sync && !Blex::GetEnvironVariable("WEBHARE_DB_CACHEALLSECTIONS").empty())
        {
                // Only adjust cache when syncing (in DB, not complexfs)
                tocache = 16384ULL * 1024 * 1024 * 1024 / C_Indexfile::SectionSize; // 16GB
                DEBUGPRINT("Caching 16GB of index file");
        }

        sectionfile.reset(Blex::SectionFile::Open(C_Indexfile::SectionSize, filename, tocache, AllowSharedSections, new_database, false, sync));
        if (!sectionfile.get())
//            throw Exception(ErrorIO,"Cannot open index file");
            throw IndexException("Cannot open index file");


        if (!AllowSharedSections)
            Blex::ErrStream() << "Warning! IndexFS: Shared sections disabled, expect VM usage increase";

        DEBUGONLY(fsdata.SetupDebugging("Indexfilesystem admistration"));

        LockedFSData::WriteRef fslock(fsdata);
        if (metadatafile)
        {
                //Process a block list from the metadata file
                if (metadatafile->ReadLsb<uint32_t>() != FSMagic
                    || metadatafile->ReadLsb<uint32_t>() != FSVersion)
                {
//                        throw Exception(ErrorIO,"Filesystem metadata does not match expected version");
                        throw IndexException("Index filesystem metadata does not match expected version");
                }

                //Parse the blocklist from the config file
                fslock->ReadBlocklist(*metadatafile);

                //Verify that we got all the data we wanted
                if (metadatafile->ReadLsb<uint32_t>() != FSMagic)
//                    throw Exception(ErrorIO,"Filesystem metadata terminator does not match expected version");
                    throw IndexException("Index filesystem metadata terminator does not match expected version");
        }
        if (fslock->clusters.size() > sectionfile->GetNumSections()) //we expected more data than we have..
            throw IndexException("Index data file is truncated");

        if (fslock->clusters.size() < sectionfile->GetNumSections())
                fslock->clusters.resize(sectionfile->GetNumSections()); //we never updated for the alloactions

#ifdef EXTENSIVE_DEBUGMESSAGES
//        DEBUGPRINT("Loaded block-freelist " << fslock->blocklist);
#endif
}

DBIndexFileSystem::~DBIndexFileSystem() throw()
{
}

void DBIndexFileSystem::FlushFile()
{
        if (!sectionfile->FlushAll())
             throw IndexException("Unable to flush index file");
}
/** Parse the blocklist from a config file */
void DBIndexFileSystem::FSData::ReadBlocklist(Blex::Stream &indata)
{
        // Read number of blocks
        clusters.resize(indata.ReadLsb<uint32_t>());

        for(unsigned i=0;i<clusters.size();++i)
        {
                clusters[i].indexid = indata.ReadLsb<uint32_t>();
                //ADDME if we ever create more than 2^31 indexes, we're done for. will we ever hit that limit?
                highestindex = std::max(highestindex, clusters[i].indexid);

                unsigned bitptr=0;
                for (unsigned j = 0; j < C_Indexfile::BlocksPerSection / 32; ++j)
                {
                        uint32_t data = indata.ReadLsb<uint32_t>();
                        for (unsigned b=0;b<32;++b)
                            Blex::SetBit(clusters[i].freeblocks, bitptr++, data&(1<<b));
                }
        }
}

/** Write the blocklist to a config file */
void DBIndexFileSystem::FSData::WriteBlocklist(Blex::Stream &outdata)
{
        // Save number of blocks in free-array
        outdata.WriteLsb<uint32_t>(clusters.size());

        for(unsigned i=0;i<clusters.size();++i)
        {
                outdata.WriteLsb<uint32_t>(clusters[i].indexid);
                unsigned bitptr=0;
                for (unsigned j = 0; j < C_Indexfile::BlocksPerSection / 32; ++j)
                {
                        uint32_t data = 0;
                        for (unsigned b=0;b<32;++b)
                        {
                                if(Blex::GetBit(clusters[i].freeblocks, bitptr++))
                                    data|=(1<<b);
                        }
                        outdata.WriteLsb(data);
                }
        }
}

void DBIndexFileSystem::SaveFSState(Blex::Stream &metadatafile)
{
        LockedFSData::WriteRef fslock(fsdata);

        metadatafile.WriteLsb<uint32_t>(FSMagic);
        metadatafile.WriteLsb<uint32_t>(FSVersion);
        fslock->WriteBlocklist(metadatafile);
        metadatafile.WriteLsb<uint32_t>(FSMagic); //terminator

#ifdef EXTENSIVE_DEBUGMESSAGES
//        DEBUGPRINT("Writing block-freelist " << config.current.filesystem.blocklist);
#endif
}

bool DBIndexFileSystem::SetModificationDate(Blex::DateTime newtime)
{
        return sectionfile->SetModificationDate(newtime);
}

void DBIndexFileSystem::GenerationalCleanupUnusedSections(volatile uint32_t *abortflag)
{
        sectionfile->GenerationalCleanupUnusedSections(abortflag);
}


//////////////////////////////////////////////////////////////////////////////
//
//  DBIndexFileSystem::Session
//

DBIndexFileSystem::Session::Session(DBIndexFileSystem &_filesystem)
  : filesystem(_filesystem)
{
}

DBIndexFileSystem::Session::~Session()
{
}

uint8_t* DBIndexFileSystem::Session::LockBlock(BlockId blockno)
{

        // Calculate sectionnumber, and offset within section
        uint32_t sectionnumber = blockno / C_Indexfile::BlocksPerSection;
        uint32_t blockoffset = (blockno % C_Indexfile::BlocksPerSection) * C_Block::Size;

        // Lock section
        uint8_t* sectionaddress = filesystem.sectionfile->LockSection(sectionnumber);

//        DEBUGPRINT("IndexFS: Locking section " << sectionnumber << " as address " << std::hex << (int)sectionaddress << std::dec);

        // Add block offset, return address
        return sectionaddress + blockoffset;
}

void DBIndexFileSystem::Session::UnlockBlock(BlockId blockno, uint8_t const *blockaddress, bool written)
{
        // Calculate sectionnumber, and unlock the section
        uint32_t sectionnumber = blockno / C_Indexfile::BlocksPerSection;
        uint32_t blockoffset = (blockno % C_Indexfile::BlocksPerSection) * C_Block::Size;
#ifndef IGNORE_DIRTY_MARKINGS
        if (written)
            filesystem.sectionfile->MarkSectionDirty(sectionnumber);
#endif
//        DEBUGPRINT("IndexFS: Releasing section " << sectionnumber << " as address " << std::hex << (int)(blockaddress-blockoffset) << std::dec);
        filesystem.sectionfile->UnlockSection(sectionnumber, blockaddress-blockoffset);
}

//////////////////////////////////////////////////////////////////////////////
//
//  DBIndexFileSystem::ReadSession
//

DBIndexFileSystem::ReadSession::ReadSession(DBIndexFileSystem &_filesystem)
: Session(_filesystem)
{
}

//////////////////////////////////////////////////////////////////////////////
//
//  DBIndexFileSystem::ReadWriteSession
//

DBIndexFileSystem::ReadWriteSession::ReadWriteSession(DBIndexFileSystem &_filesystem)
  : Session(_filesystem)
{
}

DBIndexFileSystem::ReadWriteSession::~ReadWriteSession()
{
}

unsigned DBIndexFileSystem::GetFreeIndexId() //simplified because of performance issues on this function..
{
        LockedFSData::WriteRef fslock(fsdata);
        if(++fslock->highestindex==0) //we wrapped!
        {
                Blex::ErrStream() << "Indexid wraparound detected";
                Blex::FatalAbort(); //too bad. unlikely to happen before WHDB end-of-life, i assume? (ADDME)
        }
        return fslock->highestindex;
}

unsigned DBIndexFileSystem::GetIndexId(BlockId block)
{
        LockedFSData::WriteRef fslock(fsdata);
        return fslock->clusters[FSData::GetClusterForBlock(block)].indexid;
}

BlockId DBIndexFileSystem::ReadWriteSession::AllocateBlock(unsigned indexid, BlockId childblockid)
{
        LockedFSData::WriteRef fslock(filesystem.fsdata);

        //Get the indexid (depends on childblock) and find an available cluster and block to store it
        unsigned trycluster, freeblock = C_Indexfile::BlocksPerSection;

        //Does any of the available clusters have space
        for (trycluster=0;trycluster<fslock->clusters.size();++trycluster)
        {
                FSData::Cluster &cluster = fslock->clusters[trycluster];

                if (cluster.indexid == indexid)
                {
                        freeblock = Blex::FindFirstSetBit(cluster.freeblocks, 0, C_Indexfile::BlocksPerSection);

                        if(freeblock<C_Indexfile::BlocksPerSection)//found one
                            break;
                }
        }

        // If no cluster beloning to this index found, find an empty cluster
        if (trycluster == fslock->clusters.size())
        {
                for (trycluster=0;trycluster<fslock->clusters.size();++trycluster)
                {
                        FSData::Cluster &cluster = fslock->clusters[trycluster];

                        if (cluster.indexid == 0)
                        {
                                freeblock = 0;
                                break;
                        }
                }
        }

        // Still no free block? Then append some to the index file
        if (trycluster == fslock->clusters.size())
        {
                //The file has to expand
                if (!filesystem.sectionfile->TryAppendSectionPage()) // Only thread-safe when serialized !!
//                    throw Exception(ErrorIO,"Cannot open a write session: cannot extend index file");
                    throw IndexException("Cannot open a write session: cannot extend index file");

                fslock->clusters.resize(fslock->clusters.size()+1);
                fslock->clusters.back().indexid=indexid;
                freeblock=0;
        }

        //Mark the block as used
        fslock->clusters[trycluster].indexid = indexid;
        Blex::SetBit(fslock->clusters[trycluster].freeblocks, freeblock, false);

        BlockId newblock = FSData::CalcBlockId(trycluster, freeblock);

        //ADDME: a bit stupid, because we will unlock at return, andn the caller will relock it immediately anyway
        SmartBlockPtr appended_block(*this, newblock);
        appended_block->ConstructEmptyBlock(childblockid);

        // Return number
        return newblock;
}

void DBIndexFileSystem::ReadWriteSession::FreeBlock(BlockId blockno)
{
        LockedFSData::WriteRef fslock(filesystem.fsdata);

        unsigned cluster = FSData::GetClusterForBlock(blockno);
        unsigned subblock = FSData::GetBlockInsideCluster(blockno);
        assert(Blex::GetBit(fslock->clusters[cluster].freeblocks,subblock)==false);

        Blex::SetBit(fslock->clusters[cluster].freeblocks, subblock, true); //mark as free

        bool any_used_block=false;
        for (unsigned i=0;i < C_Indexfile::BlocksPerSection; ++i)
            if (Blex::GetBit(fslock->clusters[cluster].freeblocks, i) == false) //not free
            {
                 any_used_block=true;
                 break;
            }

        if (!any_used_block)
            fslock->clusters[cluster].indexid=0; //mark as free!
}


//////////////////////////////////////////////////////////////////////////////
//
//  SmartBlockPtr
//

SmartBlockPtr::SmartBlockPtr(DBIndexFileSystem::Session &_session, BlockId _blockid)
: session(_session)
, blockid(_blockid)
, lockedblock(session.LockBlock(blockid))
{
}

SmartBlockPtr::SmartBlockPtr(SmartBlockPtr const &src)
: session(src.session)
, blockid(src.blockid)
, lockedblock(session.LockBlock(blockid))
{
}

SmartBlockPtr::~SmartBlockPtr()
{
        session.UnlockBlock(blockid, lockedblock.blockdataptr, lockedblock.IsDirty());
}

SmartBlockPtr& SmartBlockPtr::operator=(SmartBlockPtr const &src)
{
        assert(&session == &src.session);
        session.UnlockBlock(blockid, lockedblock.blockdataptr, lockedblock.IsDirty());
        blockid=src.blockid;
        lockedblock=IndexBlock(session.LockBlock(blockid));
        return *this;
}


} // end of namespace Index

} // end of namespace Blex
