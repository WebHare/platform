#ifndef blex_webhare_harescript_modules_oci_oci_binder
#define blex_webhare_harescript_modules_oci_oci_binder

#include "oci_base.h"
#include "oci_dbprovider.h"
#include <harescript/vm/hsvm_dllinterface_blex.h>

namespace HareScript
{
namespace OCIDBProvider
{

namespace BindType
{

enum Type
{
        TryBind = 0,    //< Column should always be bound
        NeverBind = 1,  //< Column may not be bound, must be read through GetData
        MustBind = 2    //< Column _must_ be bound, as we need to update it!
};

} // End of namespace BindType

//ADDME: Duidelijk markeren wat bij een Define en wat bij een Bind pointer hoort., misschien union?
struct Column
{
        Column()
        {
                defnp = NULL;
                bindhp = NULL;
                varstore = 0;
                is_resultset_column = false;
        }

        bool is_resultset_column; //If true, this is part of the returned results (read through OCIDefineByPos), if false, it's a bindable parameter
        bool column_touched; //If true, this column has been touched by a piecewise fetch (used to check Bound columns for changes)
        bool is_long; //If true, this column is of a long type, and can have a size, larger than 4K

        HSVM_ColumnId nameid; //<column name under which to store the final results
        VariableTypes::Type hstype; //<associated harescript storage type

        unsigned data_offset; //<offset off this column in the row buffer
        unsigned data_size; //<size of this column in the row buffer

        OCIBind *bindhp;
        OCIDefine *defnp; //<OCI define pointer

        ub2 ocitype;     //<OCI input/retrieve type
        sb2 indicator;   //<OCI returned indicator variable
        ub2 rlen;        //<OCI returned real length
        ub2 rcode;       //<OCI returned column-level return code

        bool piecewise_fetch; //< Whether or not to enable piecewise fetching for this column
        bool useloblocator;   //< Whether or not to use a loblocator for this column
//        bool utf16_encoded;   //< Whether or not to work with utf16 encoded data (in case of strings)
        VarId varstore;       //< Variable to store piece-wise data in
        VarId inputvar;       //< Variable containing input for bound IN colunmns
        OCILobLocator *loblocator; //<OCI LobLocator, store BLOB data in

        std::string boundname;
        ///Used for blob bindings to non-blob columns
        std::shared_ptr<HareScript::Interface::InputStream> istream;
};

/* Piece wise fetch data */
struct PieceWiseFetch
{
        PieceWiseFetch() { col = NULL; blobstream = 0; }

        dvoid *hndlp; //< handle pointer for piecewise fetching
        Column *col; //< (last) column affected by a piecewise fetch
        ub4 len; //< length of the next piece, when piecewise fetching
        ub1 in_out;
        bool last_was_in;
        int32_t blobstream; //<blob so far..

        Blex::UTF8DecodeMachine utf8decoder; //< Stateful UTF8-decoding
        unsigned curpos; //< Current fetching position
};

class OCITransaction;
struct TransferSettings;

struct InputBinder
{
        InputBinder(HSVM *hsvm, OCITransaction *trans);
        ~InputBinder();

        std::vector<Column> cols;

        void AddNamedBinding(const char *name, VariableTypes::Type hstype, VarId value);
        void AllocateColumn(VariableTypes::Type hstype, ub2 ocitype,HSVM_ColumnId colname, bool is_resultset_column);
        void PrepareBindings(std::vector<Param> const &paramlist);
        void FinishBindings(OCIStmt *stmtp);
        void AddRowid(OCIRowid *rowid);
        bool RetrieveBoundVariable(unsigned colnum, VarId returnstore, VarId indicator_id);
        void StoreBoundVariable(unsigned colnum, VarId value);
        sword ExecuteAndCompletePieces(OCISvcCtx *mysvchp);

        private:
        static int OCIDefineCallback(void*octxp, OCIDefine *defnp, ub4 iter, void **bufpp, ub4 **alenpp, ub1 *piecep, void **indpp, ub2 **rcodep);
        static int OCIBindInCallback(void*ictxp, OCIBind *bindp, ub4 iter, ub4 index, void **bufpp, ub4 *alenpp, ub1 *piecep, void **indpp);
        static int OCIBindOutCallback(void*octxp, OCIBind *bindp, ub4 iter, ub4 index, void **bufpp, ub4 **alenpp, ub1 *piecep, void **indpp, ub2 **rcodep);

        void OCIOutCallback(Column *col, ub4 iter,void **bufpp, ub4 **alenpp, ub1 *piecep, void **indpp, ub2 **rcodep);

        std::vector<uint8_t> inputbuf;

        PieceWiseFetch piecewise;
        TransferSettings *transfer;

        OCITransaction *trans;

        HSVM *hsvm;
        OCIStmt *stmtp;
        OCIError *errhp;
        OCIEnv *envhp;
        OCISvcCtx *svchp;

        unsigned start_piecewise_buffer;
        std::string piecewise_string;

        bool FillBuffer(VariableTypes::Type hstype, VarId value, ub2 ocitype);
        void FinishPiece();
        void SetupForPiece(unsigned piece);

        friend class ResultSet;
};

class ResultSet
{
        public:
        /**
            @param stmtp Statement to examine
        */
        ResultSet(HSVM *vm, OCITransaction *trans);

        ~ResultSet();

        void SetupStatement(OCIStmt *_stmtp);

        /** Get the number of return columns */
        unsigned CountResultColumns() const;

        /** Describe the columns (call AddColumn) for all columns returned
            by an OCI statement */
        void DescribeColumns();

        /** Add a column and setup bindings et al for it. AddColumn must be
            called in the proper sequence for each column we'll be reading
            @param hstype Type we want this column converted to, or
                          VariableTypes::Uninitialized if we want the best match
            @param colnameid Suggested column name id, if known*/
        void AddResultSetColumn(unsigned pos, VariableTypes::Type hstype, ColumnNameId colnameid);

        /** Load the columns of the current result into the specified record */
        void GetResult(VarId recordid);

        /** Retrieve a single column and store it in the specified record */
        bool GetSingleColumn(VarId recordid, unsigned colnum);

        /** Loads results from the database. Returns false at EOF */
        bool FetchResult(unsigned nrows);

        /** Generate a columnnameid for a column */
        ColumnNameId GenerateColumnNameId(OCIParam *pard);

        InputBinder mybinder;

        // ADDME: Change to the maximum number of rows that will be fetched in one block
        /** For each fetched row, save the rowid */
        OCIRowid* rowid[10];

        private:
        /** Given an OCI type, return a suitable HareScript type */
        VariableTypes::Type GetBestHSType(ub2 ocitype, OCIParam *pard);

        /** Get the OCI I/O type to use for a given HareScript type */
        std::pair<unsigned,ub2> GetOCITransfer(ub2 ocitype, VariableTypes::Type hstype);

        //std::vector<uint8_t> rowbuffer;

        //HSVM *vm;
        //StackMachine &stackm;

        OCIStmt *stmtp;   //< the statement we're processing results for
        //OCIError *errhp;  //< the error handle
        OCITransaction *trans;

        //std::vector<Column> columns;
};

} // End of namespace OCIDBProvider
} // End of namespace HareScript


#endif
