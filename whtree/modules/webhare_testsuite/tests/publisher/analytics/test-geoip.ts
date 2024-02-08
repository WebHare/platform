import * as test from '@mod-system/js/wh/testframework';
import type { } from "@mod-webhare_testsuite/webdesigns/basetest/js/basetest"; //we need the window globals

const bt_ip = '67.43.156.0'; // see https://github.com/maxmind/MaxMind-DB/blob/15ed5b26ec7bb9b3e1658939b540b27af61ae74b/source-data/GeoLite2-Country-Test.json

function getAnalyticsRPCRequests() {
  return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.includes("/publisher/rpc/"));
}

test.registerTests(
  [
    "Basic GEOIP",
    async function () {
      await test.invoke("mod::webhare_testsuite/tests/publisher/data/testsupport.whlib#setupGeoip", true);

      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie = "wh-debug-overrideip=127.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      test.eq(0, getAnalyticsRPCRequests().length);

      const geocoderequest = test.getWin().geoip_getCountryCode();
      const geocoderequest2 = test.getWin().geoip_getCountryCode(); //this one should wait for the first request

      test.eq("NL", await geocoderequest);
      test.eq("NL", await geocoderequest2, "should also return NL");
      test.eq(1, getAnalyticsRPCRequests().length, "Only 1 rpc should have fired!");

      test.getDoc().cookie = `wh-debug-overrideip=${bt_ip}; path=/`;
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      let countrycode = await test.getWin().geoip_getCountryCode();
      test.eq(0, getAnalyticsRPCRequests().length);

      test.eq("NL", countrycode); //should still be cached

      //clear cache, force geoip re-lookup
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');
      countrycode = await test.getWin().geoip_getCountryCode();
      test.eq("BT", countrycode);
      test.eq(1, getAnalyticsRPCRequests().length);

      //clear cache, look up a failing code
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie = "wh-debug-overrideip=0.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      countrycode = await test.getWin().geoip_getCountryCode();
      test.eq(null, countrycode);
      test.eq(1, getAnalyticsRPCRequests().length);
    },
    "GEOIP + countryname",
    async function () {
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie = "wh-debug-overrideip=127.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      const countrycode = await test.getWin().geoip_getCountryCode();
      test.eq("NL", countrycode);

      test.getDoc().cookie = `wh-debug-overrideip=${bt_ip}; path=/`;
      let ipinfo = await test.getWin().geoip_getIPInfo({ cachedays: 0 });
      test.assert(ipinfo);
      test.eq("BT", ipinfo.countrycode);
      test.assert(!ipinfo.countryname);

      ipinfo = await test.getWin().geoip_getIPInfo({ countrylang: 'nl' });
      test.assert(ipinfo);
      test.eq("BT", ipinfo.countrycode);
      test.eq("Bhutan", ipinfo.countryname);

      test.getDoc().cookie = `wh-debug-overrideip=127.0.0.1; path=/`;
      test.eq("BT", await test.getWin().geoip_getCountryCode()); //cached should be shared

      ipinfo = await test.getWin().geoip_getIPInfo({ cachedays: 0, countrylang: 'en' });
      test.assert(ipinfo);
      test.eq("NL", ipinfo.countrycode);
      test.eq("Netherlands", ipinfo.countryname);
    },

    "Finalize",
    async function () {
      await test.invoke("mod::webhare_testsuite/tests/publisher/data/testsupport.whlib#setupGeoip", false);
    }
  ]);
