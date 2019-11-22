//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include "hsvm_loopbackdbprovider.h"

//---------------------------------------------------------------------------
//
// This library contains a loopback database driver
//
//---------------------------------------------------------------------------

namespace HareScript
{
namespace SQLLib
{
namespace LoopbackDB
{

/** There exists only one copy of the context in a VM session; it is used to
    administrate session-whide stuff */
struct ContextData
{
        /// List of active transactions
        std::set< LoopbackDBTransactionDriver * > translist;
};

/** Typedef for quick access to the context */
typedef Blex::Context<ContextData, 18, void> DBProviderContext;


LoopbackDBTransactionDriver::LoopbackDBTransactionDriver(VirtualMachine *vm, VarId _obj, DBDescription const &_description)
: DatabaseTransactionDriverInterface(vm)
{
        obj = HSVM_AllocateVariable(*vm);
        HSVM_CopyFrom(*vm, obj, _obj);
        description = _description;
}

void LoopbackDBTransactionDriver::SetConditionString(VarId target, DBConditionCode::_type condition)
{
        switch (condition)
        {
        case DBConditionCode::Less:         HSVM_StringSetSTD(*vm, target, "<"); break;
        case DBConditionCode::LessEqual:    HSVM_StringSetSTD(*vm, target, "<="); break;
        case DBConditionCode::Equal:        HSVM_StringSetSTD(*vm, target, "="); break;
        case DBConditionCode::Bigger:       HSVM_StringSetSTD(*vm, target, ">"); break;
        case DBConditionCode::BiggerEqual:  HSVM_StringSetSTD(*vm, target, ">="); break;
        case DBConditionCode::UnEqual:      HSVM_StringSetSTD(*vm, target, "!="); break;
        case DBConditionCode::Like:         HSVM_StringSetSTD(*vm, target, "LIKE"); break;
        case DBConditionCode::In:           HSVM_StringSetSTD(*vm, target, "IN"); break;
        }
}

void LoopbackDBTransactionDriver::UpdateDBQueryForConditions(DatabaseQuery &query)
{
        for (std::vector< SingleCondition >::const_iterator it = query.singleconditions.begin(), end = query.singleconditions.end(); it != end; ++it)
        {
                query.tables[it->table].columns[it->column].fase |= Fases::Fase1 | Fases::Recheck;
        }
        for (std::vector< JoinCondition >::const_iterator it = query.joinconditions.begin(), end = query.joinconditions.end(); it != end; ++it)
        {
                query.tables[it->table1].columns[it->column1].fase |= Fases::Fase1 | Fases::Recheck;
                query.tables[it->table2].columns[it->column2].fase |= Fases::Fase1 | Fases::Recheck;
        }
}

void LoopbackDBTransactionDriver::TranslateDBQuery(DatabaseQuery const &query, VarId target)
{
        HSVM_SetDefault(*vm, target, HSVM_VAR_Record);

//        HSVM_ColumnId col_query_limit = HSVM_GetColumnId(*vm, "QUERY_LIMIT");
//        HSVM_ColumnId col_max_block_rows = HSVM_GetColumnId(*vm, "MAXBLOCKROWS");
//        HSVM_ColumnId col_table_sources = HSVM_GetColumnId(*vm, "TABLESOURCES");
//        HSVM_ColumnId col_single_conditions = HSVM_GetColumnId(*vm, "SINGLECONDITIONS");
//        HSVM_ColumnId col_join_conditions = HSVM_GetColumnId(*vm, "JOINCONDITIONS");
//        HSVM_ColumnId col_name = HSVM_GetColumnId(*vm, "NAME");
//        HSVM_ColumnId col_columns = HSVM_GetColumnId(*vm, "COLUMNS");
//        HSVM_ColumnId col_dbase_name = HSVM_GetColumnId(*vm, "DBASE_NAME");
//        HSVM_ColumnId col_flags = HSVM_GetColumnId(*vm, "FLAGS");
//        HSVM_ColumnId col_type = HSVM_GetColumnId(*vm, "TYPE");
//        HSVM_ColumnId col_fase = HSVM_GetColumnId(*vm, "FASE");
//        HSVM_ColumnId col_nulldefault = HSVM_GetColumnId(*vm, "NULLDEFAULT");
//        HSVM_ColumnId col_nulldefault_valid = HSVM_GetColumnId(*vm, "NULLDEFAULT_VALID");
//        HSVM_ColumnId col_handled = HSVM_GetColumnId(*vm, "HANDLED");
//        HSVM_ColumnId col_tableid = HSVM_GetColumnId(*vm, "TABLEID");
//        HSVM_ColumnId col_columnid = HSVM_GetColumnId(*vm, "COLUMNID");
//        HSVM_ColumnId col_columnname = HSVM_GetColumnId(*vm, "COLUMNNAME");
//        HSVM_ColumnId col_condition = HSVM_GetColumnId(*vm, "CONDITION");
//        HSVM_ColumnId col_value = HSVM_GetColumnId(*vm, "VALUE");
//        HSVM_ColumnId col_casesensitive = HSVM_GetColumnId(*vm, "CASESENSITIVE");
//        HSVM_ColumnId col_match_null = HSVM_GetColumnId(*vm, "MATCH_NULL");
//        HSVM_ColumnId col_table1_id = HSVM_GetColumnId(*vm, "TABLE1_ID");
//        HSVM_ColumnId col_t1_columnid = HSVM_GetColumnId(*vm, "T1_COLUMNID");
//        HSVM_ColumnId col_t1_columnname = HSVM_GetColumnId(*vm, "T1_COLUMNNAME");
//        HSVM_ColumnId col_table2_id = HSVM_GetColumnId(*vm, "TABLE2_ID");
//        HSVM_ColumnId col_t2_columnid = HSVM_GetColumnId(*vm, "T2_COLUMNID");
//        HSVM_ColumnId col_t2_columnname = HSVM_GetColumnId(*vm, "T2_COLUMNNAME");
//        HSVM_ColumnId col_match_double_null = HSVM_GetColumnId(*vm, "MATCH_DOUBLE_NULL");

        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, target, vm->cn_cache.col_query_limit), query.limit);
        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, target, vm->cn_cache.col_max_block_rows), query.maxblockrows);

        VarId table_sources = HSVM_RecordCreate(*vm, target, vm->cn_cache.col_table_sources);
        VarId single_conditions = HSVM_RecordCreate(*vm, target, vm->cn_cache.col_single_conditions);
        VarId join_conditions = HSVM_RecordCreate(*vm, target, vm->cn_cache.col_join_conditions);

        HSVM_SetDefault(*vm, table_sources, HSVM_VAR_RecordArray);
        for (DatabaseQuery::TableSources::const_iterator it = query.tables.begin(), end = query.tables.end(); it != end; ++it)
        {
                VarId table_source = HSVM_ArrayAppend(*vm, table_sources);
                HSVM_SetDefault(*vm, table_source, HSVM_VAR_Record);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, table_source, vm->cn_cache.col_name), it->name);

                VarId columns = HSVM_RecordCreate(*vm, table_source, vm->cn_cache.col_columns);
                HSVM_SetDefault(*vm, columns, HSVM_VAR_RecordArray);
                unsigned idx = 0;
                for (auto it2 = it->columns.begin(), end2 = it->columns.end(); it2 != end2; ++it2, ++idx)
                {
                        DBTypeInfo::Column const &coltypeinfo = it->typeinfo->columnsdef[idx];

                        VarId column = HSVM_ArrayAppend(*vm, columns);
                        HSVM_SetDefault(*vm, column, HSVM_VAR_Record);

                        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, column, vm->cn_cache.col_name), coltypeinfo.name);
                        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, column, vm->cn_cache.col_dbase_name), coltypeinfo.dbase_name);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, column, vm->cn_cache.col_type), coltypeinfo.type);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, column, vm->cn_cache.col_flags), coltypeinfo.flags);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, column, vm->cn_cache.col_fase), it2->fase);
                        VarId nulldefault = HSVM_RecordCreate(*vm, column, vm->cn_cache.col_nulldefault);
                        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, column, vm->cn_cache.col_nulldefault_valid), it2->nulldefault != 0);
                        if (it2->nulldefault)
                            HSVM_CopyFrom(*vm, nulldefault, it2->nulldefault);
                        else
                            HSVM_BooleanSet(*vm, nulldefault, false);
                }
        }

        HSVM_SetDefault(*vm, single_conditions, HSVM_VAR_RecordArray);
        for (std::vector< SingleCondition >::const_iterator it = query.singleconditions.begin(), end = query.singleconditions.end(); it != end; ++it)
        {
                VarId single = HSVM_ArrayAppend(*vm, single_conditions);
                HSVM_SetDefault(*vm, single, HSVM_VAR_Record);

                char colname[HSVM_MaxColumnName];
                HSVM_GetColumnName(*vm, it->columnid, colname);

                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_single), true);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_handled), it->handled);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_tableid), it->table);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_columnid), it->column);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_columnname), colname);
                SetConditionString(HSVM_RecordCreate(*vm, single, vm->cn_cache.col_condition), it->condition);
                HSVM_CopyFrom(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_value), it->value);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_casesensitive), it->casesensitive);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, single, vm->cn_cache.col_match_null), it->match_null);
        }

        HSVM_SetDefault(*vm, join_conditions, HSVM_VAR_RecordArray);
        for (std::vector< JoinCondition >::const_iterator it = query.joinconditions.begin(), end = query.joinconditions.end(); it != end; ++it)
        {
                VarId join = HSVM_ArrayAppend(*vm, join_conditions);
                HSVM_SetDefault(*vm, join, HSVM_VAR_Record);

                char colname1[HSVM_MaxColumnName], colname2[HSVM_MaxColumnName];
                HSVM_GetColumnName(*vm, it->columnid1, colname1);
                HSVM_GetColumnName(*vm, it->columnid2, colname2);

                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_single), false);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_handled), it->handled);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_table1_id), it->table1);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_t1_columnid), it->column1);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_t1_columnname), colname1);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_table2_id), it->table2);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_t2_columnid), it->column2);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_t2_columnname), colname2);
                SetConditionString(HSVM_RecordCreate(*vm, join, vm->cn_cache.col_condition), it->condition);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_casesensitive), it->casesensitive);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, join, vm->cn_cache.col_match_double_null), it->match_double_null);
        }
}

void LoopbackDBTransactionDriver::Unregister(SQLSupport &sqlsupport, LoopbackDBTransactionDriver *trans)
{
        sqlsupport.DeleteTransaction(trans->sqllib_transid);
}

LoopbackDBTransactionDriver::CursorData & LoopbackDBTransactionDriver::GetCursor(int32_t cursorid)
{
        std::map< int32_t, CursorData >::iterator it = cursors.find(cursorid);
        if (it == cursors.end())
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB got an unknown cursor id");

        return it->second;
}

void LoopbackDBTransactionDriver::ExecuteInsert(DatabaseQuery const &query, VarId newrecord)
{
        HSVM_OpenFunctionCall(*vm, 2);

        TranslateDBQuery(query, HSVM_CallParam(*vm, 0));
        HSVM_CopyFrom(*vm, HSVM_CallParam(*vm, 1), newrecord);

        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "INSERTRECORD"), true, true);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB ExecuteInsert failed");
        HSVM_CloseFunctionCall(*vm);
}

LoopbackDBTransactionDriver::CursorId LoopbackDBTransactionDriver::OpenCursor(DatabaseQuery &query, CursorType cursortype)
{
        HSVM_OpenFunctionCall(*vm, 2);

        UpdateDBQueryForConditions(query);
        TranslateDBQuery(query, HSVM_CallParam(*vm, 0));
        switch (cursortype)
        {
        case Select:    HSVM_StringSetSTD(*vm, HSVM_CallParam(*vm, 1), "SELECT"); break;
        case Delete:    HSVM_StringSetSTD(*vm, HSVM_CallParam(*vm, 1), "DELETE"); break;
        case Update:    HSVM_StringSetSTD(*vm, HSVM_CallParam(*vm, 1), "UPDATE"); break;
        }

        int32_t id = cursors.empty() ? 1 : cursors.rbegin()->first + 1;
        HSVM_VariableId copy = HSVM_AllocateVariable(*vm);

        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "OPENCURSOR"), true, false);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB OpenCursor failed to return a cursor");

        HSVM_CopyFrom(*vm, copy, res);

        CursorData data;
        data.obj = copy;
        data.tablecount = query.tables.size();

        HSVM_CloseFunctionCall(*vm);
        cursors.insert(std::make_pair(id, data));
        return id;
}

unsigned LoopbackDBTransactionDriver::RetrieveNextBlock(CursorId id, VarId recarr)
{
        CursorData &cursordata = GetCursor(id);
        HSVM_VariableId obj = cursordata.obj;

        HSVM_OpenFunctionCall(*vm, 0);
        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "RETRIEVENEXTBLOCK"), true, true);
        if (!res)
            return 0;
//            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB RetrieveNextBlock failed");
        HSVM_CloseFunctionCall(*vm);

        HSVM_VariableId block = HSVM_ObjectMemberRef(*vm, obj, HSVM_GetColumnId(*vm, "PVT_CURRENTBLOCK"), true);
        if (!block)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB object has no member 'PVT_CURRENT_BLOCK'");
        HSVM_CopyFrom(*vm, recarr, block);

        int32_t rowcount = HSVM_ArrayLength(*vm, recarr) / cursordata.tablecount;
        if (rowcount > 1)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB RetrieveNextBlock returned more than one row");

        return rowcount;
}

void LoopbackDBTransactionDriver::RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< unsigned > const &rowlist, bool /*is_last_fase2_req_for_block*/)
{
        HSVM_VariableId obj = GetCursor(id).obj;

        HSVM_VariableId block = HSVM_ObjectMemberRef(*vm, obj, HSVM_GetColumnId(*vm, "PVT_CURRENTBLOCK"), true);
        if (!block)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB object has no member 'PVT_CURRENT_BLOCK'");
        HSVM_CopyFrom(*vm, block, recarr);

        HSVM_OpenFunctionCall(*vm, 1);
        HSVM_VariableId rowlistvar = HSVM_CallParam(*vm, 0);
        HSVM_SetDefault(*vm, rowlistvar, HSVM_VAR_IntegerArray);
        for (auto itr: rowlist)
            HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, rowlistvar), itr);
//        HSVM_BooleanSet(*vm, HSVM_CallParam(*vm, 1), is_last_fase2_req_for_block);

        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "GETFASE2DATA"), true, true);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB GetFase2Data failed");
        HSVM_CloseFunctionCall(*vm);

        HSVM_CopyFrom(*vm, recarr, block);
}

LoopbackDBTransactionDriver::LockResult LoopbackDBTransactionDriver::LockRow(CursorId id, VarId /*recarr*/, unsigned row)
{
        HSVM_VariableId obj = GetCursor(id).obj;

        HSVM_OpenFunctionCall(*vm, 1);
        HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), row);
        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "LOCKROW"), true, false);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB LockRow failed");

        std::string result = HSVM_StringGetSTD(*vm, res);
        HSVM_CloseFunctionCall(*vm);

        // FIXME: is it necessary to copy pvt_current_block when result == changed??

        if (result == "REMOVED")
            return Removed;
        else if (result == "UNCHANGED")
            return Unchanged;
        else if (result == "CHANGED")
            return Changed;
        else
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB illegal result for LockRow: '" + result + "'");
}


void LoopbackDBTransactionDriver::UnlockRow(CursorId id, unsigned row)
{
        HSVM_VariableId obj = GetCursor(id).obj;

        HSVM_OpenFunctionCall(*vm, 1);
        HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), row);
        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "UNLOCKROW"), true, true);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB UnlockRow failed");
        HSVM_CloseFunctionCall(*vm);
}


void LoopbackDBTransactionDriver::DeleteRecord(CursorId id, unsigned row)
{
        HSVM_VariableId obj = GetCursor(id).obj;

        HSVM_OpenFunctionCall(*vm, 1);
        HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), row);
        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "DELETERECORD"), true, true);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB DeleteRecord failed");
        HSVM_CloseFunctionCall(*vm);
}


void LoopbackDBTransactionDriver::UpdateRecord(CursorId id, unsigned row, VarId newfields)
{
        HSVM_VariableId obj = GetCursor(id).obj;

        HSVM_OpenFunctionCall(*vm, 2);
        HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 0), row);
        HSVM_CopyFrom(*vm, HSVM_CallParam(*vm, 1), newfields);
        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "UPDATERECORD"), true, true);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB UpdateRecord failed");
        HSVM_CloseFunctionCall(*vm);
}

void LoopbackDBTransactionDriver::CloseCursor(CursorId id)
{
        HSVM_VariableId obj = GetCursor(id).obj;

        HSVM_OpenFunctionCall(*vm, 0);
        HSVM_VariableId res = HSVM_CallObjectMethod(*vm, obj, HSVM_GetColumnId(*vm, "CLOSE"), true, true);
        if (!res)
            throw VMRuntimeError (Error::DatabaseException, "Database error: LoopbackDB Close failed");
        HSVM_CloseFunctionCall(*vm);

        cursors.erase(id);
}

LoopbackDBTransactionDriver * IsLoopbackDBTransaction(VirtualMachine *vm, DatabaseTransactionDriverInterface *trans)
{
        DBProviderContext context(vm->GetContextKeeper());

        if (std::find(context->translist.begin(), context->translist.end(), trans) == context->translist.end())
            return 0;
        else
            return static_cast<LoopbackDBTransactionDriver *>(trans);
}


void RegisterTransaction(VarId id_set, VirtualMachine *vm)
{
        DBDescription description;
        description.supports_block_cursors = true;
        description.supports_single = true;
        description.supports_data_modify = true;
        description.supports_nulls = false;
        description.needs_locking_and_recheck = true;
        description.needs_uppercase_names = true;
        description.max_joined_tables = 32;

        std::unique_ptr< LoopbackDBTransactionDriver >driver(new LoopbackDBTransactionDriver(vm, HSVM_Arg(0), description));

        DBProviderContext context(vm->GetContextKeeper());
        context->translist.insert(driver.get());

        int32_t transid = vm->GetSQLSupport().RegisterTransaction(std::move(driver), 0);
//        HSVM_ColumnId col_pvt_transid = HSVM_GetColumnId(*vm, "PVT_TRANSID");

//        HSVM_VariableId pvt_transid = HSVM_ObjectMemberRef(*vm, HSVM_Arg(0), col_pvt_transid, true);
//        if (pvt_transid)
//            HSVM_IntegerSet(*vm, pvt_transid, transid);
        HSVM_IntegerSet(*vm, id_set, transid);
}

void UnregisterTransaction(VirtualMachine *vm)
{
        int32_t transid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        LoopbackDBTransactionDriver *driver = IsLoopbackDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Transaction does not exist");

        LoopbackDBTransactionDriver::Unregister(vm->GetSQLSupport(), driver);
}


void Register(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_LBDB_REGISTER::I:O", RegisterTransaction));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_LBDB_UNREGISTER:::I", UnregisterTransaction));
        DBProviderContext::Register(creg);
}
} // End of namespace LoopbackDB
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------

