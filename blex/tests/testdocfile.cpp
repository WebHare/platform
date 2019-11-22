//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../docfile.h"
#include <blex/path.h>
#include <blex/crypto.h>
#include <blex/stream.h>

using Blex::Docfile;

BLEX_TEST_FUNCTION(TestStatics)
{
        uint8_t olesignature[] =     { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 };
        uint8_t anothersignature[] = { 0xD0, 0xCF, 0x11, 0xE1, 0xA1, 0xB1, 0x1A, 0xE1 };
        BLEX_TEST_CHECKEQUAL(true,  Blex::Docfile::IsDocfileSignature(olesignature) );
        BLEX_TEST_CHECKEQUAL(false, Blex::Docfile::IsDocfileSignature(anothersignature) );
}

std::string FileHash(Docfile &srcfile, std::string const &filename)
{
        const Docfile::File* file = srcfile.FindFile(srcfile.GetRoot(),filename);
        if (!file)
            throw std::runtime_error("Stream " + filename + " does not exist");

        std::unique_ptr<Blex::Stream> infile(srcfile.OpenOleFile(file));
        if (!infile.get())
            throw std::runtime_error("Stream " + filename + " cannot be opened");

        return Blex::Test::MD5Stream(*infile);
}

BLEX_TEST_FUNCTION(TestPlainFile)
{
        std::unique_ptr<Blex::RandomStream> srcfile;
        srcfile.reset(Blex::Test::OpenTestFile("testole_plaindoc.doc"));

        std::unique_ptr<Docfile> arc;
        arc.reset(new Docfile(*srcfile));

        Docfile::Directory const *root = arc->GetRoot();
        BLEX_TEST_CHECK(root != NULL);

        //Verify the directory structure
        std::vector<std::string> files = arc->GetFiles(root);
        BLEX_TEST_CHECKEQUAL(6u, files.size());

        BLEX_TEST_CHECKEQUAL(std::string("\1CompObj"),                   files[0]);
        BLEX_TEST_CHECKEQUAL(std::string("\5DocumentSummaryInformation"),files[1]);
        BLEX_TEST_CHECKEQUAL(std::string("\5SummaryInformation"),        files[2]);
        BLEX_TEST_CHECKEQUAL(std::string("1Table"),                      files[3]);
        BLEX_TEST_CHECKEQUAL(std::string("Data"),                        files[4]);
        BLEX_TEST_CHECKEQUAL(std::string("WordDocument"),                files[5]);

        //Verify the document type
        uint8_t worddoc[16]={6,9,2,0,0,0,0,0,0xc0,0,0,0,0,0,0,0x46};
        BLEX_TEST_CHECK(std::equal(worddoc,worddoc+16,arc->GetCLSID(root)) );

        //Check the actual file contents - the hashes have been generated using a verified oleexplode and an external MD5 utility
        BLEX_TEST_CHECKEQUAL("55B245F1B7A13848A333CEB2C6AD3DC3", FileHash(*arc, "\1CompObj"));
        BLEX_TEST_CHECKEQUAL("CAD98F2B9F03BE5C6A2A72DAC465CF3E", FileHash(*arc, "\5DocumentSummaryInformation"));
        BLEX_TEST_CHECKEQUAL("BA60EB86574395752BE40D2086D12CAE", FileHash(*arc, "\5SummaryInformation"));
        BLEX_TEST_CHECKEQUAL("0AF276A4E394A2C57B0389F4BCD0E039", FileHash(*arc, "1Table"));
        BLEX_TEST_CHECKEQUAL("02104115AA095544849BBD64C940B959", FileHash(*arc, "Data"));
        BLEX_TEST_CHECKEQUAL("F80F4981B4347C960F25B0054B93D17F", FileHash(*arc, "WordDocument"));

        //Open the property sets
        const Docfile::File* file = arc->FindFile(arc->GetRoot(),"\5SummaryInformation");
        std::unique_ptr<Blex::Stream> docsum(arc->OpenOleFile(file));
        BLEX_TEST_CHECK(docsum.get());

        Blex::OlePropertySet ops;
        BLEX_TEST_CHECK(ops.ParseProperties(*docsum));

        unsigned prop = ops.GetSection(0).FindProperty(2); //title
        BLEX_TEST_CHECKEQUAL(Blex::OlePropertySet::V_String, ops.GetType(prop));
        BLEX_TEST_CHECKEQUAL("Handleiding WebHare Professional", ops.GetString(prop));
}


BLEX_TEST_FUNCTION(TestFragmentedFile)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("testole_fastsaved.doc"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        std::unique_ptr<Docfile> arc(new Blex::StreamOwningDocfile(srcfile.release()));

        Docfile::Directory const *root = arc->GetRoot();
        BLEX_TEST_CHECK(root != NULL);

        //Verify the directory structure
        std::vector<std::string> files = arc->GetFiles(root);
        BLEX_TEST_CHECKEQUAL(6u, files.size());

        BLEX_TEST_CHECKEQUAL(std::string("\1CompObj"),                   files[0]);
        BLEX_TEST_CHECKEQUAL(std::string("\5DocumentSummaryInformation"),files[1]);
        BLEX_TEST_CHECKEQUAL(std::string("\5SummaryInformation"),        files[2]);
        BLEX_TEST_CHECKEQUAL(std::string("0Table"),                      files[3]);
        BLEX_TEST_CHECKEQUAL(std::string("1Table"),                      files[4]);
        BLEX_TEST_CHECKEQUAL(std::string("WordDocument"),                files[5]);

        //Verify the document type
        uint8_t worddoc[16]={6,9,2,0,0,0,0,0,0xc0,0,0,0,0,0,0,0x46};
        BLEX_TEST_CHECK(std::equal(worddoc,worddoc+16,arc->GetCLSID(root)) );

        //Check the actual file contents - the hashes have been generated using a verified oleexplode and an external MD5 utility
        BLEX_TEST_CHECKEQUAL("5202491CAE29D3897278347A50104201", FileHash(*arc, "0Table"));
        BLEX_TEST_CHECKEQUAL("2C1F12C46C7FB5D6B150D8E5279C7116", FileHash(*arc, "1Table"));
        BLEX_TEST_CHECKEQUAL("5B6B3FBCBEA6FFD929A1A1AE372FE058", FileHash(*arc, "WordDocument"));
        BLEX_TEST_CHECKEQUAL("55B245F1B7A13848A333CEB2C6AD3DC3", FileHash(*arc, "\1CompObj"));
        BLEX_TEST_CHECKEQUAL("650EE24D908B712BEB03A2C4EEFE183B", FileHash(*arc, "\5DocumentSummaryInformation"));
        BLEX_TEST_CHECKEQUAL("46A65CE11CDE20A47D7EFD2EF72886FC", FileHash(*arc, "\5SummaryInformation"));
}

BLEX_TEST_FUNCTION(TestOnlyLargeFatFile)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("verstuurd.doc"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        std::unique_ptr<Docfile> arc(new Blex::StreamOwningDocfile(srcfile.release()));

        Docfile::Directory const *root = arc->GetRoot();
        BLEX_TEST_CHECK(root != NULL);
}

BLEX_TEST_FUNCTION(TestThaiProperties)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("testole_thai.doc"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        std::unique_ptr<Docfile> arc(new Blex::StreamOwningDocfile(srcfile.release()));

        //Open the property sets
        const Docfile::File* file = arc->FindFile(arc->GetRoot(),"\5SummaryInformation");
        std::unique_ptr<Blex::Stream> docsum(arc->OpenOleFile(file));
        BLEX_TEST_CHECK(docsum.get());

        Blex::OlePropertySet ops;
        BLEX_TEST_CHECK(ops.ParseProperties(*docsum));

        unsigned prop = ops.GetSection(0).FindProperty(2); //title
        BLEX_TEST_CHECKEQUAL(Blex::OlePropertySet::V_String, ops.GetType(prop));
        BLEX_TEST_CHECKEQUAL("\xE0\xB8\x86\xE0\xB8\x8B\xE0\xB8\x99\xEF\x81\x97", ops.GetString(prop));
}

BLEX_TEST_FUNCTION(TestTwoPropertySets)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("testole_2pps.doc"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        std::unique_ptr<Docfile> arc(new Blex::StreamOwningDocfile(srcfile.release()));

        //Open the property sets
        const Docfile::File* file = arc->FindFile(arc->GetRoot(),"\5DocumentSummaryInformation");
        std::unique_ptr<Blex::Stream> docsum(arc->OpenOleFile(file));
        BLEX_TEST_CHECK(docsum.get());

        Blex::OlePropertySet ops;
        BLEX_TEST_CHECK(ops.ParseProperties(*docsum));
        BLEX_TEST_CHECKEQUAL(2, ops.GetNumSections());

        uint8_t header[16]={0x05,0xD5,0xCD,0xD5, 0x9C,0x2E,0x1B,0x10, 0x93,0x97,0x08,0x00, 0x2B,0x2C,0xF9,0xAE };
        BLEX_TEST_CHECKEQUAL(1, ops.FindSectionByFormatId(header));
        BLEX_TEST_CHECK(ops.GetSection(1).dictionary.find(2) != ops.GetSection(1).dictionary.end());
        BLEX_TEST_CHECKEQUAL("Base Target", ops.GetSection(1).dictionary.find(2)->second);
        //we assume so far that properties are case sensitive
        BLEX_TEST_CHECKEQUAL(0, ops.GetSection(1).FindPropertyByName("Base target"));
        BLEX_TEST_CHECK(ops.GetSection(1).FindPropertyByName("Base Target") != 0);

        BLEX_TEST_CHECKEQUAL("_top", ops.GetString(ops.GetSection(1).FindPropertyByName("Base Target")));
}
