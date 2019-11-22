#ifndef blex_webhare_dbase_dbase_index_frontend
#define blex_webhare_dbase_dbase_index_frontend

#include <set>
#include <blex/btree_filesystem.h>
#include <ap/dbserver/dbase_types.h>

namespace Database {
class RawDatabase;

namespace Index {
class System;

/// Structure containing all data the system needs for indexes
class IndexData
{
    public:
        /** Builds a query object for the given index. Make sure the index exists, and is complete (check with IndexReady!).
            @return Returns Query object for described index, of given type */
        std::shared_ptr< Blex::Index::BtreeIndex::Query > MakeMultiQuery(Cell celldata[], unsigned cellcount, SearchRelationType type, bool survive_if_unavailable);

        /** Get statistics of a specific index.
            @param descriptor Descriptor of needed index
            @param stats Structure where statistics are copied to
            @return If an index existed for given descriptor, and stats are valid */
        bool GetStatistics(Blex::Index::Statistics *stats);

        /** Is the index ready ?
            @return True if the index is ready. May return a stale false value,
                    so do not rely on it */
        bool IsReady() const { return ready; }

        Descriptor const & GetDescriptor() const { return descriptor; }

        /// Holds a reference to an indexdata. Automatically manages safe refcounts.
        class Ref
        {
                public:
                ///Copy & Clone reference
                Ref(Ref const &src);
                ///Assign & clone reference
                Ref& operator=(Ref const &src);
                ///Decrease refcount
                ~Ref();
                /** Get indexdata itself . When used, the caller is responsible
                    for maintaining a reference to the index. This function is
                    used by the Scanner/Planner to avoid taking references when
                    it knows the current metadata will keep stuff alive anyway */
                IndexData* operator->() const { return indexdata; }
                IndexData* Get() const { return indexdata; }
                ///Is the index reference valid? (can only be invalid if it was requested not to create new indexees through GetIndexRef)
                bool Valid() const { return indexdata != NULL; }
                void Reset() { *this = Ref(NULL); }

                private:
                ///Ref constructor - only usable by INdex::System
                Ref(IndexData *indexdata) : indexdata(indexdata)
                {
                }

                IndexData *indexdata;

                friend class System;
        };

    private:
        explicit IndexData(System &system);

        /** Is the index filled and ready? */
        bool ready;

        /// Pointer to index object
        std::unique_ptr<Blex::Index::BtreeIndex> index;

        /** Request descriptor, contains descriptor, extra data needed for construction, and
            pointer to raw table, needed for fill (all data needed for construction of a
            new index) */
        Descriptor descriptor;

        /** Reference count. May be 0 if we're initializing the index system
            and no references were created yet. Reference count is protected
            by the 'data' lock in its owning System */
        unsigned refcount;

        friend class System;
        friend class Ref;
        System &system;
};

/** System class - maintains the whole index system. Does not fill itself upon requests! */
class System
{
    private:
        /// Shorthand for list of IndexData
        typedef std::vector< std::shared_ptr<IndexData> > IndexList;

        /** Class containing all protected data of the index-system */
        struct SystemData
        {
                /// List of indexes of statuses RequestCreate, Filling and Ready
                IndexList indexes;

                /// True if database metadata is live and valid (refcount == 0 really means deleted index)
                bool metadata_is_live;

                /// True if the first full fill after going live is done
                bool first_live_fill_done;

                /// True if the first fill has been started
                bool within_first_live_fill;

                /// True if we're shutting down
                bool abort;

                /// Have filled some indices, flush when idle
                bool flush_on_idle;
        };

        typedef Blex::InterlockedData<SystemData, Blex::ConditionMutex> LockedSystemData;

        /** We use a separate mutex for the reference counters, otherwise STL
            containers inside SystemData have a hard time dealing with the
            recursive locks caused by copying elements */
        Blex::Mutex refcount_mutex;

        void UpdateIndex(IndexData const &index, RecordId recid, Record rec, bool insertion);

        ///Shared data for the index
        LockedSystemData systemdata;

        std::string const configfilename;
        std::string const indexfilename;

        /** Create an index reference */
        IndexData::Ref CreateIndexRef(IndexData *currentref);
        /** Clone an index reference */
        void CloneIndexRef(IndexData *currentref);
        /** Free an index reference */
        void FreeIndexRef(IndexData* currentref);

        /** Open an existing index system. Throws an exception if it encounters an error (eg, improper close)
            @return true if an existing index was opened, false if no index existed yet */
        bool OpenExistingIndexSystem();
        void CreateNewIndexSystem();
        void CloseIndexSystem();

        void DestroyUnreferencedIndexes();

        std::unique_ptr<Blex::Index::DBIndexFileSystem> filesystem;

        void FillerThread();

        /// Fills indexes, returns if succesfull (if not, the filler thread was aborted)
        bool FillIndexes(std::vector<IndexData::Ref> const &to_fill);
        void MarkIndexesReady(std::vector<IndexData::Ref> const &to_fill);
        bool GetWorkForFiller(std::vector<IndexData::Ref> *to_fill);

        Blex::Thread filler;

        RawDatabase *filler_database;

        bool const sync_enabled;
    public:
        /** Constructs index management system.
            @param folder Folder in which index.dat and index.mdt files can be found or must be put */
        System(const std::string &folder, bool new_database, bool sync_enabled);

        /** Destructor for system */
        virtual ~System();

        ///Is first live fill done?
        bool IsFirstLiveFillDone() const;

        /** Gracefully closes the index system */
        void Close();

        void SyncIndexFiles();

        /** Resets whole system, destroys all indices. */
        void ResetWholeSystem();

        /** Starts the filler thread */
        void StartFiller(RawDatabase &db);

        /** Inserts or delete record into relevant indexes.
            @param table Table to which this record has been been added
            @param record Record that has been added
            @param recid RecordID of record */
        void TableUpdate(TableId table, RecordId recid, const Record &record, bool insertion);

        /** Tell whether the metadata is live, and index references can be considered up to date */
        void SetMetadataLiveStatus(bool now_live);

        /** Request an index*/
        IndexData::Ref GetIndexRef(const Descriptor &descriptor);

        /** Check if the specified index is ready for use */
        bool IsIndexReady(IndexData const &index) const;

        bool GetDescriptorOfIndexByNr(unsigned nr, Descriptor *descriptor) const;

        void WaitForFillComplete();

        void GenerationalCleanupUnusedSections(volatile uint32_t *abortflag);

        friend class Filler;
        friend class Data;
        friend class IndexData::Ref;

        System(System const &) = delete;
        System& operator=(System const &) = delete;
};

/// Shortcut for a list of descriptors
typedef std::vector<Descriptor> RequestDescriptorList;

/** Constructs an entry based on cell data
    @param datastore Store to put the raw entry data into
    @param data Cell data to fill with
    @param colcount Number of cells to fill with
    @param descriptor Descriptor of index
    @param last_cell_size_limit If not 0, limits size of data[colcount - 1] to this size
    @return Number of bytes filled in entry */
unsigned ConstructEntry(Blex::Index::IndexBlockEntryContainer &container, Cell data[4], unsigned colcount, Index::Descriptor const &descriptor, unsigned last_cell_size_limit, bool &is_last_cell_imprecise);

/** Constructs the limits for a query based on search data
    @param begin IndexBlockEntryContainer that will contain the begin entry
    @param end IndexBlockEntryContainer that will contain the end entry
    @param data Cells with data to search for
    @param colcount Number of valid cells
    @param descriptor Descriptor of index the query will be performed on
    @param type Search relation
    @return Returns true if this is a valid query */
bool ContructLimits(Blex::Index::IndexBlockEntryContainer &begin, Blex::Index::IndexBlockEntryContainer &end, Cell data[4], unsigned colcount, Index::Descriptor const &descriptor, SearchRelationType type);


} //end namespace Index
} //end namespace Database

#endif /* sentry */
