import { throwError } from "@webhare/std";
import type { HSVMVar } from "./wasm-hsvmvar";
import type { HareScriptVM } from "./wasm-hsvm";
import type { HSVMObjectWrapper } from "./wasm-proxies";
import { parseHSException } from "./wasm-support";
import { VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { parseTrace } from "@webhare/js-api-tools";
import { debugFlags } from "@webhare/env";

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
let localPromises: Map<number, WeakRef<Promise<unknown>>> | undefined;
let promisesCtr = 0;

export function resurrectPromise(obj: HSVMVar) {
  const tsPromiseRef = obj.getMemberRef("TSPROMISE");
  let tsPromiseId = tsPromiseRef.getInteger();
  const localPromiseWeakRef = localPromises?.get(tsPromiseId);
  if (localPromiseWeakRef) {
    const localPromise = localPromiseWeakRef.deref();
    if (localPromise)
      return localPromise;
    localPromises!.delete(tsPromiseId);
  }
  promises ??= new Map();
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

let js_promise_id_counter = 0;

export function createHSPromise(obj: HSVMVar) {
  obj.setNewEmptyObject();
  if (!obj.extendObject("wh::promise.whlib#PromiseBase"))
    throw new Error("Could not extend object with PromiseBase");

  // Constructor code
  obj.getMemberRef("^$WASMTYPE").setString("Promise");
  // Use negative numbers for promise constructed in JS
  obj.getMemberRef("PROMISE_ID").setInteger64(--js_promise_id_counter);
}

export async function resolveHSPromise(promise: HSVMVar, status: string, resolveValue: unknown) {
  const varGen = promise.vm.allocateVariable();
  const varStatus = promise.vm.allocateVariable();
  const varResult = promise.vm.allocateVariable();
  const varOriginPromise = promise.vm.allocateVariable();
  varGen.setInteger(0);
  varStatus.setString(status);
  if (status === "rejected" && resolveValue instanceof Error)
    setHSException(varResult, resolveValue);
  else
    varResult.setJSValue(resolveValue);
  varOriginPromise.setDefault(VariableType.Object);
  await promise.vm.callWithHSVMVars("RESOLVEINTERNAL", [varGen, varStatus, varResult, varOriginPromise], promise.id, undefined, { skipAccess: true });
}

export function setHSPromiseProxy(orgPromise: HSVMVar, jsPromise: Promise<unknown>) {
  createHSPromise(orgPromise);
  const promise = orgPromise.vm.allocateVariableCopy(orgPromise.id);

  const tsPromiseId = -(++promisesCtr);
  promise.getMemberRef("TSPROMISE").setInteger(tsPromiseId);
  (localPromises ??= new Map()).set(tsPromiseId, new WeakRef(jsPromise));

  // Convert resolution to HS - but on failure (and even the conversion may fail!) transfer the rejection instead
  jsPromise.then(value => resolveHSPromise(promise, "resolved", value)
  ).catch(reason => resolveHSPromise(promise, "rejected", reason)
  ).finally(() => promise.dispose());
}

export function setHSException(obj: HSVMVar, e: Error) {
  if (obj.vm.__isShuttingdown())
    return; //don't bother, looks like the exception was already fatal to the VM

  obj.setNewEmptyObject();
  if (!obj.extendObject("wh::system.whlib#Exception")) {
    //this happens when wh::system.whlib isn't loaded anymore, and generally happens to exceptions during VM teardown.
    //we'll just set the abort flag and be done with the vm
    if (debugFlags.vmlifecycle) {
      console.log(`[${obj.vm.currentgroup}] Terminating VM because we can't send a proper exception`);
      console.trace();
    }
    obj.vm.shutdown();
    return;
  }

  obj.getMemberRef("WHAT").setString(e.message);
  const trace = obj.getMemberRef("PVT_TRACE");
  trace.setDefault(VariableType.RecordArray);
  for (const item of parseTrace(e))
    trace.arrayAppend().setJSValue(item);
}
