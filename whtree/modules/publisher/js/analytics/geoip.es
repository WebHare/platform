/** @import: import * as geoip from '@mod-publisher/js/analytics/geoip';
    Retrieve geoip country info
*/

import { createDeferred } from 'dompack';
import RPCClient from '@mod-system/js/wh/rpc';

let requestbarrier = null;

async function getIPInfoIntoCache(options)
{
  let reqoptions = { countrylang: options.countrylang };
  let result = await new RPCClient("publisher:rpc").invoke("getIPInfo", reqoptions);
  let geoinfo = { countrycode:  result ? result.country : ""
                , creationdate: Date.now()
                };
  if(options.countrylang)
    geoinfo["countrylang_" + options.countrylang] = result.countryname;

  localStorage.setItem("_wh.geoinfo", JSON.stringify(geoinfo));
  return geoinfo;
}

/** Get geoip fields
    @param options.cachedays How long to trust the previously cached result in days (default: 7)
    @param options.countrylang Language code in which you want the country name
    @return Object with country code and possible name, null if unknown
    @cell(string) return.countrycode Country code
    @cell(string) return.countryname Country name in requested language, if requested */
export async function getIPInfo(options) //TODO add more than country name and code once we need it.
{
  options = { cachedays: 7
            , countrylang: ""
            , ...options
            };

  if(requestbarrier)
    await requestbarrier; //first let parallel requests complete and set _wh.geoinfo

  let barrier = createDeferred();
  requestbarrier = barrier.promise;

  let geoinfo;
  try
  {
    let curgeoinfotext = localStorage.getItem("_wh.geoinfo");

    if(!curgeoinfotext) //test local storage
    {
      localStorage.setItem("_wh.geoinfo", JSON.stringify({dummy:"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}));
      curgeoinfotext = localStorage.getItem("_wh.geoinfo");
    }
    geoinfo = JSON.parse(curgeoinfotext);
  }
  catch(e)
  {
    console.error(e);
    barrier.resolve();
    return null; //localstorage is broken
  }

  let refetch = false;

  if(!geoinfo.creationdate || (geoinfo.creationdate + options.cachedays * 86400*1000) <= Date.now()) //is answer still valid?
    refetch = true;
  else if(options.countrylang && geoinfo.countrycode && !(("countrylang_" + options.countrylang) in geoinfo))
    refetch = true;   //If the countrylang isn't requested.. OR we have it... OR we don't have it because we didn't even have the country figured out in the cached call... we can continue

  if(refetch)
    geoinfo = await getIPInfoIntoCache(options);

  barrier.resolve();

  if(geoinfo && geoinfo.countrycode)
  {
    let retval = { countrycode: geoinfo.countrycode };
    if(options.countrylang)
      retval.countryname = geoinfo["countrylang_" + options.countrylang];

    return retval;
  }

  return null;
}

/** Get the current country code
    @param options.cachedays How long to cache the result (default 7 days)
    @return Promise resolving to 2-letter countrycode, or null if unknown */
export async function getCountryCode(options)
{
  let data = await getIPInfo(options);
  return data ? data.countrycode : null;
}
