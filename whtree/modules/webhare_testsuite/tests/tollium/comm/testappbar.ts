import * as test from "@mod-tollium/js/testframework";
import type WebSocketTransport from "@mod-tollium/web/ui/js/comm/websocket";
import type { IndyShell } from "@mod-tollium/web/ui/js/shell";
const transport = test.getTestArgument(0);

test.runTests(
  [
    async function () {
      await test.load(test.getTolliumHost() + '?app=webhare_testsuite:appstarttest&transport=' + transport);
    },
    'restart app3',
    async function () {
      await test.wait(() => test.qSA('.t-apptab').length === 2);
      test.click(test.getMenu(['X03']));
      await test.waitUI();
    },
    'check close',
    async function () {
      test.eq('app_1_1', test.getDoc().title);
      test.eq(3, test.qSA('.t-apptab').length);
      test.eq(1, test.qSA('.t-apptab--activeapp').length);

      const activeapp = test.qSA('.t-apptab--activeapp')[0];
      const closer = activeapp.querySelector(".t-apptab__close");
      test.assert(closer);
      test.assert(test.isElementClickable(closer));

      test.click(test.getMenu(['X06']));
      await test.waitUI();
    },

    "Disrupt connection if websocket to test recovery",
    async function () {
      if (transport === 'websocket') {
        //@ts-expect-error $shell doesn't offer a public API for this
        const shell = test.getWin().$shell as IndyShell;
        const transport0 = shell.transportmgr.transports[0] as WebSocketTransport;
        test.eq(1, transport0.socket?.readyState, "Unable to get direct access to the websocket - we need that to test disconnection");
        transport0.socket!.close();
      }
    },

    'check still closeable',
    async function () {
      test.eq(2, test.getCurrentApp().getNumOpenScreens());

      const activeapp = test.qSA('.t-apptab--activeapp')[0];
      const closer = activeapp.querySelector(".t-apptab__close");
      test.assert(closer);
      test.assert(test.isElementClickable(closer));

      test.assert(!test.getCurrentApp().isBusy());
      test.click(closer);
      test.assert(!test.getCurrentApp().isBusy());
      await test.pressKey('Escape');
      await test.waitUI();
    },

    'check it closed',
    async function () {
      test.eq(1, test.getCurrentApp().getNumOpenScreens());
      test.click(test.getMenu(['X05']));
      await test.waitUI();
    },

    'check noclose',
    async function () {
      /* opening a noclose window currently -does not- disable the closer on the parent */
      const activeapp = test.qSA('.t-apptab--activeapp')[0];
      const closer = activeapp.querySelector(".t-apptab__close");
      test.assert(closer);
      test.assert(test.isElementClickable(closer), 'closer (x) should be clickable');
      test.assert(!test.getCurrentApp().isBusy());
      test.click(closer);
      test.assert(!test.getCurrentApp().isBusy());
      await test.pressKey('Escape');
      test.assert(!test.getCurrentApp().isBusy());
    },

    //but clicking it should have no effect. app should remain non busy
    //it requires the close button
    test.testClickTolliumButton('Close'),

    "toggle allowclose",
    async function () {
      //note: the first time we toggle, we also start an on-close handler
      test.click(test.getMenu(['X07']));
      await test.waitUI();
    },

    "check toggle allowclose",
    async function () {
      const activeapp = test.qSA('.t-apptab--activeapp')[0];
      const closer = activeapp.querySelector(".t-apptab__close");
      test.assert(closer);
      test.assert(!test.isElementClickable(closer));
      test.click(test.getMenu(['X07']));
      await test.waitUI();
    },

    "check confirmation",
    async function () {
      test.click(test.qSA('.t-apptab--activeapp .t-apptab__close')[0]);
      await test.waitUI();
    },

    test.testClickTolliumButton('No'),

    "check confirmation",
    async function () {
      test.click(test.qSA('.t-apptab--activeapp .t-apptab__close')[0]);
      test.eq(3, test.qSA('.t-apptab').length);
      await test.waitUI();

    },

    test.testClickTolliumButton('Yes'),

    "check close",
    async function () {
      await test.wait(() => test.qSA('.t-apptab').length === 2);
    }
  ]);


//and now we can close the app
//ADDME toggle allowclose
//ADDME test verification dialog
