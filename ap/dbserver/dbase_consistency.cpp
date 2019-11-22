#include <ap/libwebhare/allincludes.h>


#include "dbase_backend.h"
#include "dbase_transaction.h"

//#define DAMMIT_ALL
//#define DO_ALL_TABLES

namespace Database
{

ConsistencyManager::ConsistencyManager(Backend &backend)
: backend(backend)
{
}

void ConsistencyManager::CheckInsertsForTableExistance(BackendTransaction &trans)
{
        LocalModifications const &mods = trans.GetModifications();
        std::vector< TableId > modified_tables;
        mods.GetListOfModifiedTables(&modified_tables);

        // Get database view of metadata (to see what REALLY exists, not this transaction's view)
        MetadataManager::Ref database_view_metadata(backend.GetMetadataManager());

        for (std::vector< TableId >::const_iterator it = modified_tables.begin(); it != modified_tables.end(); ++it)
        {
                TableDef const *insert_table = database_view_metadata->GetTableDef(*it);
                if (!insert_table && !mods.IsTableLocallyCreated(*it)) //it might be missing because _we_ created it...
                    throw Exception(ErrorConstraint,"Insert performed in table that has been dropped in parallel transaction");
        }
}

void ConsistencyManager::GetForeignReferrers(BackendTransaction &trans, TableDef const *referenced_table, ColumnList &referrers)
{
        if (!referenced_table->primarykey)
            return;

        //Loop through all existing tables
        for (Metadata::TableCItr tableitr(trans.GetMetadata().GetTables().begin());
             tableitr!=trans.GetMetadata().GetTables().end();
             ++tableitr)
        {
                //For every table, loop through all columns. No need to process foreignrefersbycolumn here, it must be foreigncascade.
                for (TableDef::ColumnCItr columnitr = tableitr->second.GetColumns().begin();
                     columnitr != tableitr->second.GetColumns().end();
                     ++columnitr)
                    if (!columnitr->second.internal
//                        && columnitr->second.ondelete == ForeignIllegal // Check ALL references, not only on delete illegal
                        && columnitr->second.foreignreference==referenced_table->object_id)
                {
                        referrers.push_back(std::make_pair(&tableitr->second, &columnitr->second));
                }
        }
}

void ConsistencyManager::CheckUniques(BackendTransaction &trans)
{
        LocalModifications const &mods = trans.GetModifications();

        std::vector< TableId > modified_tables;
#ifdef DO_ALL_TABLES
        Metadata::Tables const &tables = trans.GetMetadata().GetTables();
        for (Metadata::Tables::const_iterator it = tables.begin(); it != tables.end(); ++it)
            modified_tables.push_back(it->second.id);
#else
        mods.GetListOfModifiedTables(&modified_tables);
#endif

        for (std::vector< TableId >::iterator titr = modified_tables.begin(); titr != modified_tables.end(); ++titr)
        {
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(*titr);
                if (!tabledef)
                {
                        DEBUGPRINT("Can't check uniques for table #" << Blex::AnyToString(*titr) << ", table missing");
                        continue;
                }

                DEBUGPRINT("Checking uniques in " << tabledef->name);

                std::vector< RecordId > sourcelist;

                //Scan all 'simple' uniques
                TableDef::Columns const &columns = tabledef->GetColumns();
                for (TableDef::Columns::const_iterator cit = columns.begin(); cit != columns.end(); ++cit)
                    if (cit->second.unique)
                    {
                        mods.GetAddedCells(*titr, cit->second.column_id, &sourcelist);
//                        mods.GetChangedRecordsFinals(*titr, &sourcelist);

                        // No modified cells for this column; check next
                        if (sourcelist.empty())
                            continue;

                        Scanner find_dupes(trans, ShowAfterCommit, false);
#ifdef DAMMIT_ALL
                        find_dupes.AddTable(*titr);
#else
                        find_dupes.AddRecordSet(*titr, sourcelist, true);
#endif
                        find_dupes.AddRawSearch(0, cit->second.column_id, 0, 0, SearchUnEqual, true);

                        find_dupes.AddTable(*titr);
                        find_dupes.AddJoin(0, cit->second.column_id, false
                                          ,1, cit->second.column_id, false
                                          ,SearchEqual, true);

                        while (find_dupes.NextRow())
                        {
                                if (find_dupes.GetRowPartRecordId(0) != find_dupes.GetRowPartRecordId(1))
                                        throw Exception(ErrorConstraintUnique,"Value for " + tabledef->parent_object->name + "." + tabledef->name + ":" + cit->second.name + " is not unique", tabledef->name, cit->second.name);
                        }
                    }

                bool req_changed_recs = false;

                //Check all complex indices
                for (TableDef::Indices::const_iterator indexit = tabledef->GetAdditionalIndices().begin(); indexit != tabledef->GetAdditionalIndices().end(); ++indexit)
                    if (indexit->unique)
                    {
                            if (!req_changed_recs)
                            {
                                    mods.GetChangedRecordsFinals(*titr, &sourcelist);
                                    req_changed_recs = true;

                                    // No records to check -> quit check.
                                    if (sourcelist.empty())
                                        break;
                            }

                            Scanner find_dupes(trans, ShowAfterCommit, false);
#ifdef DAMMIT_ALL
                            find_dupes.AddTable(*titr);
#else
                            find_dupes.AddRecordSet(*titr, sourcelist, true);
#endif
                            find_dupes.AddTable(*titr);
                            for (unsigned i=0;i<indexit->descr.num_indexed_columns;++i)
                            {
                                    // Ignore NULLs
                                    find_dupes.AddRawSearch(0, indexit->descr.columns[i], 0, 0, SearchUnEqual, true);
                                    find_dupes.AddJoin(0, indexit->descr.columns[i], false,
                                                       1, indexit->descr.columns[i], false,
                                                       SearchEqual,
                                                       /*casesensitive=*/indexit->descr.storage[i] != Index::StoreUppercase);
                            }

                            while (find_dupes.NextRow())
                            {
                                    if (find_dupes.GetRowPartRecordId(0) != find_dupes.GetRowPartRecordId(1))
                                    {
                                            DEBUGPRINT("Value in " << tabledef->name << ":" << indexit->name << " is not unique, offending row:");
                                            DumpCurrentRow(find_dupes);
#if 1 && defined(DEBUG)
                                            DEBUGPRINT("Showing entire table:");
                                            Scanner show_all(trans, ShowAfterCommit, false);
                                            show_all.AddTable(*titr);
                                            while (show_all.NextRow())
                                                DumpCurrentRow(show_all);
#endif
                                            throw Exception(ErrorConstraintUnique,"Value in " + tabledef->parent_object->name + "." + tabledef->name + ":" + indexit->name + " is not unique", tabledef->name, "");
                                    }
                            }
                    }
        }
}


void ConsistencyManager::CheckDeadReferences(BackendTransaction &trans)
{
/*
Dead reference checking
  Per table:
    Gather list of records WE deleted.
    Determine per referenced column:
      Weed list of deleted records (join deleted records with current records)
        remove record from deleted list if a join comes up
      Join deleted records with all referencing columns
        error if a result comes up.
*/
        LocalModifications const &mods = trans.GetModifications();

        std::vector< TableId > modified_tables;
        mods.GetListOfModifiedTables(&modified_tables);

        for (std::vector< TableId >::iterator titr = modified_tables.begin(); titr != modified_tables.end(); ++titr)
        {
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(*titr);
                if (!tabledef)
                    continue;

                // For all referred to columns (now only table->primarykey)
                if (!tabledef->primarykey)
                    continue;

                // Get the referrers to this column
                ColumnList referrers;
                GetForeignReferrers(trans, tabledef, referrers);

                if (referrers.empty()) // Don't bother checking, there are no referrers anyway
                    continue;

                std::vector< RecordId > sourcelist;
                mods.GetDeletedRecords(*titr, &sourcelist);
                if (sourcelist.empty()) //don't bother building if there are no deletions
                    continue;

                ColumnDef const *columndef = tabledef->GetColumnDef(tabledef->primarykey);

                // Filter out all reinserted stuff
                //   SELECT FROM tabledef (source: deleted records) AS T1, tabledef AS T2 WHERE T1.primarykey = T2.primarykey
                // ADDME: SHouldn't this use the same trick as insert/update checking to avoid referring record inserted by a secondary transaction?
                Scanner weedscan(trans, ShowAfterCommit, false);
                weedscan.AddRecordSet(*titr, sourcelist, true);
                weedscan.AddTable(*titr);
                weedscan.AddJoin(0, tabledef->primarykey, false, 1, tabledef->primarykey, false, SearchEqual, true);
                while (weedscan.NextRow())
                {
                        RecordId recid = weedscan.GetRowPartRecordId(0);
                        std::vector< RecordId >::iterator sit = std::lower_bound(sourcelist.begin(), sourcelist.end(), recid);
                        if (sit != sourcelist.end() && *sit == recid)
                            sourcelist.erase(sit);
                }

                // it->second now contains the list with all recordid that had their value conclusively deleted
                for (ColumnList::iterator rit = referrers.begin(); rit != referrers.end(); ++rit)
                {
                        // SELECT FROM tabledef (source: deleted records), referrer WHERE referrer.refer_column = tabledef.primarykey
                        Scanner referscan(trans, ShowAfterCommit, false);
                        referscan.AddRecordSet(*titr, sourcelist, true);
                        referscan.AddTable(rit->first->object_id);
                        referscan.AddJoin(0, tabledef->primarykey, false, 1, rit->second->column_id, false, SearchEqual, true);
                        referscan.AddRawSearch(0, tabledef->primarykey, 0, NULL, SearchUnEqual, true); //Never fail on NULL (although primary keys should never be NULL, file errors can cause this)
                        if (referscan.NextRow())
                        {
                                throw Exception(ErrorConstraintReference,
                                        "Column "
                                                + tabledef->parent_object->name + "." + tabledef->name + ":" + columndef->name
                                                + " does not tolerate deletion of record, because of a reference from "
                                                + rit->first->parent_object->name + "." + rit->first->name + ":" + rit->second->name
                                                + ". Primary key: " + referscan.GetRowPartCellDump(0, tabledef->primarykey),
                                        tabledef->parent_object->name + "." + tabledef->name, columndef->name);
                        }
                }
        }
}

void ConsistencyManager::CheckLiveReferencesPreCommit(BackendTransaction &trans, CheckData &checkdata)
{
/*
Live reference checking
  Per table:
    Gather list of records WE inserted.
    Per referencing column
      Weed out NULL's
      Join with referenced column
        No join record for an inserted record: signal problemo!
*/
        LocalModifications const &mods = trans.GetModifications();

        std::vector< TableId > modified_tables;
#ifdef DO_ALL_TABLES
        Metadata::Tables const &tables = trans.GetMetadata().GetTables();
        for (Metadata::Tables::const_iterator it = tables.begin(); it != tables.end(); ++it)
            modified_tables.push_back(it->second.id);
#else
        mods.GetListOfModifiedTables(&modified_tables);
#endif

        std::vector< RecordId > sourcelist;

        for (std::vector< TableId >::iterator titr = modified_tables.begin(); titr != modified_tables.end(); ++titr)
        {
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(*titr);
                if (!tabledef)
                    continue;

                TableDef::Columns const &columns = tabledef->GetColumns();
                for (TableDef::Columns::const_iterator cit = columns.begin(); cit != columns.end(); ++cit)
                {
                        if (cit->second.foreignreference || cit->second.foreignreferencesbycolumn)
                        {
                                mods.GetAddedCells(*titr, cit->first, &sourcelist);
                                std::sort(sourcelist.begin(), sourcelist.end());

                                if (sourcelist.empty())
                                    continue;

                                if (cit->second.foreignreference)
                                    CheckLiveReferencesInternalPreCommit(trans, *tabledef, cit->second, &sourcelist, checkdata);
                                else
                                    CheckLiveReferencesByColumnInternalPreCommit(trans, *tabledef, cit->second, &sourcelist, checkdata);
                        }
                }
        }
}

void ConsistencyManager::CheckLiveReferencesAtCommit(BackendTransaction &trans, CheckData &checkdata)
{
        for (std::map< TableId, std::set< RecordId > >::iterator it = checkdata.needed_records.begin(); it != checkdata.needed_records.end(); ++it)
        {
                TableId id = it->first;
                TableDef const *refdtabledef = trans.GetMetadata().GetTableDef(id);

                Scanner scan(trans, ShowAfterCommit, false);
                scan.AddRecordSet(it->first, it->second, true);

                while (scan.NextRow())
                    if (!scan.CanChaseToNowCommitted())
                        throw Exception(ErrorConstraintReference,"Cannot resolve reference to table " + refdtabledef->parent_object->name + "." + refdtabledef->name + ", because referenced record was deleted.", refdtabledef->parent_object->name + "." + refdtabledef->name);
        }
}

template <class behhh> std::ostream & operator<<(std::ostream &out, std::set< behhh > const &rhs)
{
        out << "[";
        for (typename std::set< behhh >::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin())
                    out << ", ";
                out << *it;
        }
        return out << "]";
}

void ConsistencyManager::CheckLiveReferencesInternalPreCommit(BackendTransaction &trans, TableDef const &tabledef, ColumnDef const &columndef, std::vector< RecordId > const *added_ids, CheckData &checkdata) const
{
        DEBUGPRINT("Checking " << (added_ids ? "some" : "all") << " live references from " << tabledef.parent_object->name << "." << tabledef.name << ":" << columndef.name);

        TableDef const *refdtabledef = trans.GetMetadata().GetTableDef(columndef.foreignreference);
        if (!refdtabledef) // Table deleted?
            throw Exception(ErrorInternal,"Referenced table has disappeared");

        std::set< RecordId > nnsourcelist;

        // SELECT FROM reftable WHERE reftable.recold != 0  (ADDME: distinct values only?)
        Scanner nnscan(trans, ShowNormalSkipAccess, false);

#ifndef DAMMIT_ALL
        if (added_ids)
            nnscan.AddRecordSet(tabledef.object_id, *added_ids, true);
        else
            nnscan.AddTable(tabledef.object_id);
#else
        nnscan.AddTable(tabledef.object_id);
#endif

        if (columndef.dangle_negative)
            nnscan.AddIntegerSearch(0, columndef.column_id, 0, SearchBigger);
        else
            nnscan.AddRawSearch(0, columndef.column_id, /*valuelen=*/0, /*value=*/0, SearchUnEqual, true);
        while (nnscan.NextRow())
        {
//                DumpCurrentRow(nnscan);
                nnsourcelist.insert(nnscan.GetRowPartRecordId(0));
        }

//        std::vector< RecordId > nnsourcelist_copy(nnsourcelist.begin(), nnsourcelist.end());
        std::set< RecordId > found_ids;

        // SELECT FROM reftable, refdtable WHERE reftable.recold = refdtable.primarykey
        Scanner scan(trans, ShowNormalSkipAccess, false);
        scan.AddRecordSet(tabledef.object_id, nnsourcelist, true);
        scan.AddTable(columndef.foreignreference);
        scan.AddJoin(0, columndef.column_id, false, 1, refdtabledef->primarykey, false, SearchEqual, true);

        std::set< RecordId > &referenced_ids = checkdata.needed_records[columndef.foreignreference];

        while (scan.NextRow())
        {
                found_ids.insert(scan.GetRowPartRecordId(0));
                referenced_ids.insert(scan.GetRowPartRecordId(1));
        }

        if (nnsourcelist != found_ids)
        {
                DEBUGPRINT(" NN source list " << nnsourcelist);
                DEBUGPRINT(" found id's " << found_ids);
                throw Exception(ErrorConstraintReference,"Cannot resolve reference for " + tabledef.parent_object->name + "." + tabledef.name + ":" + columndef.name + " to "
                    + refdtabledef->parent_object->name + "." + refdtabledef->name + ":" + refdtabledef->GetColumnDef(refdtabledef->primarykey)->name + " pre-transaction commit", tabledef.parent_object->name + "." + tabledef.name, columndef.name);
        }
}

void ConsistencyManager::CheckLiveReferencesByColumnInternalPreCommit(BackendTransaction &trans, TableDef const &tabledef, ColumnDef const &columndef, std::vector< RecordId > const *added_ids, CheckData &checkdata) const
{
        Scanner scan(trans, ShowNormalSkipAccess, false);

#ifndef DAMMIT_ALL
        if (added_ids)
            scan.AddRecordSet(tabledef.object_id, *added_ids, true);
        else
            scan.AddTable(tabledef.object_id);
#else
        scan.AddTable(tabledef.object_id);
#endif

        while (scan.NextRow())
        {
                TableId reftable = scan.GetRowPart(0).GetCell(columndef.foreignreferencesbycolumn).Integer();
                TableDef const *refdtabledef = trans.GetMetadata().GetTableDef(reftable);
                if (!refdtabledef) // Table deleted?
                    throw Exception(ErrorInternal,"Referenced table has disappeared");

                ColumnDef const *primcoldef = refdtabledef->GetColumnDef(refdtabledef->primarykey);
                if (!primcoldef)
                    throw Exception(ErrorConstraintReference,"Cannot resolve reference for " + tabledef.parent_object->name + "." + tabledef.name + ":" + columndef.name + " at transaction commit (no primary key)");
                if (primcoldef->type != columndef.type)
                    throw Exception(ErrorConstraintReference,"Cannot resolve reference for " + tabledef.parent_object->name + "." + tabledef.name + ":" + columndef.name + " at transaction commit (wrong type of data)");

                Cell searchfor = scan.GetRowPart(0).GetCell(columndef.column_id);

                Scanner oscan(trans, ShowNormalSkipAccess, false);
                oscan.AddTable(refdtabledef);
                oscan.AddRawSearch(0, refdtabledef->primarykey, searchfor.Size(), searchfor.Begin(), SearchEqual, true);
                if (oscan.NextRow())
                    checkdata.needed_records[reftable].insert(scan.GetRowPartRecordId(0));
                else
                    throw Exception(ErrorConstraintReference,"Cannot resolve reference for " + tabledef.parent_object->name + "." + tabledef.name + ":" + columndef.name + " at transaction commit", tabledef.parent_object->name + "." + tabledef.name, columndef.name);
        }
}
void ConsistencyManager::CheckColumnForUniqueness(BackendTransaction &trans, TableDef const *table, ColumnDef const *column)
{
        Scanner find_dupes(trans, ShowAfterCommit, false);

        find_dupes.AddTable(table);
        find_dupes.AddRawSearch(0, column->column_id, 0, 0, SearchUnEqual, true);

        find_dupes.AddTable(table);
        find_dupes.AddJoin(0, column->column_id, false, 1, column->column_id, false, SearchEqual, true);

        while (find_dupes.NextRow())
        {
                if (find_dupes.GetRowPartRecordId(0) != find_dupes.GetRowPartRecordId(1))
                    throw Exception(ErrorConstraintUnique,"Value for " + table->parent_object->name + "." + table->name + ":" + column->name + " is not unique", table->name, column->name);
        }
}

void ConsistencyManager::CheckColumnForNotNull(BackendTransaction &trans, TableDef const *table, ColumnDef const *column)
{
        Scanner nulls(trans, ShowAfterCommit, false);
        nulls.AddTable(table);
        nulls.AddRawSearch(0, column->column_id, 0, 0, SearchEqual, true);

        if (nulls.NextRow())
            throw Exception(ErrorConstraintNotNull,"Violated NOT NULL constraint on " + table->parent_object->name + "." + table->name + ":" + column->name, table->name, column->name);
}

void ConsistencyManager::CheckMetaUpdatedColumnsPreCommit(BackendTransaction &trans, CheckData &checkdata)
{
        BackendTransaction::MetaColumnsChanges const &changes = trans.GetMetaChangedColumns();

        for (BackendTransaction::MetaColumnsChanges::const_iterator it = changes.begin(), end = changes.end(); it != end; ++it)
        {
                //ADDME: These checks here are necessary because GetMetaChangedColumns() cannot be trusted yet, if a table is dropped.
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(it->first);
                if (!tabledef)
                    continue;

                ColumnDef const *columndef = tabledef->GetColumnDef(it->second);
                if (!columndef)
                    continue;

                if (columndef->foreignreference)
                    CheckLiveReferencesInternalPreCommit(trans, *tabledef, *columndef, 0, checkdata);
                if (columndef->foreignreferencesbycolumn)
                    CheckLiveReferencesByColumnInternalPreCommit(trans, *tabledef, *columndef, 0, checkdata);
        }
}

void ConsistencyManager::CheckMetaUpdatedColumnsAtCommit(BackendTransaction &trans)
{
        BackendTransaction::MetaColumnsChanges const &changes = trans.GetMetaChangedColumns();

        for (BackendTransaction::MetaColumnsChanges::const_iterator it = changes.begin(), end = changes.end(); it != end; ++it)
        {
                //ADDME: These checks here are necessary because GetMetaChangedColumns() cannot be trusted yet, if a table is dropped.
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(it->first);
                if (!tabledef)
                    continue;

                ColumnDef const *columndef = tabledef->GetColumnDef(it->second);
                if (!columndef)
                    continue;

                if (columndef->unique)
                    CheckColumnForUniqueness(trans, tabledef, columndef);
                if (columndef->notnull)
                    CheckColumnForNotNull(trans, tabledef, columndef);
        }
}

void ConsistencyManager::CheckRoleGrantsForUnique(BackendTransaction &trans)
{
        LocalModifications const &mods = trans.GetModifications();

        // Quick check, avoid building a scanner if no updates are detected
        if (!mods.HasTableModified(TableId_MetaRoleGrants))
            return;

        std::vector< RecordId > sourcelist;
        mods.GetAddedCells(TableId_MetaRoleGrants, MetaRoleGrants_Id, &sourcelist);

        Scanner find_dupes(trans, ShowAfterCommit, false);
        find_dupes.AddRecordSet(TableId_MetaRoleGrants, sourcelist, true);
        find_dupes.AddTable(TableId_MetaRoleGrants);

        find_dupes.AddJoin(0, MetaRoleGrants_Role, false, 1, MetaRoleGrants_Role, false, SearchEqual, true);
        find_dupes.AddJoin(0, MetaRoleGrants_Grantor, false, 1, MetaRoleGrants_Grantor, false, SearchEqual, true);
        find_dupes.AddJoin(0, MetaRoleGrants_Grantee, false, 1, MetaRoleGrants_Grantee, false, SearchEqual, true);
        find_dupes.AddJoin(0, MetaRoleGrants_Id, false, 1, MetaRoleGrants_Id, false, SearchUnEqual, true);

        if (find_dupes.NextRow())
            throw Exception(ErrorConstraintUnique,"Conflict with concurrent role grant detected");
}

void ConsistencyManager::CheckPrivilegeGrantsForUnique(BackendTransaction &trans)
{
        LocalModifications const &mods = trans.GetModifications();

        // Quick check, avoid building a scanner if no updates are detected
        if (!mods.HasTableModified(TableId_MetaGrants))
            return;

        std::vector< RecordId > sourcelist;
        mods.GetAddedCells(TableId_MetaGrants, MetaGrants_Id, &sourcelist);

        Scanner find_dupes(trans, ShowAfterCommit, false);
        find_dupes.AddRecordSet(TableId_MetaGrants, sourcelist, true);
        find_dupes.AddTable(TableId_MetaGrants);

        find_dupes.AddJoin(0, MetaGrants_Object, false, 1, MetaGrants_Object, false, SearchEqual, true);
        find_dupes.AddJoin(0, MetaGrants_Grantor, false, 1, MetaGrants_Grantor, false, SearchEqual, true);
        find_dupes.AddJoin(0, MetaGrants_Grantee, false, 1, MetaGrants_Grantee, false, SearchEqual, true);
        find_dupes.AddJoin(0, MetaGrants_Id, false, 1, MetaGrants_Id, false, SearchUnEqual, true);

        if (find_dupes.NextRow())
            throw Exception(ErrorConstraintUnique,"Conflict with concurrent privilege grant detected");
}

void ConsistencyManager::ExecutePreLockChecks(BackendTransaction &trans, CheckData &checkdata)
{
        trans.SetStage("C:PRE-METACOL");
        CheckMetaUpdatedColumnsPreCommit(trans, checkdata);
        trans.SetStage("C:PRE-LIVEREFS");
        CheckLiveReferencesPreCommit(trans, checkdata);

        checkdata.is_valid = true;
}

void ConsistencyManager::ExecuteCommitLockChecks(BackendTransaction &trans, CheckData &checkdata)
{
        trans.SetStage("C:COMM-METACOL");
        CheckMetaUpdatedColumnsAtCommit(trans);
        trans.SetStage("C:COMM-TABLES");
        CheckInsertsForTableExistance(trans);
        trans.SetStage("C:COMM-DEADREFS");
        CheckDeadReferences(trans);
        trans.SetStage("C:COMM-LIVEREFS");
        CheckLiveReferencesAtCommit(trans, checkdata);
        trans.SetStage("C:COMM-UNIQUE");
        CheckUniques(trans);
        trans.SetStage("C:COMM-ROLEGRANTS");
        CheckRoleGrantsForUnique(trans);
        trans.SetStage("C:COMM-PRIVGRANTS");
        CheckPrivilegeGrantsForUnique(trans);
}


} //end namespace Database

