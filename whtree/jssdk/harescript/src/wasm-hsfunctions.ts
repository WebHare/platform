import { createHarescriptModule, recompileHarescriptLibrary, HarescriptVM } from "./wasm-hsvm";
import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { config } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { HSVMVar } from "./wasm-hsvmvar";
import { WASMModule } from "./wasm-modulesupport";


class OutputCapturingModule extends WASMModule {
  stdout = "";
  print(data: string) {
    this.stdout += data;
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
    const newhsvm = newmodule._CreateHSVM();
    const newvm = new HarescriptVM(newmodule, newhsvm);
    newvm.consoleArguments = args.getJSValue() as string[];
    await newvm.run(filename.getString());
    newmodule._HSVM_GetMessageList(newhsvm, newvm.errorlist, 1);
    id_set.setJSValue({
      errors: new HSVMVar(newvm, newvm.errorlist).getJSValue(),
      output: extfunctions.stdout
    });
  });
}
