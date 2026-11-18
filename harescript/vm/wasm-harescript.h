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

void EMSCRIPTEN_KEEPALIVE InjectEvent(HSVM *vm, const char *name, uint8_t const *payloadstart, int32_t payloadlen);

typedef void (*EventCallback)(const char *name, const void *payload, unsigned payloadlength, bool local);

void EMSCRIPTEN_KEEPALIVE SetEventCallback(EventCallback callback);

bool EMSCRIPTEN_KEEPALIVE HasEnvironmentOverride(HSVM *hsvm);

void EMSCRIPTEN_KEEPALIVE GetEnvironment(HSVM *hsvm, HSVM_VariableId id_set);

void EMSCRIPTEN_KEEPALIVE SetEnvironment(HSVM *hsvm, HSVM_VariableId data);

emscripten::EM_VAL EMSCRIPTEN_KEEPALIVE GetLoadedLibrariesInfo(HSVM *hsvm, bool onlydirectloaded);

bool EMSCRIPTEN_KEEPALIVE GetAdhocCacheKeyData(HSVM *hsvm, const char **library, uint64_t *modtime, HSVM_VariableId cachetag, const char **store_hash);

const void * EMSCRIPTEN_KEEPALIVE WriteMarshalPacket(HSVM *vm, HSVM_VariableId var, bool allow_disk_paths, emscripten::EM_VAL stats_handle);

void EMSCRIPTEN_KEEPALIVE ReadMarshalPacket(HSVM *vm, HSVM_VariableId var, uint8_t *start, uint8_t *end);

bool EMSCRIPTEN_KEEPALIVE GetEventCollectorSignalled(HSVM *hsvm, int32_t eventcollector);

const char * EMSCRIPTEN_KEEPALIVE GetVMStackTrace(HSVM *hsvm);

emscripten::EM_VAL EMSCRIPTEN_KEEPALIVE GetMessageList(HSVM *vm, bool with_trace);

/* Debugger support for the TypeScript debug agent (whtree/jssdk/harescript/src/wasm-debugger.ts). The VM must not be
   running instructions: it must be waiting (eg in an async external function) or stopped by the debugger. The results are
   built in id_set, a variable of the same VM. */

/// Status of the VM: stacktrace (with code and stack positions), stacksize, statistics and errors
void EMSCRIPTEN_KEEPALIVE DebugGetStatus(HSVM *hsvm, HSVM_VariableId id_set);

/// Variables, like the native debugger's 'getvariables': requests is a record array with id and optionally min and max
void EMSCRIPTEN_KEEPALIVE DebugGetVariables(HSVM *hsvm, HSVM_VariableId requests, HSVM_VariableId id_set);

/// Loaded libraries (liburi, compile_id, sourcetime, globalvarlocation)
void EMSCRIPTEN_KEEPALIVE DebugGetLibraries(HSVM *hsvm, HSVM_VariableId id_set);

/// Debug info of a loaded library (found, compile_id, debuginfo_compressed, sourcemap)
void EMSCRIPTEN_KEEPALIVE DebugGetDebugInfo(HSVM *hsvm, const char *liburi, HSVM_VariableId id_set);

/// Open handles
void EMSCRIPTEN_KEEPALIVE DebugGetHandleList(HSVM *hsvm, HSVM_VariableId id_set);

/// Switch function profiling on or off, optionally resetting the profile
void EMSCRIPTEN_KEEPALIVE DebugSetFunctionProfiling(HSVM *hsvm, bool enable, bool reset);

/// Function profile, like __INTERNAL_GetRawFunctionProfile
void EMSCRIPTEN_KEEPALIVE DebugGetFunctionProfile(HSVM *hsvm, HSVM_VariableId id_set);

/** Set the breakpoints: config has breakpoints (liburi, compile_id, codeptr, stacksize, manual), minstacksize, maxstacksize
    and breakonexception. Running code picks up the change when it calls or returns from a function. */
void EMSCRIPTEN_KEEPALIVE DebugSetBreakpoints(HSVM *hsvm, HSVM_VariableId config);

/** Mark the VM as attached to a debugger (or not). While attached, the VM runs in debug mode and gives the debugger a
    chance to run every so often, so a busy VM can be paused too */
void EMSCRIPTEN_KEEPALIVE DebugSetAttached(HSVM *hsvm, bool attached);

} // extern "C"

#endif
