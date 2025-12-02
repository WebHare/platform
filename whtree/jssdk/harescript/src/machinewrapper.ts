import { debugFlags } from "@webhare/env";
import type { CommonLibraries, CommonLibraryType } from "./commonlibs";
import { type HareScriptVM, type StartupOptions, allocateHSVM } from "./wasm-hsvm";
import { type HSVMCallsProxy, HSVMLibraryProxy, type HSVMObject } from "./wasm-proxies";

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
  currentgroup: string;
  done: Promise<void>;

  constructor(vm: HareScriptVM, script: string) {
    this.vm = new WeakRef(vm);
    this.currentgroup = vm.currentgroup;
    if (debugFlags.vmlifecycle) //also report whether this VM's mainloop will block
      console.log(`[${vm.currentgroup}] HSVMWrapper created, mainloop: ${vm.implicitLifetime ? "non-blocking" : "retaining"}`);
    vmfinalizer.register(this, vm, this);
    this.done = vm.run(script);
  }

  _getHSVM() {
    const vm = this.vm?.deref();
    if (!vm)
      throw new Error("VM has already been disposed");
    return vm;
  }

  ///Signal the VM to shutdown, invalidating the HSVMWrapper
  async dispose() {
    if (debugFlags.vmlifecycle)
      console.trace(`[${this.currentgroup}] VM terminating because of dispose()`);
    vmfinalizer.unregister(this);
    this.vm?.deref()?.shutdown();
    try {
      await this.done;
    } catch (e) {
      if (debugFlags.vmlifecycle) //Fix losing error information when a HS engine invoked from CallJS crashes
        console.trace(`[${this.currentgroup}] Absorbing a throw from done() as we can't do anything about it during dispose()`, e);
    }
    this.vm = null;
  }

  loadlib<Lib extends keyof CommonLibraries>(name: Lib): CommonLibraryType<Lib>;
  loadlib(name: string): HSVMCallsProxy;

  loadlib(name: string): HSVMCallsProxy {
    const proxy = new Proxy({}, new HSVMLibraryProxy(this, name)) as HSVMCallsProxy;
    return proxy;
  }

  makeObject(name: string, ...params: unknown[]): Promise<HSVMObject> {
    return this.loadlib("wh::system.whlib").MakeObject(name, ...params);
  }

  [Symbol.asyncDispose]() {
    return this.dispose();
  }
}

export async function runScript(script: string, options?: StartupOptions) {
  const vm = await allocateHSVM(options || {});
  return new HSVMWrapper(vm, script);
}

export async function createVM(options?: StartupOptions) {
  const vm = await allocateHSVM(options || {});
  const wrapper = new HSVMWrapper(vm, "mod::system/scripts/internal/eventloop.whscr");
  wrapper.done.catch(e => {
    if (debugFlags.vmlifecycle)
      console.log(`[${vm.currentgroup}] Eventloop has shut down with an error`, e);
    //and ignore. presumably our caller invoked something that caused the VM to abort and also has the error information in the rejection of that call
  });
  return wrapper;
}

function shutdownHSVM(vm: HareScriptVM) {
  if (debugFlags.vmlifecycle)
    console.log(`[${vm.currentgroup}] shutdownHSVM (${vm.__isShutdown() ? "active" : "already shutdown"}}`);
  if (!vm.__isShutdown())
    vm.shutdown();
}
