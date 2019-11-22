#ifndef blex_webhare_dbase_resultsets
#define blex_webhare_dbase_resultsets

#include "../libwebhare/dbase.h"
#include "dbase_backend.h"

namespace Database
{

/** Describes the type of a column */
struct ColumnInfo
{
        inline ColumnInfo(std::string const &_name, ColumnTypes _type, unsigned _fase)
        : name(_name), type(_type), fase(_fase) {}

        /// Name of the column
        std::string name;

        /// Type of the column
        ColumnTypes type;

        /// Fase in which the column is returned. FIXME: unsigned? What ARE you thinking?
        unsigned fase;
};

typedef std::vector< ColumnInfo > ColumnInfos;

/** A NeededColumn describes a column that is requested by a client for a scan.
    Used by the ScannerResultSet resultset scanner */
struct NeededColumn
{
        /// Index of table of needed column
        uint32_t tableindex;

        /// Definition of needed column. NULL if selecting recordid
        ColumnDef const *columnselected;

        DBRecordSendType fases;
};

/** A Query contains the scanner for a ScannerResultSet. It also describes the
    requested query, the requested columns and maximum number of results to return */
struct ScannerQuery
{
        ScannerQuery(BackendTransaction &trans, bool for_update)
        : scanner(trans, ShowNormal, for_update)
        {
        }

        Scanner scanner;

        /// List of columns that need to be sent back (ordered by fase)
        std::vector< NeededColumn > columns;

        std::vector< bool > has_table_select_right;

        /// Maximum number of rows to send back
        unsigned max_returned_rows;

        bool HasFase2Data();
};

// Callback function to check validity of blobs
typedef std::function< void(BlobId) > BlobCheckCallback;

/** Base class for result sets interfacce. Interface is used by the
    rpcserver to send out the results

    The interface is block based, to allow the scanner interface to be accessed
    cleanly. */
class ResultSetBase
{
    public:
        /** Context in which passed blobs must be registered
        */
        ResultSetBase(void *blobcontext);

        /// Returns blob context
        inline void * GetBlobContext() { return blobcontext; }

        /** Destructor. Normal cleanup should be done in the Close() function, use
            the destructor only for emergency cleanup (exceptions and such)
        */
        virtual ~ResultSetBase();

        /** Structure describing the capabilities for this resultset */
        struct Description
        {
                /// Result will return results for fase2
                bool has_fase2_data;

                /// Resultset can and may be updated
                bool can_update;

                /// Maximum number of rows returned per block
                unsigned max_rows_per_block;
        };

        /// Returns description of this query
        inline Description const & GetDescription()
        {
                if (!description_generated)
                {
                        GenerateDescription(&description);
                        description_generated = true;
                }
                return description;
        }

        /** Fills a columninfo structure with info about the data types in the query
            @param info Info structure to be filled */
        virtual void FillTypeInfo(ColumnInfos *info) = 0;

        /** Clears current block, and tries to add one row to it.
            @return Returns true if the current (new) block contains a row. If not, set has ended. */
        virtual bool NextBlock() = 0;

        /** Try to add a row to the current block (not mandatory implemented)
            Returns number of added row (current number of rows in block - 1) */
        virtual unsigned TryAddRowToBlock() = 0;

        /** Return current number of rows in the block */
        virtual unsigned CurrentRowCount() = 0;

        /// Returns wether new rows are available (and thus whether a call to NextBlock will succeed!)
        virtual bool AreRowsAvailable() = 0;

        /** Sends a row to a cellsender object
            Must first report cell count to cell sender, and then send all cells which conform to sendtype
            @param row Number of row to send, must be checked by
            @param sendtype Type of row to send
            @param sender Cellsender */
        virtual void SendRow(unsigned row, DBRecordSendType sendtype, CellSender &sender) = 0;

        /** Locks a row
            @param row Row to lock, no need to check for out-of-range
            @return Lock result for row */
        virtual DBLockResult LockRow(unsigned row) = 0;

        /** Updates a row. Checking for being locked has to be done by resultset itself
            @param row Updated row, no need to check for out-of-range
            @param record Record with updated cells, cellid is number of cell within resultset
            @param blobcheckcallback Callback function which checks the validity of blobs. If false is returned, the blobs may not be used for this resultset */
        virtual void UpdateRow(unsigned row, WritableRecord &record, BlobCheckCallback const &blobcheckcallback) = 0;

        /** Deletes a row. Checking for being locked has to be done by resultset itself
            @param row Updated row, no need to check for out-of-range */
        virtual void DeleteRow(unsigned row) = 0;

        /** Unlocks a row. Checking for being locked has to be done by resultset itself
            @param row Updated row, no need to check for out-of-range */
        virtual void UnlockRow(unsigned row) = 0;

        /** Closes the resultset (must release all resources). Is called before
            the destructor, but it may be skipped when exceptions have been thrown
        */
        virtual void Close(); //nothrow

    protected:
        /// Returns the description for this resultset
        virtual void GenerateDescription(Description *description) = 0;

    private:
        /// Context in which sent blobs must be registered
        void *blobcontext;



        /// Indicates whether description has been generated
        bool description_generated;

        /// Description (filled when description_generated == true)
        Description description;
};

/** Interface for a StaticResultset; deriving from this removes the burden to
    define the function calls that change the resultset */
class StaticResultSet: public ResultSetBase
{
    public:
        explicit inline StaticResultSet(void *blobcontext) : ResultSetBase(blobcontext) {}

        /// Row locking, throws an error
        virtual DBLockResult LockRow(unsigned row);
        /// No-op (row should have been locked first, which would throw)
        virtual void UpdateRow(unsigned row, WritableRecord &record, BlobCheckCallback const &blobcheckcallback);
        /// No-op (row should have been locked first, which would throw)
        virtual void DeleteRow(unsigned row);
        /// No-op (row should have been locked first, which would throw)
        virtual void UnlockRow(unsigned row);
};

/** Define a temporary storage result set. Used for SQL feedback */
class TempResultSet : public StaticResultSet
{
    public:
        explicit TempResultSet(void *blobcontext);
        ~TempResultSet();
        void AddColumn(std::string const &name, ColumnTypes type);
        void AddRecord(Record const &newrecord);

    private:
        void FillTypeInfo(ColumnInfos *info);
        bool NextBlock();
        unsigned TryAddRowToBlock();
        unsigned CurrentRowCount();
        bool AreRowsAvailable();
        void SendRow(unsigned row, DBRecordSendType sendtype, CellSender &sender);
        void GenerateDescription(Description *description);

        ColumnInfos info;
        std::deque<WritableRecord> records;
        unsigned block_start, block_length;
};

/** The ScannerResultSet is the resultset interface for scans on the database */
class ScannerResultSet : public ResultSetBase
{
    public:
        ScannerResultSet(BackendTransaction &trans, bool for_update, void *blobcontext);

        /// Query object that contains the query data and the scanner
        ScannerQuery query;

        virtual void GenerateDescription(Description *description);
//        virtual Description const & GetDescription();

        virtual void FillTypeInfo(ColumnInfos *info);

        // Opens next block, adds 1 row into block (returns false if done)
        virtual bool NextBlock();

        // Adds new row to block (returns nr, 0 if no row added)
        virtual unsigned TryAddRowToBlock();

        // Returns wether new rows are available (and thus whether a call to NextBlock will succeed!)
        virtual bool AreRowsAvailable();

        virtual unsigned CurrentRowCount();

        virtual void SendRow(unsigned row, DBRecordSendType sendtype, CellSender &sender);

        virtual DBLockResult LockRow(unsigned row);

        virtual void UpdateRow(unsigned row, WritableRecord &record, BlobCheckCallback const &blobcheckcallback);

        virtual void UnlockRow(unsigned row);

        virtual void DeleteRow(unsigned row);
};

/** This object contains the resultset interface for notification-sets

    Thread-safety problems:
      Multiple NotificationsResultSets can be used simultaneously to access
      the same transaction, it serializes all access to all references to
      that transaction */
struct NotificationsResultSet : public StaticResultSet
{
        /// Scanned transaction. Must be locked at every use!
        BackendTransaction &trans;

        /// Modifications for this table
        TableMods const &tablemods;

        /// Scanner used to walk through the recordset. Transaction must be locked when used!
        Scanner scanner;

        /// Current number of rows in the cache
        unsigned rows_in_cache;

        std::vector< Actions > actions;
        std::vector< ColumnDef const * > columns;

        unsigned pos;

    public:
        NotificationsResultSet(BackendTransaction &trans, TableId tableid, TableMods const &tablemods, std::vector< ColumnDef const * > const &_columns, void *blobcontext);
        ~NotificationsResultSet();

        virtual void GenerateDescription(Description *description);
//        virtual Description const & GetDescription();

        virtual void FillTypeInfo(ColumnInfos *info);

        // Opens next block, adds 1 row into block (returns false if done)
        virtual bool NextBlock();

        // Adds new row to block (returns nr, 0 if no row added)
        virtual unsigned TryAddRowToBlock();

        // Returns wether new rows are available (and thus whether a call to NextBlock will succeed!)
        virtual bool AreRowsAvailable();

        virtual unsigned CurrentRowCount();

        virtual void SendRow(unsigned row, DBRecordSendType sendtype, CellSender &sender);

        virtual void Close(); //nothrow
};



} //end namespace Database

#endif
