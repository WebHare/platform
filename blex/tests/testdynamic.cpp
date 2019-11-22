//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include <blex/path.h>
#include <blex/utils.h>

extern std::string dll_path;

BLEX_TEST_FUNCTION(TestLoad)
{
        std::string error;
        void *mylib = Blex::LoadDynamicLib(dll_path, &error);
        BLEX_TEST_CHECKEQUAL("", error);
        BLEX_TEST_CHECK(mylib);

        Blex::DynamicFunction non_existant = Blex::FindDynamicFunction(mylib,"blaat");
        BLEX_TEST_CHECK(!non_existant);

        Blex::DynamicFunction func = Blex::FindDynamicFunction(mylib,"MyFunction");
        BLEX_TEST_CHECK(func);

        int (* calcfunction)(int) = (int(*)(int))func;
        BLEX_TEST_CHECKEQUAL(15+42, calcfunction(15));

        Blex::ReleaseDynamicLib(mylib);
}

