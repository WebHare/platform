/* frontend tollium test APIs that are only available if webhare_testsuite is installed (eg things that cannot live in @webhare/test-frontend)
   We are intended to extend tolliumtest. you should generally import the following for webhare_testsuite frontend tests:

import * as test from "@webhare/test-frontend";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

*/

import { getTolliumDebugVariables } from "@mod-tollium/js/testframework";
import * as test from "@webhare/test-frontend";
export * from "@mod-tollium/js/tolliumtest";

export const metrics = {
  gridRowHeight: 28
};

export async function getTestPortal() {
  //made async just in case we'll ever need to RPCV this
  return test.getTestSiteRoot() + 'testsuiteportal/';
}

export async function loadYamlScreen(name: string): Promise<void> {
  await test.load(`${await getTestPortal()}?app=webhare_testsuite:runyamlscreen(${encodeURIComponent(name)})`);
  await test.waitForUI();
}

export async function loadWTSTestScreen(testscreen: string) {
  await test.load(`${await getTestPortal()}?app=webhare_testsuite:runscreen(${encodeURIComponent(testscreen)})&${getTolliumDebugVariables()}`);
}
