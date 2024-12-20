/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";

test.runTests(
  [
    {
      loadpage: test.getCompTestPage('progress', {}),
      waits: ['ui']
    },
    {
      test: async function () {
      }
    }
  ]);
