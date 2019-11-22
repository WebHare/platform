//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../context.h"
#include "../binarylogfile.h"

void Str2Pod(std::string const &str, Blex::PodVector< uint8_t > &vect)
{ vect.assign(&*str.begin(), &*str.end()); }

void Pod2Str(Blex::PodVector< uint8_t > const &vect, std::string &str)
{ str.assign(&*vect.begin(), &*vect.end()); }

std::vector< std::string > strs;
void Receiver(Blex::PodVector< uint8_t > const &vect)
{
        std::string str(vect.begin(), vect.end());
        strs.push_back(str);
}

void WriteMessageStr(Blex::BinaryLogFile &log, std::string const &str)
{
        log.WriteMessage((uint8_t*)&str[0], str.size(), false);
}
void WriteRewriteMessageStr(Blex::BinaryLogFile &log, std::string const &str)
{
        log.WriteRewriteMessage((uint8_t*)&str[0], str.size());
}


BLEX_TEST_FUNCTION(TestBinaryLogFile)
{
        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"fslogtest"));

        std::unique_ptr< Blex::BinaryLogFile > log;
        log.reset(Blex::BinaryLogFile::Open(filename, true));

        BLEX_TEST_CHECK(log.get() != 0);

        BLEX_TEST_CHECK(log->GetChainCount() == 1);

        WriteMessageStr(*log, "TEST 1");
        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 0);

        log->Commit();

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 1);
        BLEX_TEST_CHECK(strs[0] == "TEST 1");

        WriteMessageStr(*log, "TEST 2");
        WriteMessageStr(*log, "TEST 3");
        BLEX_TEST_CHECK(log->GetChainCount() == 1);
        log->Commit(true);
        BLEX_TEST_CHECK(log->GetChainCount() == 2);
        WriteMessageStr(*log, "TEST 4");
        log->Commit();
        BLEX_TEST_CHECK(log->GetChainCount() == 2);

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 4);
        BLEX_TEST_CHECK(strs[0] == "TEST 1");
        BLEX_TEST_CHECK(strs[1] == "TEST 2");
        BLEX_TEST_CHECK(strs[2] == "TEST 3");
        BLEX_TEST_CHECK(strs[3] == "TEST 4");

        BLEX_TEST_CHECK(log->TryStartLogRewrite());
        BLEX_TEST_CHECK(!log->TryStartLogRewrite());
        strs.clear();
        log->SendRewriteMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 3);
        BLEX_TEST_CHECK(strs[0] == "TEST 1");
        BLEX_TEST_CHECK(strs[1] == "TEST 2");
        BLEX_TEST_CHECK(strs[2] == "TEST 3");

        WriteRewriteMessageStr(*log, "TEST 3"); // no commit!
        WriteMessageStr(*log, "TEST 5");
        log->Commit();

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 5);
        BLEX_TEST_CHECK(strs[0] == "TEST 1");
        BLEX_TEST_CHECK(strs[1] == "TEST 2");
        BLEX_TEST_CHECK(strs[2] == "TEST 3");
        BLEX_TEST_CHECK(strs[3] == "TEST 4");
        BLEX_TEST_CHECK(strs[4] == "TEST 5");

        log->CompleteLogRewrite();
        BLEX_TEST_CHECK(log->GetChainCount() == 2);

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 3);
        BLEX_TEST_CHECK(strs[0] == "TEST 3");
        BLEX_TEST_CHECK(strs[1] == "TEST 4");
        BLEX_TEST_CHECK(strs[2] == "TEST 5");

        BLEX_TEST_CHECK(log->TryStartLogRewrite());
        log->CompleteLogRewrite();
        BLEX_TEST_CHECK(log->GetChainCount() == 2);

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 2);
        BLEX_TEST_CHECK(strs[0] == "TEST 4");
        BLEX_TEST_CHECK(strs[1] == "TEST 5");

        // Clearing
        log->Commit(true);

        BLEX_TEST_CHECK(log->TryStartLogRewrite());
        log->CompleteLogRewrite();

        BLEX_TEST_CHECK(log->GetChainCount() == 2);

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 0);

        std::string lstr = "abcdefgh";
        while (lstr.size() < 131072)
            lstr = lstr + lstr;

        WriteMessageStr(*log, lstr);
        log->Commit();

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 1);
        BLEX_TEST_CHECK(strs[0] == lstr);

        WriteMessageStr(*log, lstr);
        log->Commit(true);

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 2);
        BLEX_TEST_CHECK(strs[0] == lstr);
        BLEX_TEST_CHECK(strs[1] == lstr);

        BLEX_TEST_CHECK(log->TryStartLogRewrite());
        strs.clear();
        log->SendRewriteMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 2);
        BLEX_TEST_CHECK(strs[0] == lstr);
        BLEX_TEST_CHECK(strs[1] == lstr);

        WriteRewriteMessageStr(*log, lstr);

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 2);
        BLEX_TEST_CHECK(strs[0] == lstr);
        BLEX_TEST_CHECK(strs[1] == lstr);

        log->CompleteLogRewrite();
        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 1);
        BLEX_TEST_CHECK(strs[0] == lstr);

        log.reset();
        log.reset(Blex::BinaryLogFile::Open(filename, false));

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 1);
        BLEX_TEST_CHECK(strs[0] == lstr);

        WriteMessageStr(*log, lstr); // No commit

        log.reset();
        log.reset(Blex::BinaryLogFile::Open(filename, false));

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 1);
        BLEX_TEST_CHECK(strs[0] == lstr);

        WriteMessageStr(*log, lstr);
        log->Commit();

        log.reset();
        log.reset(Blex::BinaryLogFile::Open(filename, false));

        strs.clear();
        log->SendAllMessages(&Receiver);

        BLEX_TEST_CHECK(strs.size() == 2);
        BLEX_TEST_CHECK(strs[0] == lstr);
        BLEX_TEST_CHECK(strs[1] == lstr);

        log.reset();
        log.reset(Blex::BinaryLogFile::Open(filename, true));
        BLEX_TEST_CHECK(log.get() == 0);
}
