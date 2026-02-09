import "@webhare/frontend/styling/reset.css";

// import * as dompack from 'dompack';
// import "@mod-publisher/js/analytics/gtm"; //TODO need a @webhare/frontend .. ?

// import * as whintegration from '@mod-system/js/wh/integration';
// import '@mod-system/js/wh/errorreporting'; //log JS errors to notice log

import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';
import * as test from '@webhare/test';
import * as env from '@webhare/env';
import { expose } from "@webhare/test-frontend";
import { frontendConfig, getFrontendData, getGeoIPInfo, getSiteRoot, isInTestFramework, setupFormAnalytics, type GetIPInfoOptions } from "@webhare/frontend";

import './forms/forms';
import './rtd/rtd';
import './frontend.scss';

import '../widgets/video';
import '../pages/wrdauthtest';
import '../pages/formtest/formtest';
import { getHTMLTid, getTid } from "@webhare/gettid";

import '../../basetest/js/basetest.lang.json';

declare module "@webhare/frontend" {
  interface FrontendDataTypes {
    "webhare_testsuite:basetestjs": {
      notOurAlarmCode: number;
    };
    "webhare_testsuite:notactuallyset": {
      xyz: number;
    };
    "webhare_testsuite:otherdata": {
      otherData: number;
    };
  }
}

function getTidTest() {
  return {
    consolelog: getTid("webhare_testsuite:webdesigns.basetest.consolelog"),
    unicode2028: getTid("webhare_testsuite:test.unicode_2028"),
    richtext: getHTMLTid("webhare_testsuite:test.richtext"),
    richtext_params: getHTMLTid("webhare_testsuite:test.richtext_params"),
    maxextras_1: getTid("webhare_testsuite:test.maxextras", 1),
    maxextras_2: getTid("webhare_testsuite:test.maxextras", 2)
  };
}


const baseTestApi = expose("baseTestApi", {
  frontendConfig,
  env,
  getMyFrontendData: () => getFrontendData("webhare_testsuite:basetestjs"),
  getTidTest,
  getGeoIPInfo: (options?: GetIPInfoOptions) => getGeoIPInfo(options)
});
void baseTestApi;
export type BaseTestApi = typeof baseTestApi;

//verify that the frontendConfig is properly initialized
test.eq({ notOurAlarmCode: 424242 }, getFrontendData("webhare_testsuite:basetestjs"));
//@ts-expect-error should be detected as invalid. this doesn't stop it from actually working at runtime!
test.eq({ invalidData: 41 }, getFrontendData("webhare_testsuite:nosuchtype"));

//these types will not actually be set
test.throws(/Missing .*notactuallyset/, () => getFrontendData("webhare_testsuite:notactuallyset"));
test.eq(null, getFrontendData("webhare_testsuite:notactuallyset", { allowMissing: true }));

/* Commonly used:
import { setupLinksInNewWindow } from '@webwhare/frontend';
setupLinksInNewWindow();
*/
dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

setupFormAnalytics();

document.documentElement.dataset.inTestFramework = isInTestFramework() ? "true" : "false";
document.documentElement.dataset.siteRoot = getSiteRoot();
