import * as test from "@mod-tollium/js/testframework";
import { invokeSetupForTestSetup, type TestSetupData } from "@mod-webhare_testsuite/js/wts-testhelpers";
import * as testwrd from "@mod-wrd/js/testframework";

let setupdata: TestSetupData | null = null;

test.runTests(
  [
    async function () {
      setupdata = await invokeSetupForTestSetup({
        createsysop: true,
        preprtd: true
      });

      await test.load(test.getWrdLogoutURL(setupdata.links.rtdpublisher!));
      await testwrd.runLogin(setupdata.sysopuser, setupdata.sysoppassword);

      const row = await test.waitForElement([".wh-list__row", /testapp-editrtd/]);
      test.assert(row.classList.contains('wh-list__row--selected'), 'Row should be selected after load');
    }
  ]);
