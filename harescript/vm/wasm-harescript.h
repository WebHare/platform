#if !defined(webhare_wasm_harescript) && defined(__EMSCRIPTEN__)
#define webhare_wasm_harescript

/* do not include hsvm_dllinterface.h here, generate-wasm-interface.js doesn't like that */
#include "emscripten.h"
#include "emscripten/val.h"

extern "C"
{

HSVM* EMSCRIPTEN_KEEPALIVE CreateHSVM();

void EMSCRIPTEN_KEEPALIVE RegisterHareScriptMacro(const char *name, unsigned id, bool async);

void EMSCRIPTEN_KEEPALIVE RegisterHareScriptFunction(const char *name, unsigned id, bool async);

void EMSCRIPTEN_KEEPALIVE ReleaseHSVMResources(HSVM *vm);

void EMSCRIPTEN_KEEPALIVE ReleaseHSVM(HSVM *byebye);

int EMSCRIPTEN_KEEPALIVE CreateWASMOutputObject(HSVM *vm, emscripten::EM_VAL obj_handle, const char *type);

void EMSCRIPTEN_KEEPALIVE SetWASMOutputObjectReadSignalled(HSVM *vm, int id, bool readsignalled);

void EMSCRIPTEN_KEEPALIVE SetWASMOutputObjectWriteSignalled(HSVM *vm, int id, bool writesignalled);

void EMSCRIPTEN_KEEPALIVE CloseWASMOutputObject(HSVM *vm, int id);

void EMSCRIPTEN_KEEPALIVE InjectEvent(HSVM *vm, const char *name, const char *payloadstart, const char *payloadend);

typedef void (*EventCallback)(const char *name, const void *payload, unsigned payloadlength);

void EMSCRIPTEN_KEEPALIVE SetEventCallback(EventCallback callback);

bool EMSCRIPTEN_KEEPALIVE HasEnvironmentOverride(HSVM *hsvm);

void EMSCRIPTEN_KEEPALIVE GetEnvironment(HSVM *hsvm, HSVM_VariableId id_set);

void EMSCRIPTEN_KEEPALIVE SetEnvironment(HSVM *hsvm, HSVM_VariableId data);

void EMSCRIPTEN_KEEPALIVE GetLoadedLibrariesInfo(HSVM *hsvm, HSVM_VariableId id_set, bool onlydirectloaded);

bool EMSCRIPTEN_KEEPALIVE GetAdhocCacheKeyData(HSVM *hsvm, const char **library, uint64_t *modtime, HSVM_VariableId cachetag, const char **store_hash);

bool EMSCRIPTEN_KEEPALIVE GetEventCollectorSignalled(HSVM *hsvm, int32_t eventcollector);

} // extern "C"

#endif
