import test from '@mod-system/js/wh/testframework';

let us_ip = '54.70.204.133'; //AWS US-WEST-2 according to https://docs.aws.amazon.com/quicksight/latest/user/regions.html - hopefully wont move out of the US soon

function getAnalyticsRPCRequests()
{
   return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.endsWith("/publisher/rpc/"));
}

test.registerTests(
  [ "Basic GEOIP"
  , async function()
    {
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie="wh-debug-overrideip=127.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      test.eq(0, getAnalyticsRPCRequests().length);

      let geocoderequest = test.getWin().geoip_getCountryCode();
      let geocoderequest2 = test.getWin().geoip_getCountryCode(); //this one should wait for the first request

      test.eq("NL", await geocoderequest);
      test.eq("NL", await geocoderequest2, "should also return NL");
      test.eq(1, getAnalyticsRPCRequests().length, "Only 1 rpc should have fired!");

      test.getDoc().cookie=`wh-debug-overrideip=${us_ip}; path=/`;
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      let countrycode = await test.getWin().geoip_getCountryCode();
      test.eq(0, getAnalyticsRPCRequests().length);

      test.eq("NL", countrycode); //should still be cached

      //clear cache, force geoip re-lookup
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');
      countrycode = await test.getWin().geoip_getCountryCode();
      test.eq("US", countrycode);
      test.eq(1, getAnalyticsRPCRequests().length);

      //clear cache, look up a failing code
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie="wh-debug-overrideip=0.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      countrycode = await test.getWin().geoip_getCountryCode();
      test.eq(null, countrycode);
      test.eq(1, getAnalyticsRPCRequests().length);
    }
  , "GEOIP + countryname"
  , async function()
    {
      test.getWin().localStorage.removeItem("_wh.geoinfo");
      test.getDoc().cookie="wh-debug-overrideip=127.0.0.1; path=/";
      await test.load(test.getTestSiteRoot() + 'testpages/staticpage');

      let countrycode = await test.getWin().geoip_getCountryCode();
      test.eq("NL", countrycode);

      test.getDoc().cookie=`wh-debug-overrideip=${us_ip}; path=/`;
      let ipinfo = await test.getWin().geoip_getIPInfo({cachedays:0});
      test.eq("US", ipinfo.countrycode);
      test.false(ipinfo.countryname);

      ipinfo = await test.getWin().geoip_getIPInfo({countrylang:'nl'});
      test.eq("US", ipinfo.countrycode);
      test.eq("Verenigde Staten", ipinfo.countryname);

      test.getDoc().cookie=`wh-debug-overrideip=127.0.0.1; path=/`;
      test.eq("US", await test.getWin().geoip_getCountryCode()); //cached should be shared

      ipinfo = await test.getWin().geoip_getIPInfo({cachedays:0, countrylang: 'en'});
      test.eq("NL", ipinfo.countrycode);
      test.eq("Netherlands", ipinfo.countryname);
    }
  ]);
