import * as test from '@webhare/test-frontend';
import type { } from "@mod-webhare_testsuite/webdesigns/basetest/js/basetest"; //we need the window globals
import type { GeoIPInfoResult, GetIPInfoOptions } from '@webhare/frontend';
import type { BaseTestApi } from '@mod-webhare_testsuite/webdesigns/basetestjs/frontend/frontend';

const bt_ip = '67.43.156.0'; // see https://github.com/maxmind/MaxMind-DB/blob/15ed5b26ec7bb9b3e1658939b540b27af61ae74b/source-data/GeoLite2-Country-Test.json

function getAnalyticsRPCRequests() {
  return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.includes("/publisher/rpc/"));
}

async function getGeoIPInfo(options?: GetIPInfoOptions): Promise<GeoIPInfoResult | null> {
  return await test.importExposed<BaseTestApi>("baseTestApi").getGeoIPInfo(options);
}
function getGeoIPCountryCode(options?: GetIPInfoOptions): Promise<string | null> {
  return getGeoIPInfo(options).then((info) => info?.countryCode ?? null);
}

test.runTests(
  [
    "Basic GEOIP",
    async function () {
      await test.invoke("mod::webhare_testsuite/tests/publisher/data/testsupport.whlib#setupGeoip", true);

      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie = "wh-debug-overrideip=127.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      test.eq(0, getAnalyticsRPCRequests().length);

      const geocoderequest = getGeoIPCountryCode();
      const geocoderequest2 = getGeoIPCountryCode(); //this one should wait for the first request

      test.eq("NL", await geocoderequest);
      test.eq("NL", await geocoderequest2, "should also return NL");
      test.eq(1, getAnalyticsRPCRequests().length, "Only 1 rpc should have fired!");

      test.getDoc().cookie = `wh-debug-overrideip=${bt_ip}; path=/`;
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      let countryCode = await getGeoIPCountryCode();
      test.eq(0, getAnalyticsRPCRequests().length);

      test.eq("NL", countryCode); //should still be cached

      //clear cache, force geoip re-lookup
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');
      countryCode = await getGeoIPCountryCode();
      test.eq("BT", countryCode);
      test.eq(1, getAnalyticsRPCRequests().length);

      //clear cache, look up a failing code
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie = "wh-debug-overrideip=0.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      countryCode = await getGeoIPCountryCode();
      test.eq(null, countryCode);
      test.eq(1, getAnalyticsRPCRequests().length);
    },
    "GEOIP + countryName",
    async function () {
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie = "wh-debug-overrideip=127.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      const countryCode = await getGeoIPCountryCode();
      test.eq("NL", countryCode);

      test.getDoc().cookie = `wh-debug-overrideip=${bt_ip}; path=/`;
      let ipinfo = await getGeoIPInfo({ cacheDays: 0 });
      test.assert(ipinfo);
      test.eq("BT", ipinfo.countryCode);
      test.assert(!ipinfo.countryName);

      ipinfo = await getGeoIPInfo({ lang: 'nl' });
      test.assert(ipinfo);
      test.eq("BT", ipinfo.countryCode);
      test.eq("Bhutan", ipinfo.countryName);

      test.getDoc().cookie = `wh-debug-overrideip=127.0.0.1; path=/`;
      test.eq("BT", await getGeoIPCountryCode()); //cached should be shared

      ipinfo = await getGeoIPInfo({ cacheDays: 0, lang: 'en' });
      test.assert(ipinfo);
      test.eq("NL", ipinfo.countryCode);
      test.eq("Netherlands", ipinfo.countryName);
    },

    "Finalize",
    async function () {
      await test.invoke("mod::webhare_testsuite/tests/publisher/data/testsupport.whlib#setupGeoip", false);
    }
  ]);
