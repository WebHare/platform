#pragma GCC diagnostic ignored "-Wuninitialized"

//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_pgsqlprovider.h"
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/errors.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/baselibs.h>
#include <blex/unicode.h>
#include <string_view>
#include <limits>
#include <iomanip>
#include <variant>

#define SHOW_PGSQL

//#define DUMP_BINARY_ENCODING


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

/** VARCHAR columns longer than this size are indexed with left(..., max_size) in WebHare. PostgreSQL needs
    a filter with left(..., max_size) to be able to match the index.
*/
std::string_view max_indexed_size("264"sv); // Keep in sync with constant in dbase/postgresql.whlib!!

// Maximum block size
const unsigned fase1_max_blocksize = 8;


// Copied from /usr/include/pgsql/server/catalog/pg_type.h (can't be included due to path issues)
enum class OID : int32_t
{
        unknown = 0,
        BOOL = 16,
        BYTEA = 17,
        CHAR = 18,
        NAME = 19,
        INT2VECTOR = 22,
        TEXT = 25,
        OIDVECTOR = 30,
        VARCHAR = 1043,
        INT8 = 20,
        INT2 = 21,
        INT4 = 23,
        REGPROC = 24,
        OID = 26,
        TID = 27,
        XID = 28,
        CID = 29,
        CIDR = 650,
        FLOAT4 = 700,
        FLOAT8 = 701,
        INET = 869,
        BOOLARRAY = 1000,
        BYTEAARRAY = 1001,
        CHARARRAY = 1002,
        INT2ARRAY = 1005,
        INT4ARRAY = 1007,
        INT8ARRAY = 1016,
        TEXTARRAY = 1009,
        FLOAT8ARRAY = 1022,
        TIMESTAMPARRAY = 1115,
        OIDARRAY = 1028,
        TIDARRAY = 1010,
        TIMESTAMP = 1114,
        TIMESTAMPTZ = 1184,
        NUMERICARRAY = 1231,
        NUMERIC = 1700,
        ANY = 2276,
        ANYARRAY = 2277,
        RECORD = 2249,
        RECORDARRAY = 2287,
};

struct PostgresqlTid
{
        unsigned blocknumber;
        unsigned tupleindex;
};

inline bool operator==(PostgresqlTid const &lhs, PostgresqlTid const &rhs) { return lhs.blocknumber == rhs.blocknumber && lhs.tupleindex == rhs.tupleindex; }

/** Blob in wh blob storage, stored in type 'webhare_blob'
*/
class PostgreSQLWHBlobData
{
    public:
        PostgreSQLWHBlobData();
        ~PostgreSQLWHBlobData();

        void Register(PGSQLTransactionDriver *driver, std::string blobid, Blex::FileOffset bloblength, bool forinsert);

        PGSQLTransactionDriver *driver;
        std::string blobid;
        Blex::FileOffset bloblength;

        static PostgreSQLWHBlobData * GetFromVariable(VirtualMachine *vm, VarId var, bool create);

    private:
        void Unregister();
};

static const unsigned PostgreSQLWHBlobContextId = 24;

PostgreSQLWHBlobData::PostgreSQLWHBlobData()
: driver(0)
, bloblength(0)
{
}

PostgreSQLWHBlobData::~PostgreSQLWHBlobData()
{
        if (driver)
            Unregister();
}

PostgreSQLWHBlobData * PostgreSQLWHBlobData::GetFromVariable(VirtualMachine *vm, VarId var, bool create)
{
        return static_cast<PostgreSQLWHBlobData * >(HSVM_BlobContext(*vm, var, PostgreSQLWHBlobContextId, create));
}

void PostgreSQLWHBlobData::Register(PGSQLTransactionDriver *_driver, std::string _blobid, Blex::FileOffset _bloblength, bool /*forinsert*/)
{
        if (driver)
           Unregister();

        // Only register valid data
        if (!_blobid.empty() && _bloblength != 0)
        {
                driver = _driver;
                blobid = _blobid;
                bloblength = _bloblength;
        }
}

void PostgreSQLWHBlobData::Unregister()
{
        driver = nullptr;
        blobid.clear();
        bloblength = 0;
}

void AddEscapedName(std::string *str, std::string_view append)
{
        bool is_simple = true;
        for (auto c: append)
            if ((c < '0' || c > '9') && (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') && c != '$' && c != '_' && c != '"')
                is_simple = false;

        if (is_simple)
        {
                str->push_back('"');
                for (auto c: append)
                {
                        if (c == '"')
                            str->push_back(c);
                        str->push_back(c);
                }
                str->push_back('"');
                return;
        }

        str->push_back('U');
        str->push_back('&');
        str->push_back('"');

        Blex::UTF8DecodeMachine decoder;
        uint8_t char_buf[6];
        unsigned char_buf_cnt = 0;

        for (auto c: append)
        {
                uint32_t curch = decoder(c);
                char_buf[char_buf_cnt++] = c;
                if (curch ==  Blex::UTF8DecodeMachine::NoChar)
                    continue;
                if (curch == Blex::UTF8DecodeMachine::InvalidChar || curch == 0)
                {
                        // Just copy invalid UTF-8, the server will catch it
                        std::copy(char_buf, char_buf + char_buf_cnt, std::back_inserter(*str));
                        char_buf_cnt = 0;
                        continue;
                }
                char_buf_cnt = 0;
                if (c >= 32 && c < 127)
                {
                        if (c == '\\')
                            str->push_back(curch);
                        str->push_back(curch);
                }
                else
                {
                        char numbuf[14] = "0000000000000"; // 5 padding, 8 room for uint32_t
                        char *encode_end = Blex::EncodeNumber(curch, 16, numbuf + 5);
                        if (curch < 65536)
                        {
                                str->push_back('\\');
                                std::copy(encode_end - 4, encode_end, std::back_inserter(*str));
                        }
                        else
                        {
                                str->push_back('\\');
                                str->push_back('+');
                                std::copy(encode_end - 6, encode_end, std::back_inserter(*str));
                        }
                }
        }

        std::copy(char_buf, char_buf + char_buf_cnt, std::back_inserter(*str));
        str->push_back('"');
}

void AddEscapedSchemaTable(std::string *str, std::string_view to_add)
{
        auto dotpos = to_add.find(".");

        if (dotpos != std::string_view::npos)
        {
                AddEscapedName(str, to_add.substr(0, dotpos));
                str->append(".");
                ++dotpos;
                AddEscapedName(str, to_add.substr(dotpos));
        }
        else
            AddEscapedName(str, to_add);
}

void AddTableName(unsigned tableid, std::string *str)
{
        str->append("T" + Blex::AnyToString(tableid));
}

void AddTableAndColumnName(DatabaseQuery const &query, unsigned tableid, unsigned columnid, bool withrename, std::string *str)
{
        std::string_view colname(query.tables[tableid].typeinfo->columnsdef[columnid].dbase_name);
        if (query.tables[tableid].name == "system.sites"sv)
        {
                if (colname == "webroot"sv)
                {
                        str->append("webhare_proc_sites_webroot("sv);
                        AddTableName(tableid, str);
                        str->append(".\"outputweb\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"outputfolder\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
        }
        else if (query.tables[tableid].name == "system.fs_objects"sv)
        {
                if (colname == "fullpath"sv)
                {
                        str->append("webhare_proc_fs_objects_fullpath("sv);
                        AddTableName(tableid, str);
                        str->append(".\"id\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"isfolder\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
                if (colname == "highestparent"sv)
                {
                        str->append("webhare_proc_fs_objects_highestparent("sv);
                        AddTableName(tableid, str);
                        str->append(".\"id\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
                if (colname == "indexurl"sv)
                {
                        str->append("webhare_proc_fs_objects_indexurl("sv);
                        AddTableName(tableid, str);
                        str->append(".\"id\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"name\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"isfolder\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"parent\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"published\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"type\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"externallink\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"filelink\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"indexdoc\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
                if (colname == "isactive"sv)
                {
                        str->append("webhare_proc_fs_objects_isactive("sv);
                        AddTableName(tableid, str);
                        str->append(".\"id\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
                if (colname == "publish"sv)
                {
                        str->append("webhare_proc_fs_objects_publish("sv);
                        AddTableName(tableid, str);
                        str->append(".\"isfolder\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"published\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
                if (colname == "url"sv)
                {
                        str->append("webhare_proc_fs_objects_url("sv);
                        AddTableName(tableid, str);
                        str->append(".\"id\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"name\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"isfolder\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"parent\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"published\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"type\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"externallink\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"filelink\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
               }
                if (colname == "whfspath"sv)
                {
                        str->append("webhare_proc_fs_objects_whfspath("sv);
                        AddTableName(tableid, str);
                        str->append(".\"id\","sv);
                        AddTableName(tableid, str);
                        str->append(".\"isfolder\")"sv);
                        if (withrename)
                        {
                                str->append(" AS "sv);
                                AddEscapedName(str, colname);
                        }
                        return;
                }
        }

        AddTableName(tableid, str);
        str->append(".");
        AddEscapedName(str, colname);
}

// No enum class because that isn't very handy for bitfields
namespace ParamEncoding
{
enum Flags
{
        None =    0,
        Binary =  1,
        Pattern = 2,
};
} // end of namespace

struct ParamsEncoder
{
    public:
        enum BuildMode
        {
                Top,
                Array,
                Record
        };

        ParamsEncoder(PGSQLTransactionDriver &_driver) : driver(_driver), buildmode(Top) {}

        PGSQLTransactionDriver &driver;

        /** Controls how parameters are added
            - Top: as top-level parameter
            - Array: as array element
            - Record: as record element
        */
        BuildMode buildmode;

        static const int staticparams = 16;
        Blex::SemiStaticPodVector< Oid, staticparams > types;
        Blex::SemiStaticPodVector< const char *, staticparams > dataptrs;
        Blex::SemiStaticPodVector< int, staticparams > lengths;
        Blex::SemiStaticPodVector< int, staticparams > formats;

        Blex::SemiStaticPodVector< char, 32768 > alldata;

        /// Register a new (sub-)parameter. Use -1 as len for NULL
        char *RegisterParameter(OID type, signed len);
        std::string AddVariableParameter(VirtualMachine *vm, VarId var, ParamEncoding::Flags flags = ParamEncoding::None);
        std::string AddParameter(VirtualMachine *vm, std::string_view str, ParamEncoding::Flags flags = ParamEncoding::None);

        struct FinalizeData
        {
                BuildMode orgbuildmode;
                unsigned datastart;
                bool hasnull;
        };

        FinalizeData AddArrayParameter(OID type, OID elttype, unsigned eltcount);
        FinalizeData AddRecordParameter(OID type, unsigned eltcount);
        void FinalizeParameter(FinalizeData const &finalizedata);

        /// Finalize all added parameters, prepare dataptrs and formats arrays
        void Finalize();
};

struct TuplesReader
{
        VirtualMachine *vm;
        PGSQLTransactionDriver &driver;
        PGresult *res;
        TuplesReader(VirtualMachine *_vm, PGSQLTransactionDriver &_driver, PGresult *_res, QueryData *querydata) : vm(_vm), driver(_driver), res(_res) { ReadColumns(querydata); }

        enum class ReadResult
        {
                Value,
                Null,
                Exception
        };

        struct Field
        {
                ColumnNameId nameid;
                OID type;
                int sizemodifier;
                bool isbinary;
                VariableTypes::Type vartype;
        };

        std::vector< Field > fields;

        typedef std::variant< std::nullptr_t, int, std::string, PostgresqlTid > Value;

        void ReadColumns(QueryData *querydata);
        ReadResult ReadValue(VarId id_set, int row, int col);
        ReadResult ReadBinaryValue(VarId id_set, OID oid, int len, const char *data, VariableTypes::Type wanttype, ColumnNameId colname);
        ReadResult ReadSimpleTuple(VarId id_set, int row);
        void AddAsParameter(ParamsEncoder *encoder, int row, int col);
        Value ReadValue(int row, int col);
};

/** Describes a query (query string, parameters, requested return value) needed to send a query to PostgreSQL
*/
class Query
{
    public:
        Query(PGSQLTransactionDriver &driver) : params(driver), astext(false) { querystr.reserve(16384); }

        std::string querystr;
        ParamsEncoder params;
        bool astext;
};

class QueryData
{
    public:
        QueryData(PGSQLTransactionDriver &driver)
        : query(driver)
        , usefase2(false)
        , tablecount(0)
        , blockstartrow(0)
        , currow(0)
        {
        }

        Query query;

        struct ResultColumn
        {
                int tableidx;
                ColumnNameId nameid;
                VariableTypes::Type vartype;
        };

        std::vector< ResultColumn > resultcolumns;

        std::string querystrfase2;
        std::vector< ResultColumn > resultcolumnsfase2;

        struct KeyColumn
        {
                unsigned resultcolumn;
        };
        std::optional< KeyColumn > keycolumn;

        struct UpdateColumn
        {
                ColumnNameId nameid;
                std::string colname;
                ParamEncoding::Flags encodingflags;
        };

        std::vector< UpdateColumn > updatecolumns;

        std::string updatedtable;
        bool usefase2;
        unsigned tablecount;
        unsigned blockstartrow;
        unsigned currow;

        Blex::SemiStaticPodVector< PostgresqlTid, fase1_max_blocksize > ctids;

        PGPtr< PGresult > resultset;
        std::unique_ptr< TuplesReader > reader;
};

char *ParamsEncoder::RegisterParameter(OID type, signed len)
{
        auto curdatalen = alldata.size();
        switch (buildmode)
        {
                case Top:
                {
                        types.push_back(static_cast< int >(type));
                        lengths.push_back(len);

                        if (len > 0)
                            alldata.resize(curdatalen + len);
                        return &alldata[curdatalen];
                }
                case Array:
                {
                        alldata.resize(curdatalen + (len > 0 ? len : 0) + 4);
                        Blex::puts32msb(&alldata[curdatalen], len);
                        return &alldata[curdatalen + 4];
                }
                case Record:
                {
                        alldata.resize(curdatalen + (len > 0 ? len : 0) + 8);
                        Blex::puts32msb(&alldata[curdatalen], static_cast< int32_t >(type));
                        Blex::puts32msb(&alldata[curdatalen + 4], len);
                        return &alldata[curdatalen + 8];
                }
        }
        throw std::logic_error("Unknown buildmode");
}

#ifdef DUMP_BINARY_ENCODING
//FIXME Just expose socket.cpp's version to us
void DumpPacket(unsigned len,void  const *buf)
{
        for (unsigned i=0;i<len;i+=16)
        {
                std::ostringstream line;
                line << std::hex << std::setw(4) << i << " ";

                for (unsigned j=0;j<16;++j)
                {
                        if (i+j<len)
                            line << std::hex << std::setfill('0') << std::setw(2) << (int)static_cast<const uint8_t*>(buf)[i+j] << " ";
                        else
                            line << "   ";

                        if (j==7)
                            line << " ";
                }
                line << " ";

                for (unsigned j=0;j<16;++j)
                {
                        if (i+j<len)
                            line << char( static_cast<const uint8_t*>(buf)[i+j]>=32 && static_cast<const uint8_t*>(buf)[i+j]<=127 ? static_cast<const uint8_t*>(buf)[i+j] : '.');

                        if (j==7)
                            line << " ";
                }
                DEBUGPRINT(line.str());
            }
}
#endif

std::string ParamsEncoder::AddVariableParameter(VirtualMachine *vm, VarId var, ParamEncoding::Flags encodingflags)
{
#ifdef DUMP_BINARY_ENCODING
        PQ_ONLYRAW(unsigned startdatalen = alldata.size();)
#endif

        StackMachine &stackm = vm->GetStackMachine();
        VariableTypes::Type type = stackm.GetType(var);
        switch (type)
        {
                case VariableTypes::Integer:
                {
                        Blex::puts32msb(RegisterParameter(OID::INT4, 4), stackm.GetInteger(var));
                } break;
                case VariableTypes::Integer64:
                {
                        Blex::puts64msb(RegisterParameter(OID::INT8, 8), stackm.GetInteger64(var));
                } break;
                case VariableTypes::Boolean:
                {
                        *RegisterParameter(OID::BOOL, 1) = stackm.GetBoolean(var) ? 1 : 0;
                } break;
                case VariableTypes::String:
                {
                        Blex::StringPair str = stackm.GetString(var);
                        return AddParameter(vm, std::string_view(str.begin, str.size()), encodingflags);
                } break;
                case VariableTypes::Float:
                {
                        Blex::putf64msb(RegisterParameter(OID::FLOAT8, 8), stackm.GetFloat(var));
                } break;
                case VariableTypes::DateTime:
                {
                        Blex::DateTime dt = stackm.GetDateTime(var);

                        int64_t val;
                        if (dt == Blex::DateTime::Invalid())
                            val = std::numeric_limits< int64_t >::min();
                        else
                        {
                                int64_t infinity = std::numeric_limits< int64_t >::max(), limit = infinity;
                                int64_t days = (static_cast< int64_t >(dt.GetDays()) - Blex::DateTime::FromDate(2000, 1, 1).GetDays());
                                limit -= dt.GetMsecs() * 1000;
                                if (days > limit / 86400000000)
                                    val = infinity;
                                else
                                    val = days * 86400000000 + dt.GetMsecs() * 1000;
                        }
                        PQ_PRINT("Writing datetime " << val << " for " << dt);
                        Blex::puts64msb(RegisterParameter(OID::TIMESTAMP, 8), val);
                } break;
                case VariableTypes::Money:
                {
                        Blex::SemiStaticPodVector< int16_t, 6 > digitgroups;
                        int64_t toencode = stackm.GetMoney(var);
                        bool negative = toencode < 0;

                        digitgroups.push_back(std::abs(toencode % 10) * 1000);
                        toencode /= 10;

                        int weight = -2;
                        while (toencode)
                        {
                                int64_t gval = toencode % 10000;
                                toencode /= 10000;
                                digitgroups.push_back(std::abs(gval));
                                ++weight;
                        }

                        std::reverse(digitgroups.begin(), digitgroups.end());

                        // prune ending 0's
                        while (!digitgroups.empty() && *digitgroups.rbegin() == 0)
                        {
                                digitgroups.erase(digitgroups.end() - 1);
                        }

                        char *data = RegisterParameter(OID::NUMERIC, 8 + digitgroups.size() * 2);
                        Blex::PutMsb< int16_t >(data, digitgroups.size()); // ndigits
                        Blex::PutMsb< int16_t >(data + 2, weight); // weight
                        Blex::PutMsb< int16_t >(data + 4, negative ? 0x4000 : 0); // sign
                        Blex::PutMsb< int16_t >(data + 6, 5); // dscale
                        data += 8;
                        for (auto val: digitgroups)
                        {
                                Blex::PutMsb< int16_t >(data, val);
                                data += 2;
                        }
                } break;
                case VariableTypes::Blob:
                {
                        auto context = PostgreSQLWHBlobData::GetFromVariable(vm, var, true);
                        if (!context)
                            return "NULL";

                        PQ_PRINT("Encoding blob, current driver: " << context->driver << ", id: " << context->blobid);
                        if (context->driver != &driver) // blob needs to be placed into storage first
                        {
                                BlobRefPtr blobref = stackm.GetBlob(var);
                                Blex::FileOffset len = blobref.GetLength();

                                PQ_PRINT(" length: " << len);

                                if (!len)
                                    return "NULL";

                                if (!driver.webhare_blob_oid)
                                {
                                        HSVM_ThrowException(*vm, "Webhare blob compositetype hasn't been registered yet");
                                        return "";
                                }

                                PQ_PRINT(" starting harescript registration");
                                HSVM_OpenFunctionCall(*vm, 2);
                                HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), driver.sqllib_transid);
                                HSVM_CopyFrom(*vm, HSVM_CallParam(*vm, 1), var);
                                const HSVM_VariableType args[2] = { HSVM_VAR_Integer, HSVM_VAR_Blob };
                                VarId retval = HSVM_CallFunction(*vm, "wh::dbase/postgresql.whlib", "__StoreNewWebharePostgreSQLBlob", 0, 2, args);
                                if (!retval || HSVM_TestMustAbort(*vm))
                                    return "";
                                HSVM_CloseFunctionCall(*vm);

                                // context doesn't need to be reloaded, we're still talking to the same blob
                                if (context->driver != &driver || context->blobid.empty() || !context->bloblength)
                                    throw VMRuntimeError (Error::DatabaseException, "Database error: WebHare database blob wasn't uploaded correctly");

                                Query blobinsertquery(driver);
                                std::string blobparam = blobinsertquery.params.AddParameter(vm, context->blobid);
                                blobinsertquery.querystr = "INSERT INTO webhare_internal.blob(id) VALUES(ROW(" + blobparam + "," + Blex::AnyToString(context->bloblength) + "))";
                                driver.ExecQuery(blobinsertquery, driver.allowwriteerrordelay);
                        }

                        PQ_PRINT(" sending, driver: " << context->driver << ", id: " << context->blobid << " len: " << context->bloblength);

                        if (!context->bloblength)
                            return "NULL";

                        // encode record
                        char *data = RegisterParameter(static_cast< OID >(driver.webhare_blob_oid), 28 + context->blobid.size());
                        Blex::putu32msb(data, 2); // 2 columns
                        Blex::puts32msb(data + 4, static_cast< int32_t >(OID::TEXT)); // col 1, OID
                        Blex::puts32msb(data + 8, context->blobid.size()); // col 1, length of blobid
                        std::copy(context->blobid.begin(), context->blobid.end(), data + 12);
                        Blex::puts32msb(data + 12 + context->blobid.size(), static_cast< int32_t >(OID::INT8)); // col 2, OID
                        Blex::puts32msb(data + 16 + context->blobid.size(), 8); // col 2, 8 bytes length
                        Blex::puts64msb(data + 20 + context->blobid.size(), context->bloblength); // col 2, 8 bytes of length
                } break;
                default:
                {
                        if (type & VariableTypes::Array)
                        {
                                OID arrayoid, eltoid;
                                switch (type)
                                {
                                        case VariableTypes::IntegerArray:       arrayoid = OID::INT4ARRAY; eltoid = OID::INT4; break;
                                        case VariableTypes::Integer64Array:     arrayoid = OID::INT8ARRAY; eltoid = OID::INT8; break;
                                        case VariableTypes::StringArray:
                                        {
                                                if (encodingflags & ParamEncoding::Binary)
                                                {
                                                        arrayoid = OID::BYTEAARRAY;
                                                        eltoid = OID::BYTEA;
                                                }
                                                else
                                                {
                                                        arrayoid = OID::TEXTARRAY;
                                                        eltoid = OID::TEXT;
                                                }
                                        } break;
                                        case VariableTypes::DateTimeArray:      arrayoid = OID::TIMESTAMPARRAY; eltoid = OID::TIMESTAMP; break;
                                        default:
                                        {
                                                HSVM_ThrowException(*vm, ("Cannot encode variables of type " + GetTypeName(stackm.GetType(var)) + " for PostgreSQL queries").c_str());
                                                return "";
                                        }
                                }

                                unsigned eltcount = stackm.ArraySize(var);

                                auto finalizedata = AddArrayParameter(arrayoid, eltoid, eltcount);

                                for (unsigned i = 0; i < eltcount; ++i)
                                {
                                        std::string pid = AddVariableParameter(vm, stackm.ArrayElementGet(var, i), encodingflags);
                                        if (pid.empty())
                                            return "";
                                        if (pid == "NULL")
                                        {
                                                auto lenpos = alldata.size();
                                                alldata.resize(lenpos + 4); // reserve space for the size
                                                Blex::puts32msb(&alldata[lenpos], -1);
                                                finalizedata.hasnull = true;
                                        }
                                }

                                FinalizeParameter(finalizedata);
                        }
                        else
                        {
                                HSVM_ThrowException(*vm, ("Cannot encode variables of type " + GetTypeName(stackm.GetType(var)) + " for PostgreSQL queries").c_str());
                                return "";
                        }
                }
        }

#ifdef DUMP_BINARY_ENCODING
        PQ_PRINT("Encoded $" + Blex::AnyToString(lengths.size()) << " from a " << GetTypeName(stackm.GetType(var)));
        PQ_ONLY(DumpPacket(alldata.size() - startdatalen, &alldata[startdatalen]));
#endif

        return "$" + Blex::AnyToString(lengths.size());
}

std::string ParamsEncoder::AddParameter(VirtualMachine *, std::string_view str, ParamEncoding::Flags encodingflags)
{
#ifdef DUMP_BINARY_ENCODING
        PQ_ONLYRAW(unsigned startdatalen = alldata.size();)
#endif

        if (encodingflags & ParamEncoding::Pattern)
        {
                std::string pattern;
                for (const char *it = str.begin(); it != str.end(); ++it)
                {
                        if (*it == '_' || *it == '%' || *it == '\\')
                            pattern.push_back('\\');
                        if (*it == '?')
                            pattern.push_back('_');
                        else if (*it == '*')
                            pattern.push_back('%');
                        else
                            pattern.push_back(*it);
                }
                std::copy(pattern.begin(), pattern.end(), RegisterParameter((encodingflags & ParamEncoding::Binary) ? OID::BYTEA : OID::VARCHAR, pattern.size()));
        }
        else
        {
                std::copy(str.begin(), str.end(), RegisterParameter((encodingflags & ParamEncoding::Binary) ? OID::BYTEA : OID::VARCHAR, str.size()));
        }

#ifdef DUMP_BINARY_ENCODING
        PQ_PRINT("Encoded $" + Blex::AnyToString(lengths.size()) << " from a string parameter");
        PQ_ONLY(DumpPacket(alldata.size() - startdatalen, &alldata[startdatalen]));
#endif

        return "$" + Blex::AnyToString(lengths.size());
}

ParamsEncoder::FinalizeData ParamsEncoder::AddArrayParameter(OID type, OID eltoid, unsigned eltcount)
{
        BuildMode orgbuildmode = buildmode;

        unsigned datastart = alldata.size();
        char *header = RegisterParameter(type, 20); // 20 is the header size

        buildmode = Array;
        Blex::puts32msb(header, 1); // 1 dimension
        Blex::puts32msb(header + 4, 0); // has null
        Blex::puts32msb(header + 8, static_cast< int32_t >(eltoid)); // has null
        Blex::puts32msb(header + 12, eltcount); // first dimension size
        Blex::puts32msb(header + 16, 0); // lower bound

        return FinalizeData{ orgbuildmode, datastart, false };
}

ParamsEncoder::FinalizeData ParamsEncoder::AddRecordParameter(OID type, unsigned eltcount)
{
        BuildMode orgbuildmode = buildmode;

        unsigned datastart = alldata.size();
        char *header = RegisterParameter(type, 4); // 4 bytes for eltcount

        buildmode = Record;
        Blex::puts32msb(header, eltcount); // 1 dimension

        return FinalizeData{ orgbuildmode, datastart, false };
}

void ParamsEncoder::FinalizeParameter(FinalizeData const &finalizedata)
{
        if (buildmode == Array && finalizedata.hasnull)
            Blex::puts32msb(&alldata[finalizedata.datastart + 4], 1); // has null

        buildmode = finalizedata.orgbuildmode;
        if (buildmode == Top)
        {
                // Adjust length
                *lengths.rbegin() = alldata.size() - finalizedata.datastart;
        }
        else
        {
                Blex::puts32msb(&alldata[finalizedata.datastart - 4], alldata.size() - finalizedata.datastart);
        }
}

void ParamsEncoder::Finalize()
{
        if (!lengths.empty())
        {
                dataptrs.clear();
                formats.clear();

                // Make sure alldata isn't empty, so dataptr won't become nullptr (indicating a NULL)
                // This can happen when adding only empty strings
                if (alldata.size() == 0)
                    alldata.push_back(0);

                const char *ptr = alldata.begin();
                for (auto len: lengths)
                {
                        dataptrs.push_back(ptr);
                        formats.push_back(1);
                        ptr += len;
                }
        }
}

void TuplesReader::ReadColumns(QueryData *querydata)
{
        StackMachine &stackm = vm->GetStackMachine();

        int fieldcount = PQnfields(res);
        fields.reserve(fieldcount);
        for (int idx = 0; idx < fieldcount; ++idx)
        {
                Field field;
                field.nameid = querydata ? querydata->resultcolumns[idx].nameid : stackm.columnnamemapper.GetMapping(PQfname(res, idx));
                field.type = static_cast< OID >(PQftype(res, idx));
                field.sizemodifier = PQfmod(res, idx);
                field.isbinary = PQfformat(res, idx);
                field.vartype = querydata ? querydata->resultcolumns[idx].vartype : VariableTypes::Variant;
                fields.push_back(field);
        }

        PQ_PRINT("Results: " << PQntuples(res) << ", fieldcount: " << fieldcount);
}

TuplesReader::ReadResult TuplesReader::ReadValue(VarId id_set, int row, int col)
{
        StackMachine &stackm = vm->GetStackMachine();

        int len = PQgetlength(res, row, col);
        char const *data = PQgetvalue(res, row, col);
        bool isnull = PQgetisnull(res, row, col);

        //PQ_PRINT("Read row: " << row << ", col: " << col << ", len: " << len << ", isnull: " << isnull << " type " << static_cast< int >(fields[col].type));

        if (!fields[col].isbinary)
        {
                stackm.SetSTLString(id_set, std::string_view(data, len));
                return isnull ? ReadResult::Null : ReadResult::Value;
        }

        TuplesReader::ReadResult retval = ReadBinaryValue(id_set, fields[col].type, isnull ? -1 : len, data, fields[col].vartype, fields[col].nameid);
        if (retval == ReadResult::Exception)
            return retval;

        return retval;
}

void TuplesReader::AddAsParameter(ParamsEncoder *encoder, int row, int col)
{
        int len = PQgetlength(res, row, col);
        char const *data = PQgetvalue(res, row, col);
        bool isnull = PQgetisnull(res, row, col);

        char *writepos = encoder->RegisterParameter(fields[col].type, isnull ? -1 : len);
        if (!isnull && len)
            std::copy(data, data + len, writepos);
}

TuplesReader::ReadResult TuplesReader::ReadBinaryValue(VarId id_set, OID type, int len, const char *data, VariableTypes::Type wanttype, ColumnNameId colname)
{
#ifdef DUMP_BINARY_ENCODING
        PQ_ONLY(
                PQ_PRINT("Decoding " << int(type) << " of len " << len);
                if (len >= 0)
                    DumpPacket(len, data);
        );
#endif

        StackMachine &stackm = vm->GetStackMachine();
        switch (type)
        {
                case OID::BOOL:
                {
                        stackm.SetBoolean(id_set, len == 1 ? *data != 0 : false);
                } break;
                case OID::BYTEA:
                case OID::CHAR:
                case OID::NAME:
                case OID::TEXT:
                case OID::VARCHAR:
                {
                        if (len > 0)
                            stackm.SetSTLString(id_set, std::string_view(data, len));
                        else
                            stackm.SetSTLString(id_set, "");
                } break;
                case OID::INT2:
                {
                        stackm.SetInteger(id_set, len == 2 ? Blex::gets16msb(data) : 0);
                } break;
                case OID::CID:
                case OID::OID:
                case OID::REGPROC:
                case OID::XID:
                {
                        stackm.SetInteger(id_set, len == 4 ? Blex::gets32msb(data) : 0);
                } break;
                case OID::INT4:
                {
                        int32_t value = len == 4 ? Blex::gets32msb(data) : 0;
                        stackm.SetInteger(id_set, value);
                } break;
                case OID::INT8:
                {
                        stackm.SetInteger64(id_set, len == 8 ? Blex::gets64msb(data) : 0);
                } break;
                case OID::FLOAT4:
                {
                        stackm.SetFloat(id_set, len == 4 ? Blex::getf32msb(data) : 0);
                } break;
                case OID::FLOAT8:
                {
                        stackm.SetFloat(id_set, len == 8 ? Blex::getf64msb(data) : 0);
                } break;
                case OID::TID:
                {
                        stackm.SetSTLString(id_set, len == 6
                                ? "'(" + Blex::AnyToString(Blex::getu32msb(data)) + "," + Blex::AnyToString(Blex::getu16msb(data + 4)) + ")'"
                                : "");
                } break;
                case OID::TIMESTAMP:
                case OID::TIMESTAMPTZ:
                {
                        int64_t val = len == 8 ? Blex::gets64msb(data) : std::numeric_limits< int64_t >::min();

                        Blex::DateTime dt;
                        if (val == std::numeric_limits< int64_t >::max())
                            dt = Blex::DateTime::Max();
                        else
                        {
                                // PostgreSQL stores an amount of microseconds, 1-1-2000 00:00 is 0 microseconds.
                                int64_t days = (val / 86400000000) + Blex::DateTime::FromDate(2000, 1, 1).GetDays();
                                int64_t usecs = val % 86400000000;

                                /* Blex::DateTime must be initialize with positive msec count. When
                                   doing modulo on a negative integer, we'll get a negative
                                   amount of msecs. If that's the case, move a day to the usecs
                                   to get it positive again */
                                if (usecs < 0)
                                {
                                        usecs += 86400000000;
                                        --days;
                                }
                                int64_t msecs = usecs / 1000;
                                if (days < 0)
                                    dt = Blex::DateTime::Invalid();
                                else
                                    dt = Blex::DateTime(days, msecs);
                        }

                        PQ_PRINT("Read datetime " << val << " to " << dt);
                        stackm.SetDateTime(id_set, dt);
                } break;
                case OID::NUMERIC:
                {
                        if (len < 8)
                            stackm.SetMoney(id_set, 0);
                        else
                        {
                                int ndigits = Blex::gets16msb(data);
                                int firstgroupweight = Blex::gets16msb(data + 2);
                                int sign = Blex::gets16msb(data + 4);
                                //int dscale = Blex::gets16msb(data + 6); // don't need presentation hints

                                if (len < 8 + 2*ndigits || sign == 0x8000) // sign 0x8000 means NaN
                                    stackm.SetMoney(id_set, 0);
                                else
                                {
                                        // read all digit groups (4 digits per group)
                                        Blex::SemiStaticPodVector< uint64_t, 16 > digitgroups;
                                        for (int i = 0; i < ndigits; ++i)
                                            digitgroups.push_back(Blex::gets16msb(data + 8 + 2*i));

                                        // the individual digitgroups should be multiplied with (10^(4*weight))
                                        // digitgroup[0] has weight 'firstgroupweight', digitgroup[1] has weight 'firstgroupweight' - 1, etc.

                                        // make sure we have all digit groups until weight -2
                                        int lastgroupweight = firstgroupweight - ndigits + 1;
                                        while (lastgroupweight > -2)
                                        {
                                                digitgroups.push_back(0);
                                                --lastgroupweight;
                                        }

                                        int64_t limitval = sign == 0 ? std::numeric_limits< int64_t >::max() : std::numeric_limits< int64_t >::min();
                                        int64_t runninglimitval = limitval;
                                        int64_t result = 0;
                                        int64_t mulfac = 1;

                                        // iterate over the digitgroups, lowest weight first
                                        int weight = lastgroupweight;
                                        for (auto itr = digitgroups.rbegin(); itr != digitgroups.rend(); ++itr)
                                        {
                                                // Get the digits in the group
                                                int64_t digitsval = sign ? -*itr : *itr;

                                                if (weight < -2) // can't have any rounding effect
                                                     continue;
                                                else if (weight == -2)
                                                {
                                                        // Use the highest digit of the group, use the rest for rounding
                                                        result = (digitsval + (sign ? -500 : 500)) / 1000;
                                                        runninglimitval = (runninglimitval - result) / 10;
                                                        mulfac = 10;
                                                }
                                                else
                                                {
                                                        if (sign ? digitsval < runninglimitval : digitsval > runninglimitval)
                                                        {
                                                                // overflow!
                                                                PQ_PRINT("  overflow");
                                                                result = limitval;
                                                                break;
                                                        }

                                                        runninglimitval = (runninglimitval - digitsval) / 10000;
                                                        result += digitsval * mulfac;
                                                        mulfac *= 10000;
                                                }
                                                ++weight;
                                        }

                                        stackm.SetMoney(id_set, result);
                                }
                        }
                } break;
                case OID::CIDR:
                case OID::INET:
                {
#ifdef DUMP_BINARY_ENCODING
                        PQ_ONLY(
                                if (len >= 0)
                                {
                                        PQ_PRINT("Decode INET/CIDR");
                                        DumpPacket(len, data);
                                }
                                else
                                    PQ_PRINT("Decode INET/CIDR: NULL");
                        );
#endif
                        // format:
                        //  0: addr family (PGSQL_AF_INET/PGSQL_AF_INET6)
                        //  1: mask bits
                        //  2: is_cidr: 1/0
                        //  3: length mask
                        if (len >= 4)
                        {
                                uint8_t maskbits = *reinterpret_cast< uint8_t const * >(data + 1);

                                std::string addr_str;
                                if (*data == AF_INET + 0 && *(data + 3) == 4 && len >= 8) // PGSQL_AF_INET == AF_INET + 0
                                {
                                        Blex::SocketAddress addr;
                                        sockaddr_in &ipv4_addr = addr.GetIP4SockAddr();
                                        ipv4_addr.sin_family = AF_INET;
                                        memcpy(&ipv4_addr.sin_addr, data + 4, 4);
                                        addr_str = addr.GetIPAddress();
                                        if (maskbits != 32)
                                        {
                                                addr_str += "/";
                                                Blex::EncodeNumber(maskbits, 10, std::back_inserter(addr_str));
                                        }
                                }
                                if (*data == AF_INET + 1 && *(data + 3) == 16 && len >= 20) // PGSQL_AF_INET6 == AF_INET + 1
                                {
                                        Blex::SocketAddress addr;
                                        sockaddr_in6 &ipv6_addr = addr.GetIP6SockAddr();
                                        ipv6_addr.sin6_family = AF_INET6;
                                        memcpy(&ipv6_addr.sin6_addr, data + 4, 20);
                                        addr_str = addr.GetIPAddress();
                                        if (maskbits != 128)
                                        {
                                                addr_str += "/";
                                                Blex::EncodeNumber(maskbits, 10, std::back_inserter(addr_str));
                                                Blex::ToLowercase(addr_str.begin(), addr_str.end());
                                        }
                                }
                                stackm.SetSTLString(id_set, addr_str);
                        }
                        else
                            stackm.SetSTLString(id_set, ""sv);
                } break;
                case OID::CHARARRAY:
                case OID::INT2ARRAY:
                case OID::INT2VECTOR:
                case OID::INT4ARRAY:
                case OID::INT8ARRAY:
                case OID::TEXTARRAY:
                case OID::BYTEAARRAY:
                case OID::OIDARRAY:
                case OID::OIDVECTOR:
                case OID::TIMESTAMPARRAY:
                case OID::ANYARRAY:
                case OID::RECORDARRAY:
                {
                        OID elttype;
                        VariableTypes::Type vartype;
                        switch (type)
                        {
                        case OID::CHARARRAY:    elttype = OID::CHAR; vartype = VariableTypes::StringArray; break;
                        case OID::INT2VECTOR:   elttype = OID::INT2; vartype = VariableTypes::IntegerArray; break;
                        case OID::INT2ARRAY:    elttype = OID::INT2; vartype = VariableTypes::IntegerArray; break;
                        case OID::INT4ARRAY:    elttype = OID::INT4; vartype = VariableTypes::IntegerArray; break;
                        case OID::INT8ARRAY:    elttype = OID::INT8; vartype = VariableTypes::Integer64Array; break;
                        case OID::OIDARRAY:     elttype = OID::OID; vartype = VariableTypes::IntegerArray; break;
                        case OID::OIDVECTOR:    elttype = OID::OID; vartype = VariableTypes::IntegerArray; break;
                        case OID::TEXTARRAY:    elttype = OID::TEXT; vartype = VariableTypes::StringArray; break;
                        case OID::BYTEAARRAY:   elttype = OID::BYTEA; vartype = VariableTypes::StringArray; break;
                        case OID::TIMESTAMPARRAY: elttype = OID::TIMESTAMP; vartype = VariableTypes::DateTimeArray; break;
                        case OID::ANYARRAY:     elttype = OID::ANY; vartype = VariableTypes::VariantArray; break;
                        case OID::RECORDARRAY:  elttype = OID::RECORD; vartype = VariableTypes::VariantArray; break;
                        default:
                                {
                                        HSVM_ThrowException(*vm, ("Cannot determine element type variables of array type " + Blex::AnyToString(static_cast< unsigned >(type))).c_str());
                                        return ReadResult::Exception;
                                }
                        }

                        int32_t dimcount = len >= 4 ? Blex::gets32msb(data) : 0;
                        if (dimcount == 0)
                        {
                                stackm.ArrayInitialize(id_set, 0, vartype);
                                return ReadResult::Null;
                        }
                        if (dimcount != 1)
                        {
                                HSVM_ThrowException(*vm, ("Cannot read arrays with dimension " + Blex::AnyToString(dimcount)).c_str());
                                return ReadResult::Exception;
                        }

                        // ignore hasnulls

                        OID gottype = static_cast< OID >(Blex::gets32msb(data + 8));
                        if (elttype == OID::ANY)
                            elttype = gottype;
                        if (elttype != gottype)
                        {
                                HSVM_ThrowException(*vm, ("Expected array element type " + Blex::AnyToString(static_cast< unsigned >(elttype)) + ", got " + Blex::AnyToString(static_cast< unsigned >(gottype))).c_str());
                                return ReadResult::Exception;
                        }

                        int32_t eltcount = Blex::gets32msb(data + 12);
                        // ignore lbound at +16

                        stackm.ArrayInitialize(id_set, eltcount, vartype);


                        VariableTypes::Type varelttype = static_cast< VariableTypes::Type >(vartype & ~VariableTypes::Array);

                        data += 20;
                        for (int32_t i = 0; i < eltcount; ++i)
                        {
                                int32_t len = Blex::gets32msb(data);
                                data += 4;
                                VarId elt = stackm.ArrayElementRef(id_set, i);
                                ReadResult readres = ReadBinaryValue(elt, elttype, len, data, varelttype, colname);
                                if (readres == ReadResult::Exception)
                                    return readres;

                                if (len > 0) // negative len is NULL
                                   data += len;
                        }
                } break;
                case OID::RECORD:
                {
                        int32_t eltcount = len >= 4 ? Blex::gets32msb(data) : 0;
                        data += 4;
                        len -= 4;

                        stackm.ArrayInitialize(id_set, eltcount, VariableTypes::VariantArray);
                        for (int32_t i = 0; i < eltcount; ++i)
                        {
                                if (len < 8)
                                    break;

                                OID elttype = static_cast< OID >(Blex::gets32msb(data));
                                int32_t len = Blex::gets32msb(data + 4);
                                data += 8;

                                VarId elt = stackm.ArrayElementRef(id_set, i);
                                ReadResult readres = ReadBinaryValue(elt, elttype, len, data, VariableTypes::Variant, colname);
                                if (readres == ReadResult::Exception)
                                    return readres;

                                if (len > 0) // negative len is NULL
                                   data += len;
                        }
                } break;
                default:
                {
                        if (type == static_cast< OID >(driver.webhare_blob_oid))
                        {
                                stackm.InitVariable(id_set, VariableTypes::Blob);
                                if (len < 0)
                                    return ReadResult::Null;
                                if (len < 28)
                                {
                                        HSVM_ThrowException(*vm, ("Cannot decode variables of type " + Blex::AnyToString(static_cast< unsigned >(type))).c_str());
                                        return ReadResult::Exception;
                                }

                                int32_t col1len = Blex::getu32msb(data + 8);
                                if (Blex::getu32msb(data) == 2
                                        && Blex::gets32msb(data + 4) == static_cast< int32_t >(OID::TEXT)
                                        && col1len > 0
                                        && Blex::gets32msb(data + 12 + col1len) == static_cast< int32_t >(OID::INT8)
                                        && Blex::getu32msb(data + 16 + col1len) == 8)
                                {
                                        std::string blobid = std::string(data + 12, data + 12 + col1len);
                                        Blex::FileOffset bloblength = Blex::gets64msb(data + 20 + col1len);

                                        bool have_blob = false;

                                        // If we have a disk-folder, lookup blobs with strategy AAAB (=1) on disk first
                                        if (blobid.size() >= 6 && std::equal(blobid.begin(), blobid.begin() + 4, "AAAB"))
                                        {
                                                std::string resourcepath = "direct::" + driver.blobfolder + "/blob/" + blobid.substr(4, 2) + "/" + blobid.substr(4);
                                                if (!HSVM_MakeBlobFromFilesystem(*vm, id_set, resourcepath.c_str(), 7))
                                                {
                                                        PQ_PRINT(" found blob " << blobid << " at " << resourcepath);

                                                        auto context = PostgreSQLWHBlobData::GetFromVariable(vm, id_set, true);
                                                        context->driver = &driver;
                                                        context->blobid = blobid;
                                                        context->bloblength = bloblength;

                                                        have_blob = true;
                                                }
                                                else
                                                {
                                                        PQ_PRINT(" blob " << blobid << " not found at " << resourcepath);
                                                }
                                        }

                                        if (!have_blob)
                                        {
                                                PQ_PRINT(" starting harescript lookup for blob " << blobid);
                                                HSVM_OpenFunctionCall(*vm, 3);
                                                HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), driver.sqllib_transid);
                                                HSVM_StringSetSTD(*vm, HSVM_CallParam(*vm, 1), blobid);
                                                HSVM_Integer64Set(*vm, HSVM_CallParam(*vm, 2), bloblength);
                                                const HSVM_VariableType args[3] = { HSVM_VAR_Integer, HSVM_VAR_String, HSVM_VAR_Integer64 };
                                                VarId retval = HSVM_CallFunction(*vm, "wh::dbase/postgresql.whlib", "__LookupWebharePostgreSQLBlob", HSVM_VAR_Blob, 3, args);
                                                if (retval && !HSVM_TestMustAbort(*vm))
                                                    HSVM_CopyFrom(*vm, id_set, retval);
                                                HSVM_CloseFunctionCall(*vm);

                                                if (!retval || HSVM_TestMustAbort(*vm))
                                                    return ReadResult::Exception;

                                                // Check and throw fatal errors when the function itself returns incorrect data
                                                auto context = PostgreSQLWHBlobData::GetFromVariable(vm, id_set, false);
                                                if (!context || context->driver != &driver || context->blobid != blobid)
                                                    throw VMRuntimeError (Error::DatabaseException, "Blob returned by __LookupWebharePostgreSQLBlob for '" + blobid + "' hasn't been registered properly");
                                                if (context->bloblength != bloblength)
                                                    throw VMRuntimeError (Error::DatabaseException, "Blob returned by __LookupWebharePostgreSQLBlob for '" + blobid + "' has the wrong length, expected " + Blex::AnyToString(bloblength) + ", got " + Blex::AnyToString(context->bloblength));
                                        }
                                }
                                else
                                {
                                        HSVM_ThrowException(*vm, ("Cannot decode variables of type " + Blex::AnyToString(static_cast< unsigned >(type))).c_str());
                                        return ReadResult::Exception;
                                }
                        }
                        else
                        {
                                HSVM_ThrowException(*vm, ("Cannot decode variables of type " + Blex::AnyToString(static_cast< unsigned >(type))).c_str());
                                return ReadResult::Exception;
                        }
                }
        }

        if (len < 0)
            return ReadResult::Null;

        if (wanttype != VariableTypes::Variant)
        {
                VariableTypes::Type gottype = stackm.GetType(id_set);
                try
                {
                        stackm.ForcedCastTo(id_set, wanttype);
                }
                catch(const std::exception& e)
                {
                        HSVM_ThrowException(*vm, ("Cannot cast column '" + stackm.columnnamemapper.GetReverseMapping(colname).stl_str() + "' from type " + HareScript::GetTypeName(gottype) + " to type " + HareScript::GetTypeName(wanttype)).c_str());
                        return ReadResult::Exception;
                }
        }
        return ReadResult::Value;
}

TuplesReader::ReadResult TuplesReader::ReadSimpleTuple(VarId id_set, int row)
{
        StackMachine &stackm = vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::Record);
        for (unsigned i = 0, e = fields.size(); i < e; ++i)
        {
                VarId elt = stackm.RecordCellCreate(id_set, fields[i].nameid);
                if (ReadValue(elt, row, i) == ReadResult::Exception)
                    return ReadResult::Exception;
        }
        return ReadResult::Value;
}

TuplesReader::Value TuplesReader::ReadValue(int row, int col)
{
        int len = PQgetlength(res, row, col);
        char const *data = PQgetvalue(res, row, col);
        bool isnull = PQgetisnull(res, row, col);

        if (isnull)
            return Value(nullptr);

        //PQ_PRINT("Read row: " << row << ", col: " << col << ", len: " << len << ", isnull: " << isnull << " type " << static_cast< int >(fields[col].type));

        if (!fields[col].isbinary)
            return Value(std::string(data, len));

        switch (fields[col].type)
        {
                case OID::BOOL:
                {
                        return Value(len == 1 ? *data != 0 : false);
                } break;
                case OID::BYTEA:
                case OID::CHAR:
                case OID::NAME:
                case OID::TEXT:
                case OID::VARCHAR:
                {
                        if (len > 0)
                            return Value(std::string(data, len));
                        else
                            return Value(std::string());
                } break;
                case OID::INT2:
                {
                        return Value(int32_t(len == 2 ? Blex::gets16msb(data) : 0));
                } break;
                case OID::CID:
                case OID::OID:
                case OID::REGPROC:
                case OID::XID:
                {
                        return Value(int32_t(len == 4 ? Blex::gets32msb(data) : 0));
                } break;
                case OID::INT4:
                {
                        return Value(int32_t(len == 4 ? Blex::gets32msb(data) : 0));
                } break;
                case OID::TID:
                {
                        if (len != 6)
                            return Value(nullptr);
                        return Value(PostgresqlTid{ Blex::getu32msb(data), Blex::getu16msb(data + 4) });
                }
                default:
                {
                        // ADDME: use different class for this return type?
                        return Value(nullptr);
                }
        }
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


DBConditionCode::_type SwappedCondition(DBConditionCode::_type cond)
{
        switch (cond)
        {
        case DBConditionCode::LessEqual:  cond = DBConditionCode::BiggerEqual; break;
        case DBConditionCode::Less:       cond = DBConditionCode::Bigger; break;
        case DBConditionCode::BiggerEqual:cond = DBConditionCode::LessEqual; break;
        case DBConditionCode::Bigger:     cond = DBConditionCode::Less; break;
        case DBConditionCode::Like:
            throw VMRuntimeError (Error::DatabaseException, "Cannot swap arguments to LIKE");
            break;
        case DBConditionCode::In:
            throw VMRuntimeError (Error::DatabaseException, "Cannot swap arguments to IN");
            break;
        default: ;
        }
        return cond;
}

const char* GetOperator(DBConditionCode::_type condition)
{
        switch (condition)
        {
        case DBConditionCode::Less:       return "<";
        case DBConditionCode::LessEqual:  return "<=";
        case DBConditionCode::Equal:      return "=";
        case DBConditionCode::Bigger:     return ">";
        case DBConditionCode::BiggerEqual:return ">=";
        case DBConditionCode::UnEqual:    return "<>";
        case DBConditionCode::Like:       return " LIKE ";
        case DBConditionCode::In:         return " = ";
        default:
            throw VMRuntimeError (Error::DatabaseException, "Encountered unkown relation type");
            return "";
        }
}



PGSQLTransactionDriver::PGSQLTransactionDriver(HSVM *_vm, PGconn *_conn, PGSQLTransactionDriver::Options const &options)
: DatabaseTransactionDriverInterface(GetVirtualMachine(_vm))
, conn(_conn)
, prepared_statements_counter(0)
, isworkopen(false)
, webhare_blob_oid(0)
, webhare_blobarray_oid(0)
, blobfolder(options.blobfolder)
, allowwriteerrordelay(false)
, logstacktraces(options.logstacktraces)
{
        description.supports_block_cursors = false;
        description.supports_single = true; // unused!!
        description.supports_data_modify = true;
        description.supports_nulls = true;
        description.supports_limit = true;
        description.needs_locking_and_recheck = false;
        description.fase2_locks_implicitly = true;
        description.needs_uppercase_names = false;
        description.max_joined_tables = 0;
        description.max_multiinsertrows = 64;

        PQsetNoticeReceiver(conn, &NoticeReceiverCallback, this);

        this->ScanTypes();
}

PGSQLTransactionDriver::~PGSQLTransactionDriver()
{
        PQfinish(conn);
}

std::pair< ConnStatusType, PGTransactionStatusType > PGSQLTransactionDriver::GetStatus()
{
        return std::make_pair(PQstatus(conn), PQtransactionStatus(conn));
}

int PGSQLTransactionDriver::GetBackendPid()
{
        return PQbackendPID(conn);
}

std::string_view PGSQLTransactionDriver::ReadResultCell(PGPtr< PGresult > &resultset, unsigned row, unsigned col)
{
        int len = PQgetlength(resultset.get(), row, col);
        char const *data = PQgetvalue(resultset.get(), row, col);
        return std::string_view(data, len);
}

int32_t PGSQLTransactionDriver::ReadResultCellInt(PGPtr< PGresult > &resultset, unsigned row, unsigned col)
{
        std::string_view data = ReadResultCell(resultset, row, col);
        return Blex::DecodeUnsignedNumber< int32_t, std::string_view::iterator >(data.begin(), data.end()).first;
}

void PGSQLTransactionDriver::ScanTypes()
{
        // Scan all declared RECORD types in the database
        Query query(*this);
        query.querystr =
                "SELECT t.oid, t.typname, t.typarray"
                "  FROM pg_catalog.pg_type t"
                "       JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid"
                "       JOIN pg_catalog.pg_proc p ON t.typinput = p.oid"
                " WHERE nspname = 'public' AND t.typname = 'webhare_blob' AND proname = 'record_in'";
        query.astext = true;

        auto resultset = ExecQuery(query, false);
        if (resultset)
        {
                // reset current stored data
                webhare_blob_oid = 0;
                webhare_blobarray_oid = 0;

                for (unsigned row = 0, rowcount = PQntuples(resultset.get()); row != rowcount; ++row)
                {
                        if (ReadResultCell(resultset, row, 1) == "webhare_blob")
                        {
                                webhare_blob_oid = ReadResultCellInt(resultset, row, 0);
                                webhare_blobarray_oid = ReadResultCellInt(resultset, row, 2);
                        }
                }
        }
}

bool PGSQLTransactionDriver::BuildQueryString(
        QueryData &querydata,
        DatabaseQuery &query,
        DatabaseTransactionDriverInterface::CursorType cursortype)
{
        //querydata.result_columns.clear();

        bool all_handled = true;

        // Filter all conditions that we can handle; update retrieval time for that columns
        for (std::vector< SingleCondition >::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
        {
                // No blob comparisons can be handled by the DB
                VariableTypes::Type coltype = query.tables[it->table].ColType(it->column).type;
                it->handled = coltype != VariableTypes::Blob;

                // Only support for IN INTEGER ARRAY, INTEGER64ARRAY, TEXTARRAY and DATETIMEARRAY
                if (it->condition == DBConditionCode::In
                        && coltype != VariableTypes::Integer
                        && coltype != VariableTypes::Integer64
                        && coltype != VariableTypes::String
                        && coltype != VariableTypes::DateTime)
                     it->handled = false;

                // No LIKE matching or case insensitive compares for binary columns
                if ((it->condition == DBConditionCode::Like || !it->casesensitive)
                        && (query.tables[it->table].typeinfo->columnsdef[it->column].flags & ColumnFlags::Binary))
                    it->handled = false;

                if (!it->handled)
                {
                        query.tables[it->table].columns[it->column].fase = Fases::Fase1 | Fases::Recheck;
                        all_handled = false;
                }
                else
                    query.tables[it->table].columns[it->column].fase |= Fases::Recheck;
        }

        for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
        {
//                // FIXME: we don't handle a join between two null-translated tables; don't know how to handle it here...
//                bool two_null_t = (query.tables[it->table1].columns[it->column1].flags & ColumnFlags::TranslateNulls) && (query.tables[it->table2].columns[it->column2].flags & ColumnFlags::TranslateNulls);
                it->handled = it->casesensitive &&
                        it->condition != DBConditionCode::Like &&
                        it->condition != DBConditionCode::In &&
                        query.tables[it->table1].ColType(it->column1).type != VariableTypes::Blob &&
                        query.tables[it->table2].ColType(it->column2).type != VariableTypes::Blob;

                if (!it->handled)
                {
                        query.tables[it->table1].columns[it->column1].fase = Fases::Fase1 | Fases::Recheck;
                        query.tables[it->table2].columns[it->column2].fase = Fases::Fase1 | Fases::Recheck;
                        all_handled = false;
                }
                else
                {
                        query.tables[it->table1].columns[it->column1].fase |= Fases::Recheck;
                        query.tables[it->table2].columns[it->column2].fase |= Fases::Recheck;
                }
        }

        std::string select, selectfase2base, selectfase2cols, from, where, fase2key;

        if (cursortype != DatabaseTransactionDriverInterface::Select)
        {
                // For updating queries, get the 'ctid' column as column 0
                QueryData::ResultColumn rcol;
                rcol.tableidx = -1;
                rcol.nameid = 0;
                rcol.vartype = VariableTypes::Variant;
                querydata.resultcolumns.push_back(rcol);
                querydata.resultcolumnsfase2.push_back(rcol);
                select = "T0.ctid"sv;
                selectfase2base = "T0.ctid"sv;

                // in fase2, the row position is returned as column 1
                rcol.vartype = VariableTypes::Integer;
                querydata.resultcolumnsfase2.push_back(rcol);

                // find the keys for this table
                unsigned keycount = 0;
                for (unsigned colidx = 0, e = query.tables[0].columns.size(); colidx < e; ++colidx)
                {
                        auto &coltype = query.tables[0].ColType(colidx);
                        if (coltype.flags & ColumnFlags::Key)
                        {
                                ++keycount;
                                AddTableAndColumnName(query, 0, colidx, true, &fase2key);
                        }
                }

                /* Can't get lookups for multiple columns to work, so using fase2 is off in
                   that case. Comparing anonymous records returns a 'comparison not implemented'
                   error
                */
                if (keycount == 1)
                {
                        // querydata.keycolumn will be filled during result column building
                        querydata.usefase2 = true;
                }
                else
                {
                        fase2key = "T0.ctid";
                        querydata.keycolumn = QueryData::KeyColumn{0};
                }
        }

        /* FIXME: propagate has_hs_code from sqllib to database query - if it is false
           and all the single/join conditations are handled we won't need fase2
        */
        // if (!query.has_hs_code && all_handled) usefase2 = false;

        unsigned tableidx = 0;
        for (auto &tbl: query.tables)
        {
                // from-part
                if (tableidx)
                    from.append(", "sv);

                AddEscapedSchemaTable(&from, tbl.name);
                from.append(" ");
                AddTableName(tableidx, &from);

                // select-part
                unsigned colidx = 0;
                for (auto &col: tbl.columns)
                {
                        auto &coltype = tbl.ColType(colidx);
                        if (!querydata.usefase2)
                        {
                                // For SELECT or when fase2 isn't used, do everything in fase 1
                                if (col.fase & Fases::Fase2)
                                    col.fase |= Fases::Fase1;
                        }
                        else
                        {
                                if (coltype.flags & ColumnFlags::Key)
                                {
                                        // for update and delete, we need the primary key in fase 1 for the fase2 lookup
                                        col.fase |= Fases::Fase1;
                                }
                        }

                        // Any interaction?
                        if (col.fase & (Fases::Fase1 | Fases::Fase2 | Fases::Recheck))
                        {
                                auto &coltype = tbl.ColType(colidx);
                                ColumnNameId nameid = coltype.nameid;
                                QueryData::ResultColumn rcol;
                                rcol.tableidx = tableidx;
                                rcol.nameid = nameid;
                                rcol.vartype = coltype.type;

                                if (col.fase & Fases::Fase1)
                                {
                                        if (!select.empty())
                                            select.append(", "sv);

                                        if ((coltype.flags & ColumnFlags::Key) && querydata.usefase2)
                                        {
                                                // INV: exactly one key column present in list, and Fase1 is set for it
                                                querydata.keycolumn = QueryData::KeyColumn{ static_cast< unsigned >(querydata.resultcolumns.size()) };
                                        }

                                        querydata.resultcolumns.push_back(rcol);
                                        AddTableAndColumnName(query, tableidx, colidx, true, &select);

                                        if (querydata.usefase2)
                                        {
                                                // We're abusing fase2 for re-getting locked rows, so always reget fase1 cols in fase2
                                                selectfase2cols.append(", "sv);
                                                querydata.resultcolumnsfase2.push_back(rcol);
                                                AddTableAndColumnName(query, tableidx, colidx, true, &selectfase2cols);
                                        }
                                }
                                else if (querydata.usefase2 && (col.fase & (Fases::Fase1 | Fases::Fase2 | Fases::Recheck)))
                                {
                                        selectfase2cols.append(", "sv);
                                        querydata.resultcolumnsfase2.push_back(rcol);
                                        AddTableAndColumnName(query, tableidx, colidx, true, &selectfase2cols);
                                }
                        }

                        if (col.fase & Fases::Updated)
                        {
                                QueryData::UpdateColumn ucol;
                                ucol.nameid = tbl.ColType(colidx).nameid;
                                ucol.colname = query.tables[tableidx].typeinfo->columnsdef[colidx].dbase_name;
                                ucol.encodingflags = query.tables[tableidx].typeinfo->columnsdef[colidx].flags & ColumnFlags::Binary ? ParamEncoding::Binary : ParamEncoding::None;
                                querydata.updatecolumns.push_back(ucol);
                        }

                        ++colidx;
                }

                ++tableidx;
        }

        if (!query.singleconditions.empty() || !query.joinconditions.empty())
        {
                unsigned cond_count = 0;
                for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
                {
                        if (!it->handled) continue;
                        if (cond_count++)
                            where.append(") AND (");
                        else
                            where.append("(");

                        if (it->match_null)
                        {
                                where.append("(");
                                AddTableAndColumnName(query, it->table, it->column, false, &where);
                                where.append(" IS NULL) OR (");
                        }

                        ParamEncoding::Flags encodingflags = (query.tables[it->table].typeinfo->columnsdef[it->column].flags & ColumnFlags::Binary) ? ParamEncoding::Binary : ParamEncoding::None;

                        if (!it->casesensitive)
                            where.append("upper(");

                        AddTableAndColumnName(query, it->table, it->column, false, &where);
                        if (it->condition == DBConditionCode::Like)
                            encodingflags = ParamEncoding::Pattern;

                        if (!it->casesensitive)
                            where.append(")");

                        where.append(GetOperator(it->condition));
                        std::string paramref = querydata.query.params.AddVariableParameter(vm, it->value, encodingflags);
                        if (paramref.empty())
                            return false;

                        if (!it->casesensitive)
                            where.append("upper(");
                        if (it->condition == DBConditionCode::In)
                            where.append("Any(");
                        where.append(paramref);
                        if (it->condition == DBConditionCode::In)
                            where.append(")");
                        if (!it->casesensitive)
                            where.append(")");

                        if (query.tables[it->table].typeinfo->columnsdef[it->column].type == VariableTypes::String
                                && it->condition == DBConditionCode::Equal
                                && encodingflags == ParamEncoding::None)
                        {
                                // Special workarounds for indexed fields that have only a part indexed
                                bool use_left = query.tables[it->table].typeinfo->columnsdef[it->column].dbase_name == "rawdata"sv
                                        && query.tables[it->table].name == "wrd.entity_settings"sv;

                                // Most string indices are case insensitive, so add a case-insensitive filter too
                                if (!it->casesensitive || use_left)
                                {
                                        // most text indices are uppercase, so uppercase the stuff.
                                        // ADDME: if the length of the param is < max_indexed_size chars, we don't need the original filter anymore
                                        where.append(" AND ");
                                        where.append(use_left ? "upper(left(" : "upper(");
                                        AddTableAndColumnName(query, it->table, it->column, false, &where);
                                        where.append(use_left ? ", " + std::string(max_indexed_size) + "))" : ")"); // Keep in sync with constant in dbase/postgresql.whlib!!

                                        where.append(GetOperator(it->condition));

                                        where.append(use_left ? "upper(left(" : "upper(");
                                        where.append(paramref);
                                        where.append(use_left ? ", " + std::string(max_indexed_size) + "))" : ")");
                                }
                        }

                        if (it->match_null)
                            where.append(")");
                }
                for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
                {
                        // Cant't handle case insensitive
                        if (!it->handled) continue;
                        if (cond_count++)
                            where.append(") AND ((");
                        else
                            where.append("((");

                        AddTableAndColumnName(query, it->table1, it->column1, false, &where);
                        where.append(" ");
                        where.append(GetOperator(it->condition));
                        where.append(" ");
                        AddTableAndColumnName(query, it->table2, it->column2, false, &where);

                        where.append(")");

                        ColumnFlags::_type t1_flags = query.tables[it->table1].ColType(it->column1).flags;
                        ColumnFlags::_type t2_flags = query.tables[it->table2].ColType(it->column2).flags;

                        if (it->match_double_null)
                        {
                                // A primary key can't be NULL, so when a key is involved, this comparison isn't necessary
                                if (!(t1_flags & ColumnFlags::Key) && !(t2_flags & ColumnFlags::Key))
                                {
                                        where.append(" OR ((");
                                        AddTableAndColumnName(query, it->table1, it->column1, false, &where);
                                        where.append(" IS NULL) AND (");
                                        AddTableAndColumnName(query, it->table2, it->column2, false, &where);
                                        where.append(" IS NULL)");
                                        where.append(")");
                                }
                        }
                        else
                        {
                                // One column has no null default, or the defaults differ
                                bool trans_t1 = t1_flags & ColumnFlags::TranslateNulls && query.tables[it->table1].columns[it->column1].nulldefault;
                                bool trans_t2 = t2_flags & ColumnFlags::TranslateNulls && query.tables[it->table2].columns[it->column2].nulldefault;

                                if (trans_t2)
                                {
                                        where.append(" OR (");
                                        AddTableAndColumnName(query, it->table2, it->column2, false, &where);
                                        where.append(" IS NULL AND ");
                                        AddTableAndColumnName(query, it->table1, it->column1, false, &where);
                                        where.append(GetOperator(it->condition));
                                        ParamEncoding::Flags encodingflags = (query.tables[it->table2].typeinfo->columnsdef[it->column2].flags & ColumnFlags::Binary) ? ParamEncoding::Binary : ParamEncoding::None;
                                        std::string paramref = querydata.query.params.AddVariableParameter(vm, query.tables[it->table2].columns[it->column2].nulldefault, encodingflags);
                                        if (paramref.empty())
                                            return false;
                                        where.append(paramref);
                                        where.append(")");
                                }
                                if (trans_t1)
                                {
                                        where.append(" OR (");
                                        AddTableAndColumnName(query, it->table1, it->column1, false, &where);
                                        where.append(" IS NULL AND ");
                                        AddTableAndColumnName(query, it->table2, it->column2, false, &where);
                                        where.append(GetOperator(SwappedCondition(it->condition)));
                                        ParamEncoding::Flags encodingflags = (query.tables[it->table1].typeinfo->columnsdef[it->column1].flags & ColumnFlags::Binary) ? ParamEncoding::Binary : ParamEncoding::None;
                                        std::string paramref = querydata.query.params.AddVariableParameter(vm, query.tables[it->table1].columns[it->column1].nulldefault, encodingflags);
                                        where.append(paramref);
                                        if (paramref.empty())
                                            return false;
                                        where.append(")");
                                }
                        }

                        it->handled = true;
                }
                if (cond_count)
                    where.append(")");
        }

        querydata.query.querystr = "SELECT " + select + " FROM " + from;
        if (!where.empty())
            querydata.query.querystr += " WHERE " + where;
        if (query.limit > 0 && all_handled)
            querydata.query.querystr += " LIMIT " + Blex::AnyToString(query.limit);

        if (cursortype == DatabaseTransactionDriverInterface::Update || cursortype == DatabaseTransactionDriverInterface::Delete)
        {
                querydata.updatedtable = query.tables[0].name;
                if (querydata.usefase2)
                {
                        // The WHERE is not repeated (so we don't have to copy the entire paramencoder. sqllib will handle recheck for all conditions, even the handled ones)
                        querydata.querystrfase2 = "SELECT T0.ctid, array_position($1, " + fase2key + ")" + selectfase2cols + " FROM " + from + " WHERE (" + fase2key + " = ANY($1)) FOR UPDATE";
                }
                else
                {
                        // Lock rows in fase1
                        querydata.query.querystr += " FOR UPDATE";
                }
        }

        querydata.tablecount = query.tables.size();
        return true;
}

std::string PGSQLTransactionDriver::GetBlobDiskpath(int64_t blobid)
{
        //ADDME: Cut back on unecessary CreateDirs and ostringstream
        std::ostringstream path;

        //Basically we store a 0x12345678 blob in blob-12/345/678
        path << blobfolder;
        if (blobid >= 0x1000000L) //more than 6 digits
        {
                path << "/blob-" << (blobid>>(6*4)); //remove right 24/4=6 digits
        }
        else
        {
                path << "/blob";
        }

        std::string basedir = path.str();
        path << '/' << ( (blobid & 0xFFFFFFL) >> (3*4)); // last 3 digits
        std::string blobdir = path.str();
        path << '/' << blobid;
        return path.str();
}

OID PGSQLTransactionDriver::GetTypeArrayOID(OID elt)
{
        switch (elt)
        {
                case OID::INT4:         return OID::INT4ARRAY; break;
                case OID::INT8:         return OID::INT8ARRAY; break;
                case OID::BOOL:         return OID::BOOLARRAY; break;
                case OID::FLOAT8:       return OID::FLOAT8ARRAY; break;
                case OID::TIMESTAMP:    return OID::TIMESTAMPARRAY; break;
                case OID::NUMERIC:      return OID::NUMERICARRAY; break;
                case OID::TEXT:         return OID::TEXTARRAY; break;
                case OID::BYTEA:        return OID::BYTEAARRAY; break;
                case OID::OID:          return OID::OIDARRAY; break;
                case OID::TID:          return OID::TIDARRAY; break;
                default:
                {
                        if (elt == static_cast< OID >(webhare_blob_oid))
                            return static_cast< OID >(webhare_blobarray_oid);
                        return OID::unknown;
                }
        }
}

void PGSQLTransactionDriver::ExecuteInsert(DatabaseQuery const &query, VarId newrecord)
{
        ExecuteInsertInternal(query, newrecord, false);
}

void PGSQLTransactionDriver::ExecuteInserts(DatabaseQuery const &query, VarId newrecord)
{
        ExecuteInsertInternal(query, newrecord, true);
}

void PGSQLTransactionDriver::ExecuteInsertInternal(DatabaseQuery const &query, VarId data, bool is_array)
{
        StackMachine &stackm = vm->GetStackMachine();

        unsigned rows = is_array ? stackm.ArraySize(data) : 1;
        if (!rows)
            return;

        std::string const &primary_table = query.tables[0].name;

        QueryData querydata(*this);
        querydata.query.astext = false;
        querydata.query.querystr = "INSERT INTO ";
        AddEscapedSchemaTable(&querydata.query.querystr, primary_table);
        querydata.query.querystr += " (";

        TableSource const &table = query.tables[0];
        unsigned len = table.columncount();

        unsigned colcount = 0;
        for (unsigned idx = 0; idx < len; ++idx)
        {
                if (table.columns[idx].fase & Fases::Updated)
                {
                        if (colcount++)
                            querydata.query.querystr += ", ";
                        AddEscapedName(&querydata.query.querystr, table.typeinfo->columnsdef[idx].dbase_name);
                }
        }

        querydata.query.querystr += ") VALUES ";

        for (unsigned row = 0; row < rows; ++row)
        {
                if (row == 0)
                    querydata.query.querystr += "(";
                else
                    querydata.query.querystr += "), (";

                unsigned valcount = 0;
                VarId newrecord = is_array ? stackm.ArrayElementGet(data, row) : data;
                for (unsigned idx = 0; idx < len; ++idx)
                {
                        if (table.columns[idx].fase & Fases::Updated)
                        {
                                if (valcount++)
                                    querydata.query.querystr += ", ";

                                ColumnNameId nameid = table.typeinfo->columnsdef[idx].nameid;
                                VarId cell = stackm.RecordCellRefByName(newrecord, nameid);

                                //PQ_PRINT("Insert val " << table.typeinfo->columnsdef[idx].dbase_name << " " << cell);
                                if (cell)
                                {
                                        ParamEncoding::Flags encodingflags = (table.typeinfo->columnsdef[idx].flags & ColumnFlags::Binary) ? ParamEncoding::Binary : ParamEncoding::None;
                                        std::string paramref = querydata.query.params.AddVariableParameter(vm, cell, encodingflags);
                                        if (paramref.empty())
                                            return;

                                        querydata.query.querystr += paramref;
                                }
                                else
                                    querydata.query.querystr += "NULL";
                        }
                }
        }
        querydata.query.querystr += ")";

        ExecQuery(querydata.query, allowwriteerrordelay);
}

DatabaseTransactionDriverInterface::CursorId PGSQLTransactionDriver::OpenCursor(DatabaseQuery &query, CursorType cursortype)
{
        CursorId id = queries.Set(QueryData(*this));
        QueryData &querydata = *queries.Get(id);

        if (!BuildQueryString(querydata, query, cursortype))
             return 0;

        auto resultset = ExecQuery(querydata.query, false);
        if (!resultset)
        {
                queries.Erase(id);
                return 0;
        }

        querydata.resultset = std::move(resultset);
        querydata.reader.reset(new TuplesReader(vm, *this, querydata.resultset.get(), &querydata));

        querydata.currow = 0;
        querydata.blockstartrow = 0;
        return id;
}

unsigned PGSQLTransactionDriver::RetrieveNextBlock(CursorId id, VarId recarr)
{
        StackMachine &stackm = vm->GetStackMachine();
        QueryData &querydata = *queries.Get(id);

        querydata.blockstartrow = querydata.currow;

        int totaltuples = PQntuples(querydata.resultset.get());

        unsigned rowcount = totaltuples - querydata.currow;
        if (rowcount > fase1_max_blocksize)
            rowcount = fase1_max_blocksize;

        unsigned elt_count = rowcount * querydata.tablecount;
        stackm.ArrayInitialize(recarr, elt_count, VariableTypes::RecordArray);
        for (unsigned idx = 0; idx < elt_count; ++idx)
            stackm.RecordInitializeEmpty(stackm.ArrayElementRef(recarr, idx));

        // Read ctids for non-select
        if (!querydata.updatedtable.empty())
        {
                querydata.ctids.resize(rowcount);
                for (unsigned row = 0; row < rowcount; ++row)
                    querydata.ctids[row] = std::get< PostgresqlTid >(querydata.reader->ReadValue(querydata.currow + row, 0));
        }

        unsigned colidx = 0;
        for (auto &resultcol: querydata.resultcolumns)
        {
                if (resultcol.tableidx >= 0) // exported column
                {
                        for (unsigned row = 0; row < rowcount; ++row)
                        {
                                VarId rec = stackm.ArrayElementRef(recarr, row * querydata.tablecount + resultcol.tableidx);
                                VarId cell = stackm.RecordCellCreate(rec, resultcol.nameid);
                                TuplesReader::ReadResult readres = querydata.reader->ReadValue(cell, querydata.currow + row, colidx);
                                if (readres == TuplesReader::ReadResult::Exception)
                                    return 0;
                                if (readres == TuplesReader::ReadResult::Null)
                                    stackm.RecordCellDelete(rec, resultcol.nameid);
                        }
                }
                ++colidx;
        }

        querydata.currow += rowcount;
        return rowcount;
}

void PGSQLTransactionDriver::RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< Fase2RetrieveRow > &rowlist, bool /*is_last_fase2_req_for_block*/)
{
        StackMachine &stackm = vm->GetStackMachine();

        if (rowlist.empty())
            return;

        QueryData &querydata = *queries.Get(id);
        if (!querydata.usefase2)
            return;

        assert(querydata.keycolumn.has_value());

        OID keycoltype = querydata.reader->fields[querydata.keycolumn->resultcolumn].type;
        OID keyarraytype = GetTypeArrayOID(keycoltype);

        if (keyarraytype == OID::unknown)
        {
                // ADDME: we could do a request per row
                HSVM_ThrowException(*vm, ("Cannot determine the array type for type #" + Blex::AnyToString(static_cast< int32_t >(keycoltype))).c_str());
                return;
        }

        QueryData f2query(*this);
        f2query.query.querystr = querydata.querystrfase2;
        f2query.resultcolumns = querydata.resultcolumnsfase2;

        auto paramdata = f2query.query.params.AddArrayParameter(keyarraytype, keycoltype, rowlist.size());
        for (auto &itr: rowlist)
             querydata.reader->AddAsParameter(&f2query.query.params, querydata.blockstartrow + itr.rownum, querydata.keycolumn->resultcolumn);
        f2query.query.params.FinalizeParameter(paramdata);

        f2query.resultset = ExecQuery(f2query.query, false);
        if (!f2query.resultset.get())
        {
                HSVM_ThrowException(*vm, "Error returned by fase2 query");
                return;
        }

        Blex::SemiStaticPodVector< LockResult, fase1_max_blocksize > lockresults;
        lockresults.resize(rowlist.size());
        std::fill(lockresults.begin(), lockresults.end(), LockResult::Removed);

        f2query.reader.reset(new TuplesReader(vm, *this, f2query.resultset.get(), &f2query));

        int numresults = PQntuples(f2query.resultset.get());
        for (int f2row = 0; f2row < numresults; ++f2row)
        {
                int arraypos = std::get< int32_t >(f2query.reader->ReadValue(f2row, 1));

                if (arraypos < 0 || static_cast< unsigned >(arraypos) >= rowlist.size())
                    continue;

                unsigned row = rowlist[arraypos].rownum;
                PostgresqlTid ctid = std::get< PostgresqlTid >(f2query.reader->ReadValue(f2row, 0));
                lockresults[arraypos] = querydata.ctids[row] == ctid ? LockResult::Unchanged : LockResult::Changed;
                querydata.ctids[row] = ctid;

                unsigned colidx = 0;
                for (auto &resultcol: f2query.resultcolumns)
                {
                        if (resultcol.tableidx == 0) // non-export column
                        {
                                VarId rec = stackm.ArrayElementRef(recarr, row * f2query.tablecount + resultcol.tableidx);
                                VarId cell = stackm.RecordCellCreate(rec, resultcol.nameid);
                                TuplesReader::ReadResult readres = f2query.reader->ReadValue(cell, f2row, colidx);
                                if (readres == TuplesReader::ReadResult::Exception)
                                {
                                        HSVM_ThrowException(*vm, "Error while reading fase2 results");
                                        return;
                                }
                                if (readres == TuplesReader::ReadResult::Null)
                                    stackm.RecordCellDelete(rec, resultcol.nameid);
                        }
                        ++colidx;
                }
        }

        for (unsigned i = 0, e = rowlist.size(); i < e; ++i)
            rowlist[i].lockresult = lockresults[i];
}

LockResult PGSQLTransactionDriver::LockRow(CursorId, VarId, unsigned)
{
        // No locking in this driver
        throw std::logic_error("locking not needed in PostgreSQL driver");
}

void PGSQLTransactionDriver::UnlockRow(CursorId, unsigned)
{
        // No locking in this driver
        throw std::logic_error("locking not needed in PostgreSQL driver");
}

void PGSQLTransactionDriver::DeleteRecord(CursorId id, unsigned row)
{
        QueryData &querydata = *queries.Get(id);

        std::string ctid = "'(" + Blex::AnyToString(querydata.ctids[row].blocknumber) + "," + Blex::AnyToString(querydata.ctids[row].tupleindex) + ")'";

        QueryData delquery(*this);
        delquery.query.querystr = "DELETE FROM ";
        AddEscapedSchemaTable(&delquery.query.querystr, querydata.updatedtable);
        delquery.query.querystr += " WHERE ctid = " + ctid;

        ExecQuery(delquery.query, allowwriteerrordelay);
}

void PGSQLTransactionDriver::UpdateRecord(CursorId id, unsigned row, VarId newfields)
{
        StackMachine &stackm = vm->GetStackMachine();
        QueryData &querydata = *queries.Get(id);

        std::string ctid = "'(" + Blex::AnyToString(querydata.ctids[row].blocknumber) + "," + Blex::AnyToString(querydata.ctids[row].tupleindex) + ")'";

        QueryData updatequery(*this);
        updatequery.query.querystr = "UPDATE ";
        AddEscapedSchemaTable(&updatequery.query.querystr, querydata.updatedtable);
        updatequery.query.querystr += " SET ";
        std::string updates;
        for (auto &itr: querydata.updatecolumns)
        {
                if (!updates.empty())
                  updates += ", ";
                AddEscapedName(&updates, itr.colname);

                VarId cell = stackm.RecordCellRefByName(newfields, itr.nameid);
                if (cell)
                {
                        std::string paramref = updatequery.query.params.AddVariableParameter(vm, cell, itr.encodingflags);
                        if (paramref.empty())
                            return;
                        updates += " = " + paramref;
                }
                else
                    updates += " = NULL";
        }

        if (!updates.empty())
        {
                updatequery.query.querystr += updates + " WHERE ctid = " + ctid + " RETURNING *";

                ExecQuery(updatequery.query, allowwriteerrordelay);
        }
}

void PGSQLTransactionDriver::CloseCursor(CursorId id)
{
        queries.Erase(id);
}

PGPtr< PGresult > PGSQLTransactionDriver::ExecQuery(Query &query, bool asyncresult)
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

        /* We can't send a query if the previous one is still in flight, so we need to
           retrieve the results first. Return immediately if an error was returned by
           that query
        */
        if (PGSQLTransactionDriver::GetLastResult().second)
            return PGPtr< PGresult >();

        std::string logprefix;
        if (logstacktraces > 0)
        {
                logprefix = "/*whlog:t[";

                std::vector< StackTraceElement > elements;
                vm->GetStackTrace(&elements, true, false);

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
                return PGPtr< PGresult >();
        }

        PGPtr< PGresult > retval;
        if (!asyncresult)
            retval = GetLastResult().first;

        return retval;
}

bool PGSQLTransactionDriver::CheckResultStatus(PGPtr< PGresult > const &res)
{
        if (!res)
        {
                HSVM_ThrowException(*vm, ("Fatal error returned: " + std::string(PQerrorMessage(conn))).c_str());
                return false;
        }

        // Clear the result when exiting this function
        auto result = PQresultStatus(res.get());

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
                        PQ_PRINT("Got fatal error: " << PQresultErrorMessage(res.get()));
                        if (HandleMessage(res.get()) && !vm->is_unwinding)
                            HSVM_ThrowException(*vm, ("Fatal error returned: " + std::string(PQresultErrorMessage(res.get()))).c_str());
                        return !vm->is_unwinding;
                } break;
                case PGRES_NONFATAL_ERROR:
                {
                        PQ_PRINT("Got non-fatal error: " << PQresultErrorMessage(res.get()));
                        if (HandleMessage(res.get()) && !vm->is_unwinding)
                            HSVM_ThrowException(*vm, ("Non-fatal error returned: " + std::string(PQresultErrorMessage(res.get()))).c_str());
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

std::pair< PGPtr< PGresult >, bool > PGSQLTransactionDriver::GetLastResult()
{
        PGPtr< PGresult > lastres;
        bool goterror = false;

        // Read results until the PQgetResult returns nullptr, return the last one
        while (true)
        {
                PGPtr< PGresult > res(PQgetResult(conn));
                if (!res)
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


void PGSQLTransactionDriver::ExecuteSimpleQuery(VarId id_set, std::string const &query, VarId params, VarId encodings, bool astext)
{
        StackMachine &stackm = vm->GetStackMachine();

        if (query.substr(0, 11) == "__internal:")
        {
                stackm.InitVariable(id_set, VariableTypes::RecordArray);
                if (query == "__internal:scantypes")
                    this->ScanTypes();
                if (query == "__internal:lastresult")
                {
                        PGPtr< PGresult > res = GetLastResult().first;
                        if (!res)
                            return;

                        TuplesReader reader(vm, *this, res.get(), nullptr);

                        for (unsigned i = 0, e = PQntuples(res.get()); i < e; ++i)
                        {
                                VarId elt = stackm.ArrayElementAppend(id_set);
                                if (reader.ReadSimpleTuple(elt, i) == TuplesReader::ReadResult::Exception)
                                    return;
                        }
                }
                return;
        }

        QueryData querydata(*this);
        querydata.query.astext = astext;
        querydata.query.querystr = query;

        unsigned encodingcount = stackm.ArraySize(encodings);
        for (unsigned i = 0, e = stackm.ArraySize(params); i < e; ++i)
        {
                ParamEncoding::Flags encodingflags = ParamEncoding::None;
                if (i < encodingcount)
                {
                        int32_t encodingnr = stackm.GetInteger(stackm.ArrayElementGet(encodings, i));
                        if (encodingnr >= 0 && encodingnr <= 2)
                            encodingflags = static_cast< ParamEncoding::Flags >(encodingnr);
                }

                querydata.query.params.AddVariableParameter(vm, stackm.ArrayElementGet(params, i), encodingflags);
        }

        stackm.InitVariable(id_set, VariableTypes::RecordArray);

        PGPtr< PGresult > res = ExecQuery(querydata.query, false);
        if (!res)
            return;

        TuplesReader reader(vm, *this, res.get(), nullptr);

        for (unsigned i = 0, e = PQntuples(res.get()); i < e; ++i)
        {
                VarId elt = stackm.ArrayElementAppend(id_set);
                if (reader.ReadSimpleTuple(elt, i) == TuplesReader::ReadResult::Exception)
                    return;
        }
}

void PGSQLTransactionDriver::GetErrorField(VarId id_set, ColumnNameId col, const PGresult *res, int fieldcode)
{
        StackMachine &stackm = vm->GetStackMachine();

        const char *fielddata = PQresultErrorField(res, fieldcode);
        VarId field = stackm.RecordCellCreate(id_set, col);
        if (fielddata)
            stackm.SetSTLString(field, fielddata);
        else
            stackm.InitVariable(field, VariableTypes::String);
}

void PGSQLTransactionDriver::NoticeReceiverCallback(void *arg, const PGresult *res)
{
        static_cast< PGSQLTransactionDriver * >(arg)->HandleMessage(res);
}


bool PGSQLTransactionDriver::HandleMessage(const PGresult *res)
{
        StackMachine &stackm = vm->GetStackMachine();

        PQ_ONLY(
            const char *errormsg = PQresultErrorMessage(res);
            if (errormsg)
               PQ_PRINT("PostgreSQL NOTICE: " << errormsg);
        );

        HSVM_OpenFunctionCall(*vm, 2);
        HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), sqllib_transid);

        VarId lastnotice = HSVM_CallParam(*vm, 1);
        stackm.InitVariable(lastnotice, VariableTypes::Record);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("SEVERITY"sv), res, PG_DIAG_SEVERITY_NONLOCALIZED);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("SQLSTATE"sv), res, PG_DIAG_SQLSTATE);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("MESSAGE_PRIMARY"sv), res, PG_DIAG_MESSAGE_PRIMARY);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("MESSAGE_DETAIL"sv), res, PG_DIAG_MESSAGE_DETAIL);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("MESSAGE_HINT"sv), res, PG_DIAG_MESSAGE_HINT);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("STATEMENT_POSITION"sv), res, PG_DIAG_STATEMENT_POSITION);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("INTERNAL_POSITION"sv), res, PG_DIAG_INTERNAL_POSITION);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("INTERNAL_QUERY"sv), res, PG_DIAG_INTERNAL_QUERY);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("CONTEXT"sv), res, PG_DIAG_CONTEXT);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("SCHEMA_NAME"sv), res, PG_DIAG_SCHEMA_NAME);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("TABLE_NAME"sv), res, PG_DIAG_TABLE_NAME);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("COLUMN_NAME"sv), res, PG_DIAG_COLUMN_NAME);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("DATATYPE_NAME"sv), res, PG_DIAG_DATATYPE_NAME);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("CONSTRAINT_NAME"sv), res, PG_DIAG_CONSTRAINT_NAME);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("SOURCE_FILE"sv), res, PG_DIAG_SOURCE_FILE);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("SOURCE_LINE"sv), res, PG_DIAG_SOURCE_LINE);
        GetErrorField(lastnotice, stackm.columnnamemapper.GetMapping("SOURCE_FUNCTION"sv), res, PG_DIAG_SOURCE_FUNCTION);

        stackm.SetSTLString(stackm.RecordCellCreate(lastnotice, stackm.columnnamemapper.GetMapping("ERROR_MESSAGE"sv)), PQresultErrorMessage(res));

        char *verbosemessage = PQresultVerboseErrorMessage(res, PQERRORS_VERBOSE, PQSHOW_CONTEXT_ALWAYS);
        stackm.SetSTLString(stackm.RecordCellCreate(lastnotice, stackm.columnnamemapper.GetMapping("VERBOSE_ERROR_MESSAGE"sv)), verbosemessage);
        PQfreemem(verbosemessage);

        bool retval = true;
        const HSVM_VariableType args[2] = { HSVM_VAR_Integer, HSVM_VAR_Record };
        HSVM_VariableId obj = HSVM_CallFunction(*vm, "wh::dbase/postgresql.whlib", "__HandleMessage", HSVM_VAR_Boolean, 2, args);
        if (obj)
        {
                retval = HSVM_BooleanGet(*vm, obj);
                HSVM_CloseFunctionCall(*vm);
        }
        return retval;
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

        auto options = PGSQLTransactionDriver::Options(); // value-initialize the options
        options.blobfolder = blobfolder;
        options.logstacktraces = logstacktraces;

        std::unique_ptr< PGSQLTransactionDriver > driver(new PGSQLTransactionDriver(hsvm, conn, options));
        int pid = driver->GetBackendPid();
        int32_t trans_id = GetVirtualMachine(hsvm)->GetSQLSupport().RegisterTransaction(std::move(driver));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ID")), trans_id);
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "PID")), pid);
}

void PGSQL_Close(HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        GetVirtualMachine(hsvm)->GetSQLSupport().DeleteTransaction(driver->sqllib_transid);
}

void PGSQL_GetStatus(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
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

void PGSQL_Exec(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        std::string query = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        bool astext = HSVM_BooleanGet(hsvm, HSVM_Arg(4));
        driver->ExecuteSimpleQuery(id_set, query, HSVM_Arg(2), HSVM_Arg(3), astext);
}

void PGSQL_GetWorkOpen(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        HSVM_BooleanSet(hsvm, id_set, driver->isworkopen);
}

void PGSQL_SetWorkOpen(HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        driver->isworkopen = HSVM_BooleanGet(hsvm, HSVM_Arg(1));
}

void PGSQL_SetAllowWriteErrorDelay(HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        driver->allowwriteerrordelay = HSVM_BooleanGet(hsvm, HSVM_Arg(1));
}

void PGSQL_SetUploadedBlobId(HSVM *hsvm)
{
        VirtualMachine *vm = GetVirtualMachine(hsvm);
        StackMachine &stackm = vm->GetStackMachine();

        int32_t transid = stackm.GetInteger(HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        auto blobid = stackm.GetSTLString(HSVM_Arg(2));
        auto context = PostgreSQLWHBlobData::GetFromVariable(vm, HSVM_Arg(1), true);
        context->Register(driver, blobid, stackm.GetBlob(HSVM_Arg(1)).GetLength(), true);
}

void PGSQL_GetUploadedBlobId(HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm = GetVirtualMachine(hsvm);
        StackMachine &stackm = vm->GetStackMachine();

        int32_t transid = stackm.GetInteger(HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        auto context = PostgreSQLWHBlobData::GetFromVariable(vm, HSVM_Arg(1), false);
        if (!context || context->driver != driver || context->blobid.empty())
            stackm.SetSTLString(id_set, ""sv);
        else
            stackm.SetSTLString(id_set, context->blobid);
}

void PGSQL_UpdateDebugSettings(HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        auto driver = dynamic_cast< PGSQLTransactionDriver *>(GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid));
        if (!driver)
        {
                HSVM_ThrowException(hsvm, "The specified transaction is not a PostgreSQL transaction");
                return;
        }

        driver->logstacktraces = HSVM_IntegerGet(hsvm, HSVM_Arg(1));
}


void PGSQL_EscapeIdentifier(HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm = GetVirtualMachine(hsvm);
        StackMachine &stackm = vm->GetStackMachine();

        // Don't care about UTF-8 encoding problems, the server will catch them anyway
        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));

        std::string result;
        AddEscapedName(&result, str.stl_stringview());
        stackm.SetSTLString(id_set, result);
}

void PGSQL_EscapeLiteral(HSVM *hsvm, HSVM_VariableId id_set)
{
        VirtualMachine *vm = GetVirtualMachine(hsvm);
        StackMachine &stackm = vm->GetStackMachine();

        // Don't care about UTF-8 encoding problems, the server will catch them anyway
        bool have_backslashes = false;
        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));
        std::string result;
        result.reserve(str.size() + 16);
        result.push_back('\'');
        for (auto itr = str.begin; itr != str.end; ++itr)
        {
                if (*itr == '\'')
                    result.push_back(*itr);
                else if (*itr < 32 || *itr == 127)
                {
                        switch (*itr)
                        {
                        case 8:    /* \b */ result.push_back('\\'); result.push_back('b'); break;
                        case 12:   /* \f */ result.push_back('\\'); result.push_back('f'); break;
                        case 10:   /* \n */ result.push_back('\\'); result.push_back('n'); break;
                        case 13:   /* \r */ result.push_back('\\'); result.push_back('r'); break;
                        case 9:    /* \t */ result.push_back('\\'); result.push_back('t'); break;
                        default:        {
                                                result.push_back('\\');
                                                result.push_back('x');
                                                Blex::EncodeBase16(itr, itr + 1, std::back_inserter(result));
                                        }
                        }
                        have_backslashes = true;
                        continue;
                }
                else if (*itr == '\\')
                {
                        result.push_back(*itr);
                        have_backslashes = true;
                }
                result.push_back(*itr);
        }
        result.push_back('\'');
        if (have_backslashes)
            result.insert(0, " E"sv);
        stackm.SetSTLString(id_set, result);
}


} // End of namespace PGSQL
} // End of namespace SQLLib
} // End of namespace HareScript


//---------------------------------------------------------------------------
extern "C"
{

static void* CreateBlobContext(void *)
{
        return new HareScript::SQLLib::PGSQL::PostgreSQLWHBlobData;
}
static void DestroyBlobContext(void*, void *context_ptr)
{
        delete static_cast< HareScript::SQLLib::PGSQL::PostgreSQLWHBlobData * >(context_ptr);
}

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        using namespace HareScript::SQLLib::PGSQL;

        HSVM_RegisterFunction(regdata, "__PGSQL_CONNECT:WH_PGSQL:R:RA", PGSQL_Connect);
        HSVM_RegisterMacro(regdata, "__PGSQL_CLOSE:WH_PGSQL::I", PGSQL_Close);
        HSVM_RegisterFunction(regdata, "__PGSQL_GETSTATUS:WH_PGSQL:R:I", PGSQL_GetStatus);
        HSVM_RegisterFunction(regdata, "__PGSQL_EXEC:WH_PGSQL:RA:ISVAIAB", PGSQL_Exec);
        HSVM_RegisterMacro(regdata, "__PGSQL_SETWORKOPEN:WH_PGSQL::IB", PGSQL_SetWorkOpen);
        HSVM_RegisterMacro(regdata, "__PGSQL_SETALLOWWRITEERRRORDELAY:WH_PGSQL::IB", PGSQL_SetAllowWriteErrorDelay);
        HSVM_RegisterFunction(regdata, "__PGSQL_GETWORKOPEN:WH_PGSQL:B:I", PGSQL_GetWorkOpen);
        HSVM_RegisterMacro(regdata, "__PGSQL_SETUPLOADEDBLOBINTERNALID:WH_PGSQL::IXS", PGSQL_SetUploadedBlobId);
        HSVM_RegisterFunction(regdata, "__PGSQL_GETBLOBINTERNALID:WH_PGSQL:S:IX", PGSQL_GetUploadedBlobId);
        HSVM_RegisterMacro(regdata, "__PGSQL_UPDATEDEBUGSETTINGS:WH_PGSQL::II", PGSQL_UpdateDebugSettings);
        HSVM_RegisterFunction(regdata, "POSTGRESQLESCAPELITERAL:WH_PGSQL:S:S", PGSQL_EscapeLiteral);
        HSVM_RegisterFunction(regdata, "POSTGRESQLESCAPEIDENTIFIER:WH_PGSQL:S:S", PGSQL_EscapeIdentifier);


        HSVM_RegisterContext(regdata, PostgreSQLWHBlobContextId, NULL, &CreateBlobContext, &DestroyBlobContext);

        return 1;
}

} //end extern "C"
