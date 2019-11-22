//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_odbcprovider.h"
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/errors.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/baselibs.h>
#include <blex/unicode.h>

static_assert(sizeof(SQLWCHAR)==sizeof(uint16_t), "SQLWCHAR needs to be a 16-bit type");

//ADDME: Centralize? Our wonderfull shortcuts..
inline bool HSVM_GetBooleanCell(HSVM *hsvm, HSVM_VariableId id_get, const char *cellname)
{
        HSVM_VariableId var = HSVM_RecordGetRef(hsvm,id_get, HSVM_GetColumnId(hsvm, cellname));
        return var ? HSVM_BooleanGet(hsvm,var) : false;
}
inline void HSVM_SetBooleanCell(HSVM *hsvm, HSVM_VariableId id_set, const char *cellname, bool value)
{
        HSVM_BooleanSet(hsvm,
                        HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, cellname)),
                        value);
}
inline void HSVM_SetStringCell(HSVM *hsvm, HSVM_VariableId id_set, const char *cellname, std::string const &value)
{
        HSVM_StringSet(hsvm,
                       HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, cellname)),
                       value.data(),
                       value.data()+value.size());
}

/* Important note about UNICODE !
   The Wide variants of ODBC SQL functions should be used, except in spots where
   we wish to support both Ansi and Wide versions for speed. Any string-taking
   or string-retuning SQL function should thus have a W suffix.

   * DO NOT INTERCHANGE SQLWCHAR WITH wchar_t ! They happen to be equivalent on
     Win32, but NOT on Linux!
   * AVOID CASTS OF char/SQLWCHAR BUFFERS, OR PREFER C++ CASTS - it's too easy
     to hide a legitimate compiler warning/error this way
   * READ FUNCTION APIs CAREFULLY - passed and returned string lengths are
     usually in CHARACTERS, but buffer sizes, even buffers containing wchar_ts
     are in BYTES (if you always use size() and sizeof, it usually turns out
     right 'magically')
*/

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

/** ODBC driver

    FIXME Current problems:

       No capabilities checking (we don't know whether the source can handle
       our interface.
*/
// -----------------------------------------------------------------------------
//
//   Error + info reporting
//
//

// TODO:
/*      To use SQLGetData with a block cursor, an application first calls SQLSetPos
        to position the cursor on a single row. It then calls SQLGetData for a column
        in that row. However, this behavior is optional. To determine if a driver supports
        the use of SQLGetData with block cursors, an application calls SQLGetInfo with
        the SQL_GETDATA_EXTENSIONS
        FIXME: We (will) rely on this mechanism for blobs; so check for availability (not done yet) */


namespace
{
std::string CursorAttributes(SQLUINTEGER p1, SQLUINTEGER p2)
{
        std::string capabilities;
#define TEST(a,b) if ((a & b) == b) capabilities += ", "#b;
        TEST(p1, SQL_CA1_NEXT);
        TEST(p1, SQL_CA1_ABSOLUTE);
        TEST(p1, SQL_CA1_RELATIVE);
        TEST(p1, SQL_CA1_BOOKMARK);
        TEST(p1, SQL_CA1_LOCK_EXCLUSIVE);
        TEST(p1, SQL_CA1_LOCK_NO_CHANGE);
        TEST(p1, SQL_CA1_LOCK_UNLOCK);
        TEST(p1, SQL_CA1_POS_POSITION);
        TEST(p1, SQL_CA1_POS_UPDATE);
        TEST(p1, SQL_CA1_POS_DELETE);
        TEST(p1, SQL_CA1_POS_REFRESH);
        TEST(p1, SQL_CA1_POSITIONED_UPDATE);
        TEST(p1, SQL_CA1_POSITIONED_DELETE);
        TEST(p1, SQL_CA1_SELECT_FOR_UPDATE);
        TEST(p1, SQL_CA1_BULK_ADD);
        TEST(p1, SQL_CA1_BULK_UPDATE_BY_BOOKMARK);
        TEST(p1, SQL_CA1_BULK_DELETE_BY_BOOKMARK);
        TEST(p1, SQL_CA1_BULK_FETCH_BY_BOOKMARK);
        TEST(p2, SQL_CA2_READ_ONLY_CONCURRENCY);
        TEST(p2, SQL_CA2_LOCK_CONCURRENCY);
        TEST(p2, SQL_CA2_OPT_ROWVER_CONCURRENCY);
        TEST(p2, SQL_CA2_OPT_VALUES_CONCURRENCY);
        TEST(p2, SQL_CA2_SENSITIVITY_ADDITIONS);
        TEST(p2, SQL_CA2_SENSITIVITY_DELETIONS);
        TEST(p2, SQL_CA2_SENSITIVITY_UPDATES);
        TEST(p2, SQL_CA2_MAX_ROWS_SELECT);
        TEST(p2, SQL_CA2_MAX_ROWS_INSERT);
        TEST(p2, SQL_CA2_MAX_ROWS_DELETE);
        TEST(p2, SQL_CA2_MAX_ROWS_UPDATE);
        TEST(p2, SQL_CA2_MAX_ROWS_CATALOG);
        TEST(p2, SQL_CA2_MAX_ROWS_AFFECTS_ALL);
        TEST(p2, SQL_CA2_CRC_EXACT);
        TEST(p2, SQL_CA2_CRC_APPROXIMATE);
        TEST(p2, SQL_CA2_SIMULATE_NON_UNIQUE);
        TEST(p2, SQL_CA2_SIMULATE_TRY_UNIQUE);
        TEST(p2, SQL_CA2_SIMULATE_UNIQUE);
        if (!capabilities.empty()) capabilities.erase(capabilities.begin(), capabilities.begin() + 2);
        return capabilities;
}
std::string SetPosCapabilities(SQLUINTEGER p1)
{
        std::string capabilities;
        TEST(p1, SQL_POS_POSITION);
        TEST(p1, SQL_POS_UPDATE);
        TEST(p1, SQL_POS_DELETE);
        if (!capabilities.empty()) capabilities.erase(capabilities.begin(), capabilities.begin() + 2);
        return capabilities;
}
std::string CursorCapabilities(SQLUINTEGER p1)
{
        std::string capabilities;
        TEST(p1, SQL_SO_FORWARD_ONLY);
        TEST(p1, SQL_SO_DYNAMIC);
        TEST(p1, SQL_SO_KEYSET_DRIVEN);
        TEST(p1, SQL_SO_STATIC);
        if (!capabilities.empty()) capabilities.erase(capabilities.begin(), capabilities.begin() + 2);
        return capabilities;
}
std::string GetDataExtensions(SQLUINTEGER p1)
{
        std::string capabilities;
        TEST(p1, SQL_GD_ANY_COLUMN);
        TEST(p1, SQL_GD_ANY_ORDER);
        TEST(p1, SQL_GD_BLOCK);
        TEST(p1, SQL_GD_BOUND);
        TEST(p1, SQL_GD_OUTPUT_PARAMS);
        if (!capabilities.empty()) capabilities.erase(capabilities.begin(), capabilities.begin() + 2);
        return capabilities;
}

void CheckDriverCapabilities(SQLHDBC handle, Capabilities &capabilities)
{
        SQLUINTEGER uint;
//        SQLUSMALLINT usmall;
        capabilities.support_bind=true;
        capabilities.harescript_challenged=false;

        std::string str;

        // Check GetData capabilities: we need retrieval of any column positioning in GetData for 2-fase blob retrieval
        // Block positioning is necessary for using SQLSetPo0s
        uint = GetDriverInfoUINTEGER(handle, SQL_GETDATA_EXTENSIONS);
        capabilities.support_getdata_when_bound = uint & SQL_GD_BOUND;
        capabilities.support_getdata_anycolumn = uint & SQL_GD_ANY_COLUMN;
        capabilities.support_setpos_position = uint & SQL_GD_BLOCK;

        // Determine which positioning functionality is present
        uint = GetDriverInfoUINTEGER(handle, SQL_POS_OPERATIONS);
        capabilities.support_setpos_position =
                capabilities.support_setpos_position
                && (uint & SQL_POS_POSITION);
        capabilities.support_setpos_modify =
                capabilities.support_setpos_position
                && (uint & SQL_POS_UPDATE)
                && (uint & SQL_POS_DELETE);

        /* All Microsoft JET based databases support positioning throught SQLSetPos
           Excel and Text driver do not support modifying through SQLSetPos
           PostgreSQL supports both as experimental in 7.2.0001 */

        // Get the available cursors
        uint = GetDriverInfoUINTEGER(handle, SQL_SCROLL_OPTIONS);

        // Get capabilities for available cursors
        SQLUINTEGER caps[ODBCCursorType::_max + 1] = {0};
        if (uint & SQL_SO_FORWARD_ONLY)
            caps[ODBCCursorType::Forward] = GetDriverInfoUINTEGER(handle, SQL_FORWARD_ONLY_CURSOR_ATTRIBUTES1);
        if (uint & SQL_SO_STATIC)
            caps[ODBCCursorType::Static] = GetDriverInfoUINTEGER(handle, SQL_STATIC_CURSOR_ATTRIBUTES1);
        if (uint & SQL_SO_KEYSET_DRIVEN)
            caps[ODBCCursorType::Keyset] = GetDriverInfoUINTEGER(handle, SQL_KEYSET_CURSOR_ATTRIBUTES1);
        if (uint & SQL_SO_DYNAMIC)
            caps[ODBCCursorType::Dynamic] = GetDriverInfoUINTEGER(handle, SQL_DYNAMIC_CURSOR_ATTRIBUTES1);


        bool have_selectcursor = false;
        bool have_modifycursor = false;
        capabilities.select_cursor = ODBCCursorType::Forward;
        capabilities.modify_cursor = ODBCCursorType::Forward;

        ODBCCursorType::_type processorder[ODBCCursorType::_max + 1] =
            { ODBCCursorType::Dynamic
            , ODBCCursorType::Keyset
            , ODBCCursorType::Static
            , ODBCCursorType::Forward
            };

        for (auto idx: processorder)
        {
                bool cap_position = capabilities.support_setpos_position && caps[idx] & SQL_CA1_POS_POSITION;
                bool caps_modify = capabilities.support_setpos_modify && caps[idx] & SQL_CA1_POS_POSITION && caps[idx] & SQL_CA1_POS_UPDATE && caps[idx] & SQL_CA1_POS_DELETE;

                if (cap_position)
                {
                        have_selectcursor = true;
                        capabilities.select_cursor = idx;
                }

                if (caps_modify)
                {
                        have_modifycursor = true;
                        capabilities.modify_cursor = idx;
                }
        }

        capabilities.support_setpos_position = have_selectcursor;
        capabilities.support_setpos_modify = have_modifycursor;

        if (!have_selectcursor || !have_modifycursor)
            capabilities.harescript_challenged = true;

        capabilities.support_char_to_wchar = GetDriverInfoUINTEGER(handle, SQL_CONVERT_CHAR) & SQL_CVT_WCHAR;
}

ODBCTransactionDriver* IsODBCTransaction(HSVM *hsvm, DatabaseTransactionDriverInterface *itf)
{
        ODBCProviderContextData *context = static_cast<ODBCProviderContextData *>(HSVM_GetContext(hsvm,ODBCProviderContextId,true));
        if (context->translist.count(static_cast<ODBCTransactionDriver *>(itf)))
            return static_cast<ODBCTransactionDriver *>(itf);

        return 0;
}


} // End of anonymous namespace

// -----------------------------------------------------------------------------
//
//   Context
//
//

ODBCProviderContextData::ODBCProviderContextData()
{
        SQLRETURN retval;

        henv = SQL_NULL_HANDLE;
        retval = SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &henv);
        if (IsError(retval) || henv == SQL_NULL_HANDLE)
            ThrowDBError("Could not allocate ODBC environment handle");

        ODBCDEBUGPRINT("Allocated environment handle " << (void*)henv);

        retval = SQLSetEnvAttr(henv, SQL_ATTR_ODBC_VERSION, (void *)(SQL_OV_ODBC3), SQL_IS_INTEGER);
        if (IsError(retval))
            ThrowDBError("Could not set ODBC environment attributes");
}

ODBCProviderContextData::~ODBCProviderContextData()
{
        if (henv != SQL_NULL_HANDLE)
        {
                ODBCDEBUGPRINT("Freeing environment handle " << (void*)henv);
                SQLFreeHandle(SQL_HANDLE_ENV, henv);
        }
}


// -----------------------------------------------------------------------------
//
//   Transaction driver extra control functions
//
//

void GetODBCDataSources (HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm= GetVirtualMachine(hsvm);

        ODBCProviderContextData *context = static_cast<ODBCProviderContextData *>(HSVM_GetContext(hsvm,ODBCProviderContextId,true));
        ODBCDEBUGPRINT("context " << (void *)context);

        std::string charset_name = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Blex::Charsets::Charset charset = Blex::FindCharacterset(charset_name.c_str(), charset_name.c_str() + charset_name.size());
        if (charset == Blex::Charsets::Unknown)
        {
                if (!charset_name.empty())
                    ThrowDBError("Unknown character set '" + charset_name + "'");
                charset = Blex::Charsets::Unicode;
        }

        HareScript::SQLLib::ODBC::GetDataSources(
                       *vm,
                       *context,
                       id_set,
                       vm->GetStackMachine().GetInteger(HSVM_Arg(0)),
                       charset);
}

void HS_SQL_ODBC_StartODBCTransaction(HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm = GetVirtualMachine(hsvm);
        StackMachine &stackm = vm->GetStackMachine();

        ODBCProviderContextData *context = static_cast<ODBCProviderContextData *>(HSVM_GetContext(hsvm,ODBCProviderContextId,true));

        // Clear output record.
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        // Check options
        HSVM_VariableId var_type = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "TYPE"));
        HSVM_VariableId var_codepage = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "CODEPAGE"));
        HSVM_VariableId var_workarounds = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "WORKAROUNDS"));

        if (!var_type)
            ThrowDBError("Missing ODBC connection parameter 'TYPE'");

        Blex::Charsets::Charset charset = Blex::Charsets::Unicode;
        if (var_codepage)
        {
                const char *charset_begin, *charset_end;
                HSVM_StringGet(hsvm, var_codepage, &charset_begin, &charset_end);
                charset = Blex::FindCharacterset(charset_begin, charset_end);
                if (charset == Blex::Charsets::Unknown)
                    ThrowDBError("Unknown character set " + std::string(charset_begin, charset_end));
        }

        ODBCWorkarounds::_type workarounds = ODBCWorkarounds::None;
        if (var_workarounds)
        {
                std::string workarounds_str = HSVM_StringGetSTD(hsvm, var_workarounds);
                if (!workarounds_str.empty())
                {
                        std::vector< std::string > tokens;
                        Blex::Tokenize(workarounds_str.begin(), workarounds_str.end(), ',', &tokens);

                        for (auto const &itr: tokens)
                        {
                                if (itr == "DOUBLEENCODEUTF8STRINGS")
                                    workarounds = static_cast< ODBCWorkarounds::_type >(workarounds | ODBCWorkarounds::DoubleEncodedUTF8Strings);
                                else if (itr == "NUMERICVIASTRING")
                                    workarounds = static_cast< ODBCWorkarounds::_type >(workarounds | ODBCWorkarounds::NumericViaString);
                        }
                }
        }

        unsigned trans_id = 0;
        SQLHDBC hdbc = SQL_NULL_HANDLE;
        ODBCTransactionDriver *driverptr = 0;

        // Allocate a new connection handle
        SQLRETURN retval = SQL_SUCCESS;
        retval = SQLAllocHandle(SQL_HANDLE_DBC, context->henv, &hdbc);
        if (IsError(retval))
            ThrowDBError("Could not allocate a connection handle : " + GetDiagnostics(SQL_HANDLE_ENV, context->henv));

        std::unique_ptr< ODBCTransactionDriver > driver; //moved here as BCB workaround
        try
        {
                //DEBUGPRINT ("Allocated connection handle " << (void*)hdbc);

                // Use cursor library; we can't handle all variations that exist in drivers (yet)
//                retval = SQLSetConnectAttr(hdbc, SQL_ATTR_ODBC_CURSORS, (void *)SQL_CUR_USE_ODBC, 0);
                retval = SQLSetConnectAttr(hdbc, SQL_ATTR_ODBC_CURSORS, (void *)SQL_CUR_USE_DRIVER, 0);
                if (IsError(retval))
                    ThrowDBError("Could not set ODBC attributes : " + GetDiagnostics(SQL_HANDLE_DBC, hdbc));

                retval = SQLSetConnectAttr(hdbc, SQL_ATTR_AUTOCOMMIT, (void *)SQL_AUTOCOMMIT_OFF, 0);
                if (IsError(retval))
                    ThrowDBError("Could not set ODBC autocommit mode: " + GetDiagnostics(SQL_HANDLE_DBC, hdbc));

                // Handle the connect.
                std::string type;
                type = HSVM_StringGetSTD(hsvm, var_type);
                Blex::ToUppercase(type.begin(), type.end());

                if (type == "DSN")
                {
                        // Connect to SQL source via DSN, username and password
                        HSVM_VariableId var_dsn = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "DSN"));
                        HSVM_VariableId var_user = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "USERNAME"));
                        HSVM_VariableId var_passwd = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "PASSWORD"));

                        if (!var_dsn) ThrowDBError("Missing ODBC connection parameter 'DSN'");
                        if (!var_user) ThrowDBError("Missing ODBC connection parameter 'USERNAME'");
                        if (!var_passwd) ThrowDBError("Missing ODBC connection parameter 'PASSWORD'");

                        if (charset != Blex::Charsets::Unicode)
                        {
                                std::string source, username, password;

                                const char *begin, *end;
                                HSVM_StringGet(*vm, var_dsn, &begin, &end);
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &source);

                                HSVM_StringGet(*vm, var_user, &begin, &end);
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &username);

                                HSVM_StringGet(*vm, var_passwd, &begin, &end);
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &password);

                                retval = SQLConnectA(hdbc,
                                                     reinterpret_cast<SQLCHAR*>(&source[0]), (SQLSMALLINT)source.size(),
                                                     reinterpret_cast<SQLCHAR*>(&username[0]), (SQLSMALLINT)username.size(),
                                                     reinterpret_cast<SQLCHAR*>(&password[0]), (SQLSMALLINT)password.size());
                        }
                        else
                        {
                                Blex::UTF16String source, username, password;

                                vm->GetStackMachine().GetUTF16String(var_dsn, &source);
                                vm->GetStackMachine().GetUTF16String(var_user, &username);
                                vm->GetStackMachine().GetUTF16String(var_passwd, &password);

                                retval = SQLConnectW(hdbc,
                                                     reinterpret_cast<SQLWCHAR*>(&source[0]), (SQLSMALLINT)source.size(),
                                                     reinterpret_cast<SQLWCHAR*>(&username[0]), (SQLSMALLINT)username.size(),
                                                     reinterpret_cast<SQLWCHAR*>(&password[0]), (SQLSMALLINT)password.size());
                        }
                }
                else if (type == "DRIVER")
                {
                        // Connect to SQL source via driver
                        HSVM_VariableId var_connstr = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "CONNECTION_STRING"));
                        if (!var_connstr) ThrowDBError("Missing ODBC connection parameter 'CONNECTION_STRING'");

                        SQLSMALLINT msglen = 0;
                        if (charset != Blex::Charsets::Unicode)
                        {
                                std::string conn_str;

                                const char *begin, *end;
                                HSVM_StringGet(*vm, var_connstr, &begin, &end);
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &conn_str);

                                char msgbuffer[2048] = {0};
                                retval = SQLDriverConnectA(hdbc,
                                                NULL,
                                                reinterpret_cast<SQLCHAR*>(&conn_str[0]), (SQLSMALLINT)conn_str.size(),
                                                reinterpret_cast<SQLCHAR*>(msgbuffer), sizeof(msgbuffer), &msglen,
                                                (SQLUSMALLINT)SQL_DRIVER_NOPROMPT);

                                std::string msg;
                                Blex::ConvertUTF8ToCharset(msgbuffer, msgbuffer + msglen, charset, &msg);

                                stackm.SetSTLString(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("MSG")), msg);
                        }
                        else
                        {
                                Blex::UTF16String conn_str;
                                vm->GetStackMachine().GetUTF16String(var_connstr, &conn_str);

                                /* this was 4096 WCHars, but that is enough to crash maodbc: it multiplies the sizeof 8K by 4,
                                    puts it in a S16, concludes -32768 bytes, sign extends and back to 64bit, and allocates 18446744073709518848 bytes. */
                                SQLWCHAR msgbuffer[2048] = {0};
                                retval = SQLDriverConnectW(hdbc,
                                                NULL,
                                                reinterpret_cast<SQLWCHAR*>(&conn_str[0]), (SQLSMALLINT)conn_str.size(),
                                                reinterpret_cast<SQLWCHAR*>(msgbuffer), sizeof(msgbuffer), &msglen,
                                                (SQLUSMALLINT)SQL_DRIVER_NOPROMPT);
                                stackm.SetUTF16String(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("MSG")),
                                                      msgbuffer,
                                                      msgbuffer + msglen);
                        }
                }
                else if (type == "BROWSE")
                {
                        HSVM_VariableId var_connstr = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "CONNECTION_STRING"));
                        if (!var_connstr) ThrowDBError("Missing ODBC connection parameter 'CONNECTION_STRING'");

                        SQLSMALLINT msglen = 0;
                        if (charset != Blex::Charsets::Unicode)
                        {
                                std::string conn_str;

                                const char *begin, *end;
                                HSVM_StringGet(*vm, var_connstr, &begin, &end);
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &conn_str);

                                char msgbuffer[4096] = {0};
                                retval = SQLBrowseConnectA(hdbc,
                                                reinterpret_cast<SQLCHAR*>(&conn_str[0]), (SQLSMALLINT)conn_str.size(),
                                                reinterpret_cast<SQLCHAR*>(msgbuffer), sizeof(msgbuffer), &msglen);

                                std::string msg;
                                Blex::ConvertUTF8ToCharset(msgbuffer, msgbuffer + msglen, charset, &msg);

                                stackm.SetSTLString(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("CONNECTION_STRING")), msg);
                        }
                        else
                        {
                                Blex::UTF16String conn_str;
                                vm->GetStackMachine().GetUTF16String(var_connstr, &conn_str);

                                SQLWCHAR msgbuffer[4096] = {0};
                                retval = SQLBrowseConnectW(hdbc,
                                                reinterpret_cast<SQLWCHAR*>(&conn_str[0]), (SQLSMALLINT)conn_str.size(),
                                                reinterpret_cast<SQLWCHAR*>(msgbuffer), sizeof(msgbuffer), &msglen);
                                stackm.SetUTF16String(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("CONNECTION_STRING")),
                                                      msgbuffer,
                                                      msgbuffer + msglen);
                        }

                        if(retval==SQL_NEED_DATA)
                        {
                                DEBUGPRINT(GetDiagnostics(SQL_HANDLE_DBC, hdbc));
                                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ID")), 0);
                                HSVM_StringSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERROR")), 0, 0);
                                return;
                        }
                }
                else
                {
                        ThrowDBError("Illegal connection method " + type + " specified");
                }

                // Check for errors
                if (IsError(retval))
                {
                        std::string diag = GetDiagnostics(SQL_HANDLE_DBC, hdbc);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ID")), 0);
                        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERROR")), diag);
                        return;
                }

                // Connection has succeeded. Build and register transaction driver.
                driver.reset(new ODBCTransactionDriver(hsvm, hdbc));
                driver->charset = charset;
                driver->workarounds = workarounds;

                CheckDriverCapabilities(hdbc, driver->capabilities);
                driverptr = driver.get();
                trans_id = vm->GetSQLSupport().RegisterTransaction(std::move(driver));
                context->translist.insert(driverptr);
        }
        catch (std::exception &e)
        {
                // If there is no driver this function is owner of the hdbc.
                if (!driverptr && hdbc != SQL_NULL_HANDLE)
                {
//                        DEBUGPRINT("Freeing connection handle " << (void*)hdbc);
                        SQLFreeHandle(SQL_HANDLE_DBC, hdbc);
                }
                throw;
        }

        // Set the transaction id in the output record.
        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ID")), trans_id);
}

void HS_SQL_ODBC_Commit(HSVM *hsvm)
{
        VirtualMachine *vm= GetVirtualMachine(hsvm);

        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            ThrowDBError("Committing a non-ODBC transaction");

        // FIXME: how does destruction process work???
        driver->Commit();

        vm->GetSQLSupport().DeleteTransaction(transid);
}

void HS_SQL_ODBC_Rollback(HSVM *hsvm)
{
        VirtualMachine *vm= GetVirtualMachine(hsvm);

        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            ThrowDBError("Rolling back a non-ODBC transaction");

        driver->Rollback();

        vm->GetSQLSupport().DeleteTransaction(transid);
}

void HS_SQL_ODBC_TableList(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (driver)
            driver->GetTables(id_set);
        else
            ThrowDBError("Used a non-ODBC transaction");
}

void HS_SQL_ODBC_ColumnList(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        Blex::UTF16String schema, table;
        GetVirtualMachine(hsvm)->GetStackMachine().GetUTF16String(HSVM_Arg(1), &table);

        Blex::UTF16String::iterator dotpos = std::find(table.begin(), table.end(), '.');
        if (dotpos != table.end())
        {
                schema.assign(table.begin(), dotpos);
                table.erase(table.begin(), dotpos + 1);
        }

        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (driver)
            driver->GetColumns(id_set, schema, table);
        else
            ThrowDBError("Used a non-ODBC transaction");
}

void HS_SQL_ODBC_SendCommand(HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm= GetVirtualMachine(hsvm);

        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            ThrowDBError("Used a non-ODBC transaction");

        SQLHSTMT stat;
        SQLRETURN retval;
        retval = SQLAllocHandle(SQL_HANDLE_STMT, driver->hdbc, &stat);
        CheckRetval(driver->hdbc, retval, "Could not alloc statement");

        try
        {
                if (driver->charset != Blex::Charsets::Unicode)
                {
                        std::string cmd;
                        const char *begin, *end;
                        HSVM_StringGet(*vm, HSVM_Arg(1), &begin, &end);
                        Blex::ConvertUTF8ToCharset(begin, end, driver->charset, &cmd);

                        retval = SQLExecDirectA(stat, reinterpret_cast<SQLCHAR*>(&cmd[0]), cmd.size());
                }
                else
                {
                        Blex::UTF16String cmd;
                        GetVirtualMachine(hsvm)->GetStackMachine().GetUTF16String(HSVM_Arg(1), &cmd);

                        retval = SQLExecDirectW(stat, reinterpret_cast<SQLWCHAR*>(&cmd[0]), cmd.size());
                }
                CheckRetval(stat, retval, "Could not execte command");
                ResultSet(vm, driver->capabilities, stat, driver->charset, driver->workarounds).ReturnTotalSet(id_set);
        }
        catch (std::exception &e)
        {
                SQLFreeHandle(SQL_HANDLE_STMT, stat);
                throw;
        }
        SQLFreeHandle(SQL_HANDLE_STMT, stat);
}

void HS_SQL_ODBC_SendTypedCommand(HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm= GetVirtualMachine(hsvm);

        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            ThrowDBError("Used a non-ODBC transaction");

        StackMachine &stackm = GetVirtualMachine(hsvm)->GetStackMachine();

        SQLHSTMT stat;
        SQLRETURN retval;
        retval = SQLAllocHandle(SQL_HANDLE_STMT, driver->hdbc, &stat);
        CheckRetval(driver->hdbc, retval, "Could not alloc statement");

        try
        {
                ResultSet rset(vm, driver->capabilities, SQL_NULL_HANDLE, driver->charset, driver->workarounds);
                unsigned len = stackm.ArraySize(HSVM_Arg(2));
                for (unsigned idx = 0; idx < len; ++idx)
                {
                        VariableTypes::Type type = static_cast<VariableTypes::Type>(stackm.GetInteger(stackm.ArrayElementRef(HSVM_Arg(2), idx)));
                        rset.AddColumn(type, BindType::TryBind);
                }
                rset.DecideBindings();
                rset.Bind(stat, 1);

                if (driver->charset != Blex::Charsets::Unicode)
                {
                        std::string cmd;
                        const char *begin, *end;
                        HSVM_StringGet(*vm, HSVM_Arg(1), &begin, &end);
                        Blex::ConvertUTF8ToCharset(begin, end, driver->charset, &cmd);

                        retval = SQLExecDirectA(stat, reinterpret_cast<SQLCHAR*>(&cmd[0]), cmd.size());
                }
                else
                {
                        Blex::UTF16String cmd;
                        stackm.GetUTF16String(HSVM_Arg(1), &cmd);
                        retval = SQLExecDirectW(stat, reinterpret_cast<SQLWCHAR*>(&cmd[0]), cmd.size());
                }
                CheckRetval(stat, retval, "Could not execte command");
                rset.ReturnTotalSet(id_set);
        }
        catch (std::exception &e)
        {
                SQLFreeHandle(SQL_HANDLE_STMT, stat);
                throw;
        }
        SQLFreeHandle(SQL_HANDLE_STMT, stat);
}

void HS_SQL_ODBC_GetInfo(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            ThrowDBError("Used a non-ODBC transaction");

        SQLHDBC handle = driver->hdbc;

        HSVM_SetDefault(hsvm,id_set,HSVM_VAR_Record);

        //Capabilities
        HSVM_SetBooleanCell(hsvm, id_set, "CAP_SETPOS_POSITION",    driver->capabilities.support_setpos_position);
        HSVM_SetBooleanCell(hsvm, id_set, "CAP_SETPOS_MODIFY",      driver->capabilities.support_setpos_modify);
        HSVM_SetBooleanCell(hsvm, id_set, "CAP_BIND",               driver->capabilities.support_bind);
        HSVM_SetBooleanCell(hsvm, id_set, "CAP_GETDATA_WHEN_BOUND", driver->capabilities.support_getdata_when_bound);
        HSVM_SetBooleanCell(hsvm, id_set, "CAP_GETDATA_ANY_COLUMN", driver->capabilities.support_getdata_anycolumn);

        HSVM_SetBooleanCell(hsvm, id_set, "HS_CONVERT_CHAR_TO_WCHAR", driver->capabilities.support_char_to_wchar);

        //Simple props
        HSVM_SetStringCell (hsvm, id_set, "DATABASE_NAME",          GetDriverInfoStr(handle, SQL_DATABASE_NAME));
        HSVM_SetStringCell (hsvm, id_set, "DATABASE_VERSION",       GetDriverInfoStr(handle, SQL_DBMS_VER));
        HSVM_SetStringCell (hsvm, id_set, "DATABASE_APPLICATION",   GetDriverInfoStr(handle, SQL_DBMS_NAME));
        HSVM_SetStringCell (hsvm, id_set, "DRIVER_NAME",            GetDriverInfoStr(handle, SQL_DRIVER_NAME));
        HSVM_SetStringCell (hsvm, id_set, "DRIVER_VERSION",         GetDriverInfoStr(handle, SQL_DRIVER_VER));
        HSVM_SetStringCell (hsvm, id_set, "DRIVER_ODBC_VERSION",    GetDriverInfoStr(handle, SQL_DRIVER_ODBC_VER));
        HSVM_SetBooleanCell(hsvm, id_set, "READONLY",               GetDriverInfoStr(handle, SQL_DATA_SOURCE_READ_ONLY)=="Y");
        HSVM_SetBooleanCell(hsvm, id_set, "NEED_LONG_DATA_LENGTH",  GetDriverInfoStr(handle, SQL_NEED_LONG_DATA_LEN)=="Y");

        //Analyze the cursors
        std::string dynattr,forwardattr,keysetattr,staticattr;
        SQLUINTEGER cursorcaps = GetDriverInfoUINTEGER(handle, SQL_SCROLL_OPTIONS);

        if (cursorcaps & SQL_SO_DYNAMIC)
            dynattr = CursorAttributes(GetDriverInfoUINTEGER(handle, SQL_DYNAMIC_CURSOR_ATTRIBUTES1), GetDriverInfoUINTEGER(handle, SQL_DYNAMIC_CURSOR_ATTRIBUTES2));
        if (cursorcaps & SQL_SO_FORWARD_ONLY)
            forwardattr = CursorAttributes(GetDriverInfoUINTEGER(handle, SQL_FORWARD_ONLY_CURSOR_ATTRIBUTES1), GetDriverInfoUINTEGER(handle, SQL_FORWARD_ONLY_CURSOR_ATTRIBUTES2));
        if (cursorcaps & SQL_SO_KEYSET_DRIVEN)
            keysetattr = CursorAttributes(GetDriverInfoUINTEGER(handle, SQL_KEYSET_CURSOR_ATTRIBUTES1), GetDriverInfoUINTEGER(handle, SQL_KEYSET_CURSOR_ATTRIBUTES2));
        if (cursorcaps & SQL_SO_STATIC)
            staticattr = CursorAttributes(GetDriverInfoUINTEGER(handle, SQL_STATIC_CURSOR_ATTRIBUTES1), GetDriverInfoUINTEGER(handle, SQL_STATIC_CURSOR_ATTRIBUTES2));

        HSVM_SetStringCell (hsvm, id_set, "POS_OPTIONS",              SetPosCapabilities(GetDriverInfoUINTEGER(handle, SQL_POS_OPERATIONS)));
        HSVM_SetStringCell (hsvm, id_set, "GETDATA_EXTENSIONS",       GetDataExtensions(GetDriverInfoUINTEGER(handle, SQL_GETDATA_EXTENSIONS)));
        HSVM_SetStringCell (hsvm, id_set, "SCROLL_OPTIONS",           CursorCapabilities(cursorcaps));
        HSVM_SetStringCell (hsvm, id_set, "DYNAMIC_ATTRIBUTES",       dynattr);
        HSVM_SetStringCell (hsvm, id_set, "FORWARD_ONLY_ATTRIBUTES",  forwardattr);
        HSVM_SetStringCell (hsvm, id_set, "KEYSET_DRIVEN_ATTRIBUTES", keysetattr);
        HSVM_SetStringCell (hsvm, id_set, "STATIC_ATTRIBUTES",        staticattr);
}

void HS_SQL_ODBC_SetCaps(HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        ODBCTransactionDriver* driver = IsODBCTransaction(hsvm, GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            ThrowDBError("Used a non-ODBC transaction");

        driver->capabilities.support_setpos_position    = HSVM_GetBooleanCell(hsvm, HSVM_Arg(1), "CAP_SETPOS_POSITION");
        driver->capabilities.support_setpos_modify      = HSVM_GetBooleanCell(hsvm, HSVM_Arg(1), "CAP_SETPOS_MODIFY");
        driver->capabilities.support_getdata_when_bound = HSVM_GetBooleanCell(hsvm, HSVM_Arg(1), "CAP_GETDATA_WHEN_BOUND");
        driver->capabilities.support_getdata_anycolumn  = HSVM_GetBooleanCell(hsvm, HSVM_Arg(1), "CAP_GETDATA_ANY_COLUMN");
        driver->capabilities.support_bind               = HSVM_GetBooleanCell(hsvm, HSVM_Arg(1), "CAP_BIND");
}

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
extern "C" {

static void* CreateContext(void *)
{
        ODBCDEBUGPRINT("Got a CreateContext call");
        return new HareScript::SQLLib::ODBC::ODBCProviderContextData;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::SQLLib::ODBC::ODBCProviderContextData*>(context_ptr);
}

} //end extern "C"

extern "C" BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "__STARTODBCTRANSACTION:WH_ODBC:R:R", HareScript::SQLLib::ODBC::HS_SQL_ODBC_StartODBCTransaction);
//        HSVM_RegisterFunction(regdata, "OPENODBCTRANSACTION:WH_ODBC:I:SSS", HareScript::SQLLib::ODBC::HS_SQL_ODBC_Connect);
//        HSVM_RegisterFunction(regdata, "ODBCDRIVERCONNECT:WH_ODBC:R:S", HareScript::SQLLib::ODBC::HS_SQL_ODBC_DriverConnect);
        HSVM_RegisterFunction(regdata, "GETODBCDATASOURCES:WH_ODBC:RA:IS", HareScript::SQLLib::ODBC::GetODBCDataSources);
        HSVM_RegisterFunction(regdata, "__GETODBCTABLES:WH_ODBC:RA:I", HareScript::SQLLib::ODBC::HS_SQL_ODBC_TableList);
        HSVM_RegisterFunction(regdata, "GETODBCCOLUMNS:WH_ODBC:RA:IS", HareScript::SQLLib::ODBC::HS_SQL_ODBC_ColumnList);
        HSVM_RegisterFunction(regdata, "SENDODBCCOMMAND:WH_ODBC:RA:IS", HareScript::SQLLib::ODBC::HS_SQL_ODBC_SendCommand);
        HSVM_RegisterFunction(regdata, "SENDODBCTYPEDCOMMAND:WH_ODBC:RA:ISIA", HareScript::SQLLib::ODBC::HS_SQL_ODBC_SendTypedCommand);
        HSVM_RegisterFunction(regdata, "GETODBCINFO:WH_ODBC:R:I", HareScript::SQLLib::ODBC::HS_SQL_ODBC_GetInfo);
        HSVM_RegisterMacro(regdata, "COMMITODBCTRANSACTION:WH_ODBC::I", HareScript::SQLLib::ODBC::HS_SQL_ODBC_Commit);
        HSVM_RegisterMacro(regdata, "ROLLBACKODBCTRANSACTION:WH_ODBC::I", HareScript::SQLLib::ODBC::HS_SQL_ODBC_Rollback);
        HSVM_RegisterMacro(regdata, "SETODBCCAPABILITIES:WH_ODBC::IR", HareScript::SQLLib::ODBC::HS_SQL_ODBC_SetCaps);

        HSVM_RegisterContext (regdata, HareScript::SQLLib::ODBC::ODBCProviderContextId, NULL, &CreateContext, &DestroyContext);
        return 1;
}
