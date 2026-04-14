#pragma GCC diagnostic ignored "-Wuninitialized"

//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_pgsql_native.h"
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/errors.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/baselibs.h>
#include <blex/unicode.h>
#include <string_view>
#include <optional>
#include <limits>
#include <iomanip>
#include <variant>
#include <poll.h>

#ifdef SHOW_PGSQL
 #define PQ_PRINT(x) DEBUGPRINT("PSQL: " << x)
 #define PQ_ONLY(x) DEBUGONLY(x)
 #define PQ_ONLYRAW(x) DEBUGONLYARG(x)
#else
 #define PQ_PRINT(x) BLEX_NOOP_STATEMENT
 #define PQ_ONLY(x) BLEX_NOOP_STATEMENT
 #define PQ_ONLYRAW(x)
#endif


/* This driver uses the binary representation for sending and receiving
   variables (for sending this can be chosen per-variable, but for results
   no fine-grained control is possible. Binary was chosen as no charset encoding
   problems arise there)

   The description for known OIDs can be found in
   https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat

   Examples for decoding them can be found in the libpqtypes library, can be
   found at: http://pgfoundry.org/projects/libpqtypes/
*/

namespace HareScript
{
namespace SQLLib
{
namespace PGSQL
{

using namespace std::literals::string_view_literals;


inline std::string HSVM_GetStringCell(HSVM *hsvm, HSVM_VariableId id_get, HSVM_ColumnId colid)
{
        HSVM_VariableId var = HSVM_RecordGetRef(hsvm, id_get, colid);
        if (!var || HSVM_GetType(hsvm, var) != HSVM_VAR_String)
            return "";
        return HSVM_StringGetSTD(hsvm, var);
}

PGSQLNativeTransactionDriver::PGSQLNativeTransactionDriver(HSVM *_vm, PGconn *_conn, PGSQLNativeTransactionDriver::Options const &options)
: PGSQLTransactionDriverBase(_vm, options)
, conn(_conn)
, prepared_statements_counter(0)
, isworkopen(false)
{
        PQsetNoticeReceiver(conn, &NoticeReceiverCallback, this);
        cancel.reset(PQgetCancel(conn));
}

PGSQLNativeTransactionDriver::~PGSQLNativeTransactionDriver()
{
        cancel.reset();
        PQfinish(conn);
}

std::pair< ConnStatusType, PGTransactionStatusType > PGSQLNativeTransactionDriver::GetStatus()
{
        return std::make_pair(PQstatus(conn), PQtransactionStatus(conn));
}

int PGSQLNativeTransactionDriver::GetBackendPid()
{
        return PQbackendPID(conn);
}

bool PGSQLNativeTransactionDriver::IsWorkOpen()
{
        return isworkopen;
}

void PGSQLNativeTransactionDriver::SetWorkOpen(bool open)
{
        isworkopen = open;
}

std::unique_ptr< QueryResult > PGSQLNativeTransactionDriver::ExecQuery(Query &query, bool asyncresult)
{
        query.params.Finalize();

#ifdef DUMP_BINARY_ENCODING
        PQ_ONLY(
                for (unsigned i = 0; i < query.params.types.size(); ++i)
                {
                        PQ_PRINT(" param " << i << ": type: " << query.params.types[i] << " len " << query.params.lengths[i] << " format " << query.params.formats[i] << " data: " << (query.params.dataptrs[i] ? "" : "nullptr"));
                        if (query.params.dataptrs[i] && query.params.lengths[i] > 0)
                                Blex::DumpPacket(query.params.lengths[i], query.params.dataptrs[i]);
                }
        );
#endif

        /* We can't send a query if the previous one is still in flight, so we need to
           retrieve the results first. Return immediately if an error was returned by
           that query
        */
        if (PGSQLNativeTransactionDriver::GetLastResult().second)
            return std::unique_ptr< QueryResult >();

        const bool fullstacktrace = false;
        std::vector< StackTraceElement > elements;

        std::string logprefix;
        if (logstacktraces > 0 || logcommands > 0)
        {
                logprefix = "/*whlog:t[";

                vm->GetStackTrace(&elements, true, fullstacktrace);

                int32_t eltcount = 0;
                for (auto itr: elements)
                {
                        if (eltcount == logstacktraces)
                             break;
                        if (eltcount++)
                            logprefix += ",";
                        logprefix += itr.filename + "#" + Blex::AnyToString(itr.position.line) + "#" + Blex::AnyToString(itr.position.column) + "(" + itr.func + ")";
                }
                logprefix += "]*/";
        }

        Blex::SHA1 sha1;
        sha1.Process(query.querystr.c_str(), query.querystr.size() + 1);
        if (query.params.types.size())
            sha1.Process(&query.params.types[0], query.params.types.size() * sizeof(query.params.types[0]));
        std::string hash = sha1.FinalizeHash().stl_str();

        PreparedStatement &prep = prepared_statements[hash];
        if (prep.use < 16 && (query.querystr.compare(0, 7, "SELECT "sv) == 0 || query.querystr.compare(0, 7, "INSERT "sv) == 0) && logprefix.empty())
        {
                if (++prep.use == 16)
                {
                        std::string name = "prep_" + Blex::AnyToString(++prepared_statements_counter);
                        PQ_PRINT("Preparing statement '" << name << "' for query " << query.querystr);
                        PGPtr< PGresult > res(PQprepare(
                                conn,
                                name.c_str(),
                                query.querystr.c_str(),
                                query.params.types.size(),
                                query.params.types.begin()));

                        if (res)
                        {
                                auto result = PQresultStatus(res.get());
                                if (result == PGRES_COMMAND_OK)
                                {
                                        PQ_PRINT("Prepare ok");
                                        prep.name = name;
                                        prep.querystr = query.querystr;
                                }
                                else
                                {
                                        PQ_PRINT("Prepare failed");
                                }
                        }
                }
        }

        if (logcommands != 0)
        {
                HSVM_OpenFunctionCall(*vm, 2);
                HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), sqllib_transid);

                VarId lastcommand = HSVM_CallParam(*vm, 1);
                HSVM_SetDefault(*vm, lastcommand, HSVM_VAR_Record);
                HSVM_VariableId var_query = HSVM_RecordCreate(*vm, lastcommand, HSVM_GetColumnId(*vm, "QUERY"));
                HSVM_StringSetSTD(*vm, var_query, query.querystr);
                HSVM_VariableId var_stacktrace = HSVM_RecordCreate(*vm, lastcommand, HSVM_GetColumnId(*vm, "STACKTRACE"));
                GetVMStackTraceFromElements(vm, var_stacktrace, elements, fullstacktrace);

                const HSVM_VariableType args[2] = { HSVM_VAR_Integer, HSVM_VAR_Record };
                int obj = HSVM_CallFunction(*vm, "wh::dbase/postgresql.whlib", "__HandleRunCommand", 0, 2, args);
                if (obj)
                    HSVM_CloseFunctionCall(*vm);
                else
                    return std::unique_ptr< QueryResult >();
        }

        int res = 0;
        if (!prep.name.empty() && logprefix.empty())
        {
                PQ_PRINT("Execute"<<(asyncresult?" async":"") << " prepared statement " << prep.name << ": " << prep.querystr);
                res = PQsendQueryPrepared(
                    conn,
                    prep.name.c_str(),
                    query.params.types.size(),
                    query.params.dataptrs.begin(),
                    query.params.lengths.begin(),
                    query.params.formats.begin(),
                    !query.astext);
        }
        else
        {
                PQ_PRINT("Execute"<<(asyncresult?" async":"") << " query: " << query.querystr);
                res = PQsendQueryParams(
                    conn,
                    logprefix.empty() ? query.querystr.c_str() : (logprefix + query.querystr).c_str(),
                    query.params.types.size(),
                    query.params.types.begin(),
                    query.params.dataptrs.begin(),
                    query.params.lengths.begin(),
                    query.params.formats.begin(),
                    !query.astext);
        }


        if (!res)
        {
                HSVM_ThrowException(*vm, ("Fatal error returned: " + std::string(PQerrorMessage(conn))).c_str());
                return std::unique_ptr< QueryResult >();
        }

        std::unique_ptr< QueryResult > retval;
        if (!asyncresult)
            retval = GetLastResult().first;

        return retval;
}

bool PGSQLNativeTransactionDriver::CheckResultStatus(std::unique_ptr< NativeQueryResult > const &res)
{
        if (!res)
        {
                HSVM_ThrowException(*vm, ("Fatal error returned: " + std::string(PQerrorMessage(conn))).c_str());
                return false;
        }

        // Clear the result when exiting this function
        auto result = res->GetResultStatus();

        switch (result)
        {
                case PGRES_EMPTY_QUERY:
                {
                        HSVM_ThrowException(*vm, "Empty query string");
                        return false;
                } break;
                case PGRES_COPY_OUT:
                case PGRES_COPY_IN:
                case PGRES_COPY_BOTH:
                {
                        HSVM_ThrowException(*vm, "COPY streaming is not supported");
                        return false;
                }
                case PGRES_BAD_RESPONSE:
                {
                        HSVM_ThrowException(*vm, "Bad response from the server");
                        return false;
                } break;
                case PGRES_FATAL_ERROR:
                {
                        PQ_PRINT("Got fatal error: " << res->GetErrorMessage());
                        if (HandleMessage(*res) && !vm->is_unwinding)
                            HSVM_ThrowException(*vm, ("Fatal error returned: " + res->GetErrorMessage()).c_str());
                        return !vm->is_unwinding;
                } break;
                case PGRES_NONFATAL_ERROR:
                {
                        PQ_PRINT("Got non-fatal error: " << res->GetErrorMessage());
                        if (HandleMessage(*res) && !vm->is_unwinding)
                            HSVM_ThrowException(*vm, ("Non-fatal error returned: " + res->GetErrorMessage()).c_str());
                        return !vm->is_unwinding;
                } break;
                case PGRES_COMMAND_OK:
                case PGRES_SINGLE_TUPLE:
                case PGRES_TUPLES_OK:
                {
                        if (PQstatus(conn) == CONNECTION_BAD)
                        {
                                HSVM_ThrowException(*vm, "The connection to the database isn't healthy anymore");
                                return false;
                        }
                } break;
                default:
                {
                        HSVM_ThrowException(*vm, "Unknown response code received");
                        return false;
                } break;
        }

        return true;
}

bool PGSQLNativeTransactionDriver::WaitForResult()
{
        if (HSVM_TestMustAbort(*vm))
            return false;

        int sock = PQsocket(conn);
        if (sock < 0)
            return true;

        // check shouldabort every 100ms
        int32_t counter = 0;
        while (true)
        {
                PQconsumeInput(conn);
                if (!PQisBusy(conn))
                    return true;

                pollfd input_fd;
                input_fd.fd = sock;
                input_fd.events = POLLERR | POLLIN;
                input_fd.revents = 0;

                // wait max 100ms
                int res = poll(&input_fd, 1, 100);
                if (res != 0)
                    return true;

                if (HSVM_TestMustAbort(*vm))
                {
                        char errbuf[256];
                        PQcancel(cancel.get(), errbuf, sizeof(errbuf));
                        return false;
                }

                if (counter >= command_timeout_secs * 10)
                {
                        char errbuf[256];
                        PQcancel(cancel.get(), errbuf, sizeof(errbuf));
                        HSVM_ThrowException(*vm, std::string("PostgreSQL command timeout after " + Blex::AnyToString(command_timeout_secs) + " seconds").c_str());
                        return false;
                }

                ++counter;
        }
}

std::pair< std::unique_ptr< QueryResult >, bool > PGSQLNativeTransactionDriver::GetLastResult()
{
        std::unique_ptr< NativeQueryResult > lastres;
        bool goterror = false;

        // Read results until the PQgetResult returns nullptr, return the last one
        while (true)
        {
                if (!WaitForResult())
                    return std::make_pair(std::unique_ptr< NativeQueryResult >(), true);

                PGPtr< PGresult > res(PQgetResult(conn));
                if (!res)
                    break;

                if (goterror)
                    continue;

                std::unique_ptr< NativeQueryResult > queryresult(new NativeQueryResult(std::move(res)));

                if (!CheckResultStatus(queryresult))
                {
                        goterror = true;
                        lastres.reset();
                }
                else
                    lastres = std::move(queryresult);
        }

        return std::make_pair(std::move(lastres), goterror);
}


void PGSQLNativeTransactionDriver::NoticeReceiverCallback(void *arg, const PGresult *res)
{
        NativeQueryResult queryresult(res);
        static_cast< PGSQLNativeTransactionDriver * >(arg)->HandleMessage(queryresult);
}

NativeQueryResult::~NativeQueryResult()
{
}

int NativeQueryResult::GetResultStatus() const
{
        return PQresultStatus(result);
}

std::vector< QueryResultField > NativeQueryResult::GetResultFields() const
{
        std::vector< QueryResultField > fields;
        int fieldcount = PQnfields(result);
        fields.reserve(fieldcount);
        for (int i = 0; i < fieldcount; ++i)
        {
                QueryResultField field;
                field.name = PQfname(result, i);
                field.formatcode = PQfformat(result, i);
                field.typemodifier = PQfmod(result, i);
                field.typeoid = static_cast< OID >(PQftype(result, i));
                fields.push_back(std::move(field));
        }
        return fields;

}

std::string NativeQueryResult::GetErrorField(PG_DIAG_CODE fieldcode) const
{
        const char *fielddata = PQresultErrorField(result, static_cast<char>(fieldcode));
        return fielddata ? std::string(fielddata) : std::string();
}

uint32_t NativeQueryResult::GetRowCount() const
{
        return PQntuples(result);
}

QueryResultValue NativeQueryResult::GetValue(uint32_t rowid, uint32_t colid)
{
        int len = PQgetlength(result, rowid, colid);
        char const *data = PQgetvalue(result, rowid, colid);
        bool isnull = PQgetisnull(result, rowid, colid);

        if (isnull)
            return QueryResultValue{ .data = nullptr, .length = 0, .isnull = true };

        return QueryResultValue{ .data = data, .length = len, .isnull = false };
}

std::string NativeQueryResult::GetErrorMessage() const
{
        return PQresultErrorMessage(result);
}

std::string NativeQueryResult::GetVerboseErrorMessage() const
{
        std::string retval;
        char *verbosemessage = PQresultVerboseErrorMessage(result, PQERRORS_VERBOSE, PQSHOW_CONTEXT_ALWAYS);
        retval = std::string(verbosemessage);
        PQfreemem(verbosemessage);
        return retval;
}

bool NativeQueryResult::HasError() const
{
        auto result = GetResultStatus();
        return result == PGRES_FATAL_ERROR || result == PGRES_NONFATAL_ERROR;
}

inline void HSVM_SetIntegerCell(HSVM *hsvm, HSVM_VariableId id_set, HSVM_ColumnId colid, int value)
{
        HSVM_VariableId var = HSVM_RecordCreate(hsvm, id_set, colid);
        HSVM_IntegerSet(hsvm, var, value);
}

void PGSQL_Connect(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_ColumnId col_name = HSVM_GetColumnId(hsvm, "NAME");
        HSVM_ColumnId col_value = HSVM_GetColumnId(hsvm, "VALUE");

        std::vector< std::string > strings;

        std::string blobfolder;
        int32_t logstacktraces = 0;

        PQ_PRINT("PGSQL_Connect");

        unsigned len = HSVM_ArrayLength(hsvm, HSVM_Arg(0));
        for (unsigned idx = 0; idx < len; ++idx)
        {
                HSVM_VariableId elt = HSVM_ArrayGetRef(hsvm, HSVM_Arg(0), idx);

                std::string name = HSVM_GetStringCell(hsvm, elt, col_name);
                std::string value = HSVM_GetStringCell(hsvm, elt, col_value);

                if (name.compare(0, 8, "webhare:"sv) == 0)
                {
                        PQ_PRINT(" wh-specific: " << name);
                        if (name == "webhare:blobfolder")
                            blobfolder = value;
                        else if (name == "webhare:logstacktraces")
                            logstacktraces = Blex::DecodeSignedNumber< int32_t >(value, 10);
                        else
                        {
                                HSVM_ThrowException(hsvm, ("Unknown webhare-specific parameter '" + name + "'").c_str());
                                return;
                        }
                        continue;
                }

                strings.push_back(name);
                strings.push_back(value);
        }

        if (len == 0)
        {
                HSVM_ThrowException(hsvm, "No parameters specified");
                return;
        }

        std::vector< const char * > params;
        std::vector< const char * > values;

        for (unsigned idx = 0; idx < strings.size() / 2; ++idx)
        {
                params.push_back(strings[idx * 2].c_str());
                values.push_back(strings[idx * 2 + 1].c_str());
        }

        params.push_back(nullptr);
        values.push_back(nullptr);

        PGconn *conn = PQconnectdbParams(&params[0], &values[0], true);

        if (PQstatus(conn) != CONNECTION_OK)
        {
                PGPtr< PGconn > connptr(conn);

                std::string errormessage = PQerrorMessage(conn);
                PQ_PRINT("Connection failed: " << errormessage);

                HSVM_ThrowException(hsvm, ("Connection failed: " + errormessage).c_str());
                return;
        }

        auto options = PGSQLNativeTransactionDriver::Options(); // value-initialize the options
        options.blobfolder = blobfolder;
        options.logstacktraces = logstacktraces;

        std::unique_ptr< PGSQLNativeTransactionDriver > driver(new PGSQLNativeTransactionDriver(hsvm, conn, options));
        int pid = driver->GetBackendPid();
        int32_t trans_id = GetVirtualMachine(hsvm)->GetSQLSupport().RegisterTransaction(std::move(driver));

        dynamic_cast< PGSQLNativeTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(trans_id))->ScanTypes();

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ID")), trans_id);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "PID")), pid);
}

void PGSQL_GetStatus(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLNativeTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        auto status = driver->GetStatus();

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_SetIntegerCell(hsvm, id_set, HSVM_GetColumnId(hsvm, "STATUS"), status.first);
        HSVM_SetIntegerCell(hsvm, id_set, HSVM_GetColumnId(hsvm, "TRANSACTIONSTATUS"), status.second);
}

} // End of namespace PGSQL
} // End of namespace SQLLib
} // End of namespace HareScript


//---------------------------------------------------------------------------
extern "C"
{

BLEXLIB_PUBLIC int PGSQLEntryPoint(HSVM_RegData *regdata,void*)
{
        using namespace HareScript::SQLLib::PGSQL;

        PGSQLRegisterSharedFunctions(regdata);

        HSVM_RegisterFunction(regdata, "__PGSQL_CONNECT::R:RAB", PGSQL_Connect);
        HSVM_RegisterFunction(regdata, "__PGSQL_GETSTATUS::R:I", PGSQL_GetStatus);

        return 1;
}

} //end extern "C"
