#include <ap/libwebhare/allincludes.h>

#include <iostream>
#include "plan.h"

#include <blex/logfile.h>
#include "dbase_transaction.h"
#include <iomanip>

/** Plan builder: this component devises the most efficient way to execute a query

It takes a Search structure, and transforms it into a tree of Join and Table nodes.
The leafs are always Table nodes, non-leafs always joins.

A Table node has search items, all of which have to be executed on the records of
that table. The table node can have three sources of records:
- a raw table scan
- the output of an index query
- a list of record ids (a sourcelist)
In all cases, all search items must evaluate to true on returned records.

A Join node joins two other nodes together, optionally on a join searchitem. If
present, the Join modifies a search item somewhere on the right hand tree based
on the data it receives from the left hand tree. A join node can also have
more joining searchitems, but evaluates them directly.

Algorithm to build the tree:

- First distribute all single and join items that work on a single table to that
  table.
- Calculate the cost for all possible join orders; choose the order with the
  lowest cost.

Current problems: (ADDME: fix these)
- Getting statistics for an index goes through a lock; the current implementation
  accesses a lot of statistics, so it is a tad slow
- The code determining which multi-column index to use is not very clean;
  it has one entry per index and tries to fill those. If a bad choice is made, that
  is not detected. Also, the code checking if joins help are helped by multi-column
  indices does not check multi-column indices that become usable through a single
  search item.
- Add more level 3 debug output on the decision process
- Better resultcount estimation for multi-column indices; record duplicates for
  every column (dups on first, on first and second, on first, sec, third, etc.

Ways to solve that:
- The multi-column administration should be tree-based; every search item should
  be tried on every extendable node of the administration tree.
- The join-cost calculation code should also use the multi-column administration.
  It now ignores it.
*/

namespace Database
{

namespace DBScanner
{

/* 0 = no debugging
   1 = gimme the search structure
   2 = gimme search structures and plan
   3 = gimme search structures, plan and basic decision info
   4 = insane levels of debugging
   5 = ludicrous levels of debugging
*/
unsigned DebugLevel = 5;

// Serializes planbuilder (for good debug-output)
#define SERIALIZE_PLANBUILDER


namespace
{

template <class T>
 struct ostream_list_helper
{
        T begin;
        T end;
        std::string glue;
        ostream_list_helper(T _begin, T _end, std::string const &_glue) : begin(_begin), end(_end), glue(_glue) {}
        std::ostream & output(std::ostream &out) const;
};
template <class T>
 std::ostream & ostream_list_helper<T>::output(std::ostream &out) const { for (T it = begin; it != end; ++it) { if (it != begin) out << glue; out << *it; } return out; }
template <class T> ostream_list_helper<T> ostream_list(T begin, T end, std::string const &glue) { return ostream_list_helper<T>(begin, end, glue); }
template <class T> std::ostream & operator <<(std::ostream &out, ostream_list_helper<T> const &list) { return list.output(out); }

void ostream_indent(std::ostream &str, unsigned indent)
{
        for (unsigned i=0;i<indent;++i)
          str << "  ";
}

struct ostream_spaces
{
        unsigned nr;
        explicit ostream_spaces(unsigned _nr) : nr(_nr) { }
};
std::ostream & operator << (std::ostream &out, ostream_spaces s)
{
        for (unsigned i=0;i<s.nr;++i)
            out << "  ";
        return out;
}

} // end of anonymous namespace



SearchRelationType ReverseRelationType(SearchRelationType type)
{
        switch (type)
        {
        case SearchSmaller:             return SearchBigger;
        case SearchSmallerEqual:        return SearchBiggerEqual;
        case SearchBiggerEqual:         return SearchSmallerEqual;
        case SearchBigger:              return SearchSmaller;
        case SearchLike:                throw Exception(ErrorInternal, "Trying to reverse operands of LIKE");
        case SearchIn:                  throw Exception(ErrorInternal, "Trying to reverse operands of IN");
        default:                        return type;
        }
}

void TableOptimizationData::Initialize()
{
        // Invalidate multis
        for (unsigned i=0; i<MaxIndexMultiTrackCount; ++i)
            multis[i].index = 0;

        // Initialize best
        best.index = 0;
        best.itemcount = 0;
        best.selectivity = 1.0f;
}

bool TableOptimizationData::TryRecordMultiColumnIndex(Index::IndexData *data, SearchItemId item)
{
        assert(data->GetDescriptor().num_indexed_columns != 1);

        for (unsigned i=0; i<MaxIndexMultiTrackCount; ++i)
            if (!multis[i].index) // Entry free?
            {
                    IndexQueryData &use = multis[i];
                    use.index = data;
                    use.itemids[0] = item;
                    use.itemcount = 1;
                    use.can_extend = true;
                    use.selectivity = 1.0f;
                    return true;
            }
        return false;
}

Plan::Plan(unsigned table_count)
: tables(table_count)
, joins(table_count - 1)
, top(0)
{
}

PlanBuilder::PlanBuilder(BackendTransaction &trans, Search &_searchfor)
: trans(trans)
, searchfor(_searchfor)
{
}

// Checks search for validity, sort sourcelists
void PlanBuilder::CheckAndOptimizeSearch()
{
        // Lookup tabledefs and sort sourcelists
        for (std::vector< Search::Table >::iterator it = searchfor.tables.begin(), end = searchfor.tables.end(); it != end; ++it)
        {
                if (it->sourcelist.get())
                    it->sourcelist->Optimize();
        }
        // Check all search items
        for (std::vector< Search::Item >::iterator it = searchfor.items.begin(); it != searchfor.items.end(); ++it)
        {
                if (it->relation == SearchLike && it->columndef->type != TText)
                    throw Exception(ErrorInternal, "LIKE can only be applied to text fields");
                if (it->relation == SearchIn)
                {
                        if (it->columndef->type != TInteger)
                            throw Exception(ErrorInternal, "LIKE can only be applied to integer fields");
                        if (it->type == SearchItemType::JoinTables)
                            throw Exception(ErrorInternal, "IN can only be applied to single items");
                }
                switch (it->type)
                {
                case SearchItemType::SingleItem:
                        {
                                if (it->singleitem.cell_index < 0)
                                    throw Exception(ErrorInvalidArg,"Invalid search data");
                                if (it->relation == SearchIn)
                                {
                                        Cell cell(&searchfor.scandata[it->singleitem.cell_index]);
                                        if ((cell.Size() & 3) != 0)
                                            throw Exception(ErrorInternal, "Invalid data in value for IN-constraint (length is not a multiple of 4 bytes)");
                                }
                        }; break;
                case SearchItemType::JoinTables:
                        {
                                if (it->columndef->type != it->joinitem.columndef2->type)
                                    throw Exception(ErrorInternal,"Can't join columns of different type");
                        }; break;
                default:
                    throw Exception(ErrorInternal,"Unknown search item type");
                }
        }
}

// Estimate the size of a table
unsigned PlanBuilder::EstimateTableSize(TableDef const *tabledef)
{
        /* Estimate the size of a table by the number of entries in the index.
           Update speed of this statistics is of course dependent on the time
           between janitor cleanups. */

        // Default count to return in case of no data at all.
        static unsigned default_count = 100; // FIXME: is 100 a correct estimate?

        unsigned total_count = default_count;

        Blex::Index::Statistics stats;

        if (tabledef->primarykey) // A primary key?
        {
                // Check all indices on the primary key. If one matches, we have what we need.
                ColumnDef const *cdef = tabledef->GetColumnDef(tabledef->primarykey);
                for (std::vector<Index::IndexData::Ref>::const_iterator iit = cdef->indices.begin(); iit != cdef->indices.end(); ++iit)
                {
                        if ((*iit)->GetDescriptor().nonullstores || !(*iit)->GetStatistics(&stats))
                            continue;

                        // Unique index; so duplicates must be invisible. Get the best estimate possible.
                        total_count = stats.totalentries - stats.duplicates;

                        SCANNERDEBUGPRINT(3, "  Estimating size of table " << tabledef->name << " to be " << total_count << " records, using primary key index");

                        return total_count;
                }
        }

        // No primary, or primary index not ready. Check all other unique columns (more desperate)
        TableDef::Columns const &columns = tabledef->GetColumns();
        for (TableDef::Columns::const_iterator it = columns.begin(), end = columns.end(); it != end; ++it)
            for (std::vector<Index::IndexData::Ref>::const_iterator iit = it->second.indices.begin(); iit != it->second.indices.end(); ++iit)
            {
                    if ((*iit)->GetDescriptor().nonullstores || !(*iit)->GetStatistics(&stats))
                        continue;

                    if (it->second.unique)
                    {
                            // Unique index; so duplicates are not visible. Best estimate possible.
                            total_count = stats.totalentries - stats.duplicates;

                            SCANNERDEBUGPRINT(3, " Estimating size of table " << tabledef->name << " to be " << total_count << " records, using index on unique column " << it->second.name);

                            return total_count;
                    }
                    else
                    {
                            // Total entry-count of any index is better estimate than default_count.
                            total_count = stats.totalentries;

                            // Process next column
                            break;
                    }
            }

        // Show whether why we got our estimate (if index estimate is 100, this borks but we don't care).
        if (total_count == default_count)
            SCANNERDEBUGPRINT(3, " Estimating size of table " << tabledef->name << " to be " << total_count << " records, by default (no ready indices found)");
        else
            SCANNERDEBUGPRINT(3, " Estimating size of table " << tabledef->name << " to be " << total_count << " records, by non-unique index");

        return total_count;
}

// Collect statistics for a query run
void PlanBuilder::CollectTableStatistics(Plan &plan)
{
        SCANNERDEBUGPRINT(3, " Collect table statistics");
        for (std::vector< PlanTable >::iterator it = plan.tables.begin(); it != plan.tables.end(); ++it)
        {
                TableDef const *tabledef = searchfor.tables[it->tablenr].tabledef;

                unsigned table_size = EstimateTableSize(tabledef);
                it->statistics.total_rows = table_size;

                if (it->sourcelist.get())
                {
                        it->statistics.visited_rows_per_query = it->sourcelist->records.size();

                        SCANNERDEBUGPRINT(3, "  Using sourcelist for table " << tabledef->name << " with " << it->statistics.visited_rows_per_query << " records");
                }
                else
                {
                        it->statistics.visited_rows_per_query = table_size;
                }

                it->statistics.row_access_cost = 1;

                // FIXME: set cost of accessing a row based on read access manager cost
//                if (tabledef->name == "FOLDERS" || tabledef->name == "FILES")
//                    it->statistics.row_access_cost = 10.0;

                SCANNERDEBUGPRINT(3, "  Table #" << it->tablenr << " rows " << it->statistics.visited_rows_per_query << " rowcost " << it->statistics.row_access_cost);
        }
}

// Try to get an index to resolve a specific search item (single or join)
Index::IndexData * PlanBuilder::GetIndex(Plan &plan, SearchItemId id, Search::Item &item, bool for_join_second)
{
        // Handling an index for SearchUnEqual queries is not useful
        if (item.relation == SearchUnEqual/* || item.relation == SearchIn*/)
            return 0;

        // Like is only useful in very specific cases.
        if (item.relation == SearchLike)
        {
                // Don't do joins
                if (item.type != SearchItemType::SingleItem)
                    return 0;
                // Can only use index for LIKE constraints that have a known prefix
                if (item.datacell.Size() == 0 || *item.datacell.Begin() == (uint8_t)'?' || *item.datacell.Begin() == (uint8_t)'*')
                    return 0;
        }

        Index::IndexData *idata(0);

        unsigned tableindex = for_join_second ? item.joinitem.tableindex2 : item.tableindex;
        ColumnDef const *cdef = for_join_second ? item.joinitem.columndef2 : item.columndef;
        for (std::vector<Index::IndexData::Ref>::const_iterator iit = cdef->indices.begin(); iit != cdef->indices.end(); ++iit)
        {
                // Check if case sensitivity matches the request
                if (((*iit)->GetDescriptor().storage[0] == Index::StoreUppercase) == item.case_sensitive)
                    continue; // Case sensitivity didn't match

                // Furhter check if the index is usable for this table
                if (!CheckIndexUsable((*iit)->GetDescriptor(), tableindex))
                    continue;

                Index::IndexData *data = iit->Get();
                if (data && data->IsReady())
                {
                        // We preferably want single-column indices; they are better result estimators
                        if (!idata || idata->GetDescriptor().num_indexed_columns != 1)
                            idata = data;

                        /* If this is a searchequal single item, it will always be used. So, if this is a
                           multi-column index, it is useful to record it, to find the best index to use */
                        if (data->GetDescriptor().num_indexed_columns != 1 && item.type == SearchItemType::SingleItem && item.relation == SearchEqual)
                        {
                                TableOptimizationData &todata(plan.tables[item.tableindex].data);
                                todata.TryRecordMultiColumnIndex(data, id);
                        }
                }
        }

        // Return index, if found
        return idata;
}

// Find the best index to use for a specific table
void PlanBuilder::FindBestSearchForTables(Plan &plan)
{
        SCANNERDEBUGPRINT(3, " Finding best search for single tables");

        for (std::vector< PlanTable >::iterator pit = plan.tables.begin(), pend = plan.tables.end(); pit != pend; ++pit)
        {
                SCANNERDEBUGPRINT(3, "  Look at table #" << pit->tablenr);

                /* Put all conditions that work on internal fields last. Does only pit->items.size() iterations, and moves items
                   to the back, so every item will only be looked at once */
                for (unsigned idx = 0, end = pit->items.size(), cur = 0; idx < end; ++idx)
                {
                        SearchItemId itemid = pit->items[cur];
                        Search::Item &item = searchfor.items[itemid];

                        // ADDME: also do this for self-joins?
                        if (item.type != SearchItemType::SingleItem)
                            continue;

                        if (item.columndef->internalcolumn_handler)
                        {
                                pit->items.erase(pit->items.begin() + cur);
                                pit->items.push_back(itemid);
                        }
                        else
                            ++cur;
                }

                TableOptimizationData &data(pit->data);

                data.best.selectivity = 1.0;
                data.best.itemcount = 1;
                data.best.can_extend = false;
                data.best.index = 0;

                // Don't go searching for index when we have a sourcelist
                if (pit->sourcelist.get())
                    continue;

                for (std::vector< SearchItemId >::const_iterator it = pit->items.begin(), end = pit->items.end(); it != end; ++it)
                {
                        Search::Item &item = searchfor.items[*it];
                        if (item.type != SearchItemType::SingleItem)
                            continue;

                        if (item.index && item.singleitem.selectivity < data.best.selectivity)
                        {
                                data.best.index = item.index;
                                data.best.itemids[0] = *it;
                                data.best.selectivity = item.singleitem.selectivity;
                        }
                }


                SCANNERDEBUGONLY(4, if (data.best.index) { SCANNERDEBUGPRINT(4, "   Best single item index for item #" << data.best.itemids[0] << " selectivity " << data.best.selectivity); });

                // Are there any multi-column indices found already (if so, the first is initialized)
                if (data.multis[0].index)
                {
                        // Check all indices
                        for (unsigned i=0; i < MaxIndexMultiTrackCount && data.multis[i].index; ++i)
                        {
                                IndexQueryData &multi = data.multis[i];

                                SCANNERDEBUGPRINT(4, "   Test multi " << multi.index->GetDescriptor().GetName() << ", current items " << ostream_list(multi.itemids, multi.itemids + multi.itemcount, " "));

                                if (multi.index && multi.can_extend)
                                {
                                        // Try to add another column to this index-query.
                                        Index::Descriptor const &desc = multi.index->GetDescriptor();

                                        // Go through 2 times, first time use only case matches, second time add one (only one) case mismatch if present
                                        bool any_changes;
                                        bool try_case_mismatch = false; // try case-sensitive search on insensitive index?
                                        do
                                        {
                                                SCANNERDEBUGPRINT(5, "    Loop extend");
                                                any_changes = false;
                                                unsigned itempos = multi.itemcount;

                                                bool store_raw = desc.storage[itempos] != Index::StoreUppercase;
                                                ColumnId colid = desc.columns[itempos];

                                                // Check all search items for quitability
                                                for (auto it = pit->items.begin(), end = pit->items.end(); it != end; ++it)
                                                {
                                                        Search::Item &item = searchfor.items[*it];

                                                        SCANNERDEBUGPRINT(5, "     Check item #" << std::distance(pit->items.begin(), it));

                                                        // Is this item relevant?
                                                        if (item.type != SearchItemType::SingleItem || item.columndef->column_id != colid || item.relation == SearchUnEqual || item.relation == SearchIn)
                                                        {
                                                                SCANNERDEBUGPRINT(5, "     - wrong column/not single/is != or IN");
                                                                continue;
                                                        }
                                                        // With a raw stored index, we can't resolve case insensitive queries.
                                                        if (store_raw && !item.case_sensitive)
                                                        {
                                                                SCANNERDEBUGPRINT(5, "     - Case insensitive item, but index is case sensitive");
                                                                continue;
                                                        }
                                                        // With an uppercase index we can resolve a case sensitive query, but only as last resort
                                                        if (!store_raw && item.case_sensitive && !try_case_mismatch)
                                                        {
                                                                SCANNERDEBUGPRINT(5, "     - Case sensitive item, but index is case insensitive (and not in last resort mode)");
                                                                continue;
                                                        }
                                                        if (desc.nonullstores && item.canseenulls)
                                                        {
                                                                SCANNERDEBUGPRINT(5, "     - Index doesn't store nulls, but item can see NULLs");
                                                                continue;
                                                        }

                                                        assert(itempos < desc.num_indexed_columns);

                                                        SCANNERDEBUGPRINT(4, "    Add single item #" << *it);

                                                        // Add it to the list of search items for this index
                                                        multi.itemids[itempos] = *it;
                                                        ++multi.itemcount;
                                                        multi.can_extend = item.relation == SearchEqual && multi.itemcount != desc.num_indexed_columns;
                                                        if (item.relation == SearchEqual && multi.itemcount == desc.num_indexed_columns)
                                                        {
                                                                // Multi is full. Set selectivity to full index selectivity
                                                                Blex::Index::Statistics stats;
                                                                if (multi.index->GetStatistics(&stats) && stats.totalentries != 0)
                                                                {
                                                                        unsigned unique_values = stats.totalentries - stats.duplicates;
                                                                        multi.selectivity = 1.0f / unique_values;
                                                                }
                                                        }
                                                        else
                                                        {
                                                                if (multi.itemcount == 2)
                                                                {
                                                                        // First item was an equal search, so we can use the selectivity of the first search item
                                                                        Search::Item const &firstitem = searchfor.items[multi.itemids[0]];
                                                                        if (firstitem.type == SearchItemType::SingleItem)
                                                                            multi.selectivity = firstitem.singleitem.selectivity;
                                                                }

                                                                // Assume that every relation other than SearchUnEqual filters half
                                                                // This also causes preference to use a multi index with multiple search items over a single index
                                                                multi.selectivity *= 0.5f;
                                                        }
                                                        any_changes = true;
                                                        break;
                                                }

                                                // Stop if all columns done, or a case mismatch has been tried.
                                                if (!multi.can_extend || try_case_mismatch)
                                                    break;
                                                if (!any_changes && !try_case_mismatch)
                                                {
                                                        SCANNERDEBUGPRINT(5, "    No changes, retry with allowing case mismatch");
                                                        any_changes = true;
                                                        try_case_mismatch = true;
                                                }
                                        }
                                        while (any_changes);
                                        SCANNERDEBUGPRINT(5, "    No changes, loop finished");
                                }
                                else
                                {
                                        SCANNERDEBUGPRINT(5, "   - Could not extend:" << (multi.index?"":" !index") << (multi.can_extend ? "": " !can_extend"));
                                }

                                // FIXME: try to calculate the number of results from this multicolumn index user
                                if (multi.itemcount > data.best.itemcount || multi.selectivity < data.best.selectivity)
                                    data.best = multi;
                        }
                }

                SCANNERDEBUGONLY(3,
                {
                        std::stringstream ss;
                        ss << "  Table #" << std::distance(plan.tables.begin(), pit) << ": ";
                        if (data.best.index)
                        {
                                ss << "Best index: " << data.best.index->GetDescriptor().GetName();
                                ss << " using items";
                                for (unsigned i = 0; i < data.best.itemcount; ++i)
                                    ss << " " << data.best.itemids[i];
                                ss << ", selectivity: " << data.best.selectivity;
                        }
                        else
                            ss << "No viable index found";
                        SCANNERDEBUGPRINT(3, ss.str());
                });


                if (!data.best.index)
                    continue;

                // Set data about index to use
                pit->index = data.best.index;
                std::copy(data.best.itemids, data.best.itemids + data.best.itemcount, pit->indexitemids);
                pit->indexitemcount = data.best.itemcount;
        }
}

void PlanBuilder::InitializePlan(Plan &plan, bool copy_sourcelist)
{
        unsigned tablecount = searchfor.tables.size();
        if (tablecount == 0)
            throw Exception(ErrorInvalidArg, "No tables specified in search");

        for (unsigned idx = 0; idx < tablecount; ++idx)
        {
                PlanTable &table = plan.tables[idx];
                table.tablenr = idx;
                table.data.Initialize();
                if (copy_sourcelist)
                    table.sourcelist = searchfor.tables[idx].sourcelist;
        }
}

void PlanBuilder::DistributeSingleSourceDataCells()
{
        // Distribute all single conditions over the tables
        unsigned criteriacount = searchfor.items.size();
        for (unsigned idx = 0; idx < criteriacount; ++idx)
        {
                Search::Item &item = searchfor.items[idx];
                if (item.type == SearchItemType::SingleItem)
                {
                        // Set data cell
                        item.datacell = Cell(&searchfor.scandata[item.singleitem.cell_index]);
                }
        }
}

void PlanBuilder::DistributeSingleSourceItems(Plan &plan)
{
        // Distribute all single conditions over the tables
        unsigned criteriacount = searchfor.items.size();
        for (unsigned idx = 0; idx < criteriacount; ++idx)
        {
                Search::Item &item = searchfor.items[idx];
                if (item.type == SearchItemType::SingleItem)
                {
                        // Calculate total return selectivity.
                        plan.tables[item.tableindex].items.push_back(idx);
                        plan.tables[item.tableindex].statistics.return_selectivity *= item.singleitem.selectivity;
                }
                else // It's a join
                {
                        /* If both sides of the join concern the same table,
                           it's not a two-table join and we can handle it immediately */
                        if (item.tableindex == item.joinitem.tableindex2)
                        {
                                item.joinitem.handled = true;
                                plan.tables[item.tableindex].items.push_back(idx);
                        }
                        else
                        {
                                //We need two tables, defer handling
                                item.joinitem.handled = false;
                        }
                }
        }
}

// FIXME: split this function up into first getting of the index, then invoking the remains of this one
void PlanBuilder::SetJoinSelectivities(Search::Item &item, SourceResults const &left_table_stats, SourceResults const &right_table_stats)
{
        // Get real table sizes
        unsigned left_table_size_estimate = left_table_stats.total_rows;
        unsigned right_table_size_estimate = right_table_stats.total_rows;

        if (item.relation == SearchUnEqual) // Unequal search, treat as non-selective
        {
                item.joinitem.selectivity_left = 1.0;
                item.joinitem.selectivity_right = 1.0;
        }
        else if (item.relation != SearchEqual) // Relation search, estimate half of table
        {
                item.joinitem.selectivity_left = 0.5;
                item.joinitem.selectivity_right = 0.5;
        }
        else
        {
                TableDef const *lhs_table = static_cast< TableDef const * >(item.columndef->parent_object);
                TableDef const *rhs_table = static_cast< TableDef const * >(item.joinitem.columndef2->parent_object);

                if (item.columndef->foreignreference == rhs_table->object_id)
                {
                        // Left references right.
                        // Total join results: count(left).
                        // We assume every row in right is referenced, so when right is fixed, (1/right_table_size) of the left table will be returned
                        item.joinitem.selectivity_left = right_table_size_estimate ? 1.0 / right_table_size_estimate : 0;
                        // Every left row references only one right row, so (1/right_table_size) of the right table is referenced
                        item.joinitem.selectivity_right = right_table_size_estimate ? 1.0 / right_table_size_estimate : 0;
                }
                else if (item.joinitem.columndef2->foreignreference == lhs_table->object_id)
                {
                        // Right references left.
                        // Total join results: count(right).
                        // We assume every row in left is referenced, so when left is fixed, (1/left_table_size) of the right table will be returned
                        item.joinitem.selectivity_left = left_table_size_estimate ? 1.0 / left_table_size_estimate : 0;
                        // Every right row references only one left row, so (1/left_table_size) of the left table is referenced
                        item.joinitem.selectivity_right = left_table_size_estimate ? 1.0 / left_table_size_estimate : 0;
                }
                else
                {
                        if (item.columndef->unique || lhs_table->primarykey == item.columndef->column_id)
                        {
                                // Left column is unique.
                                item.joinitem.selectivity_left = left_table_size_estimate ? 1.0 / left_table_size_estimate : 0;
                        }
                        else
                        {
                                // Fixme: use statistics: (total rows / (total rows - duplicates)) / left_table_size_estimate
                                item.joinitem.selectivity_left = 0.1;
                        }

                        if (item.joinitem.columndef2->unique || rhs_table->primarykey == item.joinitem.columndef2->column_id)
                        {
                                // Right column is unique.
                                item.joinitem.selectivity_right = right_table_size_estimate ? 1.0 / right_table_size_estimate : 0;
                        }
                        else
                        {
                                // Fixme: use statistics: (total rows / (total rows - duplicates)) / left_table_size_estimate
                                item.joinitem.selectivity_right = 0.1;
                        }
                }
        }
}

void PlanBuilder::SetSingleSelectivity(Search::Item &item, unsigned table_size_estimate)
{
        // We trust the table_size_estimate estimate more than the size of the index.
        if (item.relation == SearchEqual || item.relation == SearchIn)
        {
                ColumnDef const *columndef = item.columndef;
                TableDef const &tabledef = static_cast< TableDef const & >(*columndef->parent_object);

                unsigned search_count = 1;
                if (item.relation == SearchIn)
                {
                        Cell cell(&searchfor.scandata[item.singleitem.cell_index]);
                        search_count = cell.Size() / 4;
                }

                // Unique or primary column: every search finds 1 item per searched item
                if (columndef->unique || tabledef.primarykey == columndef->column_id)
                {
                        item.singleitem.selectivity = table_size_estimate ? 1.0 / table_size_estimate * search_count: 0;

                        if (item.singleitem.selectivity >= 0.999)
                            item.singleitem.selectivity = 0.999;

                        return;
                }

                Index::IndexData *indexdata = item.index;
                if (indexdata)
                {
                        Blex::Index::Statistics stats;
                        if (indexdata->GetStatistics(&stats))
                        {
                                // Calc number of unique values. If 0, return 0.
                                unsigned unique_values = stats.totalentries - stats.duplicates;
                                if (unique_values == 0)
                                {
                                        item.singleitem.selectivity = 0;
                                        return;
                                }

                                // Multiplicity is total number of values divided by number of unique values
                                item.singleitem.selectivity = 1.0 / unique_values * search_count;

                                // FIXME: if only one value is present in the table, the assumption only present values are queried for can bite us. Quick fix for that.
                                if (item.singleitem.selectivity >= 0.999)
                                    item.singleitem.selectivity = 0.999;

                                return;
                        }
                }

                // Can't do an educated guess... return 1/10 of the table. FIXME: is that wise performence-wise?
                item.singleitem.selectivity = 0.1;
        }
        else if (item.relation == SearchUnEqual)
          item.singleitem.selectivity = 1.0; // Unequal search, treat as non-selective
        else
          item.singleitem.selectivity = 0.5; // Relation search, estimate half of table
}

void PlanBuilder::SetSearchItemsNullness()
{
        SCANNERDEBUGPRINT(3, " Calculate whether search items column values can be NULL");

        bool changed = false;
        for (auto it = searchfor.items.begin(), end = searchfor.items.end(); it != end; ++it)
        {
                it->canseenulls = !it->columndef->notnull;
                if (it->type == SearchItemType::JoinTables)
                {
                        if (it->joinitem.columndef2->notnull)
                        {
                                it->canseenulls = false;
                                changed = true;
                        }
                }
                else
                {
                        if ((IsCellNull(it->datacell, it->columndef->type) && it->relation == SearchUnEqual)
                              || (!IsCellNull(it->datacell, it->columndef->type) && it->relation == SearchEqual))
                        {
                                it->canseenulls = false;
                                changed = true;
                        }
                }

                SCANNERDEBUGONLY(5, if (!it->canseenulls) { SCANNERDEBUGPRINT(4, "  Item #" << std::distance(searchfor.items.begin(), it) << " can't see null values based on search item/column defs"); });
        }

        // Loop while propgation does something
        while (changed)
        {
                changed = false;

                SCANNERDEBUGPRINT(4, "  propagation step");

                // Propagation step
                for (auto it = searchfor.items.begin(), end = searchfor.items.end(); it != end; ++it)
                {
                        if (it->canseenulls)
                            continue;

                        SCANNERDEBUGPRINT(5, "   look at item #" << std::distance(searchfor.items.begin(), it));

                        for (auto it2 = searchfor.items.begin(); it2 != end; ++it2)
                        {
                                if (!it2->canseenulls)
                                    continue;

                                if (it->UsesSameColumn(*it2))
                                {
                                        it2->canseenulls = false;
                                        changed = true;

                                        SCANNERDEBUGPRINT(4, "   propagated to #" << std::distance(searchfor.items.begin(), it2));
                                }
                                else
                                {
                                        SCANNERDEBUGPRINT(5, "   item #" << std::distance(searchfor.items.begin(), it2) << " doesn't use the same columns");
                                }

                        }
                }
        }
}

void PlanBuilder::SetSearchItemsIndicesAndSelectivities(Plan &plan)
{
        SCANNERDEBUGPRINT(3, " Calculate search items indices & selectivities ");
        SearchItemId id = 0;
        for (std::vector< Search::Item >::iterator it = searchfor.items.begin(), end = searchfor.items.end(); it != end; ++it, ++id)
        {
                PlanTable const &left_table = plan.tables[it->tableindex];
                it->index = GetIndex(plan, id, *it, false);
                if (it->type == SearchItemType::SingleItem)
                {
                        SetSingleSelectivity(*it, left_table.statistics.visited_rows_per_query);
                        SCANNERDEBUGPRINT(3, "  Single item #" << id << ", result fraction: " << it->singleitem.selectivity << " index: " << (it->index ? "yes" : "no"));
                }
                else
                {
                        PlanTable const &right_table = plan.tables[it->joinitem.tableindex2];
                        it->joinitem.index2 = GetIndex(plan, id, *it, true);
                        SetJoinSelectivities(*it, left_table.statistics, right_table.statistics);
                        SCANNERDEBUGPRINT(3, "  Join item #" << id << ", selectivity lhs: " << it->joinitem.selectivity_left << ", rhs: " << it->joinitem.selectivity_right << " index: " << (it->index ? "yes" : "no"));
                }
        }
}

SearchItemId PlanBuilder::ConstructJoinDriverItem(SearchItemId itemid, bool drive_left_side)
{
        // Allocate new item (note: this is only safe with an &item reference because we reserve()d when building the query
        unsigned new_itemid = searchfor.items.size();
        searchfor.items.resize(new_itemid + 1);
        Search::Item &item = searchfor.items[itemid];
        Search::Item &new_item = searchfor.items[new_itemid];

        // Construct relation
        new_item.type = SearchItemType::SingleItem;
        new_item.case_sensitive = item.case_sensitive;
        new_item.singleitem.cell_index = -1;
        new_item.canseenulls = item.canseenulls;
        if (drive_left_side)
        {
                new_item.relation = item.relation;
                new_item.tableindex = item.tableindex;
                new_item.columndef = item.columndef;
        }
        else
        {
                new_item.relation = ReverseRelationType(item.relation);
                new_item.tableindex = item.joinitem.tableindex2;
                new_item.columndef = item.joinitem.columndef2;
        }
        return new_itemid;
}

void PlanBuilder::BuildDrivenJoinNode_2(Plan &plan, PlanSource *left, PlanSource *right, PlanJoin &join, DirectedJoinItemList const &items)
{
        unsigned item_count = 0;
        //prevent search.items reallocation
        searchfor.items.reserve(searchfor.items.size() + items.count);

        for (unsigned idx = 0; idx < items.count; ++idx)
        {
                SearchItemId itemid = items.items[idx].id;
                bool is_switched = items.items[idx].switched;

                Search::Item &item = searchfor.items[itemid];
                if (item.type != SearchItemType::JoinTables) // Skip singles
                    continue;

                SearchItemId driverid = ConstructJoinDriverItem(itemid, is_switched);
                join.joins[item_count].driver = driverid;

                // Set index and selectivity
                Search::Item &driver = searchfor.items[driverid];
                driver.index = item_count != 0 ? 0 : (is_switched ? item.index : item.joinitem.index2);
                driver.singleitem.selectivity = is_switched ? item.joinitem.selectivity_left : item.joinitem.selectivity_right;

                join.joins[item_count].source_tablenr = is_switched ? item.joinitem.tableindex2 : item.tableindex;
                join.joins[item_count].source_columndef = is_switched ? item.joinitem.columndef2 : item.columndef;
                plan.tables[is_switched ? item.tableindex : item.joinitem.tableindex2].items.push_back(driverid);

                item.joinitem.handled = true;

                // If tracking multi's would help, add this one
                if (item_count == 0 && driver.relation == SearchEqual && driver.index && driver.index->GetDescriptor().num_indexed_columns != 1)
                {
                        TableOptimizationData &todata(plan.tables[driver.tableindex].data);
                        todata.TryRecordMultiColumnIndex(driver.index, driverid);
                }
                ++item_count;
        }
        join.join_count = item_count;
        join.left = left;
        join.right = right;
        join.left->parent = &join;
        join.right->parent = &join;
}

void PlanBuilder::BuildCarthesianJoinNode_2(Plan &/*plan*/, PlanSource *left, PlanSource *right, PlanJoin &join)
{
        // Setup join node.
        join.left = left;
        join.right = right;

        join.left->parent = &join;
        join.right->parent = &join;
}

std::unique_ptr< Plan > PlanBuilder::Construct()
{
        unsigned table_count = searchfor.tables.size();

        std::unique_ptr< Plan > plan(new Plan(table_count));

#if defined(DEBUG) && defined(SERIALIZE_PLANBUILDER)
        static Blex::Mutex buildermutex(true);
        Blex::Mutex::AutoLock builderlock(buildermutex);
#endif
        SCANNERDEBUGPRINT(3, "Starting planning by new planner");

        // Set original item count
        searchfor.original_item_count = searchfor.items.size();

        SCANNERDEBUGPRINT(1, "Building a plan for " << searchfor.Dump());

        // Reserve item space - as we may need to add additional items to
        // build join driver items, reserve for as many tables. More items may
        // be allocated, but reallocations will only occur in more extreme cases
        if (table_count != 1)
            searchfor.items.reserve(searchfor.items.size() + searchfor.tables.size());

        // Optimize source lists and do some more checks
        CheckAndOptimizeSearch();

        // Initialize the table sources
        InitializePlan(*plan, true);

        // Collect table statistics
        CollectTableStatistics(*plan);

        // Distribute cell values for single items
        DistributeSingleSourceDataCells();

        // Determine which items will see NULL values
        SetSearchItemsNullness();

        // Calculate search items fractions, and get indices
        SetSearchItemsIndicesAndSelectivities(*plan);

        // Distribute single source items (uses selectivities)
        DistributeSingleSourceItems(*plan);

        // Find the best search for the tables
        FindBestSearchForTables(*plan);

        // We're done if we're only have one table.
        if (table_count == 1)
        {
                plan->top = &plan->tables[0];

                SCANNERDEBUGPRINT(2, "Planning done, result:");
                SCANNERDEBUGONLY(2, std::stringstream str; plan->Dump(str,searchfor); SCANNERDEBUGPRINT(2, str.str()));
                return plan;
        }

        JoinPoint best[MaxTablesInQuery];
        CalculateAllCosts(*plan, best);

        // Build tree from joinpoints; also builds new driver items and sets their indices + selectivities
        plan->top = BuildTreeFromJoinPoints(*plan, best, table_count);

        SCANNERDEBUGPRINT(5, "Tree built from join points");
        SCANNERDEBUGONLY(5, std::stringstream str; plan->Dump(str,searchfor); SCANNERDEBUGPRINT(5, str.str()));

        // Find the best search for the tables
        FindBestSearchForTables(*plan);

        SCANNERDEBUGPRINT(2, " New joiner result:");
        SCANNERDEBUGONLY(2, std::stringstream str; plan->Dump(str,searchfor);SCANNERDEBUGPRINT(2, str.str()));

        return plan;
}

bool PlanBuilder::CheckIndexUsable(Index::Descriptor const &desc, unsigned tableindex)
{
        SCANNERDEBUGPRINT(5, "  Check index " << desc.GetName() << " for use in table #" << tableindex);

        if (!desc.nonullstores)
        {
                SCANNERDEBUGPRINT(5, "  - stores nulls, no problem");
                return true;
        }

        /* If the index ignores nulls, we must make sure all columns it contains won't see nulls
           (due to constraints from search items or from column definitions
        */
        for (unsigned columnnr = 0; columnnr < desc.num_indexed_columns; ++columnnr)
        {
                unsigned column_id = desc.columns[columnnr];
                bool canseenulls = true;

                // First check the search items for this column
                for (auto &item: searchfor.items)
                {
                        if (item.canseenulls || !item.UsesColumn(tableindex, column_id))
                            continue;

                        canseenulls = false;
                        break;
                }

                if (!canseenulls)
                    continue;

                // Then the column definition
                // No search item that forces this column to non-null. Get the columndef to see column is non-null
                auto *tabledef = searchfor.tables[tableindex].tabledef;
                auto *cdef = tabledef->GetColumnDef(column_id);

                // If the column doesn't exist or values can be null, the index isn't usable
                if (!cdef || !cdef->notnull)
                {
                        SCANNERDEBUGPRINT(5, "  - failed, columnnr " << columnnr << " with id #" << column_id << " can be NULL, can't use index");
                        return false;
                }
        }

        // All columns checked and ok.
        SCANNERDEBUGPRINT(5, "  - ok, all columns forced to non-NULL");
        return true;
}

bool PlanBuilder::GetBestJoinListIterate(Plan &plan, Index::Descriptor const &desc, unsigned columnnr, Blex::PodVector< DirectedJoinItem > const &relevant_items, Blex::PodVector< SearchItemId > const &single_equal_items, DirectedJoinItemList &best)
{
        assert(columnnr < Index::MaxCellsPerIndex && columnnr < desc.num_indexed_columns);

        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "  GetBestJoinListIterate enter");

        // Add extra item
        bool is_best = false;
        for (Blex::PodVector< DirectedJoinItem >::const_iterator it = relevant_items.begin(); it != relevant_items.end(); ++it)
        {
                Search::Item &item = searchfor.items[it->id];
                ColumnDef const *columndef = it->switched ? item.columndef : item.joinitem.columndef2;

                SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   check directed joint item #" << it->id);

                // Skip if it cannot be added to the index at the current position
                if (desc.columns[columnnr] != columndef->column_id
                        || (desc.storage[columnnr] == Index::StoreRaw && !item.case_sensitive && columndef->type >= BaseDynamicType)
                        || item.relation == SearchUnEqual)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   - wrong column/case mismatch/relation is '!='");
                        continue;
                }

                // We can add! Test if better.
                if (best.count < columnnr + 1)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   adding item #" << it->id << " to this multi");
                        best.count = columnnr + 1;
                        best.items[columnnr] = *it;
                        is_best = true;
                }

                // Can we add more items to this search
                if (columnnr == Index::MaxCellsPerIndex - 1
                        || columnnr == desc.num_indexed_columns - 1
                        || item.relation != SearchEqual
                        || (desc.storage[columnnr] != Index::StoreUppercase) != item.case_sensitive)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   - can't add more items to this multi");
                        continue; // No, we're full.
                }

                bool this_best = GetBestJoinListIterate(plan, desc, columnnr + 1, relevant_items, single_equal_items, best);
                if (this_best)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   adding item #" << it->id << " to this multi after iteration returns new best");
                        best.items[columnnr] = *it;
                        is_best = true;
                }
        }
        for (Blex::PodVector< SearchItemId >::const_iterator it = single_equal_items.begin(); it != single_equal_items.end(); ++it)
        {
                Search::Item &item = searchfor.items[*it];
                ColumnDef const *columndef = item.columndef;

                SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   check single item #" << *it);

                // Skip if it cannot be added to the index at the current position
                if (desc.columns[columnnr] != columndef->column_id
                        || (desc.storage[columnnr] == Index::StoreRaw && !item.case_sensitive && columndef->type >= BaseDynamicType)
                        || item.relation == SearchUnEqual)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   - wrong column/case mismatch/relation is '!='");
                        continue;
                }

                // We can add! Test if better.
                if (best.count < columnnr + 1)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   adding item #" << *it << " to this multi");
                        best.count = columnnr + 1;
                        best.items[columnnr].id = *it;
                        best.items[columnnr].switched = false;
                        is_best = true;
                }

                // Can we add more items to this search
                if (columnnr == Index::MaxCellsPerIndex - 1
                        || columnnr == desc.num_indexed_columns - 1
                        || item.relation != SearchEqual
                        || (desc.storage[columnnr] != Index::StoreUppercase) != item.case_sensitive)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   - can't add more items to this multi");
                        continue; // No, we're full.
                }

                bool this_best = GetBestJoinListIterate(plan, desc, columnnr + 1, relevant_items, single_equal_items, best);
                if (this_best)
                {
                        SCANNERDEBUGPRINT(5, ostream_spaces(columnnr) << "   adding item #" << *it << " to this multi after iteration returns new best");
                        best.items[columnnr].id = *it;
                        best.items[columnnr].switched = false;
                        is_best = true;
                }
        }

        SCANNERDEBUGPRINT(2, ostream_spaces(columnnr) << "  GetBestJoinListIterate exit, is best: " << is_best);
        return is_best;
}

Index::IndexData * PlanBuilder::GetBestJoinList(Plan &plan, Blex::PodVector< DirectedJoinItem > const &relevant_items, Blex::PodVector< SearchItemId > const &single_equal_items, DirectedJoinItemList &result_items)
{
        assert(!relevant_items.empty());

        /* FIXME: the current algorithm doesn't detect which combo is the best, taking the index with the highest number of
           columns bound is probably not teh best. Pending performance problems, this is not yet solved. More infrastructure
           is needed to detect selectivities of martial filled multi-column queries */

        // Only one item? We are done very quickly! :-)
        if (relevant_items.size() == 1 && single_equal_items.empty())
        {
                result_items.count = 1;
                result_items.items[0] = relevant_items[0];

                Search::Item &item = searchfor.items[result_items.items[0].id];
                return result_items.items[0].switched ? item.index : item.joinitem.index2;
        }

        /* FIXME: the following procedure only works with max 2-column multi-indices. It should be extended for 3/4-column
           indices too. */
        result_items.count = 0;
        Index::IndexData *best_index = 0;

        // First check relevant joining items
        for (Blex::PodVector< DirectedJoinItem >::const_iterator it = relevant_items.begin(); it != relevant_items.end(); ++it)
        {
                Search::Item &item = searchfor.items[it->id];
                ColumnDef const *columndef = it->switched ? item.columndef : item.joinitem.columndef2;
                unsigned tableindex = it->switched ? item.tableindex : item.joinitem.tableindex2;

                // Don't allow SearchUnEqual for indices.
                if (item.relation == SearchUnEqual)
                    continue;

                SCANNERDEBUGPRINT(3, " Check directed join item #" << it->id << (it->switched ? " (switched)" : ""));

                for (std::vector< Index::IndexData::Ref >::const_iterator iit = columndef->indices.begin(); iit != columndef->indices.end(); ++iit)
                {
                        if (!(*iit)->IsReady())
                            continue;
                        Index::Descriptor const &desc = (*iit)->GetDescriptor();
                        if ((desc.storage[0] != Index::StoreUppercase) != item.case_sensitive)
                            continue;
                        if (!CheckIndexUsable(desc, tableindex))
                            continue;

                        SCANNERDEBUGPRINT(3, " Evaluating index " << (*iit)->GetDescriptor().GetName());
                        bool is_best = GetBestJoinListIterate(plan, desc, 0, relevant_items, single_equal_items, result_items);
                        if (is_best)
                            best_index = iit->Get();
                }
        }

        // Then, check single items.
        for (Blex::PodVector< SearchItemId >::const_iterator it = single_equal_items.begin(); it != single_equal_items.end(); ++it)
        {
                SCANNERDEBUGPRINT(3, " Check single equality item #" << *it);

                Search::Item &item = searchfor.items[*it];
                ColumnDef const *columndef = item.columndef;
                for (std::vector< Index::IndexData::Ref >::const_iterator iit = columndef->indices.begin(); iit != columndef->indices.end(); ++iit)
                {
                        if (!(*iit)->IsReady())
                            continue;
                        Index::Descriptor const &desc = (*iit)->GetDescriptor();
                        if ((desc.storage[0] != Index::StoreUppercase) != item.case_sensitive)
                            continue;
                        if (!CheckIndexUsable(desc, item.tableindex))
                            continue;

                        SCANNERDEBUGONLY(3,
                        {
                                std::stringstream ss;
                                ss << " Evaluating index ";
                                for (unsigned i = 0; i < desc.num_indexed_columns; ++i)
                                    ss << desc.columns[i] << " ";
                                SCANNERDEBUGPRINT(3, ss.str());
                        } );
                        bool is_best = GetBestJoinListIterate(plan, desc, 0, relevant_items, single_equal_items, result_items);
                        if (is_best)
                            best_index = iit->Get();
                }
        }

        SCANNERDEBUGONLY(3,
        {
                if (best_index)
                {
                        std::stringstream ss;
                        ss << "  Best index: " << best_index->GetDescriptor().GetName();
                        ss << " using items";
                        for (unsigned i = 0; i < result_items.count; ++i)
                            ss << " " << result_items.items[i].id << (result_items.items[i].switched ? "(rev)" : "");
                        SCANNERDEBUGPRINT(3, ss.str());
                } else SCANNERDEBUGPRINT(3, "  No viable index found");
        } );

        // Found a good index? Modify the index used by the join to use that index.
        if (best_index)
        {
                assert(result_items.count != 0);
                Search::Item &item = searchfor.items[result_items.items[0].id];
                if (result_items.items[0].switched)
                    item.index = best_index;
                else
                    item.joinitem.index2 = best_index;
        }

        return best_index;
}

bool PlanBuilder::CalculateCR(Plan &plan, unsigned *_tables, unsigned count, CostResults const &current, JoinPoint best[MaxTablesInQuery], double &best_cost)
{
        unsigned tables[MaxTablesInQuery];
        std::copy(_tables, _tables + count, tables);
        unsigned *tables_end = tables + count;

        // Debug output the current cost/results state
        SCANNERDEBUGONLY(3, /*if (count == searchfor.tables.size())*/ { std::stringstream ss; for (unsigned i = 0; i < count; ++i) ss << tables[i] << " "; SCANNERDEBUGPRINT(3, "  Join order " << ss.str() << " total results: " << current.results << " cost: " << current.cost); } );

        // Check if we are done, or if we have already exceeded beyond a previous best cost
        if (count == searchfor.tables.size())
        {
                // All joined, check if the cost is the best yet.
                if (best_cost < 0 || best_cost > current.cost)
                {
                        best_cost = current.cost;
                        return true;
                }
                return false;
        }
        else
        {
                // Cost cannot decrease, so if the cost is higher than the best found yet, quit.
                if (current.cost > best_cost && best_cost >= 0)
                    return false;
        }

        // Calculate table count
        unsigned table_count = plan.tables.size();
        unsigned item_count = searchfor.original_item_count;

        // List of relevant items, and whether they must be switched. Normal: lhs is already known, rhs is added.
        typedef Blex::PodVector< DirectedJoinItem > ItemIdList;
        ItemIdList relevant_items;
        DirectedJoinItemList joinitems;
        joinitems.count = 0;

        // We now iterate over all tables not yet in our tables list
        bool any_joined = false;
        CostResults new_cr;
        bool is_best = false;
        for (unsigned t_idx = 0; t_idx < table_count; ++t_idx)
        {
                // If this table is already processed, next table
                if (std::find(tables, tables_end, t_idx) != tables_end)
                    continue;

                // Gather all join items that join this new table to the ones we already have
                relevant_items.clear();
                for (unsigned i_idx = 0; i_idx < item_count; ++i_idx)
                {
                        Search::Item &item = searchfor.items[i_idx];

                        //Skip  handled items and non joins
                        if (item.type != SearchItemType::JoinTables || item.joinitem.handled)
                            continue;

                        assert(item.tableindex != item.joinitem.tableindex2); // Should already be added to the recordmappers.

                        // Check the item, add if necessary
                        if (item.joinitem.tableindex2 == t_idx && std::find(tables, tables_end, item.tableindex) != tables_end)
                            relevant_items.push_back(DirectedJoinItem(i_idx, false));
                        else if (item.tableindex == t_idx && std::find(tables, tables_end, item.joinitem.tableindex2) != tables_end)
                            relevant_items.push_back(DirectedJoinItem(i_idx, true));
                }

                // For this round, we only consider good joinable tables, skipping carthesians.
                if (relevant_items.empty())
                    continue;

                // From this point on, the join cannot fail.
                any_joined = true;

                // Find the table
                PlanTable &table = plan.tables[t_idx];
                Index::IndexData *idata = 0;
                if (!table.sourcelist.get()) // Only test indices when not using a sourcelist
                {
                        /* We now have the relevant items, and whether they must be switched or not
                           For every order, we must check if an index can solve 'm all (or at least as much as possible)
                           We can safely choose the index with the lowest selectivity, the results cannot change later in the
                           cost calculation process anymore. */
                        Blex::PodVector< SearchItemId > single_equals;
                        for (std::vector< SearchItemId >::iterator it = table.items.begin(); it != table.items.end(); ++it)
                        {
                                Search::Item &item = searchfor.items[*it];
                                if (item.type != SearchItemType::SingleItem || item.relation != SearchEqual)
                                    continue;
                                single_equals.push_back(*it);
                        }
                        idata = GetBestJoinList(plan, relevant_items, single_equals, joinitems);
                }
                // FIXME: do GOOD cost calculation, taking into account singles, and the real index usage.

                // Calculate selectivity for all relevant items
                double selectivity = 1;
                for (ItemIdList::const_iterator it = relevant_items.begin(); it != relevant_items.end(); ++it)
                {
                        Search::Item &item = searchfor.items[it->id];
                        selectivity *= it->switched ? item.joinitem.selectivity_left : item.joinitem.selectivity_right;
                }

                // Calculate new cost and results
                if (idata)
                {
                        Blex::Index::Statistics stats;
                        selectivity = 1.0;
                        if (idata->GetStatistics(&stats) && stats.totalentries != 0)
                        {
                                unsigned unique_values = stats.totalentries - stats.duplicates;
                                selectivity = 1.0 / unique_values;
                        }
                        double new_access = current.results * selectivity * table.statistics.visited_rows_per_query + 0.5;
                        new_cr.results = new_access * table.statistics.return_selectivity + 0.5;
                        new_cr.cost = current.cost + new_access * table.statistics.row_access_cost;
                }
                else
                {
                        double new_access = current.results * table.statistics.visited_rows_per_query + 0.5;
                        new_cr.results = new_access * selectivity * table.statistics.return_selectivity + 0.5;
                        new_cr.cost = current.cost + new_access * table.statistics.row_access_cost;
                }
                if (new_cr.results == 0)
                    new_cr.results = 1;

                // Recurse for all tables not yet done
                tables[count] = t_idx;
                if (CalculateCR(plan, tables, count + 1, new_cr, best, best_cost))
                {
                        best[count].tableidx = t_idx;
                        best[count].itemlist.count = joinitems.count;
                        std::copy(joinitems.items, joinitems.items + joinitems.count, best[count].itemlist.items);
                        is_best = true;
                }
        }

        if (!any_joined)
        {
                // No join is available; this means there are multiple components in the join graph.

                /* ADDME: the best way to solve this would to execute cost processing for the other
                   component, and then carthesian join those queries */

                // Per table not in our set, add it and exec cost processing
                for (unsigned i = 0; i < count; ++i)
                    if (std::find(tables, tables_end, i) == tables_end)
                    {
                            CostResults cr;
                            SetCostResultsForSingleTableSelect(plan.tables[i], &cr);

                            new_cr.results = current.results * cr.results;
                            new_cr.cost = current.cost * cr.cost;

                            tables[count] = i;
                            if (CalculateCR(plan, tables, count + 1, new_cr, best, best_cost))
                            {
                                    best[count].tableidx = i;
                                    best[count].itemlist.count = 0;
                                    is_best = true;
                            }
                    }
        }

        return is_best;
}

void PlanBuilder::SetCostResultsForSingleTableSelect(PlanTable const &table, CostResults *cr)
{
        // Calculate results (return_selectivity also includes selectivity of index, if used)
        double results = table.statistics.visited_rows_per_query * table.statistics.return_selectivity + 0.5;

        // Calculate cost
        double visited_rows = table.statistics.visited_rows_per_query;

        // If using an index, we are visiting less records, so the cost goes down.
        if (table.index)
            visited_rows *= table.data.best.selectivity;
        double cost = visited_rows * table.statistics.row_access_cost;

        SCANNERDEBUGPRINT(3, "  Cost/results for table " << table.tablenr << " results " << results << " rows " << visited_rows << " cost " << cost << " (per row " << table.statistics.row_access_cost << ")");

        // Set expected results to a minimum of one, in case estimates were wrong. Expecting 0 results has a big impact on cost.
        if (results < 0.5)
            results = 1;

        *cr = CostResults(cost, results);
}

void PlanBuilder::CalculateAllCosts(Plan &plan, JoinPoint best[MaxTablesInQuery])
{
        double best_cost(-1);
        best[0].itemlist.count = 0;

        SCANNERDEBUGPRINT(3, " Calculating all costs");


        for (unsigned i = 0; i < plan.tables.size(); ++i)
        {
                PlanTable &table = plan.tables[i];

                CostResults cr;
                SetCostResultsForSingleTableSelect(table, &cr);

                if (CalculateCR(plan, &i, 1, cr, best, best_cost))
                    best[0].tableidx = i;
        }

        SCANNERDEBUGONLY(3,
            {
                    std::stringstream ss;
                    for (unsigned i = 0; i < plan.tables.size(); ++i)
                    {
                            ss << best[i].tableidx << " ";
                            for (unsigned idx = 0; idx < best[i].itemlist.count; ++idx)
                                ss << "(by " << best[i].itemlist.items[idx].id << (best[i].itemlist.items[idx].switched ? ",rev) " : ") ");
                    }
                    SCANNERDEBUGPRINT(3, "  Best join: " << ss.str() << "cost: " << best_cost);
            }
        );
}

PlanSource * PlanBuilder::BuildTreeFromJoinPoints(Plan &plan, JoinPoint best[MaxTablesInQuery], unsigned table_count)
{
        PlanSource *new_tops[MaxTablesInQuery];

        PlanSource *top = &plan.tables[best[0].tableidx];
        for (unsigned i = 1; i < table_count; ++i)
        {
                if (best[i].itemlist.count != 0)
                {
                        BuildDrivenJoinNode_2(plan, top, &plan.tables[best[i].tableidx], plan.joins[i-1], best[i].itemlist);
                }
                else
                {
                        BuildCarthesianJoinNode_2(plan, top, &plan.tables[best[i].tableidx], plan.joins[i-1]);
                }
                top = &plan.joins[i-1];
                new_tops[i] = top;
        }

        for (SearchItemId idx = 0; idx < searchfor.original_item_count; ++idx)
        {
                Search::Item &item = searchfor.items[idx];
                if (item.type == SearchItemType::JoinTables && !item.joinitem.handled)
                {
                        // Unhandled join.
                        bool found_left(false), found_right(false);

                        for (unsigned tidx = 0; tidx < table_count; ++tidx)
                        {
                                if (best[tidx].tableidx == item.tableindex)
                                    found_left = true;
                                if (best[tidx].tableidx == item.joinitem.tableindex2)
                                    found_right = true;
                                if (found_left && found_right)
                                {
                                        if (tidx == 0)
                                            throw Exception(ErrorInternal, "Didn't mark a join on a single table as handled");
                                        new_tops[tidx]->items.push_back(idx);
                                }
                        }
                }
        }

        return top;
}

// -----------------------------------------------------------------------------
//
// Plan dumping functions
//

void Plan::DumpItem(std::ostream &str, unsigned indent, Search::Item const &item, Search const &searchfor, signed indexid, unsigned itemid) const
{
        ostream_indent(str, indent);
        str << "- #" << itemid << " ";
        switch (item.type)
        {
        case SearchItemType::SingleItem:
            {
                    str << "T" << item.tableindex << "." << item.columndef->name << " " << item.relation;
                    if (item.singleitem.cell_index < 0)
                        str << " join-driven";
                    else
                    {
                            Cell cell(&searchfor.scandata[item.singleitem.cell_index]);
                            if (item.relation != SearchIn)
                            {
                                    Blex::StringPair data = cell.StringPair();
                                    for (char const *it = data.begin; it != data.end; ++it)
                                    {
                                            str << " ";
                                            str << std::hex << std::setw(2) << std::setfill('0') << (uint32_t)*(uint8_t const *)it;
                                    }
                                    str << std::setw(0) << std::setfill(' ') << std::dec;
                            }
                            else
                            {
                                str << " [";
                                uint8_t const *curr = cell.Begin();
                                for (unsigned idx = 0, size = cell.Size() / 4; idx < size; ++idx)
                                {
                                        str << (idx == 0 ? "" : ", ") << Blex::getu32lsb(curr);
                                        curr += 4;
                                }
                                str << "] (" << cell.Size() / 4 << " items)";
                            }
                    }
                    if (!item.case_sensitive) str << " (case insensitive)";
                    if (indexid >= 0) str << " (index: " << indexid << ")";
                    str << std::endl;
            } break;
        case SearchItemType::JoinTables:
            {
                    str << "T" << item.tableindex << "." << item.columndef->name << " " << item.relation << " ";
                    str << "T" << item.joinitem.tableindex2 << "." << item.joinitem.columndef2->name;
                    if (!item.case_sensitive) str << " (case insensitive)";
                    str << std::endl;
            }; break;
        };
}

void Plan::DumpTable(std::ostream &str, unsigned indent, PlanTable const &item, Search const &search) const
{
        ostream_indent(str, indent);
        str << "Table " << search.GetTable(item.tablenr).tabledef->name << " (T" << item.tablenr << ")";
        bool raw_scan = true;
        if (item.index)
        {
                str << "(index on: ";
                for (unsigned i=0; i < item.indexitemcount; ++i)
                {
                        if (i!=0) str << ", ";
                        str << search.items[item.indexitemids[i]].columndef->name;
                }
                str << ")";
                raw_scan = false;
        }
        if (item.sourcelist.get())
        {
                str << "(with sourcelist)";
                raw_scan = false;
        }
        if (raw_scan)
            str << "(raw scan)";
        if (item.items.empty())
            str << "(no items)" << std::endl;
        else
        {
                str << std::endl;
                unsigned id = 0;
                for (std::vector< SearchItemId >::const_iterator it = item.items.begin(); it != item.items.end(); ++it, ++id)
                {
                        signed indexid = -1;
                        if (item.index)
                          for (unsigned i=0; i < item.indexitemcount; ++i)
                            if (item.indexitemids[i] == *it)
                              indexid = i;

                        DumpItem(str, indent, search.items[*it], search, indexid, *it);
                }
        }
}

void Plan::DumpJoin(std::ostream &str, unsigned indent, PlanJoin const &item, Search const &search) const
{
        ostream_indent(str, indent);
        str << "Join";
        if (item.items.empty())
            str << " (no items)" << std::endl;
        else
        {
                str << std::endl;
                for (std::vector< SearchItemId >::const_iterator it = item.items.begin(); it != item.items.end(); ++it)
                {
                        ostream_indent(str, indent + 1);
                        str << "Aft: ";
                        DumpItem(str, 0, search.items[*it], search, -1, *it);
                }
        }
        DumpSource(str,indent+1,*item.left,search);
        DumpSource(str,indent+1,*item.right,search);
}

void Plan::DumpSource(std::ostream &str, unsigned indent, PlanSource const &item, Search const &search) const
{
        if (PlanTable const *table = item.is_table())
          DumpTable(str, indent, *table, search);
        else if (PlanJoin const *join = item.is_join())
          DumpJoin(str, indent, *join, search);
}

void Plan::Dump(std::ostream &str, Search const &search) const
{
        str << "Plan:" << std::endl;
        DumpSource(str, 1, *top, search);
}

} // End of anonymous DBScanner

} // End of namespace Database
