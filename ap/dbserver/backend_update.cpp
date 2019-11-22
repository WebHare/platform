#include <ap/libwebhare/allincludes.h>


#include "dbase_transaction.h"
//#include "dbase_index_frontend.h"

namespace Database
{

//#define SHOW_INSERTED_RECORDS
//#define SHOW_UPDATED_RECORD_IDS

/* These are the possible update scenarios

   CREATE:
     Record is new
     * UpdateRecord(table,recid,updates,false);

     - Apply the updates to the default(template) record
     - Security check insert: (new)
     - Write the new record

   FIRSTUPDATE:
     Record has not yet been updated by any transaction (or the updating transaction has been permanently rolled back)

     - Read the old record contents
     - Expire the old record
     - Apply the updates
     - Security check update: (old,new)
     - Write the new record

   REUPDATE:
     Record has been updated by our transaction
     - Read the original updated record contents
     - Expire the original update
     - Apply the updates
     - Security check update: (original update, new update)

   HOLDUPDATE:
     Record has been updated by another transaction, but has not yet been committed
     - Delay until transaction has rolled back or committed

   CONTINUEUPDATE:
     Record has been updated by a committed transaction
     - Transmit the record# of the updated version to the client
     - Let the client re-test its criteria on the new version, if necessary
     -

     what happens in the database?

     BEFORE we (TransB) try to update:
     transA: committed. transB: in-progress
     original record: 5:   (adder=AlwaysCommited, remover=TransA, update=6)
     updated record:  6:   (adder=TransA, remover=NeverComitted, update=0)

     LOCKING the record so we can continue update it:
     transA: committed. transB: in-progress
     original record: 5:   (adder=AlwaysCommited, remover=TransA, update=6)
     updated record:  6:   (adder=TransA, remover=TransB, update=0)

     step three: ACTUAL UPDATE
     transA: committed. transB: in-progress
     original record: 5:   (adder=AlwaysCommited, remover=TransA, update=6)
     updated record:  6:   (adder=TransA, remover=TransB, update=7)
     updated record:  7:   (adder=TransB, remover=NeverCommitted, update=0)

     step three: ACTUAL DELETE
     transA: committed. transB: in-progress
     original record: 5:   (adder=AlwaysCommited, remover=TransA, update=6)
     updated record:  6:   (adder=TransA, remover=TransB, update=0)

     step three: ABANDON UPDATE
     transA: committed. transB: in-progress
     original record: 5:   (adder=AlwaysCommited, remover=TransA, update=6)
     updated record:  6:   (adder=TransA, remover=NeverCommitted, update=0)
*/

/* The script of a conflicting transaction with duplicate update:

Initial table setup:
rec 5: <insert:1> <update:never> <next: 0> id = 250, published=0, template=0, profile=0

Trans 2: open

Trans 2: update files set published := 1 where id=250;
         About record 5: VISIBLE (1 is visible, never is invisible)
         TryExpire(5): returns OK, update record 5
         LockRecord(5)
         UpdateRecord(5): writes new record 6

rec 5: <insert:1> <update:2>     <next: 6> id=250, published=0, template=0, profile=0
rec 6: <insert:2> <update:never> <next: 0> id=250, published=1, template=0, profile=0

Trans 3: open (trans 2 goes on the permanently invisible list)

Trans 2: commit

Trans 3: update files set template = 1 where id =250;
         About record 5: VISIBLE (1 is visible, 2 is invisible)
         About record 6: INVISIBLE (2 is invisible)
         TryExpire(5): returns OK, chase to record 6
         LockRecord(6)
         UpdateRecord(6): writes new record 7

rec 5: <insert:1> <update:2>     <next: 6> id=250, published=0, template=0, profile=0
rec 6: <insert:2> <update:3>     <next: 7> id=250, published=1, template=0, profile=0
rec 7: <insert:3> <update:never> <next: 0> id=250, published=1, template=1, profile=0

Trans 3: select from files where id=250;
         About record 5: VISIBLE (1 is visible, 2 is invisible)
         About record 6: INVISIBLE (2 is invisible)
         About record 7: VISIBLE (3 is visible, never is invisible)

   ADDME: We probably need some form of SELECT-FOR-UPDATE and do that when
          processing an update's WHERE clause so that we can safely apply it

   ADDME: PERFORMANCE: Deflected updates should overwrite existing record if
          that would fit. Alternative, zapping the intermediate version record
          would at least save existing transactions some of the work (but don't
          forget to update the Next record pointer)

   ADDME: The database currently has a kind-of inconsistent handling of empty
          cells. Eg, an empty string is sometimes not inserted at all, instead
          of a null-size field. We need to make this a bit more consistent, but
          we'll have to deal with 'old' style records either way.

          For now, we stop inserting any 'considered NULL' values. This should
          give some compacter records and make it a lot easier to find bugs
          in not-NULL handling code, until we figure out what NULL will really
          mean to HareScript and WebHare databases */
std::pair<bool, RecordId> BackendTransaction::UpdateRecord(TableDef const &table, RecordId oldrecordid, Record const &oldrecord, Record const &updates, bool no_priv_checks, bool no_access_checks, std::vector< ColumnId > *modified_columns)
{
        if (state == TransactionState::ReadOnly)
            throw Exception(ErrorInvalidArg,"UPDATE issued in a readonly-transaction");
        else if (state == TransactionState::ReadOnlyAfterError)
        {
#ifdef SHOW_UPDATED_RECORD_IDS
                DEBUGPRINT("Ignoring update on record " << table.name << ':' << oldrecordid << " in readonly after error state");
#endif
                return std::make_pair(false, oldrecordid);
        }

//        if (!nocheck && !oldrecordid && !HasPrivilege(table.object_id, Privilege::Column_Insert)) //ADDME: Check on column levels themselves
//            throw Exception(ErrorAccessDenied,"User does not have sufficient privileges to insert a record in table " + table.name);

        bool has_table_wide_update_priv = oldrecordid && !no_priv_checks ? HasPrivilege(table.object_id, Privilege::Column_Update) : false;
        bool has_table_wide_insert_priv = !oldrecordid && !no_priv_checks ? HasPrivilege(table.object_id, Privilege::Column_Insert) : false;

        updaterecord_scratch_record.Clear();
        if (modified_columns)
            modified_columns->clear();

        if (oldrecordid == 0) //Not CREATE scenario
            PrepareForWrite();

        bool any_modifications=oldrecordid == 0; //A new record is inserted, so always do something

        //Verify the cells
        for (TableDef::ColumnCItr citr = table.GetColumns().begin();
             citr != table.GetColumns().end();
             ++citr)
        {
                ColumnDef const &column=citr->second;

                Cell oldcell = oldrecordid == 0 ? Cell() : oldrecord.GetCell(column.column_id);

                if (column.internal || column.name.empty() /*deleted*/)
                {
                        if (oldcell.Exists()) //we're REMOVING a cell!
                            any_modifications=true;
                        continue;
                }

                Cell newcell = updates.GetCell(column.column_id);

                // Is a new value being assigned to the cell? (password values can't be easily re-assigned)
                bool newcell_is_set = newcell.Exists();
                if (!newcell_is_set && oldrecordid!=0) //copy from old, if cell not updated
                    newcell = oldcell;

                // Should we upgrade the BLOB field, ie: add a filelength indicator
                bool upgrade_blob = column.type == TBlob && (newcell.Size() == 4 || newcell.Size() == 8 || newcell.Size()==12); //this blob needs an upgrade (FIXME: Verwijder case 12, voor arnold's database)

                /* ADDME: Als een blobid is gedownload door een client, of door
                          de client zelf is aangemaakt, kunnen we dan niet de
                          bloblengte onthouden en de client direct de
                          juiste cel laten aanmaken?

                          Of moeten we de client hier zelfs geheel in vertrouwen?
                   FIXME: Verifieren we uberhaupt wel dat de door client beweerde
                          blob wel bestaat? Moet INSERT/UPDATE in RPC niet de
                          blobid verifieren/mappen naar bekend om te voorkomen
                          dat client files steelt?
                */
                bool newcell_null = IsCellNull(newcell, column.type);

                /* Was the cell actually modified? */
                bool cell_is_user_modified = oldrecordid == 0 || !IsCellEqual(oldcell,newcell,column.type);
                bool cell_is_modified = cell_is_user_modified || upgrade_blob;

                /* Create an autonumber for the cell, if necessary (record is new, and cell is non-Existant or empty) */
                if (oldrecordid == 0 && newcell_null && column.autonumber_start)
                {
                        updaterecord_scratch_record.SetInteger(column.column_id,GetAutonumberKey(table,column));
                        newcell = updaterecord_scratch_record.GetCell(column.column_id);
                        newcell_null = IsCellNull(newcell, column.type);
                        cell_is_modified=true;
                }
                else if (newcell.Exists()) //Setting a new value, or did this cell exist in the previous record?
                {
                        if (!newcell_null && !upgrade_blob) //Copy it, if not null, or upgrading the blob
                        {
                                updaterecord_scratch_record.SetColumn(column.column_id,newcell.Size(),newcell.Begin());
                        }
                }
                else if (oldrecordid==0) //not setting a new value, but a new Record, so try default
                {
                        if (column.defaultval.size())
                        {
                                updaterecord_scratch_record.SetColumn(column.column_id,column.defaultval.size(),&column.defaultval[0]);
                                newcell = updaterecord_scratch_record.GetCell(column.column_id);
                                newcell_null = IsCellNull(newcell, column.type); //FIXME: defaultval just shouldn't be set in case of NULL
                                cell_is_modified=true;
                        }
                }

                if (upgrade_blob)
                {
                        //Build the new value
                        if (newcell.Blob())
                        {
                                Blex::FileOffset bloblength = backend.GetBlobMgr().GetBlobLength(newcell.Blob());
                                updaterecord_scratch_record.SetBlobAndLength(column.column_id, newcell.Blob(), bloblength);
                                DEBUGPRINT("Upgraded blob data of blob " << newcell.Blob() << " - added filelength " << bloblength);
                        }
                        else
                        {
                                DEBUGPRINT("Upgraded blob data of empty blob");
                        }
                }

                if (cell_is_modified)
                {
                        if (cell_is_user_modified && !no_priv_checks) // Skip checks?
                        {
                                if (oldrecordid          // only updates
                                        && !has_table_wide_update_priv // Update priv on table?
                                        && !HasPrivilege(column.object_id, Privilege::Column_Update)) // Update priv on column?
                                    throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to update column " + column.GetPrettyName());
                                else
                                if (!oldrecordid          // only inserts
                                        && !has_table_wide_insert_priv // Insert insert on table?
                                        && !HasPrivilege(column.object_id, Privilege::Column_Insert)) // Insert priv on column?
                                    throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to insert into column " + column.GetPrettyName());
                        }

                        any_modifications=true;
                        if (modified_columns)
                            modified_columns->push_back(column.column_id);
                }

                /* As a special extension (but NOUPDATE is an extension anyway), a NOUPDATE NOT NULL
                   column that has a NULL (equivalent!) value (metadata updated) _may_ be set once */
                if (oldrecordid != 0 && column.noupdate && cell_is_modified && !(column.notnull && IsCellNull(oldcell, column.type))) //update cell
                    throw Exception(ErrorWriteAccessDenied,"Column " + table.name + ":" + column.name + " may not be modified", table.name, column.name);

                /* Stop NULL values */
                if (column.notnull && newcell_null)
                    throw Exception(ErrorConstraintNotNull,"Violated NOT NULL constraint on " + table.name + ":" + column.name, table.name, column.name);

                //These checks are only necessary on modified cells...
                if (cell_is_modified)
                {
                        //Check for maxsize violations
                        if (newcell.Size() > column.maxsize)
                            throw Exception(ErrorConstraint,"Violated maximum size on " + table.name + ":" + column.name);
                }
        }

        if (!any_modifications && !clustering_updates)
        {
#ifdef SHOW_UPDATED_RECORD_IDS
                DEBUGPRINT("Ignoring dummy update on record " << table.name << ':' << oldrecordid);
#endif
                return std::make_pair(false, oldrecordid);
        }

        //Validate inserted/updated record, if necessary
        if (do_accessmsg_checks && !no_access_checks)
        {
                if (table.writeaccess)
                {
                        if (oldrecordid)
                        {
                                table.writeaccess(this,
                                            table,
                                            ActionUpdate,
                                            oldrecord,
                                            updaterecord_scratch_record);
                        }
                        else
                        {
                                table.writeaccess(this,
                                            table,
                                            ActionInsert,
                                            updaterecord_scratch_record,
                                            updaterecord_scratch_record);
                        }
                }
        }

        RecordId hint = oldrecordid;
        if (clustering_updates || !hint)
            hint = last_written_record[table.object_id];

        RecordId newblock=backend.WriteNewRecord(identified_trans, table, updaterecord_scratch_record, hint, clustering_updates, commits);
        SetRecordOverride(table.object_id, newblock, RecordOverride::NewRecord);

        // ADDME: also cache location when update was placed in another section
        if (clustering_updates || !oldrecordid)
            last_written_record[table.object_id] = newblock;

        //Update the original record, so that it points to the new record
        if (oldrecordid)
            backend.RegisterUpdate(table.object_id, oldrecordid, newblock, commits);

#ifdef SHOW_UPDATED_RECORD_IDS
        DEBUGPRINT("Update on record " << table.name << ':' << oldrecordid << " new block is " << newblock);
#endif
        return std::make_pair(true, newblock);
}

void BackendTransaction::InsertRecord(TableDef const &table, Record const &new_record, bool no_priv_checks, bool no_acces_checks)
{
        if (state == TransactionState::ReadOnly)
            throw Exception(ErrorInvalidArg,"INSERT issued in a readonly-transaction");
        else if (state == TransactionState::ReadOnlyAfterError)
            return; // Ignore the insert

        PrepareForWrite();
        std::pair<bool, RecordId> res = UpdateRecord(table, 0, Record(), new_record, no_priv_checks, no_acces_checks, 0);

        local_modifications.ReportInsert(table.object_id, res.second);

#if defined(DEBUG) && defined(SHOW_INSERTED_RECORDS)
        std::ostringstream str;
        str << "Insert in " << table.name << ": [";
        for (unsigned i = 0, end = new_record.GetNumCells(); i < end; ++i)
        {
                if (i != 0) str << ", ";
                ColumnId id = new_record.GetColumnIdByNum(i);
                ColumnDef const *cd = table.GetColumnDef(id);
                str << cd->name << ": ";
                Cell cell = new_record.GetCell(id);
                switch (cd->type)
                {
                case TInteger:  str << cell.Integer(); break;
                case TBoolean:  str << (cell.Boolean() ? "TRUE" : "FALSE"); break;
                case TBlob:     str << "BLOB"; break;
                case TDateTime: str << cell.DateTime(); break;
                case TMoney:    str << cell.Money() * 1.0 / 10000; break;
                case TInteger64:str << cell.Integer64(); break;
                case TFloat:    str << cell.Float(); break;
                default:
                    str << "\"" << cell.String() << "\""; break;
                }
        }
        str << "]";
        DEBUGPRINT(str.str());
#endif
}

int32_t GetNextAutonumber(TableDef const &table, ColumnDef const &column, int32_t startingtop, int32_t top)
{
        ++top;
        if(top == std::numeric_limits<int32_t>::max())
            top = column.autonumber_start;
        if(top == startingtop)
            throw Exception(ErrorConflict,"Column " + table.name + ":" + column.name + " has run out of autonumbers");
        return top;
}

/* Autonumber key must:
   - Give out the lowest available ID (try to avoid a high dispersion of used ids)
   - When an ID has been given to a transaction (reserved) that ID may not be
     offered to any other transaction unless the first transaction finishes
     without actually using the ID

   This reservation is currently implemented by resetting the ID counter to 0
   at database restart, and never re-reserve an ID until the database is
   restarted. But it could be improved a lot by recording reserved and unused
   IDs, and making them available for re-offering to other transactions */

int32_t BackendTransaction::GetAutonumberKey(TableDef const &table, ColumnDef const &column)
{
        if (!column.autonumber_start)
            throw Exception(ErrorInvalidArg,"Column " + table.name + ":" + column.name + " is not an autonumber column");

        //block concurrent access to this autosequencer
        AutoseqTop::WriteRef toplock(*column.deprecated_autoseq);

        //First check if top+1 is available
        int32_t startingtop = *toplock;
        int32_t top = GetNextAutonumber(table, column, startingtop, *toplock);

        //ADDME: Clean up this code - we have no business with internal cell representations
        uint8_t tempcell[Cell::HdrSize + sizeof(int32_t)];
        SetCellSize(tempcell ,sizeof(int32_t));
        Blex::puts32lsb(tempcell+Cell::HdrSize,top);

        // Make a query into the column with the autonumbers, search caseinsensitive for top and higher.
        std::shared_ptr<Blex::Index::Query> query;

        // Iterate over the indices to find one with only one indexed column; it must be StoredS32 because a autonumber column is an integer
        for (std::vector< Index::IndexData::Ref >::const_iterator it = column.indices.begin(); it != column.indices.end(); ++it)
        {
                if ((*it)->GetDescriptor().num_indexed_columns == 1)
                {
                        Cell tempcellstore(tempcell);
                        query = (*it)->MakeMultiQuery(&tempcellstore, 1, SearchBiggerEqual, true);
                        break;
                }
        }

        if (query.get())
        {
                namespace DI = Blex::Index;

                DI::BtreeIndex::Query::OnlineRef ref(*query);
                DI::BtreeIndex::OnlineIterator indexit(ref, *query->begin());

                while (*indexit < *query->approx_end())
                {
                        // Get the value pointed to by indexit
                        // FIXME: Ugly low-level code - we have no business with the internal index representation?
                        int32_t indexval = Blex::getu32msb(indexit->GetData())-0x80000000;

                        if (indexval!=top)
                            break;

                        // There may be dupes in the index, so skip them all
                        while (indexval==top)
                        {
                                ++indexit;
                                if (*indexit >= *query->approx_end())
                                    break;
                                indexval = Blex::getu32msb(indexit->GetData())-0x80000000;
                        }
                        top = GetNextAutonumber(table, column, startingtop, top);
                }

                *toplock = top;
//                DEBUGPRINT("Returning " << top << " for " << table.name << ':' << column.name);
                return top;
        }

        bool available; //is the current top known to be available?
        bool anyhigher; //did we find *anything* higher than our current top value?

        do
        {
                available=true; //as long as we haven't found a match, it is available
                anyhigher=false; //haven't found anything higher than 'top' yet

                /* Loop through the database and check if the current 'top' value
                   is already used. If we find the 'top' in use, we increase
                   it by 1 and continue our sequential scan.

                   If 'top' wasn't found at all (available==false), then we
                   can be sure that 'top' is available. If 'top' was found
                   (available==true) but nothing higher than any 'top' value
                   was found, then we can also be sure that 'top' is available.
                   Otherwise, we repeat the scan with the new 'top' value.

                   This loop is O(n) in the best case scenario (no gaps
                   in the ids, all records sequentially stored), and O(n^n)
                   in the worst case scenario (database stored in exact
                   reverse record order) with n==number of records. */

                Scanner scan(*this, ShowAfterCommit, false);
                scan.AddTable(table.object_id);
                while (scan.NextRow())
                {
                        int32_t ourval=scan.GetRowPart(0).GetCell(column.column_id).Integer();

                        //Is our value there?
                        if (top==ourval)
                        {
                                top = GetNextAutonumber(table, column, startingtop, top);
                                available=false; //we probably have to reloop
                        }
                        else if (!anyhigher && ourval>top)
                        {
                                anyhigher=true;
                                //we definately have to reloop if top is unavailable
                        }
                }
        }
        while (!available && anyhigher);

        *toplock=top;
//        DEBUGPRINT("Returning " << top << " for " << table.name << ':' << column.name);
        return top;
}

int32_t BackendTransaction::GetNewObjectId()
{
        TableDef const *tdef = GetMetadata().GetTableDef(TableId_MetaObjects);
        ColumnDef const *cdef = tdef->GetColumnDef(MetaObjects_ObjectId);

        // Get new id, check if this id isn't still used in the raw database
        while (true)
        {
                int32_t newid = GetAutonumberKey(*tdef, *cdef);
                if (!backend.rawdb.IsTableIdStillUsed(newid))
                    return newid;
        }
}

int32_t BackendTransaction::GetNewRoleId()
{
        TableDef const *tdef = GetMetadata().GetTableDef(TableId_MetaRoles);
        ColumnDef const *cdef = tdef->GetColumnDef(MetaRoles_RoleId);

        return GetAutonumberKey(*tdef, *cdef);
}

}
