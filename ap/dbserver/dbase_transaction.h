#ifndef blex_webhare_shared_dbase_transaction
#define blex_webhare_shared_dbase_transaction

#include "dbase_consistency.h"
#include "dbase_modifications.h"
#include "dbase_backend.h"
#include "dbase_privileges.h"

namespace Database
{

/** Transaction state

  Possible transitions:
  - X -> X (no change)
  - Normal -> ReadOnly                  (also rollbacks transaction internally)
  - Normal -> ReadOnlyAfterError        (also rollbacks transaction internally)
*/
namespace TransactionState
{
enum Type
{
Normal=0,               ///< No problem: allows all modifications.
ReadOnly,               ///< Transaction may not be modified: error on all modifications.
ReadOnlyAfterError      ///< Transaction has encountered an error: modifications are silently ignored
};
} // End of namespace TransactionState

/** BackendTransaction is the implementation of a normal database transaction.
    For every (activated) transaction the RPC server has, a corresponding
    backend transaction is created. These are the calls that actually
    write the data to the database. It has some calls that are quite
    similair to the frontend calls, which are mainly here to support
    Triggers and Constraints.
*/
class BackendTransaction
{
    public:
        /** Construct a transaction, connected to the specified backend.
            so no instances can be built on the stack
            @param _dbase Database backend for all dbase i/o
            @param client_trans Whether this is a client transaction
        */
        explicit BackendTransaction(Backend &_dbase, bool client_trans);

        /// Destructor
        ~BackendTransaction();

        typedef std::vector< RoleId > RoleIds;
        typedef std::set< std::pair< TableId, ColumnId > > MetaColumnsChanges;

        /** Modify the roleset for this transaction. This function can only
            reduce the roleset, unless skip_security is true */
        void SetBaseRoles(RoleIds const &newroles, bool skip_security);

        /** Can this transaction be timed out ? (backup transactions may never timeout) */
        bool MayTimeout() const { return may_time_out; }

        /** \addtogroup TransactionManagement */
        /*\@{*/

        /// Returns the ID of this transaction
        TransId GetTransId() const { return identified_trans.GetTransId(); }

        /// Returns the current state of this transaction
        TransactionState::Type GetState() const { return state; }

        /** Switches this transaction to another state. Throws on illegal transition.
            @param newstate New state of this transaction
        */
        void SwitchToState(TransactionState::Type newstate);

        /// Checks abort flag, throws appropriate error if the abort flag is set
        void CheckAbortFlag() const;

        /** Set the abort flag to check in CheckAbortFlag
            @param new_abortflag New abort flag to check from now on
        */
        void SetAbortFlag(int32_t *new_abortflag);

        /*\@}*/

        /** \addtogroup Metadata */
        /*\@{*/

        /// Returns the current metadata of this transaction, readonly. ADDME: replace all by GetMetadataRef calls if possible
        const Metadata& GetMetadata() const
        { return *metadata; }

        /// Returns the reference to the current metadata
        MetadataManager::Ref const & GetMetadataRef() const
        { return metadata; }

        /** Retrieves a new object id, the returned id remains reserved and can safely be used
            by the transaction that requested it
            @return The next free object id
        */
        int32_t GetNewObjectId();

        /** Retrieves a new role id, the returned id remains reserved and can safely be used
            by the transaction that requested it
            @return The next free object id
        */
        int32_t GetNewRoleId();

        /** Get the next available column id for a table
            @param tabledef Table we need a column id for
            @return The next free column id #
        */
        int32_t GetNewColumnId(TableDef const &tabledef);

        /** Notifies the transaction that an SQL command has modified metatadata
            Used for determining whether the metadata should be re-read after
            commit
        */
        void NotifyMetadataModification() { is_metadata_modified = true; }

        /// Returns whether the metadata has been modified in this transaction
        bool IsMetadataModified();

        /** Notify metadata change of a column
            @param tabledef Table where the column resides in
            @param column Column that changed
            @param do_check True to execute consistency checks, false to remove from checking list
        */
        void NotifyMetaColumnChange(TableId table, ColumnId columnid, bool do_check);

        /// Returns the list of all changed columns in the metadata
        inline MetaColumnsChanges const & GetMetaChangedColumns() { return metacolumnschanges; }

        /// Reports tablecreate, to avoid making sql-command things friends.
        inline void ReportTableCreate(TableId table) { local_modifications.ReportTableCreate(table); }

        /// Reports tabledrop, to avoid making sql-command things friends.
        inline void ReportTableDrop(TableId table) { local_modifications.ReportTableDrop(table); }

        /** Refresh metadata with the updates done in local transaction
            @param allow_grant_inconsisencies When true, no errors will be thrown if inconsistencies have been detected
                in the metadata (the metadata then keeps a list of changes of needed cascades)
        */
        void RefreshMetadata(bool allow_grant_inconsistencies);

        /*\@}*/

        /** \addtogroup Blobs */
        /*\@{*/

        /** Stores a blob, returns its id
            @param numbytes Length of the blob
            @param infile Stream with the source for the blob
            @return Id of the newly stored blob
        */
        BlobId StoreBlob(Blex::FileOffset numbytes, Blex::Stream &infile)
        {
                return blobuser.StoreBlob(numbytes, infile, 0);
        }

        /** Prepare to receive a blob
            @param outfile Stream to send the blob to
            @return Returns id of the newly created blob
        */
        BlobId StartUploadBlob(std::unique_ptr<Blex::Stream> *outfile)
        {
                return blobuser.StartUploadBlob(outfile, 0);
        }

        /*\@}*/

        /** \addtogroup Privileges */
        /*\@{*/

        /** Returns whether a privilege on an object is in the set of 'current privileges' (SQL/99-2:376 10.5/11)
            @param id Id of object to check for
            @param priv Privilege to check
            @returns Whether the privilege @priv on object @a id is in the set of current privileges
        */
        bool HasPrivilege(ObjectId id, Privilege::_type priv);

        /** Returns whether a privilege on any column of table is in the set of 'current privileges' (not recursive!)
            @param parent Id of object chose children to check (both the object and children are checked, as privileges themselves recurse)
            @param priv Privilege to check
            @returns Whether the privilege @priv on object @a id is in the set of current privileges
        */
        bool HasPrivilegeOnAnyColumn(TableId id, Privilege::_type priv);

        /** Returns whether a role is in the set of 'enabled roles' (SQL-99-2:376 10.5/7)
            CODE: returns if role is current_user_role, one of the extra added roles, or any of their applicable roles
            @param role Role to check
            @return Returns whether role @a role is in the set of enabled roles
        */
        bool IsRoleEnabled(RoleId role);

        /** Returns whether we are allowed to grant a role (current_user_role and all applicable roles with grant option)
            @param role Role to check
            @return Whether (with the current privileges) it is allowed to grant this role.
        */
        bool IsRoleGrantable(RoleId role);

        /** Drops all roles for this view (do call addbaserole if you still want to use the view, otherwise you don't have any rights) */
        void ClearRoles();

        /** Adds a base role for this transaction (cannot be granted or granted privileges from - FIXME: Is this right?!!). Throws if role does not exist.
            @param id Base role to add
        */
        void AddBaseRole(RoleId id);

        /** Get all base roles */
        RoleIds const & GetBaseRoleList() const { return base_roles; }

        /** Get enabled roles */
        RoleIds const & GetEnabledRoleList() const { return enabled_roles; }

        /*\@}*/

        /** \addtogroup RecordOverrides */
        /*\@{*/

        /** Returns the current record override for a specific record
            @param tableid Table in thich the record resides
            @param recordid Id of the record
            @return Returns the current record override for this record
        */
        RecordOverride::_type GetRecordOverride(TableId tableid, RecordId recordid);

        /** Sets a new record override for the a record override
            @param tableid Table in thich the record resides
            @param recordid Id of the record
            @param new_override New override to set
        */
        void SetRecordOverride(TableId tableid, RecordId recordid, RecordOverride::_type new_override);

        /** Finish the current command: makes all modifications done until the previous FinishCommand visible.
            (by modifying the record overrides)
        */
        void FinishCommand();

        /*\@}*/

        /** Executes a SQL command, returns resultset. The command is ignored if the
            transaction is not in 'normal' state.
            @param cmd Command to execute
            @param storage Temprresultset that is filled with optionally returned results
            @param conncontrol Connection control object, for modification of parameters in connection
            @return True if metadata has been modified
        */
        bool DoSQLCommand(std::string const &cmd, TempResultSet *storage, ConnectionControl *conncontrol);

        /** Get a new seq# from an auto sequencer. The internal counter is
            increased whether or not the seq# is used, so any returned seq#
            remains reserved and can be safely used by the transaction that
            requested it.
            @param tabledef Table we need a seq# for
            @param columndef Autonumbered column we need a seq# for
            @return The next free seq# */
        int32_t GetAutonumberKey(TableDef const &tabledef, ColumnDef const &columndef);

        /** Creates a new record. Record will not be visible until FinishCommand is called!
            @param table Table containing the record
            @param recid ID of the record to update, or 0 for a new record
            @param updates Record containing the columns we wish to update
            @param no_priv_checks Disable privilege checking
            @param no_access_checks Disable access manager checking (used by SetDefault Delete)
            @return Returns whether record was inserted (if not, then the new record is a dummy of the updated record)
                When a dummy update is detected, the old record will not be unexpired. */
        void InsertRecord(TableDef const &table, Record const &new_record, bool no_priv_checks, bool no_access_checks);

        /// Returns the consistency manager for this transaction
        ConsistencyManager & GetConsistencyManager() { return consmgr; }

        /// Returns a list with all the modifications done by this transaction
        LocalModifications const & GetModifications() const { return local_modifications; }

        /** Sync transactions changes to disk */
        bool Sync();

        /// Return data structure for commit data
        inline ConsistencyManager::CheckData & GetCommitCheckdata() { return commit_checkdata; }

        /// Return a pointer to the index system
        Index::System* GetIndexSystem() { return backend.GetIndexSystem(); }

        /// Return the identified trans for this transaction
        IdentifiedTrans const & GetIdentifiedTrans() const { return identified_trans; }

        /// Notify the identifies trans that a write is going to take place
        void PrepareForWrite() { identified_trans.PrepareForWrite(); }

        inline void SetStage(const char *stage) { backend.SetTransactionInfoTransStage(this, stage); }

        ///Mutex for serializing access by notification scanners (ADDME: ugly)
        Blex::Mutex notification_mutex;

        /// Contextkeeper for this transaction (for extensions to store their data in)
        Blex::ContextKeeper transcontextkeeper;

        //The database itself
        Backend &backend;

    private:

        ///Consistency manager for pre-commit checks
        ConsistencyManager consmgr;

        ///allows us to use the Transaction Log, and to get an ID (ADDME make this member private)
        IdentifiedTrans identified_trans;

        /// Invalidates and reinitializes privilege cache, needed after every grant/revoke.
        void RebuildPrivilegeCache();

        /** Calculates 'applicable roles' of a set of source roles (see SQL/99-2:376 10.5/3). source_roles and closure may be the same vector.
            @param source_roles Set of roles to calculate the applicable roles for
            @param closure List of roles to which the applicable roles are added */
        void CalculateApplicableRoles(std::vector< RoleId > const &source_roles, std::vector< RoleId > *applicable_roles);

        /// Rebuild list of 'enabled roles' (see SQL/99-2:376 10.5/7)
        void CalculateEnabledRoles();

        /** Calculates the 'current privileges' for a specific object (see SQL/99-2:376 10.5/11)
            @param objdef Definition of object where the current privileges must be retrieved for
            @param desc Descriptor which will be filled with the current privileges for object @a id
        */
        void CalculateCurrentPrivilegesFor(ObjectDef const &objdef, PrivilegeDescriptor &desc);

        /** Gets the 'current privileges' for a specific object (see SQL/99-2:376 10.5/11) through the cache, calculates them if necessary.
            @param id Id of object where the current privileges must be retrieved for
            @param desc Descriptor which will be filled with the current privileges for object @a id
        */
        PrivilegeDescriptor const & GetCurrentPrivilegesFor(ObjectDef const &objdef);

        /** Updates a record with updates
            @param table Definition of table that contains updated record
            @param oldrecordid Id of record that is updated
            @param oldrecord Contents of record that is updated
            @param updates Record containing updated cells
            @param no_priv_checks Skip privilege checks if true
            @param no_access_checks Skip access manager checks if true
            @param modified_columns If not 0, returns id's of updated columns
            @return Pair with as first whether the new record is different from the old one, and second id of new record (0 if no record was written, usually when table has been deleted)
        */
        std::pair<bool, RecordId> UpdateRecord(TableDef const &table, RecordId oldrecordid, Record const &oldrecord, Record const &updates, bool no_priv_checks, bool no_access_checks, std::vector< ColumnId > *modified_columns);


        void HandleDeletedRecord(TableDef const &tabledef, std::set<RecordId> const &records);
        void CascadeDelete(TableDef const &keytabledef, TableDef const &reftabledef, ColumnDef const &reftablecol, std::set<RecordId> const &records);
        void CascadeDeletes(TableDef const &referred_table, std::set<RecordId> const &records);
        void SetToDefault(TableDef const &keytabledef, TableDef const &reftabledef, ColumnDef const &reftablecol, std::set<RecordId> const &records);
        void SetToDefaults(TableDef const &referred_table, std::set<RecordId> const &records);

        void IntegrateCommandModifications();

        void DisposeRecordLock(TableId table, RecordId record);

        std::pair<bool, RecordId> TryExpireRecord(TableId tableid, RecordId recblock, bool must_signal, bool register_waits)
        {
                return backend.TryExpireRecord(identified_trans, tableid, recblock, commits, must_signal, register_waits);
        }
        void UnexpireRecord(TableId tableid, RecordId recblock)
        {
                return backend.UnexpireRecord(identified_trans, tableid, recblock, commits);
        }
        RecordId FindAfterCommitVersion(TableId tableid, RecordId recblock)
        {
                return backend.FindAfterCommitVersion(identified_trans, tableid, recblock);
        }

        typedef std::map< std::pair< TableId, RecordId >, RecordOverride::_type > RecordOverrides;

        MetaColumnsChanges metacolumnschanges;

        ///Global locker
        DatabaseLocker locker;

        ///Blob user (tracks created/uploaded blobs)
        BlobUser blobuser;

        MetadataManager::Ref metadata;

        bool is_metadata_modified;

        ///Has this transaction been committed
        bool is_committed;

        // FIXME: make more general parameter changing system
    public:
        // Cascade deletes (only used in recovery mode)
        bool cascade_deletes;

        /// True if this transaction may be timed out
        bool may_time_out;

        /// Clustering updates
        bool clustering_updates;

        /// Is a backup transaction (use different I/O strategies)
        bool is_backup_transaction;

    private:
        // Whether to do access manager callbacks (only false in recovery mode)
        bool do_accessmsg_checks;

        /// State of this transaction (normal, readonly, readonlyafter error)
        TransactionState::Type state;

        /// Record overrides of previous commands
        RecordOverrides overrides;
        /// Record overrides of the current command
        RecordOverrides new_overrides;

        LocalModifications local_modifications;

//        /// A view pointer
//        typedef std::shared_ptr< B> ViewPtr;
//        typedef std::vector<ViewPtr> Views;
//        /// All known views
//        Views views;

        Blex::SectionUpdateHistory commits;

        /// Scratch record for delete handling
        WritableRecord general_scratch_record;

        /// Flag to indicate abortion. Is written-to asynchronously.
        int32_t *abortflag;

        /// Structure for storage of pre-commit action data.
        ConsistencyManager::CheckData commit_checkdata;

        /** List of base roles (typically by access rules and login) */
        RoleIds base_roles;

        /** List of 'enabled roles', the current_roles together with their
            applicable roles. This list is sorted. */
        RoleIds enabled_roles;

        /// Cache of object grants
        std::map< ObjectId, PrivilegeDescriptor > object_grants;

        /// Scratch record for updaterecord
        WritableRecord updaterecord_scratch_record;

        /// Scratch list for updaterecord
        std::vector< ColumnId > modified_columns;

        /// RecordId of last written record per table (for clustering updates)
        std::map< ObjectId, RecordId > last_written_record;

        friend class Backend; // FIXME: only fiend to access idenitified trans to commit
        friend class Scanner; // Friend for hidden UpdateRecord and local_modifications
        friend class BackendTransactionRef; // For accessing backend

        BackendTransaction(BackendTransaction const &) = delete;
        BackendTransaction& operator=(BackendTransaction const &) = delete;
};


} //end namespace Database

namespace Blex
{
template <> void AppendAnyToString(Database::TransStateMgr::TransStatus const &in, std::string *appended_string);
}

#endif
