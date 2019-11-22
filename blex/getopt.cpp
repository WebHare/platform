#include <blex/blexlib.h>


#include <stdexcept>
#include <cstring>
#include <algorithm>
#include "getopt.h"

namespace Blex
{

OptionParser::Option::Option(std::string const &_name, ParamType _type, unsigned _value)
: optionname(_name)
, type(_type)
, value(_value)
{}

OptionParser::Option::~Option()
{
}

OptionParser::Option OptionParser::Option::Switch(std::string const &name, bool initial_value)
{
        return Option(name, PSwitch , initial_value ? 1 : 0);
}

OptionParser::Option OptionParser::Option::StringOpt(std::string const &name)
{
        return Option(name, PStringOpt , 0);
}

OptionParser::Option OptionParser::Option::StringList(std::string const &name)
{
        return Option(name, PStringList, 0);
}

OptionParser::Option OptionParser::Option::Param(std::string const &name, bool mandatory)
{
        return Option(name, PParam, mandatory);
}

OptionParser::Option OptionParser::Option::ParamList(std::string const &name)
{
        return Option(name, PParamList, 0);
}

OptionParser::Option OptionParser::Option::ListEnd()
{
        return Option("", PListEnd, 0);
}

OptionParser::OptionParser(Option const options[])
{
        Option const *curopt=options;
        while (curopt->type != Option::PListEnd)
            opts.push_back(*curopt++);
}

OptionParser::~OptionParser()
{
}

void OptionParser::ValidateOptions()
{
        std::set<std::string> names;
        bool paramsgoneoptional = false;
        bool hadlist = false;

        for (unsigned counter=0;counter<opts.size();++counter)
        {
                if (names.count(opts[counter].optionname))
                    throw std::logic_error("All options must have unique names");

                if (opts[counter].optionname.find_first_of("-+") != std::string::npos)
                    throw std::logic_error("Illegal option name");

                names.insert(opts[counter].optionname);
                if (opts[counter].type == Option::PParam)
                {
                        if (hadlist)
                            throw std::logic_error("Parameter may not be put after a parameter list");
                        if (!opts[counter].value)
                            paramsgoneoptional = true;
                        else if (paramsgoneoptional)
                            throw std::logic_error("Optional parameters must be put after mandatory parameters");
                }
                if (opts[counter].type == Option::PParamList)
                    hadlist = true;
        }
}

void OptionParser::AddOption(Option const &newoption)
{
        if (newoption.type != Option::PStringOpt && newoption.type != Option::PSwitch && newoption.type != Option::PStringList)
            throw std::logic_error("Only optional string and switch parameters can be added using AddOption");
        opts.insert(opts.begin(),newoption);
}

bool OptionParser::ParseParameter(Option const *opt, std::string const &parameter)
{
        switch (opt->type)
        {
        case Option::PStringOpt:
                if (stringvalues.count(opt->optionname))
                {
                        currenterror = "String option '" + opt->optionname + "' used twice";
                        return false;
                }
                stringvalues[opt->optionname] = parameter;
                return true;

        case Option::PStringList:
                stringlistvalues[opt->optionname].push_back(parameter);
                return true;

        default:
                throw std::logic_error("Don't know how to parse this unconcatenable option type");
        }
}

unsigned OptionParser::ParseConcatenableOption(Option const *option, std::string const &data)
{
        //Concatenable option (eg, -ab may set both -a and -b)
        if (option->type != Option::PSwitch)
            throw std::logic_error("Don't know how to parse this concatenable option type");

        bool has_enable_flag = !data.empty() && data[0]=='+';
        bool has_disable_flag = !data.empty() && data[0]=='-';

        switchvalues[option->optionname] = !has_disable_flag;

        return has_enable_flag || has_disable_flag ? 1 : 0;
}

unsigned OptionParser::ParseLongOption(const char *current, const char *next)
{
        current+=2;
        const char *current_end = current+strlen(current);
        const char *current_equals = std::find(current,current_end,'=');

        std::string optname(current, current_equals);
        Option const *opt = FindOption(optname, Option::PAny);
        if (!opt || opt->optionname.size()==1 || !opt->OptionIsReferencable())
        {
                currenterror="Unknown option '" + optname + "'";
                return 0;
        }

        if (opt->OptionHasParameter())
        {
                if (current_equals != current_end) //parameter is 'embedded' into long option
                {
                        return ParseParameter(opt,std::string(current_equals+1,current_end)) ? 1 : 0;
                }
                else if (next)
                {
                        return ParseParameter(opt,next) ? 2: 0;
                }
                else
                {
                        currenterror = "Missing parameter for string option '" + optname + "'";
                        return 0;
                }
        }
        else
        {
                ParseConcatenableOption(opt, std::string());
                return 1;
        }
}

unsigned OptionParser::ParseShortOptions(const char *current, const char *next)
{
        std::string arg(current+1);

        while (!arg.empty()) //parse one or more short options
        {
                std::string optname(&arg[0], &arg[1]);
                Option const *opt = FindOption(optname, Option::PAny);
                if (!opt || !opt->OptionIsReferencable())
                {
                        currenterror="Unknown option '" + optname + "'";
                        return 0;
                }

                if (opt->OptionHasParameter())
                {
                        //This option supports parameters, and is not concatenable
                        //If option isn't followed by anything, parameter is in next argument
                        //Optionally eat one '=' to parse the option
                        if (arg.size() == 1)
                        {
                                if (!next)
                                {
                                        currenterror = "Missing parameter for string option '" + optname + "'";
                                        return 0;
                                }
                                if (!ParseParameter(opt, next))
                                    return 0;
                                return 2; //parsed 2 parameters
                        }
                        else
                        {
                                //option shuld follow this parameter
                                std::string parameter(arg[1]=='=' ? arg.begin()+2 : arg.begin()+1,arg.end());
                                if (!ParseParameter(opt, parameter))
                                    return 0;
                                return 1; //parsed 1 parameter
                        }
                }
                else
                {
                        std::string optiondata(arg.begin()+1,arg.end());
                        unsigned bytes_parsed = ParseConcatenableOption(opt, optiondata);
                        arg.erase(arg.begin(),arg.begin()+1+bytes_parsed);
                }
        }
        return 1; //parsed 1 parameter
}
//ADDME: Ugly, this is the most-called version, no need for the char const* intermediate step!
bool OptionParser::Parse(std::vector<std::string> const &args)
{
        std::vector<char const*> argptrs;
        for (unsigned i=0;i<args.size();++i)
            argptrs.push_back(args[i].c_str());
        return Parse(args.size(), args.size() ? &argptrs[0] : NULL);
}

bool OptionParser::Parse(int argc, char const * const argv[])
{
        assert(argc == 0 || argv != NULL);

        ValidateOptions();

        currenterror = "Unknown internal error in option parser";
        switchvalues.clear();
        stringlistvalues.clear();

        int counter = 1; // Skip name of executable
        unsigned optioncounter = 0;

        //Parse options
        for (; counter < argc; ++ counter)
        {
                if (std::strlen(argv[counter]) == 1 || argv[counter][0]!='-') //end of options, start of parameters
                    break;
                if (std::strcmp(argv[counter],"--") == 0) //forced end of options
                {
                         ++counter;
                         break;
                }

                unsigned num_parsed;
                if (argv[counter][1]=='-')
                    num_parsed=ParseLongOption(argv[counter], counter+1>=argc ? NULL : argv[counter+1]);
                else
                    num_parsed=ParseShortOptions(argv[counter], counter+1>=argc ? NULL : argv[counter+1]);

                if (num_parsed == 2)
                    ++counter;
                else if (num_parsed != 1)
                    return false;
        }

        //Parse other parameters
        for (;counter < argc;++counter)
        {
                std::string parameter(argv[counter]);
                while (optioncounter<opts.size() && opts[optioncounter].type != Option::PParam && opts[optioncounter].type != Option::PParamList)
                    ++optioncounter;

                if (optioncounter == opts.size())
                {
                        currenterror = "Encountered unexpected parameter '" + parameter + "'";
                        return false;
                }

                switch (opts[optioncounter].type)
                {
                default:
                        currenterror = "Encountered unexpected parameter '" + parameter + "'";
                        return false;

                case Option::PParam:
                        stringvalues[opts[optioncounter].optionname] = parameter ;
                        ++optioncounter;
                        break;

                case Option::PParamList:
                        stringlistvalues[opts[optioncounter].optionname].push_back(parameter );
                        break;
                }
        }
        while (optioncounter<opts.size() && opts[optioncounter].type != Option::PParam && opts[optioncounter].type != Option::PParamList)
            ++optioncounter;

        if (optioncounter < opts.size() && opts[optioncounter].type == Option::PParam && opts[optioncounter].value)
        {
                currenterror = "Missing parameter " + opts[optioncounter].optionname;
                return false;
        }

        currenterror.clear();
        return true;
}

std::string OptionParser::GetErrorDescription() const
{
        return currenterror;
}

OptionParser::Option const * OptionParser::FindOption(std::string const &optionname, Option::ParamType type) const
{
        for (unsigned i=0;i<opts.size();++i)
          if (opts[i].optionname == optionname)
        {
                if (type != Option::PAny && opts[i].type != type)
                    throw std::logic_error("Option " + optionname + " has wrong type");

                return &opts[i];
        }
        return NULL;
}


bool OptionParser::Exists(std::string const &optionname) const
{
        if (!FindOption(optionname, Option::PAny))
            throw std::logic_error("No such option " + optionname);

        return switchvalues.count(optionname) || stringvalues.count(optionname) || stringlistvalues.count(optionname);
}

bool OptionParser::Switch(std::string const &optionname) const
{
        Option const *opt = FindOption(optionname, Option::PSwitch);
        if (!opt)
            throw std::logic_error("No such option " + optionname);

        std::map<std::string, bool>::const_iterator it = switchvalues.find(optionname);
        if (it==switchvalues.end())
            return opt->value;
        else
            return it->second;
}

std::string const & OptionParser::StringOpt(std::string const &optionname) const
{
        if (!FindOption(optionname, Option::PStringOpt))
            throw std::logic_error("No such option " + optionname);

        std::map<std::string, std::string>::const_iterator it = stringvalues.find(optionname);
        if (it == stringvalues.end())
           return emptystring;
        else
           return it->second;
}

std::vector<std::string> const & OptionParser::StringList(std::string const &optionname) const
{
        if (!FindOption(optionname, Option::PStringList))
            throw std::logic_error("No such option " + optionname);

        std::map<std::string, std::vector<std::string> >::const_iterator it = stringlistvalues.find(optionname);
        if (it == stringlistvalues.end())
           return emptystringlist;
        else
           return it->second;
}

std::string const &  OptionParser::Param(std::string const &optionname) const
{
        if (!FindOption(optionname, Option::PParam))
            throw std::logic_error("No such option " + optionname);

        std::map<std::string, std::string>::const_iterator it = stringvalues.find(optionname);
        if (it == stringvalues.end())
           return emptystring;
        else
           return it->second;
}

std::vector<std::string> const & OptionParser::ParamList(std::string const &optionname) const
{
        if (!FindOption(optionname, Option::PParamList))
            throw std::logic_error("No such option " + optionname);

        std::map<std::string, std::vector<std::string> >::const_iterator it = stringlistvalues.find(optionname);
        if (it == stringlistvalues.end())
           return emptystringlist;
        else
           return it->second;
}

}
