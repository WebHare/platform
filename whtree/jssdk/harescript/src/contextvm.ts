import { ensureScopedResource, getScopedResource, releaseScopedResource } from "@webhare/services/src/codecontexts";
import { type HSVMCallsProxy, type HSVMObject, invokeOnVM } from "./wasm-proxies";
import { type HSVMWrapper, createVM } from "./machinewrapper";
import { HSVMSymbol } from "./wasm-support";

async function allocateCodeContextHSVM() {
  /// implicitLifetime ensures the eventloop won't keep the process alive as the global root context (and its HSVM) is never discarded
  const vm = await createVM({ implicitLifetime: true });
  await vm.loadlib("mod::system/lib/database.whlib").openPrimary(); //JS has prepared it anwyway, so open it
  return vm;
}

export function getCodeContextHSVM(): Promise<HSVMWrapper> | undefined {
  return getScopedResource<Promise<HSVMWrapper>>(HSVMSymbol);
}
export function ensureCodeContextHSVM(): Promise<HSVMWrapper> {
  return ensureScopedResource(HSVMSymbol, () => allocateCodeContextHSVM(), async vm => {
    return (await vm).dispose();
  });
}

/** Get rid of any running context HSVM (the one used for global loadlib and MakeObject) */
export function releaseCodeContextHSVM() {
  releaseScopedResource(HSVMSymbol).then(() => { }, () => { });
}

class ContextLibraryProxy {
  private readonly lib: string;

  constructor(lib: string) {
    this.lib = lib;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  ///JavaScript supporting invoke
  async invoke(name: string, args: unknown[]) {
    return invokeOnVM((await ensureCodeContextHSVM())._getHSVM(), this.lib, name, args);
  }
}

/** Loads a stub to access a library in the then current code context VM. */
export function loadlib(name: string): HSVMCallsProxy {
  const proxy = new Proxy({}, new ContextLibraryProxy(name)) as HSVMCallsProxy;
  return proxy;
}

/** Implements HS MakeObject */
export function makeObject(name: string, ...params: unknown[]): Promise<HSVMObject> {
  return loadlib("wh::system.whlib").MakeObject(name, ...params);
}
