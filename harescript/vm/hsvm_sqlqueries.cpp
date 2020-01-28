//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/context.h>
#include <limits>
#include "hsvm_sqlqueries.h"
#include "hsvm_context.h"

namespace HareScript
{
namespace SQLLib
{

namespace
{

/** Maximum number of rows returned per block. Defined to 64 to keep querys to a limited size.
    (A lot of queries need only 1 result, but need a few more db results. If we download a
    whole table per block to get there, it can get horrendously slow.) */
const unsigned int MaxRowsPerBlock = 64;

} // End of anonymous namespace

void ConvertDBQueryToUppercase(DatabaseQuery &query)
{
        for (DatabaseQuery::TableSources::iterator it = query.tables.begin(); it != query.tables.end(); ++it)
            Blex::ToUppercase(it->name.begin(), it->name.end());
}

void SubQuery::PartitionInConditions()
{
        inpartlimit = 1;
        if (!trans)
            return;

        StackMachine &stackm = mainquery->vm->GetStackMachine();

        for (std::vector<SingleCondition>::iterator it = querydef.singleconditions.begin(); it != querydef.singleconditions.end(); ++it)
           if (it->condition == DBConditionCode::In && stackm.GetType(it->value) == VariableTypes::IntegerArray)
           {
                    unsigned len = stackm.ArraySize(it->value);

                    if (len <= 1023)
                        continue;

                    inparts.push_back(IntegerInPart());
                    IntegerInPart &part = inparts.back();

                    part.subs = (len + 1022) / 1023;
                    for (unsigned i = 0; i < len; ++i)
                        part.ints.push_back(stackm.GetInteger(stackm.ArrayElementGet(it->value, i)));
                    part.single_id = std::distance(querydef.singleconditions.begin(), it);

                    inpartlimit *= part.subs;
           }
}

void SubQuery::SetInPart(unsigned partid)
{
        if (inparts.empty())
            return;

        StackMachine &stackm = mainquery->vm->GetStackMachine();

        for (std::list< IntegerInPart >::iterator it = inparts.begin(); it != inparts.end(); ++it)
        {
                unsigned local = partid % it->subs;
                partid /= it->subs;

                SingleCondition &single = querydef.singleconditions[it->single_id];

                unsigned start = local * 1023;
                unsigned limit = std::min<std::size_t>((local + 1) * 1023, it->ints.size());

                stackm.ArrayResize(single.value, limit - start);
                for (unsigned i = 0, e = limit - start; i != e; ++i, ++start)
                    stackm.SetInteger(stackm.ArrayElementRef(single.value, i), it->ints[start]);
        }

}

void SubQuery::Open()
{
        just_opened = true;
        max_block_size = trans ? (trans->description.supports_block_cursors ? MaxRowsPerBlock : 1) : 0;
        querydef.maxblockrows = max_block_size;
        is_deleted.clear();

        if (trans)
        {
                if (trans->description.needs_uppercase_names)
                    ConvertDBQueryToUppercase(querydef);

                if (mainquery->cursortype != DatabaseTransactionDriverInterface::Select && !trans->description.supports_data_modify)
                    throw VMRuntimeError(Error::TransReadOnly);

                InitNullHandling(mainquery->vm, querydef);

                inpartquerynr = 0;

                SetInPart(inpartquerynr);
                ++inpartquerynr;
                cursorid = trans->OpenCursor(querydef, mainquery->cursortype);


                // Did opening fail silently (without throwing)?
                if (!cursorid)
                {
                        // Act like we have an empty resultset
                        trans = 0;
                        just_opened = false;
                }
        }
}

unsigned SubQuery::RetrieveNextBlock()
{
        StackMachine &stackm = mainquery->vm->GetStackMachine();

        first_block = just_opened;

        if (trans)
        {
                just_opened = false;
                // Retrieve blocks until we find one that has a matching row
                while (true)
                {
                        block_length = trans->RetrieveNextBlock(cursorid, rec_array);
                        if (!block_length)
                        {
                                if (inpartquerynr >= inpartlimit)
                                    return 0;

                                trans->CloseCursor(cursorid);
                                cursorid = 0;


                                SetInPart(inpartquerynr);
                                ++inpartquerynr;
                                cursorid = trans->OpenCursor(querydef, mainquery->cursortype);

                                if (!cursorid) // Act like we have an empty resultset
                                    return 0;

                                continue;
                        }

                        if (trans->description.supports_nulls)
                        {
                                unsigned tabcount = querydef.tables.size();
                                for (unsigned tabidx = 0; tabidx < tabcount; ++tabidx)
                                {
                                        TableSource &tc = querydef.tables[tabidx];
                                        for (unsigned rowidx = 0; rowidx < block_length; ++rowidx)
                                        {
                                                VarId rec = stackm.ArrayElementRef(rec_array, rowidx * tabcount + tabidx);
                                                FillWithNullDefaults(stackm, tc, rec, Fases::Fase1);
                                        }
                                }
                        }

                        block_pos = 0;
                        row_is_fase_2.resize(block_length);
                        std::fill(row_is_fase_2.begin(), row_is_fase_2.end(), false);

                        AdvanceWhileInvalid();

                        if (block_pos != block_length || block_length == 0)
                            return block_length;
                }
        }
        else
            if (just_opened)
            {
                    just_opened = false;
                    block_length = stackm.ArraySize(rec_array) / querydef.tables.size();
                    block_pos = 0;

                    AdvanceWhileInvalid();

                    if (block_pos != block_length)
                        return block_length;
                    else
                        return 0;
            }
            else
                return 0;
}

void SubQuery::RetrieveFase2Records(Blex::PodVector< unsigned > const &subelements_org, bool allow_direct_close)
{
        Blex::SemiStaticPodVector< unsigned, 16 > subelements(subelements_org);
        if (trans)
        {
                // Filter out all rows for which we already fetched fase 2.
                auto wit = subelements.begin();
                for (auto itr: subelements)
                {
                        if (!row_is_fase_2[itr])
                        {
                                *(wit++) = itr;
                                row_is_fase_2[itr] = true;
                        }
                }
                subelements.erase(wit, subelements.end());

                if (!subelements.empty())
                {
                        trans->RetrieveFase2Records(cursorid, rec_array, subelements, allow_direct_close);

                        if (trans->description.supports_nulls)
                        {
                                StackMachine &stackm = mainquery->vm->GetStackMachine();

                                unsigned tabcount = querydef.tables.size();
                                for (unsigned tabidx = 0; tabidx < tabcount; ++tabidx)
                                {
                                        TableSource &tc = querydef.tables[tabidx];
                                        for (auto rowitr: subelements)
                                        {
                                                VarId rec = stackm.ArrayElementRef(rec_array, rowitr * tabcount + tabidx);
                                                FillWithNullDefaults(stackm, tc, rec, Fases::Fase2);
                                        }
                                }
                        }
                }
        }
}

bool SubQuery::IsCurrentRowInvalid()
{
        // Const varmem, so it is somewhat safer to use arrayelementget operations
        StackMachine const &varmem = mainquery->vm->GetStackMachine();

        bool is_ok = true;
        // Check all not handled singleconditions
        for (std::vector<SingleCondition>::iterator it = querydef.singleconditions.begin(); it != querydef.singleconditions.end(); ++it)
           if (!it->handled)
           {
                    VarId rec = varmem.ArrayElementGet(rec_array, block_pos * querydef.tables.size() + it->table);
                    is_ok = is_ok && SatisfiesSingle(varmem, *it, rec);
           }
        if (!is_ok)
            return true;
        // Check all not handled joinconditions
        for (std::vector<JoinCondition>::iterator it = querydef.joinconditions.begin(); it != querydef.joinconditions.end(); ++it)
           if (!it->handled)
           {
                    VarId rec1 = varmem.ArrayElementGet(rec_array, block_pos * querydef.tables.size() + it->table1);
                    VarId rec2 = varmem.ArrayElementGet(rec_array, block_pos * querydef.tables.size() + it->table2);
                    is_ok = is_ok && SatisfiesJoin(varmem, *it, rec1, rec2);
           }
        return !is_ok;
}

bool SubQuery::AdvanceWhileInvalid()
{
        for (;block_pos < block_length; ++block_pos)
            if (!IsCurrentRowInvalid())
                break;

        return block_pos != block_length;
}

bool SubQuery::AdvanceCursorWithinBlock()
{
        if (block_pos != block_length)
            ++block_pos;
        return AdvanceWhileInvalid();
}


VarId SubQuery::GetRecord(unsigned tableid)
{
        return mainquery->vm->GetStackMachine().ArrayElementGet(rec_array, block_pos * querydef.tables.size() + tableid);
}

unsigned SubQuery::GetRecordArrayPosition()
{
        // Check for transaction (then we are not a record array). This approach fails if this is the
        // second sq and the data is read into an array before execution.
        if (trans)
            ThrowInternalError("Record array position requested for a table");

        return block_pos;
}

void SubQuery::Close()
{
        if (trans)
        {
                StackMachine &stackm = mainquery->vm->GetStackMachine();
                FreeNullDefaults(stackm, querydef);
                if (cursorid)
                    trans->CloseCursor(cursorid);
                cursorid = 0;
        }
}

void SubQuery::ReadAndCache()
{
        if (trans)
        {
                StackMachine &varmem = mainquery->vm->GetStackMachine();

                VarId results = varmem.NewHeapVariable();
                varmem.ArrayInitialize(results, 0,VariableTypes::RecordArray);

                Open();
                unsigned cursorsize = querydef.tables.size();
                Blex::SemiStaticPodVector< unsigned, 16 > row_request;
                while (RetrieveNextBlock() != 0)
                {
                        // Retrieve only fase 2 records for single-condition matching thingies
                        row_request.clear();
                        while (true)
                        {
                                row_request.push_back(block_pos);
                                if (!AdvanceCursorWithinBlock())
                                    break;
                        }

                        if (!row_request.empty())
                        {
                                RetrieveFase2Records(row_request, true);

                                // Copy the results to the resultset
                                for (auto itr: row_request)
                                    for (unsigned idx = 0; idx < cursorsize; ++idx)
                                        varmem.CopyFrom(varmem.ArrayElementAppend(results), varmem.ArrayElementRef(rec_array, idx + itr * cursorsize));
                        }
                }
                Close();
                varmem.CopyFrom(rec_array, results);
                varmem.DeleteHeapVariable(results);
                trans = 0;
        }
}

DatabaseTransactionDriverInterface::LockResult SubQuery::LockRow()
{
        if (trans)
            return trans->LockRow(cursorid, rec_array, block_pos);
        else
        {
                // What to do in record array case?
                return DatabaseTransactionDriverInterface::Unchanged;
        }
}

void SubQuery::UnlockRow()
{
        if (trans)
            trans->UnlockRow(cursorid, block_pos);
}

void SubQuery::DeleteRow()
{
        if (trans)
            trans->DeleteRecord(cursorid, block_pos);
        else
        {
                if (is_deleted.empty())
                {
                        is_deleted.resize(block_length);
                        std::fill(is_deleted.begin(), is_deleted.end(), false);
                }
                is_deleted[block_pos] = true;
        }
}

void SubQuery::UpdateRow(VarId newvalues)
{
        StackMachine &varmem = mainquery->vm->GetStackMachine();
        if (trans)
        {
                if (trans->description.supports_nulls)
                    DeleteNullDefaults(varmem, querydef.tables[0], newvalues);

                trans->UpdateRecord(cursorid, block_pos, newvalues);
        }
        else
        {
                VarId update_elt = varmem.ArrayElementRef(rec_array, block_pos);

                unsigned count = varmem.RecordSize(newvalues);
                for (unsigned idx = 0; idx < count; ++idx)
                {
                        ColumnNameId nameid = varmem.RecordCellNameByNr(newvalues, idx);
                        VarId elt = varmem.RecordCellRefByName(update_elt, nameid);
                        if (!elt)
                            throw VMRuntimeError(Error::UnknownColumn, mainquery->vm->columnnamemapper.GetReverseMapping(nameid).stl_str());

                        VarId new_elt = varmem.RecordCellRefByName(newvalues, nameid);
                        varmem.CastTo(new_elt, varmem.GetType(elt));
                        varmem.MoveFrom(elt, new_elt);
                }
        }
}

void SubQuery::GetResultArraySource(VarId id_set)
{
        StackMachine &varmem = mainquery->vm->GetStackMachine();
        varmem.MoveFrom(id_set, rec_array);

        unsigned len = varmem.ArraySize(id_set);
        unsigned is_deleted_len = is_deleted.size();

        for (unsigned counter = 0, deleted = 0; counter < len; ++counter)
        {
                if (counter < is_deleted_len && is_deleted[counter])
                {
                        varmem.ArrayElementDelete(id_set, counter - deleted);
                        ++deleted;
                }
        }
}


OpenQuery::OpenQuery(VirtualMachine *_vm, DatabaseTransactionDriverInterface::CursorType _cursortype)
: vm(_vm)
, cursortype(_cursortype)
{
        finished = false;
        just_started = true;
        evaluated_where_ok = false;
        in_fase2 = false;
        limitcounter = -1;
        use_blocks = false;
        fase2needslock = false;
        locked = false;
}


OpenQuery::~OpenQuery()
{
}

void OpenQuery::PartitionSources(QueryDefinition &querydef)
{
        std::vector<QueryDefinition::Source> &sources(querydef.sources);

        unsigned count = 0;
        for (std::vector< QueryDefinition::Source >::iterator it = sources.begin(); it != sources.end(); ++it)
            it->partition_id = ++count;

        // Calculate all partition-id's
        bool run_algo = sources.size() != 1;
        while (run_algo)
        {
                run_algo = false;

                for (std::vector<JoinCondition>::const_iterator it = querydef.joinconditions.begin(); it != querydef.joinconditions.end(); ++it)
                {
                        unsigned new_partition_id = std::min(sources[it->table1].partition_id, sources[it->table2].partition_id);

                        if (sources[it->table1].partition_id != new_partition_id || sources[it->table2].partition_id != new_partition_id)
                        {
                                sources[it->table1].partition_id = new_partition_id;
                                sources[it->table2].partition_id = new_partition_id;
                                run_algo = true;
                        }
                }

                // If we have 2 sources, then one run is sufficient
                if (sources.size() == 2)
                    break;
        };
}

void OpenQuery::DistributeSources(QueryDefinition const &querydef)
{
        std::vector<QueryDefinition::Source> const &sources(querydef.sources);

       // Distribute all selected tables over subqueries
        for (std::vector<QueryDefinition::Source>::const_iterator it =
                sources.begin(); it != sources.end(); ++it)
        {
                bool added = false;

                if (it->trans && it->trans->description.max_joined_tables != 1)
                {
                        // Add this source to an existing sub-query (if it exists)
                        std::vector< SubQuery >::iterator it2 = subqueries.begin();
                        for (; it2 != subqueries.end(); ++it2)
                        {
                                if (it2->GetTransaction() != it->trans || it2->GetPartitionId() != it->partition_id)
                                    continue;
                                if (it2->querydef.tables.size() == it->trans->description.max_joined_tables)
                                    continue;
                                break;
                        }
                        if (it2 != subqueries.end())
                        {
                                table_to_sq_table.push_back(std::make_pair(std::distance(subqueries.begin(), it2), it2->querydef.tables.size()));
                                it2->querydef.tables.push_back(*it);
                                added = true;
                        }
                }
                if (!added)
                {
                        // Add a new subquery
                        // First, get the record array (source for record arrays, cache for database)
                        VarId recarr = it->recarr;
                        if (recarr == 0)
                        {
                                recarr = vm->GetStackMachine().NewHeapVariable();
                                values.push_back(recarr);
                        }
                        SubQuery query(*this, recarr, it->trans, it->partition_id);
                        table_to_sq_table.push_back(std::make_pair(subqueries.size(), query.querydef.tables.size()));
                        query.querydef.tables.push_back(*it);
                        subqueries.push_back(query);
                }
        }
}

void OpenQuery::DistributeConditions(QueryDefinition const &querydef)
{
        // -- Distribute all conditions over the subqueries
        for (std::vector<SingleCondition>::const_iterator it = querydef.singleconditions.begin(); it != querydef.singleconditions.end(); ++it)
        {
                std::pair<unsigned, unsigned> res = table_to_sq_table[it->table];
                subqueries[res.first].querydef.singleconditions.push_back(*it);
                subqueries[res.first].querydef.singleconditions.back().table = res.second;
        }
        for (std::vector<JoinCondition>::const_iterator it = querydef.joinconditions.begin(); it != querydef.joinconditions.end(); ++it)
        {
                std::pair<unsigned, unsigned> res1 = table_to_sq_table[it->table1];
                std::pair<unsigned, unsigned> res2 = table_to_sq_table[it->table2];
                if (res1.first == res2.first)
                {
                        subqueries[res1.first].querydef.joinconditions.push_back(*it);
                        subqueries[res1.first].querydef.joinconditions.back().table1 = res1.second;
                        subqueries[res1.first].querydef.joinconditions.back().table2 = res2.second;
                }
                else
                {
                        subqueries[res1.first].querydef.tables[res1.second].columns[it->column1].fase = Fases::Fase1;
                        subqueries[res2.first].querydef.tables[res2.second].columns[it->column2].fase = Fases::Fase1;

                        RemainingJoinCondition rj(*it);

                        rj.sq_no1 = table_to_sq_table[rj.table1].first;
                        rj.sq_table_no1 = table_to_sq_table[rj.table1].second;
                        rj.sq_no2 = table_to_sq_table[rj.table2].first;
                        rj.sq_table_no2 = table_to_sq_table[rj.table2].second;
                        rj.sq_min = std::min(rj.sq_no1, rj.sq_no2);
                        rj.sq_max = std::max(rj.sq_no1, rj.sq_no2);

                        // Sort the remaining conditions by highest subquery they use
                        std::vector<RemainingJoinCondition>::iterator it2 = remainingjoins.begin();
                        while (it2 != remainingjoins.end())
                        {
                                if (it2->sq_max > rj.sq_max)
                                    break;
                                ++it2;
                        }
                        remainingjoins.insert(it2, rj);
                }
        }
}

void OpenQuery::DistributionFinished()
{
        for (std::vector<SubQuery>::iterator it = subqueries.begin(); it != subqueries.end(); ++it)
             it->PartitionInConditions();
}

void OpenQuery::Open(QueryDefinition &querydef, std::vector<VarId> &_values)
{
        PartitionSources(querydef);
        DistributeSources(querydef);
        DistributeConditions(querydef);
        DistributionFinished();

        // Set limit if applicable
        if (subqueries.size() == 1)
        {
                if (!subqueries[0].GetTransaction() || subqueries[0].GetTransaction()->description.supports_limit)
                    subqueries[0].querydef.limit = querydef.limit;
                else
                    subqueries[0].querydef.limit = -1;
        }
        else
            for (std::vector<SubQuery>::iterator it = subqueries.begin() + 1; it != subqueries.end(); ++it)
                it->ReadAndCache();

        values.insert(values.end(), _values.begin(), _values.end());
        _values.clear();

//        subqueries[0].Open();

        limitcounter = querydef.limit;
        bool onlyone = subqueries.begin() + 1 == subqueries.end();
        use_blocks = onlyone && (subqueries[0].GetTransaction() && subqueries[0].GetTransaction()->description.supports_block_cursors);
        use_fase1 = querydef.has_fase1_hscode;

        if (querydef.limit_blocksize)
            use_blocks = false;

        if (cursortype != DatabaseTransactionDriverInterface::Select)
        {
                fase2needslock = subqueries[0].GetTransaction() && subqueries[0].GetTransaction()->description.needs_locking_and_recheck;
                if (fase2needslock)
                    use_blocks = false;
        }
}

bool OpenQuery::SatisfiesRemainingJoin(RemainingJoinCondition const &cond)
{
        // Get the records we need from the specific queries
        VarId lhs = subqueries[cond.sq_no1].GetRecord(cond.sq_table_no1);
        VarId rhs = subqueries[cond.sq_no2].GetRecord(cond.sq_table_no2);

        return SatisfiesJoin(vm->GetStackMachine(), cond, lhs, rhs);
}

bool OpenQuery::InitializeQuery()
{
        // Open all queries
        std::vector<SubQuery>::iterator it = subqueries.begin();
        for (;it != subqueries.end(); ++it)
        {
                it->Open();
                if (!it->RetrieveNextBlock())
                {
                        // No valid rows in a subquery -> no results from the total query
                        while (true)
                        {
                                it->Close();
                                if (it == subqueries.begin())
                                    break;
                                --it;
                        }
                        return false;
                }
        }

        // All subqueries opened and valid results; check remaining joins
        AdvanceWhileInvalid(true, false);

        return !finished;
}

bool OpenQuery::AdvanceCursorInternal(unsigned &sq_to_advance, bool stop_at_0_block_boundary)
{
        for (unsigned curr_sq = sq_to_advance + 1; curr_sq < subqueries.size(); ++curr_sq)
            if (!subqueries[curr_sq].IsFirstBlock())
            {
                    subqueries[curr_sq].Close();
                    subqueries[curr_sq].Open();
                    if (!subqueries[curr_sq].RetrieveNextBlock())
                    {
                            // Panic management; reopening yielded no results
                            finished = true;
                            return false;
                    }
            }

        // Advance cursor
        while (!subqueries[sq_to_advance].AdvanceCursorWithinBlock())
        {
                // End of block reached.
                if (sq_to_advance == 0 && stop_at_0_block_boundary)
                    return false;
                // Retrieve next block
                if (!subqueries[sq_to_advance].RetrieveNextBlock())
                {
                        if (sq_to_advance == 0)
                        {
                                finished = true;
                                return false;
                        }

                        // No block present. Reset this query, advance cursor of previous subquery
                        subqueries[sq_to_advance].Close();
                        subqueries[sq_to_advance].Open();
                        if (!subqueries[sq_to_advance].RetrieveNextBlock())
                        {
                                // Panic management; reopening yielded no results
                                finished = true;
                                return false;
                        }
                        --sq_to_advance;
                }
                else
                    break;
        }
        return true;
}

/** Advances query cursor while join thingies (or single thingies) are invalid */
bool OpenQuery::AdvanceWhileInvalid(unsigned updated_sq, bool stop_at_0_block_boundary)
{
        // Entry points: 1. at initialization, 2. after advancing the cursor

        while (true)
        {
                // Check all the remaining joins that have changed data
                unsigned sq_mismatch = std::numeric_limits< unsigned >::max();
                for (std::vector<RemainingJoinCondition>::iterator it =
                    remainingjoins.begin(); it != remainingjoins.end(); ++it)
                {
                        if (it->sq_max >= updated_sq && !SatisfiesRemainingJoin(*it))
                            sq_mismatch = std::min(sq_mismatch, it->sq_max);
                }

                if (sq_mismatch == std::numeric_limits< unsigned >::max())
                    return true;

                if (!AdvanceCursorInternal(sq_mismatch, stop_at_0_block_boundary))
                    return false;

                updated_sq = std::min(updated_sq, sq_mismatch);
        }
}

bool OpenQuery::AdvanceCursor(bool stopatblockboundary)
{
        unsigned advanced_sq = subqueries.size() - 1;
        if (!AdvanceCursorInternal(advanced_sq, stopatblockboundary))
            return false;
        return AdvanceWhileInvalid(advanced_sq, stopatblockboundary);
}

void OpenQuery::RetrieveFase2Records(Blex::PodVector< unsigned > const &subelements)
{
        for (std::vector<SubQuery>::iterator it = subqueries.begin(); it != subqueries.end(); ++it)
            it->RetrieveFase2Records(subelements, use_blocks);
}

void OpenQuery::GetRecord(VarId id_set, unsigned tableindex)
{
        StackMachine &varmem = vm->GetStackMachine();
        std::pair<unsigned, unsigned> tabledata = table_to_sq_table[tableindex];

        SubQuery &sq = subqueries[tabledata.first];
        varmem.CopyFrom(id_set, sq.GetRecord(tabledata.second));
}

unsigned OpenQuery::GetRecordArrayPosition(unsigned tableindex)
{
        std::pair<unsigned, unsigned> tabledata = table_to_sq_table[tableindex];

        SubQuery &sq = subqueries[tabledata.first];
        return sq.GetRecordArrayPosition();
}

void OpenQuery::Close()
{
        for (std::vector<SubQuery>::iterator it = subqueries.begin(); it != subqueries.end(); ++it)
            it->Close();
        subqueries.clear();
        for (std::vector<VarId>::iterator it = values.begin(); it != values.end(); ++it)
            vm->GetStackMachine().DeleteHeapVariable(*it);
}

QueryActions::_type OpenQuery::GetNextAction()
{
        if (finished)
            return QueryActions::Terminate;

        SubQuery &sq0 = subqueries[0];

        // Do the startup sequence; find the first matching cursor position
        bool want_fase_1 = false;
        if (just_started)
        {
                just_started = false;

                if (limitcounter == 0 || !InitializeQuery())
                    return QueryActions::Terminate;

                // Valid cursor; do fase 1 stuff
                want_fase_1 = true;
        }

        while (true)
        {
                if (want_fase_1)
                {
                        if (use_fase1)
                            return QueryActions::Fase1Action;

                        // No fase 1 code, act like the code did evaluated_where_ok and then came back here
                        evaluated_where_ok = true;
                }

                /* 5 entry possibilities here:
                   1: just did fase1, result: false             (in_fase2 == false, locked = false, evaluated_where_ok == false)
                        we advance the cursor (stop at block boundary, then move to do fase2 for all in the current block)
                   2: just did fase1, result: true              (in_fase2 == false, locked = false, evaluated_where_ok == true)
                        if fase2needslock, we lock the row, then (unchanged) move to fase2/(changed) reevaluate/(removed) advance the cursor (stop at block boundary, then move to do fase2 for all in the current block)
                        else we mark the row for fase 2.
                   3: just did locked-fase1, result: false      (in_fase2 == false, locked = true, evaluated_where_ok == false, fase2needslock == true)
                        we unlock, advance the cursor to block boundary, then move to do fase2 for all in the current block
                   4: just did locked-fase2, result: true       (in_fase2 == false, locked = true, evaluated_where_ok == true, fase2needslock == true)
                        we mark the row for fase 2.
                   5: just did fase2                            (in_fase2 == true)
                        we unlock if not deleted or updated */
                if (!in_fase2)
                {
                        if (fase2needslock)
                        {
                                if (!locked)
                                {
                                        if (evaluated_where_ok)
                                        {
                                                // Try to lock the current row
                                                switch (sq0.LockRow())
                                                {
                                                case DatabaseTransactionDriverInterface::Unchanged:
                                                    {
                                                            // Inv: evaluated_where_ok == true
                                                            locked = true;
                                                            // Add this to fase2 set (use_blocks is false, so fase2 will be entered immediately)
                                                    } break;
                                                case DatabaseTransactionDriverInterface::Changed:
                                                    {
                                                            locked = true;
                                                            want_fase_1 = true;
                                                            continue;
                                                    }
                                                default:// equals DatabaseTransactionDriverInterface::Removed:
                                                    evaluated_where_ok = false;
                                                }
                                        }
                                }
                                else
                                {
                                        // We're locked, unlock if this row is not necessary
                                        if (!evaluated_where_ok)
                                        {
                                                sq0.UnlockRow();
                                                locked = false;
                                        }
                                }
                        }

                        if (evaluated_where_ok)
                        {
                                // Just did fase1, it was a match. Add to matching rows
                                matchingrows.push_back(sq0.GetCurrentRow());
                                if (limitcounter > 0)
                                    --limitcounter;
                                if (!use_blocks || limitcounter == 0)
                                {
                                        // If we are not using blocks, retrieve immediately, and do fase 2 stuff
                                        RetrieveFase2Records(matchingrows);
                                        in_fase2 = true;
                                }
                        }

                        if (!in_fase2)
                        {
                                // Not in fase2: do the next cursor pos in the current block
                                if (!AdvanceCursor(use_blocks))
                                {
                                        // End of current block reached; do fase 2 with all matching rows
                                        RetrieveFase2Records(matchingrows);
                                        in_fase2 = true;
                                }
                                else
                                {
                                        want_fase_1 = true;
                                        continue;
                                }
                        }
                }
                else
                {
                        // We just got back from a fase2 evaluation. Unlock if it didn't do that
                        if (locked)
                        {
                                sq0.UnlockRow();
                                locked = false;
                        }
                }

                /* Postprocessing for fase2 calls has been done; we must now
                   check wether there are still fase 2 rows left */

                // We're in fase 2 here (Inv: in_fase2 == true)
                if (!matchingrows.empty())
                {
                        // Get the first matching row
                        sq0.SetCurrentRow(matchingrows[0]);
                        matchingrows.erase(matchingrows.begin());
        //                --limitcounter;
                        return QueryActions::Fase2Action;
                }
                else
                    in_fase2 = false;

                // Done with fase 2 (Inv: matchingrows.empty() )
                // Advance the cursor, skipping block boundaries if neccessary
                if (!finished && limitcounter != 0 && AdvanceCursor(false))
                    want_fase_1 = true;
                else
                    return QueryActions::Terminate;
        }
}

void OpenQuery::DeleteRow()
{
        SubQuery &sq0 = subqueries[0];

        sq0.DeleteRow();
        locked = false;
}

void OpenQuery::UpdateRow(VarId newvalues)
{
        SubQuery &sq0 = subqueries[0];

        sq0.UpdateRow(newvalues);
        locked = false;
}

void OpenQuery::GetResultArraySource(VarId id_set)
{
        SubQuery &sq0 = subqueries[0];
        sq0.GetResultArraySource(id_set);
}

bool OpenQuery::IsAssociatedWithTrans(DatabaseTransactionDriverInterface *_trans)
{
        for (std::vector<SubQuery>::iterator it = subqueries.begin(); it != subqueries.end(); ++it)
            if (it->IsAssociatedWithTrans(_trans))
                return true;
        return false;
}

} // End of namespace SQLLib
} // End of namespace HareScript



