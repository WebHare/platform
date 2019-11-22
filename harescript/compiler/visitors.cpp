//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "visitors.h"

namespace HareScript
{
namespace Compiler
{

void ThrowReplaceTypeError(const char *currenttype_name, const char *newtype_name, const char *ptrtype_name)
{
        std::string s = std::string () + "Exception: Trying to replace an pointer to a " + currenttype_name + " with a pointer to a " + newtype_name + ", which is not a " + ptrtype_name + " pointer";
        std::cout << s << std::endl;
        throw std::logic_error(s);
}

} //end namespace compiler
} //end namespace harescript

