#include <ap/libwebhare/allincludes.h>


#include "dbase_backend.h"
#include "dbase_transaction.h"
#include <iostream>
#include "dbase_rpcserver.h"
#include "dbase_janitor.h"
#include "dbase_init.h"

#include <blex/logfile.h>
#include "scanlocate.h"


//#define SHOWTRANSREFS

#ifdef SHOWTRANSREFS
 #define TRANSREFPRINT(x) DEBUGPRINT(x)
#else
 #define TRANSREFPRINT(x) (void)0
#endif

namespace Database
{

Backend::TransactionInfo::TransactionInfo()
: transid(0)
, refcount(0)
, isfinished(false)
, started(Blex::DateTime::Now())
, waitingfor(0)
{
}

//-----------------------------------------------------------------------------
//
// Backend
//
//-----------------------------------------------------------------------------
Backend::Backend(const std::string &basefolder,
                 const std::string &recordfolder,
                 const std::string &indexfolder,
                          const Plugins &plugins,
                          unsigned janitor_maxwait,
                          bool new_database,
                          bool _recovery_mode,
                          bool no_janitor,
                          bool save_deleted_blobs,
                          bool no_index,
                          bool sync_enabled)
  : plugins(plugins)
  , rawdb(basefolder, recordfolder, new_database, _recovery_mode || no_janitor, save_deleted_blobs, sync_enabled)
  , indexsystem(no_index ? NULL : new Index::System(indexfolder, new_database, sync_enabled))
  , no_janitor(no_janitor)
  , janitor_maxwait(janitor_maxwait)
  , recovery_mode(_recovery_mode)
  , sync_enabled(sync_enabled)
{
}

void Backend::Open()
{
        startuptime = Blex::DateTime::Now();

        rawdb.SetSectionCleanHintCallback(std::bind(&Backend::SectionsCleanHint, this, std::placeholders::_1, std::placeholders::_2));

        LockedChallengeBuffer::WriteRef (challengebuffer)->seqcount=0;

        // Initialize metadata manager (initialises metadata to describe only itself)
        metamgr.reset(new MetadataManager(plugins, rawdb, autoseq, indexsystem.get(), recovery_mode));

        if (indexsystem.get())
        {
                // Start filler to quickly get data.
                indexsystem->StartFiller(rawdb);

                // Wait until metadata indices are complete, so metadata is read very quickly.
                indexsystem->WaitForFillComplete();
        }

        // First initialize database (also reads metadata from disk)
        DatabaseInitializer().InitializeDatabase(*this, recovery_mode);

        // Test for errors in metadata
        if (metamgr->AnyErrors(0))
            Blex::ErrStream() << "Errors occurred during inital reading of metadata: all access to database disallowed except for maintainance logins";
        if(recovery_mode)
            Blex::ErrStream() << "Running in recovery mode - use SQLCLIENT now to connect, CTRL+C to stop the database";
        if(no_janitor)
            Blex::ErrStream() << "Running without the janitor - the database will now only grow in size";

        if(indexsystem.get())
            indexsystem->SetMetadataLiveStatus(true);

        if (!recovery_mode && !no_janitor)
        {
                janitor.reset(new Willie(rawdb, *this, janitor_maxwait));
        }
}

void Backend::GetWillieState(WillieState *williestate)
{
        janitor->GetWillieState(williestate);
}

void Backend::SetWillieMaxWait(unsigned maxwait)
{
        janitor->SetWillieMaxWait(maxwait);
}

void Backend::SetParamRPCInfo(bool newval)
{
        LockedConfig::WriteRef(config)->rpcinfo = newval;
        if (!newval)
            LockedStatsData::WriteRef(statsdata)->queries.clear();
}

void Backend::Close()
{
        // If we still have an index system, stop it from modifying data
        if (indexsystem.get())
            indexsystem->SetMetadataLiveStatus(false);

        DEBUGPRINT("Silenced the index");

        // Kill all other systems
        janitor.reset(NULL);
        DEBUGPRINT("Disconnected from janitor");
        metamgr.reset(); //must ensure that all references are given up before killing the indexsystem
        DEBUGPRINT("Disconnected from metadata manager");

        // Now close the index system (the janitor must be destroyed first!)
        if (indexsystem.get())
            indexsystem->Close();
        indexsystem.reset(NULL);
        DEBUGPRINT("Disconnected from index");

        // Update all the file stamps
        UpdateFileTimeStamps();
        DEBUGPRINT("Flushed timestamp updates");

        // The raw database must be destroyed last
        rawdb.Close();
        DEBUGPRINT("Disconnected from database storage");
}

Backend::~Backend()
{
}

AutoSeqManager::AutoSeqManager()
{
        DEBUGONLY(list.SetupDebugging("AutoSeqManager::AutoSeqManager"));
}
AutoSeqManager::~AutoSeqManager()
{
}

AutoseqTop *AutoSeqManager::GetAutoseq(TableId tableid, ColumnId columnid, int32_t initialvalue)
{
        LockedList::WriteRef lock(list);
        for (unsigned i=0;i<lock->autoseqs.size();++i)
        {
                if (lock->autoseqs[i].tableid==tableid
                    && lock->autoseqs[i].columnid==columnid)
                {
                        AutoseqTop *autoseq = lock->autoseqs[i].auto_sequencer.get();

                        //Check that the autonumber start point is valid (it might have increased)
                        AutoseqTop::WriteRef lock(*autoseq);
                        if (*lock < initialvalue-1)
                            *lock = initialvalue-1;
                        return autoseq;
                }
        }

        AutoSeq newautoseq;
        newautoseq.tableid=tableid;
        newautoseq.columnid=columnid;
        newautoseq.auto_sequencer.reset(new AutoseqTop);
        DEBUGONLY(newautoseq.auto_sequencer->SetupDebugging("DBAutoSequencer::top"));
        *AutoseqTop::WriteRef(*newautoseq.auto_sequencer)=initialvalue-1;
        lock->autoseqs.push_back(newautoseq);

        return newautoseq.auto_sequencer.get();
}

void Backend::ExportTransactionInfo(std::vector<TransactionInfo> *receiver)
{
        Blex::Mutex::AutoWriteLock lock(transrefmutex);
        receiver->reserve(translist.size());
        for (TransMap::iterator itr=translist.begin(); itr!=translist.end();++itr)
        {
                receiver->push_back(TransactionInfo());
                receiver->back() = itr->second;
                receiver->back().waitingfor = lockmanager.IsTransactionWaiting(itr->second.transid);
        }
}

void Backend::ExportQueryInfo(std::vector< QueryInfo > *receiver)
{
        LockedStatsData::ReadRef lock(statsdata);
        for (std::map< uint64_t, QueryInfo >::const_iterator it = lock->queries.begin(); it != lock->queries.end(); ++it)
            receiver->push_back(it->second);
}

void Backend::SetTransactionInfoClientName(BackendTransaction *trans, std::string const &new_name)
{
        Blex::Mutex::AutoWriteLock lock(transrefmutex);
        TransMap::iterator itr = translist.find(trans);
        if (itr == translist.end())
            throw Exception(ErrorInternal,"Unable to find transaction in transaction list");
        itr->second.client = new_name;
}

void Backend::SetTransactionInfoTransStage(BackendTransaction *trans, const char *transstage)
{
        Blex::Mutex::AutoWriteLock lock(transrefmutex);
        TransMap::iterator itr = translist.find(trans);
        if (itr == translist.end())
            throw Exception(ErrorInternal,"Unable to find transaction in transaction list");
        itr->second.transstage = transstage;
}

void Backend::SetTransactionInfoCurrentRPC(BackendTransaction *trans, std::string const &currentrpc)
{
        Blex::Mutex::AutoWriteLock lock(transrefmutex);
        TransMap::iterator itr = translist.find(trans);
        if (itr != translist.end())
            itr->second.currentrpc = currentrpc;
}

void Backend::SetTransactionInfoRPCInfo(BackendTransaction *trans, std::string const &rpcinfo)
{
        Blex::Mutex::AutoWriteLock lock(transrefmutex);
        TransMap::iterator itr = translist.find(trans);
        if (itr != translist.end())
            itr->second.rpcinfo = rpcinfo;
}

uint64_t Backend::SetTransactionInfoRPCQuery(BackendTransaction *trans, QueryInfo &queryinfo)
{
        std::string info = queryinfo.plan;
        if (!queryinfo.origin.empty())
            info += "\nOrigin: " + queryinfo.origin;

        SetTransactionInfoRPCInfo(trans, info);

        Blex::DateTime cutoff = Blex::DateTime::Now() - Blex::DateTime::Minutes(1);
        LockedStatsData::WriteRef lock(statsdata);

        // Remove too old queries
        while (!lock->queries.empty() && lock->queries.begin()->second.starttime < cutoff)
            lock->queries.erase(lock->queries.begin());

        // Max 10000 queries in log
        if (lock->queries.size() >= 10000)
            lock->queries.erase(lock->queries.begin());

        queryinfo.id = ++lock->queryidcounter;
        lock->queries.insert(std::make_pair(queryinfo.id, queryinfo));

        return queryinfo.id;
}

void Backend::ModifyTransactionInfoQueryData(uint64_t statsqueryid, uint32_t sentrows, uint32_t time)
{
        LockedStatsData::WriteRef lock(statsdata);

        std::map< uint64_t, QueryInfo >::iterator it = lock->queries.find(statsqueryid);
        if (it == lock->queries.end())
            return;

        it->second.sentrows += sentrows;
        it->second.time += time;
}

BackendTransactionRef Backend::BeginTransaction(const std::string &login,const std::string &, const std::string &source, const std::string &client)
{
        //ADDME: Assertion: assert(!maindata.IsOwned()); //we may not 'NewStruct' when holding this lock

        //ADDME: Shorten the lock time to only make 'Create trans id' and 'Associate metadata' atomic (hmm, does this still apply?)
        Blex::Mutex::ScopedLock openlock(openmutex, true);
        std::unique_ptr< BackendTransaction > trans(new BackendTransaction(*this, login != "~recovery" && login != "~internal"));
        openlock.Unlock();

        if (login=="~backup") //backup should always be available
        {
                trans->AddBaseRole(MetaRole_BACKUP);
                trans->is_backup_transaction = true;
        }
        else if (!IsInRecoveryMode())
        {
                if (GetMetadataManager().AnyErrors(0))
                {
                        Blex::ErrStream() << "Login failure: Metadata is corrupt, only maintainance logins are allowed";
                        throw Database::Exception(Database::ErrorReadAccessDenied,"Only maintainance logins allowd");
                }

                if(login=="~webhare" || login == "~recovery" || login == "~internal")
                {
                        trans->AddBaseRole(MetaRole_SYSTEM);
                }
                else if (login=="~cluster")
                {
                        trans->AddBaseRole(MetaRole_SYSTEM);
                        trans->clustering_updates = true;
                }
                else if(login.empty())
                {

                }
                else
                {
                        throw Exception(ErrorReadAccessDenied,"Unrecognized loginname");
                }
        }
        else
        {
                if (login != "~recovery" && login != "~internal")
                {
                        throw Exception(ErrorReadAccessDenied,"Only ~recovery logins allowed in database recovery mode");
                }
                trans->AddBaseRole(MetaRole_SYSTEM);
        }

        try
        {
                Blex::Mutex::AutoWriteLock lock(transrefmutex);
                TransactionInfo &info = translist[trans.get()];
                info.username=login;
                info.client=client;
                info.source=source;
                info.transstage="R";
                info.transid = trans->GetTransId();
                info.isfinished = false;
                info.refcount = 0;
        }
        catch(...)
        {
                throw;
        }
        return BackendTransactionRef(trans.release());
}

void Backend::PrepareTransactionForCommit(BackendTransaction *trans)
{
        ConsistencyManager::CheckData &checkdata = trans->GetCommitCheckdata();

        trans->GetConsistencyManager().ExecutePreLockChecks(*trans, checkdata);

        //Flush any updated sections
        trans->SetStage("C:PRE-SYNC");
        if (sync_enabled && !trans->Sync())
            throw Exception(ErrorIO,"Unable to flush changes to the database files");
}

void Backend::FinishTransaction(BackendTransaction *trans,bool commit)
{
        //Commit the transaction if no error occured. Commit will also
        //send update notifications to the indexing system, as the records must
        //be in the index before they are made visible.
        if (commit)
        {
                //Do any checks we can do without locking (if they haven't been done yet)
                ConsistencyManager::CheckData &checkdata = trans->GetCommitCheckdata();
                if (!checkdata.is_valid)
                    PrepareTransactionForCommit(trans);

                bool is_metadata_modified = trans->IsMetadataModified();

                //Do any checking which requires only one transaction running at a time (although dbase_rpcserver also serializes, it cannot (yet?) serialize the Janitor commits, so the lock is still needed)
                Blex::Mutex::AutoLock commitlock(commitmutex);
                trans->GetConsistencyManager().ExecuteCommitLockChecks(*trans, checkdata);

                //Start an 'open' lock if metadata updated, to prevent transactions seeing an inconsistency between the meta_* tables and the real metadata
                Blex::Mutex::ScopedLock openlock(openmutex, is_metadata_modified);

                if (is_metadata_modified)
                {
                        trans->SetStage("C:COMM-METADATAREAD");
                        metamgr->ReadMetadata(trans);
                }
                trans->SetStage("C:COMM-MARKING");
                trans->identified_trans.MarkTransactionCommitted();
                trans->is_committed = true;
        }

        //Mark the transactions as 'finished' in the information table
        {
                Blex::Mutex::AutoWriteLock lock(transrefmutex);
                TransMap::iterator itr = translist.find(trans);
                if (itr == translist.end())
                    throw Exception(ErrorInternal,"Unable to find transaction in transaction list");
                itr->second.isfinished=true;
                itr->second.transstage="F";
        }
        lockmanager.UnregisterTransaction(trans);
}

void Backend::JanitorDestroyRecord(DatabaseLocker &db_locker, ObjectId origtableid, RecordId block, Blex::SectionUpdateHistory &history/*, bool inform_index_too*/)
{
        DeprecatedAutoRecord rec(db_locker, origtableid, block);
        if (/*inform_index_too && */indexsystem.get())
            indexsystem->TableUpdate(origtableid,block,*rec,false);
        rawdb.DestroyRecord(origtableid, block,history);
}

std::pair<bool,RecordId> Backend::TryExpireRecord(IdentifiedTrans &trans, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits, bool must_signal, bool register_waits)
{
        TransId waiting_for;
        std::pair<bool,RecordId> res = rawdb.TryExpireRecord(trans.GetTransId(), tableid, recblock, commits, waiting_for);
        bool now_waiting = res.first == false;

        if (register_waits)
        {
                // Indicate wait
                if (now_waiting)
                    lockmanager.IndicateWait(trans.GetTransId(), waiting_for, must_signal, tableid, recblock);
                else
                    lockmanager.IndicateWaitEnd(trans.GetTransId());
        }

        return res;
}

void Backend::UnexpireRecord(IdentifiedTrans &trans, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits)
{
        rawdb.UnexpireRecord(trans.GetTransId(), tableid, recblock, commits);
}

RecordId Backend::FindAfterCommitVersion(IdentifiedTrans &trans, TableId tableid, RecordId recblock)
{
        return rawdb.FindAfterCommitVersion(trans.GetTransId(), tableid, recblock);
}

RecordId Backend::WriteNewRecord(IdentifiedTrans &trans, TableDef const &table, Record rec, RecordId locationhint, bool force_new_section_on_hint_fail, Blex::SectionUpdateHistory &commits)
{
        RecordId recno = rawdb.WriteNewRecord(table.object_id, rec, locationhint, force_new_section_on_hint_fail, trans.GetTransId(), commits);
        if(indexsystem.get())
            indexsystem->TableUpdate(table.object_id,recno,rec,true);
        return recno;
}

void Backend::RegisterUpdate(TableId tableid, RecordId origblock, RecordId newblock, Blex::SectionUpdateHistory &commits)
{
        rawdb.RegisterUpdate(tableid, origblock, newblock, commits);
}

void Backend::SectionsCleanHint(unsigned const *sections, unsigned count)
{
        if (janitor.get())
            janitor->HintSectionsCleaning(sections, count);
}

void Backend::IncTransRef(BackendTransaction *trans)
{
        Blex::Mutex::AutoWriteLock lock(transrefmutex);
        TransMap::iterator itr = translist.find(trans);
        if (itr == translist.end())
            throw Exception(ErrorInternal,"Unable to find transaction in transaction list");
        ++itr->second.refcount;
        TRANSREFPRINT("Transref " << trans << " ++ to " << itr->second.refcount);
}

void Backend::DecTransRef(BackendTransaction *trans)
{
        unsigned newcount;
        {
                Blex::Mutex::AutoWriteLock lock(transrefmutex);
                TransMap::iterator itr = translist.find(trans);
                if (itr == translist.end())
                    throw Exception(ErrorInternal,"Unable to find transaction in transaction list");
                newcount = --itr->second.refcount;
                TRANSREFPRINT("Transref " << trans << " -- to " << itr->second.refcount);
                if (newcount==0)
                    translist.erase(itr);
        }

        // Transaction deletion out of mutex lock
        if (newcount==0)
            delete trans;
}

void Backend::UpdateFileTimeStamps()
{
        rawdb.UpdateFileTimeStamps();
}

void Backend::GenerationalCleanupUnusedSections(volatile uint32_t *abortflag)
{
        rawdb.GenerationalCleanupUnusedSections(abortflag);
        if (indexsystem)
            indexsystem->GenerationalCleanupUnusedSections(abortflag);
}


BackendTransactionRef::BackendTransactionRef(BackendTransaction *_trans)
: trans(_trans)
{
        if (trans)
            trans->backend.IncTransRef(trans);
}

BackendTransactionRef::BackendTransactionRef(BackendTransactionRef const &rhs)
: trans(rhs.trans)
{
        if (trans)
            trans->backend.IncTransRef(trans);
}

BackendTransactionRef::~BackendTransactionRef()
{
        if (trans)
            trans->backend.DecTransRef(trans);
}

void BackendTransactionRef::swap(BackendTransactionRef &rhs)
{
        std::swap(trans, rhs.trans);
}

void BackendTransactionRef::reset(BackendTransaction *_trans)
{
        if (trans != _trans)
        {
                BackendTransactionRef ref(_trans);
                swap(ref);
        }
}

BackendTransactionRef & BackendTransactionRef::operator=(BackendTransactionRef const &rhs)
{
        if (rhs.trans != trans)
        {
                BackendTransactionRef ref(rhs.trans);
                swap(ref);
        }
        return *this;
}

ConnectionControl::~ConnectionControl()
{
}

} //end namespace Database
