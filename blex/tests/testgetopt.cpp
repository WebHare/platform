//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../getopt.h"

BLEX_TEST_FUNCTION(TestOptionListParseCheck)
{
        //moved outside try-catch to work around BCB bug
        Blex::OptionParser::Option double_name_optionlist[] = {
                Blex::OptionParser::Option::Switch("abc", true),
                Blex::OptionParser::Option::ListEnd() };

        Blex::OptionParser::Option mandatory_param_optionlist[] = {
                Blex::OptionParser::Option::Param("abc", false),
                Blex::OptionParser::Option::Param("def", true),
                Blex::OptionParser::Option::ListEnd() };

        Blex::OptionParser::Option param_after_list_optionlist[] = {
                Blex::OptionParser::Option::ParamList("abc"),
                Blex::OptionParser::Option::Param("def", false),
                Blex::OptionParser::Option::ListEnd() };

        //Double option name
        try
        {
                Blex::OptionParser optionparser(double_name_optionlist);
                optionparser.AddOption(Blex::OptionParser::Option::Switch("abc", false));
                optionparser.ValidateOptions();
                BLEX_TEST_FAIL("Double option names not detected");
        } catch (std::logic_error &e) {}

        //Mandatory parameter after optional parameter
        try
        {
                Blex::OptionParser optionparser(mandatory_param_optionlist);
                optionparser.ValidateOptions();
                BLEX_TEST_FAIL("Mandatory parameter after optional parameter not detected");
        } catch (std::logic_error &e) {}

        //Parameter after parameterlist
        try
        {
                Blex::OptionParser optionparser(param_after_list_optionlist);
                optionparser.Parse(std::vector<std::string>());
                BLEX_TEST_FAIL("Parameter after parameter list not detected");
        } catch (std::logic_error &e) {}
}

BLEX_TEST_FUNCTION(TestParseSingle)
{
        Blex::OptionParser::Option optionlist[] = {
                Blex::OptionParser::Option::Switch("a", true),
                Blex::OptionParser::Option::Switch("b", false),
                Blex::OptionParser::Option::StringOpt("c"),
                Blex::OptionParser::Option::StringList("d"),
                Blex::OptionParser::Option::Param("e", true),
                Blex::OptionParser::Option::Param("f", false),
                Blex::OptionParser::Option::ParamList("g"),
                Blex::OptionParser::Option::ListEnd() };

        { // Correct parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "-a-", "-b-", "-bca", "-d=b", "-dc", "pe", "pf", "pg", "ph"};
                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                BLEX_TEST_CHECK(ok == true);

                BLEX_TEST_CHECK(optionparser.Exists("c"));
                BLEX_TEST_CHECK(optionparser.Exists("d"));
                BLEX_TEST_CHECK(optionparser.Exists("e"));
                BLEX_TEST_CHECK(optionparser.Exists("f"));
                BLEX_TEST_CHECK(optionparser.Exists("g"));

                BLEX_TEST_CHECK(optionparser.Switch("a") == false);
                BLEX_TEST_CHECK(optionparser.Switch("b") == true);
                BLEX_TEST_CHECK(optionparser.StringOpt("c") == "a");
                BLEX_TEST_CHECK(optionparser.StringList("d").size() == 2);
                BLEX_TEST_CHECK(optionparser.StringList("d")[0] == "b");
                BLEX_TEST_CHECK(optionparser.StringList("d")[1] == "c");
                BLEX_TEST_CHECK(optionparser.Param("e") == "pe");
                BLEX_TEST_CHECK(optionparser.Param("f") == "pf");
                BLEX_TEST_CHECK(optionparser.ParamList("g").size() == 2);
                BLEX_TEST_CHECK(optionparser.ParamList("g")[0] == "pg");
                BLEX_TEST_CHECK(optionparser.ParamList("g")[1] == "ph");
        }

        { // Correct parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "-ab", "-ca", "-db", "-dc", "pe", "pf", "pg", "ph"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));
                bool ok = optionparser.Parse(args);
                BLEX_TEST_CHECK(ok == true);

                BLEX_TEST_CHECK(optionparser.Exists("c"));
                BLEX_TEST_CHECK(optionparser.Exists("d"));
                BLEX_TEST_CHECK(optionparser.Exists("e"));
                BLEX_TEST_CHECK(optionparser.Exists("f"));
                BLEX_TEST_CHECK(optionparser.Exists("g"));

                BLEX_TEST_CHECK(optionparser.Switch("a") == true);
                BLEX_TEST_CHECK(optionparser.Switch("b") == true);
                BLEX_TEST_CHECK(optionparser.StringOpt("c") == "a");
                BLEX_TEST_CHECK(optionparser.StringList("d").size() == 2);
                BLEX_TEST_CHECK(optionparser.StringList("d")[0] == "b");
                BLEX_TEST_CHECK(optionparser.StringList("d")[1] == "c");
                BLEX_TEST_CHECK(optionparser.Param("e") == "pe");
                BLEX_TEST_CHECK(optionparser.Param("f") == "pf");
                BLEX_TEST_CHECK(optionparser.ParamList("g").size() == 2);
                BLEX_TEST_CHECK(optionparser.ParamList("g")[0] == "pg");
                BLEX_TEST_CHECK(optionparser.ParamList("g")[1] == "ph");
        }

        { // Correct parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "-a-b", "-ca", "-db", "-dc", "pe", "pf", "pg", "ph"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                BLEX_TEST_CHECK(ok == true);

                BLEX_TEST_CHECK(optionparser.Exists("c"));
                BLEX_TEST_CHECK(optionparser.Exists("d"));
                BLEX_TEST_CHECK(optionparser.Exists("e"));
                BLEX_TEST_CHECK(optionparser.Exists("f"));
                BLEX_TEST_CHECK(optionparser.Exists("g"));

                BLEX_TEST_CHECK(optionparser.Switch("a") == false);
                BLEX_TEST_CHECK(optionparser.Switch("b") == true);
                BLEX_TEST_CHECK(optionparser.StringOpt("c") == "a");
                BLEX_TEST_CHECK(optionparser.StringList("d").size() == 2);
                BLEX_TEST_CHECK(optionparser.StringList("d")[0] == "b");
                BLEX_TEST_CHECK(optionparser.StringList("d")[1] == "c");
                BLEX_TEST_CHECK(optionparser.Param("e") == "pe");
                BLEX_TEST_CHECK(optionparser.Param("f") == "pf");
                BLEX_TEST_CHECK(optionparser.ParamList("g").size() == 2);
                BLEX_TEST_CHECK(optionparser.ParamList("g")[0] == "pg");
                BLEX_TEST_CHECK(optionparser.ParamList("g")[1] == "ph");
        }

        { // Type access options
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "-a-", "-b-", "-ca", "-db", "-dc", "pe", "pf", "pg", "ph"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);

                BLEX_TEST_CHECK(ok);

                try
                {
                        optionparser.Switch("c");
                        BLEX_TEST_FAIL("Wrong option type not detected");
                } catch (std::logic_error &e) {}

                try
                {
                        optionparser.Param("c");
                        BLEX_TEST_FAIL("Wrong option type not detected");
                } catch (std::logic_error &e) {}

                try
                {
                        optionparser.StringOpt("e");
                        BLEX_TEST_FAIL("Wrong option type not detected");
                } catch (std::logic_error &e) {}

                try
                {
                        optionparser.StringList("g");
                        BLEX_TEST_FAIL("Wrong option type not detected");
                } catch (std::logic_error &e) {}

                try
                {
                        optionparser.ParamList("d");
                        BLEX_TEST_FAIL("Wrong option type not detected");
                } catch (std::logic_error &e) {}
        }

        { // Missing parameter
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "-a-", "-b-", "-ca", "-db", "-dc"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);

                BLEX_TEST_CHECK(ok == false);
        }

        { // Unknown option
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "-z-", "-b-", "-ca", "-db", "-dc"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);

                BLEX_TEST_CHECK(ok == false);
        }
}

BLEX_TEST_FUNCTION(TestParseMultiple)
{
        Blex::OptionParser::Option optionlist[] = {
                Blex::OptionParser::Option::Switch("ab", true),
                Blex::OptionParser::Option::Switch("cd", false),
                Blex::OptionParser::Option::StringOpt("ef"),
                Blex::OptionParser::Option::StringList("gh"),
                Blex::OptionParser::Option::Param("ij", true),
                Blex::OptionParser::Option::Param("kl", false),
                Blex::OptionParser::Option::ParamList("mn"),
                Blex::OptionParser::Option::ListEnd() };

        { // Correct parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"",
                        "--ab",
                        "--ef", "a",
                        "--gh=b",
                        "--gh" ,"c",
                        "pe", "pf", "pg", "ph"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                if (!ok)
                    BLEX_TEST_FAIL(optionparser.GetErrorDescription());

                BLEX_TEST_CHECK(optionparser.Exists("ef"));
                BLEX_TEST_CHECK(optionparser.Exists("gh"));
                BLEX_TEST_CHECK(optionparser.Exists("ij"));
                BLEX_TEST_CHECK(optionparser.Exists("kl"));
                BLEX_TEST_CHECK(optionparser.Exists("mn"));

                BLEX_TEST_CHECK(optionparser.Switch("ab") == true);
                BLEX_TEST_CHECK(optionparser.Switch("cd") == false);
                BLEX_TEST_CHECK(optionparser.StringOpt("ef") == "a");
                BLEX_TEST_CHECK(optionparser.StringList("gh").size() == 2);
                BLEX_TEST_CHECK(optionparser.StringList("gh")[0] == "b");
                BLEX_TEST_CHECK(optionparser.StringList("gh")[1] == "c");
                BLEX_TEST_CHECK(optionparser.Param("ij") == "pe");
                BLEX_TEST_CHECK(optionparser.Param("kl") == "pf");
                BLEX_TEST_CHECK(optionparser.ParamList("mn").size() == 2);
                BLEX_TEST_CHECK(optionparser.ParamList("mn")[0] == "pg");
                BLEX_TEST_CHECK(optionparser.ParamList("mn")[1] == "ph");
        }

        { // Exist check
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {"", "pe"};

                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                if (!ok)
                    BLEX_TEST_FAIL(optionparser.GetErrorDescription());

                BLEX_TEST_CHECK(!optionparser.Exists("ab"));
                BLEX_TEST_CHECK(!optionparser.Exists("cd"));
                BLEX_TEST_CHECK(!optionparser.Exists("ef"));
                BLEX_TEST_CHECK(!optionparser.Exists("gh"));
                BLEX_TEST_CHECK(optionparser.Exists("ij"));
                BLEX_TEST_CHECK(!optionparser.Exists("kl"));
                BLEX_TEST_CHECK(!optionparser.Exists("mn"));
        }
}

BLEX_TEST_FUNCTION(TestParseEmpty)
{
        Blex::OptionParser::Option optionlist[] = {
                Blex::OptionParser::Option::ListEnd() };

        { // Correct parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = {""};
                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                if (!ok)
                    BLEX_TEST_FAIL(optionparser.GetErrorDescription());
        }

        { // Incorrect parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = { "", "pe" };
                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                BLEX_TEST_CHECK(ok == false);
        }
}

BLEX_TEST_FUNCTION(TestParseSwitchTerminator)
{
        Blex::OptionParser::Option optionlist[] = {
                Blex::OptionParser::Option::Switch("a", false),
                Blex::OptionParser::Option::Switch("b", false),
                Blex::OptionParser::Option::ParamList("g"),
                Blex::OptionParser::Option::ListEnd() };

        { // Correct parse
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = { "", "-a", "--", "-b", "c" };
                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                if (!ok)
                    BLEX_TEST_FAIL(optionparser.GetErrorDescription());

                BLEX_TEST_CHECK(optionparser.Switch("a") == true);
                BLEX_TEST_CHECK(optionparser.Switch("b") == false);

                BLEX_TEST_CHECK(optionparser.ParamList("g").size() == 2);
                BLEX_TEST_CHECK(optionparser.ParamList("g")[0] == "-b");
                BLEX_TEST_CHECK(optionparser.ParamList("g")[1] == "c");
        }

        { // Multiple --
                Blex::OptionParser optionparser(optionlist);

                const char * argv[] = { "", "--", "--" };
                std::vector<std::string> args(argv, argv+(sizeof(argv)/sizeof(argv[0])));

                bool ok = optionparser.Parse(args);
                if (!ok)
                    BLEX_TEST_FAIL(optionparser.GetErrorDescription());

                BLEX_TEST_CHECK(optionparser.ParamList("g").size() == 1);
                BLEX_TEST_CHECK(optionparser.ParamList("g")[0] == "--");
        }
}

