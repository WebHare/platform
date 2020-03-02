import * as test from "@mod-tollium/js/testframework";


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/regressions.test_tab_enableoncrash')
    , waits: [ 'ui' ]
    }
  ]);
