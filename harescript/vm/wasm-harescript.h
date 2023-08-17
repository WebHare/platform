#if !defined(webhare_wasm_harescript) && defined(__EMSCRIPTEN__)
#define webhare_wasm_harescript

#include "emscripten.h"

extern "C"
{

HSVM* EMSCRIPTEN_KEEPALIVE CreateHSVM();

void EMSCRIPTEN_KEEPALIVE RegisterHareScriptMacro(const char *name, unsigned id, bool async);

void EMSCRIPTEN_KEEPALIVE RegisterHareScriptFunction(const char *name, unsigned id, bool async);

void EMSCRIPTEN_KEEPALIVE ReleaseHSVM(HSVM *byebye);

} // extern "C"

#endif
