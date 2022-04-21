//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

#include <blex/testing.h>
#include <blex/blexlib.h>
#include <blex/btree_filesystem.h>
#include <blex/path.h>
#include <blex/utils.h>
#include <iterator>
#include <vector>
#include <iostream>
#include <fstream>
#include <fstream>
#include "indexdumping.h"

//extern std::string test_dir;
//extern std::string curr_dir;


///Search relation type
enum SearchRelationType
{
        SearchSmaller=0,
        SearchSmallerEqual,
        SearchEqual,
        SearchBiggerEqual,
        SearchBigger,
        SearchUnEqual,
        SearchLike,
        SearchIn
};


using namespace Blex::Index;

const unsigned NumThreads = 1;



// END DEBUG CODE

// 30000/20000/10000

unsigned InsertsCheckInterval = 0;       // Interval between full index-tree checks. 0: no checks
unsigned DeletesCheckInterval = 0;       // Interval between full index-tree checks. 0: no checks
unsigned RandomCheckInterval = 0;        // Interval between full index-tree checks. 0: no checks

/** Tests class made friend in Database::Index::System
    Used for accessing private parts of index system *
struct Database::Index::Tests
{
        typedef System::LockedData LockedData;
        typedef System::IndexData IndexData;

        static LockedData & GetData(System &system)
        {
                return system.data;
        }
}; */


//---------------------------------------------------------------------------

/* ************************************************************************** */
/* ** Tests                                                                ** */
/* ************************************************************************** */

/* ADDME: Split off the index testing code to a seperate module for easier regression testing */

/* arnold: je kunt natuurlijk ook een << operator voor IndexBlockEntry definieren :) */

/*
std::ostream& operator <<(std::ostream &out, const Descriptor& desc)
{
        out << "Desc, type: ";
        switch (desc.type)
        {
        case Type::SingleColumn:
                {
                        out << "snglc, t:" << desc.table << ", c:"<<desc.singlecolumn.column;
                }
        }
        return out;
}

std::ostream& operator <<(std::ostream &out, const RequestDescriptor& desc)
{
        out << "ReqDesc: " << desc.descriptor << " ct: " << desc.columntype;
        return out;
}

std::ostream& operator <<(std::ostream &out, const Tests::IndexData& indexdata)
{
        out << "req:"<<(indexdata.requested?"T":"F")<<"stat:"<<indexdata.status<<std::endl<<" req:"<<indexdata.request;
        return out;
}*/

template <typename X> std::ostream& operator <<(std::ostream &out, const std::set<X> &s)
{
        out << "{";
        typename std::set<X>::const_iterator x  = s.begin();
        typename std::set<X>::const_iterator x2 = s.begin();
        if (x2 != s.end())
                ++x2;
        while (x != s.end())
        {
                out << *x;
                ++x;
                if (x2 != s.end())
                        out << ", ";
                if (x2 != s.end())
                        ++x2;
        }

        return out << "}";
}

template <typename X> std::ostream& operator <<(std::ostream &out, const std::vector<X> &s)
{
        out << "[";
        typename std::vector<X>::const_iterator x  = s.begin();
        typename std::vector<X>::const_iterator x2 = s.begin();
        if (x2 != s.end())
                ++x2;
        while (x != s.end())
        {
                out << *x;
                ++x;
                if (x2 != s.end())
                        out << ", ";
                if (x2 != s.end())
                        ++x2;
        }
        return out << "]";
}

// Call with clear index
void Index_BoundTest()
{
//        Config config(test_dir,false,false);
        Blex::Index::DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false, false);

//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;

//        ResourceManager<uint32_t>::ReadRef managerr(manager);

        IndexBlockEntryContainer entry;
        uint8_t data[4];

        BtreeIndex index(filesystem, "integer");
        for (uint32_t a = 1; a <= 500; ++a)
        {
                Blex::putu32msb(data,a);
                entry.ConstructDataEntry(data, 4, a);
                index.InsertData2(entry);
        }

//        BtreeIndex::ReadSession r(index);
//        DisplayTree(r);
        Blex::putu32msb(data,246);
        entry.ConstructDataEntry(data, 4, 246);
        // DEADLOCK!!
        index.InsertData2(entry);
//        DisplayTree(r);
}

struct DeadLockData
{
        Blex::DebugConditionMutex &mutex;
        signed step;

        BtreeIndex &index_1;
        BtreeIndex &index_2;

        DeadLockData(BtreeIndex &index_1, BtreeIndex &index_2, Blex::DebugConditionMutex &mutex)
        : mutex(mutex)
        , step(0)
        , index_1(index_1)
        , index_2(index_2)
        {}
};


class DeadLockTest
{
        DeadLockData &data;
//        ResourceLocker locker;
        unsigned id;

        public:
        DeadLockTest(DeadLockData &data, unsigned id)
        : data(data)
        , id(id)
        , thread(std::bind(&DeadLockTest::ThreadCode, this))
        {
        }

        Blex::Thread thread;

        void ThreadCode()
        {
                std::shared_ptr<Query> query_1;
                std::shared_ptr<Query> query_2;
                std::shared_ptr<Query> query_3;
                std::shared_ptr<Query> query_4;

                signed last = -1;
                while (last < 100)
                {
                        {
                                Blex::DebugConditionMutex::AutoLock lock(data.mutex);

                                while (data.step == last)
                                        lock.Wait();

                                last = data.step;
                        }
                        bool done = true;


                        unsigned xid = data.step * 10 + id;

                        unsigned action;
                        switch (xid)
                        {
                        case    1:      action = 1; break;
                        case   12:      action = 2; break;
                        case   23:      action = 3; break;
                        case   34:      action = 4; break;
                        case   41:      action = 5; break;
                        case   52:      action = 6; break;
                        default:
                                action = 0;
                        }

                        if (action)
                        {
                                DEBUGPRINT(" Step " << data.step);
                                DEBUGPRINT("Thread " << id << " does action " << action);
                        }
                        else
                                DEBUGPRINT("Thread " << id << " sleeps short");

                        switch (action)
                        {
                        case    1:      {
                                                query_1.reset(new Query(data.index_1));
                                                IndexBlockEntryContainer begin;
                                                IndexBlockEntryContainer end;
                                                begin.ConstructNULLEntry(0);
                                                end.ConstructEOBEntry();
                                                query_1->ResetNewQuery(begin, end);
                                                ++data.step;data.mutex.SignalAll();
                                        }; break;
                        case    2:      {
                                                query_2.reset(new Query(data.index_2));
                                                IndexBlockEntryContainer begin;
                                                IndexBlockEntryContainer end;
                                                begin.ConstructNULLEntry(0);
                                                end.ConstructEOBEntry();
                                                query_2->ResetNewQuery(begin, end);
                                                ++data.step;data.mutex.SignalAll();
                                        }; break;
                        case    3:      {
                                                ++data.step;
                                                uint8_t mydata[4];
                                                Blex::putu32msb(mydata,1);
                                                IndexBlockEntryContainer entry;
                                                entry.ConstructDataEntry(mydata, 4, 1);
                                                data.index_2.InsertData2(entry);
                                        }; break;
                        case    4:      {
                                                ++data.step;
                                                uint8_t mydata[4];
                                                Blex::putu32msb(mydata,1);
                                                IndexBlockEntryContainer entry;
                                                entry.ConstructDataEntry(mydata, 4, 1);
                                                data.index_1.InsertData2(entry);
                                        }; break;
                        case    5:      {
                                                query_3.reset(new Query(data.index_2));
                                                IndexBlockEntryContainer begin;
                                                IndexBlockEntryContainer end;
                                                begin.ConstructNULLEntry(0);
                                                end.ConstructEOBEntry();
                                                query_3->ResetNewQuery(begin, end);
                                                ++data.step;data.mutex.SignalAll();
                                        }; break;
                        case    6:      {
                                                query_4.reset(new Query(data.index_1));
                                                IndexBlockEntryContainer begin;
                                                IndexBlockEntryContainer end;
                                                begin.ConstructNULLEntry(0);
                                                end.ConstructEOBEntry();
                                                query_4->ResetNewQuery(begin, end);
                                                ++data.step;data.mutex.SignalAll();
                                        }; break;

                        default:
                                done = false;
                                // Sleep the thread, to ensure correct order
                                Blex::SleepThread(200);
                                DEBUGPRINT("Thread " << id << " woke up");
                        }
                        if (done)
                                DEBUGPRINT("Thread " << id << " is done with " << action);

                        if (data.step == 6)
                        {
                                data.mutex.SignalAll();
                                break;
                        }

                        {
                        }

                        data.mutex.SignalAll();
                }
                query_1.reset();
                query_2.reset();
                query_3.reset();
                query_4.reset();

                DEBUGPRINT("Thread " << id << " has terminated");
        }
};

void Index_DeadLockTest()
{
        DEBUGPRINT("Starting deadlocktest");

//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;

//        ResourceManager<uint32_t>::ReadRef lock(manager);

//        Config config(test_dir,false,false);
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false, false);
//        DBIndexFileSystem filesystem(smm,config);

        BtreeIndex index_1(filesystem, "integer-1");
        BtreeIndex index_2(filesystem, "integer-2");

        Blex::DebugConditionMutex mutex;
        DEBUGONLY(mutex.SetupDebugging("stepper"));


        DeadLockData data(index_1, index_2, mutex);

        DeadLockTest *tests[NumThreads];
        for (unsigned i=0;i<NumThreads;++i)
            tests[i]=new DeadLockTest(data, i+1);

        for (unsigned i=0;i<NumThreads;++i)
            tests[i]->thread.Start();

        for (unsigned i=0;i<NumThreads;++i)
        {
            tests[i]->thread.WaitFinish();
            delete tests[i];
        }
        DEBUGPRINT("Ended deadlocktest - successfully!");
}

void IntegerTest(std::string const &datafile)
{
//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;

//        Config config(test_dir,false,false);
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false, false);
//        DBIndexFileSystem filesystem(smm,config);
        BtreeIndex indextest(filesystem, "integer");

        std::ifstream data;
        data.open(datafile.c_str());
        if (!data.is_open())
        {
                std::cout<<"cannot open data file\n";
        }

        while (true)
        {
                int32_t value;
                uint32_t record;
                if (!(data >> value) || !(data>>record))
                    break;

                uint8_t valstore[4];
                Blex::putu32msb(valstore,value);
                IndexBlockEntryContainer entry;
                entry.ConstructDataEntry(valstore, 4, record);
                indextest.InsertData2(entry);
        }

        BtreeIndex::ReadSession r(indextest);
        DisplayTree(r);
}

void Index_DumpAll();
void Index_DumpRaw(uint32_t);
void Index_MegaIndexTest()
{
        Blex::MemoryRWStream stream;
        IndexBlockEntryContainer entry;
        std::vector<int32_t> values;
        {
                DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false, false);
                {
                BtreeIndex indextest(filesystem, "integer");

                // Insert values  1 - 65536 to map to id.
                for (int32_t i = 1; i <= 65536; ++i)
                {
                        uint8_t valstore[4];
                        Blex::puts32msb(valstore,i);
                        entry.ConstructDataEntry(valstore, 4, i);
                        indextest.InsertData2(entry);
                }

                stream.SetOffset(0);
                filesystem.SaveFSState(stream);
                indextest.SaveState(stream);
                stream.SetOffset(0);
/*
                config.current.indexmanager.clear();
                config.current.indexmanager.push_back(Config::ManagerIndexConfig());
                indextest.StoreConfig(config.current.indexmanager.back().index);
                filesystem.StoreConfig(config);*/
                }
//                config.WriteOutConfig();
        }
        {
//                Config config(test_dir,false,false);
                DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), &stream, false, false);
//                DBIndexFileSystem filesystem(smm,config);
                {
//                Config::ManagerIndexConfig &cfg = config.current.indexmanager.back();
//                std::cout << "Reopening index for deleting, super: " << cfg.index.superblockno << ", depth: " << cfg.index.treedepth << std::endl;
//                std::cout << "stats: count: " << cfg.index.statistics.totalentries << " blocks: " << cfg.index.statistics.totalblocks << std::endl;
                BtreeIndex indextest(filesystem, stream);

                // Now delete ranges 100-10000, 12000-32000
                for (int32_t i = 100; i <= 10000; ++i)
                {
                        uint8_t valstore[4];
                        Blex::puts32msb(valstore,i);
                        entry.ConstructDataEntry(valstore, 4, i);
                        indextest.DeleteData2(entry);
                }
                for (int32_t i = 32000; i >= 12000; --i)
                {
                        uint8_t valstore[4];
                        Blex::puts32msb(valstore,i);
                        entry.ConstructDataEntry(valstore, 4, i);
                        indextest.DeleteData2(entry);
                }
                for (int32_t i = 65536; i >= 32679; --i)
                {
                        uint8_t valstore[4];
                        Blex::puts32msb(valstore,i);
                        entry.ConstructDataEntry(valstore, 4, i);
                        indextest.DeleteData2(entry);
                }

                stream.SetOffset(0);
                filesystem.SaveFSState(stream);
                indextest.SaveState(stream);
                stream.SetOffset(0);

//                std::cout << "FIXME: redo closing and opening of index system" << std::endl;
/*
                config.current.indexmanager.clear();
                config.current.indexmanager.push_back(Config::ManagerIndexConfig());
                indextest.StoreConfig(config.current.indexmanager.back().index);
                super = config.current.indexmanager.back().index.superblockno;
                filesystem.StoreConfig(config);*/
                }
//                config.WriteOutConfig();
        }
//        std::cout << "Superblock in config : " << super << std::endl;
//        Index_DumpRaw(super);
//        Index_DumpAll();
        {
//                Config config(test_dir,false,false);
                DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), &stream, false, false);
//                DBIndexFileSystem filesystem(smm,config);
//                Config::ManagerIndexConfig &cfg = config.current.indexmanager.back();
//                std::cout << "Reopening index for reading, super: " << cfg.index.superblockno << ", depth: " << cfg.index.treedepth << std::endl;
//                std::cout << "stats: count: " << cfg.index.statistics.totalentries << " blocks: " << cfg.index.statistics.totalblocks << std::endl;
                {
                BtreeIndex indextest(filesystem, stream);
//                BtreeIndex indextest(manager, filesystem, cfg.index.superblockno, cfg.index.treedepth, cfg.index.statistics, "integer");

//                BtreeIndex::ReadSession r(indextest);

                IndexBlockEntryContainer beginentry;
                beginentry.ConstructNULLEntry(0);
                IndexBlockEntryContainer endentry;
                endentry.ConstructEOBEntry();

                BtreeIndex::Query query(indextest);
                query.ResetNewQuery(beginentry, endentry);

                BtreeIndex::Query::OnlineRef ref(query);

                BtreeIndex::OnlineIterator begin(ref, *query.begin());

                while (*begin < *query.approx_end())
                {
                        int32_t data = Blex::gets32msb(begin->GetData());
                        values.push_back(data);
                        ++begin;
                }
/*                config.current.indexmanager.clear();
                config.current.indexmanager.push_back(Config::ManagerIndexConfig());
                indextest.StoreConfig(config.current.indexmanager.back().index);
                filesystem.StoreConfig(config);*/
                }
//                config.WriteOutConfig();
        }

        std::vector<int32_t> reference;
        for (int32_t i = 1; i <= 99; ++i)
            reference.push_back(i);
        for (int32_t i = 10001; i <= 11999; ++i)
            reference.push_back(i);
        for (int32_t i = 32001; i <= 32678; ++i)
            reference.push_back(i);

        BLEX_TEST_CHECK(reference == values); // Error: Index has been corrupted!
//        curr_dir = temp;
}

void FillBlock(IndexBlock &block, unsigned size, unsigned &orderno, unsigned max_entry_size)
{
        assert(max_entry_size >= 10 + 11);
        block.DeleteRange(block.begin(), block.eob());
        size -= 5;

        uint8_t datastore[64];
        for (uint8_t i=1;i<(uint8_t)max_entry_size;++i) datastore[i] = (uint8_t)(i+64);

        while (true)
        {
                // We cannot insert NULL entries, breaks ordering.
                if (size <= 10)
                        break;

                unsigned this_size = size > max_entry_size ? max_entry_size : size;
                if ((size > max_entry_size) && (size < max_entry_size + 11))
                        this_size -= 11;

                datastore[0] = static_cast<uint8_t>(orderno);
                ++orderno;
                IndexBlockEntryContainer entry;
                entry.ConstructDataEntry(datastore, this_size - 10, this_size - 10);

//                uint32_t a = block.FillSize();

                block.InsertAtWithID(block.eob(), entry, 0);
                size -= this_size;
        }
}

void Index_Splice2Test()
{
//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;
//        ResourceManager<uint32_t>::ExclusiveRef e_ref(manager);

        // Testing of border-conditions of Redistribute
//        Config config(test_dir,false,false);
//        DBIndexFileSystem filesystem(smm,config);
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false, false);


        BtreeIndex indextest(filesystem, "text");
        BtreeIndex::WriteSession r(indextest);

        unsigned max_entry_size = 64;
        unsigned super_entry_size = 49;
        unsigned left_fill = 3517;
        unsigned right_fill = 3517;
//        signed balancepoint = -6;

        SmartBlockPtr left_block(r.filesession, r.filesession.AllocateBlock(1, 0));
        SmartBlockPtr right_block(r.filesession, r.filesession.AllocateBlock(1, 0));

        unsigned orderno = 65;

        // fill them blocks.
        FillBlock(*left_block, left_fill, orderno, max_entry_size);
        SmartBlockPtr superblock(r.filesession, r.filesession.AllocateBlock(1, right_block.GetBlockId()));
        IndexBlockEntryContainer entry;
        uint8_t datastore[64]; datastore[0] = static_cast<uint8_t>(orderno); ++orderno;
        for (uint8_t i=1;i<(uint8_t)super_entry_size;++i) datastore[i] = (uint8_t)(i+64);
        entry.ConstructDataEntry(datastore, super_entry_size-10, 200);
        superblock->InsertAtWithID(superblock->begin(), entry, left_block.GetBlockId());
        FillBlock(*right_block, right_fill, orderno, max_entry_size);

#ifdef DEBUG
        unsigned totalsize = left_block->FillSize() + superblock->FillSize() + right_block->FillSize();
#endif

        DEBUGPRINT("<"<<C_Index::InsertDelete::LowMinSize<<", "<<C_Index::InsertDelete::MinSize<<" - "<<C_Index::InsertDelete::MaxSize<<">");

        DEBUGPRINT("("<<totalsize<<") " <<left_block->FillSize() << " - " << superblock->FillSize() << " - " << right_block->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());

        r.Splice2(*superblock, superblock->begin());

        DEBUGPRINT("TRUE" << " ("<<totalsize<<") " <<left_block->FillSize() << " - " << superblock->FillSize() << " - " << right_block->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());
}

void Index_Average3Test()
{
//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;
//        ResourceManager<uint32_t>::ExclusiveRef e_ref(manager);

        // Testing of border-conditions of Redistribute
//        Config config(test_dir,false,false);
//        DBIndexFileSystem filesystem(smm,config);
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false, false);


        BtreeIndex indextest(filesystem, "text");
        BtreeIndex::WriteSession r(indextest);

        unsigned max_entry_size = 64;

        unsigned left_super_entry_size = 49;
        unsigned right_super_entry_size = 50;
        unsigned left_fill = 1900;
        unsigned middle_fill = 1900;
        unsigned right_fill = 1717;

        SmartBlockPtr left_block(r.filesession, r.filesession.AllocateBlock(1, 0));
        SmartBlockPtr middle_block(r.filesession, r.filesession.AllocateBlock(1, 0));
        SmartBlockPtr right_block(r.filesession, r.filesession.AllocateBlock(1, 0));
        SmartBlockPtr superblock(r.filesession, r.filesession.AllocateBlock(1, right_block.GetBlockId()));

        unsigned orderno = 65;

        // fill them blocks.
        FillBlock(*left_block, left_fill, orderno, max_entry_size);

        IndexBlockEntryContainer entry;
        uint8_t datastore[64]; datastore[0] = static_cast<uint8_t>(orderno); ++orderno;
        for (uint8_t i=1;i<(uint8_t)left_super_entry_size;++i) datastore[i] = (uint8_t)(i+64);
        entry.ConstructDataEntry(datastore, left_super_entry_size-10, 200);
        superblock->InsertAtWithID(superblock->begin(), entry, left_block.GetBlockId());
        FillBlock(*middle_block, middle_fill, orderno, max_entry_size);

        datastore[0] = static_cast<uint8_t>(orderno); ++orderno;
        for (uint8_t i=1;i<(uint8_t)right_super_entry_size;++i) datastore[i] = (uint8_t)(i+64);
        entry.ConstructDataEntry(datastore, right_super_entry_size-10, 200);
        superblock->InsertAtWithID(superblock->begin()+1, entry, middle_block.GetBlockId());
        FillBlock(*right_block, right_fill, orderno, max_entry_size);

#ifdef DEBUG
        unsigned totalsize = left_block->FillSize() + superblock->FillSize() + right_block->FillSize();
#endif

        DEBUGPRINT("<"<<C_Index::InsertDelete::LowMinSize<<", "<<C_Index::InsertDelete::MinSize<<" - "<<C_Index::InsertDelete::MaxSize<<">");

        DEBUGPRINT(" ("<<totalsize<<") " <<left_block->FillSize()  << " - " << middle_block->FillSize() << " - " << right_block->FillSize() << " - " << superblock->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());

#ifdef DEBUG
        bool retval = true;
        retval = r.Average3(*superblock, superblock->begin());
#else
        r.Average3(*superblock, superblock->begin());
#endif
        DEBUGPRINT((retval?"TRUE":"FALSE") << " ("<<totalsize<<") " <<left_block->FillSize()  << " - " << middle_block->FillSize() << " - " << right_block->FillSize() << " - " << superblock->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());
}

BLEX_TEST_FUNCTION(Index_OtherTest)
{
        Index_Splice2Test();
        Index_Average3Test();
        Index_MegaIndexTest();
//        Index_DeadLockTest();               /*FIXME*/
        Index_BoundTest();
}

//---------------------------------------------------------------------------




















