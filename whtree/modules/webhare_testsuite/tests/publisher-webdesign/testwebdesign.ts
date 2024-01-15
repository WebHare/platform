import * as test from '@mod-system/js/wh/testframework';

test.registerTests(
  [
    async function () {
      await test.load(test.getTestSiteRoot());
      //@ts-ignore -- not bothering to define test APIs
      test.eq('\u2028unicode line separator,\u2029another separator', test.getWin().getTidTest().unicode2028);
      test.assert(global.URL); //ensure the global object exists (at least for window environments)

      ///@ts-ignore -- using any for convenience
      const baseTestConfig = test.getWin().baseTestConfig as any;
      test.assert(baseTestConfig.env.debugFlags);
      test.eq("development", baseTestConfig.env.dtapStage);
      test.eq(false, baseTestConfig.env.isLive);

      //vertify deprecated fields will work for now - but with WH5.4 we expect users to prefer @webhare/env
      test.eq(false, baseTestConfig.frontendConfig.islive);
      test.eq("development", baseTestConfig.frontendConfig.dtapstage);
    }
  ]);
