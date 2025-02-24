import { throwError } from "@webhare/std";
import type { HSVMVar } from "./wasm-hsvmvar";

export function resurrectBuffer(obj: HSVMVar) {
  /* resurrects
  PUBLIC STATIC OBJECTTYPE Buffer
  <
    STRING bytes;
  >; */
  const bytes_columnid = obj.vm.getColumnId("BYTES");
  const bytes_column = obj.vm.wasmmodule._HSVM_ObjectMemberRef(obj.vm.hsvm, obj.id, bytes_columnid, /*skipaccess=*/1);
  if (!bytes_column)
    throw new Error(`Could not recreate Buffer object due to missing column BYTES`);
  return obj.vm.wrapExistingVariableId(bytes_column).getStringAsBuffer();
}

export function resurrectPromise(obj: HSVMVar) {
  //We may need to reconsider this... injecting WaitForPromise on the stack may deadlock VMs if they need to execute other microtasks
  return obj.vm.callWithHSVMVars("wh::internal/hsservices.whlib#WaitForPromise", [obj]);
}

export function resurrectJSProxy(obj: HSVMVar) {
  const id = obj.getMemberRef("^$OBJECTID").getString();
  return obj.vm.proxies.get(id) ?? throwError(`Could not find JSProxy with id ${id}`);
}

export function resurrect(type: string, obj: HSVMVar) {
  const resurrectmap: Record<string, (obj: HSVMVar) => unknown> = {
    "Buffer": resurrectBuffer,
    "Promise": resurrectPromise,
    "JSProxy": resurrectJSProxy,
  };

  if (resurrectmap[type])
    return resurrectmap[type](obj);
  throw new Error(`Unrecognized WASM type '${type}'`);
}
