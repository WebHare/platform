//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../socket.h"
#include "../pipestream.h"
#include "../mmapfile.h"
#include "../zstream.h"
#include "../threads.h"
#include "../path.h"
#include <set>

extern std::string self_app;


BLEX_TEST_FUNCTION(TestFileStream)
{
        std::unique_ptr<Blex::FileStream> filestr;
        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"filestreamtest"));

        //Make sure we don't "auto-create" non-existing files
        filestr.reset(Blex::FileStream::OpenWrite(filename,false,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() == NULL);

        //Create the real file
        filestr.reset(Blex::FileStream::OpenWrite(filename,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() != NULL);
        filestr.reset();

        //Make sure reopening the files in 'create' 'exclusive' mode fails
        filestr.reset(Blex::FileStream::OpenWrite(filename,true,true,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() == NULL);
        filestr.reset();

        //Reopen the existing file
        filestr.reset(Blex::FileStream::OpenRW(filename,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() != NULL);

        //Make sure its still 0 bytes long
        BLEX_TEST_CHECKEQUAL(0u, filestr->GetFileLength());
        BLEX_TEST_CHECKEQUAL(0u, filestr->GetOffset());
        BLEX_TEST_CHECKEQUAL(0u, filestr->GetStatus().FileLength());

        // Set offset beyond eof
        BLEX_TEST_CHECK(filestr->SetOffset(55));
        BLEX_TEST_CHECKEQUAL(55u, filestr->GetOffset());
        BLEX_TEST_CHECK(filestr->SetOffset(0));

        //Resize it to be 100 bytes
        BLEX_TEST_CHECK(filestr->SetFileLength(100));
        BLEX_TEST_CHECKEQUAL(100u,filestr->GetFileLength());
        BLEX_TEST_CHECKEQUAL(100u,filestr->GetStatus().FileLength());
        BLEX_TEST_CHECKEQUAL(0u, filestr->GetOffset());

        //Write a byte at this location
        BLEX_TEST_CHECKEQUAL(1, filestr->WriteLsb<uint8_t>(234));
        BLEX_TEST_CHECKEQUAL(1u, filestr->GetOffset());
        BLEX_TEST_CHECKEQUAL(100u,filestr->GetFileLength());

        //Ensure the byte IS at the proper location
        BLEX_TEST_CHECK(filestr->SetOffset(0));
        BLEX_TEST_CHECKEQUAL(234, filestr->ReadLsb<uint8_t>());
        BLEX_TEST_CHECKEQUAL(0, filestr->ReadLsb<uint8_t>());
        BLEX_TEST_CHECKEQUAL(2u, filestr->GetOffset());

        //Resize the file to be 60 bytes and check if the FP is correctly left untouched
        BLEX_TEST_CHECK(filestr->SetOffset(75));
        BLEX_TEST_CHECKEQUAL(75u, filestr->GetOffset());
        BLEX_TEST_CHECK(filestr->SetFileLength(60));
        BLEX_TEST_CHECKEQUAL(60u, filestr->GetFileLength());
        BLEX_TEST_CHECKEQUAL(60u, filestr->GetStatus().FileLength());
        BLEX_TEST_CHECKEQUAL(75u, filestr->GetOffset());

        //Resize the file to be 50 bytes and check if the FP is correctly left untouched
        BLEX_TEST_CHECK(filestr->SetOffset(2));
        BLEX_TEST_CHECK(filestr->SetFileLength(50));
        BLEX_TEST_CHECKEQUAL(50u,filestr->GetFileLength());
        BLEX_TEST_CHECKEQUAL(50u,filestr->GetStatus().FileLength());
        BLEX_TEST_CHECKEQUAL(2u, filestr->GetOffset());

        //Make sure the location really still 'was' 2
        BLEX_TEST_CHECKEQUAL(1, filestr->WriteLsb<uint8_t>(212));
        BLEX_TEST_CHECKEQUAL(3u, filestr->GetOffset());
        BLEX_TEST_CHECK(filestr->SetOffset(0));
        BLEX_TEST_CHECKEQUAL(234, filestr->ReadLsb<uint8_t>());
        BLEX_TEST_CHECKEQUAL(0, filestr->ReadLsb<uint8_t>());
        BLEX_TEST_CHECKEQUAL(212, filestr->ReadLsb<uint8_t>());
        BLEX_TEST_CHECKEQUAL(3u, filestr->GetOffset());

        //And make sure that all stays okay after closing the file
        filestr.reset();
        BLEX_TEST_CHECKEQUAL(50u, Blex::PathStatus(filename).FileLength());
}

BLEX_TEST_FUNCTION(TestMemoryRWStream)
{
        Blex::MemoryRWStream str;

        BLEX_TEST_CHECK(str.GetFileLength() == 0);
        str.SetFileLength(5);
        BLEX_TEST_CHECK(str.GetFileLength() == 5);

        uint8_t testd[10];
        testd[0] = 8;
        testd[1] = 9;

        str.DirectWrite(1, testd, 2);
        str.DirectRead(0, testd, 4);

        BLEX_TEST_CHECK(testd[0] == 0 && testd[1] == 8 && testd[2] == 9 && testd[3] == 0);

        testd[0] = 10;
        testd[1] = 11;
        str.DirectWrite(4, testd, 2);

        BLEX_TEST_CHECK(str.GetFileLength() == 6);

        std::size_t read_len = str.DirectRead(0, testd, 7);

        BLEX_TEST_CHECKEQUAL(6,read_len);
        BLEX_TEST_CHECK(testd[0] == 0 && testd[1] == 8 && testd[2] == 9 && testd[3] == 0 && testd[4] == 10 && testd[5] == 11);

        str.SetFileLength(0);
        BLEX_TEST_CHECKEQUAL(0u,str.GetFileLength());

        str.SetFileLength(6);
        BLEX_TEST_CHECKEQUAL(6u,str.GetFileLength());

        read_len = str.DirectRead(0, testd, 7);

        BLEX_TEST_CHECKEQUAL(6,read_len);
        BLEX_TEST_CHECK(testd[0] == 0 && testd[1] == 0 && testd[2] == 0 && testd[3] == 0 && testd[4] == 0 && testd[5] == 0);

        str.SetOffset(4);
        str.WriteLsb<uint32_t>(1);
        str.WriteLsb<uint32_t>(2);

        BLEX_TEST_CHECKEQUAL(12u,str.GetFileLength());
        BLEX_TEST_CHECKEQUAL(12u,str.GetOffset());

        str.SetOffset(16);
        BLEX_TEST_CHECKEQUAL(16u,str.GetOffset());

        str.WriteLsb<uint32_t>(3);
        BLEX_TEST_CHECKEQUAL(20u,str.GetFileLength());
        BLEX_TEST_CHECKEQUAL(20u,str.GetOffset());
}

BLEX_TEST_FUNCTION(TestFileModDate)
{
        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"modtimetest"));
        delete Blex::FileStream::OpenWrite(filename,true,false,Blex::FilePermissions::PublicRead);

        Blex::DateTime toset;
        toset = Blex::DateTime::Now() - Blex::DateTime::Minutes(25);
        //Round down so the filesystem can actually record this modtime (FAT precision is 2sec)
        toset = Blex::DateTime(toset.GetDays(), (toset.GetMsecs() / 2000) * 2000);

        BLEX_TEST_CHECKEQUAL(true, SetFileModificationDate(filename, toset));
        BLEX_TEST_CHECKEQUAL(toset, Blex::PathStatus(filename).ModTime());

        toset = Blex::DateTime::Now() + Blex::DateTime::Minutes(25);
        //Round down so the filesystem can actually record this modtime (FAT precision is 2sec)
        toset = Blex::DateTime(toset.GetDays(), (toset.GetMsecs() / 2000) * 2000);

        SetFileModificationDate(filename, toset);
        BLEX_TEST_CHECKEQUAL(toset, Blex::PathStatus(filename).ModTime());
}

#if !defined(__EMSCRIPTEN__)

BLEX_TEST_FUNCTION(TestMmap)
{
        static const char test_string[]={"This is a test!"};

        std::unique_ptr<Blex::MmapFile> mmapfile;
        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"mmaptest"));

        /* create the file first */
        mmapfile.reset(Blex::MmapFile::OpenRW(filename, true, false, Blex::FilePermissions::PublicRead, false, false, true));
        BLEX_TEST_CHECK(mmapfile.get());
        BLEX_TEST_CHECKEQUAL(0u,mmapfile->GetFilelength());

        /* map in 64KB */
        BLEX_TEST_CHECK(mmapfile->ExtendTo(64*1024));
        void *block64 = mmapfile->MapRW(0,64*1024);
        BLEX_TEST_CHECK(block64);
        memcpy(block64,test_string,sizeof (test_string));
        BLEX_TEST_CHECKEQUAL(64*1024u,mmapfile->GetFilelength());

        /* now extend the file another 64 KB*/
        BLEX_TEST_CHECK(mmapfile->ExtendTo(128*1024));
        void *block64_2nd = mmapfile->MapRW(64*1024,64*1024);
        BLEX_TEST_CHECK(block64_2nd);
        BLEX_TEST_CHECKEQUAL(0, *(char*)block64_2nd);
        memcpy((char*)block64_2nd+1,test_string,sizeof(test_string));
        BLEX_TEST_CHECKEQUAL(128*1024u,mmapfile->GetFilelength());

        /* unmap the 64KB, close the file, reopen it readonly, and remap ! */
        mmapfile->Unmap(block64, 64*1024);
        mmapfile->Unmap(block64_2nd, 64*1024);
        mmapfile.reset();
        mmapfile.reset(Blex::MmapFile::OpenRO(filename, false));
        BLEX_TEST_CHECK(mmapfile.get());
        void const *ro_block64 = mmapfile->MapRO(0,64*1024);
        BLEX_TEST_CHECK(ro_block64);
        BLEX_TEST_CHECKEQUAL(0,memcmp(ro_block64,test_string,sizeof (test_string)));
        mmapfile->Unmap(ro_block64,64*1024);

        void const *ro_block64_2nd = mmapfile->MapRO(64*1024,64*1024);
        BLEX_TEST_CHECK(ro_block64_2nd);
        BLEX_TEST_CHECKEQUAL(0, *static_cast<const char*>(ro_block64_2nd));
        BLEX_TEST_CHECKEQUAL(0,memcmp(static_cast<const char*>(ro_block64_2nd)+1,test_string,sizeof (test_string)));
        mmapfile->Unmap(ro_block64_2nd,64*1024);

        //Test whether we can stat the mmap file (used to fail because of too wide permissions requested)
        BLEX_TEST_CHECK(Blex::PathStatus(filename).IsFile());

        /* Check UpdateTimeStamp */
        mmapfile.reset();

        mmapfile.reset(Blex::MmapFile::OpenRW(filename, true, false, Blex::FilePermissions::PublicRead, false, false, true));
        Blex::DateTime old_stamp = Blex::DateTime::Now() - Blex::DateTime::Seconds(4);
        BLEX_TEST_CHECK(mmapfile->SetModificationDate(old_stamp));

        Blex::DateTime now = Blex::DateTime::Now() ;
        now = now - Blex::DateTime::Msecs(now.GetMsecs()%1000); //round down because filesystem often isn't msec precise

        BLEX_TEST_CHECK(Blex::PathStatus(filename).ModTime() < now);
        BLEX_TEST_CHECK(mmapfile->SetModificationDate(now));
        BLEX_TEST_CHECK(Blex::PathStatus(filename).ModTime() >= now);
}

//FIXME actually remove blex mmap support from emscripten - it's unreliable!
#endif
