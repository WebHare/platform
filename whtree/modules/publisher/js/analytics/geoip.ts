import { createClient } from '@webhare/jsonrpc-client';

let requestbarrier: Promise<void> | undefined; //TODO replace with serialize (or wait until we have it as a decorator)

interface GetIPInfoOptions {
  /** Language code in which you want the country name */
  countrylang?: string;
  /** How long to trust the previously cached result in days (default: 7) */
  cachedays?: number;
}

interface PublisherRPCCLient {
  getIPInfo(options: { countrylang?: string }): Promise<{ country: string; countryname?: string }>;
}

async function getIPInfoIntoCache(options?: GetIPInfoOptions) {
  const reqoptions = { countrylang: options?.countrylang };
  const result = await createClient<PublisherRPCCLient>("publisher:rpc").getIPInfo(reqoptions);
  let geoinfo = {
    countrycode: result ? result.country : "",
    creationdate: Date.now(),
  };
  if (result && options?.countrylang)
    geoinfo = { ...geoinfo, ["countrylang_" + options.countrylang]: result.countryname };

  localStorage.setItem("_wh.geoinfo", JSON.stringify(geoinfo));
  return geoinfo;
}

export async function getIPInfo(options?: { countrylang: string }): Promise<{ countrycode: string; countryname: string } | null>;
export async function getIPInfo(options?: GetIPInfoOptions): Promise<{ countrycode: string; countryname?: string } | null>;

/** Get geoip fields
    @returns Object with country code and possible name, null if unknown */
export async function getIPInfo(options?: GetIPInfoOptions): Promise<{ countrycode: string; countryname?: string } | null> {
  //TODO return more than country name and code once we need it.

  const finaloptions = {
    cachedays: 7,
    countrylang: "",
    ...options
  };

  if (requestbarrier)
    await requestbarrier; //first let parallel requests complete and set _wh.geoinfo

  const barrier = Promise.withResolvers<void>();
  requestbarrier = barrier.promise;

  let geoinfo;
  try {
    let curgeoinfotext = localStorage.getItem("_wh.geoinfo");

    if (!curgeoinfotext) { //test local storage
      localStorage.setItem("_wh.geoinfo", JSON.stringify({ dummy: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }));
      curgeoinfotext = localStorage.getItem("_wh.geoinfo") || '';
    }
    geoinfo = JSON.parse(curgeoinfotext);
  } catch (e) {
    console.error(e);
    barrier.resolve();
    return null; //localstorage is broken
  }

  let refetch = false;

  if (!geoinfo.creationdate || (geoinfo.creationdate + finaloptions.cachedays * 86400 * 1000) <= Date.now()) //is answer still valid?
    refetch = true;
  else if (finaloptions.countrylang && geoinfo.countrycode && !(("countrylang_" + finaloptions.countrylang) in geoinfo))
    refetch = true;   //If the countrylang isn't requested.. OR we have it... OR we don't have it because we didn't even have the country figured out in the cached call... we can continue

  if (refetch)
    geoinfo = await getIPInfoIntoCache(options);

  barrier.resolve();

  if (geoinfo && geoinfo.countrycode) {
    const retval: { countrycode: string; countryname?: string } = { countrycode: geoinfo.countrycode };
    if (finaloptions.countrylang)
      retval.countryname = geoinfo["countrylang_" + finaloptions.countrylang];

    return retval;
  }

  return null;
}

/** Get the current country code
    @returns Promise resolving to 2-letter countrycode, or null if unknown */
export async function getCountryCode(options?: GetIPInfoOptions) {
  const data = await getIPInfo(options);
  return data ? data.countrycode : null;
}
