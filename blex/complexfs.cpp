#include <blex/blexlib.h>


#include "complexfs.h"
#include "binarylogfile.h"
#include "logfile.h"
#include <map>
#include <iostream>


//#define SHOW_REPLAY
//#define SHOW_DIRACTIVITY
//#define SHOW_OTHER

#ifdef SHOW_REPLAY
 #define DEBUGREPLAYONLY(x) DEBUGONLY(x)
 #define DEBUGREPLAY(x) DEBUGPRINT(x)
#else
 #define DEBUGREPLAYONLY(x) if (debug_complexfs_printlogmsgs) do { x; } while (0)
 #define DEBUGREPLAY(x) if (debug_complexfs_printlogmsgs){std::cout << x << std::endl;}
#endif

#ifdef SHOW_DIRACTIVITY
 #define DA_PRINT(x) DEBUGPRINT(x)
#else
 #define DA_PRINT(x) (void)0
#endif

#ifdef SHOW_OTHER
 #define OTHER_PRINT(x) DEBUGPRINT(x)
#else
 #define OTHER_PRINT(x) (void)0
#endif

namespace Blex
{

bool BLEXLIB_PUBLIC debug_complexfs_printlogmsgs;

namespace
{

unsigned const BlockSize = 1024;
//128KB per section
unsigned const SectionSize = 128 * BlockSize;
unsigned const BlocksPerSection = SectionSize / BlockSize;
unsigned const SectionAllocSize = 8; // Nr of sections to allocate at a time (8 x 128kb = 1MB)
//8 sections are 1MB, keep up to 16MB per section file in memory
unsigned const MaxUnusedSections = 8 * 16;   //ADDME: should be a global resource (for all sectionfiles), and configurable per seciotn file part;

unsigned const MaxSectionsPerFile = 4096; // This is 512 MB total.

unsigned const AllocStreaks = 64;

/// Standard file stream buffer size
unsigned const StandardFileBufferSize = 32768;


inline CFS_FileBlockNr GetBlockNr(FileOffset ofs) { return CFS_FileBlockNr(ofs / BlockSize); }
inline CFS_FileBlockNr GetLimitBlockNr(FileOffset ofs) { return CFS_FileBlockNr((ofs + BlockSize - 1) / BlockSize); }
inline unsigned GetBlockOffset(FileOffset ofs) { return unsigned(ofs % BlockSize); }

namespace LogMsg {
enum _type
{
        EndOfMsgs       = 0, // End of msg
        CreateFile      = 1, // Create file (unsigned id, unsigned parent-id, datetime create_time, std::string name)
        CreateDir       = 2, // Create dir (unsigned id, unsigned parent-id, datetime create_time, std::string name)
        Delete          = 3, // Delete file or dir (unsigned id)
        AddRangeToFile  = 4, // Adds a block range to file, no change to length (unsigned id, unsigned start, unsigned size)
        DropFileBlocks  = 5, // Removes a number of blocks from a file (unsigned id, unsigned count)
        SetLength       = 6, // Set length attribute (unsigned id, FileOffset length)
        SetModTime      = 7, // Set modtime (unsigned id, DateTime modtime)
        MoveRename      = 8, // Set new name and parent id (unsigned id, unsigned parent_id, std::string name)
        SectionInfo     = 9  // Set section file info (unsigned file-nr, unsigned section_count)
};
} // End of namespace logmsg

template < typename A >
 void WriteToMsg(PodVector< uint8_t > &msg, A const &value)
{
        uint8_t data[sizeof(A)];
        PutLsb< A >(data, value);
        msg.insert(msg.end(), data, data + sizeof(A));
}

template <> void WriteToMsg(PodVector< uint8_t > &msg, std::string const &value)
{
        uint8_t data[sizeof(uint32_t)];
        putu32lsb(data, value.size());
        msg.insert(msg.end(), data, data + sizeof(data));
        msg.insert(msg.end(), value.data(), value.data()+value.size());
}
template < typename A >
 void ReadFromMsg(PodVector< uint8_t > const &msg, unsigned &pos, A *value)
{
        if (pos + sizeof(A) > msg.size())
            throw std::runtime_error("ComplexFileStream: Message format error");
        *value = GetLsb< A >(&msg[pos]);
        pos += sizeof(A);
}

template <>
 void ReadFromMsg(PodVector< uint8_t > const &msg, unsigned &pos, std::string *value)
{
        uint32_t len;
        ReadFromMsg(msg, pos, &len);
        if (pos + len > msg.size())
            throw std::runtime_error("ComplexFileStream: Message format error");
        value->resize(len);
        std::copy(msg.begin() + pos, msg.begin() + pos + len, value->begin());
        pos += len;
}

} // End of anonymous namespace

//******************************************************************************
//
//   Message formatting
//

namespace
{

/*
void ResetMsg(PodVector< uint8_t > &msg)
{
        msg.clear();
}
*/

void AddNewFileMsg(PodVector< uint8_t > &msg, CFS_FileId id, CFS_FileId parent_id, DateTime const &createtime, std::string const &name)
{
        msg.push_back(LogMsg::CreateFile);
        WriteToMsg(msg, id);
        WriteToMsg(msg, parent_id);
        WriteToMsg(msg, createtime);
        WriteToMsg(msg, name);
}
void ReadNewFileMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, CFS_FileId *parent_id, DateTime *createtime, std::string *name)
{
        ReadFromMsg(msg, pos, id);
        ReadFromMsg(msg, pos, parent_id);
        ReadFromMsg(msg, pos, createtime);
        ReadFromMsg(msg, pos, name);
}

void AddNewDirMsg(PodVector< uint8_t > &msg, CFS_FileId id, CFS_FileId parent_id, DateTime const &createtime, std::string const &name)
{
        msg.push_back(LogMsg::CreateDir);
        WriteToMsg(msg, id);
        WriteToMsg(msg, parent_id);
        WriteToMsg(msg, createtime);
        WriteToMsg(msg, name);
}
/*
void ReadNewDirMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, CFS_FileId *parent_id, DateTime *createtime, std::string *name)
{
        ReadFromMsg(msg, pos, id);
        ReadFromMsg(msg, pos, parent_id);
        ReadFromMsg(msg, pos, createtime);
        ReadFromMsg(msg, pos, name);
}
*/

void AddDeleteMsg(PodVector< uint8_t > &msg, CFS_FileId id)
{
        msg.push_back(LogMsg::Delete);
        WriteToMsg(msg, id);
}
void ReadDeleteMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id)
{
        ReadFromMsg(msg, pos, id);
}

void AddRangeAddMsg(PodVector< uint8_t > &msg, CFS_FileId id, CFS_Range const &range)
{
        msg.push_back(LogMsg::AddRangeToFile);
        WriteToMsg(msg, id);
        WriteToMsg(msg, range.Start());
        WriteToMsg(msg, range.Size());
}
void ReadRangeAddMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, CFS_Range *range)
{
        ReadFromMsg(msg, pos, id);
        CFS_BlockId start;
        CFS_BlockCount size;
        ReadFromMsg(msg, pos, &start);
        ReadFromMsg(msg, pos, &size);
        *range = CFS_Range(start, size);
}

void AddBlockDropMsg(PodVector< uint8_t > &msg, CFS_FileId id, CFS_BlockCount blockcount)
{
        msg.push_back(LogMsg::DropFileBlocks);
        WriteToMsg(msg, id);
        WriteToMsg(msg, blockcount);
}
void ReadBlockDropMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, CFS_BlockCount *blockcount)
{
        ReadFromMsg(msg, pos, id);
        ReadFromMsg(msg, pos, blockcount);
}

void AddSetLengthMsg(PodVector< uint8_t > &msg, CFS_FileId id, FileOffset length)
{
        msg.push_back(LogMsg::SetLength);
        WriteToMsg(msg, id);
        WriteToMsg(msg, length);
}
void ReadSetLengthMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, FileOffset *length)
{
        ReadFromMsg(msg, pos, id);
        ReadFromMsg(msg, pos, length);
}

void AddSetModTimeMsg(PodVector< uint8_t > &msg, CFS_FileId id, DateTime const &newtime)
{
        msg.push_back(LogMsg::SetModTime);
        WriteToMsg(msg, id);
        WriteToMsg(msg, newtime);
}
void ReadSetModTimeMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, DateTime *newtime)
{
        ReadFromMsg(msg, pos, id);
        ReadFromMsg(msg, pos, newtime);
}

void AddMoveRenameMsg(PodVector< uint8_t > &msg, CFS_FileId id, CFS_FileId newparent, std::string const &newname)
{
        msg.push_back(LogMsg::MoveRename);
        WriteToMsg(msg, id);
        WriteToMsg(msg, newparent);
        WriteToMsg(msg, newname);
}
void ReadMoveRenameMsg(PodVector< uint8_t > const &msg, unsigned &pos, CFS_FileId *id, CFS_FileId *newparent, std::string *newname)
{
        ReadFromMsg(msg, pos, id);
        ReadFromMsg(msg, pos, newparent);
        ReadFromMsg(msg, pos, newname);
}

void AddSectionInfoMsg(PodVector< uint8_t > &msg, uint32_t filenr, uint32_t section_count)
{
        msg.push_back(LogMsg::SectionInfo);
        WriteToMsg(msg, filenr);
        WriteToMsg(msg, section_count);
}
void ReadSectionInfoMsg(PodVector< uint8_t > const &msg, unsigned &pos, uint32_t *filenr, uint32_t *section_count)
{
        ReadFromMsg(msg, pos, filenr);
        ReadFromMsg(msg, pos, section_count);
}

void FinishMsg(PodVector< uint8_t > &msg)
{
        msg.push_back(LogMsg::EndOfMsgs);
}

} // End of anonymous namespace


//******************************************************************************
//
//   CFS_FreeRanges
//

CFS_FreeRanges::StartLimitMap::iterator CFS_FreeRanges::FindRangeWhichIncludes(CFS_BlockId id)
{
        // Upperbound is first bigger, we want last eq or smaller
        StartLimitMap::iterator it = start_limit_ranges.upper_bound(id);
        if (it == start_limit_ranges.begin())
            return start_limit_ranges.end();
        --it;

        if (id >= it->second)
            return start_limit_ranges.end();

        return it;
}

void CFS_FreeRanges::AddRange(CFS_BlockId start, CFS_BlockId limit)
{
        assert(limit > start);
        start_limit_ranges.insert(std::make_pair(start, limit));
        length_start_map.insert(std::make_pair(limit - start, start));
}

void CFS_FreeRanges::RemoveRange(StartLimitMap::iterator it)
{
        assert(it != start_limit_ranges.end());

        CFS_BlockCount len = it->second - it->first;

        // Find and erase entry in len-size map
        LengthStartMap::iterator lsit = length_start_map.find(len);
        assert(lsit != length_start_map.end());

        for (; lsit->second != it->first; ++lsit)
            assert(lsit != length_start_map.end() && lsit->first == len);
        length_start_map.erase(lsit);

        start_limit_ranges.erase(it);
}

void CFS_FreeRanges::FreeRange(CFS_Range const &range)
{
        CFS_BlockId start = range.Start();
        CFS_BlockId limit = range.Limit();
        StartLimitMap::iterator it = start_limit_ranges.end();
        if (start != 0)
        {
                it = FindRangeWhichIncludes(start - 1);
                if (it != start_limit_ranges.end())
                {
                        start = it->first;
                        RemoveRange(it);
                }
        }
        it = FindRangeWhichIncludes(limit);
        if (it != start_limit_ranges.end())
        {
                limit = it->second;
                RemoveRange(it);
        }
        AddRange(start, limit);

        DEBUGONLY(

        std::stringstream ss;
        ss << "Freed range [" << range.Start() << " - " << range.Limit() << ">, current free ranges:" << std::endl;
        for (StartLimitMap::iterator it = start_limit_ranges.begin(), end = start_limit_ranges.end(); it != end; ++it)
            ss << " [" << it->first << " - " << it->second << ">";
        OTHER_PRINT(ss.str());
        );
}

CFS_Range CFS_FreeRanges::AllocateRange(CFS_BlockCount size, CFS_BlockCount min_size, CFS_BlockId start_hint)
{
        if (min_size > size)
            min_size = size;

        StartLimitMap::iterator it = start_limit_ranges.end();
        if (start_hint != 0)
        {
                it = FindRangeWhichIncludes(start_hint);
                if (it != start_limit_ranges.end() && (it->first != start_hint || it->second - it->first < min_size))
                    it = start_limit_ranges.end();
        }
        if (it == start_limit_ranges.end())
        {
                // Find first equal or bigger
                LengthStartMap::iterator lsit = length_start_map.lower_bound(size);
                if (lsit == length_start_map.end())
                {
                        // First higher or equal does not exist, is there a previous length?
                        if (lsit == length_start_map.begin())
                            return CFS_Range(0, 0); // No, return.
                        --lsit;
                }
                // Is this length long enough?
                if (lsit->first < min_size)
                    return CFS_Range(0, 0);

                it = FindRangeWhichIncludes(lsit->second);
        }
        CFS_BlockId start = it->first;
        CFS_BlockCount rsize = it->second - it->first;

        RemoveRange(it);
        size = std::min(size, rsize);
        if (rsize > size)
            AddRange(start + size, start + rsize);

        return CFS_Range(start, size);
}

bool CFS_FreeRanges::AllocateFixedRange(CFS_BlockId start, CFS_BlockCount size)
{
        CFS_BlockId limit = start + size;

        StartLimitMap::iterator it = FindRangeWhichIncludes(start);
        if (it == start_limit_ranges.end() || it->second < limit)
        {
                DEBUGREPLAY("Allocating non-free range " << start << " - " << limit);
                DEBUGREPLAYONLY(
                    for (StartLimitMap::const_iterator cit = start_limit_ranges.begin(); cit != start_limit_ranges.end(); ++cit)
                        DEBUGREPLAY(" Avail range: " << cit->first << " - " << cit->second);
                    );

                return false;
        }

        std::pair< CFS_BlockId, CFS_BlockId > oldrange = *it;
        RemoveRange(it);
        if (oldrange.first != start)
            AddRange(oldrange.first, start);
        if (oldrange.second != limit)
            AddRange(limit, oldrange.second);
        return true;
}

unsigned CFS_FreeRanges::GetFreeBlockCount() const
{
        unsigned total = 0;
        for (auto &itr: start_limit_ranges)
            total += itr.second - itr.first;
        return total;
}

//******************************************************************************
//
//   CFS_FileBlocks
//

CFS_FileBlocks::CFS_FileBlocks()
: length(0)
{
}

CFS_BlockCount CFS_FileBlocks::GetBlockCount() const
{
        return length;
}

CFS_BlockId CFS_FileBlocks::GetDiskBlockId(CFS_FileBlockNr blocknr) const
{
        if (blocknr >= length)
        {
                // Will be called from destructor and a throw would crash the system anyway, so aborting is the safe way.
                ErrStream() << "Requesting disk block id for block past end of file!";
                Blex::FatalAbort();
        }

        Blex::PodVector< Range >::const_iterator begin = ranges.begin();
        unsigned diff = ranges.size();

        while (diff >= 2)
        {
                unsigned middle = diff >> 1;

                Blex::PodVector< Range >::const_iterator middle_it(begin + middle);

//                std::cout << "m " << std::distance(ranges.begin(), begin) << " " << diff << " " << middle_it->offset << std::endl;

                if (middle_it->offset > blocknr)
                    diff = middle;
                else
                {
                        begin = middle_it;
                        diff -= middle;
                }
        }
        return begin->start + (blocknr - begin->offset);
}

void CFS_FileBlocks::StripBlocks(CFS_BlockCount count, std::function< void(CFS_Range const &) > const &receiver)
{
        unsigned newlen = length - count;

        while (!ranges.empty() && ranges.back().offset >= newlen)
        {
                CFS_BlockCount rangelen = length - ranges.back().offset;

                CFS_Range range(ranges.back().start, rangelen);
                if (receiver)
                    receiver(range);

                length -= rangelen;
                ranges.pop_back();
        }

        if (length > newlen)
        {
                CFS_BlockCount rangelen = length - ranges.back().offset;

                // Partial block left
                unsigned stripcount = length - newlen;

                CFS_Range range(ranges.back().start + rangelen - stripcount, stripcount);
                if (receiver)
                    receiver(range);

                length = newlen;
        }
}

void CFS_FileBlocks::AddRange(CFS_Range const &range)
{
/*        std::cout << "Adding " << range.Start() << " " << range.Size() << " x" << std::endl;
        for (Blex::PodVector< Range >::const_iterator it = ranges.begin(); it != ranges.end(); ++it)
            std::cout << " " << it->offset << " " << it->start << std::endl;
        std::cout << " "<< length << std::endl;
*/
        if (!ranges.empty())
        {
                CFS_BlockCount rangelen = length - ranges.back().offset;
                CFS_BlockId limit = ranges.back().start + rangelen;

                if (limit == range.Start())
                {
                        length += range.Size();
/*
                        std::cout << "After:" << std::endl;
                        for (Blex::PodVector< Range >::const_iterator it = ranges.begin(); it != ranges.end(); ++it)
                            std::cout << " " << it->offset << " " << it->start << std::endl;
                        std::cout << " "<< length << std::endl;
*/
                        return;
                }
        }

        Range newrange;
        newrange.offset = length;
        newrange.start = range.Start();
        ranges.push_back(newrange);

        length += range.Size();
/*
        std::cout << "After:" << std::endl;
        for (Blex::PodVector< Range >::const_iterator it = ranges.begin(); it != ranges.end(); ++it)
            std::cout << " " << it->offset << " " << it->start << std::endl;
        std::cout << " "<< length << std::endl;
*/
}

CFS_BlockId CFS_FileBlocks::GetAppendHint() const
{
        if (ranges.empty())
            return 0;

        CFS_BlockCount rangelen = length - ranges.back().offset;
        CFS_BlockId limit = ranges.back().start + rangelen;

        return limit;
}

CFS_Range CFS_FileBlocks::GetRange(unsigned nr) const
{
        unsigned next_offset;
        if (nr == ranges.size() - 1)
            next_offset = length;
        else
            next_offset = ranges[nr + 1].offset;

        return CFS_Range(ranges[nr].start, next_offset - ranges[nr].offset);
}


/*
CFS_BlockCount CFS_FileBlocks::GetBlockCount() const
{
        if (ranges.Empty())
            return 0;
        return ranges.Back().first + ranges.Back().second.Size();
}

CFS_BlockId CFS_FileBlocks::GetDiskBlockId(CFS_FileBlockNr blocknr) const
{
        MapVector< CFS_FileBlockNr, CFS_Range >::const_iterator it = ranges.UpperBound(blocknr);
        assert(it != ranges.Begin());
        --it;
        return it->second.Start() + (blocknr - it->first);
}

void CFS_FileBlocks::StripBlocks(CFS_BlockCount count, std::function< void(CFS_Range const &) > const &receiver)
{
        while (count)
        {
                CFS_Range lastrange = ranges.Back().second;
                if (count >= lastrange.Size())
                {
                        if (receiver)
                            receiver(lastrange);
                        ranges.PopBack();
                        count -= lastrange.Size();
                }
                else
                {
                        CFS_BlockCount blocks_left = lastrange.Size() - count;
                        if (receiver)
                            receiver(CFS_Range(lastrange.Start() + blocks_left, count));
                        ranges.Back().second = CFS_Range(lastrange.Start(), blocks_left);
                        break;
                }
        }
}

void CFS_FileBlocks::AddRange(CFS_Range const &range)
{
        if (!ranges.Empty() && ranges.Back().second.Limit() == range.Start())
        {
                // Coalesce ranges
                ranges.Back().second = CFS_Range(ranges.Back().second.Start(), ranges.Back().second.Size() + range.Size());
        }
        else
            ranges.PushBack(std::make_pair(GetBlockCount(), range));
}

CFS_BlockId CFS_FileBlocks::GetAppendHint()
{
        if (ranges.Empty())
            return 0;

        return ranges.Back().second.Limit();
}
*/

//******************************************************************************
//
//   CFS_DirectoryMapKeeper
//



CFS_DirectoryMapKeeper::CFS_DirectoryMapKeeper(std::string const &indexfsname, bool temp)
{
        if (!indexfsname.empty())
        {
/*
                metadata.reset(new FileStream::OpenWrite(
                        indexfsname + ".dim",
                        true,
                        true,
                        FilePermissions::PublicRead);
*/
                /* Open the index file system. We reuse the pagefile, but since we rebuild the index on every
                   start, we don't need to sync the thing. Also, no state is saved, so the old index contents
                   are discarded anyway.
                */
                indexfs.reset(new Index::DBIndexFileSystem(indexfsname + (temp ? ".didt" : ".did"), 0, false, /*sync=*/false));

                index.reset(new Index::BtreeIndex(*indexfs, "directorymap"));
        }
}

CFS_DirectoryMapKeeper::~CFS_DirectoryMapKeeper()
{
        index.reset();
        indexfs.reset();
}

void CFS_DirectoryMapKeeper::AddEntry(CFS_FileId parent, std::string const &name, CFS_FileId fileid)
{
        DA_PRINT("Add entry " << parent << ":" << name << " -> " << fileid);

        std::string uname(name);
        Blex::ToUppercase(uname);

        if (!index.get())
        {
                direntries.insert(std::make_pair(std::make_pair(parent, uname), fileid));
        }
        else
        {
                Index::IndexBlockEntryContainer entry;
                uint8_t data[Index::IndexBlockEntry::MaxDataSize];

                putu32msb(data, parent);
                unsigned copybytes = std::min(uname.size(), sizeof(data) - 4);
                memcpy(data + 4, uname.c_str(), copybytes);

                entry.ConstructDataEntry(data, copybytes + 4, fileid);
                index->InsertData2(entry);
        }
}

void CFS_DirectoryMapKeeper::RemoveEntry(CFS_FileId parent, std::string const &name, CFS_FileId fileid)
{
        DA_PRINT("Remove entry " << parent << ":" << name << " -> " << fileid);

        std::string uname(name);
        Blex::ToUppercase(uname);

        if (!index.get())
        {
                direntries.erase(std::make_pair(parent, uname));
        }
        else
        {
                Index::IndexBlockEntryContainer entry;
                uint8_t data[Index::IndexBlockEntry::MaxDataSize];

                putu32msb(data, parent);
                unsigned copybytes = std::min(uname.size(), sizeof(data) - 4);
                memcpy(data + 4, uname.c_str(), copybytes);

                entry.ConstructDataEntry(data, copybytes + 4, fileid);
                index->DeleteData2(entry);
        }
}

namespace
{
template < class A >
 std::ostream & operator << (std::ostream &out, PodVector< A > const &vector)
{
        out << "[";

        typename PodVector< A >::const_iterator it = vector.begin(), end = vector.end();

        if (it != end)
        {
                while (true)
                {
                        out << *it;
                        ++it;
                        if (it != end)
                            out << ",";
                        else
                            break;
                }
        }
        out << "]";
        return out;
}

}

void CFS_DirectoryMapKeeper::SendPossibleMatches(CFS_FileId parent, std::string const &name, PodVector< CFS_FileId > *matches)
{
        std::string uname(name);
        Blex::ToUppercase(uname);

        if (!index.get())
        {
                typedef std::map< std::pair< CFS_FileId, std::string >, CFS_FileId >::iterator iterator;

                std::pair< iterator, iterator > range = direntries.equal_range(std::make_pair(parent, uname));

                for (iterator it = range.first; it != range.second; ++it)
                    matches->push_back(it->second);
        }
        else
        {
                Index::BtreeIndex::Query query(*index);

                uint8_t data[Index::IndexBlockEntry::MaxDataSize];

                putu32msb(data, parent);
                unsigned copybytes = std::min(uname.size(), sizeof(data) - 4);
                memcpy(data + 4, uname.c_str(), copybytes);

                Index::IndexBlockEntryContainer begin, end;
                begin.ConstructDataEntry(data, copybytes + 4, 0);
                end.ConstructDataEntry(data, copybytes + 4, uint32_t(-1));

                query.ResetNewQuery(begin, end);

                Index::Query::OnlineRef onlineref(query);

                Index::BtreeIndex::OnlineIterator indexit(onlineref, *query.begin());

                while (*indexit < *query.approx_end())
                {
                        matches->push_back(indexit->GetRecordId());
                        ++indexit;
                }
        }


        DA_PRINT("Matches for " << parent << ":" << name << ": " << *matches);
}

void CFS_DirectoryMapKeeper::SendDirectoryContents(CFS_FileId parent, PodVector< CFS_FileId > *matches)
{
        if (!index.get())
        {
                typedef std::map< std::pair< CFS_FileId, std::string >, CFS_FileId >::iterator iterator;

                iterator begin = direntries.lower_bound(std::make_pair(parent, ""));
                iterator end = direntries.lower_bound(std::make_pair(parent + 1, ""));

                for (iterator it = begin; it != end; ++it)
                    matches->push_back(it->second);
        }
        else
        {
                Index::BtreeIndex::Query query(*index);

                uint8_t data[Index::IndexBlockEntry::MaxDataSize];
                memset(data, 255, sizeof(data));

                putu32msb(data, parent);

                Index::IndexBlockEntryContainer begin, end;
                begin.ConstructDataEntry(data, 4, 0);
                end.ConstructDataEntry(data, sizeof(data), uint32_t(-1));

                query.ResetNewQuery(begin, end);

                Index::Query::OnlineRef onlineref(query);

                Index::BtreeIndex::OnlineIterator indexit(onlineref, *query.begin());

                while (*indexit < *query.approx_end())
                {
                        matches->push_back(indexit->GetRecordId());
                        ++indexit;
                }

        }
        DA_PRINT("Contents for " << parent << ": " << *matches);
}

void CFS_DirectoryMapKeeper::SendAndKillDirectoryContents(CFS_FileId parent, PodVector< CFS_FileId > *matches)
{
        if (!index.get())
        {
                typedef std::map< std::pair< CFS_FileId, std::string >, CFS_FileId >::iterator iterator;

                iterator begin = direntries.lower_bound(std::make_pair(parent, ""));
                iterator end = direntries.lower_bound(std::make_pair(parent + 1, ""));

                for (iterator it = begin; it != end;)
                {
                        matches->push_back(it->second);
                        direntries.erase(it++);
                }
        }
        else
        {
                Index::BtreeIndex::Query query(*index);

                uint8_t data[Index::IndexBlockEntry::MaxDataSize];
                memset(data, 255, sizeof(data));

                putu32msb(data, parent);

                Index::IndexBlockEntryContainer begin, end;
                begin.ConstructDataEntry(data, 4, 0);
                end.ConstructDataEntry(data, sizeof(data), uint32_t(-1));

                query.ResetNewQuery(begin, end);

                Index::IndexBlockEntryContainer current;
                while (true)
                {
                        {
                                Index::Query::OnlineRef onlineref(query);

                                Index::BtreeIndex::OnlineIterator indexit(onlineref, *query.begin());

                                if (*indexit < *query.approx_end())
                                {
                                        matches->push_back(indexit->GetRecordId());
                                        current.CopyFrom(*indexit);
                                }
                                else
                                    break;
                        }
                        index->DeleteData2(current);
                }

        }
        DA_PRINT("(Killed) contents for " << parent << ": " << *matches);
}

//******************************************************************************
//
//   CFS_File
//

static Blex::Mutex countermutex;
static unsigned file_counter = 0;

CFS_File::CFS_File(CFS_FileId const _file_id)
: open_handles(0)
, file_id(_file_id)
{
        Blex::Mutex::AutoLock lock(countermutex);
        ++file_counter;
//        OTHER_PRINT("Created CFS_File " << this << ", now " << file_counter << " files");
}

CFS_File::~CFS_File()
{
        Blex::Mutex::AutoLock lock(countermutex);
        --file_counter;
//        OTHER_PRINT("Destroyed CFS_File " << this << ", now " << file_counter << " files");
}

uint8_t * CFS_File::GetBlock(ComplexFileSystem &fs, CFS_FileData const &lockeddata, CFS_FileBlockNr blocknr, std::unique_ptr< CFS_SectionBase > &section, bool for_write)
{
        CFS_BlockId blockid = lockeddata.blocks.GetDiskBlockId(blocknr);
        unsigned section_nr = fs.GetSectionNumber(blockid);

        if (!section.get() || section->GetSectionId() != section_nr)
        {
                section.reset();
                section.reset(fs.OpenSection(section_nr, for_write));
        }
        unsigned section_pos = (blockid % BlocksPerSection) * BlockSize;
        return *section + section_pos;
}

std::size_t CFS_File::DirectRead(ComplexFileSystem &fs, FileOffset offset, uint8_t *buffer, std::size_t size, std::unique_ptr< CFS_SectionBase > &section)
{
        // Check for argument validity or empty read
        if (size == 0)
            return 0;

        CFS_FileDataProtector::ReadRef lock(fs.filedataprotector, *this);

        if (lock->length <= offset) // Does the file exist at this offset? If not, we're done.
            return 0;

        CFS_FileBlockNr current_block = GetBlockNr(offset);
        unsigned start = GetBlockOffset(offset);

        // Calculate limit and real read size
        FileOffset limit = std::min(lock->length, offset + size);
        size = std::min(size, (std::size_t)(limit - offset));

        std::size_t total_read = 0;

        while (size != total_read)
        {
                unsigned read_now = std::min<unsigned>(BlockSize - start, size - total_read);

                uint8_t *blockpos = GetBlock(fs, *lock, current_block, section, false);
                memcpy(&buffer[total_read], blockpos + start, read_now);

                total_read += read_now;
                start = 0;
                ++current_block;
        }

        return total_read;
}

std::size_t CFS_File::LockedWrite(ComplexFileSystem &fs, CFS_FileDataProtector::WriteRef &lock, FileOffset offset, uint8_t const *buffer, std::size_t size, std::unique_ptr< CFS_SectionBase > &section)
{
        PodVector< uint8_t > msg;

        OTHER_PRINT("Write for file #" << file_id << ", offset " << offset << ", size: " << size << ", length now is " << lock->length);

        FileOffset limit = offset + size;
        FileOffset write_start;
        FileOffset write_zeros;
        CFS_BlockCount total_need_extra_blocks = 0;
        if (limit > lock->length)
        {
                unsigned start_blocks = GetLimitBlockNr(lock->length);
                unsigned end_blocks = GetLimitBlockNr(limit);

                CFS_BlockCount need_extra_blocks = end_blocks - start_blocks;
                total_need_extra_blocks = need_extra_blocks;

                // Min alloc size (file 1024 > mb? want blocks of 1mb)
                unsigned min_alloc_size = 0;
                if (end_blocks >= 1024)
                    min_alloc_size = 1024;
                else if (end_blocks >= 256)
                    min_alloc_size = 256;
                else if (end_blocks >= 64)
                    min_alloc_size = 64;

                OTHER_PRINT("Allocating " << total_need_extra_blocks << " blocks for file #" << file_id);

                while (need_extra_blocks)
                {
                        OTHER_PRINT("- New alloc round, still want " << need_extra_blocks << " blocks");

                        // No reservation in place? Get a new one
                        if (lock->reservation.Size() == 0)
                        {
                                CFS_BlockId hint = lock->blocks.GetAppendHint();

                                // Allocate a new range
                                lock->reservation = fs.AllocateRange(std::max(min_alloc_size, need_extra_blocks), std::max(min_alloc_size, AllocStreaks), hint);

                                OTHER_PRINT("  - Got new reservation of size " << lock->reservation.Size() << " (asked for " << need_extra_blocks << ", min alloc size: " << min_alloc_size << ") (range: [" << lock->reservation.Start() << ", " << lock->reservation.Limit() << ">)");
                        }
                        else
                        {
                                OTHER_PRINT("  - Reusing reservation of size " << lock->reservation.Size());
                        }

                        CFS_Range range = lock->reservation;
                        if (range.Size() > need_extra_blocks)
                        {
                                // Allocated too much, put the rest back in the reservation
                                range = CFS_Range(range.Start(), need_extra_blocks);
                                lock->reservation = CFS_Range(lock->reservation.Start() + need_extra_blocks, lock->reservation.Size() - need_extra_blocks);
                                OTHER_PRINT("  - Reservation partly used, left: " << lock->reservation.Size());
                        }
                        else
                        {
                                OTHER_PRINT("  - Reservation completely used");
                                lock->reservation = CFS_Range(0, 0); // use all, clear the reservation
                        }

                        // Add the newlay allocated range
                        AddRangeAddMsg(msg, file_id, range);
                        lock->blocks.AddRange(range);

                        // And see how much more we need to get
                        need_extra_blocks -= range.Size();
                }
                if (offset > lock->length)
                {
                        write_zeros = offset - lock->length;
                        write_start = lock->length;
                }
                else
                {
                        write_zeros = 0;
                        write_start = offset;
                }
        }
        else
        {
                write_zeros = 0;
                write_start = offset;
        }

        unsigned start = GetBlockOffset(write_start);
        CFS_FileBlockNr current_block = GetBlockNr(write_start);

        // Write out the needed zeros
        while (write_zeros)
        {
                // Calculate how many we can write in this block
                unsigned room_left = BlockSize - start;
                unsigned write_now = unsigned(std::min< FileOffset >(room_left, write_zeros));

                uint8_t *blockpos = GetBlock(fs, *lock, current_block, section, true);
                memset(blockpos+start, 0, write_now);

                // Update starting position, go to next block when needed
                start += write_now;
                write_zeros -= write_now;
                if (start == BlockSize)
                {
                        ++current_block;
                        start = 0;
                }
        }

        // Start writing out the data
        std::size_t written = 0;
        while (written != size)
        {
                // Calculate how many we can write in this block
                unsigned write_now = std::min<unsigned>(BlockSize - start, size - written);

                uint8_t *blockpos = GetBlock(fs, *lock, current_block, section, true);
                memcpy(blockpos + start, &buffer[written], write_now);

                written += write_now;
                start = 0;
                ++current_block;
        }

        if (lock->length < offset + size)
        {
                if (fs.IsLogged())
                {
                        // Write message only if it contains block updates
                        if (fs.syncmode == ComplexFileSystem::WriteThrough || total_need_extra_blocks)
                        {
                                AddSetLengthMsg(msg, file_id, offset + size);
                                FinishMsg(msg);
                                fs.AppendMessage(msg, fs.syncmode == ComplexFileSystem::WriteThrough);
                        }
                }

                lock->length = offset + size;
        }

        return written;
}

void CFS_File::ReleaseReservations(ComplexFileSystem &fs, CFS_FileDataProtector::WriteRef &lock)
{
        if (lock->reservation.Size() != 0)
        {
                // Reservation may be freed immediately, no chance of it containing data
                OTHER_PRINT("Releasing reservation of size " << lock->reservation.Size() << " blocks for file #" << file_id);
                fs.FreeRange(lock->reservation);
        }

        lock->reservation = CFS_Range(0,0);
}

std::size_t CFS_File::DirectWrite(ComplexFileSystem &fs, FileOffset offset, uint8_t const *buffer, std::size_t size, std::unique_ptr< CFS_SectionBase > &section)
{
        // Check for argument validity
        if (size == 0)
            return 0;

        CFS_FileDataProtector::WriteRef lock(fs.filedataprotector, *this);

        std::size_t written = LockedWrite(fs, lock, offset, buffer, size, section);

        return written;
}

void CFS_File::SetLength(ComplexFileSystem &fs, FileOffset newlength)
{
        std::unique_ptr< CFS_SectionBase > section;

        bool need_commit = false;
        {
                CFS_FileDataProtector::WriteRef lock(fs.filedataprotector, *this);

                if (lock->length < newlength)
                {
                        // Extension operation is writing 0-length to new length place, auto-extending it.
                        LockedWrite(fs, lock, newlength, 0, 0, section);
                }
                else
                {
                        CFS_BlockCount need_freed_blocks = GetLimitBlockNr(lock->length) - GetLimitBlockNr(newlength);
                        lock->blocks.StripBlocks(need_freed_blocks, std::bind(&ComplexFileSystem::MarkRangeFree, std::ref(fs), std::placeholders::_1));

                        lock->length = newlength;

                        if (fs.IsLogged())
                        {
                                need_commit = fs.syncmode != ComplexFileSystem::BufferAll;

                                PodVector< uint8_t > msg;
                                AddBlockDropMsg(msg, file_id, need_freed_blocks);
                                AddSetLengthMsg(msg, file_id, newlength);
                                FinishMsg(msg);
                                fs.AppendMessage(msg, false);
                        }
                }
        }
        if (need_commit || !fs.IsLogged()) // Not logged: do a commit to free up ranges
            fs.Commit();
}

void CFS_File::UnloggedRemoveContents(ComplexFileSystem &fs)
{
        CFS_FileDataProtector::WriteRef lock(fs.filedataprotector, *this);

        CFS_BlockCount need_freed_blocks = GetLimitBlockNr(lock->length);
        lock->blocks.StripBlocks(need_freed_blocks, std::bind(&ComplexFileSystem::MarkRangeFree, std::ref(fs), std::placeholders::_1));

        lock->length = 0;
}


FileOffset CFS_File::GetFileLength(ComplexFileSystem const &fs) const
{
        CFS_FileDataProtector::ReadRef lock(fs.filedataprotector, *this);
        return lock->length;
}

DateTime CFS_File::GetCreateTime(ComplexFileSystem const &fs) const
{
        ComplexFileSystem::LockedFileData::ReadRef lock(fs.filedata);
        return createtime;
}

DateTime CFS_File::GetModTime(ComplexFileSystem const &fs) const
{
        ComplexFileSystem::LockedFileData::ReadRef lock(fs.filedata);
        OTHER_PRINT("*** ComplexFS " << this << ": modtime of file '" << name << "' is " << modtime);
        return modtime;
}

struct CFS_File::DirEntryLess
{
        bool operator()(CFS_File *lhs, CFS_File *rhs) { return StrCaseLess< std::string >()(lhs->name, rhs->name); }
        bool operator()(CFS_File *lhs, std::string const &rhs) { return StrCaseLess< std::string >()(lhs->name, rhs); }
        bool operator()(std::string const &lhs, CFS_File *rhs) { return StrCaseLess< std::string >()(lhs, rhs->name); }
};

//******************************************************************************
//
//   CFS_SectionBase
//

CFS_SectionBase::~CFS_SectionBase()
{
}

//******************************************************************************
//
//   CFS_VectorSection
//

struct CFS_VectorSection : public CFS_SectionBase
{
        inline CFS_VectorSection(unsigned id, std::vector< uint8_t > *_data) : CFS_SectionBase(id), data(_data) {}

        std::vector< uint8_t > *data;

        virtual operator uint8_t*();
};

CFS_VectorSection::operator uint8_t*()
{
        return &(*data)[0];
}

//******************************************************************************
//
//   CFS_FileSection
//

struct CFS_FileSection : public CFS_SectionBase
{
        SectionFile *sectionfile;

        SectionFile::AutoSection lock;

        CFS_FileSection(unsigned id, SectionFile *_sectionfile, unsigned section_nr);

        virtual operator uint8_t*();
};

CFS_FileSection::CFS_FileSection(unsigned id, SectionFile *_sectionfile, unsigned section_nr)
: CFS_SectionBase(id)
, sectionfile(_sectionfile)
, lock(*sectionfile, section_nr)
{
}

CFS_FileSection::operator uint8_t*()
{
        return lock;
}


//******************************************************************************
//
//   ComplexFileSystem::FileData
//

                /// Constructor
ComplexFileSystem::FileData::FileData()
: standard_filebufsize(StandardFileBufferSize)
, last_fid(0)
, fid_restart_counter(0)
{
}

CFS_FileId ComplexFileSystem::FileData::AllocateNewFileId()
{
/*
DEBUGONLY(std::string fileids;
for (std::map< CFS_FileId, std::shared_ptr< CFS_File > >::iterator it = files.begin(); it != files.end(); ++it)
    fileids += " " + Blex::AnyToString(it->first);
OTHER_PRINT("*** ComplexFS: allocating new fileid in:" << fileids););
*/
        /** Allocate a new file id. It starts at 1, scans linearly until 1000 allocations have been done,
            and then starts at 1 again (to fill holes).
        */
        CFS_FileId current;

        // Restart scanning from 1 every 1000 files.
        if (++fid_restart_counter >= 1000)
        {
                fid_restart_counter = 0;
                current = 1;
        }
        else
            current = last_fid + 1;

        // Don't forget to put the iterator at the right position, desync can cause double allocs!
        std::map< CFS_FileId, std::shared_ptr< CFS_File > >::iterator it = files.lower_bound(current);

        while (it != files.end() && it->first == current)
        {
                ++it;
                ++current;
        }

        // Just checkin', don't trust the algo just yet.
        if (files.find(current) != files.end())
            throw std::runtime_error("File id allocation algorithm just allocated an already used file id!!!");

        last_fid = current;
        return current;
}

//******************************************************************************
//
//   ComplexFileSystem
//

// Error functions
namespace
{
void ThrowInternalFileNotFound(unsigned file_id)
{
        throw std::runtime_error("ComplexFS: Internal error: File #" + Blex::AnyToString(file_id) + " not found");
}


} // End of anonymous namespace

ComplexFileSystem::ComplexFileSystem()
: root_path("")
, syncmode(WriteThrough)
, temporary(false)
, disable_flush(false)
{
        OTHER_PRINT("*** ComplexFS " << this << ": Opening memory-based filesystem");
        Init("", true);
}

ComplexFileSystem::ComplexFileSystem(std::string const &disk_path, bool create_exclusive)
: root_path(disk_path)
, syncmode(BufferAll)
, temporary(true)
, disable_flush(false)
{
        OTHER_PRINT("*** ComplexFS " << this << ": Opening filesystem " << disk_path);
        Init(disk_path, create_exclusive);
}

ComplexFileSystem::ComplexFileSystem(std::string const &disk_path, bool create_exclusive, SyncMode _syncmode)
: root_path(disk_path)
, syncmode(_syncmode)
, temporary(false)
, disable_flush(false)
{
        OTHER_PRINT("*** ComplexFS " << this << ": Opening filesystem " << disk_path);
        Init(disk_path, create_exclusive);
}

ComplexFileSystem::ComplexFileSystem(std::string const &disk_path, bool create_exclusive, SyncMode _syncmode, bool disable_flush)
: root_path(disk_path)
, syncmode(_syncmode)
, temporary(false)
, disable_flush(disable_flush)
{
        OTHER_PRINT("*** ComplexFS " << this << ": Opening filesystem " << disk_path);
        Init(disk_path, create_exclusive);
}

ComplexFileSystem::~ComplexFileSystem()
{
        OTHER_PRINT("*** ComplexFS " << this << ": Destroying filesystem " << root_path);
        if (!temporary)
            Flush();
}

void ComplexFileSystem::Init(std::string const &disk_path, bool create_exclusive)
{
        *LockedTempCounter::WriteRef(tempcounter) = 0;

        bool need_commit = false;
        {
                LockedFileData::WriteRef lock(filedata);

                lock->dirmapkeeper.reset(new CFS_DirectoryMapKeeper(temporary ? std::string("") : disk_path, false));

                bool in_memory = disk_path.empty();
                {
                        // Init block data within lock, then release, so we can open file locks
                        LockedBlockData::WriteRef block(blockdata);
                        block->in_memory = in_memory;
                        block->total_sections = 0;
                }

                bool is_empty = true;
                if (!in_memory && !temporary)
                {
                        if (!disable_flush)
                            log.reset(BinaryLogFile::Open(disk_path + ".cfslog", create_exclusive));
                        else
                            log.reset(BinaryLogFile::OpenNoFlush(disk_path + ".cfslog", create_exclusive));

                        if (!log.get())
                            throw std::runtime_error("ComplexFileSystem: Cannot open file log " + disk_path + ".cfslog");

                        DEBUGREPLAY("Replaying log for initialization. Contents of replay log:");
                        DEBUGREPLAYONLY(log->SendAllMessages(std::bind(&ComplexFileSystem::ReplayMessage, std::ref(*this), std::placeholders::_1, std::ref(lock->files), (CFS_DirectoryMapKeeper *)0, true)));
                        DEBUGREPLAY("\nExecuting replay log:");
                        log->SendAllMessages(std::bind(&ComplexFileSystem::ReplayMessage, std::ref(*this), std::placeholders::_1, std::ref(lock->files), lock->dirmapkeeper.get(), false));
                        DEBUGREPLAY("Recording used blocks from replay");
                        RecordAllocatedBlocks(lock->files, lock->dirmapkeeper.get());

                        DEBUGREPLAY("List of currently present files:");
                        DEBUGREPLAYONLY(
                            for (FileEntryMap::const_iterator it = lock->files.begin(); it != lock->files.end(); ++it)
                            {
                                    std::stringstream str;
                                    str << " File #" << it->first << " '" << it->second->name << "'";
                                    if (it->second->is_directory)
                                    {
                                            str << "is directory";
/*                                            str << " [";
                                            for (std::vector< CFS_File * >::const_iterator dit = it->second->direntries.begin(); dit != it->second->direntries.end(); ++dit)
                                                str << (dit == it->second->direntries.begin() ? "" : ", ") << (*dit)->file_id;
                                            str << "]";*/
                                    }
                                    else
                                    {
                                            CFS_FileDataProtector::WriteRef flock(filedataprotector, *it->second);
                                            str << " len: " << flock->length;
                                    }
                                    DEBUGREPLAY(str.str());
                            }
                        );

                        is_empty = lock->files.empty();
                }
                if (is_empty)
                {
                        DateTime ctime = DateTime::Now();
                        std::shared_ptr< CFS_File > root_dir(new CFS_File(1));
                        root_dir->createtime = ctime;
                        root_dir->modtime = root_dir->createtime;
                        root_dir->is_directory = true;
                        lock->files[1] = root_dir;

                        // Immediately commit initial root directory; we need it.
                        if (IsLogged())
                        {
                                PodVector< uint8_t > msg;
                                AddNewDirMsg(msg, 1, 0, ctime, "");
                                FinishMsg(msg);
                                AppendMessage(msg, false);
                                need_commit = true;
                        }
                }
        }
        if (need_commit || !IsLogged())
            Commit();
}

void ComplexFileSystem::ReplayMessage(PodVector< uint8_t > const &msg, FileEntryMap &files, CFS_DirectoryMapKeeper *direntries, bool dont_execute)
{
        assert(msg.size() != 0);
        unsigned pos = 0;
        while (true)
        {
                uint8_t type_b;
                ReadFromMsg(msg, pos, &type_b);
                LogMsg::_type type = static_cast< LogMsg::_type >(type_b);

                if (type == LogMsg::EndOfMsgs)
                    break;

                switch (type)
                {
                case LogMsg::CreateFile:        // Create file (unsigned id, unsigned parent-id, datetime create_time, std::string name)
                case LogMsg::CreateDir:         // Create dir (unsigned id, unsigned parent-id, datetime create_time, std::string name)
                        {
                                CFS_FileId file_id, parent_id;
                                DateTime create_time;
                                std::string name;

                                ReadNewFileMsg(msg, pos, &file_id, &parent_id, &create_time, &name);

                                DEBUGREPLAY("Replay: Adding " << (type == LogMsg::CreateDir ? "directory" : "file") << " #" << file_id << " named '" << name << "'");
                                if (dont_execute)
                                    break;

                                // Lookup parent when it is not zero. Directories must exist (cannot be deleted at runtime whe create succeeds)
                                CFS_File *parent = parent_id != 0 ? GetFileById(files, parent_id, false) : 0;

                                std::shared_ptr< CFS_File > &file = files[file_id];
                                if(file.get())
                                {
                                        Blex::ErrStream() << "File '" << name << "' has duplicate id " << file_id << " in directory " << parent_id;
                                        break;
                                }
                                file.reset(new CFS_File(file_id));

                                file->is_directory = type == LogMsg::CreateDir;
                                file->parent = parent;
                                file->open_handles = 0;
                                file->createtime = create_time;
                                file->modtime = DateTime::Invalid();
                                file->name = name;
                                // Length defaults to zero

                                // Add to parent dir
                                if (file->parent != 0)
                                {
                                        direntries->AddEntry(parent_id, name, file_id);
                                }
                        } break;
                case LogMsg::Delete:
                        {
                                CFS_FileId root;
                                ReadDeleteMsg(msg, pos, &root);

                                DEBUGREPLAY("Replay: Recursive delete of file #" << root);
                                if (dont_execute)
                                    break;

                                // The deleted file MUST exist (cannot be deleted again at runtime)
                                CFS_File *file = GetFileById(files, root, false);
                                assert(file->parent != 0);

                                direntries->RemoveEntry(file->parent->file_id, file->name, root);
                                PodVector< CFS_FileId > worklist2;
                                worklist2.push_back(root);
                                while (!worklist2.empty())
                                {
                                        CFS_FileId curr = worklist2.back();
                                        worklist2.pop_back();

                                        direntries->SendAndKillDirectoryContents(curr, &worklist2);
                                        files.erase(curr);
                                }

                        } break;
                case LogMsg::AddRangeToFile:    // Adds a block range to file, no change to length (unsigned id, unsigned start, unsigned size)
                        {
                                CFS_FileId file_id;
                                CFS_Range range;
                                ReadRangeAddMsg(msg, pos, &file_id, &range);

                                DEBUGREPLAY("Replay: Adding range to file #" << file_id << ": " << range.Start() << " - " << range.Limit());
                                if (dont_execute)
                                    break;

                                // File can be already deleted at runtime
                                CFS_File *file = GetFileById(files, file_id, true);
                                if (!file)
                                    break;
                                CFS_FileDataProtector::UnlockedWriteRef lock(filedataprotector, *file);
                                lock->blocks.AddRange(range);
                        } break;
                case LogMsg::DropFileBlocks:    // Removes a number of blocks from a file (unsigned id, unsigned count)
                        {
                                CFS_FileId file_id;
                                CFS_BlockCount count;
                                ReadBlockDropMsg(msg, pos, &file_id, &count);

                                DEBUGREPLAY("Replay: Stripping blocks from file #" << file_id << ": " << count);
                                if (dont_execute)
                                    break;

                                // File can be already deleted at runtime
                                CFS_File *file = GetFileById(files, file_id, true);
                                if (!file)
                                    break;
                                CFS_FileDataProtector::UnlockedWriteRef lock(filedataprotector, *file);
                                lock->blocks.StripBlocks(count, 0);

                        } break;
                case LogMsg::SetLength:         // Set length attribute (unsigned id, FileOffset length)
                        {
                                CFS_FileId file_id;
                                FileOffset newlength;
                                ReadSetLengthMsg(msg, pos, &file_id, &newlength);

                                DEBUGREPLAY("Replay: Set length of file #" << file_id << ": " << newlength);
                                if (dont_execute)
                                    break;

                                // File can be already deleted at runtime
                                CFS_File *file = GetFileById(files, file_id, true);
                                if (!file)
                                    break;
                                CFS_FileDataProtector::UnlockedWriteRef lock(filedataprotector, *file);
                                lock->length = newlength;
                        } break;
                case LogMsg::SetModTime:        // Set modtime (unsigned id, DateTime modtime)
                        {
                                CFS_FileId file_id;
                                DateTime new_time;
                                ReadSetModTimeMsg(msg, pos, &file_id, &new_time);

                                DEBUGREPLAY("Replay: Set modtime of file #" << file_id << ": " << new_time);
                                if (dont_execute)
                                    break;

                                // File can be already deleted at runtime
                                CFS_File *file = GetFileById(files, file_id, true);
                                if (!file)
                                    break;
                                file->modtime = new_time;
                        } break;
                case LogMsg::MoveRename:        // Set name and parent (unsigned id, unsigned parent_id, std::string name)
                        {
                                CFS_FileId file_id;
                                CFS_FileId new_parent_id;
                                std::string new_name;
                                ReadMoveRenameMsg(msg, pos, &file_id, &new_parent_id, &new_name);

                                DEBUGREPLAY("Replay: Moving/renaming file #" << file_id << ": new parent is " << new_parent_id << ", new name is '" << new_name << "'");
                                if (dont_execute)
                                    break;

                                // Files must exist for move to succeed at runtime
                                CFS_File *file = GetFileById(files, file_id, false);
                                assert(file->parent != 0);
                                CFS_File *new_parent = GetFileById(files, new_parent_id, false);

                                direntries->RemoveEntry(file->parent->file_id, file->name, file_id);

                                file->name = new_name;
                                file->parent = new_parent;

                                direntries->AddEntry(new_parent_id, new_name, file_id);
                        } break;
                case LogMsg::SectionInfo:
                        {
                                uint32_t file_nr;
                                uint32_t section_count;
                                ReadSectionInfoMsg(msg, pos, &file_nr, &section_count);

                                DEBUGREPLAY("Replay: Resizing section file #" << file_nr << ", new size is " << section_count);
                                if (dont_execute)
                                    break;

                                LockedBlockData::WriteRef block(blockdata);
                                if (block->files.size() == file_nr)
                                    AppendSectionFile(block, false);
                                else if (block->files.size() < file_nr)
                                    throw std::runtime_error("ComplexFileSystem: Log has section file messages in wrong order!");

                                if (block->files[file_nr].second < section_count)
                                {
                                        unsigned diff = section_count - block->files[file_nr].second;
                                        block->files[file_nr].second = section_count;
                                        block->free_ranges.FreeRange(CFS_Range(block->total_sections * BlocksPerSection, diff * BlocksPerSection));
                                        block->total_sections += diff;
                                }
                        } break;
                default:
                    throw std::runtime_error("Illegal log operation id");
                }
        }
        if (pos != msg.size())
            throw std::runtime_error("ComplexFileSystem: Message format error!");
}

void ComplexFileSystem::RebuildLog()
{
        // Try to start rewrite
        if (!log->TryStartLogRewrite())
            return;

        FileEntryMap files;

        {
                LockedBlockData::ReadRef block(blockdata);

                PodVector< uint8_t > msg;
                for (unsigned i = 0, end = block->files.size(); i < end; ++i)
                    AddSectionInfoMsg(msg, i, block->files[i].second);

                FinishMsg(msg);
                log->WriteRewriteMessage(msg.begin(), msg.size());
        }

        CFS_DirectoryMapKeeper tempmap(root_path, true);

        log->SendRewriteMessages(std::bind(&ComplexFileSystem::ReplayMessage, std::ref(*this), std::placeholders::_1, std::ref(files), &tempmap, false));

        SendFilesToRewrite(files, &tempmap, 1);

        log->CompleteLogRewrite();
}

void ComplexFileSystem::Commit()
{
        if (IsLogged())
        {
                log->Commit(false);
                if (log->GetChainCount() > 2)
                    RebuildLog();
        }

        // Free up all the ranges that were marked as free since the last commit.
        std::vector< CFS_Range > free_ranges;
        {
                LockedFreedBlockList::WriteRef lock(freed_block_list);
                if (!lock->free_ranges.empty())
                    free_ranges.swap(lock->free_ranges);
        }
        if (!free_ranges.empty())
        {
                OTHER_PRINT("Committing releases of " << free_ranges.size() << " previously freed ranges");
                for (std::vector< CFS_Range >::const_iterator it = free_ranges.begin(), end = free_ranges.end(); it != end; ++it)
                    FreeRange(*it);
        }
}

void ComplexFileSystem::SendFilesToRewrite(FileEntryMap &files, CFS_DirectoryMapKeeper *dirmapkeeper, unsigned file_id)
{
        CFS_File const *file = GetFileById(files, file_id, false);

        if (file->is_directory)
        {
                PodVector< uint8_t > msg;
                AddNewDirMsg(msg, file_id, file->parent ? file->parent->file_id : 0, file->createtime, file->name);
                AddSetModTimeMsg(msg, file_id, file->modtime);
                FinishMsg(msg);
                log->WriteRewriteMessage(msg.begin(), msg.size());

                PodVector< CFS_FileId > contents;
                dirmapkeeper->SendDirectoryContents(file_id, &contents);

                for (PodVector< CFS_FileId >::iterator it = contents.begin(), end = contents.end(); it != end; ++it)
                    SendFilesToRewrite(files, dirmapkeeper, *it);
        }
        else
        {
                CFS_FileDataProtector::ReadRef lock(filedataprotector, *file);

                PodVector< uint8_t > msg;
                AddNewFileMsg(msg, file_id, file->parent->file_id, file->createtime, file->name);
                AddSetModTimeMsg(msg, file_id, file->modtime);
                for (unsigned i = 0, end = lock->blocks.GetRangeCount(); i < end; ++i)
                    AddRangeAddMsg(msg, file_id, lock->blocks.GetRange(i));
                AddSetLengthMsg(msg, file_id, lock->length);
                FinishMsg(msg);

                log->WriteRewriteMessage(msg.begin(), msg.size());
        }
}

CFS_File * ComplexFileSystem::GetFileById(FileEntryMap &files, unsigned file_id, bool allow_fail)
{
        FileEntryMap::iterator it = files.find(file_id);
        if (it == files.end())
        {
                if (!allow_fail)
                    ThrowInternalFileNotFound(file_id);
                else
                   return 0;
        }
        return it->second.get();
}

CFS_File const * ComplexFileSystem::GetFileById(FileEntryMap const &files, unsigned file_id, bool allow_fail)
{
        FileEntryMap::const_iterator it = files.find(file_id);
        if (it == files.end())
        {
                if (!allow_fail)
                    ThrowInternalFileNotFound(file_id);
                else
                   return 0;
        }
        return it->second.get();
}

void ComplexFileSystem::RecordAllocatedBlocks(FileEntryMap &files, CFS_DirectoryMapKeeper *dirmapkeeper)
{
        FileEntryMap::iterator nextfile;
        for (FileEntryMap::iterator it = files.begin(); it != files.end(); it=nextfile)
        {
                CFS_FileDataProtector::WriteRef flock(filedataprotector, *it->second);

                LockedBlockData::WriteRef bdlock(blockdata);

                unsigned range_count = flock->blocks.GetRangeCount();
                nextfile = it;
                ++nextfile;

                DEBUGREPLAY(" Allocating " << range_count << " ranges for file " << it->second->name);

                for (unsigned i = 0; i < range_count; ++i)
                {
                        CFS_Range range = flock->blocks.GetRange(i);
                        DEBUGREPLAY(" Allocating range " << range.Start() << " - " << range.Limit());
                        if (!bdlock->free_ranges.AllocateFixedRange(range.Start(), range.Size()))
                        {
                                Blex::ErrStream() << "File " << it->second->name << " overlaps existing data (range " << range.Start() << " - " << range.Limit() << ") - it will be deleted later";
                                dirmapkeeper->RemoveEntry(it->second->parent->file_id, it->second->name, it->second->file_id);
                                files.erase(it);
                                break;
                        }
                }
        }
}


void ComplexFileSystem::AppendMessage(PodVector< uint8_t > const &message, bool commit)
{
        assert(log.get());
        log->WriteMessage(message.begin(), message.size(), commit);
}

unsigned ComplexFileSystem::GetSectionNumber(CFS_BlockId blocknr)
{
        return blocknr / BlocksPerSection;
}

CFS_BlockId ComplexFileSystem::GetFirstBlockOfSection(unsigned sectionnr)
{
        return sectionnr * BlocksPerSection;
}

void ComplexFileSystem::HandleClosed(CFS_File *file, bool has_written)
{
        // Commit outside the log
        bool need_commit = false;
        {
                LockedFileData::WriteRef lock(filedata);

                if (has_written)
                {
                        CFS_FileDataProtector::WriteRef flock(filedataprotector, *file);

                        file->ReleaseReservations(*this, flock);

                        // If logging, commit all writes
                        if (IsLogged())
                        {
                                if (syncmode != WriteThrough)
                                {
                                        PodVector< uint8_t > msg;
                                        AddSetLengthMsg(msg, file->file_id, flock->length);
                                        FinishMsg(msg);
                                        AppendMessage(msg, false);
                                        need_commit = syncmode == BufferWrites;
                                }
                        }

                        file->modtime = DateTime::Now();
                }

                // Delete if no parent and no open handles
                if (--file->open_handles == 0 && file->parent == 0)
                    RemoveFileRecursive(lock, file);
        }
        if (need_commit || !IsLogged()) // Not logged: do a commit to free up ranges
            Commit();
}

CFS_File * ComplexFileSystem::LookupElement(LockedFileData::WriteRef &lock, CFS_File *root, std::string const &name)
{
        if (!root->is_directory)
            throw std::runtime_error("Cannot find directory");

/*
        DEBUGONLY(std::string entries;
        for (std::vector< CFS_File * >::iterator it = root->direntries.begin(); it != root->direntries.end(); ++it)
            entries += " '" + (*it)->name + "'(" + Blex::AnyToString((*it)->file_id) + ")";
        OTHER_PRINT("*** ComplexFS " << this << ": Looking up file '" << name << "' in list\n[" << entries << " ]"););
*/

/*

        std::vector< CFS_File * >::iterator it = std::lower_bound(root->direntries.begin(), root->direntries.end(), name, CFS_File::DirEntryLess());
        if (it != root->direntries.end() && StrCaseCompare((*it)->name, name) == 0)
        {
                OTHER_PRINT("*** ComplexFS " << this << ": File found, id is " << (*it)->file_id << "\n ");
                return *it;
        }
        OTHER_PRINT("*** ComplexFS " << this << ": File not found\n ");
        return 0;
*/
        PodVector< CFS_FileId > matches;

        lock->dirmapkeeper->SendPossibleMatches(root->file_id, name, &matches);
        for (PodVector< CFS_FileId >::iterator it = matches.begin(), end = matches.end(); it != end; ++it)
        {
                CFS_File *file = GetFileById(lock->files, *it, false);
                if (StrCaseCompare(file->name, name) == 0)
                {
                        OTHER_PRINT("*** ComplexFS " << this << ": File found, id is " << *it << "\n ");
                        return file;
                }
        }
        OTHER_PRINT("*** ComplexFS " << this << ": File not found\n ");
        return 0;
}

void ComplexFileSystem::LookupPath(LockedFileData::WriteRef &lock, std::string const &_path, CFS_File *&dir, CFS_File *&file, std::string &name)
{
        // FIXME use stringpair to represent data?
        file = 0;
        dir = GetFileById(lock->files, 1, false);
        name.clear();

        std::string directory = CollapsePathString(_path);
        std::string::iterator start = directory.begin();

        // Skip initial
        if (start != directory.end() && *start == '/')
            ++start;
        if (start == directory.end())
            return;

        while (true)
        {
                std::string::iterator cur_end = start;
                while (cur_end != directory.end() && *cur_end != '/')
                    ++cur_end;

                name = std::string(start, cur_end);
                file = LookupElement(lock, dir, name);

                start = cur_end;
                if (start != directory.end() && *start == '/')
                    ++start;
                if (start == directory.end())
                    return;

                if (file == 0)
                    throw std::runtime_error("Cannot find directory '" + std::string(directory.begin(), start) + "'");
                dir = file;
        }
}

ComplexFileStream * ComplexFileSystem::CreateTempFile(std::string *filename)
{
        *filename = "$tmp$" + Blex::AnyToString(++*LockedTempCounter::WriteRef(tempcounter)); //ADDME reserve names specifically for this purpose?
        return OpenFile(*filename, true, true);
}

ComplexFileStream * ComplexFileSystem::OpenFile(std::string const &_filepath, bool create_file, bool exclusive_create)
{
        std::unique_ptr< ComplexFileStream > stream;
        bool need_commit = false;
        {
                CFS_File *dir;
                CFS_File *current;
                std::string name;

                LockedFileData::WriteRef lock(filedata);

                OTHER_PRINT("*** ComplexFS " << this << ": Opening file '" << _filepath << "'");
                LookupPath(lock, _filepath, dir, current, name);

                if (dir == 0)
                    throw std::runtime_error("Cannot find directory");
                CheckFileName(name);

                // Cannot open a file that does not exist.
                if (current == 0)
                {
                        if (create_file)
                        {
                                unsigned new_file_id = lock->AllocateNewFileId();

                                OTHER_PRINT("*** ComplexFS " << this << ": Creating new file '" << name << "' (new id: " << new_file_id << ")");

                                DateTime ctime = DateTime::Now();

                                // Build a new file
                                std::shared_ptr< CFS_File > file(new CFS_File(new_file_id));
                                file->is_directory = false;
                                file->parent = dir;
                                file->name = name;
                                file->createtime = ctime;
                                file->modtime = ctime;
                                // Length is default set to zero.
                                CFS_FileDataProtector::WriteRef(filedataprotector, *file)->length = 0;

                                // Insert file
                                lock->files.insert(std::make_pair(file->file_id, file));
                                current = file.get();

                                // Add file in parent directory
                                lock->dirmapkeeper->AddEntry(dir->file_id, name, new_file_id);

                                if (IsLogged())
                                {
                                        PodVector< uint8_t > msg;
                                        AddNewFileMsg(msg, file->file_id, dir->file_id, ctime, name);
                                        AddSetModTimeMsg(msg, file->file_id, ctime);
                                        FinishMsg(msg);
                                        AppendMessage(msg, false);
                                        need_commit = syncmode != BufferAll;
                                }
                        }
                        else
                        {

                                OTHER_PRINT("*** ComplexFS " << this << ": File '" << name << "' not found, directory is #" << dir->file_id);
                                return 0;
                        }
                }
                else if (create_file && exclusive_create)
                {
                        OTHER_PRINT("*** ComplexFS " << this << ": File '" << name << "' (id: #" << current->file_id << ") already exists in directory #" << dir->file_id);
                        return 0;
                }

                OTHER_PRINT("*** ComplexFS " << this << ": File '" << name << "' (id: #" << current->file_id << ") looked up in directory #" << dir->file_id);

                // Cannot open a directory
                if (current->is_directory)
                    return 0;

                ++current->open_handles;
                stream.reset(new ComplexFileStream(*this, *current, lock->standard_filebufsize));
        }
        if (need_commit || !IsLogged())
            Commit();
        return stream.release();
}

bool ComplexFileSystem::Exists(std::string const &_filepath)
{
        CFS_File *dir;
        CFS_File *current;
        std::string name;

        LockedFileData::WriteRef lock(filedata);

        LookupPath(lock, _filepath, dir, current, name);
        OTHER_PRINT("*** ComplexFS " << this << ": Exists for file '" << name << "' (" << (current ? current->file_id : 0) << ")");

        return current != 0;
}

ComplexFileStream * ComplexFileSystem::CreateClone(ComplexFileStream &str)
{
        {
                LockedFileData::WriteRef lock(filedata);
                ++str.file.open_handles;
        }
        return new ComplexFileStream(str, str.GetOffset());
}

void ComplexFileSystem::RemoveFileRecursive(LockedFileData::WriteRef &lock, CFS_File *file)
{
        if (file->file_id == 1)
            throw std::runtime_error("Deleting root directory");

        std::map< CFS_FileId, std::shared_ptr< CFS_File > >::iterator fit = lock->files.find(file->file_id);
        if (fit == lock->files.end())
        {
                // If the file could not be found, file is pointing to freed memory - something went very wrong
                ErrStream() << "Removing file " << file << ", id " << file->file_id << ", but could not find it";
                FatalAbort();
        }

        if (file->is_directory)
        {
                PodVector< CFS_FileId > files;
                lock->dirmapkeeper->SendDirectoryContents(file->file_id, &files);

                for (PodVector< CFS_FileId >::iterator dit = files.begin(); dit != files.end(); ++dit)
                {
                        CFS_File *file = GetFileById(lock->files, *dit, false);

                        if (file->open_handles == 0)
                            RemoveFileRecursive(lock, file);
                        else
                            file->parent = 0;
                }

/*
                for (std::vector< CFS_File * >::iterator dit = file->direntries.begin(); dit != file->direntries.end(); ++dit)
                {
                        if ((*dit)->open_handles == 0)
                            RemoveFileRecursive(lock, (*dit));
                        else
                            (*dit)->parent = 0;
                }
*/
        }
        else
        {
                // Free the contents of the file (but don't log it, removal is logged by deletefilebyid, this is only a consequence!)
                file->UnloggedRemoveContents(*this);
        }

        OTHER_PRINT("*** ComplexFS " << this << ": Removing file info for '" << file->name << "' (" << file->file_id << ")");
        lock->files.erase(fit);
}

void ComplexFileSystem::DeleteSpecificFile(LockedFileData::WriteRef &lock, CFS_File *file)
{
        // Remove entry in parent directory
        lock->dirmapkeeper->RemoveEntry(file->parent->file_id, file->name, file->file_id);

        // Set parent to 0, if closed this will trigger remove
        file->parent = 0;

        CFS_FileId fileid = file->file_id;

        // Not open, we may remove immediately.
        if (file->open_handles == 0)
            RemoveFileRecursive(lock, file);

        if (IsLogged())
        {
                PodVector< uint8_t > msg;
                AddDeleteMsg(msg, fileid);
                FinishMsg(msg);
                AppendMessage(msg, false);
        }
}

bool ComplexFileSystem::DeletePath(std::string const &_filepath)
{
        // Commit the added message outside of the lock.
        {
                CFS_File *dir;
                CFS_File *current;
                std::string name;

                LockedFileData::WriteRef lock(filedata);

                LookupPath(lock, _filepath, dir, current, name);

                if (current == 0)
                {
                        OTHER_PRINT("*** ComplexFS " << this << ": Deleting file " << name << " failed, file not found");
                        return false;
                }
                OTHER_PRINT("*** ComplexFS " << this << ": Deleting file " << name << " (id: #" << current->file_id << ") in directory #" << dir->file_id);

                CheckFileName(name);

                DeleteSpecificFile(lock, current);
        }
        if (syncmode != BufferAll || !IsLogged())
            Commit();

        return true;
}

void ComplexFileSystem::TouchFile(std::string const &_filepath, DateTime touch_at)
{
        // Commit the added message outside of the lock.
        {
                if (touch_at == DateTime::Invalid())
                    touch_at = DateTime::Now();

                CFS_File *dir;
                CFS_File *current;
                std::string name;

                LockedFileData::WriteRef lock(filedata);

                LookupPath(lock, _filepath, dir, current, name);

                if (current == 0)
                {
                        OTHER_PRINT("*** ComplexFS " << this << ": Touching file " << name << " failed, file not found");
                        throw std::runtime_error("Cannot find file " + _filepath);
                }
                OTHER_PRINT("*** ComplexFS " << this << ": Touching file " << name << " (id: #" << current->file_id << ") in directory " << dir->file_id);

                CheckFileName(name);

                current->modtime = touch_at;
                if (IsLogged())
                {
                        PodVector< uint8_t > msg;
                        AddSetModTimeMsg(msg, current->file_id, touch_at);
                        FinishMsg(msg);
                        AppendMessage(msg, false);
                }
        }
        if (syncmode != BufferAll || !IsLogged())
            Commit();
}

void ComplexFileSystem::MovePath(std::string const &old_path, std::string const &new_path)
{
        // Commit the added message outside of the lock.
        {
                CFS_File *old_dir, *new_dir;
                CFS_File *old_current, *new_current;
                std::string old_name, new_name;

                LockedFileData::WriteRef lock(filedata);

                // Make sure the names are valid (no wildcards)
                CheckFileName(old_name);
                CheckFileName(new_name);

                // Lookup the old path and the new path
                LookupPath(lock, old_path, old_dir, old_current, old_name);
                LookupPath(lock, new_path, new_dir, new_current, new_name);

                if (old_current == 0)
                    throw std::runtime_error("Cannot find file " + old_path);

                if (new_dir == 0)
                    throw std::runtime_error("Cannot find directory " + new_path);

                if (new_current != 0) // Old file exists? -> delete it.
                    DeleteSpecificFile(lock, new_current);

                OTHER_PRINT("*** ComplexFS " << this << ": Moving file " << old_name << " (id: #" << old_current->file_id << ") in dir #" << old_dir->file_id << " to " << new_name << " (" << new_current << ") in dir #" << new_dir->file_id);

                // Remove the directory entry from the old directory, and add it to the new directory. Also correct parent_id
                lock->dirmapkeeper->RemoveEntry(old_dir->file_id, old_name, old_current->file_id);

                old_current->parent = new_dir;
                old_current->name = new_name;

                lock->dirmapkeeper->AddEntry(new_dir->file_id, new_name, old_current->file_id);

                // Log
                if (IsLogged())
                {
                        PodVector< uint8_t > msg;
                        AddMoveRenameMsg(msg, old_current->file_id, new_dir->file_id, new_name);
                        FinishMsg(msg);
                        AppendMessage(msg, false);
                }
        }
        if (syncmode != BufferAll || !IsLogged())
            Commit();
}

DateTime ComplexFileSystem::GetLastModTime(std::string const &filepath)
{
        CFS_File *dir;
        CFS_File *current;
        std::string name;

        LockedFileData::WriteRef lock(filedata);

        LookupPath(lock, filepath, dir, current, name);
        if (!current)
        {
                OTHER_PRINT("*** ComplexFS " << this << ": GetLastModTime for file " << name << " failed, file not found");
                return DateTime::Invalid();
        }
        OTHER_PRINT("*** ComplexFS " << this << ": GetLastModTime for file " << name << " (id: " << current->file_id << ") in dir #" << dir->file_id);

        if (!current)
            return DateTime::Invalid();

        return current->modtime;
}

std::vector<std::string> ComplexFileSystem::ListDirectory(std::string const &path_mask)
{
        CFS_File *dir;
        CFS_File *current;
        std::string mask;

        LockedFileData::WriteRef lock(filedata);

        LookupPath(lock, path_mask, dir, current, mask);

        if (current != 0)
            return std::vector< std::string >(1, current->name);

        if (dir == 0) // no such directory. ADDME: is that an error?
           return std::vector< std::string >();

        std::vector< std::string > results;

        PodVector< CFS_FileId > contents;
        lock->dirmapkeeper->SendDirectoryContents(dir->file_id, &contents);

        for (PodVector< CFS_FileId >::iterator it = contents.begin(), end = contents.end(); it != end; ++it)
        {
                CFS_File *file = GetFileById(lock->files, *it, false);
                if (StrLike(file->name, mask))
                    results.push_back(file->name);
        }
/*
        for (std::vector< CFS_File * >::const_iterator it = dir->direntries.begin(); it != dir->direntries.end(); ++it)
        {
                if (StrLike((*it)->name, mask))
                    results.push_back((*it)->name);
        }
*/
        return results;
}

CFS_SectionBase * ComplexFileSystem::OpenSection(unsigned sectionnr, bool for_write)
{
        LockedBlockData::WriteRef blocklock(blockdata);

        if (blocklock->in_memory)
        {
                if (sectionnr >= blocklock->mem_sections.size())
                    throw std::runtime_error("Complexfs section nr " + Blex::AnyToString(sectionnr) + " does not exist");

                return new CFS_VectorSection(sectionnr, blocklock->mem_sections[sectionnr].get());
        }
        else
        {
                unsigned int_sectionnr = sectionnr;

                std::vector< std::pair< std::shared_ptr< SectionFile >, unsigned > >::iterator it = blocklock->files.begin();
                while (it != blocklock->files.end() && int_sectionnr >= it->second)
                {
                        int_sectionnr -= it->second;
                        ++it;
                }

                if (it == blocklock->files.end())
                {
                        assert(it != blocklock->files.end());
                        throw std::runtime_error("Complexfs section nr " + Blex::AnyToString(sectionnr) + " does not exist");
                }

                // If this section will be written to, mark it as dirty.
                if (for_write && !temporary)
                {
                        blocklock->updatehistory.commitmap[Blex::SectionUpdateHistory::CommitKey(it->first.get(), int_sectionnr)] =
                            it->first->MarkSectionDirty(int_sectionnr);
                }

                return new CFS_FileSection(sectionnr, it->first.get(), int_sectionnr);
        }
}

void ComplexFileSystem::AppendSectionFile(LockedBlockData::WriteRef &lock, bool is_new)
{
        // Make a new
        std::string name = StripExtensionFromPath(root_path);
        name += "-";
        name += Blex::AnyToString(lock->files.size() + 1);
        name += ".cfsdat";

        std::shared_ptr< SectionFile > file;
        file.reset(SectionFile::Open(SectionSize, name, MaxUnusedSections, true, is_new, !IsLogged(), IsLogged() && !disable_flush));
        if (!file.get())
            throw std::runtime_error("Cannot create storage file " + name);

        lock->files.push_back(std::make_pair(file, 0));
}

void ComplexFileSystem::AppendSections(unsigned count)
{
        LockedBlockData::WriteRef lock(blockdata);

        if (lock->in_memory)
        {
                for (unsigned i = 0; i < count; ++i)
                {
                        std::shared_ptr< std::vector< uint8_t > > data;
                        data.reset(new std::vector< uint8_t >);
                        data->resize(SectionSize);

                        lock->mem_sections.push_back(data);
                        lock->free_ranges.FreeRange(CFS_Range(lock->total_sections * BlocksPerSection, BlocksPerSection));

                        ++lock->total_sections;
                }
        }
        else
        {
                PodVector< uint8_t > msg;
                for (unsigned i = 0; i < count; ++i)
                {
                        if (lock->files.empty() || lock->files.back().first->GetNumSections() >= MaxSectionsPerFile)
                            AppendSectionFile(lock, true);

                        if (lock->files.back().first->GetNumSections() < lock->files.back().second + SectionAllocSize)
                            lock->files.back().first->TryAppendSectionPages(lock->files.back().second + SectionAllocSize - lock->files.back().first->GetNumSections());

                        lock->files.back().second += SectionAllocSize;
                        lock->free_ranges.FreeRange(CFS_Range(lock->total_sections * BlocksPerSection, BlocksPerSection * SectionAllocSize));
                        lock->total_sections += SectionAllocSize;

                        if (IsLogged())
                            AddSectionInfoMsg(msg, lock->files.size() - 1, lock->files.back().second);
                }
                if (IsLogged())
                {
                        FinishMsg(msg);
                        AppendMessage(msg, true); // Auto-commit, this is mission-critical data
                }
        }
}

CFS_Range ComplexFileSystem::AllocateRange(CFS_BlockCount size, CFS_BlockCount minsize, CFS_BlockId hint)
{
        assert(minsize != 0);

        CFS_Range range(0,0);

        {
                // Try to allocate range without expanding
                LockedBlockData::WriteRef blocklock(blockdata);
                range = blocklock->free_ranges.AllocateRange(size, minsize, hint);
        }
        while (range.Size() == 0)
        {
                // Append enough new sections to satify the request (addme: ignoring the last free range now)
                AppendSections((minsize + BlocksPerSection - 1) / BlocksPerSection);
                LockedBlockData::WriteRef blocklock(blockdata);
                range = blocklock->free_ranges.AllocateRange(size, minsize, hint);
        }
        return range;
}

void ComplexFileSystem::MarkRangeFree(CFS_Range const &range)
{
        if (IsLogged())
        {
                LockedFreedBlockList::WriteRef lock(freed_block_list);
                lock->free_ranges.push_back(range);
        }
        else
            FreeRange(range);
}

void ComplexFileSystem::FreeRange(CFS_Range const &range)
{
        LockedBlockData::WriteRef blocklock(blockdata);
        blocklock->free_ranges.FreeRange(range);
}

void ComplexFileSystem::CheckFileName(std::string const &filename)
{
        for (std::string::const_iterator it = filename.begin(); it != filename.end(); ++it)
            if (*it == '*' || *it == '?')
                throw std::runtime_error("Wildcards are not allowed within filenames");
}

void ComplexFileSystem::Flush()
{
        // First flush all data to disk
        SectionUpdateHistory updatehistory_copy;
        {
                LockedBlockData::WriteRef block(blockdata);

                updatehistory_copy = block->updatehistory;

                // ADDME: swap?
                block->updatehistory.commitmap.clear();
        }

        if (!disable_flush)
            updatehistory_copy.ForceSyncAll();

        // And then the log.
        Commit();

/*
        {
                LockedBlockData::WriteRef block(blockdata);
                //First schedule an async flush
                for (std::vector< std::pair< std::shared_ptr< SectionFile >, unsigned > >::iterator it = block->files.begin(), end = block->files.end(); it != end; ++it)
                    it->first->FlushAll(true);
                //And now the real flush!
                for (std::vector< std::pair< std::shared_ptr< SectionFile >, unsigned > >::iterator it = block->files.begin(), end = block->files.end(); it != end; ++it)
                    it->first->FlushAll(false);
        }
*/
}

void ComplexFileSystem::SetStandardBufferSize(unsigned buffersize)
{
        // Less than 32 bytes will probably incure too large performance problems
        if (buffersize < 32)
            buffersize = 32;

        LockedFileData::WriteRef lock(filedata);
        lock->standard_filebufsize = buffersize;

}

unsigned ComplexFileSystem::GetStandardBufferSize()
{
        LockedFileData::WriteRef lock(filedata);

        return lock->standard_filebufsize;
}


ComplexFileSystem::Info ComplexFileSystem::GetInfo()
{
        LockedBlockData::WriteRef blocklock(blockdata);
        
        Info info;
        info.totalblocks = blocklock->total_sections * BlocksPerSection;
        info.freeblocks = blocklock->free_ranges.GetFreeBlockCount();
        return info;
}

//******************************************************************************
//
//   ComplexFileStream
//

ComplexFileStream::ComplexFileStream(ComplexFileSystem &_fs, CFS_File &_file, unsigned buffersize)
: Stream(false)
, RandomStreamBuffer(buffersize)
, fs(_fs)
, file(_file)
, fileid(file.GetFileId())
, has_written(false)
{
        OTHER_PRINT("Created ComplexFileStream " << this << " for '" << file.GetName() << "'");
}

ComplexFileStream::ComplexFileStream(ComplexFileStream const &rhs, FileOffset offset)
: Stream(false)
, RandomStreamBuffer(rhs.GetBufferSize())
, fs(rhs.fs)
, file(rhs.file)
, fileid(rhs.fileid)
, has_written(rhs.has_written)
{
        OTHER_PRINT("Created ComplexFileStream " << this << " for '" << file.GetName() << "'");
        SetOffset(offset);
}

ComplexFileStream::~ComplexFileStream()
{
        OTHER_PRINT("Destroying ComplexFileStream " << this << " for '" << file.GetName() << "'");
        FlushBuffer();
        fs.HandleClosed(&file, has_written);
}

std::size_t ComplexFileStream::RawDirectRead(FileOffset pos, void *buf, std::size_t maxbufsize)
{
        return file.DirectRead(fs, pos, static_cast< uint8_t * >(buf), maxbufsize, section);
}

std::size_t ComplexFileStream::RawDirectWrite(FileOffset pos, void const *buf, std::size_t maxbufsize)
{
        has_written = true;
        return file.DirectWrite(fs, pos, static_cast< uint8_t const * >(buf), maxbufsize, section);
}

bool ComplexFileStream::SetFileLength(FileOffset newlength)
{
        has_written = true;
        file.SetLength(fs, newlength);
        return true;
}

FileOffset ComplexFileStream::GetFileLength()
{
        FlushBuffer();
        return file.GetFileLength(fs);
}

void ComplexFileStream::Flush()
{
        FlushBuffer();
        fs.Flush();
}

} // End of namespace Blex
