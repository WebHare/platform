import { ServiceControllerFactoryFunction } from "@webhare/services/src/backendservicerunner";
import { ApplyConfigurationOptions, applyConfiguration } from "./applyconfig";

class ConfigClient {

  async applyConfiguration(options: Pick<ApplyConfigurationOptions, "modules" | "subsystems" | "force" | "source"> = {}) {
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
