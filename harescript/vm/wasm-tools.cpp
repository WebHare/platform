#include "wasm-tools.h"

namespace WebHare {
namespace WASM {

std::string ConvertCharPtrAndDelete(char *ptr)
{
        std::string retval(ptr);
        delete ptr;
        return retval;
}

} // end namespace WASMTools
} // end namespace WebHare

