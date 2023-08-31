import { ensureScopedResource, getScopedResource } from "@webhare/services/src/codecontexts";
import { HSVMCallsProxy, argsToHSVMVar } from "./wasm-proxies";
import { HareScriptVM, allocateHSVM } from "./wasm-hsvm";
import { CommonLibraries, CommonLibraryType } from "./commonlibs";

const HSVMSymbol = Symbol("HSVM");

async function allocateCodeContextHSVM() {
  const vm = await allocateHSVM();
  await vm.loadlib("mod::system/lib/database.whlib").openPrimary(); //JS has prepared it anwyway, so open it
  return vm;
}

export function getCodeContextHSVM(): Promise<HareScriptVM> | undefined {
  return getScopedResource<Promise<HareScriptVM>>(HSVMSymbol);
}
export function ensureCodeContextHSVM(): Promise<HareScriptVM> {
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
    const vm = await ensureCodeContextHSVM();
    const funcargs = argsToHSVMVar(vm, args);

    const result = await vm.callWithHSVMVars(this.lib + "#" + name, funcargs);
    return result ? result.getJSValue() : undefined;
  }
}

export function loadlib<Lib extends keyof CommonLibraries>(name: Lib): CommonLibraryType<Lib>;
export function loadlib(name: string): HSVMCallsProxy;

/** Loads a stub to access a library in the then current code context VM. */
export function loadlib(name: string): HSVMCallsProxy {
  const proxy = new Proxy({}, new ContextLibraryProxy(name)) as HSVMCallsProxy;
  return proxy;
}
