#include <harescript/vm/allincludes.h>


#include <harescript/vm/hsvm_context.h>
#include "odbc_base.h"
#include "odbc_binder.h"

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

void ThrowDBError(const char *cstr)
{
        throw VMRuntimeError (Error::DatabaseException, cstr);
}

std::string GetDiagnostics(SQLSMALLINT handletype, SQLHANDLE handle)
{
        std::string msg;

        SQLCHAR state[6];
        SQLCHAR msgbuffer[4096];
        SQLINTEGER errorcode;
        SQLSMALLINT msglen;

        SQLSMALLINT recnr = 0;
        while (true)
        {
                SQLRETURN retval;
                retval = SQLGetDiagRecA(handletype, handle, ++recnr, state, &errorcode, msgbuffer, sizeof(msgbuffer), &msglen);
                if (retval == SQL_NO_DATA)
                    break;

                // Make sure strings are terminated
                state[5] = '\0';
                msgbuffer[4095] = '\0';

                if (recnr != 1) msg += " - ";

                if (retval == SQL_INVALID_HANDLE)
                {
                        msg += "Invalid handle";
                        break;
                }

                msg = msg + "[" + std::string((const char *)state) + "] " +
                        std::string((const char *)msgbuffer, (const char *)(msgbuffer + std::min<int>(sizeof(msgbuffer), msglen)));
        }

        if (msg == "") msg = "no diagnostics";

        return msg;
}

std::string GetSQLErrorState(SQLSMALLINT handletype, SQLHANDLE handle)
{
        SQLCHAR state[6];

        SQLRETURN retval = SQLGetDiagRecA(handletype, handle, 1, state, 0, 0, 0, 0);
        CheckRetval(handle, retval, "Could not get SQLState");
        state[5] = '\0';

        return std::string((const char *)state);
}

std::string GetDriverInfoStr(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType)
{
        SQLCHAR msgbuffer[1024];
        SQLSMALLINT retlen = sizeof(msgbuffer);
        SQLRETURN retval = SQLGetInfo(ConnectionHandle, InfoType, msgbuffer, retlen, &retlen);
        if (IsError(retval)) return GetDiagnostics(SQL_HANDLE_DBC, ConnectionHandle);
        return std::string((const char *)msgbuffer, (const char *)msgbuffer + retlen);
}

SQLUSMALLINT GetDriverInfoUSMALLINT(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType)
{
        SQLUSMALLINT buffer;
        SQLSMALLINT retlen;
        /*SQLRETURN retval = */SQLGetInfo(ConnectionHandle, InfoType, &buffer, sizeof(buffer), &retlen);
        //FIXME://if (IsError(retval)) std::cout << GetDiagnostics(SQL_HANDLE_DBC, ConnectionHandle);
        return buffer;
}

SQLUINTEGER GetDriverInfoUINTEGER(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType)
{
        SQLUINTEGER buffer;
        SQLSMALLINT retlen;
        /*SQLRETURN retval = */SQLGetInfo(ConnectionHandle, InfoType, &buffer, sizeof(buffer), &retlen);
        //FIXME: if (IsError(retval)) std::cout << GetDiagnostics(SQL_HANDLE_DBC, ConnectionHandle);
        return buffer;
}

void ThrowStatementError(SQLHSTMT stmt, const char *error)
{
        ThrowDBError(std::string(error) + ": " + GetDiagnostics(SQL_HANDLE_STMT, stmt));
}

std::string ToStlString(const char *x) { std::string y; y = x; return y; }

void CheckRetval(SQLHSTMT stmt, SQLRETURN retval, const char *error)
{
        if (retval != SQL_SUCCESS)
        {
                std::string stl_error = error;
                stl_error = stl_error + " (" + ErrorCodeString(retval) + ")";
                if (retval != SQL_SUCCESS_WITH_INFO)
                    ThrowStatementError(stmt, stl_error.c_str());
//                else DEBUGPRINT("SuccessWithInfo: "<< stl_error << ": " << GetDiagnostics(SQL_HANDLE_STMT, stmt));
        }
}

std::string ErrorCodeString(SQLRETURN retval)
{
        #define CASE(a) case a: return #a;
        switch (retval)
        {
        CASE(SQL_SUCCESS);
        CASE(SQL_SUCCESS_WITH_INFO);
        CASE(SQL_NO_DATA);
        CASE(SQL_ERROR);
        CASE(SQL_INVALID_HANDLE);
        CASE(SQL_STILL_EXECUTING);
        CASE(SQL_NEED_DATA);
        default: ;
        }
        return "unknown error code";
}
std::string SQLTypeString(SQLSMALLINT type)
{
        #define CASE(a) case a: return #a;
        switch (type)
        {
        CASE(SQL_UNKNOWN_TYPE);
        CASE(SQL_CHAR);
        CASE(SQL_WCHAR);
        CASE(SQL_NUMERIC);
        CASE(SQL_DECIMAL);
        CASE(SQL_INTEGER);
        CASE(SQL_SMALLINT);
        CASE(SQL_FLOAT);
        CASE(SQL_REAL);
        CASE(SQL_DOUBLE);
        CASE(SQL_DATETIME);
        CASE(SQL_VARCHAR);
        CASE(SQL_WVARCHAR);
//        CASE(SQL_DATE);
        CASE(SQL_INTERVAL);
//        CASE(SQL_TIME);
        CASE(SQL_TIMESTAMP);
        CASE(SQL_LONGVARCHAR);
        CASE(SQL_WLONGVARCHAR);
        CASE(SQL_BINARY);
        CASE(SQL_VARBINARY);
        CASE(SQL_LONGVARBINARY);
        CASE(SQL_BIGINT);
        CASE(SQL_TINYINT);
        CASE(SQL_BIT);
        CASE(SQL_GUID);
        CASE(SQL_TYPE_DATE);
        CASE(SQL_TYPE_TIME);
        CASE(SQL_TYPE_TIMESTAMP);
        default: ;
        }
        return "unknown type";
}

std::string SQLCTypeString(SQLSMALLINT type)
{
        #define CASE(a) case a: return #a;
        switch (type)
        {
        CASE(SQL_C_CHAR);
        CASE(SQL_C_WCHAR);
        CASE(SQL_C_SSHORT);
        CASE(SQL_C_USHORT);
        CASE(SQL_C_SLONG);
        CASE(SQL_C_ULONG);
        CASE(SQL_C_FLOAT);
        CASE(SQL_C_DOUBLE);
        CASE(SQL_C_BIT);
        CASE(SQL_C_STINYINT);
        CASE(SQL_C_UTINYINT);
        CASE(SQL_C_SBIGINT);
        CASE(SQL_C_UBIGINT);
        CASE(SQL_C_BINARY);
        CASE(SQL_C_TYPE_DATE);
        CASE(SQL_C_TYPE_TIME);
        CASE(SQL_C_TYPE_TIMESTAMP);
        CASE(SQL_C_NUMERIC);
        CASE(SQL_C_GUID);
        default: ;
        }
        return "unknown type";
}

std::string SQLCursorTypeString(SQLINTEGER type)
{
        #define CASE(a) case a: return #a;
        switch (type)
        {
        CASE(SQL_CURSOR_FORWARD_ONLY);
        CASE(SQL_CURSOR_STATIC);
        CASE(SQL_CURSOR_KEYSET_DRIVEN);
        CASE(SQL_CURSOR_DYNAMIC);
        default: ;
        }
        return "unknown type";
}

SQLHSTMT AllocateStmtHandle(SQLHDBC hdbc)
{
        SQLHSTMT stmt;

        SQLRETURN retval = SQLAllocHandle(SQL_HANDLE_STMT, hdbc, &stmt);
        if (IsError(retval))
            ThrowDBError(std::string("Could not allocate statement handle") + " (" + ErrorCodeString(retval) + "): " + GetDiagnostics(SQL_HANDLE_DBC, hdbc));

        return stmt;
}

void GetRawResultSet(VarId id_set, VirtualMachine *vm, Capabilities const &capabilities, SQLHSTMT stat, Blex::Charsets::Charset charset, ODBCWorkarounds::_type workarounds)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.ArrayInitialize(id_set, 0, VariableTypes::RecordArray);

        ResultSet rset(vm, capabilities, stat, charset, workarounds);
        unsigned rows;
        unsigned colcount = rset.ColumnCount();
        while ((rows = rset.NextBlock()) != 0)
        {
                for (unsigned row = 1; row <= rows; ++row)
                {
                        VarId rec = stackm.ArrayElementAppend(id_set);
                        stackm.RecordInitializeEmpty(rec);

                        for (unsigned col = 1; col <= colcount; ++col)
                        {
                                VarId cell = stackm.RecordCellCreate(rec, rset.GetColumnData(col).nameid);
                                rset.Get(row, col, cell);
                        }
                }
        }
}

VariableTypes::Type CalcPreferredHSType(SQLSMALLINT sqltype)
{
        switch (sqltype)
        {
        case SQL_CHAR:          return VariableTypes::String;
        case SQL_WCHAR:         return VariableTypes::String;
        case SQL_NUMERIC:       return VariableTypes::Money;
        case SQL_DECIMAL:       return VariableTypes::Money;
        case SQL_INTEGER:       return VariableTypes::Integer;
        case SQL_SMALLINT:      return VariableTypes::Integer;
        case SQL_FLOAT:         return VariableTypes::Float;
        case SQL_REAL:          return VariableTypes::Float;
        case SQL_DOUBLE:        return VariableTypes::Float;
        case SQL_DATETIME:      return VariableTypes::DateTime;
        case SQL_VARCHAR:       return VariableTypes::String;
        case SQL_WVARCHAR:      return VariableTypes::String;

        case SQL_LONGVARCHAR:   return VariableTypes::String; // FIXME: appropriate?
        case SQL_WLONGVARCHAR:  return VariableTypes::String; // FIXME: appropriate?
        case SQL_BINARY:        return VariableTypes::Blob;
        case SQL_VARBINARY:     return VariableTypes::Blob;
        case SQL_LONGVARBINARY: return VariableTypes::Blob;
        case SQL_BIGINT:        return VariableTypes::Integer; // FIXME: appropriate?
        case SQL_BIT:           return VariableTypes::Boolean;
        case SQL_TINYINT:       return VariableTypes::Integer;
        case SQL_GUID:          return VariableTypes::String;
        case SQL_TIME:          return VariableTypes::DateTime;
        case SQL_TIMESTAMP:     return VariableTypes::DateTime;
        case SQL_TYPE_DATE:     return VariableTypes::DateTime;
        case SQL_TYPE_TIME:     return VariableTypes::Integer;
        case SQL_TYPE_TIMESTAMP:return VariableTypes::DateTime;
        default:
            return VariableTypes::Blob;
        }
}

SQLSMALLINT CalcSQLCDataType(VariableTypes::Type hs_type, SQLSMALLINT ctype, Capabilities const &/*capabilities*/, bool want_ansi, ODBCWorkarounds::_type workarounds)
{
        switch (hs_type)
        {
        case VariableTypes::String:     return want_ansi ? SQL_C_CHAR : SQL_C_WCHAR;
        case VariableTypes::Integer:
                {
                        if (ctype == SQL_TYPE_TIME)
                            return SQL_C_TYPE_TIME;
                        return SQL_C_SLONG;
                }
        case VariableTypes::Boolean:    return SQL_C_BIT;
        case VariableTypes::DateTime:   return SQL_C_TYPE_TIMESTAMP;
        case VariableTypes::Money:      return workarounds & ODBCWorkarounds::NumericViaString ? SQL_C_CHAR : SQL_C_NUMERIC; //Warning: ODBC cursor library cannot handle SQL_C_NUMERIC due to bugs.
        case VariableTypes::Float:      return SQL_C_DOUBLE;
        case VariableTypes::Blob:       return SQL_C_BINARY;
        default:
            ThrowDBError(("ODBC cannot handle variables of type " + HareScript::GetTypeName(hs_type)).c_str());
        }
        return SQL_C_BINARY;
}

unsigned CalcAlignment(SQLSMALLINT ctype)
{
        switch (ctype)
        {
        case SQL_C_CHAR:                return 1;
        case SQL_C_WCHAR:               return sizeof(SQLWCHAR);
        case SQL_C_SLONG:               return sizeof(SQL_C_SLONG);
        case SQL_C_BIT:                 return 1;
        case SQL_C_TYPE_TIME:           return std::max(sizeof(SQLUSMALLINT), sizeof(SQLUINTEGER));
        case SQL_C_TYPE_TIMESTAMP:      return std::max(sizeof(SQLUSMALLINT), sizeof(SQLUINTEGER));
        case SQL_C_NUMERIC:             return std::max(sizeof(SQLSCHAR), sizeof(SQLCHAR));
        case SQL_C_DOUBLE:              return sizeof(double);
        case SQL_C_BINARY:              return 1;
        default:
            ThrowDBError("Calculating alignment of unsupported SQL C data type");
        }
        return 1;
}

unsigned CalcBufferSize(SQLSMALLINT ctype, unsigned columnsize)
{
        // always add a character for trailing 0 bytes
        switch (ctype)
        {
        case SQL_C_CHAR:                columnsize = columnsize * 2 >= MaxColBufferSize ? MaxColBufferSize : columnsize * 2 + 2; break;
        case SQL_C_WCHAR:               columnsize = columnsize * 2 >= MaxColBufferSize ? MaxColBufferSize : columnsize * 2 + 2; break;
        case SQL_C_SLONG:               columnsize = sizeof(SQLINTEGER); break;
        case SQL_C_BIT:                 columnsize = sizeof(SQLCHAR); break;
        case SQL_C_TYPE_TIME:           columnsize = sizeof(SQL_TIME_STRUCT); break;
        case SQL_C_TYPE_TIMESTAMP:      columnsize = sizeof(SQL_TIMESTAMP_STRUCT); break;
        case SQL_C_NUMERIC:             columnsize = sizeof(SQL_NUMERIC_STRUCT); break;
        case SQL_C_DOUBLE:              columnsize = sizeof(SQLDOUBLE); break;
        case SQL_C_BINARY:              columnsize = columnsize * 2 >= MaxColBufferSize ? MaxColBufferSize : columnsize * 2 + 2; break;
        default:
            ThrowDBError("Calculating alignment of unsupported SQL C data type");
        }

        // round up to next multiple of 4
        columnsize += 3;
        columnsize -= columnsize % 4;
        return columnsize;
}

SQLSMALLINT CalcSQLTypeFromCType(SQLSMALLINT ctype, unsigned datasize)
{
        switch (ctype)
        {
                /* Oracle sends us a ORA-01461
                   'Kan een LONG-waarde alleen binden voor het invoegen in een LONG-kolom.'
                   if we dare to insert SQL_WLONGVARCHARs. I can't find the
                   limit for the lesser types (ADDME: right cutoff point?) so
                   we'll just try to downgrade our type selector.

                   This function is only used in the ExecuteStatement for INSERTs.
                   Perhaps we can first describe the columns after  */
        case SQL_C_CHAR:                return datasize < 256 ? SQL_VARCHAR : SQL_LONGVARCHAR;
        case SQL_C_WCHAR:               return datasize < 256 ? SQL_WVARCHAR : SQL_WLONGVARCHAR;
        case SQL_C_SLONG:               return SQL_INTEGER;
        case SQL_C_BIT:                 return SQL_CHAR;
        case SQL_C_TYPE_TIME:           return SQL_TYPE_TIME;
        case SQL_C_TYPE_TIMESTAMP:      return SQL_TIMESTAMP;
        case SQL_C_NUMERIC:             return SQL_NUMERIC;
        case SQL_C_DOUBLE:              return SQL_DOUBLE;
        case SQL_C_BINARY:              return SQL_LONGVARBINARY;
        default:
            ThrowDBError("Calculating alignment of unsupported SQL C data type");
        }
        return SQL_BINARY;
}

SQLINTEGER GetCursorId(ODBCCursorType::_type type)
{
        switch (type)
        {
        case ODBCCursorType::Forward:   return SQL_CURSOR_FORWARD_ONLY;
        case ODBCCursorType::Static:    return SQL_CURSOR_STATIC;
        case ODBCCursorType::Keyset:    return SQL_CURSOR_KEYSET_DRIVEN;
        case ODBCCursorType::Dynamic:   return SQL_CURSOR_DYNAMIC;
        default: ;
        }
        return SQL_CURSOR_STATIC;
}

unsigned Align(unsigned org, unsigned align)
{
        unsigned extra = org % align;
        if (extra)
            return org + align - extra;
        else
            return org;
}

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript

