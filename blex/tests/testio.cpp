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
#include "../parityfile.h"
#include "../threads.h"
#include "../path.h"
#include <set>

extern std::string self_app;

std::vector<std::string> parityfile_error_list;
void OnError(std::string const &errormsg)
{
        parityfile_error_list.push_back(errormsg);
}


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

        //Test whether auto-delete temp files really auto-delete
        filestr.reset(Blex::FileStream::OpenWriteTemp(Blex::MergePath(Blex::Test::GetTempDir(),"filestreamtest"),Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() != NULL);

        //ADDME: SCan the temp dir to see hwether the file is gone
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

BLEX_TEST_FUNCTION(TestParityFile)
{
        unsigned sectorsize = 177;
        unsigned sectorsperblock = 3;
        unsigned datablockspersegment = 3;
        unsigned parityblockspersegment = 1;

        parityfile_error_list.clear();
        char parityteststring[] = {"The quick brown fox jumped over the lazy red dog. 1234567890. Parity all the way! This is not a drill. I'm so wonewy!"};

        std::string parityname = Blex::MergePath(Blex::Test::GetTempDir(),"paritytest");
        std::unique_ptr<Blex::ParityFile> parity;
        parity.reset(Blex::ParityFile::OpenWrite(
                parityname,
                Blex::FilePermissions::PublicRead,
                sectorsize,
                sectorsperblock,
                datablockspersegment,
                parityblockspersegment,
                8,
                true));

        BLEX_TEST_CHECK(parity.get());

        //Check whether the filename generation algorithm works correctly
        BLEX_TEST_CHECKEQUAL(parityname + ".bk000", parity->GetFilePathByNumber(0));
        BLEX_TEST_CHECKEQUAL(parityname + ".bk999", parity->GetFilePathByNumber(999));
        BLEX_TEST_CHECKEQUAL(parityname + ".bk1000", parity->GetFilePathByNumber(1000));

        for (int i=0;i<500;++i)
            BLEX_TEST_CHECKEQUAL(sizeof(parityteststring), parity->Write(parityteststring, sizeof(parityteststring)));

        BLEX_TEST_CHECKEQUAL((signed)500*sizeof(parityteststring), parity->GetTotalInputBytes());
        BLEX_TEST_CHECKEQUAL(true, parity->Finalize());
        unsigned numfiles = parity->GetNumFilesWritten();
        parity.reset();

        parity.reset(Blex::ParityFile::OpenRead(parityname, std::bind(&OnError, std::placeholders::_1) ));
        BLEX_TEST_CHECK(parity.get());

        char result[sizeof(parityteststring)];
        for (int i=0;i<500;++i)
        {
                BLEX_TEST_CHECKEQUAL(sizeof(parityteststring), parity->Read(result, sizeof(parityteststring)));
                BLEX_TEST_CHECK(std::equal(parityteststring, parityteststring + sizeof(parityteststring), result));
        }
        BLEX_TEST_CHECKEQUAL(500*sizeof(parityteststring), parity->GetTotalInputBytes());
        BLEX_TEST_CHECKEQUAL(0, parity->Read(result, sizeof(parityteststring)));
        BLEX_TEST_CHECKEQUAL(0, parityfile_error_list.size());

        //Verify the hashes
        std::vector<char> md5hashes_in;
        std::unique_ptr<Blex::FileStream> infile(Blex::FileStream::OpenRead(parityname + ".md5"));
        BLEX_TEST_CHECK(infile.get());
        ReadStreamIntoVector(*infile, &md5hashes_in);

        std::string md5hashes(md5hashes_in.begin(), md5hashes_in.end());
        std::vector<std::string> lines;
        Blex::Tokenize(md5hashes.begin(), md5hashes.end(), '\n', &lines);
        BLEX_TEST_CHECKEQUAL(numfiles, lines.size()-1);

        for(unsigned i=0;i<lines.size()-1;++i)
        {
                std::string line = lines[i];
                if(!line.empty() && line[line.size()-1]=='\r')
                   line.resize(line.size()-1);

                std::string::iterator space=std::find(line.begin(),line.end(),' ');
                BLEX_TEST_CHECK(space!=line.end());
                BLEX_TEST_CHECK(space!=line.end()-1);
                BLEX_TEST_CHECK(space[1]==' ');

                std::string hash = std::string(line.begin(), space);
                std::string filename = std::string(space+2, line.end());

                infile.reset(Blex::FileStream::OpenRead(Blex::MergePath(Blex::Test::GetTempDir(), filename)));
                BLEX_TEST_CHECK(infile.get());

                std::string filehash = Blex::Test::MD5Stream(*infile);
                Blex::ToLowercase(filehash.begin(), filehash.end());
                BLEX_TEST_CHECKEQUAL(hash, filehash);
        }

        // Do some chopping wor. Segments are independent, so we can do different choppings in different segments
        // We have 8 files.
        unsigned blocksize = sectorsize * sectorsperblock;
        unsigned segmentsize = (datablockspersegment + parityblockspersegment) * blocksize;

        // Block size: 3*207 = 621
        // Segment size: (3+1)*621 = 2484
        std::unique_ptr< Blex::FileStream > chopfile;
        uint8_t evil_data[16384] = { 0 };
        for (unsigned i = 0; i < sizeof(evil_data); ++i)
            evil_data[i] = i % 256;

        // Chop 1: (segment 1) remove first data block
        chopfile.reset(Blex::FileStream::OpenRW(parityname + ".bk000", false, false, Blex::FilePermissions::PublicRead));
        chopfile->DirectWrite(1 * segmentsize + 0 * blocksize, evil_data, blocksize);
//        chopfile.reset();

        // Chop 2: (segment 2) remove second data block
        chopfile->DirectWrite(2 * segmentsize + 1 * blocksize, evil_data, blocksize);

        // Chop 3: (segment 3) remove third data block
        chopfile->DirectWrite(3 * segmentsize + 2 * blocksize, evil_data, blocksize);

        // Chop 4: (segment 4) remove parity block
        chopfile->DirectWrite(4 * segmentsize + 3 * blocksize, evil_data, blocksize);

        // Chop 5: (segment 5) remove block/sector 0/1 0/2 and 1/0
        chopfile->DirectWrite(5 * segmentsize + 0 * blocksize + 1*sectorsize, evil_data, 3*sectorsize);

        // Chop 6: (segment 6) remove block/sector 0/0 1/1 and 2/2
        chopfile->DirectWrite(6 * segmentsize + 0 * blocksize + 0*sectorsize, evil_data, 1*sectorsize);
        chopfile->DirectWrite(6 * segmentsize + 1 * blocksize + 1*sectorsize, evil_data, 1*sectorsize);
        chopfile->DirectWrite(6 * segmentsize + 2 * blocksize + 2*sectorsize, evil_data, 1*sectorsize);

        chopfile.reset();

        // Check it!
        parity.reset(Blex::ParityFile::OpenRead(parityname, std::bind(&OnError, std::placeholders::_1) ));
        BLEX_TEST_CHECK(parity.get());

        for (int i=0;i<500;++i)
        {
                BLEX_TEST_CHECKEQUAL(sizeof(parityteststring), parity->Read(result, sizeof(parityteststring)));
                BLEX_TEST_CHECK(std::equal(parityteststring, parityteststring + sizeof(parityteststring), result));
        }
        BLEX_TEST_CHECKEQUAL(500*sizeof(parityteststring), parity->GetTotalInputBytes());
        BLEX_TEST_CHECKEQUAL(0, parity->Read(result, sizeof(parityteststring)));
//        BLEX_TEST_CHECKEQUAL(0, parityfile_error_list.size());
}

BLEX_TEST_FUNCTION(TestParityFileExactEOF)
{
        parityfile_error_list.clear();
        char testtext[128]={"1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567"};
        /* We want EOF to be at the end of the second file. So we want:
           64 bytes per file,
           2 sections of 32 bytes
           2 sections of 2 blocks of 16 bytes each
           2 sections of 2 blocks 2 blocks of 4 sectors of 4 bytes each  (2*2*2*4*4 = 128)

           Sector overhead is currently 24+4+2 = 30 bytes. Sector size should thus be 34
           With 1 parity block, each file should be exactly 34 * 4 * (2+1) * 2 = 816 bytes in size
        */

        std::string parityname = Blex::MergePath(Blex::Test::GetTempDir(),"parityexact");
        std::unique_ptr<Blex::ParityFile> parity;
        parity.reset(Blex::ParityFile::OpenWrite(parityname, Blex::FilePermissions::PublicRead, 34, 4, 2, 1, 2, true));
        BLEX_TEST_CHECK(parity.get());
        BLEX_TEST_CHECKEQUAL(4, parity->GetSectorDataSize());
        BLEX_TEST_CHECKEQUAL(sizeof(testtext), parity->Write(testtext, sizeof(testtext)));
        BLEX_TEST_CHECK(parity->Finalize());
        BLEX_TEST_CHECKEQUAL(2, parity->GetNumFilesWritten());
        parity.reset();
        BLEX_TEST_CHECKEQUAL(816u, Blex::PathStatus(parityname + ".bk000").FileLength());
        BLEX_TEST_CHECKEQUAL(816u, Blex::PathStatus(parityname + ".bk001").FileLength());
        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(parityname + ".bk002").Exists());
        parity.reset(Blex::ParityFile::OpenRead(parityname, std::bind(&OnError, std::placeholders::_1) ));

        char testtext_dup[sizeof(testtext)];
        BLEX_TEST_CHECKEQUAL(sizeof(testtext), parity->Read(testtext_dup, sizeof(testtext)));
        BLEX_TEST_CHECK(std::equal(testtext, testtext + sizeof(testtext), testtext_dup));
        BLEX_TEST_CHECKEQUAL(0, parity->Read(testtext_dup, sizeof(testtext)));
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

BLEX_TEST_FUNCTION(TestZlib)
{
        Blex::MemoryRWStream filestore;
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("securecrt.odt"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        std::unique_ptr<Blex::ZipArchiveReader> reader;
        reader.reset(Blex::ZipArchiveReader::Open(*srcfile));
        BLEX_TEST_CHECK(reader.get());

        //Test file 'mimetype'
        Blex::ZipArchiveReader::Entry entry = reader->NextEntryInfo();
        BLEX_TEST_CHECKEQUAL(Blex::ZipArchiveReader::Entry::File, entry.type);
        BLEX_TEST_CHECKEQUAL("mimetype", entry.name);
        BLEX_TEST_CHECKEQUAL(static_cast< Blex::FileOffset >(39), entry.length);
        BLEX_TEST_CHECK(reader->SendFile(filestore));
        BLEX_TEST_CHECKEQUAL(static_cast< Blex::FileOffset >(39), filestore.GetFileLength());

        filestore.SetOffset(0);
        BLEX_TEST_CHECKEQUAL("12FBDAB5E8E99FD318F5FBDCDC92670A", Blex::Test::MD5Stream(filestore));

        //Test folders
        entry = reader->NextEntryInfo();
        BLEX_TEST_CHECKEQUAL(Blex::ZipArchiveReader::Entry::Directory, entry.type);
        BLEX_TEST_CHECKEQUAL("Configurations2", entry.name);
        entry = reader->NextEntryInfo();
        BLEX_TEST_CHECKEQUAL(Blex::ZipArchiveReader::Entry::Directory, entry.type);
        BLEX_TEST_CHECKEQUAL("Pictures", entry.name);

        //Test file content
        entry = reader->NextEntryInfo();
        BLEX_TEST_CHECKEQUAL(Blex::ZipArchiveReader::Entry::File, entry.type);
        BLEX_TEST_CHECKEQUAL("content.xml", entry.name);
        BLEX_TEST_CHECKEQUAL(static_cast< Blex::FileOffset >(6907), entry.length);
        filestore.SetFileLength(0);
        filestore.SetOffset(0);
        BLEX_TEST_CHECK(reader->SendFile(filestore));
        BLEX_TEST_CHECKEQUAL(static_cast< Blex::FileOffset >(6907), filestore.GetFileLength());

        filestore.SetOffset(0);
        BLEX_TEST_CHECKEQUAL("B1CA0669838460854B51F843A36776D9", Blex::Test::MD5Stream(filestore));
}

BLEX_TEST_FUNCTION(TestZlibFla)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("aep_data_test1.fla"));
        std::unique_ptr<Blex::ZipArchiveReader> zreader(Blex::ZipArchiveReader::Open(*srcfile));

        BLEX_TEST_CHECK(zreader.get());
        std::vector< Blex::ZipArchiveReader::Entry > entries;
        zreader->GetFilesList(&entries);

        BLEX_TEST_CHECKEQUAL(82,entries.size());
}

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
