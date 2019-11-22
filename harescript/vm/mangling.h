#ifndef blex_harescript_vm_mangling
#define blex_harescript_vm_mangling

#include "hsvm_constants.h"

namespace HareScript
{
namespace Mangling
{

/** Returns the function name from a mangled name
    @param mangledname Mangled name
    @return Pointers to function name within mangled name */
Blex::StringPair GetFunctionName(const char *mangledname);

/** Returns the module name from a mangled name
    @param mangledname Mangled name
    @return Pointers to module name within mangled name */
Blex::StringPair GetModuleName(const char *mangledname);

/** Returns the return type from a mangled function name
    @param mangledname Mangled name
    @return Return type, VariableTypes::Uninitialized if none present (macro or error) */
VariableTypes::Type GetReturnType(const char *mangledname);

/** Returns the start of the parameter section in the mangled name
    @param mangledname Mangled name
    @return Returns first character of parameter manglin. 0 if not present or error */
const char * GetParameterSection(const char *mangledname);

/** Return the variable type of the mangled parameter type. Increases the
    parameter pointer, sets that to 0 on end or error, then returns
    VariableType::Uninitialized
    @param parameter Pointer to mangled parameter type
    @return Parameter type, VariableTypes::Uninitialized if not present */
VariableTypes::Type GetParameter(const char **parameter);

VariableTypes::Type GetParameterByNr(const char *parametersection, unsigned nr);


/** Mangles a function name
    @param mangledname Filled with mangled name
    @param functionname Name of function
    @param module Module (optional)
    @param returntype Return type of function (use VariableTypes::Uninitialized of VariableTypes::NoReturn for macros)
    @param parameter_count Number of parameters
    @param Address of first parameter */
void BLEXLIB_PUBLIC MangleFunctionName(
        std::string *mangledname,
        const char *functionname,
        const char *module,
        VariableTypes::Type returntype,
        unsigned parameter_count,
        VariableTypes::Type const *parameters);



} // End of namespace Mangling
} // End of namespace HareScript

#endif
