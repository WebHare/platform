//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>


#include <blex/testing.h>
#include <blex/btree_blocks.h>

//test the IndexBlockEntry and IndexBlockEntryContainer classes
BLEX_TEST_FUNCTION(Btree_EntryTest)
{
        using namespace Blex::Index;

        // Tests indexblocks
        IndexBlockEntryContainer eob;

        eob.ConstructEOBEntry();
        eob.SetChildBlockID(30);

        BLEX_TEST_CHECK(eob.IsEOB());
        BLEX_TEST_CHECK(eob.GetEntryLength() == IndexBlockEntry::EOBSize);
        BLEX_TEST_CHECK(eob.GetChildBlockId() == 30);

        IndexBlockEntryContainer integer;
        uint8_t data[4];
        Blex::puts32msb(data,30);
        integer.ConstructDataEntry(data, 4, 10);
        integer.SetChildBlockID(30);
        BLEX_TEST_CHECK(!integer.IsEOB());
        BLEX_TEST_CHECK(integer.GetEntryLength() == IndexBlockEntry::HeaderSize + sizeof(uint32_t));
        BLEX_TEST_CHECK(integer.GetDataLength() == 4);
        BLEX_TEST_CHECK(Blex::gets32msb(integer.GetData()) == 30);
        BLEX_TEST_CHECK(integer.GetChildBlockId() == 30);
        BLEX_TEST_CHECK(integer.GetRecordId() == 10);

        IndexBlockEntryContainer integer100;
        Blex::puts32msb(data,0x100);
        integer100.ConstructDataEntry(data, 4, 10);
        integer100.SetChildBlockID(30);
        BLEX_TEST_CHECK(!integer100.IsEOB());
        BLEX_TEST_CHECK(integer100.GetEntryLength() == IndexBlockEntry::HeaderSize + sizeof(uint32_t));
        BLEX_TEST_CHECK(integer100.GetDataLength() == 4);
        BLEX_TEST_CHECK(Blex::gets32msb(integer100.GetData()) == 0x100);
        BLEX_TEST_CHECK(integer100.GetChildBlockId() == 30);
        BLEX_TEST_CHECK(integer100.GetRecordId() == 10);

        IndexBlockEntryContainer empty_string;
        const char * empty_str = "";
        empty_string.ConstructDataEntry((const uint8_t*)empty_str, 0, 10);
        empty_string.SetChildBlockID(30);
        BLEX_TEST_CHECK(!empty_string.IsEOB());
        BLEX_TEST_CHECK(empty_string.GetEntryLength() == IndexBlockEntry::HeaderSize);
        BLEX_TEST_CHECK(empty_string.GetDataLength() == 0);
        BLEX_TEST_CHECK(empty_string.GetChildBlockId() == 30);
        BLEX_TEST_CHECK(empty_string.GetRecordId() == 10);

        IndexBlockEntryContainer a_string;
        const char * a_str = "a";
        a_string.ConstructDataEntry((const uint8_t*)a_str, 1, 10);
        a_string.SetChildBlockID(30);
        BLEX_TEST_CHECK(!a_string.IsEOB());
        BLEX_TEST_CHECK(a_string.GetEntryLength() == IndexBlockEntry::HeaderSize + a_string.GetDataLength());
        BLEX_TEST_CHECK(a_string.GetDataLength() == 1);
        BLEX_TEST_CHECK(std::string((char*)a_string.GetData(), a_string.GetDataLength()) == a_str);
        BLEX_TEST_CHECK(a_string.GetChildBlockId() == 30);
        BLEX_TEST_CHECK(a_string.GetRecordId() == 10);

        IndexBlockEntryContainer maxm1_string;
        std::string maxmin1_str(IndexBlockEntry::MaxDataSize - 1, 'b');
        maxm1_string.ConstructDataEntry((const uint8_t*)&maxmin1_str[0], IndexBlockEntry::MaxDataSize - 1, 10);
        maxm1_string.SetChildBlockID(30);
        BLEX_TEST_CHECK(!maxm1_string.IsEOB());
        BLEX_TEST_CHECK(maxm1_string.GetEntryLength() == IndexBlockEntry::HeaderSize + maxm1_string.GetDataLength());
        BLEX_TEST_CHECK(maxm1_string.GetDataLength() == IndexBlockEntry::MaxDataSize - 1);
        BLEX_TEST_CHECK(std::string((char*)maxm1_string.GetData(), maxm1_string.GetDataLength()) == maxmin1_str);
        BLEX_TEST_CHECK(maxm1_string.GetChildBlockId() == 30);
        BLEX_TEST_CHECK(maxm1_string.GetRecordId() == 10);

        IndexBlockEntryContainer max_string;
        std::string max_str(IndexBlockEntry::MaxDataSize, 'b');
        max_string.ConstructDataEntry((const uint8_t*)&max_str[0], IndexBlockEntry::MaxDataSize, 10);
        max_string.SetChildBlockID(30);
        BLEX_TEST_CHECK(!max_string.IsEOB());
        BLEX_TEST_CHECK(max_string.GetEntryLength() == IndexBlockEntry::HeaderSize + max_string.GetDataLength());
        BLEX_TEST_CHECK(max_string.GetDataLength() == IndexBlockEntry::MaxDataSize);
        BLEX_TEST_CHECK(std::string((char*)max_string.GetData(), max_string.GetDataLength()) == max_str);
        BLEX_TEST_CHECK(max_string.GetChildBlockId() == 30);
        BLEX_TEST_CHECK(max_string.GetRecordId() == 10);

        // Test various compare functions
        BLEX_TEST_CHECK(integer == integer);
        BLEX_TEST_CHECK(integer < integer100);
        BLEX_TEST_CHECK(integer < eob);

        BLEX_TEST_CHECK(integer100 > integer);
        BLEX_TEST_CHECK(integer100 == integer100);
        BLEX_TEST_CHECK(integer100 < eob);

        BLEX_TEST_CHECK(empty_string == empty_string);
        BLEX_TEST_CHECK(empty_string < a_string);
        BLEX_TEST_CHECK(empty_string < maxm1_string);
        BLEX_TEST_CHECK(empty_string < max_string);
        BLEX_TEST_CHECK(empty_string < eob);

        BLEX_TEST_CHECK(a_string > empty_string);
        BLEX_TEST_CHECK(a_string == a_string);
        BLEX_TEST_CHECK(a_string < maxm1_string);
        BLEX_TEST_CHECK(a_string < max_string);
        BLEX_TEST_CHECK(a_string < eob);

        BLEX_TEST_CHECK(maxm1_string > empty_string);
        BLEX_TEST_CHECK(maxm1_string > a_string);
        BLEX_TEST_CHECK(maxm1_string == maxm1_string);
        BLEX_TEST_CHECK(maxm1_string < max_string);
        BLEX_TEST_CHECK(maxm1_string < eob);

        BLEX_TEST_CHECK(max_string > empty_string);
        BLEX_TEST_CHECK(max_string > a_string);
        BLEX_TEST_CHECK(max_string > maxm1_string);
        BLEX_TEST_CHECK(max_string == max_string);
        BLEX_TEST_CHECK(max_string < eob);

        BLEX_TEST_CHECK(eob > integer);
        BLEX_TEST_CHECK(eob > integer100);
        BLEX_TEST_CHECK(eob > empty_string);
        BLEX_TEST_CHECK(eob > a_string);
        BLEX_TEST_CHECK(eob > maxm1_string);
        BLEX_TEST_CHECK(eob > max_string);
        BLEX_TEST_CHECK(eob == eob);
}

BLEX_TEST_FUNCTION(Btree_BlockFixedStructureTest)
{
        using namespace Blex::Index;

        std::vector<uint8_t> mem_blocks(1 * C_Block::Size,0xAA);

        uint8_t *blockptr = &mem_blocks[0 * C_Block::Size];

        uint8_t *headersizepos = blockptr + C_Block::Positions::HeadersSize;
        uint8_t *datasizepos = blockptr + C_Block::Positions::DataSize;
        uint8_t *dataend = blockptr + C_Block::Positions::DataEnd;

        uint8_t *entry_pos[4] = { blockptr, blockptr + 1 * IndexBlockEntry::HeaderSize, blockptr + 2 * IndexBlockEntry::HeaderSize, blockptr + 3 * IndexBlockEntry::HeaderSize };

        IndexBlock block(blockptr);
        block.ConstructEmptyBlock(20);

        IndexBlockEntry entry[4] = { IndexBlockEntry(entry_pos[0]), IndexBlockEntry(entry_pos[1]), IndexBlockEntry(entry_pos[2]), IndexBlockEntry(entry_pos[3]) };

        IndexBlockEntryContainer test;

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 11);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 0);
        BLEX_TEST_CHECK(entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 20);

        test.ConstructDataEntry((const uint8_t*)"test",4,33);
        block.InsertAtWithID(block.begin(), test, 77);

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 22);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 4);
        BLEX_TEST_CHECK(!entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[0].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[0].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 77);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[0].GetData()) == 0x74736574);
        BLEX_TEST_CHECK(entry[1].IsEOB());
        BLEX_TEST_CHECK(entry[1].GetChildBlockId() == 20);

        test.ConstructNULLEntry(55);
        block.InsertAtWithID(block.begin(), test, 18);

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 33);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 4);
        BLEX_TEST_CHECK(!entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetDataLength() == 0);
        BLEX_TEST_CHECK(entry[0].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[0].GetRecordId() == 55);
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 18);
        BLEX_TEST_CHECK(!entry[1].IsEOB());
        BLEX_TEST_CHECK(entry[1].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[1].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[1].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[1].GetChildBlockId() == 77);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[1].GetData()) == 0x74736574);
        BLEX_TEST_CHECK(entry[2].IsEOB());
        BLEX_TEST_CHECK(entry[2].GetChildBlockId() == 20);

        uint8_t int_val[4]={1,2,3,4};
        test.ConstructDataEntry(int_val,4,33);
        test.SetChildBlockID(99);
        block.InsertAt(block.begin() + 1, test);

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 44);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 8);
        BLEX_TEST_CHECK(!entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetDataLength() == 0);
        BLEX_TEST_CHECK(entry[0].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[0].GetRecordId() == 55);
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 18);
        BLEX_TEST_CHECK(!entry[1].IsEOB());
        BLEX_TEST_CHECK(entry[1].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[1].GetData() == dataend - 8);
        BLEX_TEST_CHECK(entry[1].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[1].GetChildBlockId() == 99);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[1].GetData()) == 0x04030201);
        BLEX_TEST_CHECK(!entry[2].IsEOB());
        BLEX_TEST_CHECK(entry[2].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[2].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[2].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[2].GetChildBlockId() == 77);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[2].GetData()) == 0x74736574);
        BLEX_TEST_CHECK(entry[3].IsEOB());
        BLEX_TEST_CHECK(entry[3].GetChildBlockId() == 20);

        block.DeleteAt(block.begin() + 0);

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 33);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 8);
        BLEX_TEST_CHECK(!entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[0].GetData() == dataend - 8);
        BLEX_TEST_CHECK(entry[0].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 99);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[0].GetData()) == 0x04030201);
        BLEX_TEST_CHECK(!entry[1].IsEOB());
        BLEX_TEST_CHECK(entry[1].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[1].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[1].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[1].GetChildBlockId() == 77);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[1].GetData()) == 0x74736574);
        BLEX_TEST_CHECK(entry[2].IsEOB());
        BLEX_TEST_CHECK(entry[2].GetChildBlockId() == 20);

        block.DeleteAt(block.begin() + 1);

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 22);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 4);
        BLEX_TEST_CHECK(!entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[0].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[0].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 99);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[0].GetData()) == 0x04030201);
        BLEX_TEST_CHECK(entry[1].IsEOB());
        BLEX_TEST_CHECK(entry[1].GetChildBlockId() == 20);

        block.DeleteAt(block.begin() + 1);

        BLEX_TEST_CHECK(Blex::getu32lsb(headersizepos) == 11);
        BLEX_TEST_CHECK(Blex::getu32lsb(datasizepos) == 4);
        BLEX_TEST_CHECK(!entry[0].IsEOB());
        BLEX_TEST_CHECK(entry[0].GetDataLength() == 4);
        BLEX_TEST_CHECK(entry[0].GetData() == dataend - 4);
        BLEX_TEST_CHECK(entry[0].GetRecordId() == 33);
        BLEX_TEST_CHECK(entry[0].GetChildBlockId() == 99);
        BLEX_TEST_CHECK(Blex::getu32lsb(entry[0].GetData()) == 0x04030201);
}

BLEX_TEST_FUNCTION(Btree_BlockTest)
{
/*
        Config config(test_dir,false,false);
        config.current.filesystem.blocklist.clear();
        DBIndexFileSystem filesys(smm,config);  //empty filesys
*/
        using namespace Blex::Index;

        std::vector<uint8_t> mem_blocks(5 * C_Block::Size,0xAA);

        uint8_t *block1ptr = &mem_blocks[0 * C_Block::Size];
        uint8_t *block2ptr = &mem_blocks[1 * C_Block::Size];
        uint8_t *block3ptr = &mem_blocks[2 * C_Block::Size];
        uint8_t *block4ptr = &mem_blocks[3 * C_Block::Size];
        uint8_t *block5ptr = &mem_blocks[4 * C_Block::Size];

        //trap values
        std::fill_n(block1ptr,C_Block::Size,0xBB);
        std::fill_n(block3ptr,C_Block::Size,0xCC);
        std::fill_n(block5ptr,C_Block::Size,0xDD);

        IndexBlock block2(block2ptr);
        IndexBlock block4(block4ptr);
        block2.ConstructEmptyBlock(20);
        block4.ConstructEmptyBlock(40);

        BLEX_TEST_CHECK(block2.begin() == block2.eob());
        BLEX_TEST_CHECK(++block2.begin() == block2.end());
        BLEX_TEST_CHECK(--++block2.begin() == block2.begin());

        IndexBlockEntryContainer str_test;
        str_test.ConstructDataEntry((const uint8_t*)"test",4,10);
        str_test.SetChildBlockID(56);

        IndexBlockEntryContainer null;
        null.ConstructNULLEntry(20);
        null.SetChildBlockID(85);

        IndexBlockEntryContainer int_1;
        uint8_t int_1_val[4]={0};
        int_1.ConstructDataEntry(int_1_val,4,10);
        int_1.SetChildBlockID(93);

        IndexBlockEntryContainer eob;
        eob.ConstructEOBEntry();
        eob.SetChildBlockID(20); // the same as block2 childblockid

        IndexBlockEntryContainer eob4;
        eob4.ConstructEOBEntry();
        eob.SetChildBlockID(40); // the same as block4 childblockid

        block2.InsertAt(block2.begin(), str_test);
        block2.InsertAt(block2.begin(), null);
        block2.InsertAt(block2.begin(), int_1);

        BLEX_TEST_CHECK(block2.FillSize() == eob.GetEntryLength() + int_1.GetEntryLength() + null.GetEntryLength() + str_test.GetEntryLength());

        // BLEX_TEST_CHECK iterator moving
        IndexBlockIterator it = block2.begin();
        IndexBlockIterator it_0 = it;
        IndexBlockIterator it_1 = ++it;
        IndexBlockIterator it_2 = ++it;
        IndexBlockIterator it_3 = ++it;
        IndexBlockIterator it_4 = ++it;
        it = block2.begin();
        it++;BLEX_TEST_CHECK(it_1 == it);
        it++;BLEX_TEST_CHECK(it_2 == it);
        it++;BLEX_TEST_CHECK(it_3 == it);
        it++;BLEX_TEST_CHECK(it_4 == it);
        BLEX_TEST_CHECK(it_4 == block2.end());
        it--;BLEX_TEST_CHECK(it_3 == it);
        it--;BLEX_TEST_CHECK(it_2 == it);
        it--;BLEX_TEST_CHECK(it_1 == it);
        it--;BLEX_TEST_CHECK(it_0 == it);
        BLEX_TEST_CHECK(it_4 == it + 4);
        BLEX_TEST_CHECK(it_4 - 4 == it);
        BLEX_TEST_CHECK(*it_0 == int_1);
        BLEX_TEST_CHECK(*it_1 == null);
        BLEX_TEST_CHECK(*it_2 == str_test);
        BLEX_TEST_CHECK(*it_3 == eob);

        // Testing memdistance and iterator & pos
        BLEX_TEST_CHECK(IndexBlock::ByteSizeOfRange(it_0, it_1) == int_1.GetEntryLength());
        BLEX_TEST_CHECK(IndexBlock::ByteSizeOfRange(it_0, it_2) == int_1.GetEntryLength() + null.GetEntryLength());
        BLEX_TEST_CHECK(IndexBlock::ByteSizeOfRange(it_0, it_3) == int_1.GetEntryLength() + null.GetEntryLength() + str_test.GetEntryLength());
        BLEX_TEST_CHECK(IndexBlock::ByteSizeOfRange(it_0, it_4) == int_1.GetEntryLength() + null.GetEntryLength() + str_test.GetEntryLength() + eob.GetEntryLength());

        for (unsigned pos = 0; pos <= block2.FillSize(); ++pos) // includes limit, we want to see behaviour at end() also.
        {
                IndexBlockIterator itp = block2.IteratorAtPos(pos);
                BLEX_TEST_CHECK(IndexBlock::ByteSizeOfRange(it_0, itp) <= pos);
                BLEX_TEST_CHECK(itp < block2.eob());
                if (it_0 != itp)
                    BLEX_TEST_CHECK(IndexBlock::ByteSizeOfRange(it_0, itp) + itp->GetEntryLength() > pos || pos >= IndexBlock::ByteSizeOfRange(it_0, block2.eob()));
        }

        // Testing range copy
        block4.InsertRange(block4.begin(), it_0, it_3);
        BLEX_TEST_CHECK(*(block4.begin()+0) == int_1);
        BLEX_TEST_CHECK(*(block4.begin()+1) == null);
        BLEX_TEST_CHECK(*(block4.begin()+2) == str_test);
        BLEX_TEST_CHECK(*(block4.begin()+3) == eob4);
        BLEX_TEST_CHECK(block4.begin()+4 == block4.end());
        BLEX_TEST_CHECK(block4.FillSize() == eob4.GetEntryLength() + int_1.GetEntryLength() + null.GetEntryLength() + str_test.GetEntryLength());

        // testing delete
        block2.DeleteAt(it_1); // deletes null
        BLEX_TEST_CHECK(block2.FillSize() == eob.GetEntryLength() + int_1.GetEntryLength() + str_test.GetEntryLength());
        it_2 = it_1 + 1;
        it_3 = it_2 + 1;

        BLEX_TEST_CHECK(*it_0 == int_1);
        BLEX_TEST_CHECK(*it_1 == str_test);
        BLEX_TEST_CHECK(*it_2 == eob);
        BLEX_TEST_CHECK(it_3 == block2.end());

        // testing insertatwithid
        block2.InsertAtWithID(it_1, null, 99);
        null.SetChildBlockID(99);
        BLEX_TEST_CHECK(block2.FillSize() == eob.GetEntryLength() + int_1.GetEntryLength() + null.GetEntryLength() + str_test.GetEntryLength());
        it_2 = it_1 + 1;
        it_3 = it_2 + 1;
        it_4 = it_3 + 1;
        BLEX_TEST_CHECK(*it_0 == int_1);
        BLEX_TEST_CHECK(*it_1 == null);
        BLEX_TEST_CHECK(*it_2 == str_test);
        BLEX_TEST_CHECK(*it_3 == eob);
        BLEX_TEST_CHECK(it_4 == block2.end());

        // Testing deleterange
        block2.DeleteRange(it_1, it_3);
        BLEX_TEST_CHECK(block2.FillSize() == eob.GetEntryLength() + int_1.GetEntryLength());
        it_2 = it_1 + 1;
        BLEX_TEST_CHECK(*it_0 == int_1);
        BLEX_TEST_CHECK(*it_1 == eob);
        BLEX_TEST_CHECK(it_2 == block2.end());

        // Testing insertpossible
         // fill until C_Block::MaxData - 20
        while (block2.FillSize() != C_Block::MaxData - 22)
        {
                unsigned todo = C_Block::MaxData - block2.FillSize();
                unsigned size = (todo > 84) ? 55 : (todo - 22);
                IndexBlockEntryContainer thing;thing.ConstructDataEntry((const uint8_t*)&std::string('t', 64)[0],size-11,20);
                block2.InsertAt(block2.begin(), thing);
        }
        // We now have 22 of space left in the block (so we can max insert an entry with 10 bytes of data
        IndexBlockEntryContainer thing;
        thing.ConstructDataEntry((const uint8_t*)&std::string('t', 64)[0],10,20);
        BLEX_TEST_CHECK(block2.InsertPossible(thing));
        thing.ConstructDataEntry((const uint8_t*)&std::string('t', 64)[0],11,20);
        BLEX_TEST_CHECK(block2.InsertPossible(thing));
        thing.ConstructDataEntry((const uint8_t*)&std::string('t', 64)[0],12,20);
        BLEX_TEST_CHECK(!block2.InsertPossible(thing));

        // Fill block to the limit
        thing.ConstructDataEntry((const uint8_t*)&std::string('t', 64)[0],11,20);
        block2.InsertAt(block2.eob(), thing);

        // existingblock test
        IndexBlock block2_c(&mem_blocks[1 * C_Block::Size]);

        BLEX_TEST_CHECK(std::distance(block2_c.begin(), block2_c.end()) == std::distance(block2.begin(),block2.end()));
        BLEX_TEST_CHECK(std::equal(block2_c.begin(), block2_c.end(),block2.begin()));

        // Additional test for equalness
        block4.DeleteRange(block4.begin(), block4.end());
        block4.InsertRange(block4.begin(), block2.begin(), block2.end());
        BLEX_TEST_CHECK(std::distance(block2.begin(), block2.end()) == std::distance(block4.begin(),block4.end()));
        BLEX_TEST_CHECK(std::equal(block2.begin(), block2.end(),block4.begin()));

        // BLEX_TEST_CHECK if bounds were not violated
        BLEX_TEST_CHECK(std::search_n(block1ptr, block1ptr+C_Block::Size, C_Block::Size, 0xBB) == block1ptr);
        BLEX_TEST_CHECK(std::search_n(block3ptr, block3ptr+C_Block::Size, C_Block::Size, 0xCC) == block3ptr);
        BLEX_TEST_CHECK(std::search_n(block5ptr, block5ptr+C_Block::Size, C_Block::Size, 0xDD) == block5ptr);
}

