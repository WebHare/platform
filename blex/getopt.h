#ifndef blex_getopt
#define blex_getopt

#ifndef blex_blexlib
#include "blexlib.h"
#endif

#include <vector>
#include <map>
#include <set>

namespace Blex
{

/** Command-line option parser.

    Multithread considerations:
    - All option accessfunctions can be called concurrently as they do not modify this object.
    - Other calls must be serialized!

    Other warnings:
    - A PParamList must be at the end of the optionlist
    - An optionlist may only contain only one PParamList
    - Mandatory parameters must appear before optional parameters
    (ADDME: ensure the above is verified in the constructor's option list check)

    Example code:
    Blex::OptionParser::Option optionlist[] =
    {
        Blex::OptionParser::Option::Switch("d", false),
        Blex::OptionParser::Option::Switch("p", true),
        Blex::OptionParser::Option::StringOpt("s"),
        Blex::OptionParser::Option::Param("_scriptname", true),
        Blex::OptionParser::Option::Param("_libname", false),
        Blex::OptionParser::Option::ListEnd()
    };

        Blex::OptionParser parser(optionlist);
        if (!parser.Parse(argc, argv))
            return ShowSyntax(), 1;

        //read the parameters using parser.Param, parser.Switch
*/
class BLEXLIB_PUBLIC OptionParser
{
    public:
        class Option
        {
            private:
                ///Type of a paramter/optin
                enum ParamType
                {
                        PAny=-1,
                        PListEnd=0,
                        PSwitch,
                        PStringOpt,
                        PStringList,
                        PParam,
                        PParamList
                };

                std::string optionname;
                ParamType type;
                unsigned value;
                Option(std::string const &name, ParamType type, unsigned value);
            public:
                ~Option();

                ///Can a user refer to this option by name?
                bool OptionIsReferencable() const
                {
                        return type != PParam && type != PParamList;
                }

                /// Does this option require a parameter?
                bool OptionHasParameter() const
                {
                        return type == PStringOpt || type==PStringList;
                }

                /// Switch-option
                static Option Switch(std::string const &name, bool initial_value);

                /// Option that takes a string
                static Option StringOpt(std::string const &name);

                /// Option that takes a list of strings
                static Option StringList(std::string const &name);

                /// Parameter
                static Option Param(std::string const &name, bool mandatory);

                /// Parameter list (contains all non-options that are not ordinary parameters. Only one allowed, must be put after all other parameters)
                static Option ParamList(std::string const &name);

                /// End of list, must be put as last element in a list of parameters
                static Option ListEnd();

                friend class OptionParser;
        };

        /** Creates an option parser. Throws exceptions on illegal option specification (when checking)
            @param options List of options, with a ListEnd option as last element
            @param check Set to true to check option format */
        OptionParser(Option const options[]);

        ~OptionParser();

        /** Validate all passed options. Throws a logic error if the option
            definitions are broken. */
        void ValidateOptions();

        /** Add an additional option to parse. Only Switch and StringOpt options
            can be added using this command */
        void AddOption(Option const &newoption);

        /** Parses the commandline. Returns false if illegal form was found.
            In that case, GetErrorDescription returns a description of the error.
            @param argc Number of arguments in argv
            @param argv List of parameter strings
            @return Wether parse was successful */
        bool Parse(std::vector<std::string> const &args);

        /** Returns error description for first parse error */
        std::string GetErrorDescription() const;

        /**
         * \defgroup AccessFunctions Option accessfunctions. These all throw std::runtime_error when their
           option name was not mentioned in the option list
         */
        /*@{*/

        /** Returns wether this option name was found in the command line
            @return True if the option exists (always true for Switch parameters) */
        bool Exists(std::string const &optionname) const;

        /** Returns value for switch.
            @param name Name of the switch
            @return Value of switch */
        bool Switch(std::string const &optionname) const;

        /** Returns value for stringoption
            @param name Name of the stringoption
            @return Value of string option ("" when it not exists) */
        std::string const & StringOpt(std::string const &optionname) const;

        /** Returns value for stringlist
            @param name Name of the stringlist
            @return Value of stringlist */
        std::vector<std::string> const & StringList(std::string const &optionname) const;

        /** Returns value for a parameter
            @param name Name of the parameter
            @return Value of parameter */
        std::string const & Param(std::string const &optionname) const;

        /** Returns value for a parameterlist
            @param name Name of the parameterlist
            @return Value of parameterlist */
        std::vector<std::string> const & ParamList(std::string const &optionname) const;

        /*@}*/
    private:
        bool Parse(int argc, char const * const argv[]);

        std::vector<Option> opts;

        std::string currenterror;

        std::map<std::string, bool> switchvalues;
        std::map<std::string, std::string> stringvalues;
        std::map<std::string, std::vector<std::string> > stringlistvalues;

        std::string const emptystring;
        std::vector<std::string> const emptystringlist;

        /** Find option with specified name (and optionally a type). Throws std::runtime_error on error
            @param name Name of option to find
            @param type Type that the option must have (set to 0 for no type check)
            @return Found option, or NULL if the option doesn't exist */
        Option const * FindOption(std::string const &name, Option::ParamType type) const;

        ///parse an option with a parameter
        bool ParseParameter(Option const *opt, std::string const &parameter);

        /** parse a concatenable option
            @param data Option data, may include further options - this function only parses what it recognizes
            @return number of bytes parsed */
        unsigned ParseConcatenableOption(Option const *opt, std::string const &data);

        /** parse a short parameter
            @param current Current option to parse (never NULL)
            @param next Next option (may be NULL)
            @return Number of parameters parsed (0: error (reported via currenterror), 1: only current, 2: current + data */
        unsigned ParseShortOptions(const char *current, const char *next);

        /** parse a long parameter
            @param current Current option to parse (never NULL)
            @param next Next option (may be NULL)
            @return Number of parameters parsed (0: error (reported via currenterror), 1: only current, 2: current + data */
        unsigned ParseLongOption(const char *current, const char *next);
};

}

#endif //sentry
