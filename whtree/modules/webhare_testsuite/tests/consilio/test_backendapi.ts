/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-system/js/wh/testframework';
import ConsilioBackend from '@mod-consilio/js/backend';

// let testdata;

test.registerTests(
  [
    async function () {
      /*testdata =*/ await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupConsilioTest');
      await test.load(test.getTestSiteRoot());
    },
    "test low level api",
    async function () {
      const backend = new ConsilioBackend(test.getWin().whintegration_config.site.consiliotoken);
      let suggestions = await backend.getSuggestions('StaticP');
      test.eq(1, suggestions.length);
      test.eq("StaticPage", suggestions[0].text);

      //Test cancellations
      const suggestions_abortme = backend.getSuggestions('testsit');
      suggestions = await backend.getSuggestions('Welcom');
      test.eq(null, await suggestions_abortme);
    }
  ]);
