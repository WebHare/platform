//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

#include <blex/testing.h>
#include <blex/blexlib.h>
#include <blex/btree_filesystem.h>
#include "dbase_index_frontend.h"
//#include <blex/fasttimer.h>
#include <blex/path.h>
#include <iterator>
#include <vector>
#include <iostream>
#include <fstream>
#include "validating_index.h"
#include "indexdumping.h"
#include "dbase_types.h"
#include "dbase_meta.h"
#include "dbase_client.h"
#include "dbase.h"

//extern std::string test_dir;
//extern std::string curr_dir;

using namespace Database;
using namespace Blex::Index;
using namespace Database::Index;

const unsigned RandomRunSize = 5000;
const unsigned RunSize = 5000;
const unsigned Repeats = 1;
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

/*
template <typename TestType> ColumnDef GetColumn(ColumnId id, std::string name);

template <> ColumnDef GetColumn<bool>(ColumnId id, std::string name)
{
        return ColumnDef::MakeBoolean(id, name);
}

template <> ColumnDef GetColumn<std::string>(ColumnId id, std::string name)
{
        return ColumnDef::MakeText(id, name, 256);
}

template <> ColumnDef GetColumn<int32_t>(ColumnId id, std::string name)
{
        return ColumnDef::MakeInteger(id, name);
} */

template <typename TestType> bool IsIndexMatch     (const TestType &data, const TestType &criterium, SearchRelationType relation, bool casesensitive, bool real_match);
template <> bool IsIndexMatch<int32_t>(const int32_t &data, const int32_t &criterium, SearchRelationType relation, bool, bool)
{
        switch (relation)
        {
        case SearchSmaller:           return data < criterium;
        case SearchSmallerEqual:      return data <= criterium;
        case SearchEqual:             return data == criterium;
        case SearchBiggerEqual:       return data >= criterium;
        case SearchBigger:            return data > criterium;
        }
        return false;
}

template <> bool IsIndexMatch<bool>(const bool &data, const bool &criterium, SearchRelationType relation, bool, bool)
{
        switch (relation)
        {
        case SearchSmaller:           return data < criterium;
        case SearchSmallerEqual:      return data <= criterium;
        case SearchEqual:             return data == criterium;
        case SearchBiggerEqual:       return data >= criterium;
        case SearchBigger:            return data > criterium;
        }
        return false;
}

template <> bool IsIndexMatch<std::string>(const std::string &data, const std::string &criterium, SearchRelationType relation, bool casesensitive, bool real_match)
{
        uint32_t max_len = (real_match ? 256 : Blex::Index::IndexBlockEntry::MaxDataSize);
        int32_t data_compare;
        if (casesensitive)
            data_compare = Blex::StrCompare( &data[0], &data[0]+data.length(),
                                       &criterium[0], &criterium[0]+criterium.length(), max_len);
        else
            data_compare = Blex::StrCaseCompare( &data[0], &data[0]+data.length(),
                                       &criterium[0], &criterium[0]+criterium.length(), max_len);

        switch (relation)
        {
        case SearchSmaller:           return data_compare < 0;
        case SearchSmallerEqual:      return data_compare <= 0;
        case SearchEqual:             return data_compare == 0;
        case SearchBiggerEqual:       return data_compare >= 0;
        case SearchBigger:            return data_compare > 0;
        }
        return false;
}
/*
template <typename TestType> Search BuildSearch(ColumnId column, TestType data, SearchRelationType relation, bool casesensitive)
{
        return Search::Single<TestType>(column, data, relation);
}

template <> Search BuildSearch<std::string>(ColumnId column, std::string data, SearchRelationType relation, bool casesensitive)
{
        return Search::SingleString(column, &data[0], &data[0]+data.length(), casesensitive, relation);
}

template <typename TestType> class DataBaseColumnType;
template <> class DataBaseColumnType<std::string>     { static ColumnTypes const type = TText; };
template <> class DataBaseColumnType<int32_t>             { static ColumnTypes const type = TInteger; };
template <> class DataBaseColumnType<bool>            { static ColumnTypes const type = TBoolean; };

/*
void AnalyseTree(BtreeIndex &index, DBIndexFileSystem::ReadSession &session, Dset &data)
{
        BtreeIndex::Query query (index, session);
        bool ok = query.MoveToFirst();
        Dset::iterator it = data.begin();
        while (ok)
        {
                const IndexBlockEntry &entry = *query;
                uint32_t rec = entry.RecordID();
                uint32_t dat = getu32lsb(entry.Data());

                if ((rec != it->recordid) || (dat != it->data))
                {
                        DEBUGPRINT("Tree does not match inserted data");
                        DisplayTree(index, session);
                        it = data.begin();
                        for (uint32_t i=0; i<data.size(); ++i)
                        {
                                cout << "("<<it->data<<","<<it->recordid<<") ";
                                ++it;
                        }
                        cout << endl;
                        abort();
                }

                it++;
                ok = query.Next();
        }
        assert(it == data.end());
} */

std::ostream& operator <<(std::ostream &out, FillType filltype)
{
        switch(filltype)
        {
                case FillSequential: return out <<"seq";
                case FillReversedSequential: return out <<"reverse-seq";
                case FillEqual: return out <<"equal";
                case FillRandom: return out <<"random";
        }
        return out<<"INVALID";
}

template <typename TestType> void TestInsert(ValidatingIndex< TestType > &tester, Blex::FastTimer &insert_timer, unsigned &insert_count/*, ResourceLocker &locker*/)
{
        //tester.ShuffleRecords();

        insert_timer.Start();

        for (unsigned i=0;i<tester.GetNumEntries();++i)
        {
                tester.Insert(i);

                if (InsertsCheckInterval && (((i+1) % InsertsCheckInterval)==0))
                    tester.Validate();
        }

        insert_timer.Stop();
        insert_count += tester.GetNumEntries();
}

template <typename TestType> void TestDelete(ValidatingIndex< TestType > &tester, Blex::FastTimer &delete_timer, unsigned &delete_count/*, ResourceLocker &locker*/)
{
        //tester.ShuffleRecords();

        delete_timer.Start();

        for (unsigned i=0;i<tester.GetNumEntries();++i)
        {
                tester.Delete(i);

                if (DeletesCheckInterval && (((i+1) % DeletesCheckInterval)==0))
                    tester.Validate();
        }

        delete_timer.Stop();
        delete_count += tester.GetNumEntries();
}

template <typename TestType> void TestRandom(ValidatingIndex< TestType > &tester, unsigned runsize, Blex::FastTimer &random_timer, unsigned &random_count/*, ResourceLocker &locker*/)
{
        //tester.ShuffleRecords();

        //std::cout << "Filling index\n";

        // Imitate a 'filler' thread, and insert the first half of our entries
        for (unsigned i=0;i<tester.GetNumEntries()/2;++i)
            tester.Insert(i);

        // Try to create a more realistic index filling-destroying pattern...
        // The probability of a delete happening is equal to the percentage
        // of entries actually in the index, so the index should remain about
        // 50% filled
        // (ADDME: Shouldn't we also test some duplicate inserts?)
        // FIXME: Improve this test: do long runs of insertions and deletions, instead of quick alternates
        random_timer.Start();

        //std::cout<<"Random additions and deletions\n";
        for (unsigned i=0;i<runsize;++i)
        {
                //Pick a random item from the testset
                unsigned which_item = tester.GetRandomEntry();

                if (tester.IsInIndex(which_item))
                        tester.Delete(which_item);
                else
                        tester.Insert(which_item);

                if (RandomCheckInterval && (((i+1) % RandomCheckInterval)==0))
                    tester.Validate();
        }

        random_timer.Stop();
        random_count += runsize;

        //std::cout<<"Clearing index\n";
        for (unsigned i=0;i<tester.GetNumEntries();++i)
          if (tester.IsInIndex(i))
            tester.Delete(i);
}

template <typename TestType> void RunTest(Blex::Index::BtreeIndex &index, Descriptor const &descriptor)
{
        ValidatingIndex<TestType> tester(index, descriptor);

        Blex::FastTimer insert_timer,delete_timer,random_timer;

        unsigned insert_count=0;
        unsigned delete_count=0;
        unsigned random_count=0;

        for (FillType fill_record = static_cast<FillType>(FillMinimum+1);
             fill_record < FillMaximum;
             fill_record = static_cast<FillType>(fill_record + 1))
          for (FillType fill_data = static_cast<FillType>(FillMinimum+1);
               fill_data < FillMaximum;
               fill_data = static_cast<FillType>(fill_data+1))
        {
                std::cout << "Test: insert,delete: fillrecord " << fill_record << " filldata " << fill_data << "\n";

                tester.FillRecords(RunSize,fill_record,fill_data);

                if (tester.GetNumEntries()==0)
                {
                        std::cout << "Disqualified test - unable to generate a proper dataset\n";
                        continue;
                }

                //Start the actual tests
                TestInsert (tester,insert_timer,insert_count);
                TestDelete (tester,delete_timer,delete_count);
                TestRandom (tester,RandomRunSize,random_timer,random_count);
        }

        if (insert_timer.GetTotalTime() && insert_count)
        {
                uint64_t perinsert = insert_timer.GetTotalTime() / insert_count;
                double persecond = (1000000.0 / insert_timer.GetTotalTime()) * insert_count;
                std::cout << "Insert done: " << perinsert << " uS per insert, " << persecond << " inserts per second\n";
        }

        if (delete_timer.GetTotalTime() && delete_count)
        {
                uint64_t perdelete = delete_timer.GetTotalTime() / delete_count;
                double persecond = (1000000.0 / delete_timer.GetTotalTime()) * delete_count;
                std::cout << "Delete done: " << perdelete << " uS per delete, " << persecond << " deletes per second\n";
        }

        if (random_timer.GetTotalTime() && random_count)
        {
                uint64_t peraction = random_timer.GetTotalTime() / random_count;
                double persecond = (1000000.0 / random_timer.GetTotalTime()) * random_count;
                std::cout << "Inserts/Deletes done: " << peraction << " uS per action, " << persecond << " actions per second\n";
        }
}

// Call with clear index
void Index_BoundTest()
{
//        Config config(test_dir,false,false);
        Blex::Index::DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);

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

class TheActualTest
{
        public:
        TheActualTest(DBIndexFileSystem &filesystem)
        : integer_index(filesystem, "integer")
        , boolean_index(filesystem, "boolean")
        , string_index(filesystem, "text")
        , thread(std::bind(&TheActualTest::ThreadCode, this))
        {
        }

        Blex::Thread thread;

//        ResourceLocker locker;

//        ResourceManager<uint32_t>::ReadRef managerrr;

        BtreeIndex integer_index;
        BtreeIndex boolean_index;
        BtreeIndex string_index;

        void ThreadCode()
        {
                for (unsigned i=0; i<Repeats; ++i)
                {
                        Descriptor descriptor;

                        std::cout<<"-- Starting analyse with int32_t (repeat " << (i+1) << " of " << Repeats << ")\n";
                        descriptor.Initialize(0, 0, StoreS32, TInteger, 4);
                        RunTest<int32_t>(integer_index, descriptor);

                        std::cout<<"-- Starting analyse with bool (repeat " << (i+1) << " of " << Repeats << ")\n";
                        descriptor.Initialize(0, 0, StoreRaw, TBoolean, 1);
                        RunTest<bool>(boolean_index, descriptor);

                        std::cout<<"-- Starting analyse with std::string (repeat " << (i+1) << " of " << Repeats << ")\n";
                        descriptor.Initialize(0, 0, StoreRaw, TText, 53);
                        RunTest<std::string>(string_index, descriptor);
                }
        }
};

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

bool OpenCloseTest()
{
//        FileStream* metadata = FileStream::OpenRW("c:\\temp\\rob\\mtd.test",true,false,FilePermissions::PrivateRead);

        std::cout << std::endl;

//        Config config(test_dir,false,false);

//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif

        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);
//        DBIndexFileSystem filesystem(smm,config);

        TheActualTest *tests[NumThreads];
        for (unsigned i=0;i<NumThreads;++i)
            tests[i]=new TheActualTest(filesystem);

        for (unsigned i=0;i<NumThreads;++i)
            tests[i]->thread.Start();

        for (unsigned i=0;i<NumThreads;++i)
            tests[i]->thread.WaitFinish();

        for (unsigned i=0;i<NumThreads;++i)
            delete tests[i];

        /*
        {
                BtreeIndex::ReadSession session(index);
                IndexBlock block = IndexBlock::ExistingBlock(session.admin->columntype, session.filesession, session.admin->superblockno);
                DisplayBlockContents(block);
                DisplayTree(session);
        }

        {
                BtreeIndex::ReadSession session(index);
                IndexBlockEntryContainer entry(session.admin->columntype);
        }
        */

        // Now check there is only ONE block allocated in file (assumes all indexes empty!)
        /* DISABLED
        if (config.current.filesystem.usedblocks != 3*NumThreads)
                throw Exception(ErrorInternal, "Leftover blocks in index filesystem");
        */
        return true;
}

template <typename TestType> void TestQuery(ValidatingIndex< TestType > &tester, SearchRelationType relation, bool casesensitive)
{
        const ValidatingIndex<TestType>::DataSet &dataset = tester.GetShadowIndex();

        for (typename ValidatingIndex<TestType>::DataSet::const_iterator it = dataset.begin(); it != dataset.end(); ++it)
        {
                DEBUGPRINT("tst: "<<relation<<" '"<<it->GetData()<<"'");

                std::set<uint32_t> query_all;
                std::set<uint32_t> query_sure;
                std::set<uint32_t> query_unsure;
                std::set<uint32_t> sim;
                std::set<uint32_t> real;

                WritableRecord rec;
                rec.SetColumn(1, it->GetDataSize(), it->GetOrgDataPtr());
                Cell cells[4];
                cells[0] = rec.GetCell(1);

                IndexBlockEntryContainer begin;
                IndexBlockEntryContainer end;
                ContructLimits(begin, end, cells, 1, tester.descriptor, relation);

                Blex::Index::Query query(tester.GetIndex());
                query.ResetNewQuery(begin, end);
                Blex::Index::Query::OnlineRef ref(query);
/*
                // Get the return of the query
                ColumnDef const &column = GetColumn<TestType>(1, std::string("test_column"));
//                Search search = Search::Single<TestType>(0, column, it->GetData(), relation);
                Search search = BuildSearch<TestType>(column.id, it->GetData(), relation, casesensitive);
                Database::Index::Query query(tester.GetIndex(), &search, DataBaseColumnType<TestType>::type);*/
                for (typename Blex::Index::BtreeIndex::OnlineIterator it2(ref, *query.begin()); *it2 < *query.approx_end(); ++it2)
                {
//                        DEBUGPRINT(*it2);
//                        if (it2.Sure())
//                                query_sure.insert(it2->GetRecordId());
//                        else
                                query_unsure.insert(it2->GetRecordId());
                }

                copy(query_sure.begin(), query_sure.end(), std::inserter(query_all,query_all.begin()));
                copy(query_unsure.begin(), query_unsure.end(), std::inserter(query_all,query_all.begin()));

                for (typename ValidatingIndex<TestType>::DataSet::const_iterator it2 = dataset.begin(); it2 != dataset.end(); ++it2)
                {
                        if (IsIndexMatch(it2->GetData(), it->GetData(), relation, casesensitive, false))
                            sim.insert(it2->GetRecordId());
                        if (IsIndexMatch(it2->GetData(), it->GetData(), relation, casesensitive, true))
                            real.insert(it2->GetRecordId());

                        if ((it->GetDataSize() >= Blex::Index::IndexBlockEntry::MaxDataSize) &&
                                (it2->GetDataSize() >= Blex::Index::IndexBlockEntry::MaxDataSize) &&
                                IsIndexMatch(it2->GetData(), it->GetData(), SearchEqual, casesensitive, false))
                            sim.insert(it2->GetRecordId());
                }

                // er moet gelden: query_sure <= real <= query_all <= sim

                // Er moet gelden real <= query_all <= sim
                bool is_equal =
                        includes(sim.begin(), sim.end(), query_all.begin(), query_all.end()) &&
                        includes(query_all.begin(), query_all.end(), real.begin(), real.end()) &&
                        includes(real.begin(), real.end(), query_sure.begin(), query_sure.end());

                DEBUGPRINT("Outcome: " << (is_equal?"OK":"ERROR"));
                if (!is_equal)
                {
                        DEBUGPRINT("real: " << real);
                        DEBUGPRINT("query: " << query_all);
                        DEBUGPRINT("sim: " << sim);
                        DEBUGPRINT("query (sure):" << query_sure);
                        DEBUGPRINT("query (unsure):" << query_unsure);

                        Blex::Index::BtreeIndex::ReadSession readses(tester.GetIndex());
                        DisplayTree(readses);
                        throw Database::Exception(Database::ErrorInternal, "Error detected");
                }
        }
}

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
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);
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


void Index_QueryTest()
{
//        Config config(test_dir,false,false);

//        ResourceManager<uint32_t> manager;

#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;
//        ResourceManager<uint32_t>::ReadRef ref(manager);

        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);
//        DBIndexFileSystem filesystem(smm,config);

        DEBUGPRINT("Normal integer query test");
        {
                // int32_t
                BtreeIndex index(filesystem, "integer");
                Database::Index::Descriptor desc;
                desc.Initialize(0, 0, StoreS32, TInteger, 4);
                ValidatingIndex<int32_t> v_index(index, desc);

                ValidatingIndex<int32_t>::DataVector source_data;
                source_data.push_back(IndexEntry<int32_t>(1,3));
                source_data.push_back(IndexEntry<int32_t>(2,4));
                source_data.push_back(IndexEntry<int32_t>(3,5));
                source_data.push_back(IndexEntry<int32_t>(3,6));
                source_data.push_back(IndexEntry<int32_t>(4,7));
                source_data.push_back(IndexEntry<int32_t>(4,8));
                source_data.push_back(IndexEntry<int32_t>(5,9));
                source_data.push_back(IndexEntry<int32_t>(6,10));

                v_index.SetDataSet(source_data);
                for (uint32_t i=0; i<source_data.size(); ++i)
                        v_index.Insert(i);

                TestQuery<int32_t>(v_index, SearchSmaller, true);
                TestQuery<int32_t>(v_index, SearchSmallerEqual, true);
                TestQuery<int32_t>(v_index, SearchEqual, true);
                TestQuery<int32_t>(v_index, SearchBiggerEqual, true);
                TestQuery<int32_t>(v_index, SearchBigger, true);
        }
        DEBUGPRINT("String-overflow query test");
        {
                // std::string - overflow test
                Blex::Index::BtreeIndex index(filesystem, "text");
                Database::Index::Descriptor desc;
                desc.Initialize(0, 0, StoreRaw, TText, 53);
                ValidatingIndex<std::string> v_index(index, desc);

                ValidatingIndex<std::string>::DataVector source_data;
                source_data.push_back(IndexEntry<std::string>("1                                                               ",3));
                source_data.push_back(IndexEntry<std::string>("2                                                               ",4));
                source_data.push_back(IndexEntry<std::string>("3                                                              1",5));
                source_data.push_back(IndexEntry<std::string>("3                                                              2",6));
                source_data.push_back(IndexEntry<std::string>("3                                                              3",7));
                source_data.push_back(IndexEntry<std::string>("3                       3                                       ",8));
                source_data.push_back(IndexEntry<std::string>("4                                                               ",9));
                source_data.push_back(IndexEntry<std::string>("5                                                              1",10));
                source_data.push_back(IndexEntry<std::string>("5                                                              2",11));
                source_data.push_back(IndexEntry<std::string>("5                                                              3",12));

                v_index.SetDataSet(source_data);
                for (uint32_t i=0; i<source_data.size(); ++i)
                        v_index.Insert(i);

                TestQuery<std::string>(v_index, SearchSmaller, false);
                TestQuery<std::string>(v_index, SearchSmallerEqual, false);
                TestQuery<std::string>(v_index, SearchEqual, false);
                TestQuery<std::string>(v_index, SearchBiggerEqual, false);
                TestQuery<std::string>(v_index, SearchBigger, false);
        }
        /* Strings are no longer stored case-insensitively, so this test has little effect
        DEBUGPRINT("String case query test");
        {
                // std::string - case test
                Database::Index::BtreeIndex index(manager, filesystem, TText, "string");
                ValidatingIndex<std::string> v_index(index);

                ValidatingIndex<std::string>::DataVector source_data;
                source_data.push_back(IndexEntry<std::string>("aaa",85));
                source_data.push_back(IndexEntry<std::string>("aaA",35));
                source_data.push_back(IndexEntry<std::string>("aAa",45));
                source_data.push_back(IndexEntry<std::string>("aAA",55));
                source_data.push_back(IndexEntry<std::string>("Aaa",15));
                source_data.push_back(IndexEntry<std::string>("AaA",25));
                source_data.push_back(IndexEntry<std::string>("AAa",75));
                source_data.push_back(IndexEntry<std::string>("AAA",65));

                source_data.push_back(IndexEntry<std::string>("bbb",63));

                source_data.push_back(IndexEntry<std::string>("ccc",64));
                source_data.push_back(IndexEntry<std::string>("ccC",44));
                source_data.push_back(IndexEntry<std::string>("cCc",14));
                source_data.push_back(IndexEntry<std::string>("cCC",84));
                source_data.push_back(IndexEntry<std::string>("Ccc",54));
                source_data.push_back(IndexEntry<std::string>("CcC",24));
                source_data.push_back(IndexEntry<std::string>("CCc",34));
                source_data.push_back(IndexEntry<std::string>("CCC",74));

                v_index.SetDataSet(source_data);
                for (uint32_t i=0; i<source_data.size(); ++i)
                        v_index.Insert(i);

                TestQuery<std::string>(v_index, SearchEqual, true);

                TestQuery<std::string>(v_index, SearchSmaller, false);
                TestQuery<std::string>(v_index, SearchSmallerEqual, false);
                TestQuery<std::string>(v_index, SearchEqual, false);
                TestQuery<std::string>(v_index, SearchBiggerEqual, false);
                TestQuery<std::string>(v_index, SearchBigger, false);
        }
        */
}


void IntegerTest(std::string const &datafile)
{
//        ResourceManager<uint32_t> manager;
#ifdef DEBUG_RESOURCEMANAGER
//        DEBUGONLY(manager.SetupDebugging("manager"));
#endif
//        ResourceLocker locker;

//        Config config(test_dir,false,false);
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);
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
                RecordId record;
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
                DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);
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
                DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), &stream, false);
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
                DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), &stream, false);
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

void Index_RAUWTest()
{
        OpenCloseTest();
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
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);


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

        unsigned totalsize = left_block->FillSize() + superblock->FillSize() + right_block->FillSize();

        DEBUGPRINT("<"<<C_Index::InsertDelete::LowMinSize<<", "<<C_Index::InsertDelete::MinSize<<" - "<<C_Index::InsertDelete::MaxSize<<">");

        DEBUGPRINT("("<<totalsize<<") " <<left_block->FillSize() << " - " << superblock->FillSize() << " - " << right_block->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());

        bool retval = true;
        r.Splice2(*superblock, superblock->begin());

        DEBUGPRINT((retval?"TRUE":"FALSE") << " ("<<totalsize<<") " <<left_block->FillSize() << " - " << superblock->FillSize() << " - " << right_block->FillSize());
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
        DBIndexFileSystem filesystem(Blex::MergePath(Blex::Test::GetTempDir(), "indexfile.whdb"), NULL, false);


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

        unsigned totalsize = left_block->FillSize() + superblock->FillSize() + right_block->FillSize();

        DEBUGPRINT("<"<<C_Index::InsertDelete::LowMinSize<<", "<<C_Index::InsertDelete::MinSize<<" - "<<C_Index::InsertDelete::MaxSize<<">");

        DEBUGPRINT(" ("<<totalsize<<") " <<left_block->FillSize()  << " - " << middle_block->FillSize() << " - " << right_block->FillSize() << " - " << superblock->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());

        bool retval = true;
        retval = r.Average3(*superblock, superblock->begin());

        DEBUGPRINT((retval?"TRUE":"FALSE") << " ("<<totalsize<<") " <<left_block->FillSize()  << " - " << middle_block->FillSize() << " - " << right_block->FillSize() << " - " << superblock->FillSize());
//        RawDisplayTree(r.filesession, superblock.GetBlockId());
}

BLEX_TEST_FUNCTION(Index_OtherTest)
{
        Index_QueryTest();
        Index_Splice2Test();
        Index_Average3Test();
        Index_MegaIndexTest();
//        Index_DeadLockTest();               /*FIXME*/
        Index_BoundTest();
        OpenCloseTest();
}

//---------------------------------------------------------------------------




















