import { loadlib } from '@webhare/harescript/src/contextvm';
import { backendConfig } from '@webhare/services';
import * as test from '@webhare/test';

async function testHSFetch() {
  const resp = await loadlib("wh::internet/fetch.whlib").fetchSync(backendConfig.backendURL + "tollium_todd.res/webhare_testsuite/tests/getrequestdata.shtml", { headers: { accept: "application/json" } });
  test.eqPartial({ method: "GET" }, await resp.json());
}

test.runTests([testHSFetch]);
