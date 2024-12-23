/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";


test.runTests(
  [
    {
      loadpage: test.getTestScreen('tests/regressions.test_tab_enableoncrash'),
      waits: ['ui']
    }
  ]);
