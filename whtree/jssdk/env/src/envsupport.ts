import * as services from '@webhare/services';

export function getDefaultRPCBase() {
  return services.getConfig().backendurl;
}
