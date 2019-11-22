#include <ap/libwebhare/allincludes.h>


#include "dbase_backend.h"
#include "dbase_modifications.h"

// Enable to see all inserts, updates and deletes
//#define SHOW_UPDATES


#ifdef SHOW_UPDATES
#define UDDEBUGPRINT(x) DEBUGPRINT(x);
#else
#define UDDEBUGPRINT(x) ;
#endif


/* I,U,D and added/removals

   Definitions and remarks
   - Remember the destinction between 'added', 'removed' and INSERT, UPDATE and DELETE. Both Insert&Update are additions, and both Update&Delete are removals
   - A locally added record is a record that was added by this transaction (either through INSERT or UPDATE)
   - The 'fast path' should be for updates/deletes on non-locally added records
   - Updating/deleting records that were locally added is stupid (the client
     is lazy and sending more commands than necessary). We won't optimize such
     operations at the expense of the 'fast path'.
   - A record is locally added, if we find it as 'first' of the added map
   - A record is locally removed, if we find it as 'first' of the removed map
   - Consistency definitions:
     if added[record_1] exists, and added[record_1]->second != 0
       then removed[added[record_1]->second] = record_1
     if removed[record_1] exists, and removed[record_1]->second != 0
       added[removed[record_1]->second] = record_1
   - The final modification: the externally visible modification done by this
     transaction. If record b := update of a, record c := update of b, then
     we want to forget about the intermediate updates and just pretend that
     what the user really did is "record c := update of a", and forget we ever
     wrote record 'b')

   Insert of a record
   - added: insert(newrecordid,0)

   Deletion of a record
   - assert: removed[oldrecordid] may not exist
   - does added[oldrecordid] exist?
     - if yes
       - (note: 'oldrecordid' is a temp version we wish to forget about, because
                the final modification is really: delete added->second)
       - if added->second != 0       If so, this was an update, not a local insert
         - cellupdatelist: for all columns, remove (oldrecordid)
         - removed[added->second] = 0
       - added: erase(added->second)
     - if no
       - remove: insert(oldrecordid, 0)

   > this causes us to always mark the OLDEST version of a record as deleted.
     ie: if you updated a record but then deleted it, we'll pretend those
         updates never happened. any references built to the updated version
         would be caught by delete cascades or illegal reference checks on the new versions

   Update of a record
   - true_oldrecordid = added[oldrecordid] ? added->second : oldrecordid;
   - does added[oldrecordid] exist?
     - if yes
       - (note: 'oldrecordid' is a temp version we wish to forget about, because
                the final modification is really: remove added->second, insert newrecordid)
       - if added->second != 0       If so, this was an update, not a local insert
         - cellupdatelist: for all columns, remove (oldrecordid), add (newrecordid,added->second)
         - for all updated columns, add (newrecordid, added->second) to cellupdatelist[updated_column_id]
         - removed[[added->second]->second] = newrecordid;
       - added: erase(oldrecordid)
       - added: insert(newrecordid, added->second)
       - remove: [added->second] = newrecordid
     - if no
       - added: add(newrecordid, oldrecordid)
       - removed: add(oldrecordid, newrecordid)
       - for all updated columns, add (newrecordid, oldrecordid) to cellupdatelist[updated_column_id]

   > this causes any previously existing local version (ie, you updated or
     inserted this record before) to be automatically discarded for further
     consideration. we still have a complete update list because we did trnsfer
     any cell changes notification from record added->second to newrecordid.

     Of course, this might cause us to do a useless reference check, eg if we
     actually undid cell updates in the second update (but see no-optimization)

   FIXME: Shouldn't we, even in the case of deletions/inserts, register added/removed
          cells (where a removed cell is defined as a not-null cell that existed
          in the deleted record) so that, when getting Deleted/Added cells, we
          only need to consult the cell update list? Might simplify code, might
          allow us to remove sorting of the recordid-list in some cases, optimizes
          the case of checking null cells.
   FIXME: Verify that we deal properly with inconsistency-threatening changes
          introduced by Update-Chase. Perhaps we should (or even MUST?) just
          ignore them as long as the record isn't modified - after all, those
          changes are coming from a valid database-state.
*/

namespace Database
{

void LocalModifications::ReportInsert(TableId table, RecordId new_record)
{
        if (!notifications.get())
            notifications.reset(new NotificationList);

        TableMods &tmods = notifications->mods[table];
        assert(tmods.additions.count(new_record) == 0 );

        tmods.additions.insert(std::make_pair(new_record,0));

        UDDEBUGPRINT("T" << table << ": Reported insert of " << new_record);
}

void LocalModifications::ReportDelete(TableId table, RecordId old_record)
{
        if (!notifications.get())
            notifications.reset(new NotificationList);

        TableMods &tmods = notifications->mods[table];
        assert(tmods.removals.count(old_record) == 0);

        //Record the deletion for our cascade&illegal checks (ADDME: How does this combine with 'additions' ?)
        deletions[table].insert(old_record);

        //Was this record added in this transaction ?
        TableMods::RecordModSet::iterator got_add = tmods.additions.find(old_record);

        if (got_add != tmods.additions.end())
        {
                UDDEBUGPRINT("T" << table << ": Reported delete of recently " << (got_add->second?"updated":"inserted") << " record " << old_record);

                if (got_add->second != 0) //it was an update of a record not inserted by this transaction
                {
                        //Remove it from the update list
                        for (TableMods::CellUpdateList::iterator it = tmods.cellupdatelist.begin(); it != tmods.cellupdatelist.end(); ++it)
                            it->second.erase( old_record );
                        tmods.removals[got_add->second] = 0;
                }

                //You're deleting a newly added record, so just forget it ever happened
                tmods.additions.erase(got_add);
        }
        else
        {
                UDDEBUGPRINT("T" << table << ": Reported delete of " << old_record);
                tmods.removals.insert(std::make_pair(old_record,0));
        }
}

void LocalModifications::ReportUpdate(TableId table, RecordId old_record, RecordId new_record, std::vector< ColumnId > const &modified_cells)
{
        if (!notifications.get())
            notifications.reset(new NotificationList);

        TableMods &tmods = notifications->mods[table];

        //Was this record added in this transaction ?
        TableMods::RecordModSet::iterator got_add = tmods.additions.find(old_record);
        if (got_add != tmods.additions.end())
        {
                UDDEBUGPRINT("T" << table << ": Reported update of recently " << (got_add->second?"updated":"inserted") << " record " << old_record << " to " << new_record);

                if (got_add->second != 0)  //it was an update of a record not inserted by this transaction
                {
                        //Migrate updates in the cellupdatelist from the old to the new record
                        for (TableMods::CellUpdateList::iterator it = tmods.cellupdatelist.begin(); it != tmods.cellupdatelist.end(); ++it)
                        {
                                TableMods::RecordModSet::iterator got_update = it->second.find(old_record);
                                if (got_update != it->second.end()) //migrate!
                                {
                                        it->second.erase( got_update );
                                        it->second.insert( std::make_pair(new_record, got_add->second) );
                                }
                        }
                        for (std::vector< ColumnId >::const_iterator it = modified_cells.begin(); it != modified_cells.end(); ++it)
                            tmods.cellupdatelist[*it].insert(std::make_pair(new_record, got_add->second));
                }

                //You're updating a newly added record, so just forget it ever happened
                tmods.removals[got_add->second] = new_record;
                tmods.additions.insert(std::make_pair(new_record, got_add->second));
                tmods.additions.erase(got_add);
                return;
        }
        else
        {
                tmods.additions.insert(std::make_pair(new_record, old_record));
                tmods.removals.insert(std::make_pair(old_record, new_record));

                for (std::vector< ColumnId >::const_iterator it = modified_cells.begin(); it != modified_cells.end(); ++it)
                    tmods.cellupdatelist[*it].insert(std::make_pair(new_record,old_record));

                UDDEBUGPRINT("T" << table << ": Reported update from " << old_record << " to " << new_record);
        }
}

bool LocalModifications::IsTableLocallyCreated(TableId table) const
{
        return table_creations.count(table)==1;
}

void LocalModifications::ReportTableCreate(TableId table)
{
        table_creations.insert(table);
}

void LocalModifications::ReportTableDrop(TableId table)
{
        deletions.erase(table);
        if (notifications.get())
            notifications->mods.erase(table);
}

void LocalModifications::GetNewDeletes(DeletionList *list)
{
        list->clear();
        list->swap(deletions);
}

void LocalModifications::GetListOfModifiedTables(std::vector< TableId > *tables) const
{
        tables->clear();
        if (!notifications.get())
            return;

        for (NotificationList::Mods::const_iterator it = notifications->mods.begin(); it != notifications->mods.end(); ++it)
            tables->push_back(it->first);
}

bool LocalModifications::HasTableModified(TableId table) const
{
        if (!notifications.get())
            return false;

        return notifications->mods.find(table) != notifications->mods.end();
}

bool LocalModifications::HaveMetaTablesModified() const
{
        if (!notifications.get())
            return false;

        for (NotificationList::Mods::const_iterator it = notifications->mods.begin(); it != notifications->mods.end(); ++it)
            if (it->first < MinimumExternalId)
                return true;
        return false;
}

void LocalModifications::GetAddedCells(TableId table, ColumnId column, std::vector< RecordId > *records) const
{
        records->clear();
        if (!notifications.get())
            return;

        NotificationList::Mods::const_iterator titr = notifications->mods.find(table);
        if (titr == notifications->mods.end())
            return;

        // First, add all freshly inserted cells
        TableMods const &tmods = titr->second;
        for (TableMods::RecordModSet::const_iterator rmit = tmods.additions.begin(); rmit != tmods.additions.end(); ++rmit)
            if (rmit->second == 0)
                records->push_back(rmit->first);

        // Then add all updated cells
        TableMods::CellUpdateList::const_iterator cuitr = tmods.cellupdatelist.find(column);
        if (cuitr != tmods.cellupdatelist.end())
        {
                for (TableMods::RecordModSet::const_iterator rmit = cuitr->second.begin(); rmit != cuitr->second.end(); ++rmit)
                    records->push_back(rmit->first); //return the new version of the record
        }
}

void LocalModifications::GetDeletedCells(TableId table, ColumnId column, std::vector< RecordId > *records) const
{
        records->clear();
        if (!notifications.get())
            return;

        NotificationList::Mods::const_iterator titr = notifications->mods.find(table);
        if (titr == notifications->mods.end())
            return;

        TableMods const &tmods = titr->second;

        //ADDME - Hmm, should consider storing deletes separately, would speed up this search..
        for(TableMods::RecordModSet::const_iterator itr = tmods.removals.begin(); itr != tmods.removals.end(); ++itr)
          if (itr->second==0) //deleted record
            records->push_back(itr->first);

        //Now tell about all rec
        TableMods::CellUpdateList::const_iterator cuitr = tmods.cellupdatelist.find(column);
        if (cuitr != tmods.cellupdatelist.end())
        {
                for (TableMods::RecordModSet::const_iterator rmit = cuitr->second.begin(); rmit != cuitr->second.end(); ++rmit)
                    records->push_back(rmit->second); //return old version of updated record
        }

        //FIXME: We still document that the caller may receive double records, but shouldn't our chase-elimination have gotten rid of that?
}

void LocalModifications::GetChangedRecordsFinals(TableId table, std::vector< RecordId > *records) const
{
        records->clear();
        if (!notifications.get())
            return;

        NotificationList::Mods::const_iterator titr = notifications->mods.find(table);
        if (titr == notifications->mods.end())
            return;

        TableMods const &tmods = titr->second;

        //add all inserted and updated records
        for(TableMods::RecordModSet::const_iterator itr = tmods.additions.begin(); itr != tmods.additions.end(); ++itr)
            records->push_back(itr->first);
}

void LocalModifications::GetDeletedRecords(TableId table, std::vector< RecordId > *records) const
{
        GetDeletedCells(table, 0, records);
}

} // End of namespace Database

