#include <ap/libwebhare/allincludes.h>


#include "dbase_janitor.h"
#include "dbase_transaction.h"

//#include "scanner/scanner.h"
#include <blex/bitmanip.h>
#include <blex/path.h>
#include <blex/logfile.h>
#include <iostream>
#include "dbase_backend.h"


//#define SHOW_CLEANUP_HINTS
// ADDME: do cleanup in the code. Exceptions and stuff aren't handled very consistently.

namespace Database
{

///If the clock jumps by this amount of time, assume it has been reset and expire our timer
const int TimeLeapGuard = 60*60*12;

///Time to wait until we want the first chore to be done (give the system some time to settle down..)
const unsigned WaitFirstChore = 60*5; //wait 5 minutes..

///Time between db/index flushes
const unsigned FlushInterval = 60*15; //every 15 minutes

///Time to wait until we want to restart the chore list
const unsigned WaitRestartChores = 60*60; //every hour

///Time to wait until we move to the next task
const unsigned WaitNextTask = 60 ; //wait 5 minutes

///Number of seconds between two immediate chores
const unsigned WaitImmediateChores = 10; // Wait 10 seconds

///Time (seconds) to wait until we increase the generation of free sections (6 generations to unmap)
const unsigned WaitNextSectionGeneration = 10 ; //wait 10 seconds


class WillieAbort { };

Willie::Willie(RawDatabase &_rawdb, Backend &_backend, unsigned janitor_maxwait)
: rawdb(_rawdb)
, backend(_backend)
, threadrunner(std::bind(&Willie::ThreadCode,this))
, volatile_abortflag(0)
{
        DEBUGPRINT("Started janitor thread, maxwait: "  << janitor_maxwait);

        DEBUGONLY(admin.SetupDebugging("Janitor.admin"));
        {
                LockedAdmin::WriteRef lock(admin);
                lock->abortflag=false;
                lock->maxwait = janitor_maxwait;
        }
        DiscoverDestroyableTables();

        if (!threadrunner.Start())
            throw Exception(ErrorInternal,"Cannot launch the janitor thread");
}

Willie::~Willie()
{
        if (LockedAdmin::ReadRef(admin)->abortflag==false)
            Stop();
}

void Willie::DiscoverDestroyableTables()
{
        columns_to_destroy.clear();

        //Create a list of destroyable columns
        BackendTransactionRef metatrans(backend.BeginTransaction("~internal", "", "janitor", "janitor discover destroyable tables"));

        for (Metadata::TableCItr titr = metatrans->GetMetadata().GetTables().begin();
             titr != metatrans->GetMetadata().GetTables().end();
             ++titr)
        {
                TableDef const &table = titr->second;

                //Create a list of columns for this table
                std::vector<ColumnId> columns;

                for (TableDef::ColumnCItr citr = table.GetColumns().begin();
                     citr != table.GetColumns().end();
                     ++citr)
                {
                        if (citr->second.name.empty()) //deleted?
                            columns.push_back(citr->second.column_id);
                }

                if (!columns.empty())
                    columns_to_destroy.push_back(std::make_pair(table.object_id, columns));
        }
}

void Willie::Stop()
{
        DEBUGPRINT("Signalling janitor thread to stop");

        //Signal thread to stop
        LockedAdmin::WriteRef(admin)->abortflag=true;
        volatile_abortflag = 1;
        admin.SignalAll();

        //Wait for thread to come back to us
        threadrunner.WaitFinish();
}

void Willie::HintSectionsCleaning(unsigned const *sections, unsigned count)
{
#ifdef SHOW_CLEANUP_HINTS
        DEBUGONLY(
            std::stringstream str;
            str << "Janitor: Got hint for section cleaning of sections ";
            for (unsigned i = 0; i < count; ++i)
                str << (i == 0 ? "" : ", ") << sections[i];
            DEBUGPRINT(str.str());
        );
#endif
        {
                LockedAdmin::WriteRef lock(admin);

                while (count--)
                    lock->section_clean_hints.insert(*(sections++));
        }
        // Immediately signal; the wait in the janitor makes sure cleaning is not done too often
        admin.SignalAll();
}

unsigned Willie::GetMaxWait(LockedAdmin::ReadRef const &lock)
{
        return lock->maxwait;
}

unsigned Willie::GetMaxWait(LockedAdmin::WriteRef &lock)
{
        return lock->maxwait;
}


void Willie::Delay(unsigned milliseconds, std::string const &nexttask)
{
        if (rawdb.GetTransLog().IsTransactionRangeAlmostExhausted())
        {
                DEBUGPRINT("Janitor not waiting (transactions almost exhausted) for task '" << nexttask << "'");
                milliseconds = 0;
        }
        else
        {
              DEBUGPRINT("Janitor waiting " << milliseconds << "ms for task '" << nexttask << "'");
        }

        Blex::DateTime waituntil = milliseconds > 0 ? Blex::DateTime::Now() + Blex::DateTime::Msecs(milliseconds) : Blex::DateTime::Min();

        // Wait max 100ms per time,
        LockedAdmin::WriteRef lock(admin);
        lock->waituntil = waituntil;
        lock->nexttask = nexttask;

        while (milliseconds > 0)
        {
                //try to wait X seconds (ADDME: actually wait X,even if interrupted)
                if (lock->abortflag)
                    throw WillieAbort();

                if (GetMaxWait(lock) == 0) //insane janitor
                    return;

                unsigned waitnow = std::min(100U, milliseconds);

                lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Msecs(waitnow));
                if (lock->abortflag)
                    throw WillieAbort();

                milliseconds -= waitnow;
        }
}

bool Willie::ClearColumnMetadata(BackendTransaction &trans, TableId tableid, ColumnId columnid)
{
        { //addme: extra block level really necessary?
                // Special updatable scan, first table may be deleted, second may not.
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaObjects);
                scan.AddTable(TableId_MetaColumns);
                scan.AddIntegerSearch(1, MetaColumn_ColumnId, columnid, SearchEqual);
                scan.AddIntegerSearch(0, MetaObjects_Parent,tableid,SearchEqual);
                scan.AddJoin(1, MetaColumn_ObjectId, false, 0, MetaObjects_ObjectId, false, SearchEqual, true);

                if (!scan.NextRow())
                {
                        // Cannot find column record; not an error
                        // A parallel trans can have deleted it, the previous lockrow can have hidden it. That's a conflict.
                        return false;
                }

                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::NoChange:
                        break;
                case LockResult::Updated: //conflict made update impossible
                        scan.UnlockCachedRow(0);
                        return false;
                case LockResult::Deleted: //concurrent delete made update impossible
                        return false;
                case LockResult::Retry: //won't happen due to autowait
                        return false;
                }

                //Internal records have no physical presence, so just drop them
                scan.DeleteLockedRow(0, true);
                trans.NotifyMetadataModification();
        }

        trans.FinishCommand();
        return true; //succesfully cleaned
}

bool Willie::ColumnCleanup(TableId to_clean, ColumnList const &columns)
{
        BackendTransactionRef trans(backend.BeginTransaction("~internal", "", "janitor", "janitor discover destroyable columns"));

        TableDef const *tabledef = trans->GetMetadata().GetTableDef(to_clean);
        if (!tabledef)
            return true; //table no longer exists, so ignore deletion!

        bool conflict = false;
        WritableRecord empty_updates;

        {
                Scanner scan(*trans, ShowNormalSkipAccess, true); //NEVER ShowNormal! We have a BackendTransaction, not a WHDbase transaction, so don't ever execute access checks
                scan.AddTable(to_clean);

                while (scan.NextRow() && !conflict)
                {
                        scan.AddActiveRowToCache();

                        //Look for the forbidden columns in the record
                        for (unsigned i=0;i<columns.size();++i)
                            if (scan.GetRowPart(0).GetCell(columns[i]).Exists())
                            {
                                    DEBUGPRINT("Record #" << scan.GetRowPartRecordId(0) << " contains forbidden cell #" << columns[i]);
                                    switch (scan.LockCachedRowWithAutoWait(0))
                                    {
                                    case LockResult::Deleted:   continue;
                                    case LockResult::Updated:
                                        {
                                                DEBUGPRINT("Conflict updating record, stopping cleanup");
                                                conflict = true;
                                                scan.UnlockCachedRow(0);
                                        }; break;
                                    case LockResult::NoChange:
                                        {
                                                scan.UpdateLockedRow(0, empty_updates);
                                        }; break;
                                    case LockResult::Retry: //won't happen due to autowait
                                        {
                                                conflict = true;
                                        } break;
                                    }

                                    break; //We only need to update once to get rid of ALL deleted columns!
                            }
                        scan.ClearCache();
                }
        }
        trans->FinishCommand();

        //We've succesfully removed all occurences of the column. Now
        //remove the deleted columns from the table metadata
        for (unsigned i=0;i<columns.size() && !conflict;++i)
            conflict = ! ClearColumnMetadata(*trans, to_clean, columns[i]);

        //Commit any changes (we do this always!)
        backend.FinishTransaction(trans.get(),true);

        return !conflict;
}

bool Willie::ColumnsCleanup()
{
        while(!columns_to_destroy.empty())
        {
                if (!ColumnCleanup(columns_to_destroy.back().first,columns_to_destroy.back().second))
                    return false; //conflict, so retry later
                columns_to_destroy.pop_back();
        }
        return true; //no conflicts!
}

void Willie::MarkUsedBlobs(DatabaseLocker &db_locker, TableDef const *tabledef, std::vector< RecordId > const &recs, std::vector< uint8_t > *currentblobdata)
{
        typedef std::vector< TableDef::Columns::const_iterator > BlobColItrs;
        BlobColItrs blobcols;

        //if there are any blob columns, check to whom the survivors are referring.
        for (TableDef::Columns::const_iterator citr = tabledef->GetColumns().begin(); citr != tabledef->GetColumns().end(); ++citr)
            if (citr->second.type == TBlob)
                blobcols.push_back(citr);

        if (blobcols.empty())
            return;

        for (std::vector<RecordId>::const_iterator itr = recs.begin(); itr != recs.end(); ++itr)
        {
                //okay, here we go....
                DeprecatedAutoRecord rec(db_locker, tabledef->object_id, *itr);

                for (BlobColItrs::const_iterator citr = blobcols.begin(); citr != blobcols.end(); ++citr)
                {
                        BlobId blobid = rec->GetCell((*citr)->second.column_id).Blob();
                        if (!blobid || blobid >= currentblobdata->size()*8) //range check
                            continue;

//                        if (Blex::GetBit(&currentblobdata[0],blobid) == false)
//                            DEBUGPRINT("Dupe reference to blob " << blobid);

                        Blex::SetBit(&(*currentblobdata)[0],blobid,false);
                }
        }
}

void Willie::InitDatabaseCleanup()
{
        /* On init, all transactions ids not in the current range are
           permanentized. No references can occur to transactions that use that
           id's, so we can wipe them surely.

           This is a necessary step after upgrades (failure to execute can lead
           to temporary visibility problems) or when the database was shutdown
           between transaction switches. Thus, we abort on exception. */
        try
        {
                DEBUGPRINT("Willie: Initial database cleanup, wiping inactive ranges");

                // Make sure the in-memory state is in sync with the disk
                rawdb.SyncAllTableFiles();

                //GetCurrentRange cannot change now (because Willie controls it) so no need to lock it.
                RangeId current_range = rawdb.GetTransLog().GetCurrentRange();
                for (RangeId id = 0; id < TransStateMgr::RangesCount; ++id)
                    if (id != current_range && rawdb.GetTransLog().IsRangeUsed(id))
                        throw Exception(ErrorIO,"Initialize cleanup called with multiple ranges active");

                Blex::SectionUpdateHistory history;
                DatabaseLocker db_locker(rawdb);
                std::vector<RecordId> destroyable, allrecs;

                //Although the table can still grow, none of the new sections can
                //refer to any of the removed transactions, so we can safely
                //assume its size is constant now...

                //ADDME: Mostly dupe with the other ClearObsoleteTransactions call!
                MetadataManager::Ref meta(backend.GetMetadataManager());
                unsigned numsections = rawdb.GetNumSections();
                for (unsigned section=0;section<numsections;++section)
                {
                        TableId tableid = rawdb.Deprecated_GetSectionTableId(section);
                        if (tableid == 0)
                            continue;

                        // Keep processing hints too
                        DestroyHintedRecords(0);

                        Delay(100, "InitDatabaseCleanup: Clear section " + Blex::AnyToString(section) + "/" + Blex::AnyToString(numsections));

                        destroyable.clear();
                        allrecs.clear();

                        // Clear obsolete transactions
                        rawdb.ClearObsoleteTransactions(tableid, current_range, section, destroyable, allrecs, history, true/*invert section test*/);

                        // ADDME: Kan beter in block destroyen, want we doen nu veel lock/unlock/prolog rechecking per sectie
                        std::sort(destroyable.begin(), destroyable.end());
                        destroyable.erase(std::unique(destroyable.begin(),destroyable.end()),destroyable.end());

                        for (std::vector<RecordId>::const_iterator killitr = destroyable.begin();
                             killitr!=destroyable.end();
                             ++killitr)
                        {
                                //inform index if table still exists
                                backend.JanitorDestroyRecord(db_locker, tableid, *killitr, history/*, tabledef!=NULL*/);
                        }
                }

                Delay(0, "InitDatabaseCleanup: Flush cleanups");
                if (!history.ForceSyncAll()) //failed to properly synchronise our changes
                    throw Exception(ErrorIO,"Unable to flush database cleanups to disk");
        }
        catch (std::exception &e)
        {
                Blex::ErrStream() << "Initial database cleanup failed, exception: " << e.what();
                Blex::FatalAbort();
        }

        next_chore = RangeSwitch;
        next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextTask, GetMaxWait(LockedAdmin::ReadRef(admin))));
}

void Willie::DatabaseCleanup()
{
        /* Pre-v2.19.0 database janitor has a race condition! If a blob is
           referred to by Destroyable records (ie, the transaction cleanups
           are going quite fast, eg during a Republish when many records are moved
           to the end of the section files), and its new referringt records are
           re-appearing in places when we're NOT looking (eg, sections we already
           checked or in sections after 'numsections', we will MISS the reference
           and incorrectly DESTROY the blob.

           It should be possible to work around this by considering a Destroyable
           record to also be a reference to the blob. We will then 'really' get
           around to destroying a blob on the _second_ DatabaseCleanup pass.

           This should be safe, as only *WE* can actually destroy records, and
           if we find neither a destroyable nor a surviving record referring
           to a blob, there is no way a reference can reappear

        NOTE: we used to work with just 'surviving' records. this has now been
              replaced with 'allrecs', the union of destroyable and surviving recs*/

        DEBUGPRINT("Willie: Switchover completed, start wiping range #" << abandoned_range);

        //Run through all tables, destroying obsolete records!
        std::vector<RecordId> destroyable, allrecs;

        DatabaseLocker db_locker(rawdb);
        MetadataManager::Ref meta(backend.GetMetadataManager());

        //Download the current blob data
        std::vector<uint8_t> currentblobdata;
        rawdb.GetBlobMgr().GetBlobSnapshot(currentblobdata);

        Blex::SectionUpdateHistory history;

        //Although the table can still grow, none of the new sections can
        //refer to any of the removed transactions, so we can safely
        //assume its size is constant now...
        unsigned numsections = rawdb.GetNumSections();
        for (unsigned section=0;section<numsections;++section)
        {
                Delay(100, "DatabaseCleanup: Clear section " + Blex::AnyToString(section) + "/" + Blex::AnyToString(numsections));

                /* Keep processing hints too. Mark the destroyed blobs! If a record is moved from
                   after our processing point to before our processing point, and the old version
                   is destroyed by a hint, the cleanup never sees that blob!
                */
                DestroyHintedRecords(&currentblobdata);

                //clear another section
                destroyable.clear();
                allrecs.clear();

                TableId sectiontableid = rawdb.Deprecated_GetSectionTableId(section);
                if (sectiontableid == 0)
                    continue;

#ifdef PLATFORM_DARWIN
                rawdb.MarkSectionDirty(sectiontableid, section, history);
#endif

                rawdb.ClearObsoleteTransactions(sectiontableid, abandoned_range, section,destroyable,allrecs,history, false /*clear exact section */);

                TableDef const *tabledef = meta->GetTableDef(sectiontableid);
                if (!tabledef)
                {
                        //Blex::ErrStream() << "Section " << section << " has unknown table id " << sectiontableid << " but still " << destroyable.size() << " records";
                        /* No table definition can be found for this tableid; ignore. All records in this
                           section must be invisible anyway

                           FIXME: BROKEN! If a blob becomes shared with a different table, and its old
                           table is dropped, but the janitor hasn't seen the new table yet (insert in earlier
                           section, the blob will be destroyed!)*/
                }
                else
                {
                        // Mark all the blobs in the records have seen (including the one we will be destroying)
                        MarkUsedBlobs(db_locker, tabledef, allrecs, &currentblobdata);
                }

                // ADDME: Kan beter in block destroyen, want we doen nu veel lock/unlock/prolog rechecking per sectie. Rob: Index updates kunnen echter veel tijd kosten; liever buiten het lock.
                for (std::vector<RecordId>::const_iterator killitr = destroyable.begin();
                     killitr!=destroyable.end();
                     ++killitr)
                {
                        backend.JanitorDestroyRecord(db_locker, sectiontableid, *killitr, history/*, tabledef!=NULL*/);
                }
        }

        Delay(0, "DatabaseCleanup: Sync cleanups");
        if (!history.ForceSyncAll()) //failed to properly synchronise our changes
            throw Exception(ErrorIO,"Unable to flush database cleanups to disk");

        /* Other transaction can have also removed transaction numbers from the old range, because
           a scanner which discovers a transaction to be PermanentlyC/R will update that transid
           to the Never/AlwaysCommitted transaction. These updates are not logged to their
           SectionHistory (and if they were, the tranasction might roll back)

           We need to be sure those their changes are also flushed, or on crash
           we may see the old id's reappear (not a hypothetical situation...) */
        Delay(0, "DatabaseCleanup: Sync all table files");
        rawdb.SyncAllTableFiles();

        Delay(2000, "DatabaseCleanup: ClearRange");

        //Hurray! We cleared ALL tables from obsolete references.
        //Now forget about all the obsolete transactions
        rawdb.GetTransLog().ClearRange(abandoned_range);

        //Start cleaning out the blobs!
        Delay(2000, "DatabaseCleanup: ClearBlobs");

        //Now, all the remaining blobs can go!
        rawdb.GetBlobMgr().ClearBlobs(currentblobdata);

        //FIXME: Sync blob file after update
}

void Willie::DoRangeSwitch()
{
        //We cannot switch when we're working in BOTH ranges!
        RangeId current_range = rawdb.GetTransLog().GetCurrentRange();
        RangeId previous_range = (current_range + TransStateMgr::RangesCount - 1) % TransStateMgr::RangesCount;

        if (rawdb.GetTransLog().IsRangeUsed(previous_range))
            throw Database::Exception(ErrorInternal,"Range switch called while previous range is still in use");

        /* The range switch, when completed, ensure that all transactions now
           running will have been completed and will not be referencing any
           data from before the range switch. This implies that any tables
           that are now on the destroy list, will be unrefrenced at range switch
           completion, so discover deletable tables now */
        DiscoverDestroyableTables();

        //Which range will go?
        abandoned_range = current_range;

        bool abandoned_range_almost_exhausted = rawdb.GetTransLog().IsTransactionRangeAlmostExhausted();

        //Start the switchover to the second range
        DEBUGPRINT("Willie: Switching to transaction range #" << ((current_range + 1) % 4));
        rawdb.GetTransLog().SwitchToNextTransactionRange();

        if (abandoned_range_almost_exhausted)
            Blex::ErrStream() << "Switched to next range, exhaustion solved";

        //Wait for the switchover to be complete (no referrers to old range)
        next_chore = RangeSwitchComplete;
        next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextTask, GetMaxWait(LockedAdmin::ReadRef(admin))));
}

void Willie::DoRangeSwitchComplete()
{
        unsigned janitor_maxwait = GetMaxWait(LockedAdmin::ReadRef(admin));

        if (rawdb.GetTransLog().IsRangeUsed(abandoned_range))
        {
                DEBUGPRINT("Willie: Old range #" << abandoned_range << " still referenced - will keep on waiting");
                if (rawdb.GetTransLog().IsTransactionRangeAlmostExhausted())
                {
                        if (!Blex::InitiateShutdownWithInterrupt())
                            Blex::ErrStream() << "Willie: Current transaction range almost exhausted, can't switch to next. Shutting down.";
                }

                //just keep waiting..
                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextTask,std::max(1u,janitor_maxwait))); //there is no point in spinning on this in maxwait 0
                return;
        }

        try
        {
                DatabaseCleanup();
                next_chore = CleanupTablesColumns;
                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextTask,janitor_maxwait));
        }
        catch (std::exception &e) //ADDME:Log!
        {
                Blex::ErrStream() << "Database cleanup failed, exception: " << e.what();
                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextTask,janitor_maxwait));
        }
}

void Willie::DoCleanupTablesColumns()
{
        DEBUGPRINT("Willie: Clean up old columns");

        unsigned janitor_maxwait = GetMaxWait(LockedAdmin::ReadRef(admin));

        /* It should be clean to do a old column cleanup after a range switch,
           because a range switch guarantees that no transactions that were
           running before the range switch started, will still be running when
           the range switch ended. From that follows, that no references to the
           metadata as it was before the range switch, can still exist after the
           range switch - it is thus safe to delete the unreferred columns */
        try
        {
                if (ColumnsCleanup())
                {
                        //succesfuly cleaned everything, go to next phase
                        next_chore = RangeSwitch;
                        next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitRestartChores,janitor_maxwait));
                        return;
                }
        }
        catch (std::exception &e) //ADDME:Log!
        {
                Blex::ErrStream() << "Database table&column cleanup failed, exception: " << e.what();
        }
        next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextTask,janitor_maxwait));
}

void Willie::DestroyHintedRecords(std::vector<uint8_t> *currentblobdata)
{
        std::vector< unsigned > section_clean_hints;
        unsigned size;
        {
                LockedAdmin::WriteRef lock(admin);
                size = lock->section_clean_hints.size();
        }

        // Preallocate enough room
        section_clean_hints.reserve(size + 1024);

        {
                // Copy within the lock - not nice, but so we have a better idea how many hints are still outstanding
                LockedAdmin::WriteRef lock(admin);
                section_clean_hints.assign(lock->section_clean_hints.begin(), lock->section_clean_hints.end());
        }

        if (section_clean_hints.empty())
            return;

        DatabaseLocker db_locker(rawdb);
        MetadataManager::Ref meta(backend.GetMetadataManager());
        Blex::SectionUpdateHistory history;

        std::vector< RecordId > destroyable;
        for (std::vector< unsigned >::const_iterator it = section_clean_hints.begin(), end = section_clean_hints.end();
                it != end; ++it)
        {
                Delay(25, "DoImmediateChores: Clean section " + Blex::AnyToString(*it));
                DEBUGPRINT("Janitor: Trying to clean section " << *it);

                // Erase hints from the set before we process them
                {
                        LockedAdmin::WriteRef lock(admin);
                        lock->section_clean_hints.erase(*it);
                        DEBUGPRINT("Hints left: " << lock->section_clean_hints.size());
                }

                //clear another section
                destroyable.clear();

                // Get table id of this section and its tabledef
                TableId sectiontableid = rawdb.Deprecated_GetSectionTableId(*it);
                if (sectiontableid == 0)
                    continue;


//                TableDef const *tabledef = meta->GetTableDef(sectiontableid);
//                if (!tabledef)
//                {
//                        //ADDME: check this: i think this will happen if a table is scanned, dropped, and the hint still comes in
//                        DEBUGPRINT("Invoked cleanup for section " << *it << " owned by table " << sectiontableid << " but this table is no longer in metadata");
//                        continue;
//                }

//                // Move the sectionviewer over the section, to trigger invisible record updating
//                {
//                        RawDatabase::SectionViewer viewer(rawdb, sectiontableid, metatrans->GetIdentifiedTrans(), ShowNormal);
//
//                        if (viewer.MoveToSection(*it))
//                            while (viewer.NextViewInSection());
//                }

                // Get permanently invisible records
                rawdb.ReturnDestroyableRecords(sectiontableid, *it, &destroyable);

                // If blobs needs to be marked, mark the blobs of all destroyed records
                if (currentblobdata && !destroyable.empty())
                {
                        TableDef const *tabledef = meta->GetTableDef(sectiontableid);
                        if (tabledef)
                            MarkUsedBlobs(db_locker, tabledef, destroyable, currentblobdata);
                }

                // Destroy the records
                for (std::vector< RecordId >::const_iterator killitr = destroyable.begin();
                     killitr!=destroyable.end();
                     ++killitr)
                {
                        backend.JanitorDestroyRecord(db_locker, sectiontableid, *killitr, history/*, tabledef!=NULL*/);
                }
        }

        Delay(100, "DoImmediateChores: Syncing");
        if (!history.ForceSyncAll()) //failed to properly synchronise our changes
            throw Exception(ErrorIO,"Unable to flush database cleanups to disk");
}

void Willie::DoImmediateChores()
{
        // Wait a second to make sure the identified_trans structs of finished transactions are also destructed
        Delay(1000, "DoImmediateChores: collapse hints");

        DestroyHintedRecords(0);

        Delay(WaitImmediateChores * 1000, "DoImmediateChores: Post cleanup idling");
}

void Willie::DoSetFileTimeStamps()
{
        /* For incremental backups, we need to reset the modification timestamps
           for all files that are essential; these are:
           - *.whrf : table files (whrfsc are caches, and invalid during running of the db)
           - blobmap.whdb
           - translog.whdb
           All index*.* files are only valid after shutdown, but not during running
        */
        Delay(0, "DoSetFileTimstamps");
        backend.UpdateFileTimeStamps();
}

void Willie::GenerationalCleanupUnusedSections()
{
        Delay(0, "GenerationalCleanupUnusedSections");
        backend.GenerationalCleanupUnusedSections(&volatile_abortflag);
        next_section_clean = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitNextSectionGeneration, GetMaxWait(LockedAdmin::ReadRef(admin))));
}

void Willie::GetWillieState(WillieState *newstate)
{
        LockedAdmin::WriteRef lock(admin);
        newstate->nexttask = lock->nexttask;
        newstate->numhints = lock->section_clean_hints.size();
        newstate->waituntil = lock->waituntil;
        newstate->maxwait = lock->maxwait;
}

void Willie::SetWillieMaxWait(unsigned maxwait)
{
        {
                LockedAdmin::WriteRef lock(admin);
                lock->maxwait = maxwait;
                lock->skipnextchorewait = true;
        }
        admin.SignalAll();
}

void Willie::DoFullFlush()
{
        Delay(0, "DoPeriodicFlush");

        rawdb.SyncAllTableFiles();
        backend.GetIndexSystem()->SyncIndexFiles();
        next_full_flush = Blex::DateTime::Now() + Blex::DateTime::Seconds(FlushInterval);
}
void Willie::ThreadCode()
{
        try
        {
                next_chore = InitCleanup;
                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(std::min(WaitFirstChore, GetMaxWait(LockedAdmin::ReadRef(admin))));
                next_section_clean = Blex::DateTime::Min();
                next_full_flush = Blex::DateTime::Now() + Blex::DateTime::Seconds(FlushInterval);

                while (true) //repeat ad infinitum
                {
                        bool have_immediate_chores;
                        bool have_scheduled_chore = false;

                        while (true) //wait for something to do
                        {
                                LockedAdmin::WriteRef lock(admin);
                                if (lock->abortflag)
                                    return;

                                if (lock->skipnextchorewait)
                                {
                                        next_time = Blex::DateTime::Min();
                                        lock->skipnextchorewait = false;
                                }

                                have_immediate_chores = lock->HaveImmediateChore();

                                // Do scheduled chores immediately when transaction range is almost exhausted
                                if (rawdb.GetTransLog().IsTransactionRangeAlmostExhausted())
                                    next_time = Blex::DateTime::Min();

                                Blex::DateTime current_time = Blex::DateTime::Now();
                                if (current_time >= next_time)
                                    have_scheduled_chore = true;
                                if (current_time < next_time-Blex::DateTime::Seconds(TimeLeapGuard))
                                {
                                        DEBUGPRINT("Willie: Backwards time jump detected! Assuming timer expired");
                                        have_scheduled_chore = true;
                                        next_section_clean = Blex::DateTime::Min();
                                }

                                if (have_immediate_chores || have_scheduled_chore || next_section_clean <= current_time)
                                    break; //it's time to do a chore!

                                Blex::DateTime until = next_section_clean < next_time ? next_section_clean : next_time;
                                if(until > next_full_flush)
                                       until = next_full_flush;

                                DEBUGPRINT("Willie: Sleeping for " << ((until - current_time).GetMsecs()/1000) << " seconds");
                                lock->waituntil = until;
                                switch(next_chore)
                                {
                                case InitCleanup: lock->nexttask = "InitCleanup"; break;
                                case RangeSwitch: lock->nexttask = "RangeSwitch"; break;
                                case RangeSwitchComplete: lock->nexttask = "RangeSwitchComplete"; break;
                                case CleanupTablesColumns: lock->nexttask = "CleanupTablesColumns"; break;
                                default: lock->nexttask = "unknown"; break;
                                }
                                lock.TimedWait(until);
                        }
                        DEBUGPRINT("Willie: Executing chores (imm: " << (have_immediate_chores?"Yes":"No") << ", sched: " << (have_scheduled_chore?"Yes":"No") << ")");

                        Blex::DateTime current_time = Blex::DateTime::Now();
                        if (next_section_clean <= current_time)
                            GenerationalCleanupUnusedSections();
                        if (next_full_flush <= current_time)
                            DoFullFlush();

                        if (have_immediate_chores)
                            DoImmediateChores();

                        if (have_scheduled_chore)
                        {
                                // Set the filestamps of all files that are not caches
                                DoSetFileTimeStamps();

                                //execute next scheduled chore
                                switch (next_chore)
                                {
                                case InitCleanup:
                                        InitDatabaseCleanup();
                                        break;
                                case RangeSwitch:
                                        DoRangeSwitch();
                                        break;
                                case RangeSwitchComplete:
                                        DoRangeSwitchComplete();
                                        break;
                                case CleanupTablesColumns:
                                        DoCleanupTablesColumns();
                                        break;
                                }
                        }
                }
        }
        catch (WillieAbort &)
        {
                //eat this exception - it's our Cancel!
        }
}

}
