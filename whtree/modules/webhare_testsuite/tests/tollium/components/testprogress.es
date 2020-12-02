import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getCompTestPage('progress', { })
    , waits:['ui']
    }
  , { test:async function()
      {
      }
    }
  ]);
