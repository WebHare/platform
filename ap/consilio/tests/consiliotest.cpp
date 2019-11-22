#include <ap/libwebhare/allincludes.h>


#include <blex/path.h>
#include <blex/testing.h>
#include <blex/utils.h>

#include "../consilio.h"

std::string test_data;

int UTF8Main(std::vector<std::string> const &args)
{
        try
        {
                if (args.size()<2)
                {
                        std::cerr << "Syntax: consiliotest <path_to_testdata>\n";
                        return EXIT_FAILURE;
                }
                test_data=args[1];

                long options = 0;
                if (args.size()>2)
                        options = atol(args[2].c_str());

                if (!Blex::PathStatus(test_data).IsDir())
                {
                        std::cerr << "Invalid test data directory\n";
                        return EXIT_FAILURE;
                }
                if (test_data[test_data.size()-1] != '/')
                    test_data.push_back('/');

                Blex::Test::SetTestName("consiliotest");
                return Blex::Test::Run(options, "*") ? EXIT_SUCCESS : EXIT_FAILURE;
        }
        catch (std::exception &e)
        {
                std::cout << "Exception: " << e.what() << "\n";
                return EXIT_FAILURE;
        }
}
//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}





