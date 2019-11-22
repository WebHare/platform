#ifndef blex_webhare_dbase_dbase_diskio
#define blex_webhare_dbase_dbase_diskio

#include <unordered_set>
#include <unordered_map>

#include <blex/mmapfile.h>
#include <blex/threads.h>
#include <blex/objectowner.h>
#include <ap/libwebhare/dbase.h>
#include "dbase_types.h"
#include "dbase_trans.h"
#include "dbase_blobmgr.h"

namespace Database
{

//Header offsets
const unsigned HeaderSize        = 0;
const unsigned HeaderVersion     = 4;
const unsigned HeaderBlockSize   = 16;
const unsigned HeaderSectionSize = 20;
const unsigned HeaderTableId     = 24;
const unsigned HeaderCacheStamp  = 28;

/** All tables and columns below this ID are for internal usage */
const ObjectId MinimumExternalId = 100;

const unsigned MaximumRecordSize = 49152;

//References
class IdentifiedTrans;

//Defined here
class RawDatabase;
class SectionInfo;
class DatabaseLocker;

///A record file holds one or more record sections
struct RecordFile
{
        ///This section file (the actual mmap-able object)
        std::unique_ptr<Blex::SectionFile> secfile;

        std::string path;
};

/** The TableData structure contains data about the sections it has. Also used
    for the list of empty sections
    Sections can be moved to/from another table. In practice, only move to/from
    the empty sections list.
*/
class TableData
{
    private:
        /// Id of this table (debug purposes). 0 for list of empty sections.
        const TableId tableid;

        /// Nr of last section returned for inserts. Use as hint to search new room first.
        unsigned lastinsertsectionnr;

    public:
        /// Constructor
        TableData(TableId tableid);

        /// List of sections that belong to this table
        std::map< unsigned, SectionInfo * > sectionlist;

        /** Moves a section to another table
            @param dest Destination table
            @param section Pointer to section that needs to be moved
        */
        void MoveSectionTo(TableData *dest, SectionInfo *section);

        /** Adds a new section to this table
            @param section Pointer to section info
        */
        void AddSection(SectionInfo *section);

        /** Tries to find a section with enough room to accomodate @block contiguous
            blocks. Returns 0 on failure.
            @param blocks Number of contiguous blocks to allocate
            @return Section info about section with enough room, or 0 if no such section exists
        */
        SectionInfo * FindSectionWithEnoughRoom(unsigned blocks);

        /** Returns the section with a specific id. If the table contains no section
            with that id, this function throws (if @a accept_failure is false), or returns
            zero otherwise.
            @param sectionid Id of section to return
            @param accept_failure If true, throw an exception if the section is not present, else return 0.
            @return Returns Section info about section with given sectionid. 0 if the section is not part
                of this table, and failure is accepted
        */
        SectionInfo * GetSection(unsigned sectionid, bool accept_failure);

        /** Returns the section that contains a specific record-id. If the table contains
            no section with that record-id, this function throws (if @a accept_failure is false),
            or returns zero otherwise.
            @param rec Id of record that must lie in returned section
            @param accept_failure If true, throw an exception if the wanted section is
                not present, else return 0.
            @return Returns Section info about section that contains record with record id. 0
                if the section is not part of this table, and failure is accepted
        */
        SectionInfo * GetSectionFromRec(RecordId rec, bool accept_failure);

        /** Returns the first section in this table after a specific section (or the first section)
            @param section Info about the previous section (set to 0 to retrieve first section)
            @return Returns first section after @a section (or first if that parameter is 0). Returns
                0 if no more sections available
        */
        SectionInfo * GetFirstSectionAfter(SectionInfo *section);
};

/** Contains a list of tables.
*/
class TableList
{
    public:
        /// List of tables in this list
        std::map< TableId, std::shared_ptr< TableData > > tables;

        /** Return the section list for a specified table. If not present, it
            is created.
            @param id Id of the table
        */
        TableData & GetTable(TableId id);

        /** Return the section list for a specified table. If not present, 0  is returned.
            @param id Id of the table
        */
        TableData const * GetTableOpt(TableId id) const;
};
#ifdef DEBUG
typedef Blex::InterlockedData< TableList, Blex::DebugMutex > LockedTableList;
#else
typedef Blex::InterlockedData< TableList, Blex::Mutex > LockedTableList;
#endif

/** Data describing the free places in a section
*/
struct SectionFreeInfo
{
        inline SectionFreeInfo() : largestrun_position(0), largestrun_size(0) {}

        /// First block of the largest set of contiguous free blocks
        unsigned largestrun_position;

        /// Number of blocks in largest set of contiguous free blocks
        unsigned largestrun_size;

        /// Returns whether the section is empty (all blocks are free)
        bool IsEmpty() const;

        /** Allocates a number of contigous blocks from the information in this
            structure (does no work on disk). Caller must make sure number of
            requested blocks isn't more than @a largestrun_size, and room is
            physically marked used in prolog before rescanning and updating this
            in the section information.
            @param blockcount Number of contigous blocks to allocate
            @return Position of first allocated block
        */
        unsigned AllocateRoom(unsigned blockcount);
};

/** Contains all information about an individual section.
*/
class SectionInfo
{
    public:
        /** Constructor
            @param globalsectionnum Section id of the section in the whole database (must be unique for every section
            @param file Backing recordfile of this section
            @param filesectionid Id of this section relative to the backing recordfile
        */
        SectionInfo(unsigned globalsectionnum, RecordFile *file, unsigned filesectionid);

        /** Free block information - SAFE TO USE/UPDATE ONLY IF TABLELOCK IS HELD
            Look out: no allocations may be unused (but may be used later) when updating this!
        */
        SectionFreeInfo tablelocked_freeinfo;

        /// Number of concurrent updaters - SAFE TO USE/UPDATE ONLY IF TABLELOCK IS HELD
        unsigned tablelocked_updater_count;

        ///Global section number for this section
        unsigned const globalsectionnum;

        ///Lock the section in memory directly
        uint8_t* Lock()
        {
                return file->secfile->LockSection(filesectionid);
        }

        ///Release a lock (ADDME: Can we combine this with AddToCommitHistory? They always come in pairs?)
        void Unlock(uint8_t const *locked_address)
        {
                return file->secfile->UnlockSection(filesectionid, locked_address);
        }
        ///Add this section to a commit history
        void AddToCommitHistory(Blex::SectionUpdateHistory *history)
        {
                history->commitmap[Blex::SectionUpdateHistory::CommitKey(file->secfile.get(), filesectionid)] = file->secfile->MarkSectionDirty(filesectionid);
        }

        ///Get file section id
        unsigned GetFileSectionId() { return filesectionid; }

        ///Returns whether this section is from a specified file
        bool IsFromFile(RecordFile const *otherfile) { return otherfile == file; }

    private:

        ///File containing this section
        RecordFile * const file;

        ///File-based section id
        unsigned const filesectionid;
};


/** This class handles the I/O to the filesystem, and the caching. It is
    not directly involved with the transactions.
*/
class RawDatabase
{
    public:
        static const unsigned SectionLockGranularity = 64;      //number of locks for sections. increase this number to decrease lock granularity
        static const unsigned TableLockGranularity = 16;        //number of locks for tables. increase this number to decrease lock granularity
        static const unsigned CacheLineSize = 128;              //cache line size (mutexes must be this far apart)

        /** IO Constructor. Opens and if necessary creates a database
            @param indexsystem Current indexsystem, which will receive Add notifications.
            @param folder Folder to store the database. It must already exist, be a full
                          path name and not end with a '/' */
        RawDatabase(const std::string &basefolder, std::string const &recordfolder, bool new_database, bool disallow_cleaning, bool save_deleted_blobs, bool sync_enabled);

        /** IO Destructor. Closes the database, if open */
        ~RawDatabase() throw();

        /** Gracefully closes the raw database. Can be called multiple times. */
        void Close();

        /// Set callback for section clean hints
        void SetSectionCleanHintCallback(std::function< void(unsigned const *, unsigned) > const &callback);

        BlobManager& GetBlobMgr() { return blobmgr; }
        BlobManager const& GetBlobMgr() const { return blobmgr; }

        TransStateMgr& GetTransLog()
        {
                return translog;
        }

        /** Get the table id for a section */
        TableId Deprecated_GetSectionTableId(unsigned section) const;

        /** Returns whether a table id is still in use (not all sections cleaned out yet. */
        bool IsTableIdStillUsed(TableId id) const;

        /** Get the number of sections in the records file */
        unsigned GetNumSections() const;

        /** SectionViewer is the (authorative) rawtable iterator. A maximum of
            MaxRecordsView records are exposed at a time, use NextViewInSection
            to get the next records in the section. It shows ALL found records,
            and flags the visibility (basic visibility rules) of them, instead
            of showing only the visible ones.

            For an iteration over the whole table, use MoveToFirstSection for
            the first section, and then MoveToNextSection for the consecutive
            sections.

            Use GuidedMoveToSection when you have a list of recordids within
            section that you want to view (should only be used by the scanner) */
        class SectionViewer
        {
            public:
                static const unsigned MaxRecordsView = 32;

                struct DiskRecord
                {
                        RecordId recordid;
                        Record record;
                        bool is_visible;
                };

             private:
                RawDatabase &rawdb;

                TableId const tableid;

                /// Transaction to search data for, or 0 to see all records
                IdentifiedTrans const *identified_trans;

                /// Show mode..
                ShowMode showmode;

                /// Locked section
                SectionInfo *locked_section;

                /// Data of locked section; 0 if no section locked
                uint8_t* sectiondata;

                /// Records in this section
                DiskRecord records[MaxRecordsView];

                /// Number of valid record in 'records'
                unsigned record_count;

                /// Recordid where next view must start to search (0 to disable NextViewInSection)
                RecordId nextviewstart;

                /// Set if any records are made permanently invisible
                bool any_records_killed;

                /// Moves to new section (handles locking), cleans records
                bool GotoSection(SectionInfo *section_info);

                /// Returns if a record is visible for the backend
                bool IsVisible(RecordId curblock);
//                bool IsVisible_old(RecordId curblock);
//                bool IsVisible_new(RecordId curblock);

                /// Moves to a section with known sectioninfo
                bool MoveToSection(SectionInfo *sectioninfo);

             public:
                /** Instantiate a normal sectionviewer
                    @param rawtable Table to iterate over, 0 to iterate over whole database.
                    @param identified_trans Identified transaction to use for resolving transaction status
                    @param showmode Showmode to operate in */
                SectionViewer(RawDatabase &rawdb, TableId tableid, IdentifiedTrans const &identified_trans, ShowMode showmode);

                /// Instantiate a raw viewer (shows all records)
                SectionViewer(RawDatabase &rawdb, TableId tableid);

                ~SectionViewer();

                /// Moves to the first section
                bool MoveToFirstSection();

                /// Moves to the next section, returns false if no next section exists, true if exists (even when empty)
                bool MoveToNextSection();

                /// Moves to next view within this section. Returns whether move succesful (and records available in view)
                bool NextViewInSection();

                /// Moves to a specific section, returns false if out of range
                bool MoveToSection(uint32_t sectionid);

                /** Moves to a specific section, and filters available recordid's by recids
                    No more then MaxRecordsView records! */
                bool GuidedMoveToSection(TableId tableid, RecordId const *recids, unsigned count);

                /// Unlocks the current section
                void Unlock();

                unsigned GetCurrentSection() const { return locked_section ? locked_section->globalsectionnum : (unsigned)-1; }

                inline DiskRecord const * view_begin() { return records; }
                inline DiskRecord const * view_end() { return records + record_count; }
                inline unsigned view_size() { return record_count; }
        };
        friend class SectionViewer;


        /** Finds the after-commit version of a record.
            @param transid ID of transaction in whose context the query is done
            @param tableid Id of the table
            @param rec Record to chase
            @return Record id of current record, 0 if deleted */
        RecordId FindAfterCommitVersion(TransId transid, TableId tableid, RecordId rec);

        /** Mark a record as expired.
            @param trans ID of transaction that is reponsible for the expiry
            @param recblock record to update
            @param commits The list with information about what sections to flush before permitting a commit
            @param waiting_for If the record is busy (wait) this reference will be filled with the id of the
                   transaction that has exprired the record.
            @return <false,0> if the record is busy (waiT), <true,0> if the record
                    has been deleted by this or a parallel transaction (), <true,recid> if
                    the record was chased - returns the record id that should be actually updated */
        std::pair<bool,RecordId> TryExpireRecord(TransId trans, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits, TransId &waiting_for);

        /** Unmark an expired record.
            @param trans ID of transaction that is reponsible for the expiry
            @param commits The list with information about what sections to flush before permittinga commit
            @param recblock Record to unexpire */
        void UnexpireRecord(TransId trans, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits);

        /** Register the location of the next version of an expired record
            @param origblock Original block (the one that was updated)
            @param newblock Block containing the new version of the record
            @param commits The list with information about what sections to flush before permittinga commit */
        void RegisterUpdate(TableId tableid, RecordId origblock,RecordId newblock, Blex::SectionUpdateHistory &commits);

        /** Write a new record to the database.
            @param rec Record data
            @param hint Record id that hint the section where the record might be written
            @param new_section_on_hint_fail If true, place the record in a new section if hint was 0 or the hinted section doesn't have enough room. If false, search for other sections with enough room first.
            @param trans Transaction for which to write the record
            @param commits The list with information about what sections to flush before permitting commit
            @return 0 on error, or the new block number */
        RecordId WriteNewRecord(TableId tableid, Record rec, RecordId hint, bool new_section_on_hint_fail, TransId trans, Blex::SectionUpdateHistory&commits);

        /** Destroy an existing record, freeing the space it occupies. This can
            be done when we are sure no transaction or notification will refer the record
            @param block Block to destroy
            @param commits The list with information about what sections to flush before permittinga commit
            */
        void DestroyRecord(TableId tableid, RecordId block, Blex::SectionUpdateHistory&commits);

        /** Run through the entire table, and remove references to obsolete transactions
            @param range Range to obsolete all transactions from
            @param section Section to clear
            @param destroyable vector receiving destroyable records
                               (but we cannot do it ourselves, because we probably
                                need to ensure that indexes and other dependents
                                are updates as well)
            @param allrecs All records, both surviving and destroyables */
        void ClearObsoleteTransactions(TableId table,
                                                RangeId range,
                                                unsigned section,
                                                std::vector<RecordId> &destroyable,
                                                std::vector<RecordId> &allrecs,
                                                Blex::SectionUpdateHistory&commits,
                                                bool invert);

        /** Returns the ids of all permanently invisible records in a given section
            @param section Section to check
            @param destroyable List that is filled with ids of records that can be destroyed directly
        */
        void ReturnDestroyableRecords(TableId tableid, unsigned section, std::vector< RecordId > *destroyable);

        struct Debug_RecordData
        {
                TableId tableid;
                unsigned size;
                TransId adder;
                TransId remover;
                RecordId next;
        };

        /** Get info about a record. Warning: NOT THREADSAFE!!!!. ADDME: Merge into the record iterator */
        Debug_RecordData Debug_GetRecordInfo(RecordId recid);

        /** Syncs all modifications in the table-file to disk. This is a heavy operation! */
        void SyncAllTableFiles();

        /** Updates the file time stamps of all table files */
        void UpdateFileTimeStamps();

        /** Syncs and frees unused sections */
        void GenerationalCleanupUnusedSections(volatile uint32_t *abortflag);

        /** Mark the end of an active transaction (after this all chased records seen by this transaction can be deleted)
            Preferrably call this function AFTER unregistering this transaction with the transaction manager
            @param trans Transaction that has finished
            @param committed Has the transaction committed? (if not, the janitor must clean all the written-to sections)
        */
        void UnregisterTransaction(TransId trans, bool committed);

        /** Mark a section as dirty in the specifide history */
        void MarkSectionDirty(TableId tableid, unsigned sectionid, Blex::SectionUpdateHistory &commits);

    private:
        typedef std::shared_ptr<RecordFile> RecordFilePtr;
        typedef Blex::ObjectOwner<SectionInfo> SectionInfoOwner;

        /// Owner for the SectionInfo structures (which are stable)
        SectionInfoOwner si_owner;

        struct RawDBData
        {
                ///Highest record file # in use
                unsigned highest_recordfile;
                ///The tables we manage
                std::vector<RecordFilePtr> files;
                ///Total number of sections
                unsigned section_count;
        };

//#ifdef DEBUG
//        typedef Blex::InterlockedData<RawDBData, Blex::DebugMutex> RawDB;
//#else
        typedef Blex::InterlockedData<RawDBData, Blex::Mutex> RawDB;
//#endif

        struct AlignedSectionLocks
        {
#ifdef DEBUG
                Blex::DebugMutex mutex;
#else
                Blex::Mutex mutex;
#endif
                uint8_t alignbytes[2*CacheLineSize - sizeof(Blex::Mutex)];
        };

        struct AlignedLockedTableList : public LockedTableList
        {
                uint8_t alignbytes[2*CacheLineSize - sizeof(Blex::Mutex)];
        };

        /** This struct records all data about record that can be of have
            been part of a chase.
        */
        struct RecordChaseData
        {
                inline RecordChaseData() : last(0), next(0), refcount(0) {}

                /// Points to last version in the update chain
                RecordId last;

                /// Points to next version in the update chain
                RecordId next;

                /// Number of transaction that have seen this record in a chase
                unsigned refcount;

                /** Returns whether this record has been seen in a transaction because
                    of a chase or is part of a update chain. If not used, this struct
                    can safely be deleted
                    @return Whether this record has any data associated to it
                */
                inline bool IsUsed() { return last || next || refcount; }
        };

        /** In the chaselockdata structure, all data pertaining to update chains
            for updated records, and for locking of chased records
        */
        struct ChaseLockData
        {
                /** Chase/update data for individual records
                */
                std::unordered_map< RecordId, RecordChaseData > chase_data;

                /** List of records that have been seen in a chase (and must be locked,
                    so they can't be deleted
                */
                std::unordered_map< TransId, std::vector< RecordId > > chases_per_trans;

                /** List of sections modified by a transaction. FIXME: better name
                    for chaselockdata structure? Move this out of chaselockdata?
                */
                std::unordered_map< TransId, std::unordered_set< unsigned > > modified_sections;
        };
        typedef Blex::InterlockedData< ChaseLockData, Blex::Mutex> LockedChaseLockData;

        /// Chase data
        LockedChaseLockData chaselockdata;

        // FIXME: document!
        /** Tries to delete all associated chase data for a record. This function
            must be called before making a record permanently invisible, but certainly
            before destroying it. The function fails when the record has been locked
            by a transaction that has chased to it.
            @param rec Id of record to delete the chase data for
            @return Whether the record data has been deleted (if false, there exists
                a transaction older than the inserter of @a rec that has chased to this
                transaction. This is a fatal error when deleting that record, because
                it may not be deleted).
        */
        bool TryDeleteRecordChaseData(RecordId rec);

        /** Returns the next version in the update chain for a record, and also chase-locks it
            @param trans Transaction to get the next record for (ignored when lock == false)
            @param rec Old version of the record
            @param lock If true, lock the next version (ADDME: use trans == 0 instead?)
            @return Returns next version of this record (0 if none available: record was deleted)
        */
        RecordId ChaseNextVersion(TransId trans, RecordId rec, bool lock);

        RecordFilePtr OpenRecordFile(RawDB::WriteRef &rawdblock, std::string const &path, bool new_file);

        bool TryReadAndInvalidateSectionCache(RawDB::WriteRef &rawdblock, RecordFile *recordfile, std::string const &path);

        /** Read and analyze database on-disk structure */
        void ReadTableFiles();

        /** Write section cache for a specific file. Also puts cache stamp in record file. */
        bool WriteSectionCache(RecordFile *recordfile, std::string const &path, uint32_t cache_stamp);

        /** Write out the section caches for all table files. */
        void WriteTableFileSectionCaches(RawDB::WriteRef &rawdblock);

        /** Closes all table files */
        void CloseTableFiles(RawDB::WriteRef &rawdblock);

        unsigned GetBestWriteSpot(uint8_t *prolog, unsigned numblocks); //NOTHROW!
        SectionInfo* FindUnusedSection (RawDB::WriteRef &rawdblock);
        SectionInfo* FindSectionWithFreeSpace (RawDB::WriteRef &rawdblock, TableId tableid, unsigned numblocks);

        void ExtendDatabase(RawDB::WriteRef &rawdblock);

        SectionInfo* AllocateEmptySection();

        // Tablelock structure
        class TableRef;
        friend class TableRef;

        // Section lock structure
        class SectionRef;
        friend class SectionRef;

        ///Shared data. Lock before any individual section
        RawDB rawdb;

        ///Mutex array to protect prologs of sections
        std::unique_ptr< AlignedSectionLocks[] > sectionlocks;

        ///Array of table structures.
        std::unique_ptr< AlignedLockedTableList[] > tablelocks;

        ///The folder where the database is located
        std::string basefolder;
        ///The folder where the database records are located
        std::string recordfolder;

        ///The transaction manager
        TransStateMgr translog;

        ///The blob manager
        BlobManager blobmgr;

        ///Callback, called when a section needs cleaning. May be 0!
        std::function< void(unsigned const *, unsigned) > section_clean_hint_callback;

        bool recordid_mapping_changed;

        bool const sync_enabled;

        friend class DatabaseLocker;
};

/** A database locker manages the locking of tables for a single user. By using
    its local lock list and caching locks, it can cut back on global mutex usage */
class DatabaseLocker
{
        public:
        ///Construct database locker
        DatabaseLocker(RawDatabase &rawdb);

        ///Destroy database locker
        ~DatabaseLocker();

        ///Lock a record
        Record LockRec(TableId tableid, RecordId locknum);

        ///Unlock a record
        void UnlockRec(RecordId locknum);

        private:
        struct SectionLock
        {
                SectionInfo *section_info;
                unsigned lockcount;
                unsigned lasthit;
                uint8_t *sectionptr;
        };

        RawDatabase &rawdb;
        std::vector< SectionLock > locks;
        unsigned totallocks;

        DatabaseLocker(DatabaseLocker const &) = delete;
        DatabaseLocker& operator=(DatabaseLocker const &) = delete;
};

/** AutoRecord works like the auto_ptr, but for records. It holds onto a
record (which it will obtain via LockRecord) and will unlock the record
when the object itself is destroyed, eg by going out of scope ) */
class DeprecatedAutoRecord
{
        public:
        /** Load and lock a record */
        inline DeprecatedAutoRecord(DatabaseLocker &_locker, TableId tableid, RecordId _recnum)
        : locker(_locker)
        {
                recnum=_recnum;
                rec=locker.LockRec(tableid, recnum);
        }

        /** Destroy ourselves, releasing the record if necessary */
        inline ~DeprecatedAutoRecord()
        {
                if (rec.Exists())
                    locker.UnlockRec(recnum);
        }
        /** Load and lock a new record */
        inline bool Reset(TableId tableid, RecordId _recnum)
        {
                if (rec.Exists())
                    locker.UnlockRec(recnum);

                recnum=_recnum;
                rec=locker.LockRec(tableid, recnum);
                return rec.Exists();
        }
        /** Set to empty record */
        inline void Reset()
        {
                if (rec.Exists())
                    locker.UnlockRec(recnum);

                recnum=0;
                rec=Record();
        }
        const Record& operator* () const
        {
                return rec;
        }
        const Record* operator-> () const
        {
                return &rec;
        }
        inline RecordId GetRecnum() const
        {
                return recnum;
        }

        private:
        ///Database locker administering our locks
        DatabaseLocker &locker;
        ///Currently held record
        Record rec;
        ///Current record number
        RecordId recnum;

        DeprecatedAutoRecord(DeprecatedAutoRecord const &) = delete;
        DeprecatedAutoRecord& operator=(DeprecatedAutoRecord const &) = delete;
};

/** Class locking and giving access to the data of a specific table
    Locking order: no two tables may be locked by a thread at a given
    time, except table 0. That table may be locked inside another table lock
*/
class RawDatabase::TableRef
{
    private:
        /// Write reference to the table list
        LockedTableList::WriteRef lock;

        /// Reference to table list data
        TableData &list;
    public:
        /** Constructor, opens a reference for a specific table.
            @param table Table to get a reference to (0 for empty sections list
        */
        TableRef(RawDatabase &rawdb, TableId table);
        ~TableRef();

        TableData * operator->() { return &list; }
        TableData & operator*() { return list; }

        // The function that are heavily involved with locks are placed here, and not in TableData.

        /** Updates the free-info of a section. WARNING: do !NOT! use when prolog
            updates from allocations from the old info are still pending.
            @param new_info New free-info
        */
        void UpdateFreeInfo(SectionInfo *info, SectionFreeInfo const &new_info);

        /// Increases the number of updaters that are active within a section. Section must be part of this table
        void IncreaseUpdaters(SectionInfo *info);

        /// Decreases the number of updaters that are active within a section, returns new count. Section must be part of this table
        unsigned DecreaseUpdaters(SectionInfo *info);
};

/** Class locking and giving access to the prolog of a specific section
    ADDME: modify prolog access function to only work through this class.
*/
class RawDatabase::SectionRef
{
    private:
        /// Info structure about section
        SectionInfo *section_info;

        /// Mapping address of section data
        uint8_t *section_data;
#ifdef DEBUG
        Blex::DebugMutex::ScopedLock prolog_lock;
#else
        Blex::Mutex::ScopedLock prolog_lock;
#endif
        /// Optional commit history to register to on destruction
        Blex::SectionUpdateHistory*history;

    public:
        /** Constructor. Maps a given section into memory, optionally locking the prolog
            for exclusive access
        */
        SectionRef(RawDatabase &rawdb, SectionInfo *info, bool lock_prolog);
        ~SectionRef();

        /// Locks the prolog data for exclusive access
        inline void LockProlog() { prolog_lock.Lock(); }
        /// Unlocks the prolog data
        inline void UnlockProlog() { prolog_lock.Unlock(); }

        /// Register a write to the section
        inline void RegisterWrite(Blex::SectionUpdateHistory &_history);

        /// Get pointer to section that can be used for accessing record data
        inline uint8_t * data() { return section_data; }
        /// Get pointer to section that can be used for accessing prolog data
        inline uint8_t * prolog() { assert(prolog_lock.IsLocked()); return section_data; }

        /// Rescans prolog (prolog MUST be locked!)
        void PrologLocked_RescanProlog(SectionFreeInfo *free_info); //

        /// Prefetches the memory pages containing the prolog into memory (for use outside the locks)
        void PrefetchProlog();
};

} //end namespace Database

#endif
