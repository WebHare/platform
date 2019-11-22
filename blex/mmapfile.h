#ifndef blex_mmapfile
#define blex_mmapfile

#ifndef blex_path
#include "path.h"
#endif
#ifndef blex_threads
#include "threads.h"
#endif
#include <set>
#include <vector>

namespace Blex
{

class MmapFile;
class SectionFile;

/** MmapFile file is a basic, OS-independent interface to memory mapped files.

    Multithreading considerations:
    All operations (except Sync) are threadsafe. Sync and SyncAll can return failures
    when the sections they refer to are removed before finishing.
*/
class BLEXLIB_PUBLIC MmapFile
{
        public:
        /** Destroy a memory-mapped file */
        virtual ~MmapFile(); //throw();

        /** Open a mmap for read-only access
            @param shareable The file may be shared with other processes */
        static MmapFile* OpenRO(std::string const &filename, bool shareable);// throw (std::bad_alloc);

        /** Open a mmap for read/write access
            @param shareable The file may be shared with other processes */
        static MmapFile* OpenRW(std::string const &filename,
                             bool create, bool exclusive,
                             FilePermissions::AccessFlags access,
                             bool shareable,
                             bool delete_after_close,
                             bool enable_autosync);// throw (std::bad_alloc);

        /** Grow the size of a mmaped file.
            @return false if resizing failed */
        bool ExtendTo(FileOffset numbytes);// throw();

        /** Open a mapping
            @return Mapped data, or 0 upon error */
        void const *MapRO(FileOffset start,std::size_t length);

        /** Open a mapping
            @return Mapped data, or 0 upon error */
        void *MapRW(FileOffset start,std::size_t length);

        /** Close and flush a mapping
            @param mappingstart Start of the mapping, which must be the return value of a previous MapRW call */
        void Unmap(void const *mappingstart, std::size_t length);// throw();

        /** Closes and flushes all mappings
            @return false upon unmap failure */
        void UnmapAll();// throw();

        /** Synchronize a mapping to disk
            @param start Start of the range to flush
            @param numbytes Number of bytes to flush
            @return false upon sync failure */
        bool Sync(void *start, std::size_t numbytes, bool ignore_unmapped) const;// throw();

        /** Synchronzie all open mappings to disk, and ensure all data if flushed */
        bool SyncAll() const;

        /** Updates the file modification timestamp */
        bool SetModificationDate(Blex::DateTime newtime);

        /** Get the filesystem status of this file
            @return A PathStatus structure */
        PathStatus GetStatus() const;// throw();

        /** Get the current length of this file */
        FileOffset GetFilelength();// throw();

        protected:
        bool InternalOpen(std::string const &filename,
                                   bool writeacces,
                                   bool create,
                                   bool exclusive,
                                   FilePermissions::AccessFlags access,
                                   bool shareable,
                                   bool delete_after_close,
                                   bool enable_autosync);// throw();

        MmapFile();// throw();

        void CheckOverlaps(FileOffset start,std::size_t  length);// throw();

        bool RegisterMapping(FileOffset start,std::size_t  length, void *ptr, bool write_access);// throw();

        bool UnregisterMapping(const void *ptr, std::size_t  length);

        /** Is the specified area actually mapped ? */
        bool IsAreaMapped(const void *ptr, std::size_t  length) const;

        /** Are there any mappings? */
        bool AnyMappings() const;

        private:
        void *DoMap(FileOffset start,std::size_t length, bool readonly);// throw();

        /** Mmap is opened for read-write ? */
        bool writeaccess;

        /** Current open file */
        FileHandle filehandle;

        /** Path to current open file */
        std::string path;

        /** Autosync on unmap */
        bool enable_autosync;

        /** Register any current mappings */
        struct Mapping
        {
                inline Mapping(void *_ptr, FileOffset startoffset, std::size_t length, bool _write_access)
                  : ptr(static_cast<uint8_t *>(_ptr))
                  , startoffset(startoffset)
                  , length(length)
                  , write_access(_write_access)
                {
                }

                /** Pointer to the mapped memory area */
                uint8_t *ptr;
                /** Start offset of this mapping */
                FileOffset startoffset;
                /** Length of this mapping */
                std::size_t length;
                /** Do we have write access to the mapping? */
                bool write_access;
        };

        typedef std::vector< Mapping > Mappings;

        struct Data
        {
                /** Currently used mappings */
                Mappings mappings;
        };

#ifdef DEBUG
        typedef InterlockedData< Data, Blex::DebugMutex > LockedData;
#else
        typedef InterlockedData< Data, Blex::Mutex > LockedData;
#endif
        LockedData data;

        friend class SectionFile;
};

/** Manage a mmaped file, divided into sections.

    Multithreading considerations:
    LockSection, UnlockSection, AppendSectionPage and GetNumSections are MT-safe. */
class BLEXLIB_PUBLIC SectionFile
{
        public:
        /** Automatic section to support 'acquisition is initialization'.
            Storing retrieved section pointers in this class allows the user
            to ensure that the sections held will be properly released */
        class AutoSection
        {
                SectionFile &sectionfile;
                uint32_t sectionnum;
                uint8_t *sectionptr;

                public:
                AutoSection(SectionFile &sectionfile, uint32_t sectionnum=0xFFFFFFFFL)
                  : sectionfile(sectionfile)
                  , sectionnum(sectionnum)
                  , sectionptr(NULL)
                {
                        if(sectionnum != 0xFFFFFFFFL)
                            sectionptr = sectionfile.LockSection(sectionnum);
                }
                ~AutoSection()
                {
                        if (sectionptr)
                            sectionfile.UnlockSection(sectionnum, sectionptr);
                }
                operator uint8_t*()
                { return sectionptr; }
                unsigned GetSectionNum() const
                { return sectionnum; }

                void Reset(unsigned newsection = 0xFFFFFFFFL)
                {
                        if (sectionnum!=newsection)
                        {
                                if (sectionptr)
                                    sectionfile.UnlockSection(sectionnum, sectionptr);

                                sectionptr=NULL; //make sure it points nowhere if LockSection throws.
                                sectionnum=0xFFFFFFFFL;

                                if(newsection != 0xFFFFFFFFL)
                                {
                                        sectionptr = sectionfile.LockSection(newsection);
                                        sectionnum=newsection;
                                }
                        }
                }

                AutoSection(AutoSection const &) = delete;
                AutoSection& operator=(AutoSection const &) = delete;
        };

        /** SectionFile opener
            @param sectionsize Size of individual sections
            @param filename File to open
            @param allow_exist May the
            @param max_free_sections Maximum backlog of free sections to keep (shared mode only)
            @param share_sections Whether to share open sections (set to false for memory debugging)
            @param create_exclusive Fail if the file already exists
            @param sync Sync writes where needed (no crash protection if set to false) */
        static SectionFile* Open(unsigned sectionsize, std::string const &filename, unsigned max_free_sections, bool share_sections, bool create_exclusive, bool delete_on_close, bool sync);

        /** SectionFile destructor
            Does not flush all data to disk, an explicit flush needs to be given for that.
        */
        ~SectionFile();// throw();

        /** Cache and lock a section prolog for writing.
            @param sectionnum Section for which the prolog must be obtained
            @return The prolog data itself */
        uint8_t* LockSection (unsigned sectionnum);// throw(Exception);

        /** Unlock a section prolog, and optionally commit it
            @param sectionnum Section for which the prolog must be obtained */
        void UnlockSection (unsigned sectionnum, uint8_t const *sectionptr);

        /** Mark a section as having been updated, and obtain its update counter,
            to allow forced-sync for commits (note: sections may be updated
            without this function being called)
            @param sectionnum Section that has been updated
            @return Updatecounter for later section force-sync */
        uint32_t MarkSectionDirty(unsigned sectionnum);

        /** Ensure that specific changes to a section have been committed. This
            function may fail to ensure committing if section sharing is not enabled.
            @param sectionnum Section that has been updated
            @param updatecount Updatecount returned by MarkSectionDiry
            @return false if we were unable to flush the section */
        bool EnsureSectionFlushed(unsigned sectionnum, uint32_t updatecount);

        /** Append a new empty section and enter it into the map.
            @return true if a new page was added, false if resizing was impossible*/
        bool TryAppendSectionPage();

        /** Append a number of empty sections and enter it into the map.
            @param count Nr of sections to append
            @return true if the new pages were added, false if resizing was impossible*/
        bool TryAppendSectionPages(unsigned count);

        /** Flush entire secion file. Does NOT update the timestamps, using SectionUpdateHistory is more efficient  */
        bool FlushAll();

        /** Get current number of sections */
        unsigned GetNumSections();

        /** Updates the file modification timestamp */
        bool SetModificationDate(Blex::DateTime newtime);

        /** Cleans up unused sections (flushes them or frees them when they are old enough) */
        void GenerationalCleanupUnusedSections(volatile uint32_t *abortflag);

        private:
        typedef std::pair<unsigned, uint8_t const*> Mapping;
        typedef std::set<Mapping> SectionMappings;

        /** SectionFile constructor */
        SectionFile(unsigned max_free_sections, bool share_sections, bool sync_enabled);// throw(Exception, std::bad_alloc);

        /** Construct our data. */
        bool Init(unsigned sectionsize, const std::string &filename, bool create_exclusive, bool delete_on_close);

        /** Section data

            The section data holds the data describing a section.
            The dirtyness accounting system uses three generation counters, which are wrapping uint32_t's
            - update_gen
            - syncing_gen
            - sync_gen
            The update_count is the current generation of a page. This is returned by MarkSectionDirty.
            The syncing_count is the highest count that has been given to EnsureSectionFlushed for sync flush.
            The sync_count is the hightes count that has been given to EnsureSectionFlushed for sync flush for which the
            sync actually succeeded.

            Invariants: update_gen == syncing_gen || update_gen == syncing_gen + 1
                        sync_gen <= syncing_gen
        */
        struct SectionData
        {
                void Reset(uint8_t *_mapptr = 0, unsigned _numlocks = 0);

                ///Number of locks held on this section
                unsigned numlocks;

                ///Pointer to section data, or 0 if not mapped
                uint8_t *mapptr;

                /// Current dirty generation of this section
                unsigned update_gen;

                /// Highest update count given to EnsureSectionFlushed for sync flush
                unsigned syncing_gen;

                /// Highest update count given to EnsureSectionFlushed for sync flush, for which the flush succeeded.
                unsigned sync_gen;

                /// Number of flushers currently busy (may not unmap when a sync is being done
                unsigned syncer_count;

                /// Counter of the time this page has been unlocked (counted in calls to GenerationalCleanupUnusedSections)
                unsigned free_age;

                /// Returns whether this page is dirty (the latest generations has not been written to disk
                bool IsDirty() const;

                /// Returns whether this generation has been written to disk
                bool IsOnDisk(unsigned updatecount) const;

                /** Signal the start of a syncing operation (increases syncer_count)
                    @param my_updatecount Generation that is synced
                */
                void StartSync(unsigned my_updatecount);

                /** Signal the finishing of a syncing operation (decreases syncer_count)
                    @param my_updatecount Generation that has been synced
                    @param success Did the flush succeed?
                */
                void FinishSync(unsigned my_updatecount, bool success);
        };

        ///Our structure data
        struct SFData
        {
                SFData();

                ///Currently mapped sections
                std::vector<SectionData> sections;

                ///Section mapping addresses, only if sections are mapped unshared
                SectionMappings sectionmappings;

                ///Number of unused (lockfree) sections
                unsigned lockfreesections;

                ///Last section 'free' point
                unsigned lastfreepoint;
        };
        typedef InterlockedData<SFData, Mutex> SF;
        SF sf;

        /// Maximum number of sections simultaneously in the free list
        unsigned const max_free_sections;
        /// Share locked sections. You want this, unless you're debugging for unlocked memory accesses
        bool const share_sections;

        ///The records file
        std::unique_ptr<Blex::MmapFile> recordsfile;

        ///Size of a section (shouldn't be changed after initialization, should be a pagesize multiply). Set to fileoffset to ensure any multiplication with sectionnum is 64-bit
        Blex::FileOffset sectionsize;

        ///Name of the section file
        std::string filename;

                ///Enable sync
        bool const sync_enabled;

        /** The deferred unlocker keeps a list of sections, which it syncs and unlocks
            when Flush() is called.
            When the destructor is called, no syncing or unlocking is done, but the
            sectionfile sflock is taken to roll back.
        */
        class DeferredUnlocker
        {
             public:
                static const unsigned MaxDeferredUnlocks = 4;

             private:
                /// Sectionfile that owns this unlocker
                SectionFile *sectionfile;

                /// Number of stored sections
                unsigned count;

                struct Data
                {
                        unsigned sectionnr;
                        unsigned update_gen;
                        uint8_t *mapptr;
                        bool must_flush;
                };

                /// List of stored sections numbers (POD) and their update nr
                Data sections[MaxDeferredUnlocks];

            public:

                explicit inline DeferredUnlocker(SectionFile *_sectionfile) : sectionfile(_sectionfile), count(0) { }

                /// Locks sectionfile::sflock
                ~DeferredUnlocker();

                /// Flush and unlock all sections. Locks sectionfile::sflock
                void Flush();

                /** Add a section to the deferred unlock lists
                    Upon succesfull taking, the section is reset
                    Returns whether unlocking has succeeded
                */
                bool AddDeferredUnlock(SF::WriteRef &sflock, SectionData *data, unsigned sectionnum);
        };

        void FlushLockfreeSections(SF::WriteRef &sflock, DeferredUnlocker *deferunlock);
        bool FlushUnlock(SectionData &sd);

        friend class DeferredUnlocker;
};

/** Commit history for a section file. Sections that have been updated will
    be recorded into this file */
class BLEXLIB_PUBLIC SectionUpdateHistory
{
        public:
        ///Info about section to commit
        struct CommitKey
        {
                ///Create a commit key
                CommitKey(Blex::SectionFile *_table, unsigned _section)
                : table(_table),section(_section)
                {
                }

                ///Compare operator for map storage
                bool operator<(CommitKey const &rhs) const
                {
                        return table<rhs.table || (table==rhs.table && section<rhs.section);
                }

                ///Table to commit
                Blex::SectionFile *table;
                ///Section in table to commit
                unsigned section;

        };

        ///Type of a map which updatecount to set for each committable section
        typedef std::map<CommitKey,uint32_t> CommitMap;

        /** Force a synchronisation of all uncommitted tables and sections
        */
        bool ForceSyncAll();

        //FIXME private:
        CommitMap commitmap;
};

} //end namespace Blex

#endif
