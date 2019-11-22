#include <ap/libwebhare/allincludes.h>


#include "resultsets.h"
#include "dbase_rpcserver.h"
#include "dbase_transaction.h"

namespace Database
{
/** Maximum number of rows sent per notification block */
static const unsigned MaxRowsForNotifications = 64;

//--------------------------------------------------------------------------
//
// ResultSetBase
//
//--------------------------------------------------------------------------

ResultSetBase::ResultSetBase(void *_blobcontext)
: blobcontext(_blobcontext)
, description_generated(false)
{
}

ResultSetBase::~ResultSetBase()
{
}

void ResultSetBase::Close()
{
}

//--------------------------------------------------------------------------
//
// ScannerQuery
//
//--------------------------------------------------------------------------

bool ScannerQuery::HasFase2Data()
{
        for (std::vector< NeededColumn >::iterator it = columns.begin(); it != columns.end(); ++it)
            if (it->fases & DBRSTFase2)
                return true;

        return false;
}

//--------------------------------------------------------------------------
//
// StaticResultSet
//
//--------------------------------------------------------------------------

DBLockResult StaticResultSet::LockRow(unsigned)
{
        throw Exception(ErrorInvalidArg, "Locking not allowed for static result sets");
}

void StaticResultSet::UpdateRow(unsigned, WritableRecord &, BlobCheckCallback const &)
{
}
void StaticResultSet::DeleteRow(unsigned)
{
}
void StaticResultSet::UnlockRow(unsigned)
{
}

//--------------------------------------------------------------------------
//
// ScannerResultSet
//
//--------------------------------------------------------------------------


ScannerResultSet::ScannerResultSet(BackendTransaction &trans, bool for_update, void *blobcontext)
: ResultSetBase(blobcontext)
, query(trans, for_update)
{
}

void ScannerResultSet::GenerateDescription(Description *description)
{
        description->has_fase2_data = query.HasFase2Data();
        description->can_update = query.scanner.CanUpdate();
        description->max_rows_per_block = query.max_returned_rows;
}

void ScannerResultSet::FillTypeInfo(ColumnInfos *info)
{
        info->clear();
        for (std::vector< NeededColumn >::const_iterator it = query.columns.begin(); it != query.columns.end(); ++it)
        {
              if(it->columnselected)
                      info->push_back(ColumnInfo(it->columnselected->name, it->columnselected->type, it->fases));
              else
                      throw Exception(ErrorInvalidArg, "Requesting column info about a recordid"); //not sure if this should be supported
        }

        return;
}

bool ScannerResultSet::NextBlock()
{
        query.scanner.ClearCache();

        return TryAddRowToBlock() == 1;
}

unsigned ScannerResultSet::TryAddRowToBlock()
{
        if (query.scanner.RowActive() && !query.scanner.IsCacheFull() && query.scanner.GetCacheFill() < query.max_returned_rows)
        {
                query.scanner.AddActiveRowToCache();
                query.scanner.NextRow();

                return query.scanner.GetCacheFill();
        }
        return 0;
}

bool ScannerResultSet::AreRowsAvailable()
{
        return query.scanner.RowActive();
}

unsigned ScannerResultSet::CurrentRowCount()
{
        return query.scanner.GetCacheFill();
}

void ScannerResultSet::SendRow(unsigned row, DBRecordSendType sendtype, CellSender &sender)
{
        if (row > query.scanner.GetCacheFill()) //FIXME: Not >= ?
            throw Exception(ErrorInvalidArg,"Invalid row requested");

        unsigned col_count = 0;

        for (std::vector<NeededColumn>::const_iterator it = query.columns.begin(); it != query.columns.end(); ++it)
            if ((it->fases & sendtype) != 0)
                ++col_count;

        sender.ReportCellCount(col_count);

        uint8_t store[MaxColumnSize + Cell::HdrSize];

        uint16_t idx = 0;
        for (std::vector<NeededColumn>::const_iterator it = query.columns.begin(); it != query.columns.end(); ++it, ++idx)
            if ((it->fases & sendtype) != 0)
            {
                    if(!it->columnselected) //it's a recordid request
                    {
                            sender.SendInteger(query.scanner.GetCachedRowPartRecordId(row, it->tableindex), idx);
                    }
                    else
                    {
                            Cell cell;
                            cell = query.scanner.GetCachedRowPartCell(row, it->tableindex, *it->columnselected, store);
                            sender.SendCell(cell, it->columnselected->type, idx, GetBlobContext());
                    }
            }
}

DBLockResult ScannerResultSet::LockRow(unsigned row)
{
        if (row > query.scanner.GetCacheFill())
            throw Exception(ErrorInvalidArg,"Lock for invalid row requested");

        // Lock is retry-able
        LockResult::_type result = query.scanner.LockCachedRow(row);
        switch (result)
        {
        case LockResult::NoChange:      return DBLRLocked;
        case LockResult::Updated:       return DBLRLockedModified;
        case LockResult::Deleted:       return DBLRGone;
        case LockResult::Retry:         return DBLRRetry;
        default: ;
            throw Exception(ErrorInternal, "Invalid return value from scanner locking");
        }
}

void ScannerResultSet::UpdateRow(unsigned row, WritableRecord &record, BlobCheckCallback const &blobcheckcallback)
{
        if (row > query.scanner.GetCacheFill())
            throw Exception(ErrorInvalidArg,"Update for invalid row requested");

        // Translate the column ids from index in the column list to real column ids. Also check block accessibility.
        uint16_t count = (uint16_t)record.GetNumCells();
        for (uint16_t idx = 0; idx < count; ++idx)
        {
                ColumnId old_id = record.GetColumnIdByNum(idx);

                if ((unsigned)old_id >= query.columns.size())
                    throw Exception(ErrorInvalidArg, "Invalid column number (" + Blex::AnyToString(old_id) + ") specified in update (only " + Blex::AnyToString(query.columns.size()) + " columns available");

                // Get the columndef of this column
                ColumnDef const *coldef = query.columns[old_id].columnselected;
                if(!coldef)
                    throw Exception(ErrorInvalidArg, "Trying to update a recordid");

                if (coldef->type == TBlob)
                    blobcheckcallback(record.GetCell(old_id).Blob());

                record.SetColumnIdByNum(idx, coldef->column_id);
        }

        query.scanner.UpdateLockedRow(row, record);
}

void ScannerResultSet::UnlockRow(unsigned row)
{
        if (row > query.scanner.GetCacheFill())
            throw Exception(ErrorInvalidArg,"Unlock for invalid row requested");

        query.scanner.UnlockCachedRow(row);
}

void ScannerResultSet::DeleteRow(unsigned row)
{
        if (row > query.scanner.GetCacheFill())
            throw Exception(ErrorInvalidArg,"Delete for invalid row requested");

        query.scanner.DeleteLockedRow(row, true);
}

//--------------------------------------------------------------------------
//
// NotificationResultSet
//
//--------------------------------------------------------------------------

/* This function is safe for accessing BackendTransaction concurrently with other
   NotificationsResultSet constructors/public members/destructors. */
NotificationsResultSet::NotificationsResultSet(BackendTransaction &_trans, TableId tableid, TableMods const &_tablemods, std::vector< ColumnDef const * > const &_columns, void *blobcontext)
: StaticResultSet(blobcontext)
, trans(_trans)
, tablemods(_tablemods)
, scanner(trans, ShowNormal, false)     // Does not access BackendTransaction resources, so safe outside lock.
, rows_in_cache(0)
, columns(_columns)
, pos(0)
{
        Blex::Mutex::AutoLock lock(trans.notification_mutex);

        std::vector< RecordId > recordids;

        unsigned max_records = tablemods.removals.size() + tablemods.additions.size();
        actions.reserve(max_records);
        recordids.reserve(max_records);

        for (TableMods::RecordModSet::const_iterator it = tablemods.additions.begin(); it != tablemods.additions.end(); ++it)
        {
                if (it->second == 0)
                {
                        // insert
                        recordids.push_back(it->first);
                        actions.push_back(ActionInsert);
                }
                else
                {
                        // Update
                        recordids.push_back(it->first);
                        recordids.push_back(it->second);
                        actions.push_back(static_cast<Actions>(ActionUpdate | ActionInsert));
                        actions.push_back(static_cast<Actions>(ActionUpdate | ActionDelete));
                }
        }
        for (TableMods::RecordModSet::const_iterator it = tablemods.removals.begin(); it != tablemods.removals.end(); ++it)
        {
                if (it->second == 0) // Ignore updates
                {
                        // Delete
                        recordids.push_back(it->first);
                        actions.push_back(ActionDelete);
                }
        }

        scanner.AddRecordSet(tableid, recordids, false);

        // FIXME: should this be a generic call in ResultSets (both needed here, in RemoteScanStart...)
        scanner.NextRow();
}

/* Does not access any BackendTransaction resource. */
void NotificationsResultSet::GenerateDescription(Description *description)
{
        description->has_fase2_data = false;
        description->can_update = false;
        description->max_rows_per_block = MaxRowsForNotifications;
}

/* Does not access any BackendTransaction resource. */
void NotificationsResultSet::FillTypeInfo(ColumnInfos *info)
{
        info->clear();
        for (std::vector< ColumnDef const * >::const_iterator it = columns.begin(); it != columns.end(); ++it)
            if (*it)
                info->push_back(ColumnInfo((*it)->name, (*it)->type, 1));
            else
                info->push_back(ColumnInfo("unknown", TInteger, 1));
        info->push_back(ColumnInfo("__action__", TInteger, 1));

        return;
}

/* This function is safe for accessing BackendTransaction concurrently with other
   NotificationsResultSet constructors/public members/destructors. */
bool NotificationsResultSet::NextBlock()
{
        {
        Blex::Mutex::AutoLock lock(trans.notification_mutex);

        scanner.ClearCache();
        rows_in_cache = 0;
        }

        return TryAddRowToBlock() == 1;
}

/* This function is safe for accessing BackendTransaction concurrently with other
   NotificationsResultSet constructors/public members/destructors. */
unsigned NotificationsResultSet::TryAddRowToBlock()
{
        Blex::Mutex::AutoLock lock(trans.notification_mutex);

        if (scanner.RowActive() && !scanner.IsCacheFull() && rows_in_cache < MaxRowsForNotifications)
        {
                scanner.AddActiveRowToCache();
                ++rows_in_cache;
                ++pos;

                scanner.NextRow();

                return rows_in_cache;
        }
        return 0;
}

/* This function is safe for accessing BackendTransaction concurrently with other
   NotificationsResultSet constructors/public members/destructors. */
bool NotificationsResultSet::AreRowsAvailable()
{
        Blex::Mutex::AutoLock lock(trans.notification_mutex);

        return scanner.RowActive();
}

/* Does not access any BackendTransaction resource. */
unsigned NotificationsResultSet::CurrentRowCount()
{
        return rows_in_cache;
}

/* This function is safe for accessing BackendTransaction concurrently with other
   NotificationsResultSet constructors/public members/destructors. */
void NotificationsResultSet::SendRow(unsigned row, DBRecordSendType /*sendtype*/, CellSender &sender)
{
        Blex::Mutex::AutoLock lock(trans.notification_mutex);

        sender.ReportCellCount(columns.size() + 1);

        uint8_t store[MaxColumnSize + Cell::HdrSize];

        uint16_t idx = 0;
        for (std::vector< ColumnDef const * >::const_iterator it = columns.begin(); it != columns.end(); ++it, ++idx)
        {
                bool hide = !*it; //eg. trying to request a column in notifications that doesn't exist
                Cell cell = hide ? Cell() : scanner.GetCachedRowPartCell(row, 0, **it, store);

                sender.SendCell(cell, hide ? TText : (*it)->type, idx, GetBlobContext());
        }
        sender.SendInteger(actions[pos - rows_in_cache + row], idx);
}

void NotificationsResultSet::Close()
{
        Blex::Mutex::AutoLock lock(trans.notification_mutex);

        // Release ALL scanner resources within the mutex
        scanner.Close();
}

/* This function is safe for accessing BackendTransaction concurrently with other
   NotificationsResultSet constructors/public members/destructors. */
NotificationsResultSet::~NotificationsResultSet()
{
        // Just in case any exception took place
        Close();
}

//--------------------------------------------------------------------------
//
// TempResultSet
//
//--------------------------------------------------------------------------

TempResultSet::TempResultSet(void *blobcontext)
: StaticResultSet(blobcontext)
, block_start(0)
, block_length(0)
{
}
TempResultSet::~TempResultSet()
{
}

void TempResultSet::AddColumn(std::string const &name, ColumnTypes type)
{
        info.push_back(ColumnInfo(name,type,1));
}
void TempResultSet::AddRecord(Record const &newrecord)
{
        records.resize(records.size()+1);
        records.back() = newrecord;
}

void TempResultSet::FillTypeInfo(ColumnInfos *setinfo)
{
        *setinfo = info;
}
/* ADDME: ALlemaal erg verwarrend hoor, deze API. Geen idee hoe ik nu minimum # of RPCS haal
          dbase_rpcsrever lijkt eng, ik zie niet hoe hij doorgaat met zenden vna hetzelfde
          blok als een blok te groot bleek? */
bool TempResultSet::NextBlock()
{
        block_start += block_length;
        block_length=0;
        return TryAddRowToBlock() == 1;
}
unsigned TempResultSet::TryAddRowToBlock()
{
        if (!AreRowsAvailable()) //all blocks picked up
            return false;

        ++block_length;
        return true;
}
unsigned TempResultSet::CurrentRowCount()
{
        return block_length;
}
bool TempResultSet::AreRowsAvailable()
{
        return block_start + block_length < records.size();
}
void TempResultSet::SendRow(unsigned row, DBRecordSendType /*sendtype*/, CellSender &sender)
{
        if (row > block_length) //FIXME: Not >= ?
            throw Exception(ErrorInvalidArg,"Invalid row requested");

        WritableRecord &rec = records[block_start + row];
        sender.ReportCellCount(info.size());
        for (unsigned i=0;i<info.size();++i)
            sender.SendCell(rec.GetCell(uint16_t(i+1)), info[i].type, uint16_t(i), GetBlobContext());
}
void TempResultSet::GenerateDescription(Description *description)
{
        description->has_fase2_data = false;
        description->can_update = false;
        description->max_rows_per_block = MaxRowsForNotifications;
}

} //end namespace Database
