#include <ap/libwebhare/allincludes.h>


//#define IODEBUG

#include <blex/logfile.h>

#include "dbase_diskio.h"
#include "dbase_init.h"

#include <blex/path.h>
#include <blex/bitmanip.h>
#include <iostream>

#ifdef IODEBUG
#define IODEBUGPRINT(x) DEBUGPRINT(x)
#define IODEBUGONLYARG(x) DEBUGONLYARG(x)
#else
#define IODEBUGPRINT(x) (void)0
#define IODEBUGONLYARG(x)
#endif

/* ADDME: At what locations do we have to ensure that data is properly committed ?
   ADDME: Get rid of AutoSection wherever possible, get a higher level DatabaseLocker?

*/
namespace Database
{

namespace
{
        /** Allow shared sections ? (set to FALSE todebug) */
        static bool AllowSharedSections = true;
        /** Number of bytes per block (specification: 128) */
        static const unsigned BlockSize = 128;
        /** Number of blocks per section (specification: 512) */
        static const unsigned SectionSize = 512;
        /** Number of bytes per section (specification: 128*512, 64kb) */
        static const unsigned SectionBytes = BlockSize*SectionSize;
        /** Number of bytes per record in the record lookup table */
        static const unsigned RecordLookupSize = 16;
        /** Number of bytes occupied by both header and record lookup table
            Also the offset of the first record inside a section (spec: 8k) */
        static const unsigned SectionProlog = SectionSize * RecordLookupSize;
        /** Actual maximum number of records inside a section (spec: 448) */
        static const unsigned RecordsPerSection = (SectionBytes-SectionProlog)/BlockSize;
        /** First available blocknumber in a section */
        static const unsigned FirstBlockNumber = SectionSize-RecordsPerSection;
        /** Number of bytes that are available for the header bytes (spec: 1024) */
/*ADDME: Unused?
        static const unsigned SectionHeaderSize = FirstBlockNumber*RecordLookupSize;
*/
        /** Maximum number of sections per reocrd file. Limit files to 512MB */
        static const unsigned MaxSectionsPerFile = (512*1024*1024) / SectionBytes;

        /** Number of cached sections (the full 512MB on 64bit machines */
        static unsigned SectionCached = 2048;//MaxSectionsPerFile;

        ///Inline fuction that calculates the total number of blocks needed for a given record size
        inline unsigned NumBlocks(unsigned length)
        {
                return (length+(BlockSize-1))/BlockSize;
        }

        ///Calculate the section of a record block
        inline unsigned RecordSection(RecordId recnum)
        {
                return recnum/SectionSize;
        }
        ///Calculate the record number of a section/blocknum combo
        inline unsigned CalculateRecordId(unsigned sectionnum, unsigned blocknum)
        {
                return (sectionnum*SectionSize) + (blocknum%SectionSize);
        }

        inline uint8_t* RecordStore(uint8_t *whichprolog,RecordId recnum)
        {
                return whichprolog + (recnum%SectionSize)*BlockSize;
        }
        inline uint8_t* RecordLookup(uint8_t *whichprolog,RecordId recnum)
        {
                return whichprolog + (recnum%SectionSize)*RecordLookupSize;
        }
        inline uint8_t *RecordLength(uint8_t *whichprolog,RecordId recnum)
        {
                return RecordLookup(whichprolog,recnum)+0;
        }
        inline uint8_t *RecordInserter(uint8_t *whichprolog,RecordId recnum)
        {
                return RecordLookup(whichprolog,recnum)+4;
        }
        inline uint8_t *RecordUpdater(uint8_t *whichprolog,RecordId recnum)
        {
                return RecordLookup(whichprolog,recnum)+8;
        }
         inline uint8_t *RecordNextVersion(uint8_t *whichprolog,RecordId recnum)
        {
                return RecordLookup(whichprolog,recnum)+12;
        }

        static const unsigned SectionCacheVersion = 4;
        static const unsigned SectionCacheMagic = 0x72710000 + SectionCacheVersion;
}

inline bool SectionFreeInfo::IsEmpty() const
{
        return largestrun_size == RecordsPerSection;
}

RecordId RawDatabase::WriteNewRecord(TableId tableid, Record rec, RecordId hint, bool new_section_on_hint_fail, TransId trans, Blex::SectionUpdateHistory &commits)
{
        // Determine record length
        uint16_t reclen=Blex::getu16lsb(rec.GetRawData());
        if (reclen > MaximumRecordSize)
            throw Exception(ErrorInvalidArg,"Trying to write a record larger than 32Kb");
        unsigned numblocks = NumBlocks(reclen);

        SectionInfo *section_info(0);
        bool section_is_new=false;
        unsigned first_block;
        {
                {
                        // Try to get a section with enough room from the table
                        TableRef tablelock(*this, tableid);
                        if (hint)
                        {
                                // We have a hint, see if that section has enough room
                                // Allow failure, as the hint may be outdated and pointing to another table's section
                                section_info = tablelock->GetSection(RecordSection(hint), true);
                                if (section_info && section_info->tablelocked_freeinfo.largestrun_size < numblocks)
                                    section_info = 0;
                                IODEBUGPRINT("IO: WNR  Table:"<<tableid<< " Trans:" << trans<< " using hint " << hint << " success: " << (section_info ? "yes" : "no"));
                        }
                        if (!section_info && !new_section_on_hint_fail)
                        {
                                // Nothing found with the hint, and not forced to put into a new section, find a section with room
                                section_info = tablelock->FindSectionWithEnoughRoom(numblocks);
                        }
                        if (section_info)
                        {
                                // Allocate room in the new section, and make sure the free-info isn't invalidates by upping the updater count
                                first_block = section_info->tablelocked_freeinfo.AllocateRoom(numblocks);
                                tablelock.IncreaseUpdaters(section_info);
                        }
                }

                // No section with enough room found, allocate a new section
                if (!section_info)
                {
                        // No free section available, allocate a new one outside the table lock. AllocateEmptySection locks a section prolog
                        // and this function locks them the other way round (the section locks can collide due to using a lock array)
                        section_info = AllocateEmptySection();

                        TableRef tablelock(*this, tableid);
                        tablelock->AddSection(section_info);
                        section_is_new = true;
                        IODEBUGPRINT("IO: WNR  Table:"<<tableid<< " Trans:" << trans<< " Added new section " << section_info->globalsectionnum);

                        // Allocate room in the new section, and make sure the free-info isn't invalidated by upping the updater count
                        first_block = section_info->tablelocked_freeinfo.AllocateRoom(numblocks);
                        tablelock.IncreaseUpdaters(section_info);
                }
        }

        IODEBUGPRINT("IO: WNR  Table:" << tableid << " Trans:" << trans
                     << " Section:" << section_info->globalsectionnum << " Blocks:" << first_block << "-" << (first_block+numblocks-1));

        // Register the write to the section for this transaction
        {
                LockedChaseLockData::WriteRef lock(chaselockdata);
                std::unordered_map< TransId, std::unordered_set< unsigned > >::iterator it = lock->modified_sections.find(trans);
                if (it == lock->modified_sections.end())
                    it = lock->modified_sections.insert(std::make_pair(trans, std::unordered_set< unsigned >())).first;

                it->second.insert(section_info->globalsectionnum);
        }

        // Get a reference to the section (map it into memory)
        SectionRef section(*this, section_info, false);

        /* At this moment, the room voor the new record has been allocated from
           the free-info in the section. That free-info cannot be invalidated, because
           updates can only be done when the updater count is zero
        */


        // We can write the data of the record outside the locks, its prolog data is invalid, and the room is freshly allocated.
        memcpy   (RecordStore(section.data(), first_block),rec.GetRawData(),reclen);

        section.PrefetchProlog();
        section.LockProlog();

        if (section_is_new)
            Blex::putu32lsb(section.prolog() + HeaderTableId, tableid);

        //Mark the blocks as used (length in the first, mark the rest as Occupied)
        Blex::putu16lsb(RecordLength(section.prolog(),first_block), reclen);
        for (unsigned curblock=first_block+1, end = first_block + numblocks; curblock<end; ++curblock)
            Blex::putu16lsb(RecordLength (section.prolog(),curblock),0xFFFF);

        //Setup metadata for the new record
        Blex::putu32lsb(RecordInserter   (section.prolog(),first_block),trans);
        Blex::putu32lsb(RecordUpdater    (section.prolog(),first_block),TransStateMgr::NeverCommitted);
        Blex::putu32lsb(RecordNextVersion(section.prolog(),first_block),0);

        // Rescan the prolog to obtain the free_info data.
        SectionFreeInfo free_info;
        section.PrologLocked_RescanProlog(&free_info);
        {
                TableRef tablelock(*this, tableid);
                unsigned count_now = tablelock.DecreaseUpdaters(section_info);

                /* Unlock the prolog lock here to make sure that if count_now is 0,
                   our prolog scan reflects the current information. */
                section.UnlockProlog();
                if (count_now == 0)
                    tablelock.UpdateFreeInfo(section_info, free_info);

                // Auto unlock tablelock
        }
        // Auto unmap of section
        // Register the write
        section.RegisterWrite(commits);

        // Calculate new record id
        return CalculateRecordId(section_info->globalsectionnum, first_block);
}
void RawDatabase::DestroyRecord(TableId tableid, RecordId block, Blex::SectionUpdateHistory &commits)
{
        IODEBUGPRINT("IO: DSTR Table:" << tableid << " section:" << RecordSection(block) << " block:"<<block);

        // Destroy the chase data of the record (if present)
        if (!TryDeleteRecordChaseData(block))
            throw Exception(ErrorInternal, "Tried to delete a record that was still actively referenced by a transaction (through chasing)");

        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSectionFromRec(block,false);

                // Make sure the free_info isn't updated
                tablelock.IncreaseUpdaters(section_info);
        }

        SectionRef section(*this, section_info, false); // maps section in
        section.PrefetchProlog();
        section.LockProlog();

        //Get the number of blocks in the record
        unsigned numblocks=NumBlocks(Blex::getu16lsb(RecordLength(section.prolog(),block)));
        //Free all blocks
        for (unsigned i=0;i<numblocks;++i)
            Blex::putu16lsb(RecordLength(section.prolog(),block+i),0);

        // Rescan the prolog to obtain the free info data.
        SectionFreeInfo free_info;
        section.PrologLocked_RescanProlog(&free_info);
        {
                TableRef tablelock(*this, tableid);
                unsigned count_now = tablelock.DecreaseUpdaters(section_info);

                /* Unlock the prolog lock here to make sure that if count_now is 0,
                   our prolog scan reflects the current information. */
                section.UnlockProlog();
                if (count_now == 0)
                {
                        tablelock.UpdateFreeInfo(section_info, free_info);

                        // If empty, move the section to the list of free sections
                        if (free_info.IsEmpty())
                        {
                                TableRef emptytablelock(*this, 0);
                                tablelock->MoveSectionTo(&*emptytablelock, section_info);
                                IODEBUGPRINT("IO: DSTR Table:" << tableid << " section:" << RecordSection(block) << " is now empty");
                                // Auto unlock EmptySectionList
                        }
                }
                // Auto table unlock
        }
        // Auto unmap of section

        // Register the write
        section.RegisterWrite(commits);
}

RecordId RawDatabase::FindAfterCommitVersion(TransId transid, TableId tableid, RecordId rec)
{
        IODEBUGPRINT("IO: FACV Table:" << tableid << " trans:" << transid << " record:" << rec);
        while (rec)
        {
                SectionInfo *section_info;
                {
                        TableRef tablelock(*this, tableid);
                        section_info = tablelock->GetSectionFromRec(rec, false);
                }
                SectionRef section(*this, section_info, false); // maps section in
                section.PrefetchProlog();
                section.LockProlog();

                //Lock the section prolog containing the record
                TransId updater = Blex::getu32lsb(RecordUpdater(section.prolog(),rec));
                RecordId next_version = ChaseNextVersion(transid, rec, /*lock=*/true);
//                Blex::getu32lsb(RecordNextVersion(section.prolog(),rec));

                section.UnlockProlog();

                if (updater == transid || updater==TransStateMgr::AlwaysCommitted)
                {
                        rec = next_version;
                        continue;
                }

                if (updater == TransStateMgr::NeverCommitted)
                    break;

                TransStateMgr::TransStatus status = translog.GetStatus(updater, 0);
                if (status == TransStateMgr::LocalCommitted || status == TransStateMgr::GlobalCommitted)
                {
                        rec = next_version;
                        continue;
                }
                break;
        }
        IODEBUGPRINT("IO: facv final " << rec);
        return rec;
}

std::pair<bool,RecordId> RawDatabase::TryExpireRecord(TransId transid,TableId tableid,RecordId recblock, Blex::SectionUpdateHistory &commits, TransId &waiting_for)
{
        IODEBUGPRINT("IO: EXPR Table:" << tableid << " trans:" << transid << " record:" << recblock);

        assert(transid!=TransStateMgr::AlwaysCommitted && transid!=TransStateMgr::NeverCommitted);
        waiting_for = 0;

        // Find the relevant sectionfor the updated record.
        // Don't tolerate missing sections, the record was visible for us once, and must still exist
        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSectionFromRec(recblock, false);
        }

        //Map the section in, and lock the section prolog
        SectionRef section(*this, section_info, false); // maps section in
        section.PrefetchProlog();
        section.LockProlog();

        TransId oldupdater=Blex::getu32lsb(RecordUpdater(section.prolog(),recblock));

        //Check if the record is already marked for update
        if (oldupdater!=TransStateMgr::NeverCommitted)
        {
                //FIXME: DiskMarkForUpdate should be moved 'up' and do external
                //       synchronization so that _we_ don't have to know about
                //       TransactionStatus
                TransStateMgr::TransStatus status;

                if (oldupdater == transid)
                    status = TransStateMgr::LocalCommitted;
                else if (oldupdater==TransStateMgr::AlwaysCommitted)
                    status = TransStateMgr::LocalCommitted;
                else
                    status = translog.GetStatus(oldupdater, 0); // Get the REAL commit status

                IODEBUGPRINT("IO: Updater is " << oldupdater << " status:" << Blex::AnyToString(status));

                switch(status)
                {
                case TransStateMgr::LocalCommitted:
                case TransStateMgr::GlobalCommitted:
                    {
                            RecordId next_version = ChaseNextVersion(transid, recblock, /*lock=*/true);
//                            Blex::getu32lsb(RecordNextVersion(section.prolog(),recblock));

                            // ADDME: PROTOCOL PERFORMANCE We only need to retry the current UPDATE
                            DEBUGPRINT("Transaction " << transid << " conflicted on record " << recblock << ", chasing to " << next_version);
                            return std::make_pair(true,next_version);
                    }

                case TransStateMgr::Busy:
                    {
                            DEBUGPRINT("Transaction " << transid << " may conflict on record " << recblock << ", retry");
                            waiting_for = oldupdater;
                            return std::make_pair(false,0);
                    }

                case TransStateMgr::LocalRolledBack:
                case TransStateMgr::GlobalRolledBack:
                    break; //just ignore

                default:
                    throw Exception(ErrorInternal,"Unexpected transaction status for " + Blex::AnyToString(recblock));
                }
        }

        // We may expire the record, do the writes.
        section.RegisterWrite(commits);
        Blex::putu32lsb(RecordUpdater(section.prolog(),recblock),transid);      //Updating transaction
//        Blex::putu32lsb(RecordNextVersion(section.prolog(),recblock),0);

        section.UnlockProlog();

        return std::make_pair(true,recblock);
}

void RawDatabase::UnexpireRecord(TransId transid, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits)
{
        IODEBUGPRINT("IO: UNEX Table:" << tableid << " trans:" << transid << " record:" << recblock);

        // Find the relevant sectionfor the unexpired record.
        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSectionFromRec(recblock, false);
        }

        // Map the section in, prefetch the prolog and lock it
        SectionRef section(*this, section_info, false); // maps section in
        section.PrefetchProlog();
        section.LockProlog();

        // We are going to write (the latter error condition shouldn't happen)
        section.RegisterWrite(commits);
        if (Blex::getu32lsb(RecordUpdater(section.prolog(),recblock)) == transid)
        {
                Blex::putu32lsb(RecordUpdater(section.prolog(),recblock),TransStateMgr::NeverCommitted);
                section.UnlockProlog();
        }
        else
        {
                DEBUGONLY(RecordId next_version = Blex::getu32lsb(RecordUpdater(section.prolog(),recblock));
                        section.UnlockProlog();
                        DEBUGPRINT("\aTransaction " << transid << " tries to unexpire record " << recblock << " that was expired by " << next_version); );
                // If not debug, auto unlock of prolog
        }
}

void RawDatabase::RegisterUpdate(TableId IODEBUGONLYARG(tableid), RecordId origblock,RecordId newblock, Blex::SectionUpdateHistory &/*commits*/)
{
        IODEBUGPRINT("IO: RUPD Table:" << tableid << " orig:" << origblock << " new:" << newblock);

        LockedChaseLockData::WriteRef lock(chaselockdata);

//        DEBUGPRINT("Old Chase-data:");
//        for (std::map< RecordId, RecordChaseData >::iterator it = lock->chase_data.begin(); it != lock->chase_data.end(); ++it)
//            DEBUGPRINT(" " << it->first << ": l:" << it->second.last << " n:" << it->second.next << " r:" << it->second.refcount);

        // Check if the original record was already expired by a rollbacked transaction. If so, we delete the rest of the chain
        RecordChaseData &origdata = lock->chase_data[origblock];
        if (origdata.next)
        {
                // Erase the now-defunct chain
                RecordId erase_me = origdata.next;
                while (erase_me)
                {
                        std::unordered_map< RecordId, RecordChaseData >::iterator oit = lock->chase_data.find(erase_me);
                        assert(oit != lock->chase_data.end());

                        if (oit->second.refcount)
                            break;

                        erase_me = oit->second.next;
                        assert(oit->second.refcount == 0);
                        lock->chase_data.erase(oit);
                }
        }

        lock->chase_data[newblock].last = origblock;
        lock->chase_data[origblock].next = newblock;

//        DEBUGPRINT("New Chase-data:");
//        for (std::map< RecordId, RecordChaseData >::iterator it = lock->chase_data.begin(); it != lock->chase_data.end(); ++it)
//            DEBUGPRINT(" " << it->first << ": l:" << it->second.last << " n:" << it->second.next << " r:" << it->second.refcount);
/*
        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSectionFromRec(origblock, false);
        }

        // Map the section in, prefetch the prolog and lock it
        SectionRef section(*this, section_info, false); // maps section in
        section.PrefetchProlog();
        section.LockProlog();

        // Write the new next version, and register the write in the commit history
        section.RegisterWrite(commits);
        Blex::putu32lsb(RecordNextVersion(section.prolog(),origblock),newblock);
        section.UnlockProlog();*/
}

unsigned RawDatabase::GetNumSections() const
{
        RawDB::ReadRef rawdblock(rawdb);
        return rawdblock->section_count;//sections.size();
}

TableId RawDatabase::Deprecated_GetSectionTableId(unsigned sectionnum) const
{
        // Rob days: This really is a bad (slow) algorithm to find a section without knowing its table; but hopefully, we can get rid of it sometimes.
        for (unsigned i = 0; i < TableLockGranularity+1; ++i)
        {
                LockedTableList::WriteRef lock(tablelocks[i]);

                for (std::map< TableId, std::shared_ptr< TableData > >::iterator titr = lock->tables.begin(); titr != lock->tables.end(); ++titr)
                {
                        if (titr->second->sectionlist.count(sectionnum) != 0)
                            return titr->first;
                }
        }
        return 0;
}

RawDatabase::SectionViewer::SectionViewer(RawDatabase &rawdb, TableId tableid, IdentifiedTrans const &_identified_trans, ShowMode _showmode)
: rawdb(rawdb)
, tableid(tableid)
, identified_trans(&_identified_trans)
, showmode(_showmode)
, locked_section(0)
, sectiondata(0)
{
        record_count = 0;
        nextviewstart = 0;
}

RawDatabase::SectionViewer::SectionViewer(RawDatabase &rawdb, TableId tableid)
: rawdb(rawdb)
, tableid(tableid)
, identified_trans(0)
, showmode(ShowNormal) // dummy value, missing backend stops sectionviewer from using showmode
, locked_section(0)
, sectiondata(0)
, any_records_killed(false)
{
        record_count = 0;
        nextviewstart = 0;
}


RawDatabase::SectionViewer::~SectionViewer()
{
        Unlock();
}

bool RawDatabase::SectionViewer::GotoSection(SectionInfo *section_info)
{
        // Unlock and clear record_count, nextviewstart and any_records_killed
        Unlock();

        // Lock section
        locked_section = section_info;
        sectiondata = locked_section->Lock();

        return true;
}

void RawDatabase::SectionViewer::Unlock()
{
        if (sectiondata)
        {
                if (any_records_killed && (rawdb.section_clean_hint_callback != 0))
                    rawdb.section_clean_hint_callback(&locked_section->globalsectionnum, 1);

                locked_section->Unlock(sectiondata);
                locked_section = 0;
        }
        sectiondata = 0;

        // Empty the list of records and any_records_killed
        record_count = 0;
        nextviewstart = 0;
        any_records_killed = false;
}

namespace
{

bool IsRecordVisibilityPermanent(TransId inserter, TransId updater)
{
        if (inserter == TransStateMgr::NeverCommitted)
            return true;
        if (updater == TransStateMgr::AlwaysCommitted)
            return true;
        if (inserter == TransStateMgr::AlwaysCommitted && updater == TransStateMgr::NeverCommitted)
            return true;
        return false;
}

}

bool RawDatabase::SectionViewer::IsVisible(RecordId curblock)
{
        assert(identified_trans);

        // FIXME: rewrite this to use proper lock stuff
        uint8_t *section = sectiondata;

        // Get the inserter and expirer for this record
        TransId trans_inserter = Blex::getu32lsb(RecordInserter(section,curblock));
        TransId trans_expirer = Blex::getu32lsb(RecordUpdater(section,curblock));

        // Do the inserter and expirer give a permanent answer?
        bool was_permanent = IsRecordVisibilityPermanent(trans_inserter, trans_expirer);

        // Get record visibility + updated inserter and expirer
        TransId new_inserter = trans_inserter, new_expirer = trans_expirer;
//        DEBUGPRINT("Checking visiblility of record " << curblock);
        bool is_visible = identified_trans->IsRecordVisible(
                trans_inserter,
                trans_expirer,
                &new_inserter,
                &new_expirer,
                showmode);

        // Check whether this record will be killed
        // (Killing is defined as making the status of a hidden record permanent)
        if (!is_visible && !was_permanent)
        {
//                DEBUGPRINT("Record " << curblock << " is invisible, but wasn't permanent. Checking permanence of new inserter/expirer");
                if (IsRecordVisibilityPermanent(new_inserter, new_expirer))
                {
//                        DEBUGPRINT("Record " << curblock << " is permanent invisible, trying to kill it");
                        // Try to delete the chase data of the record; returns failure if the record is still referenced and thus may not be killed
                        if (!rawdb.TryDeleteRecordChaseData(curblock))
                        {
//                                DEBUGPRINT("Cancelling killing record " << curblock << ", a chaser still has a lock on it!");

                                // Can't kill it, it must continue to exist for the other transaction
                                return is_visible;
                        }

                        any_records_killed = true;
                        // Fallthrough to actual record-killing code
                }
        }

        // Was the inserter updated?
        if (trans_inserter != new_inserter)
        {
//                DEBUGPRINT("XX: Update to record " << curblock);
//                DEBUGPRINT("XX: Updating inserter from " << trans_inserter << " (" << Blex::AnyToString(identified_trans->GetTransVisibility(trans_inserter,showmode)) << ")" <<
//                        " to " << new_inserter << " (" << Blex::AnyToString(identified_trans->GetTransVisibility(new_inserter,showmode)) << ")");
                Blex::putu32lsb(RecordInserter(section,curblock), new_inserter);
        }

        // Was the expirer updated?
        if (trans_expirer != new_expirer)
        {
//                DEBUGPRINT("XX: Update to record " << curblock);
//                DEBUGPRINT("XX: Updating expirer from " << trans_expirer << " (" << Blex::AnyToString(identified_trans->GetTransVisibility(trans_expirer,showmode)) << ")" <<
//                        " to " << new_expirer << " (" << Blex::AnyToString(identified_trans->GetTransVisibility(new_expirer,showmode)) << ")");
                Blex::putu32lsb(RecordUpdater(section,curblock), new_expirer);
        }

        /* No need to add to the commit history. The current transaction may not be committed at all,
           and these are only optimalizations; it doesn't matter if they are lost */
        return is_visible;
}

bool RawDatabase::SectionViewer::MoveToSection(uint32_t sectionid)
{
        SectionInfo *section_info;
        {
                TableRef tablelock(rawdb, tableid);
                section_info = tablelock->GetSection(sectionid, true);
                if(!section_info) //The section is already cleared
                {
                        IODEBUGPRINT("IO: M2S Table:" << tableid << " Section:" << sectionid << " turned out to be empty");
                        record_count=0;
                        nextviewstart=0;
                        return true;
                }
        }
        return MoveToSection(section_info);
}

bool RawDatabase::SectionViewer::MoveToSection(SectionInfo *section_info)
{
        if (!GotoSection(section_info))
            return false;

        // Auto enumerate all records
        record_count = 0;
        nextviewstart = section_info->globalsectionnum * SectionSize + FirstBlockNumber;
        NextViewInSection();

        IODEBUGPRINT("IO: M2S  Table:" << tableid << " Section:" << section_info->globalsectionnum << " nextviewstart:" << nextviewstart << " reccount:" << record_count);
        return true;
}


bool RawDatabase::SectionViewer::NextViewInSection()
{
        RecordId recid = nextviewstart;
        if (!recid)
            return false;

        SectionRef section(rawdb, locked_section, false);
        section.PrefetchProlog();
        section.LockProlog();

        record_count = 0;
        RecordId const end = (locked_section->globalsectionnum + 1) * SectionSize;
        for (;recid < end;)
        {
                uint16_t record_len = Blex::getu16lsb(RecordLength(section.prolog(),recid));
                if (record_len == 0)
                    ++recid;
                else if (record_len==0xFFFF)
                {
                        //DEBUGPRINT("\aHitting overlapped record?!?! rec: " << recid);
                        ++recid;
                }
                else
                {
                        DiskRecord &item = records[record_count++];

                        item.recordid = recid;
                        item.record = Record(RecordStore(section.data(), recid), record_len);
                        item.is_visible = identified_trans == NULL || IsVisible(recid);

                        recid += NumBlocks(record_len);
                        if (record_count == MaxRecordsView)
                            break;
                }
        }
        if (record_count == MaxRecordsView && recid < end)
            nextviewstart = recid;
        else
            nextviewstart = 0;

        return record_count;
}

bool RawDatabase::SectionViewer::MoveToFirstSection()
{
        SectionInfo *section_info;
        {
                TableRef tablelock(rawdb, tableid);
                section_info = tablelock->GetFirstSectionAfter(0);
        }
        if (!section_info)
        {
                IODEBUGPRINT("IO: M2FS Table:" << tableid << " no sections");
                return false;
        }
        return MoveToSection(section_info);
}

bool RawDatabase::SectionViewer::MoveToNextSection()
{
        SectionInfo *section_info;
        {
                TableRef tablelock(rawdb, tableid);
                section_info = tablelock->GetFirstSectionAfter(locked_section);
        }
        if (!section_info)
        {
                IODEBUGPRINT("IO: M2NS Table:" << tableid << " no more sections");
                return false;
        }
        return MoveToSection(section_info);
}

/// Moves to a specific section, and filters available recordid's by recids; recids MUST be in one section (records not from that section are ignored)
bool RawDatabase::SectionViewer::GuidedMoveToSection(TableId tableid, RecordId const *begin, unsigned count)
{
        if (!count)
            return true;

        uint32_t sectionid = RecordSection(*begin);

        SectionInfo *section_info;
        {
                TableRef tablelock(rawdb, tableid);
                section_info = tablelock->GetSection(sectionid, true);
                if (section_info == NULL) //can fail: the records may have already been destroyed because they were unreachable
                {
                        IODEBUGPRINT("IO: GM2S Section:" << sectionid << " Table:" << tableid << " First:" << *begin << " Count:" << count << " EMPTY!");
                        record_count=0;
                        nextviewstart=0;
                        return true;
                }
        }
        if (!GotoSection(section_info))
            return false;

        record_count = 0;

        SectionRef section(rawdb, locked_section, false);

        section.PrefetchProlog();
        section.LockProlog();

        RecordId const *ptr = begin;
        RecordId const *end = ptr+ count;
        for (; ptr != end; ++ptr)
        {
                if (RecordSection(*ptr) != sectionid)
                {
                        DEBUGPRINT("\aGuided SectionViewer getting record out of current section");
                        continue;
                }

                /* Warning: race condition!
                    When a record has been deleted by the janitor it is deleted from
                    the index first, then from the database. When data from the index
                    is stored, and then the index is closed, the underlying record can
                    be gone already at this point. If it reused it will be invisible,
                    so that is not a problem. */
                uint16_t record_len = Blex::getu16lsb(RecordLength(section.prolog(),*ptr));
                if (record_len == 0 || record_len == 0xFFFF)
                {
                        // Invalid or overlapped record; record gone and/or reused
                        continue;

                        /* // Because of race, these are not errors...
                        if (*ptr == 0)
                            DEBUGPRINT("\aGuided SectionViewer getting recordid 0!");
                        else
                            DEBUGPRINT("\aGuided SectionViewer getting invalid or overlapped record"); */
                }

                if (record_count == MaxRecordsView)
                    throw Exception(ErrorInternal, "Buffer overflow in SectionViewer");

                DiskRecord &dr = records[record_count++];
                dr.recordid = *ptr;
                dr.record = Record(RecordStore(section.data(), *ptr), record_len);
                dr.is_visible = (identified_trans == NULL) || IsVisible(*ptr); // FIXME: move out of the lock!
        }

        // Disable NextViewInSection
        nextviewstart = 0;
        IODEBUGPRINT("IO: GM2S Section:" << sectionid << " Table:" << tableid << " First:" << *begin << " Count:" << count << " got: " << record_count);
        return true;
}

//Clear useless transactions
void RawDatabase::ClearObsoleteTransactions(TableId tableid, RangeId range, unsigned sectionid, std::vector<RecordId> &destroyable, std::vector<RecordId> &allrecs, Blex::SectionUpdateHistory &commits, bool invert)
{
        /* FIXME: This function does a LOT of locking, and unlocks them only for SHORT periods... it can hinder all other threads!*/

        /* It does not matter that the number of sections can grow whilst we
           are clearing this table, because the new sections cannot hold any
           references to transactions that we were supposed to clear */

        //Lock the current section

        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSection(sectionid, true);
                if (!section_info)
                {
                        //The section can already be reallocated to another table. If so, it was already empty.
                        DEBUGPRINT("Called to clear section " << sectionid << " which is empty or does no longer belong to table " << tableid);
                        return;
                }
        }

        //Run through all the records in this section
        unsigned numchanges=0;

        SectionRef section(*this, section_info, false);
        section.PrefetchProlog();
        section.LockProlog();

        for (unsigned recnum = (sectionid * SectionSize) + FirstBlockNumber;
             recnum < ((sectionid+1) * SectionSize);
             ++recnum)
        {
                uint16_t recsize = Blex::getu16lsb(RecordLength(section.prolog(),recnum));
                if (recsize==0xffff /*overlapped*/ || recsize==0 /*free*/)
                    continue;

                TransId inserter=Blex::getu32lsb(RecordInserter(section.prolog(),recnum));
                TransId updater= Blex::getu32lsb(RecordUpdater(section.prolog(),recnum));

                //Set inserter to permanent? (either correct range or invert is set to true, but not both)
                if ( ( (TransStateMgr::GetRangeFromTransId(inserter) == range) ^ invert)
                    && inserter != TransStateMgr::AlwaysCommitted
                    && inserter != TransStateMgr::NeverCommitted)
                {
                        //We must be able to get a permanent status!
                        TransStateMgr::TransStatus status = translog.GetStatus(inserter, 0);
                        assert(status==TransStateMgr::GlobalCommitted || status==TransStateMgr::GlobalRolledBack);

                        if (status==TransStateMgr::GlobalCommitted)
                            inserter = TransStateMgr::AlwaysCommitted;
                        else if (status==TransStateMgr::GlobalRolledBack)
                            inserter = TransStateMgr::NeverCommitted;
                        else
                            throw Exception(ErrorInternal, "Expected permanent transaction status for inserting transaction " + Blex::AnyToString(updater) + ", got status " + Blex::AnyToString(status));

                        Blex::putu32lsb(RecordInserter(section.prolog(),recnum),inserter);
                        ++numchanges;
                }

                //Set updater to permanent?  (either correct range or invert is set to true, but not both)
                if ( ( (TransStateMgr::GetRangeFromTransId(updater) == range) ^ invert)
                    && updater != TransStateMgr::AlwaysCommitted
                    && updater != TransStateMgr::NeverCommitted)
                {
                        //We must be able to get a permanent status!
                        TransStateMgr::TransStatus status = translog.GetStatus(updater, 0);
                        assert(status==TransStateMgr::GlobalCommitted || status==TransStateMgr::GlobalRolledBack);

                        if (status==TransStateMgr::GlobalCommitted)
                            updater = TransStateMgr::AlwaysCommitted;
                        else if (status==TransStateMgr::GlobalRolledBack)
                            updater = TransStateMgr::NeverCommitted;
                        else
                            throw Exception(ErrorInternal, "Expected permanent transaction status for updating transaction " + Blex::AnyToString(updater) + ", got status " + Blex::AnyToString(status));

                        Blex::putu32lsb(RecordUpdater(section.prolog(),recnum),updater);
                        ++numchanges;
                }

                //Destroy record?
                if (inserter==TransStateMgr::NeverCommitted
                    || (inserter==TransStateMgr::AlwaysCommitted && updater==TransStateMgr::AlwaysCommitted))
                {
                        destroyable.push_back(recnum);
                }

                allrecs.push_back(recnum);
        }

        IODEBUGPRINT("IO: CLOB Section:" << sectionid << " Table:" << tableid << " Range:" << range << " updates:" << numchanges << " invert?" << (invert?"true":"false"));

        //Register the write
        if (numchanges)
            section.RegisterWrite(commits);
}

void RawDatabase::MarkSectionDirty(TableId tableid, unsigned sectionid, Blex::SectionUpdateHistory &commits)
{
        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSection(sectionid, true);
                if (!section_info)
                {
                        //The section can already be reallocated to another table. If so, it was already empty.
                        DEBUGPRINT("Called to clear section " << sectionid << " which is empty or does no longer belong to table " << tableid);
                        return;
                }
        }

        SectionRef section(*this, section_info, false);
        section.RegisterWrite(commits);
}

void RawDatabase::ReturnDestroyableRecords(TableId tableid, unsigned sectionid, std::vector<RecordId> *destroyable)
{
        assert(destroyable);

        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSection(sectionid, true);
                if (!section_info)
                {
                        IODEBUGPRINT("IO: RINV Section:" << sectionid << " Table:" << tableid << " GONE");
                        return; //no records to kill
                }
        }

        SectionRef section(*this, section_info, false);
        section.PrefetchProlog();
        section.LockProlog();

        for (unsigned recnum = (sectionid * SectionSize) + FirstBlockNumber;
             recnum < ((sectionid+1) * SectionSize);
             ++recnum)
        {
                if (Blex::getu16lsb(RecordLength(section.prolog(),recnum))==0xffff) //overlapped record
                    continue;
                if (Blex::getu16lsb(RecordLength(section.prolog(),recnum))==0) //free record
                    continue;

                assert((uint32_t)tableid == Blex::getu32lsb(section.prolog() + HeaderTableId));
                TransId inserter=Blex::getu32lsb(RecordInserter(section.prolog(),recnum));
                TransId updater= Blex::getu32lsb(RecordUpdater(section.prolog(),recnum));

                if (translog.IsRecordPermanentlyInvisible(inserter, updater))
                {
                         // Try to remove this record's chase data (fails if it is still in use)
                         if (TryDeleteRecordChaseData(recnum))
                         {
                                 IODEBUGPRINT("IO: RINV Section:" << sectionid << " Table:" << tableid << " Record " << recnum << " invisible, inserter " << inserter << ", updater " << updater);
                                 destroyable->push_back(recnum);
                         }
                }

//                //Destroy record?
//                if (inserter==TransStateMgr::NeverCommitted
//                    || (inserter==TransStateMgr::AlwaysCommitted && updater==TransStateMgr::AlwaysCommitted))
//                {
//                        destroyable->push_back(recnum);
//                }
        }
        IODEBUGPRINT("IO: RINV Section:" << sectionid << " Table:" << tableid << " To destroy:" << destroyable->size());
}

RawDatabase::Debug_RecordData RawDatabase::Debug_GetRecordInfo(RecordId recid)
{
        TableId tableid = Deprecated_GetSectionTableId(RecordSection(recid));

        SectionInfo *section_info;
        {
                TableRef tablelock(*this, tableid);
                section_info = tablelock->GetSectionFromRec(recid, false);
        }
        SectionRef section(*this, section_info, false); // maps section in
        section.PrefetchProlog();
        section.LockProlog();

        Debug_RecordData data;
        data.tableid = Blex::getu32lsb(section.prolog() + HeaderTableId);
        data.size = Blex::getu16lsb(RecordLength(section.prolog(), recid));
        data.adder = Blex::getu32lsb(RecordInserter(section.prolog(), recid));
        data.remover = Blex::getu32lsb(RecordUpdater(section.prolog(), recid));
        data.next = ChaseNextVersion(0, recid, false);
//        Blex::getu32lsb(RecordNextVersion(section.prolog(), recid)); // FIXME!!

        return data;
}

SectionInfo::SectionInfo(unsigned globalsectionnum, RecordFile *file, unsigned filesectionid)
: tablelocked_updater_count(0)
, globalsectionnum(globalsectionnum)
, file(file)
, filesectionid(filesectionid)
{
}

//-----------------------------------------------------------------------------
//
// Database I/O code
//
//-----------------------------------------------------------------------------

RawDatabase::RawDatabase(const std::string &_basefolder, const std::string &_recordfolder, bool new_database, bool disallow_cleaning, bool save_deleted_blobs, bool sync_enabled)
  : sectionlocks(new AlignedSectionLocks[SectionLockGranularity])
  , tablelocks(new AlignedLockedTableList[TableLockGranularity + 1])
  , basefolder(Blex::CollapsePathString(_basefolder))
  , recordfolder(Blex::CollapsePathString(_recordfolder))
  , translog(recordfolder, new_database, disallow_cleaning, sync_enabled)
  , blobmgr(basefolder, recordfolder,save_deleted_blobs, sync_enabled)
  , sync_enabled(sync_enabled)
{
        //assert(!subfolder.empty() && subfolder[subfolder.size()-1]!='/' && Blex::PathIsAbsolute(subfolder)); - FIXME: dit klapt eruit als je een restore doet met een relatieve dir en dat moet eigenlijk ook kunnen - fix restore en reenable de test!
        //DEBUGONLY(rawdb.SetupDebugging("RawDatabase::rawdbdata"));

        // If WEBHARE_DB_CACHEALLSECTIONS is set, cache all sections
        if (Blex::GetEnvironVariable("WEBHARE_DB_CACHEALLSECTIONS").empty())
        {
                DEBUGPRINT("Caching all sections of database records files");
                SectionCached = MaxSectionsPerFile;
        }

        DEBUGONLY(
        for (unsigned i = 0; i < TableLockGranularity+1; ++i)
            tablelocks[i].SetupDebugging("TableLock::" + Blex::AnyToString(i));
        for (unsigned i = 0; i < SectionLockGranularity; ++i)
            sectionlocks[i].mutex.SetupDebugging("SectionLock::" + Blex::AnyToString(i));
        );

        ReadTableFiles();
}

RawDatabase::~RawDatabase() throw()
{
}

void RawDatabase::Close()
{
        RawDB::WriteRef rawdblock(rawdb);
        WriteTableFileSectionCaches(rawdblock);
        CloseTableFiles(rawdblock);
}

void RawDatabase::SetSectionCleanHintCallback(std::function< void(unsigned const *, unsigned) > const &callback)
{
        section_clean_hint_callback = callback;
}


RawDatabase::RecordFilePtr RawDatabase::OpenRecordFile(RawDB::WriteRef &rawdblock, std::string const &path, bool new_file)
{
        //Create a recordfile structure to hold this file
        RecordFilePtr newfile(new RecordFile);
        // FIXME: use new_file parameter to check whether the secfile may already exist. (use create exclusive if new file)
        newfile->secfile.reset(Blex::SectionFile::Open(SectionBytes, path, SectionCached, AllowSharedSections, new_file, false, sync_enabled));
        newfile->path = path;
        if (!newfile->secfile.get())
            throw Exception(ErrorIO,"Cannot open table file");
        if (!AllowSharedSections)
            Blex::ErrStream() << "Warning! RawDatabase: Shared sections disabled, expect VM usage increase";

        //Store file data
        unsigned numsections = newfile->secfile->GetNumSections();
        rawdblock->files.push_back(newfile);

        if (!TryReadAndInvalidateSectionCache(rawdblock, newfile.get(), path + "sc"))
        {
                if (numsections > 64) // Large file, rescanning will take some time
                    Blex::ErrStream() << "Rescanning all database table sections (" << numsections << " total) for file " << path << "\n";
                else if (numsections > 0)
                    DEBUGPRINT("Rescanning all database table sections (" << numsections << " total) for file " << path);

                //Scan the sections inside this file
                for (unsigned i=0;i<numsections;++i)
                {
                        SectionInfo *newsection = new SectionInfo(rawdblock->section_count, newfile.get(), i);
                        si_owner.Adopt(newsection);

                        // Lock section in memory
                        SectionRef section(*this, newsection, true);

                        // Initialize section if necessary
                        uint8_t *prolog = section.prolog();
                        if (Blex::getu32lsb   (prolog+HeaderSize)        != 0
                            || Blex::getu32lsb(prolog+HeaderVersion)     != 2
                            || Blex::getu32lsb(prolog+HeaderBlockSize)   != BlockSize
                            || Blex::getu32lsb(prolog+HeaderSectionSize) != SectionSize)
                        {
                                // This may be an uninitialized section
                                if (std::count(prolog+0, prolog + SectionBytes, 0) != signed(SectionBytes))
                                        Blex::ErrStream() << "Unable to read section #" << i  << ", resetting it\n";
                                else
                                        Blex::ErrStream() << "Found uninitialized section #" << i << ", initializing it";

                                // Initialize section. FIXME: crash binnenin de volgende code maakt de db onleesbaar
                                memset(prolog,0,SectionBytes);
                                Blex::putu32lsb(prolog+HeaderSize,0);
                                Blex::putu32lsb(prolog+HeaderVersion,2);
                                Blex::putu32lsb(prolog+HeaderBlockSize,BlockSize);
                                Blex::putu32lsb(prolog+HeaderSectionSize,SectionSize);
                        }

                        // Scan prolog and read table id
                        SectionFreeInfo freeinfo;
                        section.PrologLocked_RescanProlog(&freeinfo);
                        TableId tableid = freeinfo.IsEmpty() ? 0 : Blex::getu32lsb(prolog + HeaderTableId);

                        // Administer
                        TableRef lock(*this, tableid);
                        lock->AddSection(newsection);
                        lock.UpdateFreeInfo(newsection, freeinfo);
                        ++rawdblock->section_count;
                }
        }

        return newfile;
}

bool RawDatabase::TryReadAndInvalidateSectionCache(RawDB::WriteRef &rawdblock, RecordFile *recordfile, std::string const &path)
{
        uint32_t expected_stamp = 0;
        if (recordfile->secfile->GetNumSections() != 0)
        {
                // Get cache stamp from first section
                std::unique_ptr< SectionInfo > newsection(new SectionInfo(rawdblock->section_count, recordfile, 0));
                SectionRef section(*this, newsection.get(), true);

                uint8_t *prolog = section.prolog();
                expected_stamp = Blex::getu32lsb(prolog+HeaderCacheStamp);
        }

        const std::unique_ptr< Blex::FileStream > uncached_file(Blex::FileStream::OpenRW(path, false, false, Blex::FilePermissions::PrivateRead));
        if (!uncached_file.get())
            return false;

        std::vector< uint8_t > file_data;
        Blex::ReadStreamIntoVector(*uncached_file, &file_data);
        std::unique_ptr< Blex::MemoryReadStream > file;
        file.reset(new Blex::MemoryReadStream(&file_data[0], file_data.size()));

        // List of sections
        std::deque< std::pair< TableId, SectionInfo* > > newsections;

        if (file->ReadLsb< uint32_t >() != SectionCacheMagic)
            return false;

        if (file->ReadLsb< uint32_t >() != expected_stamp)
            return false;

        // Read number of sections, and check file size
        unsigned count = file->ReadLsb< uint32_t >();
        if (file->GetFileLength() != 12 + count * 12)
            return false;

        // Read all individual section
        for (unsigned i = 0; i < count; ++i)
        {
                uint32_t global_section_id = rawdblock->section_count + i;
                unsigned file_section_id = i;

                TableId tableid;
                uint32_t largestrun_position;
                uint32_t largestrun_size;

                if (!file->ReadLsb< int32_t >(&tableid))
                    return false;
                if (!file->ReadLsb< uint32_t >(&largestrun_position))
                    return false;
                if (!file->ReadLsb< uint32_t >(&largestrun_size))
                    return false;

                SectionInfo *newsection = new SectionInfo(global_section_id, recordfile, file_section_id);
                si_owner.Adopt(newsection);

                newsection->tablelocked_freeinfo.largestrun_position = largestrun_position;
                newsection->tablelocked_freeinfo.largestrun_size = largestrun_size;

                newsections.push_back(std::make_pair(tableid, newsection));
        }

        // Reading is done, now invalidate
        uncached_file->SetOffset(0);
        if (uncached_file->WriteLsb< uint32_t >(0) != sizeof(uint32_t))
            return false; //We can safely return here, because we haven't added the new sections yet, but just scanned them into local structures.

        // Add sections to permanent storage AFTER all reading has succeeded
        for (std::deque< std::pair< TableId, SectionInfo* > >::iterator it = newsections.begin(); it != newsections.end(); ++it)
        {
                TableRef lock(*this, it->first);
                lock->AddSection(it->second);
        }

        rawdblock->section_count += newsections.size();

        return true;
}

bool RawDatabase::WriteSectionCache(RecordFile *recordfile, std::string const &path, uint32_t cache_stamp)
{
        const std::unique_ptr< Blex::FileStream > uncached_file(Blex::FileStream::OpenRW(path, true, false, Blex::FilePermissions::PrivateRead));
        if (!uncached_file.get())
            return false;

        uncached_file->SetFileLength(0);
        uncached_file->SetOffset(0);

        std::map< uint32_t, std::pair< TableId, SectionInfo* > > sections;

        std::unique_ptr< Blex::MemoryRWStream > file;
        file.reset(new Blex::MemoryRWStream);

        // Gather all sections from the current file
        for (unsigned i = 0; i < TableLockGranularity+1; ++i)
        {
                LockedTableList::WriteRef lock(tablelocks[i]);
                for (std::map< TableId, std::shared_ptr< TableData > >::iterator titr = lock->tables.begin(); titr != lock->tables.end(); ++titr)
                {
                        for (std::map< unsigned, SectionInfo*>::const_iterator sit = titr->second->sectionlist.begin(); sit != titr->second->sectionlist.end(); ++sit)
                        {
                                if ((sit->second->IsFromFile(recordfile)))
                                {
                                        sections.insert(std::make_pair(sit->second->GetFileSectionId(), std::make_pair(titr->first, sit->second)));
                                        if (sit->second->GetFileSectionId() == 0)
                                        {
                                                SectionRef section(*this, sit->second, true);
                                                Blex::putu32lsb(section.prolog() + HeaderCacheStamp, cache_stamp);
                                        }
                                }
                        }
                }
        }

        // Check for increasing file section ids
        uint32_t ctr = 0;
        for (std::map< uint32_t, std::pair< TableId, SectionInfo*> >::iterator it = sections.begin(); it != sections.end(); ++it)
            if (it->first != ctr++)
                throw Exception(ErrorInternal, "Missing section info during shutdown");

        //  Write the file
        if (file->WriteLsb< uint32_t >(0) != sizeof(uint32_t))
            return false;
        if (file->WriteLsb< uint32_t >(cache_stamp) != sizeof(uint32_t))
            return false;
        if (file->WriteLsb< uint32_t >(sections.size()) != sizeof(uint32_t))
            return false;
        for (std::map< uint32_t, std::pair< TableId, SectionInfo*> >::iterator it = sections.begin(); it != sections.end(); ++it)
        {
                if (file->WriteLsb< uint32_t >(it->second.first) != sizeof(uint32_t))
                    return false;
                if (file->WriteLsb< uint32_t >(it->second.second->tablelocked_freeinfo.largestrun_position) != sizeof(uint32_t))
                    return false;
                if (file->WriteLsb< uint32_t >(it->second.second->tablelocked_freeinfo.largestrun_size) != sizeof(uint32_t))
                    return false;
        }

        file->SetOffset(0);
        if (file->SendAllTo(*uncached_file, 65536) != file->GetFileLength())
            return false;
        if (!uncached_file->OSFlush())
            return false;

        // Reading is done, now set the magic nr
        uncached_file->SetOffset(0);
        if (uncached_file->WriteLsb< uint32_t >(SectionCacheMagic) != sizeof(uint32_t))
            return false;

        return true;
}

void RawDatabase::WriteTableFileSectionCaches(RawDB::WriteRef &rawdblock)
{
        // Get a new cache stamp. unsigned char * may alias everything, so the following code is okay.
        uint32_t new_cache_stamp;
        Blex::FillPseudoRandomVector(
                static_cast< unsigned char * >(static_cast< void * >(&new_cache_stamp)),
                sizeof(new_cache_stamp));

        for (std::vector<RecordFilePtr>::iterator it = rawdblock->files.begin(); it != rawdblock->files.end(); ++it)
        {
                WriteSectionCache(it->get(), (*it)->path + "sc", new_cache_stamp);
        }
}

void RawDatabase::CloseTableFiles(RawDB::WriteRef &rawdblock)
{
        rawdblock->files.clear();
}

void RawDatabase::ExtendDatabase(RawDB::WriteRef &rawdblock)
{
        /* Look for any record file with free space (ADDME: Clean up, we shouldn't have to look through every file, last file should do?!)*/
        RecordFilePtr to_extend;

        for (std::vector<RecordFilePtr>::iterator fileptr = rawdblock->files.begin(); fileptr != rawdblock->files.end(); ++fileptr)
          if ((*fileptr)->secfile->GetNumSections() < MaxSectionsPerFile)
        {
                to_extend = *fileptr;
                break;
        }

        if (!to_extend.get())
        {
                unsigned newfile = ++rawdblock->highest_recordfile;
                to_extend = OpenRecordFile(rawdblock, Blex::MergePath(recordfolder, "db-" + Blex::AnyToString(newfile) + ".whrf"), true);
        }

        /* There is some time between appending the section page and initializing it.  */
        if (!to_extend->secfile->TryAppendSectionPage())
            throw Exception(ErrorIO,"Unable to extend the database (disk full?)");

        /* Lock the newly added section and give it a header*/
        unsigned newsectionnum = to_extend->secfile->GetNumSections()-1;

        /* Store the new section into the section list */
        SectionInfo *newglobalptr = new SectionInfo(rawdblock->section_count, to_extend.get(), newsectionnum);
        si_owner.Adopt(newglobalptr);

        SectionRef section(*this, newglobalptr, true);

#ifdef DEBUG
        for (unsigned i = 0; i < SectionBytes; ++i)
            if (*(section.data() + i) != 0)
                throw Exception(ErrorIO,"Append sectionpage return non-zero pages");
#endif
        // FIXME: a crash within the following code renders the db unusable...
        memset(section.prolog(),0,SectionProlog);
        Blex::putu32lsb(section.prolog()+HeaderSize,0);
        Blex::putu32lsb(section.prolog()+HeaderVersion,2);
        Blex::putu32lsb(section.prolog()+HeaderBlockSize,BlockSize);
        Blex::putu32lsb(section.prolog()+HeaderSectionSize,SectionSize);

        section.PrologLocked_RescanProlog(&newglobalptr->tablelocked_freeinfo);

        /* Store the new section into the section list */
        TableRef tablelock(*this, 0);
        tablelock->AddSection(newglobalptr);
        ++rawdblock->section_count;
}

void RawDatabase::ReadTableFiles()
{
        RawDB::WriteRef rawdblock(rawdb);
        rawdblock->section_count=0;
        rawdblock->highest_recordfile=0;

        //Scan for the superior :) WebHare v3 record files (they have a .whrf
        //extension) and open any we find
        std::vector< std::pair< unsigned, std::string > > files;
        for (Blex::Directory tables(recordfolder,"db-*.whrf");tables;++tables)
        {
                std::string const filename = tables.CurrentFile();
                unsigned recfilenum = Blex::DecodeUnsignedNumber<uint32_t>(filename.begin()+3, filename.end(), 10).first;

                files.push_back(std::make_pair(recfilenum, filename));
        }

        // Sort to get them in ascending order, to get stable recordid mappings.
        std::sort(files.begin(), files.end());
        for (std::vector< std::pair< unsigned, std::string > >::iterator it = files.begin(); it != files.end(); ++it)
        {
                rawdblock->highest_recordfile = it->first;
                OpenRecordFile(rawdblock, Blex::MergePath(recordfolder, it->second), false);
        }
}

void RawDatabase::SyncAllTableFiles()
{
        for (unsigned idx = 0; idx < RawDB::WriteRef(rawdb)->files.size(); ++idx)
        {
                Blex::SectionFile *file = RawDB::WriteRef(rawdb)->files[idx]->secfile.get();
                file->FlushAll();
        }
}
void RawDatabase::UpdateFileTimeStamps()
{
        for (unsigned idx = 0; idx < RawDB::WriteRef(rawdb)->files.size(); ++idx)
        {
                Blex::SectionFile *file = RawDB::WriteRef(rawdb)->files[idx]->secfile.get();
                file->SetModificationDate(Blex::DateTime::Now());
        }
        blobmgr.UpdateAndSync();
        translog.UpdateFileTimeStamp();
}

void RawDatabase::GenerationalCleanupUnusedSections(volatile uint32_t *abortflag)
{
        for (unsigned idx = 0; idx < RawDB::WriteRef(rawdb)->files.size(); ++idx)
        {
                Blex::SectionFile *file = RawDB::WriteRef(rawdb)->files[idx]->secfile.get();
                file->GenerationalCleanupUnusedSections(abortflag);
        }
}

RecordId RawDatabase::ChaseNextVersion(TransId trans, RecordId rec, bool must_lock)
{
        LockedChaseLockData::WriteRef lock(chaselockdata);

//        if (must_lock) // if not, just for info and then we dont need to see the chase-data
//        {
//                DEBUGPRINT("Chasing record " << rec << " to next version from trans " << trans << ", lock: " << (must_lock?"Y":"N"));
//                DEBUGPRINT("Chase-data:");
//                for (std::map< RecordId, RecordChaseData >::iterator it = lock->chase_data.begin(); it != lock->chase_data.end(); ++it)
//                    DEBUGPRINT(" " << it->first << ": l:" << it->second.last << " n:" << it->second.next << " r:" << it->second.refcount);
//        }

        // Hath the record been expired?
        std::unordered_map< RecordId, RecordChaseData >::iterator it = lock->chase_data.find(rec);
        if (it == lock->chase_data.end())
            return 0;

        RecordId next = it->second.next;

        if (must_lock)
        {
                if (!trans)
                    throw Exception(ErrorInternal, "Illegal transid (0) passed when locking next record in a chase");

                // Lock the next record on the chase lists
                std::unordered_map< TransId, std::vector< RecordId > >::iterator tcit = lock->chases_per_trans.find(trans);
                if (tcit == lock->chases_per_trans.end())
                    tcit = lock->chases_per_trans.insert(std::make_pair(trans, std::vector< RecordId >())).first;

                tcit->second.push_back(next);
                ++lock->chase_data[next].refcount;
        }

        return next;
}

bool RawDatabase::TryDeleteRecordChaseData(RecordId rec)
{
        LockedChaseLockData::WriteRef lock(chaselockdata);

//        DEBUGPRINT("Deleting chase data of record " << rec);
//        DEBUGPRINT("Chase-data:");
//        for (std::map< RecordId, RecordChaseData >::iterator it = lock->chase_data.begin(); it != lock->chase_data.end(); ++it)
//            DEBUGPRINT(" " << it->first << ": l:" << it->second.last << " n:" << it->second.next << " r:" << it->second.refcount);

        // Is chase data present?
        std::unordered_map< RecordId, RecordChaseData >::iterator it = lock->chase_data.find(rec);
        if (it == lock->chase_data.end())
            return true; // No, it isn't. Chase data deleted, easiest job ever.!

        if (it->second.refcount != 0)
            return false; // Yes, but the record might still be referenced by another active transaction.

        // Get the record out of the linked list
        if (it->second.last)
        {
                std::unordered_map< RecordId, RecordChaseData >::iterator oit = lock->chase_data.find(it->second.last);
                assert(oit != lock->chase_data.end());

                oit->second.next = it->second.next;
                if (!oit->second.IsUsed())
                {
                        assert(oit->second.refcount == 0);
                        lock->chase_data.erase(oit);
                }
        }
        if (it->second.next)
        {
                std::unordered_map< RecordId, RecordChaseData >::iterator oit = lock->chase_data.find(it->second.next);
                assert(oit != lock->chase_data.end());

                oit->second.last = it->second.last;
                if (!oit->second.IsUsed())
                {
                        assert(oit->second.refcount == 0);
                        lock->chase_data.erase(oit);
                }
        }
        assert(it->second.refcount == 0);
        lock->chase_data.erase(it);

//        DEBUGPRINT("Deleted chase data of record " << rec);
//        DEBUGPRINT("Chase-data:");
//        for (std::map< RecordId, RecordChaseData >::iterator it = lock->chase_data.begin(); it != lock->chase_data.end(); ++it)
//            DEBUGPRINT(" " << it->first << ": l:" << it->second.last << " n:" << it->second.next << " r:" << it->second.refcount);

        return true;
}

void RawDatabase::UnregisterTransaction(TransId trans, bool committed)
{
        std::vector< unsigned > written_to_sections;
        {
                LockedChaseLockData::WriteRef lock(chaselockdata);

                std::unordered_map< TransId, std::vector< RecordId > >::iterator it = lock->chases_per_trans.find(trans);
                if (it != lock->chases_per_trans.end())
                {
                        for (std::vector< RecordId >::const_iterator rit = it->second.begin(), rend = it->second.end(); rit != rend; ++rit)
                        {
                                std::unordered_map< RecordId, RecordChaseData >::iterator cit = lock->chase_data.find(*rit);
                                assert(cit != lock->chase_data.end());
                                --cit->second.refcount;
                                if (!cit->second.IsUsed())
                                {
                                        assert(cit->second.refcount == 0);
                                        lock->chase_data.erase(cit);
                                }
                        }
                        lock->chases_per_trans.erase(it);
                }

                std::unordered_map< TransId, std::unordered_set< unsigned > >::iterator mit = lock->modified_sections.find(trans);
                if (mit != lock->modified_sections.end())
                {
                        // Only hint the janitor when rolled back
                        if (!committed)
                        {
                                written_to_sections.reserve(mit->second.size());

                                for (std::unordered_set< unsigned >::const_iterator sit = mit->second.begin(), send = mit->second.end(); sit != send; ++sit)
                                    written_to_sections.push_back(*sit);
                        }
                        lock->modified_sections.erase(mit);
                }
        }

        // FIXME: hint only for rolled back transactions
        if (!committed && bool(section_clean_hint_callback) && !written_to_sections.empty())
            section_clean_hint_callback(&*written_to_sections.begin(), written_to_sections.size());
}

DatabaseLocker::DatabaseLocker(RawDatabase &rawdb)
: rawdb(rawdb)
{
        locks.reserve(8);
        totallocks=0;
}

DatabaseLocker::~DatabaseLocker()
{
        for (unsigned i=0;i<locks.size();++i)
        {
                //ADDME: Could cascade many unlock actions?
                //DEBUGPRINT(this << "Table " << locks[i].table->GetName() << " unlock " << locks[i].section);
                locks[i].section_info->Unlock(locks[i].sectionptr);
                if (locks[i].lockcount)
                     DEBUGPRINT("Argh! still locks pending (locker: " << this << ")\a");
        }
}

Record DatabaseLocker::LockRec(TableId tableid, RecordId blocknum)
{
        //Check if the blocknum _can_ exist (it doesn't point inside a prolog)
        if ((blocknum%SectionSize) < FirstBlockNumber)
           throw Exception(ErrorInvalidArg,"Illegal record:" + Blex::AnyToString(blocknum));

        ++totallocks;

        //DEBUGPRINT("Locker " << this << " LOCK table " << table << " recnum " << recnum);

        //Find the best unlock nominee (least recently hit block)
        unsigned best_unlock=0;
        unsigned best_totallocks=0;
        unsigned total_unlock=0;

        uint8_t *sectionptr=0;
        for (unsigned i=0;i<locks.size();++i)
        {
                if (locks[i].section_info->globalsectionnum == RecordSection(blocknum))
                {
                        ++locks[i].lockcount;
                        locks[i].lasthit=totallocks;
                        sectionptr=locks[i].sectionptr;
                        break;
                }
                if (locks[i].lockcount == 0)
                {
                        ++total_unlock;
                        //first or better match?
                        if (total_unlock == 1 || best_totallocks > locks[i].lockcount)
                        {
                                best_unlock = i;
                                best_totallocks = locks[i].lockcount;
                        }
                }
        }

        if (!sectionptr)
        {
                //Make sure push_back cannot throw
                locks.reserve(locks.size()+1);

                SectionInfo *section_info;
                {
                        RawDatabase::TableRef lock(rawdb, tableid);
                        section_info = lock->GetSectionFromRec(blocknum, false);
                }

                //Create a lock
                SectionLock newlock;
                newlock.section_info=section_info;
                newlock.lasthit=totallocks;
                newlock.lockcount=1;
                //DEBUGPRINT(this << "Table " << table->GetName() << " lock " << RecordSection(blocknum));
                sectionptr=section_info->Lock();
                newlock.sectionptr=sectionptr;

                //Discard or replace an existing lock?
                if (total_unlock > 4 /* max locks */)
                {
                        //Discard lock best_unlock-1
                        //DEBUGPRINT(this << "Total unused locks " << total_unlock << " evicting " << best_unlock << " totallocks " << totallocks);
                        //DEBUGPRINT(this << "Table " << locks[best_unlock].table->GetName() << " unlock " << locks[best_unlock].section);
                        locks[best_unlock].section_info->Unlock(locks[best_unlock].sectionptr);
                        locks[best_unlock] = newlock;
                }
                else
                {
                        locks.push_back(newlock);
                }

        }

        //Verify record! (ADDME: Do we need a prolog lock here? AFAIK, there's no way a write can take place on the length of a locakble record)
        uint16_t len = Blex::getu16lsb(RecordLength(sectionptr,blocknum));
        if (len==0)
        {
                Blex::ErrStream() << "Locking deleted record:" + Blex::AnyToString(blocknum);
                return Record();
        }
        if (len==0xffff)
        {
                Blex::ErrStream() << "Locking overlapped record:" + Blex::AnyToString(blocknum);
                return Record();
        }

        //Return a pointer to the record
        return Record(RecordStore(sectionptr,blocknum), len);
}

void DatabaseLocker::UnlockRec(RecordId blocknum)
{
        //DEBUGPRINT("Locker " << this << " UNLK table " << table << " recnum " << recnum);
        for (unsigned i=0;i<locks.size();++i)
        {
                if (locks[i].section_info->globalsectionnum == RecordSection(blocknum))
                {
                        if (locks[i].lockcount==0)
                            DEBUGPRINT("DUPE UNLOCK\a");

                        --locks[i].lockcount;
                        return;
                }
        }
        DEBUGPRINT("CANNOT FIND RECORD TO UNLOCK (locker: " << this << ")\a");
}

SectionInfo* RawDatabase::AllocateEmptySection()
{
        SectionInfo *section;

        while (true)
        {
                {
                        //ADDME: Why not using the movesection call directly?
                        TableRef tablelock(*this, 0);
                        if (!tablelock->sectionlist.empty())
                        {
                                section = tablelock->sectionlist.begin()->second;
                                tablelock->sectionlist.erase(tablelock->sectionlist.begin());
                                return section;
                        }
                }
                RawDB::WriteRef rawdblock(rawdb);
                ExtendDatabase(rawdblock);
        }
}

unsigned SectionFreeInfo::AllocateRoom(unsigned blockcount)
{
        assert(largestrun_size >= blockcount);

        // Allocate room in the free info by removing the first blockcount blocks from the run.
        unsigned allocated_pos = largestrun_position;
        largestrun_position += blockcount;
        largestrun_size -= blockcount;
        return allocated_pos;
}

void TableData::MoveSectionTo(TableData *destination, SectionInfo *section)
{
        std::map< unsigned, SectionInfo* >::iterator it = sectionlist.find(section->globalsectionnum);
        if (it == sectionlist.end())
            throw Exception(ErrorInternal, "Could not find needed section in table section list");

        destination->sectionlist.insert(*it);
        sectionlist.erase(it);
}

void TableData::AddSection(SectionInfo* section)
{
        assert(sectionlist.count(section->globalsectionnum)==0);
        sectionlist[section->globalsectionnum] = section;
}

SectionInfo * TableData::FindSectionWithEnoughRoom(unsigned blocks)
{
        // Enough room in that section?
        auto lastinsert = sectionlist.find(lastinsertsectionnr);
        if (lastinsert != sectionlist.end() && lastinsert->second->tablelocked_freeinfo.largestrun_size >= blocks)
            return lastinsert->second;

        // FIXME: linear scan, is slow for very large tables
        for (auto it = sectionlist.begin(),
                end = sectionlist.end(); it != end; ++it)
        {
                if (it->second->tablelocked_freeinfo.largestrun_size >= blocks)
                {
                        lastinsertsectionnr = it->first;
                        return it->second;
                }
        }

        return 0;
}

SectionInfo * TableData::GetSection(unsigned sectionid, bool accept_failure)
{
        std::map< unsigned, SectionInfo* >::iterator it = sectionlist.find(sectionid);
        if (it == sectionlist.end())
        {
                if(accept_failure)
                    return NULL;
                throw Exception(ErrorInternal, "Could not find needed section in table section list, looking for #" + Blex::AnyToString(sectionid));
        }
        return it->second;
}

TableData::TableData(TableId tableid)
: tableid(tableid)
, lastinsertsectionnr(0)
{
}

SectionInfo * TableData::GetSectionFromRec(RecordId rec, bool accept_failure)
{
        return GetSection(RecordSection(rec), accept_failure);
}

SectionInfo * TableData::GetFirstSectionAfter(SectionInfo *section)
{
        if (sectionlist.empty())
            return 0;
        if (!section)
            return sectionlist.begin()->second;

        std::map< unsigned, SectionInfo* >::iterator it = sectionlist.lower_bound(section->globalsectionnum + 1);
        if (it == sectionlist.end())
            return 0;
        return it->second;
}

TableData & TableList::GetTable(TableId id)
{
        std::shared_ptr< TableData > &list(tables[id]);
        if (!list.get())
            list.reset(new TableData(id));
        return *list;
}

TableData const * TableList::GetTableOpt(TableId id) const
{
        std::map< TableId, std::shared_ptr< TableData > >::const_iterator it = tables.find(id);
        if (it == tables.end())
            return 0;
        return it->second.get();
}

bool RawDatabase::IsTableIdStillUsed(TableId table) const
{
        LockedTableList::ReadRef lock(tablelocks[table==0 ? 0 : (table % TableLockGranularity)+1]); //table 0 has a separate lock, because it may be locked inside another table's lock
        TableData const *data = lock->GetTableOpt(table);
        return data && !data->sectionlist.empty();
}

RawDatabase::TableRef::TableRef(RawDatabase &rawdb, TableId table)
: lock(rawdb.tablelocks[table==0 ? 0 : (table % TableLockGranularity)+1]) //table 0 has a separate lock, because it may be locked inside another table's lock
, list(lock->GetTable(table))
{
}

RawDatabase::TableRef::~TableRef()
{
}

void RawDatabase::TableRef::UpdateFreeInfo(SectionInfo *info, SectionFreeInfo const &new_info)
{
        info->tablelocked_freeinfo = new_info;
}

void RawDatabase::TableRef::IncreaseUpdaters(SectionInfo *section_info)
{
        ++section_info->tablelocked_updater_count;
}

unsigned RawDatabase::TableRef::DecreaseUpdaters(SectionInfo *section_info)
{
        return --section_info->tablelocked_updater_count;
}

RawDatabase::SectionRef::SectionRef(RawDatabase &rawdb, SectionInfo *info, bool lock_prolog)
: section_info(info)
, section_data(section_info->Lock())
, prolog_lock(rawdb.sectionlocks[info->globalsectionnum % SectionLockGranularity].mutex, lock_prolog)
, history(0)
{
}

RawDatabase::SectionRef::~SectionRef()
{
        if (prolog_lock.IsLocked())
            prolog_lock.Unlock();

        // Add the section to the commit history (and mark the section dirty) before unlocking it
        // this ensures the section is flushed before it is unmapped.
        if (history)
            section_info->AddToCommitHistory(history);

        section_info->Unlock(section_data);
}

void RawDatabase::SectionRef::PrologLocked_RescanProlog(SectionFreeInfo *free_info)
{
        assert(prolog_lock.IsLocked());

        free_info->largestrun_size = 0;
        free_info->largestrun_position = 0;

        unsigned currentrun=0; //The size of the current run of free blocks
        for (unsigned block=FirstBlockNumber;
                      block<SectionSize;
                      ++block)
        {
                // we can use section_data, we know the prolog is locked.
                if (Blex::getu16lsb(RecordLength(section_data,block))==0)
                {
                        ++currentrun;
                        if (currentrun > free_info->largestrun_size)
                        {
                                free_info->largestrun_size = currentrun;
                                free_info->largestrun_position = block + 1 - currentrun;
                        }
                }
                else
                {
                        currentrun=0;
                }
        }
}

inline void RawDatabase::SectionRef::RegisterWrite(Blex::SectionUpdateHistory &_history)
{
        history = &_history;
}

void RawDatabase::SectionRef::PrefetchProlog()
{
        volatile uint8_t *prolog_ptr = section_data;
        uint8_t *end = section_data + SectionProlog;
        while (prolog_ptr <= end)
        {
                // Force lvalue-to-rvalue conversion, thereby reading from the volatile pointer
                // BCB BUG: static_cast< char >(*prolog_ptr) should have done the trick without variables; but borland likes to optimize reads away, even if they are volatile. sigh.
                char a = *prolog_ptr;
                if (a) // Use a, so we won't get a warning
                    prolog_ptr += 4096; // page size
                else
                    prolog_ptr += 4096; // page size
        }
}

} //end namespace Database
