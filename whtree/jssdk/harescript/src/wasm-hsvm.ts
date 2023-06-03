import { HSVM, HSVM_ColumnId, HSVM_VariableId, HSVM_VariableType, Module, Ptr, StringPtr } from "./dllinterface";
import { IPCMarshallableData, VariableType, decodeHSON, encodeHSON } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import * as path from "node:path";
import * as fs from "node:fs";
import { config, toFSPath } from "@webhare/services";
import { decodeString } from "@webhare/std";

// @ts-ignore -- test file doesn't exist usually
import createModule from "../../../lib/harescript";

const allowedPrefixes = ["wh", "moduledata", "storage", "mod", "moduleroot", "module", "modulescript", "whfs", "site", "currentsite", "direct", "directclib", "relative", "test"] as const;
type AllowedPrefixes = typeof allowedPrefixes[number];

function getPrefix(uri: string): AllowedPrefixes {
  const prefix = uri.substring(0, uri.indexOf(":")) as AllowedPrefixes;
  if (!allowedPrefixes.includes(prefix))
    throw new Error(`Unknown file prefix: ${JSON.stringify(prefix)} for uri ${JSON.stringify(uri)}`);
  return prefix;
}

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

class HarescriptVM {
  module: Module;
  hsvm: HSVM;
  errorlist: HSVM_VariableId;
  columnnamebuf: StringPtr;
  /// 8-bute array for 2 ptrs for getstring
  stringptrs: Ptr;

  constructor(module: Module, hsvm: HSVM) {
    this.module = module;
    this.hsvm = hsvm;
    this.errorlist = module._HSVM_AllocateVariable(hsvm);
    this.columnnamebuf = module._malloc(65);
    this.stringptrs = module._malloc(8); // 2 string pointers
  }

  getColumnName(columnid: HSVM_ColumnId) {
    this.module._HSVM_GetColumnName(this.hsvm, columnid, this.columnnamebuf);
    return this.module.UTF8ToString(this.columnnamebuf).toLowerCase();
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
          const recompileres = await recompileHarescriptLibrary(this.module, lib);
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
    if (parsederrors.length)
      throw new Error(`Error executing script: ${parsederrors[0].message}`);
    else
      throw new Error(`Error executing script`);
  }

  async run(library: string): Promise<void> {
    await this.loadScript(library);
    await this.executeScript();
    return;
  }
}

async function createHarescriptModule(): Promise<Module> {
  // Store into variable 'module' so functions can refer to it
  const module = await createModule({
    emSyscall(jsondata_ptr: number): string {
      const jsondata = module.UTF8ToString(jsondata_ptr);
      const { call /*, data */ } = JSON.parse(jsondata);
      if (call == "init")
        return JSON.stringify({ iswasm: true });

      return "unknown";
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

    translateLibraryURI(uri: string) {
      throw new Error(`translateLibraryURI not implemented (${uri})`);
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

    resolveAbsoluteLibrary(rawloader_ptr: Ptr, libname_ptr: Ptr) {
      const rawloader = module.UTF8ToString(rawloader_ptr);
      let libname = module.UTF8ToString(libname_ptr);
      let type = getPrefix(libname);
      libname = libname.substring(type.length + 2);
      if (type !== "relative") {
        while (libname.startsWith("/"))
          libname = libname.substring(1);
      }

      if (type === "relative") {
        const loader = this.translateLibraryURI(rawloader);
        let savefirstpart = false;
        let allowreset = false;

        const loaderprefix = getPrefix(loader);

        switch (loaderprefix) {
          case "module":
          case "site":
          case "moduledata":
          case "storage":
          case "modulescript":
          case "moduleroot":
          case "mod":
            savefirstpart = true;
          //fallthrough
          case "wh":
          case "test":
            allowreset = true;
            break;

          default: {
            throw new Error(`Prefix ${JSON.stringify(loaderprefix)} doesn't allow relative adressing`);
          }
        }

        // Get the prefix path (and maybe the first string part for sites & modules), that needs to be fixed
        let prefixend = loaderprefix.length + 1;
        if (savefirstpart)
          prefixend = type.indexOf("/", prefixend);
        if (type[prefixend] === ":" || type[prefixend] === "/")
          ++prefixend;

        let oldpath = path.dirname(type.substring(prefixend));
        const stripped = loader.substring(type + 2);
        if (allowreset && stripped && stripped[0] === "/")
          oldpath = "";

        const merged = path.join(oldpath, libname);
        if (path.join("/canary/", merged) != path.join("/canary/" + oldpath, libname))
          throw new Error(`Relative paths may not escape their context (${JSON.stringify(libname)}`);

        type = loaderprefix;
        libname = merged;
        while (libname.startsWith("/"))
          libname = libname.substring(1);
      }

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
    }
  }) as Module;

  return module;
}

export async function allocateHSVM(): Promise<HarescriptVM> {
  const module = await createHarescriptModule();
  const hsvm = module._CreateHSVM();

  return new HarescriptVM(module, hsvm);
}
