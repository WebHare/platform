import { BackendServiceConnection, type ServiceControllerFactoryFunction } from "@webhare/services";
import { type ApplyConfigurationOptions, executeApply } from "./applyconfig";
import { CodeContext } from "@webhare/services/src/codecontexts";

class ConfigClient extends BackendServiceConnection {
  async applyConfiguration(options: Omit<ApplyConfigurationOptions, "verbose">) {
    await using context = new CodeContext("platform:configservice.applyConfiguration");
    return await context.run(() => executeApply(options));
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
