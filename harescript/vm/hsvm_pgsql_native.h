#ifndef blex_webhare_harescriptvm_hsvm_pgsqlprovider
#define blex_webhare_harescriptvm_hsvm_pgsqlprovider
//---------------------------------------------------------------------------

#include "hsvm_pgsql_base.h"

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
        inline void operator()(PGresult *result) { PQclear(result); }
        inline void operator()(PGcancel *cancel) { PQfreeCancel(cancel); }
};

template < class T > using PGPtr = std::unique_ptr< T, PGPtrDeleter >;

class CNativeQueryResult: public QueryResult {
    private:
        PGresult const *cresult;
    public:
        CNativeQueryResult(PGresult const *_cresult)
        : cresult(_cresult)
        {
        }

        virtual ~CNativeQueryResult();

        int GetResultStatus() const;

        virtual std::vector< QueryResultField > GetResultFields() const;
        virtual std::string GetErrorField(PG_DIAG_CODE fieldcode) const;
        virtual uint32_t GetRowCount() const;
        virtual QueryResultValue GetValue(uint32_t rowid, uint32_t colid);
        virtual std::string GetErrorMessage() const;
        virtual std::string GetVerboseErrorMessage() const;
        virtual bool HasError() const;
        virtual std::string GetCmd();
        virtual unsigned GetCmdTuples();

};

class NativeQueryResult: public CNativeQueryResult {
    private:
        PGPtr< PGresult > result;
    public:
        NativeQueryResult(PGPtr< PGresult > &&_result)
        : CNativeQueryResult(_result.get()), result(std::move(_result))
        {
        }

        virtual ~NativeQueryResult();

        virtual std::string GetCmd();
        virtual unsigned GetCmdTuples();
};

/** PostgreSQL transaction object */
class PGSQLNativeTransactionDriver : public PGSQLTransactionDriverBase
{
    public:

    private:
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

        /// Cancellation structure
        PGPtr< PGcancel > cancel;

        /// List of prepared statements
        std::map< std::string, PreparedStatement > prepared_statements;

        /// Counter for name generation
        uint64_t prepared_statements_counter;

        static void NoticeReceiverCallback(void *arg, PGresult const *res);
        std::unique_ptr< QueryResult > ExecQuery(Query &query, bool asyncresult);
        bool CheckResultStatus(std::unique_ptr< NativeQueryResult > const &res);
        bool WaitForResult();
        std::pair< std::unique_ptr< QueryResult >, bool > GetLastResult();

    public:
        /// Initializes PG transaction
        PGSQLNativeTransactionDriver(HSVM *vm, PGconn *conn, Options const &options);
        ~PGSQLNativeTransactionDriver();

        std::pair< ConnStatusType, PGTransactionStatusType > GetStatus();

        int GetBackendPid();

        bool IsWorkOpen();
        void SetWorkOpen(bool open);

        bool isworkopen;
};


} // End of namespace PGSQL
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif // blex_webhare_harescriptvm_hsvm_pgsqlprovider
