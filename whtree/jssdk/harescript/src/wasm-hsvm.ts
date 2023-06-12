import type { HSVM, HSVM_ColumnId, HSVM_VariableId, HSVM_VariableType, WASMModuleInterface, Ptr, StringPtr } from "../../../lib/harescript-interface";
import { IPCMarshallableData, IPCMarshallableRecord, VariableType, decodeHSON, determineType, encodeHSON, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import * as path from "node:path";
import * as fs from "node:fs";
import { config, toFSPath } from "@webhare/services";
import { decodeString } from "@webhare/std";

// @ts-ignore: implicitly has an `any` type
import createModule from "../../../lib/harescript";
import * as syscalls from "./syscalls";
import { registerBaseFunctions } from "./wasm-hsfunctions";

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
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (this.type !== type)
      throw new Error(`Variable doesn't have expected type ${VariableType[type]}, but got ${VariableType[this.type]}`);
  }
  getBoolean(): number {
    this.checkType(VariableType.Boolean);
    return this.vm.wasmmodule._HSVM_BooleanGet(this.vm.hsvm, this.id);
  }
  setBoolean(value: boolean) {
    this.vm.wasmmodule._HSVM_BooleanSet(this.vm.hsvm, this.id, value ? 1 : 0);
    this.type = VariableType.Boolean;
  }
  getInteger(): number {
    this.checkType(VariableType.Integer);
    return this.vm.wasmmodule._HSVM_IntegerGet(this.vm.hsvm, this.id);
  }
  setInteger(value: number) {
    this.vm.wasmmodule._HSVM_IntegerSet(this.vm.hsvm, this.id, value);
    this.type = VariableType.Integer;
  }
  getString(): string {
    this.checkType(VariableType.String);
    this.vm.wasmmodule._HSVM_StringGet(this.vm.hsvm, this.id, this.vm.wasmmodule.stringptrs, this.vm.wasmmodule.stringptrs + 4);
    const begin = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs, "*") as number;
    const end = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs + 4, "*") as number;
    // TODO: can we useuffer and its utf-8 decoder? strings can also contain \0
    return this.vm.wasmmodule.UTF8ToString(begin, end - begin);
  }
  setString(value: string) {
    // this.checkType(VariableType.String);
    const len = this.vm.wasmmodule.lengthBytesUTF8(value);
    const alloced = this.vm.wasmmodule._malloc(len + 1);
    this.vm.wasmmodule.stringToUTF8(value, alloced, len + 1);
    this.vm.wasmmodule._HSVM_StringSet(this.vm.hsvm, this.id, alloced, alloced + len);
    this.vm.wasmmodule._free(alloced);
    this.type = VariableType.String;
  }
  setDefault(type: VariableType): HSVMVar {
    if (type === VariableType.Array)
      throw new Error(`Illegal variable type ${VariableType[type] ?? type}`);
    this.vm.wasmmodule._HSVM_SetDefault(this.vm.hsvm, this.id, type as HSVM_VariableType);
    this.type = type;
    return this;
  }
  arrayAppend() {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (!(this.type & 0x80))
      throw new Error(`Variable is not an ARRAY`);
    const eltid = this.vm.wasmmodule._HSVM_ArrayAppend(this.vm.hsvm, this.id);
    return new HSVMVar(this.vm, eltid);
  }
  ensureCell(name: string) {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (this.type !== VariableType.Record)
      throw new Error(`Variable is not an RECORD`);

    const columnid = this.vm.getColumnId(name.toString());
    const newid = this.vm.wasmmodule._HSVM_RecordCreate(this.vm.hsvm, this.id, columnid);
    return new HSVMVar(this.vm, newid);
  }
  setJSValue(value: unknown) {
    this.setJSValueInternal(value, VariableType.Variant);
  }
  private setJSValueInternal(value: unknown, forcetype: VariableType): void {
    const type = determineType(value);
    if (forcetype !== VariableType.Variant && type !== forcetype)
      throw new Error(`Cannot use a ${VariableType[type]} here, a ${VariableType[forcetype]} is required`);
    switch (type) {
      case VariableType.VariantArray: break;
      case VariableType.BooleanArray: break;
      case VariableType.DateTimeArray: break;
      case VariableType.MoneyArray: break;
      case VariableType.FloatArray: break;
      case VariableType.StringArray: break;
      case VariableType.BlobArray: break;
      case VariableType.Integer64Array: break;
      case VariableType.IntegerArray: break;
      case VariableType.RecordArray: break;
      case VariableType.ObjectArray: break;

      case VariableType.Integer: {
        this.setInteger(value as number);
        return;
      } break;
      case VariableType.Boolean: {
        this.setBoolean(Boolean(value));
        return;
      } break;
      case VariableType.String: {
        this.setString(value as string);
        return;
      } break;
      case VariableType.Record: {
        const recval = value as IPCMarshallableRecord;
        if (!recval)
          this.setDefault(VariableType.Record);
        else {
          this.vm.wasmmodule._HSVM_RecordSetEmpty(this.vm.hsvm, this.id);
          for (const [key, propval] of Object.entries(recval)) {
            this.ensureCell(key).setJSValue(propval);
          }
        }
        return;
      }
    }
    if (type & VariableType.Array) {
      const itemtype = type !== VariableType.VariantArray ? type & ~VariableType.Array : VariableType.Variant;
      this.setDefault(type);
      for (const item of value as unknown[])
        this.arrayAppend().setJSValueInternal(item, itemtype);
      return;
    }
    throw new Error(`Encoding ${VariableType[type]} not supported yet`);
  }
  getJSValue(): unknown {
    const type = this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id) as VariableType;
    switch (type) {
      case VariableType.VariantArray: break;
      case VariableType.BooleanArray: break;
      case VariableType.DateTimeArray: break;
      case VariableType.MoneyArray: break;
      case VariableType.FloatArray: break;
      case VariableType.StringArray: break;
      case VariableType.BlobArray: break;
      case VariableType.Integer64Array: break;
      case VariableType.IntegerArray: break;
      case VariableType.RecordArray: break;
      case VariableType.ObjectArray: break;

      case VariableType.Integer: {
        return this.vm.wasmmodule._HSVM_IntegerGet(this.vm.hsvm, this.id);
      } break;
      case VariableType.Boolean: {
        return Boolean(this.vm.wasmmodule._HSVM_BooleanGet(this.vm.hsvm, this.id));
      } break;
      case VariableType.String: {
        return this.getString();
      } break;
      case VariableType.Record: {
        if (!this.vm.wasmmodule._HSVM_RecordExists(this.vm.hsvm, this.id))
          return null;
        const cellcount = this.vm.wasmmodule._HSVM_RecordLength(this.vm.hsvm, this.id);
        const value: Record<string, unknown> = {};
        for (let pos = 0; pos < cellcount; ++pos) {
          const columnid = this.vm.wasmmodule._HSVM_RecordColumnIdAtPos(this.vm.hsvm, this.id, pos);
          const cell = this.vm.wasmmodule._HSVM_RecordGetRef(this.vm.hsvm, this.id, columnid);
          value[this.vm.getColumnName(columnid)] = (new HSVMVar(this.vm, cell)).getJSValue();
        }
        return value;
      }
      default: {
        throw new Error(`Decoding ${VariableType[type]} not supported yet`);
      }
    }
    if (type & VariableType.Array) {
      const value: unknown[] = getTypedArray(type, []);
      const eltcount = this.vm.wasmmodule._HSVM_ArrayLength(this.vm.hsvm, this.id);
      for (let i = 0; i < eltcount; ++i) {
        const elt = this.vm.wasmmodule._HSVM_ArrayGetRef(this.vm.hsvm, this.id, i);
        value.push((new HSVMVar(this.vm, elt)).getJSValue());
      }
      return value;
    }
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
    throw new Error(`Unknown file prefix ${JSON.stringify(prefix)} for uri ${JSON.stringify(uri)}`);
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
      return lines.map(line => parseError(line));
    }
    throw new Error(`Could not contact HareScript compiler, status code ${res.status}`);
  } catch (e) {
    console.log({ recompileerror: e });
    throw e;
  }
}

export class HarescriptVM {
  wasmmodule: WASMModule;
  hsvm: HSVM;
  errorlist: HSVM_VariableId;
  dispatchfptr: HSVM_VariableId;
  havedispatchfptr = false;
  columnnamebuf: StringPtr;
  /// 8-bute array for 2 ptrs for getstring
  stringptrs: Ptr;
  consoleArguments: string[];
  columnNameIdMap: Record<string, HSVM_ColumnId> = {};

  constructor(module: WASMModule, hsvm: HSVM) {
    this.wasmmodule = module;
    module.itf = this;
    this.hsvm = hsvm;
    this.dispatchfptr = module._HSVM_AllocateVariable(hsvm);
    this.errorlist = module._HSVM_AllocateVariable(hsvm);
    this.columnnamebuf = module._malloc(65);
    this.stringptrs = module._malloc(8); // 2 string pointers
    this.consoleArguments = [];
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
      const maxTries = 5;
      for (let tryCounter = 0; tryCounter < maxTries; ++tryCounter) {
        this.wasmmodule._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);
        const fptrresult = this.wasmmodule._HSVM_LoadScript(this.hsvm, lib_str);
        if (fptrresult)
          return; //Success!

        this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
        const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
        if (tryCounter < maxTries - 1 && parsederrors.length === 1 && [2, 139, 157].includes(parsederrors[0].code)) {
          let recompileres = await recompileHarescriptLibrary(lib);
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
      this.wasmmodule._free(lib_str);
    }
  }

  async executeScript(): Promise<void> {
    const executeresult = await this.wasmmodule._HSVM_ExecuteScript(this.hsvm, 1, 0);
    if (executeresult === 1)
      return;

    this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
    const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
    if (parsederrors.length) {
      const trace = parsederrors.filter(e => e.istrace).map(e =>
        `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("");
      throw new Error(`Error executing script: ${parsederrors[0].message + trace}`);
    } else
      throw new Error(`Error executing script`);
  }

  async makeFunctionPtr(fptr: HSVM_VariableId, lib: string, name: string): Promise<boolean> {
    const lib_str = this.wasmmodule.stringToNewUTF8(lib);
    const name_str = this.wasmmodule.stringToNewUTF8(name);
    try {
      const maxTries = 5;
      for (let tryCounter = 0; tryCounter < maxTries; ++tryCounter) {
        this.wasmmodule._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);
        const fptrresult = this.wasmmodule._HSVM_MakeFunctionPtrAutoDetect(this.hsvm, fptr, lib_str, name_str, this.errorlist);
        switch (fptrresult) {
          case 0:
          case -2: {
            let parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
            if (parsederrors.length === 0) { //runtime errors are in the VM's mesage list
              this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
              parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
            }
            if (tryCounter < maxTries - 1 && parsederrors.length === 1 && [2, 139, 157].includes(parsederrors[0].code)) {
              let recompileres = await recompileHarescriptLibrary(lib);
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
      this.wasmmodule._free(lib_str);
      this.wasmmodule._free(name_str);
    }
  }

  async run(library: string): Promise<void> {
    await this.loadScript(library);
    await this.executeScript();
    return;
  }

  private async doCall(functionref: string, isfunction: boolean, params: IPCMarshallableData[]): Promise<IPCMarshallableData> {
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

    const callfuncptr = this.wasmmodule._HSVM_AllocateVariable(this.hsvm);
    try {
      await this.makeFunctionPtr(callfuncptr, parts[0], parts[1]);

      // console.log(`clear errorlist`);
      this.wasmmodule._HSVM_SetDefault(this.hsvm, this.errorlist, VariableType.RecordArray as HSVM_VariableType);

      const hson = encodeHSON(marshaldata);
      const len = this.wasmmodule.lengthBytesUTF8(hson);
      const hsondata = this.wasmmodule._malloc(len + 1);
      this.wasmmodule.stringToUTF8(hson, hsondata, len + 1);

      // console.log(`open call`);
      this.wasmmodule._HSVM_OpenFunctionCall(this.hsvm, 3);
      this.wasmmodule._HSVM_CopyFrom(this.hsvm, this.wasmmodule._HSVM_CallParam(this.hsvm, 0), callfuncptr);
      this.wasmmodule._HSVM_StringSet(this.hsvm, this.wasmmodule._HSVM_CallParam(this.hsvm, 1), hsondata, hsondata + len);
      this.wasmmodule._HSVM_BooleanSet(this.hsvm, this.wasmmodule._HSVM_CallParam(this.hsvm, 2), isfunction ? 1 : 0);
      this.wasmmodule._free(hsondata);
      // console.log(`call functionptr`, this.dispatchfptr, VariableType[this.module._HSVM_GetType(this.hsvm, this.dispatchfptr)]);
      // console.log(`call functionptr`, this.module._HSVM_GetType(this.hsvm, this.dispatchfptr));
      const retvalid = await this.wasmmodule._HSVM_CallFunctionPtr(this.hsvm, this.dispatchfptr, 0);
      // console.log({ retvalid });
      if (!retvalid) {
        this.wasmmodule._HSVM_CloseFunctionCall(this.hsvm);
        this.wasmmodule._HSVM_GetMessageList(this.hsvm, this.errorlist, 1);
        const parsederrors = this.quickParseVariable(this.errorlist) as MessageList;
        const trace = parsederrors.filter(e => e.istrace).map(e =>
          `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("");
        throw new Error((parsederrors[0].message ?? "Unknown error") + trace);
      } else {
        const retval = this.quickParseVariable(retvalid);
        this.wasmmodule._HSVM_CloseFunctionCall(this.hsvm);

        const plainvalue = decodeHSON(retval as string) as { value: IPCMarshallableData; __exception?: { what: string } };
        if (plainvalue.__exception)
          throw new Error(plainvalue.__exception.what);
        return plainvalue.value;
      }
    } finally {
      this.wasmmodule._HSVM_DeallocateVariable(this.hsvm, callfuncptr);
    }
  }

  async callFunction(functionref: string, ...params: IPCMarshallableData[]): Promise<IPCMarshallableData> {
    return this.doCall(functionref, true, params);
  }
  async callMacro(functionref: string, ...params: IPCMarshallableData[]): Promise<void> {
    await this.doCall(functionref, false, params);
  }
}

type RegisteredExternal = {
  name: string;
  parameters: number;
  func?: ((vm: HSVM, id_set: HSVMVar, ...params: HSVMVar[]) => void);
  macro?: ((vm: HSVM, ...params: HSVMVar[]) => void);
  asyncfunc?: ((vm: HSVM, id_set: HSVMVar, ...params: HSVMVar[]) => Promise<void>);
  asyncmacro?: ((vm: HSVM, ...params: HSVMVar[]) => Promise<void>);
};

/** WASMModuleBase is an empty class we override to look like it contains all the properties the Emscripten
 * WASM module harescript.js provides.
 */
const WASMModuleBase = (class { }) as { new(): WASMModuleInterface };

export class WASMModule extends WASMModuleBase {

  stringptrs: Ptr = 0;
  externals = new Array<RegisteredExternal>;
  itf: HarescriptVM;

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

  emSyscall(jsondata_ptr: number): string {
    const jsondata = this.UTF8ToString(jsondata_ptr);
    const { call, data } = JSON.parse(jsondata);
    if (!(syscalls as SysCallsModule)[call])
      return "unknown";

    const result = (syscalls as SysCallsModule)[call](data);
    return JSON.stringify(result);
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
    reg.macro!(vm, ...params);
  }

  executeJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): void {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    reg.func!(vm, new HSVMVar(this.itf!, id_set), ...params);
  }

  async executeAsyncJSMacro(vm: HSVM, nameptr: StringPtr, id: number): Promise<void> {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    await reg.asyncmacro!(vm, ...params);
  }

  async executeAsyncJSFunction(vm: HSVM, nameptr: StringPtr, id: number, id_set: HSVM_VariableId): Promise<void> {
    const reg = this.externals[id];
    const params = new Array<HSVMVar>;
    for (let paramnr = 0; paramnr < reg.parameters; ++paramnr)
      params.push(new HSVMVar(this.itf!, (0x88000000 - 1 - paramnr) as HSVM_VariableId));
    await reg.asyncfunc!(vm, new HSVMVar(this.itf!, id_set), ...params);
  }

  registerExternalMacro(signature: string, macro: (vm: HSVM, ...params: HSVMVar[]) => void): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, macro });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptMacro(signatureptr, id, 0);
    this._free(signatureptr);
  }

  registerExternalFunction(signature: string, func: (vm: HSVM, id_set: HSVMVar, ...params: HSVMVar[]) => void): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, func });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptFunction(signatureptr, id, 0);
    this._free(signatureptr);
  }

  registerAsyncExternalMacro(signature: string, asyncmacro: (vm: HSVM, ...params: HSVMVar[]) => Promise<void>): void {
    const unmangled = unmangleFunctionName(signature);
    const id = this.externals.length;
    this.externals.push({ name: signature, parameters: unmangled.parameters.length, asyncmacro });
    const signatureptr = this.stringToNewUTF8(signature);
    this._RegisterHarescriptMacro(signatureptr, id, 1);
    this._free(signatureptr);
  }

  registerAsyncExternalFunction(signature: string, asyncfunc: (vm: HSVM, id_set: HSVMVar, ...params: HSVMVar[]) => Promise<void>): void {
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

export async function createHarescriptModule<T extends WASMModule>(modulefunctions: T): Promise<T> {

  modulefunctions.prepare();
  const wasmmodule = await createModule(modulefunctions) as T;
  wasmmodule.init();

  registerBaseFunctions(wasmmodule);

  return wasmmodule;
}

export async function allocateHSVM(): Promise<HarescriptVM> {
  const module = await createHarescriptModule(new WASMModule);
  const hsvm = module._CreateHSVM();

  return new HarescriptVM(module, hsvm);
}
