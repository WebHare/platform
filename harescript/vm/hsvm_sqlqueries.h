#ifndef blex_harescript_vm_hsvm_sqlqueries
#define blex_harescript_vm_hsvm_sqlqueries
//---------------------------------------------------------------------------

#include <blex/context.h>

#include "hsvm_sqlinterface.h"
#include "hsvm_sqllib.h"

namespace HareScript
{
namespace SQLLib
{

struct QueryDefinition
{
        signed limit;
        bool has_fase1_hscode;
        bool limit_blocksize;

        struct Source : public TableSource
        {
                Source() :  TableSource("", 0) {}

                Source(const std::string &_tablename, DBTypeInfo const &_tabletypeinfo)
                : TableSource(_tablename, &_tabletypeinfo)
                , recarr(0)
                , trans(0)
                {
                }

                void SetFrom(const std::string &_name, DBTypeInfo const &_typeinfo, SQLLib::DatabaseTransactionDriverInterface *_trans, VarId _recarr)
                {
                        TableSource::SetFrom(_name, _typeinfo);
                        partition_id = 0;
                        recarr = _recarr;
                        trans = _trans;
                }

                // Id of the partition in which this source resides
                unsigned partition_id;

                // Record array with source data (0: N/A)
                VarId recarr;

                // Transaction
                SQLLib::DatabaseTransactionDriverInterface *trans;
        };

        /// List of sources
        std::vector<Source> sources;

        /// List of single conditions
        std::vector<SingleCondition> singleconditions;

        /** List of join conditions (two columns having a certain relation to each other (A.x OP B.y) . */
        std::vector<JoinCondition> joinconditions;

        void Clear()
        {
                limit = -1;
                has_fase1_hscode = true;
                limit_blocksize = false;
                sources.clear();
                singleconditions.clear();
                joinconditions.clear();
        }
};

/** A remaining join condition is a join condition that is used between
    multiple subqueries. It is used by OpenQuery::AdvanceWhileInvalid. */
struct RemainingJoinCondition : public JoinCondition
{
        // Table 1 subquery id, table no within subquery
        unsigned sq_no1;
        unsigned sq_table_no1;

        // Table 2 subquery id, table no within subquery
        unsigned sq_no2;
        unsigned sq_table_no2;

        // Lowest and highest subquery numbers (min(sq_no1, sq_no2), max(sq_no1, sq_no2))
        unsigned sq_min;
        unsigned sq_max;

        RemainingJoinCondition() {};
        RemainingJoinCondition(JoinCondition const &jc) : JoinCondition(jc) {};
};

struct OpenQuery;

struct IntegerInPart
{
        unsigned single_id;
        unsigned subs; // is (ints.size() / 1000)
        std::vector< int32_t > ints;
};

struct SubQuery
{
        /** Constructs a subquery
            @param query OpenQuery this is a subquery of
            @param var Variable that can be used to store the local resultset (never 0!)
            @param _trans Optional transaction to use */
        SubQuery(OpenQuery &query, VarId var, DatabaseTransactionDriverInterface *_trans, unsigned _partition_id)
        : mainquery(&query)
        , rec_array(var)
        , block_pos(0)
        , block_length(0)
        , trans(_trans)
        , cursorid(0)
        , partition_id(_partition_id)
        , first_block(0)
        {}

    private:
        // Query this subquery belongs to
        OpenQuery * mainquery;

        // This needs to be public, because OpenQuery needs to manipulate it directly
    public:
        // Query definition for this subquery
        DatabaseQuery querydef;

    private:
        // Record array with current block of results
        VarId rec_array;

        // Marks for every row whether fase2 promotion has taken place
        Blex::SemiStaticPodVector< bool, 16 > row_is_fase_2;

        // Stores the lockresult for every fase2 row
        Blex::SemiStaticPodVector< LockResult, 16 > fase_2_lockresult;

        // Array indicating whether record array elements are deleted
        Blex::SemiStaticPodVector< bool, 16 > is_deleted;

        // Current position in the block with results. May be changed by user, but be sure to call AdvanceWhileInvalid!
        unsigned block_pos;

        // Size of the block with results
        unsigned block_length;

        // In case of a db-query
        // DB transaction where results come from. If 0, rec_array is the main source.
        DatabaseTransactionDriverInterface *trans;
        DatabaseTransactionDriverInterface::CursorId cursorid;
        unsigned max_block_size;

        // Partition id
        unsigned partition_id;

        // Indicates whether query has just been opened
        bool just_opened;

        // Indicates first block
        bool first_block;

        std::list< IntegerInPart > inparts;

        unsigned inpartlimit;
        unsigned inpartquerynr;

        /** Advances the block_pos counter while the current row does not match the query definition. Does not retrieve
            next block.
            @return Whether a matching row has been found in the rest of the block */
        bool AdvanceWhileInvalid();

        void SetInPart(unsigned partid);

    public:
        /** Partition the in conditions */
        void PartitionInConditions();

        /** Resets and opens the subquery. */
        void Open();

        /** Retrieves next block of fase 1 records. This becomes the current block. After call to this function
            either the current row is valid, or there are no more results.
            @return Number of records retrieved, 0 means end of resultset reached. Do NOT count on block_length to be 0 in that case! */
        unsigned RetrieveNextBlock();

        /** Retrieves fase 2 rows in the current block
            @param subelements List of rows within current block for which fase2 records must be retrieved. Update the lockresult
              to Updated or Deleted when anything changes
            @param allow_direct_close If no more fase1 records are available, the query may be auto-closed after this call. */
        void RetrieveFase2Records(Blex::PodVector< Fase2RetrieveRow > &rows, bool allow_direct_close);

        /* Retrieves records from the current blockpos (fase of the returned record is determined by previous call to retrieveXXX)
           Returned record may not be written to */
        VarId GetRecord(unsigned tableid);

        /** Returns the current block position for a record array */
        unsigned GetRecordArrayPosition();

        /** Locks a row for deletion or update. Only one row may be locked at a time! Is only called when
            trans->description.needs_locking_and_recheck is true.
            @param row Row to lock
            @return Lock result (see DatabaseTransactionDriverInterface::LockResult for meaning) */
        LockResult LockRow();

        /** Unlocks a previously locked row (used when the locked row didn't match fase1)
            @param row Row to unlock */
        void UnlockRow();

        /** Deletes a specified row. If trans->description.needs_locking_and_recheck is true, LockRow must have
            been called. The row is unlocked by this call. May only be called for subqueries with 1 source.
            @param row Row to delete */
        void DeleteRow();

        /** Updates a specified row. If trans->description.needs_locking_and_recheck is true, LockRow must have
            been called. The row is unlocked by this call. May only be called for subqueries with 1 source.
            @param row Row to update
            @param newvalues Values to update the row with */
        void UpdateRow(VarId newvalues);

        /** Advances cursor to next matching row within current block.
            @return If another matching row was found in the current block */
        bool AdvanceCursorWithinBlock();

        // Closes the subquery
        void Close();

        /** Reads and caches the complete resultset into the record array. All fase 2 records are read in */
        void ReadAndCache();

        /// Returns current row
        unsigned inline GetCurrentRow() { return block_pos; }

        /// Sets current row
        void inline SetCurrentRow(unsigned row) { block_pos = row; }

        /** Check if current row is valid wrt single- and joinconditions
            @param fullcheck If true, also recheck conditions handled by the database driver
        */
        bool IsCurrentRowValid(bool fullcheck);

        /// Returns the transaction (0 if record array!)
        inline DatabaseTransactionDriverInterface * GetTransaction() { return trans; }

        VarId inline GetRecordArray() { return rec_array; }

        /// Returns whether this subquery is associated with a specific database transaction
        bool inline IsAssociatedWithTrans(DatabaseTransactionDriverInterface *_trans) { return _trans == trans; }

        /// Return the partition-id
        unsigned inline GetPartitionId() { return partition_id; }

        /// Return whether the first block is active
        unsigned inline IsFirstBlock() { return first_block; }

        /// Returns the record array as modified by updaterow/deleterows in id_set
        void GetResultArraySource(VarId id_set);
};

namespace QueryActions
{
enum _type
{
Fase1Action,
Fase2Action,
Terminate
};
} // End of namespace QueryActions


struct OpenQuery
{
        OpenQuery(VirtualMachine *_vm, DatabaseTransactionDriverInterface::CursorType _cursortype);
        ~OpenQuery();

    private:
        VirtualMachine *vm;

        // Type of query
        DatabaseTransactionDriverInterface::CursorType cursortype;

        // Subqueries
        std::vector<SubQuery> subqueries;

        // VarId's that must be killed when this query must be destroyed
        std::vector< VarId > values;

        // Inter-subquery joins
        std::vector<RemainingJoinCondition> remainingjoins;

        // Translation from table-nr to subquery/tablenr within subquery
        std::vector<std::pair<unsigned, unsigned> > table_to_sq_table;

        bool InitializeQuery();
        bool AdvanceWhileInvalid(unsigned modified_sq, bool stop_at_0_block_boundary);
        bool SatisfiesRemainingJoin(RemainingJoinCondition const &cond);
        bool AdvanceCursor(bool stopatblockboundary);
        void RetrieveFase2Records(Blex::PodVector< Fase2RetrieveRow > &subelements);

        /// Calculate all partitions (sources connected with joins)
        void PartitionSources(QueryDefinition &querydef);

        void DistributeSources(QueryDefinition const &querydef);
        void DistributeConditions(QueryDefinition const &querydef);
        void DistributionFinished();

        /** Modifies the cursor (advances using the given subquery)
            @param sq_to_advance Subquery to advance (subqueries with higher id's must be at query start!)
            @param stop_at_0_block_boundary Set to true to prevent advancing over subquery[0] block boundary
            @return Whether advance was successful. Failure: end of query, SQ 0 block bounds reached (when stop_at_0_block_boundary is true) */
        bool AdvanceCursorInternal(unsigned &sq_to_advance, bool stop_at_0_block_boundary);

    public:

        /** Opens a query
            @param querydef Query definition
            @param values List of varids used in the query definition the OpenQuery must destroy
                upon destruction. Is cleared on return. */
        void Open(QueryDefinition &querydef, std::vector<VarId> &values);

        /** Returns the current block position for a table */
        unsigned GetRecordArrayPosition(unsigned tableid);

        void GetRecord(VarId id_set, unsigned tableindex);
        QueryActions::_type GetNextAction();
        void GetResultArraySource(VarId id_set);

        void DeleteRow();
        void UpdateRow(VarId newvalues);

        /** Terminates the query */
        void Close();

// State machine for queries
        // Room in the resultset for new entries (negative for unlimited)
        signed limitcounter;

        // Indicates the result of the last evaluation of a WHERE-clause
        bool evaluated_where_ok;

        /// Returns whether this subquery is associated with a specific database transaction
        bool IsAssociatedWithTrans(DatabaseTransactionDriverInterface *_trans);

    private:
        // Indicates wether the query has just started (no GETACTION has been called)
        bool just_started;

        // Indicates wether the query has ended
        bool finished;

        Blex::SemiStaticPodVector< Fase2RetrieveRow, 16 > matchingrows;

        bool in_fase2;
        bool locked;

        bool use_blocks;
        bool use_fase1;
        bool fase2needslock;
        bool fase2_locks_implicitly;

        friend struct SubQuery;
};

void ConvertDBQueryToUppercase(DatabaseQuery &query);

} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
