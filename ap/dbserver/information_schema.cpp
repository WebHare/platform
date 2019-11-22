#include <ap/libwebhare/allincludes.h>


#include "information_schema.h"
#include "dbase_transaction.h"

namespace Database
{

namespace InformationSchema
{

/* ADDME:
   Metadata code gives stronger guarantees (eg: parent_object is never invalid)
   so we could do away with some of the errorchecking here
*/

//set catalog,schema,name and id for a table, asumming they must be specified in that exact ordering
void SetTableInColumn(WritableRecord *rec, ColumnId first_column_id, TableDef const *table)
{
        if(!table)
             return;

        rec->SetString(first_column_id,"WEBHARE"); //Catalog name
        rec->SetString(ColumnId(first_column_id+1),table->parent_object->name);
        rec->SetInteger(ColumnId(first_column_id+2),table->parent_object->object_id);
        rec->SetString(ColumnId(first_column_id+3),table->name);
        rec->SetInteger(ColumnId(first_column_id+4),table->object_id);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.TABLES
class TablesIterator : public VirtualTableRecordItr
{
        public:
        TablesIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , itr(trans.GetMetadata().GetTables().begin())
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        Metadata::TableCItr itr;
};

bool TablesIterator::GetRecord(WritableRecord *destination)
{
        while (true)
        {
                if (itr == trans.GetMetadata().GetTables().end())
                    return false;
                //ADDME: A "hasanyprivilegesof" would be nice (would requirer smarter permission bit numbering)
                if (trans.HasPrivilege(itr->second.object_id, Privilege::Column_Insert)
                    || trans.HasPrivilegeOnAnyColumn(itr->second.object_id, Privilege::Column_Select))
                    break;
                ++itr;
        }

        SetTableInColumn(destination, 1, &itr->second);
        destination->SetString(6,itr->second.record_itr_func ? "VIEW" : "BASE TABLE");

        ColumnDef const *primary = trans.GetMetadata().GetColumnDef(itr->second.object_id, itr->second.primarykey);
        if (primary)
        {
                destination->SetString(12,primary->name);
                destination->SetInteger(13,primary->object_id);
        }
        destination->SetString(14,itr->second.readaccess_name);
        destination->SetString(15,itr->second.writeaccess_name);

        unsigned max_record_length = 2;
        for (TableDef::ColumnCItr citr = itr->second.GetColumns().begin(); citr != itr->second.GetColumns().end(); ++citr)
        {
                max_record_length += 4;
                max_record_length += citr->second.maxsize;
        }
        destination->SetInteger(16, max_record_length);

        ++itr;
        return true;
}

Database::VirtualTableRecordItr * CreateTablesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new TablesIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.COLUMNS
class ColumnsIterator : public VirtualTableRecordItr
{
        public:
        ColumnsIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , t_itr(trans.GetMetadata().GetTables().begin())
        , c_itr(t_itr->second.GetColumns().begin())
        , started(false)
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        Metadata::TableCItr t_itr;
        TableDef::ColumnCItr c_itr;
        bool started;
};

std::string GetDefaultValue(std::vector<uint8_t> const &val, ColumnTypes coltype)
{
        if(val.empty())
            return std::string();

        if (coltype==TInteger && val.size()==4)
        {
                std::string encoded_data;
                Blex::EncodeNumber<int32_t>(Blex::gets32lsb(&val[0]), 10, std::back_inserter(encoded_data));
                return encoded_data;
        }
        else if (coltype==TBoolean && val.size()==1)
        {
                return val[0]!=0 ? "TRUE" : "";
        }
        else if (coltype==TText)
        {
                std::string encoded_data = "'";
                Blex::EncodeJava(val.begin(), val.end(), std::back_inserter(encoded_data));
                encoded_data += '\'';
                return encoded_data;
        }

        //ADDME: Support more defaults
        return std::string();
}

bool ColumnsIterator::GetRecord(WritableRecord *destination)
{
        if (!started)
        {
                started = true;

                if (t_itr == trans.GetMetadata().GetTables().end())
                    return false;

                while (true)
                {
                        // Set table data in destination record when necessary
                        SetTableInColumn(destination, 2, &t_itr->second); //2-6
                        if (source.IsLimitedMatch(*destination, 2, 5))
                            break;

                        ++t_itr;

                        if (t_itr == trans.GetMetadata().GetTables().end())
                            return false;

                        c_itr=t_itr->second.GetColumns().begin();
                }
        }

        // ADDME: Allow us to peek in the scanner's constrains, see if there is a Table or Column id limiting command
        while (true)
        {
                while(true)
                {
                        if (t_itr == trans.GetMetadata().GetTables().end())
                            return false;
                        while (c_itr == t_itr->second.GetColumns().end())
                        {
                                //Safely try to iterate, continue only if possible
                                while (true)
                                {
                                        // Advance iterator
                                        if (++t_itr == trans.GetMetadata().GetTables().end())
                                            return false;

                                        SetTableInColumn(destination, 2, &t_itr->second); //2-6

                                        if (source.IsLimitedMatch(*destination, 2, 5))
                                            break;
                                }
                                c_itr=t_itr->second.GetColumns().begin();
                        }

                        SetTableInColumn(destination, 2, &t_itr->second); //2-6
                        destination->SetInteger(1,c_itr->second.object_id);
                        destination->SetString(7,c_itr->second.name);

                        // Check if this is already a limited match, if so finish it. If not, go to next
                        if (!source.IsLimitedMatch(*destination, 7, 1))
                        {
                                ++c_itr;
                                continue;
                        }

                        if (!c_itr->second.name.empty() // Privilege tests are expensive, especially under _SYSTEM
                            && (trans.HasPrivilege(c_itr->second.object_id, Privilege::Column_Insert)
                                || trans.HasPrivilege(c_itr->second.object_id, Privilege::Column_Select)))
                            break;

                        ++c_itr; //skip the deleted column
                }

//                destination->SetInteger(1,c_itr->second.object_id);
//                SetTableInColumn(destination, 2, &t_itr->second); //2-6
//                destination->SetString(7,c_itr->second.name);
//
//                // Check if this is already a limited match, if so finish it. If not, go to next
//                if (source.IsLimitedMatch(*destination, 1, 8))
                    break;
//                ++c_itr;

        }

        std::string defaultvalue;

        destination->SetInteger(8,std::distance(t_itr->second.GetColumns().begin(), c_itr)+1); //ordinal
        destination->SetString(9,GetDefaultValue(c_itr->second.defaultval, c_itr->second.type));
        destination->SetString(10,"NO"); //is_nullable (must be NO if we _know_ the column not to be nullable)

        switch(c_itr->second.external_type)
        {
        case TInteger:
                destination->SetString(11,"INTEGER");
                destination->SetInteger(14,32); //precision
                destination->SetInteger(15,2); //radix
                destination->SetInteger(16,0); //scale
                break;
        case TInteger64:
                destination->SetString(11,"INTEGER64");
                destination->SetInteger(14,64); //precision
                destination->SetInteger(15,2); //radix
                destination->SetInteger(16,0); //scale
                break;
        case TBoolean:
                destination->SetString(11,"BOOLEAN");
                destination->SetInteger(13,1); //maximum length in octets
                break;
        case TBlob:
                destination->SetString(11,"BLOB");
                destination->SetInteger(13,0x7FFFFFFF); //maximum length in octets
                break;
        case TDateTime:
                destination->SetString(11,"DATETIME");
                break;
        case TMoney:
                destination->SetString(11,"MONEY");
                destination->SetInteger(14,64); //precision
                destination->SetInteger(15,2); //radix
                destination->SetInteger(16,5); //scale
                break;
        case TFloat:
                destination->SetString(11,"FLOAT");
                destination->SetInteger(14,64); //precision
                destination->SetInteger(15,2); //radix
                break;
        case TText:
                destination->SetString(11,"VARCHAR");
                destination->SetInteger(12,c_itr->second.maxsize); //maximum length in characters
                destination->SetInteger(13,c_itr->second.maxsize); //maximum length in octets
                break;
        case TTable:
                destination->SetString(11,"TABLE");
                break;
        case TRole:
                destination->SetString(11,"ROLE");
                break;
        case TText_Reserved:
        case TUnusedStatic:
        case TUnusedDynamic:
                destination->SetString(11,"ILLEGAL");
                break;
        }
        destination->SetBoolean(38, t_itr->second.primarykey == c_itr->second.column_id);
        destination->SetInteger(39, c_itr->second.autonumber_start);
        destination->SetString(40, c_itr->second.internalcolumn_name);

        if (c_itr->second.foreignreference)
        {
                if (TableDef const *table = trans.GetMetadata().GetTableDef(c_itr->second.foreignreference))
                    SetTableInColumn(destination, 41, table); //41-45

                if(c_itr->second.ondelete == ForeignSetDefault)
                    destination->SetString(46,"SET DEFAULT");
                else if(c_itr->second.ondelete == ForeignCascade)
                    destination->SetString(46,"CASCADE");
        }
        if (c_itr->second.foreignreferencesbycolumn)
        {
                ColumnDef const *table_column = t_itr->second.GetColumnDef(c_itr->second.foreignreferencesbycolumn);

                destination->SetString(51, table_column->name);
                destination->SetInteger(52, table_column->column_id);
        }
        destination->SetBoolean(47, c_itr->second.unique);
        destination->SetBoolean(48, c_itr->second.noupdate);
        destination->SetBoolean(49, c_itr->second.notnull);
        destination->SetInteger(50, c_itr->second.column_id);
        ++c_itr;
        return true;
}

Database::VirtualTableRecordItr * CreateColumnsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new ColumnsIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.SCHEMATA
class SchemataIterator : public VirtualTableRecordItr
{
        public:
        SchemataIterator(BackendTransaction &trans, bool _filtered, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , itr(trans.GetMetadata().GetSchemas().begin())
        , filtered(_filtered)
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        Metadata::SchemaCItr itr;
        bool filtered;
};

bool SchemataIterator::GetRecord(WritableRecord *destination)
{
        while (true)
        {
                if (itr == trans.GetMetadata().GetSchemas().end())
                    return false;

                // Only show definition schema in recovery mode
                if (itr->second.object_id == MetaSchema_DEFINITION_SCHEMA && !trans.backend.IsInRecoveryMode())
                {
                        ++itr;
                        continue;
                }
                if (!filtered)
                    break;
                if (trans.IsRoleEnabled(itr->second.owner))
                    break;
                ++itr;
        }

        destination->SetInteger(1,itr->second.object_id);
        destination->SetString(2,"WEBHARE"); //Catalog name
        destination->SetString(3,itr->second.name);

        RoleDef const *role = trans.GetMetadata().Privs().GetRoleDef(itr->second.owner);
        if (role)
        {
                destination->SetString(4,role->name);
                destination->SetString(6,role->schema->name);
                destination->SetInteger(7,role->schema->object_id);
        }
        destination->SetInteger(5,itr->second.owner);

        ++itr;
        return true;
}

Database::VirtualTableRecordItr * CreateSchemataIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new SchemataIterator(trans, true, source);
}

Database::VirtualTableRecordItr * CreateAllSchemataIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new SchemataIterator(trans, false, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.ENABLED_ROLES
class EnabledRolesIterator : public VirtualTableRecordItr
{
        public:
        EnabledRolesIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , itr(trans.GetMetadata().Privs().GetRoles().begin())
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        PrivilegeChecker::RoleCItr itr;
};

bool EnabledRolesIterator::GetRecord(WritableRecord *destination)
{
        while (true)
        {
                if (itr == trans.GetMetadata().Privs().GetRoles().end())
                    return false;

                // There is a list of enabled_roles in the transaction, but this
                // is the easiest way of retrieving the names of enabled roles:
                // Iterating over the list of roles and binary searching the
                // enabled_roles for each role vs. iterating over the list of
                // enabled_roles and selecting the name for each enabled role.
                if (trans.IsRoleEnabled(itr->second.role_id))
                    break;
                ++itr;
        }

        destination->SetInteger(1,itr->second.role_id);
        destination->SetString(2,itr->second.name);
        if (itr->second.schema)
        {
                destination->SetString(3,itr->second.schema->name);
                destination->SetInteger(4,itr->second.schema->object_id);
        }
        ++itr;
        return true;
}

Database::VirtualTableRecordItr * CreateEnabledRolesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new EnabledRolesIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.APPLICABLE_ROLES
class ApplicableRolesIterator : public VirtualTableRecordItr
{
        public:
        ApplicableRolesIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , itr(trans.GetMetadata().Privs().GetRoles().begin())
        , r_itr(trans.GetMetadata().Privs().GetRoleGrants().begin())
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        PrivilegeChecker::RoleCItr itr;
        PrivilegeChecker::RoleGrantCItr r_itr;
};

bool ApplicableRolesIterator::GetRecord(WritableRecord *destination)
{
        if (itr == trans.GetMetadata().Privs().GetRoles().end())
            return false;
        if (trans.GetMetadata().Privs().GetRoleGrants().empty())
            return false;

        // Applicable roles view:
        // Every role granted to current_user or public
        // + every role granted to every role in this set

        // This is eq to every rolegrant whose grantee is in enabled_roles or PUBLIC.

        while (true)
        {
                if (r_itr == trans.GetMetadata().Privs().GetRoleGrants().begin())
                {
                        // First grant, check the role if it is applicable, advance until it is true
                        while (true)
                        {
                                if (trans.IsRoleEnabled(itr->second.role_id) || itr->second.role_id == MetaRole_PUBLIC)
                                    break;
                                ++itr;
                                if (itr == trans.GetMetadata().Privs().GetRoles().end())
                                    return false;
                        }
                }

                // Is this a grant to current role?
                if (r_itr->second.grantee->role_id == itr->second.role_id)
                    break;

                ++r_itr;
                if (r_itr == trans.GetMetadata().Privs().GetRoleGrants().end())
                {
                        ++itr;
                        if (itr == trans.GetMetadata().Privs().GetRoles().end())
                            return false;
                        r_itr = trans.GetMetadata().Privs().GetRoleGrants().begin();
                }
        }

        destination->SetInteger(1,r_itr->second.role->role_id);
        destination->SetString(2,r_itr->second.role->name);
        destination->SetString(3,r_itr->second.role->schema->name);
        destination->SetInteger(4,r_itr->second.role->schema->object_id);
        destination->SetString(5,r_itr->second.grantee->name);
        destination->SetInteger(6,r_itr->second.grantee->role_id);
        destination->SetString(7,r_itr->second.grantee->schema->name);
        destination->SetInteger(8,r_itr->second.grantee->schema->object_id);
        destination->SetString(9,(r_itr->second.with_admin_option ? "YES" : "NO"));

        ++r_itr;
        if (r_itr == trans.GetMetadata().Privs().GetRoleGrants().end())
        {
                ++itr;
                r_itr = trans.GetMetadata().Privs().GetRoleGrants().begin();
        }
        return true;
}

Database::VirtualTableRecordItr * CreateApplicableRolesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new ApplicableRolesIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.USERS
class UsersIterator : public VirtualTableRecordItr
{
        public:
        UsersIterator(BackendTransaction &trans, VirtualTableSource &source);
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        PrivilegeChecker::RoleCItr itr;
};

UsersIterator::UsersIterator(BackendTransaction &trans, VirtualTableSource &source)
: VirtualTableRecordItr(source)
, trans(trans)
{
        if (trans.IsRoleEnabled(MetaRole_SYSTEM))
            itr = trans.GetMetadata().Privs().GetRoles().begin();
        else
            itr = trans.GetMetadata().Privs().GetRoles().end(); //no access, so clear view completely
}

bool UsersIterator::GetRecord(WritableRecord *destination)
{
        while (true)
        {
                if (itr == trans.GetMetadata().Privs().GetRoles().end())
                    return false;
                if (itr->second.schema
                    && itr->second.schema->object_id == MetaSchema_DEFINITION_SCHEMA //It might be a user
                    && itr->first > 0) //It's an explicitly stored role
                    break;
                ++itr;
        }

        destination->SetInteger(1,itr->second.role_id);
        destination->SetString(2,itr->second.name);
        ++itr;
        return true;
}

Database::VirtualTableRecordItr * CreateUsersIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new UsersIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.ROLES
// Iterates over all roles (filtered: only roles in owned schemas)
class RolesIterator : public VirtualTableRecordItr
{
        public:
        RolesIterator(BackendTransaction &trans, bool filtered, VirtualTableSource &source);
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        PrivilegeChecker::RoleCItr itr;
        bool filtered;
};

RolesIterator::RolesIterator(BackendTransaction &trans, bool _filtered, VirtualTableSource &source)
: VirtualTableRecordItr(source)
, trans(trans)
, filtered(_filtered)
{
        itr = trans.GetMetadata().Privs().GetRoles().begin();
}

bool RolesIterator::GetRecord(WritableRecord *destination)
{
        while (true)
        {
                if (itr == trans.GetMetadata().Privs().GetRoles().end())
                    return false;

                if (!filtered)
                    break;

                SchemaDef const *schema = itr->second.schema;

                if (trans.IsRoleEnabled(schema->owner))
                    break;
                ++itr;
        }

        destination->SetString(1,itr->second.name);
        destination->SetInteger(2,itr->second.role_id);
        destination->SetString(3,itr->second.schema->name);
        destination->SetInteger(4,itr->second.schema->object_id);
        ++itr;
        return true;
}

Database::VirtualTableRecordItr * CreateAllRolesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new RolesIterator(trans, false, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.*_PRIVILEGES and INFORMATION_SCHEMA.ROLE_*_GRANTS
class PrivilegesIterator : public VirtualTableRecordItr
{
        public:
        PrivilegesIterator(BackendTransaction &trans, MetaObjectType::_type obj_type, bool _allow_enable_roles, VirtualTableSource &source);
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        MetaObjectType::_type obj_type;
        Metadata::ObjectCItr o_itr;
        PrivilegeChecker::GrantCItr g_itr;
        Privilege::_type curpriv;
        bool allow_enabled_roles;
        bool allow_public;
};

inline bool InheritsPrivilegesFrom(ObjectDef const* child, ObjectDef const* parent)
{
        // Tables inherit from schemas, columns inherit from tables and schemas
        return (parent->type == MetaObjectType::Schema
                && (child->type == MetaObjectType::Table || child->type == MetaObjectType::Column))
            || (parent->type == MetaObjectType::Table && child->type == MetaObjectType::Column);
}

PrivilegesIterator::PrivilegesIterator(BackendTransaction &trans, MetaObjectType::_type obj_type, bool _allow_enable_roles, VirtualTableSource &source)
: VirtualTableRecordItr(source)
, trans(trans)
, obj_type(obj_type)
, o_itr(trans.GetMetadata().GetObjects().begin())
, g_itr(trans.GetMetadata().Privs().GetGrants().begin())
, curpriv(Privilege::Table_Delete)
, allow_enabled_roles(_allow_enable_roles)
, allow_public(!allow_enabled_roles)
{
        // Skip to first interesting object
        while (o_itr != trans.GetMetadata().GetObjects().end()
            && o_itr->second->type != obj_type)
            ++o_itr;
}

bool PrivilegesIterator::GetRecord(WritableRecord *destination)
{
        // Are there any grants?
        if (trans.GetMetadata().Privs().GetGrants().empty())
            return false;
        // Any objects left to iterate on?
        if (o_itr == trans.GetMetadata().GetObjects().end())
            return false;

        // For each object with requested type, we select all applicable grants
        // and iterate over each privilege type
        while (true)
        {
                // If curpriv != Privilege::Table_Delete, we have already checked the visibility of this grant
                if (curpriv == Privilege::Table_Delete)
                {
                        // Check validity of current grant
                        if (g_itr == trans.GetMetadata().Privs().GetGrants().end())
                        {
                                // All grants checked, proceed to next interesting object
                                ++o_itr;
                                while (o_itr != trans.GetMetadata().GetObjects().end()
                                    && o_itr->second->type != obj_type)
                                    ++o_itr;
                                if (o_itr == trans.GetMetadata().GetObjects().end())
                                    return false;

                                g_itr = trans.GetMetadata().Privs().GetGrants().begin();
                        }

                        // Skip to next interesting grant, if we're checking the first privilege
                        while (g_itr != trans.GetMetadata().Privs().GetGrants().end()
                            && o_itr->second->object_id != g_itr->second.object->object_id
                            && !Metadata::IsAncestor(o_itr->second, g_itr->second.object))
                            ++g_itr;
                        if (g_itr == trans.GetMetadata().Privs().GetGrants().end())
                            continue; // Proceed to next object
                }

                if ((allow_enabled_roles && trans.IsRoleEnabled(g_itr->second.grantee->role_id))
                    || (allow_public && g_itr->second.grantee->role_id == MetaRole_PUBLIC))
                {
                        // Don't propagate Table_Delete to columns
                        if ((curpriv != Privilege::Table_Delete
                                || obj_type != MetaObjectType::Column)
                        // Privilege is granted
                            && (g_itr->second.privs.HasPrivilege(curpriv)))
                            break;
                }

                // Skip to next privilege, if cycled around go to next grant
                curpriv = GetNextPrivilege(curpriv);
                if (curpriv == Privilege::Table_Delete)
                    ++g_itr;
        }

        destination->SetString(1,g_itr->second.grantor->name);
        destination->SetInteger(2,g_itr->second.grantor->role_id);
        destination->SetString(3,g_itr->second.grantor->schema->name);
        destination->SetInteger(4,g_itr->second.grantor->schema->object_id);
        destination->SetString(5,g_itr->second.grantee->name);
        destination->SetInteger(6,g_itr->second.grantee->role_id);
        destination->SetString(7,g_itr->second.grantee->schema->name);
        destination->SetInteger(8,g_itr->second.grantee->schema->object_id);

        switch (curpriv)
        {
                case Privilege::Table_Delete:
                    destination->SetString(9,"DELETE");
                    break;
                case Privilege::Column_Insert:
                    destination->SetString(9,"INSERT");
                    break;
                case Privilege::Column_References:
                    destination->SetString(9,"REFERENCES");
                    break;
                case Privilege::Column_Select:
                    destination->SetString(9,"SELECT");
                    break;
                case Privilege::Column_Update:
                    destination->SetString(9,"UPDATE");
                    break;
        }
        destination->SetString(10,g_itr->second.privs.CanGrant(curpriv) ? "YES" : "NO");

        if (obj_type == MetaObjectType::Schema)
        {
                destination->SetString(11,"WEBHARE");
                destination->SetString(12,o_itr->second->name);
                destination->SetInteger(13,o_itr->second->object_id);
        }
        else if (obj_type == MetaObjectType::Table)
        {
                SetTableInColumn(destination, 11, static_cast<TableDef const*>(o_itr->second));
        }
        else if (obj_type == MetaObjectType::Column)
        {
                SetTableInColumn(destination, 11, static_cast<TableDef const*>(o_itr->second->parent_object));
                destination->SetString(16,o_itr->second->name);
                destination->SetInteger(17,o_itr->second->object_id);
        }

        // Do next privilege. If cycled around, we increase g_itr to get to next grant
        curpriv = GetNextPrivilege(curpriv);
        if (curpriv == Privilege::Table_Delete)
            ++g_itr;
        return true;
}

Database::VirtualTableRecordItr * CreateSchemaPrivilegesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new PrivilegesIterator(trans, MetaObjectType::Schema, false, source);
}

Database::VirtualTableRecordItr * CreateTablePrivilegesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new PrivilegesIterator(trans, MetaObjectType::Table, false, source);
}

Database::VirtualTableRecordItr * CreateColumnPrivilegesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new PrivilegesIterator(trans, MetaObjectType::Column, false, source);
}

Database::VirtualTableRecordItr * CreateRoleSchemaGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new PrivilegesIterator(trans, MetaObjectType::Schema, true, source);
}

Database::VirtualTableRecordItr * CreateRoleTableGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new PrivilegesIterator(trans, MetaObjectType::Table, true, source);
}

Database::VirtualTableRecordItr * CreateRoleColumnGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new PrivilegesIterator(trans, MetaObjectType::Column, true, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.INDICES
class IndicesIterator : public VirtualTableRecordItr
{
        public:
        IndicesIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , started(false)
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;

        bool started;
        Metadata::TableCItr titr;
        TableDef::IndexItr iitr;
        unsigned colnr;
};

bool IndicesIterator::GetRecord(WritableRecord *destination)
{
        bool do_tables = false;
        if (!started)
        {
                started = true;
                titr = trans.GetMetadata().GetTables().begin();
                do_tables = true;
        }
        else
        {
                if (++colnr == iitr->descr.num_indexed_columns)
                {
                        ++iitr;
                        if (iitr == titr->second.GetAdditionalIndices().end())
                        {
                                ++titr;
                                do_tables = true;
                        }
                        colnr = 0;
                }
        }
        if (do_tables)
        {
                while (titr != trans.GetMetadata().GetTables().end() && titr->second.GetAdditionalIndices().empty())
                    ++titr;
                if (titr == trans.GetMetadata().GetTables().end())
                    return false;
                iitr = titr->second.GetAdditionalIndices().begin();
                colnr = 0;
        }

        unsigned len = iitr->descr.storesize[colnr];
        switch (iitr->descr.storage[colnr])
        {
        case Index::StoreS32:
        case Index::StoreDateTime:
            break;
        case Index::StoreRaw:
        case Index::StoreUppercase:
            --len;
            break;
        default:
            throw Exception(ErrorInternal,"Indices information schema iterator doesn't know how to calculate the length of column type " + Blex::AnyToString((unsigned)iitr->descr.storage[colnr]));
        }

        destination->SetString(1,iitr->name);
        destination->SetInteger(2,iitr->object_id);
        destination->SetString(3,iitr->parent_object->name);
        destination->SetInteger(4,iitr->parent_object->object_id);
        destination->SetString(5,iitr->parent_object->parent_object->name);
        destination->SetInteger(6,iitr->parent_object->parent_object->object_id);
        destination->SetString(7,"WEBHARE");
        destination->SetBoolean(8,iitr->unique);
        destination->SetBoolean(9,iitr->descr.storage[colnr] == Index::StoreUppercase);
        destination->SetInteger(10,colnr);
        destination->SetString(11,titr->second.GetColumnDef(iitr->descr.columns[colnr])->name);
        destination->SetInteger(12,iitr->descr.columns[colnr]);
        destination->SetInteger(13,len);
        destination->SetBoolean(14,iitr->descr.nonullstores);
/*
, { 0xFFFF00A9, 0xFFFF00A8,   1, "INDEX_NAME",                      TText,      MaxNameLen }
, { 0xFFFF00AA, 0xFFFF00A8,   2, "INDEX_ID",                        TInteger,   4 }
, { 0xFFFF00AB, 0xFFFF00A8,   3, "TABLE_NAME",                      TText,      MaxNameLen }
, { 0xFFFF00AC, 0xFFFF00A8,   4, "TABLE_ID",                        TInteger,   4 }
, { 0xFFFF00AD, 0xFFFF00A8,   5, "TABLE_SCHEMA",                    TText,      MaxNameLen }
, { 0xFFFF00AE, 0xFFFF00A8,   6, "TABLE_SCHEMA_ID",                 TInteger,   4 }
, { 0xFFFF00AF, 0xFFFF00A8,   7, "TABLE_CATALOG",                   TText,      MaxNameLen }
, { 0xFFFF00B0, 0xFFFF00A8,   8, "IS_UNIQUE",                       TBoolean, 1}
, { 0xFFFF00B1, 0xFFFF00A8,   9, "IS_UPPERCASE",                    TBoolean, 1}
, { 0xFFFF00B2, 0xFFFF00A8,  10, "ORDERING",                        TInteger,   4 }
, { 0xFFFF00B3, 0xFFFF00A8,  11, "COLUMN_NAME",                     TText,      MaxNameLen }
, { 0xFFFF00B4, 0xFFFF00A8,  12, "COLUMN_ID",                       TInteger,   4 }
, { 0xFFFF00B5, 0xFFFF00A8,  13, "COLUMN_LENGTH",                   TInteger,   4 }
, { (ObjectId)0xFFFF0133, (ObjectId)0xFFFF00C4,  14, "NONULLSTORES" ,                   TBoolean, 1 FILLOUT_NOUNIQUE}
  */
        return true;
}

Database::VirtualTableRecordItr * CreateIndicesIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new IndicesIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.EXPLICIT_*_GRANTS (except ROLE)
class ExplicitGrantsIterator : public VirtualTableRecordItr
{
        public:
        ExplicitGrantsIterator(BackendTransaction &trans, MetaObjectType::_type obj_type, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , obj_type(obj_type)
        , scanner(trans, ShowNormalSkipAccess, false)
        , started(false)
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        MetaObjectType::_type obj_type;
        Scanner scanner;
        Privilege::_type curpriv;
        PrivilegeDescriptor desc;
        bool started;
};

bool ExplicitGrantsIterator::GetRecord(WritableRecord *destination)
{
        if (!started)
        {
                scanner.AddTable(TableId_MetaGrants);
                curpriv = Privilege::Table_Delete;
                started = true;
        }
        while (true)
        {
                if (curpriv == Privilege::Table_Delete)
                {
                        // Advance scanner until we find a grant to a matching object type
                        while (true)
                        {
                                if (!scanner.NextRow())
                                    return false;

                                // Get object type, and compare to iterator object type. If match, process!
                                int32_t object_id = scanner.GetRowPart(0).GetCell(MetaGrants_Object).Integer();
                                ObjectDef const *objdef = trans.GetMetadata().GetObjectDef(object_id);
                                if (objdef->type == obj_type)
                                    break;
                        }

                        desc.ReadFromCell(scanner.GetRowPart(0).GetCell(MetaGrants_Mask));
                }

                if (desc.HasPrivilege(curpriv))
                   break;

                curpriv = GetNextPrivilege(curpriv);
        }

        int32_t grantor_id = scanner.GetRowPart(0).GetCell(MetaGrants_Grantor).Integer();
        int32_t grantee_id = scanner.GetRowPart(0).GetCell(MetaGrants_Grantee).Integer();
        int32_t object_id = scanner.GetRowPart(0).GetCell(MetaGrants_Object).Integer();

        RoleDef const *grantor = trans.GetMetadata().Privs().GetRoleDef(grantor_id);
        RoleDef const *grantee = trans.GetMetadata().Privs().GetRoleDef(grantee_id);
        ObjectDef const *obj_def = trans.GetMetadata().GetObjectDef(object_id);

        if (!grantor || !grantee || !obj_def)
            throw Exception(ErrorInternal,"Metadata out of sync with database contents");

        destination->SetString(1,grantor->name);
        destination->SetInteger(2,grantor->role_id);
        destination->SetString(3,grantor->schema->name);
        destination->SetInteger(4,grantor->schema->object_id);
        destination->SetString(5,grantee->name);
        destination->SetInteger(6,grantee->role_id);
        destination->SetString(7,grantee->schema->name);
        destination->SetInteger(8,grantee->schema->object_id);

        switch (curpriv)
        {
                case Privilege::Table_Delete:
                    destination->SetString(9,"DELETE");
                    break;
                case Privilege::Column_Insert:
                    destination->SetString(9,"INSERT");
                    break;
                case Privilege::Column_References:
                    destination->SetString(9,"REFERENCES");
                    break;
                case Privilege::Column_Select:
                    destination->SetString(9,"SELECT");
                    break;
                case Privilege::Column_Update:
                    destination->SetString(9,"UPDATE");
                    break;
        }
        destination->SetString(10,desc.CanGrant(curpriv) ? "YES" : "NO");

        if (obj_type == MetaObjectType::Schema)
        {
                destination->SetString(11,"WEBHARE");
                destination->SetString(12,obj_def->name);
                destination->SetInteger(13,obj_def->object_id);
        }
        else if (obj_type == MetaObjectType::Table)
        {
                SetTableInColumn(destination, 11, static_cast<TableDef const*>(obj_def));
        }
        else if (obj_type == MetaObjectType::Column)
        {
                SetTableInColumn(destination, 11, static_cast<TableDef const*>(obj_def->parent_object));
                destination->SetString(16,obj_def->name);
                destination->SetInteger(17,obj_def->object_id);
        }

        curpriv = GetNextPrivilege(curpriv);
        return true;
}

Database::VirtualTableRecordItr * CreateExplicitSchemaGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new ExplicitGrantsIterator(trans, MetaObjectType::Schema, source);
}

Database::VirtualTableRecordItr * CreateExplicitTableGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new ExplicitGrantsIterator(trans, MetaObjectType::Table, source);
}

Database::VirtualTableRecordItr * CreateExplicitColumnGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new ExplicitGrantsIterator(trans, MetaObjectType::Column, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.EXPLICIT_ROLE_GRANTS
class ExplicitRoleGrantsIterator : public VirtualTableRecordItr
{
        public:
        ExplicitRoleGrantsIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , scanner(trans, ShowNormalSkipAccess, false)
        , started(false)
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        Scanner scanner;
        bool started;
};

bool ExplicitRoleGrantsIterator::GetRecord(WritableRecord *destination)
{
        if (!started)
        {
                scanner.AddTable(TableId_MetaRoleGrants);
                started = true;
        }
        if (!scanner.NextRow())
            return false;

        int32_t grantor_id = scanner.GetRowPart(0).GetCell(MetaRoleGrants_Grantor).Integer();
        int32_t grantee_id = scanner.GetRowPart(0).GetCell(MetaRoleGrants_Grantee).Integer();
        int32_t role_id = scanner.GetRowPart(0).GetCell(MetaRoleGrants_Role).Integer();

        RoleDef const *grantor = trans.GetMetadata().Privs().GetRoleDef(grantor_id);
        RoleDef const *grantee = trans.GetMetadata().Privs().GetRoleDef(grantee_id);
        RoleDef const *role = trans.GetMetadata().Privs().GetRoleDef(role_id);

        if (!grantor || !grantee || !role)
            throw Exception(ErrorInternal,"Metadata out of sync with database contents");

        bool with_admin = scanner.GetRowPart(0).GetCell(MetaRoleGrants_WithAdmin).Boolean();

        destination->SetString(1,grantor->name);
        destination->SetInteger(2,grantor->role_id);
        destination->SetString(3,grantor->schema->name);
        destination->SetInteger(4,grantor->schema->object_id);
        destination->SetString(5,grantee->name);
        destination->SetInteger(6,grantee->role_id);
        destination->SetString(7,grantee->schema->name);
        destination->SetInteger(8,grantee->schema->object_id);
        destination->SetString(9,role->name);
        destination->SetInteger(10,role->role_id);
        destination->SetString(11,role->schema->name);
        destination->SetInteger(12,role->schema->object_id);
        destination->SetBoolean(13, with_admin);
        return true;
}

Database::VirtualTableRecordItr * CreateExplicitRoleGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new ExplicitRoleGrantsIterator(trans, source);
}

///////////////////////////////////////////////////////////////////////////////
// INFORMATION_SCHEMA.ALL_ROLE_GRANTS
class AllRoleGrantsIterator : public VirtualTableRecordItr
{
        public:
        AllRoleGrantsIterator(BackendTransaction &trans, VirtualTableSource &source)
        : VirtualTableRecordItr(source)
        , trans(trans)
        , r_itr(trans.GetMetadata().Privs().GetRoleGrants().begin())
        {
        }
        bool GetRecord(WritableRecord *destination);

        private:
        BackendTransaction &trans;
        PrivilegeChecker::RoleGrantCItr r_itr;
};

bool AllRoleGrantsIterator::GetRecord(WritableRecord *destination)
{
        if (r_itr == trans.GetMetadata().Privs().GetRoleGrants().end())
            return false;

        destination->SetString(1,r_itr->second.grantor->name);
        destination->SetInteger(2,r_itr->second.grantor->role_id);
        destination->SetString(3,r_itr->second.grantor->schema->name);
        destination->SetInteger(4,r_itr->second.grantor->schema->object_id);
        destination->SetString(5,r_itr->second.grantee->name);
        destination->SetInteger(6,r_itr->second.grantee->role_id);
        destination->SetString(7,r_itr->second.grantee->schema->name);
        destination->SetInteger(8,r_itr->second.grantee->schema->object_id);
        destination->SetString(9,r_itr->second.role->name);
        destination->SetInteger(10,r_itr->second.role->role_id);
        destination->SetString(11,r_itr->second.role->schema->name);
        destination->SetInteger(12,r_itr->second.role->schema->object_id);
        destination->SetBoolean(13, r_itr->second.with_admin_option);

        ++r_itr;
        return true;
}

Database::VirtualTableRecordItr * CreateAllRoleGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source)
{
        return new AllRoleGrantsIterator(trans, source);
}

} //end namespace InformationSchema
} //end namespace Database
