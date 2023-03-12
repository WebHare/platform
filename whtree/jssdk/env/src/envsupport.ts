import * as services from '@webhare/services';

export { flags, registerDebugConfigChangedCallback } from "./envbackend";


export function getDefaultRPCBase() {
  return services.getConfig().backendurl;
}
