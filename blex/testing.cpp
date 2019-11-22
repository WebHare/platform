#include <blex/blexlib.h>


#include "mime.h"
#include <iostream>
#include <string>
#include <vector>
#include "testing.h"
#include "socket.h"

#include "crypto.h"
#include "logfile.h"
#include "stream.h"

namespace Blex
{

namespace Test
{

std::string test_data_path;
bool report_all_tests = false;
bool ReportAllTests()
{
        return report_all_tests;
}
std::string testsuite_name;
std::string tempdir;

typedef void (*TestFunction)();

struct SingleTest
{
        std::string name;
        TestFunction func;
};

std::vector<SingleTest> *testlist;

AddTest::AddTest(const char *testname, TestFunction testfunc)
{
        if(!testlist)
            testlist=new std::vector<SingleTest>;

        SingleTest newtest;
        newtest.name=testname;
        newtest.func=testfunc;
        testlist->push_back(newtest);
}

const char* GetTempDir()
{
        if (testsuite_name.empty())
           throw std::runtime_error("Use SetTestName first");

        if (tempdir.empty())
        {
                std::string tmpbase = Blex::GetSystemTempDir();
                if (tmpbase.empty() || !Blex::PathIsAbsolute(tmpbase))
                    throw std::runtime_error("Temp directory '" + tmpbase + "' is not an absolute path");

                std::vector<std::string> dirs_to_kill;
                for (Blex::Directory itr(Blex::GetSystemTempDir(), testsuite_name + "-*");itr;++itr)
                    dirs_to_kill.push_back(itr.CurrentPath());
                for(unsigned i=0;i<dirs_to_kill.size();++i)
                    Blex::RemoveDirRecursive(dirs_to_kill[i]);

                testsuite_name += "-";

                Blex::DateTime now = Blex::DateTime::Now();
                std::string toadd = "00000000000" + Blex::AnyToString(now.GetDays());
                testsuite_name += toadd.substr(toadd.length()-9) + ".";

                toadd = "000000000" + Blex::AnyToString(now.GetMsecs());
                testsuite_name += toadd.substr(toadd.length()-9);

                tempdir=Blex::CreateTempDir(Blex::MergePath(Blex::GetSystemTempDir(),testsuite_name + "-"),true);
        }
        return tempdir.c_str();
}


void SetTestName(const char *testername)
{
        testsuite_name=testername;
}

bool Run(unsigned options, std::string const &mask)
{
        if (!testlist)
        {
                std::cerr << "No registered tests\n";
                return false;
        }
        if (testsuite_name.empty())
        {
                std::cerr << "Use SetTestName first\n";
                return false;
        }

        unsigned count_failure=0;

        report_all_tests = options & ReportEveryTest ? true : false;

        unsigned testcount = 0;
        for (unsigned i=0;i<testlist->size();++i)
        {
                if (StrLike((*testlist)[i].name, mask))
                    ++testcount;
        }
        for (unsigned i=0;i<testlist->size()&&(count_failure==0 || !(options & AbortOnFail));++i)
        {
                if (!StrLike((*testlist)[i].name, mask))
                    continue;

                SingleTest &test=(*testlist)[i];
                if (options & TestNoisy)
                {
                        std::cout << test.name << ':' << std::flush;
                }
                else
                {
                        std::cout << "Tests: " << i << " / " << testcount << "\r" << std::flush;
                }

                try
                {
                        test.func();
                }
                catch (Failure &e)
                {
                        if (options & TestNoisy)
                        {
                                std::cout << "FAILED\n";
                        }
                        else
                        {
                                std::cout << "\nTest " << test.name << " failure\n";
                        }
                        std::cout << e.what() << "\n";
                        ++count_failure;
                        continue;
                }
                catch (std::exception&e)
                {
                        std::cout<<"\nTest '" << test.name << "': Unexpected exception: '" << e.what () << "\n";
                        ++count_failure;
                        break;
                }
                catch(...)
                {
                        std::cout<<"\nTest '" << test.name << "': Unexpected unknown exception\n";
                        ++count_failure;
                        break;
                }

                if (options & TestNoisy)
                    std::cout<<"passed\n";
        }
        if (!(options & TestNoisy))
            std::cout << "Tests: " << testcount << " / " << testcount << "\r" << std::flush;

        std::cout << "\n";

        if (count_failure > 0)
        {
                std::cerr << count_failure << " out of " << testcount << " tests failed\n";
        }
        else
        {
                std::cerr << "All " << testcount << " tests passed\n";
        }

        delete testlist;
        testlist=NULL;
        return count_failure==0;
}

std::string MD5Stream(Blex::Stream &infile)
{
        Blex::MD5 retval;
        uint8_t buf[4096];
        while(true)
        {
                unsigned bytesread = infile.Read(buf,sizeof buf);
                retval.Process(buf,bytesread);

                if (bytesread<sizeof buf)
                    break;
        }

        uint8_t filehash[MD5HashLen];
        memcpy(filehash, retval.Finalize(), sizeof filehash);

        std::string retstr;
        Blex::EncodeBase16(filehash, filehash + sizeof filehash, std::back_inserter(retstr));
        return retstr;
}

std::string testdatadir;

void SetTestDataDir(std::string const &datadir)
{
        if(Blex::PathIsAbsolute((datadir)))
                testdatadir = datadir;
        else
                testdatadir = Blex::CollapsePathString(Blex::GetCurrentDir() + "/" + datadir);
}

std::string GetTestFilePath(std::string const &name)
{
        if(testdatadir.empty())
                throw std::runtime_error("Test data dir not yet set up");

        return Blex::MergePath(testdatadir,name);
}

Blex::FileStream* OpenTestFile(std::string const &name)
{
        std::string ondiskname = GetTestFilePath(name);
        std::unique_ptr<Blex::FileStream> testdata;
        testdata.reset(Blex::FileStream::OpenRead(ondiskname));
        if(!testdata.get())
                throw std::runtime_error("Cannot open test file " + ondiskname);
        return testdata.release();
}

} //end namespace Test

} //end namespace Blex


