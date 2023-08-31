import { HareScriptVM } from "./wasm-hsvm";
import { HSVMVar } from "./wasm-hsvmvar";
import { HSVM_VariableId } from "wh:internal/whtree/lib/harescript-interface";

export interface HSCallsProxy {
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}

export type HSVMObject = HSVMObjectWrapper & HSCallsProxy;

export type HSVMLibrary = HSCallsProxy;

export function argsToHSVMVar(vm: HareScriptVM, args: unknown[]): HSVMVar[] {

  const funcargs: HSVMVar[] = [];
  for (const arg of args) {
    const newvar = vm.allocateVariable();
    newvar.setJSValue(arg);
    funcargs.push(newvar);
  }
  return funcargs;
}

export class HSVMObjectWrapper {
  $vm;
  $objid;

  constructor(vm: HareScriptVM, objid: HSVM_VariableId) {
    this.$vm = vm;
    this.$objid = vm.wasmmodule._HSVM_AllocateVariable(vm.hsvm);
    vm.wasmmodule._HSVM_CopyFrom(vm.hsvm, this.$objid, objid);
  }

  async $get(prop: string) {
    const proxycolumnid = this.$vm.getColumnId(prop);
    if (!this.$vm.wasmmodule._HSVM_ObjectMemberExists(this.$vm.hsvm, this.$objid, proxycolumnid))
      throw new Error(`No such member or property '${prop}' on HareScript object`);

    const receiver = this.$vm.wasmmodule._HSVM_AllocateVariable(this.$vm.hsvm);
    this.$vm.wasmmodule._HSVM_ObjectMemberCopy(this.$vm.hsvm, this.$objid, proxycolumnid, receiver, /*skipaccess=*/1);
    const retval = new HSVMVar(this.$vm, receiver).getJSValue();
    this.$vm.wasmmodule._HSVM_DeallocateVariable(this.$vm.hsvm, receiver);
    return retval;
  }

  async $invoke(name: string, args: unknown[]) {
    const funcargs = argsToHSVMVar(this.$vm, args);
    const result = await this.$vm.callWithHSVMVars(name, funcargs, this.$objid);
    return result ? result.getJSValue() : undefined;
  }
}

///Proxies an object living in the HSVM
export class HSVMObjectProxy {
  get(target: HSVMObjectWrapper, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;
    if (prop in target)
      return (target as unknown as Record<string, unknown>)[prop];

    return (...args: unknown[]) => target.$invoke(prop, args);
  }
}


export class HSVMLibraryProxy {
  private readonly vm: HareScriptVM;
  private readonly lib: string;

  constructor(vm: HareScriptVM, lib: string) {
    this.vm = vm;
    this.lib = lib;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  ///JavaScript supporting invoke (TODO detect HSVM Vars and copyfrom them?)
  async invoke(name: string, args: unknown[]) {
    const funcargs = argsToHSVMVar(this.vm, args);

    const result = await this.vm.callWithHSVMVars(this.lib + "#" + name, funcargs);
    return result ? result.getJSValue() : undefined;
  }
}

export class HSVMObjectCache {
  finalizer: FinalizationRegistry<{
    varid: HSVM_VariableId;
    objid: number;
  }>;
  cachedobjects = new Map<number, WeakRef<HSVMObject>>;
  nextcachedobjectid = 53000;
  vm;

  constructor(vm: HareScriptVM) {
    this.vm = vm;
    this.finalizer = new FinalizationRegistry((finalizedata) => this.cleanupObject(finalizedata));
  }

  cleanupObject(finalizedata: { varid: HSVM_VariableId }) {
    ///HSVMObjectWrapper allocated a variable to hold the object id, so we need to deallocate it
    this.vm.wasmmodule._HSVM_DeallocateVariable(this.vm.hsvm, finalizedata.varid);
  }

  ensureObject(id: HSVM_VariableId): HSVMObject {
    //Do we already have a proxy for this object?
    const proxycolumnid = this.vm.getColumnId("^$proxyid");
    if (this.vm.wasmmodule._HSVM_ObjectMemberExists(this.vm.hsvm, id, proxycolumnid)) {
      const proxyvar = this.vm.wasmmodule._HSVM_ObjectMemberRef(this.vm.hsvm, id, proxycolumnid, /*skipaccess=*/1);
      const proxyvarid = this.vm.wasmmodule._HSVM_IntegerGet(this.vm.hsvm, proxyvar);
      const existingproxy = this.cachedobjects.get(proxyvarid)?.deref();
      if (existingproxy)
        return existingproxy;

      this.cachedobjects.delete(proxyvarid);
    }

    //Assign new proxy number
    const objid = ++this.nextcachedobjectid;
    const proxy = new HSVMObjectProxy;
    const obj: HSVMObject = new Proxy(new HSVMObjectWrapper(this.vm, id), proxy) as HSVMObject;
    this.cachedobjects.set(objid, new WeakRef(obj));
    this.finalizer.register(obj, { varid: obj.$objid, objid });

    const intvar = this.vm.wasmmodule._HSVM_AllocateVariable(this.vm.hsvm);
    this.vm.wasmmodule._HSVM_IntegerSet(this.vm.hsvm, intvar, objid);
    this.vm.wasmmodule._HSVM_ObjectMemberInsert(this.vm.hsvm, id, proxycolumnid, intvar, /*isprivate=*/1, /*skipaccess=*/1);
    this.vm.wasmmodule._HSVM_DeallocateVariable(this.vm.hsvm, intvar);

    return obj;
  }

  countObjects() {
    //Remove expired entries from the map
    this.cachedobjects.forEach((weakref, key, map) => {
      if (!weakref.deref()) map.delete(key);
    });
    return this.cachedobjects.size;
  }
}
