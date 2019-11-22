#ifndef blex_complexfs
#define blex_complexfs

#ifndef blex_stream
#include "stream.h"
#endif
#ifndef blex_binarylogfile
#include "binarylogfile.h"
#endif
#ifndef blex_mapvector
#include "mapvector.h"
#endif

#include <map>

#include "btree_filesystem.h"
#include "path.h"

namespace Blex
{

/** Filesystem lock hierarchy:
        fs.filedata -> file.data -> fs.blockdata

    Multithreading considerations: all mt-safe.
    FIXME: std::shared_ptrs are used internally, those are NOT mt-safe.
        Make sure they are only modified under lock!
*/

class ComplexFileSystem;
class ComplexFileStream;
class CFS_File;

typedef uint32_t CFS_BlockId;
typedef uint32_t CFS_BlockCount;
typedef uint32_t CFS_FileBlockNr;
typedef uint32_t CFS_FileId;

/** This class describes a range of blocks.
*/
class CFS_Range
{
    private:
        /// Start of range
        CFS_BlockId start;
        /// Size of range
        CFS_BlockId size;

    public:
        /// Default constructor
        inline CFS_Range() : start(0), size(0) {}

        /** Constructor
            @param _start Start of range
            @param _size Size of the range (not the limit)
        */
        inline CFS_Range(CFS_BlockId _start, CFS_BlockCount _size) : start(_start), size(_size) {}

        /** Returns the limit of the range (first block after the current range */
        inline CFS_BlockId Limit() const { return start + size; }

        /** Returns the size of the range */
        inline CFS_BlockCount Size() const { return size; }

        /** Returns the size of the range */
        inline CFS_BlockId Start() const { return start; }

        bool operator==(CFS_Range const &rhs) const { return start == rhs.start && size == rhs.size; }
        bool operator!=(CFS_Range const &rhs) const { return start != rhs.start || size != rhs.size; }
};

/** The FreeRanges class keeps a list of ranges which are considered free. Ranges can be allocated
    from this class, and given back. Range allocation can be done by explicitly giving the bounds,
    or letting the class find the best range given required size and hinted placement
*/
class BLEXLIB_PUBLIC CFS_FreeRanges
{
    private:
        typedef std::map< CFS_BlockId, CFS_BlockId > StartLimitMap;

        /// List of free ranges; manipulate only through AddRange and RemoveRange
        StartLimitMap start_limit_ranges;

        typedef std::multimap< CFS_BlockCount, CFS_BlockId > LengthStartMap;

        /// Multimap from lengths to start cluster, must be consistent with start_limit_ranges; manipulate only through AddRange and RemoveRange
        LengthStartMap length_start_map;

        /** Returns an iterator to the free range which includes the id @a id.
            @param id Id to find
            @return Returns iterator pointing to range, start_limit_ranges.end() if not found
        */
        StartLimitMap::iterator FindRangeWhichIncludes(CFS_BlockId id);

        /** Adds a new range to the data
            @param start Start of range
            @param limit Limit of range
        */
        void AddRange(CFS_BlockId start, CFS_BlockId limit);

        /** Removes a range
            @param it Valid iterator to start_limit_ranges, may NOT be start_limit_ranges.end()
        */
        void RemoveRange(StartLimitMap::iterator it);

    public:
        /** Tries to allocate a range of a given size
            @param size Requested size of range
            @param min_size Minimum size the returned range may have (may be bigger than size, is lowerered then internally)
            @param start_hint Optional hit where range should start
            @return Start and size of allocated range (0 if failed). Size of allocated range may be
                lower than requested, if no free range of that size is available
        */
        CFS_Range AllocateRange(CFS_BlockCount size, CFS_BlockCount min_size, CFS_BlockId start_hint = 0);

        /** Allocates a range at a specific point, with a specific size. Throws if ranges is not available
            @param start Start of range
            @param size Start of range
        */
        bool AllocateFixedRange(CFS_BlockId  start, CFS_BlockCount size);

        /** Marks a range as free
            @param start Start of range
            @param size Size of range
        */
        void FreeRange(CFS_Range const &range);
};

/** This class keeps the mapping to disk-blocks for a file
*/
class BLEXLIB_PUBLIC CFS_FileBlocks
{
    public:
        struct Range
        {
                //Offset of this range
                unsigned offset;

                /// Start of range
                CFS_BlockId start;
        };

    private:
        Blex::PodVector< Range > ranges;

        unsigned length;

//        inline CFS_Range BuildCFSRange(Range const &range) const { return CFS_Range(range.start, range.size); }

//        /** Map of start blocknr and allocated range. it->first == accumulate(begin(), it, { return _1->second.Size() } )
//        */
//        MapVector< CFS_FileBlockNr, CFS_Range > ranges;

    public:
        CFS_FileBlocks();

        /** Returns number of blocks present
        */
        CFS_BlockCount GetBlockCount() const;

        /** Returns the allocated block id for a certain block number
            @param blocknr Number of block to look up
            @param Returns blockid this blocknr maps to
        */
        CFS_BlockId GetDiskBlockId(CFS_FileBlockNr blocknr) const;

        /** Strips a number of blocks.
            @param count Number of blocks to strip
            @param reveiver Function to receive freed ranges
        */
        void StripBlocks(CFS_BlockCount count, std::function< void(CFS_Range const &) > const &receiver);

        /** Adds a range to the list of ranges
            @param range Range to add
        */
        void AddRange(CFS_Range const &range);

        /** Return number of recorded ranges
        */
        inline unsigned GetRangeCount() const { return ranges.size(); }

//        inline unsigned GetRangeCount() const { return ranges.Size(); }

        /** Returns a specific range
            @param nr Number of the range, must be 0 <= nr < GetRangeCount()
        */
        inline CFS_Range GetRange(unsigned nr) const; //{ return BuildCFSRange(ranges[nr]); }

//        inline CFS_Range GetRange(unsigned nr) const { return (ranges.Begin() + nr)->second; }

        /** Returns the block that would be logical to use as newly appended block
        */
        CFS_BlockId GetAppendHint() const;
};

/** Base class for sections; this to be able to both work with in-memory and
    on-disk file systems
*/
class CFS_SectionBase
{
    private:
        /// Id of this sections
        unsigned id;

    public:
        /** Constructor
            @param id id of this section
        */
        inline CFS_SectionBase(unsigned _id) : id(_id) {}

        /// Virtual destructor, this is a base class
        virtual ~CFS_SectionBase();

        /// Returns the id of this section
        inline unsigned GetSectionId() { return id; }

        /// Auto-converter to pointer to data of this section
        virtual operator uint8_t*() = 0;
};

class CFS_FileDataProtector;

struct CFS_FileData
{
        inline CFS_FileData() : length(0) {}

        /// Length of this file
        FileOffset length;

        /// Used blocks for this file
        CFS_FileBlocks blocks;

        /// Currently reserved blocks (have been allocated but not added to file)
        CFS_Range reservation;
};

/// Structure only allowing access to filedata to CFS_FileDataProtector
class CFS_LockedFileData
{
        CFS_FileData protected_data;
        friend class CFS_FileDataProtector;
};

class CFS_FileDataProtector
{
    public:
        static const unsigned CacheLineSize = 128;              //cache line size (mutexes must be this far apart)
        static const unsigned MutexCount = 64;
    private:

        struct AlignedSectionLocks
        {
                Blex::Mutex mutex;
                uint8_t alignbytes[2*CacheLineSize - sizeof(Blex::Mutex)];
        };
        mutable AlignedSectionLocks locks[MutexCount];

        inline Blex::Mutex & GetMutex(CFS_File const &file) const;
        inline CFS_FileData & GetData(CFS_File &file) const;
        inline CFS_FileData const & GetData(CFS_File const &file) const;
    public:
        class WriteRef
        {
            private:
                CFS_FileData &data;
                Blex::Mutex::AutoWriteLock lock;
            public:
                inline WriteRef(CFS_FileDataProtector const &protector, CFS_File &file) : data(protector.GetData(file)), lock(protector.GetMutex(file)) {}
                CFS_FileData & operator*() { return data; }
                CFS_FileData * operator->() { return &data; }
        };
        class ReadRef
        {
            private:
                CFS_FileData const &data;
                Blex::Mutex::AutoReadLock lock;
            public:
                inline ReadRef(CFS_FileDataProtector const &protector, CFS_File const &file) : data(protector.GetData(file)), lock(protector.GetMutex(file)) {}
                CFS_FileData const & operator*() { return data; }
                CFS_FileData const * operator->() { return &data; }
        };
        class UnlockedWriteRef
        {
            private:
                CFS_FileData &data;
            public:
                inline UnlockedWriteRef(CFS_FileDataProtector const &protector, CFS_File &file) : data(protector.GetData(file)) {}
                CFS_FileData & operator*() { return data; }
                CFS_FileData * operator->() { return &data; }
        };
        friend class WriteRef;
        friend class ReadRef;
        friend class UnlockedWriteRef;
};

class CFS_DirectoryMapKeeper
{
    private:
        std::map< std::pair< CFS_FileId, std::string >, CFS_FileId > direntries;

        //std::unique_ptr< FileStream > metadata;
        std::unique_ptr< Index::DBIndexFileSystem > indexfs;
        std::unique_ptr< Index::BtreeIndex > index;


    public:
        /** Create a new CFS_DirectoryMapKeeper
            @param indexfsname Name of indexfs, keep empty for in-memory storage
        */
        explicit CFS_DirectoryMapKeeper(std::string const &indexfsname, bool temp);

        ~CFS_DirectoryMapKeeper();

        /** Add an entry to the directorymap keeper
            @param parent Parent folder
            @param name Name of the file
            @param fileid Id of the file
        */
        void AddEntry(CFS_FileId parent, std::string const &name, CFS_FileId fileid);

        /** Removes an entry from the directorymap keeper
            @param parent Parent folder
            @param name Name of the file
            @param fileid Id of the file
        */
        void RemoveEntry(CFS_FileId parent, std::string const &name, CFS_FileId fileid);

        /** Pushes all possible matches for a file with a name in a specific directory
            @param parent Parent folder
            @param name Name of the file
            @param matches PodVector where possible matches will be pushed into
        */
        void SendPossibleMatches(CFS_FileId parent, std::string const &name, PodVector< CFS_FileId > *matches);

        /** Pushes all files in a directory into a list
            @param parent Parent folder
            @param matches PodVector where entries
        */
        void SendDirectoryContents(CFS_FileId parent, PodVector< CFS_FileId > *matches);

        void SendAndKillDirectoryContents(CFS_FileId parent, PodVector< CFS_FileId > *matches);

};

/** Contains file data for files and directories in the complex file system.
*/
class BLEXLIB_PUBLIC CFS_File
{
    private:
        CFS_LockedFileData data;

        /// Number of open handles to this file (protected by LockedFileData). 0 when this is a directory
        unsigned open_handles;

        /// Id of this file
        CFS_FileId const file_id;

        /// Name of this file (protected by LockedFileData)
        std::string name;

        /// Creation time (protected by LockedFileData)
        DateTime createtime;

        /// Modification time (protected by LockedFileData)
        DateTime modtime;

        /// Is this a directory?
        bool is_directory;

        /// Structure that is be used for ordering directory entries
        struct DirEntryLess;
        friend struct DirEntryLess; // Need this until nested classes have access to private parts of parent classes

        /// Parent directory (0 for root directory and files (not dirs!) scheduled for deletion)
        CFS_File *parent;

        /** Locks a specific block into memory
            @param fs The file system this file belongs to
            @param blocknr Sequence block number of the needed block
            @param section Auto_ptr that will be filled with the needed section
            @param for_write Whether the block will be used for writing. If so, the section will be marked dirty, and
                synced at the next Flush().
            @return Pointer to the block
        */
        uint8_t * GetBlock(ComplexFileSystem &fs, CFS_FileData const &lockeddata, CFS_FileBlockNr blocknr, std::unique_ptr< CFS_SectionBase > &section, bool for_write);

        /** Does a write to a specific position, auto extending the file to that point
            @param fs The file system this file belongs to
            @param lock Lock for file data
            @param pos Position to write to
            @param buf Position of data to write
            @param bufsize Size of data to write (may be 0)
            @param section Section that can be used for locking sections (caching)
            @return Number of bytes of data that have been written (excluding extra added 0s)
        */
        std::size_t LockedWrite(ComplexFileSystem &fs, CFS_FileDataProtector::WriteRef &lock, FileOffset pos, uint8_t const *buf, std::size_t bufsize, std::unique_ptr< CFS_SectionBase > &section);

        /** Kills all contents of the file, without logging it
        */
        void UnloggedRemoveContents(ComplexFileSystem &fs);

        /** Release any outstanding blocks reservations
        */
        void ReleaseReservations(ComplexFileSystem &fs, CFS_FileDataProtector::WriteRef &lock);

    public:
        CFS_File(CFS_FileId const _file_id);
        ~CFS_File();

        /** Reads as much as possible from this file
            @param fs The file system this file belongs to
            @param offset Offset to read from
            @param buffer Buffer to store the read data in
            @param size Number of bytes to read
            @param section Section that can be used for locking sections (caching)
            @return Returns number of read bytes
        */
        std::size_t DirectRead(ComplexFileSystem &fs, FileOffset offset, uint8_t *buffer, std::size_t size, std::unique_ptr< CFS_SectionBase > &section);

        /** Writes to a file, can write past eof
            @param fs The file system this file belongs to
            @param offset offset to write to
            @param buffer Buffer the written data must be read from
            @param size Size of data to write
            @param section Section that can be used for locking sections (caching)
            @return Number of bytes that have been written.
        */
        std::size_t DirectWrite(ComplexFileSystem &fs, FileOffset offset, uint8_t const *buffer, std::size_t size, std::unique_ptr< CFS_SectionBase > &section);

        /** Resizes the file
            @param fs The file system this file belongs to
            @param newlength New length of the file
        */
        void SetLength(ComplexFileSystem &fs, FileOffset newlength);

        /// Retrieve the current length of the file
        FileOffset GetFileLength(ComplexFileSystem const &fs) const;

        /// Returns the time of creation
        DateTime GetCreateTime(ComplexFileSystem const &fs) const;

        /// Returns the time of last modification
        DateTime GetModTime(ComplexFileSystem const &fs) const;

        /// Returns id of this file
        CFS_FileId inline GetFileId() const { return file_id; }

        /// Returns name
        inline std::string const & GetName() const { return name; }

        friend class ComplexFileSystem;
        friend class CFS_FileDataProtector;
};

class BLEXLIB_PUBLIC ComplexFileSystem
{
    public:
        /** Disk synchronization mode; determines what is immediately commited to disk
            Operations that are hazardous to data contents (shrinking of files and
            deleting files) are always committed, no matter what.

            Data writes are synced to disc on a call to Flush.
        */
        enum SyncMode
        {
        WriteThrough,   ///< Write-through: every metadata write is immediately committed to disk
        BufferWrites,   ///< Buffer-writes: as WriteThrough, only metadata-changes of writes are delayed until Flush of close on file.
        BufferAll       ///< Everything is buffered, and committed on filesystem close or Flush.
        };

    protected:
        /** Data about the free blocks
        */
        struct BlockData
        {
                /// Free ranges admin
                CFS_FreeRanges free_ranges;

                /// Is this memory based?
                bool in_memory;

                /// Total number of sections
                unsigned total_sections;

                /// List of memory sections
                std::vector< std::shared_ptr< std::vector< uint8_t > > > mem_sections;

                /// Disk files
                std::vector< std::pair< std::shared_ptr< SectionFile >, unsigned > > files;

                /// Update history
                SectionUpdateHistory updatehistory;
        };

        typedef InterlockedData< BlockData, Mutex > LockedBlockData;

        LockedBlockData blockdata;

        typedef std::map< CFS_FileId, std::shared_ptr< CFS_File > > FileEntryMap;

        typedef Blex::InterlockedData< uint64_t, Blex::Mutex > LockedTempCounter;

        LockedTempCounter tempcounter;

        struct FileData
        {
                /// Constructor
                FileData();

                /// Standard buffer size for files
                unsigned standard_filebufsize;

                /// Last allocated fied
                unsigned last_fid;

                /// Number of linearly allocated fids at the moment (restart at 1 at 1000 allocs)
                unsigned fid_restart_counter;

                FileEntryMap files;

                /// Directory map keeper
                std::unique_ptr< CFS_DirectoryMapKeeper > dirmapkeeper;

                /** Allocate a new, unused fileid. This function must be called under the @a filedata lock,
                    the returned id is guaranteed to be free while the lock is held. No guarantees are given
                    about ordering.
                    @return Freshly, unused fileid.
                */
                CFS_FileId AllocateNewFileId();
        };
        typedef InterlockedData< FileData, Mutex > LockedFileData;

        LockedFileData filedata;

        /** List of ranges that have been freed since the last Commit.
            These ranges may not be reused until the log entries have been committed to disk,
            so new files that won't be visible can't write over them yet
        */
        struct FreedBlockList
        {
                /// List of free ranges
                std::vector< CFS_Range > free_ranges;
        };
        typedef InterlockedData< FreedBlockList, Mutex > LockedFreedBlockList;

        LockedFreedBlockList freed_block_list;

        CFS_FileDataProtector filedataprotector;

        std::string root_path;

        // Tha Log
        std::unique_ptr< BinaryLogFile > log;

        /// Return the section number based on the id of a block
        static unsigned GetSectionNumber(CFS_BlockId blockid);

        /// Return the id of the first block of a section
        static CFS_BlockId GetFirstBlockOfSection(unsigned sectionnr);

        /** Allocates a range of disk blocks
            @param size Number of blocks needed
            @parma minsize Minimum number of blocks that may be returned
            @param hint Block id that is wanted as start block (optional)
            @return Returns a range of new blocks (size >= Size() >= minsize)
        */
        CFS_Range AllocateRange(CFS_BlockCount size, CFS_BlockCount minsize, CFS_BlockId hint = 0);

        /** Marks a range as free. For logged filesystems, the range will be freed at the next commit, otherwise
            the range is freed immediately.
        */
        void MarkRangeFree(CFS_Range const &range);

        /** Frees a range, so it can be re-used immediately
        */
        void FreeRange(CFS_Range const &range);

        /// Retrieves a file based on id, throws if not found
        CFS_File * GetFileById(FileEntryMap &files, unsigned file_id, bool allow_fail);
        CFS_File const * GetFileById(FileEntryMap const &files, unsigned file_id, bool allow_fail);

        void Init(std::string const &disk_path, bool create_exclusive);

        CFS_File * LookupElement(LockedFileData::WriteRef &lock, CFS_File *root, std::string const &name);
        void LookupPath(LockedFileData::WriteRef &lock, std::string const &path, CFS_File *&found_dir, CFS_File *&found_file, std::string &name);
        void RemoveFileRecursive(LockedFileData::WriteRef &lock, CFS_File *file);
        void DeleteSpecificFile(LockedFileData::WriteRef &lock, CFS_File *id);

        void HandleClosed(CFS_File *file, bool has_written);

        CFS_SectionBase * OpenSection(unsigned sectionnr, bool for_write);
        void AppendSections(unsigned count);
        void AppendSectionFile(LockedBlockData::WriteRef &lock, bool is_new);

        ComplexFileStream * CreateClone(ComplexFileStream &str);

        /** Check filename for validity (throws when errors are found, like wildcards)
        */
        void CheckFileName(std::string const &filename);

        void RecordAllocatedBlocks(FileEntryMap &files, CFS_DirectoryMapKeeper *dirmapkeeper);

        /** \defgroup Logging Logging related functions */
        /*@{*/

        /** Replays a message from the log */
        void ReplayMessage(PodVector< uint8_t > const &msg, FileEntryMap &files, CFS_DirectoryMapKeeper *direntries, bool dont_execute);

        void AppendMessage(PodVector< uint8_t > const &message, bool commit);

        /*@}*/

        void RebuildLog();
        void SendFilesToRewrite(FileEntryMap &files, CFS_DirectoryMapKeeper *dirmapkeeper, unsigned file_id);

        void Commit();

        /// Disk synchronization mode
        SyncMode syncmode;

        /// Whether this is a temporary fs
        bool temporary;

        /// Whether flushing is disabled
        bool disable_flush;

    public:

        ComplexFileSystem();
        ComplexFileSystem(std::string const &disk_path, bool create_exclusive);
        ComplexFileSystem(std::string const &disk_path, bool create_exclusive, SyncMode syncmode);
        ComplexFileSystem(std::string const &disk_path, bool create_exclusive, SyncMode syncmode, bool disable_flush);
        ~ComplexFileSystem();

        ComplexFileStream * OpenFile(std::string const &filepath, bool create_file, bool exclusive_create);
        ComplexFileStream * CreateTempFile(std::string *filename);

        bool Exists(std::string const &_filepath);
        void TouchFile(std::string const &_filepath, DateTime touch_at = DateTime::Invalid());
        bool DeletePath(std::string const &_filepath);
        void MovePath(std::string const &old_path, std::string const &new_path);

        DateTime GetLastModTime(std::string const &_filepath);

        std::vector<std::string> ListDirectory(std::string const &mask);

        inline bool IsLogged() { return log.get(); }

        inline void Optimize() { RebuildLog(); }

        /** Sets buffer size for files (standard 32768 bytes)
            @param buffersize New buffer size
        */
        void SetStandardBufferSize(unsigned buffersize);

        /// Returns current standard file buffer size
        unsigned GetStandardBufferSize();

        /** Make sure that everything is flushed to disk (usefull for delayed commit mode)
        */
        void Flush();

        friend class CFS_File;
        friend class ComplexFileStream;
};

/** This class is the accessor for a file stream. This class is NOT threadsafe,
    use serialized only!
*/
class BLEXLIB_PUBLIC ComplexFileStream : public virtual RandomStream, public RandomStreamBuffer
{
    private:
        /// Our filesystem
        ComplexFileSystem &fs;

        /// File structure of this file.
        CFS_File &file;

        /// Id of this file
        CFS_FileId fileid;

        /// Has this stream written? If so, must update modtime on close
        bool has_written;

        /// Current section used for reading/writing
        std::unique_ptr< CFS_SectionBase > section;

        /// Constructor
        ComplexFileStream(ComplexFileSystem &_fs, CFS_File &_file, unsigned buffersize);
        ComplexFileStream(ComplexFileStream const &rhs, FileOffset offset);

        // Deny copying
        ComplexFileStream(ComplexFileStream const &rhs);
        ComplexFileStream & operator=(ComplexFileStream const &rhs);

    public:
        /// Destructor (decreases open handle count)
        virtual ~ComplexFileStream();

        /** Read a file from a specific position.
            @param buf Buffer to fill
            @param pos Starting position
            @param maxbufsize Maximum buffer size
            @return The number of bytes actually read, or 0 on EOF or I/O error
        */
        std::size_t RawDirectRead(FileOffset pos,void *buf,std::size_t maxbufsize);

        /** Write a file to a specific position.
            @param buf Buffer to write from
            @param pos Starting position
            @param bufsize Size of the buffer to write
            @return The number of bytes written (bufsize), or 0 on I/O error
        */
        std::size_t RawDirectWrite(FileOffset pos,const void *buf,std::size_t bufsize);

        /** Makes a copy of this stream; this copy receives its own file pointer */
        ComplexFileStream * CloneStream() { return fs.CreateClone(*this); }

        /** Change the file length of the current file (allows both truncation and extending).
            The current file position is not altered, unless it was beyond EOF,
            in which case it is moved to EOF
            @param newlenth Total length the file should have
            @return true if the file was succesfully resized
        */
        bool SetFileLength(FileOffset newlength);

        /** Retrieve the current length of the file
        */
        FileOffset GetFileLength();

        /** Returns the time of creation
        */
        inline DateTime GetCreateTime() const { return file.GetCreateTime(fs); }

        /** Returns the time of last modification
        */
        inline DateTime GetModTime() const { return file.GetModTime(fs); }

        /** Make sure that file contents are put on disk no matter what (when if caching or delayed commit is on)
        */
        void Flush();

        friend class ComplexFileSystem;
};

inline Blex::Mutex & CFS_FileDataProtector::GetMutex(CFS_File const &file) const
{
        return locks[file.GetFileId() % MutexCount].mutex;
}

inline CFS_FileData & CFS_FileDataProtector::GetData(CFS_File &file) const
{
        return file.data.protected_data;
}

inline CFS_FileData const & CFS_FileDataProtector::GetData(CFS_File const &file) const
{
        return file.data.protected_data;
}

extern bool debug_complexfs_printlogmsgs;

} // End of namespace Blex

#endif
