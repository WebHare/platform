#ifndef blex_webhare_harescript_hsvm_debugsupport
#define blex_webhare_harescript_hsvm_debugsupport

#include "hsvm_context.h"

/* Debugger support shared by the C++ debugger (hsvm_debugger.cpp, native only) and the debugger for VMs running
   in the WASM engine (wasm-harescript.cpp, driven from TypeScript)
*/

namespace HareScript
{

/// Access to variable ids for the debugger functions below (VarMemory's id mapping is protected)
class DebugSupport
{
    public:
        static bool IsOnHeap(StackMachine const &stackm, VarId id) { return stackm.IsOnHeap(id); }
        static uint32_t MapHeapId(StackMachine const &stackm, VarId id) { return stackm.MapHeapId(id); }
        static uint32_t MapStackId(StackMachine const &stackm, VarId id) { return stackm.MapStackId(id); }
        static VarId UnmapHeapId(StackMachine const &stackm, uint32_t id) { return stackm.UnmapHeapId(id); }
};

/** Get the range of items of a value to return
    @param stackm Stack machine of the VM receiving the value
    @param id_set Value record being built (gets length, min and max cells)
    @param req Request record with optional min/max cells (0 if none)
    @param defaultmax Max to use when the request doesn't specify one
    @param len Total number of items
*/
std::pair< int64_t, int64_t > GetDebugValueMinMax(StackMachine &stackm, ColumnNameCache const &cn_cache, VarId id_set, VarId req, int64_t defaultmax, int64_t len);

/** Describe a variable of a VM for the debugger: type, id, (part of) the value and of nested values
    @param vm VM to build the description in
    @param id_set Variable to store the description in
    @param source_vm VM the variable lives in (may be the same as vm)
    @param source_id The variable
    @param req Request record with optional min/max cells (0 if none)
    @param depth How deep to describe nested values
*/
void RetrieveDebugValue(VirtualMachine *vm, VarId id_set, VirtualMachine *source_vm, VarId source_id, VarId req, unsigned depth);

/** Get the variable id for a debugger variable id (stack position, or heap id with bit 31 set)
    @return The variable, or 0 if the id is invalid
*/
VarId GetDebugVariable(VirtualMachine *target_vm, uint32_t id);

/** Add the debug info (cells found, compile_id, debuginfo_compressed, sourcemap) of a library as loaded by a VM to a record
    @param vm VM to build the record in
    @param id_set Record to add the cells to
    @param target_vm VM that loaded the library
    @param liburi Library
*/
void EncodeLibraryDebugInfo(VirtualMachine *vm, VarId id_set, VirtualMachine *target_vm, std::string const &liburi);

/** A breakpoint, as set by the debugger */
struct DebugBreakpointSpec
{
        std::string liburi;
        Blex::DateTime compile_id;
        uint32_t codeptr;
        int32_t stacksize;
        bool manual;
};

/** Resolve breakpoints to code positions in the libraries a VM has loaded and store them in the debugger data of its group.
    Breakpoints in libraries that aren't loaded or have another compile id are ignored
*/
void ApplyDebugBreakpoints(VMGroup &vmgroup, VirtualMachine *target_vm, std::vector< DebugBreakpointSpec > const &breakpoints, unsigned min_stack, unsigned max_stack, bool break_on_exception);

} // End of namespace HareScript

#endif
