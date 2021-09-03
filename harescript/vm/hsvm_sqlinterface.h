#ifndef blex_webhare_harescriptvm_hsvm_sqlinterface
#define blex_webhare_harescriptvm_hsvm_sqlinterface

#include <harescript/vm/hsvm_constants.h>
#include "hsvm_stackmachine.h"

namespace HareScript
{
namespace SQLLib
{

struct DBDescription
{
        bool supports_block_cursors;
        bool supports_single;
        bool supports_data_modify;
        bool supports_nulls;
        bool supports_limit;
        bool needs_locking_and_recheck;
        bool needs_uppercase_names;
        bool add_missing_default_columns;
        unsigned max_joined_tables;             ///< Maximum number of joined tables per query (0 for no limit)
        unsigned max_multiinsertrows;           ///< Maximum number of rows in a multinsert (0 for no limit)
};

namespace Fases
{
enum _type
{
        None =          0x00,
        Fase1 =         0x01,
        Fase2 =         0x02,
        Recheck =       0x04,
        Updated =       0x08, ///< Updated
        __Scratch1 =    0x10, ///< For sqllib usage only, must be ignored by db driver
};
inline Fases::_type operator |(Fases::_type lhs, Fases::_type rhs) { return (Fases::_type)((unsigned)lhs | (unsigned)rhs); }
inline Fases::_type operator |=(Fases::_type &lhs, Fases::_type rhs) { return (Fases::_type)(lhs = lhs | rhs); }

} // End of namespace Fases

struct TableSource
{
        TableSource(const std::string &_name, DBTypeInfo const *_tabletypeinfo);
        void SetFrom(const std::string &_name, DBTypeInfo const &_typeinfo);

        ///Name of this table, as passed to BINDTABLE (record arrays '(RECORDARRAY)')
        std::string name;

        ///Description of the table, never NULL
        DBTypeInfo const * typeinfo;

        /// Number of columns
        inline unsigned columncount() const { return columns.size(); }

        /// Info per column for database provider to use
        struct ColumnInfo
        {
                /// Fase in which the column must be retrieved; initally set by SQLLib; may be modified
                Fases::_type fase;

                /// Null default (0 if no null default available). Usable until query is freed in SQLLib.
                VarId nulldefault;

                inline ColumnInfo() : fase(Fases::None), nulldefault(0) {}
        };

        // Info per column in typeinfo (columncount == columns.size() == typeinfo->columnsdef.size())
        std::vector< ColumnInfo > columns;

        inline DBTypeInfo::Column const & ColType(int idx) { return typeinfo->columnsdef[idx]; }
};

struct SingleCondition
{
        /// Indicated whether a DB handles this condition
        bool handled;

        /// Index within table list
        unsigned table;

        /// Column in the table condition refers to (definition at query.tables[table].typeinfo.columnsdef[column])
        unsigned column;

        /// NameId for the column
        ColumnNameId columnid;

        /// Kind of relation that must exist between the column and the value
        DBConditionCode::_type condition;

        /// Value the column must have a relation to (not valid after opening of cursor!)
        VarId value;

        /// Flag indicating wether the compare must be casesensitive
        bool casesensitive;

        /// Flag indicating whether a NULL value matches
        bool match_null;
};

struct JoinCondition
{
        /// Indicated whether a DB handles this join
        bool handled;

        /// Index within table list of table where the first column comes from
        unsigned table1;

        /// First column (definition at query.tables[table1].typeinfo.columnsdef[column1])
        unsigned column1;

        /// NameId for the first column
        ColumnNameId columnid1;

        /// Index within table list of table where the first column comes from
        unsigned table2;

        /// Second column (definition at query.tables[table1].typeinfo.columnsdef[column1])
        unsigned column2;

        /// NameId for the second column
        ColumnNameId columnid2;

        /// Kind of relation that must exist between the two columns
        DBConditionCode::_type condition;

        /// Flag indicating wether the compare must be casesensitive
        bool casesensitive;

        /// Flag indicating whether two NULL values must match
        bool match_double_null;
};

/// Description of a (possibly multi-table) query.
struct DatabaseQuery
{
        ///Selected tables
        typedef std::vector<TableSource> TableSources;

        /** Limit to how much results can be returned by the query, <0 for no limit. Only
            valid for SELECT statements; and when the DB provider handles ALL conditions
            (single AND joins) itself. */
        signed limit;

        /** Maximum number of rows to return in a RetrieveNextBlock */
        unsigned maxblockrows;

        /** List of tables in this query. Tables can occur multiple times in this list. When
            a tableid is mentioned in this query, the table tablenames[tableid] is used.
            The index in this vector is used to identify the table. */
        TableSources tables;

        /** List of conditions on a single column (that must have a certain relation to a constant value) (A.x OP y) */
        std::vector<SingleCondition> singleconditions;

        /** List of join conditions (two columns having a certain relation to each other (A.x OP B.y) . */
        std::vector<JoinCondition> joinconditions;

//        TypeInfo const *update_columns;

        DatabaseQuery() : limit(-1), maxblockrows(0) {}
};

enum class LockResult
{
        Unchanged,
        Changed,
        Removed
};

/** Base class for a transaction interface.

    Every transaction used in the VM must have one of these to provide
    the interface to the SQL library. */
struct BLEXLIB_PUBLIC DatabaseTransactionDriverInterface
{
        /// Virtual machine where this transaction functions in
        VirtualMachine *vm;

        /// SQLLib registered transaction id
        int32_t sqllib_transid;

        typedef unsigned CursorId; // May NOT have a value of 0!!!
        enum CursorType
        {
                Select = 0,
                Delete = 1,
                Update = 2
        };

        DatabaseTransactionDriverInterface(VirtualMachine *vm);
        virtual ~DatabaseTransactionDriverInterface();

        /// Description of this DB. MUST BE FILLED!!!
        DBDescription description;

        /** Inserts a record into the table specified in the query. Record with values may not be altered.
            @param query Query containing 1 table
            @param newrecord Record with values for new record; for all columns that have ColumnFlag::Updated in their
                typeinfo flags. Missing column indicates NULL. */
        virtual void ExecuteInsert(DatabaseQuery const &query, VarId newrecord) = 0;

        /** Inserts an array of records into the table specified in the query. Record with values may not be altered.
            @param query Query containing a table per record
            @param newrecordarray Array with records with values for new record; for all columns that have ColumnFlag::Updated in their
                typeinfo flags. Missing column indicates NULL. */
        virtual void ExecuteInserts(DatabaseQuery const &query, VarId newrecordarray);

        /** Opens a cursor for a query. This query MUST be closed by calling CloseCursor after completion of the query
            @param vm Virtual machine in which query is executed
            @param query Structure containing the query definition. The definition must be updated to show which conditions/joins
                are handled, and which are not. The structure is alive during the lifetime of the query.
            @param cursortype Needed type of cursor (for SELECT, UPDATE or DELETE)
            @return Id identifying this query (for use in cursor functions). Is 0 if opening failed, and an empty resultset should be given back. */
        virtual CursorId OpenCursor(DatabaseQuery &query, CursorType cursortype) = 0;

        /** Retrieves the next block with rows (returning fase 1 records is required, adding fase 2 records is optional)
            @param id Id identifying query
            @param recarr Array in which the records must be stored. Missing columns indicate NULL. The called function MUST initialize it, it might be uninitialized.
            @param max_count Maximum number of rows to retrieve
            @return Number of rows stored in recarr. 0 to signal end of query */
        virtual unsigned RetrieveNextBlock(CursorId id, VarId recarr) = 0;

        /** Retrieves fase 2 records for the specified rows. Works on last block retrieved by RetrieveNextBlock. Multiple calls to this
            function (for different rows) must be allowed.
            @param id Id identifying query
            @param recarr Array in which the records must be stored. Missing columns indicate NULL.
            @param rowlist List of rows for which the fase 2 records must be retrieved
            @param is_last_fase2_req_for_block If true, no more fase 2 requests will be done for this block */
        virtual void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< unsigned > const &rowlist, bool is_last_fase2_req_for_block) = 0;

        /** Locks the specified row within the current block for update or delete. Only called when
            'needs_locking_and_recheck' is true in the description member. The values of
            the results pointed to by the cursor may change after calling this function, but must still
            adhere to all conditions marked 'handled'! Only allowed for single-table queries.
            @param id Id identifying query
            @param recarr Array in which the records are currently stored. Missing columns indicate NULL.
            @param row Row that must be locked
            @return Result for the lock */
        virtual LockResult LockRow(CursorId id, VarId recarr, unsigned row) = 0;

        /** Unlocks a row with the current block.
            @param id Id identifying query
            @param row Row that must be locked */
        virtual void UnlockRow(CursorId id, unsigned row) = 0;

        /** Deletes the record pointed to by the current cursor. Only allowed for single-table queries.
            @param id Id identifying query
            @param row Row that must be deleted */
        virtual void DeleteRecord(CursorId id, unsigned row) = 0;

        /** Overwrites the record pointed to by the current cursor by an other record. Existing values
            will stay unchanged.
            @param id Id identifying query
            @param row Row that must be updated
            @param newfields VarId identifying record with new values */
        virtual void UpdateRecord(CursorId id, unsigned row, VarId newfields) = 0;

        /** Closes the query.
            @param id Id identifying query */
        virtual void CloseCursor(CursorId id) = 0;

        /** Keepalive for the transaction. Override when needed.
        */
        virtual bool KeepAlive();
};

struct TableColumn
{
        // Nr of the table (within the query)
        unsigned tablenr;

        std::string columnname;

        ColumnNameId columnid;

        bool operator < (TableColumn const &) const;
};

typedef std::map<TableColumn,VariableTypes::Type> TCTypeMap;

namespace ColumnListTypes
{
enum Type
{
NoFaseDestinction,              // Fill all into fase1 (doesn't check handled conditions)
Fase1And2,                      // Fill fase1 and fase2 (doesn't check handled conditions)
Fase1And2AndRecheck             // Fill fase1, lockrecheck, fase2
};
} // End of namespace ColumnListTypes

//------------------------------------------------------------------------------
//
// Helper functions
//

/** Evaluates a single condition. Stackmachine will not be modified.
    @param stackm Stack Machine
    @param cond Condition to check
    @param rec Record containing record in which the columns that will be checked exist
    @return Returns wether the single condition has been satisfied */
bool SatisfiesSingle(StackMachine const &stackm, SingleCondition const &cond, VarId rec);

/** Evaluates a join condition
    @param stackm Stack Machine
    @param cond Condition to check
    @param recleft Record containing record in which the columns in the left side of the join exist.
    @param recright Record containing record in which the columns in the right side of the join exist.
    @return Returns wether the join condition has been satisfied */
bool SatisfiesJoin(StackMachine const &stackm, JoinCondition const &cond, VarId recleft, VarId recright);



/** Puts all expensive NULL translation stuff in query (fills VarId's etc.) */
void InitNullHandling(VirtualMachine *vm, DatabaseQuery &query);

/** Frees all NULL defaults in VarMemory variables */
void FreeNullDefaults(StackMachine &stackm, DatabaseQuery &query);

/** Returns whether a column translates to a NULL value
    @param stackm Stack machine
    @param ts TableSource for the table
    @param idx Column nr of the column
    @param value Value to check
    @return Returns whether the value equals to the NULL value and NULL translation is on for that column*/
bool EqualsToNullDefault(StackMachine &stackm, TableSource &ts, unsigned idx, VarId value);

/** Fills a variable with the NULL default for a specific column
    @param stackm Stack machine
    @param ts TableSource for the table
    @param idx Column nr of the column
    @param value Variable to fill with the default */
void FillWithNullDefault(StackMachine &stackm, TableSource &ts, unsigned idx, VarId value);

/** Deletes all cells that are equal to their NULL default (and have the flage ColumnFlags::Update)
    @param stackm Stack machine
    @param ts TableSource for the table
    @param rec Record to delete NULL columns from */
void DeleteNullDefaults(StackMachine &stackm, TableSource &ts, VarId rec);

/** Fills all missing cells for this fase with their NULL default
    @param stackm Stack machine
    @param ts TableSource for the table
    @param rec Record to delete NULL columns from
    @param fases Fases to correct this record for */
void FillWithNullDefaults(StackMachine &stackm, TableSource &ts, VarId rec, Fases::_type fases);

/** Adds missing cells for an insert
    @param stackm Stack machine
    @param ts TableSource for the table
    @param rec Record to add non-NULL column values to */
void AddMissingDefaultColumns(StackMachine &stackm, TableSource &ts, VarId rec);

} // End of namespace SQLLib
} // End of namespace HareScript

#endif
