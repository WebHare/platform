import { HSVM, HSVM_ColumnId, HSVM_VariableId, HSVM_VariableType, Module, Ptr, StringPtr } from "./dllinterface";
import { IPCMarshallableData, VariableType, decodeHSON, encodeHSON } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import * as path from "node:path";
import * as fs from "node:fs";
import { config, toFSPath } from "@webhare/services";
import { decodeString } from "@webhare/std";

// @ts-ignore: implicitly has an `any` type
import createModule from "../../../lib/harescript";
import * as syscalls from "./syscalls";

type SysCallsModule = { [key: string]: (data: unknown) => unknown };

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

export class HSVMVar {
  vm: HarescriptVM;
  id: HSVM_VariableId;
  type: VariableType | undefined;

  constructor(vm: HarescriptVM, id: HSVM_VariableId) {
    this.vm = vm;
    this.id = id;
  }

  checkType(type: VariableType) {
    this.type ??= this.vm.module._HSVM_GetType(this.vm.hsvm, this.id);
    if (this.type !== type)
      throw new Error(`Variable doesn't have expected type ${VariableType[type]}, but got ${VariableType[this.type]}`);
  }
  getInteger(): number {
    this.checkType(VariableType.Integer);
    return this.vm.module._HSVM_IntegerGet(this.vm.hsvm, this.id);
  }
  setInteger(value: number) {
    // this.checkType(VariableType.Integer);
    this.vm.module._HSVM_IntegerSet(this.vm.hsvm, this.id, value);
    this.type = VariableType.Integer;
  }
  getString(): string {
    this.checkType(VariableType.String);
    this.vm.module._HSVM_StringGet(this.vm.hsvm, this.id, this.vm.module.stringptrs, this.vm.module.stringptrs + 4);
    const begin = this.vm.module.getValue(this.vm.module.stringptrs, "*") as number;
    const end = this.vm.module.getValue(this.vm.module.stringptrs + 4, "*") as number;
    // TODO: can we useuffer and its utf-8 decoder? strings can also contain \0
    return this.vm.module.UTF8ToString(begin, end - begin);
  }
  setString(value: string) {
    // this.checkType(VariableType.String);
    const len = this.vm.module.lengthBytesUTF8(value);
    const alloced = this.vm.module._malloc(len + 1);
    this.vm.module.stringToUTF8(value, alloced, len + 1);
    this.vm.module._HSVM_StringSet(this.vm.hsvm, this.id, alloced, alloced + len);
    this.vm.module._free(alloced);
    this.type = VariableType.String;
  }
  setDefault(type: VariableType): HSVMVar {
    if (type === VariableType.Array)
      throw new Error(`Illegal variable type ${VariableType[type] ?? type}`);
    this.vm.module._HSVM_SetDefault(this.vm.hsvm, this.id, type as HSVM_VariableType);
    this.type = type;
    return this;
  }
  arrayAppend() {
    this.type ??= this.vm.module._HSVM_GetType(this.vm.hsvm, this.id);
    if (!(this.type & 0x80))
      throw new Error(`Variable is not an ARRAY`);
    const eltid = this.vm.module._HSVM_ArrayAppend(this.vm.hsvm, this.id);
    return new HSVMVar(this.vm, eltid);
  }
  ensureCell(name: string) {
    this.type ??= this.vm.module._HSVM_GetType(this.vm.hsvm, this.id);
    if (this.type !== VariableType.Record)
      throw new Error(`Variable is not an RECORD`);

    const columnid = this.vm.getColumnId(name);
    const newid = this.vm.module._HSVM_RecordCreate(this.vm.hsvm, this.id, columnid);
    return new HSVMVar(this.vm, newid);
  }
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
    throw new Error(`Unknown file prefix '${JSON.stringify(prefix)}' for uri ${JSON.stringify(uri)}`);
  return prefix;
}

const dispatchlibrary = "mod::system/js/internal/wasm/dispatch.whlib";
const dispatchname = "DISPATCH";

type MessageList = Array<{
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

function parseError(module: Module, line: string) {

  const errorparts = line.split("\t");
  if (errorparts.length < 8)
    throw new Error("Unrecognized error string returned by HareScript compiler");

  return {
    iserror: !errorparts[0] || !errorparts[0].startsWith("W"),
    line: parseInt(errorparts[1]),
    column: parseInt(errorparts[2]),
    filename: errorparts[3],
    code: parseInt(errorparts[4]),
    msg1: errorparts[5],
    msg2: errorparts[6],
    message: decodeString(errorparts[7], 'html')
  };
}

async function recompileHarescriptLibrary(module: Module, uri: string, options?: { force: boolean }) {
  try {
    // console.log(`recompileHarescriptLibrary`, uri);

    const res = await fetch(`http://127.0.0.1:${getFullConfigFile().baseport + 1}/compile/${encodeURIComponent(uri)}`, {
      headers: {
        "X-WHCompile-Priority": "2", // CompilationPriority::ClassBackground
        ...(options?.force ? { "X-WHCompile-Force": "true" } : {})
      }
    });
    // console.log({ res });

    if (res.status === 200 || res.status === 403) {
      const text = await res.text();
      // console.log({ text });
      const lines = text.split("\n").filter(line => line);
      // console.log('recompileresult:', res.status, lines);
      return lines.map(line => parseError(module, line));
    }
    throw new Error(`Could not contact HareScript compiler, status code ${res.status}`);
  } catch (e) {
    console.log({ recompileerror: e });
    throw e;
  }
}

function ensureItfSet(module: Module): asserts module is Module & { itf: HarescriptVM } {
  if (!module.itf)
    throw new Error(`Initialization of Harescript module not complete`);
}

export class HarescriptVM {
  module: Module;
  hsvm: HSVM;
  errorlist: HSVM_VariableId;
  dispatchfptr: HSVM_VariableId;
  havedispatchfptr = false;
  columnnamebuf: StringPtr;
  /// 8-bute array for 2 ptrs for getstring
  stringptrs: Ptr;
  consoleArguments: string[];
  columnNameIdMap: Record<string, HSVM_ColumnId> = {};

  constructor(module: Module, hsvm: HSVM) {
    this.module = module;
    module.itf = this;
    this.hsvm = hsvm;
    this.dispatchfptr = module._HSVM_AllocateVariable(hsvm);
    this.errorlist = module._HSVM_AllocateVariable(hsvm);
    this.columnnamebuf = module._malloc(65);
    this.stringptrs = module._malloc(8); // 2 string pointers
    this.consoleArguments = [];
  }

  getColumnName(columnid: HSVM_ColumnId): string {
    this.module._HSVM_GetColumnName(this.hsvm, columnid, this.columnnamebuf);
    return this.module.UTF8ToString(this.columnnamebuf).toLowerCase();
  }

  getColumnId(name: string): HSVM_ColumnId {
    const id = this.columnNameIdMap[name];
    if (id)
      return id;
    this.module.stringToUTF8(name, this.columnnamebuf, 64);
    return this.columnNameIdMap[name] = this.module._HSVM_GetColumnId(this.hsvm, this.columnnamebuf);
  }

  quickParseVariable(variable: HSVM_VariableId): IPCMarshallableData {
    let value;
    const type = this.module._HSVM_GetType(this.hsvm, variable);
    switch (type) {
      case VariableType.Integer: {
        value = this.module._HSVM_IntegerGet(this.hsvm, variable);
      } break;
      case VariableType.Boolean: {
        value = Boolean(this.module._HSVM_BooleanGet(this.hsvm, variable));
      } break;
      case VariableType.String: {
        this.module._HSVM_StringGet(this.hsvm, variable, this.stringptrs, this.stringptrs + 4);
        const begin = this.module.getValue(this.stringptrs, "*") as number;
        const end = this.module.getValue(this.stringptrs + 4, "*") as number;
        value = this.module.UTF8ToString(begin, end - begin);
      } break;
      case VariableType.RecordArray: {
        value = [];
        const eltcount = this.module._HSVM_ArrayLength(this.hsvm, variable);
        for (let i = 0; i < eltcount; ++i) {
          const elt = this.module._HSVM_ArrayGetRef(this.hsvm, variable, i);
          value.push(this.quickParseVariable(elt));
        }
      } break;
      case VariableType.Record: {
        if (!this.module._HSVM_RecordExists(this.hsvm, variable))
          value = null;
        else {
          const cellcount = this.module._HSVM_RecordLength(this.hsvm, variable);
          value = {};
          for (let pos = 0; pos < cellcount; ++pos) {
            const columnid = this.module._HSVM_RecordColumnIdAtPos(this.hsvm, variable, pos);
            const cell = this.module._HSVM_RecordGetRef(this.hsvm, variable, columnid);
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
    const lib_str = this.module.stringToNewUTF8(lib);
    try {
      const maxTries = 5;
      for (let tryCounter = 0; tryCounter < maxTries; ++tryCounter) {
        this.module._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);
        const fptrresult = this.module._HSVM_LoadScript(this.hsvm, lib_str);
        if (fptrresult)
          return; //Success!

        this.module._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
        const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
        if (tryCounter < maxTries - 1 && parsederrors.length === 1 && [2, 139, 157].includes(parsederrors[0].code)) {
          let recompileres = await recompileHarescriptLibrary(this.module, lib);
          recompileres = recompileres.filter(msg => msg.iserror);
          if (recompileres.length)
            throw new Error(`Error during compilation of ${lib}: ` + recompileres[0].message);
        } else {
          throw new Error(`Error loading library ${lib}: ${parsederrors[0].message || "Unknown error"}`);
        }
      }

      // Should be unreachable, in last tries the returned error is thrown
      throw new Error(`Could not compile library after ${maxTries} tries`);
    } finally {
      this.module._free(lib_str);
    }
  }

  async executeScript(): Promise<void> {
    if (this.module._HSVM_ExecuteScript(this.hsvm, 1, 0) === 1)
      return;

    this.module._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
    const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
    if (parsederrors.length) {
      const trace = parsederrors.filter(e => e.istrace).map(e =>
        `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})}`).join("");
      throw new Error(`Error executing script: ${parsederrors[0].message + trace}`);
    } else
      throw new Error(`Error executing script`);
  }

  async makeFunctionPtr(fptr: HSVM_VariableId, lib: string, name: string): Promise<boolean> {
    const lib_str = this.module.stringToNewUTF8(lib);
    const name_str = this.module.stringToNewUTF8(name);
    try {
      const maxTries = 5;
      for (let tryCounter = 0; tryCounter < maxTries; ++tryCounter) {
        this.module._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);
        const fptrresult = this.module._HSVM_MakeFunctionPtrAutoDetect(this.hsvm, fptr, lib_str, name_str, this.errorlist);
        switch (fptrresult) {
          case 0:
          case -2: {
            let parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
            if (parsederrors.length === 0) { //runtime errors are in the VM's mesage list
              this.module._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
              parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
            }
            if (tryCounter < maxTries - 1 && parsederrors.length === 1 && [2, 139, 157].includes(parsederrors[0].code)) {
              let recompileres = await recompileHarescriptLibrary(this.module, lib);
              recompileres = recompileres.filter(msg => msg.iserror);
              if (recompileres.length)
                throw new Error(`Error during compilation of ${lib}: ` + recompileres[0].message);
            } else {
              throw new Error(`Error loading library ${lib}: ${parsederrors[0].message || "Unknown error"}`);
            }
          } break;
          case -1: throw new Error(`No such function ${lib}#${name}`);
          case 1: return true;
        }
      }

      // Should be unreachable, in last tries the returned error is thrown
      throw new Error(`Could not compile library after ${maxTries} tries`);
    } finally {
      this.module._free(lib_str);
      this.module._free(name_str);
    }
  }

  async run(library: string): Promise<void> {
    await this.loadScript(library);
    await this.executeScript();
    return;
  }

  async call(functionref: string, ...params: IPCMarshallableData[]): Promise<IPCMarshallableData> {
    const parts = functionref.split("#");
    if (parts.length !== 2)
      throw new Error(`Illegal function reference ${JSON.stringify(functionref)}`);

    const marshaldata = {
      functionref,
      params
    };

    if (!this.havedispatchfptr) {
      await this.makeFunctionPtr(this.dispatchfptr, dispatchlibrary, dispatchname);
      this.havedispatchfptr = true;
    }

    const callfuncptr = this.module._HSVM_AllocateVariable(this.hsvm);
    try {
      await this.makeFunctionPtr(callfuncptr, parts[0], parts[1]);

      // console.log(`clear errorlist`);
      this.module._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);

      const hson = encodeHSON(marshaldata);
      const len = this.module.lengthBytesUTF8(hson);
      const hsondata = this.module._malloc(len + 1);
      this.module.stringToUTF8(hson, hsondata, len + 1);

      // console.log(`open call`);
      this.module._HSVM_OpenFunctionCall(this.hsvm, 2);
      this.module._HSVM_CopyFrom(this.hsvm, this.module._HSVM_CallParam(this.hsvm, 0), callfuncptr);
      this.module._HSVM_StringSet(this.hsvm, this.module._HSVM_CallParam(this.hsvm, 1), hsondata, hsondata + len);
      this.module._free(hsondata);
      // console.log(`call functionptr`, this.dispatchfptr, VariableType[this.module._HSVM_GetType(this.hsvm, this.dispatchfptr)]);
      // console.log(`call functionptr`, this.module._HSVM_GetType(this.hsvm, this.dispatchfptr));
      const retvalid = this.module._HSVM_CallFunctionPtr(this.hsvm, this.dispatchfptr, 0);
      // console.log({ retvalid });
      if (!retvalid) {
        this.module._HSVM_CloseFunctionCall(this.hsvm);
        this.module._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
        const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
        const trace = parsederrors.filter(e => e.istrace).map(e =>
          `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})}`).join("");
        throw new Error((parsederrors[0].message ?? "Unknown error") + trace);
      } else {
        const retval = this.quickParseVariable(retvalid);
        this.module._HSVM_CloseFunctionCall(this.hsvm);

        const plainvalue = decodeHSON(retval as string) as { value: IPCMarshallableData };
        return plainvalue.value;
      }
    } finally {
      this.module._HSVM_DeallocateVariable(this.hsvm, callfuncptr);
    }
  }
}

async function createHarescriptModule(): Promise<Module> {
  // Store into variable 'module' so functions can refer to it
  const module = await createModule({
    emSyscall(jsondata_ptr: number): string {
      const jsondata = module.UTF8ToString(jsondata_ptr);
      const { call, data } = JSON.parse(jsondata);
      if (!(syscalls as SysCallsModule)[call])
        return "unknown";

      const result = (syscalls as SysCallsModule)[call](data);
      return JSON.stringify(result);
    },

    getTempDir() {
      return process.env.WEBHARE_TEMP || path.join(config.dataroot || "tmp/");
    },

    getWHResourceDir() {
      return path.join(config.installationroot, "modules/system/whres/");
    },

    getDataRoot() {
      return config.dataroot;
    },

    getInstallationRoot() {
      return config.installationroot;
    },

    getCompileCache() {
      let cache = process.env.WEBHARE_COMPILECACHE;
      if (cache && !cache.endsWith("/"))
        cache += "/";
      else if (!cache) {
        cache = config.dataroot + "ephemeral/compilecache/";
      }
      return cache;
    },

    doTranslateLibraryURI(directuri: string) {
      const moduri = translateDirectToModURI(directuri);
      if (moduri.startsWith(wh_namespace_location)) //wh:: lives in mod::system...
        return `wh::${moduri.substring(wh_namespace_location.length)}`;
      return moduri;
    },

    translateLibraryURI(directuri_ptr: Ptr) {
      const directuri = module.UTF8ToString(directuri_ptr);
      return module.stringToNewUTF8(this.doTranslateLibraryURI(directuri));
    },

    getOpenLibraryPath(uri_ptr: Ptr) {
      const uri = module.UTF8ToString(uri_ptr);
      let retval;
      //Legacy HareScript namespaces we may not want to retain in JS
      if (uri.startsWith("direct::"))
        retval = uri.substring(8);
      else if (uri.startsWith("wh::"))
        retval = toFSPath("mod::system/whlibs/" + uri.substring(4));
      else
        retval = toFSPath(uri);
      return module.stringToNewUTF8(retval);
    },

    resolveAbsoluteLibrary(loader_ptr: Ptr, libname_ptr: Ptr) {
      let loader = module.UTF8ToString(loader_ptr);
      let libname = module.UTF8ToString(libname_ptr);

      loader = this.doTranslateLibraryURI(loader); //get rid of any direct:: paths
      if (libname.startsWith('relative::')) {
        // Grab the prefixed root. For mod/site we also want the first path component
        const split = loader.match(/^((?:wh::|(?:mod|site)::[^/]+\/))(.*)$/);
        if (!split)
          throw new Error(`Base path '${loader}' doesn't allow for relative adressing`);

        if (libname.startsWith('relative::/')) //module-root reference
          return module.stringToNewUTF8(split[1] + path.normalize(libname.substring(10)).substring(1));

        const targetpath = path.normalize("canary/" + path.dirname(split[2]) + "/" + libname.substring(10));
        if (!targetpath.startsWith("canary/"))
          throw new Error(`Relative path '${libname}' may not escape its context '${split[1]}'`);

        return module.stringToNewUTF8(split[1] + targetpath.substring(7));
      }

      const type = getPrefix(libname);
      libname = libname.substring(type.length + 2);
      libname = path.normalize(libname);

      if (type == "module" || type == "moduledata" || type == "modulescript" || type == "moduleroot") { //module:: should be rewritten to mod:: /lib/
        const firstslash = libname.indexOf(":");
        if (firstslash === -1)
          return libname;

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

          const modroot = config.module["modulename"];
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
      return module.stringToNewUTF8(libname);
    },

    throwException(vm: HSVM, text: string): void {
      const alloced = module.stringToNewUTF8(text);
      module._HSVM_ThrowException(vm, alloced);
      module._free(alloced);
    },

    executeJSMacro(vm: HSVM, nameptr: StringPtr, id: number): void {
      const reg = module.externals[id];
      const params = new Array<HSVMVar>;
      for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
        params.push(new HSVMVar(module.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
      reg.macro!(vm, ...params);
    },

    executeJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): void {
      const reg = module.externals[id];
      const params = new Array<HSVMVar>;
      for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
        params.push(new HSVMVar(module.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
      reg.func!(vm, new HSVMVar(module.itf!, id_set), ...params);
    },

    registerExternalMacro(signature: string, func: (vm: HSVM, ...params: HSVMVar[]) => void): void {
      const unmangled = unmangleFunctionName(signature);
      const id = module.externals.length;
      module.externals.push({ name: signature, parameters: unmangled.parameters.length, func });
      const signatureptr = module.stringToNewUTF8(signature);
      module._RegisterHarescriptMacro(signatureptr, id);
      module._free(signatureptr);
    },

    registerExternalFunction(signature: string, func: (vm: HSVM, id_set: HSVMVar, ...params: HSVMVar[]) => void): void {
      const unmangled = unmangleFunctionName(signature);
      const id = module.externals.length;
      module.externals.push({ name: signature, parameters: unmangled.parameters.length, func });
      const signatureptr = module.stringToNewUTF8(signature);
      module._RegisterHarescriptFunction(signatureptr, id);
      module._free(signatureptr);
    },

    itf: undefined as HarescriptVM | undefined,
  }) as Module;

  module.stringptrs = module._malloc(8);
  module.externals = [];
  module.registerExternalFunction("__SYSTEM_GETMODULEINSTALLATIONROOT::S:S", (vm, id_set, modulename) => {
    const mod = config.module[modulename.getString()];
    if (!mod) {
      id_set.setString("");
    } else
      id_set.setString(mod.root);
  });
  module.registerExternalFunction("GETCONSOLEARGUMENTS::SA:", (vm, id_set) => {
    ensureItfSet(module);
    id_set.setDefault(VariableType.StringArray);
    for (const arg of module.itf.consoleArguments)
      id_set.arrayAppend().setString(arg);
  });
  module.registerExternalFunction("__SYSTEM_WHCOREPARAMETERS::R:", (vm, id_set) => {
    id_set.setDefault(VariableType.Record);
    id_set.ensureCell("INSTALLATIONROOT").setString(config.installationroot);
    id_set.ensureCell("BASEDATAROOT").setString(config.dataroot);
    id_set.ensureCell("VARROOT").setString(config.dataroot);
    id_set.ensureCell("EPHEMERALROOT").setString(config.dataroot + "ephemeral/");
    id_set.ensureCell("LOGROOT").setString(config.dataroot + "log/");
    const moduledirs = id_set.ensureCell("MODULEDIRS").setDefault(VariableType.StringArray);
    for (const moduledir of getFullConfigFile().modulescandirs)
      moduledirs.arrayAppend().setString(moduledir);
    moduledirs.arrayAppend().setString(config.installationroot + "modules/");
  });

  return module;
}

export async function allocateHSVM(): Promise<HarescriptVM> {
  const module = await createHarescriptModule();
  const hsvm = module._CreateHSVM();

  return new HarescriptVM(module, hsvm);
}
