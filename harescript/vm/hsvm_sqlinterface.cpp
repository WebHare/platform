//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_sqlinterface.h"
#include "hsvm_context.h"

namespace HareScript
{
namespace SQLLib
{

TableSource::TableSource(const std::string &_name, DBTypeInfo const *_typeinfo)
: name(_name)
, typeinfo(_typeinfo)
, columns(_typeinfo ? _typeinfo->columnsdef.size() : 0)
{
        if (!_typeinfo)
            return;

        std::vector< TableSource::ColumnInfo >::iterator fit = columns.begin();
        for (auto it = _typeinfo->columnsdef.begin(); it != _typeinfo->columnsdef.end(); ++it, ++fit)
        {
                if (it->flags & ColumnFlags::InternalFase1)
                    fit->fase = Fases::Fase1;
                else if (it->flags & ColumnFlags::InternalFase2)
                    fit->fase = Fases::Fase2;
                if (it->flags & ColumnFlags::InternalUpdates)
                    fit->fase |= Fases::Updated;
        }
}

void TableSource::SetFrom(const std::string &_name, DBTypeInfo const &_typeinfo)
{
        name = _name;
        typeinfo = &_typeinfo;
        columns.resize(_typeinfo.columnsdef.size());

        std::vector< TableSource::ColumnInfo >::iterator fit = columns.begin();
        for (auto it = _typeinfo.columnsdef.begin(); it != _typeinfo.columnsdef.end(); ++it, ++fit)
        {
                assert(fit->nulldefault == 0);
                if (it->flags & ColumnFlags::InternalFase1)
                    fit->fase = Fases::Fase1;
                else if (it->flags & ColumnFlags::InternalFase2)
                    fit->fase = Fases::Fase2;
                else
                    fit->fase = Fases::None;
                if (it->flags & ColumnFlags::InternalUpdates)
                    fit->fase |= Fases::Updated;
        }
}


bool SatisfiesSingle(StackMachine const &stackm, SingleCondition const &cond, VarId rec)
{
        // Get the column we need
        VarId column = stackm.RecordCellGetByName(rec, cond.columnid);
        if (!column)
//        if (!stackm.RecordCellCopyByName(rec, cond.columnid, column))
            throw VMRuntimeError(Error::UnknownColumn, stackm.columnnamemapper.GetReverseMapping(cond.columnid).stl_str());

        if (cond.condition == DBConditionCode::Like)
        {
                VariableTypes::Type gottype = stackm.GetType(column);
                if (gottype != VariableTypes::String)
                    throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(gottype), HareScript::GetTypeName(VariableTypes::String));

                return stackm.Like(column, cond.value, cond.casesensitive);
        }
        if (cond.condition == DBConditionCode::In)
        {
                return stackm.SearchElementNoCast(cond.value, column, 0) != -1;
        }

        // Execute the compare.
        // do a compare
        int32_t res = stackm.Compare(column, cond.value, cond.casesensitive);

        switch (cond.condition)
        {
        case DBConditionCode::Less: return res < 0;
        case DBConditionCode::LessEqual: return res <= 0;
        case DBConditionCode::Equal: return res == 0;
        case DBConditionCode::BiggerEqual: return res >= 0;
        case DBConditionCode::Bigger: return res > 0;
        case DBConditionCode::UnEqual: return res != 0;
        default:
            throw VMRuntimeError(Error::InternalError, "Encountered unknown DBConditionCode");
        }
}

bool SatisfiesJoin(StackMachine const &stackm, JoinCondition const &cond, VarId recleft, VarId recright)
{
        // Get the columns we need
        VarId columnleft = stackm.RecordCellGetByName(recleft, cond.columnid1);
        VarId columnright = stackm.RecordCellGetByName(recright, cond.columnid2);

        if (!columnleft)
            throw VMRuntimeError(Error::UnknownColumn, stackm.columnnamemapper.GetReverseMapping(cond.columnid1).stl_str());
        if (!columnright)
            throw VMRuntimeError(Error::UnknownColumn, stackm.columnnamemapper.GetReverseMapping(cond.columnid2).stl_str());

        if (cond.condition == DBConditionCode::In)
        {
                throw VMRuntimeError(Error::InternalError, "In-operation internally not supported for joins");
                return stackm.SearchElementNoCast(columnright, columnleft, 0) != -1;
        }

        if (cond.condition == DBConditionCode::Like)
        {
                // Make sure they're a string, don't worry about changing the variable.
                if (stackm.GetType(columnleft) == VariableTypes::String)
                    if (stackm.GetType(columnright) == VariableTypes::String)
                        return stackm.Like(columnleft, columnright, cond.casesensitive);
                    else
                        throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackm.GetType(columnright)), HareScript::GetTypeName(VariableTypes::String));
                else
                    throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(stackm.GetType(columnleft)), HareScript::GetTypeName(VariableTypes::String));
                // Make sure they're a string, don't worry about changing the variable.
//                stackm.CastTo(columnleft, VariableTypes::String);
//                stackm.CastTo(columnright, VariableTypes::String);
//                return stackm.Like(columnleft, columnright, cond.casesensitive);
        }

        // do a normal compare
        int32_t res = stackm.Compare(columnleft, columnright, cond.casesensitive);

        switch (cond.condition)
        {
        case DBConditionCode::Less: return res < 0;
        case DBConditionCode::LessEqual: return res <= 0;
        case DBConditionCode::Equal: return res == 0;
        case DBConditionCode::BiggerEqual: return res >= 0;
        case DBConditionCode::Bigger: return res > 0;
        case DBConditionCode::UnEqual: return res != 0;
        default:
            throw VMRuntimeError(Error::InternalError, "Encountered unknown DBConditionCode");
        }
}

bool TableColumn::operator < (TableColumn const &rhs) const
{
        if (tablenr < rhs.tablenr)
            return true;
        if (tablenr == rhs.tablenr && columnid < rhs.columnid)
            return true;
        return false;
}

bool EqualsToNullDefault(StackMachine &stackm, TableSource &ts, unsigned idx, VarId value)
{
        if (ts.ColType(idx).flags & ColumnFlags::TranslateNulls)
        {
                if ( (stackm.GetType(value) == VariableTypes::Blob && stackm.GetBlob(value).GetLength()==0)
                     || stackm.Compare(value, ts.columns[idx].nulldefault, true) == 0)
                    return true;
        }
        return false;
}

void FillWithNullDefault(StackMachine &stackm, TableSource &ts, unsigned idx, VarId value)
{
        if ((ts.ColType(idx).flags & ColumnFlags::TranslateNulls) && (ts.ColType(idx).type != VariableTypes::Blob))
            stackm.CopyFrom(value, ts.columns[idx].nulldefault);
        else
            stackm.InitVariable(value, ts.ColType(idx).type);
}

void DeleteNullDefaults(StackMachine &stackm, TableSource &ts, VarId rec)
{
//        DEBUGPRINT("Deleting NULL defaults");
        for (unsigned idx = 0; idx < ts.columncount(); ++idx)
            if (ts.columns[idx].fase & Fases::Updated && ts.ColType(idx).flags & ColumnFlags::TranslateNulls)
            {
                    VarId cell = stackm.RecordCellGetByName(rec, ts.ColType(idx).nameid);
                    if (cell == 0)
                        throw VMRuntimeError(Error::UnknownColumn, ts.ColType(idx).name);

//                    bool is_null = EqualsToNullDefault(stackm, ts, idx, cell);
//                    DEBUGPRINT("Looking at " << ts[idx].name << (EqualsToNullDefault(stackm, ts, idx, cell) ? " NULL" : " OK"));

                    if (EqualsToNullDefault(stackm, ts, idx, cell))
                        stackm.RecordCellDelete(rec, ts.ColType(idx).nameid);
            }
}

void FillWithNullDefaults(StackMachine &stackm, TableSource &ts, VarId rec, Fases::_type fases)
{
        for (unsigned idx = 0; idx < ts.columncount(); ++idx)
            if ((ts.columns[idx].fase & fases) && (stackm.RecordCellGetByName(rec, ts.ColType(idx).nameid) == 0))
                FillWithNullDefault(stackm, ts, idx, stackm.RecordCellCreate(rec, ts.ColType(idx).nameid));
}

void AddMissingDefaultColumns(StackMachine &stackm, TableSource &ts, VarId rec)
{
        // for all non-blob columns that are non inserted and are not null-translated, add the default value
        for (unsigned idx = 0; idx < ts.columncount(); ++idx)
            if (!(ts.columns[idx].fase & Fases::Updated)
                && !(ts.ColType(idx).flags & (ColumnFlags::TranslateNulls | ColumnFlags::Key | ColumnFlags::ReadOnly))
                && ts.ColType(idx).type != VariableTypes::Blob)
            {
                    VarId cell = stackm.RecordCellCreate(rec, ts.ColType(idx).nameid);
                    stackm.InitVariable(cell, ts.ColType(idx).type);
                    ts.columns[idx].fase |= Fases::Updated;
            }
}

void InitNullHandling(VirtualMachine *vm, DatabaseQuery &query)
{
        StackMachine &stackm = vm->GetStackMachine();
        Marshaller marshaller(vm, MarshalMode::DataOnly);

        for (DatabaseQuery::TableSources::iterator it = query.tables.begin(); it != query.tables.end(); ++it)
        {
                unsigned len = it->columncount();
                DBTypeInfo::ColumnsDef const &cd = it->typeinfo->columnsdef;
                for (unsigned idx = 0; idx < len; ++idx)
                    if (cd[idx].flags & ColumnFlags::TranslateNulls && cd[idx].type != VariableTypes::Blob)
                    {
                            VarId var = stackm.NewHeapVariable();
                            if (cd[idx].null_default.size() == 0)
                                throw VMRuntimeError(Error::InternalError, "Missing NULL substitution value");

                            uint8_t const *buf = &cd[idx].null_default[0];
                            uint8_t const *limit = buf + cd[idx].null_default.size();
                            marshaller.Read(var, buf, limit);
                            it->columns[idx].nulldefault = var;
                    }
        }
        if (!query.singleconditions.empty())
        {
                VarId rec = stackm.NewHeapVariable();
                stackm.RecordInitializeEmpty(rec);
                for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
                {
                        if (query.tables[it->table].columns[it->column].nulldefault)
                        {
                                VarId cell = stackm.RecordCellCreate(rec, it->columnid);
                                stackm.CopyFrom(cell, query.tables[it->table].columns[it->column].nulldefault);
                                it->match_null = SatisfiesSingle(stackm, *it, rec);
                                stackm.RecordCellDelete(rec, it->columnid);
                        }
                }
                stackm.DeleteHeapVariable(rec);
        }
        if (!query.joinconditions.empty())
        {
                VarId rec1 = stackm.NewHeapVariable();
                VarId rec2 = stackm.NewHeapVariable();
                stackm.RecordInitializeEmpty(rec1);
                stackm.RecordInitializeEmpty(rec2);
                for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
                {
                        if (query.tables[it->table1].columns[it->column1].nulldefault && query.tables[it->table2].columns[it->column2].nulldefault)
                        {
                                VarId cell1 = stackm.RecordCellCreate(rec1, it->columnid1);
                                stackm.CopyFrom(cell1, query.tables[it->table1].columns[it->column1].nulldefault);
                                VarId cell2 = stackm.RecordCellCreate(rec2, it->columnid2);
                                stackm.CopyFrom(cell2, query.tables[it->table2].columns[it->column2].nulldefault);
                                it->match_double_null = SatisfiesJoin(stackm, *it, rec1, rec2);
                                stackm.RecordCellDelete(rec1, it->columnid1);
                                stackm.RecordCellDelete(rec2, it->columnid2);
                        }
                }
                stackm.DeleteHeapVariable(rec1);
                stackm.DeleteHeapVariable(rec2);
        }
}
void FreeNullDefaults(StackMachine &stackm, DatabaseQuery &query)
{
        for (DatabaseQuery::TableSources::iterator it = query.tables.begin(); it != query.tables.end(); ++it)
        {
                unsigned len = it->columncount();
                for (unsigned idx = 0; idx < len; ++idx)
                {
                        VarId &nullvar = it->columns[idx].nulldefault;
                        if (nullvar)
                        {
                                stackm.DeleteHeapVariable(nullvar);
                                nullvar = 0;
                        }
                }
        }
}

DatabaseTransactionDriverInterface::DatabaseTransactionDriverInterface(VirtualMachine *vm)
: vm(vm)
, description() // value-initialize, so everything is set to default value
{
}

DatabaseTransactionDriverInterface::~DatabaseTransactionDriverInterface()
{
}

bool DatabaseTransactionDriverInterface::KeepAlive()
{
        return true;
}

void DatabaseTransactionDriverInterface::ExecuteInserts(DatabaseQuery const &query, VarId newrecordarray)
{
        StackMachine &stackm = vm->GetStackMachine();

        unsigned rows = stackm.ArraySize(newrecordarray);

        for (unsigned row = 0; row < rows; ++row)
            ExecuteInsert(query, stackm.ArrayElementGet(newrecordarray, row));
}

} // End of namespace SQLLib
} // End of namespace HareScript
