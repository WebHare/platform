#include <ap/libwebhare/allincludes.h>


#include "indexdumping.h"
#include "validating_index.h"
//#include "indextest2.h"
#include <iostream>

unsigned ReallyDumpTrees = 1;

extern std::string test_dir;
extern std::string curr_dir;

struct BlockData
{
        BlockData()
        {
                in_use=false;
                indexid=-1;
        }

        bool in_use;
        int32_t indexid;
};

typedef std::vector<BlockData> BlocksData;

//---------------------------------------------------------------------------
using namespace Blex::Index;

void DisplayBlockContents(IndexBlock &b)
{
        IndexBlockIterator i = b.begin();
        uint32_t c=1;
        std::cout << std::endl;
        while (i!=b.end())
        {
                std::ostringstream naam;
                naam << "Entry no " << c << " at " << IndexBlock::ByteSizeOfRange(b.begin(), i) << ": " << *i;

                DEBUGPRINT(naam.str());

                ++i;
                ++c;

                if (i>b.end())
                {
                        DEBUGPRINT("" << std::endl << "OH NO!! TOTAL ENTRY SIZES DO NOT MATCH FILLSIZE");
                        break;
                }
        }
        DEBUGPRINT("Total size of entries " << IndexBlock::ByteSizeOfRange(b.begin(), i) << ", reported: " << b.FillSize());
}

/*
void DisplayTreeQuery(BtreeIndex &index, DBIndexFileSystem::ReadSession &session)
{
        DEBUGPRINT("Tree contents:");
        BtreeIndex::Query query (index, session);
        try
        {
                bool ok = query.MoveToFirst();
                while (ok)
                {
                        ostringstream naam;
                        for (uint32_t i=0; i<query.stack.size(); i++)
                                naam << " ";

                        naam << FormatEntryContents(*query);
                        DEBUGPRINT(naam.str());

                        ok = query.Next();
                }
        }
        catch (...)
        {
                DEBUGPRINT("failure");
        }
} */



void DisplayTreeIterate(BtreeIndex::ReadSession &session, BlockId blockno, uint32_t depth, int32_t indexid, BlocksData *blocksdata)
{
        //Record what we know of this block first
        if (blocksdata)
        {
                (*blocksdata)[blockno].indexid = indexid;
        }

        SmartBlockPtr blockptr(session.filesession, blockno);
        IndexBlock::iterator bit = blockptr->begin();

        while (bit != blockptr->end())
        {
                if (depth != session.admin->treedepth)
                        DisplayTreeIterate(session, bit->GetChildBlockId(), depth + 1, indexid, blocksdata);

                if (ReallyDumpTrees)
                {
                        std::ostringstream naam;
                        for (uint32_t i=0; i<depth; i++)
                                naam << " ";

                        naam << *bit;
                        if (bit->IsEOB())
                                naam << " (block: "<<blockptr.GetBlockId()<<", size: "<<blockptr->FillSize()<<")";
                        std::cout << naam.str() << std::endl;
                }
                ++bit;
        }
}

void DisplayTree(BtreeIndex::ReadSession &session, int32_t indexid, BlocksData *blocksdata)
{
        DisplayTreeIterate(session, session.admin->superblockno, 1, indexid, blocksdata);
}
void DisplayTree(BtreeIndex::ReadSession &session)
{
        DisplayTree(session,0,NULL);
}

void DisplayOrphanBlock(DBIndexFileSystem::Session &session, BlockId blockno)
{
        SmartBlockPtr blockptr(session, blockno);
        IndexBlock::iterator bit = blockptr->begin();

        while (bit != blockptr->end())
        {
                /*if (bit->GetChildBlockId() != 0)
                        RawDisplayTreeIterate(session, bit->GetChildBlockId(), depth + 1);
                */
                std::ostringstream naam;
                naam << *bit;
                if (bit->IsEOB())
                        naam << " (block: "<<blockptr.GetBlockId()<<", size: "<<blockptr->FillSize()<<")";
                std::cout << naam.str() << std::endl;
                ++bit;
        }
}

void RawDisplayTreeIterate(DBIndexFileSystem::Session &session, BlockId blockno, uint32_t depth)
{
        SmartBlockPtr blockptr(session, blockno);
        IndexBlock::iterator bit = blockptr->begin();

        while (bit != blockptr->end())
        {
                if (bit->GetChildBlockId() != uint32_t(-1))
                        RawDisplayTreeIterate(session, bit->GetChildBlockId(), depth + 1);

                std::ostringstream naam;
                for (uint32_t i=0; i<depth; i++)
                        naam << " ";

                naam << *bit;
                if (bit->IsEOB())
                        naam << " (block: "<<blockptr.GetBlockId()<<", size: "<<blockptr->FillSize()<<")";
                std::cout << naam.str() << std::endl;
                ++bit;
        }
}

void RawDisplayTree(DBIndexFileSystem::Session &session, BlockId id)
{
        RawDisplayTreeIterate(session, id, 1);
}

/*
void Index_DumpAll()
{
        // Get a readonly config (ignore invalidity, don't mark as invalid!)
        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
        DEBUGONLY(manager.SetupDebugging("manager"));
#endif

        ResourceLocker locker;
        Config config(curr_dir, true, true);
        DBIndexFileSystem filesystem(smm,config);
        ResourceManager<uint32_t>::ExclusiveRef er(manager, locker);


        BlocksData blocks(config.current.filesystem.blocklist.size());
        for (unsigned i=0;i<blocks.size();++i)
        {
                blocks[i].in_use = config.current.filesystem.blocklist[i];
        }

        unsigned indexid=0;
        for (Config::IndexManager::iterator it = config.current.indexmanager.begin(); it != config.current.indexmanager.end(); ++it)
        {
                BtreeIndex index(manager, filesystem, it->index.superblockno, it->index.treedepth, it->index.statistics, "index");
                std::cout << std::endl;
                std::cout << "Index " << indexid << ", type " << it->index.columntype << "  superblock: " << it->index.superblockno << "  depth: " << it->index.treedepth << std::endl;
                std::cout << "Statistics: entries: " << it->index.statistics.totalentries << std::endl;
                std::cout << "config data: " << std::endl;
                std::cout << " tableid " << it->table << std::endl;
                std::cout << " columnid " << it->columnid << std::endl;
                std::cout << " IndexConfig: " << std::endl;
                std::cout << "  superblockno " << it->index.superblockno << std::endl;
                std::cout << "  treedepth " << it->index.treedepth << std::endl;
                std::cout << "  columntype " << it->index.columntype << std::endl;
                std::cout << "  Statistics " << std::endl;
                std::cout << "   totalentries " << it->index.statistics.totalentries << std::endl;
                std::cout << "   totalblocks " << it->index.statistics.totalblocks << std::endl;
                std::cout << "   duplicates " << it->index.statistics.duplicates << std::endl;
                std::cout << "   totalentrysize " << it->index.statistics.totalentrysize << std::endl;
                std::cout << "index data:" << std::endl;

                BtreeIndex::ReadSession readsession(index, locker);
                DisplayTree(readsession,indexid,&blocks);
                std::cout << "end of index data:" << std::endl;
                ++indexid;
        }

        for (unsigned i=0;i<blocks.size();++i)
        {
                if (blocks[i].in_use && blocks[i].indexid==-1)
                {
                        std::cout << "UNOWNED BLOCK " << i << "\n";
                        Database::Index::DBIndexFileSystem::ReadSession session(filesystem);
                        DisplayOrphanBlock(session,i);
                }
        }

        unsigned used=0, orphan=0;

        for (unsigned i=0;i<blocks.size();++i)
        {
                if (blocks[i].in_use)
                {
                        ++used;
                        if (blocks[i].indexid==-1)
                            ++orphan;
                }

                std::cout << "Block " << i << " inuse "
                          << (blocks[i].in_use?"yes":"no ")
                          << " index " << blocks[i].indexid
                          << "\n";
        }

        std::cout << "Stats: " << blocks.size() << " blocks total, "
                     << used << " blocks used, "
                     << orphan << " orphan blocks\n";
}

void Index_DumpRaw(uint32_t block)
{
        // Get a readonly config (ignore invalidity, don't mark as invalid!)
        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
        DEBUGONLY(manager.SetupDebugging("manager"));
#endif

        ResourceLocker locker;
        Config config(curr_dir, true, true);
        DBIndexFileSystem filesystem(smm,config);
        ResourceManager<uint32_t>::ExclusiveRef er(manager, locker);

        Database::Index::DBIndexFileSystem::ReadSession session(filesystem);
        RawDisplayTree(session, block);
}

  */
