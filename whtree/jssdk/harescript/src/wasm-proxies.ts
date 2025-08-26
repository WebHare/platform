import { Marshaller, HareScriptType } from "@webhare/hscompat/src/hson";
import type { HSVM_HSVMSource } from "./machinewrapper";
import type { HareScriptVM, HSVM_VariableId } from "./wasm-hsvm";
import type { HSVMHeapVar, HSVMVar } from "./wasm-hsvmvar";
import { generateRandomId } from "@webhare/std";

export interface HSVMCallsProxy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- it's overhead to have to define the type whenever you invoke. But feel free to extend commonlibs.ts!
  [key: string]: (...args: unknown[]) => Promise<any>;
}

export type HSVMObject = HSVMObjectWrapper & HSVMCallsProxy;

export type HSVMLibrary = HSVMCallsProxy;

export function argsToHSVMVar(vm: HareScriptVM, args: unknown[]): HSVMHeapVar[] {

  const funcargs: HSVMHeapVar[] = [];
  for (const arg of args) {
    const newvar = vm.allocateVariable();
    newvar.setJSValue(arg);
    funcargs.push(newvar);
  }
  return funcargs;
}

export function cleanupHSVMCall(vm: HareScriptVM, args: HSVMHeapVar[], result: HSVMHeapVar | undefined) {
  for (const arg of args)
    arg.dispose();

  result?.dispose();
}

export class HSVMObjectWrapper {
  $obj: HSVMHeapVar;

  constructor(vm: HareScriptVM, objid: HSVM_VariableId) {
    this.$obj = vm.allocateVariable();
    vm.wasmmodule._HSVM_CopyFrom(vm.hsvm, this.$obj.id, objid);
  }

  [Marshaller] = {
    type: HareScriptType.Object,
    setValue: function (this: HSVMObjectWrapper, value: HSVMVar) {
      value.copyFrom(this.$obj);
    }
  };

  async $get<T = unknown>(prop: string): Promise<T> {
    const retvalholder = await this.$obj.getMember(prop);
    const retval = retvalholder.getJSValue();
    retvalholder.dispose();
    return retval as T;
  }

  async $set(prop: string, newValue: unknown): Promise<void> {
    await this.$obj.setMember(prop, newValue);
  }

  async $invoke(name: string, args: unknown[]) {
    const funcargs = argsToHSVMVar(this.$obj.vm, args);
    try {
      return await this.$obj.vm.callWithHSVMVars(name, funcargs, this.$obj.id);
    } finally {
      cleanupHSVMCall(this.$obj.vm, funcargs, undefined);
    }
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

export async function invokeOnVM(vm: HareScriptVM, lib: string, name: string, args: unknown[]) {
  //TODO detect HSVM Vars and copyfrom them?
  const funcargs = argsToHSVMVar(vm, args);

  const result = await vm.callWithHSVMVars(lib + "#" + name, funcargs);
  try {
    return result;
  } finally {
    cleanupHSVMCall(vm, funcargs, undefined);
  }
}

export class HSVMLibraryProxy {
  private readonly vm: HSVM_HSVMSource;
  private readonly lib: string;

  constructor(vm: HSVM_HSVMSource, lib: string) {
    this.vm = vm;
    this.lib = lib;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === "then") //do not appear like our object is a promise
      return undefined;

    return (...args: unknown[]) => this.invoke(prop, args);
  }

  ///JavaScript supporting invoke
  async invoke(name: string, args: unknown[]) {
    return invokeOnVM(this.vm._getHSVM(), this.lib, name, args);
  }
}

export class HSVMObjectCache {
  cachedobjects = new Map<number, WeakRef<HSVMObject>>;
  nextcachedobjectid = 53000;
  vm;

  constructor(vm: HareScriptVM) {
    this.vm = vm;
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
      this.vm.wasmmodule._HSVM_ObjectMemberDelete(this.vm.hsvm, id, proxycolumnid, /*skipaccess=*/1);
    }

    //Assign new proxy number
    const objid = ++this.nextcachedobjectid;
    const proxy = new HSVMObjectProxy;
    const obj: HSVMObject = new Proxy(new HSVMObjectWrapper(this.vm, id), proxy) as HSVMObject;
    this.cachedobjects.set(objid, new WeakRef(obj));

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

export class HSVMMarshallableOpaqueObject {
  private __hsvm_id = generateRandomId();

  constructor() {
  }

  [Marshaller] = {
    type: HareScriptType.Object,
    setValue: function (this: HSVMMarshallableOpaqueObject, value: HSVMVar) {
      const id = (this as unknown as { __hsvm_id: string }).__hsvm_id;
      const mod = value.vm._getHSVM().wasmmodule;
      mod._HSVM_ObjectInitializeEmpty(value.vm.hsvm, value.id);
      value.insertMember("^$WASMTYPE", "JSProxy", { isPrivate: true });
      value.insertMember("^$OBJECTID", id, { isPrivate: true });
      value.vm.proxies.set(id, this);
    }
  };
}
