#include <ap/libwebhare/allincludes.h>


#include <sstream>
#include "searches.h"
#include "dbase_backend.h"
#include <iomanip>

namespace Database
{

SourceList::SourceList(std::vector< RecordId > const &_records, bool _allow_sort)
: allow_sort(_allow_sort)
{
        records = _records;
}

void SourceList::Optimize()
{
        if (allow_sort)
        {
                std::sort(records.begin(), records.end());
        }
        else
        {
                opt_sorted_records = records;
                std::sort(opt_sorted_records.begin(), opt_sorted_records.end());
        }
}

bool SourceList::Contains(RecordId rec)
{
        if (allow_sort)
            return std::binary_search(records.begin(), records.end(), rec);
        else
            return std::binary_search(opt_sorted_records.begin(), opt_sorted_records.end(), rec);
}

bool Search::Item::UsesColumn(unsigned tableidx, ColumnId column_id) const
{
        if (tableindex == tableidx && columndef->column_id == column_id)
            return true;

        return type == SearchItemType::JoinTables && joinitem.tableindex2 == tableidx && joinitem.columndef2->column_id == column_id;
}

bool Search::Item::UsesSameColumn(Item const &rhs) const
{
        if (rhs.UsesColumn(tableindex, columndef->column_id))
            return true;

        return type == SearchItemType::JoinTables && rhs.UsesColumn(joinitem.tableindex2, joinitem.columndef2->column_id);
}


Search::Table::Table(TableDef const *_tableid)
: tabledef(_tableid)
{
}

Search::Table::Table(TableDef const *_tableid, std::vector< RecordId > const &records, bool allow_sort)
: tabledef(_tableid)
, sourcelist(new SourceList(records, allow_sort))
{
}

Search::Search()
: limit(0)
, original_item_count( std::numeric_limits<unsigned>::max() )
{
        // Reserve a lot instead of a little first and then a little more etc.
        scandata.reserve(256);
}

void Search::AddTable(Table const &table)
{
        tables.push_back(table);
}

void Search::AddIntegerSearch(uint32_t tableindex, ColumnId column, int32_t value, SearchRelationType howtosearch)
{
        if (tableindex>=tables.size())
            throw Exception(ErrorInvalidArg,"No table with index " + Blex::AnyToString(tableindex));
        ColumnDef const *coldef = tables[tableindex].tabledef->GetColumnDef(column);
        if (!coldef)
            throw Exception(ErrorInvalidArg,"No column with id " + Blex::AnyToString(column) + " in table " + tables[tableindex].tabledef->name);

        unsigned add_pos = scandata.size();
        scandata.resize(scandata.size() + Cell::HdrSize + sizeof(int32_t));
        SetCellSize(&scandata[add_pos], sizeof(int32_t));
        Blex::putu32lsb(&scandata[add_pos + Cell::HdrSize], value);

        items.resize(items.size() + 1);
        Item &item = items.back();
        item.type = SearchItemType::SingleItem;
        item.tableindex = tableindex;
        item.columndef = coldef;
        item.relation = howtosearch;
        item.case_sensitive = true;
        item.singleitem.cell_index = add_pos;
}

void Search::AddBooleanSearch(uint32_t tableindex, ColumnId column, bool value)
{
        if (tableindex>=tables.size())
            throw Exception(ErrorInvalidArg,"No table with index " + Blex::AnyToString(tableindex));
        ColumnDef const *coldef = tables[tableindex].tabledef->GetColumnDef(column);
        if (!coldef)
            throw Exception(ErrorInvalidArg,"No column with id " + Blex::AnyToString(column) + " in table " + tables[tableindex].tabledef->name);

        uint8_t val = value?1:0;
        AddRawSearch(tableindex, column, 1, &val, SearchEqual, true);
}

void Search::AddRawSearch(uint32_t tableindex, ColumnId column, uint32_t valuelen, const uint8_t *value, SearchRelationType howtosearch, bool casesensitive)
{
        if (tableindex>=tables.size())
            throw Exception(ErrorInvalidArg,"No table with index " + Blex::AnyToString(tableindex));
        ColumnDef const *coldef = tables[tableindex].tabledef->GetColumnDef(column);
        if (!coldef)
            throw Exception(ErrorInvalidArg,"No column with id " + Blex::AnyToString(column) + " in table " + tables[tableindex].tabledef->name);

        unsigned add_pos = scandata.size();
        scandata.resize(scandata.size() + Cell::HdrSize + valuelen);
        SetCellSize(&scandata[add_pos], (uint16_t)valuelen);
        std::copy(value, value + valuelen, scandata.begin() + add_pos + Cell::HdrSize);

        items.resize(items.size() + 1);
        Item &item = items.back();
        item.type = SearchItemType::SingleItem;
        item.tableindex = tableindex;
        item.columndef = coldef;
        item.relation = howtosearch;
        item.case_sensitive = casesensitive;
        item.singleitem.cell_index = add_pos;

        /** FIXME: Ugly hack to speed up selects on PARENT_INSIDE_SITE.
            But, since the dbserver almost is at eol, we don't care for nice solutions no'mo'
        */
        if (coldef->name == "PARENT_INSIDE_SITE" && tables[tableindex].tabledef->name == "FS_OBJECTS" &&
                tables[tableindex].tabledef->parent_object && tables[tableindex].tabledef->parent_object->name == "SYSTEM")
        {
                // parent_inside_site != 0 -> parent_inside_site == parent.
                // Can't replace the item we just added, cause there are we can't return site-root folders when
                // searching for their parent.

                if (howtosearch == SearchEqual && valuelen == 4)
                {
                        // If searching for 0, no optimization is possible
                        if (Blex::GetLsb< int32_t >(value) == 0)
                            return;

                        // Not searching for 0, so we can search 'parent' column too
                        ColumnId col_parent = tables[tableindex].tabledef->GetColumnId("PARENT");
                        if (col_parent)
                            AddRawSearch(tableindex, col_parent, valuelen, value, howtosearch, casesensitive);
                }
                else if (howtosearch == SearchIn)
                {
                        // Illegal length?
                        if ((valuelen & 3) != 0)
                            return;

                        // If searching for 0, no optimization is possible
                        for (uint8_t const *it = value, *end = value + valuelen; it != end; it += 4)
                            if (Blex::GetLsb< int32_t >(it) == 0)
                                return;

                        // Not searching for 0, so we can search 'parent' column too
                        ColumnId col_parent = tables[tableindex].tabledef->GetColumnId("PARENT");
                        if (col_parent)
                            AddRawSearch(tableindex, col_parent, valuelen, value, howtosearch, casesensitive);
                }
        }
}

void Search::AddJoin(uint32_t tableindex1, ColumnId column1, bool /*allrecords_table1*/, uint32_t tableindex2, ColumnId column2, bool /*allrecords_table2 ADDME: outer join*/, SearchRelationType howtosearch, bool casesensitive)
{
        if (tableindex1>=tables.size())
            throw Exception(ErrorInvalidArg,"No table with index " + Blex::AnyToString(tableindex1));
        if (tableindex2>=tables.size())
            throw Exception(ErrorInvalidArg,"No table with index " + Blex::AnyToString(tableindex2));

        ColumnDef const *coldef_1 = tables[tableindex1].tabledef->GetColumnDef(column1);
        ColumnDef const *coldef_2 = tables[tableindex2].tabledef->GetColumnDef(column2);
        if (!coldef_1)
            throw Exception(ErrorInvalidArg,"No column with id " + Blex::AnyToString(column1) + " in table " + tables[tableindex1].tabledef->name);
        if (!coldef_2)
            throw Exception(ErrorInvalidArg,"No column with id " + Blex::AnyToString(column2) + " in table " + tables[tableindex2].tabledef->name);

        items.resize(items.size() + 1);
        Item &item = items.back();
        item.type = SearchItemType::JoinTables;
        item.tableindex = tableindex1;
        item.columndef = coldef_1;
        item.relation = howtosearch;
        item.case_sensitive = casesensitive;
        item.joinitem.tableindex2 = tableindex2;
        item.joinitem.columndef2 = coldef_2;
}

void Search::AddIntegerInSearch(uint32_t tableindex, ColumnId column, Blex::PodVector< int32_t > const &values)
{
        if (tableindex>=tables.size())
            throw Exception(ErrorInvalidArg,"No table with index " + Blex::AnyToString(tableindex));
        ColumnDef const *coldef = tables[tableindex].tabledef->GetColumnDef(column);
        if (!coldef)
            throw Exception(ErrorInvalidArg,"No column with id " + Blex::AnyToString(column) + " in table " + tables[tableindex].tabledef->name);

        unsigned add_pos = scandata.size();
        scandata.resize(scandata.size() + Cell::HdrSize + values.size() * sizeof(int32_t));
        SetCellSize(&scandata[add_pos], values.size() * sizeof(int32_t));

        for (unsigned idx = 0, end = values.size(); idx != end; ++idx)
            Blex::putu32lsb(&scandata[add_pos + Cell::HdrSize + idx * sizeof(int32_t)], values[idx]);

        items.resize(items.size() + 1);
        Item &item = items.back();
        item.type = SearchItemType::SingleItem;
        item.tableindex = tableindex;
        item.columndef = coldef;
        item.relation = SearchIn;
        item.case_sensitive = true;
        item.singleitem.cell_index = add_pos;
}


std::string Search::Dump() const
{
        std::ostringstream ostr;
        ostr << "Search tables: ";
        for (std::vector< Table >::const_iterator table_it = tables.begin(); table_it != tables.end(); ++table_it)
        {
                if (table_it != tables.begin())
                    ostr << ", ";
                ostr << table_it->tabledef->name << "(" << table_it->tabledef->object_id << ") AS T" << std::distance(tables.begin(), table_it);
                if (table_it->sourcelist.get())
                    ostr << " (with sourcelist)";
        }
        ostr << std::endl;
        ostr << " Limit: " << limit << std::endl;
        ostr << " Items: " << std::endl;
        unsigned item_count = std::min<unsigned>(original_item_count, items.size());
        unsigned counter = 0;
        for (std::vector< Item >::const_iterator it = items.begin(); it != items.begin() + item_count; ++it, ++counter)
        {
                ostr << "  #" << counter << " ";
                switch (it->type)
                {
                case SearchItemType::SingleItem:
                        {
                                ostr << "Single on ";
                                ostr << tables[it->tableindex].tabledef->name << "." << it->columndef->name;
                                ostr << " (T" << it->tableindex << ":" << tables[it->tableindex].tabledef->object_id << "." << it->columndef->column_id << ")";

                                ostr << " " << it->relation;
                                Cell cell(&scandata[it->singleitem.cell_index]);
                                Blex::StringPair data = cell.StringPair();
                                for (char const *it2 = data.begin; it2 != data.end; ++it2)
                                {
                                        ostr << " ";
                                        ostr << std::hex << std::setw(2) << std::setfill('0') << (uint32_t)*(uint8_t const *)it2;
                                }
                                ostr << std::setw(0) << std::setfill(' ') << std::dec;
                                if (!it->case_sensitive)
                                    ostr << " (case insensitive)";
                                ostr << std::endl;
                        }; break;
                case SearchItemType::JoinTables:
                        {
                                ostr << "Join on ";
                                ostr << tables[it->tableindex].tabledef->name << "." << it->columndef->name;
                                ostr << " (T" << it->tableindex << ":" << tables[it->tableindex].tabledef->object_id << "." << it->columndef->column_id << ")";
                                ostr << " " << it->relation << " ";

                                ostr << tables[it->joinitem.tableindex2].tabledef->name << "." << it->joinitem.columndef2->name;
                                ostr << " (T" << it->joinitem.tableindex2 << ":" << tables[it->joinitem.tableindex2].tabledef->object_id << "." << it->joinitem.columndef2->column_id << ")";

                                if (!it->case_sensitive) ostr << " (case insensitive)";
                                ostr << std::endl;
                        }; break;
                default:
                    ostr << "Unknown type" << std::endl;
                }
        }
        /* IF we still want this, move it to rpc server
        ostr << " Columns (fase1): ";
        for (std::vector< NeededColumn >::const_iterator it = needed_columns.begin(); it != needed_columns.begin() + fase2_start; ++it)
        {
                if (it != needed_columns.begin()) ostr << ", ";
                if (built_plan)
                {
                        if (!it->columndef)
                            throw std::runtime_error("Encountered unresulved columndef!!!");
                        ostr << tables[it->tableindex].tabledef->name << "." << it->columndef->name;
                        ostr << " (" << it->tableindex << ":" << tables[it->tableindex].tableid << "." << it->columnid << ")";
                }
                else
                    ostr << it->tableindex << ":" << tables[it->tableindex].tableid << "." << it->columnid;
        }
        ostr << std::endl;
        ostr << " Columns (fase2): ";
        for (std::vector< NeededColumn >::iterator it = needed_columns.begin() + fase2_start; it != needed_columns.end(); ++it)
        {
                if (it != needed_columns.begin() + fase2_start) ostr << ", ";
                if (built_plan)
                {
                        ostr << tables[it->tableindex].tabledef->name << "." << it->columndef->name;
                        ostr << " (" << it->tableindex << ":" << tables[it->tableindex].tableid << "." << it->columnid << ")";
                }
                else
                    ostr << it->tableindex << ":" << tables[it->tableindex].tableid << "." << it->columnid;
        }
        ostr << std::endl;
                                                       */
        return ostr.str();
}

} //end namespace Database











