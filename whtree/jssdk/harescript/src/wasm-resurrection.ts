import { throwError } from "@webhare/std";
import type { HSVMVar } from "./wasm-hsvmvar";
import type { HareScriptVM } from "./wasm-hsvm";
import type { HSVMObjectWrapper } from "./wasm-proxies";
import { parseHSException } from "./wasm-support";

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

let promises: Map<number, PromiseWithResolvers<unknown>> | undefined;
let promisesCtr = 0;

export function resurrectPromise(obj: HSVMVar) {
  promises ??= new Map();
  const tsPromiseRef = obj.getMemberRef("TSPROMISE");
  let tsPromiseId = tsPromiseRef.getInteger();
  if (tsPromiseId) {
    const pobj = promises.get(tsPromiseId);
    if (!pobj)
      throw new Error(`Could not find promise with id ${tsPromiseId}`);
    return pobj.promise;
  }
  tsPromiseId = ++promisesCtr;
  const pobj = Promise.withResolvers<unknown>();
  promises.set(tsPromiseId, pobj);
  tsPromiseRef.setInteger(tsPromiseId);
  const status = obj.getMemberRef("STATUS").getString();
  if (status) {
    const value = obj.getMemberRef("KEEPER").getCell("VALUE");
    if (status === "resolved")
      pobj.resolve(value);
    else if (status === "rejected")
      pobj.reject(parseHSException(value!)); // exceptions are never null
  } else if (promises.size === 1) {
    obj.vm.setKeepaliveLock("resurrectedPromise", true);
  }
  return pobj.promise;
}

/** Called by HS when a promise with a set tspromise is fulfilled */
export function fulfillResurrectedPromise(hsvm: HareScriptVM, { id, status, value }: { id: number; status: "resolved" | "rejected"; value: unknown }) {
  if (!promises)
    throw new Error(`Could not find promise with id ${id}`);
  const pobj = promises?.get(id);
  if (!pobj)
    throw new Error(`Could not find promise with id ${id}`);
  promises.delete(id);
  if (!promises.size)
    hsvm.setKeepaliveLock("resurrectedPromise", false);
  if (status === "resolved")
    pobj.resolve(value);
  else if (status === "rejected")
    pobj.reject(parseHSException((value as HSVMObjectWrapper).$obj));
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
