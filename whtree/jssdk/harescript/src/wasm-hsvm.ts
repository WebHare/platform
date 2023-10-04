import type { HSVM, HSVM_ColumnId, HSVM_VariableId, HSVM_VariableType, Ptr, StringPtr } from "../../../lib/harescript-interface";
import { IPCMarshallableData, SimpleMarshallableRecord, VariableType, readMarshalData, writeMarshalData } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { DeferredPromise, createDeferred, decodeString } from "@webhare/std";

// @ts-ignore: implicitly has an `any` type
import createModule from "../../../lib/harescript";
import { registerBaseFunctions } from "./wasm-hsfunctions";
import { WASMModule } from "./wasm-modulesupport";
import { HSVMHeapVar, HSVMVar } from "./wasm-hsvmvar";
import { HSVMCallsProxy, HSVMLibraryProxy, HSVMObjectCache, argsToHSVMVar, cleanupHSVMCall } from "./wasm-proxies";
import { registerPGSQLFunctions } from "@mod-system/js/internal/whdb/wasm_pgsqlprovider";
import { Mutex } from "@webhare/services";
import { CommonLibraries, CommonLibraryType } from "./commonlibs";
import { debugFlags } from "@webhare/env";
import bridge, { BridgeEvent } from "@mod-system/js/internal/whmanager/bridge";
import { rootstorage, runOutsideCodeContext } from "@webhare/services/src/codecontexts";
import { type HSVM_HSVMSource } from "./machinewrapper";
import { encodeIPCException } from "@mod-system/js/internal/whmanager/ipc";


export interface StartupOptions {
  /// Script to run. If not specified an eventloop is started
  script?: string;
  consoleArguments?: string[];
  /// A hook that is executed when the main script is done but before it is cleaned up. HSVM/wasmmodule state should still be accessible
  onScriptDone?: (exception: Error | null) => void | Promise<void>;
  __unrefMainTimer?: boolean;
}

export type MessageList = Array<{
  iserror: boolean;
  iswarning: boolean;
  istrace: boolean;
  filename: string;
  line: number;
  col: number;
  code: number;
  param1: string;
  param2: string;
  func: string;
  message: string;
}>;

// interface TraceElement {
//   filename: string;
//   line: number;
//   col: number;
//   func: string;
// }

///Pool of unused engines.
const enginePool = new Array<WASMModule>;

export type JSBlobTag = { pg: string } | null;

// function addHareScriptTrace(trace: TraceElement[], err: Error) {
//   const stacklines = err.stack?.split("\n") || [];
//   const tracelines = trace.map(e =>
//     `    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("\n");
//   err.stack = (stacklines[0] ? stacklines[0] + "\n" : "") + tracelines + '\n' + (stacklines.slice(1).join("\n"));
// }

function parseError(line: string) {
  const errorparts = line.split("\t");
  if (errorparts.length < 8)
    throw new Error("Unrecognized error string returned by HareScript compiler");

  return {
    iserror: !errorparts[0] || !errorparts[0].startsWith("W"),
    line: parseInt(errorparts[1]),
    col: parseInt(errorparts[2]),
    filename: errorparts[3],
    code: parseInt(errorparts[4]),
    msg1: errorparts[5],
    msg2: errorparts[6],
    message: decodeString(errorparts[7], 'html')
  };
}

///compile library, return raw fetch result
export async function recompileHarescriptLibraryRaw(uri: string, options?: { force: boolean }) {
  try {
    // console.log(`recompileHarescriptLibrary`, uri);

    const res = await fetch(`http://127.0.0.1:${getFullConfigFile().baseport + 1}/compile/${encodeURIComponent(uri)}`, {
      headers: {
        ...(options?.force ? { "X-WHCompile-Force": "true" } : {})
      }
    });
    // console.log({ res });

    if (res.status === 200 || res.status === 403) {
      return await res.text();
    }
    throw new Error(`Could not contact HareScript compiler, status code ${res.status}`);
  } catch (e) {
    console.log({ recompileerror: e });
    throw e;
  }
}

class TransitionLock {
  vm: HareScriptVM;
  intoHareScript: boolean;
  trace: Error;
  title: string;
  constructor(vm: HareScriptVM, intoHareScript: boolean, title: string) {
    this.vm = vm;
    this.intoHareScript = intoHareScript;
    this.title = title;
    this.trace = new Error(`transition into ${this.intoHareScript ? "HareScript" : "TypeScript"} calling ${JSON.stringify(title)}`);
    const currentTransition: TransitionLock = vm.transitionLocks[vm.transitionLocks.length - 1];
    if (currentTransition && !currentTransition.intoHareScript !== intoHareScript) {
      throw new Error(`Missing transition registration when calling ${JSON.stringify(title)}, this transition is ${intoHareScript ? "js->hs" : "hs->js"} just like the current top transition`, { cause: currentTransition.trace });
    }
    vm.transitionLocks.push(this);
  }
  close() {
    let other = this.vm.transitionLocks.pop();
    if (other && other !== this) {
      const pos = this.vm.transitionLocks.indexOf(this);
      if (pos !== -1)
        other = this.vm.transitionLocks[pos + 1] ?? other;

      // Calls to async functions lose connection to the stack trace, so use the current transition lock stack to show some more
      const transitionTrace = this.vm.transitionLocks.slice(0, pos).map(t => `${JSON.stringify(t.title)}->`).join("");
      let traces = "";
      for (const lock of this.vm.transitionLocks.slice(0, pos).reverse()) {
        const stack = lock.trace.stack ?? "";
        const spos = stack.indexOf("\n    at", stack.indexOf("startTransition"));
        traces += `\n    at transition:${JSON.stringify(lock.title)}${stack.substring(spos)}`;
      }

      try {
        this.trace.cause = other.trace;
        this.trace.message = `Tried to return to ${this.intoHareScript ? "TypeScript" : "HareScript"} after calling ${transitionTrace}${JSON.stringify(this.title)} while a call to ${JSON.stringify(other.title)} was still in progress. Probably an await is missing in the first transition chain.`;
        throw this.trace;
      } catch (e) {
        // TODO: eliminate overlapping trace parts
        (e as Error).stack += traces;
        throw e;
      }
    }
  }
}

export async function recompileHarescriptLibrary(uri: string, options?: { force: boolean }) {
  const text = await recompileHarescriptLibraryRaw(uri, options);
  const lines = text.split("\n").filter(line => line);
  return lines.map(line => parseError(line));
}

function registerBridgeEventHandler(weakModule: WeakRef<HareScriptVM>) {
  runOutsideCodeContext(() => {
    const listenerid = bridge.on("event", (event: BridgeEvent) => {
      const mod = weakModule.deref();
      if (!mod || mod.isShutdown()) {
        bridge.off(listenerid);
        if (mod)
          mod.unregisterEventCallback = undefined;
        return;
      }

      // Don't re-emit events that originate from this vm
      if (event.data && event.data.__sourcegroup === mod.currentgroup)
        return;

      mod.injectEvent(event.name, event.data);
    });
    weakModule.deref()!.unregisterEventCallback = () => bridge.off(listenerid);
  });
}


export class HareScriptVM implements HSVM_HSVMSource {
  static moduleIdCounter = 0;
  private _wasmmodule: WASMModule | null;
  private _hsvm: HSVM | null;
  errorlist: HSVM_VariableId;
  dispatchfptr: HSVM_VariableId;
  havedispatchfptr = false;
  columnnamebuf: StringPtr;
  /// 8-bute array for 2 ptrs for getstring
  stringptrs: Ptr;
  consoleArguments: string[];
  columnNameIdMap: Record<string, HSVM_ColumnId> = {};
  objectCache;
  mutexes: Array<Mutex | null> = [];
  currentgroup: string;
  pipeWaiters = new Map<Ptr, DeferredPromise<number>>;
  heapFinalizer = new FinalizationRegistry<HSVM_VariableId>((varid) => this._hsvm && this.wasmmodule._HSVM_DeallocateVariable(this._hsvm, varid));
  transitionLocks = new Array<TransitionLock>;
  unregisterEventCallback: (() => void) | undefined;
  private gotEventCallbackId = 0; //id of event callback provided to the C++ code
  private gotOutputCallbackId = 0;  //id of output callback provided to the C++ code
  __unrefMainTimer: boolean;
  onScriptDone: ((e: Error | null) => void | Promise<void>) | null;

  /// Unique id counter
  syscallPromiseIdCounter = 0;
  /// List of JS Promises that have resolved and now need their results communicated back to HS
  pendingPromiseResults = new Array<{
    id: number;
    isResolve: boolean;
    result: unknown;
  }>;
  /// List of HS function calls that need to be execute
  pendingFunctionRequests = new Array<{
    id: number;
    resolve: (result: unknown | undefined) => void;
    reject: (result: Error) => void;
    functionref: string;
    params: HSVMVar[];
    object: HSVMHeapVar | null;
    sent: boolean;
  }>;

  constructor(module: WASMModule, startupoptions: StartupOptions) {
    this._wasmmodule = module;
    this.objectCache = new HSVMObjectCache(this);
    module.itf = this;
    this._hsvm = module._CreateHSVM();
    module.initVM(this.hsvm);
    this.dispatchfptr = module._HSVM_AllocateVariable(this.hsvm);
    this.errorlist = module._HSVM_AllocateVariable(this.hsvm);
    this.columnnamebuf = module._malloc(65);
    this.stringptrs = module._malloc(8); // 2 string pointers
    this.consoleArguments = startupoptions?.consoleArguments || [];
    this.currentgroup = `${bridge.getGroupId()}-wasmmodule-${HareScriptVM.moduleIdCounter++}`;
    this.integrateEvents();
    this.onScriptDone = startupoptions.onScriptDone || null;

    this.__unrefMainTimer = startupoptions?.__unrefMainTimer || false;

  }

  captureOutput(onOutput: (output: number[]) => void) {
    if (this.gotOutputCallbackId)
      throw new Error("output callback already set");

    const out = (opaqueptr: number, numbytes: number, data: StringPtr, allow_partial: number, error_result: Ptr): number => {
      onOutput(Array.from(this.wasmmodule.HEAP8.slice(data, data + numbytes)));
      return numbytes;
    };
    this.gotOutputCallbackId = this.wasmmodule.addFunction(out, "iiiiii"); //TODO where do we remove this?
    this.wasmmodule._HSVM_SetOutputCallback(this.hsvm, 0, this.gotOutputCallbackId);
  }

  async run(script: string): Promise<void> {
    if (debugFlags.vmlifecycle) {
      console.log(`[${this.currentgroup}] Load script: ${script}`);
      console.trace();
    }
    await this.loadScript(script);

    let exception: unknown | null = null;
    try {
      if (debugFlags.vmlifecycle)
        console.log(`[${this.currentgroup}] Execute script`);
      await this.executeScript();
    } catch (e) {
      exception = e;
      throw e;
    } finally {
      //When the script is done, we clean up
      if (this.onScriptDone)
        await this.onScriptDone(exception instanceof Error ? exception : null);

      try {
        //TODO Might want to already release some resources when the main script is done ?

        if (debugFlags.vmlifecycle) {
          if (exception)
            console.log(`[${this.currentgroup}] Script failed, releasing VM`, exception);
          else
            console.log(`[${this.currentgroup}] Script completed, releasing VM`);
          console.trace();
        }

        this.unregisterEventCallback?.();
        this.wasmmodule._ReleaseHSVMResources(this.hsvm);

        for (const mutex of this.mutexes)
          mutex?.release();

        this.wasmmodule._SetEventCallback(0 as HSVM, 0);
        if (this.gotEventCallbackId)
          this.wasmmodule.removeFunction(this.gotEventCallbackId);
        if (this.gotOutputCallbackId)
          this.wasmmodule.removeFunction(this.gotOutputCallbackId);
        this.wasmmodule._ReleaseHSVM(this.hsvm);
        this.wasmmodule.prepareForReuse();

        enginePool.push(this.wasmmodule);

        this._hsvm = null;
        this._wasmmodule = null;
      } catch (e) {
        console.error("Exception during HSVM cleanup", e);
      }
    }
  }

  _getHSVM() {
    return this;
  }

  get hsvm() { //We want callers to not have to check this.hsvm on every use
    if (this._hsvm)
      return this._hsvm;
    throw new Error(`VM ${this.currentgroup} has already shut down`);
  }

  get wasmmodule() {
    if (this._wasmmodule)
      return this._wasmmodule;
    throw new Error(`VM ${this.currentgroup} has already shut down`);
  }

  async __pipewaiterWait(pipewaiter: number, wait_ms: number) { //threads.cpp callback
    const waiter = this.pipeWaiters.get(pipewaiter);
    if (!waiter)
      throw new Error(`Could not find pipewaiter`);

    const timer = rootstorage.run(() => setTimeout(() => waiter.resolve(0), wait_ms));
    if (this.__unrefMainTimer && !this.pendingFunctionRequests.length)
      timer.unref();
    const res = await waiter.promise;
    return res;
  }

  //Bridge-based HSVM compatibillty. Report the number of Proxies still alive
  __getNumRemoteUnmarshallables() {
    return this.objectCache.countObjects();
  }

  checkType(variable: HSVM_VariableId, expectType: VariableType) {
    const curType = this.wasmmodule._HSVM_GetType(this.hsvm, variable);
    if (curType !== expectType)
      throw new Error(`Variable doesn't have expected type ${VariableType[expectType]}, but got ${VariableType[curType]}`);

    return curType;
  }

  /** Resolve a promise returnd by EM_Syscall */
  resolveSyscalledPromise(id: number, isResolve: boolean, result: unknown) {
    if (!isResolve)
      result = encodeIPCException(result as Error).__exception;

    this.pendingPromiseResults.push({ id, isResolve, result: result === undefined ? false : result });
    this.injectEvent("system:wasm-promises", null);
  }

  /// Inject an event directly into this HSVM
  injectEvent(name: string, data: unknown) {
    if (this.isShutdown())
      return;

    const encoded = writeMarshalData(data, { onlySimple: true });
    const payload = this.wasmmodule._malloc(encoded.byteLength);
    const namebuf = this.wasmmodule.stringToNewUTF8(name);
    try {
      encoded.copy(this.wasmmodule.HEAPU8, payload);
      this.wasmmodule._InjectEvent(this.hsvm, namebuf, payload, encoded.byteLength);
    } finally {
      this.wasmmodule._free(payload);
      this.wasmmodule._free(namebuf);
    }
  }

  //Get the JS tag for this blob, used to track its original/current location (eg on disk or uploaded to PG)
  getBlobJSTag(variable: HSVM_VariableId): JSBlobTag {
    this.checkType(variable, VariableType.Blob);
    const as_cstr = this.wasmmodule._HSVM_BlobGetTag(this.hsvm, variable);
    if (!as_cstr)
      return null;

    const tag = this.wasmmodule.UTF8ToString(as_cstr);
    return tag ? JSON.parse(tag) : null;
  }
  setBlobJSTag(variable: HSVM_VariableId, tag: JSBlobTag) {
    this.checkType(variable, VariableType.Blob);
    const as_cstr = this.wasmmodule.stringToNewUTF8(tag ? JSON.stringify(tag) : '');
    this.wasmmodule._HSVM_BlobSetTag(this.hsvm, variable, as_cstr);
    this.wasmmodule._free(as_cstr);
  }

  getColumnName(columnid: HSVM_ColumnId): string {
    this.wasmmodule._HSVM_GetColumnName(this.hsvm, columnid, this.columnnamebuf);
    return this.wasmmodule.UTF8ToString(this.columnnamebuf).toLowerCase();
  }

  getColumnId(name: string): HSVM_ColumnId {
    const id = this.columnNameIdMap[name];
    if (id)
      return id;
    this.wasmmodule.stringToUTF8(name, this.columnnamebuf, 64);
    return this.columnNameIdMap[name] = this.wasmmodule._HSVM_GetColumnId(this.hsvm, this.columnnamebuf);
  }

  allocateVariable(): HSVMHeapVar {
    const id = this.wasmmodule._HSVM_AllocateVariable(this.hsvm);
    return new HSVMHeapVar(this, id);
  }

  allocateVariableCopy(source: HSVM_VariableId): HSVMHeapVar {
    const heapvar = this.allocateVariable();
    this.wasmmodule._HSVM_CopyFrom(this.hsvm, heapvar.id, source);
    return heapvar;
  }

  quickParseVariable(variable: HSVM_VariableId): IPCMarshallableData {
    let value;
    const type = this.wasmmodule._HSVM_GetType(this.hsvm, variable);
    switch (type) {
      case VariableType.Integer: {
        value = this.wasmmodule._HSVM_IntegerGet(this.hsvm, variable);
      } break;
      case VariableType.Boolean: {
        value = Boolean(this.wasmmodule._HSVM_BooleanGet(this.hsvm, variable));
      } break;
      case VariableType.String: {
        this.wasmmodule._HSVM_StringGet(this.hsvm, variable, this.stringptrs, this.stringptrs + 4);
        const begin = this.wasmmodule.getValue(this.stringptrs, "*") as number;
        const end = this.wasmmodule.getValue(this.stringptrs + 4, "*") as number;
        value = this.wasmmodule.UTF8ToString(begin, end - begin);
      } break;
      case VariableType.RecordArray: {
        value = [];
        const eltcount = this.wasmmodule._HSVM_ArrayLength(this.hsvm, variable);
        for (let i = 0; i < eltcount; ++i) {
          const elt = this.wasmmodule._HSVM_ArrayGetRef(this.hsvm, variable, i);
          value.push(this.quickParseVariable(elt));
        }
      } break;
      case VariableType.Record: {
        if (!this.wasmmodule._HSVM_RecordExists(this.hsvm, variable))
          value = null;
        else {
          const cellcount = this.wasmmodule._HSVM_RecordLength(this.hsvm, variable);
          value = {};
          for (let pos = 0; pos < cellcount; ++pos) {
            const columnid = this.wasmmodule._HSVM_RecordColumnIdAtPos(this.hsvm, variable, pos);
            const cell = this.wasmmodule._HSVM_RecordGetRef(this.hsvm, variable, columnid);
            (value as Record<string, unknown>)[this.getColumnName(columnid)] = this.quickParseVariable(cell);
          }
        }
      } break;
      default: {
        throw new Error(`Parsing variables of type ${VariableType[type]} is not implemented`);
      }
    }
    return value;
  }

  async loadScript(lib: string): Promise<void> {
    const lib_str = this.wasmmodule.stringToNewUTF8(lib);
    try {
      this.wasmmodule._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);
      const fptrresult = await this.wasmmodule._HSVM_LoadScript(this.hsvm, lib_str);
      if (fptrresult)
        return; //Success!

      this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
      const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
      throw new Error(`Error loading library ${lib}: ${parsederrors[0].message || "Unknown error"}`);
    } finally {
      this.wasmmodule._free(lib_str);
    }
  }

  loadlib<Lib extends keyof CommonLibraries>(name: Lib): CommonLibraryType<Lib>;
  loadlib(name: string): HSVMCallsProxy;

  loadlib(name: string): HSVMCallsProxy {
    const proxy = new Proxy({}, new HSVMLibraryProxy(this, name)) as HSVMCallsProxy;
    return proxy;
  }

  async executeScript(): Promise<void> {
    const executeresult = await this.wasmmodule._HSVM_ExecuteScript(this.hsvm, 1, 0);
    if (executeresult === 1)
      return;

    this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
    const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
    if (parsederrors.length) {
      const errors = parsederrors.filter(e => e.iserror).map(e => e.message);
      const trace = parsederrors.filter(e => e.istrace).map(e =>
        `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("");
      throw new Error(`Error executing script: ${errors.join("\n") + trace}`);
    } else
      throw new Error(`Error executing script`);
  }

  async makeFunctionPtr(fptr: HSVM_VariableId, lib: string, name: string): Promise<void> {
    const lib_str = this.wasmmodule.stringToNewUTF8(lib);
    const name_str = this.wasmmodule.stringToNewUTF8(name);
    try {
      this.wasmmodule._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);
      const fptrresult = await this.wasmmodule._HSVM_MakeFunctionPtrAutoDetect(this.hsvm, fptr, lib_str, name_str, this.errorlist);
      switch (fptrresult) {
        case 0:
        case -2: {
          let parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
          if (parsederrors.length === 0) { //runtime errors are in the VM's mesage list
            this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
            parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
          }
          console.error(parsederrors);
          throw new Error(`Error loading library ${lib}: ${parsederrors[0].message || "Unknown error"}`);
        } break;
        case -1: throw new Error(`No such function ${lib}#${name}`);
        case 1: return;
      }
    } finally {
      this.wasmmodule._free(lib_str);
      this.wasmmodule._free(name_str);
    }
  }

  openFunctionCall(paramcount: number): HSVMVar[] {
    const params: HSVMVar[] = [];
    this.wasmmodule._HSVM_OpenFunctionCall(this.hsvm, paramcount);
    for (let i = 0; i < paramcount; ++i)
      params.push(new HSVMVar(this, this.wasmmodule._HSVM_CallParam(this.hsvm, i)));
    return params;
  }

  /** @param functionref - Function to call
      @param isfunction - Whether to call a function or macro
   */
  async callWithHSVMVars(functionref: string, params: HSVMVar[], objectid?: HSVM_VariableId): Promise<unknown> {
    //FIXME check if we really want to bother with HSMVars as currently its just a lot of extra cloning
    const defer = createDeferred<unknown | undefined>();
    const id = ++this.syscallPromiseIdCounter;
    const object = objectid ? this.allocateVariableCopy(objectid) : null;
    this.pendingFunctionRequests.push({ id, resolve: defer.resolve, reject: defer.reject, functionref, params: params.map(p => this.allocateVariableCopy(p.id)), object, sent: false });

    // console.log("Queued outgoing call", this.pendingFunctionRequests.at(-1));
    this.injectEvent("system:wasm-promises", null);
    return defer.promise;

    /* TODO do we need to keep the direct-invoke approach ?
    const parts = functionref.split("#");
    if (!object && parts.length !== 2)
      throw new Error(`Illegal function reference ${JSON.stringify(functionref)}`);

    const callfuncptr: HSVMHeapVar = this.allocateVariable();
    try {
      this.wasmmodule._HSVM_OpenFunctionCall(this.hsvm, params.length);
      for (const [idx, param] of params.entries())
        this.wasmmodule._HSVM_CopyFrom(this.hsvm, this.wasmmodule._HSVM_CallParam(this.hsvm, idx), param.id);

      let retvalid, wasfunction;
      if (object) {
        const colid = this.getColumnId(functionref);
        const transitionLock = debugFlags.async && this.startTransition(true, functionref);
        retvalid = await this.wasmmodule._HSVM_CallObjectMethod(this.hsvm, object, colid, 0, /*allow macro=* /1);
        transitionLock?.close();
        //HSVM_CallObjectMethod simply returns an uninitialized value when dealing with a macro
        wasfunction = retvalid !== 0 && this.wasmmodule._HSVM_GetType(this.hsvm, retvalid) !== VariableType.Uninitialized;
      } else {
        //HSVM_CAllFucnctionPtr returns FALSE for a MACRO so inspect the actual returntype
        await this.makeFunctionPtr(callfuncptr.id, parts[0], parts[1]);
        const returntypecolumn = this.getColumnId("returntype");
        const returntypecell = this.wasmmodule._HSVM_RecordGetRef(this.hsvm, callfuncptr.id, returntypecolumn);
        const returntype = this.wasmmodule._HSVM_IntegerGet(this.hsvm, returntypecell);
        wasfunction = ![0, 2].includes(returntype);
        const transitionLock = debugFlags.async && this.startTransition(true, functionref);
        retvalid = await this.wasmmodule._HSVM_CallFunctionPtr(this.hsvm, callfuncptr.id, /*allow macro=* /1);
        transitionLock?.close();
      }

      if (!retvalid) {
        const throwvar = new HSVMVar(this, this.wasmmodule._HSVM_GetThrowVar(this.hsvm));
        if (throwvar.objectExists()) {
          const what = (await throwvar.getMember("what")).getString();
          const trace = (await throwvar.getMember("pvt_trace")).getJSValue() as TraceElement[];

          //clear the exception
          this.wasmmodule._HSVM_CleanupException(this.hsvm);

          //build a combined exception
          const err = new Error(what);
          addHareScriptTrace(trace, err);
          throw err;
        }
        this.wasmmodule._HSVM_CloseFunctionCall(this.hsvm);
        this.throwVMErrors();
      }

      const retval = wasfunction ? this.allocateVariable() : undefined;
      if (retval)
        this.wasmmodule._HSVM_CopyFrom(this.hsvm, retval.id, retvalid);
      this.wasmmodule._HSVM_CloseFunctionCall(this.hsvm);
      return wasfunction ? retval : undefined;
    } finally {
      callfuncptr.dispose();
    }
    */
  }

  parseMessageList(): MessageList {
    const errorlist = this.wasmmodule._HSVM_AllocateVariable(this.hsvm);
    this.wasmmodule._HSVM_GetMessageList(this.hsvm, errorlist, 1);
    const retval = this.quickParseVariable(errorlist) as MessageList;
    this.wasmmodule._HSVM_DeallocateVariable(this.hsvm, errorlist);
    return retval;
  }

  private throwVMErrors(): never {
    const errorlist = this.wasmmodule._HSVM_AllocateVariable(this.hsvm);
    this.wasmmodule._HSVM_SetDefault(this.hsvm, errorlist, VariableType.RecordArray as HSVM_VariableType);
    this.wasmmodule._HSVM_GetMessageList(this.hsvm, errorlist, 1);
    const parsederrors = this.quickParseVariable(errorlist) as MessageList;
    console.error(parsederrors);
    const trace = parsederrors.filter(e => e.istrace).map(e =>
      `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("");
    throw new Error((parsederrors[0].message ?? "Unknown error") + trace);
  }

  async call(functionref: string, ...params: unknown[]): Promise<unknown> {
    const funcargs = argsToHSVMVar(this, params);
    try {
      return this.callWithHSVMVars(functionref, funcargs);
    } finally {
      cleanupHSVMCall(this, funcargs, undefined);
    }
  }

  async createPrintCallback(text: string): Promise<HSVMHeapVar> {
    const printcallback = this.allocateVariable();
    const printptr = this.allocateVariable();
    await this.makeFunctionPtr(printptr.id, "wh::system.whlib", "Print");

    const textholder = this.allocateVariable();
    textholder.setString(text);
    const bound = this.wasmmodule._malloc(4); //allocate 1 ptr
    const sources = this.wasmmodule._malloc(4); //allocate 1 ptr
    this.wasmmodule.setValue(bound, textholder.id, "i32");
    this.wasmmodule.setValue(sources, 0, "i32");
    this.wasmmodule._HSVM_RebindFunctionPtr(this.hsvm, printcallback.id, printptr.id, 1, 0, sources, bound, 0, 0);
    this.wasmmodule._free(bound);
    this.wasmmodule._free(sources);
    printptr.dispose();
    textholder.dispose();

    return printcallback;
  }

  /// Shutdown the VM. Use this if you know it's no longer needed, it prevents having to wait for garbage collection to free up resources
  shutdown() {
    if (debugFlags.vmlifecycle) {
      console.log(`[${this.currentgroup}] Aborting VM:`);
      console.trace();
    }

    this.wasmmodule._HSVM_AbortVM(this.hsvm);
  }

  /// Is the VM already closed?
  isShutdown() {
    return this._hsvm === null;
  }

  startTransition(intoHareScript: boolean, title: string): TransitionLock | undefined {
    if (!debugFlags.async)
      return;
    return new TransitionLock(this, intoHareScript, title);
  }

  integrateEvents() {
    /* bridge may not hold strong references to the wasm module, so use a free-standing function
       that won't keep this object in a closure context */
    registerBridgeEventHandler(new WeakRef(this));

    const gotEvent = (nameptr: number, payloadptr: number, payloadlength: number): void => {
      const name = this.wasmmodule.UTF8ToString(nameptr);
      const payload = Buffer.from(this.wasmmodule.HEAPU8.slice(payloadptr, payloadptr + payloadlength));
      let data = readMarshalData(payload) as (SimpleMarshallableRecord & { __recordexists?: boolean; __sourcegroup?: string }) | null;
      // Make sure __sourcegroup is filled in the data
      if (!data || !("__sourcegroup" in data)) {
        if (!data)
          data = { __recordexists: false };
        data.__sourcegroup ??= this.currentgroup || "";
      }
      /* Send the event over the bridge. It will be reflected to the local bridge, but filtered out by
         the receiver based on sourcegroup */
      bridge.sendEvent(name, data as SimpleMarshallableRecord);
    };

    this.gotEventCallbackId = this.wasmmodule.addFunction(gotEvent, "viii");
    this.wasmmodule._SetEventCallback(this.hsvm, this.gotEventCallbackId);
  }
}

async function createHarescriptModule() {
  const modulefunctions = new WASMModule;
  modulefunctions.prepare();
  const wasmmodule = await createModule(modulefunctions);
  wasmmodule.init();

  registerBaseFunctions(wasmmodule);
  registerPGSQLFunctions(wasmmodule);

  return wasmmodule;
}

//TODO should we rename this to make clear we're also starting the VM? it's not just an 'allocation' anymore
export async function allocateHSVM(options?: StartupOptions): Promise<HareScriptVM> {
  const hsvmModule = enginePool.pop() || createHarescriptModule();
  return new HareScriptVM(await hsvmModule, options || {});
}

//Only for CI tests:
export async function isInFreePool(mod: WASMModule) {
  return enginePool.includes(mod);
}
