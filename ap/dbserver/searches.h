#ifndef blex_webhare_dbase_scanner_searches
#define blex_webhare_dbase_scanner_searches

#include <ap/libwebhare/dbase.h>
#include <ap/dbserver/dbase_index_frontend.h>

namespace Database
{

class ColumnDef; //forward..

namespace DBScanner
{
        /// Type that holds the number of a search-item in the corresponding Search structure
        typedef unsigned SearchItemId;
        /// Flag indicating that no search-item is used.
        static const unsigned NoSearch = 0xFFFFFFFF;

        class Plan;
        class PlanBuilder;
}

/** Maximum number of tables in a query */
static const unsigned MaxTablesInQuery = 32;

namespace SearchItemType
{
enum _type
{
SingleItem = 0x00,
JoinTables = 0x01
};
} // End of namespace SearchItemType

/** Contains a ptr list of records that are used as source (without visibility
    checks!!) */
struct SourceList
{
        // FIXME: document this!
        std::vector< RecordId > records;
        std::vector< RecordId > opt_sorted_records;
        bool allow_sort;

        void Optimize();
        bool Contains(RecordId rec);

        SourceList(): allow_sort(true) {}
        SourceList(std::vector< RecordId > const &records, bool _allow_sort);
};

/** Structure describing a query on the database */
struct Search
{
    public:
        /** A individual table source in this query */
        struct Table
        {
                /// Table definition for this table; filled in by plan-builder
                Database::TableDef const *tabledef;

                /// Optional list of records to return without visibility checks
                std::shared_ptr< SourceList > sourcelist;

                explicit Table(Database::TableDef const *tabledef);
                Table(Database::TableDef const *tabledef, std::vector< RecordId > const &records, bool allow_sort);
        };

        /** A criterium for a single column */
        struct SingleItem
        {
                ///Index in scandata for our value. Negative value means not valid.
                int32_t cell_index;

            private:
                /// Selectivity of this item
                double selectivity;

                friend class DBScanner::PlanBuilder;
        };

        /** A criterium that describes a relation between 2 columns */
        struct JoinItem
        {
                /// Index of table with secondary column
                uint32_t tableindex2;

                /// Column definition of secondary column; filled in by plan-builder
                ColumnDef const *columndef2;

            private:
                /// Fraction of estimated number of results with fixed second column, compared to total size of left table
                double selectivity_left;

                /// Fraction of estimated number of results with fixed first column, compared to total size of right table
                double selectivity_right;

                Index::IndexData *index2;

                /// Scratch space for the plan-builder
                bool handled;

                friend class DBScanner::PlanBuilder;
        };

        /// A criterium
        struct Item
        {
                /// Type of this criterium (single/join)
                SearchItemType::_type type;

                ///Cell containing data; used for single-searches; filled in by the scanner
                Cell datacell;

                ///Search relation type
                SearchRelationType relation;

                ///Case-sensitive search?
                bool case_sensitive;

                ///Index of table with the primary colunn
                uint32_t tableindex;

                ///Column definition of the primary column; filled in by the plan-builder
                ColumnDef const *columndef;

                /// Whether this item can accept NULL's (can also be false when another item disallows them)
                bool canseenulls;

                union
                {
                SingleItem singleitem;
                JoinItem joinitem;
                };

                Item() : datacell(0) {}

                bool UsesColumn(unsigned tableidx, ColumnId column_id) const;
                bool UsesSameColumn(Item const &rhs) const;

            private:
                Index::IndexData *index;

                friend class DBScanner::PlanBuilder;
        };

        Search();

        void SetLimit(unsigned new_limit) { limit = new_limit; }

        /** Constructor reading from IO Buffer*/
        explicit Search(IOBuffer *src);

        /** Add a table to search through */
        void AddTable(Table const &table);

        void AddBooleanSearch(uint32_t tableindex, ColumnId column, bool value);
        void AddIntegerSearch(uint32_t tableindex, ColumnId column, int32_t value, SearchRelationType howtosearch);
        void AddRawSearch(uint32_t tableindex, ColumnId column, uint32_t valuelen, const uint8_t *value, SearchRelationType howtosearch, bool casesensitive);
        void AddStringSearch(uint32_t tableindex, ColumnId column, uint32_t valuelen, const char *value, SearchRelationType howtosearch, bool casesensitive)
        { AddRawSearch(tableindex, column, valuelen, (uint8_t const *)value, howtosearch, casesensitive); }
        void AddStringSearch(uint32_t tableindex, ColumnId column, std::string const &str, SearchRelationType howtosearch, bool casesensitive)
        { AddRawSearch(tableindex, column, str.size(), (uint8_t const *)str.c_str(), howtosearch, casesensitive); }
        /** @param allrecords_table1 Return _all_ records from table 1 (left or full outer join)
            @param allrecords_table1 Return _all_ records from table 2 (right or full outer join)*/
        void AddJoin(uint32_t tableindex1, ColumnId column1, bool allrecords_table1,
                              uint32_t tableindex2, ColumnId column2, bool allrecords_table2,
                              SearchRelationType howtosearch, bool casesensitive);
        void AddIntegerInSearch(uint32_t tableindex, ColumnId column, Blex::PodVector< int32_t > const &values);

        std::string Dump() const;

        inline Table const & GetTable(unsigned tableindex) const { return tables[tableindex]; }
        inline unsigned GetTableCount() const { return tables.size(); }
        inline Item const & GetItem(unsigned itemindex) const { return items[itemindex]; }

    private:
        // Limit (0 for no limit)
        uint32_t limit;

        // Tables in this search
        std::vector< Table > tables;

        // Items in this search
        std::vector< Item > items;

        // Data for single searches
        std::vector< uint8_t > scandata;

        /// Number of oritinal items in search (all items after that are custom-built for scanner). Set by plan-builder.
        unsigned original_item_count;

        friend class DBScanner::Plan; // For dumps
        friend class DBScanner::PlanBuilder;
        friend class Scanner;
};

} //end namespace database

#endif
