/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";

test.runTests(
  [
    async function () {
      await test.load(test.getCompTestPage('progress', {}));
    },
    {
      test: async function () {
      }
    }
  ]);
