#ifndef blex_webhare_shared_dbase_meta
#define blex_webhare_shared_dbase_meta

//Database metadata tables column ids
#include <blex/context.h>
#include "dbase_types.h"
#include "dbase_index_frontend.h"
#include "dbase_privileges.h"

#include <memory>

namespace Database
{

const unsigned MetaTableCount          = 9;

const TableId TableId_MetaColumns     = 2;

const ColumnId MetaColumn_ColumnId     = 2;
const ColumnId MetaColumn_MaxSize      = 3;
const ColumnId MetaColumn_Type         = 4;
const ColumnId MetaColumn_Default      = 5;
const ColumnId MetaColumn_Autokey      = 7;
const ColumnId MetaColumn_ForeignBehav = 8;
const ColumnId MetaColumn_ForeignRefer = 9;
const ColumnId MetaColumn_NotNull      = 11;
const ColumnId MetaColumn_Internal     = 12;
const ColumnId MetaColumn_NoCirculairs = 13;
const ColumnId MetaColumn_Unique       = 14;
const ColumnId MetaColumn_NoUpdate     = 15;
const ColumnId MetaColumn_ObjectId     = 16;
const ColumnId MetaColumn_RefersByCol  = 17;

const TableId TableId_MetaTables      = 1;

const ColumnId MetaTable_ObjectId      = 14;
const ColumnId MetaTable_Primary       = 15;
const ColumnId MetaTable_ReadAccess    = 16;
const ColumnId MetaTable_WriteAccess   = 17;

const TableId TableId_MetaObjects     = 3;

const ColumnId MetaObjects_ObjectId    = 1;
const ColumnId MetaObjects_Name        = 2;
const ColumnId MetaObjects_Type        = 3;
const ColumnId MetaObjects_Parent      = 4;
const ColumnId MetaObjects_CreationDate= 5;
const ColumnId MetaObjects_Comment     = 6;

const TableId TableId_MetaSchemas     = 4;

const ColumnId MetaSchemas_ObjectId     = 1;
const ColumnId MetaSchemas_Owner        = 2;

const TableId  TableId_MetaIndices      =  5;
const ColumnId MetaIndex_IndexId        =  1; //The unique id for this index
const ColumnId MetaIndex_Uppercase      =  3; //True if this index must be stored in uppercase (case-sensitive)
const ColumnId MetaIndex_Unique         =  4; //True if this index is a unique index
const ColumnId MetaIndex_ObjectId       =  6; //The object id for this index
const ColumnId MetaIndex_NoNullStores   =  7; //True if this index doesn't store entries with one or more nulls

const TableId  TableId_MetaIndexColumns =  6;
const ColumnId MetaIndexColumn_IndexId  =  1; //The index containing this column
const ColumnId MetaIndexColumn_ColumnId =  2; //The ID of the column referred by this index entry
const ColumnId MetaIndexColumn_Ordering =  3; //The relative ordering of this column in the index (1..4)
const ColumnId MetaIndexColumn_Length   =  4; //Maximum length of data to store in the index

const TableId  TableId_MetaRoles       =  7;
const ColumnId MetaRoles_RoleId         =  1; //The index containing this column
const ColumnId MetaRoles_Name           =  2; //The ID of the column referred by this index entry
const ColumnId MetaRoles_Schema         =  3; //The schema this role belongs to

const TableId  TableId_MetaGrants      =  8;
const ColumnId MetaGrants_Id            =  1; //Id of this grant
const ColumnId MetaGrants_Object        =  2; //Object on which priviliges are granted
const ColumnId MetaGrants_Grantor       =  3; //The role that grants this privileges
const ColumnId MetaGrants_Grantee       =  4; //The role that has been granted this privileges
const ColumnId MetaGrants_Mask          =  5; //Mask with privilige definition

const TableId  TableId_MetaRoleGrants  =  9;
const ColumnId MetaRoleGrants_Id        =  1; //Id of this grant
const ColumnId MetaRoleGrants_Role      =  2; //Role that has been granted
const ColumnId MetaRoleGrants_Grantor   =  3; //The role that grants this privileges
const ColumnId MetaRoleGrants_Grantee   =  4; //The role that has been granted this privileges
const ColumnId MetaRoleGrants_WithAdmin =  5; //Is this role regrantable?

const RoleId MetaRole_PUBLIC = -2; //A role implicitly granted to all other roles
const RoleId MetaRole_SYSTEM = -1; //The DBA role, owner of all SQL standard objects
const RoleId MetaRole_DATABASE_SELF = -3; //The database itself, to keep metadata out of the reach of _SYSTEM. Noone can ever obtain the role DATABASE_SELF
const RoleId MetaRole_BACKUP = -4; //The database backup transaction. Reads EVERYTHING

const ObjectId MetaSchema_PUBLIC = -2;
const ObjectId MetaSchema_INFORMATION_SCHEMA = -3;
const ObjectId MetaSchema_DEFINITION_SCHEMA = -4;

class AutoSeqManager;
class RawDatabase;
class Plugins;
class Backend;
class BackendTransaction;
class HotMetadata;
class PrivilegeChecker;

/** Responses to DELETE and UPDATE on referred columns */
enum ForeignBehaviours
{
        ///Refuse deletion of the record we're pointing to
        ForeignIllegal,
        ///When the record being pointed to is deleted, restore our default value
        ForeignSetDefault,
        ///When the record being pointed to is deleted, delete this record as well
        ForeignCascade
};

/** An objectdef holds the base description of every object */
class ObjectDef
{
        public:
        explicit ObjectDef(MetaObjectType::_type _type);

        virtual ~ObjectDef();

        typedef std::map<std::string, ObjectId, Blex::StrLess<std::string> > ChildNames;

        /** Lookup the id of a object
            @param name Name of the object to return
            @param parent Parent of the object to return (0 for no parent, returns schemas)
        */
        ObjectId GetObjectId(std::string const &name) const
        {
                ObjectDef::ChildNames::const_iterator itr = childnames.find(name);
                if (itr == childnames.end())
                    return 0;
                else
                    return itr->second;
        }

        /// Object name
        std::string name;

        /// Object id
        ObjectId object_id;

        /// Parent object, NULL for the metadata root
        ObjectDef *parent_object;

        /// Type of object.
        MetaObjectType::_type type;

        /// Children name to object_id mappings
        ChildNames childnames;

        // Get a pretty name
        virtual std::string GetPrettyName() const;
};

/** An IndexDef holds the metadata of an index. */
class IndexDef : public ObjectDef
{
        public:
        IndexDef();
        ~IndexDef();

        ///Reference to this index
        Index::Descriptor descr;
        ///True if this is a unique index
        bool unique;

        // Get a pretty name
        virtual std::string GetPrettyName() const;
};

/** DBColumnDefs hold the metadata of the existing columns */
class ColumnDef : public ObjectDef
{
        public:
        ColumnDef();
        ~ColumnDef();

        ///Id of this column
        ColumnId column_id;

        ///The external type of the column (as the outside world should see it)
        ColumnTypes external_type;

        ///The internal type of the column (types >= 0x8000 are dynamic, others static)
        ColumnTypes type;

        ///Maximum size for data in this column
        unsigned maxsize;

        ///The default value for this column
        std::vector<uint8_t> defaultval;

        ///Start value for autonumbered colmuns
        int32_t autonumber_start;

        ///UGLY fix: Internal column's name, needed to pass it to the table create functions :-(
        std::string internalcolumn_name;

        ///Function handling internal columns
        Plugins::InternalColumn internalcolumn_handler;

        ///Autonumber handler
        AutoseqTop *deprecated_autoseq;

        ///What to do when the record we are referring to is deleted
        ForeignBehaviours ondelete;

        ///The table this column refers to
        TableId foreignreference;

        ///In the current row, this column references the table in this column
        ColumnId foreignreferencesbycolumn;

        ///True if the column may not contain NULL values
        unsigned notnull : 1;

        ///True if the column may not contain/cause circulair references
        unsigned nocirculairs : 1;

        ///True if this column should be unique
        unsigned unique : 1;

        ///True if this column may not be updated after an insert
        unsigned noupdate : 1;

        ///True if this column is internal
        unsigned internal : 1;

        /** True if foreign references may 'dangle' (point to invalid objects)
            if pointing to a negative value. This is a 'hack' for the definition_schema,
            because it sometimes refers to built-in objects, but we'll do this as long
            as this works and suffices: the proper alternative would be to add the implicit
            roles and tables as 'virtual' records to the definition_schema */
        unsigned dangle_negative : 1;

        ///Indices with this column as first column
        std::vector< Index::IndexData::Ref > indices;

        /** Returns whether the reference in this column is soft.
            @param table_is_hard Indicicates whether the table is hard referenced
            @return Returns whether this is a soft reference */
        bool IsSoftReference(bool table_is_hard_referenced) const;

        // Get a pretty name
        virtual std::string GetPrettyName() const;
};

class VirtualTableSource;

/** A virtual table record iterator */
class VirtualTableRecordItr
{
        public:
        inline VirtualTableRecordItr(VirtualTableSource &_source) : source(_source) {}
        virtual ~VirtualTableRecordItr() = 0;

        virtual bool GetRecord(WritableRecord *destination) = 0;

        VirtualTableSource &source;
};

/** A function returning an iterator for a virtual table
    (ADDME: Can we in the future merge this a bit more with disk iterators?) */
typedef VirtualTableRecordItr* (*CreateRecordIterator)(BackendTransaction &trans, VirtualTableSource &source);

/** TableDef hold the metadata of the existing tables, and their columns. It
    guarantees that any return ColumnDef* is not invalidated until the TableDef
    itself is invalidated */
class TableDef : public ObjectDef
{
        public:
        ///Map for storing our columns (we need to be able to generate stable references)
        typedef std::map<ColumnId, ColumnDef> Columns;
        ///Iterator for columns container
        typedef Columns::iterator ColumnItr;
        ///Constant iterator for columns container
        typedef Columns::const_iterator ColumnCItr;
        ///Vector for storing column names
        typedef std::map<std::string, ColumnId> ColumnNames;
        ///Vector for storing requested indices
        typedef std::vector<IndexDef> Indices;
        ///Iterator for index container
        typedef Indices::const_iterator IndexItr;

        TableDef()
        : ObjectDef(MetaObjectType::Table)
        , primarykey(0)
        , record_itr_func(NULL)
        , readaccess(NULL)
        , writeaccess(NULL)
        , is_hard_referenced(false)
        {
        }

        /** Lookup the definition of a column
            @param  id      ID of the column to return
            @return The requested ColumnDef structure, or NULL.
        */
        inline const ColumnDef* GetColumnDef(ColumnId id) const
        {
                ColumnCItr bound = columns.find(id);
                return bound != columns.end() ? &bound->second : NULL;
        }

        /** Lookup the definition of a column
            @param  name    Name of the column to return. Never NULL
            @return The requested ColumnDef structure, or NULL.
        */
        template <class T> ColumnId GetColumnId(T const &name) const
        {
                ColumnNames::const_iterator itr = column_names.find(name);
                return itr==column_names.end() ? ColumnId(0) : itr->second;
        }

        /** Look up an index by name */
        IndexDef const* GetIndexDef(std::string const &name) const;

        /** Get the column list itself */
        const Columns& GetColumns() const { return columns; }
        /** Get the index list */
        const Indices& GetAdditionalIndices() const { return additional_indices; }

        /** Return whether the table is hard referenced */
        inline bool IsHardReferenced() const { return is_hard_referenced; }

        ///Table's primary key
        ColumnId primarykey;

        ///Virtual table iterator
        CreateRecordIterator record_itr_func;

        ///UGLY fix: Internal name, needed to pass it to the table create functions :-(
        std::string readaccess_name;

        ///UGLY fix: Internal name, needed to pass it to the table create functions :-(
        std::string writeaccess_name;

        Plugins::RecordReadAccess readaccess;
        Plugins::RecordWriteAccess writeaccess;

        // Get a pretty name
        virtual std::string GetPrettyName() const;

        private:
        inline ColumnDef* GetColumnDef(ColumnId id)
        {
                ColumnItr bound = columns.find(id);
                return bound != columns.end() ? &bound->second : NULL;
        }

        Columns& GetColumns() { return columns; }

        Columns columns;

        ColumnNames column_names;

        Indices additional_indices;

        bool is_hard_referenced;

        friend class HotMetadata;
        friend class MetadataManager;
};

/** Definition of a schema (still quite empty) */
class SchemaDef : public ObjectDef
{
    public:
        inline SchemaDef() : ObjectDef(MetaObjectType::Schema), owner(0) {}

        /// ID of the owner of this schema
        int32_t owner;

        // Get a pretty name
        virtual std::string GetPrettyName() const;
};

/** The Metadata object holds the metadata (tables and columns) for the
    database. Each transaction backend receives its own copy of the table's
    metadata, which will not be modified as long as the transaction itself
    doesn't modify anything.

    Any TableDef* or SchemaDef* returned by functions in this Metadata will not
    be invalidated until the current Metadata itself is destroyed.

    Every definition that inherits from ObjectDef also has a copy of its
    ObjectDef in the objects list.
*/
class Metadata
{
        public:
        /// Map for storing all objects
        typedef std::map<ObjectId, ObjectDef const*> Objects;
        ///Constant iterator for objects container
        typedef Objects::const_iterator ObjectCItr;
        ///Mutable iterator for table container
        typedef Objects::iterator ObjectItr;

        ///Map for storing our tables (we need to be able to generate stable references)
        typedef std::map<TableId, TableDef> Tables;
        ///Constant iterator for table container
        typedef Tables::const_iterator TableCItr;
        ///Mutable iterator for table container
        typedef Tables::iterator TableItr;

        /// Map for storing our schema's (we need to be able to generate stable references)
        typedef std::map< ObjectId, SchemaDef > Schemas;
        ///Constant iterator for schema container
        typedef Schemas::const_iterator SchemaCItr;

        /** Construct an empty metadata object */
        Metadata(Blex::ContextRegistrator const &registrator);

        /** Get the root object (contains the Scheams) */
        ObjectDef const &GetRootObject() const
        {
                return *root;
        }

        /** Lookup the definition of an object
            @param  id  ID of the table to return
            @return The requested ColumnDef structure, or NULL.
        */
        ObjectDef const * GetObjectDef(ObjectId objectid) const
        {
                ObjectCItr bound = objects.find(objectid);
                return bound != objects.end() ? bound->second : NULL;
        }
        ObjectDef * GetObjectDef(ObjectId objectid)
        {
                return const_cast<ObjectDef*>(const_cast<Metadata const*>(this)->GetObjectDef(objectid));
        }
        SchemaDef const * GetSchemaDef(ObjectId objectid) const
        {
                ObjectDef const *object = GetObjectDef(objectid);
                if (object->type == MetaObjectType::Schema)
                    return static_cast<SchemaDef const*>(object);
                else
                    return NULL;
        }

        /** Get the object list */
        const Objects& GetObjects() const { return objects; }
        /** Get the schema list */
        const Schemas& GetSchemas() const { return schemas; }
        /** Get the table list itself */
        const Tables& GetTables() const { return tables; }

        /** Lookup the definition of a table
            @param  id  ID of the table to return
            @return The requested ColumnDef structure, or NULL.
        */
        const TableDef* GetTableDef(TableId tableid) const
        {
                TableCItr bound = tables.find(tableid);
                return bound != tables.end() ? &bound->second : NULL;
        }

        /** Lookup the definition of a column
            @param  table   TableDef containing the column, which may be NULL
            @param  id      ID of the column to return
            @return The requested ColumnDef structure, or NULL.
        */
        ColumnDef const* GetColumnDef(const TableDef* table,ColumnId id) const
        { return table ? table->GetColumnDef(id) : NULL; }

        /** Lookup the definition of a column
            @param  tableid ID of the table, which may be NULL
            @param  id      ID of the column to return
            @return The requested ColumnDef structure, or NULL.
        */
        ColumnDef const* GetColumnDef(TableId tableid,ColumnId id) const
        { return GetColumnDef(GetTableDef(tableid),id); }

        /** Lookup the definition of a column
            @param  tableid ID of the table, which may be NULL
            @param  name    Name of the column to return. Never NULL
            @return The requested ColumnDef structure, or NULL.
        */
        template <class T> ColumnId GetColumnId(TableDef const *table,T const &name) const
        { return table ? table->GetColumnId(name) : ColumnId(0); }

        /** Lookup the definition of a column
            @param  tableid ID of the table, which may be NULL
            @param  name    Name of the column to return. Never NULL
            @return The requested ColumnDef structure, or NULL.
        */
        template <class T> ColumnId GetColumnId(TableId tableid,T const &name) const
        { return GetColumnId(GetTableDef(tableid),name); }

        /** Returns whether an object is a ancestor of another object
            @param child Child object
            @param ancestor Object to check if it is a parent of the child
            @return TRUE if the ancestor object really is a ancestor of the child object */
        static bool IsAncestor(ObjectDef const *child, ObjectDef const *ancestor);

        bool IsAncestor(ObjectId child, ObjectId ancestor)
        { return IsAncestor(GetObjectDef(child), GetObjectDef(ancestor)); }

        PrivilegeChecker const & Privs() const { return privs; }

        /** Returns whether errors occurred in reading of metadata
            @param errors Optional list of strings that is filled with the list of errors. 0 to not fill.
            @return Whether any errors occurred during reading of the metadata. */
        bool AnyErrors(std::vector< Exception > *errors) const;

        ///Context keeper
        Blex::ContextKeeper keeper;

        void Swap(Metadata &rhs);

        /// Describes an action needed to keep grants happy
        struct NeededAction
        {
                /// Object this actions referes to
                ObjectId object;

                /// Types of actions
                enum Action
                {
                        UnknownAction,          ///< Unknown action (object still should be set)
                        DropReference           ///< Column, should have its reference dropped
                } type;
        };

        /** Calculates list of actions needed to keep grants happy. Clears actions at start. */
        void CalculateNeededActions(std::vector< NeededAction > *actions) const;

        /** Get the metadata start timestamp */
        Blex::DateTime GetStartTimeStamp() const { return timestamp; }

        /** Get the metadata version count */
        uint32_t GetVersionId() const { return versionid; }

    private:
        // Need custom copy constructor due to privilege_checker tandem object
        Metadata(Metadata const &rhs);
        Metadata & operator =(Metadata const &rhs);

        Tables& GetTables() { return tables; }
        Objects& GetObjects() { return objects; }
        Schemas& GetSchemas() { return schemas; }

        TableDef* GetTableDef(TableId tableid)
        {
                TableItr bound = tables.find(tableid);
                return bound != tables.end() ? &bound->second : NULL;
        }
        SchemaDef * GetSchemaDef(ObjectId objectid)
        {
                Schemas::iterator bound = schemas.find(objectid);
                return bound != schemas.end() ? &bound->second : NULL;
        }

        /** Adds an error to the list of errors */
        void ErrorDetected(Exception const &exception);

        uint32_t versionid;
        Blex::DateTime timestamp;

        Objects objects;
        ///Has to be a ptr, because schema's refer to the root by address and swap should work
        std::unique_ptr< ObjectDef > root;

        Tables tables;

        Schemas schemas;

        ///Privileges checker;
        PrivilegeChecker privs;

        /// Errors that occurred reading current metadata
        std::vector< Exception > errors;

        friend class HotMetadata;
        friend class MetadataManager;
        friend class PrivilegeChecker;
};


/** The metadata config manager controls the database main configuration structures.

    Before reading the metadata the first time, it contains only the metadata of
    the META_ tables. */
class MetadataManager
{
        public:
        /** A reference to metadata */
        class Ref
        {
                public:
                /** Get a reference to metadata */
                Ref (MetadataManager &mgr);
                /** Release a reference to metadata */
                ~Ref();

                /** Access the metadata */
                const Metadata& operator*() const;

                /** Access the metadata */
                const Metadata* operator->() const;

                /** Update this reference's metadata by swapping it with
                    a new version.
                    @param metadata Metadata to swap - old data is returned in this object
                */
                void SwapMetadata(HotMetadata *metadata);

                private:
                MetadataManager &mgr;
                HotMetadata *myref;

                Ref(const Ref&); //not implemented
                Ref& operator=(const Ref&); //not implemented

                friend class HotMetadata;
        };

        /** Construct the base metadata tables and register the plugins we will use */
        MetadataManager(Plugins const &plugins, RawDatabase &rawdb,AutoSeqManager &autoseq, Index::System *indexsystem, bool recovery_mode);

        ~MetadataManager();

        /** Read the database metadata. Throws a Exception on error. */
        void ReadMetadata(BackendTransaction *metatrans);

        /** Returns whether errors occurred in reading of metadata
            @param errors Optional list of strings that is filled with the list of errors. 0 to not fill.
            @return Whether any errors occurred during reading of the metadata. */
        bool AnyErrors(std::vector< Exception > *errors) const;

        /** Returns an new metadata version id */
        uint32_t AllocateNewVersionId();

        private:
        void ConfigureExternals(HotMetadata &metadata);
        void ConfigureIndexes(ColumnDef *col, TableDef const &table);
        void ConfigureTableExternals(TableDef *table, SchemaDef const *schema);
        void ConfigureColumnExternals(TableDef const &table, ColumnDef *column, SchemaDef const *schema);

        ///Time at which we started the metadata manager (required for versioning)
        const Blex::DateTime databasestart;

        bool const recovery_mode;
        RawDatabase &rawdb;
        AutoSeqManager &autoseq;

        /// Shared data
        struct SharedData
        {
                inline SharedData() : current_metadata(0), counter(1) {}

                ///Current metadata instance
                HotMetadata* current_metadata;

                ///Metadata version counter, used to give out unique version ids
                unsigned counter;
        };
#ifdef DEBUG
        typedef Blex::InterlockedData<SharedData, Blex::DebugMutex> LockedData;
#else
        typedef Blex::InterlockedData<SharedData, Blex::Mutex> LockedData;
#endif

        LockedData data;

        Plugins const &plugins;

        Index::System *const indexsystem;

        /// Context registrator for meta-contexts
        Blex::ContextRegistrator metacontextregistrator;

        friend class Ref;
        friend class HotMetadata;

        MetadataManager(MetadataManager const &) = delete;
        MetadataManager& operator=(MetadataManager const &) = delete;
};

/** The metadata class, with additional functions that permit modifications */
class HotMetadata
{
        public:
        HotMetadata(MetadataManager &metamgr);
        ~HotMetadata();

        /** Read or refresh metadata from transaction
            @param metatrans Transaction to use when reading metadata */
        void ReadMetadata(BackendTransaction &metatrans, bool aftercommit, bool allow_grant_inconsistencies, uint32_t newversionid);

        Metadata const& GetMetadata() const { return metadata; }

        //Swap this hot metadata with another hot metadata object
        void Swap(HotMetadata &rhs);

        private:
        HotMetadata(HotMetadata const &src);

        void ReadMetadataIndices(BackendTransaction &metatrans, bool aftercommit);
        bool ReadMetadataIndex(BackendTransaction &metatrans, bool aftercommit, int32_t indexid, TableDef *table, bool uppercase, bool nonullstores, Index::Descriptor *descr);

        bool ApplyObjectRecord(const Record &objectrec, ObjectDef *apply_to);
        void ApplySchemaRecord(const Record &objectrec, const Record &rec);
        void ApplyTableRecord(const Record &objectrec, const Record &rec);
        void ApplyColumnRecord(const Record &objectrec, const Record &rec);

        void ReadMetadataRoles(BackendTransaction &metatrans, bool aftercommit);
        void ReadMetadataRoleGrants(BackendTransaction &metatrans, bool aftercommit);
        void ReadMetadataGrants(BackendTransaction &metatrans, bool aftercommit);

        /** Validate a object. Should be called before calling RegisterObject! */
        bool ValidateObject(const ObjectDef &new_object);
        /** Create a object in the objects list */
        void RegisterObject(ObjectDef *new_object);

        /** Create a schema in the schema list */
        bool AddSchema(SchemaDef *new_schema);

        /** Create a table in the table list */
        bool AddTable(TableDef *new_column);

        /** Create a column in the columns list
            @param columnid Id of the new column
            @param name Name of the new column
            @return false if the column was a dupe or invalid */
        bool AddColumn(ColumnDef *new_column);

        /** Finish updates to the metadata (must be called to properly update
            references et al) */
        void FinishUpdates();

        bool recovery_mode;

        Metadata metadata;

        void PropagateHardReferences();
        void AssertConsistency();

        bool CheckTable(TableDef &tabledef);

        bool CheckColumn(TableDef const &table, ColumnDef &columndef);

        /** Adds an error to the list of errors */
        void ErrorDetected(Exception const &exception) { metadata.ErrorDetected(exception); }

        ///Metadata reference count (must have the MetadataManager lock)
        unsigned refcount;

        void AutoCreateMetadata();
        void InsertSystemSchemas();
        void CreateImplicitGrants(); // Also validates schema owner roles

        friend class MetadataManager;
        friend class MetadataManager::Ref;
};

inline const Metadata& MetadataManager::Ref::operator*() const { return myref->GetMetadata(); }
inline const Metadata* MetadataManager::Ref::operator->() const { return &myref->GetMetadata(); }
} //end namespace Database

namespace std
{

inline void swap(Database::Metadata &lhs, Database::Metadata &rhs)
{
        lhs.Swap(rhs);
}
inline void swap(Database::HotMetadata &lhs, Database::HotMetadata &rhs)
{
        lhs.Swap(rhs);
}

} //end namespace std

#endif /* sentry */

