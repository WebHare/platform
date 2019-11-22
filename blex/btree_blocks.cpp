#include <blex/blexlib.h>


#include <iostream>
#include "logfile.h"
#include "btree_blocks.h"

namespace Blex
{
namespace Index
{

//Instantiate it here...
const unsigned IndexBlockEntry::MaxDataSize;

IndexException::IndexException(std::string const & what_arg) : std::runtime_error(what_arg)
{
}
IndexException::~IndexException() throw()
{
}

void FailIndex(std::string const &err)
{
        Blex::ErrStream() << "Index has been corrupted, and will be regenerated (" << err << ")";
        Blex::FatalAbort(); //It would've been cleaner to let the dbserver make this decision.
}
void IndexBlockEntry::FailDLBTPV()
{
        FailIndex("Index: Quering length for invalid data type");
}

std::ostream& operator <<(std::ostream &out, const IndexBlockEntry &e)
{
        out << "CBID: " << e.GetChildBlockId() << " ";

        if (e.IsEOB())
        {
                out << "END OF BLOCK ";
        }
        else
        {
                out << "RecID: " << e.GetRecordId() << " ";
                out << "tdata: '" << std::string(reinterpret_cast<const char *>(e.GetData()), e.GetDataLength()) << "' ";
                out << "length " << e.GetDataLength() << " ";
        }
        out << "(len: " << e.GetEntryLength() << ")";

        return out;
}

/* *** IndexBlockEntry *** */
template <typename CompareType> inline signed Compare (CompareType A, CompareType B)
{
        if (A<B)
            return -1;
        else if (A==B)
            return 0;
        else
            return 1;
}

void IndexBlockEntryContainer::CopyFrom(IndexBlockEntry const &to_copy)
{
        if (to_copy.address != address)
        {
                memcpy(entrydata, to_copy.GetAddress(), HeaderSize);
                if (!IsEOB())
                {
                        SetDataAddress(address + HeaderSize);
                        assert(GetDataLength() <= MaxDataSize);
                        memcpy(GetData(), to_copy.GetData(), to_copy.GetDataLength());
                }
        }
}

// This function is heavy optimized, because it it is accessed VERY VERY much.
int32_t IndexBlockEntry::CompareEntries(uint8_t const *lhs_entry, uint8_t const *rhs_entry)
{
        unsigned lhs_type = lhs_entry[Pos_Type];
        unsigned rhs_type = rhs_entry[Pos_Type];

        // Weed out EOB's
        if (lhs_type == IndexBlockEntry::Type_EOB)
            if (rhs_type == IndexBlockEntry::Type_EOB)
                return 0;
            else
                return 1;
        else
            if (rhs_type == IndexBlockEntry::Type_EOB)
                return -1;

        {
                // Written out memcmp; avoids function call, and we can keep everything in registers
                unsigned length = lhs_type;
                if (rhs_type < length)
                    length = rhs_type;
                uint8_t const *lhs_data = lhs_entry + Blex::gets16lsb(&lhs_entry[Pos_DataPtr]);
                uint8_t const *rhs_data = rhs_entry + Blex::gets16lsb(&rhs_entry[Pos_DataPtr]);

                // First take steps of 4 (quick for lsb case)
                while (length & ~3 && Blex::getu32lsb(lhs_data) == Blex::getu32lsb(rhs_data))
                    length -= 4, lhs_data += 4, rhs_data += 4;
                if (length)
                {
                        if (lhs_data[0] != rhs_data[0])
                            return lhs_data[0] > rhs_data[0] ? 1 : -1;
                        if (length >= 2 && lhs_data[1] != rhs_data[1])
                            return lhs_data[1] > rhs_data[1] ? 1 : -1;
                        if (length >= 3 && lhs_data[2] != rhs_data[2])
                            return lhs_data[2] > rhs_data[2] ? 1 : -1;
                        if (length >= 4 && lhs_data[3] != rhs_data[3])
                            return lhs_data[3] > rhs_data[3] ? 1 : -1;
                }
        }

        // Shared data is equal; longer one is less.
        if (lhs_type > rhs_type)
            return 1;
        else if (lhs_type < rhs_type)
            return -1;

        // Compare recordids
        uint32_t lhs_recordid = Blex::getu32lsb(lhs_entry + Pos_RecordID);
        uint32_t rhs_recordid = Blex::getu32lsb(rhs_entry + Pos_RecordID);

        if (lhs_recordid > rhs_recordid)
            return 1;
        else if (lhs_recordid < rhs_recordid)
            return -1;
        else
            return 0;
}

// Older compare function
int32_t IndexBlockEntry::CompareToEntry_old(const IndexBlockEntry& rhs) const
{
        unsigned lhs_type = Type();
        unsigned rhs_type = rhs.Type();

        // Both types the same? Both EOB or equal data length (75% in tests, not tested irl)
        if (lhs_type == rhs_type)
        {
                if (lhs_type != IndexBlockEntry::Type_EOB) // (99+% in tests, not tested irl)
                {
                        // Normal data, compare data, type val of lhs == type val or rhs -> lhs datalength = rhs data length
                        unsigned length = GetDataLengthByTypeValue(lhs_type);
                        signed data_compare = std::memcmp(GetData(), rhs.GetData(), length);
                        if (data_compare) // (90% in tests, not tested irl)
                            return data_compare;

                        return Compare(GetRecordId(), rhs.GetRecordId());
                }
                else
                    return 0; // Low
        }

        // Following tests catch 99.9% in tests
        // lhs is eob, and rhs is not -> lhs is bigger
        if (lhs_type == IndexBlockEntry::Type_EOB)
            return 1;
        // rhs is eob, and lhs is not -> lhs is bigger
        if (rhs_type == IndexBlockEntry::Type_EOB)
            return -1;

        signed data_compare = std::memcmp(GetData(), rhs.GetData(), std::min(GetDataLength(), rhs.GetDataLength()));
        if (data_compare == 0) //first few bytes were equal
            data_compare = Compare(GetDataLength(), rhs.GetDataLength());

        if (data_compare) // (90% in tests, not tested irl)
            return data_compare;

        return Compare(GetRecordId(), rhs.GetRecordId());
}

//int32_t IndexBlockEntry::CompareToEntry(const IndexBlockEntry& rhs) const
//{
//        return CompareEntries(address, rhs.address);
//
//        int32_t new_c = CompareEntries(address, rhs.address);
//        int32_t old_c = CompareToEntry_old(rhs);
//
//        assert(new_c == old_c);
//        return old_c;
//}


void IndexBlockEntry::SetChildBlockID(BlockId childblockid)
{
        Blex::putu32lsb(address + IndexBlockEntry::Pos_ChildBlockID, childblockid);
}

void IndexBlockEntry::SetDataAddress(uint8_t const *data)
{
        Blex::puts16lsb(&address[Pos_DataPtr], (uint16_t)std::distance(static_cast<uint8_t const *>(address), data));
}


/* *** DBIndexEntryContainer *** */
void IndexBlockEntryContainer::ConstructDataEntry(const uint8_t* data, unsigned datalen, uint32_t recordid)
{
        // Clear first entry
        Blex::putu32lsb(&entrydata[IndexBlockEntry::Pos_ChildBlockID], uint32_t(-1));

        // Enter recordid
        Blex::putu32lsb(&entrydata[IndexBlockEntry::Pos_RecordID], recordid);

        // Determine type of entry
        if (datalen > IndexBlockEntry::MaxDataSize)
            datalen = IndexBlockEntry::MaxDataSize;

        entrydata[IndexBlockEntry::Pos_Type] = static_cast<uint8_t>(datalen);

        // Set type, and store data
        memcpy(GetData(), data, datalen);
}

void IndexBlockEntryContainer::ConstructEOBEntry()
{
        // Clear childblockid, and set type.
        Blex::putu32lsb(&entrydata[IndexBlockEntry::Pos_ChildBlockID], uint32_t(-1));
        entrydata[IndexBlockEntry::Pos_Type] = IndexBlockEntry::Type_EOB;
}

void IndexBlock::CheckNewFillSize(uint32_t newheadersize, uint32_t newdatasize)
{
        uint32_t fillsize = newheadersize + newdatasize;
        if (fillsize > C_Block::MaxData)
            FailIndex("SetHeadersSize or SetDataSize block overflow");
}

/* Moved to header, to allow more inlining
void IndexBlock::SetDataSize(uint32_t newdatasize)
{
        DEBUGONLY( CheckNewFillSize(GetHeadersSize(), newdatasize);
        Blex::putu32lsb(blockdataptr + C_Block::Positions::DataSize, newdatasize);
}

void IndexBlock::SetHeadersSize(uint32_t newheadersize)
{
        DEBUGONLY( CheckNewFillSize(newheadersize, GetDataSize());
        Blex::putu32lsb(blockdataptr + C_Block::Positions::HeadersSize, newheadersize);
}

IndexBlockIterator IndexBlock::begin() const
{
        return IndexBlockIterator(blockdataptr + C_Block::Positions::HeadersBegin);
}

IndexBlockIterator IndexBlock::end() const
{
        return IndexBlockIterator(blockdataptr + C_Block::Positions::HeadersBegin + GetHeadersSize());
} */

IndexBlockIterator IndexBlock::eob() const
{
        return IndexBlockIterator(blockdataptr + C_Block::Positions::HeadersBegin + GetHeadersSize() - IndexBlockEntry::EOBSize);
}

/* arnold: Dit is eigenlijk een soort 'find nearest' algorithme? of eigenlijk
           'find iterator after specified position' */
IndexBlockIterator IndexBlock::IteratorAtPos(uint32_t position)
{
        if (FillSize() == IndexBlockEntry::EOBSize)
            FailIndex("IteratorAtPos may not be called on empty blocks!");

        if (position >= FillSize() - IndexBlockEntry::EOBSize)
            position = FillSize() - IndexBlockEntry::EOBSize - 1;

        IndexBlockIterator it = begin();

        while (position >= it->GetEntryLength())
        {
                position -= it->GetEntryLength();
                ++it;
        }
        return it;
}

bool IndexBlock::InsertPossible(const IndexBlockEntry &entry)
{
        return entry.GetEntryLength() + FillSize() <= C_Block::MaxData;
}

void IndexBlock::PrimitiveAppend(IndexBlockEntry const &entry)
{
        assert(FillSize() + entry.GetEntryLength() <= C_Block::MaxData);

        //Install the entry's header
        uint8_t *header_start = blockdataptr + GetHeadersSize();
        Blex::putu32lsb(header_start + IndexBlockEntry::Pos_ChildBlockID, entry.GetChildBlockId());
        Blex::putu8(header_start + IndexBlockEntry::Pos_Type,entry.Type());

        if (!entry.IsEOB())
        {
                Blex::putu32lsb(header_start + IndexBlockEntry::Pos_RecordID, entry.GetRecordId());

                // Move the data and install its location into the header
                uint8_t *dataaddr = blockdataptr + C_Block::Positions::DataEnd - GetDataSize() - entry.GetDataLength();
                Blex::puts16lsb(header_start + IndexBlockEntry::Pos_DataPtr, (int16_t)std::distance(header_start,dataaddr));
                memcpy(dataaddr, entry.GetData(), entry.GetDataLength());

                SetDataSize(GetDataSize() + entry.GetDataLength());
        }
        SetHeadersSize(GetHeadersSize() + IndexBlockEntry::HeaderSize);
}

/* namespace {
bool CompareBlock(IndexBlock const & left, IndexBlock const & right)
{
#ifdef DEBUG
        if (left.FillSize() != right.FillSize())
            return false;

        return std::distance(left.begin(),left.end()) == std::distance(right.begin(),right.end())
               && std::equal(left.begin(),left.end(),right.begin());
#else
        return true;
#endif
}
} // End of anonymous namespace */

void IndexBlock::InsertAt(IndexBlockIterator at, const IndexBlockEntry &entry)
{
        assert(InsertPossible(entry));
        assert(IsContained(at) || at == end());

        uint8_t *atpos = at.Address();
        if (entry.IsEOB())
        {
                // EOB is easy, no moving needed
                Blex::putu32lsb(atpos + IndexBlockEntry::Pos_ChildBlockID, entry.GetChildBlockId());
                Blex::putu8(atpos + IndexBlockEntry::Pos_Type, entry.Type());

                SetHeadersSize(GetHeadersSize() + IndexBlockEntry::HeaderSize);
        }
        else
        {
                uint8_t *atpos = at.Address();

                // Decrease data ptrs of entries from at (their header is moved rel to their data)
                uint8_t *header_end = blockdataptr + GetHeadersSize();
                IndexBlockIterator it(at);
                for (uint8_t *eob = header_end - IndexBlockEntry::EOBSize; it.Address() < eob; ++it)
                    it->IncreaseDataAddress(-(int16_t)IndexBlockEntry::HeaderSize);

                memmove(atpos + IndexBlockEntry::HeaderSize, atpos, header_end - atpos);

                // Fill the entry, and set the new header and data sizes
                unsigned data_len = entry.GetDataLength();
                uint8_t *data_insert_pos = blockdataptr + C_Block::Positions::DataEnd - GetDataSize() - data_len;

                // Copy bits directly, then adjust
                memcpy(atpos, entry.address, IndexBlockEntry::HeaderSize);
//                Blex::putu32lsb(atpos + IndexBlockEntry::Pos_ChildBlockID, entry.GetChildBlockId());
//                Blex::putu8(atpos + IndexBlockEntry::Pos_Type, entry.Type());
//                Blex::putu32lsb(atpos + IndexBlockEntry::Pos_RecordID, entry.GetRecordId());
                Blex::puts16lsb(atpos + IndexBlockEntry::Pos_DataPtr, data_insert_pos - atpos);

                memcpy(data_insert_pos, entry.GetData(), data_len);

                SetHeadersSize(GetHeadersSize() + IndexBlockEntry::HeaderSize);
                SetDataSize(GetDataSize() + data_len);
        }
}

void IndexBlock::InsertAtWithID(IndexBlockIterator at, const IndexBlockEntry &entry, BlockId childblockid)
{
        InsertAt(at, entry);
        at->SetChildBlockID(childblockid);
}

void IndexBlock::InsertRange(IndexBlockIterator at, IndexBlockIterator rangestart, IndexBlockIterator rangeend)
{
        assert(IsContained(at) || at == end());

        uint8_t *atpos = at.Address();

        // Collect number of items
        unsigned newitem_count = rangeend - rangestart;

        // Decrease data ptrs of entries from at (their header is moved rel to their data), then move them
        unsigned headersbytes_to_move = newitem_count * IndexBlockEntry::HeaderSize;
        if (GetHeadersSize() > 0) // Don't move entries of blocks with no eob
        {
                uint8_t *header_end = blockdataptr + GetHeadersSize();
                uint8_t *eob = header_end - IndexBlockEntry::HeaderSize;
                for (IndexBlockIterator it(at); it.Address() < eob; ++it)
                {
                        uint8_t *pos = it.Address();
                        Blex::puts16lsb(pos + IndexBlockEntry::Pos_DataPtr, Blex::gets16lsb(pos + IndexBlockEntry::Pos_DataPtr) - headersbytes_to_move);
                }
                // Move the headers
                memmove(atpos + headersbytes_to_move, atpos, header_end - atpos);
        }

        // Construct new entries
        uint8_t *databegin = blockdataptr + C_Block::Positions::DataEnd - GetDataSize();
        while (rangestart != rangeend)
        {
                // Build basics of entry
                uint8_t *atpos = at.Address();

                if (rangestart->IsEOB())
                {
                        Blex::putu32lsb(atpos + IndexBlockEntry::Pos_ChildBlockID, rangestart->GetChildBlockId());
                        Blex::putu8(atpos + IndexBlockEntry::Pos_Type, rangestart->Type());
                }
                else
                {
                        // Calculate place of data, and copy it
                        unsigned data_len = rangestart->GetDataLength();
                        databegin -= data_len;
                        memcpy(databegin, rangestart->GetData(), data_len);

                        // Copy entry, and adjust (faster)
                        memcpy(atpos, rangestart.Address(), IndexBlockEntry::HeaderSize);
                        Blex::puts16lsb(atpos + IndexBlockEntry::Pos_DataPtr, databegin - atpos);
                        // Build entry
//                        Blex::putu32lsb(atpos + IndexBlockEntry::Pos_ChildBlockID, rangestart->GetChildBlockId());
//                        Blex::putu8(atpos + IndexBlockEntry::Pos_Type, rangestart->Type());
//                        Blex::putu32lsb(atpos + IndexBlockEntry::Pos_RecordID, rangestart->GetRecordId());
//                        Blex::puts16lsb(atpos + IndexBlockEntry::Pos_DataPtr, databegin - atpos);
                }

                ++rangestart;
                ++at;
        }

        SetHeadersSize(GetHeadersSize() + headersbytes_to_move);
        SetDataSize(blockdataptr + C_Block::Positions::DataEnd - databegin);
}

void IndexBlock::DeleteAt(IndexBlockIterator at)
{
//        Old code: DeleteRange(at, at + 1);

        if (at->IsEOB())
        {
                /* It is fishy that the EOB would be deleted with this function, but can't determine just yet
                   if it isn't done */
                SetHeadersSize(GetHeadersSize() - IndexBlockEntry::HeaderSize);
        }
        else
        {
                uint8_t *old_data_pos = at->GetData();
                unsigned datalen = at->GetDataLength();

                uint8_t *header_end = blockdataptr + GetHeadersSize();

                uint8_t *atpos = at.Address();
                uint8_t *new_eob = header_end - 2*IndexBlockEntry::HeaderSize;

                {
                        // Move the headers and correct the data ptrs
                        uint8_t *nextpos = atpos + IndexBlockEntry::HeaderSize;
                        memmove(atpos, nextpos, header_end - nextpos);

                        for (; at.Address() < new_eob; ++at)
                            at->IncreaseDataAddress(IndexBlockEntry::HeaderSize);
                }

                if (datalen)
                {
                        uint8_t *data_begin = blockdataptr + C_Block::Positions::DataEnd - GetDataSize();

                        unsigned movelen = old_data_pos - data_begin;
                        if (movelen)
                            memmove(data_begin + datalen, data_begin, movelen);

                        IndexBlockIterator it(blockdataptr);
                        for (; it.Address() < new_eob; ++it)
                            if (it->GetData() <= old_data_pos)
                                it->IncreaseDataAddress(datalen);
                }

                SetHeadersSize(GetHeadersSize() - IndexBlockEntry::HeaderSize);
                SetDataSize(GetDataSize() - datalen);
        }
}

void IndexBlock::DeleteRange(IndexBlockIterator rangestart, IndexBlockIterator rangeend)
{
        assert(IsContained(rangestart));
        assert(rangeend <= end());

        /* For deleterange the current approach (calling insertrange twice) is currently the best algo.
           The data of the deleted entries is scattered throughout the data store, and coalesing them
           would probably cost a lot of time */

        uint8_t newblockdata[C_Block::Size];
        IndexBlock newblock(newblockdata);

        Blex::putu32lsb(newblock.blockdataptr + C_Block::Positions::DataSize, 0); // Set datasize to avoid seteobposition asserts
        newblock.SetHeadersSize(0);
        newblock.SetDataSize(0);

        newblock.InsertRange(newblock.begin(), begin(), rangestart);
        newblock.InsertRange(newblock.end(), rangeend, end());

        CopyFrom(newblock);
}

void IndexBlock::ConstructEmptyBlock(BlockId childblockid)
{
        // Clean block
        Blex::putu32lsb(blockdataptr + C_Block::Positions::DataSize, 0); // Set datasize to avoid seteobposition asserts
        SetHeadersSize(0);
        SetDataSize(0);

        // Put an EOB pointing to the specified childblockid into the block
        IndexBlockEntryContainer eob;
        eob.ConstructEOBEntry();
        InsertAtWithID(begin(), eob, childblockid);
}

void IndexBlock::CopyFrom(IndexBlock const &rhs)
{
        unsigned header_size = rhs.GetHeadersSize();
        unsigned data_size = rhs.GetDataSize();
        unsigned data_start_pos = C_Block::Positions::DataEnd - data_size;

        memcpy(blockdataptr, rhs.blockdataptr, header_size);
        memcpy(blockdataptr + data_start_pos, rhs.blockdataptr + data_start_pos, C_Block::Size - data_start_pos);
        MarkDirty();
}

unsigned IndexBlock::ByteSizeOfRange(iterator rangestart, iterator rangeend)
{
        unsigned len = 0;
        for (IndexBlockIterator it = rangestart; it != rangeend; ++it)
            len += it->GetEntryLength();
        return len;
}

} //end namespace Index

} //end namespace Blex

