import { BackendServiceConnection, type ServiceControllerFactoryFunction } from "@webhare/services/src/backendservicerunner";
import { type ApplyConfigurationOptions, executeApply } from "./applyconfig";
import { HareScriptLibraryOutOfDateError } from "@webhare/harescript";
import { releaseCodeContextHSVM } from "@webhare/harescript/src/contextvm";

class ConfigClient extends BackendServiceConnection {

  async applyConfiguration(options: Omit<ApplyConfigurationOptions, "verbose">) {
    try {
      await executeApply(options);
    } catch (e) {
      if (e instanceof HareScriptLibraryOutOfDateError) {
        //retry it once
        releaseCodeContextHSVM();
        await executeApply(options);
        return;
      }
      throw e;
    }
  }
}

export function createConfigManager() {
  return new class {
    async createClient(source: string) {
      return new ConfigClient;
    }
  };
}


createConfigManager satisfies ServiceControllerFactoryFunction;
export { type ConfigClient };
