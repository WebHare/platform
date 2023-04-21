/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-system/js/wh/testframework';

test.registerTests(
  [
    async function () {
      await test.load(test.getTestSiteRoot());
      test.eq('\u2028unicode line separator,\u2029another separator', test.getWin().getTidTest().unicode2028);
      test.assert(global.URL); //ensure the global object exists (at least for window environments)
    }
  ]);
