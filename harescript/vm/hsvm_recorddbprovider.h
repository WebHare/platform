#ifndef blex_webhare_harescriptvm_hsvm_recorddbprovider
#define blex_webhare_harescriptvm_hsvm_recorddbprovider
//---------------------------------------------------------------------------
#include "hsvm_sqlinterface.h"
#include "hsvm_idmapstorage.h"

#include "hsvm_context.h"

namespace HareScript
{
namespace SQLLib
{
namespace RecordDB
{

struct SQLQueryData
{
        // Type of cursor
        DatabaseTransactionDriverInterface::CursorType cursortype;

        signed results_start;
        signed results_end;

        // Index of start of current block
        signed block_start;

        // Index of end of current block
        signed block_end;

        // Record array with current table contents (is an updateable copy only in non-select queries)
        VarId current_table;

        // Record array with the table itself
        VarId table;

        // Maximum size of returned blocks
        unsigned max_block_size;
};

/** Interface for a transaction with only record arrays internally.

    Not multithreading enabled: serialize all accesses! */
class RecordDBTransactionDriver : public DatabaseTransactionDriverInterface
{
    private:
        typedef IdMapStorage<SQLQueryData> QueryStorage;
        QueryStorage queries;

        struct TableData
        {
                VarId recarr;
                bool frozen;

                ColumnNameId sort_column;
                bool sort_casesensitive;

                inline TableData() : recarr(0), frozen(false), sort_column(0), sort_casesensitive(true) {}
        };

        typedef std::map<std::string, TableData> TableStorage;
        TableStorage tables;

        TableData & FindTable(std::string name);

        // Check typeinfo for presence of column renames, throws if found
        void CheckTypeInfo(DBTypeInfo const *typeinfo);

    public:
        /** Creates the transaction driver
            @param vm Virtual machine that owns this session */
        RecordDBTransactionDriver(VirtualMachine *vm);

        /** Destroys this transaction driver */
        ~RecordDBTransactionDriver();

        /** Inserts a record into the table specified in the query. Record with values may not be altered.
            @param query Query containing 1 table
            @param newrecord Record with values for new record */
        void ExecuteInsert(DatabaseQuery const &query, VarId newrecord);

        /** Opens a cursor for a query. This query MUST be closed by calling CloseCursor after completion of the query
            @param vm Virtual machine in which query is executed
            @param query Structure containing the query definition. The definition must be updated to show which conditions/joins
                are handled, and which are not. The structure is alive during the lifetime of the query.
            @param cursortype Needed type of cursor (for SELECT, UPDATE or DELETE)
            @return Id identifying this query (for use in cursor functions) */
        CursorId OpenCursor(DatabaseQuery &query, CursorType cursortype);

        /** Retrieves the next block with rows (returning fase 1 records is required, adding fase 2 records is optional)
            @param id Id identifying query
            @param recarr Array in which the records must be stored
            @param max_count Maximum number of rows to retrieve
            @return Number of rows stored in recarr. 0 to signal end of query */
        unsigned RetrieveNextBlock(CursorId id, VarId recarr);

        /** Retrieves fase 2 records for the specified rows. Works on last block retrieved by RetrieveNextBlock. Multiple calls to this
            function (for different rows) must be allowed.
            @param id Id identifying query
            @param recarr Array in which the records must be stored
            @param rowlist List of rows for which the fase 2 records must be retrieved
            @param is_last_fase2_req_for_block If true, no more fase 2 requests will be done for this block */
        void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< Fase2RetrieveRow > &rowlist, bool is_last_fase2_req_for_block);

        /** Locks the specified row within the current block for update or delete. Only called when
            'needs_locking_and_recheck' is true in the description member. The values of
            the results pointed to by the cursor may change after calling this function, but must still
            adhere to all conditions marked 'handled'! Only allowed for single-table queries.
            @param id Id identifying query
            @param recarr Array in which the records are currently stored
            @param row Row that must be locked
            @return Result for the lock */
        LockResult LockRow(CursorId id, VarId recarr, unsigned row);

        /** Unlocks a row with the current block.
            @param id Id identifying query
            @param row Row that must be locked */
        void UnlockRow(CursorId id, unsigned row);

        /** Deletes the record pointed to by the current cursor. Only allowed for single-table queries.
            @param id Id identifying query
            @param row Row that must be deleted */
        void DeleteRecord(CursorId id, unsigned row);

        /** Overwrites the record pointed to by the current cursor by an other record. Existing values
            will stay unchanged. The table will not be resorted if the sorted element is changed.
            @param id Id identifying query
            @param row Row that must be updated
            @param newfields VarId identifying record with new values */
        void UpdateRecord(CursorId id, unsigned row, VarId newfields);

        /** Closes the query.
            @param id Id identifying query */
        void CloseCursor(CursorId id);

        void CreateTable(std::string const &name);
        void SetTableSortOrder(std::string const &_name, std::string const &column, bool casesensitive);
        void FreezeTable(std::string const &name);
};

void Register(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg);

} // End of namespace RecordDB
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
