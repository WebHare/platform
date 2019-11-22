#include <ap/libwebhare/allincludes.h>


#include "dbase_meta.h"
#include "information_schema.h"
#include "dbase_transaction.h"

#include <iostream>
#include <blex/logfile.h>
#include "dbase_backend.h"
#include "dbase_types.h"


//#define SHOWMETAREFS

#ifdef SHOWMETAREFS
 #define METAREFPRINT(x) DEBUGPRINT(x)
#else
 #define METAREFPRINT(x) (void)0
#endif


namespace Database
{

/* ADDMEs
   - Restrict the range of characters that are permissible in table and columnnames
   - Unused things still take up resources. If tables and autosequencers are
     created and then rolled back (or deleted later on), they will still
     take up resources. We probably need reference counting on these resources,
     and destroy/clean up unreferenced resources.
*/

bool DenyAllReadAccess(BackendTransaction *,TableDef const &,Record)
{
        return false;
}
void DenyAllWriteAccess(BackendTransaction *, TableDef const &table, Actions , Record , Record )
{
        throw Exception(ErrorWriteAccessDenied,"All writes to table " + table.name + " forbidden, due to a database configuration error (access manager does not exist)");
}
void CannotEditMetadata(BackendTransaction *, TableDef const &, Actions , Record , Record )
{
        throw Exception(ErrorWriteAccessDenied,"Metadata may not be directly updated");
}
unsigned ErrorInternalColumn(void *,unsigned, BackendTransaction *,Database::Record)
{
        throw Exception(ErrorMetadataBad, "Attempting to use an internal column handler that is not present in the database");
}

Metadata::Metadata(Blex::ContextRegistrator const &registrator)
: keeper(registrator)
, versionid(0)
, timestamp(Blex::DateTime::Invalid())
, root(new ObjectDef(MetaObjectType::Root))
{ }

Metadata::Metadata(Metadata const &rhs)
: keeper(rhs.keeper.GetRegistrator())
, versionid(rhs.versionid)
, timestamp(rhs.timestamp)
, objects(rhs.objects)
, root(new ObjectDef(MetaObjectType::Root))
, tables(rhs.tables)
, schemas(rhs.schemas)
, privs(rhs.privs)
{
}

void Metadata::Swap(Metadata &rhs)
{
        keeper.Swap(rhs.keeper);
        std::swap(versionid, rhs.versionid);
        std::swap(timestamp, rhs.timestamp);

        privs.Swap(rhs.privs); // Swaps only data, not ptr to metadata object
        std::swap(objects, rhs.objects);
        std::swap(tables, rhs.tables);
        std::swap(schemas, rhs.schemas);
        std::swap(errors, rhs.errors);

        std::unique_ptr<ObjectDef> root_swap_cache;
        root_swap_cache = std::move(rhs.root);
        rhs.root = std::move(root);
        root = std::move(root_swap_cache);
}

bool Metadata::IsAncestor(ObjectDef const *child, ObjectDef const *ancestor)
{
        if (!child)
            return false;
        do
        {
                child = child->parent_object;
                if (child == ancestor)
                    return true;
        }
        while (child);
        return false;
}

void Metadata::ErrorDetected(Exception const &exception)
{
        DEBUGPRINT(exception.what());
        errors.push_back(exception);
}

bool Metadata::AnyErrors(std::vector< Exception > *_errors) const
{
        if (_errors)
            *_errors = errors;
        return !errors.empty();
}

//-----------------------------------------------------------------------------
//
// Hot metadata (updateable metadata)
//
//-----------------------------------------------------------------------------

HotMetadata::HotMetadata(HotMetadata const &src)
: recovery_mode(src.recovery_mode)
, metadata(src.metadata)
, refcount(1)
{
        METAREFPRINT("metadata " << this << " copy of " << &src << ":" << src.refcount << " to " << 1);
}

HotMetadata::HotMetadata(MetadataManager &metamgr)
: recovery_mode(metamgr.recovery_mode)
, metadata(metamgr.metacontextregistrator)
, refcount(1)
{
        metadata.timestamp = metamgr.databasestart;
        InsertSystemSchemas();
        AutoCreateMetadata();
        METAREFPRINT("metadata " << this << " init to " << 1);
}

HotMetadata::~HotMetadata()
{
        METAREFPRINT("metadata " << this << " destroy of " << refcount);
}

void HotMetadata::Swap(HotMetadata &rhs)
{
        METAREFPRINT("metadata swap " << this << ": " << refcount << " and " << &rhs << ":" << rhs.refcount);
        metadata.Swap(rhs.metadata);
        std::swap(recovery_mode, rhs.recovery_mode);
        METAREFPRINT("metadata swap result " << this << ": " << refcount << " and " << &rhs << ":" << rhs.refcount);
}

struct AutoTableDef
{
        ObjectId objectid;
        ObjectId parentobjectid;
        const char *name;
        ColumnId primarykey;
        CreateRecordIterator recordgenerator;
};

AutoTableDef const auto_tables[] = {
{ TableId_MetaObjects,      MetaSchema_DEFINITION_SCHEMA,  "OBJECTS",      MetaObjects_ObjectId, NULL },
{ TableId_MetaColumns,      MetaSchema_DEFINITION_SCHEMA,  "COLUMNS",      MetaColumn_ObjectId, NULL },
{ TableId_MetaTables,       MetaSchema_DEFINITION_SCHEMA,  "TABLES",       MetaTable_ObjectId, NULL },
{ TableId_MetaSchemas,      MetaSchema_DEFINITION_SCHEMA,  "SCHEMAS",      MetaSchemas_ObjectId, NULL },
{ TableId_MetaIndices,      MetaSchema_DEFINITION_SCHEMA,  "INDICES",      MetaIndex_IndexId, NULL },
{ TableId_MetaIndexColumns, MetaSchema_DEFINITION_SCHEMA,  "INDEXCOLUMNS", 0, NULL },
{ TableId_MetaRoles,        MetaSchema_DEFINITION_SCHEMA,  "ROLES",        MetaRoles_RoleId, NULL },
{ TableId_MetaGrants,       MetaSchema_DEFINITION_SCHEMA,  "GRANTS",       MetaGrants_Id, NULL },
{ TableId_MetaRoleGrants,   MetaSchema_DEFINITION_SCHEMA,  "ROLEGRANTS",   MetaRoleGrants_Id, NULL },

{ (ObjectId)0xFFFF0001,     MetaSchema_INFORMATION_SCHEMA, "TABLES",            0, &InformationSchema::CreateTablesIterator },
{ (ObjectId)0xFFFF0011,     MetaSchema_INFORMATION_SCHEMA, "COLUMNS",           0, &InformationSchema::CreateColumnsIterator },
{ (ObjectId)0xFFFF0044,     MetaSchema_INFORMATION_SCHEMA, "SCHEMATA",          0, &InformationSchema::CreateSchemataIterator },
{ (ObjectId)0xFFFF0050,     MetaSchema_INFORMATION_SCHEMA, "ENABLED_ROLES",     0, &InformationSchema::CreateEnabledRolesIterator },
{ (ObjectId)0xFFFF0055,     MetaSchema_INFORMATION_SCHEMA, "APPLICABLE_ROLES",  0, &InformationSchema::CreateApplicableRolesIterator },
{ (ObjectId)0xFFFF005F,     MetaSchema_INFORMATION_SCHEMA, "USERS",             0, &InformationSchema::CreateUsersIterator },
{ (ObjectId)0xFFFF0062,     MetaSchema_INFORMATION_SCHEMA, "TABLE_PRIVILEGES",  0, &InformationSchema::CreateTablePrivilegesIterator },
{ (ObjectId)0xFFFF0073,     MetaSchema_INFORMATION_SCHEMA, "COLUMN_PRIVILEGES", 0, &InformationSchema::CreateColumnPrivilegesIterator },
{ (ObjectId)0xFFFF0085,     MetaSchema_INFORMATION_SCHEMA, "SCHEMA_PRIVILEGES", 0, &InformationSchema::CreateSchemaPrivilegesIterator },
{ (ObjectId)0xFFFF0093,     MetaSchema_INFORMATION_SCHEMA, "ROLE_TABLE_GRANTS", 0,      &InformationSchema::CreateRoleTableGrantsIterator },
{ (ObjectId)0xFFFF00A4,     MetaSchema_INFORMATION_SCHEMA, "ROLE_COLUMN_GRANTS", 0,     &InformationSchema::CreateRoleColumnGrantsIterator },
{ (ObjectId)0xFFFF00B6,     MetaSchema_INFORMATION_SCHEMA, "ROLE_SCHEMA_GRANTS", 0,     &InformationSchema::CreateRoleSchemaGrantsIterator },
{ (ObjectId)0xFFFF00C4,     MetaSchema_INFORMATION_SCHEMA, "INDICES",           0,      &InformationSchema::CreateIndicesIterator },
{ (ObjectId)0xFFFF00D2,     MetaSchema_INFORMATION_SCHEMA, "ALL_ROLES",         0,      &InformationSchema::CreateAllRolesIterator },
{ (ObjectId)0xFFFF00D7,     MetaSchema_INFORMATION_SCHEMA, "ALL_SCHEMATA",      0,      &InformationSchema::CreateAllSchemataIterator },
{ (ObjectId)0xFFFF00E3,     MetaSchema_INFORMATION_SCHEMA, "EXPLICIT_TABLE_GRANTS", 0,  &InformationSchema::CreateExplicitTableGrantsIterator },
{ (ObjectId)0xFFFF00F4,     MetaSchema_INFORMATION_SCHEMA, "EXPLICIT_COLUMN_GRANTS", 0, &InformationSchema::CreateExplicitColumnGrantsIterator },
{ (ObjectId)0xFFFF0106,     MetaSchema_INFORMATION_SCHEMA, "EXPLICIT_SCHEMA_GRANTS", 0, &InformationSchema::CreateExplicitSchemaGrantsIterator },
{ (ObjectId)0xFFFF0114,     MetaSchema_INFORMATION_SCHEMA, "EXPLICIT_ROLE_GRANTS", 0,   &InformationSchema::CreateExplicitRoleGrantsIterator },
{ (ObjectId)0xFFFF0122,     MetaSchema_INFORMATION_SCHEMA, "ALL_ROLE_GRANTS", 0,        &InformationSchema::CreateAllRoleGrantsIterator },

{ 0, 0, 0, 0, NULL }}; //EOT

struct AutoColumnDef
{
        ObjectId column_object_id;
        ObjectId tableid;
        ColumnId columnid;
        const char *name;
        ColumnTypes type;
        unsigned maxlen;
        bool unique;
        bool noupdate;
        bool notnull;
        int32_t autonumber_start;
        TableId references;
        ForeignBehaviours ondelete;
        bool dangle_negative; //a hack for as long as it works, see dbase_meta.h for details
};

//NOTE: NEVER bother to renumber object ids! Just pick a free one.

#define FILLOUT_NODANGLE ,false
#define FILLOUT_NOREF ,0 ,ForeignIllegal FILLOUT_NODANGLE
#define FILLOUT_NOAUTO ,0 FILLOUT_NOREF
#define FILLOUT_NOUNIQUE ,false ,false ,false FILLOUT_NOAUTO

AutoColumnDef const auto_columns[] =
//  OBJECT ID   PARENT OBJECT ID     COLUMN ID                 NAME           TYPE      MAXLENGTH     UNIQU NOUPD !NULL AUTONUMBER_START  FOREIGN_REFER  ON_DELETE      DANGLE_NEGATIVE
//DEFINITION_SCHEMA.OBJECTS
{ { (ObjectId)0xFFFE0001, TableId_MetaObjects, MetaObjects_ObjectId,     "OBJECTID",    TInteger, 4,            true, true, true, 101  FILLOUT_NOREF}
, { (ObjectId)0xFFFE0002, TableId_MetaObjects, MetaObjects_Name,         "NAME",        TText,    MaxNameLen+1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0003, TableId_MetaObjects, MetaObjects_Type,         "TYPE",        TInteger, 4,            false,true, true FILLOUT_NOAUTO}
, { (ObjectId)0xFFFE0004, TableId_MetaObjects, MetaObjects_Parent,       "PARENT",      TInteger, 4,            false,false,false, 0, TableId_MetaObjects, ForeignCascade,        true}
, { (ObjectId)0xFFFE002D, TableId_MetaObjects, MetaObjects_CreationDate, "CREATIONDATE",TDateTime,8,            false,false,true FILLOUT_NOAUTO}
, { (ObjectId)0xFFFE002E, TableId_MetaObjects, MetaObjects_Comment,      "COMMENT",     TText,    MaxColumnSize,false,false,false FILLOUT_NOAUTO}
//DEFINITION_SCHEMA.SCHEMAS
, { (ObjectId)0xFFFE0005, TableId_MetaSchemas, MetaSchemas_ObjectId, "OBJECTID", TInteger, 4,                   true, true, true, 0, TableId_MetaObjects, ForeignCascade FILLOUT_NODANGLE}
, { (ObjectId)0xFFFE0006, TableId_MetaSchemas, MetaSchemas_Owner,    "OWNER",    TInteger, 4,                   false,false,true, 0, TableId_MetaRoles,   ForeignIllegal,         true} //CASCADE is unsafe, because it would just kill the schema, not the object!
//DEFINITION_SCHEMA.TABLES
, { (ObjectId)0xFFFE0007, TableId_MetaTables,  MetaTable_ObjectId,   "OBJECTID", TInteger, 4,                   true, true, true, 0, TableId_MetaObjects, ForeignCascade FILLOUT_NODANGLE}
, { (ObjectId)0xFFFE0008, TableId_MetaTables,  MetaTable_Primary,    "PRIMARY",  TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0009, TableId_MetaTables,  MetaTable_ReadAccess, "READACCESS",  TText, MaxNameLen*2 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE000A, TableId_MetaTables,  MetaTable_WriteAccess,"WRITEACCESS", TText, MaxNameLen*2 FILLOUT_NOUNIQUE}
//DEFINITION_SCHEMA.COLUMNS
, { (ObjectId)0xFFFE000B, TableId_MetaColumns,  MetaColumn_ObjectId,     "OBJECTID",    TInteger, 4,            true, true, true, 0, TableId_MetaObjects, ForeignCascade FILLOUT_NODANGLE}
, { (ObjectId)0xFFFE000C, TableId_MetaColumns,  MetaColumn_ColumnId,     "COLUMNID",    TInteger, 4,            false,true,true FILLOUT_NOAUTO}
, { (ObjectId)0xFFFE000D, TableId_MetaColumns,  MetaColumn_ForeignRefer, "REFERSTO",    TInteger, 4,            false,false,false, 0, TableId_MetaTables, ForeignIllegal FILLOUT_NODANGLE}
, { (ObjectId)0xFFFE000E, TableId_MetaColumns,  MetaColumn_MaxSize,      "MAXSIZE",     TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE000F, TableId_MetaColumns,  MetaColumn_Type,         "COLUMNTYPE",  TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0010, TableId_MetaColumns,  MetaColumn_Default,      "DEFAULT",     TText, MaxColumnSize FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0011, TableId_MetaColumns,  MetaColumn_Autokey,      "AUTOKEY",     TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0012, TableId_MetaColumns,  MetaColumn_ForeignBehav, "ONDELETE",    TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0013, TableId_MetaColumns,  MetaColumn_NotNull,      "NOTNULL",     TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0014, TableId_MetaColumns,  MetaColumn_NoCirculairs, "NOCIRCULAIRS",TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0015, TableId_MetaColumns,  MetaColumn_Internal,     "INTERNAL",    TText, MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0016, TableId_MetaColumns,  MetaColumn_Unique,       "UNIQUE",      TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0017, TableId_MetaColumns,  MetaColumn_NoUpdate,     "NOUPDATE",    TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0030, TableId_MetaColumns,  MetaColumn_RefersByCol,  "REFERSBYCOL", TInteger, 4 FILLOUT_NOUNIQUE}
//DEFINITION_SCHEMA.INDICES
, { (ObjectId)0xFFFE0018, TableId_MetaIndices,  MetaIndex_ObjectId,      "OBJECTID",    TInteger, 4,            true, true, true, 0, TableId_MetaObjects, ForeignCascade FILLOUT_NODANGLE}
, { (ObjectId)0xFFFE0019, TableId_MetaIndices,  MetaIndex_IndexId,       "INDEXID",     TInteger, 4,            true, true, true, 1 FILLOUT_NOREF}
, { (ObjectId)0xFFFE001A, TableId_MetaIndices,  MetaIndex_Uppercase,     "UPPERCASE",   TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE001B, TableId_MetaIndices,  MetaIndex_Unique,        "UNIQUE",      TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0031, TableId_MetaIndices,  MetaIndex_NoNullStores,  "NONULLSTORES",TBoolean, 1 FILLOUT_NOUNIQUE}
//DEFINITION_SCHEMA.INDEXCOLUMNS
, { (ObjectId)0xFFFE001C, TableId_MetaIndexColumns,  MetaIndexColumn_IndexId,      "INDEXID",    TInteger, 4,   false,true, true, 0, TableId_MetaIndices, ForeignCascade FILLOUT_NODANGLE}
, { (ObjectId)0xFFFE001D, TableId_MetaIndexColumns,  MetaIndexColumn_ColumnId,     "COLUMNID",   TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE001E, TableId_MetaIndexColumns,  MetaIndexColumn_Ordering,     "ORDERING",   TInteger, 4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE001F, TableId_MetaIndexColumns,  MetaIndexColumn_Length,       "LENGTH",     TInteger, 4 FILLOUT_NOUNIQUE}
//DEFINITION_SCHEMA.ROLES
, { (ObjectId)0xFFFE0020, TableId_MetaRoles,  MetaRoles_RoleId,      "ROLEID",    TInteger, 4,                  true, true, true, 2 FILLOUT_NOREF}
, { (ObjectId)0xFFFE0021, TableId_MetaRoles,  MetaRoles_Name,        "NAME",      TText,    MaxNameLen*2 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFE0022, TableId_MetaRoles,  MetaRoles_Schema,      "SCHEMA",    TInteger, 4,                  false,true, true, 0, TableId_MetaSchemas, ForeignCascade, true}
//DEFINITION_SCHEMA.GRANTS
, { (ObjectId)0xFFFE0023, TableId_MetaGrants,  MetaGrants_Id,        "ID",        TInteger, 4,                  true, true, true, 1 FILLOUT_NOREF}
, { (ObjectId)0xFFFE0024, TableId_MetaGrants,  MetaGrants_Object,    "OBJECT",    TInteger, 4,                  false, false, true, 0, TableId_MetaObjects, ForeignCascade, true}
, { (ObjectId)0xFFFE0025, TableId_MetaGrants,  MetaGrants_Grantor,   "GRANTOR",   TInteger, 4,                  false, false, true, 0, TableId_MetaRoles, ForeignCascade, true}
, { (ObjectId)0xFFFE0026, TableId_MetaGrants,  MetaGrants_Grantee,   "GRANTEE",   TInteger, 4,                  false, false, true, 0, TableId_MetaRoles, ForeignCascade, true}
, { (ObjectId)0xFFFE0027, TableId_MetaGrants,  MetaGrants_Mask,      "MASK",      TText,    PrivilegeDescriptor::NumPrivileges FILLOUT_NOUNIQUE}
//DEFINITION_SCHEMA.ROLEGRANTS
, { (ObjectId)0xFFFE0028, TableId_MetaRoleGrants, MetaRoleGrants_Id,        "ID",           TInteger, 4,        true, true, true, 1 FILLOUT_NOREF}
, { (ObjectId)0xFFFE0029, TableId_MetaRoleGrants, MetaRoleGrants_Role,      "ROLE",         TInteger, 4,        false, false, true, 0, TableId_MetaRoles, ForeignCascade, true}
, { (ObjectId)0xFFFE002A, TableId_MetaRoleGrants, MetaRoleGrants_Grantor,   "GRANTOR",      TInteger, 4,        false, false, true, 0, TableId_MetaRoles, ForeignCascade, true}
, { (ObjectId)0xFFFE002B, TableId_MetaRoleGrants, MetaRoleGrants_Grantee,   "GRANTEE",      TInteger, 4,        false, false, true, 0, TableId_MetaRoles, ForeignCascade, true}
, { (ObjectId)0xFFFE002C, TableId_MetaRoleGrants, MetaRoleGrants_WithAdmin, "WITH_ADMIN",   TBoolean, 1 FILLOUT_NOUNIQUE}
// Last used object_id: 0xFFFE0031

//INFORMATION_SCHEMA.TABLES
, { (ObjectId)0xFFFF0002, (ObjectId)0xFFFF0001,   1, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0003, (ObjectId)0xFFFF0001,   2, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0004, (ObjectId)0xFFFF0001,   3, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0005, (ObjectId)0xFFFF0001,   4, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0006, (ObjectId)0xFFFF0001,   5, "OBJECT_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0007, (ObjectId)0xFFFF0001,   6, "TABLE_TYPE",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0008, (ObjectId)0xFFFF0001,   7, "SELF_REFERENCING_COLUMN_NAME",    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0009, (ObjectId)0xFFFF0001,   8, "REFERENCE_GENERATION",            TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF000A, (ObjectId)0xFFFF0001,   9, "USER_DEFINED_TYPE_CATALOG",       TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF000B, (ObjectId)0xFFFF0001,  10, "USER_DEFINED_TYPE_SCHEMA",        TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF000C, (ObjectId)0xFFFF0001,  11, "USER_DEFINED_TYPE_NAME",          TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF000D, (ObjectId)0xFFFF0001,  12, "PRIMARY_KEY_NAME",                TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF000E, (ObjectId)0xFFFF0001,  13, "PRIMARY_KEY_ID",                  TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF000F, (ObjectId)0xFFFF0001,  14, "READ_ACCESS_MANAGER",             TText,      MaxNameLen*2 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0010, (ObjectId)0xFFFF0001,  15, "WRITE_ACCESS_MANAGER",            TText,      MaxNameLen*2 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0132, (ObjectId)0xFFFF0001,  16, "MAXIMUM_ROW_SIZE",                TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.COLUMNS
, { (ObjectId)0xFFFF0012, (ObjectId)0xFFFF0011,   1, "OBJECT_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0013, (ObjectId)0xFFFF0011,   2, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0014, (ObjectId)0xFFFF0011,   3, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0015, (ObjectId)0xFFFF0011,   4, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0016, (ObjectId)0xFFFF0011,   5, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0017, (ObjectId)0xFFFF0011,   6, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0018, (ObjectId)0xFFFF0011,   7, "COLUMN_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0019, (ObjectId)0xFFFF0011,   8, "ORDINAL_POSITION",                TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF001A, (ObjectId)0xFFFF0011,   9, "COLUMN_DEFAULT",                  TText,      MaxColumnSize FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF001B, (ObjectId)0xFFFF0011,  10, "IS_NULLABLE",                     TText,      3 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF001C, (ObjectId)0xFFFF0011,  11, "DATA_TYPE",                       TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF001D, (ObjectId)0xFFFF0011,  12, "CHARACTER_MAXIMUM_LENGTH",        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF001E, (ObjectId)0xFFFF0011,  13, "CHARACTER_OCTET_LENGTH",          TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF001F, (ObjectId)0xFFFF0011,  14, "NUMERIC_PRECISION",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0020, (ObjectId)0xFFFF0011,  15, "NUMERIC_PRECISION_RADIX",         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0021, (ObjectId)0xFFFF0011,  16, "NUMERIC_PRECISION_SCALE",         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0022, (ObjectId)0xFFFF0011,  17, "DATETIME_PRECISION",              TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0023, (ObjectId)0xFFFF0011,  18, "INTERVAL_TYPE",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0024, (ObjectId)0xFFFF0011,  19, "INTERVAL_PRECISION",              TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0025, (ObjectId)0xFFFF0011,  20, "CHARACTER_SET_CATALOG",           TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0026, (ObjectId)0xFFFF0011,  21, "CHARACTER_SET_SCHEMA",            TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0027, (ObjectId)0xFFFF0011,  22, "CHARACTER_SET_NAME",              TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0028, (ObjectId)0xFFFF0011,  23, "COLLATION_SET_CATALOG",           TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0029, (ObjectId)0xFFFF0011,  24, "COLLATION_SET_SCHEMA",            TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF002A, (ObjectId)0xFFFF0011,  25, "COLLATION_SET_NAME",              TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF002B, (ObjectId)0xFFFF0011,  26, "DOMAIN_CATALOG",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF002C, (ObjectId)0xFFFF0011,  27, "DOMAIN_SCHEMA",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF002D, (ObjectId)0xFFFF0011,  28, "DOMAIN_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF002E, (ObjectId)0xFFFF0011,  29, "UDT_CATALOG",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF002F, (ObjectId)0xFFFF0011,  30, "UDT_SCHEMA",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0030, (ObjectId)0xFFFF0011,  31, "UDT_NAME",                        TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0031, (ObjectId)0xFFFF0011,  32, "SCOPE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0032, (ObjectId)0xFFFF0011,  33, "SCOPE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0033, (ObjectId)0xFFFF0011,  34, "SCOPE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0034, (ObjectId)0xFFFF0011,  35, "MAXIMUM_CARDINALITY",             TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0035, (ObjectId)0xFFFF0011,  36, "DTD_IDENTIFIER",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0036, (ObjectId)0xFFFF0011,  37, "IS_SELF_REFERENCING",             TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0037, (ObjectId)0xFFFF0011,  38, "IS_PRIMARY",                      TBoolean,   1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0038, (ObjectId)0xFFFF0011,  39, "AUTONUMBER_START",                TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0039, (ObjectId)0xFFFF0011,  40, "INTERNAL_COLUMN_NAME",            TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF003A, (ObjectId)0xFFFF0011,  41, "REFERENCED_TABLE_CATALOG",        TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF003B, (ObjectId)0xFFFF0011,  42, "REFERENCED_TABLE_SCHEMA",         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF003C, (ObjectId)0xFFFF0011,  43, "REFERENCED_TABLE_SCHEMA_ID",      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF003D, (ObjectId)0xFFFF0011,  44, "REFERENCED_TABLE_NAME",           TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF003E, (ObjectId)0xFFFF0011,  45, "REFERENCED_TABLE_ID",             TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF003F, (ObjectId)0xFFFF0011,  46, "ON_DELETE",                       TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0040, (ObjectId)0xFFFF0011,  47, "UNIQUE",                          TBoolean,   1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0041, (ObjectId)0xFFFF0011,  48, "NOUPDATE",                        TBoolean,   1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0042, (ObjectId)0xFFFF0011,  49, "NOT_NULL",                        TBoolean,   1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0043, (ObjectId)0xFFFF0011,  50, "ON_DISK_COLUMN_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0130, (ObjectId)0xFFFF0011,  51, "REFERENCE_BY_COLUMN_NAME",        TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0131, (ObjectId)0xFFFF0011,  52, "REFERENCE_BY_COLUMN_ID",          TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.SCHEMATA
, { (ObjectId)0xFFFF0045, (ObjectId)0xFFFF0044,   1, "OBJECT_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0046, (ObjectId)0xFFFF0044,   2, "CATALOG_NAME",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0047, (ObjectId)0xFFFF0044,   3, "SCHEMA_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0048, (ObjectId)0xFFFF0044,   4, "SCHEMA_OWNER",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0049, (ObjectId)0xFFFF0044,   5, "SCHEMA_OWNER_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF004A, (ObjectId)0xFFFF0044,   6, "SCHEMA_OWNER_SCHEMA",             TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF004B, (ObjectId)0xFFFF0044,   7, "SCHEMA_OWNER_SCHEMA_ID",          TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF004C, (ObjectId)0xFFFF0044,   8, "DEFAULT_CHARACTER_SET_CATALOG",   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF004D, (ObjectId)0xFFFF0044,   9, "DEFAULT_CHARACTER_SET_SCHEMA",    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF004E, (ObjectId)0xFFFF0044,  10, "DEFAULT_CHARACTER_SET_NAME",      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF004F, (ObjectId)0xFFFF0044,  11, "SQL_PATH",                        TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ENABLED_ROLES
, { (ObjectId)0xFFFF0051, (ObjectId)0xFFFF0050,   1, "ROLE_ID",                         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0052, (ObjectId)0xFFFF0050,   2, "ROLE_NAME",                       TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0053, (ObjectId)0xFFFF0050,   3, "ROLE_SCHEMA",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0054, (ObjectId)0xFFFF0050,   4, "ROLE_SCHEMA_ID",                  TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.APPLICABLE_ROLES
, { (ObjectId)0xFFFF0056, (ObjectId)0xFFFF0055,   1, "ROLE_ID",                         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0057, (ObjectId)0xFFFF0055,   2, "ROLE_NAME",                       TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0058, (ObjectId)0xFFFF0055,   3, "ROLE_SCHEMA",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0059, (ObjectId)0xFFFF0055,   4, "ROLE_SCHEMA_ID",                  TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF005A, (ObjectId)0xFFFF0055,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF005B, (ObjectId)0xFFFF0055,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF005C, (ObjectId)0xFFFF0055,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF005D, (ObjectId)0xFFFF0055,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF005E, (ObjectId)0xFFFF0055,   9, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.APPLICABLE_USERS
, { (ObjectId)0xFFFF0060, (ObjectId)0xFFFF005F,   1, "USER_ID",                         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0061, (ObjectId)0xFFFF005F,   2, "USER_NAME",                       TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.TABLE_PRIVILEGES
, { (ObjectId)0xFFFF0063, (ObjectId)0xFFFF0062,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0064, (ObjectId)0xFFFF0062,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0065, (ObjectId)0xFFFF0062,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0066, (ObjectId)0xFFFF0062,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0067, (ObjectId)0xFFFF0062,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0068, (ObjectId)0xFFFF0062,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0069, (ObjectId)0xFFFF0062,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF006A, (ObjectId)0xFFFF0062,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF006B, (ObjectId)0xFFFF0062,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF006C, (ObjectId)0xFFFF0062,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF006D, (ObjectId)0xFFFF0062,  11, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF006E, (ObjectId)0xFFFF0062,  12, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF006F, (ObjectId)0xFFFF0062,  13, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0070, (ObjectId)0xFFFF0062,  14, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0071, (ObjectId)0xFFFF0062,  15, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0072, (ObjectId)0xFFFF0062,  16, "WITH_HIERARCHY",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.COLUMN_PRIVILEGES
, { (ObjectId)0xFFFF0074, (ObjectId)0xFFFF0073,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0075, (ObjectId)0xFFFF0073,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0076, (ObjectId)0xFFFF0073,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0077, (ObjectId)0xFFFF0073,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0078, (ObjectId)0xFFFF0073,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0079, (ObjectId)0xFFFF0073,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF007A, (ObjectId)0xFFFF0073,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF007B, (ObjectId)0xFFFF0073,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF007C, (ObjectId)0xFFFF0073,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF007D, (ObjectId)0xFFFF0073,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF007E, (ObjectId)0xFFFF0073,  11, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF007F, (ObjectId)0xFFFF0073,  12, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0080, (ObjectId)0xFFFF0073,  13, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0081, (ObjectId)0xFFFF0073,  14, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0082, (ObjectId)0xFFFF0073,  15, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0083, (ObjectId)0xFFFF0073,  16, "COLUMN_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0084, (ObjectId)0xFFFF0073,  17, "COLUMN_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.SCHEMA_PRIVILEGES
, { (ObjectId)0xFFFF0086, (ObjectId)0xFFFF0085,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0087, (ObjectId)0xFFFF0085,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0088, (ObjectId)0xFFFF0085,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0089, (ObjectId)0xFFFF0085,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF008A, (ObjectId)0xFFFF0085,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF008B, (ObjectId)0xFFFF0085,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF008C, (ObjectId)0xFFFF0085,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF008D, (ObjectId)0xFFFF0085,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF008E, (ObjectId)0xFFFF0085,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF008F, (ObjectId)0xFFFF0085,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0090, (ObjectId)0xFFFF0085,  11, "CATALOG_NAME",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0091, (ObjectId)0xFFFF0085,  12, "SCHEMA_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0092, (ObjectId)0xFFFF0085,  13, "SCHEMA_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ROLE_TABLE_GRANTS
, { (ObjectId)0xFFFF0094, (ObjectId)0xFFFF0093,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0095, (ObjectId)0xFFFF0093,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0096, (ObjectId)0xFFFF0093,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0097, (ObjectId)0xFFFF0093,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0098, (ObjectId)0xFFFF0093,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0099, (ObjectId)0xFFFF0093,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF009A, (ObjectId)0xFFFF0093,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF009B, (ObjectId)0xFFFF0093,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF009C, (ObjectId)0xFFFF0093,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF009D, (ObjectId)0xFFFF0093,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF009E, (ObjectId)0xFFFF0093,  11, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF009F, (ObjectId)0xFFFF0093,  12, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A0, (ObjectId)0xFFFF0093,  13, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A1, (ObjectId)0xFFFF0093,  14, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A2, (ObjectId)0xFFFF0093,  15, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A3, (ObjectId)0xFFFF0093,  16, "WITH_HIERARCHY",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ROLE_COLUMN_GRANTS
, { (ObjectId)0xFFFF00A5, (ObjectId)0xFFFF00A4,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A6, (ObjectId)0xFFFF00A4,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A7, (ObjectId)0xFFFF00A4,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A8, (ObjectId)0xFFFF00A4,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00A9, (ObjectId)0xFFFF00A4,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00AA, (ObjectId)0xFFFF00A4,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00AB, (ObjectId)0xFFFF00A4,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00AC, (ObjectId)0xFFFF00A4,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00AD, (ObjectId)0xFFFF00A4,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00AE, (ObjectId)0xFFFF00A4,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00AF, (ObjectId)0xFFFF00A4,  11, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B0, (ObjectId)0xFFFF00A4,  12, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B1, (ObjectId)0xFFFF00A4,  13, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B2, (ObjectId)0xFFFF00A4,  14, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B3, (ObjectId)0xFFFF00A4,  15, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B4, (ObjectId)0xFFFF00A4,  16, "COLUMN_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B5, (ObjectId)0xFFFF00A4,  17, "COLUMN_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ROLE_SCHEMA_GRANTS
, { (ObjectId)0xFFFF00B7, (ObjectId)0xFFFF00B6,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B8, (ObjectId)0xFFFF00B6,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00B9, (ObjectId)0xFFFF00B6,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00BA, (ObjectId)0xFFFF00B6,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00BB, (ObjectId)0xFFFF00B6,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00BC, (ObjectId)0xFFFF00B6,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00BD, (ObjectId)0xFFFF00B6,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00BE, (ObjectId)0xFFFF00B6,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00BF, (ObjectId)0xFFFF00B6,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C0, (ObjectId)0xFFFF00B6,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C1, (ObjectId)0xFFFF00B6,  11, "CATALOG_NAME",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C2, (ObjectId)0xFFFF00B6,  12, "SCHEMA_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C3, (ObjectId)0xFFFF00B6,  13, "SCHEMA_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.INDICES
, { (ObjectId)0xFFFF00C5, (ObjectId)0xFFFF00C4,   1, "INDEX_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C6, (ObjectId)0xFFFF00C4,   2, "INDEX_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C7, (ObjectId)0xFFFF00C4,   3, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C8, (ObjectId)0xFFFF00C4,   4, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00C9, (ObjectId)0xFFFF00C4,   5, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00CA, (ObjectId)0xFFFF00C4,   6, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00CB, (ObjectId)0xFFFF00C4,   7, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00CC, (ObjectId)0xFFFF00C4,   8, "IS_UNIQUE",                       TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00CD, (ObjectId)0xFFFF00C4,   9, "IS_UPPERCASE",                    TBoolean, 1 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00CE, (ObjectId)0xFFFF00C4,  10, "ORDERING",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00CF, (ObjectId)0xFFFF00C4,  11, "COLUMN_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00D0, (ObjectId)0xFFFF00C4,  12, "COLUMN_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00D1, (ObjectId)0xFFFF00C4,  13, "COLUMN_LENGTH",                   TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0133, (ObjectId)0xFFFF00C4,  14, "NONULLSTORES" ,                   TBoolean, 1 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ALL_ROLES
, { (ObjectId)0xFFFF00D3, (ObjectId)0xFFFF00D2,   1, "ROLE_NAME",                       TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00D4, (ObjectId)0xFFFF00D2,   2, "ROLE_ID",                         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00D5, (ObjectId)0xFFFF00D2,   3, "ROLE_SCHEMA",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00D6, (ObjectId)0xFFFF00D2,   4, "ROLE_SCHEMA_ID",                  TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ALL_SCHEMATA
, { (ObjectId)0xFFFF00D8, (ObjectId)0xFFFF00D7,   1, "OBJECT_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00D9, (ObjectId)0xFFFF00D7,   2, "CATALOG_NAME",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00DA, (ObjectId)0xFFFF00D7,   3, "SCHEMA_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00DB, (ObjectId)0xFFFF00D7,   4, "SCHEMA_OWNER",                    TText,      MaxNameLen*2 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00DC, (ObjectId)0xFFFF00D7,   5, "SCHEMA_OWNER_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00DD, (ObjectId)0xFFFF00D7,   6, "SCHEMA_OWNER_SCHEMA",             TText,      MaxNameLen*2 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00DE, (ObjectId)0xFFFF00D7,   7, "SCHEMA_OWNER_SCHEMA_ID",          TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00DF, (ObjectId)0xFFFF00D7,   8, "DEFAULT_CHARACTER_SET_CATALOG",   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E0, (ObjectId)0xFFFF00D7,   9, "DEFAULT_CHARACTER_SET_SCHEMA",    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E1, (ObjectId)0xFFFF00D7,  10, "DEFAULT_CHARACTER_SET_NAME",      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E2, (ObjectId)0xFFFF00D7,  11, "SQL_PATH",                        TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ROLE_TABLE_GRANTS
, { (ObjectId)0xFFFF00E4, (ObjectId)0xFFFF00E3,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E5, (ObjectId)0xFFFF00E3,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E6, (ObjectId)0xFFFF00E3,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E7, (ObjectId)0xFFFF00E3,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E8, (ObjectId)0xFFFF00E3,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00E9, (ObjectId)0xFFFF00E3,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00EA, (ObjectId)0xFFFF00E3,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00EB, (ObjectId)0xFFFF00E3,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00EC, (ObjectId)0xFFFF00E3,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00ED, (ObjectId)0xFFFF00E3,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00EE, (ObjectId)0xFFFF00E3,  11, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00EF, (ObjectId)0xFFFF00E3,  12, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F0, (ObjectId)0xFFFF00E3,  13, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F1, (ObjectId)0xFFFF00E3,  14, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F2, (ObjectId)0xFFFF00E3,  15, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F3, (ObjectId)0xFFFF00E3,  16, "WITH_HIERARCHY",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ROLE_COLUMN_GRANTS
, { (ObjectId)0xFFFF00F5, (ObjectId)0xFFFF00F4,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F6, (ObjectId)0xFFFF00F4,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F7, (ObjectId)0xFFFF00F4,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F8, (ObjectId)0xFFFF00F4,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00F9, (ObjectId)0xFFFF00F4,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00FA, (ObjectId)0xFFFF00F4,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00FB, (ObjectId)0xFFFF00F4,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00FC, (ObjectId)0xFFFF00F4,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00FD, (ObjectId)0xFFFF00F4,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00FE, (ObjectId)0xFFFF00F4,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF00FF, (ObjectId)0xFFFF00F4,  11, "TABLE_CATALOG",                   TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0100, (ObjectId)0xFFFF00F4,  12, "TABLE_SCHEMA",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0101, (ObjectId)0xFFFF00F4,  13, "TABLE_SCHEMA_ID",                 TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0102, (ObjectId)0xFFFF00F4,  14, "TABLE_NAME",                      TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0103, (ObjectId)0xFFFF00F4,  15, "TABLE_ID",                        TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0104, (ObjectId)0xFFFF00F4,  16, "COLUMN_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0105, (ObjectId)0xFFFF00F4,  17, "COLUMN_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ROLE_SCHEMA_GRANTS
, { (ObjectId)0xFFFF0107, (ObjectId)0xFFFF0106,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0108, (ObjectId)0xFFFF0106,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0109, (ObjectId)0xFFFF0106,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF010A, (ObjectId)0xFFFF0106,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF010B, (ObjectId)0xFFFF0106,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF010C, (ObjectId)0xFFFF0106,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF010D, (ObjectId)0xFFFF0106,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF010E, (ObjectId)0xFFFF0106,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF010F, (ObjectId)0xFFFF0106,   9, "PRIVILEGE_TYPE",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0110, (ObjectId)0xFFFF0106,  10, "IS_GRANTABLE",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0111, (ObjectId)0xFFFF0106,  11, "CATALOG_NAME",                    TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0112, (ObjectId)0xFFFF0106,  12, "SCHEMA_NAME",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0113, (ObjectId)0xFFFF0106,  13, "SCHEMA_ID",                       TInteger,   4 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.EXPLICIT_ROLE_GRANTS
, { (ObjectId)0xFFFF0115, (ObjectId)0xFFFF0114,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0116, (ObjectId)0xFFFF0114,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0117, (ObjectId)0xFFFF0114,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0118, (ObjectId)0xFFFF0114,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0119, (ObjectId)0xFFFF0114,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF011A, (ObjectId)0xFFFF0114,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF011B, (ObjectId)0xFFFF0114,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF011C, (ObjectId)0xFFFF0114,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF011D, (ObjectId)0xFFFF0114,   9, "ROLE",                            TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF011E, (ObjectId)0xFFFF0114,  10, "ROLE_ID",                         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF011F, (ObjectId)0xFFFF0114,  11, "ROLE_SCHEMA",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0120, (ObjectId)0xFFFF0114,  12, "ROLE_SCHEMA_ID",                  TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0121, (ObjectId)0xFFFF0114,  13, "WITH_ADMIN",                      TBoolean,   1 FILLOUT_NOUNIQUE}
//INFORMATION_SCHEMA.ALL_ROLE_GRANTS
, { (ObjectId)0xFFFF0123, (ObjectId)0xFFFF0122,   1, "GRANTOR",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0124, (ObjectId)0xFFFF0122,   2, "GRANTOR_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0125, (ObjectId)0xFFFF0122,   3, "GRANTOR_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0126, (ObjectId)0xFFFF0122,   4, "GRANTOR_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0127, (ObjectId)0xFFFF0122,   5, "GRANTEE",                         TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0128, (ObjectId)0xFFFF0122,   6, "GRANTEE_ID",                      TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF0129, (ObjectId)0xFFFF0122,   7, "GRANTEE_SCHEMA",                  TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF012A, (ObjectId)0xFFFF0122,   8, "GRANTEE_SCHEMA_ID",               TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF012B, (ObjectId)0xFFFF0122,   9, "ROLE",                            TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF012C, (ObjectId)0xFFFF0122,  10, "ROLE_ID",                         TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF012D, (ObjectId)0xFFFF0122,  11, "ROLE_SCHEMA",                     TText,      MaxNameLen FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF012E, (ObjectId)0xFFFF0122,  12, "ROLE_SCHEMA_ID",                  TInteger,   4 FILLOUT_NOUNIQUE}
, { (ObjectId)0xFFFF012F, (ObjectId)0xFFFF0122,  13, "WITH_ADMIN",                      TBoolean,   1 FILLOUT_NOUNIQUE}

//Last used object_id: 0xFFFF0133
, { 0,0,0,0, TBoolean, 1 FILLOUT_NOUNIQUE }
};

void HotMetadata::AutoCreateMetadata()
{
        //New metadata table-based generation
        for (AutoTableDef const *itr=auto_tables;itr->objectid!=0;++itr)
        {
                TableDef table;
                table.object_id=itr->objectid;
                table.parent_object=metadata.GetObjectDef(itr->parentobjectid);
                table.name=itr->name;
                table.primarykey=itr->primarykey;
                table.record_itr_func=itr->recordgenerator;

                if (!recovery_mode)
                    table.writeaccess=CannotEditMetadata;

                AddTable(&table);
        }
        for (AutoColumnDef const *itr=auto_columns;itr->column_object_id!=0;++itr)
        {
                ColumnDef col;
                col.object_id = itr->column_object_id;
                col.parent_object = metadata.GetObjectDef(itr->tableid);
                col.column_id = itr->columnid;
                col.name = itr->name;
                col.external_type = itr->type;
                col.type = itr->type;
                col.maxsize = itr->maxlen;
                col.unique = itr->unique;
                col.notnull = itr->notnull;
                col.autonumber_start = itr->autonumber_start;
                col.dangle_negative = itr->dangle_negative;
                if (!recovery_mode)
                {
                        col.noupdate = itr->noupdate;
                        col.foreignreference = itr->references;
                        col.ondelete = itr->ondelete;
                }
                else
                {
                        col.noupdate = static_cast<TableDef const*>(col.parent_object)->primarykey == col.column_id;
                }
                AddColumn(&col);
        }
}

void HotMetadata::InsertSystemSchemas()
{
        metadata.root->object_id = 0;
        metadata.root->name = "WEBHARE";
        metadata.root->parent_object = NULL;
        RegisterObject(metadata.root.get());

        SchemaDef schema_is;
        schema_is.object_id = MetaSchema_INFORMATION_SCHEMA;
        schema_is.name = "INFORMATION_SCHEMA";
        schema_is.owner = MetaRole_DATABASE_SELF;
        schema_is.parent_object = metadata.root.get();
        AddSchema(&schema_is);

        SchemaDef schema_ds;
        schema_ds.object_id = MetaSchema_DEFINITION_SCHEMA;
        schema_ds.name = "DEFINITION_SCHEMA";
        schema_ds.owner = MetaRole_DATABASE_SELF;
        schema_ds.parent_object = metadata.root.get();
        AddSchema(&schema_ds);

        SchemaDef schema_public;
        schema_public.object_id = MetaSchema_PUBLIC;
        schema_public.name = "PUBLIC";
        schema_public.owner = MetaRole_SYSTEM; // Owner: SYSTEM (ADDME: should be a schemarole itself according to SQL spec?? (does it matter???))
        schema_public.parent_object = metadata.root.get();
        AddSchema(&schema_public);

        RoleDef role_database_self;
        role_database_self.role_id = MetaRole_DATABASE_SELF;
        role_database_self.name = "_DATABASE_SELF";
        role_database_self.schema = metadata.GetSchemaDef(MetaSchema_DEFINITION_SCHEMA);

        RoleDef role_backup;
        role_backup.role_id = MetaRole_BACKUP;
        role_backup.name = "_BACKUP";
        role_backup.schema = metadata.GetSchemaDef(MetaSchema_DEFINITION_SCHEMA);

        RoleDef role_system;
        role_system.role_id = MetaRole_SYSTEM;
        role_system.name = "_SYSTEM";
        role_system.schema = metadata.GetSchemaDef(MetaSchema_DEFINITION_SCHEMA);

        RoleDef role_public;
        role_public.role_id = MetaRole_PUBLIC;
        role_public.name = "PUBLIC";
        role_public.schema = metadata.GetSchemaDef(MetaSchema_DEFINITION_SCHEMA);

        if (!metadata.privs.AddRole(role_database_self)
            || !metadata.privs.AddRole(role_backup)
            || !metadata.privs.AddRole(role_system)
            || !metadata.privs.AddRole(role_public))
            metadata.ErrorDetected(Exception(ErrorMetadataBad,"Unable to create the default system roles"));
}

void HotMetadata::CreateImplicitGrants()
{
        // First, grant rights to the owner of a schema (1st from dbase_self->_system, then from )system->owner
        for (Metadata::Schemas::iterator itr = metadata.schemas.begin(); itr != metadata.schemas.end(); ++itr)
        {
                RoleDef *owner = metadata.privs.GetRoleDef(itr->second.owner);
                if (!owner)
                {
                        metadata.ErrorDetected(Exception(ErrorMetadataBad,"Owner role #" + Blex::AnyToString(itr->second.owner) + " of schema " + itr->second.name + " does not exist"));
                        itr->second.owner = MetaRole_SYSTEM;
                        owner = metadata.privs.GetRoleDef(itr->second.owner);
                }

                // DATABASE_SELF gets full rights to every schema
                GrantDef self_grant;
                self_grant.id = 0;
                self_grant.grantor = metadata.privs.GetRoleDef(MetaRole_DATABASE_SELF);
                self_grant.grantee = metadata.privs.GetRoleDef(MetaRole_DATABASE_SELF);
                self_grant.object = &itr->second;
                self_grant.privs.GiveAllPrivileges(MetaObjectType::Schema, /*grant=*/true);
                metadata.privs.AddGrant(self_grant);

                // Backup users gets select rights to every schema
                GrantDef backup_grant;
                backup_grant.id = 0;
                backup_grant.grantor = metadata.privs.GetRoleDef(MetaRole_DATABASE_SELF);
                backup_grant.grantee = metadata.privs.GetRoleDef(MetaRole_BACKUP);
                backup_grant.object = &itr->second;
                backup_grant.privs.AddPrivilege(Privilege::Column_Select, /*grant=*/true);
                metadata.privs.AddGrant(backup_grant);

                // _SYSTEM gets full rights on all schemas(except DEF. SCHEMA), schema owners on their own schema.
                if (itr->first == MetaSchema_DEFINITION_SCHEMA)
                    continue;

                GrantDef system_grant;
                system_grant.id = 0;
                system_grant.grantor = metadata.privs.GetRoleDef(MetaRole_DATABASE_SELF);
                system_grant.grantee = metadata.privs.GetRoleDef(MetaRole_SYSTEM);
                system_grant.object = &itr->second;
                system_grant.privs.GiveAllPrivileges(MetaObjectType::Schema, /*grant=*/true);
                metadata.privs.AddGrant(system_grant);

                if (itr->second.owner != MetaRole_SYSTEM && itr->second.owner != MetaRole_DATABASE_SELF)
                {
                        GrantDef owner_grant;
                        owner_grant.id = 0;
                        owner_grant.grantor = metadata.privs.GetRoleDef(MetaRole_SYSTEM);
                        owner_grant.grantee = metadata.privs.GetRoleDef(itr->second.owner);
                        owner_grant.object = &itr->second;
                        owner_grant.privs.GiveAllPrivileges(MetaObjectType::Schema, /*grant=*/true);
                        metadata.privs.AddGrant(owner_grant);
                }
        }

        //Grant PUBLIC SELECT to information schema
        GrantDef public_is_grant;
        public_is_grant.id = 0;
        public_is_grant.grantor = metadata.privs.GetRoleDef(MetaRole_SYSTEM);
        public_is_grant.grantee = metadata.privs.GetRoleDef(MetaRole_PUBLIC);
        public_is_grant.object = metadata.GetSchemaDef(MetaSchema_INFORMATION_SCHEMA);
        public_is_grant.privs.AddPrivilege(Privilege::Column_Select, /*grant=*/true);
        metadata.privs.AddGrant(public_is_grant);

        if (recovery_mode) //Grant full privileges to DEFINITION SCHEMA to SYSTEM
        {
                GrantDef system_ds_grant;
                system_ds_grant.id = 0;
                system_ds_grant.grantor = metadata.privs.GetRoleDef(MetaRole_DATABASE_SELF);
                system_ds_grant.grantee = metadata.privs.GetRoleDef(MetaRole_SYSTEM);
                system_ds_grant.object = metadata.GetSchemaDef(MetaSchema_DEFINITION_SCHEMA);
                //ADDME: Do these rights suffice for recovery mode?
                system_ds_grant.privs.AddPrivilege(Privilege::Table_Delete, /*grant=*/false);
                system_ds_grant.privs.AddPrivilege(Privilege::Column_Insert, /*grant=*/false);
                system_ds_grant.privs.AddPrivilege(Privilege::Column_Select, /*grant=*/false);
                system_ds_grant.privs.AddPrivilege(Privilege::Column_Update, /*grant=*/false);
                metadata.privs.AddGrant(system_ds_grant);
        }

        // Add all user roles implicitly to _SYSTEM, and to the schema owner
        PrivilegeChecker::Roles const &roles = metadata.privs.GetRoles();
        for (PrivilegeChecker::Roles::const_iterator it = roles.begin(); it != roles.end(); ++it)
        {
                if (it->second.role_id <= 0)
                    continue;

                RoleGrantDef role_grant;
                role_grant.grantor = metadata.privs.GetRoleDef(MetaRole_DATABASE_SELF);
                role_grant.grantee = metadata.privs.GetRoleDef(MetaRole_SYSTEM);
                role_grant.role = metadata.privs.GetRoleDef(it->second.role_id);
                role_grant.with_admin_option = true;
                metadata.privs.AddRoleGrant(role_grant);

                role_grant.grantor = metadata.privs.GetRoleDef(MetaRole_SYSTEM);

                SchemaDef const *schema = it->second.schema;
                RoleDef *owner = metadata.privs.GetRoleDef(schema->owner);
                if (owner != &it->second)
                {
                        role_grant.grantee = owner;
                        metadata.privs.AddRoleGrant(role_grant);
                }
        }
}


//-----------------------------------------------------------------------------
//
// MetadataManager
//
//-----------------------------------------------------------------------------
MetadataManager::MetadataManager(Plugins const &plugins,RawDatabase &rawdb,AutoSeqManager &autoseq,Index::System *indexsystem, bool recovery_mode)
: databasestart(Blex::DateTime::Now())
, recovery_mode(recovery_mode)
, rawdb(rawdb)
, autoseq(autoseq)
, plugins(plugins)
, indexsystem(indexsystem)
{
        DEBUGONLY(data.SetupDebugging("MetadataManager::LockedData"));

        plugins.RegisterMetadataContexts(metacontextregistrator);

        std::unique_ptr<HotMetadata> meta(new HotMetadata(*this));
        ConfigureExternals(*meta);

        LockedData::WriteRef lock(data);
        lock->current_metadata = meta.release();
}

MetadataManager::~MetadataManager()
{
        //Release our main metadata
        LockedData::WriteRef lock(data);

        METAREFPRINT("metamgr shutdown " << lock->current_metadata << " = " << lock->current_metadata->refcount);

        assert(lock->current_metadata->refcount==1);
        delete lock->current_metadata;
}

MetadataManager::Ref::Ref (MetadataManager &mgr)
: mgr(mgr)
//, timestamp(mgr.databasestart)
{
        LockedData::WriteRef lock(mgr.data);
        myref = lock->current_metadata;
//        versioncount = lock->versioncount;
        ++myref->refcount;
        METAREFPRINT("meta ref " << myref << " ++ to " << myref->refcount);
}

MetadataManager::Ref::~Ref()
{
        LockedData::WriteRef lock(mgr.data);
        METAREFPRINT("meta ref " << myref << " -- to " << myref->refcount-1 << " #1");
        if (--myref->refcount == 0)
            delete myref;
}

void MetadataManager::Ref::SwapMetadata(HotMetadata *newmetadata)
{
        LockedData::WriteRef lock(mgr.data);
        if (myref->refcount != 1) //unshare the metadata
        {
                //We have to create a local copy for ourselves (ADDME: We can just create an empty version?)
                std::unique_ptr<HotMetadata> new_metadata(new HotMetadata(*myref));
                --myref->refcount;
                METAREFPRINT("meta ref " << myref << " -- to " << myref->refcount << " #2");
                myref=new_metadata.release();
                METAREFPRINT("meta ref " << myref << " swapped to " << newmetadata->refcount);
        }
        std::swap(*myref, *newmetadata);
}

void MetadataManager::ConfigureIndexes(ColumnDef *col, TableDef const &table)
{
        std::vector<Index::Descriptor> requests;

        //Index every primary and foreign key, and every column with unique records
        if (col->column_id==table.primarykey
            || col->foreignreference
            || col->unique)
        {
                Index::Descriptor desc;
                //ADDME: Op al dit soort plekken een mooie 'get store type' functie bouwen die het type teruggeeft - die functie kan ook anamelden of een type uberhaupt indexable is ?
                Index::StorageType storetype = col->type==TDateTime ? Index::StoreDateTime : col->type == TInteger ? Index::StoreS32 : Index::StoreRaw;
                unsigned storesize = std::min(col->maxsize, Blex::Index::IndexBlockEntry::MaxDataSize);

                desc.Initialize(table.object_id, col->column_id, storetype, col->type, storesize, false);
                requests.push_back(desc);
        }

        if (col->external_type == TTable) // Table columns can be used for foreignreferencesbycolumn; this becomes a multicolumn thingy
        {
                for (TableDef::Columns::const_iterator citr = table.GetColumns().begin(); citr != table.GetColumns().end(); ++citr)
                    if (citr->second.foreignreferencesbycolumn == col->column_id)
                    {
                            Index::Descriptor desc;
                            Index::StorageType storetype = citr->second.type == TDateTime ? Index::StoreDateTime : citr->second.type == TInteger ? Index::StoreS32 : Index::StoreRaw;
                            unsigned storesize = std::min(citr->second.maxsize, Blex::Index::IndexBlockEntry::MaxDataSize-4);

                            desc.Initialize(table.object_id, col->column_id, Index::StoreS32, TInteger, 4, false);
                            desc.Append(citr->second.column_id, storetype, citr->second.type, storesize);
                            requests.push_back(desc);
                    }
        }

        //Create custom indices (ADDME: detect duplicate indices)
        for (TableDef::IndexItr idx = table.GetAdditionalIndices().begin(); idx != table.GetAdditionalIndices().end(); ++idx)
        {
                if (idx->descr.columns[0] != col->column_id)
                    continue; //does not index this column, so skip it

                //Request this index
                requests.push_back(idx->descr);
        }

        /* De-associate unnecessary indexes */
        std::vector< Index::IndexData::Ref >::iterator it = col->indices.begin();
        while (it != col->indices.end())
        {
                /* Check if the current index is in the request descriptor list */
                std::vector<Index::Descriptor>::iterator rit = std::find(requests.begin(),requests.end(),(*it)->GetDescriptor());
                if (rit == requests.end())
                {
                        it = col->indices.erase(it);
                }
                else
                {
                        requests.erase(rit);
                        ++it;
                }
        }

        if(indexsystem)
        {
                /* Associate newly requested indexes */
                for (unsigned i=0;i<requests.size();++i)
                {
                        Index::Descriptor descriptor;
                        descriptor = requests[i];

                        col->indices.reserve(col->indices.size() + 1); //for exception safety
                        col->indices.push_back(indexsystem->GetIndexRef(descriptor));
                        if (!col->indices.back().Valid())
                            col->indices.erase(col->indices.end()-1);
                }
        }
}

void MetadataManager::ConfigureColumnExternals(TableDef const &table, ColumnDef *column, SchemaDef const *schema)
{
        //Look up the internal column definition
        if (!column->internalcolumn_name.empty())
        {
                column->indices.clear(); //internals can never have indices

                column->internalcolumn_handler = plugins.GetInternalColumn(column->internalcolumn_name,schema->name + "." + table.name);
                if (!column->internalcolumn_handler)
                {
                        // Make look like a deleted column
                        column->internalcolumn_handler = plugins.GetErrorInternalColumn();
                }
        }
        else
        {
                ConfigureIndexes(column, table);
        }
        if (column->autonumber_start)
            column->deprecated_autoseq = autoseq.GetAutoseq(table.object_id,column->column_id,column->autonumber_start);
}

void MetadataManager::ConfigureTableExternals(TableDef *table, SchemaDef const *schema)
{
        if (!table->readaccess_name.empty())
        {
                std::string::iterator colon = std::find(table->readaccess_name.begin(), table->readaccess_name.end(), ':');
                std::string funcname(table->readaccess_name.begin(), colon);

                table->readaccess = plugins.GetReadAccess(funcname,schema->name + "." + table->name);
                if (!table->readaccess)
                {
                        //fallback to full deny handler
                        table->readaccess = DenyAllReadAccess;
                        DEBUGPRINT("Table " << table->name << " has a non-existing read access handler: " << table->readaccess_name);
                }
        }
        if (!table->writeaccess_name.empty())
        {
                std::string::iterator colon = std::find(table->writeaccess_name.begin(), table->writeaccess_name.end(), ':');
                std::string funcname(table->writeaccess_name.begin(), colon);

                table->writeaccess = plugins.GetWriteAccess(funcname,schema->name + "." + table->name);
                if (!table->writeaccess)
                {
                        //fallback to full deny handler
                        table->writeaccess = DenyAllWriteAccess;
                        DEBUGPRINT("Table " << table->name << " has a non-existing write access handler: " << table->writeaccess_name);
                }
        }

        for (TableDef::ColumnItr citr = table->GetColumns().begin(); citr!= table->GetColumns().end(); ++citr)
        {
                if (citr->second.name.empty()) //no need to configure a deleted column
                    continue;

                ConfigureColumnExternals(*table,&citr->second,schema);
        }
}

void MetadataManager::ConfigureExternals(HotMetadata &metadata)
{
        for (Metadata::TableItr titr = metadata.metadata.GetTables().begin();
             titr != metadata.metadata.GetTables().end();
             ++titr)
        {
                if (titr->second.name.empty())
                    continue; //no need to configure a deleted table

                SchemaDef const *schemadef = static_cast<SchemaDef const*>(titr->second.parent_object);
                if (!schemadef)
                {
                        // Error detected, signal it and skip this externals
                        metadata.ErrorDetected(Exception(ErrorMetadataBad,"Table " + titr->second.name + " has invalid parent schema " + titr->second.parent_object->name));
                        continue;
                }

                ConfigureTableExternals(&titr->second, schemadef);
        }
        plugins.OnMetadataUpdate(metadata.metadata, metadata.metadata.keeper);
}

uint32_t MetadataManager::AllocateNewVersionId()
{
        LockedData::WriteRef lock(data);
        return ++lock->counter;
}

void MetadataManager::ReadMetadata(BackendTransaction *metatrans)
{
        //ADDME: Fix the reciprocal dependency - metadatamgr knows how transactions work, and vice versa

        //Read through all records in the TableField table to restore
        //our table and column definitions
        LockedData::WriteRef lock(data);
        unsigned new_counter = ++lock->counter;

        /* FIXME: Reading the new metadata happens within the metadata lock, but is that usefull?
           Before the lock, the metadata is stale (wrt the database). During the lock, the metadata can
           be updated by a commit. Wait a minute, that's BAD!!! */
        METAREFPRINT("metadata create " << this << " on stack");
        HotMetadata newmetadata(*this);

        DEBUGPRINT("Reading new authorative metadata copy, version: " << new_counter);
        newmetadata.ReadMetadata(*metatrans, true, false, new_counter);

        /* If no exceptions happened until this point, we'll apply the actual metadata */
        if (lock->current_metadata->refcount == 1)
        {
                METAREFPRINT("meta readmetadata inplace, swap " << &*lock->current_metadata << ":" << lock->current_metadata->refcount << " -- to " << &newmetadata << ":" << newmetadata.refcount);

                // The metadata isn't shared, we can just swap
                lock->current_metadata->Swap(newmetadata);
        }
        else
        {
                // This metadata instance is in use, we must allocate a new one.

                METAREFPRINT("meta readmetadata raii, current " << &*lock->current_metadata << ":" << lock->current_metadata->refcount);

                // First build swap to a raii object (with refcount 1)
                std::unique_ptr< HotMetadata > meta(new HotMetadata(*this));
                METAREFPRINT("metadata create " << meta.get() << " on heap");
                meta->Swap(newmetadata);

                // And assign the new metadata
                --lock->current_metadata->refcount;
                METAREFPRINT("meta ref " << &*lock->current_metadata << " -- to " << lock->current_metadata->refcount << " #3");

                lock->current_metadata = meta.release();
                assert(lock->current_metadata->refcount == 1);

                METAREFPRINT("meta readmetadata raii, replaced with " << &*lock->current_metadata << ":" << lock->current_metadata->refcount);
        }
}

bool MetadataManager::AnyErrors(std::vector< Exception > *errors) const
{
        LockedData::ReadRef lock(data);
        return lock->current_metadata->metadata.AnyErrors(errors);
}

//-----------------------------------------------------------------------------
//
// Plugins
//
//-----------------------------------------------------------------------------
Plugins::Plugins()
{
        DEBUGONLY(plugins.SetupDebugging("PluginSystem::plugins"));
}

Plugins::~Plugins()
{
}

void Plugins::RegisterMetadataContextRegistrator(MetadataContextRegistrator func)
{
        PluginList::WriteRef(plugins)->metadatacontextregistrators.push_back(func);
}

void Plugins::RegisterMetadataContextUpdater(MetadataContextUpdater metadatacontextupdater)
{
        PluginList::WriteRef(plugins)->metadatacontextupdaters.push_back(metadatacontextupdater);
}

void Plugins::RegisterAccessPlugin(const std::string &name,const Plugins::RAPtr &recordaccess)
{
        if (!Blex::IsUppercase(name.begin(),name.end()))
            throw Exception(ErrorInvalidArg,"Access function name must be in uppercase");

        PluginList::WriteRef(plugins)->accessfuncs.insert( make_pair(name, recordaccess) );
}

void Plugins::RegisterInternalPlugin(const std::string &name,const Plugins::ICPtr &columnfunc)
{
        if (!Blex::IsUppercase(name.begin(),name.end()))
            throw Exception(ErrorInvalidArg,"Column function name must be in uppercase");

        PluginList::WriteRef(plugins)->columnfuncs.insert( make_pair(name, columnfunc) );
}

const Plugins::RAPtr* Plugins::FindAccessFunc(const std::string &name,std::string const &tablename) const
{
        typedef AccessFuncs::const_iterator pa_itr;
        PluginList::ReadRef pluginlock(plugins);

        std::pair<pa_itr,pa_itr> p=pluginlock->accessfuncs.equal_range(name);

        for (pa_itr itr=p.first;itr!=p.second;++itr)
          if (itr->second.restrictedtable.empty() || itr->second.restrictedtable==tablename)
            return &itr->second;

        return NULL;
}

const Plugins::ICPtr* Plugins::FindColumnFunc(const std::string &name,std::string const &tablename) const
{
        typedef ColumnFuncs::const_iterator pc_itr;
        PluginList::ReadRef pluginlock(plugins);

        std::pair<pc_itr,pc_itr> p=pluginlock->columnfuncs.equal_range(name);
        for (pc_itr itr=p.first;itr!=p.second;++itr)
          if (itr->second.restrictedtable.empty() || itr->second.restrictedtable==tablename)
            return &itr->second;

        return NULL;
}

void Plugins::RegisterMetadataContexts(Blex::ContextRegistrator &reg) const
{
        PluginList::ReadRef pluginlock(plugins);
        for (Plugins::MetadataContextRegistrators::const_iterator it = pluginlock->metadatacontextregistrators.begin();
                it != pluginlock->metadatacontextregistrators.end(); ++it)
            (*it)(reg);
}

void Plugins::OnMetadataUpdate(Metadata const &metadata, Blex::ContextKeeper &keeper) const
{
        PluginList::ReadRef pluginlock(plugins);
        for (Plugins::MetadataContextUpdaters::const_iterator it = pluginlock->metadatacontextupdaters.begin();
                it != pluginlock->metadatacontextupdaters.end(); ++it)
            (*it)(metadata, keeper);
}

Plugins::RecordReadAccess Plugins::GetReadAccess(const std::string &name,std::string const &tablename) const
{
        const RAPtr *ra=FindAccessFunc(name,tablename);
        return ra ? ra->readfunc : NULL;
}

Plugins::RecordWriteAccess Plugins::GetWriteAccess(const std::string &name,std::string const &tablename) const
{
        const RAPtr *ra=FindAccessFunc(name,tablename);
        return ra ? ra->writefunc : NULL;
}

Plugins::InternalColumn Plugins::GetInternalColumn(const std::string &name,std::string const &tablename) const
{
        const ICPtr *ic=FindColumnFunc(name,tablename);
        return ic ? ic->func : NULL;
}

Plugins::InternalColumn Plugins::GetErrorInternalColumn() const
{
        return &ErrorInternalColumn;
}



namespace
{

struct TempIndexColumn
{
        ColumnId columnid;
        int32_t orderingid;
        int32_t length;
};

bool TempColumnLess(TempIndexColumn const &lhs, TempIndexColumn const &rhs)
{
        return lhs.orderingid<rhs.orderingid;
}

} //end anonymous namespace

bool HotMetadata::ReadMetadataIndex(BackendTransaction &metatrans, bool aftercommit, int32_t indexid, TableDef *table, bool uppercase, bool nonullstores, Index::Descriptor *_descr)
{
        /* Read basic index information first - we need to sort it before we can
           actually process it ! */
        std::vector<TempIndexColumn> columns;

        Scanner scan_indexcolumns(metatrans,aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan_indexcolumns.AddTable(TableId_MetaIndexColumns);
        scan_indexcolumns.AddIntegerSearch(0, MetaIndexColumn_IndexId, indexid, SearchEqual);
        while (scan_indexcolumns.NextRow())
        {
                TempIndexColumn newcol;
                newcol.columnid = static_cast<ColumnId>(scan_indexcolumns.GetRowPart(0).GetCell(MetaIndexColumn_ColumnId).Integer());
                newcol.orderingid = scan_indexcolumns.GetRowPart(0).GetCell(MetaIndexColumn_Ordering).Integer();
                newcol.length = scan_indexcolumns.GetRowPart(0).GetCell(MetaIndexColumn_Length).Integer();
                columns.push_back(newcol);
        }

        if (columns.empty() || columns.size() > Index::MaxCellsPerIndex)
        {
                // Error detected, signal and murder
                ErrorDetected(Exception(ErrorMetadataBad,"An index may only index up to 4 columns"));
                return false;
        }

        //Sort it into our requested ordering
        std::sort(columns.begin(), columns.end(), TempColumnLess);

        //Build an index descriptor out of the index information
        Index::Descriptor descr;
        descr.num_indexed_columns = columns.size();
        descr.table = table->object_id;
        descr.nonullstores = nonullstores;

        unsigned totalindexsize=0;
        unsigned maxpayload = Blex::Index::IndexBlockEntry::MaxDataSize;
        for (unsigned i=0;i<columns.size();++i)
        {
                ColumnDef const *coldef = table->GetColumnDef(columns[i].columnid);
                if (!coldef)
                {
                        // Error detected, signal and murder
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken index in META_INDEXCOLUMNS (no such column #"
                                        + Blex::AnyToString(columns[i].columnid)
                                        + " in table " + table->name + " )"));
                        return false;
                }

                //ADDME: Is the index suitable for more types? Many types probably need normalizing (eg DateTime)
                if (coldef->type != TInteger
                    && coldef->type != TBoolean
                    && coldef->type != TDateTime
                    && coldef->type != TText)
                {
                        // Error detected, signal and murder
                        ErrorDetected(Exception(ErrorMetadataBad,"Column " + table->name + ":" + coldef->name + " is of an unindexable type"));
                        return false;
                }

                unsigned storesize=0;
                if (TypeIsDynamic(coldef->type))
                {
                        storesize = coldef->maxsize + 1;
                        if (columns[i].length > 0) //if a length is specified, store up to that size
                            storesize = std::min(storesize, (unsigned)columns[i].length + 1);
                        else //fill up remainder of index
                            storesize = std::min(storesize, maxpayload - totalindexsize);
                }
                else
                {
                        if (columns[i].length != 0)
                        {
                                // Error detected, signal and murder
                                ErrorDetected(Exception(ErrorMetadataBad,"Cannot specify a maximum storage size for statically-sized columns in an index"));
                                return false;
                        }
                        storesize = coldef->maxsize;
                }
                totalindexsize += storesize;
                if (totalindexsize > maxpayload)
                {
                        // Error detected, signal and murder
                        ErrorDetected(Exception(ErrorMetadataBad,"Index for table " + table->name + " is too large"));
                        return false;
                }

                if (std::find(descr.columns, descr.columns + i, coldef->column_id) != descr.columns + i)
                {
                        // Error detected, signal and murder
                        ErrorDetected(Exception(ErrorMetadataBad,"Column found twice in index"));
                        return false;
                }

                //No problems, so add it to the index!
                descr.columns[i] = coldef->column_id;
                descr.coltype[i] = coldef->type;
                descr.storesize[i] = storesize;

                if (coldef->type == TText && uppercase)
                    descr.storage[i] = Index::StoreUppercase;
                else if (coldef->type == TInteger)
                    descr.storage[i] = Index::StoreS32;
                else if (coldef->type == TDateTime)
                    descr.storage[i] = Index::StoreDateTime;
                else
                    descr.storage[i] = Index::StoreRaw;
        }

        *_descr = descr;
        return true;
}

void HotMetadata::ReadMetadataIndices(BackendTransaction &metatrans, bool aftercommit)
{
        Scanner scan_indices(metatrans,aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan_indices.AddTable(TableId_MetaObjects);
        scan_indices.AddTable(TableId_MetaIndices);
        scan_indices.AddJoin(0, MetaObjects_ObjectId, false, 1, MetaIndex_ObjectId, false, SearchEqual,true);

        while (scan_indices.NextRow())
        {
                //Read the stuff first..
                IndexDef newdef;
                if (!ApplyObjectRecord(scan_indices.GetRowPart(0), &newdef))
                    continue;

                newdef.unique = scan_indices.GetRowPart(1).GetCell(MetaIndex_Unique).Boolean();

                int32_t indexid = scan_indices.GetRowPart(1).GetCell(MetaIndex_IndexId).Integer();
                bool uppercase = scan_indices.GetRowPart(1).GetCell(MetaIndex_Uppercase).Boolean();
                bool nonullstores = scan_indices.GetRowPart(1).GetCell(MetaIndex_NoNullStores).Boolean();
                TableDef *tabledef = static_cast<TableDef*>(newdef.parent_object);

                if (!ReadMetadataIndex(metatrans,aftercommit,indexid,tabledef,uppercase,nonullstores,&newdef.descr))
                {
                        // Error detected, skip
                        continue;
                }
                tabledef->additional_indices.push_back(newdef);
        }
}

void HotMetadata::ReadMetadataRoles(BackendTransaction &metatrans, bool aftercommit)
{
        Scanner scan(metatrans, aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan.AddTable(TableId_MetaRoles);
        while (scan.NextRow())
        {
                RoleDef role;
                role.role_id = scan.GetRowPart(0).GetCell(MetaRoles_RoleId).Integer();
                if (role.role_id <= 0)
                {
                        ErrorDetected(Exception(ErrorMetadataBad,
                                    "Role #" + Blex::AnyToString(role.role_id) +
                                    + " is an unacceptable role id"));
                        continue;
                }

                role.name = scan.GetRowPart(0).GetCell(MetaRoles_Name).String();
                Blex::ToUppercase(role.name.begin(), role.name.end());
                if (role.name=="PUBLIC" || role.name=="_SYSTEM" || role.name.empty())
                {
                        ErrorDetected(Exception(ErrorMetadataBad,
                                    "Role #" + Blex::AnyToString(role.role_id) +
                                    + " has an unacceptable name"));
                        continue;
                }

                ObjectId schemaid = scan.GetRowPart(0).GetCell(MetaRoles_Schema).Integer();
                role.schema = metadata.GetSchemaDef(schemaid);
                if (!role.schema)
                {
                        // Error detected: signal and skip this role
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken role in META_ROLES (no such schema #" + Blex::AnyToString(schemaid) + ")"));
                        continue;
                }

                if (!metadata.privs.AddRole(role))
                {
                        // Error detected: signal and skip this role
                        ErrorDetected(Exception(ErrorMetadataBad,"Role " + role.name + " exists twice in schema " + role.schema->name));
                        continue;
                }
        }
}

void HotMetadata::ReadMetadataRoleGrants(BackendTransaction &metatrans, bool aftercommit)
{
        Scanner scan(metatrans, aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan.AddTable(TableId_MetaRoleGrants);
        while (scan.NextRow())
        {
                RoleGrantDef role_grant;
                RoleId grantorid = scan.GetRowPart(0).GetCell(MetaRoleGrants_Grantor).Integer();
                RoleId granteeid = scan.GetRowPart(0).GetCell(MetaRoleGrants_Grantee).Integer();
                RoleId roleid = scan.GetRowPart(0).GetCell(MetaRoleGrants_Role).Integer();

                if (granteeid == MetaRole_SYSTEM)
                {
                        // Error detected: signal and skip this role
                        ErrorDetected(Exception(ErrorMetadataBad,"Grants to role _SYSTEM are forbidden"));
                        continue;
                }
                if (grantorid == MetaRole_PUBLIC)
                {
                        // Error detected: signal and skip this role
                        ErrorDetected(Exception(ErrorMetadataBad,"Grants by role PUBLIC are forbidden"));
                        continue;
                }

                role_grant.id = scan.GetRowPart(0).GetCell(MetaRoleGrants_Id).Integer();
                role_grant.grantor = metadata.privs.GetRoleDef(grantorid);
                if (!role_grant.grantor)
                {
                        // Error: signal and skip this rolegrant
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken role grant in META_ROLEGRANTS (no such role #" + Blex::AnyToString(grantorid) + ")"));
                        continue;
                }
                role_grant.grantee = metadata.privs.GetRoleDef(granteeid);
                if (!role_grant.grantee)
                {
                        // Error: signal and skip this rolegrant
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken role grant in META_ROLEGRANTS (no such role #" + Blex::AnyToString(granteeid) + ")"));
                        continue;
                }
                role_grant.role = metadata.privs.GetRoleDef(roleid);
                if (!role_grant.role)
                {
                        // Error: signal and skip this rolegrant
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken role grant in META_ROLEGRANTS (no such role #" + Blex::AnyToString(roleid) + ")"));
                        continue;
                }
                role_grant.with_admin_option = scan.GetRowPart(0).GetCell(MetaRoleGrants_WithAdmin).Boolean();
                metadata.privs.AddRoleGrant(role_grant);
        }
}

void HotMetadata::ReadMetadataGrants(BackendTransaction &metatrans, bool aftercommit)
{
        Scanner scan(metatrans, aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan.AddTable(TableId_MetaGrants);
        while (scan.NextRow())
        {
                GrantDef grant;
                RoleId grantorid = scan.GetRowPart(0).GetCell(MetaGrants_Grantor).Integer();
                RoleId granteeid = scan.GetRowPart(0).GetCell(MetaGrants_Grantee).Integer();
                ObjectId objectid = scan.GetRowPart(0).GetCell(MetaGrants_Object).Integer();

                if (granteeid == MetaRole_SYSTEM)
                {
                        // Error: signal and skip this grant
                        ErrorDetected(Exception(ErrorMetadataBad,"Grants to role _SYSTEM are forbidden"));
                        continue;
                }
                if (grantorid == MetaRole_PUBLIC)
                {
                        // Error: signal and skip this grant
                        ErrorDetected(Exception(ErrorMetadataBad,"Grants by role PUBLIC are forbidden"));
                        continue;
                }

                grant.id = scan.GetRowPart(0).GetCell(MetaGrants_Id).Integer();
                grant.grantor = metadata.privs.GetRoleDef(grantorid);
                if (!grant.grantor)
                {
                        // Error: signal and skip this grant
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken grant in META_GRANTS (no such role #" + Blex::AnyToString(grantorid) + ")"));
                        continue;
                }
                grant.grantee = metadata.privs.GetRoleDef(granteeid);
                if (!grant.grantee)
                {
                        // Error: signal and skip this grant
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken grant in META_GRANTS (no such role #" + Blex::AnyToString(granteeid) + ")"));
                        continue;
                }
                grant.object = metadata.GetObjectDef(objectid);
                if (!grant.object)
                {
                        // Error: signal and skip this grant
                        ErrorDetected(Exception(ErrorMetadataBad,"Broken grant in META_GRANTS (no such object #" + Blex::AnyToString(objectid) + ")"));
                        continue;
                }
                grant.privs.ReadFromCell(scan.GetRowPart(0).GetCell(MetaGrants_Mask));

                metadata.privs.AddGrant(grant);
        }
}

void HotMetadata::ReadMetadata(BackendTransaction &metatrans, bool aftercommit, bool allow_grant_inconsistencies, uint32_t newversionid)
{
        DEBUGPRINT("Reading metadata, new version id: " << newversionid);
        metadata.versionid = newversionid;

        DEBUGPRINT("Reading schemas");
        Scanner scan_schemas(metatrans,aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan_schemas.AddTable(TableId_MetaSchemas);
        scan_schemas.AddTable(TableId_MetaObjects);
        scan_schemas.AddJoin(1, MetaObjects_ObjectId, false, 0, MetaSchemas_ObjectId, false, SearchEqual,true);
        while (scan_schemas.NextRow())
            ApplySchemaRecord(scan_schemas.GetRowPart(1),scan_schemas.GetRowPart(0));

        DEBUGPRINT("Reading tables");
        Scanner scan_tables(metatrans,aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan_tables.AddTable(TableId_MetaObjects);
        scan_tables.AddTable(TableId_MetaTables);
        scan_tables.AddJoin(0,MetaObjects_ObjectId, false, 1,MetaTable_ObjectId, false, SearchEqual,true);
        while (scan_tables.NextRow())
            ApplyTableRecord(scan_tables.GetRowPart(0),scan_tables.GetRowPart(1));

        DEBUGPRINT("Reading columns");
        Scanner scan_columns(metatrans,aftercommit ? ShowAfterCommit : ShowNormalSkipAccess, false);
        scan_columns.AddTable(TableId_MetaObjects);
        scan_columns.AddTable(TableId_MetaColumns);
        scan_columns.AddJoin(0,MetaObjects_ObjectId,false, 1,MetaColumn_ObjectId,false, SearchEqual,true);
        while (scan_columns.NextRow())
            ApplyColumnRecord(scan_columns.GetRowPart(0), scan_columns.GetRowPart(1));

        DEBUGPRINT("Reading indices");
        ReadMetadataIndices(metatrans,aftercommit);

        DEBUGPRINT("Reading roles");
        ReadMetadataRoles(metatrans,aftercommit);

        DEBUGPRINT("Reading role grants");
        ReadMetadataRoleGrants(metatrans,aftercommit);

        DEBUGPRINT("Reading grants");
        ReadMetadataGrants(metatrans,aftercommit);

        DEBUGPRINT("Processing");
        CreateImplicitGrants();
        if (!metadata.AnyErrors(NULL)) //validate assumes proper metadata..
        {
                try
                {
                        metadata.privs.ProcessAndValidateGrantData(allow_grant_inconsistencies);
                }
                catch (Exception &e)
                {
                        if (!allow_grant_inconsistencies)
                            ErrorDetected(e);
                }

                std::vector< Metadata::NeededAction > actions;
                try
                {
                        metadata.CalculateNeededActions(&actions);
                }
                catch (Exception &e)
                {
                        ErrorDetected(e);
                }

                if (!allow_grant_inconsistencies)
                    for (unsigned i=0;i<actions.size(); ++i)
                    {
                            if (actions[i].type == Metadata::NeededAction::DropReference)
                                 ErrorDetected(Exception(ErrorMetadataBad,"Foreign reference constraint created by object #" + Blex::AnyToString(actions[i].object) + " should be dropped"));
                            else
                                 ErrorDetected(Exception(ErrorMetadataBad,"Unknown grant-consistency repair action required by object #" + Blex::AnyToString(actions[i].object)));
                    }
        }
        metatrans.GetMetadataRef().mgr.ConfigureExternals(*this);
        FinishUpdates();

        std::vector< Exception > errors;
        if (metadata.AnyErrors(&errors))
        {
                if(!recovery_mode)
                    throw errors[0];
                for(auto const &error : errors)
                {
                        Blex::ErrStream() << error.what();
                }
        }
}

std::string GetObjectTypeName(int32_t type)
{
        switch(type)
        {
        case MetaObjectType::Schema: return "SCHEMA";
        case MetaObjectType::Table:  return "TABLE";
        case MetaObjectType::Column: return "COLUMN";
        case MetaObjectType::Index:  return "INDEX";
        default:                     return "#" + Blex::AnyToString(type);
        }
}

bool HotMetadata::ApplyObjectRecord(const Record &objectrec, ObjectDef *apply_to)
{
        int32_t ondisktype = objectrec.GetCell(MetaObjects_Type).Integer();
        apply_to->object_id = objectrec.GetCell(MetaObjects_ObjectId).Integer();
        if (apply_to->object_id <= 0)
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(apply_to->object_id) +
                            + " is an unacceptable object id"));
        }

        if (apply_to->type != ondisktype)
        {
                // Error: signal and ignore
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(apply_to->object_id) +
                            " should have type " + GetObjectTypeName(apply_to->type) +
                            " but has type " + GetObjectTypeName(ondisktype)));
                return false;
        }

        int32_t parentid = objectrec.GetCell(MetaObjects_Parent).Integer();
        apply_to->parent_object = metadata.GetObjectDef(parentid);
        if (!apply_to->parent_object)
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(apply_to->object_id) +
                            " of type " + GetObjectTypeName(apply_to->type) +
                            " refers to non-existing parent #" + Blex::AnyToString(parentid)));
                return false;
        }

        apply_to->name = objectrec.GetCell(MetaObjects_Name).String();
        Blex::ToUppercase(apply_to->name.begin(),apply_to->name.end());
        if (objectrec.GetCell(MetaObjects_CreationDate).DateTime() == Blex::DateTime::Invalid())
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(apply_to->object_id) +
                            " has an invalid creation date"));
        }
        return true;
}

void HotMetadata::ApplySchemaRecord(const Record &objectrec, const Record &rec)
{
        SchemaDef newobject;
        if (!ApplyObjectRecord(objectrec, &newobject))
            return;

        newobject.owner = rec.GetCell(MetaSchemas_Owner).Integer();
        AddSchema(&newobject);
}

void HotMetadata::ApplyTableRecord(const Record &objectrec, const Record &rec)
{
        //Lookup important columns
        TableDef newtable;
        if (!ApplyObjectRecord(objectrec, &newtable))
            return;

        newtable.primarykey=static_cast<uint16_t>(rec.GetCell(MetaTable_Primary).Integer());
        newtable.readaccess_name = rec.GetCell(MetaTable_ReadAccess).String();
        newtable.writeaccess_name = rec.GetCell(MetaTable_WriteAccess).String();

        Blex::ToUppercase(newtable.name.begin(),newtable.name.end());
        Blex::ToUppercase(newtable.readaccess_name.begin(),newtable.readaccess_name.end());
        Blex::ToUppercase(newtable.writeaccess_name.begin(),newtable.writeaccess_name.end());

        // '*' are old pre-v2.3 deleted tables. we cannot handle those anymore.
        if (!newtable.object_id || newtable.name.size()==0 || newtable.name[0]=='*' || newtable.name.size()>MaxNameLen)
        {
                // Error: signal and skip table
                ErrorDetected(Exception(ErrorMetadataBad,"Metatable TABLEDEF record is broken!"));
                return;
        }

        //It's a table defition
        AddTable(&newtable);
}

void HotMetadata::ApplyColumnRecord(const Record &objectrec, const Record &rec)
{
        //Now get a column definition
        ColumnDef columndef;
        if (!ApplyObjectRecord(objectrec, &columndef))
            return;

        columndef.column_id=ColumnId(static_cast<uint16_t>(rec.GetCell(MetaColumn_ColumnId).Integer()));

        int32_t type=rec.GetCell(MetaColumn_Type).Integer();

        Cell defval=rec.GetCell(MetaColumn_Default);
        columndef.external_type=static_cast<ColumnTypes>(type);
        columndef.defaultval.assign(defval.Begin(),defval.End());
        columndef.maxsize=rec.GetCell(MetaColumn_MaxSize).Integer();
        columndef.ondelete=static_cast<ForeignBehaviours>(rec.GetCell(MetaColumn_ForeignBehav).Integer());
        columndef.foreignreference=rec.GetCell(MetaColumn_ForeignRefer).Integer();
        columndef.autonumber_start=rec.GetCell(MetaColumn_Autokey).Integer();
        columndef.notnull=rec.GetCell(MetaColumn_NotNull).Boolean();
        columndef.internalcolumn_name=rec.GetCell(MetaColumn_Internal).String();
        columndef.nocirculairs=rec.GetCell(MetaColumn_NoCirculairs).Boolean();
        columndef.unique=rec.GetCell(MetaColumn_Unique).Boolean();
        columndef.noupdate=rec.GetCell(MetaColumn_NoUpdate).Boolean();
        columndef.internal=!columndef.internalcolumn_name.empty();
        columndef.foreignreferencesbycolumn=ColumnId(rec.GetCell(MetaColumn_RefersByCol).Integer());

        if (type == TText_Reserved) //This is the old password type, convert it to VARCHAR(256)
        {
                columndef.external_type = TText;
                type = TText;
                columndef.maxsize = 256;
        }
        else if (type == TTable)
        {
                if (columndef.foreignreference != 0)
                    ErrorDetected(Exception(ErrorMetadataBad,"TABLE columns may not reference other tables"));

                columndef.foreignreference = TableId_MetaTables;
                columndef.ondelete = ForeignCascade;
                columndef.notnull = true;
                type = TInteger;
        }
        else if (type == TRole)
        {
                if (columndef.foreignreference != 0)
                    ErrorDetected(Exception(ErrorMetadataBad,"ROLE columns may not reference other tables"));

                columndef.foreignreference = TableId_MetaRoles;
                columndef.ondelete = ForeignCascade;
                //FIXME: Validate inserted TRole values to point to a valid ID
                columndef.dangle_negative = true;
                type = TInteger;
        }

        //Convert deleted columns to no-name columns
        unsigned namelen = columndef.name.size();
        if (namelen>0 && columndef.name[0]=='*')
            columndef.name.clear();

        //Disable 'unique' check on deleted columns
        if (columndef.name.empty())
            columndef.unique = false;

        Blex::ToUppercase(columndef.name.begin(),columndef.name.end());
        Blex::ToUppercase(columndef.internalcolumn_name.begin(),columndef.internalcolumn_name.end());

        if (!columndef.column_id || !columndef.parent_object
            || namelen>MaxNameLen
            || type<1 || type>0xffff
            || columndef.internalcolumn_name.size()>MaxNameLen)//validate internal
        {
                // Error: signal and skip column
                ErrorDetected(Exception(ErrorMetadataBad,"Metatable COLUMNDEF record is broken!"));
                return;
        }

        columndef.type=static_cast<ColumnTypes>(type);
        AddColumn(&columndef);
}

bool HotMetadata::CheckColumn(TableDef const &table, ColumnDef &col)
{
        std::string parent_tablename = table.name;

        if (col.name.empty())
            return true; //noone cares about almost deleted columns

        bool continue_checking = true;

        // Illegal id. Nonfatal.
        if (col.column_id<1)
        {
                // Error: signal and murder column
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Column " + parent_tablename + ":" + col.name
                              + " has an illegal ID #" + Blex::AnyToString(col.column_id)));
                continue_checking = false;
        }

        // Check if autonumber when not integer. Fatal, correct by dropping autonumber.
        if (col.autonumber_start && col.type!=TInteger)
        {
                // Error: signal and murder column
                col.autonumber_start = 0;
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Column " + parent_tablename + ":" + col.name + " may not be an autosequencer, dropping autonumber"));
                continue_checking = false;
        }

        unsigned required_size=0;

        //Some specific checks, based on the column type. Fatal, correct to ttext
        switch (col.type)
        {
        case TDateTime:
        case TFloat:
        case TMoney:
        case TInteger64:
                required_size=8;
                break;

        case TTable:
        case TRole:
        case TInteger:
                required_size=4;
                break;

        case TBoolean:
                required_size=1;
                break;

        case TBlob:
        case TText:
                break;

        default:
                // Error: signal and set to ttext
                col.type = TText;
                ErrorDetected(Exception(ErrorMetadataBad,
                                  "Column " + parent_tablename + ":" + col.name + " has an illegal type, using varchar"));
                continue_checking = false;
        }

        // Check correct length for blob. Fatal, correct to TText.
        if (col.type == TBlob)
        {
                col.maxsize = 16; //no matter what the original size was..
                required_size = 16;
        }

        // Check default value for blob. No support for non-default blobs, so require DEFAULT NULL
        if (col.type == TBlob && col.defaultval.size()!=0)
        {
                // Ignore this, old databases do this. Just clear the default value (ADDME: remove this code when we have fixed all metadata (vooral UT))
                col.defaultval.clear();
                DEBUGPRINT("Column " << parent_tablename << ":" << col.name << " has an illegal default value size " << col.defaultval.size() <<", ignoring it");
        }

        // Check column size. Fatal, correct to TText
        if ((required_size && col.maxsize!=required_size)
            || col.maxsize>MaxColumnSize)
        {
                // Error: signal and set to ttext
                col.type = TText;
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Column " + parent_tablename + ":" + col.name + " has illegal size " + Blex::AnyToString(col.maxsize) + ", using varchar"));
                continue_checking = false;
        }

        // Check default value size. Fatal, ignore default
        if ((required_size && col.defaultval.size()!=required_size && col.defaultval.size()>0)
            || col.defaultval.size()>MaxColumnSize)
        {
                // Error: signal and clear default
                col.defaultval.clear();
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Column " + parent_tablename + ":" + col.name + " has an illegal default value size " + Blex::AnyToString(col.defaultval.size())));
                continue_checking = false;
        }

        if (col.external_type == TTable || col.external_type==TRole)
        {
                //Already enforced in ApplyColumnRecord
                assert(col.type == TInteger && col.ondelete == ForeignCascade);
        }
        else
        {
                if (col.type != col.external_type)
                {
                        // Error: signal and restore real type
                        col.external_type = col.type;
                        ErrorDetected(Exception(ErrorInternal,
                                      "External column type conflicts with internal column type, using type integer"));
                        continue_checking = false;
                }
        }

        if (col.dangle_negative && col.type != TInteger)
        {
                // Error: signal and ignore
                col.dangle_negative = false;
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Dangle negative only supported on integer type columns"));
                continue_checking = false;
        }

        if (col.foreignreference)
        {
                // Both normal reference and references by column?
                if (col.foreignreferencesbycolumn)
                {
                        // Error: signal and ignore all references
                        col.foreignreferencesbycolumn = 0;
                        col.foreignreference = 0;
                        ErrorDetected(Exception(ErrorMetadataBad,
                                      "Column " + parent_tablename + ":" + col.name + " both refers to a table and by table column, ignoring references"));
                        continue_checking = false;
                }

                const TableDef *reftable=metadata.GetTableDef(col.foreignreference);
                const ColumnDef *reffield=reftable ? reftable->GetColumnDef(reftable->primarykey) : 0;

                if (!reftable || reftable->name.empty())
                {
                        // Error: signal and ignore reference
                        col.foreignreference = 0;
                        ErrorDetected(Exception(ErrorMetadataBad,
                                      "Column " + parent_tablename + ":" + col.name + " refers to a non-existing table, ignoring reference"));
                        continue_checking = false;
                }

                if (!reffield || reffield->name.empty())
                {
                        // Error: signal and ignore reference
                        col.foreignreference = 0;
                        ErrorDetected(Exception(ErrorMetadataBad,
                                      "Column " + parent_tablename + ":" + col.name + " refers to a table without a primary column, ignoring reference"));
                        continue_checking = false;
                }

                if (continue_checking)
                {
                        if ((reffield->type!=col.type)
                            || reffield->maxsize!=col.maxsize)
                        {
                                // Error: signal and ignore reference
                                col.foreignreference = 0;
                                ErrorDetected(Exception(ErrorMetadataBad,
                                              "Column " + parent_tablename + ":" + col.name + " refers to a table with an incompatible primary key, ignoring reference"));
                                continue_checking = false;
                        }

                        TableDef::Columns const &columns = reftable->GetColumns();
                        for (TableDef::Columns::const_iterator it = columns.begin(), end = columns.end(); it != end; ++it)
                        {
                                if (it->second.external_type == TTable)
                                {
                                        // Error: signal and ignore reference
                                        col.foreignreference = 0;
                                        ErrorDetected(Exception(ErrorMetadataBad,
                                                      "Column " + parent_tablename + ":" + col.name + " refers to a table with a TABLE column, ignoring reference"));
                                        continue_checking = false;
                                }
                                if (it->second.foreignreferencesbycolumn)
                                {
                                        // Error: signal and murder column
                                        col.foreignreference = 0;
                                        ErrorDetected(Exception(ErrorMetadataBad,
                                                      "Column " + parent_tablename + ":" + col.name + " refers to a table with a references by table-column column, ignoring reference"));
                                        continue_checking = false;
                                }
                        }
                }

        }
        if (col.foreignreferencesbycolumn)
        {
                ColumnDef const *refcol = table.GetColumnDef(col.foreignreferencesbycolumn);

                if (!refcol)
                {
                        // Error: signal and murder column
                        col.foreignreferencesbycolumn = 0;
                        ErrorDetected(Exception(ErrorMetadataBad,
                                      "Column " + parent_tablename + ":" + col.name + " uses a table column which does not exist in its table, ignoring reference"));
                        continue_checking = false;
                }
                if (continue_checking)
                {
                        if (refcol->external_type != TTable)
                        {
                                // Error: signal and ignore reference
                                col.foreignreferencesbycolumn = 0;
                                ErrorDetected(Exception(ErrorMetadataBad,
                                              "Column " + parent_tablename + ":" + col.name + " uses a column that is not a table column, ignoring reference"));
//                                continue_checking = false;
                        }
                        if (col.ondelete != ForeignCascade)
                        {
                                // Error: signal and ignore reference
                                col.foreignreferencesbycolumn = 0;
                                ErrorDetected(Exception(ErrorMetadataBad,
                                              "Column " + parent_tablename + ":" + col.name + " refers by a table column to other tables, but does not have ON DELETE CASCADE set, ignoring reference"));
//                                continue_checking = false;
                        }
                }
        }
        return true;
}

bool HotMetadata::CheckTable(TableDef &tab)
{
        bool continue_checking = true;
        if (tab.object_id<1 && tab.parent_object->object_id != MetaSchema_INFORMATION_SCHEMA) //virtual tables exist only in the InformationSchema
        {
                // Error: signal and ignore
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Table " + tab.name
                              + " has an illegal ID #" + Blex::AnyToString(tab.object_id)));
                continue_checking = false;
        }

        if (tab.name.empty()) //no-one cares about broken almost-deleted tables
            return continue_checking;

        // Primary key constraints
        if (tab.primarykey)
        {
                //The primary key, if any, must exist, and have positive id. Fatal error, drop primary column.
                ColumnDef const *columndef = tab.GetColumnDef(tab.primarykey);
                if (!columndef || tab.primarykey < 1)
                {
                        // Error: signal and make consistent
                        tab.primarykey = 0;
                        ErrorDetected(Exception(ErrorMetadataBad,
                                      "Table " + tab.name + " has primary key "
                                      + Blex::AnyToString(tab.primarykey) + " but no definition. Primary key has been dropped."));
                        continue_checking = false;
                }

                if (continue_checking)
                {
                        // Primary key must be unique. Nonfatal error.
                        if (!columndef->unique)
                        {
                                // Error: signal
                                ErrorDetected(Exception(ErrorMetadataBad,
                                              "Table " + tab.name + " has primary key "
                                              + Blex::AnyToString(tab.primarykey) + " but it is not unique"));
                                return false;
                        }

                        // primary key may not be updated. Nonfatal error.
                        if (columndef->foreignreference && columndef->ondelete == ForeignSetDefault)
                        {
                                // Error: signal
                                ErrorDetected(Exception(ErrorMetadataBad,
                                              "Table " + tab.name + " has primary key "
                                              + Blex::AnyToString(tab.primarykey) + " but it has delete behaviour SET DEFAULT"));
                                return false;
                        }
                }
        }

        //The table must have columns. Nonfatal.
        if (tab.GetColumns().empty())
        {
                // Error: signal
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Table " + tab.name + " has no columns"));
                continue_checking = false;
        }

        // record header
        unsigned max_record_length = 2;

        for (TableDef::ColumnItr citr = tab.GetColumns().begin(); citr != tab.GetColumns().end(); ++citr)
        {
                // Add cell header length, and max cell length
                max_record_length += 4;
                max_record_length += citr->second.maxsize;

                // Check columns. Nonfatal.
                if (!CheckColumn(tab, citr->second/*,tab.name*/))
                {
                        ErrorDetected(Exception(ErrorMetadataBad,
                                      "Table " + tab.name + " has column " + citr->second.name + " with errors, ignoring"));
                }
        }

        // Check theoretical max length. Nonfatal.
        if (max_record_length > MaximumRecordSize)
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                              "Table " + tab.name + " can have records exceeding the maximum record size of 32 kilobytes (" + Blex::AnyToString(max_record_length) + " bytes)"));
                continue_checking = false;
        }

        return continue_checking;
}

void HotMetadata::PropagateHardReferences()
{
        // Initial round: set all tables that are hard referenced
        for (Metadata::TableItr titr = metadata.tables.begin(); titr != metadata.tables.end(); ++titr)
        {
                for (TableDef::ColumnCItr citr = titr->second.GetColumns().begin(); citr != titr->second.GetColumns().end(); ++citr)
                {
                        if (!citr->second.foreignreference)
                            continue;

                        if (!citr->second.IsSoftReference(titr->second.is_hard_referenced))
                        {
                                TableDef *tabledef = metadata.GetTableDef(citr->second.foreignreference);
                                tabledef->is_hard_referenced = true;
                        }
                }
        }

        // Propagation rounds: propagate all references of tables that are hard referenced
        while (true)
        {
                bool any_change = false;

                for (Metadata::TableItr titr = metadata.tables.begin(); titr != metadata.tables.end(); ++titr)
                {
                        if (!titr->second.is_hard_referenced)
                            continue;

                        for (TableDef::ColumnCItr citr = titr->second.GetColumns().begin(); citr != titr->second.GetColumns().end(); ++citr)
                        {
                                if (!citr->second.foreignreference)
                                    continue;

                                if (!citr->second.IsSoftReference(titr->second.is_hard_referenced))
                                {
                                        TableDef *tabledef = metadata.GetTableDef(citr->second.foreignreference);
                                        if (!tabledef->is_hard_referenced)
                                        {
                                                tabledef->is_hard_referenced = true;
                                                any_change = true;
                                        }
                                }
                        }
                }
                if (!any_change)
                    break;
        }
}

void HotMetadata::FinishUpdates()
{
        AssertConsistency();
        PropagateHardReferences();
}

void HotMetadata::AssertConsistency()
{
        bool any_problem = false;

        for (Metadata::TableItr titr = metadata.tables.begin(); titr != metadata.tables.end(); ++titr)
            any_problem = CheckTable(titr->second) || any_problem;

        if (any_problem) // Aftercheck if references still can find a table with a primary key.
        {
                for (Metadata::TableItr titr = metadata.tables.begin(); titr != metadata.tables.end(); ++titr)
                    for (TableDef::ColumnItr citr = titr->second.GetColumns().begin(); citr != titr->second.GetColumns().end(); ++citr)
                    {
                            if (!citr->second.foreignreference)
                                continue;

                            // Must succeed.
                            TableDef const *tabledef = metadata.GetTableDef(citr->second.foreignreference);

                            // No need to mention errors, they occur because of errors mentioned earlier
                            if (!tabledef->primarykey)
                                citr->second.foreignreference = 0;
                    }
        }
}

bool HotMetadata::AddColumn(ColumnDef *new_column)
{
        // Do ID/Name uniqueness
        if (!ValidateObject(*new_column))
            return false;

        //Insert the new column into the table list
        TableDef *table = static_cast<TableDef *>(new_column->parent_object);
        TableDef::ColumnItr coldef = table->columns.insert(std::make_pair(new_column->column_id, *new_column)).first;
        RegisterObject(&coldef->second);

        if (!new_column->name.empty()) //make name mapping only if column is not deleted
            table->column_names.insert(std::make_pair(new_column->name,new_column->column_id));
        return true;
}

bool HotMetadata::AddTable (TableDef *new_table)
{
        assert(!new_table->name.empty());
        if (!ValidateObject(*new_table))
            return false;

        //Insert the new table into the table list
        Metadata::TableItr tabdef = metadata.tables.insert(std::make_pair(new_table->object_id,*new_table)).first;
        RegisterObject(&tabdef->second);
        return true;
}

bool HotMetadata::ValidateObject (const ObjectDef &new_object)
{
        //ADDME: Convert type #s to text, mention object names as well as IDs (in other words: improve the error messages)
        if (!Blex::IsUppercase(new_object.name.begin(),new_object.name.end()))
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(new_object.object_id) +
                            " has non-uppercase name '" + new_object.name + "'"));
                return false;
        }
        // Does the id already exist?
        if (metadata.GetObjectDef(new_object.object_id)) //dupe id
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(new_object.object_id) +
                            " of type " + GetObjectTypeName(new_object.type) +
                            " is duplicate"));
                return false;
        }

        if (!new_object.name.empty())
        {
                ObjectDef const *parentobject = new_object.parent_object;
                ObjectId dupeobjectid = parentobject ? parentobject->GetObjectId(new_object.name) : 0;
                if (dupeobjectid)
                {
                        ErrorDetected(Exception(ErrorMetadataBad,
                                    "Object #" + Blex::AnyToString(new_object.object_id) +
                                    " with parent #" + Blex::AnyToString(parentobject ? parentobject->object_id : 0) +
                                    " named '" + new_object.name +
                                    "' is duplicate with object #" + Blex::AnyToString(dupeobjectid)));
                        return false;
                }
        }

        // Is the parent of a valid type
        int require_parent_type;
        switch(new_object.type)
        {
        case MetaObjectType::Schema:
                require_parent_type = MetaObjectType::Root;
                break;
        case MetaObjectType::Table:
                require_parent_type = MetaObjectType::Schema;
                break;
        case MetaObjectType::Column:
        case MetaObjectType::Index:
                require_parent_type = MetaObjectType::Table;
                break;
        default:
                require_parent_type = -1;
                break;
        }

        if (require_parent_type == -1 && new_object.parent_object)
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(new_object.object_id) +
                            " of type " + GetObjectTypeName(new_object.type) +
                            " shouldn't have a parent, but claims to be a child of #" + Blex::AnyToString(new_object.parent_object->object_id)));
                return false;
        }
        if (require_parent_type != -1 && !new_object.parent_object)
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(new_object.object_id) +
                            " of type " + GetObjectTypeName(new_object.type) +
                            " has no parent, but should have a parent of type " + GetObjectTypeName(require_parent_type)));
                return false;
        }
        if (require_parent_type != -1 && new_object.parent_object->type != require_parent_type)
        {
                ErrorDetected(Exception(ErrorMetadataBad,
                            "Object #" + Blex::AnyToString(new_object.object_id) +
                            " of type " + GetObjectTypeName(new_object.type) +
                            " requires a parent of type " + GetObjectTypeName(require_parent_type) +
                            " but its parent #" + Blex::AnyToString(new_object.parent_object->object_id) +
                            " has type " + GetObjectTypeName(new_object.type)));
                return false;
        }
        return true;
}

void HotMetadata::RegisterObject (ObjectDef *new_object)
{
        if (!ValidateObject(*new_object))
            return; //FIXME: SHOW THEERROR?!

        metadata.objects.insert(std::make_pair(new_object->object_id, new_object));
        if (!new_object->name.empty() && new_object->parent_object) //Add a name mapping, only if its not deleted
            new_object->parent_object->childnames.insert(std::make_pair(new_object->name,new_object->object_id));
}

bool HotMetadata::AddSchema (SchemaDef *new_schema)
{
        if (!ValidateObject(*new_schema))
            return false;
        if (new_schema->owner == MetaRole_PUBLIC)
        {
                ErrorDetected(Exception(ErrorMetadataBad,"Schema " + new_schema->name + " is owned by PUBLIC"));
        }

        Metadata::Schemas::iterator itr = metadata.schemas.insert(std::make_pair(new_schema->object_id, *new_schema)).first;
        RegisterObject(&itr->second);
        return true;
}

ObjectDef::ObjectDef(MetaObjectType::_type _type)
: object_id(0)
, parent_object(NULL)
, type(_type)
{
}

ObjectDef::~ObjectDef()
{
}

std::string ObjectDef::GetPrettyName() const
{
        return name;
}


IndexDef::IndexDef()
: ObjectDef(MetaObjectType::Index)
, unique(false)
{
}

IndexDef::~IndexDef()
{
}

std::string IndexDef::GetPrettyName() const
{
        return "#" + Blex::AnyToString(object_id) + " (" + name + ")";
}

ColumnDef::ColumnDef()
: ObjectDef(MetaObjectType::Column)
, column_id(0)
, autonumber_start(0)
, internalcolumn_handler(NULL)
, deprecated_autoseq(NULL)
, ondelete(ForeignIllegal)
, foreignreference(0)
, foreignreferencesbycolumn(0)
, notnull(false)
, nocirculairs(false)
, unique(false)
, noupdate(false)
, internal(false)
, dangle_negative(false)
{
}

ColumnDef::~ColumnDef()
{
}

bool ColumnDef::IsSoftReference(bool table_is_hard_referenced) const
{
        // Not foreignreference? We're soft
        if (!foreignreference)
            return true;
        switch (ondelete)
        {
        case ForeignIllegal:    return false;
        case ForeignCascade:    return !table_is_hard_referenced;
        case ForeignSetDefault:
                {
                        // Not soft if any of the following are set
                        if (notnull || unique || noupdate)
                            return false;
                        // Not soft if defaultval is not null
                        if (!defaultval.empty())
                            return false;

                        return true;
                }
        }
        return true;
}

std::string ColumnDef::GetPrettyName() const
{
        return parent_object->GetPrettyName() + "(" + name + ")";
}


IndexDef const* TableDef::GetIndexDef(std::string const &name) const
{
        for (unsigned i=0;i<additional_indices.size();++i)
          if (additional_indices[i].name == name)
            return &additional_indices[i];
        return NULL;
}

std::string TableDef::GetPrettyName() const
{
        return parent_object->GetPrettyName() + "." + name;
}

std::string SchemaDef::GetPrettyName() const
{
        return name;
}


VirtualTableRecordItr::~VirtualTableRecordItr()
{
}

void Metadata::CalculateNeededActions(std::vector< NeededAction > *actions) const
{
        actions->clear();

        for (Tables::const_iterator tit = GetTables().begin(); tit != GetTables().end(); ++tit)
        {
                // Tabledef parent is always a schema, so this is a safe cast.
                SchemaDef const *schema = static_cast<SchemaDef const*>(tit->second.parent_object);
                if (!schema)
                    throw Exception(ErrorInternal, "Could not find schema");

                RoleDef const *schema_owner = Privs().GetRoleDef(schema->owner);
                if (!schema_owner)
                    throw Exception(ErrorInternal, "Could not find schema owner");

                for (TableDef::Columns::const_iterator cit = tit->second.GetColumns().begin(); cit != tit->second.GetColumns().end(); ++cit)
                {
                        ColumnDef const *columndef = &cit->second;
                        if (!columndef->foreignreference)
                            continue;

                        // Any table with TABLE columns must be owned by _SYSTEM
                        if (columndef->external_type == TTable)
                        {
                                if (schema_owner->role_id != MetaRole_SYSTEM)
                                {
                                        NeededAction action;
                                        action.object = columndef->object_id;
                                        action.type = NeededAction::UnknownAction;
                                        actions->push_back(action);
                                }
                                continue;
                        }

                        // Role definitions are free to use and do not need checking
                        if (columndef->external_type == TRole)
                            continue;

                        // Owner of table that references another table must have REFERENCES privilege on that table
                        TableDef const *referenced_table = GetTableDef(columndef->foreignreference);
                        if (!referenced_table)
                            throw Exception(ErrorInternal, "Could not find referenced object");
                        if (!referenced_table->primarykey)
                            throw Exception(ErrorInternal, "Referenced object does not have a primary column");

                        ColumnDef const *referenced_column = referenced_table->GetColumnDef(referenced_table->primarykey);
                        if (!referenced_column)
                            throw Exception(ErrorInternal, "Could not find definition of primary column of referenced object");
                        if (!referenced_column->noupdate)
                            throw Exception(ErrorInternal, "Primary key " + referenced_column->GetPrettyName() + " referenced by " + columndef->GetPrettyName() + " may not be updateable if you will refer to it (it must be marked NOUPDATE)");

                        PrivilegeDescriptor desc;
                        Privs().GetObjectPrivilegesForSpecificRole(schema->owner, *referenced_column, &desc);

                        // FIXME: this check is also in backend_sql.cpp, MERGE!
                        bool has_hard_right = desc.HasPrivilege(Privilege::Column_References);
                        bool has_soft_right = desc.HasPrivilege(Privilege::Column_Select);
                        bool is_soft = columndef->IsSoftReference(tit->second.IsHardReferenced());

                        if (!has_hard_right && !(is_soft && has_soft_right))
                        {
                                NeededAction action;
                                action.object = columndef->object_id;
                                action.type = NeededAction::DropReference;
                                actions->push_back(action);
                        }
                }
        }
}

} //end namespace database
