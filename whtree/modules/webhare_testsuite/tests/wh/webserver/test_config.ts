import * as test from "@mod-webhare_testsuite/js/wts-backend";

import { compareHSandTSConfig } from "@mod-platform/js/webserver/config-compat";

test.runTests([
  // this API is split off so we can use it in different reconfiguration tests too
  compareHSandTSConfig
]);
