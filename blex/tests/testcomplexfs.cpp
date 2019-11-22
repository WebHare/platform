//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../context.h"
#include "../complexfs.h"
#include "../path.h"

// FIXME: also test other caching modes

using namespace Blex;

BLEX_TEST_FUNCTION(TestFreeRanges)
{
        CFS_FreeRanges fr;
        fr.FreeRange(CFS_Range(0, 100));
        CFS_Range r1 = fr.AllocateRange(30, 16);
        BLEX_TEST_CHECK(r1 == CFS_Range(0, 30));

        CFS_Range r2 = fr.AllocateRange(10, 10);
        BLEX_TEST_CHECK(r2 == CFS_Range(30, 10));

        CFS_Range r3 = fr.AllocateRange(10, 10);
        BLEX_TEST_CHECK(r3 == CFS_Range(40, 10));

        fr.FreeRange(r2);

        CFS_Range r4 = fr.AllocateRange(15, 15, 30);
        BLEX_TEST_CHECK(r4 == CFS_Range(50, 15));

        CFS_Range r5 = fr.AllocateRange(15, 10, 30);
        BLEX_TEST_CHECK(r5 == CFS_Range(30, 10));

        fr.FreeRange(r5);

        CFS_Range r6 = fr.AllocateRange(7, 7);
        BLEX_TEST_CHECK(r6 == CFS_Range(30, 7));

        CFS_Range r7 = fr.AllocateRange(1, 1);
        BLEX_TEST_CHECK(r7 == CFS_Range(37, 1));

        CFS_Range r8 = fr.AllocateRange(4, 2);
        BLEX_TEST_CHECK(r8 == CFS_Range(65, 4));

        CFS_Range r9 = fr.AllocateRange(2, 2);
        BLEX_TEST_CHECK(r9 == CFS_Range(38, 2));

        CFS_Range r10 = fr.AllocateRange(35, 35);
        BLEX_TEST_CHECK(r10 == CFS_Range(0, 0));

        CFS_Range r11 = fr.AllocateRange(35, 30);
        BLEX_TEST_CHECK(r11 == CFS_Range(69, 31));
}

std::vector< CFS_Range > freed_ranges;
void AddFreedRange(CFS_Range const &range) { freed_ranges.push_back(range); }

BLEX_TEST_FUNCTION(TestFileBlocks)
{
        CFS_FileBlocks fb;
        BLEX_TEST_CHECK(fb.GetBlockCount() == 0);

        fb.AddRange(CFS_Range(4, 2));
        BLEX_TEST_CHECK(fb.GetBlockCount() == 2);
        BLEX_TEST_CHECK(fb.GetRangeCount() == 1);
        BLEX_TEST_CHECK(fb.GetBlockCount() == 2);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(0) == 4);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(1) == 5);
        BLEX_TEST_CHECK(fb.GetAppendHint() == 6);

        fb.AddRange(CFS_Range(8, 3));
        BLEX_TEST_CHECK(fb.GetBlockCount() == 5);
        BLEX_TEST_CHECK(fb.GetRangeCount() == 2);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(0) == 4);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(1) == 5);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(2) == 8);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(4) == 10);
        BLEX_TEST_CHECK(fb.GetAppendHint() == 11);

        fb.StripBlocks(1, &AddFreedRange);
        BLEX_TEST_CHECK(fb.GetBlockCount() == 4);
        BLEX_TEST_CHECK(fb.GetRangeCount() == 2);
        BLEX_TEST_CHECK(freed_ranges.size() == 1);
        BLEX_TEST_CHECK(freed_ranges[0] == CFS_Range(10, 1));
        BLEX_TEST_CHECK(fb.GetBlockCount() == 4);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(0) == 4);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(1) == 5);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(2) == 8);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(3) == 9);
        BLEX_TEST_CHECK(fb.GetAppendHint() == 10);

        fb.AddRange(CFS_Range(10, 1));
        BLEX_TEST_CHECK(fb.GetBlockCount() == 5);
        BLEX_TEST_CHECK(fb.GetRangeCount() == 2);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(0) == 4);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(1) == 5);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(2) == 8);
        BLEX_TEST_CHECK(fb.GetDiskBlockId(4) == 10);
        BLEX_TEST_CHECK(fb.GetAppendHint() == 11);

        freed_ranges.clear();
        fb.StripBlocks(5, &AddFreedRange);
        BLEX_TEST_CHECK(fb.GetBlockCount() == 0);
        BLEX_TEST_CHECK(fb.GetRangeCount() == 0);
        BLEX_TEST_CHECK(freed_ranges.size() == 2);
        BLEX_TEST_CHECK(freed_ranges[0] == CFS_Range(8, 3));
        BLEX_TEST_CHECK(freed_ranges[1] == CFS_Range(4, 2));
        BLEX_TEST_CHECK(fb.GetAppendHint() == 0);
}

BLEX_TEST_FUNCTION(TestComplexFS)
{
        ComplexFileSystem fs;

        std::unique_ptr< ComplexFileStream > str;
        str.reset(fs.OpenFile("test.dat", true, true));
        BLEX_TEST_CHECK(str.get() != 0);

        std::string data("DAMN SHIT THAT'S WHACK");
        std::string copy;
        unsigned written = str->DirectWrite(0, &*data.begin(), data.size());
        BLEX_TEST_CHECK(written == data.size());

        BLEX_TEST_CHECK(str->GetFileLength() == data.size());

        copy.resize(data.size());
        unsigned read = str->DirectRead(0, &*copy.begin(), data.size());
        BLEX_TEST_CHECK(read == data.size());
        BLEX_TEST_CHECK(data == copy);
}

//******************************************************************************
// Tests copied from simplefs
//

//Parts which does read/writes
void RunComplexFsTest_ReadWritePart(Blex::ComplexFileSystem &simplefs)
{
        for (unsigned i=0;i<30;++i)
        {
                std::string name = Blex::AnyToString(i)+".txt";
                std::string input = "Dit is file nummer " + Blex::AnyToString(i)
                                  + ". Lorup ipsum etc tot in de oneindigheid omdat we minimaal 128 bytes"
                                  + "met onzin willen vullen in het kader van deze vrijwel nutteloze test"
                                  + ". Lorup ipsum etc tot in de oneindigheid omdat we minimaal 128 bytes"
                                  + "met onzin willen vullen in het kader van deze vrijwel nutteloze test";

                std::unique_ptr<Blex::ComplexFileStream> newfile;
                newfile.reset(simplefs.OpenFile(name,true,true));
                BLEX_TEST_CHECK(newfile.get());
                BLEX_TEST_CHECK(newfile->WriteLsb(input));
                BLEX_TEST_CHECK(newfile->WriteLsb(input));
        }
}

//Parts which does reads only (should be re-runnable after a readwrite test to test close/open of a simplefs)
void RunComplexFsTest_ReadPart(Blex::ComplexFileSystem &simplefs)
{
        for (unsigned i=0;i<30;++i)
        {
                std::string name = Blex::AnyToString(i)+".txt";
                std::string input = "Dit is file nummer " + Blex::AnyToString(i)
                                  + ". Lorup ipsum etc tot in de oneindigheid omdat we minimaal 128 bytes"
                                  + "met onzin willen vullen in het kader van deze vrijwel nutteloze test"
                                  + ". Lorup ipsum etc tot in de oneindigheid omdat we minimaal 128 bytes"
                                  + "met onzin willen vullen in het kader van deze vrijwel nutteloze test";

                std::unique_ptr<Blex::ComplexFileStream> newfile;
                newfile.reset(simplefs.OpenFile(name,false,false));
                BLEX_TEST_CHECK(newfile.get());

                std::string reread_text;
                BLEX_TEST_CHECK(newfile->ReadLsb(&reread_text));
                BLEX_TEST_CHECKEQUAL(input, reread_text);

                std::unique_ptr<Blex::ComplexFileStream> newfile2;
                newfile2.reset(newfile->CloneStream());
                BLEX_TEST_CHECK(newfile2.get());

                BLEX_TEST_CHECK(newfile->ReadLsb(&reread_text));
                BLEX_TEST_CHECKEQUAL(input, reread_text);
                BLEX_TEST_CHECK(newfile2->ReadLsb(&reread_text));
                BLEX_TEST_CHECKEQUAL(input, reread_text);

                //Verify EOF
                uint8_t testbyte;
                BLEX_TEST_CHECK(!newfile->ReadLsb<uint8_t>(&testbyte));
                BLEX_TEST_CHECK(!newfile2->ReadLsb<uint8_t>(&testbyte));
        }
}

BLEX_TEST_FUNCTION(TestComplexFS_Plain)
{
        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-1");
        {
                Blex::ComplexFileSystem complexfs;
                RunComplexFsTest_ReadWritePart(complexfs);
                RunComplexFsTest_ReadPart(complexfs);
        }
        {
                Blex::ComplexFileSystem complexfs(basefile, true, ComplexFileSystem::WriteThrough);
                RunComplexFsTest_ReadWritePart(complexfs);
                RunComplexFsTest_ReadPart(complexfs);
        }
}

BLEX_TEST_FUNCTION(TestComplexFS_BasicReopen)
{
        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-2");
        {
                Blex::ComplexFileSystem complexfs(basefile, true, ComplexFileSystem::WriteThrough);

                std::unique_ptr<Blex::ComplexFileStream> newfile;

                newfile.reset(complexfs.OpenFile("test",true,true));
                BLEX_TEST_CHECK(newfile.get());

                BLEX_TEST_CHECK(newfile->WriteLsb(uint32_t(17)));

                newfile.reset();
                newfile.reset(complexfs.OpenFile("test",true,true));
                BLEX_TEST_CHECK(!newfile.get());

                newfile.reset(complexfs.OpenFile("test",false,false));
                BLEX_TEST_CHECK(newfile.get());

                uint32_t value;
                BLEX_TEST_CHECK(newfile->ReadLsb(&value));
                BLEX_TEST_CHECKEQUAL(17, value);

                newfile.reset();
        }
        {
                Blex::ComplexFileSystem complexfs(basefile, false, Blex::ComplexFileSystem::WriteThrough);

                std::unique_ptr<Blex::ComplexFileStream> newfile;

                newfile.reset(complexfs.OpenFile("test",true,true));
                BLEX_TEST_CHECK(!newfile.get());

                newfile.reset(complexfs.OpenFile("test",false,false));
                BLEX_TEST_CHECK(newfile.get());

                uint32_t value;
                BLEX_TEST_CHECK(newfile->ReadLsb(&value));
                BLEX_TEST_CHECKEQUAL(17, value);

                newfile.reset();
        }
}

BLEX_TEST_FUNCTION(TestComplexFS_HeavyReopen)
{
        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-3");
        DateTime newmodtime = DateTime::Now() + DateTime::Days(253);
        {
                Blex::ComplexFileSystem complexfs(basefile, true, Blex::ComplexFileSystem::WriteThrough);

                std::unique_ptr<Blex::ComplexFileStream> newfile;

                newfile.reset(complexfs.OpenFile("test",true,true));
                BLEX_TEST_CHECK(newfile.get());
                newfile.reset();

                complexfs.DeletePath("test");
                newfile.reset(complexfs.OpenFile("test",false,false));
                BLEX_TEST_CHECK(!newfile.get());
                newfile.reset(complexfs.OpenFile("test",true,true));
                BLEX_TEST_CHECK(newfile.get());

                complexfs.TouchFile("test", newmodtime);

                newfile->SetFileLength(1000000);
                newfile->SetFileLength(10);
                newfile->SetFileLength(1000000);
                newfile->SetFileLength(10);
                newfile->SetFileLength(1000000);
                newfile->SetFileLength(10);
                newfile->SetOffset(99999);
                BLEX_TEST_CHECK(newfile->WriteLsb(uint32_t(17)));

                std::vector<std::string> list;
                list = complexfs.ListDirectory("test");
                BLEX_TEST_CHECKEQUAL(1, list.size());
                BLEX_TEST_CHECKEQUAL("test", list[0]);
                list = complexfs.ListDirectory("tes*");
                BLEX_TEST_CHECKEQUAL(1, list.size());
                BLEX_TEST_CHECKEQUAL("test", list[0]);
                list = complexfs.ListDirectory("tet*");
                BLEX_TEST_CHECKEQUAL(0, list.size());

                newfile.reset();
                complexfs.MovePath("test", "newname");
                newfile.reset(complexfs.OpenFile("test",false,false));
                BLEX_TEST_CHECK(!newfile.get());
                newfile.reset(complexfs.OpenFile("newname",false,false));
                BLEX_TEST_CHECK(newfile.get());
                newfile.reset();

                list = complexfs.ListDirectory("t*");
                BLEX_TEST_CHECKEQUAL(0, list.size());
                list = complexfs.ListDirectory("n*");
                BLEX_TEST_CHECKEQUAL(1, list.size());
                BLEX_TEST_CHECKEQUAL("newname", list[0]);
                list = complexfs.ListDirectory("newname");
                BLEX_TEST_CHECKEQUAL(1, list.size());
                BLEX_TEST_CHECKEQUAL("newname", list[0]);
        }
        {
                Blex::ComplexFileSystem complexfs(basefile, false, Blex::ComplexFileSystem::WriteThrough);

                std::unique_ptr<Blex::ComplexFileStream> newfile;

                newfile.reset(complexfs.OpenFile("test",false,false));
                BLEX_TEST_CHECK(!newfile.get());

                newfile.reset(complexfs.OpenFile("newname",false,false));
                BLEX_TEST_CHECK(newfile.get());

                BLEX_TEST_CHECKEQUAL(unsigned(99999 + 4), newfile->GetFileLength());
                newfile->SetOffset(99999);
                uint32_t val;
                BLEX_TEST_CHECK(newfile->ReadLsb(&val));
                BLEX_TEST_CHECKEQUAL(17, val);

                BLEX_TEST_CHECKEQUAL(newfile->GetModTime(), newmodtime);

                std::vector< std::string > list;
                list = complexfs.ListDirectory("t*");
                BLEX_TEST_CHECKEQUAL(0, list.size());
                list = complexfs.ListDirectory("n*");
                BLEX_TEST_CHECKEQUAL(1, list.size());
                BLEX_TEST_CHECKEQUAL("newname", list[0]);
                list = complexfs.ListDirectory("newname");
                BLEX_TEST_CHECKEQUAL(1, list.size());
                BLEX_TEST_CHECKEQUAL("newname", list[0]);
        }
}

BLEX_TEST_FUNCTION(TestComplexFS_PathManip)
{
        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-4");
        {
        Blex::ComplexFileSystem complexfs(basefile, true, Blex::ComplexFileSystem::WriteThrough);

        DateTime now = DateTime::Now();

        BLEX_TEST_CHECKEQUAL(DateTime::Invalid(), complexfs.GetLastModTime("test"));

        std::unique_ptr<Blex::ComplexFileStream> newfile;
        newfile.reset(complexfs.OpenFile("test",true,true));
        complexfs.TouchFile("test", now + DateTime::Days(1));

        BLEX_TEST_CHECKEQUAL(now + DateTime::Days(1), complexfs.GetLastModTime("test"));
        BLEX_TEST_CHECKEQUAL(true, complexfs.Exists("test"));
        BLEX_TEST_CHECKEQUAL(false, complexfs.Exists("test2"));

        newfile.reset(complexfs.OpenFile("test2",true,true));
        complexfs.TouchFile("test2", now + DateTime::Days(2));
        BLEX_TEST_CHECKEQUAL(true, complexfs.Exists("test2"));
        BLEX_TEST_CHECKEQUAL(now + DateTime::Days(2), complexfs.GetLastModTime("test2"));

        BLEX_TEST_CHECK(!complexfs.DeletePath("test3"));
        BLEX_TEST_CHECK(complexfs.DeletePath("test2"));
        BLEX_TEST_CHECKEQUAL(false, complexfs.Exists("test2"));

        newfile.reset(complexfs.OpenFile("test2",true,true));
        complexfs.TouchFile("test2", now + DateTime::Days(2));
        BLEX_TEST_CHECKEQUAL(true, complexfs.Exists("test2"));
        BLEX_TEST_CHECKEQUAL(now + DateTime::Days(2), complexfs.GetLastModTime("test2"));

        complexfs.MovePath("test2", "test");
        BLEX_TEST_CHECKEQUAL(now + DateTime::Days(2), complexfs.GetLastModTime("test"));
        BLEX_TEST_CHECKEQUAL(true, complexfs.Exists("test"));
        BLEX_TEST_CHECKEQUAL(false, complexfs.Exists("test2"));
        }
        Blex::ComplexFileSystem complexfs(basefile, false, Blex::ComplexFileSystem::WriteThrough);
}

BLEX_TEST_FUNCTION(TestComplexFS_FileLookup)
{
        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-5");
        {
        Blex::ComplexFileSystem complexfs(basefile, true, Blex::ComplexFileSystem::WriteThrough);

        std::unique_ptr<Blex::ComplexFileStream> newfile;
        for (unsigned i = 0; i < 13; ++i)
        {
                newfile.reset(complexfs.OpenFile("test"+Blex::AnyToString((i*4) % 13),true,true));
                BLEX_TEST_CHECK(newfile.get());
        }
        for (unsigned i = 13; i < 17; ++i)
        {
                newfile.reset(complexfs.OpenFile("test"+Blex::AnyToString(i),true,true));
                BLEX_TEST_CHECK(newfile.get());
        }
        for (unsigned i = 0; i < 17; ++i)
        {
                newfile.reset(complexfs.OpenFile("test"+Blex::AnyToString((i*5) % 13),false,false));
                BLEX_TEST_CHECK(newfile.get());
        }
        }
}

BLEX_TEST_FUNCTION(TestComplexFS_ModifyAfterDelete)
{
        char buf[4] = { 'T', 'E', 'S', 'T' };
        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-6");
        {
        Blex::ComplexFileSystem complexfs(basefile, true, Blex::ComplexFileSystem::WriteThrough);

        DateTime now = DateTime::Now();
        DateTime newmodtime1 = now + DateTime::Days(1);
//        DateTime newmodtime2 = now + DateTime::Days(2);

        // Open a new file
        std::unique_ptr<Blex::ComplexFileStream> newfile;
        newfile.reset(complexfs.OpenFile("test",true,true));

        complexfs.TouchFile("test", newmodtime1);

        //Remove it
        BLEX_TEST_CHECK(complexfs.DeletePath("test"));

        //complexfs direct
        BLEX_TEST_CHECK(!complexfs.Exists("test"));
        BLEX_TEST_CHECK(!complexfs.DeletePath("test"));
//        complexfs.TouchFile("test", newmodtime2);

        std::unique_ptr< CFS_SectionBase > cache;

        //file direct
        char buf2[4];
        BLEX_TEST_CHECK(newfile->GetFileLength() == 0);
        BLEX_TEST_CHECK(newfile->RawDirectWrite(0, buf, 4) == 4);
        BLEX_TEST_CHECK(newfile->SetFileLength(100000));
        BLEX_TEST_CHECK(newfile->SetFileLength(0));
        BLEX_TEST_CHECK(newfile->RawDirectWrite(100000, buf, 4) == 4);
        BLEX_TEST_CHECK(newfile->GetFileLength() == 100000 + 4);
        BLEX_TEST_CHECK(newfile->GetModTime() == newmodtime1);
        BLEX_TEST_CHECK(newfile->RawDirectRead(100000, buf2, 4) == 4);
        BLEX_TEST_CHECK(memcmp(buf, buf2, 4) == 0);
        }

        //Reopen
        {
        Blex::ComplexFileSystem complexfs(basefile, false, Blex::ComplexFileSystem::WriteThrough);
        BLEX_TEST_CHECK(!complexfs.Exists("test"));
        }
}

BLEX_TEST_FUNCTION(TestComplexFS_OverwritesPastEnd)
{
        // Bug was present when overwriting just before end of end to past end of file
        // FileOffset overflow (it is unsigned...) caused a very large number of zeros to be written, the first
        // fix appended that content at the end, instead of at the specified offset (without allocating enough room)

        std::string basefile = Blex::MergePath(Blex::Test::GetTempDir(),"complexfs-7");
        Blex::ComplexFileSystem complexfs(basefile, true, Blex::ComplexFileSystem::WriteThrough);

        unsigned char write_buffer[4000];
        unsigned char read_buffer[5000];
        for (unsigned i = 0; i < 4000; ++i)
            write_buffer[i] = i % 256;

        std::unique_ptr<Blex::ComplexFileStream> newfile;
        newfile.reset(complexfs.OpenFile("test",true,true));

        newfile->Write(write_buffer, 3500);
        newfile->SetOffset(500);
        newfile->Write(write_buffer, 4000);
        newfile->SetOffset(0);
        BLEX_TEST_CHECKEQUAL(4500, newfile->Read(read_buffer, 4500));

        BLEX_TEST_CHECKEQUAL(499 % 256, read_buffer[499]);
        BLEX_TEST_CHECKEQUAL(0, read_buffer[500]);
}
