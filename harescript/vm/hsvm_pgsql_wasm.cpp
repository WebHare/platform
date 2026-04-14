#pragma GCC diagnostic ignored "-Wuninitialized"

//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_pgsql_wasm.h"
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

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif // __EMSCRIPTEN__


#ifdef SHOW_PGSQL
 #define PQ_PRINT(x) DEBUGPRINT("PSQL: " << x)
 #define PQ_ONLY(x) DEBUGONLY(x)
 #define PQ_ONLYRAW(x) DEBUGONLYARG(x)
#else
 #define PQ_PRINT(x) BLEX_NOOP_STATEMENT
 #define PQ_ONLY(x) BLEX_NOOP_STATEMENT
 #define PQ_ONLYRAW(x)
#endif

// Disable dollar-in-identifier-extension warning (needed for EM_ASM) for clang and gcc
#ifdef __clang__
 #pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
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

#define PqMsg_Bind 'B'
#define PqMsg_Close 'C'
#define PqMsg_Describe 'D'
#define PqMsg_Execute 'E'
#define PqMsg_FunctionCall 'F'
#define PqMsg_Flush 'H'
#define PqMsg_Parse 'P'
#define PqMsg_Query 'Q'
#define PqMsg_Sync 'S'
#define PqMsg_Terminate 'X'
#define PqMsg_CopyFail 'f'
#define PqMsg_GSSResponse 'p'
#define PqMsg_PasswordMessage 'p'
#define PqMsg_SASLInitialResponse 'p'
#define PqMsg_SASLResponse 'p'

#define PqMsg_ParseComplete '1'
#define PqMsg_BindComplete '2'
#define PqMsg_CloseComplete '3'
#define PqMsg_NotificationResponse 'A'
#define PqMsg_CommandComplete 'C'
#define PqMsg_DataRow 'D'
#define PqMsg_ErrorResponse 'E'
#define PqMsg_CopyInResponse 'G'
#define PqMsg_CopyOutResponse 'H'
#define PqMsg_EmptyQueryResponse 'I'
#define PqMsg_BackendKeyData 'K'
#define PqMsg_NoticeResponse 'N'
#define PqMsg_AuthenticationRequest 'R'
#define PqMsg_ParameterStatus 'S'
#define PqMsg_RowDescription 'T'
#define PqMsg_FunctionCallResponse 'V'
#define PqMsg_CopyBothResponse 'W'
#define PqMsg_ReadyForQuery 'Z'
#define PqMsg_NoData 'n'
#define PqMsg_PortalSuspended 's'
#define PqMsg_ParameterDescription 't'
#define PqMsg_NegotiateProtocolVersion 'v'


/* These are the codes sent by both the frontend and backend. */

#define PqMsg_CopyDone				'c'
#define PqMsg_CopyData				'd'


struct QueryDataRow {
        uint32_t offset;
        uint32_t length;
};

struct QueryResultErrorField {
        char code;
        std::string value;
};

class WasmQueryResult: public QueryResult {
        char *data;
        unsigned length;

        uint32_t cachedrowidx = std::numeric_limits< uint32_t >::max();
        Blex::PodVector< QueryResultValue > cachedrowvalues;

        Blex::PodVector< QueryDataRow > rows;
        bool have_error;
        std::vector< QueryResultErrorField > errorfields;

        void ParseBuffer();
        void EnsureRowCached(uint32_t rowid);

        std::string cmdline;

    public:
        std::vector< QueryResultField > fields;

        /** Called with all result buffers concatenated. Buffer was malloc'ed and will be freed by destructor */
        WasmQueryResult(char *data, unsigned length);
        ~WasmQueryResult();

        virtual std::vector< QueryResultField > GetResultFields() const;
        virtual std::string GetErrorField(PG_DIAG_CODE fieldcode) const;
        uint32_t GetRowCount() const { return rows.size(); }
        bool HasError() const { return have_error; }
        QueryResultValue GetValue(uint32_t rowid, uint32_t colid);
        virtual std::string GetErrorMessage() const;
        virtual std::string GetVerboseErrorMessage() const;
        virtual std::string GetCmd();
        virtual unsigned GetCmdTuples();
};


WasmQueryResult::WasmQueryResult(char *data_, unsigned length_)
: data(data_)
, length(length_)
, have_error(false) {
        this->ParseBuffer();
}

WasmQueryResult::~WasmQueryResult() {
        free(data);
}

std::vector< QueryResultField > WasmQueryResult::GetResultFields() const {
        return fields;
}

std::string WasmQueryResult::GetErrorField(PG_DIAG_CODE fieldcode) const {
        for (auto const &field: errorfields)
            if (field.code == static_cast<char>(fieldcode))
                return field.value;
        return std::string();
}


void WasmQueryResult::ParseBuffer() {
        unsigned idx = 0;

        while (idx + 5 < length) {
                auto code = data[idx++];
                uint32_t len = Blex::getu32msb(&data[idx]);
                unsigned packetend = idx + len;
                idx += 4;
                if (packetend > length)
                    throw std::runtime_error("Invalid result buffer");
                switch (code) {
                        case PqMsg_RowDescription: { // Row description
                                if (len < 2)
                                        throw std::runtime_error("Invalid row description message");
                                unsigned colcount = Blex::getu16msb(&data[idx]);
                                idx += 2;
                                for (unsigned i = 0; i < colcount; ++i) {
                                        // field name (null-terminated string)
                                        auto itr = std::find(data + idx, data + packetend, 0);
                                        if (itr == data + packetend)
                                            throw std::runtime_error("Invalid row description message");
                                        std::string_view fieldname(data + idx, itr - (data + idx));
                                        idx += fieldname.size() + 1;
                                        if (idx + 18 > packetend)
                                            throw std::runtime_error("Invalid row description message");
                                        //uint32_t tableoid = Blex::getu32msb(&data[idx]); // unused
                                        idx += 4;
                                        //uint16_t attrnum = Blex::getu16msb(&data[idx]); // unused
                                        idx += 2;
                                        OID typeoid = static_cast<OID>(Blex::getu32msb(&data[idx]));
                                        idx += 4;
                                        //int16_t datatypesize = Blex::gets16msb(&data[idx]);
                                        idx += 2;
                                        int32_t typemodifier = Blex::gets32msb(&data[idx]);
                                        idx += 4;
                                        int16_t formatcode = Blex::gets16msb(&data[idx]);
                                        idx += 2;

                                        // Store field information
                                        QueryResultField field{ .name = fieldname, .typeoid = typeoid, .typemodifier = typemodifier, .formatcode = formatcode };
                                        // Fill field details
                                        fields.push_back(field);
                                        cachedrowvalues.push_back(QueryResultValue{});
                                }
                        } break;
                        case PqMsg_DataRow: { // Data row
                                QueryDataRow row{ .offset = idx, .length = len };
                                rows.push_back(row);
                        } break;
                        case PqMsg_ErrorResponse: { // Error message
                                have_error = true;
                                while (idx < packetend) {
                                        char fieldcode = data[idx++];
                                        if (fieldcode == 0)
                                            break;
                                        auto itr = std::find(data + idx, data + packetend, 0);
                                        if (itr == data +packetend)
                                            throw std::runtime_error("Invalid error message");
                                        std::string fieldvalue(data + idx, itr - (data + idx));
                                        idx += fieldvalue.size() + 1;

                                        QueryResultErrorField errorfield{ .code = fieldcode, .value = fieldvalue };
                                        errorfields.push_back(errorfield);
                                }
                        } break;
                        case PqMsg_CommandComplete: { // Command complete
                                // Command tag is a null-terminated string
                                auto itr = std::find(data + idx, data + packetend, 0);
                                if (itr == data + packetend)
                                    throw std::runtime_error("Invalid command complete message");
                                cmdline = std::string(data + idx, itr - (data + idx));
                                idx += cmdline.size() + 1;
                        } break;
                        default:
                                // Skip unknown message types
                                break;
                }
                idx = packetend;
        }

        if (idx < length)
                throw std::runtime_error("Invalid result buffer: extra data at end");
}

void WasmQueryResult::EnsureRowCached(uint32_t rowid) {
        if (cachedrowidx != rowid) {
                cachedrowidx = rowid;

                auto const &rowdata = rows[rowid];

                // Parse DataRow packet
                unsigned idx = rowdata.offset;
                if (rowdata.length < 2)
                    throw std::runtime_error("Invalid data row message");
                unsigned colcount = Blex::getu16msb(&data[idx]);
                idx += 2;
                if (colcount != fields.size())
                    throw std::runtime_error("Column count mismatch in data row message");
                for (unsigned colidx = 0; colidx < colcount; colidx++) {
                        if (idx + 4 > length)
                            throw std::runtime_error("Invalid data row message");
                        int32_t datalen = Blex::gets32msb(&data[idx]);
                        idx += 4;
                        if (datalen == -1) {
                                // NULL value
                                cachedrowvalues[colidx] = QueryResultValue{ .data = nullptr, .length = 0, .isnull = true };
                        } else {
                                if (idx + datalen > length)
                                    throw std::runtime_error("Invalid data row message");
                                char *dataptr = &data[idx];
                                idx += datalen;
                                cachedrowvalues[colidx] = QueryResultValue{ .data = dataptr, .length = datalen, .isnull = false };
                        }
                }
        }
}

QueryResultValue WasmQueryResult::GetValue(uint32_t rowid, uint32_t colid)
{
        EnsureRowCached(rowid);
        return cachedrowvalues[colid];
}

std::string WasmQueryResult::GetErrorMessage() const
{
        // FIXME: see which fields are actually returned by fe-protocol3.c:pqBuildErrorMessage3
        std::string message;
        auto severity = GetErrorField(PG_DIAG_CODE::SEVERITY_NONLOCALIZED);
        if (!severity.empty())
                message += severity + ":  ";
        auto sqlstate = GetErrorField(PG_DIAG_CODE::SQLSTATE);
        if (!sqlstate.empty())
                message += sqlstate + ": ";
        message += GetErrorField(PG_DIAG_CODE::MESSAGE_PRIMARY);
        message += "\n";
        auto detail = GetErrorField(PG_DIAG_CODE::MESSAGE_DETAIL);
        if (!detail.empty())
                message += "DETAIL: " + detail + "\n";
        auto hint = GetErrorField(PG_DIAG_CODE::MESSAGE_HINT);
        if (!hint.empty())
                message += "HINT: " + hint + "\n";
        auto context = GetErrorField(PG_DIAG_CODE::CONTEXT);
        if (!context.empty())
                message += "CONTEXT: " + context + "\n";

        return message;
}

std::string WasmQueryResult::GetCmd()
{
        return { cmdline.begin(), std::find(cmdline.begin(), cmdline.end(), ' ') };
}

unsigned WasmQueryResult::GetCmdTuples()
{
        auto ptr = cmdline.c_str();
        if (Blex::StrStartsWith(cmdline, "INSERT "))
            ptr += 7;
        else if (!Blex::CStrCompare(ptr, "SELECT ", 7) &&
            !Blex::CStrCompare(ptr, "DELETE ", 7) &&
            !Blex::CStrCompare(ptr, "UPDATE ", 7) &&
            !Blex::CStrCompare(ptr, "FETCH ", 6) &&
                !Blex::CStrCompare(ptr, "MERGE ", 6) &&
                !Blex::CStrCompare(ptr, "MOVE ", 5) &&
                !Blex::CStrCompare(ptr, "COPY ", 5))
            return 0;

        // Skip command verb (or INSERT OID)
        while (*ptr && *ptr != ' ')
            ++ptr;
        if (!*ptr)
            return 0;
        ++ptr;

        return Blex::DecodeUnsignedNumber<unsigned, const char *>(ptr, cmdline.c_str() + cmdline.size(), 10).first;
}

std::string WasmQueryResult::GetVerboseErrorMessage() const
{
        // FIXME: replicate libpq building the verbose error message from postgresql fe-protocol3.c:pqBuildErrorMessage3
        return GetErrorMessage();
}

inline std::string HSVM_GetStringCell(HSVM *hsvm, HSVM_VariableId id_get, HSVM_ColumnId colid)
{
        HSVM_VariableId var = HSVM_RecordGetRef(hsvm, id_get, colid);
        if (!var || HSVM_GetType(hsvm, var) != HSVM_VAR_String)
            return "";
        return HSVM_StringGetSTD(hsvm, var);
}

inline void HSVM_SetStringCell(HSVM *hsvm, HSVM_VariableId id_set, HSVM_ColumnId colid, std::string const &value)
{
        HSVM_VariableId var = HSVM_RecordCreate(hsvm, id_set, colid);
        HSVM_StringSetSTD(hsvm, var, value);
}

inline void HSVM_SetIntegerCell(HSVM *hsvm, HSVM_VariableId id_set, HSVM_ColumnId colid, int value)
{
        HSVM_VariableId var = HSVM_RecordCreate(hsvm, id_set, colid);
        HSVM_IntegerSet(hsvm, var, value);
}


PGSQLWasmTransactionDriver::PGSQLWasmTransactionDriver(HSVM *_vm, PGSQLWasmTransactionDriver::Options const &options)
: PGSQLTransactionDriverBase(_vm, options)
{
}

EM_JS(void, supportClosePgDriver, (PGSQLWasmTransactionDriver *driver, int32_t trans_id), {
        Module.closePgDriver(driver, trans_id);
});

PGSQLWasmTransactionDriver::~PGSQLWasmTransactionDriver()
{
        supportClosePgDriver(this, this->sqllib_transid);
}

EM_ASYNC_JS(void, supportPrepareForQuery, (int32_t trans_id, int32_t *webhare_blob_oid, int32_t *webhare_blobarray_oid), {
        await Module.prepareForPgQuery(trans_id, webhare_blob_oid, webhare_blobarray_oid);
});

void PGSQLWasmTransactionDriver::PrepareForQuery()
{
        if (!this->webhare_blob_oid)
            supportPrepareForQuery(this->sqllib_transid, &webhare_blob_oid, &webhare_blobarray_oid);
}

EM_JS(bool, supportIsWorkOpen, (int32_t trans_id), {
        return Module.isPgWorkOpen(trans_id);
});

bool PGSQLWasmTransactionDriver::IsWorkOpen()
{
        return supportIsWorkOpen(this->sqllib_transid);
}

void PGSQLWasmTransactionDriver::SetWorkOpen(bool)
{
        ThrowVMRuntimeError(Error::Codes::InternalError, "SetWorkOpen is not supported in PGSQLWasmTransactionDriver");
}

EM_JS(void, supportSendPgQuery, (int32_t trans_id, void *query, unsigned length), {
        Module.sendPgQuery(trans_id, query, length);
});
std::unique_ptr< QueryResult > PGSQLWasmTransactionDriver::ExecQuery(Query &query, bool asyncresult)
{
        query.params.Finalize();

#ifdef DUMP_BINARY_ENCODING
        PQ_ONLY(
                for (unsigned i = 0; i < query.params.types.size(); ++i)
                {
                        PQ_PRINT(" param " << i << ": type: " << query.params.types[i] << " len " << query.params.lengths[i] << " format " << query.params.formats[i] << " data: " << (query.params.dataptrs[i] ? "" : "nullptr"));
                        if (query.params.dataptrs[i] && query.params.lengths[i] > 0)
                                DumpPacket(query.params.lengths[i], query.params.dataptrs[i]);
                }
        );
#endif

        PQ_PRINT("Wait last result");

        /* We can't send a query if the previous one is still in flight, so we need to
           retrieve the results first. Return immediately if an error was returned by
           that query
        */
        if (PGSQLWasmTransactionDriver::GetLastResult().second)
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

        PQ_PRINT("logcommands");

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

        {
                PQ_PRINT("build query");

                std::string querystr = logprefix.empty() ? query.querystr.c_str() : (logprefix + query.querystr).c_str();

                // TODO: prepare buffer with PARSE, BIND and EXECUTE message, pass those to postgrease passthrough query directly
                unsigned parsesize = 8 + querystr.size() + 4 * query.params.types.size();
                unsigned bindsize = 14 + 2 * query.params.formats.size() + 4 * query.params.types.size();
                for (auto len: query.params.lengths)
                        bindsize += len;

                unsigned buffersize = 24 + parsesize + bindsize; // 2 bytes for describe and bind codes, 7 for describe, 10 for execute message, 5 for sync

                Blex::PodVector< char > &fullquerybuf = query.fullquerybuf;
                fullquerybuf.resize(buffersize + 65536); // extra room for now
                unsigned idx = 0;

                // Parse
                fullquerybuf[idx++] = PqMsg_Parse;
                Blex::putu32msb(&fullquerybuf[idx], parsesize);
                idx += 4;
                fullquerybuf[idx++] = 0; // unnamed statement
                for (auto itr: querystr)
                    fullquerybuf[idx++] = itr;
                fullquerybuf[idx++] = 0; // end of query string
                Blex::putu16msb(&fullquerybuf[idx], query.params.types.size());
                idx += 2;
                for (auto itr: query.params.types) {
                        Blex::putu32msb(&fullquerybuf[idx], itr);
                        idx += 4;
                }

                // Bind
                fullquerybuf[idx++] = PqMsg_Bind;
                Blex::putu32msb(&fullquerybuf[idx], bindsize);
                idx += 4;
                fullquerybuf[idx++] = 0; // unnamed portal
                fullquerybuf[idx++] = 0; // unnamed statement
                Blex::putu16msb(&fullquerybuf[idx], query.params.formats.size());
                idx += 2;
                for (auto itr: query.params.formats) {
                        Blex::putu16msb(&fullquerybuf[idx], itr); // parameter binary format
                        idx += 2;
                }
                Blex::putu16msb(&fullquerybuf[idx], query.params.lengths.size());
                idx += 2;
                for (unsigned pidx = 0, e = query.params.lengths.size(); pidx < e; ++pidx) {
                        unsigned len = query.params.lengths[pidx];
                        Blex::putu32msb(&fullquerybuf[idx], len);
                        idx += 4;
                        std::copy(query.params.dataptrs[pidx], query.params.dataptrs[pidx] + len, &fullquerybuf[idx]);
                        idx += len;
                }
                // result formats
                Blex::putu16msb(&fullquerybuf[idx], 1);
                idx += 2;
                Blex::putu16msb(&fullquerybuf[idx], query.astext ? 0 : 1);
                idx += 2;

                // describe
                fullquerybuf[idx++] = PqMsg_Describe;
                Blex::putu32msb(&fullquerybuf[idx], 6);
                idx += 4;
                fullquerybuf[idx++] = 'P'; // portal
                fullquerybuf[idx++] = 0; // unnamed portal

                // execute
                fullquerybuf[idx++] = PqMsg_Execute;
                Blex::putu32msb(&fullquerybuf[idx], 9);
                idx += 4;
                fullquerybuf[idx++] = 0; // unnamed portal
                Blex::putu32msb(&fullquerybuf[idx], 0); // max rows
                idx += 4;

                // sync
                fullquerybuf[idx++] = PqMsg_Sync;
                Blex::putu32msb(&fullquerybuf[idx], 4);
                idx += 4;

                if (idx != buffersize)
                    throw std::runtime_error("Internal error: query buffer size mismatch");

                supportSendPgQuery(this->sqllib_transid, &fullquerybuf[0], idx);
        }

        std::unique_ptr< QueryResult > retval;
        if (!asyncresult)
            retval = GetLastResult().first;

        return retval;
}

bool PGSQLWasmTransactionDriver::CheckResultStatus(std::unique_ptr< QueryResult > const &res)
{
        if (!res)
        {
                HSVM_ThrowException(*vm, "Unknown fatal error returned");
                return false;
        }

        if (res->HasError()) {
                auto severity = res->GetErrorField(PG_DIAG_CODE::SEVERITY_NONLOCALIZED);
                auto message = res->GetErrorField(PG_DIAG_CODE::MESSAGE_PRIMARY);
                if (severity == "FATAL" || severity == "PANIC") {
                        PQ_PRINT("Got fatal error: " << message);
                        if (HandleMessage(*res) && !vm->is_unwinding)
                            HSVM_ThrowException(*vm, ("Fatal error returned: " + message).c_str());
                        return !vm->is_unwinding;
                } else {
                        PQ_PRINT("Got non-fatal error: " << message);
                        if (HandleMessage(*res) && !vm->is_unwinding)
                            HSVM_ThrowException(*vm, ("Non-fatal error returned: " + message).c_str());
                        return !vm->is_unwinding;
                }
        }

        return true;
}

EM_ASYNC_JS(bool, supportWaitForResult, (int32_t trans_id, char **data, unsigned *len, int32_t timeout_secs), {
  return Module.getPgResult(trans_id, data, len, timeout_secs);
});



std::unique_ptr< QueryResult > PGSQLWasmTransactionDriver::WaitForResult() {
        char *data = nullptr;
        unsigned len = 0;
        PQ_PRINT(" T" << sqllib_transid << " WaitForResult start");
        supportWaitForResult(this->sqllib_transid, &data, &len, command_timeout_secs);
        PQ_PRINT(" T" << sqllib_transid << " WaitForResult end, len: " << len);

        if (!len)
            return std::unique_ptr< QueryResult >();

        return std::unique_ptr< QueryResult >(new WasmQueryResult(data, len));
}

std::pair< std::unique_ptr< QueryResult >, bool > PGSQLWasmTransactionDriver::GetLastResult()
{
        std::unique_ptr< QueryResult > lastres;
        bool goterror = false;

        // Read results until the PQgetResult returns nullptr, return the last one
        while (true)
        {
                std::unique_ptr< QueryResult > res(WaitForResult());
                PQ_PRINT("T " << sqllib_transid << " WaitForResult returned " << (res ? "a result" : "nullptr"));
                if (!res.get())
                    break;

                if (goterror)
                    continue;

                if (!CheckResultStatus(res))
                {
                        goterror = true;
                        lastres.reset();
                }
                else
                    lastres = std::move(res);
        }

        return std::make_pair(std::move(lastres), goterror);
}

EM_JS(void, supportInitPgDriver, (PGSQLWasmTransactionDriver *driver, int32_t trans_id, bool isprimary), {
  Module.initPgDriver(driver, trans_id, isprimary);
});

void PGSQL_Connect(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_ColumnId col_name = HSVM_GetColumnId(hsvm, "NAME");
        HSVM_ColumnId col_value = HSVM_GetColumnId(hsvm, "VALUE");

        std::vector< std::string > strings;

        bool isprimary = HSVM_BooleanGet(hsvm, HSVM_Arg(1));

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
        }

        auto options = PGSQLWasmTransactionDriver::Options(); // value-initialize the options
        options.blobfolder = blobfolder;
        options.logstacktraces = logstacktraces;

        std::unique_ptr< PGSQLWasmTransactionDriver > driver(new PGSQLWasmTransactionDriver(hsvm, options));
        int32_t trans_id = GetVirtualMachine(hsvm)->GetSQLSupport().RegisterTransaction(std::move(driver));
        supportInitPgDriver(driver.get(), trans_id, isprimary);

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ID")), trans_id);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "PID")), 0);
}

} // End of namespace PGSQLWasm
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

        return 1;
}

} //end extern "C"
