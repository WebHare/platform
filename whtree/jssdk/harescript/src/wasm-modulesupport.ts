import type { HSVM, HSVM_VariableId, WASMModuleInterface, Ptr, StringPtr } from "../../../lib/harescript-interface";
import * as path from "node:path";
import * as fs from "node:fs";
import { config, toFSPath } from "@webhare/services";
import { HSVMVar } from "./wasm-hsvmvar";
import { recompileHarescriptLibraryRaw, type HarescriptVM } from "./wasm-hsvm";
import { VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";

const wh_namespace_location = "mod::system/whlibs/";
function translateDirectToModURI(directuri: string) {
  if (directuri.startsWith("direct::")) { //it's actually a direct::
    const directpath = directuri.substring(8);
    for (const [modulename, modconfig] of Object.entries(config.module))
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
  func?: ((vm: HarescriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => void);
  macro?: ((vm: HarescriptVM, ...params: HSVMVar[]) => void);
  asyncfunc?: ((vm: HarescriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => Promise<void>);
  asyncmacro?: ((vm: HarescriptVM, ...params: HSVMVar[]) => Promise<void>);
};

/** WASMModuleBase is an empty class we override to look like it contains all the properties the Emscripten
 * WASM module harescript.js provides.
 */
const WASMModuleBase = (class { }) as { new(): WASMModuleInterface };

export class WASMModule extends WASMModuleBase {

  stringptrs: Ptr = 0;
  externals = new Array<RegisteredExternal>;
  itf: HarescriptVM; // only one VM per module!

  constructor() {
    super();
    // this.itf is always set when running functions of this class, so make it look like it is
    this.itf = undefined as unknown as HarescriptVM;
  }

  prepare() {
    // emscripten doesn't call preRun with class syntax, so bind it
    this["preRun"] = this["preRun"].bind(this);
  }

  init() {
    this.stringptrs = this._malloc(8);
  }

  initVM(hsvm: HSVM) {
    // can be overridden
  }

  getTempDir() {
    return process.env.WEBHARE_TEMP || path.join(config.dataroot || "tmp/");
  }

  getWHResourceDir() {
    return path.join(config.installationroot, "modules/system/whres/");
  }

  getDataRoot() {
    return config.dataroot;
  }

  getInstallationRoot() {
    return config.installationroot;
  }

  getCompileCache() {
    let cache = process.env.WEBHARE_COMPILECACHE;
    if (cache && !cache.endsWith("/"))
      cache += "/";
    else if (!cache) {
      cache = config.dataroot + "ephemeral/compilecache/";
    }
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
    const uri = this.UTF8ToString(uri_ptr);
    let retval;
    //Legacy HareScript namespaces we may not want to retain in JS
    if (uri.startsWith("direct::"))
      retval = uri.substring(8);
    else if (uri.startsWith("wh::"))
      retval = toFSPath("mod::system/whlibs/" + uri.substring(4));
    else
      retval = toFSPath(uri);
    return this.stringToNewUTF8(retval);
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

    if (type == "module" || type == "moduledata" || type == "modulescript" || type == "moduleroot") { //module:: should be rewritten to mod:: /lib/
      // Grab the prefixed root. For mod/site we also want the first path component
      const firstslash = libname.indexOf("/");
      const modulename = libname.substring(0, firstslash);
      let subpart = "";

      if (type == "moduledata") {
        subpart = "/data/";
      } else if (type == "modulescript") {
        subpart = "/scripts/";
      } else if (type == "moduleroot") {
        subpart = "/";
      } else {
        //See if /include/ exists, otherwise we'll go for lib (lib is considered default)
        let useinclude = false;

        const modroot = config.module[modulename]?.root;
        if (modroot) {
          const trylib = modroot + "include/" + libname.substring(firstslash + 1);
          useinclude = fs.existsSync(trylib);
        }
        subpart = useinclude ? "/include/" : "/lib/";
      }
      libname = "mod::" + modulename + subpart + libname.substring(firstslash + 1);
    } else {
      libname = type + (type == "direct" || type == "directclib" ? "::/" : "::") + libname;
    }

    if (libname.startsWith("mod::system/whlibs/"))
      libname = "wh::" + libname.substring(19);
    return this.stringToNewUTF8(libname);
  }

  throwException(vm: HSVM, text: string): void {
    const alloced = this.stringToNewUTF8(text);
    this._HSVM_ThrowException(vm, alloced);
    this._free(alloced);
  }

  executeJSMacro(vm: HSVM, nameptr: StringPtr, id: number): void {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    reg.macro!(this.itf, ...params);
  }

  executeJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): void {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    reg.func!(this.itf, new HSVMVar(this.itf!, id_set), ...params);
  }

  async executeAsyncJSMacro(vm: HSVM, nameptr: StringPtr, id: number): Promise<void> {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    await reg.asyncmacro!(this.itf, ...params);
  }

  async executeAsyncJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): Promise<void> {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    // ignoring vm, using itf: only one VM per module!
    await reg.asyncfunc!(this.itf, new HSVMVar(this.itf!, id_set), ...params);
  }

  registerExternalMacro(signature: string, macro: (vm: HarescriptVM, ...params: HSVMVar[]) => void): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, macro });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptMacro(signatureptr, id, 0);
    this._free(signatureptr);
  }

  registerExternalFunction(signature: string, func: (vm: HarescriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => void): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, func });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptFunction(signatureptr, id, 0);
    this._free(signatureptr);
  }

  registerAsyncExternalMacro(signature: string, asyncmacro: (vm: HarescriptVM, ...params: HSVMVar[]) => Promise<void>): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, asyncmacro });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptMacro(signatureptr, id, 1);
    this._free(signatureptr);
  }

  registerAsyncExternalFunction(signature: string, asyncfunc: (vm: HarescriptVM, id_set: HSVMVar, ...params: HSVMVar[]) => Promise<void>): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, asyncfunc });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptFunction(signatureptr, id, 1);
    this._free(signatureptr);
  }

  preRun() {
    Object.assign(this.ENV, process.env);
  }
}
