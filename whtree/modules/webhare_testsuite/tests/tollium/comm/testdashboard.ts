import * as test from "@mod-tollium/js/testframework";
import { invokeSetupForTestSetup, type TestSetupData } from "@mod-webhare_testsuite/js/wts-testhelpers";
import * as testwrd from "@mod-wrd/js/testframework";

let setupdata: TestSetupData | null = null;

test.runTests(
  [
    "Prepare",
    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });
      await test.load(setupdata.testportalurl);
      await testwrd.runLogin(setupdata.sysopuser, setupdata.sysoppassword);
      await test.waitForUI();

      await test.waitForUI();
    },

    "Test dashboard menu",
    async function () {
      //test dashboard now at the end
      test.eq("TEST GROUP", test.qR(".dashboard__menuitem:last-of-type .dashboard__menusectiontitle").textContent);
      test.eq("Dashboard", test.qR(".dashboard__menuitem:last-of-type .dashboard__app:last-of-type .dashboard__apptitle").textContent);
    }
  ]);
