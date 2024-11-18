/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/* import * as clientinfo from '@mod-publisher/js/analytics/clientinfo';
*/

///Return the remote client's IP address. Requires WebHare proxy 3.3.0+ and the `x-webhare-proxyoptions: addremoteip` header
export function getRemoteIPAddress() {
  return performance.getEntries()[0]?.serverTiming?.find(_ => _.name === 'remoteip')?.description ?? null;
}
