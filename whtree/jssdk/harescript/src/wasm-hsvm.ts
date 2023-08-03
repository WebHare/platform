import type { HSVM, HSVM_ColumnId, HSVM_VariableId, HSVM_VariableType, Ptr, StringPtr } from "../../../lib/harescript-interface";
import { IPCMarshallableData, VariableType, decodeHSON, encodeHSON } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { decodeString } from "@webhare/std";

// @ts-ignore: implicitly has an `any` type
import createModule from "../../../lib/harescript";
import { registerBaseFunctions } from "./wasm-hsfunctions";
import { WASMModule } from "./wasm-modulesupport";
import { HSVMVar } from "./wasm-hsvmvar";


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

///compile library, return raw fetch result
export async function recompileHarescriptLibraryRaw(uri: string, options?: { force: boolean }) {
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
      return await res.text();
    }
    throw new Error(`Could not contact HareScript compiler, status code ${res.status}`);
  } catch (e) {
    console.log({ recompileerror: e });
    throw e;
  }
}

export async function recompileHarescriptLibrary(uri: string, options?: { force: boolean }) {
  const text = await recompileHarescriptLibraryRaw(uri, options);
  const lines = text.split("\n").filter(line => line);
  return lines.map(line => parseError(line));
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

  constructor(module: WASMModule) {
    this.wasmmodule = module;
    module.itf = this;
    this.hsvm = module._CreateHSVM();
    module.initVM(this.hsvm);
    this.dispatchfptr = module._HSVM_AllocateVariable(this.hsvm);
    this.errorlist = module._HSVM_AllocateVariable(this.hsvm);
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

  allocateVariable(): HSVMVar {
    const id = this.wasmmodule._HSVM_AllocateVariable(this.hsvm);
    return new HSVMVar(this, id);
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
        const fptrresult = await this.wasmmodule._HSVM_LoadScript(this.hsvm, lib_str);
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
      const errors = parsederrors.filter(e => e.iserror).map(e => e.message);
      const trace = parsederrors.filter(e => e.istrace).map(e =>
        `\n    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("");
      throw new Error(`Error executing script: ${errors.join("\n") + trace}`);
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
        const fptrresult = await this.wasmmodule._HSVM_MakeFunctionPtrAutoDetect(this.hsvm, fptr, lib_str, name_str, this.errorlist);
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

  openFunctionCall(paramcount: number): HSVMVar[] {
    const params: HSVMVar[] = [];
    this.wasmmodule._HSVM_OpenFunctionCall(this.hsvm, paramcount);
    for (let i = 0; i < paramcount; ++i)
      params.push(new HSVMVar(this, this.wasmmodule._HSVM_CallParam(this.hsvm, i)));
    return params;
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

export async function createHarescriptModule<T extends WASMModule>(modulefunctions: T): Promise<T> {

  modulefunctions.prepare();
  const wasmmodule = await createModule(modulefunctions) as T;
  wasmmodule.init();

  registerBaseFunctions(wasmmodule);

  return wasmmodule;
}

export async function allocateHSVM(): Promise<HarescriptVM> {
  const module = await createHarescriptModule(new WASMModule);
  return new HarescriptVM(module);
}
