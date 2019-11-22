//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>


#define protected public //FIXME: Ugly hack to get ValidatingIndex to work (solution should be cleaner :-/ )
#define private public //FIXME: Ugly hack to get ValidatingIndex to work (solution should be cleaner :-/ )

#include <blex/testing.h>
#include <ap/dbserver/dbase_diskio.h>
#include <ap/dbserver/dbase_index_frontend.h>
#include "validating_index.h"

namespace DB = Database;
namespace DI = Database::Index;
namespace BI = Blex::Index;

namespace
{
static const DB::TableId testtableid = 1000;
} // End of anonymous namespace

template <typename X> std::string VectorToString(const std::vector<X> &v)
{
        std::ostringstream out;
        out << "[";
        for (typename std::vector<X>::const_iterator it = v.begin(); it != v.end(); ++it)
        {
                out << *it;
                if (it+1 != v.end())
                        out << ", ";
        }
        return out.str();
}


struct IndexFrontendTest
{
        DB::RawDatabase dbase;
        DB::RawTable *testtable;

        std::vector<DB::RecordId> record_ids;
        std::vector<bool> alternating_bools;
        std::vector<int32_t> climbing_ints;
        std::vector<std::string> climbing_strings;

        const std::unique_ptr<DI::System> indexsystem;

        IndexFrontendTest();
        void TestBooleanQuery();
        void BuildTable(Database::RawDatabase *datatable);
        void KillTable(int32_t testtableid);
};

IndexFrontendTest::IndexFrontendTest()
: dbase(Blex::Test::GetTempDir(), false, true, false)
//, testtable(dbase.RegisterTable("test",1000))
{
        BuildTable(&dbase);
        indexsystem.reset(new DI::System (Blex::Test::GetTempDir(), true));
        indexsystem->StartFiller(dbase);
}

/* We'll create a table with 1000 records with the following data pattern:

   Cell 1: integer values 2,4,6,8...
   Cell 2: boolean values (one out of 5 records has TRUE)
   Cell 3: string values (AAA,BBB,...,ZZZ,aAA,bBB,...,zZZ,AaA,BbB,...)

   ADDME: Truncate-able data patterns
*/
void IndexFrontendTest::BuildTable(Database::RawDatabase *database)
{
        DB::WritableRecord rec;
        std::string repeater(3,char(0));
        Blex::SectionUpdateHistory history;

        for (unsigned count=0;count<1000;++count)
        {
                //clear the record
                rec=Database::Record();

                //create the simple cells.
                int32_t intval=-4+count*2;
                climbing_ints.push_back(intval);
                if (intval!=0)
                    rec.SetInteger(1,intval);

                //create the boolean true cell. it may only be created when 'true'
                bool boolval=count%5 == 0;
                alternating_bools.push_back(boolval);
                if (boolval)
                   rec.SetBoolean(2,true);

                //create the 3 char repeater cell
                repeater[0]=char('A' + (count%26) + ( (((count/26)%8) & 1) ? 32 : 0));
                repeater[1]=char('A' + (count%26) + ( (((count/26)%8) & 2) ? 32 : 0));
                repeater[2]=char('A' + (count%26) + ( (((count/26)%8) & 4) ? 32 : 0));
                climbing_strings.push_back(repeater);
                rec.SetString(3,repeater);

                //finalize the cell
                record_ids.push_back(database->WriteNewRecord(testtableid, rec, 0, false, 1, history));
        }
}

void IndexFrontendTest::KillTable(int32_t testtableid)
{
        // Using evil destroyrecord, because it does not require a transaction. Nobody is using this table anyway
        Blex::SectionUpdateHistory history;
        for (std::vector<DB::RecordId>::iterator it = record_ids.begin(); it != record_ids.end(); ++it)
            dbase.DestroyRecord(testtableid, *it, history);
}


void ReadQueryRecordIds(BI::BtreeIndex::Query &query, std::vector<DB::RecordId> *store)
{
        store->clear();
        BI::BtreeIndex::Query::OnlineRef ref(query);
        BI::BtreeIndex::OnlineIterator pos(ref, *query.begin());
        BI::BtreeIndex::OfflineIterator approx_end(query.approx_end());
        for (;*pos <= *approx_end;++pos)
            store->push_back(pos->GetRecordId());
}

void IndexFrontendTest::TestBooleanQuery()
{
        //we need some temporary storage to be able to create cells
        std::shared_ptr<BI::BtreeIndex::Query > query;
        DB::WritableRecord datarec;
        std::vector<DB::RecordId> returned_recordids, proper_recordids;

        DI::Descriptor req;
        req.Initialize(testtableid, 2, DI::StoreRaw, DB::TBoolean, 1);
        DI::IndexData::Ref idata = indexsystem->GetIndexRef(req);

        //Find all 'true' records
        datarec.SetBoolean(1,true);
        query=idata->MakeMultiQuery(&datarec.GetCell(1), 1, DB::SearchEqual, false);

        BLEX_TEST_CHECK(query.get());
        ReadQueryRecordIds(*query, &returned_recordids);

        //Render the actual recordirds
        proper_recordids.clear();
        for (unsigned i=0;i<record_ids.size();++i)
          if (alternating_bools[i])
            proper_recordids.push_back(record_ids[i]);

        //And check them!
        BLEX_TEST_CHECKEQUAL(proper_recordids.size(), returned_recordids.size());
        BLEX_TEST_CHECK(std::equal(proper_recordids.begin(), proper_recordids.end(), returned_recordids.begin()));

        //Now, find all 'false' records
        datarec.SetBoolean(1,false);
        query=idata->MakeMultiQuery(&datarec.GetCell(1), 1, DB::SearchEqual, false);

        BLEX_TEST_CHECK(query.get());
        ReadQueryRecordIds(*query, &returned_recordids);

        //Render the actual recordirds
        proper_recordids.clear();
        for (unsigned i=0;i<record_ids.size();++i)
          if (alternating_bools[i] == false)
            proper_recordids.push_back(record_ids[i]);

        //And check them!
        BLEX_TEST_CHECKEQUAL(proper_recordids.size(), returned_recordids.size());
        BLEX_TEST_CHECK(std::equal(proper_recordids.begin(), proper_recordids.end(), returned_recordids.begin()));
}

BLEX_TEST_FUNCTION(AI_Index_FillerTest)
{
        IndexFrontendTest ift;

        DI::Descriptor da;

        //request a int32_t index on the integer
        da.Initialize(testtableid, 1, DI::StoreS32, DB::TInteger, 4);
        DI::IndexData::Ref s32index = ift.indexsystem->GetIndexRef(da);

        {

                //request a raw index on the boolean
                da.Initialize(testtableid, 2, DI::StoreRaw, DB::TBoolean, 1);
                DI::IndexData::Ref boolindex = ift.indexsystem->GetIndexRef(da);

                //request an uppercase index on the string
                da.Initialize(testtableid, 3, DI::StoreUppercase, DB::TText, 50);
                DI::IndexData::Ref uppcase_textindex = ift.indexsystem->GetIndexRef(da);

                //request an plain index on the string
                da.Initialize(testtableid, 3, DI::StoreRaw, DB::TText, 50);
                DI::IndexData::Ref raw_textindex = ift.indexsystem->GetIndexRef(da);

                //request a combined int32_t, Uppercase indeex on the integer+string
                da.Initialize(testtableid, 1, DI::StoreS32, DB::TInteger, 4);
                da.Append(3, DI::StoreUppercase, DB::TText, 46);
                DI::IndexData::Ref s32_uppcasetext_index = ift.indexsystem->GetIndexRef(da);

                /* Try a serach on the combined index

                // ADDME: Display all indexes at the moment
                /*
                {
                        System::LockedData::ReadRef lockeddata(system.data);
                        for (uint32_t counter = 0; counter < lockeddata->indexes.size(); ++counter)
                        {
                                const System::IndexData &indexdata = lockeddata->indexes[counter];
                                DBIndex2 *index = indexdata.index.get();
                                DBIndex2::ReadSession session(*index);
                                DisplayTree(session);
                        }
                }
                */

                ift.indexsystem->SetMetadataLiveStatus(true);
                ift.indexsystem->WaitForFillComplete();
                ift.TestBooleanQuery();
        }
        //request only a int32_t index on the integer
        ift.indexsystem->WaitForFillComplete();

        //FIXME: Check that the 'freed' indexes actually disappeared.

        // Much needed cleanup
        ift.KillTable(testtableid);
}

BLEX_TEST_FUNCTION(Index_SystemTest)
{
        //ADDME: Grappige testen hier hoor, maar ze valideren nauwelijks of hun acties effect hebben (bv: geen check of een index ook ECHT weg is..)
        namespace DB = Database;
        namespace DI = Database::Index;

        DI::Descriptor d_1,d_2,d_3;

        d_1.Initialize(testtableid,3,DI::StoreS32,DB::TInteger, 4);

        d_2.Initialize(testtableid,4,DI::StoreS32,DB::TInteger, 4);

        d_3.Initialize(testtableid,5,DI::StoreS32,DB::TInteger, 4);

        ValidatingIndex<int32_t>::DataVector source_data_1;
        ValidatingIndex<int32_t>::DataVector source_data_2;
        ValidatingIndex<int32_t>::DataVector source_data_3;
        {
                //DEBUGPRINT("Starting system - 1st time");
                DB::RawDatabase dbase(Blex::Test::GetTempDir(), false, true, false);
                DI::System system(Blex::Test::GetTempDir(), true);

                //DEBUGPRINT("Killing all indexes");
                system.SetMetadataLiveStatus(true);

                //DEBUGPRINT("Requesting " << list.size() << " indexes");
                DI::IndexData::Ref index_1 = system.GetIndexRef(d_1);
                DI::IndexData::Ref index_2 = system.GetIndexRef(d_2);

                //Wait for the indices to become valid
                system.StartFiller(dbase);
                system.WaitForFillComplete();

                //DEBUGPRINT("Inserting record for table 1");
                DB::WritableRecord record;
//                record.SetInteger(3, 0); (Not inserted: new table rules dictate that non-existant = 0)
                record.SetInteger(4, 20);
                record.SetInteger(5, 30);
                system.TableUpdate(testtableid, 30, record, true);
                source_data_1.push_back(IndexEntry<int32_t>(0,30,true));
                source_data_2.push_back(IndexEntry<int32_t>(20,30,true));

                // validate indexes
                {
                        //DEBUGPRINT(VectorToString(source_data_1));
                        //DEBUGPRINT(VectorToString(source_data_2));

                        ValidatingIndex<int32_t> v_1(*index_1->index, d_1, source_data_1);
                        v_1.Validate();
                        ValidatingIndex<int32_t> v_2(*index_2->index, d_2, source_data_2);
                        v_2.Validate();
                }

                system.SetMetadataLiveStatus(false);

                index_1.Reset();
                index_2.Reset();

                system.Close();
                //Sleep(200);
                //DEBUGPRINT("Shutting down system - 1st time");
        }
        //DEBUGPRINT("System shut down - 1st time");

        // Re-opening system
        {
                //DEBUGPRINT("Starting system - 2nd time");
                DB::RawDatabase dbase(Blex::Test::GetTempDir(), false, false, false);
                DI::System system(Blex::Test::GetTempDir(), false);

                //DEBUGPRINT("Requesting " << list.size() << " indexes");

                // Request index for column 3 and for 5. Discard the one on 4.
                DI::IndexData::Ref index_1 = system.GetIndexRef(d_1);
                DI::IndexData::Ref  index_3 = system.GetIndexRef(d_3);
                system.SetMetadataLiveStatus(true);

                //Wait for the indices to become valid
                system.StartFiller(dbase);
                system.WaitForFillComplete();

                //FIXME: Verify that indexes 1 exists, 2 no longer exists, and 3 got created!

                DB::WritableRecord record;
                record.SetInteger(3, 11);
                record.SetInteger(4, 21);
                record.SetInteger(5, 31);
                system.TableUpdate(testtableid, 31, record, true);

                source_data_1.push_back(IndexEntry<int32_t>(11,31,true));
                source_data_3.push_back(IndexEntry<int32_t>(31,31,true));

                // validate indexes
                {
                        //DEBUGPRINT(source_data_1);
                        //DEBUGPRINT(source_data_3);

                        ValidatingIndex<int32_t> v_1(*index_1->index, d_1, source_data_1);
                        v_1.Validate();
                        ValidatingIndex<int32_t> v_3(*index_3->index, d_2, source_data_3);
                        v_3.Validate();
                }

                system.SetMetadataLiveStatus(false);

                index_1.Reset();
                index_3.Reset();

                system.Close();
        }
        //DEBUGPRINT("System shut down - 2nd time");

        {
                //DEBUGPRINT("Starting system - 3rd time");
                DB::RawDatabase dbase(Blex::Test::GetTempDir(), false, false, false);
                DI::System system(Blex::Test::GetTempDir(), false);

                system.SetMetadataLiveStatus(true);
                system.SetMetadataLiveStatus(false);
                system.Close();
                //DEBUGPRINT("Killing all indexes");
                //FIXME: Verify taht the above kill succeeded
                //DEBUGPRINT("Shutting down system - 2nd time");
        }
        //DEBUGPRINT("System shut down - 3nd time");
}

BLEX_TEST_FUNCTION(Index_EntryTest)
{
        //ADDME: Grappige testen hier hoor, maar ze valideren nauwelijks of hun acties effect hebben (bv: geen check of een index ook ECHT weg is..)
        namespace DB = Database;
        namespace DI = Database::Index;

        DI::Descriptor descriptor;
        DB::Cell cells[4];
        BI::IndexBlockEntryContainer container;
        container.ConstructDataEntry((uint8_t const *)"", 0, 0);
        uint8_t *datastore = container.GetData();
        unsigned length;
        bool is_last_imprecise;

        DB::WritableRecord wr;
        wr.SetInteger(3, 10);
        wr.SetString(4, "testing");
        wr.SetBoolean(5, true);
        wr.SetInteger(7, 20);
        wr.SetString(8, "012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789");

        descriptor.Initialize(testtableid,3,DI::StoreS32,DB::TInteger, 4);
        cells[0] = wr.GetCell(3);

        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        uint8_t test_1[] = { 128, 0, 0, 10};
        BLEX_TEST_CHECK(length == 4 && !is_last_imprecise && std::equal(datastore, datastore + length, test_1));

        descriptor.Initialize(testtableid,3,DI::StoreRaw,DB::TText, 5);
        cells[0] = wr.GetCell(4);
        cells[1] = wr.GetCell(3);
        uint8_t test_2[] = { 't', 'e', 's', 't', 'i', 'n', 'g', 0, 0, 0, 7, 128, 0, 0, 10};
        uint8_t test_2_1[] = { 't', 'e', 's', 0, 0, 0, 0, 0, 0, 0};

        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 5 && is_last_imprecise && std::equal(datastore, datastore + length, test_2));

        descriptor.Initialize(testtableid,3,DI::StoreRaw,DB::TText, 10);
        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 7 && !is_last_imprecise && std::equal(datastore, datastore + length, test_2));

        length = DI::ConstructEntry(container, cells, 1, descriptor, 3, is_last_imprecise);
        BLEX_TEST_CHECK(length == 3 && is_last_imprecise && std::equal(datastore, datastore + length, test_2));

        descriptor.Append(2,DI::StoreS32,DB::TInteger, 4);
        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 11 && !is_last_imprecise && std::equal(datastore, datastore + length, test_2));

        length = DI::ConstructEntry(container, cells, 1, descriptor, 3, is_last_imprecise);
        BLEX_TEST_CHECK(length == 3 && is_last_imprecise && std::equal(datastore, datastore + length, test_2_1));

        length = DI::ConstructEntry(container, cells, 2, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 15 && !is_last_imprecise && std::equal(datastore, datastore + length, test_2));

        descriptor.Append(8,DI::StoreUppercase,DB::TText, BI::IndexBlockEntry::MaxDataSize - 15);
        cells[2] = wr.GetCell(8);

        // Test integrity test: lengten string 8 if this fails
        BLEX_TEST_CHECK(cells[2].String().size() > BI::IndexBlockEntry::MaxDataSize - 15);

        const char *str_8 = cells[2].String().c_str();
        length = DI::ConstructEntry(container, cells, 3, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == BI::IndexBlockEntry::MaxDataSize && is_last_imprecise && std::equal(datastore, datastore + 15, test_2));
        BLEX_TEST_CHECK(std::equal(datastore + 15, datastore + BI::IndexBlockEntry::MaxDataSize, str_8));

        descriptor.Initialize(testtableid,3,DI::StoreUppercase,DB::TText, 5);
        cells[0] = wr.GetCell(4);
        cells[1] = wr.GetCell(3);
        uint8_t test_3[] = { 'T', 'E', 'S', 'T', 'I', 'N', 'G', 0, 0, 0, 7, 128, 0, 0, 10};

        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 5 && is_last_imprecise && std::equal(datastore, datastore + length, test_3));

        descriptor.Initialize(testtableid,3,DI::StoreUppercase,DB::TText, 10);
        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 7 && !is_last_imprecise && std::equal(datastore, datastore + length, test_3));

        descriptor.Append(2,DI::StoreS32,DB::TInteger, 4);
        length = DI::ConstructEntry(container, cells, 1, descriptor, 0, is_last_imprecise);
        BLEX_TEST_CHECK(length == 11 && !is_last_imprecise && std::equal(datastore, datastore + length, test_3));
}

