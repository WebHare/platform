// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/harescript" {
}

export type { HSVMObject } from "./wasm-proxies";
export { HareScriptLibraryOutOfDateError } from "./wasm-hsvm";
export { loadlib, makeObject } from "./contextvm";
export { runScript, createVM, type HSVMWrapper } from "./machinewrapper";
