#ifndef blex_webhare_shared_dbase_modifications
#define blex_webhare_shared_dbase_modifications

#include "dbase_types.h"
#include "dbase_meta.h"

namespace Database
{

namespace ModType
{
        enum _type
        {
                Insert,
                Delete,
                Update
        };
} // End of namespace ModType

struct TableMods
{
        /// Record modification set
        typedef std::map< RecordId, RecordId > RecordModSet;

        /// A list of record additions. first is the new record id, second is the old record id (if 0, record is insert, otherwise update)
        RecordModSet additions;

        /// A list of record removals. first is the old record id, second is the new record id (if 0, record is deleted, otherwise update)
        RecordModSet removals;

        /// Typedef for cell update list
        typedef std::map< ColumnId, RecordModSet > CellUpdateList;

        /// List of all cells that were changed in a update
        CellUpdateList cellupdatelist;
};

/** A list of notifications which a listener indicated his interest in. If we
    combine this with Zombie transactions, we're very close to a low-memory
    notification system */
struct NotificationList
{
        /* Typedef for structure that keeps all modifications (meant for
          notifications) */
        typedef std::map< TableId, TableMods > Mods;

        Mods mods;
};

typedef std::map<TableId, std::set<RecordId> > DeletionList;

/** The LocalModifications class records all modifications that are needed for
    notifications and for consistency of the database.

    It has multiple users:
    - the scanner, which inputs done modifications into this class
    - the backend, which uses the data this class collects to cascade deletes
    - the consistency manager, which uses this class to quickly check consistency
    - the notification mechanism, which sends out the data this class collects
    */
struct LocalModifications
{
        /** @name Scanner interface
                Interface for the scanner to communicate all modifications to
                the database to this class. */
        //@{

        /** Reports the insert of a new record
            @param table Table in which this happened
            @param new_record Id of new record */
        void ReportInsert(TableId table, RecordId new_record);

        /** Reports the delete of a record (by own action, not through chase!)
            @param table Table in which this happened
            @param old_record Id of deleted record */
        void ReportDelete(TableId table, RecordId old_record);

        /** Reports the update of a record (by own action, not through chase!).
            Do not add dummy updates
            @param table Table in which this happened
            @param old_record Id of old record
            @param new_record Id of new (updated) record
            @param modified_cells List of all cells that were modified */
        void ReportUpdate(TableId table, RecordId old_record, RecordId new_record, std::vector< ColumnId > const &modified_cells);

        //@}

        /** @name Backend interface
                Interface for the backend for finishing commands (cascading
                deletes, adjusting visibility for chases). Also for some meta-
                updates reporting */
        //@{

        /** Returns a list of all deleted records (either by self delete or
            chased delete) since the last call to this function
            @param list List of all those records. Test for emptyness can be done
                by performing list.empty() */
        void GetNewDeletes(DeletionList *list);

        /** Reports create of a table; this method makes sure we don't trigger
            the 'insert in deleted table' error
            @param table Id of dropped table */
        void ReportTableCreate(TableId table);

        /** Reports drop of a table; this method causes all modifications
            associated with this table to be deleted
            @param table Id of dropped table */
        void ReportTableDrop(TableId table);

        //@}

        /** @name Consistency manager interface
                The consistency manager uses this interface for checking
                consistency. */

        //@{

        void GetListOfModifiedTables(std::vector< TableId > *tables) const;
        bool HasTableModified(TableId table) const;
        bool HaveMetaTablesModified() const;

        /** Returns list of all final versions of records in which particular column got new contents.
            @param table Table to check
            @param column Column to check for modifications (if 0, return only deleted records)
            @param records Vector that will receive all records to check */
        void GetAddedCells(TableId table, ColumnId column, std::vector< RecordId > *records) const;

        /** Returns list of all removed versions of records in which particular column got contents deleted.
            @param table Table to check
            @param column Column to check for modifications (if 0, return only deleted records)
            @param records Vector that will receive all records to check */
        void GetDeletedCells(TableId table, ColumnId column, std::vector< RecordId > *records) const;

        void GetChangedRecordsFinals(TableId table, std::vector< RecordId > *records) const;

        void GetDeletedRecords(TableId table, std::vector< RecordId > *records) const;

        /** Are we responsible for creating a table? (used for parallel-table-drop checks) */
        bool IsTableLocallyCreated(TableId table) const;

        //@}


        /** @name Interface generics
                This is a generic stuff */
        //@{

        /* All the modifications to this column will be recorded after this
            function  is called*/
        void Subscribe(TableId table, ColumnId column);

        NotificationList const * GetNotifications() const { return notifications.get(); }

        //@}

    private:
        std::unique_ptr<NotificationList> notifications;
        ///List of table creations
        std::set<TableId> table_creations;
        DeletionList deletions;
};

} // End of namespace Database

#endif
