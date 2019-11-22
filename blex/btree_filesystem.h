#ifndef blex_btree_filesystem
#define blex_btree_filesystem

#include "mmapfile.h"
#include "bitmanip.h"

#include "btree_blocks.h"

namespace Blex
{
namespace Index
{

/* *** Constants *** */

/* index block file */
namespace C_Indexfile
{
 /* Global constants */

 // Number of blocks in section
 static const unsigned BlocksPerSection = 32;
 // Size of a section
 static const unsigned SectionSize = BlocksPerSection * C_Block::Size; // This is 128 kb now (32*4096)
 // Number of cached sections
 static const unsigned SectionsCached = 16384; // This is 2GB now (16384*128kb) (2048 for 256mb, 2048*128kb)
}

struct Statistics
{
        /// Default constructor
        Statistics()
        : totalentries(0)
        , totalblocks(0)
        , duplicates(0)
        , totalentrysize(0)
        {
        }

        /// Reading statistics from file. In: ptr points to data, out: ptr points to just after data
        void Read(Blex::Stream &file);

        /// Writes out statistics to file
        void Write(Blex::Stream &file) const;

        /// Total number of entries in this index
        uint32_t totalentries;

        /// Total number of blocks in this index
        uint32_t totalblocks;

        /** Total number of duplicate values in entries (not counting firsts). Defined on default sorting order
            So, for strings this is the number of case-insensitive duplicates. Expected number of results for
            exact queries is totalentries/(totalentries-duplicates) */
        uint32_t duplicates;

        /// Total size of all data and NULL entries in the index
        uint64_t totalentrysize;

        /// Returns number of estimated results on an average query with relationtype Equal
        uint32_t EqualQueryResultsEstimate() const
        {
                if (totalentries!=0 && duplicates<totalentries) //ADDME: Check should be unnecessary
                    return totalentries / (totalentries - duplicates);
                else
                    return  0;
        }

        bool operator ==(const Statistics &rhs) const;
        bool operator !=(const Statistics &rhs) const
        {
                return !(*this == rhs);
        }
};

class BtreeIndex;
class IndexBlock;
class IndexBlockEntry;
class IndexBlockEntryContainer;
class IndexBlockIterator;

/* *** Global index constants *** */
namespace C_Index
{
 /* Global constants */
 /// Minimum fillsize of block (not superblocks, or childs of superblock when superblock has only 2 childs)
 static const unsigned MinBlockFill = C_Block::MaxData / 2 + IndexBlockEntry::EOBSize;
 /// Maximum fillsize of blocks
 static const unsigned MaxBlockFill = C_Block::MaxData;
 /// Estimated average fillsize of block. ADDME: check this estimate
 static const unsigned AverageBlockFill = (MinBlockFill + MaxBlockFill) / 2;
 /// Minimum number of entries in block (not superblocks, or childs of superblock when superblock has only 2 childs)
 static const unsigned MinFanout = MinBlockFill / IndexBlockEntry::MaxEntrySize;

 /* Constants for insert and delete */
 namespace InsertDelete
 {
  /** CheckChildSize can cause the fill of the parent block to change with a maximum of IndexBlockEntry::MaxEntrySize
     + IndexBlockEntry::MaxDataSize. */
  static const unsigned CheckChildSizeMaxModificationSize = IndexBlockEntry::MaxEntrySize + IndexBlockEntry::MaxDataSize;

  /** Minimum fillsize a block should have before letting CheckChildSize mess with it's children, and inserting or deleting
      an entry, without violating MinBlockFill bound. Inserts do not occur in parents, deletes act like a replace.
      The replace is always done on a entry that has been fiddled with, so the bounds can not be violated anymore.
      Extreme case: CheckChildSize decreases fillsize with CheckChildSizeMaxModificationSize */
  static const unsigned MinSize = MinBlockFill + CheckChildSizeMaxModificationSize;

  /** Maximum fillsize a block should have before letting CheckChildSize mess with it's children, and inserting or deleting
      an entry, without violating MaxBlockFill bound. Inserts do not occur in parents, deletes act like a replace.
      The replace is always done on a entry that has been fiddled with, so the bounds can not be violated anymore.
      Extreme case: CheckChildSize increases fillsize with CheckChildSizeMaxModificationSize */
  static const unsigned MaxSize = C_Block::MaxData - CheckChildSizeMaxModificationSize;

  /** Minimum fillsize of children of superblock (only when superblock has only 2 children!).
      Chosen so that LowMinSize = 0.5*average(MinSize, MaxSize). */
  static const unsigned LowMinSize = (MinSize + MaxSize) / 4;
 }
}

/** DBIndexFileSystem

    The IndexFileSystem manages the memory-mapped file, and tries to make sure
    that queries, inserts etc. don't deadlock when the mmapped file has to be
    expanded.
    To do something (read, write) a session object has to be opened. In the
    session the operations on the file can be performed.
    All sessions can operate simultaneously, except when the mmapped file has
    to be expanded. In that case, no new sessions will be allowed to start, and
    when the current sessions have ended the file will be expanded.
    WARNING!!!! A THREAD EXECTUTING A READ SESSION MAY NOT WAIT FOR COMPLETION
    OF A READWRITE SESSION TO END!!!This will cause deadlock when the mmapped
    file has to appended.

    Destruction of a session does not free the blocks that were requested, that
    blocks must explicitly be freed (destruction of the SectionFileLocker will
    do the job, though).

    Threading considerations
    - All operations are thread-safe.
    - Deadlock can occur when an operation within read session waits for write session to complete.
    */

class BLEXLIB_PUBLIC DBIndexFileSystem
{
    private:
        /** Sectionfile, to store the raw blocks */
        std::unique_ptr<Blex::SectionFile> sectionfile;

        /** Structure to capture free block and file administration */
        struct FSData
        {
                FSData()
                {
                        highestindex = 0;
                }

                /** Parse the blocklist from a config file */
                void ReadBlocklist(Blex::Stream &indata);

                /** Write the blocklist to a config file */
                void WriteBlocklist(Blex::Stream &outdata);

                struct Cluster
                {
                        inline Cluster()
                        : indexid(0)
                        {
                                memset(freeblocks, 255, sizeof(freeblocks));
                        }

                        typedef Blex::BitmapType FreeBlocks[C_Indexfile::BlocksPerSection/32]; //constant expression required, so hardcoded 32... an assert( in .cpp verifies

                        ///Bit indicating free blocks in this cluster
                        FreeBlocks freeblocks;
                        ///Index ID for cluster (currently only used to cluster index blocks, not used to indicate actual onwership). 0 is unallocated
                        unsigned indexid;
                };

                static inline unsigned GetClusterForBlock(BlockId blockid)
                {
                        return blockid/C_Indexfile::BlocksPerSection;
                }
                static inline unsigned GetBlockInsideCluster(BlockId blockid)
                {
                        return blockid%C_Indexfile::BlocksPerSection;
                }
                static inline unsigned CalcBlockId(unsigned cluster, unsigned block)
                {
                        return cluster * C_Indexfile::BlocksPerSection + block;
                }

                /** boolean-pattern, indicates being in-use of blocks */
                std::vector<Cluster> clusters;
                /// Highest index id in use
                unsigned highestindex;
        };

#ifdef DEBUG
        typedef Blex::InterlockedData<FSData,Blex::DebugMutex> LockedFSData;
#else
        typedef Blex::InterlockedData<FSData,Blex::Mutex> LockedFSData;
#endif

        LockedFSData fsdata;

        DBIndexFileSystem(DBIndexFileSystem const &) = delete;
        DBIndexFileSystem& operator=(DBIndexFileSystem const &) = delete;

    public:
        /** Opens index-file. Recreates file if not existing.
            @param metadatafile If not NULL, a stream supplying state info previously saved by SaveState
            @param config Configuration object
            @param new_system Fail if index files already exist when opened */
        DBIndexFileSystem(std::string const &filename, Blex::Stream *metadatafile, bool new_system, bool sync);

        /** Destructor. Closes the file */
        ~DBIndexFileSystem() throw();

        /** Allocate a new index id */
        unsigned GetFreeIndexId();

        /** Get the index id for a specified block*/
        unsigned GetIndexId(BlockId block);

        /** Flsuh the index file. Throw an ErrorIO on flush error to prevent
            us from marking an unflushed index as valid. */
        void FlushFile();

        /** Request us to send our configuration data to a config file (ADDME: MT
            considerations? should probably not be called with any open sessions..) */
        void SaveFSState(Blex::Stream &metadata_file);

        /** General session class. Used by ReadSession and ReadWriteSession. Contains
            all operations supported by both objects. May not be instantiated. */
        class Session
        {
        public:
                /** Gets data address of specified block. Block must afterwards be released by ReleaseBlock. Throws
                    exception on read error, etc.
                    @param blockno Specifies number of block
                    @return Data of block. */
                uint8_t* LockBlock(BlockId blockno);

                /** Releases specified block. Data address gotten with GetBlock is not valid after this call.
                    @param blockno Specifies number of block
                    @param blockaddress Address of the block
                    @param written Whether the block has been written to (is dirty) */
                void UnlockBlock(BlockId blockno, uint8_t const *blockaddress, bool written);

        protected:
                /** Constructor. Constructs a file session. Throws Exception
                    @param _locker SectionFile::Locker to use
                    @param _filesystem DBIndexFileSystem to use */
                Session(DBIndexFileSystem &_filesystem);

                /// DBIndexFileSystem object to use
                DBIndexFileSystem &filesystem;
        public:
                ~Session();
        };

        /** ReadSession class. Can be used for read-only operations. Waits for mmap-append operations
            to wait, then returns. */

        class ReadSession : public Session
        {
        public:
                /** Constructor. Throws Exception
                    @param _locker SectionFile::Locker to use
                    @param _filesystem DBIndexFileSystem to use */
                ReadSession(DBIndexFileSystem &_filesystem);
        };

        /** Keeps records for sessions in which blocks will be written. Initially, a number of blocks
            must be reserved. At any time, the number of newly allocated blocks
            within the session may NOT exceed the number of reserved blocks.
            If mmap file is too small to guarantee the number of free blocks, the mmap file will be expanded
            after all other sessions have ended (also no new sessions will be allowed). */

        class ReadWriteSession : public Session
        {
        public:
                /** Constructor. Throws Exception
                    @param _locker SectionFile::Locker to use
                    @param _filesystem DBIndexFileSystem to use */
                ReadWriteSession(DBIndexFileSystem &_filesystem);

                ~ReadWriteSession();

                /** Allocates new block. Throws exception on error.
                    @param childblockid Childblockid that must be put in the eob of the block
                    @return Number of new block */
                BlockId AllocateBlock(unsigned indexid, BlockId childblockid);

                /** Frees specified block.
                    @param Number of block to free */
                void FreeBlock(BlockId blockno);
        };

        /** Updates the file modification timestamp */
        bool SetModificationDate(Blex::DateTime newtime);

        void GenerationalCleanupUnusedSections(volatile uint32_t *abortflag);

        // Allow Sessions to use sectionfile
        friend class Session;
        // Allow ReadWrite sessions to use freeblockadmin
        friend class ReadWriteSession;
};

/** A smart pointer for blocks, bound to a session and automatically locking
    and unlocking blocks

    ADDME: Unfortunately, this smart ptr does NOT enforce proper write
    protection (it permits passing a Read-only session, and using it to write)

    const-ness is not transitive. A const SmartBlockPtr still allows access
    to its contained block */
class SmartBlockPtr
{
        public:
        /** Construct an unused SmartBlockPtr
        explicit SmartBlockPtr(DBIndexFileSystem::Session &_session)
        : session(_session)
        , blockid(0)
        , lockedblock(_session)
        {
        }*/

        /** Load and lock a block */
        SmartBlockPtr(DBIndexFileSystem::Session &_session, BlockId _blockid);

        /** Destroy and unlock any locked block */
        ~SmartBlockPtr();

        /** ADDME: Can't we get rid of these copy constructors and assigment operators ? */
        SmartBlockPtr(SmartBlockPtr const &src);
        SmartBlockPtr& operator=(SmartBlockPtr const &src);

        IndexBlock& operator* () const
        { return const_cast<IndexBlock&> (lockedblock); }
        IndexBlock* operator-> () const
        { return const_cast<IndexBlock*> (&lockedblock); }

        inline BlockId GetBlockId() const { return blockid; }

     private:
        DBIndexFileSystem::Session &session;
        BlockId blockid;
        IndexBlock lockedblock;
};

/** Index class, contains an index.

    Access to the index is splitted into read- and writesessions, to isolate
    reads and writes to (and from) a index. */
class BLEXLIB_PUBLIC BtreeIndex
{
    public: // ADDME: publication to make tree analysis possible
        class ReadSession;
        class WriteSession;
        friend class ReadSession;
        // WriteSession may also touch index's private parts, is more trusted than evil world.
        friend class WriteSession;

        /// Name of the index (very useful for debugging)
        std::string indexname;
    private:
        /** Administration structure. All state (modifyable or not) of an index is put into
            thisstructure. Read sessions must get a read reference, inserts and deletes must
            get a write lock (synchronisation on sessions is also done with this struct */
        struct Admin
        {
                /// Depth of tree
                uint32_t treedepth;

                /// Superblock number
                BlockId superblockno;

                /// Statistics object
                Statistics statistics;

                /// My index id
                unsigned indexid;
        };
        typedef Blex::InterlockedData<Admin, Blex::Mutex> LockedAdmin;
        LockedAdmin admin;

        /// File system used by index
        DBIndexFileSystem& filesystem;

        /// Types of actions
        enum ActionType
        {
                Find,
                Insert,
                Delete
        };

        /** Stack used to walk the index-tree. Used both by read and write sessions */
        class Stack
        {
                public:
                /** Element in index-tree walk stack. Contains a block and an iterator within
                    that block. */
                class Element
                {
                    public:
                        SmartBlockPtr blockptr;
                        IndexBlockIterator current;

                        Element(DBIndexFileSystem::Session &session, BlockId blockno)
                        : blockptr(session,blockno)
                        , current(blockptr->begin())
                        {
                        }
                };

            private:
                /// Reference to read- or writelocked administration of index.
                const Admin &admin;

                /// Reference to read- or writesession on the filesystem
                DBIndexFileSystem::Session &filesession;

                /// Stack
                std::vector<Element*> innerstack;

            public:
                /** Returns the depth of the current walk into the stack */
                uint32_t size() const
                {
                        return innerstack.size();
                }

                /** Walk one level deeper, follow the childblockid on the entry that is now
                    pointed to by the iterator on the current top of the stack */
                void followchild();

                /** Goes back one step back */
                void pop();

                const Element& operator[](uint32_t index) const
                {
                        return *const_cast<Stack*>(this)->innerstack[index];
                }

                /** Returns the top of the current stack */
                const Element& top() const
                {
                        return *innerstack.back();
                }
                Element& top()
                {
                        return *innerstack.back();
                }

                /** Searches for first entry bigger or equal to given entry. Does not descend!
                    @param entry Entry to search for */
                void MoveToFirstBiggerOrEqual(const IndexBlockEntry& entry);
                void MoveToFirstBigger(const IndexBlockEntry& entry);

                Stack(const Admin& _admin, DBIndexFileSystem::Session &_filesession);
                ~Stack();
                private:
                Stack& operator=(Stack const&);
                Stack(Stack const&);
        };

        class IndexIterator : public std::iterator<std::bidirectional_iterator_tag, const IndexBlockEntry>
        {
            private:
//                ReadSession &xsession;
                const Admin &admin;
                Stack stack;

                // Makes an indexitor from an existing stack
                //IndexIterator(const Admin &_admin, const Stack &_stack);

                friend uint32_t EstimateDistance(const IndexIterator &a, const IndexIterator &b);

            public:
                // Atend signifies if iterator is placed at the end or not.
                IndexIterator(const Admin &_admin, DBIndexFileSystem::Session &_session, bool atend);

                void MoveToBegin();
                void MoveToEnd();

                IndexIterator& operator ++();
                //IndexIterator operator++(int);

                IndexIterator& operator --();
                //IndexIterator operator--(int);

                const IndexBlockEntry& operator*() const { return *stack.top().current; }
                const IndexBlockEntry* operator->() const { return &*stack.top().current; }
                int32_t CompareTo(const IndexIterator& rhs) const;

                bool operator <(const IndexIterator& rhs) const { return CompareTo(rhs)<0; }
                bool operator >(const IndexIterator& rhs) const { return CompareTo(rhs)>0; }
                bool operator ==(const IndexIterator& rhs) const { return CompareTo(rhs)==0; }
                bool operator !=(const IndexIterator& rhs) const { return CompareTo(rhs)!=0; }
                bool operator <=(const IndexIterator& rhs) const { return CompareTo(rhs)<=0; }
                bool operator >=(const IndexIterator& rhs) const { return CompareTo(rhs)>=0; }

                void MoveToFirstBiggerOrEqual(const IndexBlockEntry& entry) { stack.MoveToFirstBiggerOrEqual(entry); }
                void MoveToFirstBigger(const IndexBlockEntry& entry) { stack.MoveToFirstBigger(entry); }

                friend class ReadSession;
                friend class WriteSession;
                friend class BtreeIndex;
        };
        friend uint32_t EstimateDistance(const IndexIterator &a, const IndexIterator &b);

        BtreeIndex(BtreeIndex const &) = delete;
        BtreeIndex& operator=(BtreeIndex const &) = delete;

    public:
        /** ReadSession - all functions only used for reading from the index are placed here */
        class ReadSession
        {
            public:
                /// Read session on the file-system
                DBIndexFileSystem::ReadSession filesession;

                /// Index administration, locked for reading
                LockedAdmin::ReadRef admin;

                explicit ReadSession(BtreeIndex &_index);

                ReadSession(ReadSession const &) = delete;
                ReadSession& operator=(ReadSession const &) = delete;

/*                IndexIterator begin() { return IndexIterator(*admin, filesession, false); }
                IndexIterator end() { return IndexIterator(*admin, filesession, true); }*/
        };

        /** WriteSession - all functions used for writing to an index are placed here */
        class WriteSession
        {
            // private: // ADDME: make private again, now public for testing
            public:
                /** Rebalances childblock of at (hereafter named left), and childblock of at+1 (named right).

                    balancepoint controls the redistribution. If balancepoint is negative, it will be
                    treated as if balancepoint + totalsize was passed
                    ( totalsize = left.FillSize() + at.EntrySize() + right.FillSize() ).

                    Preconditions: (balancepoint > 0)
                    1. (IndexBlockEntry::EOBSize <= balancepoint <= totalsize - IndexBlockEntry::EOBSize)
                    2. ((balancepoint <= C_Block::MaxData) && (totalsize - C_Block::MaxData <= balancepoint))
                    3. baseblock.FillSize() - at->GetEntryLength() + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData
                    4. at != EOB

                    Postconditions: (balancepoint > 0)
                    1. balancepoint - MaxEntrySize <= new_left.fillsize <= balancepoint
                    2. (totalSize - balancepoint) - MaxEntrySize <= new_right.fillsize <= (totalSize - balancepoint)
                    3. abs(new_baseblock.FillSize - old_baseblock.FillSize) <= IndexBlockEntry::MaxDataSize

                    Example: 6 as balancepoint guarantees a maximum of 6 bytes in left after redistribution,
                    -6 as balancepoint guarantees a maximum of 6 bytes in right after redistribution.

                    @param baseblock Block containing 'at'
                    @param at Iterator pointing to entry
                    @param balancepoint Point where new median can be found. */
                void Redistribute(IndexBlock &baseblock, IndexBlockIterator at, int32_t balancepoint);

                /** Redistributes childblock of at (left), at itself and childblock of (at+1) (right), with
                    the balancepoint right in the middle.

                    totalsize = left.FillSize() + at.EntrySize() + right.FillSize()

                    Average2 will guaranteed return true when the following conditions hold:
                    1. totalsize >= 2*(C_Index::InsertDelete::MinSize + IndexBlockEntry::MaxEntrySize) (no underflow will happen)
                    2. totalsize <= 2*(C_Index::InsertDelete::MaxSize) (no overflow will happen)

                    Preconditions:
                    1. at != EOB
                    2. baseblock.FillSize() - at->GetEntryLength() + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData

                    Postconditions: (balancepoint > 0)
                    if retval == true
                     1. abs(new_baseblock.FillSize - old_baseblock.FillSize) <= IndexBlockEntry::MaxDataSize
                     2. totalsize / 2 - IndexBlockEntry::MaxEntrySize <= new_left.FillSize() <= totalsize / 2
                     3. (totalsize+1) / 2 - IndexBlockEntry::MaxEntrySize <= new_right.FillSize() <= (totalsize+1) / 2
                     4. C_Index::InsertDelete::MinSize <= new_left.FillSize() <= C_Index::InsertDelete::MaxSize
                     5. C_Index::InsertDelete::MinSize <= new_right.FillSize() <= C_Index::InsertDelete::MaxSize
                     6. abs(new_baseblock.FillSize - old_baseblock.FillSize) <= IndexBlockEntry::MaxDataSize
                    end

                    @param baseblock Block containing 'at'
                    @param at Iterator pointing to entry
                    @return Returns TRUE indicates succesfull rebalance, FALSE if a block would under- or overflow due to the rebalancing. Nothing happens in the latter case */
                bool Average2(IndexBlock &baseblock, IndexBlockIterator at);

                /** Redistributes childblock of at (left), at itself and childblock of (at+1) (right), with
                    the balancepoint right in the middle. This function differs only from Average2 in that
                    it has lower fillsize postconditions for left and right. It may only be used for
                    children of superblock, when superblock has only 2 children.

                    totalsize = left.FillSize() + at.EntrySize() + right.FillSize()

                    Average2WithLowerBound will guaranteed return true when the following conditions hold:
                    1. totalsize >= 2* C_Index::InsertDelete::LowMinSize + 2*IndexBlockEntry::MaxEntrySize) (no underflow will happen)
                    2. totalsize <= 2* C_Index::InsertDelete::MaxSize (no overflow will happen)

                    Preconditions:
                    1. at != EOB
                    2. baseblock.FillSize() - at->GetEntryLength() + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData

                    Postconditions: (balancepoint > 0)
                    if retval == true
                     1. abs(new_baseblock.FillSize - old_baseblock.FillSize) <= IndexBlockEntry::MaxDataSize
                     2. totalsize / 2 - IndexBlockEntry::MaxEntrySize <= new_left.FillSize() <= totalsize / 2
                     3. (totalsize+1) / 2 - IndexBlockEntry::MaxEntrySize <= new_right.FillSize() <= (totalsize+1) / 2
                     4. C_Index::InsertDelete::LowMinSize <= new_left.FillSize() <= C_Index::InsertDelete::MaxSize
                     5. C_Index::InsertDelete::LowMinSize <= new_right.FillSize() <= C_Index::InsertDelete::MaxSize
                     6. abs(new_baseblock.FillSize - old_baseblock.FillSize) <= IndexBlockEntry::MaxDataSize
                    end

                    @param baseblock Block containing 'at'
                    @param at Iterator pointing to entry
                    @return Returns TRUE indicates succesfull rebalance, FALSE if a block would under- or overflow due to the rebalancing. Nothing happens in the latter case */
                bool Average2WithLowerBound(IndexBlock &baseblock, IndexBlockIterator at);

                /** Redistributes evenly all entries of childblock of at (name: left), at itself, childblock of (at+1) (name: middle), at+1 and childblock of (at+2) (name: right).

                    totalsize = left.FillSize() + at->EntryLength() + middle.FillSize() + (at+1)->EntryLength() + right.FillSize()

                    Average3 will guaranteed return true when the following conditions hold:
                    1. totalsize >= 3* C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize) (no underflow will happen)
                    2. totalsize <= 3* C_Index::InsertDelete::MaxSize (no overflow will happen)
                    When false is returned, one of these is most likely violated.

                    Pre:
                    1. ('at' != EOB) && (('at'+1) != EOB)
                    2. baseblock.FillSize() - at->GetEntryLength() - (at+1)->GetEntryLength()
                                     + 2*IndexBlockEntry::MaxEntrySize <= C_Block::MaxData

                    Post: (when returnvalue == true)
                    1. abs(new_baseblock.FillSize() - old_baseblock.FillSize()) <= 2*IndexBlockEntry::MaxDataSize
                    2. C_Index::InsertDelete::MinSize <= totalsize/3 - IndexBlockEntry::MaxEntrySize <=
                                         left.FillSize(), right.FillSize() <=
                                      totalsize/3 <= C_Index::InsertDelete::MaxSize
                    3. C_Index::InsertDelete::MinSize <= (totalsize+2)/3 - 2*IndexBlockEntry::MaxEntrySize <=
                                                   middle.FillSize() <=
                                     (totalsize+2)/3 <= C_Index::InsertDelete::MaxSize

                    @param at Iterator pointing to at.
                    @param rwsession Read-write session in which this operation happens
                    @return Returns TRUE indicates succesfull rebalance, FALSE if a block would over- or underflow after rebalancing. Nothing happens in this case */
                bool Average3(IndexBlock &baseblock, IndexBlockIterator at);

                /** Splits entries in childblock of 'at' (hereafter named child) into 2 childblocks (and a new entry).
                    It may only be used on a old superblock, that is the only child of a new superblock

                    Preconditions:
                    1. 'at' != EOB
                    2. baseblock.FillSize() + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData
                    3. child.FillSize() >= 2*C_Index::InsertDelete::LowMinSize + 2* IndexBlockEntry::MaxEntrySize

                    After calling Splice1, at points to a childblock (left), and (at+1) points to the
                    next childblock (right)

                    Postconditions
                    1. child.FillSize() / 2 - IndexBlockEntry::MaxEntrySize <= left.FillSize() <= child.FillSize() / 2
                    2. (child.FillSize()+1) / 2 - IndexBlockEntry::MaxEntrySize <= right.FillSize() <= (child.FillSize()+1) / 2
                    3. C_Index::InsertDelete::LowMinSize <= left.FillSize() <= C_Index::InsertDelete::MaxSize
                    4. C_Index::InsertDelete::LowMinSize <= right.FillSize() <= C_Index::InsertDelete::MaxSize
                    5. old_baseblock.FillSize() <= new_baseblock.FillSize() <= old_baseblock.FillSize() + IndexBlockEntry::MaxEntrySize

                    @param baseblock Block containing 'at'
                    @param at Iterator */
                void Splice1(IndexBlock &baseblock, IndexBlockIterator at);

                /** Balances entries in this childblock of at (name: left) and childblock of 'at'+1 (name: right) over 3 blocks
                    (name of new block: middle)

                    totalsize = left.FillSize() + at.Entrylength() + right.FillSize()

                    Pre:
                    1. 'at' != EOB
                    2. baseblock.FillSize() + 2 * IndexBlockEntry::MaxEntrySize - at.EntryLength() <= C_Block::MaxData
                    3. totalsize >= 3*C_Index::InsertDelete::MinSize + 6*IndexBlockEntry::MaxEntrySize

                    Post:
                    Blocksizes: see postconditions on Average3
                    +. old_baseblock.FillSize() + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxEntryData <=
                         new_baseblock.FillSize() <=
                         old_baseblock.FillSize() + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize

                    @param at Iterator pointing to an entry before which the new entry must be inserted
                    @param rwsession Read-write session in which this operation happens */
                void Splice2(IndexBlock &baseblock, IndexBlockIterator at);

                /** Recombines entries of childblock of at (name: left), *at and the entries in the childblock of (at+1) (name: right) into the childblock of 'at'.

                    totalsize = left.FillSize() + at.EntrySize() + right.EntrySize().

                    Pre:
                    1. 'at' != EOB
                    2. totalsize - IndexBlockEntry::EOBSize <= C_Index::InsertDelete::MaxSize
                    2. base.FillSize() - at->GetEntryLength() + IndexBlockEntry::MaxEntrySize <= C_Block::MaxData

                    Post:
                    1. old_baseblock.FillSize() - IndexBlockEntry::MaxEntrySize <= new_baseblock.FillSize() = old_baseblock.FillSize() - at.EntryLength()
                    2. at->child.FillSize() == totalsize - IndexBlockEntry::EOBSize
                    3. old_baseblock.FillSize() - IndexBlockEntry::MaxEntrySize <= new_baseblock.FillSize() <= old_baseblock.FillSize()

                    @param baseblock Block containing 'at'
                    @param at Iterator */
                void Recombine2(IndexBlock &baseblock, IndexBlockIterator at);

                /** Recombines entries of childblock of at, at itself, the entries in the childblock of (at+1)
                    (at+1) and the entries in the childblock of (at+2) into 1 entries and 2 childblocks.
                    Only used when the only 2 children of the superblock must be merged.

                    totalsize = left.FillSize() + at->EntryLength() + middle.FillSize() + (at+1)->EntryLength() + right.FillSize()

                    Pre:
                    1. ('at' != EOB) && (('at'+1) != EOB)
                    2. baseblock.FillSize() - at->getEntryLenght() - (at+1)->GetEntryLength() + 2*IndexBlockEntry::MaxEntrySize <= C_Block::MaxData
                    3. 2*C_Index::InsertDelete::MinSize + 2*IndexBlockEntry::MaxEntrySize
                                <= totalsize - IndexBlockEntry::EOBSize
                                        <= 2*C_Index::InsertDelete::MaxSize

                    Post:
                    1. C_Index::InsertDelete::MinSize <=
                        left.FillSize(), right.FillSize() <=
                         C_Index::InsertDelete::MaxSize
                    2. old_baseblock.FillSize() - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxDataSize <=
                         new_baseblock.FillSize() <=
                         old_baseblock.FillSize() + IndexBlockEntry::MaxDataSize - IndexBlockEntry::HeaderSize

                    @param baseblock Block containing 'at'
                    @param at Iterator */
                void Recombine3(IndexBlock &baseblock, IndexBlockIterator at);

                /** Checks childblock of at (name: child) for size requirements, and rebalances if it does not meet them
                    ( C_Index::InsertDelete::MinSize <= fillsize <= C_Index::InsertDelete::MaxSize)

                    It guarantees that, after calling, all entries in the range
                    [ *at->ChildBlock.begin(), *at->ChildBlock.eob() ) + {*at}
                    are either in a childblock that meets size requirements, or in baseblock.

                    It may only called once per baseblock, after that only on childblocks that meet size requirements.
                    CheckTreeRoot must be called for the root of the tree before calling this function.

                    ADDME: Fix this function name: it's name suggests it is just checking
                           but it's actually MODIFYING stuff!

                    Pre:
                    1. C_Index::InsertDelete::LowMinSize <= baseblock.FillSize() <= C_Index::InsertDelete::MaxSize

                    Post:
                    if return_value == true
                     1. C_Index::InsertDelete::MinSize <= child.FillSize() <= C_Index::InsertDelete::MaxSize
                    else
                     The entry that 'at' points to has been changed.
                     1. *new_at <= *old_at

                     After average2:
                       abs(new_baseblock.FillSize - old_baseblock.FillSize) <= IndexBlockEntry::MaxDataSize
                     After Splice2 (average2 failed!, at->child.fillsize > C_Block::InsertDelete::MaxSize)
                       old_baseblock.FillSize() + IndexBlockEntry::HeaderSize - IndexBlockEntry::MaxEntryData <=
                         new_baseblock.FillSize() <=
                         old_baseblock.FillSize() + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize
                     After Average3 (average2 failed, at->child.fillsize < C_Block::InsertDelete::MinSize)
                       old_baseblock.FillSize() - 2*IndexBlockEntry::MaxDataSize <=
                         new_baseblock.FillSize() <=
                         old_baseblock.FillSize()+ 2*IndexBlockEntry::MaxDataSize
                     After Recombine3 (average3 failed)
                       old_baseblock.FillSize() - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxEntryData <=
                         new_baseblock.FillSize() <=
                         old_baseblock.FillSize() + IndexBlockEntry::MaxDataSize - IndexBlockEntry::HeaderSize

                     Lowest: - IndexBlockEntry::MaxEntrySize - IndexBlockEntry::MaxEntryData (after recombine3)
                     Highest: + IndexBlockEntry::MaxDataSize + IndexBlockEntry::MaxEntrySize (after splice2)

                     2. abs(old_baseblock.FillSize() - new_baseblock.FillSize()) <= CheckChildSizeMaxModificationSize
                     3. new_baseblock.FillSize() <= C_Index::MaxBlockFill - IndexBlockEntry::MaxDataSize
                    end

                    @param baseblock Block containing 'at'
                    @param at Iterator pointing to entry whose childblock must be checked */
                bool CheckChildSize(IndexBlock &baseblock, IndexBlockIterator &at);

                WriteSession(WriteSession const &) = delete;
                WriteSession& operator=(WriteSession const &) = delete;

            public:
                /// Write session on the file-system
                DBIndexFileSystem::ReadWriteSession filesession;

                /// Index administration, locked for writing
                LockedAdmin::WriteRef admin;

                explicit WriteSession(BtreeIndex &_index);

                /** Checks the tree-root for guarantees. Call this before an insert or delete, to
                    make sure that fiddeling with the tree root will not cause overflows or
                    underflows (or guarantee violations). It makes sure that when the superblock contains 2
                    subblocks, CheckChildSize will not make modifications. */
                void CheckTreeRoot();

                /** Searches for entry in index, while guaranteeing that inserts and deletes can take place
                    on the tree after finding it. If entry is not found, stack points to place in leaf
                    where entry should be inserted, just after highest entry smaller than entry (in the subtree
                    pointed to by stack on entry.
                    Guarantees per requester:
                    Find: no guarantees are checked
                    Insert: One insert in the block pointed to by the stack will not break the guarantees
                    Delete: One insert or delete in this block, OR in the childblock of this block will not break the guarantees
                    @param Stack to use for the walk toward the entry
                    @param entry to search for
                    @param requester Type of guarantees to make sure exist */
                bool MoveUpwardTowardEntry(Stack &stack, IndexBlockEntry const &entry, ActionType requester);

                /** Destroys a subtree of an index (frees all blocks in subtree, including root)
                    @param base superblock of subtree
                    @param depth of subtree */
                void DestroySubtree(SmartBlockPtr const &base, uint32_t depth);

                /** Checks if entry pointed to by stack, and the entry before that one are
                    duplicates of entry.
                    @param Stack stack pointing to second entry
                    @param entry to compare with
                    @return TRUE if one of entries pointed by stack, and entry before that is equal to entry */
                bool IsDuplicate(Stack &stack, const IndexBlockEntry& entry);

                /*IndexIterator begin() { return IndexIterator(*admin, filesession, false); }
                IndexIterator end() { return IndexIterator(*admin, filesession, true); }*/
        };

    public:
        /** Creates an new, empty index.
            @param manager Resource manager for the indexing system
            @param _filesystem Filesystem to use for reading and writing
            @param locker Locker that can be used for accessing the index filesystem */
        BtreeIndex(DBIndexFileSystem &_filesystem, std::string const &_name);

        /** Creates a object for an already existing index. ONLY ONE OBJECT PER INDEX!
            @param _filesystem Filesystem to use for reading and writing
            @param _columntype Type of data stored in index
            @param indata Stream containing state of stored index*/
        BtreeIndex(DBIndexFileSystem &_filesystem, Blex::Stream &indata);

        /** Inserts data into index. If entry already exists insertion will be cancelled
            Assumptions: entry.RecordId() != 0.
            @param entry Entry to insert */
        void InsertData2(IndexBlockEntry const &entry);

        /** Deletes data from index. Entry MUST exist in index. Assumptions: entry.RecordId() != 0.
            @param entry Entry to delete
            @return TRUE if element was found, FALSE if not */
        bool DeleteData2(IndexBlockEntry const &entry);

        /** Destroys the whole index, and frees all blocks. Very dangerous! */
        void DestroyIndex();

        /** Request us to send our configuration data to a config file (ADDME: MT
            considerations? should probably not be called with any open sessions..) */
        void SaveState(Blex::Stream &metadata_file);

        /// Copies statistics to structure in argument
        void GetStatistics(Statistics& stats)
        {
                stats = LockedAdmin::ReadRef(admin)->statistics;
        }

        class OfflineIterator;
        class OnlineIterator;
        class Query;
};

/** Offline iterator. Used to hold index iterator values that do not require a
    lock on the index. */
class BtreeIndex::OfflineIterator
{
    private:
        // Entry this offline iterator points to (doesn't need to correspond to an actual entry!)
        IndexBlockEntryContainer current;

    public:
        /// Standard constructor, points to end()
        inline OfflineIterator() { current.ConstructEOBEntry(); }

        inline OfflineIterator(IndexBlockEntry const &entry) { *this = entry; }
        OfflineIterator & operator =(IndexBlockEntry const &entry) { current.CopyFrom(entry); return *this; }

        inline IndexBlockEntry const & operator *() const { return current; }
        inline IndexBlockEntry const * operator ->() const { return &current; }

        friend class OnlineRef;
};

/** Contains a query on the index. Use an OnlineRef if actual reading is done, don't keep it
    too long because it readlocks the index. */
class BtreeIndex::Query
{
    private:
        // Noncopyable
        Query(Query const &);
        Query & operator = (Query const &);

        /** Constructs a like query */
        void ConstructLikeQuery(
                IndexBlockEntryContainer &first_entry,
                IndexBlockEntryContainer &limit_entry,
                uint8_t const *searchdata,
                unsigned searchlen);

        /// Index this query is on
        BtreeIndex & index;

        /// Current begin of the query
        OfflineIterator current_begin;

        /// Current end of the query
        OfflineIterator current_end;

    public:
        /// Builds a new uninitialized query
        explicit Query(BtreeIndex &index);

        OfflineIterator const & begin() const { return current_begin; }
        // Approximate end; we cannot garantee that an iterator will be equal to it when the end of the query has been reached!
        OfflineIterator const & approx_end() const { return current_end; }

        ///Statistics of index on moment of creation
        const Statistics statistics;

        /** Constructs a new query. It is REQUIRED that one of the Reset functions
            is called after Query() */
        void ResetNewQuery(IndexBlockEntry const &start, IndexBlockEntry const &end);

        /** Allocates a read session for a query, makes creation of online iterators possible */
        class OnlineRef
        {
            private:
                // Noncopyable
                OnlineRef(OnlineRef const &);
                OnlineRef & operator=(OnlineRef const &);

                /// Query this ref puts online
                Query &query;

                /// Allocated session
                BtreeIndex::ReadSession session;

            public:
                explicit OnlineRef(Query &query);

                friend class OnlineIterator;
        };

        friend class OnlineRef;
        friend class OnlineIterator;
};

class BtreeIndex::OnlineIterator
{
    private:
        // noncopyable
        OnlineIterator(OnlineIterator const &);
        OnlineIterator & operator =(OnlineIterator const &);

        Query::OnlineRef &query;

        std::unique_ptr< IndexIterator > iterator;

        IndexBlockEntry const & GetEntry() const { return **iterator; }
    public:
        OnlineIterator(Query::OnlineRef &query, IndexBlockEntry const &position);

        inline IndexBlockEntry const & operator *() const { return **iterator; }
        inline IndexBlockEntry const * operator ->() const { return &**iterator; }

        inline OnlineIterator & operator ++() { ++*iterator; return *this; }
        inline OnlineIterator & operator --() { --*iterator; return *this; }

        friend uint32_t EstimateDistance(const OnlineIterator &a, const OnlineIterator &b);
};


/** Returns the estimated distance from iterator a and b. Precise on small distances, on
    bigger distances great imprecisions can occur. a must be smaller or equal to b.
    @param a First iterator.
    @param b Second iterator
    @return Estimated distances from a to b */
uint32_t EstimateDistance(const BtreeIndex::IndexIterator &a, const BtreeIndex::IndexIterator &b);
uint32_t EstimateDistance(const BtreeIndex::OnlineIterator &a, const BtreeIndex::OnlineIterator &b);

/** Shortcut to to make access to a query object a bit easier */
typedef BtreeIndex::Query Query;

} //end namespace Index
} //end namespace Blex

#endif
