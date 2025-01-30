import { BackendServiceConnection, type ServiceControllerFactoryFunction } from "@webhare/services/src/backendservicerunner";
import { type ApplyConfigurationOptions, applyConfiguration } from "./applyconfig";

class ConfigClient extends BackendServiceConnection {

  async applyConfiguration(options: Omit<ApplyConfigurationOptions, "verbose">) {
    await applyConfiguration(options);
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
