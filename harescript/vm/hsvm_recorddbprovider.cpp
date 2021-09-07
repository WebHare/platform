//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

#include <iostream>

#include "hsvm_context.h"
#include "hsvm_sqllib.h"
#include "hsvm_sqlinterface.h"
#include "errors.h"
#include "baselibs.h"
#include "hsvm_recorddbprovider.h"

namespace HareScript
{
namespace SQLLib
{
namespace RecordDB
{

/** There exists only one copy of the context in a VM session; it is used to
    administrate session-whide stuff */
struct ContextData
{
        /// List of active transactions
        std::set< RecordDBTransactionDriver * > translist;
};

/** Typedef for quick access to the context */
typedef Blex::Context<ContextData, 9, void> DBProviderContext;

RecordDBTransactionDriver::RecordDBTransactionDriver(VirtualMachine *vm)
: DatabaseTransactionDriverInterface(vm)
{
        // Fill the description structure
        description.supports_block_cursors = true;
        description.max_joined_tables = 1;
        description.supports_single = false;
        description.supports_data_modify = true;
        description.supports_nulls = false;
        description.needs_locking_and_recheck = false;
        description.fase2_locks_implicitly = false;
        description.needs_uppercase_names = true;
}

RecordDBTransactionDriver::~RecordDBTransactionDriver()
{
        // Release all tables that are in memory
        for (TableStorage::iterator it = tables.begin(); it != tables.end(); ++it)
            vm->GetStackMachine().DeleteHeapVariable(it->second.recarr);
}

RecordDBTransactionDriver::TableData & RecordDBTransactionDriver::FindTable(std::string name)
{
        Blex::ToUppercase(name.begin(), name.end());

        TableStorage::iterator table_it = tables.find(name);
        if (table_it == tables.end())
            throw VMRuntimeError(Error::DatabaseException, "Database error: Table " + name + " does not exist");

        return table_it->second;
}

void RecordDBTransactionDriver::CheckTypeInfo(DBTypeInfo const *typeinfo)
{
        if (typeinfo)
        {
                for (auto it = typeinfo->columnsdef.begin(); it != typeinfo->columnsdef.end(); ++it)
                    if (Blex::StrCaseCompare(it->name, it->dbase_name) != 0)
                        throw VMRuntimeError(Error::InternalError, "Record DB provider cannot handle table column renames");
        }
}

namespace
{
unsigned GetBound(StackMachine &stackm, VarId array, ColumnNameId column, VarId cmpelt, bool casesensitive, bool upper_bound)
{
        unsigned low = 0, limit = stackm.ArraySize(array);
        while (limit != low)
        {
                unsigned mid = (limit + low) / 2;

                VarId rec = stackm.ArrayElementGet(array, mid);
                VarId elt = stackm.RecordCellGetByName(rec, column);
                int32_t cmp = stackm.Compare(elt, cmpelt, casesensitive);
                if (cmp < 0 || (upper_bound && cmp == 0))
                    low = mid + 1;
                else
                    limit = mid;
        }
        return limit;
}

} // End of anonymous namespace

void RecordDBTransactionDriver::ExecuteInsert(DatabaseQuery const &query, VarId newrecord)
{
        StackMachine &stackm = vm->GetStackMachine();

        CheckTypeInfo(query.tables[0].typeinfo);

        // Retrieve the table (always only one table in this db provider)
        TableData &tabledata = FindTable(query.tables[0].name);
        if (tabledata.frozen)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Cannot modify a frozen table");

        VarId insert_rec;
        if (tabledata.sort_column)
        {
                VarId new_elt = stackm.RecordCellGetByName(newrecord, tabledata.sort_column);

                unsigned location = GetBound(stackm, tabledata.recarr, tabledata.sort_column, new_elt, tabledata.sort_casesensitive, true);
                insert_rec = stackm.ArrayElementInsert(tabledata.recarr, location);
        }
        else
        {
                insert_rec = stackm.ArrayElementAppend(tabledata.recarr);
        }
        stackm.MoveFrom(insert_rec, newrecord);
}

RecordDBTransactionDriver::CursorId RecordDBTransactionDriver::OpenCursor(DatabaseQuery &query, CursorType cursortype)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Create a new SQLQueryData, and an unique id
        CursorId id = queries.Set(SQLQueryData());
        SQLQueryData &querydata = *queries.Get(id);

        CheckTypeInfo(query.tables[0].typeinfo);

        // Retrieve the table (always only one table in this db provider)
        TableData &tabledata = FindTable(query.tables[0].name);

        querydata.table = tabledata.recarr;
        if (cursortype == Select)
            querydata.current_table = querydata.table;
        else
        {
                if (tabledata.frozen)
                    throw VMRuntimeError(Error::DatabaseException, "Database error: Cannot modify a frozen table");

                // Make a copy of the stored array
                querydata.current_table = stackm.NewHeapVariable();
                stackm.CopyFrom(querydata.current_table, querydata.table);
        }

        // Set result start to whole array
        querydata.results_start = 0;
        querydata.results_end = stackm.ArraySize(querydata.current_table);

//        std::cout << "RDB: Query over " << (querydata.results_end - querydata.results_start) << " records" << std::endl;

        // Look in query for conditions on sorted column
        for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
        {
                if (it->columnid == tabledata.sort_column && it->casesensitive == tabledata.sort_casesensitive)
                {
                        unsigned eq_start = GetBound(stackm, tabledata.recarr, tabledata.sort_column, it->value, tabledata.sort_casesensitive, false);
                        unsigned eq_end = GetBound(stackm, tabledata.recarr, tabledata.sort_column, it->value, tabledata.sort_casesensitive, true);

                        it->handled = true;
                        switch (it->condition)
                        {
                        case DBConditionCode::Less:
                                querydata.results_end = eq_start;
                                break;
                        case DBConditionCode::LessEqual:
                                querydata.results_end = eq_end;
                                break;
                        case DBConditionCode::Equal:
                                querydata.results_start = eq_start;
                                querydata.results_end = eq_end;
                                break;
                        case DBConditionCode::BiggerEqual:
                                querydata.results_start = eq_start;
                                break;
                        case DBConditionCode::Bigger:
                                querydata.results_start = eq_end;
                                break;
                        default:
                            it->handled = false;
                        }
//                        if (it->handled)
//                            std::cout << "RDB: Limited to " << (querydata.results_end - querydata.results_start) << " records" << std::endl;
                }
        }

        // Set block ptrs to their initial, invalid values; RetrieveNextBlock must be called for the first block

        querydata.block_start = querydata.results_start;
        querydata.block_end = querydata.results_start;

        querydata.cursortype = cursortype;
        querydata.max_block_size = query.maxblockrows;

        return id;
}

unsigned RecordDBTransactionDriver::RetrieveNextBlock(CursorId id, VarId recarr)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Retrieve the query data for this cursor
        SQLQueryData &querydata = *queries.Get(id);

        // Set the block pointers to the next block
        querydata.block_start = querydata.block_end;
        querydata.block_end = std::min<signed>(querydata.block_start + querydata.max_block_size, querydata.results_end);

        // Determine number of rows in the current block
        unsigned retrieve_count = querydata.block_end - querydata.block_start;

        // Copy all the elements in the current block to the block variable
        stackm.ArrayInitialize(recarr, retrieve_count, VariableTypes::RecordArray);
        for (unsigned idx = 0; idx < retrieve_count; ++idx)
            stackm.ArrayElementCopy(querydata.current_table, querydata.block_start + idx, stackm.ArrayElementRef(recarr, idx));

        // Return number of results returned
        return retrieve_count;
}

void RecordDBTransactionDriver::RetrieveFase2Records(CursorId /*id*/, VarId /*recarr*/, Blex::PodVector< Fase2RetrieveRow > &/*rowlist*/, bool/*last_fase2_req_in_block*/)
{
        // Ignored; this db provider always returns all columns
}

LockResult RecordDBTransactionDriver::LockRow(CursorId /*id*/, VarId /*recarr*/, unsigned /*row*/)
{
        // Ignored; this db provider does not need locking
        return LockResult::Unchanged;
}

void RecordDBTransactionDriver::UnlockRow(CursorId /*id*/, unsigned /*row*/)
{
        // Ignored; this db provider does not need locking
}

void RecordDBTransactionDriver::DeleteRecord(CursorId id, unsigned row)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Retrieve the query data for this cursor
        SQLQueryData &querydata = *queries.Get(id);

        // Flag the record as NULL; don't copy this row back later
        stackm.RecordInitializeNull(stackm.ArrayElementRef(querydata.current_table, querydata.block_start + row));
}
void RecordDBTransactionDriver::UpdateRecord(CursorId id, unsigned row, VarId newfields)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Retrieve the query data for this cursor
        SQLQueryData &querydata = *queries.Get(id);

        unsigned column_count = stackm.RecordSize(newfields);
        VarId rec = stackm.ArrayElementRef(querydata.current_table, querydata.block_start + row);
        for (unsigned idx = 0; idx < column_count; ++idx)
        {
                // Retrieve the name of the column
                ColumnNameId name = stackm.RecordCellNameByNr(newfields, idx);

                // Overwrite the old data; no type changing allowed
                VarId cell = stackm.RecordCellRefByName(rec, name);
                if (cell) // Ignore non-existing stuff
                {
                        VariableTypes::Type oldtype = stackm.GetType(cell);
                        stackm.CopyFrom(cell, stackm.RecordCellRefByName(newfields, name));
                        stackm.CastTo(cell, oldtype);
                }
        }
}

void RecordDBTransactionDriver::CloseCursor(CursorId id)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Retrieve the query data for this cursor
        SQLQueryData &querydata = *queries.Get(id);

        switch (querydata.cursortype)
        {
        case Delete:
                {
                        // Copy all non-null records back
                        stackm.ArrayInitialize(querydata.table, 0, VariableTypes::RecordArray);
                        unsigned len = stackm.ArraySize(querydata.current_table);

                        for (unsigned idx = 0; idx < len; ++idx)
                        {
                                VarId rec = stackm.ArrayElementRef(querydata.current_table, idx);
                                if (!stackm.RecordNull(rec))
                                    stackm.MoveFrom(stackm.ArrayElementAppend(querydata.table), rec);
                        }
                        stackm.DeleteHeapVariable(querydata.current_table);
                } break;
        case Update:
                {
                        stackm.MoveFrom(querydata.table, querydata.current_table);
                        stackm.DeleteHeapVariable(querydata.current_table);
                } break;
        default: ;
        }
}

void RecordDBTransactionDriver::CreateTable(std::string const &_name)
{
        std::string name = _name;
        Blex::ToUppercase(name.begin(), name.end());

        TableData &table = tables[name];
        if (table.recarr)
            throw VMRuntimeError (Error::DatabaseException, "Database error: table " + name + " already exists");

        table.recarr = vm->GetStackMachine().NewHeapVariable();
        vm->GetStackMachine().ArrayInitialize(table.recarr, 0, VariableTypes::RecordArray);

}

void RecordDBTransactionDriver::SetTableSortOrder(std::string const &_name, std::string const &column, bool casesensitive)
{
        std::string name = _name;
        Blex::ToUppercase(name.begin(), name.end());

        TableData &table = tables[name];
        if (!table.recarr)
            throw VMRuntimeError (Error::DatabaseException, "Database error: table " + name + " does not exist");

        if (vm->GetStackMachine().ArraySize(table.recarr) != 0)
            throw VMRuntimeError (Error::DatabaseException, "Database error: sort order can only be set on empty table");

        table.sort_column = vm->columnnamemapper.GetMapping(column);
        table.sort_casesensitive = casesensitive;
}

void RecordDBTransactionDriver::FreezeTable(std::string const &_name)
{
        std::string name = _name;
        Blex::ToUppercase(name.begin(), name.end());

        TableData &table = tables[name];
        if (!table.recarr)
            throw VMRuntimeError (Error::DatabaseException, "Database error: table " + name + " does not exist");

        table.frozen = true;
}

// -----------------------------------------------------------------------------
//
//   Transaction driver extra control functions
//
//
RecordDBTransactionDriver * IsRecordDBTransaction(VirtualMachine *vm, DatabaseTransactionDriverInterface *trans)
{
        DBProviderContext context(vm->GetContextKeeper());

        if (std::find(context->translist.begin(), context->translist.end(), trans) == context->translist.end())
            return 0;
        else
            return static_cast<RecordDBTransactionDriver *>(trans);
}

void NewTransaction (VarId id_set, VirtualMachine *vm)
{
        std::unique_ptr< RecordDBTransactionDriver > driver(new RecordDBTransactionDriver(vm));

        DBProviderContext context(vm->GetContextKeeper());
        context->translist.insert(driver.get());

        vm->GetStackMachine().SetInteger(id_set, vm->GetSQLSupport().RegisterTransaction(std::move(driver)));
}

void CreateTable (VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Get the transaction
        unsigned transid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        RecordDBTransactionDriver *driver = IsRecordDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            throw VMRuntimeError (Error::DatabaseException, "Database error: creating table in non-recorddb transaction");

        driver->CreateTable(stackm.GetSTLString(HSVM_Arg(1)));
}

void SetTableSortOrder (VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Get the transaction
        unsigned transid = stackm.GetInteger(HSVM_Arg(0));
        RecordDBTransactionDriver *driver = IsRecordDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            throw VMRuntimeError (Error::DatabaseException, "Database error: creating table in non-recorddb transaction");

        driver->SetTableSortOrder(stackm.GetSTLString(HSVM_Arg(1)), stackm.GetSTLString(HSVM_Arg(2)), stackm.GetBoolean(HSVM_Arg(3)));
}

void FreezeTable (VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        // Get the transaction
        unsigned transid = stackm.GetInteger(HSVM_Arg(0));
        RecordDBTransactionDriver *driver = IsRecordDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            throw VMRuntimeError (Error::DatabaseException, "Database error: creating table in non-recorddb transaction");

        driver->FreezeTable(stackm.GetSTLString(HSVM_Arg(1)));
}

// -----------------------------------------------------------------------------
//
//   Transaction driver registration and initialisation
//
//

void Register(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_RDB_NEWTRANSACTION::I:", NewTransaction));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_RDB_CREATETABLE:::IS", CreateTable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_RDB_SETTABLESORTORDER:::ISSB", SetTableSortOrder));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_RDB_FREEZETABLE:::IS", FreezeTable));
        DBProviderContext::Register(creg);
}

} // End of namespace WHDB
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------










