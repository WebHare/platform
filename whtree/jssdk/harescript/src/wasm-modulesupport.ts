import type { HSVM, HSVM_VariableId, WASMModuleInterface, Ptr, StringPtr } from "../../../lib/harescript-interface";
import * as path from "node:path";
import * as fs from "node:fs";
import { backendConfig } from "@webhare/services/src/config.ts";
import { HSVMVar } from "./wasm-hsvmvar";
import type { HareScriptVM } from "./wasm-hsvm";
import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { debugFlags } from "@webhare/env";
import * as stacktrace_parser from "stacktrace-parser";
import { mapHareScriptPath } from "./wasm-support";
import { AsyncResource, executionAsyncId } from "node:async_hooks";
import { getCompileServerOrigin } from "@mod-system/js/internal/configuration";
import { decodeString } from "@webhare/std";

const wh_namespace_location = "mod::system/whlibs/";
let webAssemblyInstantiatedSourcePromise: Promise<WebAssembly.WebAssemblyInstantiatedSource> | undefined;
let cachedWebAssemblyModule: WebAssembly.Module | undefined;

export function getCachedWebAssemblyModule() {
  return cachedWebAssemblyModule;
}

export function setCachedWebAssemblyModule(module: WebAssembly.Module) {
  cachedWebAssemblyModule = module;
}

function translateDirectToModURI(directuri: string) {
  if (directuri.startsWith("direct::")) { //it's actually a direct::
    const directpath = directuri.substring(8);
    for (const [modulename, modconfig] of Object.entries(backendConfig.module))
      if (directpath.startsWith(modconfig.root))
        return `mod::${modulename}/${directpath.substring(modconfig.root.length)}`;
  }

  return directuri; //no replacement found
}

function parseMangledParameters(params: string): VariableType[] {
  const retval: VariableType[] = [];
  for (let idx = 0; idx < params.length; ++idx) {
    let type: VariableType;
    switch (params[idx]) {
      case "V": type = VariableType.Variant; break;
      case "I": type = VariableType.Integer; break;
      case "6": type = VariableType.Integer64; break;
      case "M": type = VariableType.HSMoney; break;
      case "F": type = VariableType.Float; break;
      case "B": type = VariableType.Boolean; break;
      case "S": type = VariableType.String; break;
      case "R": type = VariableType.Record; break;
      case "D": type = VariableType.DateTime; break;
      case "T": type = VariableType.Table; break;
      case "C": type = VariableType.Schema; break;
      case "P": type = VariableType.FunctionPtr; break;
      case "O": type = VariableType.Object; break;
      case "W": type = VariableType.WeakObject; break;
      case "X": type = VariableType.Blob; break;
      default:
        throw new Error(`Illegal character ${JSON.stringify(params[idx])} in mangled function name`);
    }
    if (params[idx + 1] === "A") {
      type = type | 0x80;
      ++idx;
    }
    retval.push(type);
  }
  return retval;
}

function unmangleFunctionName(name: string) {
  const retval = {
    name: "",
    modulename: "",
    returntype: VariableType.Variant,
    parameters: new Array<VariableType>
  };

  let start = 0;
  let idx = name.indexOf(":");
  if (idx === -1)
    throw new Error(`Error in mangled function name ${JSON.stringify(name)}: missing first ':'`);
  retval.name = name.substring(start, idx);
  start = idx + 1;
  idx = name.indexOf(":", start);
  if (idx === -1)
    throw new Error(`Error in mangled function name ${JSON.stringify(name)}: missing second ':'`);
  retval.modulename = name.substring(start, idx);
  start = idx + 1;
  idx = name.indexOf(":", start);
  if (idx === -1)
    throw new Error(`Error in mangled function name ${JSON.stringify(name)}: missing third ':'`);
  retval.returntype = parseMangledParameters(name.substring(start, idx))[0] ?? VariableType.Uninitialized;
  retval.parameters = parseMangledParameters(name.substring(idx + 1));
  return retval;
}

const allowedPrefixes = ["wh", "moduledata", "storage", "mod", "moduleroot", "module", "modulescript", "whfs", "site", "currentsite", "direct", "directclib", "relative", "test"] as const;
type AllowedPrefixes = typeof allowedPrefixes[number];

function getPrefix(uri: string): AllowedPrefixes {
  const prefix = uri.substring(0, uri.indexOf("::")) as AllowedPrefixes;
  if (!allowedPrefixes.includes(prefix))
    throw new Error(`Unknown file prefix ${JSON.stringify(prefix)} for uri ${JSON.stringify(uri)}`);
  return prefix;
}


type RegisteredExternal = {
  name: string;
  parameters: number;
  func?: ((vm: HareScriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => void);
  macro?: ((vm: HareScriptVM, ...params: HSVMVar[]) => void);
  asyncfunc?: ((vm: HareScriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => Promise<void>);
  asyncmacro?: ((vm: HareScriptVM, ...params: HSVMVar[]) => Promise<void>);
};

/** WASMModuleBase is an empty class we override to look like it contains all the properties the Emscripten
 * WASM module harescript.js provides.
 */
const WASMModuleBase = (class { }) as { new(): WASMModuleInterface };

export class WASMModule extends WASMModuleBase {

  stringptrs: Ptr = 0;
  externals = new Array<RegisteredExternal>;
  itf: HareScriptVM; // only one VM per module!
  lastSyncException: undefined | { error: unknown; stopAtFunction: string };

  constructor() {
    super();
    // this.itf is always set when running functions of this class, so make it look like it is (FIXME we might now need to guard it now that we can push WASMModules for reuse?)
    this.itf = undefined as unknown as HareScriptVM;
  }

  prepare() {
    // emscripten doesn't call preRun with class syntax, so bind it
    this["preRun"] = this["preRun"].bind(this);
  }

  prepareForReuse() { //ensures garbage can be collected when we're pushed for reuse
    this.itf = undefined as unknown as HareScriptVM;
  }

  init() {
    this.stringptrs = this._malloc(8);
  }

  initVM(hsvm: HSVM) {
    // can be overridden
  }

  getTempDir() {
    return process.env.WEBHARE_TEMP || (path.join(backendConfig.dataRoot, "tmp/"));
  }

  getWHResourceDir() {
    return path.join(backendConfig.installationRoot, "modules/system/whres/");
  }

  getDataRoot() {
    return backendConfig.dataRoot;
  }

  getInstallationRoot() {
    return backendConfig.installationRoot;
  }

  getCompileCache() {
    let cache = process.env.WEBHARE_HSBUILDCACHE;
    if (!cache)
      throw new Error("WEBHARE_HSBUILDCACHE not set");
    if (!cache.endsWith("/"))
      cache += "/";

    return cache;
  }

  doTranslateLibraryURI(directuri: string) {
    const moduri = translateDirectToModURI(directuri);
    if (moduri.startsWith(wh_namespace_location)) //wh:: lives in mod::system...
      return `wh::${moduri.substring(wh_namespace_location.length)}`;
    return moduri;
  }

  translateLibraryURI(directuri_ptr: Ptr) {
    const directuri = this.UTF8ToString(directuri_ptr);
    return this.stringToNewUTF8(this.doTranslateLibraryURI(directuri));
  }

  getOpenLibraryPath(uri_ptr: Ptr) {
    return this.stringToNewUTF8(mapHareScriptPath(this.UTF8ToString(uri_ptr)));
  }

  async recompile(uri_ptr: Ptr) {
    const uri = this.UTF8ToString(uri_ptr);
    const result = await recompileHarescriptLibraryRaw(uri);
    return this.stringToNewUTF8(result);
  }

  resolveAbsoluteLibrary(loader_ptr: Ptr, libname_ptr: Ptr) {
    let loader = this.UTF8ToString(loader_ptr);
    let libname = this.UTF8ToString(libname_ptr);

    loader = this.doTranslateLibraryURI(loader); //get rid of any direct:: paths
    if (libname.startsWith('relative::')) {
      // Grab the prefixed root. For mod/site we also want the first path component
      const split = loader.match(/^((?:wh::|(?:mod|site)::[^/]+\/))(.*)$/);
      if (!split)
        throw new Error(`Base path '${loader}' doesn't allow for relative adressing`);

      if (libname.startsWith('relative::/')) //module-root reference
        return this.stringToNewUTF8(split[1] + path.normalize(libname.substring(10)).substring(1));

      const targetpath = path.normalize("canary/" + path.dirname(split[2]) + "/" + libname.substring(10));
      if (!targetpath.startsWith("canary/"))
        throw new Error(`Relative path '${libname}' may not escape its context '${split[1]}'`);

      return this.stringToNewUTF8(split[1] + targetpath.substring(7));
    }

    const type = getPrefix(libname);
    libname = libname.substring(type.length + 2);
    libname = path.normalize(libname);

    if (type === "module" || type === "moduledata" || type === "modulescript" || type === "moduleroot") { //module:: should be rewritten to mod:: /lib/
      // Grab the prefixed root. For mod/site we also want the first path component
      const firstslash = libname.indexOf("/");
      const modulename = libname.substring(0, firstslash);
      let subpart = "";

      if (type === "moduledata") {
        subpart = "/data/";
      } else if (type === "modulescript") {
        subpart = "/scripts/";
      } else if (type === "moduleroot") {
        subpart = "/";
      } else {
        //See if /include/ exists, otherwise we'll go for lib (lib is considered default)
        let useinclude = false;

        const modroot = backendConfig.module[modulename]?.root;
        if (modroot) {
          const trylib = modroot + "include/" + libname.substring(firstslash + 1);
          useinclude = fs.existsSync(trylib);
        }
        subpart = useinclude ? "/include/" : "/lib/";
      }
      libname = "mod::" + modulename + subpart + libname.substring(firstslash + 1);
    } else {
      libname = type + (type === "direct" || type === "directclib" ? "::/" : "::") + libname;
    }

    if (libname.startsWith("mod::system/whlibs/"))
      libname = "wh::" + libname.substring(19);
    return this.stringToNewUTF8(libname);
  }

  async throwReturnedException(vm: HareScriptVM, e: unknown, stopAtFunction?: string) {
    let message: string;
    let stacktrace: stacktrace_parser.StackFrame[] = [];
    if (e instanceof Error) {
      stacktrace = stacktrace_parser.parse(e.stack || "");
      message = e.message;
      if (stopAtFunction) {
        const stopAt = stacktrace.findIndex(elt => elt.methodName.includes(stopAtFunction));
        if (stopAt !== -1)
          stacktrace.splice(stopAt);
      }
    } else
      message = `${e}`;

    // If the VM isn't usable anymore, just throw the exception directly
    if (this._HSVM_TestMustAbort(this.itf.hsvm)) {
      throw e;
    }

    const alloced = this.stringToNewUTF8(message);
    vm.assertRunPermission();
    await this._HSVM_ThrowException(vm.hsvm, alloced);
    this._free(alloced);

    const throwvar = new HSVMVar(vm, vm.wasmmodule._HSVM_GetThrowVar(vm.hsvm));
    const trace = throwvar.getMemberRef("pvt_trace", { allowMissing: true });
    if (!trace) {
      console.error(`No pvt_trace member in thrown exception when trying to throw exception ${JSON.stringify(e instanceof Error ? e.message : e)}`);
      throw new Error(`No pvt_trace member in thrown exception when trying to throw exception ${JSON.stringify(e instanceof Error ? e.message : e)}`);
    }
    trace.setJSValue(getTypedArray(VariableType.RecordArray, stacktrace.map(elt => ({
      filename: elt.file || "unknown",
      line: elt.lineNumber || 1,
      col: elt.column || 1,
      func: elt.methodName || "anonymous"
    }))));
  }

  executeJSMacro(vm: HSVM, nameptr: StringPtr, id: number): boolean {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    const transitionLock = debugFlags.async ? this.itf!.startTransition(false, reg.name) : undefined;
    try {
      const res: unknown = reg.macro!(this.itf, ...params);
      if (res && typeof res === "object" && "then" in res)
        throw new Error(`Return value of ${JSON.stringify(reg.name)} is a Promise, should have been registered with executeJSMacro`);
      return true;
    } catch (e) {
      this.lastSyncException = { error: e, stopAtFunction: "executeJSMacro" };
      return false;
    } finally {
      transitionLock?.close();
    }
  }

  executeJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): boolean {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    const transitionLock = debugFlags.async ? this.itf!.startTransition(false, reg.name) : undefined;
    try {
      const res: unknown = reg.func!(this.itf, new HSVMVar(this.itf!, id_set), ...params);
      if (res && typeof res === "object" && "then" in res)
        throw new Error(`Return value of ${JSON.stringify(reg.name)} is a Promise, should have been registered with executeJSFunction`);
      return true;
    } catch (e) {
      this.lastSyncException = { error: e, stopAtFunction: "executeJSFunction" };
      return false;
    } finally {
      transitionLock?.close();
    }
  }

  async throwLastSyncException() {
    if (!this.lastSyncException)
      throw new Error(`No lastSyncException set`);
    const data = this.lastSyncException;
    this.lastSyncException = undefined;
    await this.throwReturnedException(this.itf!, data.error, data.stopAtFunction);
  }

  async executeAsyncJSMacro(vm: HSVM, nameptr: StringPtr, id: number): Promise<void> {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    const transitionLock = debugFlags.async ? this.itf!.startTransition(false, reg.name) : undefined;
    try {
      await reg.asyncmacro!(this.itf, ...params);
    } catch (e) {
      await this.throwReturnedException(this.itf!, e, "executeAsyncJSMacro");
    } finally {
      transitionLock?.close();
    }
  }

  async executeAsyncJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): Promise<void> {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    const transitionLock = debugFlags.async ? this.itf!.startTransition(false, reg.name) : undefined;
    try {
      await reg.asyncfunc!(this.itf, new HSVMVar(this.itf!, id_set), ...params);
    } catch (e) {
      await this.throwReturnedException(this.itf!, e, "executeAsyncJSFunction");
    } finally {
      transitionLock?.close();
    }
  }

  registerExternalMacro(signature: string, macro: (vm: HareScriptVM, ...params: HSVMVar[]) => void): void {
    if (!macro.name)
      Object.defineProperty(macro, "name", { value: signature });
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, macro });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHareScriptMacro(signatureptr, id, 0);
    this._free(signatureptr);
  }

  registerExternalFunction(signature: string, func: (vm: HareScriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => void): void {
    if (!func.name)
      Object.defineProperty(func, "name", { value: signature });
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, func });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHareScriptFunction(signatureptr, id, 0);
    this._free(signatureptr);
  }

  registerAsyncExternalMacro(signature: string, asyncmacro: (vm: HareScriptVM, ...params: HSVMVar[]) => Promise<void>): void {
    if (!asyncmacro.name)
      Object.defineProperty(asyncmacro, "name", { value: signature });
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, asyncmacro });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHareScriptMacro(signatureptr, id, 1);
    this._free(signatureptr);
  }

  registerAsyncExternalFunction(signature: string, asyncfunc: (vm: HareScriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => Promise<void>): void {
    if (!asyncfunc.name)
      Object.defineProperty(asyncfunc, "name", { value: signature });
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, asyncfunc });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHareScriptFunction(signatureptr, id, 1);
    this._free(signatureptr);
  }

  preRun() {
    Object.assign(this.ENV, process.env);
  }

  /** Overrides the emscripten instantiation functions so we can save the WebAssembly module and distribute it to
   * jobs so we can avoid reading the wasm file from disk and compiling it.
   */
  async instantiateWasm(imports: WebAssembly.Imports, receiveInstance: (instance: WebAssembly.Instance, module?: WebAssembly.Module) => object) {
    if (cachedWebAssemblyModule) {
      // synchronous variable cachedWebAssemblyModule already set, use it
      const instance = await WebAssembly.instantiate(cachedWebAssemblyModule, imports);
      receiveInstance(instance);
    } else if (!webAssemblyInstantiatedSourcePromise) {
      // No instantiation promise present yet, fill it with a new instantiation.
      webAssemblyInstantiatedSourcePromise = (async () => {
        const wasmFilePath = process.env.WEBHARE_WASMMODULEDIR ?
          path.join(process.env.WEBHARE_WASMMODULEDIR, "harescript.wasm") :
          path.join(__dirname, "../../../lib/harescript.wasm");
        const binary = await fs.promises.readFile(wasmFilePath);
        return await WebAssembly.instantiate(binary, imports);
      })();
      // We wrote the webAssemblyInstantiatedSourcePromise, we can use its instance
      const { instance, module } = await webAssemblyInstantiatedSourcePromise;
      cachedWebAssemblyModule ??= module;
      receiveInstance(instance);
    } else {
      // We didn't write the webAssemblyInstantiatedSourcePromise, use its module to create a new instance
      const { module } = await webAssemblyInstantiatedSourcePromise;
      cachedWebAssemblyModule ??= module;
      const instance = await WebAssembly.instantiate(cachedWebAssemblyModule, imports);
      receiveInstance(instance);
    }
  }

  /** In node 21 and 22, a WebAssambly async function will resume without its AsyncStorage context (due to
   * missing callbacks to node Async tracking in v8). See https://github.com/nodejs/node/issues/51832.
   * Working around that by restoring the async context on every called imported JS function. The hooks to
   * call the following functions are installed in the emcc compiled code by fix-emcc-output.js */

  asyncResource: AsyncResource | undefined;

  fixAsyncImportForAsyncStorage(func: (...args: unknown[]) => unknown) {
    return (...args: unknown[]) => {
      if (!executionAsyncId() && this.asyncResource) {
        // Lost the correct async resource, restore it
        return this.asyncResource.runInAsyncScope(() => func(...args));
      } else
        return func(...args);
    };
  }

  fixSyncImportForAsyncStorage(func: (...args: unknown[]) => unknown) {
    return (...args: unknown[]) => {
      if (!executionAsyncId() && this.asyncResource) {
        // Lost the correct async resource, restore it
        return this.asyncResource.runInAsyncScope(() => func(...args));
      } else
        return func(...args);
    };
  }

  fixAsyncExportForAsyncStorage(func: (...args: unknown[]) => unknown) {
    return (...args: unknown[]) => {
      const curExecutionAsyncId = executionAsyncId();
      if (this.asyncResource?.asyncId() !== curExecutionAsyncId) {
        // Create a new async resource for this call. safe the old to make sure recursive calls don't lose context
        const orgAsyncResource = this.asyncResource;
        this.asyncResource = new AsyncResource(`WASMModule`, { triggerAsyncId: curExecutionAsyncId });
        try {
          const retval = this.asyncResource.runInAsyncScope(() => func(...args));
          if (typeof retval === "object" && retval && "then" in retval && typeof retval.then === "function") {
            return retval.then((res: unknown) => {
              this.asyncResource = orgAsyncResource;
              return res;
            });
          }
          this.asyncResource = orgAsyncResource;
          return retval;
        } catch (e) {
          this.asyncResource = orgAsyncResource;
          throw e;
        }
      } else {
        // current executionAsyncId() is already correct, just run the function
        return func(...args);
      }
    };
  }

  fixSyncExportForAsyncStorage(func: (...args: unknown[]) => unknown) {
    return (...args: unknown[]) => {
      const curExecutionAsyncId = executionAsyncId();
      if (this.asyncResource?.asyncId() !== curExecutionAsyncId) {
        // Create a new async resource for this call. safe the old to make sure recursive calls don't lose context
        const orgAsyncResource = this.asyncResource;
        this.asyncResource = new AsyncResource(`WASMModule`, { triggerAsyncId: curExecutionAsyncId });
        try {
          return this.asyncResource.runInAsyncScope(() => func(...args));
        } finally {
          this.asyncResource = orgAsyncResource;
        }
      } else {
        // current executionAsyncId() is already correct, just run the function
        return func(...args);
      }
    };
  }

  activeRunBreakLocks = new Map<number, { [Symbol.dispose]: () => Promise<void> }>();
  activeRunBreakLockCounter = 0;

  breakPipeWaiterOnRequest() {
    const id = ++this.activeRunBreakLockCounter;
    const borrow = this.itf!.breakPipeWaiterOnRequest();
    this.activeRunBreakLocks.set(id, borrow);
    return id;
  }

  async releaseBreakPipeWaiterOnRequest(id: number) {
    const lock = this.activeRunBreakLocks.get(id);
    if (!lock)
      throw new Error(`No borrow with id ${id} found`);
    this.activeRunBreakLocks.delete(id);
    await lock[Symbol.dispose]();
  }

  anyPendingPermissionRequests() {
    return this.itf!.anyPendingPermissionRequests();
  }

  streamWriteData = new Map<number, {
    broken: boolean;

  }>;

  async standardWrite(fd: number, numbytes: number, data: Ptr): Promise<number> {
    try {
      // Copy the data, didn't find any guarantee that the data is copied synchronously on .write()
      const toWrite = this.HEAPU8.slice(data, data + numbytes);
      if (fd === 0 || fd === 1 || fd === 2) {
        const stream = fd === 2 ? process.stderr : process.stdout;
        let streamData = this.streamWriteData.get(fd);
        if (!streamData) {
          this.streamWriteData.set(fd, streamData = {
            broken: false
          });
          stream.on("error", () => streamData!.broken = true);
        }
        if (stream.writableEnded)
          return 0;
        const res = stream.write(toWrite, (err) => console.error(`write to fd ${fd} returned error`, err));

        // if write returns false, we need to wait for 'drain' to avoid excessive memory use
        if (!res) {
          await new Promise<void>(resolve => stream.once("drain", () => resolve()));
        }
        return toWrite.byteLength;
      } else {
        const res = await new Promise<{ err: NodeJS.ErrnoException | null; bytesWritten: number }>(resolve => fs.write(fd, toWrite, (err, bytesWritten) => resolve({ err, bytesWritten })));
        return res.bytesWritten;
      }
    } catch (e) {
      return 0;
    }
  }

  /** Print debuginfo from C++ (javascript stack trace and VM stack trace)
   * Usage:
   * ```
   * EM_ASM({ Module.debugPoint("show this text") }, 0);
   * ```
   */
  debugPoint(str: string) {
    console.trace(`debugPoint ${this.itf!.currentgroup}: ${str}`);
    console.log(`VM stack trace:`, this.itf!.getStackTraceString());
  }
}

export enum SocketError {
  ///nothing went wrong
  NoError = 0,
  ///a not (yet) supported error
  UnknownError = -1,
  ///the socket/connection has been gracefully closed
  Closed = -2,
  ///there was no connection
  Unconnected = -3,
  ///address already in use
  InUse = -4,
  ///there is still data left to be sent
  DataLeft = -5,
  ///message too big for underlying protocol
  TooBig = -6,
  ///destination unreachable
  Unreachable = -7,
  ///connection refused
  Refused = -8,
  ///a time limited call timed out
  Timeout = -9,
  ///the socket was already connected
  AlreadyConnected = -10,
  ///invalid argument, or invalid action for this socket state/type
  InvalidArgument = -11,
  ///the socket/connection has already been disconnected
  AlreadyDisconnected = -12,
  ///The call would block
  WouldBlock = -13,
  ///Connecting is already in progress
  AlreadyInProgress = -14,
  ///Tis operation requires a nonblocking socket
  SocketIsBlocking = -15,
  ///Unable to resolve hostname
  UnableToResolveHostname = -16,
  ///The connection has been reset
  ConnectionReset = -17,
  ///Address family not supported (eg trying to connect an ipv4 bound socket to a ipv6 port)
  AddressFamilyNotSupported = -18,
  ///Address not available
  AddressNotAvailable = -19,
  ///Access denied (ie <1024 port)
  AccessDenied = -20,
  ///marked to limit the error list: MUST ALWAYS BE LAST - DO NOT ADD ANY ERRORS BELOW SOCKETERRORLIMIT
  SocketErrorLimit = -21
}

/** Represents an OutputObject in HareScript */
export class OutputObjectBase {
  static vmTypeStrings = new WeakMap<HareScriptVM, Record<string, number>>;
  readonly vm: HareScriptVM;
  readonly id: number;
  closed = false;
  private _readSignalled = true;
  private _writeSignalled = true;
  private _unregisteredId = false;

  constructor(vm: HareScriptVM, type: string) {
    let typeStrings = OutputObjectBase.vmTypeStrings.get(vm);
    if (!typeStrings) {
      typeStrings = {};
      OutputObjectBase.vmTypeStrings.set(vm, typeStrings);
    }

    this.vm = vm;
    const typestr = typeStrings[type] ??= this.vm.wasmmodule.stringToNewUTF8(type);
    this.id = this.vm.wasmmodule._CreateWASMOutputObject(vm.hsvm, this.vm.wasmmodule.Emval.toHandle(this), typestr);
  }

  /** Called when read from the outputobject. Wrapper to create nice Buffers and process the signalled status */
  private _read(numbytes: number, ptr: number): { error?: SocketError; bytes: number; signalled?: boolean } {
    const res = this.read(Buffer.from(this.vm.wasmmodule.HEAPU8.buffer, ptr, numbytes));
    if (typeof res.signalled === "boolean")
      this._readSignalled = res.signalled;
    return res;
  }

  /** Called when written to the outputobject. Wrapper to create nice Buffers and process the signalled status */
  private _write(numbytes: number, ptr: number, allowPartial: boolean): { error?: SocketError; bytes: number; signalled?: boolean } {
    const res = this.write(Buffer.from(this.vm.wasmmodule.HEAPU8.buffer, ptr, numbytes), allowPartial);
    if (typeof res.signalled === "boolean")
      this._writeSignalled = res.signalled;
    return res;
  }

  /** Called just before a wait so wait status can be checked synchronously */
  protected syncUpdateReadSignalled() {
    /* empty */
  }

  /** Called just before a wait so wait status can be checked synchronously */
  protected syncUpdateWriteSignalled() {
    /* empty */
  }

  /** Called by HareScript when the outputobject has been deregistered */
  protected _closed() {
    this._unregisteredId = true;
    this.close();
    if (!this.closed)
      throw new Error(`The close() function of outputobjects should call super.close()!`);
  }

  /** Updates the read signalled status */
  protected setReadSignalled(newsignalled: boolean) {
    if (this._readSignalled !== newsignalled) {
      this.vm.wasmmodule._SetWASMOutputObjectReadSignalled(this.vm.hsvm, this.id, newsignalled ? 1 : 0);
      this._readSignalled = newsignalled;
    }
  }

  /** Updates the write signalled status */
  protected setWriteSignalled(newsignalled: boolean) {
    if (this._writeSignalled !== newsignalled) {
      this._writeSignalled = newsignalled;
      this.vm.wasmmodule._SetWASMOutputObjectWriteSignalled(this.vm.hsvm, this.id, newsignalled ? 1 : 0);
    }
  }

  /** Called when read from the outputobject. Place the data in the buffer at position 0, report the
   * number of bytes placed in the buffer.
   */
  read(buffer: Buffer): { error?: SocketError; bytes: number; signalled?: boolean } {
    return { bytes: 0 };
  }

  /** Called when written to the outputobject. Process the data in the buffer from position 0, report the
   * number of bytes processed.
   */
  write(buffer: Buffer, allowPartial: boolean): { error?: SocketError; bytes: number; signalled?: boolean } {
    return { bytes: 0 };
  }

  /** Returns whether there is potentially more data present. At EOF, no more data will arrive, even
   * after waiting indefinitely.
   */
  isAtEOF() {
    return true;
  }

  /** Close the outputobject, unregister its id in HareScript. Is called by the `_closed` callback  */
  close() {
    if (!this._unregisteredId) {
      this._unregisteredId = true;
      this.vm.wasmmodule._CloseWASMOutputObject(this.vm.hsvm, this.id);
    }
    this.closed = true;
  }
}

///compile library, return raw fetch result
export async function recompileHarescriptLibraryRaw(uri: string, options?: { force: boolean }) {
  try {
    // console.log(`recompileHarescriptLibrary`, uri);

    const res = await fetch(`${getCompileServerOrigin()}/compile/${encodeURIComponent(uri)}`, {
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
    /*
      iserror: !errorparts[0] || !errorparts[0].startsWith("W"),
      line: parseInt(errorparts[1]),
      col: parseInt(errorparts[2]),
      filename: errorparts[3],
      code: parseInt(errorparts[4]),
      msg1: errorparts[5],
      msg2: errorparts[6],
      message: decodeString(errorparts[7], 'html')
    (*/
    const msg = `Compilation failed: ${(e as Error).message}`;
    return `E\t0\t0\t${uri}\t0\t${msg}\t\t${msg}`;
  }
}

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

export async function recompileHarescriptLibrary(uri: string, options?: { force: boolean }) {
  const text = await recompileHarescriptLibraryRaw(uri, options);
  const lines = text.split("\n").filter(line => line);
  return lines.map(line => parseError(line));
}
