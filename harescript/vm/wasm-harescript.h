#if !defined(webhare_wasm_harescript) && defined(__EMSCRIPTEN__)
#define webhare_wasm_harescript

#include "emscripten.h"

extern "C"
{

HSVM* EMSCRIPTEN_KEEPALIVE CreateHSVM();

void EMSCRIPTEN_KEEPALIVE RegisterHarescriptMacro(const char *name, unsigned id, bool async);

void EMSCRIPTEN_KEEPALIVE RegisterHarescriptFunction(const char *name, unsigned id, bool async);

} // extern "C"

#endif
