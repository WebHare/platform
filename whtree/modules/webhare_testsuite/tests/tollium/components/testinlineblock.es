import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/inlineblock.inlineblocktest')
    , waits: [ 'ui', 200 ] // wait for svg to get loaded
    }

    // Some simple tests to check if the inline block and its contents are rendered
  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');

        // Check if the inline block is visible
        var inlineblock = holder.querySelector("t-inlineblock");
        test.true(inlineblock);

        // There should be 4 texts visible (3 titles, 1 text value)
        var texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
      }
    }
  ]);
