/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [
    {
      loadpage: test.getTestScreen('tests/inlineblock.inlineblocktest'),
      waits: ['ui', 200] // wait for svg to get loaded
    },

    // Some simple tests to check if the inline block and its contents are rendered
    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');

        // Check if the inline block is visible
        const inlineblock = holder.querySelector("t-inlineblock");
        test.assert(inlineblock);

        // There should be 4 texts visible (3 titles, 1 text value)
        const texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
      }
    }
  ]);
