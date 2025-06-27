import * as test from '@webhare/test-frontend';
import type { BaseTestApi } from "@mod-webhare_testsuite/webdesigns/basetestjs/frontend/frontend";
import { isInTestFramework } from '@webhare/frontend';


test.runTests(
  [
    async function () {
      await test.load(test.getTestSiteRoot());
      const baseTestApi = test.importExposed<BaseTestApi>("baseTestApi");

      test.eq("true", test.getDoc().documentElement.dataset.inTestFramework);
      test.eq(true, isInTestFramework());
      test.eq(test.getTestSiteRoot(), test.getDoc().documentElement.dataset.siteRoot);

      const tids = baseTestApi.getTidTest();
      //we now translate \u2028 and \u2029 to \n as we switched from the HS to TS parse. either should be fine as long as nothing crashes.
      test.eq('\nunicode line separator,\nanother separator', tids.unicode2028);
      test.eq("(cannot find text: webhare_testsuite:webdesigns.basetest.consolelog)", tids.consolelog, "Not included in lang.json");
      test.eq('\nunicode line separator,\nanother separator', tids.unicode2028);
      test.eq('Dit is <b>bold</b><br>volgende<br>regel', tids.richtext);
      test.eq('Please note: max 1 person', tids.maxextras_1);
      test.eq('Please note: max 2 persons', tids.maxextras_2);

      test.assert(global.URL); //ensure the global object exists (at least for window environments)

      test.assert(baseTestApi.env.debugFlags);
      test.eq("development", baseTestApi.env.dtapStage);
      test.eq(false, baseTestApi.env.isLive);
      test.eq(test.getTestSiteRoot(), baseTestApi.frontendConfig.siteRoot);

      //vertify deprecated fields will work for now - but with WH5.4 we expect users to prefer @webhare/env
      test.eq(false, baseTestApi.frontendConfig.islive);
      test.eq("development", baseTestApi.frontendConfig.dtapstage);
      test.eq(baseTestApi.frontendConfig.siteRoot, baseTestApi.frontendConfig.siteroot);

      test.eq({ notOurAlarmCode: 424242 }, baseTestApi.getMyFrontendData());
    }
  ]);
