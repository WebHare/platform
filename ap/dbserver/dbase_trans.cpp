#include <ap/libwebhare/allincludes.h>


#include "dbase_trans.h"
#include "dbase_init.h"

#include <blex/bitmanip.h>
#include <blex/logfile.h>
#include <iostream>


/** Transaction IDs are split into 4 ranges.
    Inside the transaction file, the statusses of these IDs are stored on
    alternating pages, eg:

    <HeaderPage> <range 0 page 0> <range 1 page 0> <range 2 page 0> <range 3 page 0><range 0 page 1> <range 1 page 1> <range 2 page 1> <range 3 page 1> */

namespace Database
{

const TransId         TransStateMgr::NeverCommitted;
const TransId         TransStateMgr::AlwaysCommitted;

IdentifiedTrans::IdentifiedTrans(TransStateMgr &_trans_mgr, bool _client_trans)
: committable(true)
, data_written(false)
, trans_mgr(_trans_mgr)
, client_trans(_client_trans)
{
        TransStateMgr::Log::WriteRef(trans_mgr.log)->Register(this, client_trans);
}

/** Destroy this transaction. If the transaction has not been written
    to yet, it's transaction ID is made available for use again.
    Otherwise, the transaction remains in a rolled back state. */
IdentifiedTrans::~IdentifiedTrans()
{
        TransStateMgr::Log::WriteRef(trans_mgr.log)->Unregister(this);
}

void IdentifiedTrans::ThrowWriteWhileNotCommittable()
{
        throw Exception(ErrorInternal, "Trying to prepare a write in a finished transaction!");
}

void IdentifiedTrans::MarkTransactionCommitted()
{
        if (!committable)
            throw Exception(ErrorInternal, "Trying to commit an already finished transaction!");

        committable = false;
        TransStateMgr::Log::WriteRef loglock(trans_mgr.log);

        //Finish the transaction, commit if data written
        loglock->SetFinished(this_trans_id, data_written);
}

void IdentifiedTrans::MarkTransactionRolledBack()
{
        // We do survive repeated rollbacks.
        if (committable)
        {
                committable = false;
                TransStateMgr::Log::WriteRef loglock(trans_mgr.log);

                loglock->SetFinished(this_trans_id, false);
        }
}

bool IdentifiedTrans::IsParallelTransaction(TransId check_trans_id) const
{
        RangeId this_range = trans_mgr.GetRangeFromTransId(this_trans_id);
        RangeId check_range = trans_mgr.GetRangeFromTransId(check_trans_id);

        // If 'check' started after 'this', it can't be committed from the view of 'this'.
        // If both transactions are in the same range, the starting point is orderable by transaction id
        if (this_range == check_range)
        {
                // If 'this' started earlier, 'check' is always rolled back
                if (this_trans_id < check_trans_id)
                    return true;
        }
        else
        {
                // If 'this' is in a old range, and 'check' in the next, 'check' is always rolled back
                if (check_range == (this_range + 1) % TransStateMgr::RangesCount)
                    return true;
        }

        // 'check' started earlier. Was it running when we started?
        if (std::binary_search(earlier_running.begin(), earlier_running.end(), check_trans_id))
            return true;

        return false;
}


TransStateMgr::TransStatus IdentifiedTrans::GetTransVisibility(TransId check_trans_id,ShowMode showmode)
{
        return GetTransStatus(check_trans_id, 0, showmode);
}

TransStateMgr::TransStatus IdentifiedTrans::GetTransStatus(TransId check_trans_id, TransId *equivalent_id, ShowMode showmode) const
{
        if (equivalent_id)
            *equivalent_id = check_trans_id;

        if (check_trans_id==TransStateMgr::AlwaysCommitted)
            return TransStateMgr::GlobalCommitted;
        if (check_trans_id==TransStateMgr::NeverCommitted)
            return TransStateMgr::GlobalRolledBack;

        //We are always visible to ourselves
        if (this_trans_id == check_trans_id)
            return TransStateMgr::LocalCommitted;

        // Get the real commit status (will also update equivalent_id)
        TransStateMgr::TransStatus status = trans_mgr.GetStatus(check_trans_id, equivalent_id);

//        DEBUGPRINT("Gotten REAL commit status for " << check_trans_id << ": " << Blex::AnyToString(status));

        //Hide us from parallel changes?
        if (showmode != ShowAfterCommit)
        {
//                DEBUGPRINT("Checking for parallellity with " << check_trans_id);
                if (IsParallelTransaction(check_trans_id))
                {
                        assert(status != TransStateMgr::GlobalCommitted && (!equivalent_id || *equivalent_id != TransStateMgr::AlwaysCommitted)); // That would be BAD
                        return TransStateMgr::LocalRolledBack;
                }
        }

//        DEBUGPRINT("Not parallel, " << check_trans_id << " really is "<< Blex::AnyToString(status));

        //The transaction finished before us, so its visible if it actually committed
        return status; //trans_mgr.GetStatus(check_trans_id, equivalent_id);
}

bool IdentifiedTrans::IsRecordVisible(TransId inserter, TransId expirer, TransId *new_inserter, TransId *new_expirer, ShowMode showmode) const
{
        // The new data is initially the same as the old data, just to be sure
        if (new_inserter)
            *new_inserter = inserter;
        if (new_expirer)
            *new_expirer = expirer;

        // First do the cheap (local) tests
        // Never visible if the inserter is always invisible or updater is always committed
        if (inserter == TransStateMgr::NeverCommitted)
            return false;
        if (expirer == TransStateMgr::AlwaysCommitted)
            return false;
        if (inserter == TransStateMgr::AlwaysCommitted && expirer == TransStateMgr::NeverCommitted)
            return true;

        TransStateMgr::TransStatus i_status = GetTransStatus(inserter, new_inserter, showmode);
        TransStateMgr::TransStatus e_status = GetTransStatus(expirer, new_expirer, showmode);

        // May we update, and is it probable that they are (non-trivially) equivalent?
        if (new_inserter && new_expirer && i_status == e_status)
        {
                // FIXME: re-enable this when chase-information is stored in memory; by destroying this record we may sever the chase-chain
                TransStateMgr::Log::WriteRef loglock(trans_mgr.log);
                if (trans_mgr.IsCleaningAllowed() && loglock->IsVisibilityNonTrivialPermanent(*new_inserter, *new_expirer))
                {
                        *new_inserter = TransStateMgr::AlwaysCommitted;
                        *new_expirer = TransStateMgr::AlwaysCommitted;

                        return false;
                }
        }

        // Check the status of the inserter
        switch (i_status)
        {
        case TransStateMgr::Busy:
        case TransStateMgr::LocalRolledBack:              // Inserter not committed: invisible
        case TransStateMgr::GlobalRolledBack:
                return false;
        default: ;
        }
        assert(i_status == TransStateMgr::LocalCommitted || i_status == TransStateMgr::GlobalCommitted);

        // Check the status of the expirer
        switch (e_status)
        {
        case TransStateMgr::Busy:
        case TransStateMgr::LocalRolledBack:              // Updater not committed: visible
        case TransStateMgr::GlobalRolledBack:
                return true;
        default: ;
        }
        assert(e_status == TransStateMgr::LocalCommitted || e_status == TransStateMgr::GlobalCommitted);

        // Inserter is committed, updater is committed
        return false;
}

TransStateMgr::TransStateMgr(const std::string &folder, bool new_database, bool _disallow_cleaning, bool sync_enabled)
: disallow_cleaning(_disallow_cleaning)
, sync_enabled(sync_enabled)
{
        DEBUGONLY(log.SetupDebugging("TransStateMgr::LogData"));
        Log::WriteRef (log)->Init(folder, new_database, sync_enabled);
}

TransStateMgr::TransStatus TransStateMgr::GetStatus(TransId id, TransId *equivalent_id)
{
        if (equivalent_id)
            *equivalent_id = id;

        if (id == AlwaysCommitted)
            return GlobalCommitted;
        else if (id == NeverCommitted)
            return GlobalRolledBack;

        Log::ReadRef loglock(log);

        //Check if the transaction is in the running transaction list
        if (loglock->IsCommittable(id))
            return Busy;

        RangeId range = GetRangeFromTransId(id);

        //Do we have the info at all?
        if(id > loglock->GetLast(range))
        {
                /* ADDME: How to deal with this condition ? This is a quick hack to get around it,
                   but I suggest that this be an exception but allow the janitor to warn about
                   and destroy these records...

                   The original handler accepted this condition and just
                   interpreted it to be case of a missing PrepareForWrite
                   call - but it should be impossible for a transaction id
                   to be known to other transactions without having ever
                   been actually written to disk */
                Blex::ErrStream() << "The status for non-existing transaction #" << id << " was requested (its range is " << range << ", current range is " << loglock->GetCurrentRange() << ")\n";
                return GlobalRolledBack;
        }

        bool is_committed = Blex::GetBit(loglock->GetPageAddress(GetPage(id)), GetBitNumber(id));

        // Is change allowed?
        bool may_change = IsCleaningAllowed();

        if (!is_committed)
        {
                /* If not committed, the only transaction that can see this as committed is this transaction itself
                   So, if it isn't active anymore, proceed to setting as NeverCommitted */
                bool permanent_answer = may_change && !loglock->IsActive(id);
                if (permanent_answer && equivalent_id)
                    *equivalent_id = NeverCommitted;

//                DEBUGPRINT("GetStatus: Transaction " << id << " is rolled back, perm: " << (permanent_answer?"Y":"N"));

                return permanent_answer ? GlobalRolledBack : LocalRolledBack;
        }
        else
        {
                /* If committed, all transactions started after this (or with this on earlier_running_list) can see
                   this as rolled back. If id < lowest_reffered[range(id)], then this is older than every referred
                   transaction: noone can see it as rolled back anymore */
                bool permanent_answer = may_change && id < loglock->GetLowestReferred(range);
                if (permanent_answer && equivalent_id)
                    *equivalent_id = AlwaysCommitted;

//                DEBUGPRINT("GetStatus: Transaction " << id << " is committed, perm: " << (permanent_answer?"Y":"N"));

                return permanent_answer ? GlobalCommitted : LocalCommitted;
        }
}

bool TransStateMgr::IsRecordPermanentlyInvisible(TransId inserter, TransId expirer)
{
        if (!IsCleaningAllowed())
            return false;

        TransId new_inserter, new_expirer;

        // Get status (cheap for permanent answers)
        TransStateMgr::TransStatus i_status = GetStatus(inserter, &new_inserter);
        TransStateMgr::TransStatus e_status = GetStatus(expirer, &new_expirer);

        // Any of transactions is busy: not permanent.
        if (i_status == Busy || e_status == Busy)
            return false;

        // Check again, but now with the updated inserter and expirer
        if (new_inserter == TransStateMgr::NeverCommitted
                || (new_inserter == TransStateMgr::AlwaysCommitted && new_expirer == TransStateMgr::AlwaysCommitted))
            return true;
        if (new_expirer == TransStateMgr::NeverCommitted)
            return false;

        if (i_status == e_status) // If both states are the same, it might be nontrivially invisible
        {
                TransStateMgr::Log::WriteRef loglock(log);

                if (IsCleaningAllowed() && loglock->IsVisibilityNonTrivialPermanent(new_inserter, new_expirer))
                {
                        return true;
                }
        }
        return false;
}

TransStateMgr::LogData::LogData()
  : numpages(0)
  , transmap(NULL)
{
}

void TransStateMgr::LogData::Init(const std::string &folder, bool new_database, bool set_sync_enabled)
{
        logfile.reset(DatabaseInitializer().InitializeTranslog(Blex::MergePath(folder,"translog.whdb"), new_database, set_sync_enabled).release());
        sync_enabled = set_sync_enabled;

//        logfile.reset(Blex::MmapFile::OpenRW(Blex::MergePath(folder,"translog.whdb"),true,false,Blex::FilePermissions::PrivateRead,false,false));

        if (!logfile.get())
            throw Exception(ErrorIO,"Cannot open transaction log file");

        Blex::FileOffset filelen=logfile->GetFilelength();

        if ((filelen % BlockSize) != 0)
            throw Exception(ErrorInternal,"Transaction log file is in an unrecognized format");

        numpages=(uint32_t)(filelen/BlockSize);
        transmap=static_cast<uint8_t*>(logfile->MapRW(0,numpages*BlockSize));
        if (transmap==NULL)
            throw Exception(ErrorIO,"Cannot open transaction log file");

        //Read and validate the header
        if (numpages < NumHeaderBlocks || Blex::getu32lsb(transmap + HeaderVersionId) != Version)
        {
                logfile->Unmap(transmap,numpages*BlockSize);
                throw Exception(ErrorInternal,"Transaction log file is in an unrecognized format");
        }

        RangeId current_range = Blex::getu8(transmap + HeaderCurrentRange);
        if (current_range >= RangesCount)
            throw Exception(ErrorInternal,"Found illegal current range-id in transaction log");

        unsigned expected_page_count = 1;
        for (RangeId id = 0; id < RangesCount; ++id)
        {
                TransId last_trans = GetLast(id);
                if (GetRangeFromTransId(last_trans) != id)
                    throw Exception(ErrorInternal,"Found illegal last-used transaction id");

                // Page nr of last trans + 1 as needed number of pages (position -> count conversion)
                expected_page_count = std::max(expected_page_count, GetPage(last_trans) + 1);
        }
/*
        if (numpages < NumHeaderBlocks
            || Blex::getu32lsb(transmap + HeaderVersionId) != CurrentVersion)
        {
                logfile->Unmap(transmap,numpages*BlockSize);
                throw Exception(ErrorInternal,"Transaction log file is in an unrecognized format");
        }

        bool use_high_range = Blex::getu8(transmap + HeaderCurrentRange) ? true : false;
        unsigned expected_pages=NumHeaderBlocks+std::max( GetPage(GetLast(true)), GetPage(GetLast(false)) );*/

        if (numpages < expected_page_count)
        {
                logfile->Unmap(transmap,numpages*BlockSize);
                throw Exception(ErrorIO,"Transaction log file has been truncated");
        }
        next_unused_id=GetLast(current_range) + 1;
        last_reserved_id=GetLast(current_range);

        std::fill(lowest_referred_id, lowest_referred_id + RangesCount, NeverCommitted);
}

TransStateMgr::LogData::~LogData() throw()
{
        if (transmap)
        {
                Unreserve();
                logfile->Unmap(transmap,numpages*BlockSize);
        }
}

void TransStateMgr::LogData::Unreserve()
{
        RangeId range = GetRangeFromTransId(next_unused_id);
        TransId new_reserved_range = next_unused_id-1;

        PutLast(range, new_reserved_range);

        if (sync_enabled && !logfile->Sync(GetPageAddress(0), BlockSize, /*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit un-reserve of transaction ids to the transaction log");

        last_reserved_id=new_reserved_range;
}

void TransStateMgr::LogData::Reserve()
{
        RangeId range = GetRangeFromTransId(next_unused_id);
        TransId new_reserved_range = next_unused_id + 4096; //reserve 4k of transactions!

        // Are we running outside the range with this reservation?
        if (GetRangeFromTransId(new_reserved_range) != range)
            throw Database::Exception(ErrorIO, "Transaction range exhausted");

        //Do we have enough space for these new ids?
        if (GetPage(new_reserved_range) >= numpages)
        {
                DEBUGPRINT("Extending transaction log to reserve transaction " << new_reserved_range);
                ExtendLogSize(GetPage(new_reserved_range));
        }

        //Store and commit the new reserved range
        PutLast(range, new_reserved_range);

        if (sync_enabled && !logfile->Sync(GetPageAddress(0),BlockSize,/*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit reserve of transaction ids to the transaction log");

        last_reserved_id=new_reserved_range;

        if (IsTransactionRangeAlmostExhausted())
            Blex::ErrStream() << "Transaction range almost exhausted - not allowing clients in anymore";
}

void TransStateMgr::LogData::SwitchToNextTransactionRange()
{
        //May not switch if the next range is used.
        RangeId current_range = GetRangeFromTransId(next_unused_id);
        RangeId next_range = (current_range + 1) % RangesCount;
        RangeId previous_range = (current_range + RangesCount - 1) % RangesCount;

        //May not switch when we're already using the next range!
        if (IsRangeUsed(next_range))
            throw Database::Exception(ErrorInternal,"Transaction log: Cannot switch range when next range is already in use");

        //May not switch when we're still using the previous range!
        if (IsRangeUsed(previous_range))
            throw Database::Exception(ErrorInternal,"Transaction log: Cannot switch range when the previous range is still in use");

        //Free unused transaction ids
        Unreserve();

        next_unused_id = GetLast(next_range) + 1; //get last from next range
        last_reserved_id=GetLast(next_range);

        //Switch 'next' range selection bit
        Blex::putu8(transmap + HeaderCurrentRange, (uint8_t)next_range);
        //And commit it!
        if (sync_enabled && !logfile->Sync(GetPageAddress(0),NumHeaderBlocks * BlockSize,/*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit transaction switch status to the transaction log");
}

void TransStateMgr::LogData::ClearRange(RangeId range)
{
        if (IsRangeUsed(range))
            throw Database::Exception(ErrorInternal,"Transaction log: Cannot clear a range that is already in use");

        /* Clear all associated pages */
        for (unsigned i=NumHeaderBlocks + range;
             i < numpages;
             i+=RangesCount)
        {
                std::fill( GetPageAddress(i),
                           GetPageAddress(i) + BlockSize,
                           0);
        }

        if (sync_enabled && !logfile->Sync(GetPageAddress(0),numpages * BlockSize,/*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit cleanup of transaction ids to the transaction log");

        /* Now reset the first id */
        PutLast(range, GetFirstTransIdInRange(range));

        if (sync_enabled && !logfile->Sync(GetPageAddress(0),BlockSize,/*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit finalization of the cleanup of transaction ids to the transaction log");
}

bool TransStateMgr::LogData::IsRangeUsed(RangeId range) const
{
        //Now, see if a transaction is still being referenced inside the opposite range
        TransPointers::const_iterator const end_itr = referenced.end();
        for (TransPointers::const_iterator itr = referenced.begin();
             itr != end_itr;
             ++itr)
        {
                if (itr->refcount > 0 && GetRangeFromTransId(itr->id) == range)
                    return true;
        }
        return range == GetCurrentRange();
}

RangeId TransStateMgr::LogData::GetCurrentRange() const
{
        return GetRangeFromTransId(next_unused_id);
}

void TransStateMgr::LogData::Register(IdentifiedTrans *trans, bool clienttrans)
{
        if (IsTransactionRangeAlmostExhausted() && clienttrans)
            throw Database::Exception(ErrorInternal, "Transaction resources almost exhausted, normal logins disallowed");

        /* Give the new transaction a list of all running transactions, and look
           for a free spot in the transaction table for this transaction. */
        TransPointers::iterator free_position=referenced.end();

        unsigned free_count = 0;
        trans->earlier_running.reserve(referenced.size()); // Make sure we don't need reallocations

        // Allocate a new place in referenced. Also make sure that no more than 10 free entries remain.
        for (TransPointers::iterator itr = referenced.begin(); itr != referenced.end(); )
        {
                // Is this an unused position?
                if (itr->refcount == 0)
                {
                        // Yes it is. If we have less than 10 free entries, we may add keep the free entrie
                        if (free_count < 10)
                        {
                                // Check if we have reserved our first free position (inv: free_count == 0 && free_count < 10)
                                if (free_position == referenced.end())
                                    free_position = itr;
                                else
                                    ++free_count;
                        }
                        else
                        {
                                // More than 10 free positions, kill this one, go to start, don't pass ++itr;
                                referenced.erase(itr++);
                                continue;
                        }
                }
                else if (itr->committable) // Is this transaction commitable?
                {
                        // Yes: it must be placed on our earlier_running list because it must be hidden from us
                        trans->earlier_running.push_back(itr->id);
                        ++itr->refcount;
                }
                ++itr;
        }
//        DEBUGPRINT("Referenced size() " << referenced.size() << ", now free: " << free_count << " running: " << trans->earlier_running.size());

        // Sort the earlier_running list, for quick access
        std::sort(trans->earlier_running.begin(), trans->earlier_running.end());

        //Make sure we have room for an id
        if (next_unused_id > last_reserved_id)
            Reserve();

        //Give the transaction its own ID
        TransId transid = next_unused_id++;
        trans->this_trans_id = transid;

        //Insert transaction in the list (automatic refcount of 1, and status running)
        if (free_position == referenced.end())
        {
                referenced.push_back( TransData(transid) );
        }
        else
        {
                *free_position = TransData(transid);
        }

        // Register the transaction in the range
        RangeId range = GetRangeFromTransId(transid);
        if (transid < lowest_referred_id[range])
            lowest_referred_id[range] = transid;
}

void TransStateMgr::LogData::Unregister(IdentifiedTrans *trans)
{
        /* Unregister a transaction
            It must remain referenced while it still is on some other active transaction
            its earlier_running list.
        */

        //Get the end of the referenced list
        TransPointers::iterator const end_refitr = referenced.end();

        // Find transdata of this transaction
        TransData *my_data = 0;
        for (TransPointers::iterator ritr = referenced.begin(); ritr != end_refitr; ++ritr)
        {
                if (ritr->id == trans->this_trans_id && ritr->refcount>0)
                    my_data = &*ritr;
        }
        assert(my_data); // Must be available

        // Go through already_running, and populate the relevant already_finished lists. Approx. O(n log n)
        for (TransPointers::iterator ritr = referenced.begin(), end = referenced.end(); ritr != end; ++ritr)
        {
                // Check if this transaction is in our earlier_running list
                if (ritr->refcount>0 && std::binary_search(trans->earlier_running.begin(), trans->earlier_running.end(), ritr->id))
                {
                        // Decrease the refcount of the other transaction. If zero, delete its data
                        if (--ritr->refcount == 0)
                            DeleteTransData(&*ritr);
                }
        }

        // Stop running, decrease refcounter. If zero, the data can safely be deleted
        my_data->committable = false;
        my_data->active = false;
        if (--my_data->refcount == 0)
            DeleteTransData(my_data);

        // Recalculate the lowest_referred_ids
        RangeId current_range = GetCurrentRange();
        std::fill(lowest_referred_id, lowest_referred_id + RangesCount, NeverCommitted); // NeverCommitted is max of uint32_t
        for (TransPointers::iterator ritr = referenced.begin();
             ritr != end_refitr;
             ++ritr)
        {
                if (ritr->refcount==0)
                    continue; //don't bother with this transaction

                RangeId range = GetRangeFromTransId(ritr->id);
                if (lowest_referred_id[range] > ritr->id)
                    lowest_referred_id[range] = ritr->id;

                // If another range is still referenced, everything in the current range is referenced.
                if (range != current_range)
                    lowest_referred_id[current_range] = AlwaysCommitted;
        }

        /* ADDME: transaction reuse might be handy: however it severely clashes
           with our time based approach to transaction IDs (in the same range,
           a lower id means an earlier starting time. So in that case,
           we can only reuse transaction IDs higher than the ID of any currently
           running transaction. It probably isn't worth it.

           And why don't we zap (destroyrecord) all our updates if we chickened
           out of committing anyway ?*/
}

void TransStateMgr::LogData::DeleteTransData(TransData *trans)
{
        // List of transactions that have already been freed (have refcount of zero, but unprocessed already_finished lists)
        std::deque< TransData * > worklist(1, trans);
        while (!worklist.empty())
        {
                TransData *current = worklist.front();
                worklist.pop_front();

                // Lower refcount of all transactions on already_finished list. If zero, process that transaction too.
                for (std::vector< TransData * >::const_iterator it = current->already_finished.begin(),
                        end = current->already_finished.end(); it != end; ++it)
                {
                        if (--(*it)->refcount == 0)
                            worklist.push_back(*it);
                }
        }
}


void TransStateMgr::LogData::SetFinished(TransId transid, bool commit)
{
        assert (transid!=AlwaysCommitted && transid!=NeverCommitted);

        TransData *my_data = 0;

        //Set running to false
        TransPointers::iterator const end_refitr = referenced.end();
        for (TransPointers::iterator ritr = referenced.begin();
             ritr != end_refitr;
             ++ritr)
        {
                if (ritr->id == transid && ritr->refcount>0)
                    my_data = &*ritr;
        }
        if (!my_data)
            throw Exception(ErrorInternal,"Finishing transaction that is not in the referenced list");
        if (!my_data->committable && commit)
            throw Exception(ErrorInternal,"Committing an already finished transaction");

        if (commit)
        {
                //Set the proper COMMIT bit
                unsigned whichpage = GetPage(transid);
                Blex::SetBit(GetPageAddress(whichpage),GetBitNumber(transid), true);

                //Sync the commit to disk
                if(sync_enabled)
                    logfile->Sync(GetPageAddress(whichpage),BlockSize,/*ignore_unmapped=*/false);
        }
        my_data->committable=false;
}

bool TransStateMgr::LogData::IsCommittable(TransId trans) const
{
        TransPointers::const_iterator const end_itr = referenced.end();
        for (TransPointers::const_iterator itr = referenced.begin();
             itr != end_itr;
             ++itr)
        {
                if (itr->id==trans && itr->refcount>0)
                    return itr->committable;
        }
        return false;
}

bool TransStateMgr::LogData::IsActive(TransId trans) const
{
        TransPointers::const_iterator const end_itr = referenced.end();
        for (TransPointers::const_iterator itr = referenced.begin();
             itr != end_itr;
             ++itr)
        {
                if (itr->id==trans && itr->refcount>0)
                    return itr->active;
        }
        return false;
}


bool TransStateMgr::LogData::IsTransactionReferred(TransId trans) const
{
        TransPointers::const_iterator const end_itr = referenced.end();
        for (TransPointers::const_iterator itr = referenced.begin();
             itr != end_itr;
             ++itr)
        {
                if (itr->id == trans && itr->refcount>0)
                    return true;
        }
        return false;
}

void TransStateMgr::LogData::ExtendLogSize(unsigned requested_page)
{
        //Unmap current file
        logfile->Unmap(transmap,numpages * BlockSize);
        transmap=NULL;

        //Attempt to extend the file
        unsigned new_num_pages = requested_page + 1;
        if (!logfile->ExtendTo(new_num_pages * BlockSize)
            || (transmap=static_cast<uint8_t*>(logfile->MapRW(0,new_num_pages * BlockSize))) == NULL)
        {
                //Oops! Attempt to recover!
                DEBUGPRINT("\aUnable to extend transaction log file");
                transmap=static_cast<uint8_t*>(logfile->MapRW(0,numpages * BlockSize));
                if (transmap==NULL) //map failed?!
                {
                        Blex::ErrStream() << "Database panic! Unable to extend transaction log file, and unable to reopen original log file. Must abort to prevent corruption.";
                        std::abort();
                }

                //We _did_ recover, so the system should be able to continue
                throw Exception(ErrorIO,"Unable to extend transaction log file");
        }

        //Clear the new pages and update our impression of the filesize
        std::fill( transmap + numpages * BlockSize,
                   transmap + new_num_pages * BlockSize,
                   0 );

        if (sync_enabled && !logfile->Sync(transmap+numpages * BlockSize,(new_num_pages-numpages) * BlockSize, /*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit clearing of transaction ids to the transaction log");

        numpages = new_num_pages;

        //Synchronize the new, longer transaction list
        if(sync_enabled)
            logfile->SyncAll();
}

void TransStateMgr::LogData::UpdateFileTimeStamp()
{
        logfile->SetModificationDate(Blex::DateTime::Now());
}

bool TransStateMgr::LogData::IsVisibilityNonTrivialPermanent(TransId lhs_trans, TransId rhs_trans) const
{
        /* Visibility is permanent if inserter and expirer have the following properties
          1. They are both not permanent
          if inserter == expirer
            2. They may not be active (an active transaction may change the expirer)
          else
            2. They both have the same commit status
            if both rollbacked:
               3. Both may not be active (rollbacked trans can only be seen as committed by itself)
            if both committed
              3. They both lie in the same transaction range (so we can compare ids) ADDME: use something like IsTransactionOlder, but see how that interacts with v2 translog update
              4. They are not in not in earlier running lists (not referenced). Won't implement: always together in earlier running list.
              5. There is no active transaction that lies between them (which could see one as started earlier and one as started later)
                 and no transaction that has only the updater on the earlier_running_list (and therefore, references at least the updater)
                 (solved together as checking for referenced transactions in the range [inserter, updater], inclusive).
        */

        // Sort
        if (lhs_trans > rhs_trans)
           std::swap(lhs_trans, rhs_trans);

        // Inv: lhs_trans <= rhs_trans

        // 1: not permanent (this check can be done this way due to sortedness, lhs_trans <= rhs_trans)
        if (lhs_trans == AlwaysCommitted/*0*/ || rhs_trans == NeverCommitted/*0xFFFFFFFFUL*/)
            return false;

        if (lhs_trans == rhs_trans)
        {
                //2. May not be active
                if (IsActive(lhs_trans))
                    return false;

                return true;
        }

        RangeId lhs_range = GetRangeFromTransId(lhs_trans);
        RangeId rhs_range = GetRangeFromTransId(rhs_trans);
        if(lhs_trans > GetLast(lhs_range) || rhs_trans > GetLast(rhs_range))
                return false;

        // 2: the same commit status
        bool is_lhs_committed = Blex::GetBit(GetPageAddress(GetPage(lhs_trans)), GetBitNumber(lhs_trans));
        bool is_rhs_committed = Blex::GetBit(GetPageAddress(GetPage(rhs_trans)), GetBitNumber(rhs_trans));
        if (is_lhs_committed != is_rhs_committed)
            return false;

        TransPointers::const_iterator const end_itr = referenced.end();

        if (!is_lhs_committed)
        {
                // If lhs_trans or rhs_trans is active, it can see another status. Else, they are rollbacked for everyone
                for (TransPointers::const_iterator itr = referenced.begin(); itr != end_itr; ++itr)
                {
                        if (itr->refcount > 0 && (itr->id == lhs_trans || itr->id == rhs_trans) && itr->active)
                            return false;
                }
                return true;
        }
        else
        {
                // 3: the same range
                if (GetRangeFromTransId(lhs_trans) != GetRangeFromTransId(rhs_trans))
                    return false;

                // 4+5: no referenced transactions in the range [ lhs_trans, rhs_trans ]
                TransPointers::const_iterator const end_itr = referenced.end();
                for (TransPointers::const_iterator itr = referenced.begin(); itr != end_itr; ++itr)
                {
                        if (itr->refcount > 0 && itr->id >= lhs_trans && itr->id <= rhs_trans)
                            return false;
                }
                return true;
        }
}

bool TransStateMgr::LogData::IsTransactionRangeAlmostExhausted() const
{
        // Range is almost exhaused when we have less than 1.048.576 transactions ids left
        return GetRangeFromTransId(last_reserved_id) != GetRangeFromTransId(last_reserved_id + 1048576);
}


/* ADDME: Functions with the same names as their locked counterpart risk accidental recursive locks causing deadlock. Must fix! */

/// Switch the transaction range we're using
void TransStateMgr::SwitchToNextTransactionRange()
{
        Log::WriteRef(log)->SwitchToNextTransactionRange();
}

/// Test whether both transaction ranges are active (cleaning up impossible)
bool TransStateMgr::IsRangeUsed(RangeId range) const
{
        return Log::ReadRef(log)->IsRangeUsed(range);
}

/// Returns range in which new transactions will be allotted a transaction id
RangeId TransStateMgr::GetCurrentRange() const
{
        return Log::ReadRef(log)->GetCurrentRange();
}

/// Test whether both transaction ranges are active (cleaning up impossible)
void TransStateMgr::ClearRange(RangeId range)
{
        return Log::WriteRef(log)->ClearRange(range);
}

void TransStateMgr::UpdateFileTimeStamp()
{
        return Log::WriteRef(log)->UpdateFileTimeStamp();
}

bool TransStateMgr::IsTransactionRangeAlmostExhausted() const
{
        return Log::ReadRef(log)->IsTransactionRangeAlmostExhausted();
}


void DatabaseInitializer::InitializeEmptyTranslog(std::unique_ptr< Blex::MmapFile > &logfile)
{
        Blex::IndependentBitmap transmap = 0;

        unsigned numpages=TransStateMgr::NumHeaderBlocks + TransStateMgr::RangesCount; //page for the header + first page for all ranges

        unsigned filesize = numpages * TransStateMgr::BlockSize;

        //Create a new transaction log
        if (!logfile->ExtendTo(filesize)
            || (transmap=static_cast< uint8_t * >(logfile->MapRW(0, filesize))) == NULL)
            throw Exception(ErrorIO,"Cannot create transaction log file");

        // Fill everything with 0, and flush.
        std::fill(transmap, transmap + filesize, 0);

        // Put 0 in version; failed initialisation will not break anything
        Blex::putu32lsb(transmap + TransStateMgr::HeaderVersionId, 0);

        // Set initial transaction id's
        for (RangeId id = 0; id < TransStateMgr::RangesCount; ++id)
            Blex::putu32lsb(transmap + TransStateMgr::HeaderLastTransactionIds + TransStateMgr::RangesCount * id, 0x40000000 * id);
        Blex::putu8(transmap + TransStateMgr::HeaderCurrentRange, 0);

        // Commit all initialized data to stable storage, but don't validate yet, so on a crash ordering problems won't bite us
        if (!logfile->Sync(transmap, filesize, /*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit initialization of transaction log to stable storage");

        // Set the version to the current version, and commit the header block
        Blex::putu32lsb(transmap + TransStateMgr::HeaderVersionId, TransStateMgr::Version);
        if (!logfile->Sync(transmap, TransStateMgr::BlockSize, /*ignore_unmapped=*/false))
            throw Database::Exception(ErrorIO,"Unable to commit initialization of transaction log to stable storage");

        logfile->Unmap(transmap, filesize);
}

std::unique_ptr< Blex::MmapFile > DatabaseInitializer::InitializeTranslog(std::string const &logfilename, bool new_database, bool sync_enabled)
{
        std::unique_ptr< Blex::MmapFile > logfile;

        // New database? We muse create a new translog file, that may not exist yet
        if (new_database)
        {
                logfile.reset(Blex::MmapFile::OpenRW(logfilename,true,true,Blex::FilePermissions::PrivateRead,false,false,sync_enabled));
        }
        else
        {
                // Try to open pre-existing transaction log.
                logfile.reset(Blex::MmapFile::OpenRW(logfilename,false,false,Blex::FilePermissions::PrivateRead,false,false,sync_enabled));
        }

        if (!logfile.get())
            throw Exception(ErrorIO,"Cannot open transaction log file");

        // Get and check length of translog
        Blex::FileOffset filelen=logfile->GetFilelength();
        if ((filelen % TransStateMgr::BlockSize) != 0)
            throw Exception(ErrorInternal,"Transaction log file is in an unrecognized format");

        // Read version if file length is valid, otherwise we were just initializing
        unsigned version = 0;
        if (filelen >= TransStateMgr::NumHeaderBlocks*TransStateMgr::BlockSize)
        {
                // Map header pages and read version
                Blex::IndependentBitmap transmap=static_cast< uint8_t* >(logfile->MapRW(0, TransStateMgr::NumHeaderBlocks*TransStateMgr::BlockSize));
                version = Blex::getu32lsb(transmap + TransStateMgr::HeaderVersionId);
                logfile->Unmap(transmap, TransStateMgr::NumHeaderBlocks*TransStateMgr::BlockSize);
        }

        switch (version)
        {
        case 0: // Empty log
            InitializeEmptyTranslog(logfile);
            break;

        case TransStateMgr::Version: // Current version
            break;

        default:
            throw Exception(ErrorInternal,"Transaction log file is in an unrecognized format");
        }

        logfile->UnmapAll();
        return logfile;
}

} //end of namespace Database

namespace Blex
{
template <> void AppendAnyToString(Database::TransStateMgr::TransStatus const &in, std::string *appended_string)
{
        switch(in)
        {
        case Database::TransStateMgr::Busy: *appended_string="NowBusy"; break;
        case Database::TransStateMgr::LocalCommitted: *appended_string="LocalCommitted"; break;
        case Database::TransStateMgr::LocalRolledBack: *appended_string="LocalRolledBack"; break;
        case Database::TransStateMgr::GlobalCommitted: *appended_string="GlobalCommitted"; break;
        case Database::TransStateMgr::GlobalRolledBack: *appended_string="GlobalRolledBack"; break;
        }
}

} //end namespace Blex
