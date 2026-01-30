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
      await test.load(test.getWrdLogoutURL(setupdata.testportalurl + "?app=publisher(" + setupdata!.rtdid + ")"));
      await testwrd.runLogin(setupdata.sysopuser, setupdata.sysoppassword);
      await test.waitForUI();
    },
    async function () {
      test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));
      test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));

      await test.waitForUI();
    },
    async function () {
      const h1 = test.getCurrentScreen().qSA('h1.heading1');
      test.assert(h1);
      test.eq(1, h1.length);
      //ADDME css ready would be nice, but we'll just wait
      await test.wait(() => getComputedStyle(h1[0]).color === 'rgb(0, 0, 255)');
      await test.sleep(200);
    },
    "Empty line between objects disappear on save",
    async function () {
      // focus the edit area
      let body = test.getCurrentScreen().qS(".wh-rtd-editor-bodynode");
      test.click(body);
      test.getWin().getSelection()!.setBaseAndExtent(body, body.children.length, body, body.children.length);

      // Append two objects
      test.click(test.getCurrentScreen().qS(`*[data-button="object-insert"]`));
      await test.wait("ui");
      test.click(test.getCurrentScreen().getListRow('contenttypes', 'http://www.webhare.net/xmlns/webhare_testsuite/rtd/emptywidget'));
      await test.wait("ui");
      test.click(test.compByTitle("OK"));
      await test.wait("ui");

      test.click(test.getCurrentScreen().qS(`*[data-button="object-insert"]`));
      await test.wait("ui");
      test.click(test.getCurrentScreen().getListRow('contenttypes', 'http://www.webhare.net/xmlns/webhare_testsuite/rtd/emptywidget'));
      await test.wait("ui");
      test.click(test.compByTitle("OK"));
      await test.wait("ui");

      // Ensure an empty line between them
      test.click(test.getCurrentScreen().qS(`.wh-rtd-navunderbutton`));

      // Ensure an empty line between them
      test.click(test.compByTitle("Save"));
      await test.wait("ui");

      // Exit the editor to avoid lock on re-open
      test.click(test.getMenu(["Exit"]));
      await test.wait("ui");

      // Close and reopen the editor
      await test.load(setupdata!.testportalurl + "?app=publisher(" + setupdata!.rtdid + ")");
      await test.wait("ui");
      test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));
      test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));
      await test.waitForUI();

      body = test.getCurrentScreen().qS(".wh-rtd-editor-bodynode");
      test.eq(["h1", "div", "p", "div"], Array.from((body as HTMLElement).children).map(n => n.nodeName.toLowerCase()));
    }

  ]);
