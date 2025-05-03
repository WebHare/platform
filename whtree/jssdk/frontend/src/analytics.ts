import { getIPInfo } from "@mod-publisher/js/analytics/geoip";

export interface GetIPInfoOptions {
  /** Language code in which you want the country name */
  lang?: string;
  /** How long to trust the previously cached result in days (default: 7) */
  cacheDays?: number;
}

export type GeoIPInfoResult = {
  countryCode: string;
  countryName?: string;
};

export async function getGeoIPInfo(options?: GetIPInfoOptions): Promise<GeoIPInfoResult | null> {
  const data = await getIPInfo({
    countrylang: options?.lang,
    cachedays: options?.cacheDays,
  });

  return data ? {
    countryCode: data.countrycode,
    countryName: data.countryname
  } : null;
}
/** Get the remote client's IP address.
 *
 * Requires WebHare proxy 3.3.0+ and the `x-webhare-proxyoptions: addremoteip` header */
export function getRemoteIPAddress() {
  return (performance.getEntries()[0] as PerformanceResourceTiming)?.serverTiming?.find(_ => _.name === 'remoteip')?.description ?? null;
}
