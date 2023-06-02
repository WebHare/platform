#ifndef harescript_modules_icu_icu_provider
#define harescript_modules_icu_icu_provider

#include <harescript/vm/hsvm_dllinterface.h>

#include <unicode/unistr.h>
#include <unicode/utypes.h>

using namespace icu;

namespace HareScript
{
namespace ICU
{

const unsigned ContextId = 21; //our official registered ICU context id

// The UDate value for DEFAULT DATETIME (the UDate value for daycount == mseconds == 0)
const double UDateDefault = -62135683200000;

// Read a DATETIME value into a UDate variable, returns UDateDefault if a DEFAULT DATETIME was read
UDate HSVM_DateTimeGetUnicode(HSVM *hsvm, HSVM_VariableId id);

// Write a UDate value into a DATETIME variable
void HSVM_DateTimeSetUnicode(HSVM *hsvm, HSVM_VariableId id, UDate value);

// Read a STRING value into a UnicodeString
UnicodeString HSVM_StringGetUnicode(HSVM *hsvm, HSVM_VariableId id);

// Write a UnicodeString into a STRING variable
void HSVM_StringSetUnicode(HSVM *hsvm, HSVM_VariableId id, UnicodeString const &value);

} // End of namespace ICU
} // End of namespace HareScript

#endif
