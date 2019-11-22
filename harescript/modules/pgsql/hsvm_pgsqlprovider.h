#ifndef blex_webhare_harescriptvm_hsvm_pgsqlprovider
#define blex_webhare_harescriptvm_hsvm_pgsqlprovider
//---------------------------------------------------------------------------

#define PGSQL_DEBUG //enable to define debugprints

#if defined(PGSQL_DEBUG) && defined(DEBUG)
#define PG_PRINT(x) DEBUGPRINT(x)
#else
#define PG_PRINT(x)
#endif

#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_dllinterface.h>

#include <libpq-fe.h>

namespace HareScript
{
namespace SQLLib
{
namespace PGSQL
{

struct PGPtrDeleter
{
        inline void operator()(PGconn *conn) { PQfinish(conn); }
        inline void operator()(PGresult *conn) { PQclear(conn); }
};

template < class T > using PGPtr = std::unique_ptr< T, PGPtrDeleter >;


/** PostgreSQL query data storage */
class Query;
class QueryData;
struct ParamsEncoder;

/** PostgreSQL transaction object */
class PGSQLTransactionDriver : public DatabaseTransactionDriverInterface
{
    private:
        typedef IdMapStorage< QueryData > QueryStorage;

        struct PreparedStatement
        {
                PreparedStatement() : use(0) {}
                PreparedStatement(PreparedStatement const &rhs) = default;
                PreparedStatement(PreparedStatement &&rhs) = default;

                unsigned use;
                std::string name;
                std::string querystr;
        };

        /// PostgreSQL database connection
        PGconn *conn;

        /// List of active queries
        QueryStorage queries;

        /// List of prepared statements
        std::map< std::string, PreparedStatement > prepared_statements;

        /// Counter for name generation
        uint64_t prepared_statements_counter;

        void ScanTypes();
        bool BuildQueryString(QueryData &querydata, DatabaseQuery &query, DatabaseTransactionDriverInterface::CursorType);

        std::string_view ReadResultCell(PGPtr< PGresult > &resultset, unsigned row, unsigned col);
        int32_t ReadResultCellInt(PGPtr< PGresult > &resultset, unsigned row, unsigned col);

        PGPtr< PGresult > ExecQuery(Query &query, bool asyncresult);
        bool CheckResultStatus(PGPtr< PGresult > const &res);
        std::pair< PGPtr< PGresult >, bool > GetLastResult();

        void GetErrorField(VarId id_set, ColumnNameId col, const PGresult *res, int fieldcode);
        static void NoticeReceiverCallback(void *arg, const PGresult *res);
        bool HandleMessage(const PGresult *res);
        void ExecuteInsertInternal(DatabaseQuery const &query, VarId newrecord, bool isarray);

    public:
        /// Initializes ODBC transaction
        PGSQLTransactionDriver(HSVM *vm, PGconn *conn, std::string const &_blobfolder);
        ~PGSQLTransactionDriver();

        virtual void ExecuteInsert(DatabaseQuery const &query, VarId newrecord);
        virtual void ExecuteInserts(DatabaseQuery const &query, VarId newrecord);
        virtual CursorId OpenCursor(DatabaseQuery &query, CursorType cursortype);
        virtual unsigned RetrieveNextBlock(CursorId id, VarId recarr);
        virtual void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< unsigned > const &rowlist, bool is_last_fase2_req_for_block);
        virtual LockResult LockRow(CursorId id, VarId recarr, unsigned row);
        virtual void UnlockRow(CursorId id, unsigned row);
        virtual void DeleteRecord(CursorId id, unsigned row);
        virtual void UpdateRecord(CursorId id, unsigned row, VarId newfields);
        virtual void CloseCursor(CursorId id);

        void ExecuteSimpleQuery(VarId id_set, std::string const &query, VarId params, VarId encodings, bool astext);

        std::string GetBlobDiskpath(int64_t blobid);

        std::pair< ConnStatusType, PGTransactionStatusType > GetStatus();

        bool isworkopen;
        int32_t webhare_blob_oid;
        std::string blobfolder;
        bool allowwriteerrordelay;

        friend struct ParamsEncoder;
};


struct PGSQLConn
{
        PGconn *conn;

        PGSQLConn();
        ~PGSQLConn();
};

/** Global ODBC data, per VM */
struct PGSQLProviderContextData
{
        PGSQLProviderContextData();
        ~PGSQLProviderContextData();

        typedef IdMapStorage< std::shared_ptr< PGSQLConn > > ConnStorage;

        /// List of connections
        ConnStorage conns;
};

const unsigned PGSQLProviderContextId = 23;

} // End of namespace PGSQL
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif // blex_webhare_harescriptvm_hsvm_pgsqlprovider
