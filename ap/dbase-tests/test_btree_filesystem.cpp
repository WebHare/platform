//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>


#include <stack>
#include <blex/testing.h>
#include <blex/path.h>
#include <blex/btree_filesystem.h>

using namespace Blex::Index;

//////////////////////////////////////////////////////////////////////////////
//
// Index consistency tests. We move them here, to trim the size of the true
// code files (although this one is still too huge as well :-( ) but they still
// need to be compiled as part of the database server preparation tests
//

/* When an Average2 has failed, due to overflow, a splice2 MUST succeed.
   Failure of Average2 due to overflow: totalsize > 2*C_Index::InsertDelete::MaxSize
   splice2: totalsize >= 3*C_Block::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize */
static_assert(2*C_Index::InsertDelete::MaxSize >= 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize, "test failure");

/* LowMinSize may not be smaller than 2 entries and an EOB (after CheckChildSizeModification and delete of entry of maximum size),
   or else the invariant that every block except the superblock has 3 entries can be violated. */
static_assert(C_Index::InsertDelete::LowMinSize >=
        3*IndexBlockEntry::MaxEntrySize
        + C_Index::InsertDelete::CheckChildSizeMaxModificationSize
        + IndexBlockEntry::EOBSize, "test failure");

/* LowMinSize may not be so big that a block of size LowMinSize, one of size LowMinSize + MaxEntrySize +
   an entry of MaxEntrySize is bigger than C_Index::InsertDelete::MaxSize (After average 2 fails on underflow,
   an recombine2 MUST succeed)
   Also, it may not be bigger than C_Index::InsertDelete::MaxSize / 2 - DBIndexEntry2::MaxEntrySize. (after
   a superblock overflows, a splice1 MUST succeed */
static_assert(2*C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize <= C_Index::InsertDelete::MaxSize, "test failure");
static_assert(C_Index::InsertDelete::LowMinSize <= C_Index::InsertDelete::MaxSize / 2 - IndexBlockEntry::MaxEntrySize, "test failure");

// Following checks are moved here from CheckTreeRoot()
// No overflow in Average2WithLowerBound!
static_assert(C_Index::InsertDelete::LowMinSize + C_Block::MaxData <= 2* C_Index::InsertDelete::MaxSize - IndexBlockEntry::MaxEntrySize, "test failure");
// Inv: totalsize <= 2*C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize
static_assert(2*C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize - IndexBlockEntry::EOBSize <= C_Index::InsertDelete::MaxSize, "test failure");
// Average2WithLowerBound may not fail due to underflow
static_assert(C_Index::InsertDelete::MaxSize + 2*IndexBlockEntry::HeaderSize + IndexBlockEntry::EOBSize >= 2*C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize, "test failure");
static_assert(2*C_Index::InsertDelete::MaxSize >= 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize, "test failure");
static_assert(C_Index::InsertDelete::MaxSize >= 2*C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize, "test failure");

// Following checks are moved here from CheckChildSize()
// Average2 may NOT have failed due to underflow
static_assert(C_Index::MinBlockFill + C_Index::InsertDelete::MaxSize >= 2*(C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize), "test failure");
// fillsize of child and at+1 combined must be enough to fill 3 blocks with C_Index::InsertDelete::MinSize.
static_assert(2*C_Index::InsertDelete::MaxSize >= 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize, "test failure");
// Only action that can modify a parent is delete. However, a delete cannot increase or decrease the fillsize further than the worstcases set here.
static_assert(C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData, "test failure");
static_assert(C_Index::InsertDelete::MinSize + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxDataSize >= C_Index::MinBlockFill, "test failure");
// Average2 may NOT have failed due to overflow
static_assert(C_Index::MinBlockFill + C_Block::MaxData <= 2*C_Index::InsertDelete::MaxSize, "test failure");
// Asserts in average3 may not fail due to overflow
static_assert(2*(C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize) + C_Block::MaxData <= 3* C_Index::InsertDelete::MaxSize, "test failure"); // overflow
static_assert(3* C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize <= 2*C_Index::InsertDelete::MaxSize, "test failure"); // no overflow
static_assert(3*C_Index::MinBlockFill >= 2*C_Index::InsertDelete::MinSize + 2*IndexBlockEntry::MaxEntrySize, "test failure"); // no underflow
static_assert(C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize >= 2*IndexBlockEntry::MaxEntrySize + IndexBlockEntry::EOBSize, "test failure"); // always 3+ children in a non-superblock!!!
static_assert(C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize >= C_Index::MinBlockFill, "test failure");
static_assert(C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData, "test failure");
static_assert(C_Index::InsertDelete::MinSize - IndexBlockEntry::MaxEntrySize >= C_Index::MinBlockFill, "test failure");
static_assert(C_Index::InsertDelete::LowMinSize - IndexBlockEntry::MaxEntrySize >= 2*IndexBlockEntry::MaxEntrySize + IndexBlockEntry::EOBSize, "test failure"); // always 3+ children in a non-superblock!!!
static_assert(C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData, "test failure");

//////////////////////////////////////////////////////////////////////////////
//
// True filesystem test code, and a lot of associated mess, starts yhere
//

typedef std::vector<Blex::Index::IndexBlockEntryContainer> ContainerList;

// RawTreeIterator - instantiate with base block. All childblockid's in leaves MUST be BockID(-1)!
class RawTreeIterator
{
    private:
        struct Elt
        {
                SmartBlockPtr blockptr;
                IndexBlock::iterator it;
                Elt(DBIndexFileSystem::Session &session, int32_t blockid)
                : blockptr(session,blockid)
                , it(blockptr->begin()) { }
                bool operator ==(const Elt& rhs) const { return blockptr.GetBlockId()==rhs.blockptr.GetBlockId() && it == rhs.it; }
        };
        std::stack<Elt> stack;
        DBIndexFileSystem::Session &session;
        RawTreeIterator(DBIndexFileSystem::Session &session) : session(session) { }
    public:
        void DeeperDowner()
        {
                while (stack.top().it->GetChildBlockId() != BlockId(-1))
                    stack.push(Elt(session, stack.top().it->GetChildBlockId()));
                while (stack.size() > 0 && stack.top().it == stack.top().blockptr->eob())
                    stack.pop();
        };
        static RawTreeIterator GetBegin(DBIndexFileSystem::Session &session, int32_t blockid)
        {
                RawTreeIterator iterator(session);
                iterator.stack.push(Elt(session, blockid));
                iterator.DeeperDowner();
                return iterator;
        };
        static RawTreeIterator GetEnd(DBIndexFileSystem::Session &session)
        {
                RawTreeIterator iterator(session);
                return iterator;
        };
        bool operator==(const RawTreeIterator& rhs) { return stack == rhs.stack; }
        bool operator!=(const RawTreeIterator& rhs) { return !(*this == rhs); }
        const IndexBlockEntry& operator*() { return *stack.top().it; }
        RawTreeIterator& operator++()
        {
                ++stack.top().it;
                DeeperDowner();
                return *this;
        }
        unsigned Level() { return stack.size(); }
};

bool equal(DBIndexFileSystem::Session &session, int32_t blockid, ContainerList const &list)
{
        const IndexBlockEntryContainer* listit = &list[0];
        const IndexBlockEntryContainer* listend = &list[0] + list.size();
        RawTreeIterator it = RawTreeIterator::GetBegin(session, blockid);
        RawTreeIterator end = RawTreeIterator::GetEnd(session);
        while (it != end && listit != listend)
        {
                if (*it != *listit)
                    return false;
                ++listit;
                ++it;
        }
        return (it == end) && (listit == listend);
}
void FillBlock(IndexBlock& block, signed firstlen, signed lastlen, signed totallen, signed idstart, bool bigentries = true)
{
        assert(totallen <= C_Block::MaxData && (totallen == IndexBlockEntry::EOBSize || totallen >= IndexBlockEntry::EOBSize + IndexBlockEntry::HeaderSize));
        // Fills block base with entries until exact length of totallen (when possible)
        std::string s(64, '_');
        const uint8_t* text = reinterpret_cast<const uint8_t*>(&s[0]);
        IndexBlockEntryContainer thing;

        signed oldtotallen = totallen;
        totallen -= IndexBlockEntry::EOBSize;
        block.DeleteRange(block.begin(), block.end());
        if (firstlen)
        {
                thing.ConstructDataEntry(text,firstlen-IndexBlockEntry::HeaderSize,0);
                thing.SetRecordID(idstart++);
                block.InsertAt(block.end(), thing);
        };
        totallen -= lastlen;
        unsigned fillentrysize = bigentries?IndexBlockEntry::MaxEntrySize:IndexBlockEntry::HeaderSize;
        // fill until totallen is done
        while (static_cast<signed>(block.FillSize()) < totallen)
        {
                unsigned todo = totallen - block.FillSize();
                unsigned len = todo;

                if (len > fillentrysize + IndexBlockEntry::HeaderSize|| len <= fillentrysize)
                    len = std::min<const unsigned int>(len, fillentrysize);
                else
                    if (len >= 2*IndexBlockEntry::HeaderSize)
                        len -= IndexBlockEntry::HeaderSize;

                thing.ConstructDataEntry(text, len - IndexBlockEntry::HeaderSize,0);
                thing.SetRecordID(idstart++);
                block.InsertAt(block.end(), thing);
        }
        if (lastlen)
        {
                thing.ConstructDataEntry(text,lastlen-IndexBlockEntry::HeaderSize,0);
                thing.SetRecordID(idstart++);
                block.InsertAt(block.end(), thing);
        };
        thing.ConstructEOBEntry();
        block.InsertAt(block.end(), thing);
        assert(static_cast<signed>(block.FillSize()) == oldtotallen);
}

bool CompareBlock(IndexBlock const & left, IndexBlock const & right)
{
        return std::distance(left.begin(),left.end()) == std::distance(right.begin(),right.end())
               && std::equal(left.begin(),left.end(),right.begin());
}

void CopyBlock(IndexBlock& dest, IndexBlock const & source)
{
        dest.DeleteRange(dest.begin(), dest.end());
        dest.InsertRange(dest.begin(), source.begin(), source.end());
}

void AllocateBlocks(DBIndexFileSystem::ReadWriteSession &session, SmartBlockPtr *block1, SmartBlockPtr *block2 = NULL, SmartBlockPtr *block3 = NULL, SmartBlockPtr *block4 = NULL)
{
        if (block1)
            *block1=SmartBlockPtr(session, session.AllocateBlock(1, BlockId(-1)));
        if (block2)
            *block2=SmartBlockPtr(session, session.AllocateBlock(1, BlockId(-1)));
        if (block3)
            *block3=SmartBlockPtr(session, session.AllocateBlock(1, BlockId(-1)));
        if (block4)
            *block4=SmartBlockPtr(session, session.AllocateBlock(1, BlockId(-1)));
}

ContainerList GetTreeEntryList(DBIndexFileSystem::Session &session, SmartBlockPtr& blockptr)
{
        ContainerList list;
        IndexBlockEntryContainer cont;
        RawTreeIterator it = RawTreeIterator::GetBegin(session, blockptr.GetBlockId());
        RawTreeIterator end = RawTreeIterator::GetEnd(session);
        while (it != end)
        {
                cont.CopyFrom(*it);
                list.push_back(cont);
                ++it;
        }
        return list;
}

void FreeTree(DBIndexFileSystem::ReadWriteSession &session, int32_t blockid)
{
        if (blockid == BlockId(-1)) return;
        SmartBlockPtr blockptr(session,blockid);
        IndexBlock::iterator it = blockptr->begin();
        IndexBlock::iterator end = blockptr->end();
        while (it != end)
        {
                FreeTree(session, it->GetChildBlockId());
                ++it;
        }
//        DEBUGPRINT("Freeing: " << blockid);
        session.FreeBlock(blockid);
}
void FreeTree(DBIndexFileSystem::ReadWriteSession &session, SmartBlockPtr* base)
{
        unsigned blockid = base->GetBlockId();
        FreeTree(session, blockid);
}
void TestCheckChildSize(DBIndexFileSystem::ReadWriteSession &session, BtreeIndex::WriteSession &iwsession, const std::vector<unsigned> &blocksizes, unsigned testedblock)
{
        IndexBlockEntryContainer thing;

        SmartBlockPtr base(session, session.AllocateBlock(1, BlockId(-1)));
        SmartBlockPtr child(session, session.AllocateBlock(1, BlockId(-1)));
        AllocateBlocks(session, &base);
        unsigned lastblockid = 0;
        for (unsigned i = 0; i<blocksizes.size(); ++i)
        {
                AllocateBlocks(session, &child);
                FillBlock(*child, 0, 0, blocksizes[i], i*10000);
                if (i != blocksizes.size() - 1)
                {
                        thing.ConstructDataEntry(NULL,0,5000+10000*i);
                        base->InsertAtWithID(base->eob(), thing, child.GetBlockId());
                }
                else
                {
                        lastblockid = child.GetBlockId();
                }
        }
        base->eob()->SetChildBlockID(lastblockid);

        iwsession.admin->treedepth = 2;

        IndexBlock::iterator at = base->begin() + testedblock;

        ContainerList list = GetTreeEntryList(session, base);
        {
                SmartBlockPtr b(session, at->GetChildBlockId());
                thing.CopyFrom(*b->begin());
        };
        BLEX_TEST_CHECK(!iwsession.CheckChildSize(*base, at));
        {
                SmartBlockPtr b(session, at->GetChildBlockId());
                BLEX_TEST_CHECK(thing.GetRecordId() >= b->begin()->GetRecordId());
        };

        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);
}


void Operation_1(SmartBlockPtr &base, SmartBlockPtr &left, SmartBlockPtr &right)
{
        IndexBlockEntryContainer container;
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(left.GetBlockId());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin()+0);
        base->InsertAt(base->begin()+0, container);
        container.CopyFrom(*(base->begin()+1));
        container.SetChildBlockID(right.GetBlockId());
        base->DeleteAt(base->begin()+1);
        base->InsertAt(base->begin()+1, container);
}

BLEX_TEST_FUNCTION(Index_RedistributesTest)
{
        namespace BI = Blex::Index;

        std::string indexfilename = Blex::MergePath(Blex::Test::GetTempDir(),"redistributetest.idx");
        DBIndexFileSystem filesys(indexfilename, NULL, true);  //empty filesys
        DBIndexFileSystem::ReadWriteSession session(filesys);

        SmartBlockPtr org1(session, session.AllocateBlock(1, -1));
        SmartBlockPtr org2(session, session.AllocateBlock(1, -1));
        SmartBlockPtr org3(session, session.AllocateBlock(1, -1));
        SmartBlockPtr org4(session, session.AllocateBlock(1, -1));

        SmartBlockPtr base(session, session.AllocateBlock(1, -1));
        SmartBlockPtr left(session, session.AllocateBlock(1, -1));
        SmartBlockPtr middle(session, session.AllocateBlock(1, -1));
        SmartBlockPtr right(session, session.AllocateBlock(1, -1));

                unsigned testedblocks = 12;

        // Get 3 blocks, use first and last for bound-check
        std::vector<unsigned> borderblocks;
        std::vector<unsigned> useblocks;
        for (unsigned i = 0; i <= testedblocks*2; ++i)
        {
                unsigned no = session.AllocateBlock(1, BlockId(-1));
                if (i % 2 == 0)
                    borderblocks.push_back(no);
                else
                    useblocks.push_back(no);
        }
        for (unsigned i = 0; i < useblocks.size(); ++i)
            session.FreeBlock(useblocks[i]);

        for (unsigned i = 0; i < borderblocks.size(); ++i)
        {
                uint8_t* block = session.LockBlock(borderblocks[i]);
                memset(block, 0xCC, C_Block::Size);
                session.UnlockBlock(borderblocks[i], block, true);
        };

        // 4 boundtested blocks available (block_2, block_4, block_6, block_8)

        std::string test_str(64, ' ');
        const uint8_t* text = reinterpret_cast<const uint8_t*>(&test_str[0]);
        BI::IndexBlockEntryContainer thing;thing.ConstructDataEntry(text,64,20);

        AllocateBlocks(session, &base, &left, &middle, &right);
        base->begin()->SetChildBlockID(right.GetBlockId());

        thing.SetRecordID(10000);
        base->InsertAtWithID(base->begin(), thing, left.GetBlockId());

#ifdef DEBUG_RESOURCEMANAGER
        manager.SetupDebugging("manager");
#endif

        BI::BtreeIndex index(filesys, "testindex");
        BI::BtreeIndex::WriteSession iwsession(index);
        ContainerList list;

        IndexBlock::iterator at = base->begin();

        // Make copies
        CopyBlock(*org1, *base);
        CopyBlock(*org2, *left);
        CopyBlock(*org4, *right);

        // These 2 shouldn't change a thing
        iwsession.Redistribute(*base, at, IndexBlockEntry::EOBSize);
        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(CompareBlock(*org1, *base));
        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
        BLEX_TEST_CHECK(CompareBlock(*org4, *right));

        iwsession.Redistribute(*base, at, -static_cast<signed>(IndexBlockEntry::EOBSize));
        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(CompareBlock(*org1, *base));
        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
        BLEX_TEST_CHECK(CompareBlock(*org4, *right));

        unsigned rid = 1;
        while (left->FillSize() < C_Block::MaxData - 2*thing.GetEntryLength())
        {
                thing.SetRecordID(rid++);
                left->InsertAt(left->eob(), thing);
        }

        // Make copies
        CopyBlock(*org1, *base);
        CopyBlock(*org2, *left);
        CopyBlock(*org4, *right);

        unsigned totalsize = left->FillSize() + at->GetEntryLength() + right->FillSize();

        // Move everything as far to right as possible, and back
        iwsession.Redistribute(*base, at, IndexBlockEntry::EOBSize);
        BLEX_TEST_CHECK(left->FillSize() == IndexBlockEntry::EOBSize);
        iwsession.Redistribute(*base, at, -static_cast<signed>(IndexBlockEntry::EOBSize));

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(CompareBlock(*org1, *base));
        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
        BLEX_TEST_CHECK(CompareBlock(*org4, *right));

        // fill left total
        thing.SetRecordID(rid++);
        left->InsertAt(left->eob(), thing);
        // fill right to 1/3
        rid = 15000;
        while (right->FillSize() < C_Block::MaxData / 3)
        {
                thing.SetRecordID(rid++);
                right->InsertAt(right->eob(), thing);
        }

        // Make copies
        CopyBlock(*org1, *base);
        CopyBlock(*org2, *left);
        CopyBlock(*org4, *right);

        // Move everything as far to right as possible, and back
        totalsize = left->FillSize() + at->GetEntryLength() + right->FillSize();
        signed balancepoint = std::max<signed>(IndexBlockEntry::EOBSize, totalsize - C_Block::MaxData);
        iwsession.Redistribute(*base, at, balancepoint);
        BLEX_TEST_CHECK(static_cast<signed>(base->FillSize()) <= balancepoint);
        iwsession.Redistribute(*base, at, -balancepoint);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(CompareBlock(*org1, *base));
        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
        BLEX_TEST_CHECK(CompareBlock(*org4, *right));

        FillBlock(*right, 0, 0, 200, 15000);
        totalsize = 200 + at->GetEntryLength() + right->FillSize();
        CopyBlock(*org1, *base);
        CopyBlock(*org4, *left);
        CopyBlock(*org4, *right);

        // BLEX_TEST_CHECK redistribute with all last entry length, and all positions within that entry (at is entry of max length
        for (unsigned i = IndexBlockEntry::HeaderSize; i < IndexBlockEntry::MaxEntrySize; ++i)
        {
                FillBlock(*left, 0, i, 200, 5000);
                CopyBlock(*org2, *left);
                for (unsigned a = 0; a < i; ++a)
                {
                        unsigned balancepoint = 200 - a;
                        iwsession.Redistribute(*base, at, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);

                        balancepoint = 200;
                        iwsession.Redistribute(*base, at, IndexBlockEntry::EOBSize); // move all to left, to get next redistribution to exact 200 in left.fillsize
                        iwsession.Redistribute(*base, at, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
                        BLEX_TEST_CHECK(CompareBlock(*org4, *right));
                };
//                std::cout << i << " ";
        }
//        std::cout << std::endl;

        // BLEX_TEST_CHECK redistribute with all last entry length, and all positions within that entry (max loength entry in base)
        for (unsigned i = IndexBlockEntry::HeaderSize; i < IndexBlockEntry::MaxEntrySize; ++i)
        {
                FillBlock(*right, i, 0, 200, 5000);
                CopyBlock(*org4, *right);
                for (unsigned a = 0; a < i; ++a)
                {
                        unsigned balancepoint = totalsize-(200 - a);
                        iwsession.Redistribute(*base, at, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);

                        balancepoint = 200;
                        iwsession.Redistribute(*base, at, IndexBlockEntry::EOBSize); // move all to left, to get next redistribution to exact 200 in left.fillsize
                        iwsession.Redistribute(*base, at, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
                        BLEX_TEST_CHECK(CompareBlock(*org4, *right));
                };
//                std::cout << i << " ";
        }
//        std::cout << std::endl;

        middle->DeleteAt(middle->begin());
        IndexBlockEntryContainer littlething;littlething.ConstructDataEntry(text,0,20);
        middle->InsertAtWithID(middle->end(), littlething, left.GetBlockId());
        littlething.ConstructEOBEntry();
        middle->InsertAtWithID(middle->end(), littlething, right.GetBlockId());

        CopyBlock(*org3, *middle);
        IndexBlock::iterator mat = middle->begin();

        totalsize = 200 + mat->GetEntryLength() + 200;
        // BLEX_TEST_CHECK redistribute with all last entry length, and all positions within that entry (at is entry of max length
        for (unsigned i = IndexBlockEntry::HeaderSize; i < IndexBlockEntry::MaxEntrySize; ++i)
        {
                FillBlock(*left, 0, i, 200, 5000);
                CopyBlock(*org2, *left);
                for (unsigned a = 0; a < i; ++a)
                {
                        unsigned balancepoint = 200 - a;
                        iwsession.Redistribute(*middle, mat, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);

                        balancepoint = 200;
                        iwsession.Redistribute(*middle, mat, IndexBlockEntry::EOBSize); // move all to left, to get next redistribution to exact 200 in left.fillsize
                        iwsession.Redistribute(*middle, mat, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
                        BLEX_TEST_CHECK(CompareBlock(*org4, *right));
                };
//                std::cout << i << " ";
        }
//        std::cout << std::endl;

        // BLEX_TEST_CHECK redistribute with all last entry length, and all positions within that entry (min length entry in middle)
        for (unsigned i = IndexBlockEntry::HeaderSize; i < IndexBlockEntry::MaxEntrySize; ++i)
        {
                FillBlock(*right, i, 0, 200, 5000);
                CopyBlock(*org4, *right);
                for (unsigned a = 0; a < i; ++a)
                {
                        unsigned balancepoint = totalsize-(200 - a);
                        iwsession.Redistribute(*middle, mat, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);

                        balancepoint = 200;
                        iwsession.Redistribute(*middle, mat, IndexBlockEntry::EOBSize); // move all to left, to get next redistribution to exact 200 in left.fillsize
                        iwsession.Redistribute(*middle, mat, balancepoint);

                        BLEX_TEST_CHECK(left->FillSize() <= balancepoint);
                        BLEX_TEST_CHECK(left->FillSize() >= balancepoint - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(right->FillSize() <= (totalsize - balancepoint));
                        BLEX_TEST_CHECK(right->FillSize() >= (totalsize - balancepoint) - IndexBlockEntry::MaxEntrySize);
                        BLEX_TEST_CHECK(CompareBlock(*org2, *left));
                        BLEX_TEST_CHECK(CompareBlock(*org4, *right));
                };
//                std::cout << i << " ";
        }
//        std::cout << std::endl;

        //-- Average2 ----------------------------------------------------------

// test average2 on left full, right so full that minsize average is possible with minimal minsize bytes in left and right afterwards
        totalsize = 2*C_Index::InsertDelete::MinSize + at->GetEntryLength() + 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, totalsize - at->GetEntryLength() - left->FillSize(), 15000);

        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2 on right full, left so full that minsize average is possible with minimal minsize bytes in left and right afterwards
        totalsize = 2*C_Index::InsertDelete::MinSize + at->GetEntryLength() + 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        FillBlock(*left, 0, 0, totalsize - at->GetEntryLength() - right->FillSize(), 5000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2 on left full, right as full as possible
        totalsize = 2*C_Index::InsertDelete::MaxSize;
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, totalsize - at->GetEntryLength() - left->FillSize(), 15000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2 on right full, left as full as possible
        totalsize = 2*C_Index::InsertDelete::MaxSize;
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        FillBlock(*left, 0, 0, totalsize - at->GetEntryLength() - right->FillSize(), 5000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// left empty, right empty
        FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize, 5000);
        FillBlock(*right, 0, 0, IndexBlockEntry::EOBSize, 15000);
        BLEX_TEST_CHECK(!iwsession.Average2(*base, at)); // must fail

// test average2 on left full, right empty
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, IndexBlockEntry::EOBSize, 15000);
        BLEX_TEST_CHECK(!iwsession.Average2(*base, at)); // must fail

// test average2 on left empty, right full
        FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize, 5000);
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        BLEX_TEST_CHECK(!iwsession.Average2(*base, at)); // must fail

// test average2 on left full, right full
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        BLEX_TEST_CHECK(!iwsession.Average2(*base, at)); // must fail

        //-- Average2LowerBound ------------------------------------------------

// test average2WithLowerBound on left full, right so full that minsize average is possible with minimal minsize bytes in left and right afterwards
        totalsize = 2*C_Index::InsertDelete::LowMinSize + at->GetEntryLength() + 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*left, 0, 0, totalsize - at->GetEntryLength() - IndexBlockEntry::EOBSize, 5000);
        FillBlock(*right, 0, 0, IndexBlockEntry::EOBSize, 15000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2WithLowerBound(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2WithLowerBound on right full, left so full that minsize average is possible with minimal minsize bytes in left and right afterwards
        totalsize = 2*C_Index::InsertDelete::LowMinSize + at->GetEntryLength() + 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*right, 0, 0, totalsize - at->GetEntryLength() - IndexBlockEntry::EOBSize, 15000);
        FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize, 5000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2WithLowerBound(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2WithLowerBound on left full, right as full as possible
        totalsize = 2*C_Index::InsertDelete::MaxSize + at->GetEntryLength() - 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, totalsize - at->GetEntryLength() - left->FillSize(), 15000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2WithLowerBound(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2WithLowerBound on right full, left as full as possible
        totalsize = 2*C_Index::InsertDelete::MaxSize + at->GetEntryLength() - 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        FillBlock(*left, 0, 0, totalsize - at->GetEntryLength() - right->FillSize(), 5000);

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2WithLowerBound(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// left empty, right empty
        FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize, 5000);
        FillBlock(*right, 0, 0, IndexBlockEntry::EOBSize, 15000);
        BLEX_TEST_CHECK(!iwsession.Average2WithLowerBound(*base, at)); // must fail

// left full, right full
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        BLEX_TEST_CHECK(!iwsession.Average2WithLowerBound(*base, at)); // must fail

// test average2WithLowerBound on left full, right empty
        FillBlock(*left, 0, 0, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, IndexBlockEntry::EOBSize, 15000);
        totalsize = left->FillSize() + at->GetEntryLength() + right->FillSize();

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2WithLowerBound(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// test average2WithLowerBound on left empty, right full
        FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize, 5000);
        FillBlock(*right, 0, 0, C_Block::MaxData, 15000);
        totalsize = left->FillSize() + at->GetEntryLength() + right->FillSize();

        // Make copies
        list = GetTreeEntryList(session, base);

        BLEX_TEST_CHECK(iwsession.Average2WithLowerBound(*base, at)); // must succeed
        BLEX_TEST_CHECK(left->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(left->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);
        BLEX_TEST_CHECK(right->FillSize() <= (totalsize+1) / 2);
        BLEX_TEST_CHECK(right->FillSize() >= (totalsize / 2) - IndexBlockEntry::MaxEntrySize);

        // BLEX_TEST_CHECK equality to copies
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

// -- Free all blocks
        FillBlock(*base, 0, 0, IndexBlockEntry::EOBSize,0);FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize,0);
        FillBlock(*middle, 0, 0,IndexBlockEntry::EOBSize,0);FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize,0);
        FreeTree(session, base.GetBlockId());
        FreeTree(session, left.GetBlockId());
        FreeTree(session, middle.GetBlockId());
        FreeTree(session, right.GetBlockId());

/* I assume further that the assertions laid out in the functions are correct.
   These are VERY strict. The functions use only Redistribute, and that one is now tested ok. */
// Functions affected: Average3

        //-- Splice2 -----------------------------------------------------------

// left full, right full, base as full as preconditions allow
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        unsigned fillsize = 2*C_Block::MaxData;

        unsigned atlen = 34;

        FillBlock(*left, 0, 0, fillsize / 2, 5000);
        FillBlock(*right, 0, 0, fillsize / 2, 15000);
        FillBlock(*base, atlen, 0, C_Block::MaxData - 2*IndexBlockEntry::MaxEntrySize + atlen, 20000);
        IndexBlockEntryContainer container;
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        (base->begin()+1)->SetChildBlockID(right.GetBlockId());

        list = GetTreeEntryList(session, base);

        // We won't be able to reconstruct the original... due to very fullness. Using new testfunction
        iwsession.Splice2(*base, at);

        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        // left and right were filled with entries with max data size by fillblock, so now baseblock
        // should be full
        BLEX_TEST_CHECK(base->FillSize() == C_Block::MaxData);

        FreeTree(session, &base);
// left full and right as empty as preconditions allow
        AllocateBlocks(session, &base, &left, &right);at = base->begin();

        totalsize = 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize;

        FillBlock(*left, 0, 0, std::min(totalsize - atlen, C_Block::MaxData), 5000);
        FillBlock(*right, 0, 0, totalsize - atlen - left->FillSize(), 15000, false);

        FillBlock(*base, atlen, 0, C_Block::MaxData - 2*IndexBlockEntry::MaxEntrySize + atlen, 20000);
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        (base->begin()+1)->SetChildBlockID(right.GetBlockId());

        list = GetTreeEntryList(session, base);
        iwsession.Splice2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

        FreeTree(session, &base);

// right full and left as empty as preconditions allow
        AllocateBlocks(session, &base, &left, &right);at = base->begin();

        totalsize = 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize;

        FillBlock(*right, 0, 0, std::min(totalsize - atlen, C_Block::MaxData), 15000, false);
        FillBlock(*left, 0, 0, totalsize - atlen - right->FillSize(), 5000);

        FillBlock(*base, atlen, 0, C_Block::MaxData - 2*IndexBlockEntry::MaxEntrySize + atlen, 20000);
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        (base->begin()+1)->SetChildBlockID(right.GetBlockId());

        list = GetTreeEntryList(session, base);
        iwsession.Splice2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

        FreeTree(session, &base);

        //-- Recombine2 --------------------------------------------------------

// left full and right as full as preconditions allow (64-byte entries), base as full as allowed
        AllocateBlocks(session, &base, &left, &right);at = base->begin();

        totalsize = C_Index::InsertDelete::MaxSize+IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        unsigned secondlen = IndexBlockEntry::MaxEntrySize;

        FillBlock(*left, 0, 0, std::min(totalsize - atlen - IndexBlockEntry::EOBSize, C_Block::MaxData), 5000);
        FillBlock(*right, 0, 0, std::max<unsigned>(0, totalsize - atlen - left->FillSize()), 15000, false);

//        DEBUGPRINT(left->FillSize() << " " << right->FillSize());

        FillBlock(*base, atlen, 0, C_Block::MaxData - IndexBlockEntry::MaxEntrySize + atlen - secondlen, 20001);
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        thing.ConstructDataEntry(text,secondlen,20000); // max len entry
        thing.SetChildBlockID(right.GetBlockId());
        base->InsertAt(base->begin()+1, thing);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine2(*base, at);

        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

        FreeTree(session, &base);

// right full and left as full as preconditions allow (64-byte entries), base as full as allowed
        AllocateBlocks(session, &base, &left, &right);at = base->begin();

        totalsize = C_Index::InsertDelete::MaxSize+IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        secondlen = IndexBlockEntry::MaxEntrySize;

        FillBlock(*right, 0, 0, std::min(totalsize - atlen - IndexBlockEntry::EOBSize, C_Block::MaxData), 5000);
        FillBlock(*left, 0, 0, std::max<unsigned>(0, totalsize - atlen - right->FillSize()), 15000, false);

        FillBlock(*base, atlen, 0, C_Block::MaxData - IndexBlockEntry::MaxEntrySize + atlen - secondlen, 20001);
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        thing.ConstructDataEntry(text,secondlen,20000); // max len entry
        thing.SetChildBlockID(right.GetBlockId());
        base->InsertAt(base->begin()+1, thing);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

        FreeTree(session, &base);

// right empty and left as empty as preconditions allow (64-byte entries), base as full as allowed
        AllocateBlocks(session, &base, &left, &right);at = base->begin();

        totalsize = C_Index::InsertDelete::MinSize + IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        secondlen = IndexBlockEntry::MaxEntrySize;

        FillBlock(*right, 0, 0, IndexBlockEntry::EOBSize, C_Block::MaxData, 5000);
        FillBlock(*left, 0, 0, std::max<unsigned>(0, totalsize - atlen - right->FillSize()), 15000, false);

        FillBlock(*base, atlen, 0, C_Block::MaxData - IndexBlockEntry::MaxEntrySize + atlen - secondlen, 20001);
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        thing.ConstructDataEntry(text,secondlen,20000); // max len entry
        thing.SetChildBlockID(right.GetBlockId());
        base->InsertAt(base->begin()+1, thing);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

        FreeTree(session, &base);

// left empty and right as empty as preconditions allow (64-byte entries), base as full as allowed
        AllocateBlocks(session, &base, &left, &right);at = base->begin();

        totalsize = C_Index::InsertDelete::MinSize + IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        secondlen = IndexBlockEntry::MaxEntrySize;

        FillBlock(*left, 0, 0, IndexBlockEntry::EOBSize, C_Block::MaxData, 5000);
        FillBlock(*right, 0, 0, std::max<unsigned>(0, totalsize - atlen - left->FillSize()), 15000, false);

        FillBlock(*base, atlen, 0, C_Block::MaxData - IndexBlockEntry::MaxEntrySize + atlen - secondlen, 20001);
        container.CopyFrom(*base->begin());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        base->begin()->SetChildBlockID(left.GetBlockId());
        thing.ConstructDataEntry(text,secondlen,20000); // max len entry
        thing.SetChildBlockID(right.GetBlockId());
        base->InsertAt(base->begin()+1, thing);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));

        FreeTree(session, &base);

        //-- Recombine2 --------------------------------------------------------

// left full, middle as full as possible, right empty, 64-byte entries. Base as full as possible (parent entries of 10 bytes, beink replaced by 64-byte ones)
        AllocateBlocks(session, &base, &left, &middle, &right);at = base->begin();

        totalsize = 2*C_Index::InsertDelete::MaxSize + IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        unsigned at2len = IndexBlockEntry::HeaderSize;

        unsigned block1len = std::max<unsigned>(0,std::min<unsigned>(C_Block::MaxData, totalsize - atlen-at2len - 2 * IndexBlockEntry::EOBSize));
        unsigned block2len = std::max<unsigned>(0,std::min<unsigned>(C_Block::MaxData, totalsize - atlen - at2len - IndexBlockEntry::EOBSize - block1len));
        unsigned block3len = std::max<unsigned>(0,std::min<unsigned>(C_Block::MaxData, totalsize - atlen - at2len - block1len - block2len));

//        std::cout << block1len << " " << block2len << " " << block3len << std::endl;

        FillBlock(*left, 0, 0, block1len, 5000);
        FillBlock(*middle, 0, IndexBlockEntry::MaxEntrySize, block2len, 15000); // Let last entry be a BIG one!
        FillBlock(*right, 0, 0, block3len, 25000);

        unsigned basefillminats = C_Block::MaxData - 2*IndexBlockEntry::MaxEntrySize;
        FillBlock(*base, IndexBlockEntry::MaxEntrySize, 0, basefillminats, 30000);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(30000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        container.ConstructDataEntry(NULL, 0, 0);
        container.SetChildBlockID(middle.GetBlockId());container.SetRecordID(20000);base->InsertAt(base->begin(), container);
        container.SetChildBlockID(left.GetBlockId());container.SetRecordID(10000);base->InsertAt(base->begin(), container);

//        DEBUGPRINT(C_Index::InsertDelete::MaxSize<< " " << totalsize);
//        DEBUGPRINT(left->FillSize() << " "<<middle->FillSize()<<" "<<right->FillSize());
//        DEBUGPRINT(at->GetEntryLength() << " " << (at+1)->GetEntryLength());

        list = GetTreeEntryList(session, base);
        iwsession.Recombine3(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

// left empty, middle as full as possible, right full, 64-byte entries. Base as full as possible (parent entries of 10 bytes, beink replaced by 64-byte ones)
        AllocateBlocks(session, &base, &left, &middle, &right);at = base->begin();

        FillBlock(*left, 0, 0, block3len, 5000);
        FillBlock(*middle, 0, IndexBlockEntry::MaxEntrySize, block2len, 15000); // Let last entry be a BIG one!
        FillBlock(*right, 0, 0, block1len, 25000);

        FillBlock(*base, IndexBlockEntry::MaxEntrySize, 0, basefillminats, 30000);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(30000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        container.ConstructDataEntry(NULL, 0, 0);
        container.SetChildBlockID(middle.GetBlockId());container.SetRecordID(20000);base->InsertAt(base->begin(), container);
        container.SetChildBlockID(left.GetBlockId());container.SetRecordID(10000);base->InsertAt(base->begin(), container);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine3(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

// left full, middle empty, right as full as possible, 64-byte entries. Base as full as possible (parent entries of 10 bytes, beink replaced by 64-byte ones)
        AllocateBlocks(session, &base, &left, &middle, &right);at = base->begin();

        FillBlock(*left, 0, 0, block1len, 5000);
        FillBlock(*middle, 0, 0, block3len, 15000);
        FillBlock(*right, 0, IndexBlockEntry::MaxEntrySize, block2len, 25000);

        FillBlock(*base, IndexBlockEntry::MaxEntrySize, 0, basefillminats, 30000);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(30000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        container.ConstructDataEntry(NULL, 0, 0);
        container.SetChildBlockID(middle.GetBlockId());container.SetRecordID(20000);base->InsertAt(base->begin(), container);
        container.SetChildBlockID(left.GetBlockId());container.SetRecordID(10000);base->InsertAt(base->begin(), container);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine3(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

// right full, middle as full as possible, left empty
        AllocateBlocks(session, &base, &left, &middle, &right);at = base->begin();

        totalsize = 2*C_Index::InsertDelete::MinSize + 2*IndexBlockEntry::MaxEntrySize + IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        at2len = IndexBlockEntry::HeaderSize;

        block1len = std::max<unsigned>(0,std::min<unsigned>(C_Block::MaxData, totalsize - atlen-at2len - 2 * IndexBlockEntry::EOBSize));
        block2len = std::max<unsigned>(0,std::min<unsigned>(C_Block::MaxData, totalsize - atlen - at2len - IndexBlockEntry::EOBSize - block1len));
        block3len = std::max<unsigned>(0,std::min<unsigned>(C_Block::MaxData, totalsize - atlen - at2len - block1len - block2len));

        FillBlock(*left, 0, 0, block1len, 5000);
        FillBlock(*middle, 0, 0, block2len, 15000);
        FillBlock(*right, 0, 0, block3len, 25000);

        FillBlock(*base, IndexBlockEntry::MaxEntrySize, 0, basefillminats, 30000);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(30000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);
        container.ConstructDataEntry(NULL, 0, 0);
        container.SetChildBlockID(middle.GetBlockId());container.SetRecordID(20000);base->InsertAt(base->begin(), container);
        container.SetChildBlockID(left.GetBlockId());container.SetRecordID(10000);base->InsertAt(base->begin(), container);

        list = GetTreeEntryList(session, base);
        iwsession.Recombine3(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

        //-- Splice1 -----------------------------------------------------------

// Right as empty as possible, base as full as possible
        AllocateBlocks(session, &base, &right);at = base->begin();

        totalsize = 2*C_Index::InsertDelete::LowMinSize + 2* IndexBlockEntry::MaxEntrySize;
        atlen = IndexBlockEntry::HeaderSize;
        basefillminats = C_Block::MaxData - IndexBlockEntry::MaxEntrySize;
        FillBlock(*right, 0, 0, totalsize, 5000);
        FillBlock(*base, 0, 0, basefillminats, 10001);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);

        list = GetTreeEntryList(session, base);
        iwsession.Splice1(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

// Right as full as possible, base as full as possible
        AllocateBlocks(session, &base, &right);at = base->begin();

        totalsize = C_Block::MaxData;
        atlen = IndexBlockEntry::HeaderSize;
        basefillminats = C_Block::MaxData - IndexBlockEntry::MaxEntrySize;
        FillBlock(*right, 0, 0, totalsize, 5000);
        FillBlock(*base, 0, 0, basefillminats, 10001);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin());
        base->InsertAt(base->begin(), container);

        list = GetTreeEntryList(session, base);
        iwsession.Splice1(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

        //-- Recombine2 --------------------------------------------------------
// left full, right as empty as possible
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        totalsize = C_Index::InsertDelete::MaxSize - IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        basefillminats = C_Block::MaxData - IndexBlockEntry::MaxEntrySize;
        FillBlock(*left, 0, 0, std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen), 5000);
        FillBlock(*right, 0, 0, totalsize - atlen - left->FillSize(), 15000);

        FillBlock(*base, atlen, 0, basefillminats + atlen, 20000-1);
        container.CopyFrom(*base->begin());
        container.SetChildBlockID(left.GetBlockId());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin()+0);
        base->InsertAt(base->begin()+0, container);
        container.CopyFrom(*(base->begin()+1));
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(20000);
        base->DeleteAt(base->begin()+1);
        base->InsertAt(base->begin()+1, container);

//        DEBUGPRINT("basesize: " << base->FillSize() << " " << at->GetEntryLength());
//        DEBUGPRINT("left: " << left->FillSize() << "  right: " << right->FillSize());

        list = GetTreeEntryList(session, base);
        iwsession.Recombine2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

// right full, left as empty as possible
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        totalsize = C_Index::InsertDelete::MaxSize - IndexBlockEntry::EOBSize;
        atlen = IndexBlockEntry::HeaderSize;
        basefillminats = C_Block::MaxData - IndexBlockEntry::MaxEntrySize;
        FillBlock(*right, 0, 0, std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen), 15000);
        FillBlock(*left, 0, 0, totalsize - atlen - right->FillSize(), 5000);

        FillBlock(*base, atlen, 0, basefillminats + atlen, 200001);

        container.CopyFrom(*base->begin());
        container.SetChildBlockID(left.GetBlockId());
        container.SetRecordID(10000);
        base->DeleteAt(base->begin()+0);
        base->InsertAt(base->begin()+0, container);
        container.CopyFrom(*(base->begin()+1));
        container.SetChildBlockID(right.GetBlockId());
        container.SetRecordID(20000);
        base->DeleteAt(base->begin()+1);
        base->InsertAt(base->begin()+1, container);

        //        DEBUGPRINT("basesize: " << base->FillSize() << " " << at->GetEntryLength());
//        DEBUGPRINT("left: " << left->FillSize() << "  right: " << right->FillSize());

        list = GetTreeEntryList(session, base);
        iwsession.Recombine2(*base, at);
        BLEX_TEST_CHECK(equal(session, base.GetBlockId(), list));
        FreeTree(session, &base);

        //-- CheckChildSize ----------------------------------------------------

        std::vector<unsigned> sizes;

// codepath: there are both left and right entries, averaging with left works
        atlen = 2*IndexBlockEntry::EOBSize;
        at2len = 2*IndexBlockEntry::EOBSize;
        totalsize = C_Index::MinBlockFill + C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxEntrySize;
        block1len = std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen);
        block2len = totalsize - atlen - block1len;
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block2len);sizes.push_back(block1len);sizes.push_back(block3len);
        TestCheckChildSize(session, iwsession, sizes, 1);

// codepath: there are both left and right entries, averaging with left does not work, with right works
        totalsize = C_Index::MinBlockFill + C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxEntrySize;
        block1len = std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block3len);sizes.push_back(block1len);sizes.push_back(block2len);
        TestCheckChildSize(session, iwsession, sizes, 1);

// codepath: there is no left entry, averaging with right works
        totalsize = C_Index::MinBlockFill + C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxEntrySize;
        block1len = std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block1len);sizes.push_back(block2len);sizes.push_back(block3len);
        TestCheckChildSize(session, iwsession, sizes, 0);

// codepath: there is no right entry, averaging with left works
        totalsize = C_Index::MinBlockFill + C_Index::InsertDelete::MaxSize + IndexBlockEntry::MaxEntrySize;
        block1len = std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block3len);sizes.push_back(block2len);sizes.push_back(block1len);
        TestCheckChildSize(session, iwsession, sizes, 2);
// averaging with left and right neighbour fully tested

// tests for child.FillSize() > C_Index::InsertDelete::MaxSize, splice2 with right neighbour
        // for every neightbour that exists, totalsize > 2* C_Index::InsertDelete::MaxSize
        totalsize = 2*C_Index::InsertDelete::MaxSize+1;

        block1len = std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block1len);sizes.push_back(block2len);sizes.push_back(block3len);
        TestCheckChildSize(session, iwsession, sizes, 0);

// tests for child.FillSize() > C_Index::InsertDelete::MaxSize, right neighbour does not exist
        // for every neightbour that exists, totalsize > 2* C_Index::InsertDelete::MaxSize
        totalsize = 2*C_Index::InsertDelete::MaxSize+1;

        block1len = std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block3len);sizes.push_back(block2len);sizes.push_back(block1len);
        TestCheckChildSize(session, iwsession, sizes, 2);

// Both average2's underflow, path for Average3:
// left neighbour exists, right also, thus average3 does not work due to underflow
        totalsize = 2*(C_Index::InsertDelete::MinSize+IndexBlockEntry::MaxEntrySize) - 1;

        block1len = std::min<unsigned>(C_Index::InsertDelete::MinSize-1, totalsize-C_Index::MinBlockFill-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block2len);sizes.push_back(block1len);sizes.push_back(block2len);
        TestCheckChildSize(session, iwsession, sizes, 1);

// left neighbour does not exist, right side 2 neighbours
        totalsize = 2*(C_Index::InsertDelete::MinSize+IndexBlockEntry::MaxEntrySize) - 1;

        block1len = std::min<unsigned>(C_Index::InsertDelete::MinSize-1, totalsize-C_Index::MinBlockFill-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block1len);sizes.push_back(block2len);sizes.push_back(block2len);
        TestCheckChildSize(session, iwsession, sizes, 0);

// right neighbour does not exist, left side 2 neighbours
        totalsize = 2*(C_Index::InsertDelete::MinSize+IndexBlockEntry::MaxEntrySize) - 1;

        block1len = std::min<unsigned>(C_Index::InsertDelete::MinSize-1, totalsize-C_Index::MinBlockFill-atlen);
        block2len = std::max<unsigned>(totalsize - atlen - block1len, C_Index::MinBlockFill);
        block3len = C_Block::MaxData;

        sizes.clear();sizes.push_back(block2len);sizes.push_back(block2len);sizes.push_back(block1len);
        TestCheckChildSize(session, iwsession, sizes, 2);

// left neigbour does not exist & Average3 works
        totalsize = 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize;
        block1len = std::min<unsigned>(C_Index::InsertDelete::MinSize-1, totalsize - 2*(C_Index::InsertDelete::MinSize-1) - atlen - at2len);
        block2len = std::min<unsigned>(C_Index::InsertDelete::MinSize-1, totalsize - block1len - (C_Index::InsertDelete::MinSize-1) - at2len);
        block3len = totalsize - block1len - block2len;

        sizes.clear();sizes.push_back(block1len);sizes.push_back(block3len);sizes.push_back(block2len);
        TestCheckChildSize(session, iwsession, sizes, 0);

// Same, but right does not exist
        sizes.clear();sizes.push_back(block2len);sizes.push_back(block3len);sizes.push_back(block1len);
        TestCheckChildSize(session, iwsession, sizes, 2);

        //-- CheckTreeRoot -----------------------------------------------------

        // superblock overflow, just.
        AllocateBlocks(session, &base);at = base->begin();
        FillBlock(*base, 0, 0, C_Index::InsertDelete::MaxSize+1, 0);

        iwsession.admin->treedepth = 1;
        iwsession.admin->superblockno = base.GetBlockId();

        list = GetTreeEntryList(session, base);
        iwsession.CheckTreeRoot();
        BLEX_TEST_CHECK(equal(session, iwsession.admin->superblockno, list));
        FreeTree(session, iwsession.admin->superblockno);

        // superblock overflow, max
        AllocateBlocks(session, &base);at = base->begin();
        FillBlock(*base, 0, 0, C_Block::MaxData, 0);

        iwsession.admin->treedepth = 1;
        iwsession.admin->superblockno = base.GetBlockId();

        list = GetTreeEntryList(session, base);
        iwsession.CheckTreeRoot();
        BLEX_TEST_CHECK(equal(session, iwsession.admin->superblockno, list));
        FreeTree(session, iwsession.admin->superblockno);

        // superblock 2 children, they overflow. (left full)
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        totalsize = 2*C_Index::InsertDelete::MaxSize + 1;
        FillBlock(*left, 0, 0, std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen), 5000);
        FillBlock(*right, 0, 0, totalsize - atlen - left->FillSize(), 15000);

        FillBlock(*base, atlen, 0, atlen + IndexBlockEntry::EOBSize, 10000);

        Operation_1(base,left,right);

        iwsession.admin->treedepth = 1;
        iwsession.admin->superblockno = base.GetBlockId();
        list = GetTreeEntryList(session, base);
        iwsession.CheckTreeRoot();
        BLEX_TEST_CHECK(equal(session, iwsession.admin->superblockno, list));
        FreeTree(session, iwsession.admin->superblockno);

        // superblock 2 children, they overflow. (right full)
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        totalsize = 2*C_Index::InsertDelete::MaxSize + 1;
        FillBlock(*right, 0, 0, std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen), 15000);
        FillBlock(*left, 0, 0, totalsize - atlen - right->FillSize(), 5000);

        FillBlock(*base, atlen, 0, atlen + IndexBlockEntry::EOBSize, 10000);

        Operation_1(base,left,right);

        iwsession.admin->treedepth = 1;
        iwsession.admin->superblockno = base.GetBlockId();
        list = GetTreeEntryList(session, base);
        iwsession.CheckTreeRoot();
        BLEX_TEST_CHECK(equal(session, iwsession.admin->superblockno, list));
        FreeTree(session, iwsession.admin->superblockno);

        // superblock 2 children, they just underflow
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        totalsize = C_Index::InsertDelete::LowMinSize + C_Index::MinBlockFill - 1;
        FillBlock(*right, 0, 0, std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen), 15000);
        FillBlock(*left, 0, 0, totalsize - atlen - right->FillSize(), 5000);

        FillBlock(*base, atlen, 0, atlen + IndexBlockEntry::EOBSize, 10000);

        Operation_1(base,left,right);

        iwsession.admin->treedepth = 1;
        iwsession.admin->superblockno = base.GetBlockId();
        list = GetTreeEntryList(session, base);
        iwsession.CheckTreeRoot();
        BLEX_TEST_CHECK(equal(session, iwsession.admin->superblockno, list));
        FreeTree(session, iwsession.admin->superblockno);

        // superblock 2 children, they max underflow
        AllocateBlocks(session, &base, &left, &right);at = base->begin();
        totalsize = 2*C_Index::MinBlockFill;
        FillBlock(*right, 0, 0, std::min<unsigned>(C_Block::MaxData, totalsize-IndexBlockEntry::EOBSize-atlen), 15000);
        FillBlock(*left, 0, 0, totalsize - atlen - right->FillSize(), 5000);

        FillBlock(*base, atlen, 0, atlen + IndexBlockEntry::EOBSize, 10000);

        Operation_1(base,left,right);

        iwsession.admin->treedepth = 1;
        iwsession.admin->superblockno = base.GetBlockId();
        list = GetTreeEntryList(session, base);
        iwsession.CheckTreeRoot();
        BLEX_TEST_CHECK(equal(session, iwsession.admin->superblockno, list));
        FreeTree(session, iwsession.admin->superblockno);

        // BLEX_TEST_CHECK if bounds were not violated
        for (unsigned i = 0; i < borderblocks.size(); ++i)
        {
                uint8_t* block = session.LockBlock(borderblocks[i]);
                BLEX_TEST_CHECK(std::search_n(block, block + C_Block::Size, static_cast<signed>(C_Block::Size), 0xCC) == block);
                session.UnlockBlock(borderblocks[i], block, false);
        }
}


