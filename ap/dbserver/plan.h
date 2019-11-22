#ifndef blex_webhare_dbase_scanner_plan
#define blex_webhare_dbase_scanner_plan

#include <ap/libwebhare/dbase.h>
#include "dbase_index_frontend.h"
#include "searches.h"
#include "scanlocate.h"

namespace Database
{
namespace DBScanner
{

extern unsigned DebugLevel;
#ifdef DEBUG
 #define SCANNERDEBUGONLY(level, x) do { if (DebugLevel >= level) { x; } } while (0)
 #define SCANNERDEBUGPRINT(level, x) do { if (DebugLevel >= level) DEBUGPRINT(x); } while (0)
#else
 #define SCANNERDEBUGONLY(level, x) (void)0
 #define SCANNERDEBUGPRINT(level, x) (void)0
#endif

/// Maximum number of multi-column alternatives are tracked at a time
static const unsigned MaxIndexMultiTrackCount = 4;

// Type of a node in the execution tree
namespace SourceType
{
enum _type
{
Table,                  ///< Node wh a single table as output
Join                    ///< Tree node that jns the output of two other nodes
};
} // End of namespace SourceType

class PlanBuilder;

/** Tracks data about a query for a particular source */
struct IndexQueryData
{
        /// Index to use for a query (als functions as valid flag)
        Index::IndexData *index;

        /// List of search items that are handled by this query
        SearchItemId itemids[Index::MaxCellsPerIndex]; // Items for which index is used

        /// Number of items in itemids
        unsigned itemcount;             // Number of valid items in itemids

        /// Selectivity (number of matches / total number)
        double selectivity;

        /// Flag if more items can be added (equivalent of relation of last item == SearchEqual)
        bool can_extend;
};

struct TableOptimizationData
{
        /// Multi-column alternatives. Only multi-column indices get into this list.
        IndexQueryData multis[MaxIndexMultiTrackCount];

        /// Best index up to now
        IndexQueryData best;

        /** Initializes IndexDeterminationData */
        void Initialize();

        bool TryRecordMultiColumnIndex(Index::IndexData *data, SearchItemId item);
};

/** Raw results/cost estimates of a source */
struct SourceResults
{
        inline SourceResults() : total_rows(0), visited_rows_per_query(0), return_selectivity(1.0), row_access_cost(1) {}

        /// Total rows available in db
        unsigned total_rows;

        /// Rows accessed per query
        unsigned visited_rows_per_query;

        /// Fraction of the accessed rows that are returned compared to the total number of incoming rows
        double return_selectivity;

        /// Cost of accessing of a row
        int row_access_cost;
};


/** Base class for source nodes. */
struct PlanSource
{
    private:
        /// Type of the node (for quick casting)
        SourceType::_type type;

        /// Source the data form this source flows to
        PlanSource *parent;

        /// Cost/results statistics
        SourceResults statistics;

    public:
        PlanSource (SourceType::_type _type) : type(_type), parent(0) {}
        const PlanJoin* is_join() const;
        const PlanTable* is_table() const;

        /** All search items that become relevant at this node. */
        std::vector< SearchItemId > items;

        friend class PlanBuilder;
};

/// Single table source
struct PlanTable: public PlanSource
{
    public:
        PlanTable() : PlanSource(SourceType::Table), index(0) {}

        /// Nr of the table in search-structure
        unsigned tablenr;

        /// Index to use for this table (if specified then it is used as source)
        Index::IndexData *index;

        /// Search item to use for index.
        SearchItemId indexitemids[Index::MaxCellsPerIndex];

        unsigned indexitemcount;

        /** Sourcelist to use for this table. If index is not NULL this is
            used as source, otherwise as filter */
        std::shared_ptr< SourceList > sourcelist;
    private:

        TableOptimizationData data;

        friend class PlanBuilder;
};

/// Joining source
struct PlanJoin: public PlanSource
{
        PlanJoin() : PlanSource(SourceType::Join), join_count(0) {}

        /// Left source
        PlanSource *left;

        /// Right source
        PlanSource *right;

        struct JoinData
        {
                /// The search-item used for driving
                SearchItemId driver;

                /// Source for the driving.
                unsigned source_tablenr;
                ColumnDef const *source_columndef;
        };

        unsigned join_count;
        JoinData joins[Index::MaxCellsPerIndex];

    private:
        friend class PlanBuilder;
};

inline const PlanJoin* PlanSource::is_join() const
{
        return type == SourceType::Join ? static_cast<PlanJoin const *>(this) : 0;
}
inline const PlanTable* PlanSource::is_table() const
{
        return type == SourceType::Table ? static_cast<PlanTable const *>(this) : 0;
}

/** A plan describes the way the scanner must solve a query, as described in
  a Search structure. A scanner is built according to this description.
  A plan should not be dependent on a Search; is thould be possible to use
  the same plan for another search that only differs from the original in
  search values (not search types). */
class Plan
{
    public:
        Plan(unsigned table_count);

        /// Tables in this plan
        std::vector< PlanTable > tables;

        /// Joins in this plan
        std::vector< PlanJoin > joins;

        /// Top source item in the script; this one delivers the resultset.
        PlanSource *top;

        void Dump(std::ostream &str, Search const &search) const;
        void DumpItem(std::ostream &str, unsigned indent, Search::Item const &item, Search const &searchfor, signed indexid, unsigned itemid) const;
        void DumpSource(std::ostream &str, unsigned indent, PlanSource const &item, Search const &search) const;
        void DumpTable(std::ostream &str, unsigned indent, PlanTable const &item, Search const &search) const;
        void DumpJoin(std::ostream &str, unsigned indent, PlanJoin const &item, Search const &search) const;
};

class PlanBuilder
{
    private:
        BackendTransaction &trans;
        Search &searchfor;

        /** Does initalization for a plan */
        void InitializePlan(Plan &plan, bool copy_sourcelist);

        /** Initializes all table and column defs ptrs in the search structure (and sorts source lists)
            Does validity checking for tables and columns. */
        void CheckAndOptimizeSearch();

        /** Returns index data for an item (left or right side)
            Also records usable multi-column indices in the plantable source
            @param plan Plan
            @param id Id of search item
            @param item Search item
            @param for_join_second Set to true if item is a join item, and the rhs column must be done
            @return Index data if a compatible index was found */
        Index::IndexData * GetIndex(Plan &plan, SearchItemId id, Search::Item &item, bool for_join_second);

        /** Estimates number of results of a search
            @param columndef Column the search is performed on
            @param table_size_estimate Best estimate of the size of the table
            @param relation Search relation
            @param indexdata Filled with data about index found for this column (or 0 if no index)
            @return Estimated number of results returned by this kind of search as fraction of the total table size */
        double GetEstimatedResultSelectivity(unsigned table_size_estimate, Search::Item const &item, bool for_join_second);

        void SetJoinSelectivities(Search::Item &item, SourceResults const &left_table_stats, SourceResults const &right_table_stats);
        void SetSingleSelectivity(Search::Item &item, unsigned table_size_estimate);

        /** Determine which search items can see NULL's */
        void SetSearchItemsNullness();

        /** Set the index fields of the search items, and the estimated fractions of total rows vs. returned rows
            @param plan Plan to work on */
        void SetSearchItemsIndicesAndSelectivities(Plan &plan);

        void FindBestSearchForTables(Plan &plan);

        /** Collects statistics on the tables in the plan */
        void CollectTableStatistics(Plan &plan);

        /** Assigns all single item data cells from the searchfrom query */
        void DistributeSingleSourceDataCells();

        /** Assigns all single table items and joins on the same table to the Table-source nodes */
        void DistributeSingleSourceItems(Plan &plan);

        struct IndexJoinData
        {
                SearchItemId best_item;
                bool must_switch;
                unsigned left_results;
        };

        /** Constructs a search items used for driving a join. Invalidates pointers to searchfor.items.
            @param itemid Id if original join item
            @param do_switch Drive left(true) or right(false) source
            @return Returns id of new item */
        SearchItemId ConstructJoinDriverItem(SearchItemId itemid, bool drive_left_side);

        /** Build a carthesian join node
            @param join Join node to fill
            @param sources List of sources. source[0] and source[1] will be carthesiannaly joined and replaced with &join. */
        void BuildCarthesianJoinNode(PlanJoin &join, std::vector< PlanSource * > &sources);

        /** Returns estimate number of entries in a table
            @param table Pointer to table metadata
            @return Estimate number of entries in the table */
        unsigned EstimateTableSize(TableDef const *tabledef);

        // Describes a join item, and whether it must be used switched
        struct DirectedJoinItem
        {
                inline DirectedJoinItem() = default;
                inline DirectedJoinItem(SearchItemId _id, bool _switched) : id(_id), switched(_switched) {}

                SearchItemId id;
                bool switched;
        };

        // List of join items to use inside an index
        struct DirectedJoinItemList
        {
                unsigned count;
                DirectedJoinItem items[Index::MaxCellsPerIndex];
        };

        // Describes an extra joined table, together with used join items
        struct JoinPoint
        {
                unsigned tableidx;
                DirectedJoinItemList itemlist;
        };

        /** Checks whether a index may be used for a table. Needed to prevent use of ignorenull indexes when null values
            should also be found
            @param desc Descriptor of the index
            @param tableindex Index of the table to use the index for
            @return Whether the index may be used
        */
        bool CheckIndexUsable(Index::Descriptor const &desc, unsigned tableindex);

        /** Given the descriptor, a list of search items, searches for the best combination of items for this descriptor
            This function tries to fill the columns for the descriptor, starting at column @a columnnr.
            The best combination is currently the combination with the highest number of items used
            @param plan Current plan
            @param desc Descriptor of index
            @param columnnr Number of column to fill
            @param relevant_items Relevant search items
            @param best Structure filled with the best combination
            @return Returns whether the invocation found the best combination yet */
        bool GetBestJoinListIterate(Plan &plan, Index::Descriptor const &desc, unsigned columnnr, Blex::PodVector< DirectedJoinItem > const &relevant_items, Blex::PodVector< SearchItemId > const &single_items, DirectedJoinItemList &best);

        /** Determines which join-items must be used for a join, taking into account multi-column indices.
            @param plan Current plan
            @param relevant_items Join items that can be used (default lhs given, rhs added), with switch var (switch lhs and rhs wrt default)
            @param result_items Result items to be used with a single index */
        Index::IndexData * GetBestJoinList(Plan &plan, Blex::PodVector< DirectedJoinItem > const &relevant_items, Blex::PodVector< SearchItemId > const &single_items, DirectedJoinItemList &result_items);

        /** Calculates costs of all possible joins given a set of already joined tables
            @param plan Current built plan
            @param tables Array of already joined tables
            @param count Number of already joined tables
            @param current Cost/results of already joined tables
            @param best Array containing list of joined tables + join criteria with the lowest cost (only modified when join with better cost then the current best cost has been found)
            @param best_cost Total cost for best join order (only modified when lower cost join order has been found). 0xFFFFFFFF is initial value.
            @return Whether this join order found modified the best possible join */
        bool CalculateCR(Plan &plan, unsigned *_tables, unsigned count, CostResults const &current, JoinPoint best[MaxTablesInQuery], double &best_cost);

        /** Calculates the join order with the lowest cost
            @param plan Plan
            @param best Join order with the lowest cost */
        void CalculateAllCosts(Plan &plan, JoinPoint best[MaxTablesInQuery]);

        /** Calculates costs of a full select over a single table
            @param Selected tables
            @param cr Cost-results to fill */
        void SetCostResultsForSingleTableSelect(PlanTable const &table, CostResults *cr);

        /** Builds the join tree
            @param plan Plan
            @param best Join order with the lowest cost
            @return Top of join tree */
        PlanSource * BuildTreeFromJoinPoints(Plan &plan, JoinPoint best[MaxTablesInQuery], unsigned table_count);

        // Invalidates pointers to searchfor.items.
        void BuildDrivenJoinNode_2(Plan &plan, PlanSource *left, PlanSource *right, PlanJoin &join, DirectedJoinItemList const &items);
        void BuildCarthesianJoinNode_2(Plan &plan, PlanSource *left, PlanSource *right, PlanJoin &join);

    public:
        PlanBuilder(BackendTransaction &trans, Search &_searchfor);

        std::unique_ptr< Plan > Construct();
};

} // end namespace DBScanner
} // End of namespace Database


#endif


