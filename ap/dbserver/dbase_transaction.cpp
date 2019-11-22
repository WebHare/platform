#include <ap/libwebhare/allincludes.h>


#include "dbase_transaction.h"
#include <ap/libwebhare/whrpc_server.h>


//#define SHOWTRANSCREATE

#ifdef SHOWTRANSCREATE
 #define TRANSCREATEPRINT(x) DEBUGPRINT(x)
#else
 #define TRANSCREATEPRINT(x) (void)0
#endif

namespace Database
{

BackendTransaction::BackendTransaction(Backend &_dbase, bool client_trans)
 : transcontextkeeper(_dbase.GetTransRegistrator())
 , backend(_dbase)
 , consmgr(_dbase)
 , identified_trans(backend.GetTransLog(), client_trans)
 , locker(backend.rawdb)
 , blobuser(_dbase.GetBlobMgr())
 , metadata(backend.GetMetadataManager())
 , is_metadata_modified(false)
 , is_committed(false)
 , cascade_deletes(true)
 , may_time_out(true)
 , clustering_updates(false)
 , is_backup_transaction(false)
 , do_accessmsg_checks(!_dbase.IsInRecoveryMode())
 , state(TransactionState::Normal)
 , abortflag(0)
{
        TRANSCREATEPRINT("BTransaction " << this << " create - " << GetTransId());
        backend.lockmanager.RegisterTransaction(this);
        RebuildPrivilegeCache();
}

BackendTransaction::~BackendTransaction()
{
        TRANSCREATEPRINT("BTransaction " << this << " destroy - " << GetTransId() << ", state: " << Blex::AnyToString(state));
        if (state == TransactionState::Normal)
        {
                backend.lockmanager.UnregisterTransaction(this);
        }
        backend.rawdb.UnregisterTransaction(identified_trans.GetTransId(), is_committed);
}

//ADDME: Move the transaction-local privilege cache to dbase_privileges
void BackendTransaction::RebuildPrivilegeCache()
{
        /* Roles in all_roles can have become invalid due to metadata re-read.
            It might be possible you want to delete a role automatically added to you, so we just erase all
            roles that have become invalid. But, we still bork on erasing all_roles[0], because that is the
            current user role id.  */
        for (std::vector< RoleId >::iterator it = base_roles.begin(); it != base_roles.end();)
        {
                RoleDef const *roledef = GetMetadata().Privs().GetRoleDef(*it);
                if (!roledef)
                {
                        if (it == base_roles.begin())
                            throw Exception(ErrorInternal, "Role for current user has been erased");
                        it = base_roles.erase(it);
                }
                else
                    ++it;
        }

        CalculateEnabledRoles();
        object_grants.clear();
}
void BackendTransaction::CalculateApplicableRoles(std::vector< RoleId > const &source_roles, std::vector< RoleId > *applicable_roles)
{
        // Calculate applicable roles - merge roles applicable to source_roles and roles applicable to PUBLIC
        GetMetadata().Privs().GetContainedRoles(source_roles, false, applicable_roles); // No problem here if &source_roles == applicable_roles.
        GetMetadata().Privs().GetContainedRoles(std::vector< RoleId >(1, MetaRole_PUBLIC), false, applicable_roles);

        // Remove all double roles
        std::sort(applicable_roles->begin(), applicable_roles->end());
        applicable_roles->erase(std::unique(applicable_roles->begin(), applicable_roles->end()), applicable_roles->end());
}

void BackendTransaction::CalculateEnabledRoles()
{
        enabled_roles = base_roles;
        CalculateApplicableRoles(enabled_roles, &enabled_roles);
}

//PVT
void BackendTransaction::CalculateCurrentPrivilegesFor(ObjectDef const &objdef, PrivilegeDescriptor &desc)
{
        // Get privileges of parent (if applicable), use the cache.
        if (objdef.parent_object)
            desc = GetCurrentPrivilegesFor(*objdef.parent_object);
        else
            desc.Clear();

        for (std::vector< RoleId >::const_iterator it = enabled_roles.begin(); it != enabled_roles.end(); ++it)
        {
                RoleDef const *roledef = GetMetadata().Privs().GetRoleDef(*it);
                if (!roledef)
                    throw Exception(ErrorInternal,"Role #" + Blex::AnyToString(*it) + " does not exist");
                GetMetadata().Privs().MergeDirectPrivilegesForSingleObject(roledef, objdef, &desc);
        }

        GetMetadata().Privs().MergeDirectPrivilegesForSingleObject(GetMetadata().Privs().GetRoleDef(MetaRole_PUBLIC), objdef, &desc);
}

//PVT
PrivilegeDescriptor const & BackendTransaction::GetCurrentPrivilegesFor(ObjectDef const &objdef)
{
        std::map< ObjectId, PrivilegeDescriptor >::iterator it = object_grants.find(objdef.object_id);
        if (it == object_grants.end())
        {
                // Calculate privileges
                PrivilegeDescriptor p;
                CalculateCurrentPrivilegesFor(objdef, p);

                it = object_grants.insert(std::make_pair(objdef.object_id, p)).first;
        }
        return it->second;
}

bool BackendTransaction::HasPrivilege(ObjectId id, Privilege::_type priv)
{
        ObjectDef const * objdef = GetMetadata().GetObjectDef(id);
        if (!objdef)
            throw Exception(ErrorInternal,"Illegal object referenced");

        // If a parent-object is present, check that first.
        if (objdef->parent_object && HasPrivilege(objdef->parent_object->object_id, priv))
            return true;

        return GetCurrentPrivilegesFor(*objdef).HasPrivilege(priv);
}
bool BackendTransaction::HasPrivilegeOnAnyColumn(TableId id, Privilege::_type priv)
{
        /* ADDME: also support schema/table relations?! we need an easier way
                  to query object children, converting the multimap into a map
                  on objectid,name would help */
        TableDef const *tabledef = GetMetadata().GetTableDef(id);
        if (!tabledef)
            throw Exception(ErrorInternal,"Sorry, HasPrivilegeOnAnyColumn only supports tables right now");
        for (TableDef::ColumnCItr colitr=tabledef->GetColumns().begin();colitr!=tabledef->GetColumns().end();++colitr)
          if (GetCurrentPrivilegesFor(colitr->second).HasPrivilege(priv))
            return true;
        return false;
}

bool BackendTransaction::IsRoleEnabled(RoleId role)
{
        return std::binary_search(enabled_roles.begin(), enabled_roles.end(), role);
}

void BackendTransaction::ClearRoles()
{
        base_roles.clear();
        RebuildPrivilegeCache();
}

void BackendTransaction::AddBaseRole(RoleId id)
{
        if (!GetMetadata().Privs().GetRoleDef(id))
            throw Exception(ErrorInvalidArg,"Trying to add non-existing role #" + Blex::AnyToString(id));

        if (id==MetaRole_BACKUP) //backup transactions cannot time out
            may_time_out=false;

        //ADDME: Perhaps don't add roles if we already have them enabled?
        if (std::find(base_roles.begin(), base_roles.end(), id) == base_roles.end())
        {
                base_roles.push_back(id);
                RebuildPrivilegeCache();
        }
}

bool BackendTransaction::IsRoleGrantable(RoleId role)
{
        for (std::vector< RoleId >::const_iterator itr=base_roles.begin(); itr != base_roles.end(); ++itr)
          if (GetMetadata().Privs().IsRoleGrantableByRole(role, *itr))
            return true;
        return false;
}

void BackendTransaction::SetBaseRoles(RoleIds const &newroles, bool skip_security)
{
        if (!skip_security)
        {
                for (unsigned i=0;i<newroles.size();++i)
                    if (!IsRoleEnabled(newroles[i]))
                    {
                            RoleDef const *roledef = GetMetadata().Privs().GetRoleDef(newroles[i]);
                            if (!roledef)
                                throw Exception(ErrorReadAccessDenied, "Not allowed to set base role " + Blex::AnyToString((int32_t)newroles[i]) + ", it doesn't exist");
                            else
                                throw Exception(ErrorReadAccessDenied, "Not allowed to set base role " + roledef->schema->name + "." + roledef->name + ", it isn't enabled");
                    }
        }

        base_roles = newroles;
        RebuildPrivilegeCache();
}


void BackendTransaction::SwitchToState(TransactionState::Type newstate)
{
        DEBUGPRINT("Switching state of transaction " << GetTransId() << " from " << Blex::AnyToString(state) << " to " << Blex::AnyToString(newstate));

        if (state == newstate)
            return;
        if (state != TransactionState::Normal || newstate == TransactionState::Normal)
            throw Exception(ErrorInternal,"Illegal transition of transaction state requested");

        // Inv: state == Normal, newstate == ReadOnly || newstate == ReadOnlyAfterError
        identified_trans.MarkTransactionRolledBack();
        backend.lockmanager.UnregisterTransaction(this);
        state = newstate;
}

void BackendTransaction::RefreshMetadata(bool allow_grant_inconsistencies)
{
        HotMetadata newmetadata(backend.GetMetadataManager());
        uint32_t newversionid = backend.GetMetadataManager().AllocateNewVersionId();
        newmetadata.ReadMetadata(*this, /*aftercommit=*/false, allow_grant_inconsistencies, newversionid);

        // Swap the old metadata with the newly read one
        metadata.SwapMetadata(&newmetadata);

        /* Rebuild privilege cache before any other transaction processing (specifically accessing base_roles,
           that can now contain invalid role ids) */
        RebuildPrivilegeCache();
}

int32_t BackendTransaction::GetNewColumnId(TableDef const &tabledef)
{
        //Process all metadata, looking for a free tableid
        std::vector<ColumnId> columnids;

        Scanner scan(*this,ShowAfterCommit, false);
        scan.AddTable(TableId_MetaColumns);
        scan.AddTable(TableId_MetaObjects);
        scan.AddIntegerSearch(1, MetaObjects_Parent, tabledef.object_id, Database::SearchEqual);
        scan.AddJoin(0, MetaColumn_ObjectId, false, 1, MetaObjects_ObjectId, false, SearchEqual, true);

        while (scan.NextRow())
            columnids.push_back(static_cast<ColumnId>(scan.GetRowPart(0).GetCell(MetaColumn_ColumnId).Integer()));

        //Now grab a free column id (ADDME: sync with other transactions)
        for (ColumnId next_columnid  = MinimumExternalId;;++next_columnid)
        {
                if (std::find(columnids.begin(),columnids.end(),next_columnid) == columnids.end())
                    return next_columnid;
        }
}

RecordOverride::_type BackendTransaction::GetRecordOverride(TableId tableid, RecordId recordid)
{
        RecordOverrides::key_type key = std::make_pair(tableid, recordid);

        // First check the overrides of the current command (they take precedent)
        { // Keep first_it local
                RecordOverrides::iterator first_it = new_overrides.find(key);
                if (first_it != new_overrides.end())
                    return first_it->second;
        }
        RecordOverrides::iterator second_it = overrides.find(key);
        if (second_it == overrides.end())
            return RecordOverride::Normal;
        return second_it->second;
/*old code
        RecordOverrides::iterator it = overrides.find(std::make_pair(tableid, recordid));
        if (it == overrides.end())
            return RecordOverride::Normal;
        else
            return it->second;
*/
}
void BackendTransaction::SetRecordOverride(TableId tableid, RecordId recordid, RecordOverride::_type type)
{
        new_overrides[std::make_pair(tableid, recordid)] = type;
/*old code
        if (type == RecordOverride::Normal)
            overrides.erase(std::make_pair(tableid, recordid));
        else
            overrides[std::make_pair(tableid, recordid)] = type;
*/
}

void BackendTransaction::FinishCommand()
{
//        DEBUGPRINT("Finishing updates made by previous commands");
        if (cascade_deletes)
        {
                // Cascade deletes
                DeletionList all_deletes;
                DeletionList deletes;
                while (true)
                {
                        local_modifications.GetNewDeletes(&deletes);
                        if (deletes.empty())
                            break;

                        for (DeletionList::const_iterator delitr = deletes.begin(); delitr != deletes.end(); ++delitr)
                        {
                                TableDef const *tabledef = metadata->GetTableDef(delitr->first);
                                if (!tabledef)
                                    throw Exception(ErrorInternal,"Cascading deletes in already dropped table");
                                CascadeDeletes(*tabledef, delitr->second);
                                all_deletes[delitr->first].insert(delitr->second.begin(), delitr->second.end());
                        }
                }

                for (DeletionList::const_iterator it = all_deletes.begin(); it != all_deletes.end(); ++it)
                {
                        TableDef const *tabledef = metadata->GetTableDef(it->first);
                        if (!tabledef)
                            throw Exception(ErrorInternal,"Cascading deletes in already dropped table");
                        SetToDefaults(*tabledef, it->second);
                }
        }
        else
        {
                // Clear deletes for this command
                DeletionList deletes;
                local_modifications.GetNewDeletes(&deletes);
        }

        // Copy new overrides to old overrides
        for (RecordOverrides::const_iterator it = new_overrides.begin(); it != new_overrides.end(); ++it)
        {
                switch(it->second)
                {
                case RecordOverride::Expired: //if a record is still expired, upgrade it to invisible
                        overrides[it->first] = RecordOverride::ForcedInvisible;
                        break;
                case RecordOverride::IntroducedByChase: //if a record appeared through chase, upgrade it to visible
                        overrides[it->first] = RecordOverride::ForcedVisible;
                        break;
                case RecordOverride::Normal: //if a record is now visibly normally, erase the previous override (if available)
                        overrides.erase(it->first);
                        break;
                case RecordOverride::ForcedVisible:
                case RecordOverride::ForcedInvisible:
                        overrides[it->first] = it->second;
                        break;
                default: ; // Ignore all other overrides
                }
        }
        new_overrides.clear();

/*old code
        // Clean all overrides that don't persist through commands.
        RecordOverrides::iterator it = overrides.begin();
        while(it != overrides.end())
        {
                switch(it->second)
                {
                case RecordOverride::Expired: //if a record is still expired, upgrade it to invisible
                        it->second = RecordOverride::ForcedInvisible;
                        ++it;
                        break;
                case RecordOverride::IntroducedByChase: //if a record appeared through chase, upgrade it to visible
                        it->second = RecordOverride::ForcedVisible;
                        ++it;
                        break;
                case RecordOverride::ForcedVisible:
                case RecordOverride::ForcedInvisible:
                        ++it;
                        break;
                default:
                        overrides.erase(it++);
                        break;
                }
        }
*/
//        DEBUGPRINT("Finished command");
}

//FIXME: This function, or at least the is_metadata_modified flag, should be in dbase_modifications
bool BackendTransaction::IsMetadataModified()
{
        return is_metadata_modified || local_modifications.HaveMetaTablesModified();
}

//FIXME: This function isn't always called when a column disappears, because it is being listened for in SQL code, not modification checks
//FIXME: This function should be in dbase_modifications
void BackendTransaction::NotifyMetaColumnChange(TableId table, ColumnId column, bool do_check)
{
        if (do_check)
            metacolumnschanges.insert(std::make_pair(table, column));
        else
            metacolumnschanges.erase(std::make_pair(table, column));
}

void BackendTransaction::CascadeDelete(TableDef const &keytabledef, TableDef const &reftabledef, ColumnDef const &reftablecol, std::set<RecordId> const &records)
{
        ColumnDef const *keytablecol = keytabledef.GetColumnDef(keytabledef.primarykey);
        if (!keytablecol || keytablecol->type != reftablecol.type)
             return;

        Scanner scan(*this, ShowNormalSkipAccess, true);
        scan.AddTable(reftabledef.object_id);
        scan.AddRecordSet(keytabledef.object_id, records, true);
        scan.AddJoin(0, reftablecol.column_id, false, 1, keytabledef.primarykey, false, SearchEqual, true);
        scan.AddRawSearch(1, keytabledef.primarykey, 0, NULL, SearchUnEqual, true); //Never cascade on NULL (although primary keys should never be NULL, file errors can cause this)
        if (reftablecol.foreignreferencesbycolumn)
            scan.AddIntegerSearch(0, reftablecol.foreignreferencesbycolumn, keytabledef.object_id, SearchEqual);

        while (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                LockResult::_type result = scan.LockCachedRowWithAutoWait(0);
                if (result != LockResult::Deleted)
                {
//                        DEBUGPRINT("Cascading delete to " << reftabledef.name <<":"<< scan.GetCachedRowPartRecordId(0, 0));
                        scan.DeleteLockedRow(0, true);
                }

                scan.ClearCache();
        }
}

void BackendTransaction::SetToDefault(TableDef const &keytabledef, TableDef const &reftabledef, ColumnDef const &reftablecol, std::set< RecordId > const &records)
{
        ColumnDef const *keytablecol = keytabledef.GetColumnDef(keytabledef.primarykey);
        if (!keytablecol || keytablecol->type != reftablecol.type)
             return;

        Scanner scan(*this, ShowNormalSkipAccess, true);
        scan.AddTable(reftabledef.object_id);
        scan.AddRecordSet(keytabledef.object_id, records, true);
        scan.AddJoin(0, reftablecol.column_id, false, 1, keytabledef.primarykey, false, SearchEqual, true);
        scan.AddRawSearch(1, keytabledef.primarykey, 0, NULL, SearchUnEqual, true); //Never cascade on NULL (although primary keys should never be NULL, file errors can cause this)
        if (reftablecol.foreignreferencesbycolumn)
            scan.AddIntegerSearch(1, reftablecol.foreignreferencesbycolumn, keytabledef.object_id, SearchEqual);

        general_scratch_record.Clear();
        general_scratch_record.SetColumn(reftablecol.column_id,
                         reftablecol.defaultval.size(),
                         &reftablecol.defaultval[0]);

        while (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                LockResult::_type result = scan.LockCachedRowWithAutoWait(0);
                if (result != LockResult::Deleted)
                    scan.UpdateLockedRow(0, general_scratch_record);

                scan.ClearCache();
        }
}

void BackendTransaction::CascadeDeletes(TableDef const &referred_table, std::set<RecordId> const &records)
{
        //Loop through all existing tables
        for (Metadata::TableCItr tableitr(metadata->GetTables().begin());
             tableitr!=metadata->GetTables().end();
             ++tableitr)
        {
                //For every table, loop through all columns
                for (TableDef::ColumnCItr columnitr = tableitr->second.GetColumns().begin();
                     columnitr != tableitr->second.GetColumns().end();
                     ++columnitr)
                {
                        // Don't work internal or non-cascading column
                        if (columnitr->second.internal || columnitr->second.ondelete != ForeignCascade)
                            continue;

                        if (columnitr->second.foreignreference==referred_table.object_id ||
                                columnitr->second.foreignreferencesbycolumn)
                        {
                                CascadeDelete(referred_table, tableitr->second, columnitr->second, records);
                        }
                }
        }
}

void BackendTransaction::SetToDefaults(TableDef const &referred_table, std::set<RecordId> const &records)
{
        //Loop through all existing tables
        for (Metadata::TableCItr tableitr(metadata->GetTables().begin());
             tableitr!=metadata->GetTables().end();
             ++tableitr)
        {
                //For every table, loop through all columns
                for (TableDef::ColumnCItr columnitr = tableitr->second.GetColumns().begin();
                     columnitr != tableitr->second.GetColumns().end();
                     ++columnitr)
                    if (!columnitr->second.internal
                        && columnitr->second.ondelete == ForeignSetDefault
                        && columnitr->second.foreignreference==referred_table.object_id)
                {
                        SetToDefault(referred_table, tableitr->second, columnitr->second, records);
                }
        }
}

bool BackendTransaction::Sync()
{
        return commits.ForceSyncAll();
}
void BackendTransaction::CheckAbortFlag() const
{
        if (!abortflag || *abortflag == 0)
            return;

        DEBUGPRINT("Abortflag " << abortflag << " triggered with value " << *abortflag);

        switch (*abortflag)
        {
        case AbortReason::Disconnect:
                throw Exception(ErrorDisconnect, "The client has disconnected during a query.");
        case AbortReason::Timeout:
                throw Exception(ErrorTimeout, "The transaction has been terminated because it has been running too long.");
        default:
            throw Exception(ErrorInternal, "Transaction aborted asynchronously with an invalid reason type.");
        }
}

void BackendTransaction::SetAbortFlag(int32_t *new_abortflag)
{
        abortflag = new_abortflag;
}

} //end namespace Database

namespace Blex
{
template <> void AppendAnyToString(Database::TransactionState::Type const &in, std::string *appended_string)
{
        switch(in)
        {
        case Database::TransactionState::Normal:                *appended_string="normal"; break;
        case Database::TransactionState::ReadOnly:              *appended_string="readonly"; break;
        case Database::TransactionState::ReadOnlyAfterError:    *appended_string="readonlyaftererror"; break;
        }
}

} //end namespace Blex
