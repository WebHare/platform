import { debugFlags } from "@webhare/env";
import { CommonLibraries, CommonLibraryType } from "./commonlibs";
import { HareScriptVM, StartupOptions, allocateHSVM } from "./wasm-hsvm";
import { HSVMCallsProxy, HSVMLibraryProxy } from "./wasm-proxies";

const vmfinalizer = new FinalizationRegistry<HareScriptVM>(shutdownHSVM);

//compatibility layer between AllocateVM and OpenVM
export interface HSVM_HSVMSource {
  _getHSVM(): HareScriptVM;
}

/* HSVMWrapper is a 'weak' wrapper for the HareScriptVM so we can detect when a JS user has forgotten about a HSVM.
   A HareScriptVM in an eventloop cannot be garbage collected (it's self-referential through setTimeout, and there are probably more issues)
   so we will explicitly destroy the HareScriptVM as soon as the wrapper goes out of scope and is garbage collected.

   Any proxies (eg loadlib, objects) returned to JS users should hold a reference to us. We intend to keep the HareScriptVM alive as long
   as someone can still refer to it (through eg loadlib) or is waiting for a function call (actually: its promise) to resolve. We do not care
   whether the HareScriptVM itself has outstanding requests (but a runscripting user should wait for the 'done' promise so it knows when the
   initfunction has completed) */
export class HSVMWrapper implements HSVM_HSVMSource {
  vm: WeakRef<HareScriptVM> | null;

  constructor(vm: HareScriptVM) {
    this.vm = new WeakRef(vm);
    if (debugFlags.vmlifecycle)
      console.log(`[${vm.currentgroup}] HSVMWrapper created`);
    vmfinalizer.register(this, vm, this);
  }

  _getHSVM() {
    const vm = this.vm?.deref();
    if (!vm)
      throw new Error("VM has already been disposed");
    return vm;
  }

  ///Signal the VM to shutdown, invalidating the HSVMWrapper
  dispose() {
    vmfinalizer.unregister(this);
    this.vm?.deref()?.shutdown();
    this.vm = null;
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}

export class CallableVMWrapper extends HSVMWrapper {
  loadlib<Lib extends keyof CommonLibraries>(name: Lib): CommonLibraryType<Lib>;
  loadlib(name: string): HSVMCallsProxy;

  loadlib(name: string): HSVMCallsProxy {
    const proxy = new Proxy({}, new HSVMLibraryProxy(this, name)) as HSVMCallsProxy;
    return proxy;
  }
}

export class RunScriptVMWrapper extends HSVMWrapper {
  done: Promise<void>;

  constructor(script: string, vm: HareScriptVM) {
    super(vm);
    this.done = vm.run(script);
  }
}

export async function runScript(script: string, options?: StartupOptions) {
  const vm = await allocateHSVM(options || {});
  return new RunScriptVMWrapper(script, vm);
}

export async function createVM(options?: StartupOptions) {
  const vm = await allocateHSVM(options || {});
  vm.run("mod::system/scripts/internal/eventloop.whscr");
  return new CallableVMWrapper(vm);
}

function shutdownHSVM(vm: HareScriptVM) {
  if (debugFlags.vmlifecycle)
    console.log(`[${vm.currentgroup}] shutdownHSVM`);
  vm.shutdown();
}
