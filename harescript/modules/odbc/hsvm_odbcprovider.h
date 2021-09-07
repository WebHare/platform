#ifndef blex_webhare_harescriptvm_hsvm_odbcprovider
#define blex_webhare_harescriptvm_hsvm_odbcprovider
//---------------------------------------------------------------------------

#define ODBCDEBUG //enable to define debugprints

#if defined(ODBCDEBUG) && defined(DEBUG)
#define ODBCDEBUGPRINT(x) DEBUGPRINT(x)
#else
#define ODBCDEBUGPRINT(x)
#endif


#include <sql.h>
#include <sqlext.h>
#include <sqlucode.h>
#include <harescript/vm/hsvm_sqllib.h>
#include "odbc_base.h"
#include "odbc_binder.h"
#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_dllinterface.h>

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

class ODBCTransactionDriver;

/** Global ODBC data, per VM */
struct ODBCProviderContextData
{
        SQLHENV henv;

        std::set<ODBCTransactionDriver *> translist;

        ODBCProviderContextData();
        ~ODBCProviderContextData();
};

const unsigned ODBCProviderContextId = 4;
/// Maximum number of rows fetched
const unsigned maxrowsfetched = 8;

/** ODBC query data storage */
struct ODBCQueryData
{
        VirtualMachine *vm;
        SQLHSTMT query_handle;
//        SQLHSTMT update_handle;

        ResultSet resultset;

        /// Row status array
//        std::string cursorname;
        std::string primary_table;

        bool finished;
        unsigned tablecount;

        unsigned fase1colcount;
        unsigned fase2colcount;

        /// Decription of a column in the resultset
        struct ResultColumn
        {
                /// Type expected by Harescript
                VariableTypes::Type hs_type;

                /// A name (FIXME: what name???)
                ColumnNameId nameid;

                /// Table-nr which this column belongs to
                unsigned tablenr;

                /// Nr of column in column yypeinfo
                unsigned columnnr;

                /// Type of binding that is needed for this column
                BindType::Type bindtype;

                /// Fase in which this column is needed
                unsigned fase;

                /// Indicates whether this column is updated
                bool is_updated;

                inline ResultColumn(
                        VariableTypes::Type _type,
                        ColumnNameId _nameid,
                        unsigned _tablenr,
                        unsigned _columnnr,
                        unsigned _fase,
                        BindType::Type _bindtype,
                        bool _is_updated) : hs_type(_type), nameid(_nameid), tablenr(_tablenr), columnnr(_columnnr), bindtype(_bindtype), fase(_fase), is_updated(_is_updated) {}

                bool operator <(ResultColumn const &rhs) const;
        };
        typedef std::vector< ResultColumn > ResultColumns;
        ResultColumns result_columns;

        typedef std::map< std::string, std::pair< VariableTypes::Type, signed > > UpdateColumns;
        UpdateColumns updatecolumns;
        std::map< ColumnNameId, signed > updatenamemap;

        void TerminateQuery();

        ODBCQueryData(VirtualMachine *vm, Capabilities const &capabilities, Blex::Charsets::Charset charset, ODBCWorkarounds::_type _workarounds);
        ~ODBCQueryData();
};

/// Cursor types, in order of increasing cost of use

/** ODBC transaction object */
class ODBCTransactionDriver : public DatabaseTransactionDriverInterface
{
    private:
        typedef IdMapStorage<ODBCQueryData> QueryStorage;

        /// List of queries
        QueryStorage queries;

        /// Virtual machine for this transaction
        HSVM *hsvm;

    public:

        /// SQL connection handle
        SQLHDBC hdbc;

        Blex::Charsets::Charset charset;

        ODBCWorkarounds::_type workarounds;

    private:
        /** Builds the query-string for a specified query
            @param querydate ODBC query data structure
            @param query Harescript query definition
            @param tc_list TCTypeMap containing all fase1 columns
            @param tc_list2 TCTypeMap containing all fase2 columns
            @param cursortype Type of query (SELECT, DELETE, UPDATE) */
        void BuildQueryString(ODBCQueryData &querydata, DatabaseQuery &query, std::vector< std::pair< VariableTypes::Type, VarId > > &params, DatabaseTransactionDriverInterface::CursorType cursortype, Blex::UTF16String *store);

        /** Executes a select/update/delete query (without going over the result-set
            @param querydate ODBC query data structure
            @param query Harescript query definition
            @param cursortype Type of query (SELECT, DELETE, UPDATE) */
        void ConstructQuery(ODBCQueryData &querydata, DatabaseQuery &query, CursorType cursortype);

    public:
        /// Initializes ODBC transaction
        ODBCTransactionDriver(HSVM *vm, SQLHDBC hdbc);
        ~ODBCTransactionDriver();

        CursorId OpenCursor(DatabaseQuery &query, CursorType cursortype);
        void CloseCursor(CursorId id);

        unsigned RetrieveNextBlock(CursorId id, VarId recarr);
        void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< Fase2RetrieveRow > &rowlist, bool is_last_fase2_req_for_block);

        LockResult LockRow(CursorId /*id*/, VarId /*recarr*/, unsigned /*row*/) { return LockResult::Removed; }
        void UnlockRow(CursorId /*id*/, unsigned /*row*/) {}
        void DeleteRecord(CursorId id, unsigned row);
        void UpdateRecord(CursorId id, unsigned row, VarId newfields);

        void ExecuteInsert(DatabaseQuery const &query, VarId newrecord);

        void Commit();
        void Rollback();

        // Extra stuff
        Capabilities capabilities;

        /// Returns list of tables in id_set
        void GetTables(VarId id_set);

        /// Returns list of columns in the specified table in id_set
        void GetColumns(VarId id_set, Blex::UTF16String const &schema, Blex::UTF16String const &table);
};

/// Returns a string with driver-info
std::string GetDriverInfo(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType);

/** Returns a record array with a list of data sources
    @param vm Virtual Machine
    @param context ODBC context
    @param id_set Variable to return the record array in
    @param sources_type Type of sources to return (0: all, 1: user, 2:system) */
void GetDataSources(HareScript::VirtualMachine &vm, ODBCProviderContextData &context, HareScript::VarId id_set, int32_t sources_type, Blex::Charsets::Charset charset);

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
