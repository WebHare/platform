//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>


#include <iostream>
#include <blex/path.h>
#include <blex/mmapfile.h>
#include <blex/testing.h>

bool deep_testing;

int main(int argc, char* argv[])
{
        srand(1);
        deep_testing = argc>=2 ? std::string(argv[1])=="deep" : false;
        Blex::Test::SetTestName("Database tests");
        return Blex::Test::Run(Blex::Test::TestNoisy, "*") ? EXIT_SUCCESS : EXIT_FAILURE;
}
//---------------------------------------------------------------------------

