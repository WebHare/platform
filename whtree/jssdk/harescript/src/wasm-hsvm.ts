import * as path from "node:path";
import type { HSVM, HSVM_ColumnId, HSVM_VariableId, HSVM_VariableType, Ptr, StringPtr } from "../../../lib/harescript-interface";
import { type IPCMarshallableData, type IPCMarshallableRecord, type SimpleMarshallableRecord, VariableType, readMarshalData, writeMarshalData } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { isTruthy } from "@webhare/std";

// @ts-ignore: implicitly has an `any` type
import createModule from "../../../lib/harescript";
import { HareScriptJob, registerBaseFunctions } from "./wasm-hsfunctions";
import { getCachedWebAssemblyModule, setCachedWebAssemblyModule, WASMModule } from "./wasm-modulesupport";
import { HSVMHeapVar, HSVMVar } from "./wasm-hsvmvar";
import { type HSVMCallsProxy, HSVMLibraryProxy, type HSVMMarshallableOpaqueObject, HSVMObjectCache, argsToHSVMVar, cleanupHSVMCall } from "./wasm-proxies";
import { registerPGSQLFunctions } from "@mod-system/js/internal/whdb/wasm_pgsqlprovider";
import { type Mutex, JSLibraryImporter } from "@webhare/services";
import type { CommonLibraries, CommonLibraryType } from "./commonlibs";
import { debugFlags } from "@webhare/env";
import bridge, { type BridgeEvent } from "@mod-system/js/internal/whmanager/bridge";
import { ensureScopedResource, getScopedResource, rootstorage, runOutsideCodeContext, setScopedResource } from "@webhare/services/src/codecontexts";
import type { HSVM_HSVMSource } from "./machinewrapper";
import { decodeTransferredIPCEndPoint } from "@mod-system/js/internal/whmanager/ipc";
import { mapHareScriptPath, HSVMSymbol, parseHSException } from "./wasm-support";
import { AsyncLocalStorage } from "node:async_hooks";
import { HSVMRunContext, HSVMRunPermissionSystem } from "./runcontext";

export type { HSVM_VariableId, HSVM_VariableType }; //prevent others from reaching into harescript-interface

export interface StartupOptions {
  /// Script to run. If not specified an eventloop is started
  script?: string;
  consoleArguments?: string[];
  /// A hook that is executed when the main script is done but before it is cleaned up. HSVM/wasmmodule state should still be accessible
  onScriptDone?: (exception: Error | null) => void | Promise<void>;
  implicitLifetime?: boolean;
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

export class HareScriptLibraryOutOfDateError extends Error {
}

function getFirstError(message: string, parsederrors: MessageList): Error {
  const prefix = message ? `${message}: ` : "";
  if (parsederrors.length) {
    const errors = parsederrors.filter(e => e.iserror).map(e => e.message);
    const trace = parsederrors.filter(e => e.istrace).map(e =>
      `\n    at ${e.func} (${mapHareScriptPath(e.filename)}:${e.line}:${e.col})`).join("");

    if (errors.length)
      if (parsederrors[0].code === 170)
        return new HareScriptLibraryOutOfDateError(`${prefix}${errors.join("\n") + trace}`);
      else
        return new Error(`${prefix}${errors.join("\n") + trace}`);
  }
  return new Error(`${prefix}Unknown HSVM error`);
}

function throwFirstError(message: string, parsederrors: MessageList): never {
  throw getFirstError(message, parsederrors);
}


// interface TraceElement {
//   filename: string;
//   line: number;
//   col: number;
//   func: string;
// }

///Pool of unused engines.
const enginePool = new Array<WASMModule>;

export type JSBlobTag = { pg: string } | null;

const hsvmlistsymbol = Symbol("HSVMList");
type HSVMList = Set<WeakRef<HareScriptVM>>;

// function addHareScriptTrace(trace: TraceElement[], err: Error) {
//   const stacklines = err.stack?.split("\n") || [];
//   const tracelines = trace.map(e =>
//     `    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("\n");
//   err.stack = (stacklines[0] ? stacklines[0] + "\n" : "") + tracelines + '\n' + (stacklines.slice(1).join("\n"));
// }

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
  [Symbol.dispose]() { this.close(); }
}

function registerBridgeEventHandler(weakModule: WeakRef<HareScriptVM>) {
  runOutsideCodeContext(() => {
    const listenerid = bridge.on("event", (event: BridgeEvent) => {
      const mod = weakModule.deref();
      if (!mod || mod.__isShuttingdown()) {
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
  currentgroup = `${bridge.getGroupId()}-wasmmodule-${HareScriptVM.moduleIdCounter++}`;
  pipeWaiters = new Map<Ptr, PromiseWithResolvers<number> & { timer?: NodeJS.Timeout; cancel: () => void }>;
  heapFinalizer = new FinalizationRegistry<HSVM_VariableId>((varid) => this._hsvm && this.wasmmodule._HSVM_DeallocateVariable(this._hsvm, varid));
  transitionLocks = new Array<TransitionLock>;
  unregisterEventCallback: (() => void) | undefined;
  private gotEventCallbackId = 0; //id of event callback provided to the C++ code
  private gotOutputCallbackId = 0;  //id of output callback provided to the C++ code
  private onOutput: undefined | ((output: Buffer) => void);
  private gotErrorCallbackId = 0;  //id of error callback provided to the C++ code
  private onErrors: undefined | ((errors: Buffer) => void);
  implicitLifetime: boolean;
  mainTimer?: NodeJS.Timer;
  keepAliveLocks = new Set<string>();
  onScriptDone: ((e: Error | null) => void | Promise<void>) | null;
  contexts = new Map<symbol, { close?: () => void }>;
  inSyncSyscall = false;
  abortController = new AbortController();
  exitCode?: number;
  readonly importedLibs = new JSLibraryImporter;
  readonly proxies = new Map<string, HSVMMarshallableOpaqueObject>(); //TODO this should go in to the VM object
  permissionSystem = new HSVMRunPermissionSystem(this);
  rootRunPermission = this.permissionSystem.allocRootContext();
  runContextStore = new AsyncLocalStorage<HSVMRunContext>();

  /** Unresolved resurrected promises we still expect the VM to syscall fulfillResurrectedPromise for */
  unresolvedPromises = new Map<number, PromiseWithResolvers<unknown>>;
  /** Promises that still appear to be alive and may be requested to resolve by JavaScript users of this VM*/
  resolveablePromises = new Map<number, WeakRef<Promise<unknown>>>;

  constructor(module: WASMModule, startupoptions: StartupOptions) {
    if (process.env.WEBHARE_HARESCRIPT_OFF)
      throw new Error(`HareScript is disabled`);

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
    this.integrateEvents();
    this.onScriptDone = startupoptions.onScriptDone || null;

    //by default a HSVM will write to stdout but not stderr, that always requires setup
    this.captureErrors(this.writeToStderr.bind(this));

    this.implicitLifetime = startupoptions?.implicitLifetime || false;
    if (this.implicitLifetime) {
      process.setMaxListeners(Infinity); //we can easily have more than 10 VMs when eg. debugging nodeservices
      process.on('beforeExit', this.#beforeExit);
    }
  }

  captureOutput(onOutput: (output: Buffer) => void) {
    if (!this.gotOutputCallbackId) {
      const out = (opaqueptr: number, numbytes: number, data: StringPtr, allow_partial: number, error_result: Ptr): number => {
        this.onOutput?.(Buffer.copyBytesFrom(this.wasmmodule.HEAPU8, data, numbytes));
        return numbytes;
      };
      this.gotOutputCallbackId = this.wasmmodule.addFunction(out, "iiiiii");
      this.wasmmodule._HSVM_SetOutputCallback(this.hsvm, 0, this.gotOutputCallbackId);
    }
    this.onOutput = onOutput;
  }

  captureErrors(onErrors: (errors: Buffer) => void) {
    if (!this.gotErrorCallbackId) {
      const error = (opaqueptr: number, numbytes: number, data: StringPtr, allow_partial: number, error_result: Ptr): number => {
        this.onErrors?.(Buffer.copyBytesFrom(this.wasmmodule.HEAPU8, data, numbytes));
        return numbytes;
      };
      this.gotErrorCallbackId = this.wasmmodule.addFunction(error, "iiiiii");
      this.wasmmodule._HSVM_SetErrorCallback(this.hsvm, 0, this.gotErrorCallbackId);
    }
    this.onErrors = onErrors;
  }

  writeToStderr(data: Buffer) {
    process.stderr.write(data);
  }

  /** Throw if the current VM has a pending exception or error. Needed to ensure errors are handled on the current stack (and not on the eventloop) */
  throwDetectedVMError(): never {
    if (this._wasmmodule?._HSVM_IsUnwinding(this.hsvm)) {
      const throwvarid: HSVM_VariableId = this._wasmmodule._HSVM_GetThrowVar(this.hsvm);
      if (throwvarid) {
        const throwvar = new HSVMVar(this, throwvarid);
        const err = parseHSException(throwvar);
        this._wasmmodule._HSVM_CleanupException(this.hsvm);
        throw err;
      }
      throw new Error(`HareScript VM is unwinding, but no exception was found`);
    }

    this.throwVMErrors();
  }

  assertRunPermission() {
    if (!this.runContextStore.getStore()?.havePermission)
      throw new Error("No run permission available");
  }

  async executeWithRunPermission<T>(fn: () => T): Promise<Awaited<T>> {
    const ctxt = this.runContextStore.getStore() ?? this.rootRunPermission;
    const childCtxt = new HSVMRunContext(this.permissionSystem, ctxt);
    return await this.runContextStore.run(childCtxt, async () => {
      using useCtxt = childCtxt; void useCtxt;
      using lock = await childCtxt.ensureRunPermission(); void lock;
      return await fn();
    });
  }

  breakPipeWaiterOnRequest() {
    const ctxt = this.runContextStore.getStore();
    if (!ctxt)
      throw new Error("No run context available");
    return ctxt.breakPipeWaiterOnRequest();
  }

  anyPendingPermissionRequests() {
    return this.permissionSystem.waitingForPermission.length !== 0;
  }

  currentRun?: Promise<void>;
  run(script: string): Promise<void> {
    if (this.runContextStore.getStore())
      return this.currentRun = this.executeWithRunPermission(() => this.runInternal(script));
    else
      return this.runContextStore.run(this.rootRunPermission, () => {
        return this.currentRun = this.runInternal(script);
      });
  }

  private async runInternal(script: string): Promise<void> {
    if (debugFlags.vmlifecycle) {
      console.log(`[${this.currentgroup}] Load script: ${script}`);
      console.trace();
    }

    await this.loadScript(script);
    const myweakref = new WeakRef(this);
    const vmlist = ensureScopedResource<HSVMList>(hsvmlistsymbol, () => new Set<WeakRef<HareScriptVM>>());
    vmlist.add(myweakref);

    let exception: unknown | null = null;
    try {
      if (debugFlags.vmlifecycle)
        console.log(`[${this.currentgroup}] Execute script`);
      // Run the script in a new runContext
      await this.executeScript();
    } catch (e) {
      exception = e;
      throw e;
    } finally {
      //Clean up #beforeExit listener
      if (this.implicitLifetime)
        process.off('beforeExit', this.#beforeExit);

      //When the script is done, we clean up
      if (this.onScriptDone)
        await this.onScriptDone(exception instanceof Error ? exception : null);

      vmlist.delete(myweakref); //remove from active list, prevent any more incoming calls from eg commitWork handlers

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
        this.exitCode = this.wasmmodule._HSVM_GetConsoleExitCode(this.hsvm);

        for (const mutex of this.mutexes)
          mutex?.release();
        for (const context of this.contexts.values())
          context.close?.();

        this.wasmmodule._SetEventCallback(0);
        if (this.gotEventCallbackId)
          this.wasmmodule.removeFunction(this.gotEventCallbackId);
        if (this.gotOutputCallbackId)
          this.wasmmodule.removeFunction(this.gotOutputCallbackId);
        if (this.gotErrorCallbackId)
          this.wasmmodule.removeFunction(this.gotErrorCallbackId);
        this.wasmmodule._ReleaseHSVM(this.hsvm);
        this.wasmmodule.prepareForReuse();

        enginePool.push(this.wasmmodule);

        this._hsvm = null;
        this._wasmmodule = null;
      } catch (e) {
        console.error("Exception during HSVM cleanup", e);
      }

      this.runContextStore.disable();
    }
  }

  #beforeExit = () => {
    (async () => {
      await this.call("wh::ipc.whlib#CancelEventLoop");
      await bridge.ensureDataSent(); //ensure all data is sent. we run in beforeExit and probably can't rely on a future bridge beforeExit handler
    })().then(() => { }, () => { }); //ignore errors
  };

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


    // Ensure a query for run permission breaks the timer
    const ctxt = this.runContextStore.getStore();
    if (!ctxt)
      throw new Error(`No run context available`);
    using callbackRegistration = ctxt.shortTimerOnRequest ?
      ctxt.onPermissionRequest(() => waiter.resolve(0)) :
      null;
    void callbackRegistration;

    this.abortController.signal.addEventListener("abort", waiter.cancel);
    if (waiter.timer)
      clearTimeout(waiter.timer);
    waiter.timer = rootstorage.run(() => setTimeout(() => { waiter.timer = undefined; waiter.resolve(0); this.mainTimer = undefined; }, wait_ms));
    const isMainTimer = !this.permissionSystem.anyRequestsInFlight();
    if (isMainTimer) {
      this.mainTimer = waiter.timer;
      if (this.implicitLifetime && !this.keepAliveLocks.size)
        waiter.timer.unref();
    }
    const res = await waiter.promise;
    this.abortController.signal.removeEventListener("abort", waiter.cancel);
    return res;
  }

  __pipewaiterDelete(pipewaiter: number) {
    const waiter = this.pipeWaiters.get(pipewaiter);
    if (waiter) {
      if (waiter.timer)
        clearTimeout(waiter.timer);
      this.abortController.signal.removeEventListener("abort", waiter.cancel);
    }
    this.pipeWaiters.delete(pipewaiter);
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

  /// Inject an event directly into this HSVM
  injectEvent(name: string, data: unknown) {
    if (this.__isShutdown())
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

  wrapExistingVariableId(id: HSVM_VariableId): HSVMVar {
    return new HSVMVar(this, id);
  }

  quickParseVariable(variable: HSVM_VariableId): IPCMarshallableData { //TODO see if getJSValue can be used instead
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
      throwFirstError(`Error loading library ${lib}`, parsederrors);
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
    this.assertRunPermission();
    const executeresult = await this.wasmmodule._HSVM_ExecuteScript(this.hsvm, 1, 0);
    if (executeresult === 1) {
      this.unresolvedPromises.forEach((p) => p.reject(new Error("The HareScript VM exited normally before it resolved this promise")));
      return;
    }

    this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
    const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
    const error = getFirstError(`Error executing script`, parsederrors);
    this.unresolvedPromises.forEach((p) => p.reject(error));
    throw error;
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
          throwFirstError(`Error loading library ${lib}`, parsederrors);
        } break;
        case -1: throw new Error(`No such function ${lib}#${name}`);
        case 1: return;
      }
    } finally {
      this.wasmmodule._free(lib_str);
      this.wasmmodule._free(name_str);
    }
  }

  /** Call a function (or an object method) in the HSVM
   *  @param functionref - Function to call
   *  @param params - Parameters
   *  @param objectid - Object to call the function on
   *  @param retvalStore - Variable to store the return value
   *  @param options - Additional options for the call (such as skipAccess)
   *  @returns If retvalStore was set, the return value is whether the called function was a function (true) or a macro
   * (false). If retvalStore was not set, the return value is the return value of the function.
   */
  async callWithHSVMVars(functionref: string, params: HSVMVar[], objectid?: HSVM_VariableId, retvalStore?: HSVMHeapVar, options?: { skipAccess?: boolean }): Promise<unknown> {
    let startcall;
    if (debugFlags.vmcalls)
      startcall = performance.now();

    if (this.inSyncSyscall)
      throw new Error(`Not allowed to reenter a VM while executing EM_SyncSyscall`);
    if (this.__isShuttingdown()) {
      if (debugFlags.vmlifecycle) {
        console.log(`[${this.currentgroup}] Calling '${functionref}' onto VM that is shutting down or has aborted`);
        console.trace();
      }
      throw new Error(`VM ${this.currentgroup} is shutting down or has aborted`);
    }

    const execResult = await this.executeWithRunPermission(async () => {
      let retvalid: HSVM_VariableId | undefined;
      let wasfunction = false;
      let stackptr = 0;

      using transitionLock = debugFlags.async ? this.startTransition(true, functionref) : undefined; void transitionLock;
      if (objectid) {
        const colid = this.getColumnId(functionref);
        stackptr = this.wasmmodule._HSVM_OpenFunctionCall(this.hsvm, params.length);

        for (const [idx, param] of params.entries())
          this.wasmmodule._HSVM_CopyFrom(this.hsvm, this.wasmmodule._HSVM_CallParam(this.hsvm, idx), param.id);

        retvalid = await this.wasmmodule._HSVM_CallObjectMethod(this.hsvm, objectid, colid!, options?.skipAccess ? 1 : 0, 1); //allow macro=1
        //HSVM_CallObjectMethod simply returns an uninitialized value when dealing with a macro
        wasfunction = retvalid !== 0 && this.wasmmodule._HSVM_GetType(this.hsvm, retvalid) !== VariableType.Uninitialized;
      } else {
        // Call all potentially throwing functions before opening the function call
        const parts = functionref.split("#");
        if (!objectid && parts.length !== 2)
          throw new Error(`Illegal function reference ${JSON.stringify(functionref)}`);

        using callfuncptr: HSVMHeapVar = this.allocateVariable();
        await this.makeFunctionPtr(callfuncptr.id, parts[0], parts[1]);

        const returntypecolumn = this.getColumnId("RETURNTYPE");
        const returntypecell = this.wasmmodule._HSVM_RecordGetRef(this.hsvm, callfuncptr.id, returntypecolumn);
        const returntype = this.wasmmodule._HSVM_IntegerGet(this.hsvm, returntypecell);
        wasfunction = ![0, 2].includes(returntype);

        stackptr = this.wasmmodule._HSVM_OpenFunctionCall(this.hsvm, params.length);

        for (const [idx, param] of params.entries())
          this.wasmmodule._HSVM_CopyFrom(this.hsvm, this.wasmmodule._HSVM_CallParam(this.hsvm, idx), param.id);

        retvalid = await this.wasmmodule._HSVM_CallFunctionPtr(this.hsvm, callfuncptr.id, 1); //allow macro=1
      }

      if (this.__isShuttingdown())  //we've already crashed. no need to process the return value
        this.throwDetectedVMError();  //this will always throw

      // Handle the return value
      let retval: unknown = false;
      if (retvalid) {
        const returnVariable = new HSVMVar(this, retvalid);
        if (retvalStore) {
          if (wasfunction)
            retvalStore.copyFrom(returnVariable);
          else
            retvalStore.setBoolean(false);
        }
        retval = retvalStore ? wasfunction : wasfunction ? returnVariable.getJSValue() : undefined;
      }

      // Close the function call, cleanup the return value
      this.wasmmodule._HSVM_CloseFunctionCall2(this.hsvm, stackptr);

      /* Throw throwDetectedVMError after closing the function call, that function needs to now whether the VM is
      unwinding. throwDetectedVMError resets that state */
      if (!retvalid) {
        this.throwDetectedVMError();
      }

      /* Need to wrap the return value because it might be a HS promise. We need to release
         run permission so the code resolveing the promise can run */
      return { value: retval };
    });

    if (debugFlags.vmcalls)
      console.log(`[${this.currentgroup}] Call function ${functionref} complete, took ${(performance.now() - startcall!).toFixed(3)}ms`);

    return execResult.value;
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

    // If no errors are found, the abort flag must have been set to 1 - silent abort.
    if (parsederrors.length === 0)
      throw new Error("VM has been disposed");
    throwFirstError("", parsederrors);
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
    this.abortController.abort();
    this.wasmmodule._HSVM_AbortVM(this.hsvm, 1);
  }

  /** Is the VM already closed or closing? This call has been marked internal because its very hard to use right: the answer may be out of date after the next tick/await */
  __isShuttingdown() {
    return this._hsvm === null || this._wasmmodule?._HSVM_TestMustAbort(this.hsvm);
  }

  /** Is the VM already closed? This call has been marked internal because its very hard to use right: the answer may be out of date after the next tick/await */
  __isShutdown() {
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

    const gotEvent = (nameptr: number, payloadptr: number, payloadlength: number, source: number): void => {
      if (source === 2) // Blex::NotificationEventSource::External
        return;
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

    this.gotEventCallbackId = this.wasmmodule.addFunction(gotEvent, "viiii");
    this.wasmmodule._SetEventCallback(this.gotEventCallbackId);
  }

  getStackTraceString(): string {
    const stacktrace = this.wasmmodule._GetVMStackTrace(this.hsvm);
    const retval = this.wasmmodule.UTF8ToString(stacktrace);
    this.wasmmodule._free(stacktrace);
    return retval;
  }

  allocateHSVM(options?: StartupOptions): Promise<HareScriptVM> {
    return allocateHSVM(options);
  }

  setKeepaliveLock(subsystem: string, keepalive: boolean) {
    if (keepalive)
      this.keepAliveLocks.add(subsystem);
    else
      this.keepAliveLocks.delete(subsystem);

    if (this.mainTimer && this.implicitLifetime && this.mainTimer.hasRef() !== Boolean(this.keepAliveLocks.size)) {
      if (this.keepAliveLocks.size)
        this.mainTimer.ref();
      else
        this.mainTimer.unref();
    }
  }
}

async function createHarescriptModule() {
  const modulefunctions = new WASMModule;
  modulefunctions.prepare();
  let useCreateModule = createModule;
  if (process.env["WEBHARE_WASMMODULEDIR"]) {
    const modulePath = path.join(process.env["WEBHARE_WASMMODULEDIR"], "harescript.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    useCreateModule = require(modulePath);
  }

  const wasmmodule = await useCreateModule(modulefunctions);
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

export function getActiveVMs(): HareScriptVM[] {
  const vmlist = getScopedResource<HSVMList>(hsvmlistsymbol);
  return vmlist ? [...vmlist].map(_ => _.deref()).filter(isTruthy) : [];
}

//Only for CI tests:
export async function isInFreePool(mod: WASMModule) {
  return enginePool.includes(mod);
}

let preparedJobHSVM: Promise<HareScriptVM> | undefined;

export async function harescriptWorkerPrepare(preloadScripts: string[], wasmModule: WebAssembly.Module | undefined): Promise<void> {
  if (preparedJobHSVM)
    return;
  if (wasmModule && !getCachedWebAssemblyModule())
    setCachedWebAssemblyModule(wasmModule);
  if (debugFlags.vmlifecycle)
    console.log(`[n/a] Load script: prepare job`);
  preparedJobHSVM = allocateHSVM().then(async vm => {
    if (debugFlags.vmlifecycle)
      console.log(`[n/a] VM allocated, preloading libraries`, preloadScripts);
    for (const script of preloadScripts) {
      const ptr_str = vm.wasmmodule.stringToNewUTF8(script);
      const result = await vm.wasmmodule._HSVM_PrelinkLibraryLeakRef(vm.hsvm, ptr_str);
      if (!result && debugFlags.vmlifecycle)
        console.log(`[${vm.currentgroup}] Preloaded script ${JSON.stringify(script)} failed, result: ${result}`);
      vm.wasmmodule._free(ptr_str);
    }
    if (debugFlags.vmlifecycle)
      console.log(`[${vm.currentgroup}] Preload complete`);
    return vm;
  });
}

export async function harescriptWorkerFactory(script: string, encodedLink: unknown, authRecord: unknown, externalSessionData: string, env: Array<{ name: string; value: string }> | null, wasmModule: WebAssembly.Module | undefined): Promise<HareScriptJob> {
  if (wasmModule && !getCachedWebAssemblyModule())
    setCachedWebAssemblyModule(wasmModule);
  const link = decodeTransferredIPCEndPoint<IPCMarshallableRecord, IPCMarshallableRecord>(encodedLink);
  if (debugFlags.vmlifecycle)
    console.log(`[n/a] create new VM in worker${preparedJobHSVM ? ", using prepared VM" : ", allocating new VM"}`);
  const vmPromise = preparedJobHSVM ?? allocateHSVM();
  preparedJobHSVM = undefined;
  const vm = await vmPromise;
  setScopedResource(HSVMSymbol, vm);
  if (debugFlags.vmlifecycle)
    console.log(`[${vm.currentgroup}] VM allocation/preparation complete`);
  return new HareScriptJob(vm, script, link, authRecord, externalSessionData, env);
}
