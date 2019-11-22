#include <harescript/vm/allincludes.h>


#include <harescript/vm/hsvm_context.h>
#include "hsvm_odbcprovider.h"

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

ODBCQueryData::ODBCQueryData(VirtualMachine *vm, Capabilities const &capabilities, Blex::Charsets::Charset charset, ODBCWorkarounds::_type workarounds)
: vm(vm)
, resultset(vm,capabilities,SQL_NULL_HANDLE, charset, workarounds)
{
        query_handle = SQL_NULL_HANDLE;
}

ODBCQueryData::~ODBCQueryData()
{
        // Eat all exceptions; we don't want to crash
        try
        {
                TerminateQuery();
        } catch (std::exception &)
        {
        }
}

void ODBCQueryData::TerminateQuery()
{
        SQLRETURN retval;
        if (query_handle != SQL_NULL_HANDLE)
        {
//                DEBUGPRINT("Freeing select handle " << (void*)query_handle);

                retval = SQLFreeHandle(SQL_HANDLE_STMT, query_handle);
                CheckRetval(query_handle, retval, "Closing query handle failed");
                query_handle = SQL_NULL_HANDLE;
        }
}

bool ODBCQueryData::ResultColumn::operator <(ResultColumn const &rhs) const
{
        if (bindtype != rhs.bindtype)
           return bindtype < rhs.bindtype;
        if (fase != rhs.fase)
           return fase < rhs.fase;
        return false;
}

ODBCTransactionDriver::ODBCTransactionDriver(HSVM *hsvm, SQLHDBC hdbc)
: DatabaseTransactionDriverInterface(GetVirtualMachine(hsvm))
, hsvm(hsvm)
, hdbc(hdbc)
, charset(Blex::Charsets::Unknown)
{
//        DEBUGPRINT("Creating ODBC driver " << this);
        description.supports_block_cursors = true;
        description.max_joined_tables = 0;
        description.supports_single = true;
        description.supports_nulls = true;
        description.supports_data_modify = (GetDriverInfoStr(hdbc, SQL_DATA_SOURCE_READ_ONLY) == "N");
        description.needs_locking_and_recheck = false;
        description.needs_uppercase_names = false;
}

ODBCTransactionDriver::~ODBCTransactionDriver()
{
//        DEBUGPRINT("Deleting ODBC driver " << this);

        ODBCProviderContextData *context = static_cast<ODBCProviderContextData *>(HSVM_GetContext(hsvm,ODBCProviderContextId,true));
        context->translist.erase(this);

        queries.Clear();

        if (hdbc != SQL_NULL_HANDLE)
        {
                SQLRETURN retval;
                retval = SQLEndTran(SQL_HANDLE_DBC, hdbc, SQL_ROLLBACK);
                if (IsError(retval))
                {
                    DEBUGPRINT(GetDiagnostics(SQL_HANDLE_DBC, context->henv));
                    // ADDME: No throws in destructor, so add to commit/rollback functions later
//                    ThrowDBError("Could not end transaction : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));
                }

                retval = SQLDisconnect(hdbc);
                if (IsError(retval))
                {
                    DEBUGPRINT(GetDiagnostics(SQL_HANDLE_DBC, context->henv));
                    // ADDME: No throws in destructor, so add to commit/rollback functions later
//                    ThrowDBError("Could not disconnect : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));
                }

                retval = SQLFreeHandle(SQL_HANDLE_DBC, hdbc);
                if (IsError(retval))
                {
                    DEBUGPRINT(GetDiagnostics(SQL_HANDLE_DBC, context->henv));
                    // ADDME: No throws in destructor, so add to commit/rollback functions later
//                    ThrowDBError("Could not de-allocate a connection handle : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));
                }

                hdbc=SQL_NULL_HANDLE;
        }
}


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

void AddEscapedNameItr(Blex::UTF16String *str, std::string::const_iterator start, std::string::const_iterator limit)
{
        AddCString(str,"\"");

        //ADDME: Use a proper UTF8 -> UTF16 converter
        Blex::UTF8DecodeMachine decoder;
        for (; start != limit; ++start)
        {
                if (*start == '"') //escape double quotes with a backslash
                    str->push_back('\\');

                //add the character itself, decoding if necessary
                uint32_t nextunicodebyte = decoder(*start);
                if (nextunicodebyte != Blex::UTF8DecodeMachine::NoChar && nextunicodebyte != Blex::UTF8DecodeMachine::InvalidChar)
                    str->push_back(nextunicodebyte);
        }

        AddCString(str,"\"");
}


/* add a column or table, escaping it */
void AddEscapedName(Blex::UTF16String *str, std::string to_add)
{
        AddEscapedNameItr(str, to_add.begin(), to_add.end());
}

void AddEscapedSchemaTable(Blex::UTF16String *str, std::string to_add)
{
        std::string::const_iterator dotpos = std::find(to_add.begin(), to_add.end(), '.');

        if (dotpos != to_add.end())
        {
                AddEscapedNameItr(str, to_add.begin(), dotpos);
                AddCString(str,".");
                ++dotpos;
                AddEscapedNameItr(str, dotpos, to_add.end());
        }
        else
            AddEscapedName(str, to_add);
}

std::string ConvertToUTF8(Blex::UTF16String const &str)
{
        std::string retstr;
        Blex::UTF8Encode(str.begin(), str.end(), std::back_inserter(retstr));
        return retstr;
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
        case DBConditionCode::Like:
            ThrowDBError("Cannot swap arguments to LIKE");
            break;
        case DBConditionCode::In:
            ThrowDBError("Cannot swap arguments to IN");
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
        default:
            ThrowDBError("Encountered unkown relation type");
            return "";
        }
}

} // End of anonymous namespace

void ODBCTransactionDriver::BuildQueryString(ODBCQueryData &querydata, DatabaseQuery &query, std::vector< std::pair< VariableTypes::Type, VarId > > &params, DatabaseTransactionDriverInterface::CursorType, Blex::UTF16String *str)
{
        querydata.result_columns.clear();

        // Filter all conditions that we can handle; update retrieval time for that columns
        for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
        {
                it->handled = it->casesensitive && it->condition != DBConditionCode::In;
                if (!it->handled)
                    query.tables[it->table].columns[it->column].fase = Fases::Fase1;
        }

        for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
        {
//  /              // FIXME: we don't handle a join between two null-translated tables; don't know how to handle it here...
//                bool two_null_t = (query.tables[it->table1][it->column1].flags & ColumnFlags::TranslateNulls) && (query.tables[it->table2][it->column2].flags & ColumnFlags::TranslateNulls);
                it->handled = it->casesensitive && it->condition != DBConditionCode::Like && it->condition != DBConditionCode::In;
                if (!it->handled)
                {
                        query.tables[it->table1].columns[it->column1].fase = Fases::Fase1;
                        query.tables[it->table2].columns[it->column2].fase = Fases::Fase1;
                }
        }

        AddCString(str,"SELECT ");

        // Relatively cheap columns, to use in case no columns are selected (ODBC barfs on that)
        signed cand_table = -1;
        unsigned cand_column = 0;
        unsigned colcount = 0;

        /** Add all selected fields to the query string and the resultset */
        for (unsigned tabidx = 0; tabidx < query.tables.size(); ++tabidx)
        {
                TableSource &table = query.tables[tabidx];
                for (unsigned idx = 0; idx < table.columncount(); ++idx)
                {
                        unsigned fase = 0;
                        bool is_updated = table.columns[idx].fase & Fases::Updated;
                        if (table.columns[idx].fase & Fases::Fase2)
                            fase = 2;
                        if (table.columns[idx].fase & Fases::Fase1)
                            fase = 1;
                        if (fase == 0 && is_updated)
                            fase = 3;

                        if (fase != 0) //downloadable column?
                        {
                                BindType::Type binding;

                                if (is_updated)
                                {
                                        binding = BindType::MustBind;
                                }
                                else if (ResultSet::CanOverflowBuffer(table.ColType(idx).type) && !capabilities.support_getdata_when_bound)
                                {
                                        binding = BindType::NeverBind;
                                        DEBUGPRINT("Not binding column " << vm->columnnamemapper.GetReverseMapping(table.ColType(idx).nameid).stl_str());
                                }
                                else
                                {
                                        binding = BindType::TryBind;
                                }

                            querydata.result_columns.push_back(
                                    ODBCQueryData::ResultColumn(
                                        table.ColType(idx).type,
                                        table.ColType(idx).nameid,
                                        tabidx,
                                        idx,
                                        fase,
                                        binding,
                                        is_updated
                                        ));
                            ++colcount;
                    }
                    else
                    {
                          if (colcount && cand_table == -1 && table.ColType(idx).flags & ColumnFlags::Key)
                          {
                                  cand_table = tabidx;
                                  cand_column = idx;
                          }
                    }
              }
        }

        /* Sort the resultset columns in such a way that the unbound columns are gotten in
           ascending order */
        std::sort(querydata.result_columns.begin(), querydata.result_columns.end());

        colcount = 0;
        for (std::vector< ODBCQueryData::ResultColumn >::iterator it = querydata.result_columns.begin(); it != querydata.result_columns.end(); ++it, ++colcount)
        {
                if (it != querydata.result_columns.begin())
                    AddCString(str,", ");
                AddTableAndColumnName(query, it->tablenr, it->columnnr, str);
                querydata.resultset.AddColumn(it->hs_type, it->bindtype);
                DEBUGPRINT("Added " << vm->columnnamemapper.GetReverseMapping(it->nameid).stl_str()<<", bindtype: "<<it->bindtype);
                if (it->is_updated)
                    querydata.updatenamemap[it->nameid] = colcount;
        }
/*
        unsigned colcount = 0;
        // Fase 1
        for (unsigned tabidx = 0; tabidx < query.tables.size(); ++tabidx)
        {
                TableSource &table = query.tables[tabidx];
                for (unsigned idx = 0; idx < table.columncount(); ++idx)
                {
                        bool add = false;
                        BindType::Type binding;
                        if (table.columns[idx].fase & (Fases::Fase1 | Fases::Fase2))
                        {
                                binding = BindType::PreferBind;
                                add = true;
                        }
                        if (table[idx].flags & ColumnFlags::Updated)
                        {
                                binding = BindType::MustBind;
                                add = true;
                                querydata.updatenamemap[table[idx].nameid] = colcount;
                        }
                        if (colcount && cand_table == -1 && table[idx].flags & ColumnFlags::Key)
                        {
                                cand_table = tabidx;
                                cand_column = idx;
                        }
                        if (add)
                        {
                                if (colcount++)
                                    AddCString(str,", ");
                                querydata.result_columns.push_back(ODBCQueryData::ResultColumn(table[idx].type, table[idx].nameid, tabidx));
                                AddTableAndColumnName(query, tabidx, idx, str);
                        }
                }
        }
        querydata.fase1colcount = colcount;

        for (unsigned tabidx = 0; tabidx < query.tables.size(); ++tabidx)
        {
                TableSource &table = query.tables[tabidx];
                for (unsigned idx = 0; idx < table.columncount(); ++idx)
                {
                        if (table.columns[idx].fase & Fases::Fase2 && !table.columns[idx].fase & Fases::Fase1 && !(table[idx].flags & ColumnFlags::Updated))
                        {
                                if (colcount++)
                                    AddCString(str,", ");
                                querydata.resultset.AddColumn(table[idx].type, BindType::PreferBind);
                                querydata.result_columns.push_back(ODBCQueryData::ResultColumn(table[idx].type, table[idx].nameid, tabidx));
                                AddTableAndColumnName(query, tabidx, idx, str);
                        }
                }
        }

                                querydata.updatenamemap[table[idx].nameid] = colcount;
                                querydata.resultset.AddColumn(table[idx].type, BindType::PreferBind);
                                querydata.resultset.AddColumn(table[idx].type, binding);
*/

        querydata.fase2colcount = colcount - querydata.fase1colcount;

        if (colcount == 0)
        {
                if (cand_table == -1)
                {
                        // No keys; snatch first valid field
                        for (cand_table = 0; cand_table < (signed)query.tables.size(); ++cand_table)
                            if (query.tables[cand_table].columncount() != 0)
                                break;
                        if (cand_table == (signed)query.tables.size())
                            ThrowDBError("ODBC implementation cannot work with all empty table-defintions (define at least one column in one of the used tables)");
                }
                ++colcount;
                querydata.resultset.AddColumn(query.tables[cand_table].ColType(cand_column).type, BindType::TryBind);
                AddTableAndColumnName(query, cand_table, cand_column, str);
        }

        if (colcount == 0)
            ThrowDBError("ODBC requires selecting at least 1 column in a SELECT query (or a key in one of the tables)");

        // Add sources
        AddCString(str, " FROM ");
        unsigned idx = 0;
        for (DatabaseQuery::TableSources::const_iterator it = query.tables.begin(); it != query.tables.end(); ++it, ++idx)
        {
                if (it != query.tables.begin())
                    AddCString(str,", ");
                AddEscapedSchemaTable(str, it->name);
                AddCString(str," ");
                AddTableName(idx, str);
        }

        bool has_where = false;

        // Crawl through all singles/joins
        if (!query.singleconditions.empty() || !query.joinconditions.empty())
        {
                unsigned cond_count = 0;
                for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
                {
                        if (!it->handled) continue;
                        if (cond_count++)
                            AddCString(str,") AND (");
                        else
                            AddCString(str," WHERE (");
                        has_where = true;

                        if (it->match_null)
                        {
                                AddCString(str,"(");
                                AddTableAndColumnName(query, it->table, it->column, str);
                                AddCString(str," IS NULL) OR (");
                        }

                        AddTableAndColumnName(query, it->table, it->column, str);
                        AddCString(str,GetOperator(it->condition));
                        AddCString(str,"?");

                        if (it->match_null)
                            AddCString(str,")");

                        params.push_back(std::make_pair(query.tables[it->table].typeinfo->columnsdef[it->column].type, it->value));
                }
                for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
                {
                        // Cant't handle case insensitive
                        if (!it->handled) continue;
                        if (cond_count++)
                            AddCString(str,") AND ((");
                        else
                            AddCString(str," WHERE ((");
                        has_where = true;

                        AddTableAndColumnName(query, it->table1, it->column1, str);
                        AddCString(str," ");
                        AddCString(str,GetOperator(it->condition));
                        AddCString(str," ");
                        AddTableAndColumnName(query, it->table2, it->column2, str);

                        AddCString(str,")");

                        bool trans_t1 = query.tables[it->table1].ColType(it->column1).flags & ColumnFlags::TranslateNulls && query.tables[it->table1].columns[it->column1].nulldefault;
                        bool trans_t2 = query.tables[it->table2].ColType(it->column2).flags & ColumnFlags::TranslateNulls && query.tables[it->table2].columns[it->column2].nulldefault;

                        if (trans_t2)
                        {
                                AddCString(str,"OR(");
                                AddTableAndColumnName(query, it->table2, it->column2, str);
                                AddCString(str," IS NULL AND ");
                                AddTableAndColumnName(query, it->table1, it->column1, str);
                                AddCString(str,GetOperator(it->condition));
                                AddCString(str,"?");
                                params.push_back(std::make_pair(query.tables[it->table2].ColType(it->column2).type, query.tables[it->table2].columns[it->column2].nulldefault));
                                AddCString(str,")");
                        }
                        if (trans_t1)
                        {
                                AddCString(str,"OR(");
                                AddTableAndColumnName(query, it->table1, it->column1, str);
                                AddCString(str," IS NULL AND ");
                                AddTableAndColumnName(query, it->table2, it->column2, str);
                                AddCString(str,GetOperator(SwappedCondition(it->condition)));
                                AddCString(str,"?");
                                params.push_back(std::make_pair(query.tables[it->table1].ColType(it->column1).type, query.tables[it->table1].columns[it->column1].nulldefault));
                                AddCString(str,")");
                        }
                        if (it->match_double_null)
                        {
                                AddCString(str," OR ((");
                                AddTableAndColumnName(query, it->table1, it->column1, str);
                                AddCString(str," IS NULL)AND(");
                                AddTableAndColumnName(query, it->table2, it->column2, str);
                                AddCString(str," IS NULL)");
                                AddCString(str,")");
                        }

                        it->handled = true;
                }
                if (cond_count)
                    AddCString(str,")");
        }

        // Sigh. PSQLODBC doesn't like selects without a where.
        if (!has_where)
            AddCString(str," WHERE 1=1");
}

void ODBCTransactionDriver::ConstructQuery(ODBCQueryData &querydata, DatabaseQuery &query, CursorType cursortype)
{
        TCTypeMap tc_list;
        TCTypeMap tc_list2;

        querydata.primary_table = query.tables[0].name;
        querydata.tablecount = query.tables.size();

        querydata.query_handle = AllocateStmtHandle(hdbc);

        //DEBUGPRINT("Allocated select handle " << (void*)querydata.query_handle);

        SQLRETURN retval;

        // Select type of cursor; select only needs readonly; update and delete need a locking cursor
        ODBCCursorType::_type cursor = cursortype == Select ? capabilities.select_cursor : capabilities.modify_cursor;
        retval = SQLSetStmtAttr(querydata.query_handle, SQL_ATTR_CURSOR_TYPE, (void *)(long)GetCursorId(cursor), 0);
        CheckRetval(querydata.query_handle, retval, "Could not set cursor type");

        if (cursortype != Select)
        {
                retval = SQLSetStmtAttr(querydata.query_handle, SQL_ATTR_CONCURRENCY, (void *)SQL_CONCUR_LOCK, 0);
                CheckRetval(querydata.query_handle, retval, "Could not set concurrency attribute");
        }

        // Set a limit if applicable
        if (query.limit >= 0)
        {
                retval = SQLSetStmtAttr(querydata.query_handle, SQL_ATTR_MAX_ROWS, (void *)(long)query.limit, 0);
                CheckRetval(querydata.query_handle, retval, "Could not set maximum number of rows (limit)");
        }

        // Build the select-string
        std::vector< std::pair< VariableTypes::Type, VarId > > params;

        Blex::UTF16String query_string;
        BuildQueryString(querydata, query, params, cursortype, &query_string);
        DEBUGPRINT("ODBC query string: " << ConvertToUTF8(query_string));

        // Prepare the query
        if (charset != Blex::Charsets::Unicode)
        {
                std::string query_utf8 = ConvertToUTF8(query_string);
                std::string query_ansi;
                Blex::ConvertUTF8ToCharset(query_utf8.c_str(), query_utf8.c_str() + query_utf8.size(), charset, &query_ansi);
                retval = SQLPrepareA(querydata.query_handle, reinterpret_cast<SQLCHAR*>(&query_ansi[0]), query_ansi.size());
        }
        else
            retval = SQLPrepareW(querydata.query_handle, reinterpret_cast<SQLWCHAR*>(&query_string[0]), query_string.size());

        CheckRetval(querydata.query_handle, retval, "Could not prepare ODBC query");

/*/        // Collect the parameters
        for (std::vector<SingleCondition>::const_iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
            if (it->handled)
                params.push_back(std::make_pair(query.tables[it->table].typeinfo->columnsdef[it->column].type, it->value));*/

        // Execute the query
        CheckRetval(querydata.query_handle, querydata.resultset.ExecuteStatement(querydata.query_handle, params), "Could not execute query");

        // Calculate number of block rows to use (without setpos, we can't change the
        // current row in a block, so don't retrieve more than one row at a time)
        unsigned maxblockrows = (cursortype == Select ? capabilities.support_setpos_position : capabilities.support_setpos_modify) ? query.maxblockrows : 1;
        querydata.resultset.DecideBindings();
        querydata.resultset.Bind(querydata.query_handle, maxblockrows);

        querydata.finished = false;
}

// -----------------------------------------------------------------------------
//
//   Transaction driver main functions
//
//

DatabaseTransactionDriverInterface::CursorId ODBCTransactionDriver::OpenCursor(DatabaseQuery &query, CursorType cursortype)
{
        CursorId id = queries.Set(ODBCQueryData(vm,capabilities, charset, workarounds));
        ODBCQueryData &querydata = *queries.Get(id);
        querydata.vm = vm;

        if (capabilities.harescript_challenged)
            ThrowDBError("This database does not support enough ODBC functionality to allow HareScript native access");

        try
        {
                ConstructQuery(querydata, query, cursortype);
        }
        catch (std::exception &)
        {
                queries.Erase(id);
                throw;
        }

        return id;
}

unsigned ODBCTransactionDriver::RetrieveNextBlock(CursorId id, VarId recarr)
{
        ODBCQueryData &querydata = *queries.Get(id);
        StackMachine &varmem = vm->GetStackMachine();

        if (querydata.resultset.NextBlock() == 0)
        {
                querydata.finished = true;
                return 0;
        }

        assert(querydata.result_columns.size() >= querydata.fase1colcount + querydata.fase2colcount);

        unsigned rowcount = querydata.resultset.BlockRowCount();
        unsigned colidx = 1;

        unsigned elt_count = rowcount * querydata.tablecount;
        varmem.ArrayInitialize(recarr, elt_count, VariableTypes::RecordArray);
        for (unsigned idx = 0; idx < elt_count; ++idx)
            varmem.RecordInitializeEmpty(varmem.ArrayElementRef(recarr, idx));

        for (ODBCQueryData::ResultColumns::iterator it = querydata.result_columns.begin();
                it != querydata.result_columns.end(); ++it, ++colidx)
            if (it->fase == 1)
                for (unsigned row = 0; row < rowcount; ++row)
                {
                        VarId rec = varmem.ArrayElementRef(recarr, row * querydata.tablecount + it->tablenr);
                        VarId cell = varmem.RecordCellCreate(rec, it->nameid);
                        if (!querydata.resultset.Get(row + 1, colidx, cell))
                             varmem.RecordCellDelete(rec, it->nameid); // NULL value, delete cell
                }
/*
        std::vector< ODBCQueryData::ResultColumn >::iterator it = querydata.result_columns.begin();
        for (unsigned colidx = 1; colidx <= querydata.fase1colcount; ++it, ++colidx)
            for (unsigned row = 0; row < rowcount; ++row)
            {
                    VarId rec = varmem.ArrayElementRef(recarr, row * querydata.tablecount + it->tablenr);
                    VarId cell = varmem.RecordCellCreate(rec, it->nameid);
                    if (!querydata.resultset.Get(row + 1, colidx, cell))
                         varmem.RecordCellDelete(rec, it->nameid); // NULL value, delete cell
            }*/

        return querydata.resultset.BlockRowCount();
}

void ODBCTransactionDriver::RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< unsigned > const &/*rowlist*/, bool /*is_last_fase2_req_for_block*/)
{
        ODBCQueryData &querydata = *queries.Get(id);
        StackMachine &varmem = vm->GetStackMachine();

        unsigned rowcount = querydata.resultset.BlockRowCount();
        unsigned colidx = 1;
        for (ODBCQueryData::ResultColumns::iterator it = querydata.result_columns.begin();
                it != querydata.result_columns.end(); ++it, ++colidx)
            if (it->fase == 2)
                for (unsigned row = 0; row < rowcount; ++row)
                {
                        VarId rec = varmem.ArrayElementRef(recarr, row * querydata.tablecount + it->tablenr);
                        VarId cell = varmem.RecordCellCreate(rec, it->nameid);
                        if (!querydata.resultset.Get(row + 1, colidx, cell))
                             varmem.RecordCellDelete(rec, it->nameid); // NULL value, delete cell
                }
/*
        std::vector< ODBCQueryData::ResultColumn >::iterator it = querydata.result_columns.begin() + querydata.fase1colcount;
        for (unsigned colidx = querydata.fase1colcount + 1; colidx <= querydata.fase1colcount + querydata.fase2colcount; ++it, ++colidx)
            for (std::vector<unsigned>::const_iterator rowit = rowlist.begin(); rowit != rowlist.end(); ++rowit)
            {
                    VarId rec = varmem.ArrayElementRef(recarr, *rowit * querydata.tablecount + it->tablenr);
                    VarId cell = varmem.RecordCellCreate(rec, it->nameid);
                    if (!querydata.resultset.Get(*rowit + 1, colidx, cell))
                         varmem.RecordCellDelete(rec, it->nameid); // NULL value, delete cell
            }*/
}


void ODBCTransactionDriver::DeleteRecord(CursorId id, unsigned row)
{
        if (!capabilities.support_setpos_modify)
            ThrowDBError("Cannot delete records using a database driver that does not support SQLSetPos");

        ODBCQueryData &querydata = *queries.Get(id);

        DEBUGPRINT("Deleting row #" << row);

        SQLRETURN retval = SQLSetPos(querydata.query_handle, (SQLUSMALLINT)(1 + row), SQL_DELETE, SQL_LOCK_NO_CHANGE);
        CheckRetval(querydata.query_handle,retval, "Could not set cursor position");
}

void ODBCTransactionDriver::UpdateRecord(CursorId id, unsigned row, VarId newfields)
{
        if (!capabilities.support_setpos_modify)
            ThrowDBError("Cannot delete records using a database driver that does not support SQLSetPos");

        StackMachine &stackm = vm->GetStackMachine();
        ODBCQueryData &querydata = *queries.Get(id);

        querydata.resultset.PositionCursor(row + 1);
        for (std::map< ColumnNameId, signed >::iterator it = querydata.updatenamemap.begin(); it != querydata.updatenamemap.end(); ++it)
        {
                VarId cell = stackm.RecordCellRefByName(newfields, it->first);
                // cell ==0 : NULL

                querydata.resultset.Set(it->second + 1, cell);
        }
        querydata.resultset.UpdateRow();
}

void ODBCTransactionDriver::CloseCursor(CursorId id)
{
        ODBCQueryData &querydata = *queries.Get(id);

        querydata.TerminateQuery();

        queries.Erase(id);
}

void ODBCTransactionDriver::ExecuteInsert(DatabaseQuery const &query, VarId newrecord)
{
        StackMachine &stackm = vm->GetStackMachine();

        SQLHSTMT insert_handle;

        insert_handle = AllocateStmtHandle(hdbc);

        //DEBUGPRINT("Allocated insert handle " << (void*)insert_handle);
        try
        {
                std::vector< std::pair< VariableTypes::Type, VarId > > params;

                std::string const &primary_table = query.tables[0].name;

                Blex::UTF16String insert_string;
                AddCString(&insert_string,"INSERT INTO ");
                AddEscapedSchemaTable(&insert_string, primary_table);
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
                        params.push_back(std::make_pair(table.typeinfo->columnsdef[idx].type, cell));
                    }
                AddCString(&insert_string,") VALUES (");
                for (unsigned idx = 0; idx < colcount; ++idx)
                {
                        if (idx != 0)
                            AddCString(&insert_string,", ");
                        AddCString(&insert_string,"?");
                }
                AddCString(&insert_string,")");

                DEBUGPRINT("Insert query: " << ConvertToUTF8(insert_string));

                if (charset != Blex::Charsets::Unicode)
                {
                        std::string insert_utf8 = ConvertToUTF8(insert_string);
                        std::string insert_ansi;
                        Blex::ConvertUTF8ToCharset(insert_utf8.c_str(), insert_utf8.c_str() + insert_utf8.size(), charset, &insert_ansi);
                        CheckRetval(insert_handle,
                                SQLPrepareA(insert_handle, reinterpret_cast<SQLCHAR*>(&insert_ansi[0]), insert_ansi.size()), "Error preparing insert");
                }
                else
                    CheckRetval(insert_handle,
                            SQLPrepareW(insert_handle, reinterpret_cast<SQLWCHAR*>(&insert_string[0]), insert_string.size()), "Error preparing insert");
                ResultSet resultset(vm, capabilities, SQL_NULL_HANDLE, charset, workarounds);
                CheckRetval(insert_handle, resultset.ExecuteStatement(insert_handle, params), "Could not execute insert");
        }
        catch (std::exception &)
        {
                SQLFreeHandle(SQL_HANDLE_STMT, insert_handle);
                throw;
        }
//        DEBUGPRINT("Freeing insert handle " << (void*)insert_handle);
        SQLFreeHandle(SQL_HANDLE_STMT, insert_handle);
}

void ODBCTransactionDriver::Commit()
{
        ODBCProviderContextData *context = static_cast<ODBCProviderContextData *>(HSVM_GetContext(hsvm,ODBCProviderContextId,true));

        SQLRETURN retval;
        retval = SQLEndTran(SQL_HANDLE_DBC, hdbc, SQL_COMMIT);
        if (IsError(retval))
            ThrowDBError("Error committing ODBC transaction: " +  GetDiagnostics(SQL_HANDLE_DBC, hdbc));

        retval = SQLDisconnect(hdbc);
        if (IsError(retval))
            ThrowDBError("Could not disconnect : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));

        retval = SQLFreeHandle(SQL_HANDLE_DBC, hdbc);
        if (IsError(retval))
            ThrowDBError("Could not de-allocate a connection handle : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));

        hdbc = SQL_NULL_HANDLE;
}

void ODBCTransactionDriver::Rollback()
{
        ODBCProviderContextData *context = static_cast<ODBCProviderContextData *>(HSVM_GetContext(hsvm,ODBCProviderContextId,true));

        SQLRETURN retval;
        retval = SQLEndTran(SQL_HANDLE_DBC, hdbc, SQL_ROLLBACK);
        if (IsError(retval))
            ThrowDBError("Error rolling back ODBC transaction: " +  GetDiagnostics(SQL_HANDLE_DBC, hdbc));

        retval = SQLDisconnect(hdbc);
        if (IsError(retval))
            ThrowDBError("Could not disconnect : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));

        retval = SQLFreeHandle(SQL_HANDLE_DBC, hdbc);
        if (IsError(retval))
            ThrowDBError("Could not de-allocate a connection handle : " + GetDiagnostics(SQL_HANDLE_DBC, context->henv));

        hdbc = SQL_NULL_HANDLE;
}

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript



