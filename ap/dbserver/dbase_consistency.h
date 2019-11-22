#ifndef blex_webhare_shared_dbase_consistency
#define blex_webhare_shared_dbase_consistency

#include "dbase_types.h"
#include "dbase_meta.h"
#include "dbase_modifications.h"

namespace Database
{
/** ConsistencyManager is a part of the BackendTransaction that implements the
    'C' of ACID: consistency. Its task is to monitor database modifications,
    and ensure that the constraints are not broken

    ADDME: ConsistencyManager shouldn't be confused by UPDATES and then DELETEs.
    Currently, when a record is updated and then deleted, it may still have
    a referential integrity check logged, which can cause a transaction fail if
    the referred entitiy is deleted. But: it shouldn't fail, because noone is
    actually referring anymore - it's just a log entry..

    ADDME: ConsistencyManager should probably track 'interesting' record numbers,
           and then watch for modifications for those - it can then do relevant
           scans immediately and act on those (eg, when having an Intolerable
           Delete, immediately record the rec#, don't wait for the Commit check?)
*/
class ConsistencyManager
{
    public:
        ConsistencyManager(Backend &backend);

        struct CheckData;

        void ExecutePreLockChecks(BackendTransaction &trans, CheckData &checkdata);
        void ExecuteCommitLockChecks(BackendTransaction &trans, CheckData &checkdata);

    private:
        /** Check that all referred records actually exist in the database */
        void CheckDeadReferences(BackendTransaction &trans);

        void CheckLiveReferencesPreCommit(BackendTransaction &trans, CheckData &checkdata);
        void CheckLiveReferencesAtCommit(BackendTransaction &trans, CheckData &checkdata);

        /** Check that all should-be unique keys are actually unique in the database */
        void CheckUniques(BackendTransaction &trans);

        /** Checks if all inserts are against tables that still exist...  what about created/dropped tables? */
        void CheckInsertsForTableExistance(BackendTransaction &trans);

        /** Check newly added/changed unique columns for uniqueness */
        void CheckColumnForUniqueness(BackendTransaction &trans, TableDef const *table, ColumnDef const *column);

        /** Check newly added/changed not null columns for nulls */
        void CheckColumnForNotNull(BackendTransaction &trans, TableDef const *table, ColumnDef const *column);

        /** Check added/updated columns for constraints */
        void CheckMetaUpdatedColumnsPreCommit(BackendTransaction &trans, CheckData &checkdata);

        void CheckMetaUpdatedColumnsAtCommit(BackendTransaction &trans);

        /** Checks whether there are multiple role grants with the same role, grantor and grantee, but different id */
        void CheckRoleGrantsForUnique(BackendTransaction &trans);

        /** Checks whether there are multiple grants with the same object, grantor and grantee, but different id */
        void CheckPrivilegeGrantsForUnique(BackendTransaction &trans);

    private:

        /** Checks for a list of references (or all) in a column if the referenced record exists. Only for normal references.
            @param trans Transaction
            @param tabledef Table the column resides in
            @param columndef Column to check
            @param added_ids RecordIds of records to check (0 to check all records table)
            @param checkdata Struct to store data in that needs to be checked during commit */
        void CheckLiveReferencesInternalPreCommit(BackendTransaction &trans, TableDef const &tabledef, ColumnDef const &columndef, std::vector< RecordId > const *added_ids, CheckData &checkdata) const;

        /** Checks for a list of references (or all) in a column if the referenced record exists. Only for references by column.
            @param trans Transaction
            @param tabledef Table the column resides in
            @param columndef Column to check
            @param added_ids RecordIds of records to check (0 to check all records table)
            @param checkdata Struct to store data in that needs to be checked during commit */
        void CheckLiveReferencesByColumnInternalPreCommit(BackendTransaction &trans, TableDef const &tabledef, ColumnDef const &columndef, std::vector< RecordId > const *added_ids, CheckData &checkdata) const;

        // List of columns
        typedef std::vector< std::pair< TableDef const *, ColumnDef const * > > ColumnList;

        typedef std::map< TableId, std::set< RecordId > > RecordList;

        void GetForeignReferrers(BackendTransaction &trans, TableDef const *referenced_table, ColumnList &referrers);

        ConsistencyManager(ConsistencyManager const &) = delete;
        ConsistencyManager& operator=(ConsistencyManager const &) = delete;

        Backend &backend;
};

struct ConsistencyManager::CheckData
{
        inline CheckData() : is_valid(false) {}

        /// Is this data valid?
        bool is_valid;

        /** Records needed to satisfy live references */
        RecordList needed_records;
};

} //end namespace Database

#endif
