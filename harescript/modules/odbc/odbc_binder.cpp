#include <harescript/vm/allincludes.h>


#include <blex/unicode.h>
#include <harescript/vm/hsvm_context.h>
#include "odbc_binder.h"
#include "odbc_base.h"
#include <time.h>
#include <blex/decimalfloat.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>

/* ADDME: A possible optimization for the binder, is to, if it knows that
          a text column can only be ANSI, to bind it as an ANSI field instead
          of Unicode (this is an optimization suggeste by the MS ODBC Help,
          not sure how feasibly it really is in practice..) */

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

ResultSet::ResultSet(VirtualMachine *_vm, Capabilities const &capabilities, SQLHSTMT _stat, Blex::Charsets::Charset _charset, ODBCWorkarounds::_type _workarounds)
: vm(_vm)
, stat(SQL_NULL_HANDLE)
, charset(_charset)
, workarounds(_workarounds)
, rowdata_size(0)
, ind_array_start(0)
, data(0)
, blockrowcount(0)
, capabilities(capabilities)
{
        max_align = sizeof(SQLINTEGER);

        // Allow for at least 16 columns without resize; is faster
        columns.reserve(16);

        // Auto describe and finalize if requested
        if (_stat != SQL_NULL_HANDLE)
        {
                SQLSMALLINT colcount;
                CheckRetval(stat, SQLNumResultCols(_stat, &colcount), "Could not get number of result columns");

                for (SQLSMALLINT idx = 0; idx < colcount; ++idx)
                    AddColumn(VariableTypes::Uninitialized, BindType::TryBind);

                DecideBindings();
                Bind(_stat, 1);
        }
}
/*
ResultSet::ResultSet(ResultSet const &rhs)
: vm(rhs.vm)
, stackm(vm->GetStackMachine())
, stat(SQL_NULL_HANDLE)
, rowdata_size(0)
, ind_array_start(0)
, data(0)
, blockrowcount(0)
, columns(rhs.columns)
, capabilities(rhs.capabilities)
{
        if (rhs.stat != SQL_NULL_HANDLE)
            ThrowDBError("Cannot copy an already bound resultset");
}
*/

void ResultSet::CheckAllowedTypes(VariableTypes::Type hstype)
{
        switch (hstype)
        {
        case VariableTypes::Integer:
        case VariableTypes::Float:
        case VariableTypes::Boolean:
        case VariableTypes::DateTime:
        case VariableTypes::Money:
        case VariableTypes::Blob:
        case VariableTypes::String:     return;
        default: ;
            ThrowDBError("ODBC cannot retrieve columns with as HareScript type " + HareScript::GetTypeName(hstype));
        }
}

void ResultSet::DecideBindings()
{
        /* For every column, figure out if it should or shouldn't be bound */
        bool stop_all_binds = false;
        std::vector<unsigned> override_non_bind;
        for (std::vector< Column >::iterator it = columns.begin(); it != columns.end(); ++it)
        {
                bool bind = capabilities.support_bind && !stop_all_binds && it->bindtype!=BindType::NeverBind;

                /* We can't bind any more columns after a nonbound column, if support_getdata_anycolumn is false */
                if (!bind && !capabilities.support_getdata_anycolumn)
                    stop_all_binds = true;

                if (!bind && it->bindtype==BindType::MustBind)
                    ThrowDBError("Query too complex - we need to bind columns, but it is not supported by the database driver");

                it->bind_column = bind;
                it->bind_write_only = false;
        }
}

void ResultSet::FinalizeColumnBindings()
{
        SQLSMALLINT idx = 1;
        for (std::vector< Column >::iterator it = columns.begin(); it != columns.end(); ++it, ++idx)
        {
                SQLSMALLINT namelen;
                SQLSMALLINT decimaldigits;
                SQLSMALLINT nullable;

                if (charset != Blex::Charsets::Unicode)
                {
                        char tempname[MaxNamesLen];
                        CheckRetval(stat,
                                SQLDescribeColA(
                                        stat,
                                        idx,
                                        reinterpret_cast< SQLCHAR * >(tempname),
                                        sizeof tempname,
                                        &namelen,
                                        &it->sqldatatype,
                                        &it->columnsize,
                                        &decimaldigits,
                                        &nullable),
                                "Could not get returnset column description");

                        Blex::ConvertCharsetToUTF8(tempname, tempname + namelen, charset, &it->name);
                }
                else
                {
                        SQLWCHAR tempname[MaxNamesLen];
                        CheckRetval(stat,
                                SQLDescribeColW(
                                        stat,
                                        idx,
                                        tempname,
                                        sizeof tempname,
                                        &namelen,
                                        &it->sqldatatype,
                                        &it->columnsize,
                                        &decimaldigits,
                                        &nullable),
                                "Could not get returnset column description");

                        Blex::UTF8Decode(tempname, tempname+namelen, std::back_inserter(it->name));
                }

                if (it->hstype == VariableTypes::Uninitialized)
                    it->hstype = CalcPreferredHSType(it->sqldatatype);

                CheckAllowedTypes(it->hstype);

                it->cdatatype = CalcSQLCDataType(it->hstype, it->sqldatatype, capabilities, charset != Blex::Charsets::Unicode, workarounds);
                it->buffersize = CalcBufferSize(it->cdatatype, it->columnsize);

//                DEBUGPRINT("Column "<< it->name
//                    << " type " << it->sqldatatype << " " << SQLTypeString(it->sqldatatype)
//                    << " ctype " << it->cdatatype << " " << SQLCTypeString(it->cdatatype));

                it->name.resize(namelen);
                Blex::ToUppercase(it->name.begin(), it->name.end());
                it->nameid = vm->columnnamemapper.GetMapping(it->name); //ADDME: This mapping should've been done ages ago, at least for TableDef columns?

                if (it->bind_column) // Do we need to allocate a buffer in the row?
                {
                        // Do alignment calcing
                        unsigned align = CalcAlignment(it->cdatatype);
                        rowdata_size = Align(rowdata_size, align);
                        max_align = std::max(max_align, align);
                        it->data_offset = rowdata_size;
                        rowdata_size += it->buffersize;
                }
        }
}

void ResultSet::AddColumn(VariableTypes::Type castto, BindType::Type bindtype)
{
        if (stat != SQL_NULL_HANDLE)
            ThrowDBError("Cannot change an already bound resultset");

        Column col;

        col.hstype = castto;
        col.bindtype = bindtype;

        columns.push_back(col);
}

void ResultSet::Bind(SQLHSTMT _stat, unsigned maxblockrows)
{
        if (stat != SQL_NULL_HANDLE)
            ThrowDBError("Binding already bound resultset description");

        // Set stat now; ColumnCount() needs it
        stat = _stat;

        if (columns.size() != ColumnCount())
        {
                stat = SQL_NULL_HANDLE; // Roll back Bind changes
                ThrowDBError("Binding without having specified all columns");
        }

        max_align = std::max(sizeof(SQLINTEGER), sizeof(SQLLEN));
        FinalizeColumnBindings();

        rowdata_size = Align(rowdata_size, sizeof(SQLLEN));
        ind_array_start = rowdata_size;

        rowdata_size += sizeof(SQLLEN) * columns.size();
        rowdata_size = Align(rowdata_size, max_align);

        /* FIXME: Weird; ODBC overruns the buffer with 8 bytes (and corrupts the heap in the process...). FInd out WHY
           20120327: Does not happen with a select in the MySQL connector in linux after the rowdata size fixes
        */
        unsigned total_size = rowdata_size * maxblockrows;

        data = new SQLCHAR[total_size];

        CheckRetval(stat, SQLSetStmtAttr(stat, SQL_ATTR_ROW_BIND_TYPE, (void *)(long)rowdata_size, 0), "Could not set row-wise binding");
        CheckRetval(stat, SQLSetStmtAttr(stat, SQL_ATTR_ROW_ARRAY_SIZE, (void *)(long)maxblockrows, 0), "Could not set block cursor size");
        CheckRetval(stat, SQLSetStmtAttr(stat, SQL_ATTR_ROWS_FETCHED_PTR, &blockrowcount, 0), "Could not set ptr to number of retrieved blocks");

        SQLLEN *ind = (SQLLEN *)(data + ind_array_start);


        // IRD and ARD descriptors, defer fetching them until we need them (they break ODBC 2.5 drivers).
        SQLHDESC desc_ird = 0;
        SQLHDESC desc_ard = 0;

        // Bind all bound columns, and set precision/scale for money types
        SQLSMALLINT idx = 1;
        for (std::vector< Column >::iterator it = columns.begin(); it != columns.end(); ++it, ++ind, ++idx)
        {
//                DEBUGPRINT("Column " << vm->columnnamemapper.GetReverseMapping(it->nameid).stl_str() << " bind: "<<(it->bind_column?"yes":"no"));
                if (it->hstype == VariableTypes::Money && !(workarounds & ODBCWorkarounds::NumericViaString))
                {
                        if (desc_ird == 0 || desc_ard == 0)
                        {
                                CheckRetval(stat, SQLGetStmtAttr(stat, SQL_ATTR_IMP_ROW_DESC, &desc_ird, 0, 0), "Could not get implicit rowset descriptor");
                                CheckRetval(stat, SQLGetStmtAttr(stat, SQL_ATTR_APP_ROW_DESC, &desc_ard, 0, 0), "Could not get application rowset descriptor");
                        }

                        // Setting the scale
                        // querying the field with SQLGetDescField doesn't work either.
                        // using fixed precision and scale for money for now.

                        // Retrieve the precision and scale from the IRD
                        SQLRETURN retval =
                                SQLGetDescRec(desc_ird, idx,
                                        0, // Name
                                        0, // Buffer length
                                        0, // String length ptr
                                        0, // Type ptr
                                        0, // Subtype ptr
                                        0, // Length ptr
                                        &it->precision,
                                        &it->scale,
                                        0); // Nullable

                        if (IsError(retval))
                            ThrowDBError("Could not retrieve precision and scale: " + GetDiagnostics(SQL_HANDLE_DESC, desc_ird));

                        /* Warning: the ODBC cursor library resets the ARD with every call to FetchScroll. Probably
                           the whole ARD needs to be reset to the needed parameters afterwards, and SQLBindCol cannot
                           be used; a real problem for updating... */
                        if (it->bind_column)
                            CheckRetval(stat, SQLBindCol(stat, idx, it->cdatatype, data + it->data_offset, it->buffersize, ind), "Could not bind column");

                        // Set the precision and scale in the ARD (for retrieval with SQLGetData)
                        CheckRetval(stat, SQLSetDescField(desc_ard, (SQLSMALLINT)idx, SQL_DESC_TYPE, (void *)SQL_C_NUMERIC, SQL_IS_SMALLINT), "Could not set internal retrieval type");
                        CheckRetval(stat, SQLSetDescField(desc_ard, (SQLSMALLINT)idx, SQL_DESC_CONCISE_TYPE, (void *)SQL_C_NUMERIC, SQL_IS_SMALLINT), "Could not set internal retrieval type");
                        CheckRetval(stat, SQLSetDescField(desc_ard, (SQLSMALLINT)idx, SQL_DESC_PRECISION, (void *)(long)it->precision, SQL_IS_SMALLINT), "Could not set required precision");
                        CheckRetval(stat, SQLSetDescField(desc_ard, (SQLSMALLINT)idx, SQL_DESC_SCALE, (void *)(long)it->scale, SQL_IS_SMALLINT), "Could not set required scale");

                }
                else if (it->bind_column)
                {
                        CheckRetval(stat, SQLBindCol(stat, idx, it->cdatatype, data + it->data_offset, it->buffersize, ind), "Could not bind column");
                }
        }

}

ResultSet::~ResultSet()
{
        if (data) delete[] data;
}

namespace
{
void NumericScaleDown(SQL_NUMERIC_STRUCT &ns)
{
        assert(ns.scale > 6);

        if (ns.sign != 1) // Negative; add 9 to u128 to round up (instead of down)
        {
                uint64_t value = Blex::getu64lsb(ns.val) + 9;
                Blex::putu64lsb(ns.val, value);
                if (value < 9)
                    Blex::putu64lsb(ns.val + 8, Blex::getu64lsb(ns.val + 8) + 1);
        }

        uint64_t rest = 0;
        for (signed idx = 3; idx >= 0; --idx)
        {
                uint64_t value = (Blex::getu32lsb(ns.val + idx * 4)) + (rest << 32);
                rest = value % 10;
                Blex::putu32lsb(ns.val + idx * 4, (uint32_t)(value / 10));
        }
        --ns.scale;
}

void WorkaroundDoubleDecodeUTF8(std::string *str)
{
        /* Workaround for UTF-8 encoded payload in UTF-16 data. Normal readout
           encodes the UTF-16 codepoints as UTF-8, but this results in double encoding.
           This function reverses one of the encodings.

           Also, as seem in shopman databases, it seems that the UTF-8 bytes of the first
           encoding are converted from CP1252 to Unicode codepoints.

           EG: \u20AC (euro sign), in UTF-8: E2 82 AC
           Stored in MySQL with WCHARS:  00E2 201A 00AC
           The 201A is the Unicode CP for 82 in CP1252 (see https://www.i18nqa.com/debug/utf8-debug.html)

           If at the decoding we encounter a CP above 256, it is not a valid UTF-8
           encoding character, so we treat it as a CP and convert to CP1252
        */
        Blex::SemiStaticPodVector< unsigned, 4096 > double_decode;

        Blex::UTF8Decode(str->begin(), str->end(), std::back_inserter(double_decode));
        str->clear();

        for (auto itr: double_decode)
        {
                // Bigger than 256? Probably charset 1252 converted to unicode
                if (itr < 256)
                    str->push_back(itr);
                else
                {
                        // Max 6 bytes for utf-8 encoding
                        char decodebuf[6];
                        auto decodebufend = Blex::UTF8Encode(&itr, &itr + 1, decodebuf);
                        Blex::ConvertUTF8ToCharset(decodebuf, decodebufend, Blex::Charsets::CP1252, str);
                }
        }
}

} // End of anonymous namespace

bool ResultSet::Get(unsigned row, unsigned column, VarId id_set)
{
        if (stat == SQL_NULL_HANDLE)
            ThrowDBError("Using unbound resultset");

        if (row == 0 || row > blockrowcount)
            ThrowDBError("Illegal row index used for retrieving values");

        if (column == 0 || column > columns.size())
            ThrowDBError("Illegal column index used for retrieving values");

//        DEBUGPRINT("GET ROW " << row << " COLUMN " << column);

        Column &coldata = columns[column - 1];

        Blex::PodVector< uint8_t > tempbuffer;
        uint8_t *colbuffer;
        if (coldata.bind_column)
            colbuffer = data + (row - 1) * rowdata_size + coldata.data_offset;
        else
        {
                tempbuffer.resize(MaxColBufferSize);
                colbuffer = &*tempbuffer.begin();
        }

        SQLLEN *ind = (SQLLEN *)(data + (row - 1) * rowdata_size + ind_array_start) + (column - 1);

        SQLRETURN retval = SQL_SUCCESS;

        if (!coldata.bind_column)
        {
                PositionCursor(row);
                *ind = coldata.columnsize;

                if (coldata.hstype == VariableTypes::Money && !(workarounds & ODBCWorkarounds::NumericViaString))
                {
                        retval = SQLGetData(
                                    stat,
                                    (SQLUSMALLINT)column,
                                    SQL_ARD_TYPE,
                                    colbuffer,
                                    coldata.buffersize,
                                    ind);
                }
                else
                {
                        retval = SQLGetData(
                                    stat,
                                    (SQLUSMALLINT)column,
                                    coldata.cdatatype,
                                    colbuffer,
                                    coldata.buffersize,
                                    ind);
                }
//                DEBUGPRINT("Retrieved data; length: " << *ind);
                // Ignore truncated fileds if we're gonna retrieve it later
                if (retval != SQL_SUCCESS_WITH_INFO || GetSQLErrorState(SQL_HANDLE_STMT, stat) == "01004" ||
                        (coldata.hstype != VariableTypes::Blob && coldata.hstype != VariableTypes::String))
                    CheckRetval(stat, retval, ("Could not get value for column " + coldata.name).c_str());
        }

        if (*ind == SQL_NULL_DATA) //return false, tell upper layer to discard this cell as NULL
        {
                HSVM_SetDefault(*vm, id_set, coldata.hstype);
                return false;
        }

        StackMachine &stackm = vm->GetStackMachine();

        // Non-null data; length fits structure for non-blob and non-char
        switch (coldata.hstype)
        {
        case VariableTypes::Integer:
                {
                        if (coldata.cdatatype == SQL_C_TYPE_TIME)
                        {
                                SQL_TIME_STRUCT &time = *(SQL_TIME_STRUCT*)colbuffer;
                                int32_t value = time.hour * 60 * 60 * 1000 + time.minute * 60 * 1000 + time.second * 1000;
                                stackm.SetInteger(id_set, value);
                        }
                        else
                            stackm.SetInteger(id_set, *(SQLINTEGER*)colbuffer);
                } break;
        case VariableTypes::Float:      stackm.SetFloat(id_set, *(SQLDOUBLE*)colbuffer); break;
        case VariableTypes::Boolean:    stackm.SetBoolean(id_set, *(SQLCHAR*)colbuffer); break;
        case VariableTypes::DateTime:
                {
                        SQL_TIMESTAMP_STRUCT &dt = *(SQL_TIMESTAMP_STRUCT*)colbuffer;
                        if (dt.year > (SQLSMALLINT)9999 ||
                            (dt.year == (SQLSMALLINT)9999 &&
                             dt.month == (SQLUSMALLINT)12 &&
                             dt.day == (SQLUSMALLINT)31 &&
                             dt.hour == (SQLUSMALLINT)23 &&
                             dt.minute == (SQLUSMALLINT)59 &&
                             dt.second == (SQLUSMALLINT)59)) // Ignore fraction
                        {
                                // Convert everything after year 9999 (or last second of year 9999) to MAX_DATETIME
                                // complement of FillBuffer datetime code, see comment there.
                                stackm.SetDateTime(id_set, Blex::DateTime::Max());
                        }
                        else
                        {
                                // ADDME: MySQL connector passes current day for SQL_TYPE_TIME, clear the day?
                                tm c_time;
                                c_time.tm_sec = dt.second;
                                c_time.tm_min = dt.minute;
                                c_time.tm_hour = dt.hour;
                                c_time.tm_mday = dt.day;
                                c_time.tm_mon = dt.month - 1;
                                c_time.tm_year = dt.year - 1900;
                                Blex::DateTime date = Blex::DateTime::FromTM(c_time);
                                date += Blex::DateTime::Msecs(dt.fraction / 1000000UL); // fraction in in nanoseconds
                                stackm.SetDateTime(id_set, date);
                        }
                } break;
        case VariableTypes::Money:
                {
                        Blex::DecimalFloat df;

                        /* SQL cursor library has bugs which prevent us to use SQL_C_NUMERIC; workaround uses SQL_C_CHAR as transfer format */
                        if (workarounds & ODBCWorkarounds::NumericViaString)
                        {
                                char const *finish;
                                Blex::DecimalFloat::ParseResult res = df.ParseNumberString(
                                    reinterpret_cast< const char * >(colbuffer),
                                    reinterpret_cast< const char * >(colbuffer) + *ind,
                                    nullptr,
                                    &finish);

                                if (res != Blex::DecimalFloat::PR_Integer && res != Blex::DecimalFloat::PR_FloatingPoint)
                                    ThrowDBError("Cannot convert to number to money");
                        }
                        else
                        {
                                SQL_NUMERIC_STRUCT &num = *(SQL_NUMERIC_STRUCT *)colbuffer;

                                // For rounding, only the 6th decimal is important; ignore the 7th+ decimals
                                while (num.scale > 6)
                                    NumericScaleDown(num);

                                uint64_t digits = 0;
                                for (signed idx = std::min<signed>(sizeof(digits), SQL_MAX_NUMERIC_LEN); idx >= 0; --idx)
                                {
                                        digits = digits * 0x100;
                                        digits += (uint8_t)num.val[idx];
                                }

                                // Overflow detection
                                for (signed idx = sizeof(digits); idx < SQL_MAX_NUMERIC_LEN; ++idx)
                                    if ((uint8_t)num.val[idx] != 0)
                                        ThrowDBError("Cannot convert to number to money");
                                if (digits > BIGU64NUM(9223372036854775807) || (num.sign != 1 && digits == BIGU64NUM(9223372036854775808)))
                                    ThrowDBError("Cannot convert to number to money");

                                // Fill the decimalfloat
                                df.digits = digits;
                                df.negate = num.sign != 1;
                                df.exponent = (short)-num.scale;
                        }

                        if (!df.ConvertableToMoney(true))
                            ThrowDBError("Cannot convert to number to money");

                        stackm.SetMoney(id_set, df.ToMoney());
                } break;
        case VariableTypes::Blob:
                {
                        // Retrieve the data in chunks
                        int32_t outstream = HSVM_CreateStream(*vm);
                        if (coldata.bind_column)
                        {
                                if (*ind <= (int)MaxColBufferSize - 1) // Whole data already in buffer?
                                {
                                        HSVM_PrintTo(*vm, outstream, *ind, colbuffer);
                                        HSVM_MakeBlobFromStream(*vm, id_set, outstream);
                                        break;
                                }
                                else
                                {
                                        PositionCursor(row);
                                        // Get the first batch of data
                                        retval = SQLGetData(stat, (SQLUSMALLINT)column, coldata.cdatatype, colbuffer, coldata.buffersize, ind);
                                }
                        }

                        while (retval != SQL_NO_DATA)
                        {
                                if (retval != SQL_SUCCESS_WITH_INFO)
                                    CheckRetval(stat, retval, "Retrieving blob data failed");

                                // Calculate returned length, and append
                                unsigned len = std::min<unsigned>(*ind, MaxColBufferSize);
                                HSVM_PrintTo(*vm, outstream, len, colbuffer);

                                retval = SQLGetData(stat, (SQLUSMALLINT)column, coldata.cdatatype, colbuffer, coldata.buffersize, ind);
                        }

                        HSVM_MakeBlobFromStream(*vm, id_set, outstream);
                } break;
        case VariableTypes::String:
                {
//                        DEBUGPRINT(coldata.name << " string " << *ind << " bytes");
                        bool is_wchar = coldata.cdatatype == SQL_C_WCHAR;
                        std::string str;
                        if (coldata.bind_column)
                        {
                                if (*ind <= (int)MaxColBufferSize - 1) // Whole data already in buffer?
                                {
                                        if (is_wchar)
                                        {
                                                //FIXME: UTF-16 Recode
                                                Blex::UTF8Encode((const SQLWCHAR *)colbuffer,
                                                                (const SQLWCHAR *)(colbuffer + *ind),
                                                                std::back_inserter(str));
                                        }
                                        else
                                        {
                                                Blex::ConvertCharsetToUTF8(reinterpret_cast< char * >(colbuffer),
                                                                        reinterpret_cast< char * >(colbuffer) + *ind,
                                                                        charset,
                                                                        &str);
//                                              //FIXME: Charset conversion
//                                              Blex::UTF8Encode((const SQLCHAR *)colbuffer,
//                                                               (const SQLCHAR *)(colbuffer + *ind),
//                                                               std::back_inserter(str));

                                        }

                                        if (workarounds & ODBCWorkarounds::DoubleEncodedUTF8Strings)
                                            WorkaroundDoubleDecodeUTF8(&str);

                                        stackm.SetSTLString(id_set, str);
                                        break;
                                }
                                else
                                {
                                      PositionCursor(row);
                                      // Get the first batch of data
                                      retval = SQLGetData(stat, (SQLUSMALLINT)column, coldata.cdatatype, colbuffer, coldata.buffersize, ind);
                                }
                        }
                        while (retval != SQL_NO_DATA)
                        {
                                if (retval != SQL_SUCCESS_WITH_INFO)
                                    CheckRetval(stat, retval, "Retrieving string data failed");

                                // Calculate returned length, and append
                                unsigned len = std::min<unsigned>(*ind, MaxColBufferSize - (is_wchar?sizeof (SQLWCHAR):sizeof(SQLCHAR)) /* Skip \0 character at end of buffer */);
                                if (is_wchar)
                                {
                                        //FIXME: UTF-16 Recode
                                        Blex::UTF8Encode((const SQLWCHAR *)colbuffer,
                                                         (const SQLWCHAR *)(colbuffer + len),
                                                         std::back_inserter(str));
                                }
                                else
                                {
                                        Blex::ConvertCharsetToUTF8(reinterpret_cast< char * >(colbuffer),
                                                                   reinterpret_cast< char * >(colbuffer) + *ind,
                                                                   charset,
                                                                   &str);
//                                        //FIXME: Charset conversion
//                                        Blex::UTF8Encode((const SQLCHAR *)colbuffer,
//                                                         (const SQLCHAR *)(colbuffer + len),
//                                                         std::back_inserter(str));

                                }
                                // Get next chunk
                                retval = SQLGetData(stat, (SQLUSMALLINT)column, coldata.cdatatype, colbuffer, coldata.buffersize, ind);
                        }

                        if (workarounds & ODBCWorkarounds::DoubleEncodedUTF8Strings)
                            WorkaroundDoubleDecodeUTF8(&str);

                        stackm.SetSTLString(id_set, str);
                } break;
        default:
            ThrowDBError(("ODBC unsupported variable type " + HareScript::GetTypeName(coldata.hstype)).c_str());
        }
        return true;
}

bool ResultSet::FillBuffer(SQLCHAR *colbuffer, SQLLEN &ind, VarId value, SQLSMALLINT scale)
{
        if (value == 0) // NULL
        {
                ind = SQL_NULL_DATA;
                return true;
        }

        StackMachine &stackm = vm->GetStackMachine();

        switch (stackm.GetType(value))
        {
        case VariableTypes::Integer:
                *(SQLINTEGER*)colbuffer = stackm.GetInteger(value);
                ind = sizeof(SQLINTEGER);
                break;
        case VariableTypes::Float:
                *(SQLDOUBLE*)colbuffer = stackm.GetFloat(value);
                ind = sizeof(SQLDOUBLE);
                break;
        case VariableTypes::Boolean:
                *(SQLCHAR*)colbuffer = stackm.GetBoolean(value);
                ind = sizeof(SQLCHAR);
                break;
        case VariableTypes::DateTime:
                {
                        SQL_TIMESTAMP_STRUCT &dt = *(SQL_TIMESTAMP_STRUCT*)colbuffer;
                        Blex::DateTime datetime = stackm.GetDateTime(value);
                        tm c_time = datetime.GetTM();

                        /* PSQL odbc driver can't store dates higher than year 9999 (bug, drops 5th decimal digit)
                           otherwise, the limit lies on year 32768 (dt.year is a signed 16-bit)
                        */
                        if (c_time.tm_year + 1900 > 9999)
                        {
                                dt.fraction = (SQLUINTEGER)0; // Just to be sure; we don't know if the DB supports fractions in this precision.
                                dt.second = (SQLUSMALLINT)59;
                                dt.minute = (SQLUSMALLINT)59;
                                dt.hour = (SQLUSMALLINT)23;
                                dt.day = (SQLUSMALLINT)31;
                                dt.month = (SQLUSMALLINT)12;
                                dt.year = (SQLSMALLINT)9999;
                                dt.fraction = 0;
                        }
                        else
                        {
                                dt.fraction = (SQLUINTEGER)((datetime.GetMsecs() % 1000) * 1000000UL);
                                dt.second = (SQLUSMALLINT)c_time.tm_sec;
                                dt.minute = (SQLUSMALLINT)c_time.tm_min;
                                dt.hour = (SQLUSMALLINT)c_time.tm_hour;
                                dt.day = (SQLUSMALLINT)c_time.tm_mday;
                                dt.month = (SQLUSMALLINT)(c_time.tm_mon + 1);
                                dt.year = (SQLSMALLINT)(c_time.tm_year + 1900);
                        }
                        ind = sizeof(SQL_TIMESTAMP_STRUCT);
                } break;
        case VariableTypes::Money:
        {
                if (workarounds & ODBCWorkarounds::NumericViaString)
                {
                        // SQL cursor library has bugs which prevent us to use SQL_C_NUMERIC; workaround uses SQL_C_CHAR as transfer format
                        std::string strvalue = Blex::AnyToString(stackm.GetMoney(value));
                        while (strvalue.length() <= 5) strvalue = "0" + strvalue;
                        strvalue.insert(strvalue.end() - 5, '.');

                        std::copy(strvalue.begin(), strvalue.end(), (char *)colbuffer);
                        ind = strvalue.size();
                }
                else
                {
                        SQL_NUMERIC_STRUCT &num = *(SQL_NUMERIC_STRUCT *)colbuffer;
                        int64_t money = stackm.GetMoney(value);

                        num.sign = (SQLSCHAR)((money >= 0) ? 1 : 2); // 1 if positive, 2 if negative
                        money = money < 0 ? -money : money;

                        if (scale < 5)
                        {
                                uint64_t factor = 1;
                                for (signed idx = scale; idx < 5; ++idx)
                                    factor *= 10;

                                money += (factor >> 1);
                                money /= factor;
                        }
                        else
                            scale = 5;

                        memset(num.val, 0, SQL_MAX_NUMERIC_LEN);
                        for (unsigned idx = 0; idx < 8; ++idx)
                            num.val[idx] = (uint8_t)((money >> (idx * 8)) & 0xff);

                        // ODBC docs say the setting of this is not needed; but Access does not know that.
                        num.scale = scale;
                        num.precision = 1; // Access will complain if this is too high; not if it's too low

                        ind = sizeof(SQL_NUMERIC_STRUCT);
                }
        } break;
        case VariableTypes::Blob: /* FIXME: I presume BLOB code is badly broken when writing more than MaxColBufferSize (where is the offset manipulation?) */
                {
                        HareScript::Interface::InputStream blob(*vm, value);
                        unsigned len = blob.GetFileLength();
                        if (len == 0)
                            ind = SQL_NULL_DATA;
                        else if (len > MaxColBufferSize)
                        {
                                ind = SQL_LEN_DATA_AT_EXEC(len);
                                return false;
                        }
                        else
                        {
                                blob.Read(colbuffer, len);
                                ind = len;
                        }
                }; break;
        case VariableTypes::String:
                {
                        const char *begin, *end;
                        HSVM_StringGet(*vm, value, &begin, &end);

                        if (charset != Blex::Charsets::Unicode)
                        {
                                std::string data;
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &data);

                                if (workarounds & ODBCWorkarounds::DoubleEncodedUTF8Strings)
                                {
                                        std::string double_decode;
                                        Blex::UTF8Decode(data.begin(), data.end(), std::back_inserter(double_decode));
                                        std::swap(data, double_decode);
                                }

                                if (data.size() > MaxColBufferSize)
                                {
                                        ind = SQL_LEN_DATA_AT_EXEC(static_cast< signed >(data.size()));
                                        return false;
                                }
                                else
                                {
                                        std::copy(data.begin(), data.end(), (SQLCHAR*)colbuffer);
                                        ind = data.size();
                                }
                        }
                        else
                        {
                                /* ADDME: Avoid building string twice */
                                Blex::UTF16String data;

                                // FIXME: Proper UTF-16 encoding
                                if (workarounds & ODBCWorkarounds::DoubleEncodedUTF8Strings)
                                {
                                        std::string double_decode;
                                        Blex::UTF8Decode(data.begin(), data.end(), std::back_inserter(double_decode));
                                        Blex::UTF8Decode(double_decode.begin(), double_decode.end(), std::back_inserter(data));
                                }
                                else
                                    Blex::UTF8Decode(data.begin(), data.end(), std::back_inserter(data));

                                stackm.GetUTF16String(value,&data);
                                if (data.size() * sizeof(SQLWCHAR) > MaxColBufferSize)
                                {
                                        ind = SQL_LEN_DATA_AT_EXEC((signed)(data.size() * sizeof(SQLWCHAR)));
                                        return false;
                                }
                                else
                                {
                                        std::copy(data.begin(), data.end(), (SQLWCHAR*)colbuffer);
                                        ind = data.size() * sizeof(SQLWCHAR);
                                }
                        }
                }; break;
        default:
            ThrowDBError(("ODBC unsupported variable type " + HareScript::GetTypeName(stackm.GetType(value))).c_str());
        }
        return true;
}

void ResultSet::SendVariable(SQLHSTMT stat, VarId value)
{
        SQLCHAR colbuffer[MaxColBufferSize];

        StackMachine &stackm = vm->GetStackMachine();
        switch (stackm.GetType(value))
        {
        case VariableTypes::Blob:
                {
                        HareScript::Interface::InputStream blob(*vm, value);
                        while (true)
                        {
                                signed len = blob.Read(colbuffer, MaxColBufferSize);
                                if (len==0)
                                    break;//EOF
                                CheckRetval(stat, SQLPutData(stat, colbuffer, len), "Could not write update-data");
                                DEBUGPRINT("Sent " << len);
                        }
                }
                break;
        case VariableTypes::String:
                {
                        const char *begin, *end;
                        HSVM_StringGet(*vm, value, &begin, &end);

                        /* ADDME: Avoid building string twice */
                        if (charset != Blex::Charsets::Unicode)
                        {
                                std::string data;
                                Blex::ConvertUTF8ToCharset(begin, end, charset, &data);

                                if (workarounds & ODBCWorkarounds::DoubleEncodedUTF8Strings)
                                {
                                        std::string double_decode;
                                        Blex::UTF8Decode(data.begin(), data.end(), std::back_inserter(double_decode));
                                        std::swap(data, double_decode);
                                }

                                unsigned pos = 0;
                                while (pos < data.size())
                                {
                                        signed len = std::min<unsigned>(data.size() - pos, MaxColBufferSize);
                                        CheckRetval(stat, SQLPutData(stat, &data[pos], len), "Could not write update-data");
                                        pos += len;
                                }
                        }
                        else
                        {
                                Blex::UTF16String data;

                                // FIXME: Proper UTF-16 encoding
                                if (workarounds & ODBCWorkarounds::DoubleEncodedUTF8Strings)
                                {
                                        std::string double_decode;
                                        Blex::UTF8Decode(data.begin(), data.end(), std::back_inserter(double_decode));
                                        Blex::UTF8Decode(double_decode.begin(), double_decode.end(), std::back_inserter(data));
                                }
                                else
                                    Blex::UTF8Decode(data.begin(), data.end(), std::back_inserter(data));

                                unsigned pos = 0;
                                while (pos < data.size())
                                {
                                        signed len = std::min<unsigned>(data.size() - pos, MaxColBufferSize / sizeof(SQLWCHAR));
                                        CheckRetval(stat, SQLPutData(stat, &data[pos], len * sizeof(SQLWCHAR)), "Could not write update-data");
                                        pos += len;
                                }
                        }
                }
                break;
        default:
            ThrowDBError("Can only send big STRINGs and BLOBs");
        }
}


void ResultSet::Set(unsigned column, VarId value)
{
        if (stat == SQL_NULL_HANDLE)
            ThrowDBError("Using unbound resultset");

        if (current_row == 0)
            ThrowDBError("Cursor not positioned to a valid row in the current block");

        if (column == 0 || column > columns.size())
            ThrowDBError("Illegal column index used for updating values");

        updates[column] = value;
}

void ResultSet::UpdateRow()
{
        StackMachine &stackm = vm->GetStackMachine();
        if (stat == SQL_NULL_HANDLE)
            ThrowDBError("Using unbound resultset");

        if (current_row == 0)
            ThrowDBError("Cursor not positioned to a valid row in the current block");

        // By default, ignore all columns. Later, set all columns that will be updated
        for (unsigned column = 0; column <= columns.size(); ++column)
        {
                SQLLEN *ind = (SQLLEN *)(data + (current_row - 1) * rowdata_size + ind_array_start) + (column - 1);
                *ind = SQL_COLUMN_IGNORE;
        }
        for (std::map< unsigned, VarId >::iterator it = updates.begin(); it != updates.end(); ++it)
        {
                unsigned column = it->first;
                Column &coldata = columns[column - 1];

                uint8_t *colbuffer = data + (current_row - 1) * rowdata_size + coldata.data_offset;
                SQLLEN *ind = (SQLLEN *)(data + (current_row - 1) * rowdata_size + ind_array_start) + (column - 1);

                if (it->second != 0)
                    stackm.CastTo(it->second, coldata.hstype);

                FillBuffer(colbuffer, *ind, it->second, coldata.scale);
        }

        SQLRETURN retval;

        retval = SQLSetPos(stat, (SQLUSMALLINT)current_row, SQL_UPDATE, SQL_LOCK_NO_CHANGE);
        while (retval == SQL_NEED_DATA)
        {
                // Never accessed for NULL data
                SQLPOINTER bufpos;
                retval = SQLParamData(stat, &bufpos);
                if (retval != SQL_NEED_DATA)
                    break;

                // Find the column nr
                unsigned column;
                for (column = 1; column <= columns.size(); ++column)
                {
                        Column &coldata = columns[column - 1];

                        uint8_t *colbuffer = data + (current_row - 1) * rowdata_size + coldata.data_offset;
                        if (colbuffer == bufpos)
                            break;
                }
                if (column > columns.size() || updates.count(column) == 0)
                    ThrowDBError("Data requested for non-long column");

                SendVariable    (stat, updates[column]);
        }
        CheckRetval(stat, retval, "Could not update current row");
}

void ResultSet::PositionCursor(unsigned row)
{
        if (row == 0 || row > blockrowcount)
            ThrowDBError("Illegal row index used for positioning cursor");

        if (row != current_row) //no need to check support_sqlsetpos, because then current_row==row==1
        {
                CheckRetval(stat,
                        SQLSetPos(stat, (SQLUSMALLINT)row, SQL_POSITION, SQL_LOCK_NO_CHANGE),
                        "Could not set cursor position");
        }

        current_row = row;
}

unsigned ResultSet::NextBlock()
{
        current_row = 1;

        SQLRETURN retval = SQLFetchScroll(stat, SQL_FETCH_NEXT, 0);
        if (retval == SQL_NO_DATA)
            return 0;
        CheckRetval(stat, retval, "Could not fetch block of rows");
        return blockrowcount;
}

unsigned ResultSet::ColumnCount()
{
        if (stat == SQL_NULL_HANDLE)
            ThrowDBError("Using unbound resultset");

        SQLSMALLINT count;
        CheckRetval(stat, SQLNumResultCols(stat, &count), "Could not get number of result columns");
        return count;
}

ResultSet::Column const & ResultSet::GetColumnData(unsigned column)
{
        if (column == 0 || column > columns.size())
            ThrowDBError("ODBC illegal parameter used in GetColumnData");
        return columns[column - 1];
}

namespace
{
struct IndBufpos
{
        SQLLEN ind;
        SQLSMALLINT ctype;
        unsigned bufpos;
        VariableTypes::Type hstype;
};
} // End of anonymous namespace

SQLRETURN ResultSet::ExecuteStatement(SQLHSTMT stat, std::vector< std::pair< VariableTypes::Type, VarId > > const &parameters)
{
        StackMachine &stackm = vm->GetStackMachine();
        SQLRETURN retval;

        unsigned paramcount = parameters.size();

        // Allocate a buffer of sufficient size
        std::vector< IndBufpos > poslist(paramcount);
        unsigned bufsize = 0;
        for (unsigned idx = 0; idx < paramcount; ++idx)
        {
                IndBufpos &ib = poslist[idx];
                ib.bufpos = bufsize;
                if (parameters[idx].first == VariableTypes::Uninitialized)
                    ib.hstype = stackm.GetType(parameters[idx].second);
                else
                    ib.hstype = parameters[idx].first;
                ib.ctype = CalcSQLCDataType(ib.hstype, 0, capabilities, charset != Blex::Charsets::Unicode, workarounds);
                bufsize = Align(bufsize + CalcBufferSize(ib.ctype, MaxColBufferSize), CalcAlignment(ib.ctype));
        }

        std::unique_ptr<SQLCHAR[]> data;
        data.reset(new SQLCHAR[bufsize]);

        // Fill all buffers and bind the parameters
        for (unsigned idx = 0; idx < paramcount; ++idx)
        {
                IndBufpos &ib = poslist[idx];
                unsigned colsize = 0;
                unsigned decdigits = 0;

                /* Cast the parameter to the right type (take a copy, cause the same param can be used multiple times in
                   different contexts)
                */
                VarId param = 0;
                if (parameters[idx].second)
                {
                        param = stackm.PushCopy(parameters[idx].second);
                        stackm.CastTo(param, ib.hstype);
                }

                switch (ib.hstype)
                {
                case VariableTypes::String:
                        if (parameters[idx].second) /* FIXME: This is the wrong size?!? We should have the size after charset recoding */
                            colsize = stackm.GetString(parameters[idx].second).size();
                        break;
                case VariableTypes::DateTime:   decdigits = 19; break; // FIXME set right precision value here
                case VariableTypes::Money:      decdigits = 5; colsize = 5; break;
                case VariableTypes::Float:      colsize = 19; break; // Precision
                case VariableTypes::Blob:
                        if (parameters[idx].second)
                            colsize = stackm.GetBlob(parameters[idx].second).GetLength();
                        break;
                case VariableTypes::Boolean:    colsize = 1; break;
                default: ;
                }

                //ADDME: Should we suppress or fail on null equivalency when the column is not in fact nullable?

                FillBuffer(data.get() + poslist[idx].bufpos, poslist[idx].ind, parameters[idx].second, 5);
                CheckRetval(stat,
                        SQLBindParameter(
                                stat,
                                (SQLSMALLINT)(idx + 1),
                                (SQLSMALLINT)SQL_PARAM_INPUT,
                                ib.ctype,
                                CalcSQLTypeFromCType(ib.ctype,colsize),
                                std::max(colsize,1u), //Access doesn't like 0 here for SQLWVARCHAR types (but it's okay for SQLWLONGVARCHAR)
                                (SQLSMALLINT)decdigits,
                                data.get() + poslist[idx].bufpos,
                                0,
                                &poslist[idx].ind),
                        "Could not bind parameter");

                if (param)
                    stackm.PopVariablesN(1);
        }

        retval = SQLExecute(stat);

        while (retval == SQL_NEED_DATA)
        {
                SQLPOINTER bufpos;
                retval = SQLParamData(stat, &bufpos);
                if (retval != SQL_NEED_DATA)
                    break;

                // Find the column nr
                unsigned idx;
                for (idx = 0; idx < paramcount; ++idx)
                {
                        IndBufpos &ib = poslist[idx];
                        uint8_t *buffer = data.get() + ib.bufpos;

                        if (buffer == bufpos)
                            break;
                }
                if (idx == paramcount)
                    ThrowDBError("Data requested for unknown column");

                SendVariable(stat, parameters[idx].second);
        }

        return retval;
}

void ResultSet::ReturnTotalSet(VarId id_set)
{
                StackMachine &stackm = vm->GetStackMachine();
        stackm.ArrayInitialize(id_set, 0, VariableTypes::RecordArray);

        unsigned rows;
        unsigned colcount = ColumnCount();
        if (colcount == 0) // Was there a result-set?
            return;

        // Modify names to be unique in the result-set
        // Placed here instead of in FinalizeColumnBindings() because this function
        // isn't called very often, but FinalizeColumnBindings() is.
        std::set<ColumnNameId> names;
        for (unsigned col = 1; col <= colcount;)
        {
                // Already unique? Do next names
                if (names.count(columns[col - 1].nameid) == 0)
                {
                        names.insert(columns[col - 1].nameid);
                        ++col;
                        continue;
                }
                // Append _number to the original name with the first unique number that makes the total name unique
                std::string barestr = vm->columnnamemapper.GetReverseMapping(columns[col - 1].nameid).stl_str();
                unsigned idx = 1;
                // While the name is not unique, compute a new one
                while (names.count(columns[col - 1].nameid) != 0)
                     columns[col - 1].nameid = vm->columnnamemapper.GetMapping(barestr + "_" + Blex::AnyToString(idx++));
        }

        while ((rows = NextBlock()) != 0)
            for (unsigned row = 1; row <= rows; ++row)
            {
                    VarId rec = stackm.ArrayElementAppend(id_set);
                    stackm.RecordInitializeEmpty(rec);

                    for (unsigned col = 1; col <= colcount; ++col)
                    {
                            VarId cell = stackm.RecordCellCreate(rec, columns[col - 1].nameid);
                            Get(row, col, cell);
//                            if (!Get(row, col, cell))
//                                stackm.RecordCellDelete(rec, columns[col - 1].nameid);
                    }
            }
}

bool ResultSet::CanOverflowBuffer(VariableTypes::Type type)
{
        switch (type)
        {
        case VariableTypes::Blob:
        case VariableTypes::String:
            return true;
        default:
            return false;
        }
}

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript
