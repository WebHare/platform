#include <harescript/vm/allincludes.h>

#include "vmtest.h"
#include <blex/testing.h>
#include <blex/utils.h>
#include <blex/getopt.h>

namespace VMTest
{

std::string srcdir;
std::string moduledir;

} // End of namespace VMTest

void ShowSyntax()
{
        std::cout << "Syntax: vmtest --srcdir webharesrcdir --moduledir moduledir [options]\n";
        std::cout << " --srcdir: The webhare source directory" << std::endl;
        std::cout << " --moduledir: The harescript modules directory" << std::endl;
}

int UTF8Main(std::vector<std::string> const &args)
{
        Blex::Test::SetTestName("vmtest");

        Blex::OptionParser::Option optionlist[] = {
                Blex::OptionParser::Option::StringOpt("srcdir"),
                Blex::OptionParser::Option::StringOpt("moduledir"),
                Blex::OptionParser::Option::Param("options", false),
                Blex::OptionParser::Option::ListEnd() };

        Blex::OptionParser parser(optionlist);
        if (!parser.Parse(args) || !parser.Exists("srcdir"))
            return ShowSyntax(),EXIT_FAILURE;


        VMTest::srcdir = Blex::FixupToAbsolutePath(parser.StringOpt("srcdir"));
        VMTest::moduledir = Blex::FixupToAbsolutePath(parser.StringOpt("moduledir"));

        long options = 0;
        if (parser.Param("options") != "")
            options = std::atol(parser.Param("options").c_str());

        return Blex::Test::Run(options, "*") ? EXIT_SUCCESS : EXIT_FAILURE;
}

//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

