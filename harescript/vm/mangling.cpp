//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "mangling.h"
#include "errors.h"

namespace HareScript
{
namespace Mangling
{

Blex::StringPair GetFunctionName(const char *mangledname)
{
        const char *start = mangledname;
        while (*mangledname && *mangledname != ':')
            ++mangledname;

        return Blex::StringPair(start, mangledname);
}

Blex::StringPair GetModuleName(const char *mangledname)
{
        while (*mangledname && *mangledname != ':')
            ++mangledname;

        if (*mangledname)
            ++mangledname;

        const char *start = mangledname;
        while (*mangledname && *mangledname != ':')
            ++mangledname;

        return Blex::StringPair(start, mangledname);
}

VariableTypes::Type GetReturnType(const char *mangledname)
{
        for (unsigned idx = 0; idx != 2; ++idx)
        {
                while (*mangledname && *mangledname != ':')
                    ++mangledname;

                if (*mangledname)
                     ++mangledname;
        }
        return GetParameter(&mangledname);
}

const char * GetParameterSection(const char *mangledname)
{
        for (unsigned idx = 0; idx != 3; ++idx)
        {
                while (*mangledname && *mangledname != ':')
                    ++mangledname;

                if (*mangledname)
                     ++mangledname;
        }
        if (*mangledname)
            return mangledname;
        else
            return 0;
}

VariableTypes::Type GetParameterByNr(const char *parametersection, unsigned nr)
{
        while (nr && *parametersection)
        {
                ++parametersection;
                if (*parametersection == 'A')
                    ++parametersection;
        }
        return GetParameter(&parametersection);
}

VariableTypes::Type GetParameter(const char **parameters)
{
        if (!parameters || !*parameters)
        {
            *parameters = 0;
            return VariableTypes::Uninitialized;
        }

        VariableTypes::Type type = VariableTypes::Uninitialized;
        switch (**parameters)
        {
        case 'V':       type = VariableTypes::Variant; break;
        case 'I':       type = VariableTypes::Integer; break;
        case '6':       type = VariableTypes::Integer64; break;
        case 'M':       type = VariableTypes::Money; break;
        case 'F':       type = VariableTypes::Float; break;
        case 'B':       type = VariableTypes::Boolean; break;
        case 'S':       type = VariableTypes::String; break;
        case 'R':       type = VariableTypes::Record; break;
        case 'D':       type = VariableTypes::DateTime; break;
        case 'T':       type = VariableTypes::Table; break;
        case 'C':       type = VariableTypes::Schema; break;
        case 'P':       type = VariableTypes::FunctionRecord; break;
        case 'O':       type = VariableTypes::Object; break;
        case 'W':       type = VariableTypes::WeakObject; break;
        default:
            *parameters = 0;
            return type;
        }
        if (*++*parameters == 'A')
        {
                type = HareScript::ToArray(type);
                ++*parameters;
        }

        if (**parameters == 0)
            *parameters = 0;

        return type;
}

namespace
{
void AddType(std::string &x, ::HareScript::VariableTypes::Type type)
{
        switch (type & ~VariableTypes::Array)
        {
        case VariableTypes::Variant:
                x += 'V';
                break;
        case VariableTypes::Integer:
                x += 'I';
                break;
        case VariableTypes::Integer64:
                x += '6';
                break;
        case VariableTypes::Money:
                x += 'M';
                break;
        case VariableTypes::Float:
                x += 'F';
                break;
        case VariableTypes::Boolean:
                x += 'B';
                break;
        case VariableTypes::String:
                x += 'S';
                break;
        case VariableTypes::Record:
                x += 'R';
                break;
        case VariableTypes::Blob:
                x += 'X';
                break;
        case VariableTypes::DateTime:
                x += 'D';
                break;
        case VariableTypes::Table:
                x += 'T';
                break;
        case VariableTypes::Schema:
                x += 'C';
                break;
        case VariableTypes::FunctionRecord:
                x += 'P';
                break;
        case VariableTypes::Object:
                x += 'O';
                break;
        case VariableTypes::WeakObject:
                x += 'W';
                break;
        default:
                throw VMRuntimeError(Error::InternalError,"Unknown type handed to function name mangler");
        }
        if (type & VariableTypes::Array)
            x += 'A';
}
} //end anonymous namespace


void MangleFunctionName(
        std::string *mangledname,
        const char *functionname,
        const char *module,
        VariableTypes::Type returntype,
        unsigned parameter_count,
        VariableTypes::Type const *parameters)
{
        mangledname->reserve(128);

        *mangledname += functionname;
        *mangledname += ':';
        if (module)
            *mangledname += module;

        // The cases of the rest we have under our control, so uppercase now.
        Blex::ToUppercase(mangledname->begin(), mangledname->end());

        *mangledname += ':';
        if (returntype != VariableTypes::Uninitialized && returntype != VariableTypes::NoReturn)
            AddType(*mangledname, returntype);
        *mangledname += ':';
        for (unsigned idx = 0; idx < parameter_count; ++idx)
            AddType(*mangledname, *parameters++);
}

} // End of namespace Mangling
} // End of namespace HareScript
