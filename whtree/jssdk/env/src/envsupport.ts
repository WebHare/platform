import * as services from '@webhare/services';
export { getWHDebugFlags } from "./envbackend";

export function getDefaultRPCBase() {
  return services.getConfig().backendurl;
}
