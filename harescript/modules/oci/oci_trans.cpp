#include <harescript/vm/allincludes.h>


#include <stdlib.h>
#include "oci_dbprovider.h"
#include "oci_binder.h"

namespace HareScript
{

namespace OCIDBProvider
{

using namespace SQLLib;

OCIQueryData::OCIQueryData(HSVM *_vm, OCITransaction *trans)
{
        vm = _vm;
        stmthp = NULL;
        errhp = trans->GetErrhp();
        resultset.reset(new ResultSet(vm, trans));
}

OCIQueryData::~OCIQueryData()
{
        /* Close the statement handle */
        if (stmthp != NULL)
                OCIHandleFree(stmthp, OCI_HTYPE_STMT);
}

void OCIQueryData::SetupResultSet()
{
        if (stmthp == NULL)
                ThrowDBError(-1,"OCI error: Statement handle not initialized");

        /* Create the resultset */
        resultset->SetupStatement(stmthp);

        /* Add all columns to the resultset */
        unsigned pos=1;
        for (std::vector<ResultColumn>::iterator it = result_columns.begin(); it != result_columns.end(); ++it)
            resultset->AddResultSetColumn(pos++, it->hs_type, it->nameid);

        resultset->mybinder.FinishBindings(stmthp);
}

OCITransaction::OCITransaction(HSVM *hsvm, OCIContext &ocicontext)
: SQLLib::DatabaseTransactionDriverInterface(GetVirtualMachine(hsvm))
, ocicontext(ocicontext)
, hsvm(hsvm)
{
        description.supports_block_cursors = false;
        description.max_joined_tables = 0;
        description.supports_single = false;
        description.supports_data_modify = true;
        description.supports_nulls = true;
        description.needs_locking_and_recheck = false;
        description.fase2_locks_implicitly = false;
        description.needs_uppercase_names = true;

        transfer.StringPieceSize=4000;
        transfer.BlobPieceSize=4000;

        mysvchp=NULL;
        myuserhp=NULL;
}

OCITransaction::~OCITransaction()
{
        if (mysvchp)
        {
                OCITransRollback(mysvchp,GetErrhp(),OCI_DEFAULT);
                mysvchp=NULL;
        }
        if(myuserhp)
            OCIHandleFree(myuserhp, OCI_HTYPE_SESSION);
}

bool OCITransaction::Connect(OCIServer *server, Blex::UTF16String const &username, Blex::UTF16String const &password)
{
        try
        {
                //ALlocate service handle
                mysvchp = AllocOCIHandle<OCISvcCtx *>(NULL, "alloc service context", GetEnvhp(),OCI_HTYPE_SVCCTX,0,NULL);
                //Set server attribute in service context ahndle
                CheckRetval(ocicontext.GetErrhp(), "set server", OCIAttrSet((dvoid*)mysvchp, OCI_HTYPE_SVCCTX, (dvoid*)server, (ub4)0, OCI_ATTR_SERVER, ocicontext.GetErrhp()));
                //Allocate a user sesion handle
                myuserhp = AllocOCIHandle<OCISession *>(NULL, "alloc session", GetEnvhp(), OCI_HTYPE_SESSION,0,NULL);
                //Set username and password
                CheckRetval(ocicontext.GetErrhp(), "set user", OCIAttrSet((dvoid*)myuserhp, OCI_HTYPE_SESSION, (dvoid*)&username[0], (ub4)username.size()*2, OCI_ATTR_USERNAME, ocicontext.GetErrhp()));
                CheckRetval(ocicontext.GetErrhp(), "set password", OCIAttrSet((dvoid*)myuserhp, OCI_HTYPE_SESSION, (dvoid*)&password[0], (ub4)password.size()*2, OCI_ATTR_PASSWORD, ocicontext.GetErrhp()));
                //Logon
                CheckRetval(ocicontext.GetErrhp(), "session begin", OCISessionBegin(mysvchp, ocicontext.GetErrhp(), myuserhp, OCI_CRED_RDBMS, OCI_DEFAULT));
                //Set user session attribute in service context handle
                CheckRetval(ocicontext.GetErrhp(), "set user in session", OCIAttrSet((dvoid*)mysvchp, OCI_HTYPE_SVCCTX, (dvoid*)myuserhp, (ub4)0, OCI_ATTR_SESSION, ocicontext.GetErrhp()));
                return true;
        }
        catch (VMOCIError const &e)
        {
                errorlist.push_back(ErrorType(e.GetCode(), e.GetMsg()));
                return false;
        }
}

// FIXME: This could be placed in a separate, shared file between ODBC and OCI, since
// they both use these functions
// -----------------------------------------------------------------------------
//
//   Variable conversion functions
//
//
namespace
{

void AddCString(Blex::UTF16String *str, const char *to_add)
{
        str->insert(str->end(), to_add, to_add+strlen(to_add));
}

/* add a column or table, escaping it if necesary (oracle seems to hate escaping
   so we shouldn't do this unless necessary) */
void AddEscapedName(Blex::UTF16String *str, std::string const &to_add)
{
        /* Do we have to encode the to_add name? */
        bool must_escape=false;

        /* ADDME: Is this character range the proper non escape set? */
        for(unsigned i=0;i<to_add.size() && !must_escape;++i)
          if (! strchr("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789.", to_add[i]))
            must_escape = true;

        if (must_escape)
            AddCString(str,"\"");

        //ADDME: Use a proper UTF8 -> UTF16 converter
        Blex::UTF8DecodeMachine decoder;
        for(unsigned i=0;i<to_add.size();++i)
        {
                if (to_add[i]=='"' && must_escape) //escape double quotes with a backslash
                    str->push_back('\\');
                //add the character itself, decoding if necessary
                uint32_t nextunicodebyte = decoder(to_add[i]);
                if (nextunicodebyte != Blex::UTF8DecodeMachine::NoChar && nextunicodebyte != Blex::UTF8DecodeMachine::InvalidChar)
                    str->push_back((char)nextunicodebyte);
        }

        if (must_escape)
            AddCString(str,"\"");
}

void AddTableName(unsigned tableid, Blex::UTF16String *str)
{
        AddCString(str,"T");
        Blex::EncodeNumber(tableid, 10, std::back_inserter(*str));
}

void AddTableAndColumnName(DatabaseQuery const &query, unsigned tableid, unsigned columnid, Blex::UTF16String *str)
{
        AddTableName(tableid, str);
        AddCString(str,".");
        AddEscapedName(str, query.tables[tableid].typeinfo->columnsdef[columnid].dbase_name);
}

DBConditionCode::_type SwappedCondition(DBConditionCode::_type cond)
{
        switch (cond)
        {
        case DBConditionCode::LessEqual:  cond = DBConditionCode::BiggerEqual; break;
        case DBConditionCode::Less:       cond = DBConditionCode::Bigger; break;
        case DBConditionCode::BiggerEqual:cond = DBConditionCode::LessEqual; break;
        case DBConditionCode::Bigger:     cond = DBConditionCode::Less; break;
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
        default:
            ThrowDBError(-1,"Encountered unkown relation type");
            return "";
        }
}

} // End of anonymous namespace

void OCITransaction::ConstructQuery(OCIQueryData &querydata, DatabaseQuery &query, CursorType cursortype)
{
        /* Prepare the statement */
        querydata.stmthp=NULL;
        CheckRetval(GetErrhp(), "ConstructQuery.OCIHandleAlloc",
                    OCIHandleAlloc(GetEnvhp(),(void**)&querydata.stmthp,OCI_HTYPE_STMT,0,NULL));

        // FIXME: Change to maximum number of rows to fetch at once
        for (unsigned i = 0; i < 10; i++)
          CheckRetval(GetErrhp(), "ConstructQuery.OCIDescriptorAlloc",
                                 OCIDescriptorAlloc(GetEnvhp(), (dvoid **) &(querydata.resultset->rowid[i]),
                                 (ub4) OCI_DTYPE_ROWID, (size_t) 0, (dvoid **) 0));

        /* Construct the query, and determine input parameters */
        std::vector<Param> params;
        Blex::UTF16String query_string;
        BuildQueryString(querydata, query, params, &query_string, cursortype);

        DEBUGPRINT("OCI query string: " << UTF16toUTF8(query_string));

        /* Prepare the query */
        CheckRetval(GetErrhp(), "ConstructQuery.OCIStmtPrepare",
                    OCIStmtPrepare(querydata.stmthp, GetErrhp(), (const text*)&query_string[0], query_string.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

        /* Setup input parameters */
        InputBinder inputbinder(*vm, this);
        inputbinder.PrepareBindings(params);
        inputbinder.FinishBindings(querydata.stmthp);

        /* Execute the query */
        inputbinder.ExecuteAndCompletePieces(mysvchp);

        /* Setup the resultset */
        querydata.SetupResultSet();
}

void OCITransaction::SQLCommand(Blex::UTF16String const &sqlcommand, HSVM *vm, VarId id_set, std::vector<HSVM_VariableType> const *types)
{
        HSVM_SetDefault(hsvm, id_set,HSVM_VAR_RecordArray);
        OCIStmt *stmthp=NULL;

        //////////////////////////////////////////////////////////////////////
        //
        // Prepare and run the statement
        //
        try
        {
                DEBUGPRINT("SQLCommand " << UTF16toUTF8(sqlcommand));

                CheckRetval(GetErrhp(), "SQLCommand.OCIHandleAlloc",
                            OCIHandleAlloc(GetEnvhp(),(void**)&stmthp,OCI_HTYPE_STMT,0,NULL));

                Blex::UTF16String query_string;
                CheckRetval(GetErrhp(), "SQLCommand.OCIStmtPrepare",
                            OCIStmtPrepare(stmthp, GetErrhp(), (text const*)&sqlcommand[0], sqlcommand.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

                //Is this a select?
                ub2 fntype;
                CheckRetval(GetErrhp(), "SQLCommand.OCIAttrGet",
                            OCIAttrGet(stmthp,OCI_HTYPE_STMT,&fntype,NULL,OCI_ATTR_STMT_TYPE,GetErrhp()));

                bool is_select = fntype == OCI_STMT_SELECT;

                CheckRetval(GetErrhp(), "SQLCommand.OCIStmtExecute",
                            OCIStmtExecute(mysvchp,stmthp,GetErrhp(),is_select?0:1,0,NULL,NULL,OCI_DEFAULT));

                //////////////////////////////////////////////////////////////////////
                //
                // Process the output
                //
                if (is_select)
                {
                        ResultSet results(vm,this);
                        results.SetupStatement(stmthp);

                        if (types)
                        {
                                if (results.CountResultColumns() != types->size())
                                    throw VMOCIError(-1, "OCI error: Mismatch between number of selected and typed columns");

                                for (unsigned i=0;i<types->size();++i)
                                    results.AddResultSetColumn(i+1,(HareScript::VariableTypes::Type) (*types)[i],0);
                                results.mybinder.FinishBindings(stmthp);
                        }
                        else
                        {
                                //discover columns in the query output
                                results.DescribeColumns();
                        }

                        //fetch the rows from the query output
                        while (results.FetchResult(1))
                        {
                                VarId nextrecord = HSVM_ArrayAppend(hsvm, id_set);
                                results.GetResult(nextrecord);
                        }
                }
        }
        catch (VMOCIError const &e)
        {
                DEBUGPRINT("OCI Error " << e.GetCode() << " " << e.GetMsg());
                errorlist.push_back(ErrorType(e.GetCode(), e.GetMsg()));
        }
        if(stmthp)
            OCIHandleFree(stmthp, OCI_HTYPE_STMT);
}

void OCITransaction::Commit(VarId recarr)
{
        // Only commit when the errorlist is empty
        if (errorlist.empty())
        {
                CheckRetval(GetErrhp(), "Commit.OCITransCommit", OCITransCommit(mysvchp,GetErrhp(),OCI_DEFAULT));
                mysvchp=NULL;
        }

        // Send list with errors as record array back to user
        GetHSErrors(hsvm, recarr, errorlist);
}
void OCITransaction::Rollback()
{
        if (mysvchp)
        {
                CheckRetval(GetErrhp(), "Rollback.OCITransRollback", OCITransRollback(mysvchp,GetErrhp(),OCI_DEFAULT));
                mysvchp=NULL;
        }
}

void OCITransaction::ExecuteInsert(SQLLib::DatabaseQuery const &query, VarId newrecord)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Initialize querydata
        OCIQueryData querydata(hsvm, this);

        /* Prepare the statement */
        querydata.stmthp=AllocOCIHandle<OCIStmt*>(GetErrhp(), "ConstructQuery.OCIHandleAlloc",GetEnvhp(),OCI_HTYPE_STMT,0,NULL);

        /* Construct the query, and determine input parameters */
        std::vector<Param> params;
        std::string const &primary_table = query.tables[0].name;
        Blex::UTF16String insert_string;
        AddCString(&insert_string,"INSERT INTO ");
        AddEscapedName(&insert_string, primary_table);
        AddCString(&insert_string," (");

        TableSource const &table = query.tables[0];
        unsigned len = table.columncount();
        unsigned colcount = 0;
        for (unsigned idx = 0; idx < len; ++idx)
          if (table.columns[idx].fase & Fases::Updated)
            {
                if (colcount++ != 0)
                    AddCString(&insert_string,", ");

                ColumnNameId nameid = table.typeinfo->columnsdef[idx].nameid;
                VarId cell = stackm.RecordCellRefByName(newrecord, nameid);
                AddEscapedName(&insert_string, table.typeinfo->columnsdef[idx].dbase_name);

                // Convert the column name to uppercase
                std::string tempname = table.typeinfo->columnsdef[idx].dbase_name;
                Blex::ToUppercase(tempname.begin(), tempname.end());

                // And add it to the list of input parameters
                params.push_back(Param(cell, table.typeinfo->columnsdef[idx].type, tempname));
            }
        AddCString(&insert_string,") VALUES (");
        unsigned inputvarnr = 1;
        for (unsigned idx = 0; idx < colcount; ++idx)
        {
                if (idx != 0)
                    AddCString(&insert_string,", ");
                AddCString(&insert_string,":");
                Blex::EncodeNumber(inputvarnr, 10, std::back_inserter(insert_string));
                ++inputvarnr;
        }
        AddCString(&insert_string,")");

        DEBUGPRINT("OCI insert query: " << UTF16toUTF8(insert_string));

        /* Prepare the query */
        CheckRetval(GetErrhp(), "ExecuteInsert.OCIStmtPrepare",
                    OCIStmtPrepare(querydata.stmthp, GetErrhp(), (text const*)&insert_string[0], insert_string.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

        /* Determine OCI Internal datatypes */
        std::vector<OCIColumnType> columns;
        DescribeTableColumns(UTF8toUTF16(primary_table), columns);

        /* We use information about the internal OCI type in the bind process */
        AddInternalOCITypes(columns, params);

        /* Setup input parameters */
        InputBinder inputbinder(*vm, this);
        inputbinder.PrepareBindings(params);
        inputbinder.FinishBindings(querydata.stmthp);

        /* Execute the query */
        inputbinder.ExecuteAndCompletePieces(mysvchp);

        // Free this statement handle
        CheckRetval(GetErrhp(), "ConstructQuery.OCIHandleFree",
                    OCIHandleFree(querydata.stmthp,OCI_HTYPE_STMT));
        querydata.stmthp = NULL;
}
OCITransaction::CursorId OCITransaction::OpenCursor(SQLLib::DatabaseQuery &query, CursorType cursortype)
{
        // Save the query data
        CursorId id = queries.Set(OCIQueryData(hsvm, this));
        OCIQueryData &querydata = *queries.Get(id);

        querydata.primary_table.assign(query.tables[0].name);
        querydata.tablecount = query.tables.size();

        // Construct the query
        ConstructQuery(querydata, query, cursortype);

        /* Determine OCI Internal datatypes */
        if (cursortype == Update)
                DescribeTableColumns(UTF8toUTF16(querydata.primary_table), querydata.update_columns);

        DEBUGPRINT(UTF16toUTF8(querydata.modify_str));

        return id;
}
unsigned OCITransaction::RetrieveNextBlock(CursorId id, VarId recarr)
{
        OCIQueryData &querydata = *queries.Get(id);

        StackMachine &varmem = vm->GetStackMachine();

        if (querydata.resultset->FetchResult(1))
        {
                unsigned elt_count = 1/*rowcount*/ * querydata.tablecount;
                varmem.ArrayInitialize(recarr, elt_count, VariableTypes::RecordArray);
                for (unsigned idx = 0; idx < elt_count; ++idx)
                    varmem.RecordInitializeEmpty(varmem.ArrayElementRef(recarr, idx));

                unsigned colidx = 0;
                for (OCIQueryData::ResultColumns::iterator it = querydata.result_columns.begin();
                        it != querydata.result_columns.end(); ++it, ++colidx)
                        // When it->tablenr is set to -1, we have no columns to fetch
                        if (it->fase == 1 && it->tablenr != 0xFFFFFFFF)
                        {
                                VarId rec = varmem.ArrayElementRef(recarr, it->tablenr);
                                if (!querydata.resultset->GetSingleColumn(rec, colidx))
                                        varmem.RecordCellDelete(rec, it->nameid); // NULL value, delete cell
                        }

                return 1;
        }
        return 0;
}
void OCITransaction::RetrieveFase2Records(CursorId /*id*/, VarId /*recarr*/, Blex::PodVector< Fase2RetrieveRow > &/*rowlist*/, bool /*is_last_fase2_req_for_block*/)
{
        // ADDME: Add support for fase2 records
        return;
}
OCITransaction::LockResult OCITransaction::LockRow(CursorId /*id*/, VarId /*recarr*/, unsigned /*row*/)
{
        return OCITransaction::Removed;
}
void OCITransaction::UnlockRow(CursorId /*id*/, unsigned /*row*/)
{
}
void OCITransaction::DeleteRecord(CursorId id, unsigned row)
{
        OCIQueryData &querydata = *queries.Get(id);

        /* Prepare the statement */
        OCIStmt *update_p=AllocOCIHandle<OCIStmt*>(GetErrhp(), "ConstructQuery.OCIHandleAlloc",GetEnvhp(),OCI_HTYPE_STMT,0,NULL);

        /* Prepare the query */
        CheckRetval(GetErrhp(), "DeleteRecord.OCIStmtPrepare",
                    OCIStmtPrepare(update_p, GetErrhp(), (const text*)&querydata.modify_str[0], querydata.modify_str.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

        // Do the binding to the correct rowid
        OCIBind *bndhp;
        CheckRetval(GetErrhp(), "DeleteRecord.OCIBindByPos",
            OCIBindByPos(update_p, &bndhp, GetErrhp(), 1,
            &(querydata.resultset->rowid[row]), sizeof(OCIRowid *),
            SQLT_RDD, 0, 0, 0, 0, 0, OCI_DEFAULT));

        /* Execute the query */
        CheckRetval(GetErrhp(), "ConstructQuery.OCIStmtExecute",
                    OCIStmtExecute(mysvchp,update_p,GetErrhp(),1,0,NULL,NULL,OCI_DEFAULT));

        // Free this statement handle
        CheckRetval(GetErrhp(), "ConstructQuery.OCIHandleFree",
                    OCIHandleFree((void *)update_p,OCI_HTYPE_STMT));
}
void OCITransaction::UpdateRecord(CursorId id, unsigned row, VarId newfields)
{
        OCIQueryData &querydata = *queries.Get(id);
        StackMachine &stackm = vm->GetStackMachine();

        // Prepare the statement
        OCIStmt *update_p=AllocOCIHandle<OCIStmt*>(GetErrhp(), "ConstructQuery.OCIHandleAlloc",GetEnvhp(),OCI_HTYPE_STMT,0,NULL);

        DEBUGPRINT("OCI update query: " << UTF16toUTF8(querydata.modify_str));

        // Prepare the query
        CheckRetval(GetErrhp(), "UpdateRecord.OCIStmtPrepare",
                    OCIStmtPrepare(update_p, GetErrhp(), (const text*)&querydata.modify_str[0], querydata.modify_str.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

        // Read input parameters into params
        std::vector<Param> params;
        params.resize(querydata.updatenamemap.size());
        for (std::map< ColumnNameId, signed >::iterator it = querydata.updatenamemap.begin(); it != querydata.updatenamemap.end(); ++it)
        {
                VarId cell = stackm.RecordCellRefByName(newfields, it->first);
                params[it->second] = Param(cell, querydata.result_columns[it->second].hs_type, querydata.result_columns[it->second].name);
        }

        // We use information about the internal OCI type in the bind process
        AddInternalOCITypes(querydata.update_columns, params);

        // Setup input parameters
        InputBinder inputbinder(*vm, this);
        inputbinder.PrepareBindings(params);
        inputbinder.FinishBindings(update_p);

        // Do the binding to the correct rowid
        OCIBind *bndhp = NULL;
        CheckRetval(GetErrhp(), "UpdateRecord.OCIBindByPos",
            OCIBindByPos(update_p, &bndhp, GetErrhp(), params.size()+1,
            &(querydata.resultset->rowid[row]), sizeof(OCIRowid *),
            SQLT_RDD, 0, 0, 0, 0, 0, OCI_DEFAULT));

        // Execute the query
        inputbinder.ExecuteAndCompletePieces(mysvchp);


        // Free this statement handle
        CheckRetval(GetErrhp(), "ConstructQuery.OCIHandleFree",
                    OCIHandleFree((void *)update_p,OCI_HTYPE_STMT));

}
void OCITransaction::CloseCursor(CursorId id)
{
        /* Remove the query */
        queries.Erase(id);
}

void OCITransaction::BuildQueryString(OCIQueryData &querydata, HareScript::SQLLib::DatabaseQuery &query, std::vector<Param> &params, Blex::UTF16String *select_str, CursorType cursortype)
{
        querydata.result_columns.clear();

        std::vector<std::pair<std::string, std::vector<OCIColumnType> > > table_columns;

        // Filter all conditions that we can handle; update retrieval time for that columns
        for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
        {
                // Find this column in the list with cached table descriptions
                std::vector<OCIColumnType> table_cols;
                for (std::vector<std::pair<std::string, std::vector<OCIColumnType> > >::const_iterator table_column_it = table_columns.begin();
                        table_column_it != table_columns.end();
                        ++table_column_it)
                        if (table_column_it->first == query.tables[it->table].name)
                                table_cols = table_column_it->second;

                // When not found, then do a new describe
                if (!table_cols.size())
                {
                        DescribeTableColumns(UTF8toUTF16(query.tables[it->table].name), table_cols);
                        table_columns.push_back(std::make_pair(query.tables[it->table].name, table_cols));
                }

                // Now find this column
                std::vector<OCIColumnType>::const_iterator col_it;
                for (col_it = table_cols.begin(); col_it != table_cols.end(); ++col_it)
                        if (Blex::StrCaseCompare(col_it->name, query.tables[it->table].typeinfo->columnsdef[it->column].dbase_name) == 0)
                                break;

                // When we found it
                if (col_it == table_cols.end())
                        ThrowDBError(-1, "Column not found: " + query.tables[it->table].typeinfo->columnsdef[it->column].dbase_name);

                // We don't handle case insensitive and LONG and BLOB compares
                it->handled = it->casesensitive && col_it->ocitype != SQLT_LNG &&
                        col_it->ocitype != SQLT_LBI && col_it->ocitype != SQLT_LVC &&
                        col_it->ocitype != SQLT_LVB &&
                        col_it->ocitype != SQLT_BLOB && col_it->ocitype != SQLT_CLOB;

                if (!it->handled)
                    query.tables[it->table].columns[it->column].fase = Fases::Fase1;
        }

        // Filter all join conditions that we can handle
        for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
        {
                /* FIXME: how do we handle a join between two null-translated tables */
                it->handled = it->casesensitive;
                if (!it->handled)
                {
                        query.tables[it->table1].columns[it->column1].fase = Fases::Fase1;
                        query.tables[it->table2].columns[it->column2].fase = Fases::Fase1;
                }
        }

        AddCString(select_str,"SELECT ");
        switch (cursortype)
        {
        case Delete:
                AddCString(&querydata.modify_str,"DELETE FROM ");
                AddCString(&querydata.modify_str,&querydata.primary_table[0]);
        break;
        case Update:
                AddCString(&querydata.modify_str,"UPDATE ");
                AddCString(&querydata.modify_str,&querydata.primary_table[0]);
                AddCString(&querydata.modify_str," SET ");
        break;
        case Select: ;
        }

        /* Add all selected fields to the query string and the resultset */
        unsigned colcount = 0;
        unsigned update_cols = 0;
        std::vector<std::string> update_colnames;
        for (unsigned tabidx = 0; tabidx < query.tables.size(); ++tabidx)
        {
                TableSource &table = query.tables[tabidx];
                for (unsigned idx = 0; idx < table.columncount(); ++idx)
                {
                        unsigned fase = 0;
                        // FIXME: Add fase 2 support
                        if (table.columns[idx].fase & Fases::Fase2)
                            fase = 1;
                        if (table.columns[idx].fase & Fases::Fase1)
                            fase = 1;

                        if (table.columns[idx].fase & Fases::Updated)
                        {
                                // Add column to updatenamemap, when we are doing an update
                                if (cursortype == Update && table.columns[idx].fase & Fases::Updated)
                                {
                                        if (update_cols > 0)
                                            AddCString(&querydata.modify_str,", ");
                                        AddEscapedName(&querydata.modify_str, table.typeinfo->columnsdef[idx].dbase_name);
                                        update_colnames.push_back(table.typeinfo->columnsdef[idx].dbase_name);
                                        AddCString(&querydata.modify_str,"=:i");
                                        Blex::EncodeNumber(colcount, 10, std::back_inserter(*&querydata.modify_str));
                                        querydata.updatenamemap[table.ColType(idx).nameid] = update_cols;
                                        ++update_cols;
                                }
                                fase = 1;
                        }

                        if (fase != 0) //downloadable column?
                        {
                                if (colcount > 0)
                                    AddCString(select_str,", ");
                                AddTableAndColumnName(query, tabidx, idx, select_str);

                                // Convert colunm name to uppercase
                                std::string tempname = table.typeinfo->columnsdef[idx].dbase_name;
                                Blex::ToUppercase(tempname.begin(), tempname.end());

                                querydata.result_columns.push_back(
                                        OCIQueryData::ResultColumn(
                                            table.ColType(idx).type,
                                            table.ColType(idx).nameid,
                                            tempname,
                                            tabidx,
                                            idx,
                                            fase
                                            ));
                                ++colcount;
                    }
              }
        }

        querydata.fase2colcount = colcount - querydata.fase1colcount;

        // ADDME: We can optimize this to a SELECT COUNT(*) query
        // When no result columns are selected, insert a fake column (select a 1)
        if (colcount == 0)
        {
                AddCString(select_str, "1");
                querydata.result_columns.push_back(
                        OCIQueryData::ResultColumn(VariableTypes::Integer,
                            0, "1", 0xFFFFFFFF, -1, 1));
        }

        // Add sources
        AddCString(select_str, " FROM ");
        unsigned idx = 0;
        for (DatabaseQuery::TableSources::const_iterator it = query.tables.begin(); it != query.tables.end(); ++it, ++idx)
        {
                if (it != query.tables.begin())
                    AddCString(select_str,", ");
                AddEscapedName(select_str, it->name);
                AddCString(select_str," ");
                AddTableName(idx, select_str);
        }

        unsigned inputvarnr = 1;
        // Crawl through all singles/joins
        if (!query.singleconditions.empty() || !query.joinconditions.empty())
        {
                unsigned cond_count = 0;
                for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
                {
                        if (!it->handled) continue;
                        if (cond_count++)
                            AddCString(select_str,") AND (");
                        else
                            AddCString(select_str," WHERE (");

                        if (it->match_null)
                        {
                                AddCString(select_str,"(");
                                AddTableAndColumnName(query, it->table, it->column, select_str);
                                AddCString(select_str," IS NULL) OR (");
                        }


                        AddTableAndColumnName(query, it->table, it->column, select_str);
                        AddCString(select_str,GetOperator(it->condition));

                        AddCString(select_str,":");
                        Blex::EncodeNumber(inputvarnr, 10, std::back_inserter(*select_str));

                        if (it->match_null)
                            AddCString(select_str,")");

                        // Convert column name to uppercase
                        std::string tempname = query.tables[it->table].typeinfo->columnsdef[it->column].dbase_name;
                        Blex::ToUppercase(tempname.begin(), tempname.end());

                        params.push_back(Param(it->value, query.tables[it->table].typeinfo->columnsdef[it->column].type, tempname));
                }
                for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
                {
                        // Cant't handle case insensitive
                        if (!it->handled) continue;
                        if (cond_count++)
                            AddCString(select_str,") AND ((");
                        else
                            AddCString(select_str," WHERE ((");

                        AddTableAndColumnName(query, it->table1, it->column1, select_str);
                        AddCString(select_str," ");
                        AddCString(select_str,GetOperator(it->condition));
                        AddCString(select_str," ");
                        AddTableAndColumnName(query, it->table2, it->column2, select_str);

                        AddCString(select_str,")");

                        bool trans_t1 = query.tables[it->table1].ColType(it->column1).flags & ColumnFlags::TranslateNulls && query.tables[it->table1].columns[it->column1].nulldefault;
                        bool trans_t2 = query.tables[it->table2].ColType(it->column2).flags & ColumnFlags::TranslateNulls && query.tables[it->table2].columns[it->column2].nulldefault;

                        if (trans_t2)
                        {
                                AddCString(select_str,"OR(");
                                AddTableAndColumnName(query, it->table2, it->column2, select_str);
                                AddCString(select_str," IS NULL AND ");
                                AddTableAndColumnName(query, it->table1, it->column1, select_str);
                                AddCString(select_str,GetOperator(it->condition));
                                AddCString(select_str,":");
                                Blex::EncodeNumber(inputvarnr, 10, std::back_inserter(*select_str));

                                // Convert column name to uppercase
                                std::string tempname = query.tables[it->table1].typeinfo->columnsdef[it->column1].dbase_name;
                                Blex::ToUppercase(tempname.begin(), tempname.end());

                                params.push_back(Param(query.tables[it->table2].columns[it->column2].nulldefault, query.tables[it->table2].ColType(it->column2).type, tempname));
                                AddCString(select_str,")");
                        }
                        if (trans_t1)
                        {
                                AddCString(select_str,"OR(");
                                AddTableAndColumnName(query, it->table1, it->column1, select_str);
                                AddCString(select_str," IS NULL AND ");
                                AddTableAndColumnName(query, it->table2, it->column2, select_str);
                                AddCString(select_str,GetOperator(SwappedCondition(it->condition)));
                                AddCString(select_str,":");
                                Blex::EncodeNumber(inputvarnr, 10, std::back_inserter(*select_str));

                                // Convert column name to uppercase
                                std::string tempname = query.tables[it->table1].typeinfo->columnsdef[it->column1].dbase_name;
                                Blex::ToUppercase(tempname.begin(), tempname.end());

                                params.push_back(Param(query.tables[it->table1].columns[it->column1].nulldefault, query.tables[it->table1].ColType(it->column1).type, tempname));
                                AddCString(select_str,")");
                        }
                        if (it->match_double_null)
                        {
                                AddCString(select_str," OR ((");
                                AddTableAndColumnName(query, it->table1, it->column1, select_str);
                                AddCString(select_str," IS NULL)AND(");
                                AddTableAndColumnName(query, it->table2, it->column2, select_str);
                                AddCString(select_str," IS NULL)");
                                AddCString(select_str,")");
                        }

                        it->handled = true;
                }
                if (cond_count)
                    AddCString(select_str,")");
        }


        // When we have a non select statement, adjust the query_string
        if (cursortype != Select)
        {
              AddCString(select_str," FOR UPDATE ");
              if (cursortype == Update)
              {
                      AddCString(select_str,"OF ");
                      for (std::vector<std::string>::const_iterator it = update_colnames.begin();
                           it != update_colnames.end(); ++it)
                      {
                                if (it != update_colnames.begin())
                                    AddCString(select_str,", ");
                                AddEscapedName(select_str, *it);
                      }
              }
              AddCString(&querydata.modify_str," WHERE rowid=:a");
        }
}

void OCITransaction::AddInternalOCITypes(std::vector<OCIColumnType> columns, std::vector<Param> &params)
{
        for (std::vector<OCIColumnType>::const_iterator it = columns.begin(); it != columns.end(); ++it)
                for (std::vector<Param>::iterator par = params.begin(); par != params.end(); ++par)
                        if (it->name == par->name)
                        {
                                par->ocitype = it->ocitype;
                                break;
                        }

}

} // End of namespace OCIDBProvider
} // End of namespace HareScript



