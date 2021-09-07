#ifndef blex_webhare_harescriptvm_hsvm_webharedbprovider
#define blex_webhare_harescriptvm_hsvm_webharedbprovider
//---------------------------------------------------------------------------
#include <ap/libwebhare/whcore.h>
#include <ap/libwebhare/dbase_client.h>

#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>
#include <harescript/vm/hsvm_environment.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/hsvm_context.h>

namespace HareScript
{
namespace SQLLib
{
namespace WHDB
{

class Connection;
class WebHareDBTransaction;

// Synchronize with wh::generatewhdbdefs.hslib and wh::whdbtables.hslib!
namespace DBError
{
enum Type
{
        UniqueError             = 0x01,         // violated UNIQUE constraint for TABLE.COLUMN
        ReferenceError          = 0x02,         // violated REFERENCES xxx constraint for TABLE.COLUMN
        AccessError             = 0x03,         // no rights to access TABLE.COLUMN
        NotNullError            = 0x04,         // violated NOT NULL constraint for TABLE.COLUMN
        OtherError              = 0x05,         // Other error
        DeadlockError           = 0x06          // transaction would cause deadlock
};
}

/** Class describing an (non-fatal) error from the database
*/
struct DBRuntimeError
{
        DBError::Type code;

        std::string table;
        std::string column;

        std::string message;

        DBRuntimeError(
                DBError::Type code,
                std::string const &message,
                std::string const &table = std::string(),
                std::string const &column = std::string());
};
typedef std::vector< DBRuntimeError > DBRuntimeErrors;

class DirectCursorQuery;

/** This class describes a query on the database
*/
struct SQLQueryData
{
        DatabaseTransactionDriverInterface::CursorType cursortype;

        /** Copy of database query, only valid when querytype != SELECT */
        DatabaseQuery query;

        /** Translation from columnnameid to columnnr (only filled for first table!) */
        std::map< ColumnNameId, Database::ColumnId > update_trans;

        struct Column
        {
                Column(unsigned _tableidx, std::string const &_dbase_name, ColumnNameId _hs_nameid, Database::ColumnTypes _type, Fases::_type _fases) : tableidx(_tableidx), dbase_name(_dbase_name), hs_nameid(_hs_nameid), type(_type), fases(_fases) {}

                unsigned tableidx;

                std::string dbase_name;

                ColumnNameId hs_nameid;

                Database::ColumnTypes type;

                Fases::_type fases;
        };

        typedef std::vector< std::pair< unsigned, unsigned > > TableData; // begin, end
        std::vector< Column > columns;
        TableData tabledata;

        std::vector<Database::TableInfo const *> sources;

        // VM that owns this transaction
        VirtualMachine *vm;

        std::shared_ptr< Database::RawScanIterator > scan;
        bool scan_used;
};

/** Data needed to support restorateion of a timed-out auto-transaction */
struct RestoreData
{
        inline RestoreData() : readonly(true), is_auto(false) {}

        std::string username;
        std::string password;
        std::string clientname;
        bool readonly;
        bool is_auto;
};

/** The WebHareTransaction class represents a transaction in the webhare database.
*/
class WebHareDBTransaction : public DatabaseTransactionDriverInterface
{
    public:
        /** Construct a transaction
            @param conn Database connection
            @param trans Database transaction frontend
        */
        WebHareDBTransaction(Connection *conn, std::unique_ptr< Database::TransFrontend > &trans);

        /// Destructor
        ~WebHareDBTransaction();

        /** Overwrites the current virtual machine
        */
        void SetVirtualMachine(VirtualMachine *vm);

        /** Returns the raw database transaction object
        */
        inline Database::TransFrontend & GetDBTrans() { return *dbase_trans; }

        /** Processes database error. Adds to errors list if it must be cached, otherwise it translates
            to a VMRuntimeError that is thrown
            @param e Caught datbase exception
        */
        void TranslateException(Database::Exception const &e);

        /** Returns whether any errors were cached by TranslateException. Equivalent to !GetErrors().empty()
        */
        bool AnyErrors() const
        {
                return !errors.empty();
        }

        /** Clear all errors
        */
        void ClearErrors()
        {
                errors.clear();
        }

        /** Returns the list of errors cached by TranslateException
        */
        DBRuntimeErrors const & GetErrors() const { return errors; }

        bool Finish(bool commit);

        static void Unregister(SQLSupport &sqlsupport, WebHareDBTransaction *trans);

        void ExecuteInsert(DatabaseQuery const &query, VarId newrecord);

        CursorId OpenCursor(DatabaseQuery &query, CursorType cursortype);
        void CloseCursor(CursorId id);

        Database::SQLResultScanner* SQL(std::string const &command);

        int32_t GetTableId(std::string const &tablename);

        int32_t InsertAutoNumber(std::string const &tablename, std::string const &columnname);

        unsigned RetrieveNextBlock(CursorId id, VarId recarr);
        void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< Fase2RetrieveRow > &rowlist, bool allow_direct_close);
        LockResult LockRow(CursorId id, VarId recarr, unsigned row);
        void UnlockRow(CursorId id, unsigned row);
        void DeleteRecord(CursorId id, unsigned row);
        void UpdateRecord(CursorId id, unsigned row, VarId newfields);

//        static void DestroyEntireTransaction(SQLSupport &sqlsupport, WebHareDBTransaction *trans);

        /// Connection over which this transaction runs
        Connection *whdbconn;

        RestoreData restoredata;
        void ReconnectDBTransaction(Connection *new_conn);

    private:
        std::string GetClientNamePostfix(Database::Exception const *e);

        enum Fase
        {
                Fase1 = 1,
                Fase2 = 2,
                Extra = 4
        };

        typedef IdMapStorage< SQLQueryData > QueryStorage;
        QueryStorage queries;

        void BuildResultRow(SQLQueryData &query, DatabaseQuery const &dbquery);

//        void InitDescription();

        /** Locks the next record in the cursor, advances it if neccesary (also
            rechecks conditions
            @param querydata Data structure identifying cursoring query
            @param clear Set to true if the read record must be reinitalized before filling
            @return FALSE if end of query reached, TRUE if current record is locked */
        void InternalTranslateRecord(SQLQueryData &querydata, Database::Record rec, unsigned tableindex, VarId storageloc, Fase fase, bool clear);

        /** Fills a writable record with the contents of a HareScript record
            @param vm Virtual Machine object
            @param querydata Data structure identifying query
            @param dbrec Database record to fill
            @param hsrec Harescript record to get data from
            @return name of table where this record belongs */
        void FillUpdateRecord(SQLQueryData const &querydata, Database::WritableRecord &dbrec, VarId hsrec);

        /** Fills a writable record with the contents of a HareScript record, for an insert
            @param querydata Data structure identifying query
            @param dbrec Database record to fill
            @param hsrec Harescript record to get data from
            @param columns Outputs list of column names
            @return TableInfo of the table where this record belongs */
        Database::TableInfo const * FillInsertRecord(DatabaseQuery const &query, Database::WritableRecord &dbrec, VarId hsrec, std::vector< Database::ClientColumnInfo const * > *columns);

        Database::SQLResultScanner* ExecuteClientSet(const char *command, const char *command_end);
        Database::SQLResultScanner* ExecuteLocalSet(const char *command, const char *command_end);

        /// Databse transaction we're associated with
        std::unique_ptr< Database::TransFrontend > dbase_trans;

        /// List of cached errors
        DBRuntimeErrors errors;

        /// Local parameters (SET CLIENT ... stuff)
        std::map< std::string, std::string > parameters;

    public:
        friend class WHDBBlobData;
        friend class DirectCursorQuery;
};

void Register(Environment &env);
void InitializeContext(VirtualMachine *vm, Database::TCPFrontend *connection);

/** Converts a DatabaseTransactionDriverInterface * to a WebhareDBTransactionDriver *, if applicable.
    @param Pointer to whdb driver (0 if not applicable) */
WHDB::WebHareDBTransaction * IsWHDBTransaction(VirtualMachine *vm, DatabaseTransactionDriverInterface *trans);

/** Set a default name for clients */
void BLEXLIB_PUBLIC SetWHDBProviderDefaultClientName(HSVM *vm, std::string const &name);

} // End of namespace WHDB
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
