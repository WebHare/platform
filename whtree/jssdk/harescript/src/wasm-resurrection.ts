import { throwError } from "@webhare/std";
import { HSVMVar } from "./wasm-hsvmvar";

export function resurrectBuffer(obj: HSVMVar) {
  /* resurrects
  PUBLIC STATIC OBJECTTYPE Buffer
  <
    STRING bytes;
  >; */
  const bytes_columnid = obj.vm.getColumnId("BYTES");
  const bytes_column = obj.vm.wasmmodule._HSVM_ObjectMemberRef(obj.vm.hsvm, obj.id, bytes_columnid, /*skipaccess=*/1);
  return new HSVMVar(obj.vm, bytes_column).getStringAsBuffer();
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
