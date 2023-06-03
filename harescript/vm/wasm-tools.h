#if !defined(webhare_wasm_tools) && defined(__EMSCRIPTEN__)
#define webhare_wasm_tools

#include <string>

namespace WebHare {
namespace WASM {

std::string ConvertCharPtrAndDelete(char *ptr);

} // end namespace WASMTools
} // end namespace WebHare


#endif
