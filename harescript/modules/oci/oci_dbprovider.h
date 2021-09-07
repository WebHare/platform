#ifndef blex_harescript_modules_oci_oci_dbprovider
#define blex_harescript_modules_oci_oci_dbprovider
//---------------------------------------------------------------------------

#include "oci_base.h"

namespace HareScript
{
namespace OCIDBProvider
{

using namespace SQLLib;

class OCIContext;
class ResultSet;
class OCITransaction;

void GetHSErrors(HSVM *vm, HSVM_VariableId recarr, ErrorList const &errors);

struct TransferSettings
{
        unsigned StringPieceSize;
        unsigned BlobPieceSize;
};

struct OCIColumnType
{
        OCIColumnType(std::string name_, ub2 ocitype_, ub1 precision_, sb1 scale_, ub2 collen_, ub1 null_allowed_, ub2 charset_)
        {
                name = name_;
                ocitype = ocitype_;
                precision = precision_;
                scale = scale_;
                collen = collen_;
                null_allowed = null_allowed_;
                charset = charset_;
        }

        std::string name;
        ub2 ocitype;
        ub1 precision;
        sb1 scale;
        ub2 collen;
        ub1 null_allowed;
        ub2 charset;
};

struct Param
{
        Param(VarId varid_, VariableTypes::Type hstype_, std::string name_) {hstype = hstype_; varid = varid_; name = name_; ocitype = 0; }
        Param() {};

        VariableTypes::Type hstype;
        VarId varid;
        std::string name;
        ub2 ocitype;
};

/** Global OCI data, per VM */
class OCIContext
{
        public:
        OCIContext();
        ~OCIContext();

        OCIEnv *GetEnvhp() { return myenvhp; }
        OCIError *GetErrhp() { return myerrhp; }

        /** Look up a transaction by ID, and verify that it is an OCI transaction */
        OCITransaction* GetTrans(HSVM *hsvm, int32_t transid);

        OCIServer* GetServer(Blex::UTF16String const &dbasename, ErrorList *errorlist);

        //SQLHENV henv;

        std::set<OCITransaction *> translist;

        private:
        typedef std::map<Blex::UTF16String, OCIServer*> ServerHandles;
        ServerHandles serverhandles;

        OCIEnv *myenvhp;    //< the environment handle
        OCIError *myerrhp;  //< the error handle
};

/** OCI query data storage */
struct OCIQueryData
{
        unsigned fase1colcount;
        unsigned fase2colcount;
        unsigned tablecount;

        std::string primary_table;

        /// Decription of a column in the resultset
        struct ResultColumn
        {
                /// Type expected by Harescript
                VariableTypes::Type hs_type;

                /// u
                ColumnNameId nameid;

                /// Uppercase name of the column
                std::string name;

                /// Table-nr which this column belongs to
                unsigned tablenr;

                /// Nr of column in column typeinfo
                unsigned columnnr;

                /// Fase in which this column is needed
                unsigned fase;

                /// Indicates whether this column is updated
                bool is_updated;

                inline ResultColumn(
                        VariableTypes::Type _type,
                        ColumnNameId _nameid,
                        std::string _name,
                        unsigned _tablenr,
                        unsigned _columnnr,
                        unsigned _fase) : hs_type(_type), nameid(_nameid), name(_name), tablenr(_tablenr), columnnr(_columnnr), fase(_fase) {}
        };
        typedef std::vector< ResultColumn > ResultColumns;
        ResultColumns result_columns;
        std::vector<OCIColumnType> update_columns;

        std::map< ColumnNameId, signed > updatenamemap;
        Blex::UTF16String modify_str;

        HSVM *vm;
        OCIError *errhp;
        OCIStmt *stmthp;

        std::shared_ptr<ResultSet> resultset;

        void SetupResultSet();

        OCIQueryData(HSVM *_vm, OCITransaction *trans);
        ~OCIQueryData();
};

/** Single OCI transaction */
class OCITransaction : public SQLLib::DatabaseTransactionDriverInterface
{
    private:
        typedef IdMapStorage<OCIQueryData> QueryStorage;

        /// List of queries
        QueryStorage queries;

        // Chunk sizes for STRING and BLOB transfers, configurable via __OCI_TRANSHACK
        TransferSettings transfer;
        ErrorList errorlist;
        OCIContext &ocicontext;

    public:
        OCIEnv *GetEnvhp() { return ocicontext.GetEnvhp(); }
        OCIError *GetErrhp() { return ocicontext.GetErrhp(); }

        OCITransaction(HSVM *vm, OCIContext &ocicontext);
        virtual ~OCITransaction();

        void ExecuteInsert(SQLLib::DatabaseQuery const &query, VarId newrecord);
        CursorId OpenCursor(SQLLib::DatabaseQuery &query, CursorType cursortype);
        unsigned RetrieveNextBlock(CursorId id, VarId recarr);
        void RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< Fase2RetrieveRow > &rowlist, bool is_last_fase2_req_for_block);
        LockResult LockRow(CursorId id, VarId recarr, unsigned row);
        void UnlockRow(CursorId id, unsigned row);
        void DeleteRecord(CursorId id, unsigned row);
        ErrorList const& GetHSErrorList() { return errorlist; }
        void ClearHSErrors() {errorlist.clear();}

        void UpdateRecord(CursorId id, unsigned row, VarId newfields);
        void CloseCursor(CursorId id);

        bool Connect(OCIServer *server, Blex::UTF16String const &username, Blex::UTF16String const &password);
        void GetBindInfo(Blex::UTF16String const &sqlcommand, HSVM *vm, VarId id_set);
        void SQLCommand(Blex::UTF16String const &sqlcommand, HSVM *vm, VarId id_set, std::vector<HSVM_VariableType> const *types);
        void SQLCall(Blex::UTF16String const &sqlcommand, HSVM *vm, VarId id_send, VarId id_return);
        void SetTransferChunkSizes(unsigned stringsize, unsigned blobsize) {transfer.StringPieceSize = stringsize; transfer.BlobPieceSize = blobsize;}
        void GetColumnList(Blex::UTF16String const &sqlcommand, VarId id_set);
        void Describe(std::string const &type, std::string const &object, VarId id_set);

        void DescribeTableColumns(Blex::UTF16String const &tablename, std::vector<OCIColumnType> &columns);
        void AddInternalOCITypes(std::vector<OCIColumnType> columns, std::vector<Param> &params);

        OCISvcCtx *GetSvchp() { return mysvchp; }
        TransferSettings *GetTransfer() { return &transfer; }

        void Commit(VarId recarr);
        void Rollback();

        void BuildQueryString(OCIQueryData &querydata, HareScript::SQLLib::DatabaseQuery &query, std::vector<Param> &params, Blex::UTF16String *str, CursorType cursortype);
        void ConstructQuery(OCIQueryData &querydata, DatabaseQuery &query, CursorType cursortype);

        private:
        OCISvcCtx *mysvchp; //< the service handle
        OCISession *myuserhp;
        HSVM *hsvm;
};


const unsigned OCIContextId = 9999; //FIXME: Allocate proper contextid
/// Maximum number of rows fetched
const unsigned maxrowsfetched = 8;

} // End of namespace OCIDBProvider
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
