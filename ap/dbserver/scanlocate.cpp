#include <ap/libwebhare/allincludes.h>

#include <sstream>
#include "scanlocate.h"
#include "plan.h"
#include "dbase_transaction.h"
#include "dbase_diskio.h"

/*
Problems with current scanner:

Updating within a join: when a record is chased due to a lock
only the row itself is reevaluated (and deleted when not a match
anymore), but NEW rows (due to the change) are not returned!
*/

// define to do an aftercheck on the results
//#define AFTERTEST_RESULTS

namespace Database
{

unsigned const Scanner::CacheSize;

/** A RecordIdSource gives out lists of record-ids over whichs has to be searched.
    A returned block may only contain records from the SAME section!!! */
class RecordIdSource
{
    public:
        /// Virtual destructor is needed
        virtual ~RecordIdSource();

        /// Returns an iterator to the begin of the current block
        virtual RecordId const *block_begin() = 0;

        /// Returns an iterator to the end of the current block
        virtual RecordId const *block_end() = 0;

        /// Resets the source (next getblock starts at the beginning)
        virtual void Reset() = 0;

        /** Retrieves the first or the next block. A block may only contain
            records from the same section!
            @param max_count Maximum size of block to return
            @return Size of returned block, 0 indicates end of list */
        virtual unsigned GetBlock(unsigned max_count) = 0;
};

/** The index joiner joins two sources together (based on a join-item.)
    The joiner retrieves records from the left source, when one has been
    retrieved the right source is reset and per returned row on the right size
    a result is returned.

    When using a join-item a column is retrieved from the left source (the
    joinsource). The join_item search item (used in the right source) is set to
    that cell, and then the right source is reset. */
class IndexJoiner : public SourceBase
{
    public:
        static const unsigned MaxJoinItems = 4;

    private:
        /// Left source (drives right source)
        std::unique_ptr< SourceBase > left;

        /// Right source
        std::unique_ptr< SourceBase > right;

        /// Number of join items used
        unsigned join_item_count;

        /// Data about a search join item this join uses
        struct JoinItem
        {
                /// Id of the search item
                DBScanner::SearchItemId item;

                /// Cell storage for the joinsource column cell (for internal columns)
                Scanner::CellStore source_cellstore;

                /// Tablenr of the join source column
                unsigned source_tablenr;

                /// Columndef of the joinsource column
                ColumnDef const *source_columndef;
        };

        /// Data about joins solved by this joiner
        JoinItem join_item[4];

        bool GetNextLeftMatch();
        bool GetFirstRightMatch();
        bool GetNextRightMatch();

    public:
        /** Construct a joiner
            @param scanner DBScanner that owns this joiner
            @param left Left source tree
            @param right Right source tree  */
        IndexJoiner(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, std::unique_ptr< SourceBase > &left, std::unique_ptr< SourceBase > &right);

        /// Initializes the join-data from the plan
        void InitFromPlan(DBScanner::PlanJoin const &plan);

        virtual bool FirstBlock();
        virtual bool NextBlock();
        virtual bool FirstRowInBlock();
        virtual bool NextRowInBlock();
};

/** The joiner joins two sources together (carthesian)
    The joiner retrieves records from the left source, when one has been
    retrieved the right source is reset and per returned row on the right size
    a result is returned. */
class BlockJoiner : public SourceBase
{
    private:
        /// Left source (drives right source)
        std::unique_ptr< SourceBase > left;

        /// Right source
        std::unique_ptr< SourceBase > right;

        bool GetNextLeftMatch();
        bool GetNextRightMatch();

        /// Is the current left block empty?
        bool left_block_empty;
    public:
        /** Construct a joiner
            @param scanner DBScanner that owns this joiner
            @param left Left source tree
            @param right Right source tree */
        BlockJoiner(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, std::unique_ptr< SourceBase > &left, std::unique_ptr< SourceBase > &right);

        /// Initializes the join-data from the plan
        void InitFromPlan(DBScanner::PlanJoin const &plan);

        virtual bool FirstBlock();
        virtual bool NextBlock();
        virtual bool FirstRowInBlock();
        virtual bool NextRowInBlock();
};

/** @short An index-reading record ID source
    @long This is the record id source for the index. It reads recordids from
          the index in BufferSize chunks, but internally sorts them and then
          returns the record ids in chunks called 'subrange's - each subrange
          contains record ids from only one section.

    ADDME: findout if for for limit(1) searches the buffer size must be adjusted */
class IndexQuery : public RecordIdSource
{
    private:
        static const unsigned BufferSize = 256;
        Scanner &scanner;

        /// Current query
        std::shared_ptr< Blex::Index::Query > query;
        Blex::Index::BtreeIndex::OfflineIterator current_it;

        /// Buffer for recordids from the index
        RecordId buffer[BufferSize];
        RecordId *buffer_limit; //< Limit of currently used buffer space
        RecordId *subrange_start; //< Where does our section subrange start?
        RecordId *subrange_limit; //< Where does our section subrange end?

        // Buffer for IN-cells
        WritableRecord cell_buffer;
    public:
        IndexQuery(Scanner &scanner);

        /// Items this query searches for
        Search::Item const *items[Index::MaxCellsPerIndex];

        unsigned itemcount;
        unsigned in_itemnr;
        std::vector< uint32_t > in_items;

        Index::IndexData *index;

        virtual RecordId const *block_begin();
        virtual RecordId const *block_end();

        virtual void Reset();
        virtual unsigned GetBlock(unsigned max_count);
};

/** The recordidsource for a previously generated list of records
    Performs best when sourcelist is sorted per section! */
class RecordList: public RecordIdSource
{
    private:
        std::shared_ptr< SourceList > sourcelist;

        std::vector< RecordId >::const_iterator begin;
        std::vector< RecordId >::const_iterator end;
    public:
        RecordList(std::shared_ptr< SourceList > const  &sourcelist);

        virtual RecordId const *block_begin();
        virtual RecordId const *block_end();

        virtual void Reset();
        virtual unsigned GetBlock(unsigned max_count);
};

class RecordMapper: public SourceBase
{
    public:
        /// Tabledef of the current table
        TableDef const *tabledef;

        /// Showmode
        ShowMode showmode;

        /// Viewer used to get records of the current table
        RawDatabase::SectionViewer viewer;

        ///Block size (may be set smaller to test, making it larger than MaxRecordsView is currently useless)
        static const unsigned BlockSize = RawDatabase::SectionViewer::MaxRecordsView;

        enum CachedVisibilityStatus
        {
                C_Unknown, C_Visible, C_Invisible
        };

        /// Which records are already known to be (in)visible ? (ADDME: Move to viewer?!)
        CachedVisibilityStatus status[BlockSize];

        /// Current startblock within the viewers view
        unsigned viewer_startptr;
        /// Current item within the viewers view ( 0 <= viewer_startptr <= viewer_viewptr <= viewer.view_size())
        unsigned viewer_viewptr;

        /// Optional recordidsource to use as source-list instead of raw scan
        std::unique_ptr< RecordIdSource > ris;

        /// Readaccess checks to perform
        Plugins::RecordReadAccess readaccess;

        /// Nr of this table within total query
        unsigned tablenr;

        /// Indicates whether ris is a SourceList (and visibility checking must be ignored!)
        bool sourcelist_source;

        /// Filter to use (instead of access checks)
        std::shared_ptr< SourceList > filter;

        RecordMapper(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, TableDef const *tabledef, ShowMode showmode, unsigned tablenr);

        virtual bool FirstBlock();
        virtual bool NextBlock();
        virtual bool FirstRowInBlock();
        virtual bool NextRowInBlock();

        /// Calculates visibility of a given record (record visibility)
        bool IsVisible(RawDatabase::SectionViewer::DiskRecord const &dr);

        /// Calculates access of a given record (access checks). Returns whether record is visible
        bool IsAccessVisible(RawDatabase::SectionViewer::DiskRecord const &dr);

        private:
        bool GetNextAccessibleRecord();
};

SourceBase::~SourceBase()
{
}

bool SourceBase::IsMatch()
{
        for (std::vector< DBScanner::SearchItemId >::const_iterator it = filter_items->begin(); it != filter_items->end(); ++it)
          if (!scanner.Matches(*it))
            return false;
        return true;
}

RecordIdSource::~RecordIdSource()
{
}

const unsigned IndexJoiner::MaxJoinItems;

IndexJoiner::IndexJoiner(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, std::unique_ptr< SourceBase > &_left, std::unique_ptr< SourceBase > &_right)
: SourceBase(scanner, _filter_items)
, left(std::move(_left))
, right(std::move(_right))
, join_item_count(0)
{
}

void IndexJoiner::InitFromPlan(DBScanner::PlanJoin const &plan)
{
        assert(plan.join_count != 0);

        join_item_count = plan.join_count;
        for (unsigned idx = 0; idx < join_item_count; ++idx)
        {
                join_item[idx].item = plan.joins[idx].driver;
                join_item[idx].source_tablenr = plan.joins[idx].source_tablenr;
                join_item[idx].source_columndef = plan.joins[idx].source_columndef;
        }
}

bool IndexJoiner::FirstBlock()
{
        return left->FirstBlock();
}
bool IndexJoiner::NextBlock()
{
        return left->NextBlock();
}
bool IndexJoiner::FirstRowInBlock()
{
        if (!left->FirstRowInBlock())
            return false;
        return GetNextLeftMatch();
}
bool IndexJoiner::NextRowInBlock()
{
        /* Look for _any_ right match */
        if (right->NextRowInBlock())
        {
                if (GetNextRightMatch()) //this will loop to the next block
                    return true;
        }
        else // No more matches in this block, Look for one with a match
        {
                while(true) //Loop looking for new blocks
                {
                        if (!right->NextBlock()) //No block? abort the loop, so we can look on the LHS of the join
                            break;
                        if (right->FirstRowInBlock()) //GOt a block
                        {
                                if (GetNextRightMatch()) //this will loop through block until it has a match too
                                    return true;
                                break; //we can break, as GetNextRightMatch() will ahve skipped blocks
                        }
                }
        }

        if (!left->NextRowInBlock())
            return false;
        return GetNextLeftMatch();
}
bool IndexJoiner::GetNextLeftMatch()
{
        do if (GetFirstRightMatch())
              return true;
        while(left->NextRowInBlock());

        return false;
}
bool IndexJoiner::GetFirstRightMatch()
{
        for (unsigned idx = 0; idx < join_item_count; ++idx)
          scanner.SetJoinSearch(join_item[idx].item, join_item[idx].source_tablenr, *join_item[idx].source_columndef, join_item[idx].source_cellstore);
        if (!right->FirstBlock())
            return false; //No data on right matches this row

        do
        {
                if (right->FirstRowInBlock())
                    return GetNextRightMatch();
        }
        while (right->NextBlock());
        return false;
}
bool IndexJoiner::GetNextRightMatch()
{
        while(true)
        {
                //Loop through records in this block
                do
                {
                        if (IsMatch())
                            return true;
                }
                while (right->NextRowInBlock());

                //Loop through blocks until we have a block with a new record
                do
                {
                        if (!right->NextBlock())
                            return false;
                }
                while (!right->FirstRowInBlock());

        }
        return false; //no more Right matches
}
        /* Block joiner:
           for every Left block
           - for every Right block
             - for every Left record in block
               - for every Right record in block
                 - see if this is a match

        */
BlockJoiner::BlockJoiner(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, std::unique_ptr< SourceBase > &_left, std::unique_ptr< SourceBase > &_right)
: SourceBase(scanner, _filter_items)
, left(std::move(_left))
, right(std::move(_right))
{
}

void BlockJoiner::InitFromPlan(DBScanner::PlanJoin const &DEBUGONLYARG(plan))
{
        assert(plan.join_count == 0);
}

bool BlockJoiner::FirstBlock()
{
        return left->FirstBlock() && right->FirstBlock();
}

bool BlockJoiner::NextBlock()
{
        //If there is no match in this left block, there is no point in looping through all the Right blocks
        //We have iterated at least the first left/right combination
        if (!left_block_empty && right->NextBlock()) //Can we move to the next Right block?
            return true; //Got new right block, so restart the Left block
        else if (left->NextBlock()) //No more records in this Left block, and no more Right blocks. Next left block, please!
            return right->FirstBlock();
        return false; //out of blocks on both left and right sides
}
bool BlockJoiner::FirstRowInBlock()
{
        left_block_empty = left->FirstRowInBlock() == false;
        if (left_block_empty)
             return false;
        return GetNextLeftMatch();
}
bool BlockJoiner::NextRowInBlock()
{
        if (right->NextRowInBlock() && GetNextRightMatch()) //another match in the Right block ?
            return true;
        if (!left->NextRowInBlock())
            return false;
        return GetNextLeftMatch();
}
bool BlockJoiner::GetNextLeftMatch()
{
        do
        {
                if (right->FirstRowInBlock() && GetNextRightMatch())
                    return true;
        }
        while(left->NextRowInBlock());
        return false;
}
bool BlockJoiner::GetNextRightMatch()
{
        do
        {
                if (IsMatch())
                    return true;
        }
        while(right->NextRowInBlock());
        return false;
}

IndexQuery::IndexQuery(Scanner &_scanner)
: scanner(_scanner)
{
        buffer_limit = buffer;
        subrange_start = buffer;
        subrange_limit = buffer;
}

void IndexQuery::Reset()
{
        Cell searchcells[Index::MaxCellsPerIndex];
        for (unsigned i = 0; i < itemcount; ++i)
           searchcells[i] = items[i]->datacell;

        buffer_limit = buffer;
        subrange_start = buffer;
        subrange_limit = buffer;

        if (items[0]->relation == SearchIn)
        {
                assert(items[0]->columndef->type == TInteger);
                assert(itemcount == 1);

                in_itemnr = 0;
                in_items.clear();

                unsigned size = items[0]->datacell.Size() / 4;
                if (size == 0)
                    return;
                uint8_t const *begin = items[0]->datacell.Begin();
                while (size--)
                {
                        in_items.push_back(Blex::getu32lsb(begin));
                        begin += 4;
                }


                std::sort(in_items.begin(), in_items.end());
                in_items.erase(std::unique(in_items.begin(), in_items.end()), in_items.end());

                cell_buffer.SetInteger(1, in_items[0]);
                searchcells[0] = cell_buffer.GetCell(1);

                query = index->MakeMultiQuery(
                        searchcells,
                        1,
                        SearchEqual,
                        false);
        }
        else
        {
                query = index->MakeMultiQuery(
                        searchcells,
                        itemcount,
                        items[itemcount-1]->relation,
                        false);
        }

        if (!query.get())
            throw Exception(ErrorInternal, "Expected index disappeared");

        current_it = query->begin();
}

unsigned IndexQuery::GetBlock(unsigned max_count)
{
        while (buffer_limit == buffer || subrange_limit == buffer_limit)
        {
                // No query: item is 'in []'
                if (!query.get())
                    return 0;

                // Limit the scope of the RAII stuff
                {
                        Blex::Index::BtreeIndex::Query::OnlineRef ref(*query);
                        Blex::Index::BtreeIndex::OnlineIterator indexit(ref, *current_it);

                        buffer_limit = buffer;
                        subrange_start = buffer; //reset to read the first subrange
                        subrange_limit = buffer;

                        while(*indexit < *query->approx_end() && buffer_limit < buffer + BufferSize)
                        {
                                *buffer_limit = indexit->GetRecordId();
                                ++buffer_limit;
                                ++indexit;
                        }

                        // Save the new iterator back to the query
                        current_it = *indexit;
                }

                if (buffer_limit != buffer)
                {
                        //sort by recordid (and thus section)
                        std::sort(buffer, buffer_limit);
                        break;
                }

                if (items[0]->relation == SearchIn)
                {
                        ++in_itemnr;

                        if (in_items.size() <= in_itemnr)
                            return 0; // no more data

                        cell_buffer.SetInteger(1, in_items[in_itemnr]);

                        Cell searchcells[Index::MaxCellsPerIndex];
                        searchcells[0] = cell_buffer.GetCell(1);

                        query = index->MakeMultiQuery(
                                searchcells,
                                1,
                                SearchEqual,
                                false);

                        if (!query.get())
                            throw Exception(ErrorInternal, "Expected index disappeared");

                        current_it = query->begin();
                        continue;
                }
                return 0; //no more data
        }

        //We've got subranges left, just iterate to the next subrange
        subrange_start = subrange_limit; //next subrange

        //We can never return more entries than we have in our buffer
        RecordId *return_limit = subrange_start + std::min<unsigned>(max_count, buffer_limit - subrange_start);

        // FIXME: 512 used here as number of blocks within a section -> must be done better!!!
        // Calculate how many record ids to return (min of 'max_count', 'subrange_size')
        unsigned cursection = *subrange_start / 512;
        for (subrange_limit = subrange_start + 1; subrange_limit < return_limit; ++subrange_limit)
          if (*subrange_limit / 512 != cursection) //abort when we leave the current section
            break;

        return subrange_limit-subrange_start;
}

RecordId const * IndexQuery::block_begin()
{
        return subrange_start;
}

RecordId const * IndexQuery::block_end()
{
        return subrange_limit;
}

RecordList::RecordList(std::shared_ptr< SourceList > const &_sourcelist)
: sourcelist(_sourcelist)
{
        Reset();
}

RecordId const * RecordList::block_begin()
{
        return &*begin;
}

RecordId const * RecordList::block_end()
{
        return &*end;
}

void RecordList::Reset()
{
        end = sourcelist->records.begin();
        begin = end; // Keep block_begin, and block_size correct
}

unsigned RecordList::GetBlock(unsigned max_count)
{
        begin = end;
        if (!max_count || end == sourcelist->records.end())
           return 0;
        ++end;
        unsigned size(1);

        // FIXME: 512 used here as number of blocks within a section -> must be done better!!!
        unsigned section = *begin / 512;
        while (size < max_count && end != sourcelist->records.end() && *end / 512 == section)
            ++end, ++size;

        return size;
}

VirtualTableSource::VirtualTableSource(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, TableDef const *tabledef, unsigned tablenr)
: SourceBase(scanner, _filter_items)
, tabledef(*tabledef)
, tablenr(tablenr)
{
}
bool VirtualTableSource::FirstBlock()
{
        return true;
}
bool VirtualTableSource::NextBlock()
{
        return false; //there is never more than one block
}
bool VirtualTableSource::FirstRowInBlock()
{
        virt_iterator.reset(tabledef.record_itr_func(scanner.trans, *this));
        if(!virt_iterator.get())
            return false;
        return NextRowInBlock();
}
bool VirtualTableSource::NextRowInBlock()
{
        scanner.CheckAbortFlag();
        while(true)
        {
                currec=Record();
                if(!virt_iterator->GetRecord(&currec))
                    break;

                scanner.active_row[tablenr].recordid = 0; //Not a diskmounted record!
                scanner.active_row[tablenr].record = currec;
                if (IsMatch())
                    return true; //got a record!
        }
        return false;
}
bool VirtualTableSource::IsLimitedMatch(Record const &record, ColumnId range_start, unsigned range_size) const
{
        Search const &search = scanner.GetSearch();
        ColumnId range_limit = ColumnId(range_start + range_size);
        for (std::vector< DBScanner::SearchItemId >::const_iterator it = filter_items->begin(); it != filter_items->end(); ++it)
        {
                Search::Item const &item = search.GetItem(*it);
                if (item.type != SearchItemType::SingleItem) // ADDME: allow joins
                    continue;
                ColumnId colid = item.columndef->column_id;
                if (colid < range_start || colid >= range_limit)
                    continue;

                if (!IsCellMatch(record.GetCell(colid), item.datacell, item.columndef->type, item.relation, item.case_sensitive))
                    return false;
        }
        return true;
}


RecordMapper::RecordMapper(Scanner &scanner, DBScanner::SearchItemIds const *_filter_items, TableDef const *_tabledef, ShowMode _showmode, unsigned _tablenr)
: SourceBase(scanner, _filter_items)
, tabledef(_tabledef)
, showmode(_showmode)
, viewer(scanner.rawdb, _tabledef->object_id, scanner.trans.GetIdentifiedTrans(), showmode)
, readaccess(NULL)
, tablenr(_tablenr)
{
}

bool RecordMapper::IsVisible(RawDatabase::SectionViewer::DiskRecord const &dr)
{
        RecordOverride::_type co = scanner.trans.GetRecordOverride(tabledef->object_id, dr.recordid);
        switch (co)
        {
        case RecordOverride::Normal:
        default:
                return dr.is_visible;
        case RecordOverride::NormalLocked:
        case RecordOverride::ForcedVisible:
        case RecordOverride::ForcedVisibleLocked:
        case RecordOverride::Expired:
        case RecordOverride::ExpiredLocked:
                return true;
        case RecordOverride::NewRecord:
        case RecordOverride::ForcedInvisible:
        case RecordOverride::IntroducedByChase:
                return false;
        }
}

bool RecordMapper::IsAccessVisible(RawDatabase::SectionViewer::DiskRecord const &dr)
{
        if (showmode == ShowNormal)
        {
                RecordOverride::_type co = scanner.trans.GetRecordOverride(tabledef->object_id, dr.recordid);
                if (co == RecordOverride::Normal && readaccess && !readaccess(&scanner.trans, *tabledef, dr.record))
                    return false;
        }
        return true;
}

bool RecordMapper::FirstBlock()
{
        viewer_viewptr = 0;
        viewer_startptr = 0;
        if (ris.get())
        {
                ris->Reset();
                unsigned count = ris->GetBlock(BlockSize);
                if (count==0)
                    return false;

                // Do a guided move to a section
                if (!viewer.GuidedMoveToSection(tabledef->object_id, ris->block_begin(), count))
                    throw Exception(ErrorInternal, "Error positioning on section");
        }
        else
        {
                if (!viewer.MoveToFirstSection())
                    return false;
        }
        std::fill_n(status, BlockSize, C_Unknown);
        return true;
}

bool RecordMapper::NextBlock()
{
        viewer_startptr += BlockSize;
        if (viewer_startptr >= viewer.view_size()) //End of current view reached?
        {
                viewer_startptr=0; //next view!
                viewer_viewptr=0;

                if (ris.get())
                {
                        // Get a sectioned block from the index
                        unsigned count = ris->GetBlock(BlockSize);
                        if (!count)
                            return false;

                        // Do a guided move to a section
                        if (!viewer.GuidedMoveToSection(tabledef->object_id, ris->block_begin(), count))
                            throw Exception(ErrorInternal, "Error positioning on section");
                }
                else // Do a raw table scan (first next view, otherwise next section)
                {
                        do
                        {
                                if (!viewer.NextViewInSection() && !viewer.MoveToNextSection())
                                    return false;
                        }
                        while (viewer.view_size() == 0);
                }
        }
        std::fill_n(status, BlockSize, C_Unknown);
        scanner.CheckAbortFlag();
        return true;
}
bool RecordMapper::FirstRowInBlock()
{
        viewer_viewptr=0;
        return GetNextAccessibleRecord();
}
bool RecordMapper::NextRowInBlock()
{
        ++viewer_viewptr;
        return GetNextAccessibleRecord();
}
bool RecordMapper::GetNextAccessibleRecord()
{
        for(;viewer_viewptr < BlockSize && viewer_startptr+viewer_viewptr < viewer.view_size();++viewer_viewptr)
        {
                // Ok, now we have a valid result at viewer_viewptr
                RawDatabase::SectionViewer::DiskRecord const &result = viewer.view_begin()[viewer_startptr + viewer_viewptr];

                if (status[viewer_viewptr] == C_Invisible)
                    continue;

                scanner.active_row[tablenr].recordid = result.recordid;
                scanner.active_row[tablenr].record = result.record;

                //Get the visibility status for this record
                if (status[viewer_viewptr] == C_Unknown)
                {
                        status[viewer_viewptr] = C_Invisible;
                        if (filter)
                        {
                                if (!filter->Contains(result.recordid))
                                    continue;
                        }
                        else
                        {
                                if (!sourcelist_source && !IsVisible(result))
                                    continue;
                        }
                        if (!IsMatch() ||!IsAccessVisible(result))
                            continue;
                }
                status[viewer_viewptr] = C_Visible;
                return true;
        }
        return false; //out of records
}

// Warning! The initialization code may NOT access anything!!!
Scanner::Scanner(BackendTransaction &_trans, ShowMode showmode, bool _for_update)
: trans(_trans)
, rawdb(trans.backend.rawdb)
, for_update(_for_update)
, showmode(showmode)
, table_count(0)
, cache_fill(0)
, row_is_active(false)
{
        if (for_update && showmode != ShowNormal && showmode != ShowNormalSkipAccess)
            throw Exception(ErrorInvalidArg,"Opening an updating scanner is only possible in a 'normal' showmode");
}

/*
Scanner::Scanner(BackendTransaction &_trans, ShowMode showmode)
: trans(_trans) //ADDME: Ugly view
, rawdb(trans.backend.rawdb)
, for_update(false)
, showmode(showmode)
, table_count(0)
, cache_fill(0)
, row_is_active(false)
{
        assert(showmode != ShowNormal);
} */

// Warning! This member must release ALL resources!!!
void Scanner::Close()
{
        // Clears all locks and section locks of cache
        ClearCache();
        // Delete entire search tree; also releases section locks of active row
        top.reset();
        // Kill plan
        plan.reset();
}

// Warning! The desctruction code may NOT access anything outside Scanner when Close() has been called before!!
Scanner::~Scanner()
{
        ClearCache();
}

void Scanner::CheckAbortFlag() const
{
        trans.CheckAbortFlag();
}

Cell Scanner::SafeGetCell(Record recdata, ColumnDef const &columndef, CellStore &store)
{
        if (columndef.internalcolumn_handler)
        {
                unsigned len=columndef.internalcolumn_handler(store+Cell::HdrSize,sizeof(store)-Cell::HdrSize,&trans,recdata);
                SetCellSize(store,static_cast<uint16_t>(len));
                return Cell(store);
        }
        else
            return recdata.GetCell(columndef.column_id);
}

bool Scanner::Matches(DBScanner::SearchItemId id)
{
        Search::Item const &item = search.items[id];

        switch (item.type)
        {
        case SearchItemType::SingleItem:
            {
                    uint8_t store[MaxColumnSize + Cell::HdrSize];
                    Cell cell = SafeGetCell(active_row[item.tableindex].record, *item.columndef, store);

                    return IsCellMatch(cell, item.datacell, item.columndef->type, item.relation, item.case_sensitive);
            };
        case SearchItemType::JoinTables:
            {
                    Search::JoinItem const &sub = item.joinitem;

                    uint8_t store_l[MaxColumnSize + Cell::HdrSize];
                    uint8_t store_r[MaxColumnSize + Cell::HdrSize];
                    Cell cell_l = SafeGetCell(active_row[item.tableindex].record, *item.columndef, store_l);
                    Cell cell_r = SafeGetCell(active_row[sub.tableindex2].record, *sub.columndef2, store_r);

                    return IsCellMatch(cell_l, cell_r, item.columndef->type, item.relation, item.case_sensitive);
            };
        default: ;
        }
        return false;
}

bool Scanner::CacheRowMatches(unsigned rownr)
{
        for (unsigned idx = 0; idx < search.original_item_count; ++idx)
        {
                CachedItem *row = &cache[rownr * table_count];
                Search::Item const &item = search.items[idx];

                bool match = false;
                switch (item.type)
                {
                case SearchItemType::SingleItem:
                    {
                            uint8_t store[MaxColumnSize + Cell::HdrSize];
                            Cell cell = SafeGetCell(Record(row[item.tableindex].recordraw, row[item.tableindex].reclen), *item.columndef, store);

                            match = IsCellMatch(cell, item.datacell, item.columndef->type, item.relation, item.case_sensitive);
                    } break;
                case SearchItemType::JoinTables:
                    {
                            Search::JoinItem const &sub = item.joinitem;

                            uint8_t store_l[MaxColumnSize + Cell::HdrSize];
                            uint8_t store_r[MaxColumnSize + Cell::HdrSize];
                            Cell cell_l = SafeGetCell(Record(row[item.tableindex].recordraw, row[item.tableindex].reclen), *item.columndef, store_l);
                            Cell cell_r = SafeGetCell(Record(row[sub.tableindex2].recordraw, row[item.tableindex].reclen), *sub.columndef2, store_r);

                            match = IsCellMatch(cell_l, cell_r, item.columndef->type, item.relation, item.case_sensitive);
                    } break;
                default: ;
                }
                if (!match)
                    return false;
        }
        return true;
}

void Scanner::SetLimit(unsigned new_limit)
{
        search.SetLimit(new_limit);
}

void Scanner::AddTable(TableId tableid)
{
        TableDef const *table = trans.GetMetadata().GetTableDef(tableid);
        if (!table)
            throw Exception(ErrorInvalidArg,"No table with id #" + Blex::AnyToString(tableid));

        search.AddTable(Search::Table(table));
}

void Scanner::AddTable(TableDef const *tabledef)
{
        search.AddTable(Search::Table(tabledef));
}

void Scanner::AddRecordSet(TableId tableid, std::vector< RecordId > const &records, bool allow_sort)
{
        TableDef const *table = trans.GetMetadata().GetTableDef(tableid);
        if (!table)
            throw Exception(ErrorInvalidArg,"No table with id#" + Blex::AnyToString(tableid));

        search.AddTable(Search::Table(table,records, allow_sort));
}

void Scanner::AddRecordSet(TableId tableid, std::set< RecordId > const &records, bool allow_sort)
{
        TableDef const *table = trans.GetMetadata().GetTableDef(tableid);
        if (!table)
            throw Exception(ErrorInvalidArg,"No table with id#" + Blex::AnyToString(tableid));

        //FIXME: Optimize this by allowing us to immediately insert into the destination vector
        std::vector<RecordId> realrecords(records.begin(), records.end());
        search.AddTable(Search::Table(table,realrecords, allow_sort));
}

TableDef const * Scanner::GetTable(unsigned tableindex)
{
        return search.GetTable(tableindex).tabledef;
}

unsigned Scanner::GetTableCount()
{
        return search.GetTableCount();
}

void Scanner::SetJoinSearch(DBScanner::SearchItemId id, unsigned tablenr, ColumnDef const &columndef, CellStore &store)
{
        Search::Item &item = search.items[id];
        item.datacell = SafeGetCell(active_row[tablenr].record, columndef, store);
}

std::unique_ptr< SourceBase > Scanner::BuildNode(DBScanner::PlanSource const &source)
{
        if (source.is_join())
            return BuildJoin(*source.is_join());
        if (DBScanner::PlanTable const *plan = source.is_table())
        {
                if (search.tables[plan->tablenr].tabledef->record_itr_func)
                     return BuildVTableIterator(*plan);
                return BuildRecordMapper(*plan);
        }
        throw Exception(ErrorInternal, "Unknown plan type");
}

std::unique_ptr< SourceBase > Scanner::BuildJoin(DBScanner::PlanJoin const &join)
{
        std::unique_ptr< SourceBase > left;
        left.reset(BuildNode(*join.left).release());
        std::unique_ptr< SourceBase > right;
        right.reset(BuildNode(*join.right).release());

        if (join.join_count == 0)
        {
                std::unique_ptr<BlockJoiner> joiner;
                joiner.reset(new BlockJoiner(*this, &join.items, left, right));
                joiner->InitFromPlan(join);
                return std::unique_ptr< SourceBase >(joiner.release());
        }
        else
        {
                std::unique_ptr<IndexJoiner> joiner;
                joiner.reset(new IndexJoiner(*this, &join.items, left, right));
                joiner->InitFromPlan(join);
                return std::unique_ptr< SourceBase >(joiner.release());
        }
}

std::unique_ptr< SourceBase > Scanner::BuildVTableIterator(DBScanner::PlanTable const &table)
{
        std::unique_ptr< SourceBase > source;
        source.reset(new VirtualTableSource(*this, &table.items, search.tables[table.tablenr].tabledef, table.tablenr));
        return source;
}

std::unique_ptr< SourceBase > Scanner::BuildRecordMapper(DBScanner::PlanTable const &table)
{
        std::unique_ptr< RecordMapper > mapper;

        mapper.reset(new RecordMapper(*this, &table.items, search.tables[table.tablenr].tabledef, showmode, table.tablenr));

        mapper->sourcelist_source = false;
        if (table.index)
        {
                std::unique_ptr< IndexQuery > iq(new IndexQuery(*this));
                for (unsigned i=0; i<table.indexitemcount; ++i)
                    iq->items[i] = &search.items[table.indexitemids[i]];
                iq->itemcount = table.indexitemcount;
                iq->in_itemnr = 0;
                iq->index = table.index;

                mapper->ris.reset(iq.release());
                mapper->filter = table.sourcelist;
        }
        else if (table.sourcelist)
        {
                mapper->sourcelist_source = true;
                mapper->ris.reset(new RecordList(table.sourcelist));
        }

        //ADDME: Because the read access managers don't understand Backup and Sysop roles, manually disable the readaccess mgrs for them!
        if (showmode == ShowNormal && !trans.IsRoleEnabled(MetaRole_SYSTEM) && !trans.IsRoleEnabled(MetaRole_BACKUP))
            mapper->readaccess = mapper->tabledef->readaccess;

        return std::unique_ptr< SourceBase >(mapper.release());
}

void Scanner::PrepareFromPlan()
{
        top.reset();
        row_is_active = false;
        ClearCache();
        table_count = search.tables.size();
        limit = search.limit;
        use_limit = limit != 0;
        have_delete_privilege = false;
        have_global_update_privilege = false;

        top.reset(BuildNode(*plan->top).release());

        // Check all rights
        if (for_update && table_count != 0)
        {
                if (showmode != ShowNormal)
                {
                        have_delete_privilege = true;
                        have_global_update_privilege = true;
                }
                else
                {
                        // User must have delete right on table or update right for any column.
                        TableDef const *tabledef = GetTable(0);

                        have_delete_privilege = trans.HasPrivilege(tabledef->object_id, Privilege::Table_Delete);
                        have_global_update_privilege = trans.HasPrivilege(tabledef->object_id, Privilege::Column_Update);

                        if (!have_delete_privilege && !have_global_update_privilege && !trans.HasPrivilegeOnAnyColumn(tabledef->object_id, Privilege::Column_Update))
                            throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to update or delete in table " + tabledef->GetPrettyName());
                }
        }

        if (showmode == ShowNormal)
        {
                // Check whether any selected table is selectable (select right on ANY column, or table itself)
                for (unsigned idx = 0; idx < GetTableCount(); ++idx)
                {
                        bool has_right = false;
                        TableDef const *tabledef = GetTable(idx);
                        if (trans.HasPrivilege(tabledef->object_id, Privilege::Column_Select))
                            has_right = true;
                        else
                        {
                                for (TableDef::Columns::const_iterator it = tabledef->GetColumns().begin(); it != tabledef->GetColumns().end(); ++it)
                                    if (trans.HasPrivilege(it->second.object_id, Privilege::Column_Select))
                                    {
                                            has_right = true;
                                            break;
                                    }
                        }

                        // Can's select ANY of the columns? Then you have no right to know the length of the table!
                        if (!has_right)
                            throw Exception(ErrorReadAccessDenied, "Not sufficient privileges to select " + tabledef->GetPrettyName());
                }

                for (unsigned idx = 0; idx < search.original_item_count; ++idx)
                {
                        Search::Item const &item = search.GetItem(idx);

                        if (!trans.HasPrivilege(item.columndef->object_id, Privilege::Column_Select))
                            throw Exception(ErrorReadAccessDenied, "Not sufficient privileges to select " + item.columndef->GetPrettyName());

                        if (item.type == SearchItemType::JoinTables)
                        {
                                if (!trans.HasPrivilege(item.joinitem.columndef2->object_id, Privilege::Column_Select))
                                    throw Exception(ErrorReadAccessDenied, "Not sufficient privileges to select " + item.joinitem.columndef2->GetPrettyName());
                        }
                };
        }
}

bool Scanner::RowActive()
{
        return row_is_active;
}

unsigned Scanner::CountRows()
{
        //ADDME: Room for optimization?
        unsigned count=0;
        while (NextRow())
            ++count;

        return count;
}

void Scanner::HitEof()
{
        //Prepare the scanner to return no more results (ADDME: If we'd coordinate
        //better with our callers (they would guarantee not to call us at EOF)
        //we wouldn't need this)
        use_limit=true;
        limit=0;
        row_is_active = false;
}

bool Scanner::NextRow()
{
        if (!plan.get()) //Argh, still need to create a plan
        {
                DBScanner::PlanBuilder builder(trans, search);
                plan.reset(builder.Construct().release());
                PrepareFromPlan();
                if ( (use_limit && limit==0) || !top->FirstBlock())
                    return HitEof(), false; //there is no more data!
                row_is_active=top->FirstRowInBlock();
        }
        else
        {
                row_is_active=top->NextRowInBlock();
        }

        if (use_limit)
        {
                if(limit == 0)
                    return HitEof(), false;
                --limit;
        }

        while(!row_is_active) //try next block
        {
                if (!top->NextBlock())
                    return HitEof(), false;
                row_is_active=top->FirstRowInBlock();
        }

#if defined(DEBUG) && defined(AFTERTEST_RESULTS)
        for (unsigned i = 0; i < search.original_item_count; ++i)
          if (!Matches(i))
            throw Exception(ErrorInternal, "Scanner returned invalid results");
#endif
        return true;
}

Record Scanner::GetRowPart(unsigned tablenr)
{
        return active_row[tablenr].record;
}

RecordId Scanner::GetRowPartRecordId(unsigned tablenr)
{
        return active_row[tablenr].recordid;
}

std::string Scanner::GetRowPartCellDump(unsigned tablenr, ColumnId colid)
{
        ColumnDef const *coldef = search.tables[tablenr].tabledef->GetColumnDef(colid);
        std::string retval;
        if (coldef)
        {
                Record rec = GetRowPart(tablenr);
                Cell cell = rec.GetCell(colid);

                switch (coldef->type)
                {
                case TInteger:
                    {
                            retval = Blex::AnyToJSON(cell.Integer());
                    } break;
                case TText:
                    {
                            retval = Blex::AnyToJSON(cell.String());
                    } break;
                default:
                    {
                            retval = "(type: " + Blex::AnyToString((int)coldef->type) + ")";
                    }
                }
        }
        return retval;
}


void Scanner::AddActiveRowToCache()
{
        if (IsCacheFull())
            throw Exception(ErrorInvalidArg,"Query record cache overflow");
        if (!row_is_active)
            throw Exception(ErrorInvalidArg,"Adding inactive row to cache");
        unsigned offset = cache_fill * table_count;
        for (unsigned idx = 0; idx < table_count; ++idx)
        {
                cache[offset].recordid = active_row[idx].recordid;
                if (cache[offset].recordid == 0) //Virtual record - copy it, because it will move away and cannot be locked!
                {
                        if (cache_backing.empty())
                            cache_backing.resize(CacheSize); //ADDME: Optimize, we don't really need 64 records

                        cache_backing[offset] = active_row[idx].record;
                        cache[offset].recordraw = cache_backing[offset].GetRawData();
                        cache[offset].reclen = cache_backing[offset].GetRawLength();
                }
                else
                {
                        TableId tableid = GetTable(idx)->object_id;
                        cache[offset].recordraw = trans.locker.LockRec(tableid, active_row[idx].recordid).GetRawData();
                        cache[offset].reclen = active_row[idx].record.GetRawLength();
                }
                ++offset;
        }
        lockdata[cache_fill].original = 0;
        lockdata[cache_fill].is_locked = false;
        ++cache_fill;
}

Record Scanner::GetCachedRowPart(unsigned row, unsigned tablenr)
{
        if (row >= cache_fill || tablenr >= table_count)
            return Record();
        return Record(cache[row * table_count + tablenr].recordraw, cache[row * table_count + tablenr].reclen);
}

RecordId Scanner::GetCachedRowPartRecordId(unsigned row, unsigned tablenr)
{
        if (row >= cache_fill || tablenr >= table_count)
            return 0;
        return cache[row * table_count + tablenr].recordid;
}

Cell Scanner::GetCachedRowPartCell(unsigned row, unsigned tablenr, ColumnDef const &columndef, CellStore &store)
{
        return SafeGetCell(GetCachedRowPart(row, tablenr), columndef, store);
}

void Scanner::ClearCache()
{
        for (unsigned row = 0; row < cache_fill; ++row)
            if (lockdata[row].original)
            {
                    if (lockdata[row].is_locked)
                        DEBUGPRINT("Warning, row " << row << " not unlocked (may be due to a transaction error)");
                    UnlockCachedRow(row);
            }

        for (unsigned idx = 0; idx < table_count; ++idx)
        {
                for (unsigned row = 0; row < cache_fill; ++row)
                  if (cache[row * table_count + idx].recordid)
                    trans.locker.UnlockRec(cache[row * table_count + idx].recordid);
        }
        cache_fill = 0;
}

LockResult::_type Scanner::LockCachedRowInternal(unsigned row, bool can_signal)
{
        if (!for_update)
            throw Exception(ErrorInvalidArg,"DBScanner not in update-mode");

        if (row >= cache_fill)
            throw Exception(ErrorInvalidArg,"Row id not in row cache");

        if (lockdata[row].is_locked)
            throw Exception(ErrorInvalidArg,"Row already locked");

        CachedItem &item = cache[row * table_count];

        TableDef const *tabledef = search.tables[0].tabledef;

        TransactionState::Type transstate = trans.GetState();
        if (transstate == TransactionState::ReadOnly)
            throw Exception(ErrorInvalidArg,"Record lock issued in a readonly-transaction");
        else if (transstate == TransactionState::ReadOnlyAfterError)
            return LockResult::Deleted; // Ignore the lock

        // Replicated from Backend::LockResult
        trans.PrepareForWrite();

        LockResult::_type result;

        std::pair<bool,RecordId> new_recid;

        /* Try to lock the current record. If it has been modified outside our
           transaction (by a concurrent transaction), chase it to the next version */
        while (true)
        {
                /* Expire the current record.
                   Old code retried expiring while record was expired by another
                   uncommitted transaction for max. 60 seconds. Due to worker thread
                   starvation that transaction couldn't finish, leading to deadlock.
                   Current code relays the info back to client, releasing this thread. */
                while (true)
                {
                        // Try to expire record (fail when expired by uncommitted transaction)
                        new_recid = trans.TryExpireRecord(tabledef->object_id, item.recordid, can_signal, !trans.clustering_updates);
                        if (new_recid.first)
                        {
                                // Expiration was successfull, continue
                                break;
                        }

                        // TryExpire failed, and nothing was expired. We can safely retry later.
                        if (trans.clustering_updates)
                        {
                                // Clustering updates are not allowed to wait on locked records, treat as deleted
                                new_recid.first = true;
                                new_recid.second = 0;
                                break;
                        }

                        return LockResult::Retry; //ADDME: Don't bother clients with this state. Instead, handle locks locally
/*
                        Blex::SleepThread(100); //wait 1/10 seconds...
                        if (++try_update_counter > 600) //give up after 60 seconds
                            throw Exception(ErrorConflict,"Giving up on trying to lock " + Blex::AnyToString(item.recordid));
*/
                }

                // Lock has been acquired or record has been deleted. If deleted, register that and return.
                if (new_recid.second == 0)
                {
                        trans.SetRecordOverride(tabledef->object_id, item.recordid, RecordOverride::Expired);
                        result = LockResult::Deleted;
                        lockdata[row].original = 0; // No lock has been achieved, no override adjustment needed

                        break;
                }

                bool is_first_expire = lockdata[row].original == 0;

                // Is the first chased record?
                if (is_first_expire)
                {
                        RecordOverride::_type co = trans.GetRecordOverride(tabledef->object_id, item.recordid);
                        switch (co)
                        {
                        case RecordOverride::Normal: // Visible by basic visibility rules
                                co = RecordOverride::NormalLocked; break;
                        case RecordOverride::Expired:
                                co = RecordOverride::ExpiredLocked; break;
                        case RecordOverride::ForcedVisible:
                                co = RecordOverride::ForcedVisibleLocked; break;
                        case RecordOverride::NormalLocked:
                        case RecordOverride::ExpiredLocked:
                        case RecordOverride::ForcedVisibleLocked:
                            throw Exception(ErrorInvalidArg, "Trying to lock a record already locked in this transaction.");
                        default:
                            throw Exception(ErrorInternal, "Encountered unexpected record override in LockRecord.");
                        }
                        trans.SetRecordOverride(tabledef->object_id, item.recordid, co);

                        lockdata[row].original = item.recordid;

                        //ADDME: Allow stateful chases. I'm pretty sure I'm opening up a loophole in the RPC layers here, but we need to get rid of the 'local' has_chased flag to ensure everything works with client-based delays
                        //FIXME: Check ALL LockCachedRow calls in the DB, and make them accept LockResult::Retry!!!
                }

                // Check if expiration was successful, or a chase was necessary
                if (new_recid.second == item.recordid)
                {
                        // Last expired record was the final one.
                        result = is_first_expire ? LockResult::NoChange : LockResult::Updated;
                        break;
                }
                else
                {
                        // Record was chased. Get the new version in the cache, and chase further on.
                        trans.locker.UnlockRec(item.recordid);

                        item.recordid = new_recid.second;
                        Record recinfo = trans.locker.LockRec(tabledef->object_id, item.recordid);
                        item.recordraw = recinfo.GetRawData();
                        item.reclen = recinfo.GetRawLength();
                }
        }

        // Lock has been achieved
        lockdata[row].is_locked = lockdata[row].original != 0;

        // If there was chased, the current row must be checked if the required conditions still hold.
        if (result == LockResult::Updated && !CacheRowMatches(row))
        {
                // Record changed, and is not valid anymore. Unlock, register as deleted.
                result = LockResult::Deleted;
                UnlockCachedRow(row);
        }

        return result;
}

LockResult::_type Scanner::LockCachedRowWithAutoWait(unsigned row)
{
        unsigned try_update_counter = 0;
        while (true)
        {
                LockResult::_type result = LockCachedRowInternal(row, /*can_signal=*/false);
                if (result != LockResult::Retry)
                    return result;

                if (++try_update_counter > 600) //give up after 60 seconds
                    throw Exception(ErrorConflict,"Giving up on trying on lock " + Blex::AnyToString(cache[row * table_count].recordid));

                Blex::SleepThread(100); //wait 1/10 seconds...
        }
}

void Scanner::UnlockCachedRow(unsigned row)
{
        if (row >= cache_fill)
            throw Exception(ErrorInvalidArg,"Row id not in row cache");

        if (!lockdata[row].is_locked && lockdata[row].original == 0)
            throw Exception(ErrorInvalidArg,"Row not locked (UnlockCachedRow)");

        CachedItem &item = cache[row * table_count];

        TableDef const *tabledef = search.tables[0].tabledef;

        // Unexpire the record at the end of the chase-chain (only if locked!)
        if (lockdata[row].is_locked)
        {
                trans.UnexpireRecord(tabledef->object_id, item.recordid);
                lockdata[row].is_locked = false;
        }

        if (lockdata[row].original != item.recordid)
        {
                // When we do a dummy update after a chase, we still introduce
                // that change into our transaction. The original record should
                // stay expired, but the new version must become visible after
                // the current command
                trans.SetRecordOverride(tabledef->object_id, lockdata[row].original, RecordOverride::Expired);
                trans.SetRecordOverride(tabledef->object_id, item.recordid, RecordOverride::IntroducedByChase);
        }
        else
        {
                // No chase hath taken place, reset the command override at the begin of the chase-chain. Issue NO modification!
                RecordOverride::_type co = trans.GetRecordOverride(tabledef->object_id, lockdata[row].original);
                switch (co)
                {
                case RecordOverride::NormalLocked:
                    co = RecordOverride::Normal; break;
                case RecordOverride::ForcedVisibleLocked:
                    co = RecordOverride::ForcedVisible; break;
                default:
                    // RecordOverride::ExpiredLocked may not occur, because it can only occur in chases.
                    throw Exception(ErrorInternal, "Unlock expected an expired record as original in UnlockCachedRow");
                }
                trans.SetRecordOverride(tabledef->object_id, lockdata[row].original, co);
        }

        lockdata[row].original = 0;
}

void Scanner::DeleteLockedRow(unsigned row/*, bool no_access_checks*/, bool report_delete)
{
        if (row >= cache_fill)
            throw Exception(ErrorInvalidArg,"Row id not in row cache");

        if (!lockdata[row].is_locked)
            throw Exception(ErrorInvalidArg,"Row not locked (DeleteLockedRow)");

        CachedItem &item = cache[row * table_count];
        TableDef const *tabledef = search.tables[0].tabledef;

        if (showmode != ShowNormalSkipAccess)
        {
                if (tabledef->writeaccess)
                {
                        Record rec(item.recordraw, item.reclen);
                        tabledef->writeaccess(&trans, *tabledef, ActionDelete, rec, rec);
                }
                if (!have_delete_privilege)
                    throw Exception(ErrorWriteAccessDenied,"User does not have sufficient privileges to delete a record from table " + tabledef->name);
        }

        if (report_delete)
            trans.local_modifications.ReportDelete(tabledef->object_id, item.recordid);

        trans.SetRecordOverride(tabledef->object_id, lockdata[row].original, RecordOverride::Expired);

        lockdata[row].original = 0;
        lockdata[row].is_locked = false;
}

void Scanner::UpdateLockedRow(unsigned row, Record const &updates/*, bool no_access_checks*/)
{
        if (row >= cache_fill)
            throw Exception(ErrorInvalidArg,"Row id not in row cache");

        if (!lockdata[row].is_locked)
            throw Exception(ErrorInvalidArg,"Row not locked (UpdateLockedRow)");

        CachedItem &item = cache[row * table_count];

        TableDef const *tabledef = search.tables[0].tabledef;

        // No privilege checks needed in showmode normalskipaccess, or when global insert privileges have already been established.
        bool no_privilege_checks = showmode == ShowNormalSkipAccess || have_global_update_privilege;
        bool no_access_checks = showmode == ShowNormalSkipAccess;

        // Construct the new record on the db
        std::pair<bool,RecordId> updateresult = trans.UpdateRecord(*tabledef, item.recordid, Record(item.recordraw, item.reclen), updates, no_privilege_checks, no_access_checks, &trans.modified_columns);

        // Update the command overrides and modifications
        if (updateresult.first)
        {
                trans.local_modifications.ReportUpdate(tabledef->object_id, item.recordid, updateresult.second, trans.modified_columns);
                trans.SetRecordOverride(tabledef->object_id, lockdata[row].original, RecordOverride::Expired);
                lockdata[row].original = 0;
                lockdata[row].is_locked = false;
        }
        else
        {
                // Dummy update, treat this as an unlock.
                UnlockCachedRow(row);
        }
}

bool Scanner::CanChaseToNowCommitted()
{
        return trans.FindAfterCommitVersion(search.GetTable(0).tabledef->object_id, active_row[0].recordid) != 0;
}

std::string Scanner::DumpPlan()
{
        std::stringstream str;
        plan->Dump(str, search);
        return str.str();
}

void DumpCurrentRow(Scanner &scanner)
{
        Search const &search = scanner.GetSearch();

        if (!scanner.RowActive())
        {
                DEBUGPRINT("No current active row");
        }
        else
        {
                std::ostringstream out;
                out << "Current row:" << std::endl;
                for (unsigned i = 0; i < search.GetTableCount(); ++i)
                {
                        TableDef const *tabledef = search.GetTable(i).tabledef;
                        TableDef::Columns const &columns = tabledef->GetColumns();
                        out << tabledef->name << ": (" << scanner.GetRowPartRecordId(i) << ") [";
                        Record rec = scanner.GetRowPart(i);

                        for (TableDef::Columns::const_iterator it = columns.begin(); it != columns.end(); ++it)
                        {
                                if (it != columns.begin())
                                    out << ", ";
                                out << it->second.name << ": ";
                                Cell cell = rec.GetCell(it->second.column_id);
                                if (cell.Exists())
                                    switch (it->second.type)
                                    {
                                    case TBoolean:      out << (cell.Boolean() ? "TRUE" : "FALSE"); break;
                                    case TMoney:        out << cell.Money() / 100000.0; break;
                                    case TInteger64:    out << cell.Integer64(); break;
                                    case TFloat:        out << cell.Float(); break;
                                    case TBlob:
                                    case TInteger:      out << cell.Integer(); break;
                                    case TDateTime:     out << cell.DateTime(); break;
                                    default:
                                        out << cell.String();
                                    }
                                else
                                    out << "N/A";
                        }
                        out << "]" << std::endl;
                }
                DEBUGPRINT(out.str());
        }
}


} // End of namespace Database
