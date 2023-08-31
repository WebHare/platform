import { ensureScopedResource } from "@webhare/services/src/codecontexts";
import { HSCallsProxy, argsToHSVMVar } from "./wasm-proxies";
import { allocateHSVM } from "./wasm-hsvm";

const HSVMSymbol = Symbol("HSVM");

async function allocateCodeContextHSVM() {
  const vm = await allocateHSVM();
  await vm.loadlib("mod::system/lib/database.whlib").openPrimary(); //JS has prepaerd it anwyway, so open it
  return vm;
}

export function getCodeContextHSVM() {
  return ensureScopedResource(HSVMSymbol, () => allocateCodeContextHSVM());
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

  ///JavaScript supporting invoke (TODO detect HSVM Vars and copyfrom them?)
  async invoke(name: string, args: unknown[]) {
    const vm = await getCodeContextHSVM();
    const funcargs = argsToHSVMVar(vm, args);

    const result = await vm.callWithHSVMVars(this.lib + "#" + name, funcargs);
    return result ? result.getJSValue() : undefined;
  }
}

/** Loads a stub to access a library in the then current code context VM. */
export function loadlib(name: string): HSCallsProxy {
  const proxy = new Proxy({}, new ContextLibraryProxy(name)) as HSCallsProxy;
  return proxy;
}
