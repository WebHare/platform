#ifndef blex_btree_blocks
#define blex_btree_blocks

namespace Blex
{
namespace Index
{

class BLEXLIB_PUBLIC IndexException : public std::runtime_error
{
        public:
        IndexException(std::string const & what_arg);
        ~IndexException() throw();
};

typedef uint32_t BlockId;

void BLEXLIB_PUBLIC FailIndex(std::string const &err) FUNCTION_NORETURN;

/* *** Constants for blocks *** */
namespace C_Block
{
 /* Global constants */
 /// Size of blocks on disk. Page size multiple is recommended. Section size must be multiple of 32 * page size (for config write/read code)
 static const unsigned Size = 4096; //set to 4096
 /// Maximum size of data in block (0..FillSizePosition).
 static const unsigned MaxData = Size-8;

 /* Positions of members in block data-structure */
 namespace Positions
 {
  static const unsigned HeadersBegin = 0;                    //< Start of entry-data in block
  static const unsigned DataEnd = Size - 8;          //< Start of entry-data in block
  static const unsigned DataSize = Size - 4;         //< Place of fillsize number in block.
  static const unsigned HeadersSize = Size - 8;           //< Place of eob position in block
 }
}

class IndexBlockEntryContainer;

/** IndexBlockEntry
    Describes an entry. Contains usefull functions for fiddeling with entries.

    An entry is split into 2 parts; a header and (optional) data.
    Headers are always 11 bytes long; except for EOB entries

    Entry structure:
    byte 0 - 3  : child block pointer
    byte 4      : entry type/data length
    byte 5 - 8  : recordid of entry
    byte 9 -10  : pointer to data (relative to byte 0) (int16_t)

    Maximum data length: MaxDataSize ( = MaxSize - HeaderSize )

    Headers for EOB entries are 5 bytes long (contain only child block ptr and entry type)

    Entry types:
    0 .. MaxData:                       data of length type()
    Type_Integer:                       integer data
    Type_EOB:                           last entry of a block, no data
    */

class BLEXLIB_PUBLIC IndexBlockEntry
{
    //protected:
        /** Returns type of entry
            @return Type of entry. */
        public:
        uint8_t inline Type() const
        {
                return address[Pos_Type];
        }

        uint8_t *address;

        static int32_t CompareEntries(uint8_t const *lhs_entry, uint8_t const *rhs_entry);

    public:

        /// Entry is a EOB entry
        static const unsigned Type_EOB = 255;
        /// Maximum size of entry. Update Index::MaxTreeDepth when changing!
        static const unsigned MaxEntrySize = 64; /* should be 64 */
        /// Size of EOB entry
        static const unsigned EOBSize = 11;
        /// Minimum size of data entry. Total size of entry is HeaderSize + sizeof(data)
        static const unsigned HeaderSize = 11; /* should be 11 */
        /// Maximum size of data within entry
        static const unsigned MaxDataSize = MaxEntrySize - HeaderSize;

        /// Position of ChildblockID uint32_t in entry structure
        static const unsigned Pos_ChildBlockID = 0;
        /// Position of front type-id uint8_t in entry structure
        static const unsigned Pos_Type = 4;
        /// Position of recordid uint32_t in entry structure (not for eob entries)
        static const unsigned Pos_RecordID = 5;
        /// Position data in entry structure (not for eob entries)
        static const unsigned Pos_DataPtr = 9;

        inline IndexBlockEntry (uint8_t * _address)
        : address(_address)
        {
        };

        //DEBUG STUFF
        static void FailDLBTPV();

        /** Returns length of entry, calculated from given type value
            Returns 0 if data is NULL.
            @return Length of data. */
        static inline uint32_t GetDataLengthByTypeValue(uint8_t typevalue)
        {
//                if (typevalue <= IndexBlockEntry::MaxDataSize)
                    return typevalue;

//                FailDLBTPV();
//                return 0;
        }

        /** Returns length of entry (including management stuff) calculated from given Type value.
            @return Length of entry */
        static inline uint32_t GetEntryLengthByTypeValue(uint8_t typevalue)
        {
                if (typevalue == Type_EOB)
                    return IndexBlockEntry::EOBSize;

                return IndexBlockEntry::HeaderSize + GetDataLengthByTypeValue(typevalue);
        }

        /** Compares 2 entries. Compares first on data, if the two entries have identical data
            the recordid will be compared after that. (Record-id of 0 on either block will cause the recordid compare to be skipped)
            ADDME: support for custom-built entries (for multi-column indexes)
            @param rhs Entry to compare this entry to
            @return -1: this<rhs, 0: this~=rhs, 1: this>rhs */
        int32_t inline CompareToEntry(IndexBlockEntry const & rhs) const { return CompareEntries(address, rhs.address); }
        int32_t CompareToEntry_old(IndexBlockEntry const & rhs) const;

        /** Is this iterator pointing to the end of the block? */
        bool IsEOB() const
        {
                return Type() == Type_EOB;
        }

        /** Returns Length of entry (including management stuff)
            @return Length of entry */
        uint32_t GetEntryLength() const
        {
                return GetEntryLengthByTypeValue(Type());
        }

        /** Returns length of entry
            @return Length of data. */
        uint32_t GetDataLength() const
        {
                return GetDataLengthByTypeValue(Type());
        }

        /** Returns pointer to data within entry. Do NOT call if no data is present within entry
            @return Pointer to data. */
        uint8_t* GetData()
        {
//                assert(Type() <= MaxDataSize);
                return address + Blex::gets16lsb(&address[Pos_DataPtr]);
        }
        uint8_t const * GetData() const
        {
//                assert(Type() <= MaxDataSize);
                return address + Blex::gets16lsb(&address[Pos_DataPtr]);
        }

        /** Returns Record ID of entry. Do NOT call if no data is present within entry.
            @return Record ID */
        uint32_t GetRecordId() const
        {
                assert(!IsEOB());
                return Blex::getu32lsb(address + Pos_RecordID);
        }

        /** Returns Childblock ID of entry.
            @return Childblock ID */
        BlockId GetChildBlockId() const
        {
                return BlockId(Blex::getu32lsb(address + Pos_ChildBlockID));
        }

        /** Get the address this index entry points to */
        uint8_t * GetAddress()
        { return address; }
        uint8_t const * GetAddress() const
        { return address; }

        // Comparison operators on entries
        bool operator <(const IndexBlockEntry& rhs) const
        { return CompareToEntry(rhs)<0; }

        bool operator >(const IndexBlockEntry& rhs) const
        { return CompareToEntry(rhs)>0; }

        bool operator ==(const IndexBlockEntry& rhs) const
        { return CompareToEntry(rhs)==0; }

        bool operator !=(const IndexBlockEntry& rhs) const
        { return CompareToEntry(rhs)!=0; }

        bool operator <=(const IndexBlockEntry& rhs) const
        { return CompareToEntry(rhs)<=0; }

        bool operator >=(const IndexBlockEntry& rhs) const
        { return CompareToEntry(rhs)>=0; }

        void SetChildBlockID(BlockId childblockid);
        void SetDataAddress(uint8_t const *data);

        // Increases data address by position_increase
        void inline IncreaseDataAddress(int16_t position_increase)
        { uint8_t *dpos = &address[Pos_DataPtr]; Blex::puts16lsb(dpos, static_cast< uint16_t >(Blex::gets16lsb(dpos) + position_increase)); }

        friend class IndexBlockIterator;
};
std::ostream& operator <<(std::ostream &out, const IndexBlockEntry &e);

class IndexBlockIterator;

/** DBIndexEntryContainer is an entry with its own storage space. */
class BLEXLIB_PUBLIC IndexBlockEntryContainer : public IndexBlockEntry
{
        private:
        /// Data of entry
        uint8_t entrydata[IndexBlockEntry::MaxEntrySize];

        public:
        IndexBlockEntryContainer()
        : IndexBlockEntry(entrydata)
        {
                Blex::puts16lsb(&entrydata[Pos_DataPtr], HeaderSize);
        }


        IndexBlockEntryContainer(const IndexBlockEntryContainer& rhs)
        : IndexBlockEntry(entrydata)
        {
                memcpy(entrydata, rhs.entrydata, sizeof(entrydata));
        }
        IndexBlockEntryContainer& operator =(const IndexBlockEntryContainer& rhs)
        {
                memcpy(entrydata, rhs.entrydata, sizeof(entrydata));
                return *this;
        }

        /** Copies this entry fully to another entry.
            @param entry Entry to copy this entry to */
        void CopyFrom(IndexBlockEntry const &entry);

        /** Constructs an entry from given data.
            @param data Data that must be in the entry.
            @param datalen Length of data in data parameter
            @param recordid RecordID of given entry. LimitLowestRecordId to create the 'first possible' entry, LimitHighestrecordId to create the 'last possible' entry */
        void ConstructDataEntry(uint8_t const * data, unsigned datalen, uint32_t recordid);

        /** Constructs an end-of block entry */
        void ConstructEOBEntry();

        /** Constructs a NULL entry (smallest data value possible)
            @param recordid RecordID of entry. */
        void ConstructNULLEntry(uint32_t recordid)
        {
                ConstructDataEntry(NULL, 0, recordid);
        }

        /** Set Record ID of entry.
            ADDME: SetRecordId shouldn't need to know about Pos_RecordID */
        void SetRecordID(uint32_t id)
        {
                assert(!IsEOB());
                Blex::putu32lsb(entrydata + IndexBlockEntry::Pos_RecordID, id);
        }

        uint8_t* GetData()
        {
                assert(Type() <= MaxDataSize);
                return address + Blex::gets16lsb(&address[Pos_DataPtr]);
        }
};

/** Disk-block encapsulator

    A block contains a number of entries.

    It does not contain state in it's own data, it is all maintained in the data on disk. So,
    read-only copies of a block can be used thread-safe, but when writing to a block, no read-access to
    that block is permitted.

    Block structure:
    Byte 0..: Headers (stored front to back)

    Byte ..4087: headers (stored back to front)
    Byte 4088-4091: Position of EOB header
    Byte 4092-4095: Filled size of block

    Headers are stored front to back; data is stored back to front. The dataptr of NULL entries must be filled
    in!
    for EOB: fillsize() - EOBSize
    Total size of headers before entry X: (entry.GetAddress() - C_Block::HeadersBegin)
    Total size of data before entry X: C_Block::DataEnd - (entry.dataptr + entry->DataLength())

*/

class IndexBlock
{
    public:
        typedef IndexBlockIterator iterator;
        typedef IndexBlockIterator const_iterator;

    private:
        // Address of block data
        uint8_t* blockdataptr;

        bool dirty;

        void CheckNewFillSize(uint32_t newheadersize, uint32_t newdatasize);

        /// Sets the total size of the data to a new value
        void inline SetDataSize(uint32_t newdatasize)
        {
//                DEBUGONLY( CheckNewFillSize(GetHeadersSize(), newdatasize));
                Blex::putu32lsb(blockdataptr + C_Block::Positions::DataSize, newdatasize);
        }

        /// Sets the total size of the headers in the block to a new value
        void inline SetHeadersSize(uint32_t newheadersize)
        {
//                DEBUGONLY( CheckNewFillSize(newheadersize, GetDataSize()));
                dirty = true;
                Blex::putu32lsb(blockdataptr + C_Block::Positions::HeadersSize, newheadersize);
        }

        /// Returns the size of all headers
        uint32_t GetHeadersSize() const
        {
                return Blex::getu32lsb(blockdataptr + C_Block::Positions::HeadersSize);
        }

        /// Returns the size of all data combined
        uint32_t GetDataSize() const
        {
                return Blex::getu32lsb(blockdataptr + C_Block::Positions::DataSize);
        }

        /** Copies al entries between two ranges to the address of another iterator. Overlapping
            copies are handled correctly.
            @param dest Destination iterator
            @param source Source iterator
            @param end Iterator pointing to end of area to copy
            @return Number of bytes copied */
        uint32_t CopyRange(iterator dest, iterator source, iterator end);

        void PrimitiveAppend(IndexBlockEntry const &entry);

        inline void MarkDirty() { dirty = true; }

    public:
        explicit IndexBlock(uint8_t *_dataaddress) : blockdataptr(_dataaddress), dirty(false)
        {
        }

        /** Is the specified iterator contained in this block? (intended for debugging) */
        bool IsContained(iterator itr) const;

        /// Returns the total size of the entries in the block (including eob)
        uint32_t FillSize() const
        {
                return GetHeadersSize() + GetDataSize();
        }

        /// Iterator pointing to first entry in block
        iterator inline begin() const;
        /// Iterator pointing just after last entry (last entry is EOB-entry)
        iterator inline end() const;
        /// Iterator pointing to last entry (the EOB-entry)
        iterator eob() const;

        /** Returns iterator pointing to the last data-entry (NOT the EOB-entry!) whose MemDistance
            to the first entry (*begin()) is less or equal to position. May NEVER be called on an empty block!!
            @param position Maximum distance to *begin() */
        iterator IteratorAtPos(uint32_t position);

        /** Determines if an insert is possible in this block (if block does not overflow)
            @param entry Entry that has to be inserted in this block
            @return Returns TRUE if this entry fits into this block */
        bool InsertPossible(const IndexBlockEntry &entry);

        /** Inserts entry into block. Iterators pointing to the same location as at will
            afterwards point to the new entry, iterators pointing to entries before at will still point to thesame
            entry, iterators after at will all be invalidated. Insert MUST be possible when calling this
            function.
            @param at Iterator pointing to position where entry has to be inserted.
            @param entry Entry that has to be inserted in this block */
        void InsertAt(iterator at, const IndexBlockEntry &entry);

        /** Inserts entry into block, with specified childblockid. Iterators pointing to thesame locations as at will
            afterwards point to the new entry, iterators pointing to entries before at will still point to thesame
            entry, iterators after at will all be invalidated. Insert MUST be possible when calling this function.
            @param at Iterator pointing to position where entry has to be inserted.
            @param entry Entry that has to be inserted in this block
            @param childblockid ID of childblock that has to be put into the entry. */
        void InsertAtWithID(iterator at, const IndexBlockEntry &entry, BlockId childblockid);

        /** Inserts range of entries into block. Iterators pointing to thesame locations as at will
            afterwards point to the first entry of the range, iterators pointing to entries before at will still point to thesame
            entry, iterators after at will all be invalidated. Insert MUST be possible when calling this function.
            @param at Iterator pointing to position where entry has to be inserted.
            @param rangestart Start of range of entries to insert
            @param rangeend End of range of entries to insert */
        void InsertRange(iterator at, iterator rangestart, iterator rangeend);

        /** Deletes entry pointed to by this iterator. Iterators pointing to thesame locations as at will
            afterwards point to the next entry, iterators pointing to entries before at will still point to thesame
            entry, iterators after at will all be invalidated.
            @param at Iterator pointing to entry to delete from block */
        void DeleteAt(iterator at);

        /** Deletes range defined by iterators rangestart and rangeend. Iterators pointing to thesame locations as at will
            afterwards point to the next entry after the range, iterators pointing to entries before at will still point to thesame
            entry, iterators after at will all be invalidated.
            @param rangestart Start of range of entries to delete
            @param rangeend End of range of entries to delete */
        void DeleteRange(iterator rangestart, iterator rangeend);

        /** Construct a new, empty block at the current blockdataptr. Destroys all current data in the block
            @param childblockid Childblockid that must be put in the eob of the block */
        void ConstructEmptyBlock(BlockId childblockid);

        /** Copies the data from another block to this block
            @param rhs Block to copy from */
        void CopyFrom(IndexBlock const &rhs);

        /// Returns whether this block has changed since creation, but that hasn't been recorded in the sectionfile
        inline bool IsDirty() { return dirty; }

        /** Calculates number of bytes the range [rangestart, iterator rangeend) contains (inclusive data!) */
        static unsigned ByteSizeOfRange(iterator rangestart, iterator rangeend);

        friend class IndexBlockIterator;
        friend class SmartBlockPtr;
};

class IndexBlockIterator : public std::iterator<std::random_access_iterator_tag, IndexBlockEntry>
{
    private:
        /** Returns entry currently pointed to by iterator
            @return Entry currently pointed to */
        IndexBlockEntry entry;

    public:
        explicit inline IndexBlockIterator(uint8_t* address = 0)
        : entry(address)
        {
        }

        uint8_t* Address()
        {
                return entry.GetAddress();
        }

        IndexBlockEntry& operator*() { return entry; }
        const IndexBlockEntry& operator*() const { return entry; }
        IndexBlockEntry* operator ->() { return &entry; }
        const IndexBlockEntry* operator ->() const { return &entry; }

        IndexBlockIterator& operator++()
        {
                entry.address += IndexBlockEntry::HeaderSize;
                return *this;
        }
        IndexBlockIterator operator++(int)
        {
                IndexBlockIterator temp(*this);
                ++*this;
                return temp;
        }
        IndexBlockIterator & operator+=(int rhs)
        {
                entry.address += IndexBlockEntry::HeaderSize * rhs;
                return *this;
        }
        IndexBlockIterator operator+(int rhs) const
        {
                IndexBlockIterator temp(*this);
                temp += rhs;
                return temp;
        }
        IndexBlockIterator& operator--()
        {
                entry.address -= IndexBlockEntry::HeaderSize;
                return *this;
        }
        IndexBlockIterator operator--(int)
        {
                IndexBlockIterator temp(*this);
                --*this;
                return temp;
        }
        IndexBlockIterator & operator-=(int rhs)
        {
                entry.address -= IndexBlockEntry::HeaderSize * rhs;
                return *this;
        }
        IndexBlockIterator operator-(int rhs) const
        {
                IndexBlockIterator temp(*this);
                temp -= rhs;
                return temp;
        }
        IndexBlockEntry operator[](int rhs)
        {
                return *(*this + rhs);
        }
        signed operator-(IndexBlockIterator const &rhs) const
        {
                return (entry.address - rhs.entry.address) / IndexBlockEntry::HeaderSize;
        }

        bool operator <(const IndexBlockIterator& rhs) const { return entry.address < rhs.entry.address; }
        bool operator <=(const IndexBlockIterator& rhs) const { return entry.address <= rhs.entry.address; }
        bool operator ==(const IndexBlockIterator& rhs) const { return entry.address == rhs.entry.address; }
        bool operator !=(const IndexBlockIterator& rhs) const { return entry.address != rhs.entry.address; }
        bool operator >(const IndexBlockIterator& rhs) const { return entry.address > rhs.entry.address; }
        bool operator >=(const IndexBlockIterator& rhs) const { return entry.address >= rhs.entry.address; }

        void MoveForwardInMemory(uint32_t distance) { entry.address += distance; }
};

IndexBlock::iterator IndexBlock::begin() const
{
        return IndexBlockIterator(blockdataptr);
}

IndexBlock::iterator IndexBlock::end() const
{
        return IndexBlockIterator(blockdataptr + C_Block::Positions::HeadersBegin + GetHeadersSize());
}

inline bool IndexBlock::IsContained(iterator itr) const
{
        return itr.Address() >= blockdataptr && itr.Address() < blockdataptr + GetHeadersSize();
}

inline IndexBlockIterator operator+(int lhs, IndexBlockIterator rhs)
{
                return rhs+lhs;
}




} //end namespace Index

} //end namespace Blex

#endif //end sentry
