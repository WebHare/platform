#ifndef blex_webhare_dbase_scanner_scanlocate
#define blex_webhare_dbase_scanner_scanlocate

#include <ap/libwebhare/dbase.h>
#include "searches.h"

namespace Database
{

namespace LockResult
{
enum _type
{
        NoChange,
        Retry,
        Updated,
        Deleted
};
} // End of namespace LockResult

namespace DBScanner
{

typedef std::vector< SearchItemId > SearchItemIds;

struct ResultRecord
{
        RecordId recordid;
        Record record;
};

struct PlanSource;
struct PlanJoin;
struct PlanTable;

} //end namespace DBScanner

class SourceBase;
class VirtualTableSource;
class VirtualTableRecordItr;
class IndexJoiner;
class BlockJoiner;
class RecordMapper;
class RecordList;
class IndexQuery;

/** This class executes queries over the database. */
class Scanner
{
    public:
        /** Maximum number of records in the cache. Look out; the cache can keep
            a max of CacheSize sections locked at a time */
        static unsigned const CacheSize = 256;

        typedef uint8_t CellStore[MaxColumnSize + Cell::HdrSize];

    private:
        /// Transaction this scanner operates in
        BackendTransaction &trans;

        ///Raw database we're scanning
        RawDatabase &rawdb;

        /// Indicates whether this scanner is used for updating
        bool const for_update;

        /// Search this scanner implements.
        Search search;

        /// Plan this scanner uses
        std::shared_ptr< DBScanner::Plan > plan;

        /// Showmode for this scanner
        ShowMode const showmode;

        /// Top node of search tree
        std::unique_ptr< SourceBase > top;

        /// An item in the cache
        struct CachedItem
        {
                RecordId recordid;
                const uint8_t *recordraw; // No Record because of it's initialization (ADDME: Ugly!)
                uint16_t reclen;
        };

        /** Data per locked row. If either original != 0 or is_locked is true,
            cleanup (by UnlockRow) is necessary */
        struct RowLockData
        {
                /// Original record (record that was given to client by scanner)
                RecordId original;

                /// Is row locked? (or: is the record at end of chase-chain expired by this trans?).
                bool is_locked;
        };

        /// Number of rows in current query
        unsigned table_count;

        /// Nr of rows in the cache
        unsigned cache_fill;

        /// Cache
        CachedItem cache[CacheSize];

        /// Writable records as backing store for the cache, if we're reading from virtual tables
        std::vector<WritableRecord> cache_backing;

        /// Lock data per row (max CacheSize rows)
        RowLockData lockdata[CacheSize];

        /// Indicator whether a row is active.
        bool row_is_active;

        /// Current active row (iff row_is_active is TRUE)
        DBScanner::ResultRecord active_row[MaxTablesInQuery];

        std::unique_ptr< SourceBase > BuildNode(DBScanner::PlanSource const &source);
        std::unique_ptr< SourceBase > BuildJoin(DBScanner::PlanJoin const &join);
        std::unique_ptr< SourceBase > BuildVTableIterator(DBScanner::PlanTable const &table);
        std::unique_ptr< SourceBase > BuildRecordMapper(DBScanner::PlanTable const &table);

        bool use_limit;
        unsigned limit;

        bool Matches(DBScanner::SearchItemId id);
        bool CacheRowMatches(unsigned row);

        /** Sets the searchdata for a single search (done by the joiner)
            @param id Searchitem to update
            @param tablenr Tablenr to get the new searchdata from
            @param columndef ColumnDef of column to get the new searchdata from
            @param store Temporary storage for the cell that is used. Must be alive while searchitem is used! */
        void SetJoinSearch(DBScanner::SearchItemId id, unsigned tablenr, ColumnDef const &columndef, CellStore &store);

        /** Returns the a cell from a record, with internal column translation
            @param recdata Record data
            @param columndef ColumnDef of needed column
            @param store Temporary storage for the cell that is used. Must be alive while the returned cell is used!
            @return Requested cell */
        Cell SafeGetCell(Record recdata, ColumnDef const &columndef, CellStore &store);

        /** Initializes the scanner from a plan. */
        void PrepareFromPlan();

        ///Called when we hit EOF on the scanner.
        void HitEof();

        /** Locks first record in a row. Returns immediately on failure (even when wait might help)
            @param row Row to lock
            @param can_signal If set to true, the locking manager can signal the current connection to start a retry of taking this lock if the record is busy
            @return Result of lock */
        LockResult::_type LockCachedRowInternal(unsigned row, bool can_signal);

    public:
        /** Builds a new scanner. This does NOT access BackendTransaction data. */
        Scanner(BackendTransaction &_trans, ShowMode showmode, bool _for_update);

//        Scanner(BackendTransaction &_trans, ShowMode showmode);

        ~Scanner();

        /** Add a table to the list of scanned tables */
        void AddTable(TableId tableid);
        void AddTable(TableDef const *tabledef);

        /** Add a set of records from a table to the scannable list */
        void AddRecordSet(TableId tableid, std::vector< RecordId > const &records, bool allow_sort);
        /** Add a set of records from a table to the scannable list */
        void AddRecordSet(TableId tableid, std::set< RecordId > const &records, bool allow_sort);

        void AddBooleanSearch(uint32_t tableindex, ColumnId column, bool value)
        { search.AddBooleanSearch(tableindex, column, value); }
        void AddIntegerSearch(uint32_t tableindex, ColumnId column, int32_t value, SearchRelationType howtosearch)
        { search.AddIntegerSearch(tableindex, column, value, howtosearch); }
        void AddRawSearch(uint32_t tableindex, ColumnId column, uint32_t valuelen, const uint8_t *value, SearchRelationType howtosearch, bool casesensitive)
        { search.AddRawSearch(tableindex, column, valuelen, value, howtosearch, casesensitive); }
        void AddStringSearch(uint32_t tableindex, ColumnId column, uint32_t valuelen, const char *value, SearchRelationType howtosearch, bool casesensitive)
        { search.AddStringSearch(tableindex, column, valuelen, value, howtosearch, casesensitive); }
        void AddStringSearch(uint32_t tableindex, ColumnId column, std::string const &str, SearchRelationType howtosearch, bool casesensitive)
        { search.AddStringSearch(tableindex, column, str, howtosearch, casesensitive); }
        void AddJoin(uint32_t tableindex1, ColumnId column1,  bool allrecords_table1,
                              uint32_t tableindex2, ColumnId column2,  bool allrecords_table2,
                              SearchRelationType howtosearch, bool casesensitive)
        { search.AddJoin(tableindex1, column1, allrecords_table1, tableindex2, column2, allrecords_table2,howtosearch, casesensitive); }
        void AddIntegerInSearch(uint32_t tableindex, ColumnId column, Blex::PodVector< int32_t > const &values)
        { search.AddIntegerInSearch(tableindex, column, values); }

        TableDef const * GetTable(unsigned tableindex);
        unsigned GetTableCount();

        void SetLimit(unsigned new_limit);

        /** Returns if a row is currently active */
        bool RowActive();

        /** Moves the iterator to the next row.
            @return True if a row was found, false if not. If this function
                    returned false, it shouldn't be called anymore*/
        bool NextRow();

        /** Get the number of rows left. Moves the scan to the end of the range.
            Might allow some simple optimziations in cases where we only want
            the scan counter? */
        unsigned CountRows();

        /** Returns a part of the current row; does not return internal fields!!
            @param tablenr Nr of table the record must come from
            @return Record of current row, from designated table. NULL record if no row is active. */
        Record GetRowPart(unsigned tablenr);
        RecordId GetRowPartRecordId(unsigned tablenr);
        std::string GetRowPartCellDump(unsigned tablenr, ColumnId colid);

        /// Checks whether the active record still exists in the current committed state (chase until deleter isn't committed)
        bool CanChaseToNowCommitted();

        /** Returns whether cache is full */
        inline bool IsCacheFull() { return (cache_fill + 1) * table_count > CacheSize; }

        /** Adds the current active row to the cache. Throws if no row is active, or cache was full */
        void AddActiveRowToCache();

        /** Returns a part of a row in the rowcache
            @param row Nr of row where the part resides that must be returned
            @param tablenr Nr of table the record must come from
            @return Record the cached row, from designated table. NULL if invalid arguments. */
        Record GetCachedRowPart(unsigned row, unsigned tablenr);
        RecordId GetCachedRowPartRecordId(unsigned row, unsigned tablenr);

        /** Returns a cell in a part of a row in the rowcache
            @param row Nr of row where the part resides that must be returned
            @param tablenr Nr of table the record must come from
            @param columndef Definition of column to retrieve
            @return Record the cached row, from designated table. NULL if invalid arguments. */
        Cell GetCachedRowPartCell(unsigned row, unsigned tablenr, ColumnDef const &columndef, CellStore &store);

        /** Returns number of rows in the cache */
        inline unsigned GetCacheFill() { return cache_fill; }

        /** Locks first record in a row, only for locks that can be retried by signalling the connections.
            Returns immediately on failure (even when wait might help)
            @param row Row to lock
            @return Result of lock */
        LockResult::_type LockCachedRow(unsigned row)
        { return LockCachedRowInternal(row, true); }

        // Locks first record in a row. Autowaits, throws on 10 second wait.
        LockResult::_type LockCachedRowWithAutoWait(unsigned row/*, bool no_access_checks*/);

        // Unlocks first record in the current row
        void UnlockCachedRow(unsigned row);

        // Deletes first record in the current row
        void DeleteLockedRow(unsigned row/*, bool no_access_checks*/, bool report_delete);

        // Updates first record in the current row
        void UpdateLockedRow(unsigned row, Record const &updates/*, bool no_access_checks*/);

        /** Clears the row-cache */
        void ClearCache();

        /** Releases all resources */
        void Close();

        Search const & GetSearch() const { return search; }

        inline bool CanUpdate() { return for_update; }

        std::string DumpPlan();

        void CheckAbortFlag() const;

        bool have_delete_privilege;
        bool have_global_update_privilege;

        //ADDME: Can we reduce the # of friends? (eg by moving the Scanner accessors into a protected: section of SourceBase)
        friend class SourceBase;
        friend class IndexQuery;
        friend class RecordList;
        friend class RecordMapper;
        friend class IndexJoiner;
        friend class BlockJoiner;
        friend class VirtualTableSource;
};

/** Base class for a scanner row source
    Only one row is retrieved per call (the active_row in the scanner reflects
    that row) */
class SourceBase
{
    public:
        /// Constructor
        SourceBase(Scanner &_scanner, DBScanner::SearchItemIds const *_filter_items)
        :scanner(_scanner)
        ,filter_items(_filter_items)
        {}

        /// Virtual destructor for polymorphisms
        virtual ~SourceBase();

        /// DBScanner this source belongs to
        Scanner &scanner;

        /** Return the first block
            @return Whether a block was returned. False return indicates end of resultset */
        virtual bool FirstBlock() = 0;

        /** Returns the the next block.
            This function should not be called without a succesful NextBlock() call
            @return Whether a block was returned. False return indicates end of resultset */
        virtual bool NextBlock() = 0;

        /** Returns the first row  */
        virtual bool FirstRowInBlock() = 0;

        /** Returns or the next row. (scanner.active_row is updated)
            This function should not be called without a succesful NextBlock() call
            @return Whether a row was returned. No return indicates end of current block */
        virtual bool NextRowInBlock() = 0;

        protected:
        ///Check the currently stored filter_items against the currently selected records
        bool IsMatch();

        /// Filtering items that must be applied on rowparts produced by this source
        DBScanner::SearchItemIds const * const filter_items;
};

class VirtualTableSource : public SourceBase
{
public:
        VirtualTableSource(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, TableDef const *tabledef, unsigned tablenr);

        virtual bool FirstBlock();
        virtual bool NextBlock();
        virtual bool FirstRowInBlock();
        virtual bool NextRowInBlock();

        /** Check the conditions relevant to a range of column-ids a record. FIXME: checks only single-column items, not 2-column relations.
            @param record Record to check
            @param range_start First column that has been defined
            @param range_size Number of columns that have been defined, in numerical succession to range_start
                        (for example, start 3 and size 5 means columnids 3, 4, 5, 6 and 7 are defined
            @return Returns whether the defined columns adhere to all the search items relevant to them (also true if there are no such items).*/
        bool IsLimitedMatch(Record const &record, ColumnId range_start, unsigned range_size) const;

private:
        /// Table definition
        TableDef const &tabledef;
        /// Nr of this table within total query
        unsigned tablenr;
        /// Current record for this table source
        WritableRecord currec;
        /// Virtual table iterator, if allocated
        std::unique_ptr<VirtualTableRecordItr> virt_iterator;
};

void DumpCurrentRow(Scanner &scanner);

} //end namespace database

#endif
