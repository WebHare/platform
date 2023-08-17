import { createHarescriptModule, recompileHarescriptLibrary, HareScriptVM } from "./wasm-hsvm";
import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { backendConfig, log } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { HSVMVar } from "./wasm-hsvmvar";
import { WASMModule } from "./wasm-modulesupport";
import { HSVM, Ptr, StringPtr } from "wh:internal/whtree/lib/harescript-interface";
import { generateRandomId } from "@webhare/std";
import * as syscalls from "./syscalls";
import { localToUTC, utcToLocal } from "@webhare/hscompat/datetime";
import { isWHDBBlob } from "@webhare/whdb/src/blobs";

type SysCallsModule = { [key: string]: (data: unknown) => unknown };


class OutputCapturingModule extends WASMModule {
  stdout_bytes: number[] = [];
  outputfunction: number = 0;

  init() {
    super.init();
    const out = (opaqueptr: number, numbytes: number, data: StringPtr, allow_partial: number, error_result: Ptr): number => {
      this.stdout_bytes.push(...Array.from(this.HEAP8.slice(data, data + numbytes)));
      return numbytes;
    };
    this.outputfunction = this.addFunction(out, "iiiiii");
  }

  initVM(hsvm: HSVM) {
    super.initVM(hsvm);
    this._HSVM_SetOutputCallback(hsvm, 0, this.outputfunction);
  }

  getOutput() {
    return Buffer.from(this.stdout_bytes).toString();
  }
}


export function registerBaseFunctions(wasmmodule: WASMModule) {

  wasmmodule.registerExternalFunction("__SYSTEM_GETMODULEINSTALLATIONROOT::S:S", (vm, id_set, modulename) => {
    const mod = backendConfig.module[modulename.getString()];
    if (!mod) {
      id_set.setString("");
    } else
      id_set.setString(mod.root);
  });
  wasmmodule.registerExternalFunction("GETCONSOLEARGUMENTS::SA:", (vm, id_set) => {
    id_set.setDefault(VariableType.StringArray);
    for (const arg of wasmmodule.itf.consoleArguments)
      id_set.arrayAppend().setString(arg);
  });
  wasmmodule.registerExternalFunction("__SYSTEM_WHCOREPARAMETERS::R:", (vm, id_set) => {
    id_set.setJSValue({
      installationroot: backendConfig.installationroot,
      basedataroot: backendConfig.dataroot,
      varroot: backendConfig.dataroot,
      ephemeralroot: backendConfig.dataroot + "ephemeral/",
      logroot: backendConfig.dataroot + "log/",
      moduledirs: [...getFullConfigFile().modulescandirs, backendConfig.installationroot + "modules/"] // always filled, no need to cast
    });
  });
  wasmmodule.registerExternalFunction("__SYSTEM_GETINSTALLEDMODULENAMES::SA:", (vm, id_set) => {
    id_set.setJSValue(getTypedArray(VariableType.StringArray, Object.keys(backendConfig.module).sort()));
  });
  wasmmodule.registerExternalFunction("__SYSTEM_GETSYSTEMCONFIG::R:", (vm, id_set) => {
    id_set.setJSValue(bridge.systemconfig);
  });
  wasmmodule.registerAsyncExternalFunction("DOCOMPILE:WH_SELFCOMPILE:RA:S", async (vm, id_set, uri) => {
    const uri_str = uri.getString();
    const compileresult = await recompileHarescriptLibrary(uri_str, { force: true });
    id_set.setJSValue(getTypedArray(VariableType.RecordArray, compileresult));
  });
  wasmmodule.registerAsyncExternalFunction("DORUN:WH_SELFCOMPILE:R:SSA", async (vm, id_set, filename, args) => {
    const extfunctions = new OutputCapturingModule;
    const newmodule = await createHarescriptModule(extfunctions);
    const newvm = new HareScriptVM(newmodule);
    newvm.consoleArguments = args.getJSValue() as string[];
    await newvm.loadScript(filename.getString());
    await newmodule._HSVM_ExecuteScript(newvm.hsvm, 1, 0);
    newmodule._HSVM_GetMessageList(newvm.hsvm, newvm.errorlist, 1);
    id_set.setJSValue({
      errors: new HSVMVar(newvm, newvm.errorlist).getJSValue(),
      output: extfunctions.getOutput()
    });
  });
  wasmmodule.registerExternalFunction("GENERATEUFS128BITID::S:", (vm, id_set) => {
    id_set.setString(generateRandomId("base64url"));
  });
  let last_syscall_promise: Promise<unknown> | undefined;
  wasmmodule.registerExternalFunction("__EM_SYSCALL::R:SV", (vm, id_set, var_func, var_data) => {
    const func = var_func.getString();
    const data = var_data.getJSValue();
    if (!(syscalls as SysCallsModule)[func]) {
      id_set.setJSValue({ result: "unknown" });
      return;
    }

    const value = (syscalls as SysCallsModule)[func].call(vm, data);
    if (value && typeof value === "object" && "then" in value && typeof value.then === "function") {
      // This assumes that __EM_SYSCALL_WAITLASTPROMISE is called immediately after __EM_SYSCALL returns!
      last_syscall_promise = value as Promise<unknown>;
      id_set.setJSValue({
        result: "promise"
      });
    } else {
      id_set.setJSValue({
        result: "ok",
        value
      });
    }
  });
  wasmmodule.registerAsyncExternalFunction("__EM_SYSCALL_WAITLASTPROMISE::V:", async (vm, id_set) => {
    const toawait = last_syscall_promise;
    last_syscall_promise = undefined;
    const result = await toawait;
    id_set.setJSValue({ value: result === undefined ? false : result });
  });
  wasmmodule.registerAsyncExternalFunction("__ICU_GETTIMEZONEIDS::SA:", async (vm, id_set) => {
    //@ts-ignore -- MDN says it is supported everywhere we need it to be
    const list = Intl.supportedValuesOf('timeZone');
    // Add some missing timezones: https://bugs.chromium.org/p/v8/issues/detail?id=13084
    for (const toAdd of ["UTC", "GMT", "CET"])
      if (!list.includes(toAdd))
        list.push(toAdd);
    id_set.setJSValue(list.sort());
  });
  wasmmodule.registerAsyncExternalFunction("__ICU_LOCALTOUTC::D:DS", async (vm, id_set, var_date, var_timezone) => {
    try {
      id_set.setDateTime(localToUTC(var_date.getDateTime(), var_timezone.getString()));
    } catch (e) {
      id_set.copyFrom(var_date);
    }
  });
  wasmmodule.registerAsyncExternalFunction("__ICU_UTCTOLOCAL::D:DS", async (vm, id_set, var_date, var_timezone) => {
    try {
      id_set.setDateTime(utcToLocal(var_date.getDateTime(), var_timezone.getString()));
    } catch (e) {
      id_set.copyFrom(var_date);
    }
  });
  wasmmodule.registerAsyncExternalFunction("POSTGRESQLESCAPEIDENTIFIER::S:S", async (vm, id_set, var_str) => {
    const str = var_str.getString();
    const is_simple = Boolean(str.match(/^[0-9a-zA-Z_"$]*$/));
    let retval: string;
    if (is_simple)
      retval = `"${str.replaceAll(`"`, `""`)}"`;
    else {
      retval = `U&"`;
      for (const char of str) {
        const code = char.charCodeAt(0);
        if (code >= 32 && code < 127) {
          if (char === "\\")
            retval += char;
          retval += char;
        } else {
          if (code < 65536)
            retval += `\\${code.toString(16).padStart(4, "0")}`;
          else
            retval += `\\+${code.toString(16).padStart(8, "0")}`;
        }
      }
      retval += `"`;
    }
    id_set.setString(retval);
  });
  wasmmodule.registerAsyncExternalFunction("POSTGRESQLESCAPELITERAL::S:S", async (vm, id_set, var_str) => {
    // Don't care about UTF-8 encoding problems, the server will catch them anyway
    let have_backslashes = false;
    const str = var_str.getString();
    let result = `'`;
    for (const char of str) {
      const code = char.codePointAt(0) ?? 0;
      if (char == `'`)
        result += char;
      else if (code < 32 || code == 127) {
        switch (code) {
          case 8:    /* \b */ result += '\\b'; break;
          case 12:   /* \f */ result += '\\f'; break;
          case 10:   /* \n */ result += '\\n'; break;
          case 13:   /* \r */ result += '\\r'; break;
          case 9:    /* \t */ result += '\\t'; break;
          default: result += `\\x${code.toString(16).padStart(2, "0")}`;
        }
        have_backslashes = true;
        continue;
      } else if (char == '\\') {
        result += char;
        have_backslashes = true;
      }
      result += char;
    }
    result += `'`;
    if (have_backslashes)
      result = " E" + result;
    id_set.setString(result);
  });

  wasmmodule.registerAsyncExternalFunction("__PGSQL_GETBLOBINTERNALID::S:IX", async (vm, id_set, transaction, var_blob) => {
    const blob = var_blob.getBlob();
    id_set.setString(isWHDBBlob(blob) ? blob.databaseid : "");
  });

  wasmmodule.registerExternalFunction("__HS_GETCURRENTGROUPID::S:", (vm, id_set) => {
    vm.currentgroup ||= generateRandomId("base64url");
    id_set.setString(vm.currentgroup);
  });

  wasmmodule.registerExternalFunction("GETEXTERNALSESSIONDATA::S:", (vm, id_set) => {
    id_set.setString("");
  });

  wasmmodule.registerExternalMacro("__SYSTEM_REMOTELOG:::SS", (vm, logfile: HSVMVar, text: HSVMVar) => {
    //FIXME should bridge log just give us a raw format? or should we convert all WASM logger usage to JSON?
    log(logfile.getString(), { __system_remotelog_wasm: text.getString() });
  });
}
