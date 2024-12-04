/** Get the remote client's IP address.
 *
 * Requires WebHare proxy 3.3.0+ and the `x-webhare-proxyoptions: addremoteip` header */
export function getRemoteIPAddress() {
  return (performance.getEntries()[0] as PerformanceResourceTiming)?.serverTiming?.find(_ => _.name === 'remoteip')?.description ?? null;
}
