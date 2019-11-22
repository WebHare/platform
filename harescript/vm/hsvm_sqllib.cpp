//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/context.h>
#include <blex/logfile.h>
#include "hsvm_sqllib.h"
#include "hsvm_sqlqueries.h"
#include "hsvm_idmapstorage.h"
#include "hsvm_context.h"
#include "hsvm_sqlinterface.h"
#include "hsvm_sqlqueries.h"

// Show registration and deletion of transactions
//#define SHOW_TRANSACTIONS
//#define SHOW_SQLLIBCALLS

#ifdef SHOW_TRANSACTIONS
 #define TRANS_PRINT(x) DEBUGPRINT(x)
#else
 #define TRANS_PRINT(x)
#endif

#ifdef SHOW_SQLLIBCALLS
 #define CALL_PRINT(x) DEBUGPRINT(x)
 #define CALL_ONLY(x) x
#else
 #define CALL_PRINT(x)
 #define CALL_ONLY(x)
#endif

namespace HareScript
{
namespace SQLLib
{

struct SQLContextData
{
        typedef IdMapStorage< std::unique_ptr< DatabaseTransactionDriverInterface > > TransactionsStorage;
        TransactionsStorage transactions;

        typedef IdMapStorage< HSBindDef > BindingStorage;
        BindingStorage bindings;
        std::map< HSBindDef, unsigned > reverse_bindings;

        typedef IdMapStorage< OpenQuery > OpenQueryStorage;
        OpenQueryStorage openqueries;

        // For use by OpenCursor2
        std::vector<VarId> values;
        QueryDefinition query;

        ~SQLContextData();

        unsigned SetBinding(HSBindDef const &data);
        HSBindDef GetBindingInfo(unsigned table);

        /** Returns the transaction id of a given transaction. Potentially slow function.
            @param trans Transaction to find the id of
            @return Id of the transaction, 0 if not found
        */
        unsigned GetTransactionId(SQLLib::DatabaseTransactionDriverInterface *trans);
};

unsigned SQLContextData::SetBinding(HSBindDef const &data)
{
        std::map< HSBindDef, unsigned >::iterator it = reverse_bindings.find(data);
        if (it != reverse_bindings.end())
            return it->second;

        unsigned id = bindings.Set(data);
        reverse_bindings.insert(std::make_pair(data, id));

        return id;
}

HSBindDef SQLContextData::GetBindingInfo(unsigned bindid)
{
        HSBindDef *binddef = bindings.Get(bindid);

        if (!binddef)
            throw VMRuntimeError (Error::TableNotBound);

        return *binddef;
}

unsigned SQLContextData::GetTransactionId(SQLLib::DatabaseTransactionDriverInterface *trans)
{
        return trans->sqllib_transid;
}


typedef Blex::Context<SQLContextData, 1, void> SQLContext;

namespace
{
void ThrowInvalidTransaction()
{
        throw VMRuntimeError(Error::InvalidTransaction);
}

} // End of anonymous namespace


SQLContextData::~SQLContextData()
{
}

unsigned BindName(VirtualMachine *vm, unsigned transid, std::string const &name)
{
        SQLContext context(vm->GetContextKeeper());

        std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans = context->transactions.Get(transid);

        if (!trans)
            return 0;

        HSBindDef pr(name, trans->get());

        return context->SetBinding(pr);
}

/** TABLE FUNCTION HS_SQL_BindTable(INTEGER transaction, STRING tablename): binds a table to a table in a transaction
    @param tablename name of table
    @param transaction Identifier of transaction */
void HS_SQL_BindTable(VarId id_set, VirtualMachine *vm)
{
        unsigned transid = vm->GetStackMachine().GetInteger(HSVM_Arg(0));
        std::string tablename = vm->GetStackMachine().GetSTLString(HSVM_Arg(1));
        vm->GetStackMachine().SetTable(id_set, BindName(vm, transid, tablename));
}

void HS_SQL_BindSchema(VarId id_set, VirtualMachine *vm)
{
        unsigned transid = vm->GetStackMachine().GetInteger(HSVM_Arg(0));
        std::string schemaname = vm->GetStackMachine().GetSTLString(HSVM_Arg(1));
        vm->GetStackMachine().SetInteger(id_set, BindName(vm, transid, schemaname));
}

void HS_SQL_BindSchemaToTable(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());

        unsigned bindid = vm->GetStackMachine().GetInteger(HSVM_Arg(0));
        std::string tablename = vm->GetStackMachine().GetSTLString(HSVM_Arg(1));
        HSBindDef binddef = context->GetBindingInfo(bindid);
        if (binddef.dbasename.empty())
            std::swap(binddef.dbasename, tablename);
        else
            (binddef.dbasename += ".") += tablename;
        vm->GetStackMachine().SetTable(id_set, context->SetBinding(binddef));
}

void HS_SQL_GetBoundTransactionFromTable(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &stackm = vm->GetStackMachine();

        unsigned bindid = vm->GetStackMachine().GetTable(HSVM_Arg(0));
        HSBindDef *binddef = context->bindings.Get(bindid);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        if(binddef)
        {
                stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("TRANSACTION")), context->GetTransactionId(binddef->driver));
                stackm.SetSTLString(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("TABLENAME")), binddef->dbasename);
        }
//        vm->GetStackMachine().SetInteger(id_set, context->GetTransactionId(binddef.second));
}

void HS_SQL_GetBoundTransactionFromSchema(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &stackm = vm->GetStackMachine();

        unsigned bindid = vm->GetStackMachine().GetInteger(HSVM_Arg(0));
        HSBindDef *binddef = context->bindings.Get(bindid);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        if(binddef)
        {
                stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("TRANSACTION")), context->GetTransactionId(binddef->driver));
                stackm.SetSTLString(stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("SCHEMANAME")), binddef->dbasename);
        }
//        vm->GetStackMachine().SetInteger(id_set, context->GetTransactionId(binddef.second));
}

void HS_SQL_RebindTableWithTypeInfo(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());

        unsigned bindid = vm->GetStackMachine().GetTable(HSVM_Arg(0));
        int32_t typeinfo = vm->GetStackMachine().GetInteger(HSVM_Arg(1));

        if (bindid)
        {
                HSBindDef binddef = context->GetBindingInfo(bindid);
                binddef.typeinfo = typeinfo;
                vm->GetStackMachine().SetTable(id_set, context->SetBinding(binddef));
        }
        else
            HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0));
}

void HS_SQL_RebindSchemaWithTypeInfo(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());

        unsigned bindid = vm->GetStackMachine().GetInteger(HSVM_Arg(0));
        int32_t typeinfo = vm->GetStackMachine().GetInteger(HSVM_Arg(1));

        if (bindid)
        {
                HSBindDef binddef = context->GetBindingInfo(bindid);
                binddef.typeinfo = typeinfo;
                vm->GetStackMachine().SetInteger(id_set, context->SetBinding(binddef));
        }
        else
            HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0));
}

void HS_SQL_DescribeTableTypeInfo(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        unsigned bindid = vm->GetStackMachine().GetTable(HSVM_Arg(0));
        HSBindDef binddef = context->GetBindingInfo(bindid);
        if (!binddef.typeinfo)
            return;

        auto typeinfo = vm->GetSQLSupport().GetTypeInfoById(binddef.typeinfo);
        if (!typeinfo)
            return;

        DBTypeInfo::ColumnsDef const *columnlist = &typeinfo->columnsdef;
        if (typeinfo->type == VariableTypes::Schema)
        {
                // typeinfo from schema
                auto dotpos = binddef.dbasename.find_last_of('.');
                if (dotpos == std::string::npos)
                     return;

                std::string tablename = binddef.dbasename.substr(dotpos + 1);
                bool found = false;
                for (auto &itr: typeinfo->tablesdef)
                {
                        if (itr.dbase_name == tablename)
                        {
                                columnlist = &itr.columnsdef;
                                found = true;
                        }
                }
                if (!found)
                     return;
        }

        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, id_set, vm->cn_cache.col_istable), true);
        HSVM_VariableId columns = HSVM_RecordCreate(*vm, id_set, vm->cn_cache.col_columns);
        HSVM_SetDefault(*vm, columns, HSVM_VAR_RecordArray);

        Marshaller marshaller(vm, MarshalMode::SimpleOnly);
        for (auto &itr: *columnlist)
        {
                VarId var = HSVM_ArrayAppend(*vm, columns);

                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var, vm->cn_cache.col_name), itr.name);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var, vm->cn_cache.col_dbase_name), itr.dbase_name);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var, vm->cn_cache.col_type), itr.type);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var, vm->cn_cache.col_flags), (ColumnFlags::_type)(itr.flags & ~(ColumnFlags::InternalFase1 | ColumnFlags::InternalFase2 | ColumnFlags::InternalUpdates | ColumnFlags::TranslateNulls)));
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, var, vm->cn_cache.col_fase), 0);
                if ((itr.flags & ColumnFlags::TranslateNulls) && !itr.null_default.empty())
                {
                        HSVM_VariableId var_nulldefault = HSVM_RecordCreate(*vm, var, vm->cn_cache.col_nulldefault);

                        marshaller.Read(var_nulldefault, &itr.null_default[0], &itr.null_default[0] + itr.null_default.size());
                }
        }
}

// -----------------------------------------------------------------------------
//
// Direct executing queries (without further need for HareScript code)
//

/** MACRO HS_SQL_Insert(TABLE id, INTEGER typeinfo, RECORD rec);
    @param id Table to insert to
    @param rec Record containing values for new record */
void HS_SQL_Insert(VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();

        unsigned tableid = varmem.GetTable(HSVM_Arg(0));
        HSBindDef table = context->GetBindingInfo(tableid);

        unsigned typeinfoid = varmem.GetInteger(HSVM_Arg(1));
        DBTypeInfo const **typeinfo_ptr = vm->typeinfomapper.Get(typeinfoid);
        DBTypeInfo const *typeinfo = typeinfo_ptr ? *typeinfo_ptr : 0;

        if (!typeinfo)
            throw VMRuntimeError(Error::InternalError, "Missing typeinfo for expression source in SQL INSERT statement");

        bool dynamic = varmem.GetBoolean(HSVM_Arg(3));

        DatabaseQuery query;
        query.tables.push_back(TableSource(table.dbasename, typeinfo));

        if (dynamic)
        {
                TableSource &source = query.tables.back();
                for (unsigned i = 0, e = varmem.RecordSize(HSVM_Arg(2)); i < e; ++i)
                {
                        ColumnNameId nameid = varmem.RecordCellNameByNr(HSVM_Arg(2), i);
                        signed pos = source.typeinfo->FindColumn(nameid);
                        if (pos < 0) // no such column!
                        {
                                HSVM_ThrowException(*vm, ("Could not find cell '" + vm->columnnamemapper.GetReverseMapping(nameid).stl_str() + "' in the table definition").c_str());
                                return;
                        }

                        if (source.ColType(pos).flags & ColumnFlags::ReadOnly)
                            throw VMRuntimeError(Error::WriteToReadonlyColumn, vm->columnnamemapper.GetReverseMapping(nameid).stl_str());

                        source.columns[pos].fase |= Fases::Updated;
                }
        }

        if (table.driver->description.needs_uppercase_names)
            ConvertDBQueryToUppercase(query);

//        DEBUGPRINT("Inserting " << Wrap(varmem, vm->columnnamemapper, HSVM_Arg(2)));
        if (!table.driver->description.supports_data_modify)
            throw VMRuntimeError(Error::TransReadOnly);

        if (table.driver->description.supports_nulls)
        {
                InitNullHandling(vm, query);
                DeleteNullDefaults(varmem, query.tables[0], HSVM_Arg(2));
                if (table.driver->description.add_missing_default_columns)
                    AddMissingDefaultColumns(varmem, query.tables[0], HSVM_Arg(2));
        }

        table.driver->ExecuteInsert(query, HSVM_Arg(2));

        if (table.driver->description.supports_nulls)
            FreeNullDefaults(varmem, query);
}

void RunMultipleInserts(StackMachine &varmem, HSBindDef &table, DatabaseQuery &query, VarId records)
{
        unsigned rows = varmem.ArraySize(records);
        for (unsigned row = 0; row < rows; ++row)
        {
                VarId elt = varmem.ArrayElementGet(records, row);
                DeleteNullDefaults(varmem, query.tables[0], elt);
                if (table.driver->description.add_missing_default_columns)
                    AddMissingDefaultColumns(varmem, query.tables[0], elt);
        }
        table.driver->ExecuteInserts(query, records);
}

/** MACRO HS_SQL_InsertMultiple(TABLE id, INTEGER typeinfo, RECORD ARRAY recs);
    @param id Table to insert to
    @param recs Record array containing values for new records */
void HS_SQL_InsertMultiple(VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();

        unsigned tableid = varmem.GetTable(HSVM_Arg(0));
        HSBindDef table = context->GetBindingInfo(tableid);

        unsigned typeinfoid = varmem.GetInteger(HSVM_Arg(1));
        DBTypeInfo const **typeinfo_ptr = vm->typeinfomapper.Get(typeinfoid);
        DBTypeInfo const *typeinfo = typeinfo_ptr ? *typeinfo_ptr : 0;

        if (!typeinfo)
            throw VMRuntimeError(Error::InternalError, "Missing typeinfo for expression source in SQL INSERT statement");

        bool dynamic = varmem.GetBoolean(HSVM_Arg(3));

        if (!table.driver->description.supports_data_modify)
            throw VMRuntimeError(Error::TransReadOnly);

        unsigned rows = varmem.ArraySize(HSVM_Arg(2));
        if (!rows)
            return;

        DatabaseQuery query;
        query.tables.push_back(TableSource(table.dbasename, typeinfo));

        if (table.driver->description.needs_uppercase_names)
            ConvertDBQueryToUppercase(query);

        if (table.driver->description.supports_nulls)
            InitNullHandling(vm, query);

        if (!dynamic)
        {
                RunMultipleInserts(varmem, table, query, HSVM_Arg(2));
        }
        else
        {
                VarId tmp = varmem.PushVariables(1);
                varmem.InitVariable(tmp, VariableTypes::RecordArray);

                for (auto &itr: query.tables[0].columns)
                    itr.fase = Fases::None;

                TableSource &source = query.tables[0];
                for (unsigned row = 0; row < rows; ++row)
                {
                        VarId elt = varmem.ArrayElementGet(HSVM_Arg(2), row);
                        for (unsigned i = 0, e = varmem.RecordSize(elt); i < e; ++i)
                        {
                                ColumnNameId nameid = varmem.RecordCellNameByNr(elt, i);
                                signed pos = source.typeinfo->FindColumn(nameid);
                                if (pos < 0) // no such column!
                                {
                                        if (table.driver->description.supports_nulls)
                                            FreeNullDefaults(varmem, query);

                                        HSVM_ThrowException(*vm, ("Could not find cell '" + vm->columnnamemapper.GetReverseMapping(nameid).stl_str() + "' in the table definition").c_str());
                                        return;
                                }

                                if (source.ColType(pos).flags & ColumnFlags::ReadOnly)
                                    throw VMRuntimeError(Error::WriteToReadonlyColumn, vm->columnnamemapper.GetReverseMapping(nameid).stl_str());

                                // use __Scratch1 so we can see when Updates will change without messing it up for the current records
                                source.columns[pos].fase |= Fases::__Scratch1;
                        }

                        bool have_col_change = false;
                        for (auto &itr: query.tables[0].columns)
                        {
                                bool was_updated = itr.fase & Fases::Updated;
                                bool is_updated = itr.fase & Fases::__Scratch1;
                                if (was_updated != is_updated)
                                    have_col_change = true;
                        }

                        // Insert the previous records with the old Fases::Updated settings
                        // Ignore max_multiinsertrows when it is 0, never insert for the first row (when tmp is empty)
                        if ((have_col_change || varmem.ArraySize(tmp) == table.driver->description.max_multiinsertrows) && row != 0)
                        {
                                RunMultipleInserts(varmem, table, query, tmp);
                                varmem.InitVariable(tmp, VariableTypes::RecordArray);
                        }

                        // Set fase Fases::Updated for the current row (and reset __Scratch1 for the next)
                        for (auto &itr: query.tables[0].columns)
                             itr.fase = (itr.fase & Fases::__Scratch1) ? Fases::Updated : Fases::None;

                        varmem.MoveFrom(varmem.ArrayElementAppend(tmp), elt);
                }

                // At least one row must be ready for insert, insert those
                RunMultipleInserts(varmem, table, query, tmp);
        }

        if (table.driver->description.supports_nulls)
            FreeNullDefaults(varmem, query);
}

/** INTEGER FUNCTION HS_SQL_OpenCursor2(RECORD ARRAY sources, RECORD opt): Opens a query, with the given query description
    @param(record array) sources
    @param(boolean) sources.isdb
    @param(variant) sources.source
    @param(integer) sources.typeinfo
    @param(record) opt
    @param(record array) opt.conditions
    @param(boolean) opt.conditions.single
    @param(integer) opt.conditions.tablenr (single)
    @param(integer) opt.conditions.typeinfonr (single)
    @param(variant) opt.conditions.value (single)
    @param(boolean) opt.conditions.casesensitive
    @param(integer) opt.conditions.condition
    @param(integer) opt.conditions.tablenr1 (relation)
    @param(integer) opt.conditions.typeinfonr1 (relation)
    @param(integer) opt.conditions.tablenr2 (relation)
    @param(integer) opt.conditions.typeinfonr2 (relation)
    @param(boolean) opt.has_hs_code
    @param(integer) opt.querytype 0: SELECT, 1: DELETE, 2:UPDATE
    @param(integer) opt.limit (optional)
    @param(record) opt.updatecolumnlist (optional)
    @param(boolean) opt.limitblocksize
*/
void HS_SQL_OpenCursor2(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &stackm = vm->GetStackMachine();

        static std::string recarr_str = "(RECORD ARRAY)";

        QueryDefinition &query = context->query;
        std::vector< VarId > &values = context->values;

        query.Clear();
        values.clear();

        // Read the sources
        unsigned sources_count = stackm.ArraySize(HSVM_Arg(0));
        query.sources.resize(sources_count);

        for (unsigned idx = 0; idx != sources_count; ++idx)
        {
                VarId source = stackm.ArrayElementRef(HSVM_Arg(0), idx);
                int32_t typeinfo_id = stackm.GetInteger(stackm.RecordCellTypedGetByName(source, vm->cn_cache.col_typeinfo, VariableTypes::Integer, true));

                VarId var_isdb = stackm.RecordCellTypedGetByName(source, vm->cn_cache.col_isdb, VariableTypes::Boolean, true);
                if (stackm.GetBoolean(var_isdb))
                {
                        // DB table
                        int32_t tableid = stackm.GetTable(stackm.RecordCellTypedGetByName(source, vm->cn_cache.col_source, VariableTypes::Table, true));

                        DBTypeInfo const **typeinfo_ptr = vm->typeinfomapper.Get(typeinfo_id);
                        if (!typeinfo_ptr && !*typeinfo_ptr)
                            throw VMRuntimeError(Error::InternalError, "Missing typeinfo for table source in SQL statement");

                        HSBindDef def = context->GetBindingInfo(tableid);

                        if (def.driver->vm != vm)
                            throw VMRuntimeError(Error::InternalError, "Using transaction that is rooted in other VM");

                        QueryDefinition::Source &source = query.sources[idx];
                        source.SetFrom(def.dbasename, **typeinfo_ptr, def.driver, 0);
                }
                else
                {
                        // Expression
                        VarId var_recarr = stackm.RecordCellTypedGetByName(source, vm->cn_cache.col_source, VariableTypes::RecordArray, true);

                        DBTypeInfo const **typeinfo_ptr = vm->typeinfomapper.Get(typeinfo_id);
                        if (!typeinfo_ptr && !*typeinfo_ptr)
                            throw VMRuntimeError(Error::InternalError, "Missing typeinfo for expression source in SQL statement");

                        VarId copy = stackm.NewHeapVariable();
                        values.push_back(copy);

                        QueryDefinition::Source &source = query.sources[idx];
                        source.SetFrom(recarr_str, **typeinfo_ptr, 0, copy);
                        stackm.CopyFrom(source.recarr, var_recarr);
                }
        }
        if (query.sources.empty())
            throw VMRuntimeError(Error::InternalError, "No sources specified");

        // Handle the updatecolumnlist
        VarId var_updatecolumnlist = stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_updatecolumnlist, VariableTypes::Record, false);
        if (var_updatecolumnlist)
        {
                unsigned numcells = HSVM_RecordLength(*vm, var_updatecolumnlist);
                for (unsigned i=0;i<numcells;++i)
                {
                        HSVM_ColumnId column = HSVM_RecordColumnIdAtPos(*vm, var_updatecolumnlist, i);
                        signed col = query.sources[0].typeinfo->FindColumn(column);
                        if (col<0)
                            throw VMRuntimeError(Error::UnknownColumn, vm->columnnamemapper.GetReverseMapping(column).stl_str());

                        query.sources[0].columns[col].fase |= Fases::Updated;
                }
        }

        // Handle limit
        VarId var_limit = stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_limit, VariableTypes::Integer, false);
        if (var_limit)
        {
                query.limit = stackm.GetInteger(var_limit);
                if (query.limit < 0)
                    query.limit = 0;
        }
        else
            query.limit = -1;

        // Handle limit
        VarId var_limitblocksize = stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_limitblocksize, VariableTypes::Boolean, false);
        if (var_limitblocksize)
            query.limit_blocksize = stackm.GetBoolean(var_limitblocksize);
        else
            query.limit_blocksize = false;

        // Handle has_hs_code
        query.has_fase1_hscode = stackm.GetBoolean(stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_has_hs_code, VariableTypes::Boolean, true));

        // Handle conditions
        VarId var_conditions = stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_conditions, VariableTypes::RecordArray, true);
        unsigned conditions_count = stackm.ArraySize(var_conditions);

        query.singleconditions.reserve(conditions_count);
        query.joinconditions.reserve(conditions_count);

        for (unsigned idx = 0; idx != conditions_count; ++idx)
        {
                VarId var_condition = stackm.ArrayElementRef(var_conditions, idx);

                bool casesensitive = stackm.GetBoolean(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_casesensitive, VariableTypes::Boolean, true));
                int32_t condition = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_condition, VariableTypes::Integer, true));

                VarId var_single = stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_single, VariableTypes::Boolean, true);
                if (stackm.GetBoolean(var_single))
                {
                        int32_t tablenr = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_tablenr, VariableTypes::Integer, true));
                        int32_t typeinfonr = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_typeinfonr, VariableTypes::Integer, true));
                        VarId cond_value = stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_value, VariableTypes::Variant, true);

                        VarId value = stackm.NewHeapVariable();
                        values.push_back(value);
                        stackm.CopyFrom(value, cond_value);

                        SingleCondition cond;
                        cond.handled = false;
                        cond.value = value;
                        cond.table = tablenr;
                        cond.column = typeinfonr;
                        if (cond.table >= query.sources.size() || cond.column >= query.sources[cond.table].typeinfo->columnsdef.size())
                            throw VMRuntimeError(Error::InternalError, "Call to AddConditionSingle with illegal parameters");
                        cond.columnid = query.sources[cond.table].typeinfo->columnsdef[cond.column].nameid;
                        cond.condition = (DBConditionCode::_type)condition;
                        cond.casesensitive = casesensitive;
                        cond.match_null = false;

                        query.singleconditions.push_back(cond);
                }
                else
                {
                        int32_t tablenr1 = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_tablenr1, VariableTypes::Integer, true));
                        int32_t typeinfonr1 = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_typeinfonr1, VariableTypes::Integer, true));
                        int32_t tablenr2 = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_tablenr2, VariableTypes::Integer, true));
                        int32_t typeinfonr2 = stackm.GetInteger(stackm.RecordCellTypedGetByName(var_condition, vm->cn_cache.col_typeinfonr2, VariableTypes::Integer, true));

                        JoinCondition cond;
                        cond.handled = false;
                        cond.table1 = tablenr1;
                        cond.table2 = tablenr2;
                        cond.column1 = typeinfonr1;
                        cond.column2 = typeinfonr2;

                        if (cond.table1 >= query.sources.size() || cond.column1 >= query.sources[cond.table1].typeinfo->columnsdef.size())
                            throw VMRuntimeError(Error::InternalError, "Call to AddConditionRelation with illegal parameters");
                        if (cond.table2 >= query.sources.size() || cond.column2 >= query.sources[cond.table2].typeinfo->columnsdef.size())
                            throw VMRuntimeError(Error::InternalError, "Call to AddConditionRelation with illegal parameters");

                        cond.columnid1 = query.sources[cond.table1].typeinfo->columnsdef[cond.column1].nameid;
                        cond.columnid2 = query.sources[cond.table2].typeinfo->columnsdef[cond.column2].nameid;
                        cond.condition = (DBConditionCode::_type)condition;
                        cond.casesensitive = casesensitive;
                        cond.match_double_null = false;

                        query.joinconditions.push_back(cond);
                }
        }

        int32_t querytype = stackm.GetInteger(stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_querytype, VariableTypes::Integer, true));
        if (querytype < 0 || querytype > 2)
            throw VMRuntimeError(Error::InternalError, "Invalid query type");

        if (querytype != 0 && (query.sources.size() != 1))
            throw VMRuntimeError (Error::MustBeOneTable);

        CALL_PRINT("SQL_OpenCursor(" << querytype << ")");

        unsigned id = context->openqueries.Set(OpenQuery(vm, static_cast<DatabaseTransactionDriverInterface::CursorType>(querytype)));
        OpenQuery &openquery = *context->openqueries.Get(id);

        openquery.Open(query, values);

        CALL_PRINT("SQL_OpenCursor-result: " << id);
        stackm.SetInteger(id_set, id);
}

/** INTEGER FUNCTION HS_SQL_OpenCursor(INTEGER querytype): Opens a query, with the current query description
    @param querytype type of query (0: SELECT, 1: DELETE, 2:UPDATE) */
void HS_SQL_OpenCursor(VarId /*id_set*/, VirtualMachine */*vm*/)
{
        throw VMRuntimeError(Error::InternalError, "REMOVED HS_SQL_FUNCTION");
        /*
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        QueryDefinition &querydef = context->query;

        DatabaseTransactionDriverInterface::CursorType type =
                static_cast<DatabaseTransactionDriverInterface::CursorType>(varmem.GetInteger(HSVM_Arg(0)));

        if (type != 0 && (querydef.sources.size() != 1))
            throw VMRuntimeError (Error::MustBeOneTable);

        CALL_PRINT("SQL_OpenCursor(" << type << ")");

        unsigned id = context->openqueries.Set(OpenQuery(vm, type));
        OpenQuery &openquery = *context->openqueries.Get(id);

        openquery.Open(querydef, context->values);

        CALL_PRINT("SQL_OpenCursor-result: " << id);
        varmem.SetInteger(id_set, id);
        */
}

/** INTEGER FUNCTION HS_SQL_GetAction(INTEGER quid, INTEGER tid): Retrieves the current action for the harescript code
    @param quid Id of the query */
void HS_SQL_GetAction(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        int32_t quid = varmem.GetInteger(HSVM_Arg(0));

        CALL_PRINT("SQL_GetAction(" << quid << ")");

        OpenQuery *openquery = context->openqueries.Get(quid);

        if (!openquery)
            ThrowInvalidTransaction();

        int32_t action = openquery->GetNextAction();
        varmem.SetInteger(id_set, action);

        CALL_ONLY(
          switch (action)
          {
          case 0:       CALL_PRINT("SQL_GetAction(" << quid << ")-result: get&check fase1"); break;
          case 1:       CALL_PRINT("SQL_GetAction(" << quid << ")-result: get fase2&do stuff"); break;
          default:      CALL_PRINT("SQL_GetAction(" << quid << ")-result: finish"); break;
          }
        );
}

/** RECORD FUNCTION HS_SQL_GetRecord(INTEGER quid, INTEGER tid): Gets a record from a query
    @param quid Id of the query
    @param tid Number of the table which record must be retrieved (0: first table in tablelist, 1: second, etc.) */
void HS_SQL_GetRecord(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        int32_t quid = varmem.GetInteger(HSVM_Arg(0));
        int32_t tid = varmem.GetInteger(HSVM_Arg(1));

        CALL_PRINT("SQL_GetRecord(" << quid << ", " << tid << ")");

        OpenQuery *openquery = context->openqueries.Get(quid);

        if (!openquery)
            ThrowInvalidTransaction();

        openquery->GetRecord(id_set, tid);
}

/** RECORD FUNCTION HS_SQL_GetRecordArrayPosition(INTEGER quid, INTEGER tid): Gets the current position for a record array
    @param quid Id of the query
    @param tid Number of the record array which position must be retrieved (0: first table in tablelist, 1: second, etc.) */
void HS_SQL_GetRecordArrayPosition(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();

        OpenQuery *openquery = context->openqueries.Get(varmem.GetInteger(HSVM_Arg(0)));

        if (!openquery)
            ThrowInvalidTransaction();

        varmem.SetInteger(id_set, openquery->GetRecordArrayPosition(varmem.GetInteger(HSVM_Arg(1))));
}

/** MACRO HS_SQL_CloseQuery(INTEGER quid): Closes query
    @param quid Id of the query */
void HS_SQL_CloseQuery(VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        unsigned quid = varmem.GetInteger(HSVM_Arg(0));

        CALL_PRINT("SQL_CloseQuery(" << quid << ")");

        OpenQuery *openquery = context->openqueries.Get(quid);

        if (!openquery)
            ThrowInvalidTransaction();

        openquery->Close();
        context->openqueries.Erase(quid);
}

/** MACRO HS_SQL_DeleteRecord(INTEGER quid): Deletes record at current cursor position
    @param quid Id of the query */
void HS_SQL_DeleteRecord(VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        unsigned quid = varmem.GetInteger(HSVM_Arg(0));

        CALL_PRINT("SQL_DeleteRecord(" << quid << ")");
        OpenQuery *openquery = context->openqueries.Get(quid);

        if (!openquery)
            ThrowInvalidTransaction();

        openquery->DeleteRow();
}

/** MACRO HS_SQL_UpdateRecord(INTEGER quid, __VARIANT newfields): Updates record at current cursor position
    @param quid Id of the query
    @param newfields New fields */
void HS_SQL_UpdateRecord(VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        unsigned quid = varmem.GetInteger(HSVM_Arg(0));

        CALL_PRINT("SQL_UpdateRecord(" << quid << ")");
        OpenQuery *openquery = context->openqueries.Get(quid);

        if (!openquery)
            ThrowInvalidTransaction();

        openquery->UpdateRow(HSVM_Arg(1));
}

/** Record FUNCTION OverwriteRecord(Record A, Record B) Overwrites record a with b
    @param handle Handle identifying the query */
void HS_SQL_OverwriteRecord(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();

        VarId arg1 = HSVM_Arg(0);
        VarId arg2 = HSVM_Arg(1);

        varmem.MoveFrom(id_set, arg1);
        for (unsigned idx = 0; idx < varmem.RecordSize(arg2); ++idx)
        {
                ColumnNameId nameid = varmem.RecordCellNameByNr(arg2, idx);
                varmem.CopyFrom(
                        varmem.RecordCellCreate(id_set, nameid),
                        varmem.RecordCellGetByName(arg2, nameid));
        }
}

/** Record FUNCTION OverwriteRecord(Record A, Record B) Overwrites record a with b
    @param handle Handle identifying the query */
void HS_SQL_MergeRecords(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();

        VarId arg1 = HSVM_Arg(0);
        VarId arg2 = HSVM_Arg(1);

        varmem.MoveFrom(id_set, arg1);
        ColumnNameId error_nameid = 0;

        for (unsigned idx = 0, end = varmem.RecordSize(arg2); idx < end; ++idx)
        {
                ColumnNameId nameid = varmem.RecordCellNameByNr(arg2, idx);

                if (varmem.RecordCellExists(id_set, nameid))
                {
                        error_nameid = nameid;
                        break;
                }

                varmem.CopyFrom(
                        varmem.RecordCellCreate(id_set, nameid),
                        varmem.RecordCellGetByName(arg2, nameid));
        }
        if (error_nameid != 0)
            throw VMRuntimeError (Error::ColumnNameAlreadyExists, varmem.columnnamemapper.GetReverseMapping(error_nameid).stl_str());
}

/** RECORD FUNCTION HS_SQL_GetRecordFase1(INTEGER quid, INTEGER tid): Gets a record from a query (only fase 1 fields)
    @param quid Id of the query
    @param tid Number of the table which record must be retrieved (0: first table in tablelist, 1: second, etc.) */
void HS_SQL_GetRecordFase1(VarId id_set, VirtualMachine *vm)
{
        // Get the record; it is currently filled with fase1 columns
        HS_SQL_GetRecord(id_set, vm);
}

/** RECORD FUNCTION HS_SQL_GetRecordFase2(INTEGER quid, INTEGER tid): Gets a record from a query (only fase 1 fields)
    @param quid Id of the query
    @param tid Number of the table which record must be retrieved (0: first table in tablelist, 1: second, etc.) */
void HS_SQL_GetRecordFase2(VarId id_set, VirtualMachine *vm)
{
        // Get the record; it is currently filled with fase1 and fase2 columns
        HS_SQL_GetRecord(id_set, vm);
}

/** MACRO ReportWhereResult(INTEGER quid, BOOLEAN result) Reports the result of a where evaluation
    @param handle Handle identifying the query
    @param result Result of where evaluation */
void HS_SQL_ReportWhereResult(VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        unsigned quid = varmem.GetInteger(HSVM_Arg(0));
        bool result = varmem.GetBoolean(HSVM_Arg(1));

        CALL_PRINT("SQL_ReportWhereResult(" << quid << ", " << (result ? "true" : "false") << ")");
        OpenQuery *openquery = context->openqueries.Get(quid);

        if (!openquery)
            ThrowInvalidTransaction();

        openquery->evaluated_where_ok = result;
}

/** RECORD ARRAY FUNCTION GetArrayResults(INTEGER quid) Returns the modified record array on which a
            update or delete has been performed
    @param quid Id of the query (returned by OpenCursor)
    @return Modified record array */
void HS_SQL_GetArrayResults(VarId id_set, VirtualMachine *vm)
{
        SQLContext context(vm->GetContextKeeper());
        StackMachine &varmem = vm->GetStackMachine();
        OpenQuery *openquery = context->openqueries.Get(varmem.GetInteger(HSVM_Arg(0)));

        if (!openquery)
            ThrowInvalidTransaction();

        openquery->GetResultArraySource(id_set);
}

/// Reordering engine
class Reordering2
{
    public:
        // Create a reordering engine. If orderstring is empty, distinct processing is done.
        Reordering2(VirtualMachine &vm, Blex::StringPair orderstring);

        /** Run the actual reordering */
        void Run(VarId inputdata);

        /** Store results into the specified array */
        void StoreResults(VarId array);

    private:

        typedef Blex::PodVector< VarId > VarIds;

        ///A single order-by
        struct Ordering
        {
                ///Id of the column to order
                ColumnNameId column;
                ///True for an ascending ordering
                bool ascending;
        };

        struct Record
        {
                unsigned idx;
                VarIds::const_iterator vals;
        };

        typedef std::vector< Ordering > Orderings;
        typedef Blex::PodVector< Record > Records;

        static bool CompareRecords(Reordering2 const &odr, Record const &lhs, Record const &rhs);

        /// Stackmachine to use for variable manupulation
        StackMachine &varmem;

        /// The ordering to apply
        Orderings orderings;

        /// List of records
        Records records;

        /// Vars
        VarIds varids;

        VarIds recordids;

        /// Flag indicating whether duplicates should be deleted
        bool execute_distinct;
};

Reordering2::Reordering2(VirtualMachine &vm, Blex::StringPair orderstring)
: varmem(vm.GetStackMachine())
, orderings(orderstring.size())
, execute_distinct(orderstring.empty())
{
        Blex::SemiStaticPodVector< char, 20 > cellname_storage;
        const char cellname_base[] = ":__ORDERBY";

        for (unsigned i=0;i<orderstring.size();++i)
        {
                // Reinit cellname storage, correct for \0 at end
                cellname_storage.assign(cellname_base, cellname_base + sizeof(cellname_base) - 1);
                Blex::EncodeNumber(i, 10, std::back_inserter(cellname_storage));

                Blex::StringPair cellname(cellname_storage.begin(), cellname_storage.end());

                Ordering &order = orderings[i];
                order.column = vm.columnnamemapper.GetMapping(cellname);
                order.ascending = orderstring.begin[i]=='A';
        }
}

bool Reordering2::CompareRecords(Reordering2 const &odr, Record const &lhs, Record const &rhs)
{
        VarIds::const_iterator lhs_itr(lhs.vals);
        VarIds::const_iterator rhs_itr(rhs.vals);

        for (Orderings::const_iterator it = odr.orderings.begin(); it != odr.orderings.end(); ++it)
        {
                int32_t cmp = odr.varmem.Compare(*lhs_itr, *rhs_itr, true);
                if (!it->ascending)
                    cmp = -cmp;
                if (cmp < 0)
                    return true;
                else if (cmp > 0)
                    return false;
                ++lhs_itr;
                ++rhs_itr;
        }
        // They're equal. Don't care about stable sort.
        return false;//lhs.idx < rhs.idx;
}

void Reordering2::Run(VarId inputdata)
{
        unsigned sourcelen = varmem.ArraySize(inputdata);
        unsigned numorders = orderings.size();

        // Empty array is sorted very quick
        if (sourcelen == 0)
            return;

        unsigned first_elt_cellcount = 0;
        if (execute_distinct)
        {
                // Locate all cells in the first record. Add all to the ordering (no need to weed out :__orderbys)
                VarId first_elt = varmem.ArrayElementRef(inputdata, 0);
                first_elt_cellcount = varmem.RecordSize(first_elt);

                orderings.reserve(numorders + first_elt_cellcount);

                for (unsigned idx = 0; idx < first_elt_cellcount; ++idx)
                {
                        ColumnNameId cid = varmem.RecordCellNameByNr(first_elt, idx);

                        // Skip orderby columns
                        std::string name = varmem.columnnamemapper.GetReverseMapping(cid).stl_str(); // ADDME: rework to stringpair!
                        if (name.size() > 10 && name.substr(0, 10) == ":__ORDERBY")
                            continue;

                        Ordering order;
                        order.column = cid;
                        order.ascending = true;
                        orderings.push_back(order);
                }
                numorders = orderings.size();
        }

        records.resize(sourcelen);
        varids.reserve(sourcelen * numorders);
        for (unsigned i = 0; i < sourcelen; ++i)
        {
                Record &rec = records[i];
                rec.vals = varids.end();
                rec.idx = i;
                VarId var = varmem.ArrayElementRef(inputdata, i);
                recordids.push_back(var);

                for (unsigned order=0; order<numorders; ++order)
                {
                        VarId cell = varmem.RecordCellRefByName(var, orderings[order].column);
                        if (!cell)
                            throw VMRuntimeError(Error::UnknownColumn, varmem.columnnamemapper.GetReverseMapping(orderings[order].column).stl_str());
                        varids.push_back(cell);
                }

                if (execute_distinct)
                {
                        unsigned cellcount = varmem.RecordSize(var);
                        if (cellcount != first_elt_cellcount)
                        {
                                VarId first_elt = varmem.ArrayElementGet(inputdata, 0);

                                // in DISTINCT mode, records all must have the same layout as the first record
                                for (unsigned idx = 0; idx < cellcount; ++idx)
                                {
                                        ColumnNameId cid = varmem.RecordCellNameByNr(var, idx);
                                        if (!varmem.RecordCellGetByName(first_elt, cid))
                                            throw VMRuntimeError(Error::UnknownColumn, varmem.columnnamemapper.GetReverseMapping(cid).stl_str()); // no did you mean, this is an extra column
                                }
                        }
                }
        }

        std::stable_sort(records.begin(), records.end(), std::bind(CompareRecords, std::ref(*this), std::placeholders::_1, std::placeholders::_2));
}

void Reordering2::StoreResults(VarId array)
{
        unsigned size = records.size();

        varmem.ArrayInitialize(array, size, VariableTypes::RecordArray);

        if (!execute_distinct)
        {
                for (unsigned i=0;i<size;++i)
                {
                        unsigned idx = records[i].idx;
                        VarId cell = recordids[idx];
                        for (Orderings::const_iterator it = orderings.begin(); it != orderings.end(); ++it)
                            varmem.RecordCellDelete(cell, it->column);
                        varmem.MoveFrom(varmem.ArrayElementRef(array, i), cell);
                }
        }
        else
        {
                unsigned copied = 0;
                for (Records::const_iterator it = records.begin(), end = records.end(); it != end;)
                {
                        // Copy first unique record
                        varmem.MoveFrom(varmem.ArrayElementRef(array, copied), recordids[it->idx]);
                        ++copied;

                        // Iterate next while *it is not smaller than *next
                        Records::const_iterator next = it + 1;
                        for (; next != end; ++next)
                            if (CompareRecords(*this, *it, *next))
                                break;

                        it = next;
                }
                varmem.ArrayResize(array, copied);
        }
}

/** RECORD ARRAY MACRO HS_SQL_REORDER_RESULTS(RECORD ARRAY recarr, STRING orderings): Reorders a record array. Assumes that for
    every character in 'orderings' a ':__orderbyXXX' columns exists in every record in array 'recarr'.
    @param recarr Source record array
    @param orderings String containing A's and D's defining the ordering (Ascending/Descending) */
void ReorderResults(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();

        Blex::StringPair orderstring = varmem.GetString(HSVM_Arg(1));

        Reordering2 reorder(*vm, orderstring);
        reorder.Run(HSVM_Arg(0));
        reorder.StoreResults(id_set);
}

void MakeDistinct(VarId id_set, VirtualMachine *vm)
{
        Reordering2 reorder(*vm, Blex::StringPair::ConstructEmpty());
        reorder.Run(HSVM_Arg(0));
        reorder.StoreResults(id_set);
}

namespace
{
void ThrownCellNotFound(StackMachine &stackm, ColumnNameId nameid)
{
        throw VMRuntimeError(Error::UnknownColumn, stackm.columnnamemapper.GetReverseMapping(nameid).stl_str());
}

signed GroupCompare(StackMachine &stackm, Blex::PodVector< ColumnNameId > const &mappings, VarId reca, VarId recb)
{
        for (auto it = mappings.begin(); it != mappings.end(); ++it)
        {
                // We're not gonna change the records, so we can use get
                VarId lhs = stackm.RecordCellGetByName(reca, *it);
                VarId rhs = stackm.RecordCellGetByName(recb, *it);
                if (!lhs || !rhs)
                    ThrownCellNotFound(stackm, *it);

                int32_t cmp = stackm.Compare(lhs, rhs, true);
                if (cmp != 0)
                    return cmp;
        }
        return 0;
}

std::pair< bool, int32_t > BinaryRecordSearchImpl(VirtualMachine *vm, VarId group_array, VarId new_group, Blex::PodVector< ColumnNameId > const &ids, bool upper_bound)
{
        StackMachine &stackm = vm->GetStackMachine();

        signed first = 0;
        unsigned len = stackm.ArraySize(group_array);
        bool found = false;

        signed cmpbound = upper_bound ? 1 : 0;
        signed unsorted_cmp = 0; // if this is non-0 and cmp is this value, we have an unsorted list
        while (len > 0)
        {
                unsigned half = len / 2;
                unsigned middle = first + half;
                signed cmp = GroupCompare(stackm, ids, stackm.ArrayElementGet(group_array, middle), new_group);
                if (cmp == 0)
                {
                       found = true;
                       unsorted_cmp = upper_bound ? -1 : 1;
                }
                else if (cmp == unsorted_cmp)
                    return std::make_pair(true, -2);

                if (cmp < cmpbound)
                {
                        first = middle + 1;
                        len -= half;
                        --len;
                }
                else
                {
                        len = half;
                }
        }
        return std::make_pair(found, first);
}

std::pair< bool, int32_t > BinarySearchImpl(VirtualMachine *vm, VarId group_array, VarId new_group, bool upper_bound)
{
        StackMachine &stackm = vm->GetStackMachine();

        signed first = 0;
        unsigned len = stackm.ArraySize(group_array);

        signed cmpbound = upper_bound ? 1 : 0;
        signed unsorted_cmp = 0; // if this is non-0 and cmp is this value, we have an unsorted list
        bool found = false;

        while (len > 0)
        {
                unsigned half = len / 2;
                unsigned middle = first + half;
                signed cmp = stackm.Compare(stackm.ArrayElementGet(group_array, middle), new_group, true);
                if (cmp == 0)
                {
                       found = true;
                       unsorted_cmp = upper_bound ? -1 : 1;
                }
                else if (cmp == unsorted_cmp)
                    return std::make_pair(true, -2);

                if (cmp < cmpbound)
                {
                        first = middle + 1;
                        len -= half;
                        --len;
                }
                else
                {
                        len = half;
                }
        }
        return std::make_pair(found, first);
}

bool CompareStdLess(StackMachine *stackm, VarId left, VarId right, bool invert)
{
        return stackm->Compare(left, right, true) == (invert ? 1 : -1);
}

bool CompareStdEq(StackMachine *stackm, VarId left, VarId right)
{
        return stackm->Compare(left, right, true) == 0;
}

} // End of anonymous namespace



void HS_SQL_GetGroupPosition(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId group_array = HSVM_Arg(0);
        VarId new_group = HSVM_Arg(1);

        Blex::SemiStaticPodVector< ColumnNameId, 16 > ids;
        unsigned reclen = stackm.RecordSize(new_group);
        for (unsigned i = 0; i < reclen; ++i)
        {
                char numbuf[21]; // Enough for 64-bit (log 2^64 = 19.2, so max 20 + 1(sign) chars.
                char *numend = Blex::EncodeNumber(i, 10, numbuf);
                ids.push_back(stackm.columnnamemapper.GetMapping(Blex::StringPair(numbuf, numend)));
        }

        std::pair< bool, int32_t> res = BinaryRecordSearchImpl(vm, group_array, new_group, ids, false);

        stackm.SetInteger(id_set, res.first ? res.second : -res.second-1);
}

void HS_BinaryRecordLowerBound(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId group_array = HSVM_Arg(0);
        VarId new_group = HSVM_Arg(1);
        VarId cellnames = HSVM_Arg(2);

        Blex::SemiStaticPodVector< ColumnNameId, 16 > ids;
        unsigned arraylen = stackm.ArraySize(cellnames);
        for (unsigned i = 0; i < arraylen; ++i)
            ids.push_back(stackm.columnnamemapper.GetMapping(stackm.GetString(stackm.ArrayElementRef(cellnames, i))));

        std::pair< bool, int32_t> res = BinaryRecordSearchImpl(vm, group_array, new_group, ids, false);
        if (res.second == -2)
        {
                HSVM_ThrowException(*vm, "The array provided to RecordLowerBound was not properly sorted");
                return;
        }

        stackm.InitVariable(id_set, VariableTypes::Record);
        stackm.SetBoolean(stackm.RecordCellCreate(id_set, vm->cn_cache.col_found), res.first);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_position), res.second);
}

void HS_BinaryRecordUpperBound(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId group_array = HSVM_Arg(0);
        VarId new_group = HSVM_Arg(1);
        VarId cellnames = HSVM_Arg(2);

        Blex::SemiStaticPodVector< ColumnNameId, 16 > ids;
        unsigned arraylen = stackm.ArraySize(cellnames);
        for (unsigned i = 0; i < arraylen; ++i)
            ids.push_back(stackm.columnnamemapper.GetMapping(stackm.GetString(stackm.ArrayElementRef(cellnames, i))));

        std::pair< bool, int32_t> res = BinaryRecordSearchImpl(vm, group_array, new_group, ids, true);
        if (res.second == -2)
        {
                HSVM_ThrowException(*vm, "The array provided to RecordUpperBound was not properly sorted");
                return;
        }

        stackm.SetInteger(id_set, res.second);
}

void HS_BinaryLowerBound(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId group_array = HSVM_Arg(0);
        VarId new_group = HSVM_Arg(1);

        VariableTypes::Type type = stackm.GetType(group_array);
        if (!(type & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        std::pair< bool, int32_t> res = BinarySearchImpl(vm, group_array, new_group, false);
        if (res.second == -2)
        {
                HSVM_ThrowException(*vm, "The array provided to LowerBound was not properly sorted");
                return;
        }

        stackm.InitVariable(id_set, VariableTypes::Record);
        stackm.SetBoolean(stackm.RecordCellCreate(id_set, vm->cn_cache.col_found), res.first);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_position), res.second);
}

void HS_BinaryUpperBound(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId group_array = HSVM_Arg(0);
        VarId new_group = HSVM_Arg(1);

        VariableTypes::Type type = stackm.GetType(group_array);
        if (!(type & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        std::pair< bool, int32_t> res = BinarySearchImpl(vm, group_array, new_group, true);
        if (res.second == -2)
        {
                HSVM_ThrowException(*vm, "The array provided to UpperBound was not properly sorted");
                return;
        }

        stackm.SetInteger(id_set, res.second);
}

void HS_SQL_SortArray(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId list = HSVM_Arg(0);

        VariableTypes::Type type = stackm.GetType(HSVM_Arg(0));
        if (!(type & VariableTypes::Array))
            throw VMRuntimeError (Error::TypeNotArray);

        Blex::PodVector< VarId > ids;
        unsigned rec_count = HSVM_ArrayLength(*vm, list);
        for (unsigned idx = 0; idx < rec_count; ++idx)
            ids.push_back(stackm.ArrayElementGet(list, idx));

        bool reverse = stackm.GetBoolean(HSVM_Arg(1));

        std::sort(ids.begin(), ids.end(), std::bind(CompareStdLess, &stackm, std::placeholders::_1, std::placeholders::_2, reverse));

        Blex::PodVector< VarId >::iterator end = ids.end();
        if (stackm.GetBoolean(HSVM_Arg(2)))
            end = std::unique(ids.begin(), ids.end(), std::bind(CompareStdEq, &stackm, std::placeholders::_1, std::placeholders::_2));

        stackm.ArrayInitialize(id_set, 0, type);
        for (Blex::PodVector< VarId >::iterator it = ids.begin(); it != end; ++it)
            stackm.CopyFrom(stackm.ArrayElementAppend(id_set), *it);
}


void HS_SQL_MakeArrayOfValue(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        VariableTypes::Type type = stackm.GetType(HSVM_Arg(0));
        if (type & VariableTypes::Array) // Code below is prepared to disable this
            throw VMRuntimeError(Error::CannnotAggregateArrays);

        VariableTypes::Type arraytype = type & VariableTypes::Array ? VariableTypes::VariantArray : HareScript::ToArray(type);
        stackm.ArrayInitialize(id_set, 0, arraytype);

        stackm.MoveFrom(stackm.ArrayElementAppend(id_set), HSVM_Arg(0));
}

void HS_SQL_RegisterTypeInfo(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        bool is_rec_arr = stackm.GetBoolean(HSVM_Arg(0));

        DBTypeInfo typeinfo;
        typeinfo.type = is_rec_arr ? VariableTypes::RecordArray : VariableTypes::Table;

        unsigned len = stackm.ArraySize(HSVM_Arg(1));
        for (unsigned idx = 0; idx < len; ++idx)
        {
                VarId var = stackm.ArrayElementGet(HSVM_Arg(1), idx);
                DBTypeInfo::Column col;
                col.name = stackm.GetSTLString(var);
                col.dbase_name = col.name;
                col.type = VariableTypes::Variant;
                col.flags = ColumnFlags::InternalFase1;
                col.nameid = vm->columnnamemapper.GetMapping(col.name);

                typeinfo.columnsdef.push_back(col);
        }

        stackm.SetInteger(id_set, vm->GetSQLSupport().RegisterTypeInfo(typeinfo));
}

void HS_SQL_RegisterTableTypeInfo(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        Marshaller marshaller(vm, MarshalMode::SimpleOnly);

//        HSVM_ColumnId col_istable = HSVM_GetColumnId(*vm, "ISTABLE");
//        HSVM_ColumnId col_columns = HSVM_GetColumnId(*vm, "COLUMNS");
//        HSVM_ColumnId col_name = HSVM_GetColumnId(*vm, "NAME");
//        HSVM_ColumnId col_dbase_name = HSVM_GetColumnId(*vm, "DBASE_NAME");
//        HSVM_ColumnId col_type = HSVM_GetColumnId(*vm, "TYPE");
//        HSVM_ColumnId col_flags = HSVM_GetColumnId(*vm, "FLAGS");
//        HSVM_ColumnId col_fase = HSVM_GetColumnId(*vm, "FASE");
//        HSVM_ColumnId col_nulldefault = HSVM_GetColumnId(*vm, "NULLDEFAULT");

        bool istable = HSVM_BooleanGet(*vm, HSVM_RecordGetRef(*vm, HSVM_Arg(0), vm->cn_cache.col_istable));

        DBTypeInfo typeinfo;
        typeinfo.type = istable ? VariableTypes::Table : VariableTypes::RecordArray;

        HSVM_VariableId columns = HSVM_RecordGetRef(*vm, HSVM_Arg(0), vm->cn_cache.col_columns);

        unsigned len = stackm.ArraySize(columns);
        for (unsigned idx = 0; idx < len; ++idx)
        {
                VarId var = stackm.ArrayElementGet(columns, idx);
                DBTypeInfo::Column col;
                col.name = HSVM_StringGetSTD(*vm, HSVM_RecordGetRef(*vm, var, vm->cn_cache.col_name));
                col.dbase_name = HSVM_StringGetSTD(*vm, HSVM_RecordGetRef(*vm, var, vm->cn_cache.col_dbase_name));
                col.type = (VariableTypes::Type)HSVM_IntegerGet(*vm, HSVM_RecordGetRef(*vm, var, vm->cn_cache.col_type));
                col.flags = (ColumnFlags::_type)HSVM_IntegerGet(*vm, HSVM_RecordGetRef(*vm, var, vm->cn_cache.col_flags));
                col.nameid = HSVM_GetColumnIdRange(*vm, &*col.name.begin(), &*col.name.end());

                HSVM_VariableId var_fase = HSVM_RecordGetRef(*vm, var, vm->cn_cache.col_fase);
                if (var_fase)
                {
                        // fase cell is authorative
                        col.flags = (ColumnFlags::_type)(col.flags & (ColumnFlags::MaskExcludeInternal | ColumnFlags::TranslateNulls | ColumnFlags::Binary));
                        Fases::_type fase = (SQLLib::Fases::_type)HSVM_IntegerGet(*vm, var_fase);
                        if (fase & Fases::Fase1)
                            col.flags = (ColumnFlags::_type)(col.flags | ColumnFlags::InternalFase1);
                        if (fase & Fases::Fase2)
                            col.flags = (ColumnFlags::_type)(col.flags | ColumnFlags::InternalFase2);
                        if (fase & Fases::Updated)
                            col.flags = (ColumnFlags::_type)(col.flags | ColumnFlags::InternalUpdates);
                }

                HSVM_VariableId var_nulldefault = HSVM_RecordGetRef(*vm, var, vm->cn_cache.col_nulldefault);
                if (var_nulldefault && col.type != HSVM_VAR_Blob)
                {
                        unsigned size = marshaller.Analyze(var_nulldefault);
                        col.null_default.resize(size);
                        marshaller.Write(var_nulldefault, &col.null_default[0], (&col.null_default[0]) + size);
                        col.flags |= ColumnFlags::TranslateNulls;
                }
                else
                    col.flags = (ColumnFlags::_type)(col.flags & ~ColumnFlags::TranslateNulls);
                typeinfo.columnsdef.push_back(col);
        }
        HSVM_IntegerSet(*vm, id_set, vm->GetSQLSupport().RegisterTypeInfo(typeinfo));
}

void HS_SQL_UnregisterTypeInfo(VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        return vm->GetSQLSupport().UnregisterTypeInfo(stackm.GetInteger(HSVM_Arg(0)));
}

void HS_SQL_DescribeTypeInfo(VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        return vm->GetSQLSupport().UnregisterTypeInfo(stackm.GetInteger(HSVM_Arg(0)));
}

void HS_SQL_KeepTransactionsAlive(VarId id_set, VirtualMachine *vm)
{
        VMGroup *group = vm->GetVMGroup();

        std::vector< VirtualMachine * > vms;
        group->GetListOfVMs(&vms);

        bool all_alive = true;

        for (std::vector< VirtualMachine * >::iterator it = vms.begin();  it != vms.end(); ++it)
        {
                SQLContext context((*it)->GetContextKeeper());

                for (SQLContextData::TransactionsStorage::iterator it2 = context->transactions.begin(); it2 != context->transactions.end(); ++it2)
                    if (*it2)
                        all_alive = (*it2)->KeepAlive() && all_alive;
        }

        HSVM_BooleanSet(*vm, id_set, all_alive);
}

struct GroupingDef
{
        typedef std::vector< std::pair< ColumnNameId, ColumnNameId > > MappedIds;

        MappedIds group;
        MappedIds groupedvalues;
        MappedIds count;
        MappedIds counti64;
        MappedIds sum;
        MappedIds first;
        MappedIds last;
        MappedIds min;
        MappedIds max;
        MappedIds concat;

        // These are used in SetIdMapping, calculate them up front
        HSVM_ColumnId col_name;
        HSVM_ColumnId col_field;

        // ref MUST be record
        void InitFromDef(StackMachine &stackm, VarId def);
        void SetIdMapping(StackMachine &stackm, VarId list, MappedIds *target);
        void CopyCells(StackMachine &stackm, VarId group, VarId rec, MappedIds const &ids, VariableTypes::Type requiretype);
        void InitGroup(StackMachine &stackm, VarId group, VarId rec);
        void AddToGroup(StackMachine &stackm, VarId group, VarId rec);
};

void GroupingDef::InitFromDef(StackMachine &stackm, VarId def)
{
        HSVM_ColumnId col_group = stackm.columnnamemapper.GetMapping("GROUP");
        HSVM_ColumnId col_groupedvalues = stackm.columnnamemapper.GetMapping("GROUPEDVALUES");
        HSVM_ColumnId col_count = stackm.columnnamemapper.GetMapping("COUNT");
        HSVM_ColumnId col_counti64 = stackm.columnnamemapper.GetMapping("COUNTI64");
        HSVM_ColumnId col_sum = stackm.columnnamemapper.GetMapping("SUM");
        HSVM_ColumnId col_first = stackm.columnnamemapper.GetMapping("FIRST");
        HSVM_ColumnId col_last = stackm.columnnamemapper.GetMapping("LAST");
        HSVM_ColumnId col_min = stackm.columnnamemapper.GetMapping("MIN");
        HSVM_ColumnId col_max = stackm.columnnamemapper.GetMapping("MAX");
        HSVM_ColumnId col_concat = stackm.columnnamemapper.GetMapping("CONCAT");

        col_name = stackm.columnnamemapper.GetMapping("NAME");
        col_field = stackm.columnnamemapper.GetMapping("FIELD");

        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_group, VariableTypes::RecordArray, false), &group);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_groupedvalues, VariableTypes::RecordArray, false), &groupedvalues);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_count, VariableTypes::RecordArray, false), &count);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_counti64, VariableTypes::RecordArray, false), &counti64);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_sum, VariableTypes::RecordArray, false), &sum);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_first, VariableTypes::RecordArray, false), &first);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_last, VariableTypes::RecordArray, false), &last);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_min, VariableTypes::RecordArray, false), &min);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_max, VariableTypes::RecordArray, false), &max);
        SetIdMapping(stackm, stackm.RecordCellTypedRefByName(def, col_concat, VariableTypes::RecordArray, false), &concat);
}

void GroupingDef::CopyCells(StackMachine &stackm, VarId group, VarId rec, MappedIds const &ids, VariableTypes::Type requiretype)
{
        for (MappedIds::const_iterator it = ids.begin(), end = ids.end(); it != end; ++it)
            stackm.CopyFrom(stackm.RecordCellCreate(group, it->second), stackm.RecordCellTypedGetByName(rec, it->first, requiretype, true));
}

void GroupingDef::InitGroup(StackMachine &stackm, VarId group, VarId rec)
{
        for (MappedIds::const_iterator it = count.begin(), end = count.end(); it != end; ++it)
            stackm.SetInteger(stackm.RecordCellCreate(group, it->second), 1);
        for (MappedIds::const_iterator it = counti64.begin(), end = counti64.end(); it != end; ++it)
            stackm.SetInteger64(stackm.RecordCellCreate(group, it->second), 1);
        for (MappedIds::const_iterator it = groupedvalues.begin(), end = groupedvalues.end(); it != end; ++it)
        {
                VarId var = stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true);
                VariableTypes::Type type = stackm.GetType(var);
                type = VariableTypes::Type(type | VariableTypes::Array);
                VarId target = stackm.RecordCellCreate(group, it->second);
                stackm.InitVariable(target, type);
                stackm.CopyFrom(stackm.ArrayElementAppend(target), var);
        }

        CopyCells(stackm, group, rec, sum, VariableTypes::Variant);
        CopyCells(stackm, group, rec, last, VariableTypes::Variant);
        CopyCells(stackm, group, rec, first, VariableTypes::Variant);
        CopyCells(stackm, group, rec, min, VariableTypes::Variant);
        CopyCells(stackm, group, rec, max, VariableTypes::Variant);
        CopyCells(stackm, group, rec, concat, VariableTypes::Variant);
}

void GroupingDef::AddToGroup(StackMachine &stackm, VarId group, VarId rec)
{
        // Count: increase
        for (MappedIds::const_iterator it = count.begin(), end = count.end(); it != end; ++it)
            stackm.SetInteger(stackm.RecordCellRefByName(group, it->second), stackm.GetInteger(stackm.RecordCellGetByName(group, it->second)) + 1);

        // counti64: increase
        for (MappedIds::const_iterator it = counti64.begin(), end = counti64.end(); it != end; ++it)
            stackm.SetInteger64(stackm.RecordCellRefByName(group, it->second), stackm.GetInteger64(stackm.RecordCellGetByName(group, it->second)) + 1);

        // Groupedvalues: Append
        for (MappedIds::const_iterator it = groupedvalues.begin(), end = groupedvalues.end(); it != end; ++it)
        {
                VarId var = stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true);
                VarId target = stackm.RecordCellRefByName(group, it->second);
                stackm.CopyFrom(stackm.ArrayElementAppend(target), var);
        }

        // First: ignore (present value is return value)

        // last: always overwrite with new record
        for (MappedIds::const_iterator it = last.begin(), end = last.end(); it != end; ++it)
            stackm.CopyFrom(stackm.RecordCellRefByName(group, it->second), stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true));

        // concat: use stack_concat
        for (MappedIds::const_iterator it = concat.begin(), end = concat.end(); it != end; ++it)
        {
                VarId target = stackm.RecordCellRefByName(group, it->second);

                stackm.MoveFrom(stackm.PushVariables(1), target);
                stackm.PushCopy(stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true));
                stackm.Stack_Concat();
                stackm.MoveFrom(target, stackm.StackPointer() - 1);
                stackm.PopVariablesN(1);
        }

        // Sum: use Stack_Arith_Add
        for (MappedIds::const_iterator it = sum.begin(), end = sum.end(); it != end; ++it)
        {
                VarId target = stackm.RecordCellRefByName(group, it->second);

                stackm.MoveFrom(stackm.PushVariables(1), target);
                stackm.PushCopy(stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true));
                stackm.Stack_Arith_Add();
                stackm.MoveFrom(target, stackm.StackPointer() - 1);
                stackm.PopVariablesN(1);
        }

        // Min: compare, copy if smaller
        for (MappedIds::const_iterator it = min.begin(), end = min.end(); it != end; ++it)
        {
                VarId target = stackm.RecordCellRefByName(group, it->second);
                VarId source = stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true);
                if (stackm.Compare(target, source, true) > 0)
                    stackm.CopyFrom(target, source);
        }

        // Max: compare, copy if larger
        for (MappedIds::const_iterator it = max.begin(), end = max.end(); it != end; ++it)
        {
                VarId target = stackm.RecordCellRefByName(group, it->second);
                VarId source = stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true);
                if (stackm.Compare(target, source, true) < 0)
                    stackm.CopyFrom(target, source);
        }
}

void GroupingDef::SetIdMapping(StackMachine &stackm, VarId list, MappedIds *target)
{
        if (!list)
            return;

        // Inv: list is a RECORD ARRAY
        unsigned len = stackm.ArraySize(list);
        if (!len)
            return;

        for (unsigned i = 0; i < len; ++i)
        {
                VarId rec = stackm.ArrayElementGet(list, i);
                VarId var_name = stackm.RecordCellTypedGetByName(rec, col_name, VariableTypes::String, true);
                VarId var_field = stackm.RecordCellTypedGetByName(rec, col_field, VariableTypes::String, true);

                Blex::StringPair name = stackm.GetString(var_name);
                Blex::StringPair field = stackm.GetString(var_field);

                target->push_back(std::make_pair(stackm.columnnamemapper.GetMapping(field), stackm.columnnamemapper.GetMapping(name)));
        }
}


// record array currentgroups, record def, record array to_process
void HS_SQL_ProcessRecordGrouping(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId group_array = HSVM_Arg(0);
        VarId grouping_def = HSVM_Arg(1);
        VarId recs = HSVM_Arg(2);

        stackm.MoveFrom(id_set, group_array);
        group_array = id_set;

        GroupingDef def;
        def.InitFromDef(stackm, grouping_def);

        VarId scratch_rec = stackm.NewHeapVariable();

        std::pair< bool, int32_t > pos;
        unsigned rec_count = HSVM_ArrayLength(*vm, recs);
        for (unsigned idx = 0; idx < rec_count; ++idx)
        {
                VarId rec = stackm.ArrayElementGet(recs, idx);
                HSVM_SetDefault(*vm, scratch_rec, HSVM_VAR_Record);

                if (def.group.empty())
                    pos = std::make_pair(idx == 0 ? HSVM_ArrayLength(*vm, group_array) == 1 : true, 0);
                else
                {
                        Blex::SemiStaticPodVector< ColumnNameId, 16 > ids;
                        ids.resize(def.group.size());
                        auto ids_write = ids.begin();

                        // Create grouping records in scratch_rec, then search in group_array
                        for (GroupingDef::MappedIds::iterator it = def.group.begin(), e = def.group.end(); it != e; ++it)
                        {
                                VarId var = stackm.RecordCellTypedGetByName(rec, it->first, VariableTypes::Variant, true);
                                stackm.CopyFrom(stackm.RecordCellCreate(scratch_rec, it->second), var);
                                *(ids_write++) = it->second;
                        }

                        pos = BinaryRecordSearchImpl(vm, group_array, scratch_rec, ids, false);
                }

                // Found position
                if (!pos.first)
                {
                        // Not present yet
                        VarId elt = stackm.ArrayElementInsert(group_array, pos.second);
                        stackm.MoveFrom(elt, scratch_rec);
                        def.InitGroup(stackm, elt, rec);
                }
                else
                {
                        VarId elt = stackm.ArrayElementGet(group_array, pos.second);
                        def.AddToGroup(stackm, elt, rec);
                }
        }
}

} // End of namespace SQLLib

SQLSupport::SQLSupport(VirtualMachine *_vm)
: vm(_vm)
{
        // Make sure the context is registered
        SQLLib::SQLContext context(vm->GetContextKeeper());
}

SQLSupport::~SQLSupport()
{
        Cleanup();
}

void SQLSupport::Cleanup()
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        // Kill all outstanding queries
        context->openqueries.Clear();

        // Kill all outstanding transactions
        context->transactions.Clear();

        // Clear the rest of the data.
        context->bindings.Clear();
        context->reverse_bindings.clear();
}


unsigned SQLSupport::RegisterTransaction(std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > &&new_trans, unsigned rebind_to)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        if (!rebind_to)
        {
                unsigned id = context->transactions.Set(std::move(new_trans));
                TRANS_PRINT("Registered transaction " << new_trans << ", got id " << id);

                context->transactions.Get(id)->get()->sqllib_transid = id;
                return id;
        }
        else
        {
                // Rebinding won't fail
                new_trans->sqllib_transid = rebind_to;

                std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans = context->transactions.Get(rebind_to);
                if (!trans)
                    context->transactions.SetAs(std::move(new_trans), rebind_to);
                else
                {
                        if (*trans)
                            RebindTransaction(trans, std::move(new_trans));
                        else
                            trans->swap(new_trans);
                }
                TRANS_PRINT("Registered transaction " << new_trans << ", rebound to id " << rebind_to);
                return rebind_to;
        }
}

SQLLib::DatabaseTransactionDriverInterface * SQLSupport::GetTransaction(unsigned transid)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans = context->transactions.Get(transid);

        if (!trans)
            return 0;
        else
            return trans->get();
}

void SQLSupport::InvalidateTransaction(SQLLib::DatabaseTransactionDriverInterface *trans)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        // Invalidate all tables bound to this transaction
        for (SQLLib::SQLContextData::BindingStorage::iterator it = context->bindings.begin(); it != context->bindings.end();)
            if (it->driver == trans)
            {
                    context->reverse_bindings.erase(*it);
                    context->bindings.Erase(it++);
            }
            else
                ++it;

        // Murder all queries that associate with this transaction
        for (SQLLib::SQLContextData::OpenQueryStorage::iterator it = context->openqueries.begin(); it != context->openqueries.end();)
            if (it->IsAssociatedWithTrans(trans))
                context->openqueries.Erase(it++);
            else
                ++it;
}

void SQLSupport::ExtractTransaction(unsigned transid, std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *transref)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans = context->transactions.Get(transid);
        if (!trans)
        {
                transref->reset();
                return;
        }

        trans->swap(*transref);
        context->transactions.Erase(transid);
}

void SQLSupport::RebindTransaction(std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans_ref, std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > &&new_trans)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        // Invalidate all tables bound to this transaction
        for (SQLLib::SQLContextData::BindingStorage::iterator it = context->bindings.begin(); it != context->bindings.end(); ++it)
            if (it->driver == trans_ref->get())
            {
                    context->reverse_bindings.erase(*it);
                    it->driver = new_trans.get();
                    context->reverse_bindings.insert(std::make_pair(*it, it.GetId()));
            }

        // Murder all queries that associate with this transaction
        for (SQLLib::SQLContextData::OpenQueryStorage::iterator it = context->openqueries.begin(); it != context->openqueries.end();)
            if (it->IsAssociatedWithTrans(trans_ref->get()))
                context->openqueries.Erase(it++);
            else
                ++it;

        trans_ref->swap(new_trans);
        new_trans.reset(nullptr);
}


void SQLSupport::DeleteTransaction(unsigned transid)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        SQLLib::DatabaseTransactionDriverInterface *trans = GetTransaction(transid);
        TRANS_PRINT("Deleting transaction " << trans << " with id " << transid);

        InvalidateTransaction(trans);
        context->transactions.Erase(transid);
}

HSBindDef SQLSupport::GetBindingInfo(unsigned bindid)
{
        SQLLib::SQLContext context(vm->GetContextKeeper());

        return context->GetBindingInfo(bindid);
}

int32_t SQLSupport::RegisterTypeInfo(DBTypeInfo const &typeinfo)
{
        std::shared_ptr< DBTypeInfo > new_typeinfo;
        new_typeinfo.reset(new DBTypeInfo(typeinfo));

        unsigned new_id = vm->typeinfomapper.Set(new_typeinfo.get());

        custom_typeinfos[new_id] = new_typeinfo;
        return new_id;
}

void SQLSupport::UnregisterTypeInfo(int32_t id)
{
        DBTypeInfo const **typeinfo_ptr = vm->typeinfomapper.Get(id);
        if (!typeinfo_ptr && !*typeinfo_ptr)
            throw VMRuntimeError(Error::InternalError, "Cannot unregister a typeinfo that hasn't been registered first");
        if (!custom_typeinfos.count(id))
            throw VMRuntimeError(Error::InternalError, "Cannot unregister a typeinfo that hasn't been registered first");

        vm->typeinfomapper.Erase(id);
        custom_typeinfos.erase(id);
}

DBTypeInfo const * SQLSupport::GetTypeInfoById(int32_t id)
{
        DBTypeInfo const **typeinfo_ptr = vm->typeinfomapper.Get(id);
        if (!typeinfo_ptr && !*typeinfo_ptr)
            throw VMRuntimeError(Error::InternalError, "Cannot unregister a typeinfo that hasn't been registered first");

        return *typeinfo_ptr;
}

void SQLSupport::Register(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg)
{
        SQLLib::SQLContext::Register(creg);

        using namespace SQLLib;

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("BINDTRANSACTIONTOTABLE::T:IS", HS_SQL_BindTable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("BINDTRANSACTIONTOSCHEMA::C:IS", HS_SQL_BindSchema));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("BINDSCHEMATOTABLE::T:CS", HS_SQL_BindSchemaToTable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETBINDINGFROMTABLE::R:T", HS_SQL_GetBoundTransactionFromTable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETBINDINGFROMSCHEMA::R:C", HS_SQL_GetBoundTransactionFromSchema));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("KEEPTRANSACTIONSALIVE::B:", HS_SQL_KeepTransactionsAlive));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_INSERT:::TIRB", HS_SQL_Insert));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_INSERTMULTIPLE:::TIRAB", HS_SQL_InsertMultiple));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_OPENCURSOR2::I:RAR", HS_SQL_OpenCursor2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_CLOSEQUERY:::I", HS_SQL_CloseQuery));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_OVERWRITERECORD::R:RR", HS_SQL_OverwriteRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_MERGERECORDS::R:RR", HS_SQL_MergeRecords));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_DELETERECORD:::I", HS_SQL_DeleteRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_UPDATERECORD:::IV", HS_SQL_UpdateRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_REORDER_RESULTS::RA:RAS", ReorderResults));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_MAKEDISTINCT::RA:RA", MakeDistinct));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETRECORDFASE1::R:II", HS_SQL_GetRecordFase1));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETRECORDFASE2::R:II", HS_SQL_GetRecordFase2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETRECORDARRAYPOSITION::I:II", HS_SQL_GetRecordArrayPosition));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_REPORTWHERERESULT:::IB", HS_SQL_ReportWhereResult));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETACTION::I:I", HS_SQL_GetAction));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETRECACTION::I:I", HS_SQL_GetAction));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETARRAYRESULTS::RA:I", HS_SQL_GetArrayResults));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_GETGROUPPOSITION::I:RAR", HS_SQL_GetGroupPosition));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_MAKEARRAYOFVALUE::V:V", HS_SQL_MakeArrayOfValue));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_PROCESSRECORDGROUPING::RA:RARRA", HS_SQL_ProcessRecordGrouping));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_SORTARRAY::V:VBB", HS_SQL_SortArray));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_REGISTERTYPEINFO::I:BSA", HS_SQL_RegisterTypeInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_REGISTERTABLETYPEINFO::I:R", HS_SQL_RegisterTableTypeInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_UNREGISTERTYPEINFO:::I", HS_SQL_UnregisterTypeInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_REBINDSCHEMAWITHTYPEINFO::C:CI", HS_SQL_RebindSchemaWithTypeInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_REBINDTABLEWITHTYPEINFO::T:TI", HS_SQL_RebindTableWithTypeInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_DESCRIBETABLETYPEINFO::R:T", HS_SQL_DescribeTableTypeInfo));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RECORDLOWERBOUND::R:RARSA", HS_BinaryRecordLowerBound));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RECORDUPPERBOUND::I:RARSA", HS_BinaryRecordUpperBound));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_LOWERBOUND::R:VV", HS_BinaryLowerBound));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SQL_UPPERBOUND::I:VV", HS_BinaryUpperBound));
}

} // End of namespace HareScript
