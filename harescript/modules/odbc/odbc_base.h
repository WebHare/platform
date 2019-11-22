#ifndef blex_webhare_harescript_modules_odbc_odbc_constants
#define blex_webhare_harescript_modules_odbc_odbc_constants
//---------------------------------------------------------------------------

#include <sql.h>
#include <sqlext.h>
#include <sqlucode.h>

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

/** Maximum number of rows retrieved in a fetch */
static const unsigned MaxRows = 8;

/** Maximum length of names (column and table names may not be larger than this)
    Look out; errors have been observed with high values. 1024 works at the moment */
static const unsigned MaxNamesLen = 1024;

/** Maximum size of a column buffer - must be a multiple of 4  */
static const unsigned MaxColBufferSize = 65536;

/** Returns wether a SQL return code does not signal a succes condition */
bool inline IsError(SQLRETURN retval)
{
        return !SQL_SUCCEEDED(retval);
}

namespace ODBCCursorType
{
enum _type
{
        Forward = 0,
        Static,
        Keyset,
        Dynamic,
        _min = Forward,
        _max = Dynamic
};
} // End of namespace ODBCCursorType

namespace ODBCWorkarounds
{
enum _type
{
        None =                      0,
        DoubleEncodedUTF8Strings =  1, // Strings in db are stored utf-8 encoded within unicode (need extra encode/decode ops)
        NumericViaString =          2, // Reading numeric via SQL_NUMERIC_STRUCT doesn't work properly
};
} // End of namespace ODBCWorkarounds

struct Capabilities
{
        /// True if this SQL connection supports SQLSetPos
        bool support_setpos_position;
        bool support_setpos_modify;

        /// True if this SQL connection allows to both bind to a column and use it for SQLGetData when it overflows (Oracle doesn't allow this)
        bool support_getdata_when_bound;

        /// True if this SQL connection requires specific column ordering, hindering raw SQL command results
        bool support_getdata_anycolumn;

        /// True if this SQL connection supports binding at all (all do, I think. this just helps stress testing)
        bool support_bind;

        /// Type of cursor to use for selecting
        ODBCCursorType::_type select_cursor;

        /// Type of cursor to use for modifying
        ODBCCursorType::_type modify_cursor;

        /// Does not support HareSCript native interface
        bool harescript_challenged;
        /// Supports char->wchar conversion
        bool support_char_to_wchar;

//        bool support_keysetcursors;
//        bool support_write;
//        bool support_like; // Warning: ODBC uses % and _ as wildcards!
};

/** Translates SQL return codes (SQL_SUCCESS, SQL_NO_DATA, etc) to readable strings
    @param retval SQL return code
    @return Name representation of return code */
std::string ErrorCodeString(SQLRETURN retval);

/** Translates a SQL type codes (SQL_INTEGER, SQL_VARCHAR, etc) to readable strings)
    @param type SQL type code
    @return NAme representation of type code */
std::string SQLTypeString(SQLSMALLINT type);

/** Translates a SQL C type codes (SQL_C_INTEGER, SQL_C_CHAR, etc) to readable strings)
    @param type SQL type code
    @return Name representation of type code */
std::string SQLCTypeString(SQLSMALLINT type);

/** Translates a SQL cursort type code (SQL_CURSOR_XXX) to a readable string)
    @param type Type of cursor
    @return Name of the cursor */
std::string SQLCursorTypeString(SQLINTEGER type);

// Diagnostics
std::string GetDiagnostics(SQLSMALLINT handletype, SQLHANDLE handle);
std::string GetSQLErrorState(SQLSMALLINT handletype, SQLHANDLE handle);

// Driver info
std::string GetDriverInfoStr(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType);
SQLUSMALLINT GetDriverInfoUSMALLINT(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType);
SQLUINTEGER GetDriverInfoUINTEGER(SQLHDBC ConnectionHandle, SQLUSMALLINT InfoType);

// Signalling of errors
void ThrowDBError(const char *cstr);
void ThrowStatementError(SQLHSTMT stmt, const char *error);
void CheckRetval(SQLHSTMT stmt, SQLRETURN retval, const char *error);

inline void ThrowDBError(std::string const &str) { ThrowDBError(str.c_str()); }
inline void ThrowStatementError(SQLHSTMT stmt, std::string const &error) { ThrowStatementError(stmt, error.c_str()); }

// SQL stuff
SQLHSTMT AllocateStmtHandle(SQLHDBC hdbc);

/** Reads out a result set in a record array (all strings)
    @param id_set Variable where the record array must be stored in
    @param vm VM where id_set exists
    @param stat Statement handle that has the return set */
void GetRawResultSet(VarId id_set, VirtualMachine *vm, Capabilities const &capabilities, SQLHSTMT stat, Blex::Charsets::Charset charset, ODBCWorkarounds::_type workarounds);

VariableTypes::Type CalcPreferredHSType(SQLSMALLINT sqltype);

SQLSMALLINT CalcSQLCDataType(VariableTypes::Type hs_type, SQLSMALLINT ctype, Capabilities const &capabilities, bool want_ansi, ODBCWorkarounds::_type workarounds);
SQLSMALLINT CalcSQLTypeFromCType(SQLSMALLINT ctype, unsigned datasize);
unsigned CalcBufferSize(SQLSMALLINT ctype, unsigned columnsize);

unsigned CalcAlignment(SQLSMALLINT ctype);

inline ODBCCursorType::_type & operator ++(ODBCCursorType::_type &type)
{
    switch (type)
    {
    case ODBCCursorType::Forward:       type = ODBCCursorType::Static;
    case ODBCCursorType::Static:        type = ODBCCursorType::Keyset;
    case ODBCCursorType::Keyset:        type = ODBCCursorType::Dynamic;
    default : type = ODBCCursorType::Dynamic;
    }
    return type;
}

inline ODBCCursorType::_type & operator --(ODBCCursorType::_type &type)
{
    switch (type)
    {
    case ODBCCursorType::Static:        type = ODBCCursorType::Forward;
    case ODBCCursorType::Keyset:        type = ODBCCursorType::Static;
    case ODBCCursorType::Dynamic:       type = ODBCCursorType::Keyset;
    default : type = ODBCCursorType::Forward;
    }
    return type;
}


SQLINTEGER GetCursorId(ODBCCursorType::_type type);

unsigned Align(unsigned org, unsigned align);

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif


