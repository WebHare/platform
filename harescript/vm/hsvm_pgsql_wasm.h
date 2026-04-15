#ifndef blex_webhare_harescriptvm_hsvm_wasmpgsqlprovider
#define blex_webhare_harescriptvm_hsvm_wasmpgsqlprovider
//---------------------------------------------------------------------------

#include "hsvm_pgsql_base.h"
#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_dllinterface.h>

namespace HareScript
{
namespace SQLLib
{
namespace PGSQL
{

class WasmQueryResult;


/** PostgreSQL transaction object */
class PGSQLWasmTransactionDriver : public PGSQLTransactionDriverBase
{
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

        /// List of prepared statements
        std::map< std::string, PreparedStatement > prepared_statements;

        /// Counter for name generation
        uint64_t prepared_statements_counter;

        void PrepareForQuery();
        std::unique_ptr< QueryResult > ExecQuery(Query &query, bool asyncresult);
        bool CheckResultStatus(std::unique_ptr< QueryResult > const &res);
        std::unique_ptr< QueryResult > WaitForResult();
        std::pair< std::unique_ptr< QueryResult >, bool > GetLastResult();

    public:
        /// Initializes PG transaction
        PGSQLWasmTransactionDriver(HSVM *vm, Options const &options);
        ~PGSQLWasmTransactionDriver();

        bool IsWorkOpen();
        void SetWorkOpen(bool open);
        void AwaitPendingQueries();
};

} // End of namespace PGSQL
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif // blex_webhare_harescriptvm_hsvm_pgsqlprovider
