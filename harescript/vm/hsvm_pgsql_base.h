#ifndef blex_webhare_harescriptvm_hsvm_pgsqlbase
#define blex_webhare_harescriptvm_hsvm_pgsqlbase
//---------------------------------------------------------------------------

#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <optional>
#include <string>
#include <string_view>
#include <variant>

//#define SHOW_PGSQL

//#define DUMP_BINARY_ENCODING

namespace HareScript
{
namespace SQLLib
{
namespace PGSQL
{

class QueryResult;
class QueryData;
class PGSQLTransactionDriverBase;

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
        UUID = 2950,
};

// PostgreSQL error field codes
enum class PG_DIAG_CODE: char
{
  SEVERITY = 'S',
  SEVERITY_NONLOCALIZED = 'V',
  SQLSTATE = 'C',
  MESSAGE_PRIMARY = 'M',
  MESSAGE_DETAIL = 'D',
  MESSAGE_HINT = 'H',
  STATEMENT_POSITION = 'P',
  INTERNAL_POSITION = 'p',
  INTERNAL_QUERY = 'q',
  CONTEXT = 'W',
  SCHEMA_NAME = 's',
  TABLE_NAME = 't',
  COLUMN_NAME = 'c',
  DATATYPE_NAME = 'd',
  CONSTRAINT_NAME = 'n',
  SOURCE_FILE = 'F',
  SOURCE_LINE = 'L',
  SOURCE_FUNCTION = 'R',
};

// Oid
typedef unsigned int Oid;

struct PostgresqlTid
{
        unsigned blocknumber;
        unsigned tupleindex;
};

inline bool operator==(PostgresqlTid const &lhs, PostgresqlTid const &rhs) { return lhs.blocknumber == rhs.blocknumber && lhs.tupleindex == rhs.tupleindex; }

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

        ParamsEncoder(PGSQLTransactionDriverBase &_driver) : driver(_driver), buildmode(Top) {}

        PGSQLTransactionDriverBase &driver;

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
        PGSQLTransactionDriverBase &driver;
        QueryResult *res;
        TuplesReader(VirtualMachine *_vm, PGSQLTransactionDriverBase &_driver, QueryResult *_res, QueryData *querydata) : vm(_vm), driver(_driver), res(_res) { ReadColumns(querydata); }

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
        Query(PGSQLTransactionDriverBase &driver) : params(driver), astext(false) { querystr.reserve(16384); }

        std::string querystr;
        ParamsEncoder params;
        bool astext;

        Blex::PodVector< char > fullquerybuf;
};

class QueryData
{
    public:
        QueryData(PGSQLTransactionDriverBase &driver)
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

        std::unique_ptr< QueryResult > resultset;
        std::unique_ptr< TuplesReader > reader;
};

struct QueryResultValue {
        char const *data;
        int32_t length;
        bool isnull;
};

struct QueryResultField {
        std::string_view name;
        OID typeoid;
        int32_t typemodifier;
        int16_t formatcode;
};

class QueryResult {
    public:
        virtual ~QueryResult();

        virtual bool HasError() const = 0;
        virtual std::vector< QueryResultField > GetResultFields() const = 0;
        virtual std::string GetErrorField(PG_DIAG_CODE fieldcode) const = 0;
        virtual uint32_t GetRowCount() const = 0;
        virtual QueryResultValue GetValue(uint32_t rowid, uint32_t colid) = 0;
        virtual std::string GetErrorMessage() const = 0;
        virtual std::string GetVerboseErrorMessage() const = 0;
};

/** PostgreSQL transaction object base class for native & WASM implementations */
class PGSQLTransactionDriverBase : public DatabaseTransactionDriverInterface
{
    public:
        struct Options
        {
                std::string blobfolder;
                int32_t logstacktraces;
        };

    protected:
        typedef IdMapStorage< QueryData > QueryStorage;

        /// List of active queries
        QueryStorage queries;

        virtual void PrepareForQuery();
        bool BuildQueryString(QueryData &querydata, DatabaseQuery &query, DatabaseTransactionDriverInterface::CursorType);

        std::string_view ReadResultCell(std::unique_ptr< QueryResult > &resultset, unsigned row, unsigned col);
        int32_t ReadResultCellInt(std::unique_ptr< QueryResult > &resultset, unsigned row, unsigned col);

        virtual std::unique_ptr< QueryResult > ExecQuery(Query &query, bool asyncresult) = 0;
        //virtual bool CheckResultStatus(std::unique_ptr< QueryResult > const &res) = 0;
        //virtual std::unique_ptr< QueryResult > WaitForResult() = 0;
        virtual std::pair< std::unique_ptr< QueryResult >, bool > GetLastResult() = 0;

        void GetErrorField(VarId id_set, ColumnNameId col, QueryResult const &res, PG_DIAG_CODE fieldcode);
        //static void NoticeReceiverCallback(void *arg, const PGresult *res);
        bool HandleMessage(QueryResult const &res);
        void ExecuteInsertInternal(DatabaseQuery const &query, VarId newrecord, bool isarray);

    public:
        /// Initializes PG transaction. Run this->ScanTypes() after the constructor finishes1
        PGSQLTransactionDriverBase(HSVM *vm, Options const &options);
        virtual ~PGSQLTransactionDriverBase();

        void ScanTypes();

        OID GetTypeArrayOID(OID elt);

        void ExecuteInsert(DatabaseQuery const &query, VarId newrecord);
        void ExecuteInserts(DatabaseQuery const &query, VarId newrecord);
        CursorId OpenCursor(DatabaseQuery &query, CursorType cursortype);
        unsigned RetrieveNextBlock(CursorId id, VarId recarr);
        void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< Fase2RetrieveRow > &rowlist, bool is_last_fase2_req_for_block);
        LockResult LockRow(CursorId id, VarId recarr, unsigned row);
        void UnlockRow(CursorId id, unsigned row);
        void DeleteRecord(CursorId id, unsigned row);
        void UpdateRecord(CursorId id, unsigned row, VarId newfields);
        void CloseCursor(CursorId id);

        void ExecuteSimpleQuery(VarId id_set, std::string const &query, VarId params, VarId encodings, bool astext);

        void EscapeLiteral(VarId id_set, Blex::StringPair to_encode);
        void EscapeIdentifier(VarId id_set, Blex::StringPair to_encode);

        std::string GetBlobDiskpath(int64_t blobid);

        virtual bool IsWorkOpen() = 0;
        virtual void SetWorkOpen(bool open) = 0;

        bool assumeblobsexist;
        /// Hold uploaded blobs by PGID until transaction ends so we can return the original blobs when they get selected again
        std::map< std::string, BlobRefPtr > uploaded_blob_cache;
        int32_t webhare_blob_oid;
        int32_t webhare_blobarray_oid;
        std::string blobfolder;
        bool allowwriteerrordelay;
        int32_t logstacktraces;
        int32_t logcommands;
        HSVM_VariableId commandlog;
        int32_t command_timeout_secs;

        friend struct ParamsEncoder;
};

void PGSQLRegisterSharedFunctions(HSVM_RegData *regdata);

} // End of namespace PGSQL
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif // blex_webhare_harescriptvm_hsvm_pgsqlbase
