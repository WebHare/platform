import { createHarescriptModule, recompileHarescriptLibrary, HarescriptVM } from "./wasm-hsvm";
import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { config } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { HSVMVar } from "./wasm-hsvmvar";
import { WASMModule } from "./wasm-modulesupport";
import { HSVM, Ptr, StringPtr } from "wh:internal/whtree/lib/harescript-interface";
import { generateRandomId } from "@webhare/std";
import * as syscalls from "./syscalls";

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
    const mod = config.module[modulename.getString()];
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
      installationroot: config.installationroot,
      basedataroot: config.dataroot,
      varroot: config.dataroot,
      ephemeralroot: config.dataroot + "ephemeral/",
      logroot: config.dataroot + "log/",
      moduledirs: [...getFullConfigFile().modulescandirs, config.installationroot + "modules/"] // always filled, no need to cast
    });
  });
  wasmmodule.registerExternalFunction("__SYSTEM_GETINSTALLEDMODULENAMES::SA:", (vm, id_set) => {
    id_set.setJSValue(getTypedArray(VariableType.StringArray, Object.keys(config.module).sort()));
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
    const newvm = new HarescriptVM(newmodule);
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

    const value = (syscalls as SysCallsModule)[func](data);
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
    id_set.setJSValue({ value: await toawait });
  });
}
