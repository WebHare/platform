#include <ap/libwebhare/allincludes.h>

#include "backend_sql_parser.h"
#include "dbase_meta.h"
#include "dbase_backend.h"
#include "dbase_janitor.h"
#include "dbase_transaction.h"
#include "resultsets.h"

//ADDME: Eigenlijk zouden de Statement::Execute geen members meer moeten zijn, voor 'correcte' werkverdeling

namespace Database {

namespace SQL {

void UpdateSchema(BackendTransaction &trans, std::string const &schemaname, WritableRecord const &updates, bool update_object)
{
        ObjectId schemaid = trans.GetMetadata().GetRootObject().GetObjectId(schemaname);

        { // prevent Index Update deadlocks caused by our scanner holding Index locks (ADDME: cleanup when the new Scanner is properly implemented!)
                Scanner scan(trans, ShowNormalSkipAccess, true);
                if (update_object)
                {
                        scan.AddTable(TableId_MetaObjects);
                        scan.AddIntegerSearch(0,MetaObjects_ObjectId,schemaid,SearchEqual);
                        if (!scan.NextRow())
                            throw Exception(ErrorInternal,"Cannot find objectdef for " + schemaname + " in META_OBJECTS");
                }
                else
                {
                        scan.AddTable(TableId_MetaSchemas);
                        scan.AddIntegerSearch(0,MetaSchemas_ObjectId,schemaid,SearchEqual);
                        if (!scan.NextRow())
                            throw Exception(ErrorInternal,"Cannot find schemadef for " + schemaname + " in META_SCHEMAS");
                }
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted:
                case LockResult::Updated:
                    throw Exception(ErrorConflict,"Column is being manipulated by another transaction");
                case LockResult::NoChange: break;
                }
                scan.UpdateLockedRow(0, updates);
        }
        trans.FinishCommand();
}

void UpdateTable(BackendTransaction &trans, TableId tableid, WritableRecord const &updates)
{
        { // prevent Index Update deadlocks caused by our scanner holding Index locks (ADDME: cleanup when the new Scanner is properly implemented!)
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaTables);
                scan.AddIntegerSearch(0,MetaTable_ObjectId,tableid,SearchEqual);

                if (!scan.NextRow())
                    throw Exception(ErrorInternal,"Cannot find tabledef in META_TABLES");

                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted:
                case LockResult::Updated:
                    throw Exception(ErrorConflict,"Table is being manipulated by another transaction");
                case LockResult::NoChange: break;
                }
                scan.UpdateLockedRow(0, updates);
        }
        trans.FinishCommand();
}

void UpdateColumn(BackendTransaction &trans, ObjectId column_objectid, WritableRecord const &column_updates, WritableRecord const &object_updates, bool is_delete)
{
        { // prevent Index Update deadlocks caused by our scanner holding Index locks (ADDME: cleanup when the new Scanner is properly implemented!)

                // Special updatable scan, first table may be deleted, second may not. FIXME: check for correctness
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaColumns);
                scan.AddIntegerSearch(0, MetaColumn_ObjectId, column_objectid, SearchEqual);

                if (!scan.NextRow())
                    throw Exception(ErrorInternal,"Cannot find column record");

                //ADDME: Sleep until record is available, merge any changes?
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted:
                case LockResult::Updated:
                    throw Exception(ErrorConflict,"Column is being manipulated by another transaction");
                case LockResult::NoChange: break;
                }

                if (is_delete)
                    scan.DeleteLockedRow(0, true);
                else
                    scan.UpdateLockedRow(0, column_updates);
        }
        if (object_updates.Exists())
        {
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaObjects);
                scan.AddIntegerSearch(0,MetaObjects_ObjectId,column_objectid,SearchEqual);
                if (!scan.NextRow())
                    throw Exception(ErrorInternal,"Cannot find object def for column in META_OBJECTS");
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted:
                case LockResult::Updated:
                    throw Exception(ErrorConflict,"Column is being manipulated by another transaction");
                case LockResult::NoChange: break;
                }
                scan.UpdateLockedRow(0, object_updates);
        }
        trans.FinishCommand();
}

void MoveTableToOtherSchema(BackendTransaction &trans, std::string const &rename, ObjectId table, ObjectId newschema)
{
        {
        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(TableId_MetaObjects);
        scan.AddIntegerSearch(0,MetaObjects_ObjectId,table,SearchEqual);
        if (!scan.NextRow())
            throw Exception(ErrorInternal,"Cannot find object def for table");
        scan.AddActiveRowToCache();
        switch (scan.LockCachedRowWithAutoWait(0))
        {
        case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
        case LockResult::Deleted:
        case LockResult::Updated:
            throw Exception(ErrorConflict,"Table is being manipulated by another transaction");
        case LockResult::NoChange: break;
        }
        WritableRecord rec;
        rec.SetInteger(MetaObjects_Parent, newschema);
        if (!rename.empty())
            rec.SetString(MetaObjects_Name, rename);

        scan.UpdateLockedRow(0, rec);
        }
        trans.FinishCommand();
}

void DeleteSingleObject(BackendTransaction &trans, ObjectId objectid)
{
        {
        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(TableId_MetaObjects);
        scan.AddIntegerSearch(0,MetaObjects_ObjectId,objectid,SearchEqual);
        if (!scan.NextRow())
            throw Exception(ErrorInternal,"Cannot find object def for object #" + Blex::AnyToString(objectid) + " in META_OBJECTS");
        scan.AddActiveRowToCache();
        switch (scan.LockCachedRowWithAutoWait(0))
        {
        case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
        case LockResult::Deleted:
        case LockResult::Updated:
            throw Exception(ErrorConflict,"Object #" + Blex::AnyToString(objectid) + "  is being manipulated by another transaction");
        case LockResult::NoChange: break;
        }
        scan.DeleteLockedRow(0, true);
        }
        trans.FinishCommand();
}

RoleId FindRoleId(BackendTransaction &trans, std::string schema, std::string role)
{
        ObjectId schemaid = trans.GetMetadata().GetRootObject().GetObjectId(schema);
        return schemaid ? trans.GetMetadata().Privs().GetRoleId(schemaid, role) : 0;
}

bool CascadeGrantChanges(Metadata const &metadata, BackendTransaction &trans)
{
        bool any_meta_update=false;

        std::vector< unsigned > abandoned_ids;

        metadata.Privs().GetAbandonedRoleGrants(&abandoned_ids);

        if (!abandoned_ids.empty())
        {
                any_meta_update = true;
                std::sort(abandoned_ids.begin(), abandoned_ids.end());

                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaRoleGrants);
                while (scan.NextRow())
                {
                        scan.AddActiveRowToCache();
                        switch (scan.LockCachedRowWithAutoWait(0))
                        {
                        case LockResult::NoChange:
                            {
                                    if (std::binary_search(abandoned_ids.begin(), abandoned_ids.end(), scan.GetCachedRowPart(0, 0).GetCell(MetaRoleGrants_Id).Integer()))
                                        scan.DeleteLockedRow(0, true);
                                    else
                                        scan.UnlockCachedRow(0); // Fallthrough
                            } break;
                        case LockResult::Updated: //conflict made update impossible
                            scan.UnlockCachedRow(0); // Fallthrough

                        case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                        case LockResult::Deleted: //concurrent delete, conflict
                            throw Exception(ErrorConflict,"Grant is being manipulated by another transaction");
                        }
                        scan.ClearCache();
                }
        }

        abandoned_ids.clear();
        metadata.Privs().GetAbandonedGrants(&abandoned_ids);

        if (!abandoned_ids.empty())
        {
                any_meta_update = true;

                std::sort(abandoned_ids.begin(), abandoned_ids.end());
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaGrants);
                while (scan.NextRow())
                {
                        scan.AddActiveRowToCache();
                        switch (scan.LockCachedRowWithAutoWait(0))
                        {
                        case LockResult::NoChange:
                            {
                                    unsigned grantid = scan.GetCachedRowPart(0, 0).GetCell(MetaGrants_Id).Integer();
                                    if (std::binary_search(abandoned_ids.begin(), abandoned_ids.end(), grantid))
                                        scan.DeleteLockedRow(0, true);
                                    else
                                        scan.UnlockCachedRow(0); // Fallthrough
                            } break;
                        case LockResult::Updated: //conflict made update impossible
                            scan.UnlockCachedRow(0); // Fallthrough

                        case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                        case LockResult::Deleted: //concurrent delete, conflict
                            throw Exception(ErrorConflict,"Grant is being manipulated by another transaction");
                        }
                        scan.ClearCache();
                }
        }

        trans.FinishCommand();

        typedef std::vector< Metadata::NeededAction > ActionList;
        ActionList actions;
        metadata.CalculateNeededActions(&actions);

        for (ActionList::iterator it = actions.begin(); it != actions.end(); ++it)
        {
                any_meta_update = true;

                switch (it->type)
                {
                case Metadata::NeededAction::DropReference:
                    {
                            WritableRecord c_updates, o_updates;
                            c_updates.SetInteger(MetaColumn_ForeignRefer, 0);

                            UpdateColumn(trans, it->object, c_updates, o_updates, false);
                    } break;
                default: ;
                }
        }
        trans.FinishCommand();
        return any_meta_update; //metadata must be refreshed again if we updated anything
}

void GrantRole(BackendTransaction &trans, RoleId role, RoleId grantee, RoleId grantor, bool with_admin)
{
        TableDef const *metarolegrants = trans.GetMetadata().GetTableDef(TableId_MetaRoleGrants);
        ColumnDef const *metarolegrants_id = metarolegrants->GetColumnDef(MetaRoleGrants_Id);

        // First, see if there is already a role grant available.
        {
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(metarolegrants);
                scan.AddIntegerSearch(0, MetaRoleGrants_Role, role, SearchEqual);
                scan.AddIntegerSearch(0, MetaRoleGrants_Grantor, grantor, SearchEqual);
                scan.AddIntegerSearch(0, MetaRoleGrants_Grantee, grantee, SearchEqual);
                if (scan.NextRow())
                {
                        scan.AddActiveRowToCache();
                        switch (scan.LockCachedRowWithAutoWait(0))
                        {
                        case LockResult::NoChange:
                            {
                                   bool had_admin = scan.GetCachedRowPart(0, 0).GetCell(MetaRoleGrants_WithAdmin).Boolean();
                                   if (!had_admin && with_admin)
                                   {
                                           WritableRecord rec;
                                           rec.SetBoolean(MetaRoleGrants_WithAdmin, with_admin);

                                           scan.UpdateLockedRow(0, rec);
                                   }
                                   else
                                       scan.UnlockCachedRow(0);
                                   scan.Close();
                                   trans.FinishCommand();
                                   return;
                            }
                        case LockResult::Updated: //conflict made update impossible
                            scan.UnlockCachedRow(0); // Fallthrough

                        case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                        case LockResult::Deleted: //concurrent delete, conflict
                            throw Exception(ErrorConflict,"Grant is being manipulated by another transaction");
                        }
                }
        }

        WritableRecord rec;
        rec.SetInteger(MetaRoleGrants_Id, trans.GetAutonumberKey(*metarolegrants, *metarolegrants_id));
        rec.SetInteger(MetaRoleGrants_Role, role);
        rec.SetInteger(MetaRoleGrants_Grantee, grantee);
        rec.SetInteger(MetaRoleGrants_Grantor, grantor);
        rec.SetBoolean(MetaRoleGrants_WithAdmin, with_admin);
        trans.InsertRecord(*metarolegrants, rec, true, true);
        trans.FinishCommand();
}

void RevokeRole(BackendTransaction &trans, RoleId role, RoleId grantee, RoleId grantor, bool revoke_only_admin)
{
        TableDef const *metarolegrants = trans.GetMetadata().GetTableDef(TableId_MetaRoleGrants);

        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(metarolegrants);
        scan.AddIntegerSearch(0, MetaRoleGrants_Role, role, SearchEqual);
        scan.AddIntegerSearch(0, MetaRoleGrants_Grantor, grantor, SearchEqual);
        scan.AddIntegerSearch(0, MetaRoleGrants_Grantee, grantee, SearchEqual);
        if (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::NoChange:
                    {
                           if (revoke_only_admin)
                           {
                                   bool had_admin = scan.GetCachedRowPart(0, 0).GetCell(MetaRoleGrants_WithAdmin).Boolean();
                                   if (!had_admin)
                                       throw Exception(ErrorIllegalSQLCommand,"The role grant does not have a grant option");

                                   WritableRecord rec;
                                   rec.SetBoolean(MetaRoleGrants_WithAdmin, false);

                                   scan.UpdateLockedRow(0, rec);
                           }
                           else
                               scan.DeleteLockedRow(0, true);
                    } break;
                case LockResult::Updated: //conflict made update impossible
                    scan.UnlockCachedRow(0); // Fallthrough

                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted: //concurrent delete, conflict
                    throw Exception(ErrorConflict,"Grant is being manipulated by another transaction");
                }
        }
        else
        {
                throw Exception(ErrorIllegalSQLCommand,"The role grant does not exist");
        }
        // Make changes visible
        scan.Close();
        trans.FinishCommand();
}

void GrantPrivileges(BackendTransaction &trans, ObjectId object, PrivilegeDescriptor const &new_privs, RoleId grantee, RoleId grantor)
{
        TableDef const *metagrants = trans.GetMetadata().GetTableDef(TableId_MetaGrants);
        ColumnDef const *metagrants_id = metagrants->GetColumnDef(MetaGrants_Id);

        // First, see if there is already a role grant available.
        {
                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(metagrants);
                scan.AddIntegerSearch(0, MetaGrants_Object, object, SearchEqual);
                scan.AddIntegerSearch(0, MetaGrants_Grantor, grantor, SearchEqual);
                scan.AddIntegerSearch(0, MetaGrants_Grantee, grantee, SearchEqual);
                if (scan.NextRow())
                {
                        scan.AddActiveRowToCache();
                        switch (scan.LockCachedRowWithAutoWait(0))
                        {
                        case LockResult::NoChange:
                            {
                                   PrivilegeDescriptor privs;
                                   privs.ReadFromCell(scan.GetCachedRowPart(0, 0).GetCell(MetaGrants_Mask));
                                   privs.Merge(new_privs);

                                   WritableRecord rec;
                                   privs.SetCell(rec, MetaGrants_Mask);

                                   scan.UpdateLockedRow(0, rec);
                                   scan.Close();
                                   trans.FinishCommand();
                                   return;
                            }

                        case LockResult::Updated: //conflict made update impossible
                            scan.UnlockCachedRow(0); // Fallthrough

                        case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                        case LockResult::Deleted: //concurrent delete, conflict
                            throw Exception(ErrorConflict,"Grant is being manipulated by another transaction");
                        }
                }
        }

        WritableRecord rec;
        rec.SetInteger(MetaGrants_Id, trans.GetAutonumberKey(*metagrants, *metagrants_id));
        rec.SetInteger(MetaGrants_Object, object);
        new_privs.SetCell(rec, MetaGrants_Mask);
        rec.SetInteger(MetaGrants_Grantee, grantee);
        rec.SetInteger(MetaGrants_Grantor, grantor);
        trans.InsertRecord(*metagrants, rec, true, true);
        trans.FinishCommand();
}

void RevokePrivileges(BackendTransaction &trans, ObjectId object, PrivilegeDescriptor const &new_privs, RoleId grantee, RoleId grantor, bool revoke_grant_options)
{
        TableDef const *metagrants = trans.GetMetadata().GetTableDef(TableId_MetaGrants);

        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(metagrants);
        scan.AddIntegerSearch(0, MetaGrants_Object, object, SearchEqual);
        scan.AddIntegerSearch(0, MetaGrants_Grantor, grantor, SearchEqual);
        scan.AddIntegerSearch(0, MetaGrants_Grantee, grantee, SearchEqual);
        if (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::NoChange:
                    {
                            PrivilegeDescriptor privs;
                            privs.ReadFromCell(scan.GetCachedRowPart(0, 0).GetCell(MetaGrants_Mask));
                            privs.Erase(new_privs, revoke_grant_options);

                            if (privs.IsEmpty())
                                scan.DeleteLockedRow(0, true);
                            else
                            {
                                    WritableRecord rec;
                                    privs.SetCell(rec, MetaGrants_Mask);

                                    scan.UpdateLockedRow(0, rec);
                            }
                    } break;

                case LockResult::Updated: //conflict made update impossible
                    scan.UnlockCachedRow(0); // Fallthrough

                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted: //concurrent delete, conflict
                    throw Exception(ErrorConflict,"Grant is being manipulated by another transaction");
                }
        }
        else
        {
                throw Exception(ErrorIllegalSQLCommand,"The privilege was not granted");
        }
        // Make changes visible
        scan.Close();
        trans.FinishCommand();
}

void DropRole(BackendTransaction &trans, RoleId role)
{
        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(TableId_MetaRoles);
        scan.AddIntegerSearch(0,MetaRoles_RoleId,role,SearchEqual);
        if (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::NoChange:
                    {
                            scan.DeleteLockedRow(0, true);
                    } break;

                case LockResult::Updated: //conflict made update impossible
                    scan.UnlockCachedRow(0); // Fallthrough

                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted: //concurrent delete, conflict
                    throw Exception(ErrorConflict,"Role is being manipulated by another transaction");
                }
        }
        scan.Close();
        trans.FinishCommand();
}

void RenameRole(BackendTransaction &trans, RoleId role, std::string newname)
{
        Blex::ToUppercase(newname);

        WritableRecord updates;
        updates.SetString(MetaRoles_Name, newname);

        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(TableId_MetaRoles);
        scan.AddIntegerSearch(0,MetaRoles_RoleId,role,SearchEqual);
        if (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::NoChange:
                    {
                            scan.UpdateLockedRow(0, updates);
                    } break;

                case LockResult::Updated: //conflict made update impossible
                    scan.UnlockCachedRow(0); // Fallthrough

                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted: //concurrent delete, conflict
                    throw Exception(ErrorConflict,"Role is being manipulated by another transaction");
                }
        }
        scan.Close();
        trans.FinishCommand();
}

void ObjectToRecord(const ObjectDef &object, ObjectId parent, WritableRecord *recupd)
{
        recupd->SetInteger(MetaObjects_ObjectId,object.object_id);
        recupd->SetString (MetaObjects_Name,object.name);
        recupd->SetInteger(MetaObjects_Type,object.type);
        recupd->SetInteger(MetaObjects_Parent,parent);
        recupd->SetDateTime(MetaObjects_CreationDate,Blex::DateTime::Now());
}

void SchemaToRecord(const SchemaDef &object, WritableRecord *recupd)
{
        recupd->SetInteger(MetaSchemas_ObjectId,object.object_id);
        recupd->SetInteger(MetaSchemas_Owner,object.owner);
}

void ColumnToRecord(const ParsedColumn &col, WritableRecord *recupd)
{
        ColumnDef const &column = col.coldef;
        recupd->SetInteger(MetaColumn_ObjectId,column.object_id);
        recupd->SetInteger(MetaColumn_ColumnId,column.column_id);
        recupd->SetInteger(MetaColumn_MaxSize,column.maxsize);
        recupd->SetInteger(MetaColumn_Type,column.type);

        if (col.defaulttype)
        {
                if(column.type != col.defaulttype) //setting to wrong type
                    throw Exception(ErrorIllegalSQLCommand, "Incorrect default value type");

                recupd->SetColumn(MetaColumn_Default,column.defaultval.size(),&column.defaultval[0]);
        }

        recupd->SetInteger(MetaColumn_Autokey,column.autonumber_start);
        recupd->SetInteger(MetaColumn_ForeignBehav,column.ondelete);
        recupd->SetInteger(MetaColumn_ForeignRefer,column.foreignreference);
        recupd->SetBoolean(MetaColumn_NotNull,column.notnull);
        recupd->SetBoolean(MetaColumn_NoCirculairs,column.nocirculairs);
        recupd->SetString (MetaColumn_Internal,column.internalcolumn_name);
        recupd->SetBoolean(MetaColumn_Unique,column.unique);
        recupd->SetBoolean(MetaColumn_NoUpdate,column.noupdate);
        recupd->SetInteger(MetaColumn_RefersByCol,column.foreignreferencesbycolumn);
}

void RoleToRecord(ObjectId schema, RoleId roleid, std::string const &name, WritableRecord *recupd)
{
        recupd->SetInteger(MetaRoles_RoleId,roleid);
        recupd->SetString(MetaRoles_Name,name);
        recupd->SetInteger(MetaRoles_Schema,schema);
}

void TableToRecord(const TableDef &table, WritableRecord *recupd)
{
//        recupd->SetString (MetaTable_Name,table.name);
        recupd->SetInteger(MetaTable_ObjectId,table.object_id);
        recupd->SetInteger(MetaTable_Primary,table.primarykey);
        recupd->SetString (MetaTable_ReadAccess,table.readaccess_name);
        recupd->SetString (MetaTable_WriteAccess,table.writeaccess_name);
}

TableId LookupSchemaTableName(BackendTransaction &trans, SchemaTableName const &table)
{
        ObjectId schemaid = table.first.empty() ? MetaSchema_PUBLIC : trans.GetMetadata().GetRootObject().GetObjectId(table.first);
        if(schemaid==0)
           return 0;
        return trans.GetMetadata().GetObjectDef(schemaid)->GetObjectId(table.second);
}

TableId GetValidateReference(BackendTransaction &trans, SchemaTableName const &to_table, SchemaDef const *from_schema, TableDef const &tabledef, ColumnDef const &columndef, ForeignBehaviours new_ondelete)
{
        DEBUGPRINT("Validating reference to " << to_table.first << "." << to_table.second << " from " << from_schema->name << "." << tabledef.name << "." << columndef.name);

        TableId refersto_id = LookupSchemaTableName(trans, to_table);
        if (!refersto_id)
            throw Exception(ErrorIllegalSQLCommand,"No such table '" + to_table.first + "'.'" + to_table.second + "'");
        TableDef const *refersto = trans.GetMetadata().GetTableDef(refersto_id);

        if (!refersto->primarykey)
            throw Exception(ErrorIllegalSQLCommand,"Table '" + to_table.first + "'.'" + to_table.second + "' does not have a primary key");
        ColumnDef const *refersto_column = refersto->GetColumnDef(refersto->primarykey);
        if (!refersto_column)
            throw Exception(ErrorInternal,"Could not find definition for primary key of table '" + to_table.first + "'.'" + to_table.second + "'");

        // Make a copy of columndef and complete it, to allow issoftreference to work ok. MAY NOT MESS WITH ORIGINAL!
        ColumnDef columndef_copy = columndef;
        columndef_copy.foreignreference = refersto->object_id;
        columndef_copy.ondelete = new_ondelete;

        PrivilegeDescriptor privs;
        trans.GetMetadata().Privs().GetObjectPrivilegesForSpecificRole(from_schema->owner, *refersto_column, &privs);

        // FIXME: this check is also in dbase_meta.cpp, MERGE!
        bool has_hard_right = privs.HasPrivilege(Privilege::Column_References);
        bool has_soft_right = privs.HasPrivilege(Privilege::Column_Select);
        bool is_soft = columndef_copy.IsSoftReference(tabledef.IsHardReferenced());

        if (!has_hard_right && !(is_soft && has_soft_right))
        {
                std::string error = "Owner of schema " + from_schema->name + " does not have sufficient privileges to complete this operation - a ";
                if(is_soft)
                    error += "SELECT";
                else
                    error += "REFERENCES";
                error += " privilege on " + to_table.first + "." + to_table.second + " is required because of a reference from ";
                error += from_schema->name + "." + tabledef.name + "(" + columndef.name + ")";
                throw Exception(ErrorWriteAccessDenied, error);
        }

        DEBUGPRINT("is_soft: " << is_soft);

        // This is not a soft reference. Check whether the referenced table is soft referenced. If so, this reference is disallowed.
        if (!is_soft && !refersto->IsHardReferenced())
        {
                SchemaDef const *refersto_schema = static_cast<SchemaDef const*>(refersto->parent_object);

                // This is a hard reference. Check all the references of the referenced table for their privileges
                for (TableDef::ColumnCItr citr = refersto->GetColumns().begin(); citr != refersto->GetColumns().end(); ++citr)
                {
                        if (!citr->second.foreignreference)
                            continue;
                        TableDef const *refersto2 = trans.GetMetadata().GetTableDef(citr->second.foreignreference);
                        ColumnDef const *refersto2_column = refersto2->GetColumnDef(refersto2->primarykey);

                        trans.GetMetadata().Privs().GetObjectPrivilegesForSpecificRole(refersto_schema->owner, *refersto2_column, &privs);

                        bool has_hard_right = privs.HasPrivilege(Privilege::Column_References);
                        bool has_soft_right = privs.HasPrivilege(Privilege::Column_Select);
                        bool is_soft = citr->second.IsSoftReference(true);

                        if (!has_hard_right && !(is_soft && has_soft_right))
                        {
                                std::string error = "The column " + from_schema->name + "." + tabledef.name + "(" + columndef.name + ") may not refer with a non-soft reference to ";
                                error += to_table.first + "." + to_table.second + ", because that table has a soft reference itself";

                                throw Exception(ErrorWriteAccessDenied, error);
                        }
                }
        }

        return refersto_id;
}

bool SQLCreateTableStatement::Execute(BackendTransaction &trans)
{
        if(schema.empty())
            schema="PUBLIC";

        ObjectId schemaid = trans.GetMetadata().GetRootObject().GetObjectId(schema);
        if (schemaid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot create a table in non-existing schema '" + schema + "'");
        SchemaDef const *schemadef = trans.GetMetadata().GetSchemaDef(schemaid);

        // Check privileges. Needed: Schema_MetadataManagement on schema, Table_References for referenced tables (checked later)
        if (!trans.IsRoleEnabled(schemadef->owner))
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to create table '" + newtable.name + "' in schema '" + schema + "'");

        // Create new object id (FIXME: We should ensure that no sections exist that still claim to have records here - they will get inserted into the index, even though all their records will be invisible)
        newtable.object_id = trans.GetNewObjectId();
        newtable.type = MetaObjectType::Table;

        Blex::ToUppercase(newtable.name);
        Blex::ToUppercase(newtable.readaccess_name);
        Blex::ToUppercase(newtable.writeaccess_name);

        if (newtable.name.empty())
            throw Exception(ErrorIllegalSQLCommand,"Cannot create table '" + newtable.name + "', its name is illegal");

        if (schemadef->GetObjectId(newtable.name) != 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot create table '" + newtable.name + "' in schema '" + schema + "', a table with that name already exists");

        if (!newtable.readaccess_name.empty())
        {
                std::string::iterator colon = std::find(newtable.readaccess_name.begin(), newtable.readaccess_name.end(), ':');
                std::string funcname(newtable.readaccess_name.begin(), colon);

                if (!trans.backend.plugins.GetReadAccess(funcname,schemadef->name + "." + newtable.name))
                    throw Exception(ErrorIllegalSQLCommand,"No such read access handler " + newtable.readaccess_name);
        }
        if (!newtable.writeaccess_name.empty())
        {
                std::string::iterator colon = std::find(newtable.writeaccess_name.begin(), newtable.writeaccess_name.end(), ':');
                std::string funcname(newtable.writeaccess_name.begin(), colon);

                if (!trans.backend.plugins.GetWriteAccess(funcname,schemadef->name + "." + newtable.name))
                    throw Exception(ErrorIllegalSQLCommand,"No such write access handler " + newtable.writeaccess_name);
        }

        //Implement column referrals, and look for a primary key
        newtable.primarykey=0;
        for (unsigned i=0;i<coldefs.size();++i)
        {
                //Assign an ID, if necessary
                if (coldefs[i].coldef.column_id==0)
                    coldefs[i].coldef.column_id = static_cast<ColumnId>(Database::MinimumExternalId + i);
                coldefs[i].coldef.object_id = trans.GetNewObjectId();
        }

        for (unsigned i=0;i<coldefs.size();++i)
        {
                //Look up the references table
                if (!coldefs[i].foreignreference.second.empty())
                {
                        //Convert unqualified references to SELF!
                        if (coldefs[i].foreignreference.first.empty())
                            coldefs[i].foreignreference.first = schema;

                        if (coldefs[i].foreignreference.first == schema
                            && coldefs[i].foreignreference.second == newtable.name)
                        {
                                // Owner of schema has references privileges to all tables in the schema, no checking needed here.
                                coldefs[i].coldef.foreignreference = newtable.object_id;
                        }
                        else //look it up
                        {
                                coldefs[i].coldef.foreignreference = GetValidateReference(trans, coldefs[i].foreignreference, schemadef, newtable, coldefs[i].coldef, coldefs[i].coldef.ondelete);
                        }
                }
                if (!coldefs[i].foreignreferencesbycolumn.empty())
                {
                        Blex::ToUppercase(coldefs[i].foreignreferencesbycolumn);

                        for (unsigned u=0;u<coldefs.size();++u)
                        {
                                if (coldefs[u].coldef.name == coldefs[i].foreignreferencesbycolumn)
                                    coldefs[i].coldef.foreignreferencesbycolumn = coldefs[u].coldef.column_id;
                        }
                        if (!coldefs[i].coldef.foreignreferencesbycolumn)
                            throw Exception(ErrorIllegalSQLCommand,"Could not find column " + coldefs[i].foreignreferencesbycolumn);
                }
                if (coldefs[i].make_primary) //make it primary?
                {
                        if (newtable.primarykey)
                            throw Exception(ErrorIllegalSQLCommand,"Duplicate primary key");
                        newtable.primarykey=coldefs[i].coldef.column_id;
                }
        }

        TableDef const *metaobjects = trans.GetMetadata().GetTableDef(TableId_MetaObjects);
        TableDef const *metatables = trans.GetMetadata().GetTableDef(TableId_MetaTables);
        TableDef const *metacolumns = trans.GetMetadata().GetTableDef(TableId_MetaColumns);

        assert(metatables && metacolumns);

        /* Currently, creating a table is defined as just doing a bunch of INSERTS into meta_tables (and meta_objects) */
        WritableRecord newrec;
        ObjectToRecord(newtable,schemaid,&newrec);
        trans.InsertRecord(*metaobjects, newrec, true, true);

        newrec=Record();
        TableToRecord(newtable,&newrec);
        trans.InsertRecord(*metatables, newrec, true, true);

        //Now add the columns
        for (unsigned i=0;i<coldefs.size();++i)
        {
                //Create the column remotely first
                newrec=Record();
                ObjectToRecord(coldefs[i].coldef,newtable.object_id,&newrec);
                trans.InsertRecord(*metaobjects, newrec, true, true);

                newrec=Record();
                ColumnToRecord(coldefs[i],&newrec);

                trans.InsertRecord(*metacolumns, newrec, true, true);
        }

        trans.FinishCommand();

        trans.ReportTableCreate(newtable.object_id);
        return true;
}

bool SQLCreateSchemaStatement::Execute(BackendTransaction &trans)
{
        TableDef const *metaobjects = trans.GetMetadata().GetTableDef(TableId_MetaObjects);
        TableDef const *metaschemas = trans.GetMetadata().GetTableDef(TableId_MetaSchemas);
        TableDef const *metaroles = trans.GetMetadata().GetTableDef(TableId_MetaRoles);

        // Check privileges. Only _SYSTEM may create schemas.
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may create schemas");

        Blex::ToUppercase(newschema.name);

        if (trans.GetMetadata().GetRootObject().GetObjectId(newschema.name) != 0)
            throw Exception(ErrorIllegalSQLCommand,"Schema '" + newschema.name + "' already exists");

        newschema.object_id = trans.GetNewObjectId();

        if (Blex::StrCaseCompare(admin.first, newschema.name)==0) //owner is IN new schema
        {
                newschema.owner = trans.GetNewRoleId();

                WritableRecord newrec;
                RoleToRecord(newschema.object_id, newschema.owner, admin.second, &newrec);
                trans.InsertRecord(*metaroles, newrec, true, true);
        }
        else
        {
                newschema.owner = FindRoleId(trans, admin.first, admin.second);
                if (newschema.owner == 0)
                    throw Exception(ErrorIllegalSQLCommand,"Role " + admin.first + "." + admin.second + " does not exist, when creating schema '" + newschema.name + "'");

                // Privileges: grantor must be _SYSTEM, or (enabled through current user or PUBLIC and have all privileges granted with grant option)
                if (!trans.IsRoleGrantable(newschema.owner))
                    throw Exception(ErrorWriteAccessDenied,"Role " + admin.first + "." + admin.second + " is not active at the moment, when creating schema '" + newschema.name + "'");
        }

        WritableRecord newrec;
        ObjectToRecord(newschema,0,&newrec);
        trans.InsertRecord(*metaobjects, newrec, true, true);

        SchemaToRecord(newschema,&newrec);
        trans.InsertRecord(*metaschemas, newrec, true, true);

        trans.FinishCommand();

        return true;
}

bool SQLCreateRoleStatement::Execute(BackendTransaction &trans, TempResultSet *storage)
{
        Metadata const &metadata = trans.GetMetadata();

        TableDef const *metaroles = metadata.GetTableDef(TableId_MetaRoles);
        Blex::ToUppercase(rolename.first);
        Blex::ToUppercase(rolename.second);

        SchemaDef const *schema = metadata.GetSchemaDef(metadata.GetRootObject().GetObjectId(rolename.first));
        if (!schema)
            throw Exception(ErrorIllegalSQLCommand,"No such schema " + rolename.first);

        if (rolename.second == "PUBLIC" || rolename.second == "_SYSTEM")
            throw Exception(ErrorIllegalSQLCommand,"Illegal role name " + rolename.second);

        // Check privileges.
        if (!trans.IsRoleEnabled(schema->owner))
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        // Don't want duplicates
        if (FindRoleId(trans, schema->name, rolename.second) != 0)
            throw Exception(ErrorWriteAccessDenied,"Role " + rolename.second + " already exists in schema " + schema->name);

        RoleId roleid = trans.GetNewRoleId();

        WritableRecord newrec;
        RoleToRecord(schema->object_id, roleid, rolename.second, &newrec);
        trans.InsertRecord(*metaroles, newrec, true, true);
        trans.FinishCommand();

        storage->AddColumn("ID", TInteger);

        WritableRecord data;
        data.SetInteger(1,roleid);
        storage->AddRecord(data);
        return true;
}

bool SQLCreateUserStatement::Execute(BackendTransaction &trans, TempResultSet *storage)
{
        Metadata const &metadata = trans.GetMetadata();

        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may create users");

        TableDef const *metaroles = metadata.GetTableDef(TableId_MetaRoles);
        Blex::ToUppercase(username);

        // Don't want duplicates
        if (FindRoleId(trans, "DEFINITION_SCHEMA", username) != 0)
            throw Exception(ErrorWriteAccessDenied,"User " + username + " already exists");

        RoleId roleid = trans.GetNewRoleId();

        WritableRecord newrec;
        RoleToRecord(MetaSchema_DEFINITION_SCHEMA, roleid, username, &newrec);
        trans.InsertRecord(*metaroles, newrec, true, true);
        trans.FinishCommand();

        storage->AddColumn("ID", TInteger);

        WritableRecord data;
        data.SetInteger(1,roleid);
        storage->AddRecord(data);
        return true;
}

bool SQLAlterRoleRenameStatement::Execute(BackendTransaction &trans)
{
        RoleId sourceroleid = FindRoleId(trans, rolename.first, rolename.second);
        if (sourceroleid==0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter non-existing role " + rolename.first + "." + rolename.second);

        RoleDef const *roledef = trans.GetMetadata().Privs().GetRoleDef(sourceroleid);
        if(!roledef->schema)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter role " + rolename.first + "." + rolename.second + ", it does not have a containing schema");

        if (FindRoleId(trans, roledef->schema->name, new_name))
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter role " + rolename.first + "." + rolename.second + " to " + rolename.first + "." + new_name + ", a role with that name already exists");

        // Check privileges. Needed: Schema_RoleManagement on schema where role is created.
        if (!trans.IsRoleEnabled(roledef->schema->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        RenameRole(trans, sourceroleid, new_name);
        return true;
}

bool SQLAlterSchemaRenameStatement::Execute(BackendTransaction &trans)
{
        ObjectId schemaid = trans.GetMetadata().GetRootObject().GetObjectId(schemaname);
        if (!schemaid || schemaname.empty())
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter schema " + schemaname + ", it does not exist");

        SchemaDef const *schemadef = trans.GetMetadata().GetSchemaDef(schemaid);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to schema owner to manage it
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to alter schema " + schemaname);

        //Validations DONE, do the actual work!
        WritableRecord updates;
        updates.SetString(MetaObjects_Name,newschemaname);
        UpdateSchema(trans, schemaname, updates, true);

        return true; //metadata is updated!
}

bool SQLAlterSchemaOwnerStatement::Execute(BackendTransaction &trans)
{
        ObjectId schemaid = trans.GetMetadata().GetRootObject().GetObjectId(schemaname);
        if (!schemaid || schemaname.empty())
            throw Exception(ErrorIllegalSQLCommand,"No such schema " + schemaname);

        SchemaDef const *schemadef = trans.GetMetadata().GetSchemaDef(schemaid);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to schema owner to manage it
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        RoleId newownerid = FindRoleId(trans, newowner.first, newowner.second);
        if (newownerid == 0)
            throw Exception(ErrorIllegalSQLCommand, "Cannot alter owner of schema " + schemaname + ", role " + newowner.first + "." + newowner.second + " does not exist");

        // Privileges: grantor must be _SYSTEM, or (enabled through current user or PUBLIC and have all privileges granted with grant option)
        if (!trans.IsRoleGrantable(newownerid))
            throw Exception(ErrorWriteAccessDenied, "Cannot alter owner of schema " + schemaname + ", role " + newowner.first + "." + newowner.second + " is not active at the moment");

        //Validations DONE, do the actual work!
        WritableRecord updates;
        updates.SetInteger(MetaSchemas_Owner,newownerid);
        UpdateSchema(trans, schemaname, updates, false);

        return true; //metadata is updated!
}

bool SQLAlterTableRenameColumnStatement::Execute(BackendTransaction &trans)
{
        TableId tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter non-existing table " + tablename.first + "." + tablename.second);

        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);
        ColumnId colid = tabledef->GetColumnId(columnname);
        if (!colid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter non-existing column " + columnname + " in table " + tablename.first + "." + tablename.second);

        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to schema owner to manage it
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to alter column " + columnname + " in table " + tablename.first + "." + tablename.second);

        //Validations DONE, do the actual work!
        WritableRecord updates;
        updates.SetString(MetaObjects_Name,newcolumnname);
        UpdateColumn(trans, tabledef->GetColumnDef(colid)->object_id, WritableRecord(), updates, false);

        return true; //metadata is updated!
}

bool SQLAlterTableAddColumnStatement::Execute(BackendTransaction &trans)
{
        TableId tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"No such table " + tablename.first + "." + tablename.second);

        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);
        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to schema owner to manage it
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to add column " + newcol.coldef.name + " in table " + tablename.first + "." + tablename.second);

        if (tabledef->GetObjectId(newcol.coldef.name) != 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot add column '" + newcol.coldef.name + "' in table '" + tablename.first + "'.'" + tablename.second + "', a column with that name already exists");

        //Assign an ID, if necessary
        if (newcol.coldef.column_id==0)
            newcol.coldef.column_id = static_cast<ColumnId>(trans.GetNewColumnId(*tabledef));
        newcol.coldef.object_id = trans.GetNewObjectId();

        //Look up the references table
        if (!newcol.foreignreference.second.empty())
        {
                //Convert unqualified references to SELF!
                if (newcol.foreignreference.first.empty())
                    newcol.foreignreference.first = schemadef->name;

                SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
                newcol.coldef.foreignreference = GetValidateReference(trans, newcol.foreignreference, schemadef, *tabledef, newcol.coldef, newcol.coldef.ondelete);
        }
        if (!newcol.foreignreferencesbycolumn.empty())
        {
                newcol.coldef.foreignreferencesbycolumn = tabledef->GetColumnId(newcol.foreignreferencesbycolumn);
                if (!newcol.coldef.foreignreferencesbycolumn)
                    throw Exception(ErrorIllegalSQLCommand,"Could not find column " + newcol.foreignreferencesbycolumn);
        }

        if (newcol.make_primary)
            throw Exception(ErrorIllegalSQLCommand, "Cannot alter table primary column of table table '" + tablename.first + "'.'" + tablename.second + "'");

        trans.NotifyMetaColumnChange(tabledef->object_id, newcol.coldef.column_id, true);

        //Transmit the update..
        TableDef const *metaobjects = trans.GetMetadata().GetTableDef(TableId_MetaObjects);
        TableDef const *metacolumns = trans.GetMetadata().GetTableDef(TableId_MetaColumns);
        WritableRecord newrec;
        ObjectToRecord(newcol.coldef,tableid,&newrec);
        trans.InsertRecord(*metaobjects, newrec, true, true);
        newrec=Record();
        ColumnToRecord(newcol, &newrec);
        trans.InsertRecord(*metacolumns,newrec,true, true);

        trans.FinishCommand();

        return true; //metadata is updated!
}

// GCC 5.1.1 gives an array bounds error on 'is_applicable = it->descr.columns[i] == colid || is_applicable;'
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Warray-bounds"

bool SQLAlterTableAlterColumnStatement::Execute(BackendTransaction &trans)
{
        TableId tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter columns in non-existing table '" + tablename.first + "." + tablename.second + "'");

        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);
        ColumnId colid = tabledef->GetColumnId(colinfo.coldef.name);
        if (!colid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter non-existing column '" + colinfo.coldef.name + "' in table '" + tablename.first + "." + tablename.second + "'");
        ColumnDef *columndef = const_cast<ColumnDef*>(tabledef->GetColumnDef(colid)); //FIXME:Ugly const hack!

        if (type == SetMaxLength && columndef->maxsize > static_cast<unsigned>(colinfo.coldef.maxsize))
            throw Exception(ErrorIllegalSQLCommand,"Cannot shrink the size of an existing column '" + colinfo.coldef.name + "' in table '" + tablename.first + "." + tablename.second + "'");

        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!bypass_rights)
        {
                if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to schema owner to manage it
                    throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to alter column '" + colinfo.coldef.name + "' in table '" + tablename.first + "." + tablename.second + "'");
        }

        TableId referenced_tableid = 0;
        if (type == AddReference)
        {
                if (columndef->foreignreference)
                    throw Exception(ErrorIllegalSQLCommand,"Column already refers to another table");

                SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
                referenced_tableid = GetValidateReference(trans, colinfo.foreignreference, schemadef, *tabledef, *columndef, colinfo.coldef.ondelete);
        }

        if (type == DropColumn)
        {
                //Never drop a primary column (ADDME: dropping is safe if we ensure there are no foreign references)
                if (tabledef->primarykey == colid)
                    throw Exception(ErrorIllegalSQLCommand,"Cannot drop primary column " + colinfo.coldef.name + " in table " + tablename.first + "." + tablename.second);

                //Count the number of undeleted columns
                unsigned countcolumns=0;
                for (TableDef::ColumnCItr itr=tabledef->GetColumns().begin();itr!=tabledef->GetColumns().end();++itr)
                  if (!itr->second.name.empty()) //not a deleted column
                    ++countcolumns;

                if (countcolumns==1)
                    throw Exception(ErrorIllegalSQLCommand, "Cannot drop last column of a table");
        }

        // Notify add/update/delete of column metadata
        if(type != SetNoupdate && type != DropNoupdate && type != DropUnique && type != DropNotNull && type != DropReference && type != DropAutonumber && type != AddAutonumber)
                trans.NotifyMetaColumnChange(tableid, colid, type != DropColumn);

        //Validations DONE, do the actual work!
        WritableRecord c_updates, o_updates;
        switch(type)
        {
        case DropColumn:
                {
                        if (!columndef->internal)
                        {
                                //Prepend a star to mark the record as deleted
                                o_updates.SetString(MetaObjects_Name,"*" + colinfo.coldef.name);
                                c_updates.SetInteger(MetaColumn_ForeignRefer,0);
                                UpdateColumn(trans, columndef->object_id, c_updates, o_updates, false);
                        }
                        else
                        {
                                //Internal records have no physical presence, so just drop them
                                UpdateColumn(trans, columndef->object_id, c_updates, o_updates, true);
                        }

                        // Delete all indices that use this column
                        TableDef::Indices const &indices = tabledef->GetAdditionalIndices();
                        for (TableDef::Indices::const_iterator it = indices.begin(); it != indices.end(); ++it)
                        {
                                bool is_applicable = false;
                                for (unsigned i = 0; i < it->descr.num_indexed_columns; ++i)
                                    is_applicable = it->descr.columns[i] == colid || is_applicable;

                                if (is_applicable)
                                    DeleteSingleObject(trans, it->object_id);
                        }

                } break;
        case SetMaxLength:
                c_updates.SetInteger(MetaColumn_MaxSize, colinfo.coldef.maxsize);
                UpdateColumn(trans, columndef->object_id, c_updates, o_updates, false);
                break;
        case SetNotNull:
        case DropNotNull:
                c_updates.SetBoolean(MetaColumn_NotNull,type==SetNotNull);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case UpdateDefault:
                if (colinfo.defaulttype && columndef->type != colinfo.defaulttype) //setting to wrong type
                    throw Exception(ErrorIllegalSQLCommand, "Incorrect default value type");
                c_updates.SetColumn(MetaColumn_Default, colinfo.coldef.defaultval.size(), &colinfo.coldef.defaultval[0]);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case DropUnique:
        case SetUnique: //FIXME: Post after-check for unqiueness
                c_updates.SetBoolean(MetaColumn_Unique,type==SetUnique);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case DropNoupdate:
        case SetNoupdate:
                c_updates.SetBoolean(MetaColumn_NoUpdate,type==SetNoupdate);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case DropReference:
                c_updates.SetInteger(MetaColumn_ForeignRefer, 0);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case AddReference:
                c_updates.SetInteger(MetaColumn_ForeignRefer, referenced_tableid);
                c_updates.SetInteger(MetaColumn_ForeignBehav, colinfo.coldef.ondelete);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case DropAutonumber:
                c_updates.SetInteger(MetaColumn_Autokey, 0);
                UpdateColumn(trans, columndef->object_id,  c_updates, o_updates, false);
                break;
        case AddAutonumber:
                c_updates.SetInteger(MetaColumn_Autokey, colinfo.coldef.autonumber_start);
                UpdateColumn(trans, columndef->object_id, c_updates, o_updates, false);
                break;
        }

        return true; //metadata is updated!
}

#pragma GCC diagnostic pop

void SQLDropStatementExecutor::GatherDeletionList(std::vector<TableId> *currentlist, TableId tocheck, Metadata const &meta)
{
        //If this table is already on the deletion list, skip it
        if (std::find(currentlist->begin(),currentlist->end(),tocheck) != currentlist->end())
            return;

        //Add the requested table to the deletion list
        currentlist->push_back(tocheck);

        //Look for any tables that refer this table, and also add them to the deletion list
        for (Metadata::TableCItr titr = meta.GetTables().begin(); titr != meta.GetTables().end();++titr)
        {
                if (titr->second.name.empty()) //is deleted
                    continue;

                for (TableDef::ColumnCItr citr = titr->second.GetColumns().begin(); citr != titr->second.GetColumns().end();++citr)
                {
                        if (citr->second.name.empty()) //is deleted
                            continue;

                        if (citr->second.foreignreference == tocheck) //also add this table to the list!
                            GatherDeletionList(currentlist,titr->second.object_id,meta);
                }
        }
}

void SQLDropStatementExecutor::CancelMetaColumnChecks(BackendTransaction &trans, TableId to_cancel)
{
        TableDef const *tabledef = trans.GetMetadata().GetTableDef(to_cancel);
        TableDef::Columns const &columns = tabledef->GetColumns();
        for (TableDef::Columns::const_iterator it = columns.begin(), end = columns.end(); it != end; ++it)
            trans.NotifyMetaColumnChange(to_cancel, it->second.column_id, false);
}

void SQLDropStatementExecutor::DropMetaTabledef(BackendTransaction &trans, TableId todrop)
{
        //ADDME: Also cancel indices to stop them from being updated unnecessarily ?
        CancelMetaColumnChecks(trans, todrop);

        // Delete all records in table
        {
        Scanner scan(trans, ShowNormalSkipAccess, true);
        scan.AddTable(todrop);

        while (scan.NextRow())
        {
                scan.AddActiveRowToCache();
                switch (scan.LockCachedRowWithAutoWait(0))
                {
                case LockResult::Retry: // won't happen due to autowait, fallback to throw for safety
                case LockResult::Deleted:
                case LockResult::Updated: //conflict made update impossible
                        throw Exception(ErrorConflict,"Table is being manipulated by another transaction");
                case LockResult::NoChange: ;
                }
                scan.DeleteLockedRow(0, false);
                scan.ClearCache();
        }
        }

        // Delete table definition
        DeleteSingleObject(trans, todrop);

        // Report table drop to modification mechanism
        trans.ReportTableDrop(todrop);

        trans.FinishCommand();
}

void SQLDropStatementExecutor::RemoveReferenceConstraints(BackendTransaction &trans, std::vector< TableId > &deletelist)
{
        bool any_changes = false;
        for (std::vector< TableId >::const_iterator it = deletelist.begin(); it != deletelist.end(); ++it)
        {
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(*it);
                if (!tabledef || tabledef->name.empty())
                    continue; // Already dropped?

                SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);

                TableDef::Columns const &cols = tabledef->GetColumns();

                for (TableDef::Columns::const_iterator cit = cols.begin(); cit != cols.end(); ++cit)
                    if (cit->second.foreignreference)
                    {
                            // Drop reference
                            SQLAlterTableAlterColumnStatement(std::make_pair(schemadef->name, tabledef->name), cit->second.name, SQLAlterTableAlterColumnStatement::DropReference).Execute(trans);
                            any_changes = true;
                    }
        }

        // Get new metadata if applicable
        if (any_changes)
            trans.RefreshMetadata(false);
}

bool SQLDropTableStatement::Execute(BackendTransaction &trans)
{
        tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"No such table " + tablename.first + "." + tablename.second);

        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);

        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        return SQLDropStatementExecutor::Execute(trans);
}

bool SQLDropStatementExecutor::Execute(BackendTransaction &trans)
{
        std::vector<TableId> delete_list;
        GatherDeletionList(&delete_list, tableid, trans.GetMetadata());

        if (delete_list.size()>1 && !cascade) //the deletion requires a cascade
            throw Exception(ErrorIllegalSQLCommand,"Table " + tablename.first+"."+tablename.second + " requires a cascade drop, because it is referred by other tables");

        // Remove all reference constraints, for quick deletion.
        RemoveReferenceConstraints(trans, delete_list);

        //ADDME: If we had a 'proper' deleter (That didn't care about temporary dangling foreign references) we could do this in a more normal order
        for (unsigned i=delete_list.size();i>0;--i)
            DropMetaTabledef(trans,delete_list[i-1]);

        return true; //metadata is updated!
}

bool SQLDropStatementExecutor::ExecuteFromList(BackendTransaction &trans, std::vector<TableId> const &deltables)
{
        std::vector<TableId> delete_list;
        for (std::vector<TableId>::const_iterator it = deltables.begin(); it != deltables.end(); ++it)
          GatherDeletionList(&delete_list, *it, trans.GetMetadata());

        if (!cascade) //the deletion requires a cascade
            throw Exception(ErrorIllegalSQLCommand,"Multi-table drop requires cascade");

        // Remove all reference constraints, for quick deletion.
        RemoveReferenceConstraints(trans, delete_list);

        //ADDME: If we had a 'proper' deleter (That didn't care about temporary dangling foreign references) we could do this in a more normal order
        for (unsigned i=delete_list.size();i>0;--i)
            DropMetaTabledef(trans,delete_list[i-1]);

        return true; //metadata is updated!
}


bool SQLDropSchemaStatement::Execute(BackendTransaction &trans)
{
        Metadata const &oldmetadata = trans.GetMetadata();

        ObjectId schemaid = oldmetadata.GetRootObject().GetObjectId(schemaname);
        if (!schemaid)
            throw Exception(ErrorIllegalSQLCommand,"No such schema " + schemaname);

        if (schemaid < 0)
            throw Exception(ErrorIllegalSQLCommand,"System schema " + schemaname + " may not be dropped");

        // Check privileges. Only owner may drop a schema
        SchemaDef const *schemadef = trans.GetMetadata().GetSchemaDef(schemaid);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"Only owner may drop schemas");

        DEBUGPRINT("Dropping schema #" << schemaid);

        DEBUGPRINT("Dropping tables");
        std::vector< TableId > tables;
        for (Metadata::Tables::const_iterator it = oldmetadata.GetTables().begin(); it != oldmetadata.GetTables().end(); ++it)
            if (it->second.parent_object->object_id == schemaid && !it->second.name.empty())
                tables.push_back(it->second.object_id);
        SQLDropStatementExecutor(true).ExecuteFromList(trans, tables);

        DEBUGPRINT("Deleting schema #" << schemaid);

        DeleteSingleObject(trans, schemaid);

        return true;
}

bool SQLAlterTableModifyMgrStatement::Execute(BackendTransaction &trans)
{
        TableId tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot alter non-existing table " + tablename.first + "." + tablename.second);

        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);

        // Check privileges. Needed: Schema_MetadataManagement on schema where table resides.
        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        Blex::ToUppercase(newmgr);

        if (!newmgr.empty())
        {
                std::string::iterator colon = std::find(newmgr.begin(), newmgr.end(), ':');
                std::string funcname(newmgr.begin(), colon);

                if (is_readaccess)
                {
                        if (!trans.backend.plugins.GetReadAccess(funcname,schemadef->name + "." + tabledef->name))
                            throw Exception(ErrorIllegalSQLCommand,"No such read access handler " + newmgr);
                }
                else
                {
                        if (!trans.backend.plugins.GetWriteAccess(funcname,schemadef->name + "." + tabledef->name))
                            throw Exception(ErrorIllegalSQLCommand,"No such write access handler " + newmgr);
                }
        }

        //update the physical record
        WritableRecord updates;
        updates.SetString(is_readaccess ? MetaTable_ReadAccess : MetaTable_WriteAccess,newmgr);
        UpdateTable(trans,tableid,updates);

        return true; //metadata update
}

///////////////////////////////////////////////////////////////////////////////
//
// Create Index statement
//
bool SQLCreateIndexStatement::Execute(BackendTransaction &trans)
{
        //Look up the referred table
        TableId tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"No such table " + tablename.first + "." + tablename.second);

        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);

        // Check privileges. Needed: Schema_MetadataManagement on schema where table resides.
        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        //Look up our index tables
        TableDef const &objects_tabledef = *trans.GetMetadata().GetTableDef(TableId_MetaObjects);
        TableDef const &indices_tabledef = *trans.GetMetadata().GetTableDef(TableId_MetaIndices);
        TableDef const &indexcolumns_tabledef = *trans.GetMetadata().GetTableDef(TableId_MetaIndexColumns);

        //Check the index name for uniqueness
        IndexDef const *idx = tabledef->GetIndexDef(indexname);
        if (idx)
            throw Exception(ErrorIllegalSQLCommand,"Table " + tablename.first+"."+tablename.second + " already has an index named " + indexname);

        int32_t newindexid = trans.GetAutonumberKey(indices_tabledef, *indices_tabledef.GetColumnDef(MetaIndex_IndexId));

        ObjectDef obj(MetaObjectType::Index);
        obj.object_id = trans.GetNewObjectId();
        obj.name = indexname;

        WritableRecord newindex;
        ObjectToRecord(obj, tabledef->object_id, &newindex);
        trans.InsertRecord(objects_tabledef, newindex, true, true);
        newindex=Record();

        newindex.SetInteger(MetaIndex_ObjectId, obj.object_id);
        newindex.SetInteger(MetaIndex_IndexId, newindexid);
//        newindex.SetInteger(MetaIndex_TableId, tableid);
        newindex.SetBoolean(MetaIndex_Uppercase, uppercase);
        newindex.SetBoolean(MetaIndex_Unique, unique);
        newindex.SetBoolean(MetaIndex_NoNullStores, nonullstores);
//        newindex.SetString(MetaIndex_Name, indexname);
        trans.InsertRecord(indices_tabledef, newindex, true, true);

        // Check if the sizes are specified.
        for (unsigned i=0;i<columns.size();++i)
        {
                Database::ColumnId colid = tabledef->GetColumnId(columns[i].colname);
                if (colid==0)
                    throw Exception(ErrorIllegalSQLCommand,"Table " + tablename.first+"."+tablename.second + " has no column named " + columns[i].colname);
                Database::ColumnDef const *coldef = tabledef->GetColumnDef(colid);

                if (TypeIsDynamic(coldef->type) && i != columns.size() - 1 && columns[i].maxlength == 0)
                    throw Exception(ErrorIllegalSQLCommand,"The size reserved for a column may not be omitted for dynamically-sized data types, except for the last column");
        }

        //Add the individual columns
        for (unsigned i=0;i<columns.size();++i)
        {
                WritableRecord newcolumn;

                Database::ColumnId colid = tabledef->GetColumnId(columns[i].colname);
                if (colid==0)
                    throw Exception(ErrorIllegalSQLCommand,"Table " + tablename.first+"."+tablename.second + " has no column named " + columns[i].colname);
                newcolumn.SetInteger(MetaIndexColumn_IndexId, newindexid);
                newcolumn.SetInteger(MetaIndexColumn_ColumnId, colid);
                newcolumn.SetInteger(MetaIndexColumn_Ordering, i);
                newcolumn.SetInteger(MetaIndexColumn_Length, columns[i].maxlength);
                trans.InsertRecord(indexcolumns_tabledef, newcolumn, true, true);
        }
        trans.FinishCommand();

        //ADDME: When adding a Unique index, post an on-commit constraint check

        return true;
}

///////////////////////////////////////////////////////////////////////////////
//
// Drop Index statement
//
bool SQLDropIndexStatement::Execute(BackendTransaction &trans)
{
        //Look up the referred table
        TableId tableid = LookupSchemaTableName(trans, tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"No such table " + tablename.first + "." + tablename.second);

        // Check privileges. Needed: Schema_MetadataManagement on schema where table resides.
        TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);
        SchemaDef const *schemadef = static_cast<SchemaDef const*>(tabledef->parent_object);
        if (!trans.IsRoleEnabled(schemadef->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to complete this operation");

        //The index apparently exists. Delete it 'for real'.
        { // prevent Index Update deadlocks caused by our scanner holding Index locks (ADDME: cleanup when the new Scanner is properly implemented!)

                Scanner scan(trans, ShowNormalSkipAccess, true);
                scan.AddTable(TableId_MetaObjects);
                scan.AddIntegerSearch(0,MetaObjects_Parent,tableid,SearchEqual);
                scan.AddStringSearch(0,MetaObjects_Name,indexname,SearchEqual,true);
                scan.AddIntegerSearch(0,MetaObjects_Type,MetaObjectType::Index,SearchEqual);

                if (!scan.NextRow())
                    throw Exception(ErrorInternal,"Table " + tablename.first+"."+tablename.second + " has no index named " + indexname);

                //ADDME: Sleep until record is available, merge any changes?
                scan.AddActiveRowToCache();
                if (scan.LockCachedRowWithAutoWait(0) != LockResult::Deleted)
                    scan.DeleteLockedRow(0, true);
        }

        trans.FinishCommand();

        return true;
}

///////////////////////////////////////////////////////////////////////////////
//
// Drop Role statement
//
bool SQLDropRoleStatement::Execute(BackendTransaction &trans)
{
        Metadata const &metadata = trans.GetMetadata();
        RoleId roleid = FindRoleId(trans, role.first, role.second);
        if (roleid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot drop non-existing role '" + role.first + "." + role.second + "'");

        SchemaDef const *schema = metadata.GetSchemaDef(metadata.GetRootObject().GetObjectId(role.first));
        if (!schema)
            throw Exception(ErrorIllegalSQLCommand,"No such schema '" + role.first + "' when dropping role '" + role.first + "." + role.second + "'");

        // Check privileges. Needed: Schema_RoleManagement on schema where role is created.
        if (!trans.IsRoleEnabled(schema->owner)) //must have access to the schema owner role
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to drop role '" + role.first + "." + role.second + "'");

        DropRole(trans, roleid);

        return true;
}

bool SQLDropUserStatement::Execute(BackendTransaction &trans)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may drop users");
        Blex::ToUppercase(username);

        RoleId roleid = FindRoleId(trans, "DEFINITION_SCHEMA", username);
        if (roleid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot drop non-existing user '" + username + "'");

        DropRole(trans, roleid);

        return true;
}

///////////////////////////////////////////////////////////////////////////////
//
// Wait Index statement
//
bool SQLWaitStatement::Execute(BackendTransaction &trans)
{
        //ADDME: Find a way to return to the dispatcher while waiting!
        DEBUGPRINT("Transaction wants to wait for index fill");
        if(trans.GetIndexSystem())
            trans.GetIndexSystem()->WaitForFillComplete();
        return false;
}

///////////////////////////////////////////////////////////////////////////////
//
// Show statement
//

struct ShowColumnInfo
{
        char const *name;
        ColumnTypes type;
};
struct Shows
{
        char const *showname;
        char const *description;
        void (*showfunction)(BackendTransaction &, TempResultSet *storage);
        ShowColumnInfo const *columns;
};

static ShowColumnInfo const cols_dbfile_section []= { {"ID",TInteger}, {"TABLEID",TInteger}, {"SCHEMANAME",TText}, {"TABLENAME",TText}, {NULL,TText} };
void Show_DBFileSections(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may trans the list of database sections");

        WritableRecord data;
        for (unsigned i=0;i<trans.backend.rawdb.GetNumSections();++i)
        {
                data.SetInteger(1, i);
                data.SetInteger(2, trans.backend.rawdb.Deprecated_GetSectionTableId(i));
                //FIXME: Remove column when we can just join against objects table
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(trans.backend.rawdb.Deprecated_GetSectionTableId(i));
                if (tabledef)
                {
                        data.SetString(3, tabledef->parent_object->name);
                        data.SetString(4, tabledef->name);
                }
                else
                {
                        data.SetString(3, "");
                        data.SetString(4, "");
                }
                storage->AddRecord(data);
        }
}


static ShowColumnInfo const cols_janitor[] = { {"WAITUNTIL",TDateTime}, {"NEXTTASK", TText}, {"NUMHINTS", TInteger}, {"MAXWAIT", TInteger}, {NULL,TText} };
void Show_Janitor(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
                throw Exception(ErrorWriteAccessDenied,"Only sysops may list janitor");

        WillieState willystate;
        trans.backend.GetWillieState(&willystate);

        WritableRecord data;

        data.SetDateTime(1, willystate.waituntil);
        data.SetString(2, willystate.nexttask);
        data.SetInteger(3, willystate.numhints);
        data.SetInteger(4, willystate.maxwait);
        storage->AddRecord(data);
}

static ShowColumnInfo const cols_transactions[] = { {"TRANSID",TInteger}, {"USERNAME",TText}, {"SOURCE",TText}, {"REFCOUNT",TInteger}, {"ISFINISHED",TBoolean}, {"ISSELF",TBoolean}, {"STARTTIME",TDateTime}, {"CLIENT",TText}, {"TRANSSTAGE",TText}, {"WAITSFOR",TInteger}, {"CURRENTRPC",TText}, {"RPCINFO",TText}, {NULL,TText} };
void Show_Transactions(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may list transactions");

        std::vector<Backend::TransactionInfo> all;
        trans.backend.ExportTransactionInfo(&all);

        WritableRecord data;
        TransId my_id = trans.GetTransId();

        for (unsigned i=0;i<all.size();++i)
        {
                data.SetInteger(1, all[i].transid);
                data.SetString(2, all[i].username);
                data.SetString(3, all[i].source);
                data.SetInteger(4, all[i].refcount);
                data.SetBoolean(5, all[i].isfinished);
                data.SetBoolean(6, all[i].transid == my_id);
                data.SetDateTime(7, all[i].started);
                data.SetString(8, all[i].client);
                data.SetString(9, all[i].transstage);
                data.SetInteger(10, all[i].waitingfor);
                data.SetString(11, all[i].currentrpc);
                data.SetString(12, all[i].rpcinfo);
                storage->AddRecord(data);
        }
}

static ShowColumnInfo const cols_querylog[] = { {"ID", TInteger64}, {"TRANSID",TInteger}, {"STARTTIME",TDateTime}, {"PLAN",TText}, {"ORIGIN",TText}, {"SENTROWS",TInteger}, {"TIME",TInteger}, {NULL,TText} };
void Show_Querylog(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may list queries");

        std::vector< Backend::QueryInfo > all;
        trans.backend.ExportQueryInfo(&all);

        WritableRecord data;
        for (unsigned i=0;i<all.size();++i)
        {
                data.SetInteger64(1, all[i].id);
                data.SetInteger(2, all[i].transid);
                data.SetDateTime(3, all[i].starttime);
                data.SetString(4, all[i].plan);
                data.SetString(5, all[i].origin);
                data.SetInteger(6, all[i].sentrows);
                data.SetInteger(7, all[i].time);
                storage->AddRecord(data);
        }
}

static ShowColumnInfo const cols_metadata_errors[] = { {"ID",TInteger}, {"ERROR",TText}, {NULL,TText} };
void Show_MetadataErrors(BackendTransaction &trans, TempResultSet *storage)
{
        std::vector< Exception > errors;
        trans.backend.GetMetadataManager().AnyErrors(&errors);

        WritableRecord data;
        for (unsigned i=0;i<errors.size();++i)
        {
                data.SetInteger(1, i); //id
                data.SetString(2, errors[i].what()); //error
                storage->AddRecord(data);
        }
}

static ShowColumnInfo const cols_indices []= { {"ID",TInteger}, {"INTERNALNAME",TText}, {"TABLE", TText}, {"NAME", TText}, {"TOTALRECORDS", TInteger}, {"DUPLICATES", TInteger}, {"STATE", TText}, {NULL,TText} };
void Show_Indices(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may trans the list of indices");

        Index::System *indexsystem = trans.backend.GetIndexSystem();
        if(!indexsystem)
            return;

        WritableRecord data;
        for (unsigned i=0;;++i)
        {
                Index::Descriptor descriptor;
                if (!indexsystem->GetDescriptorOfIndexByNr(i, &descriptor))
                    break;

                Index::IndexData::Ref ref = indexsystem->GetIndexRef(descriptor);
                Blex::Index::Statistics stats;
                ref->GetStatistics(&stats);

                TableId tableid = descriptor.table;
                TableDef const *tabledef = trans.GetMetadata().GetTableDef(tableid);
                if (!tabledef)
                    continue;
                std::string ext_name;
                TableDef::Indices const &indices = tabledef->GetAdditionalIndices();
                for (TableDef::Indices::const_iterator it = indices.begin(); it != indices.end(); ++it)
                    if (it->descr == descriptor)
                        ext_name = it->name;

                data.SetInteger(1, i); //id
                data.SetString(2, descriptor.GetName()); //name
                data.SetString(3, tabledef->parent_object->name + "." + tabledef->name); //table
                data.SetString(4, ext_name);
                data.SetInteger(5, stats.totalentries);
                data.SetInteger(6, stats.duplicates);
                data.SetString(7, ref->IsReady() ? "ready" : "initializing");
                storage->AddRecord(data);
        }
}

static ShowColumnInfo const cols_usedblobs []= { {"BLOBID",TInteger}, {NULL,TText} };
void Show_UsedBlobs(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may trans the list of used blobs");

        Blex::PodVector< BlobId > usedblobs;
        trans.backend.GetBlobMgr().ExportUsedBlobs(&usedblobs);

        WritableRecord data;
        for (auto blobid: usedblobs)
        {
                data.SetInteger(1, blobid); //blobid
                storage->AddRecord(data);
        }
}

void DumpParameter(BackendTransaction &trans, TempResultSet *storage, std::string const &param)
{
        bool have_one = false;
        bool do_all = param.empty();
        if (!do_all)
            storage->AddColumn("VALUE", TText);

        WritableRecord data;

        if (do_all || param=="RPCINFO")
        {
                if (do_all) data.SetString(1, "RPCINFO"); //name
                data.SetString(do_all ? 2 : 1, trans.backend.GetParamRPCInfo() ? "ON" : "OFF"); //name
                storage->AddRecord(data);
                have_one = true;
        }
        if (do_all || param=="CASCADING")
        {
                if (do_all) data.SetString(1, "CASCADING"); //name
                data.SetString(do_all ? 2 : 1, trans.cascade_deletes ? "ON" : "OFF"); //name
                storage->AddRecord(data);
                have_one = true;
        }
        if (do_all || param=="CLUSTERING")
        {
                if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
                    throw Exception(ErrorWriteAccessDenied,"Only sysops may change the clustering parameter");

                if (do_all) data.SetString(1, "CLUSTERING"); //name
                data.SetString(do_all ? 2 : 1, trans.clustering_updates ? "ON" : "OFF"); //name
                storage->AddRecord(data);
                have_one = true;
        }
        if (do_all || param=="TRANSACTIONTIMEOUT")
        {
                if (do_all) data.SetString(1, "TRANSACTIONTIMEOUT"); //name
                data.SetString(do_all ? 2 : 1, trans.may_time_out ? "ON" : "OFF"); //name
                storage->AddRecord(data);
                have_one = true;
        }
        if (do_all || param=="JANITOR_MAXWAIT")
        {
                if (do_all) data.SetString(1, "JANITOR_MAXWAIT"); //name
                data.SetString(do_all ? 2 : 1, trans.backend.GetParamRPCInfo() ? "ON" : "OFF"); //name
                storage->AddRecord(data);
                have_one = true;
        }

        if (!have_one)
            throw Exception(ErrorIllegalSQLCommand,"No such parameter " + param);
}

static ShowColumnInfo const cols_parameter[] = { {"VALUE",TText}, {NULL,TText} };
static ShowColumnInfo const cols_parameters[] = { {"PARAMETER",TText}, {"VALUE",TText}, {NULL,TText} };

void Show_Parameters(BackendTransaction &trans, TempResultSet *storage)
{
        DumpParameter(trans, storage, "");
}


void Show_Null(BackendTransaction &, TempResultSet *) {}

static ShowColumnInfo const cols_shows[] = { {"SHOWNAME",TText}, {"DESCRIPTION",TText}, {NULL,TText} };
void Show_Shows(BackendTransaction &, TempResultSet *storage);

static Shows const showmodes[] =
{ { "SHOWS", "Display all available show modes", &Show_Shows, cols_shows }
, { "TRANSACTIONS", "Show running and finished (but still notifying) transactions", &Show_Transactions, cols_transactions }
, { "QUERYLOG", "Show query log", &Show_Querylog, cols_querylog}
, { "METADATA_ERRORS", "Display errors that occurred during metadata reading", &Show_MetadataErrors, cols_metadata_errors }
, { "DBFILE_SECTIONS", "Display database file sections", &Show_DBFileSections, cols_dbfile_section }
, { "INDICES", "Show all available indices", &Show_Indices, cols_indices }
, { "INDEX", "Show a specific index", &Show_Null, cols_indices } // handled internally
, { "PARAMETERS", "Show the values of all run-time parameters", &Show_Parameters, cols_parameters }
, { "PARAMETER", "Show the value of a single run-time parameter", &Show_Null, cols_parameter } // handled internally
, { "JANITOR", "Show the janitor state", &Show_Janitor, cols_janitor} // handled internally
, { "USEDBLOBS", "Show the list of currently referenced blobs", &Show_UsedBlobs, cols_usedblobs}
};

static unsigned const num_showmodes = sizeof(showmodes)/sizeof(*showmodes);

void Show_Shows(BackendTransaction &, TempResultSet *storage)
{
        WritableRecord data;
        for (unsigned i=0;i<num_showmodes;++i)
        {
                data.SetString(1,showmodes[i].showname);
                data.SetString(2,showmodes[i].description);
                storage->AddRecord(data);
        }
}

void SQLShowStatement::DumpSection(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may trans the contents of a database file section");

        if (sectionid>=trans.backend.rawdb.GetNumSections())
             return;
        TableDef const *tabledef = trans.GetMetadata().GetTableDef(trans.backend.rawdb.Deprecated_GetSectionTableId(sectionid));
        if (!tabledef)
            return;

        storage->AddColumn("__REC", TInteger);
        storage->AddColumn("__LEN", TInteger);
        storage->AddColumn("__INS", TInteger);
        storage->AddColumn("__DEL", TInteger);
        storage->AddColumn("__UPD", TInteger);

        if(!headersonly)
        {
                for (TableDef::ColumnCItr citr = tabledef->GetColumns().begin(); citr!=tabledef->GetColumns().end(); ++citr)
                    storage->AddColumn(citr->second.name, citr->second.type);
        }

        Database::RawDatabase::SectionViewer viewer(trans.backend.rawdb, tabledef->object_id);
        if (!viewer.MoveToSection(sectionid))
            return;

        WritableRecord rec;
        do
        {
                for (RawDatabase::SectionViewer::DiskRecord const *rit = viewer.view_begin(); rit != viewer.view_end(); ++rit)
                {
                        RawDatabase::Debug_RecordData data = trans.backend.rawdb.Debug_GetRecordInfo(rit->recordid);
                        rec=Record(); //reset
                        rec.SetInteger(1,rit->recordid);
                        rec.SetInteger(2,data.size);
                        rec.SetInteger(3,data.adder);
                        rec.SetInteger(4,data.remover);
                        rec.SetInteger(5,data.next);

                        if(!headersonly)
                        {
                                uint16_t cellcounter=6;
                                for (TableDef::ColumnCItr citr = tabledef->GetColumns().begin(); citr!=tabledef->GetColumns().end(); ++citr, ++cellcounter)
                                {
                                        Cell inputcell = rit->record.GetCell(citr->second.column_id);
                                        if (inputcell.Exists())
                                            rec.SetColumn(cellcounter, inputcell.Size(), inputcell.Begin());
                                }
                        }
                        storage->AddRecord(rec);
                }
        } while (viewer.NextViewInSection());
}

void SQLShowStatement::DumpIndex(BackendTransaction &trans, TempResultSet *storage)
{
        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only sysops may trans the contents of an index");

        Index::System *indexsystem = trans.backend.GetIndexSystem();
        if(!indexsystem)
            return;

        Index::Descriptor descriptor;
        if (!indexsystem->GetDescriptorOfIndexByNr(indexid, &descriptor))
            return;

        storage->AddColumn("__RECID", TInteger);
        for (unsigned i = 0; i < descriptor.num_indexed_columns; ++i)
        {
                ColumnTypes ct;
                if (descriptor.storage[i] == Index::StoreS32)
                    ct = TInteger;
                else if (descriptor.storage[i] == Index::StoreDateTime)
                    ct = TDateTime;
                else
                    ct = TText;
                storage->AddColumn("__COL" + Blex::AnyToString(i), ct);
        }

        Index::IndexData::Ref qref = indexsystem->GetIndexRef(descriptor);
        Cell empty;
        std::shared_ptr< Blex::Index::BtreeIndex::Query > query = qref->MakeMultiQuery(&empty, 0, SearchBiggerEqual, false);

        WritableRecord rec;
        Blex::Index::BtreeIndex::Query::OnlineRef ref(*query);
        Blex::Index::BtreeIndex::OnlineIterator indexit(ref, *query->begin());
        while (*indexit < *query->approx_end())
        {
                rec=Record(); //reset
                rec.SetInteger(1,indexit->GetRecordId());

                unsigned len = indexit->GetDataLength();
                const uint8_t *data = indexit->GetData();
                for (unsigned i = 0; i < descriptor.num_indexed_columns; ++i)
                {
                        if (descriptor.storage[i] == Index::StoreS32)
                        {
                                rec.SetInteger(uint16_t(2 + i),int32_t(Blex::getu32msb(data) ^ 0x80000000));
                                data += 4;
                                len -= 4;
                        }
                        else //ADDME: StoredateTime support
                        {
                                unsigned tl = std::min(len, descriptor.storesize[i]);
                                rec.SetString(uint16_t(2 + i),std::string(data, data + tl));
                                data += tl;
                                len -= tl;
                        }
                }
                storage->AddRecord(rec);
                ++indexit;
        }
}

bool SQLShowStatement::Execute(BackendTransaction &trans, TempResultSet *storage)
{
        if (what=="SECTION")
        {
                //FIXME: Verify read privs! Or perhaps make it sysoponly.... (ADDME: How about a DEFINITION_SCHEMA._DATABASE_DEBUGGER role, grantably by sysop, for this kind of stuff? or perhaps connect to BACUP privileges?)
                DumpSection(trans,storage);
                return false;
        }
        if (what=="SECTIONHEADERS")
        {
                //FIXME: Verify read privs! Or perhaps make it sysoponly.... (ADDME: How about a DEFINITION_SCHEMA._DATABASE_DEBUGGER role, grantably by sysop, for this kind of stuff? or perhaps connect to BACUP privileges?)
                DumpSection(trans,storage);
                return false;
        }
        if (what=="INDEX")
        {
                //FIXME: Verify read privs! Or perhaps make it sysoponly....
                DumpIndex(trans,storage);
                return false;
        }
        if (what=="PARAMETER")
        {
                DumpParameter(trans, storage, param);
                return false;
        }

        //FIXME: Protect sensitive commands!
        for (unsigned i=0;i<num_showmodes;++i)
          if (what==showmodes[i].showname)
        {
                for (ShowColumnInfo const *ptr=showmodes[i].columns;ptr->name!=NULL;++ptr)
                    storage->AddColumn(ptr->name,ptr->type);
                (showmodes[i].showfunction)(trans,storage);
                return false;
        }
        throw Exception(ErrorIllegalSQLCommand,"No such show option " + what);
}

bool SQLGrantRevokePrivilegesStatement::Execute(BackendTransaction &trans)
{
        Metadata const &metadata = trans.GetMetadata();

        Blex::ToUppercase(schema);
        Blex::ToUppercase(table);
        for (std::vector< std::string >::iterator it = columns.begin(); it != columns.end(); ++it)
            Blex::ToUppercase(*it);

        std::vector< ObjectDef const * > objects;
        if (object_type == MetaObjectType::Schema)
        {
                ObjectDef const *object = metadata.GetSchemaDef(metadata.GetRootObject().GetObjectId(schema));
                if (!object)
                    throw Exception(ErrorIllegalSQLCommand,"Cannot grant privileges on non-existing schema '" + schema + "'");
                objects.push_back(object);
        }
        else if (object_type == MetaObjectType::Table || object_type == MetaObjectType::Column)
        {
                TableId tableid = LookupSchemaTableName(trans, std::make_pair(schema,table));
                if (!tableid)
                    throw Exception(ErrorIllegalSQLCommand,"Cannot grant privileges on non-existing table '" + schema + "." + table + "'");

                TableDef const *tabledef = metadata.GetTableDef(tableid);
                if (object_type == MetaObjectType::Column)
                {
                        for (std::vector< std::string >::const_iterator it = columns.begin(); it != columns.end(); ++it)
                        {
                                    ColumnId colid = tabledef->GetColumnId(*it);
                                    if (!colid)
                                        throw Exception(ErrorIllegalSQLCommand,"Cannot grant privileges on non-existing column '" + schema + "." + table + "(" + *it + ")'");
                                    objects.push_back(tabledef->GetColumnDef(colid));
                        }
                }
                else
                {
                        objects.push_back(tabledef);
                }
        }

        // Global checks
        if (!all_privileges && !privileges.CheckForApplicability(object_type))
            throw Exception(ErrorIllegalSQLCommand,"This privilege(s) do not apply to this kind of object");

        RoleId grantorid = FindRoleId(trans, grantor.first, grantor.second);
        if (grantorid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot grant privileges by non-existing grantor role '" + grantor.first + "." + grantor.second + "'");
        RoleId granteeid = FindRoleId(trans, grantee.first, grantee.second);
        if (granteeid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot grant privileges to non-existing grantee role '" + grantee.first + "." + grantee.second + "'");

        // Privileges: grantor must be _SYSTEM, or (enabled through current user or PUBLIC and have all privileges granted with grant option)
        if (!trans.IsRoleGrantable(grantorid))
            throw Exception(ErrorWriteAccessDenied,"Cannot grant privileges by inactive grantor role '" + grantor.first + "." + grantor.second + "'");

        for (std::vector< ObjectDef const * >::const_iterator it = objects.begin(); it != objects.end(); ++it)
        {
                ObjectDef const *object = *it;

                PrivilegeDescriptor current = privileges;

                PrivilegeDescriptor privs;
                trans.GetMetadata().Privs().GetAllGrantableObjectPrivilegesForRole(grantorid, *object, &privs);
                if (all_privileges)
                    current = privs;
                else if (!privs.HasPrivileges(privileges))
                    throw Exception(ErrorWriteAccessDenied,"Cannot grant privilege by grantor role " + grantor.first + "." + grantor.second + ", it does not have sufficient privileges to execute this statement");
                else
                    current = privileges;

                if (is_grant)
                {
                        // Grant all privileges the grantor has
                        // FIXME: add warning (sql term: completion condition) if privs is empty
                        if (grant_option)
                            current.AddGrantOptions();
                        GrantPrivileges(trans, object->object_id, current, granteeid, grantorid);
                }
                else
                {
                        RevokePrivileges(trans, object->object_id, current, granteeid, grantorid, grant_option);
                }
        }
        return true;
}

bool SQLGrantRevokeRoleStatement::Execute(BackendTransaction &trans)
{
        RoleId grantorid = FindRoleId(trans, grantor.first, grantor.second);
        if (grantorid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot revoke role, grantor role '" + grantor.first + "." + grantor.second + "' does not exist");
        RoleId granteeid = FindRoleId(trans, grantee.first, grantee.second);
        if (granteeid == 0)
            throw Exception(ErrorIllegalSQLCommand,"Cannot revoke role, grantee role '" + grantee.first + "." + grantee.second + "' does not exist");

        // Privileges: grantor must be _SYSTEM, or (enabled through current user or PUBLIC and have all privileges granted with grant option)
        if (!trans.IsRoleGrantable(grantorid))
            throw Exception(ErrorWriteAccessDenied,"Cannot revoke role, grantor '" + grantor.first + "." + grantor.second + "' is not active at the moment");

        for (std::vector< std::pair< std::string, std::string > >::const_iterator it = roles.begin(); it != roles.end(); ++it)
        {
                RoleId roleid = FindRoleId(trans, it->first, it->second);
                if (roleid == 0)
                    throw Exception(ErrorWriteAccessDenied,"Cannot revoke non-existing role '" + it->first + "." + it->second + "'");

                if (!trans.GetMetadata().Privs().IsRoleGrantableByRole(roleid, grantorid))
                    throw Exception(ErrorWriteAccessDenied,"Cannot revoke role '" + it->first + "." + it->second + "', it has not been granted to " + grantor.first + "." + grantor.second + " with admin option");

                if (is_grant)
                    GrantRole(trans, roleid, granteeid, grantorid, admin_option);
                else
                    RevokeRole(trans, roleid, granteeid, grantorid, admin_option);
        }

        return true;
}

bool SQLMoveTableStatement::Execute(BackendTransaction &trans)
{
        TableId tableid = LookupSchemaTableName(trans, old_tablename);
        if (!tableid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot move non-existing table '" + old_tablename.first + "." + old_tablename.second + "'");

        TableDef const *old_tabledef = trans.GetMetadata().GetTableDef(tableid);

        SchemaDef const *old_schemadef = static_cast<SchemaDef const*>(old_tabledef->parent_object);

        ObjectId new_schemaid = trans.GetMetadata().GetRootObject().GetObjectId(new_table.first);
        if (!new_schemaid)
            throw Exception(ErrorIllegalSQLCommand,"Cannot move table to non-existing schema '" + new_table.first + "'");
        SchemaDef const *new_schemadef = trans.GetMetadata().GetSchemaDef(new_schemaid);

        if (new_schemaid == old_schemadef->object_id && new_table.second.empty())
            throw Exception(ErrorIllegalSQLCommand,"A move of a table to the same schema not allowed, except when renaming");

        /* Privileges: metadata management on old schema and on new schema, owner of new schema must have
            references for all referenced tables */
        if (!trans.IsRoleEnabled(old_schemadef->owner) || !trans.IsRoleEnabled(new_schemadef->owner))
            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to move table " + old_tabledef->GetPrettyName() + " to schema " + new_schemadef->GetPrettyName());

        TableDef::Columns const &columns = old_tabledef->GetColumns();
        for (TableDef::ColumnCItr itr = columns.begin(); itr != columns.end(); ++itr)
        {
                if (ObjectId referenced_table = itr->second.foreignreference)
                {
                        TableDef const *refersto = trans.GetMetadata().GetTableDef(referenced_table);
                        ColumnDef const *refersto_column = refersto->GetColumnDef(refersto->primarykey);

                        PrivilegeDescriptor privs;
                        trans.GetMetadata().Privs().GetObjectPrivilegesForSpecificRole(new_schemadef->owner, *refersto_column, &privs);

                        bool has_hard_right = privs.HasPrivilege(Privilege::Column_References);
                        bool has_soft_right = privs.HasPrivilege(Privilege::Column_Select);
                        bool is_soft = itr->second.IsSoftReference(old_tabledef->IsHardReferenced());

                        if (!has_hard_right && !(is_soft && has_soft_right)) //ADDME: Explain required privilege shere too (see 'Owner of the schema ...' error)
                            throw Exception(ErrorWriteAccessDenied, "Cannot move table " + old_tabledef->GetPrettyName() + " to schema " + new_schemadef->GetPrettyName() +
                                ", its owner has no right to make a " + (is_soft?"soft":"hard") + " reference to " + refersto_column->GetPrettyName());
                }
        }

        MoveTableToOtherSchema(trans, new_table.second, tableid, new_schemaid);

        return true;
}

bool SQLSetStatement::Execute(BackendTransaction &trans, ConnectionControl *conncontrol)
{
        if (isglobal)
        {
                if (param == "RPCINFO")
                {
                        bool newval;
                        Blex::ToUppercase(value);
                        if (value == "ON")
                            newval = true;
                        else if (value == "OFF")
                            newval = false;
                        else throw Exception(ErrorIllegalSQLCommand,"Only values ON and OFF are allowed for the cascading parameter");

                        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
                            throw Exception(ErrorWriteAccessDenied,"Only sysops may change the RPCINFO parameter");

                        trans.backend.SetParamRPCInfo(newval);
                }
                else if (param == "JANITOR_MAXWAIT")
                {
                        unsigned maxwait = 0;
                        Blex::ToUppercase(value);
                        if (value == "INSANE")
                            maxwait = 0;
                        else if (value == "BUSY")
                            maxwait = 1;
                        else if (value == "NORMAL")
                            maxwait = 86400;
                        else
                            throw Exception(ErrorIllegalSQLCommand,"Expected 'NORMAL', 'BUSY' or 'INSANE' as value");

                        trans.backend.SetWillieMaxWait(maxwait);
                }
                else
                    throw Exception(ErrorIllegalSQLCommand,"No such global parameter " + param + " exists");
        }
        else
        {
                if (param == "CASCADING")
                {
                        bool newval;
                        Blex::ToUppercase(value);
                        if (value == "ON")
                            newval = true;
                        else if (value == "OFF")
                            newval = false;
                        else throw Exception(ErrorIllegalSQLCommand,"Only values ON and OFF are allowed for the cascading parameter");

                        if (!trans.IsRoleEnabled(MetaRole_SYSTEM))
                            throw Exception(ErrorWriteAccessDenied,"Only sysops may change the CASCADING parameter");

                        trans.cascade_deletes = newval;
                }
                else if (param == "TRANSACTIONTIMEOUT")
                {
                        Blex::ToUppercase(value);
                        if (value == "ON")
                            trans.may_time_out = true;
                        else if (value == "OFF")
                            trans.may_time_out = false;
                        else throw Exception(ErrorIllegalSQLCommand,"Only values ON and OFF are allowed for the transactiontimeout parameter");
                }
                else if (param == "CLUSTERING")
                {
                        throw Exception(ErrorIllegalSQLCommand,"The clustering parameter cannot be changed");
                }
                else if (param == "CLIENTNAME")
                {
                        conncontrol->SetTransactionClientName(value);
                        trans.backend.SetTransactionInfoClientName(&trans, value);
                }
                else
                    throw Exception(ErrorIllegalSQLCommand,"No such local parameter " + param + " exists");
        }
        return false;
}

SQLRefreshMetadata::SQLRefreshMetadata(SQL::Lexer&)
{
}
bool SQLRefreshMetadata::Execute(BackendTransaction &)
{
        return true;
}

} //end namespace SQL

bool BackendTransaction::DoSQLCommand(std::string const &cmd, TempResultSet *storage, ConnectionControl *conncontrol)
{
        /* Let's just throw together a Quick&Dirty parser.. */
        //DEBUGPRINT("Got " << cmd);
        bool newmetadata = SQL::ParseAndExecuteCommand(*this, cmd, storage, state == TransactionState::Normal, conncontrol);

        if (newmetadata) //refresh our side of the story!
        {
                RefreshMetadata(true);
                if (SQL::CascadeGrantChanges(GetMetadata(), *this))
                    RefreshMetadata(false);
        }


        return newmetadata;
}

} //end namespace Database
