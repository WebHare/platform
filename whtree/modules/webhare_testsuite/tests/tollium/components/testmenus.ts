/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


function getDividers(menu) {
  return Array.from(menu.querySelectorAll("li.divider")).filter(el => el.offsetHeight > 0);
}

let lastcustomactioninfo = null;

function myCustomAction(info) {
  lastcustomactioninfo = info;
  info.screen.sendFrameMessage({ msg: "removecustomaction" }, true);
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest");
    },

    {
      name: 'dummyaction',
      test: function (doc, win) {
        const X01 = test.getMenu(['X01']);
        test.click(X01);
        test.assert(X01.classList.contains("selected"));

        const X09 = test.getMenu(['X01', 'X09']);
        test.sendMouseGesture([{ el: X09 }]);

        test.assert(X01.classList.contains("selected"));
        test.assert(X09.classList.contains("selected"));
        test.assert(!test.getCurrentApp().isBusy());
        test.click(X09);
        test.assert(test.getCurrentApp().isBusy());
      },
      waits: ['ui']
    },

    {
      name: 'triggerquickaction',
      test: function (doc, win) {
        test.assert(!test.getCurrentApp().isBusy());

        // After clicking a menu item, ensure the menu is closed
        const X01 = test.getMenu(['X01']);
        test.assert(!X01.classList.contains("selected"));

        test.click(X01);
        const X03 = test.getMenu(['X03']);

        //hover to the click action via the opened menu
        const X09 = test.getMenu(['X01', 'X09']);
        test.sendMouseGesture([
          { el: X09 },
          { relx: 500 },
          { el: X03 }
        ]);

        //should have hover and selected status (menu was already open)
        test.assert(X03.classList.contains("selected"));
        test.assert(!X01.classList.contains("selected"));

        //click outside the menu to close it
        test.sendMouseGesture([
          { rely: 150, down: 0 },
          { up: 0 }
        ]);
      },
      waitforgestures: 1
    },

    {
      name: 'verify X03',
      test: async function (doc, win) {
        //hover to the click action
        const X03 = test.getMenu(['X03']);
        //should have hover and status, but not selected
        test.assert(!X03.classList.contains("selected"), 'X03 should not have selected state yet');

        //hover to the click action
        test.sendMouseGesture([{ el: X03 }]);

        //test simply clicking on the direct action
        test.eq('0', test.compByName("action1count").textContent);
        test.click(X03);

        //should still have hover status but not selected
        await test.sleep(1);
        test.assert(!X03.classList.contains("selected"));
      },
      waits: ['ui']
    },

    {
      name: 'visibility checks',
      test: function (doc, win) {
        let menu = test.qSA('.wh-menubar')[0];
        const X03 = test.qSA(menu, "*").filter(item => item.textContent.includes('X03'))[0];
        const X01 = test.qSA(menu, "*").filter(item => item.textContent.includes('X01'))[0];
        let X04 = menu.querySelector("li[data-menuitem$=':x04menu']");
        let X07 = test.qSA(X04, "ul li").filter(item => item.textContent.includes('X07'))[0];
        //var X08 = test.qSA(X04,"ul li").filter(item=>item.textContent.includes('X08'));

        test.eq('1', test.compByName("action1count").textContent);

        //should still have hover status but not selected, as our mouse is still here
        test.assert(!X03.classList.contains("selected"));

        //move the mouse to the first menu item
        test.sendMouseGesture([{ el: X01 }]);
        test.assert(!X01.classList.contains("selected")); //should be false, or the menu didn't lose semifocus after the click!

        //click the menu item
        test.click(X01);
        test.assert(X01.classList.contains("selected"));

        //to the 3rdmenu
        test.sendMouseGesture([{ el: X04 }]);

        //verify that only X07, X08, and the divider between them are visible
        test.assert(!test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X05'))[0]);
        test.assert(!test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X06'))[0]);
        test.assert(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X07'))[0]);
        test.assert(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X08'))[0]);
        test.assert(!test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X07'))[0].classList.contains("disabled"));
        test.assert(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X08'))[0].classList.contains("disabled"));

        const visibledividers = getDividers(test.getOpenMenu());
        test.eq(1, visibledividers.length);
        test.eq('X07 item', visibledividers[0].previousSibling.textContent);

        //Click the last menu item
        test.click(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X08'))[0]);

        test.eq('1', test.compByName("action1count").textContent); //action was disabled, so nothing should have happened

        menu = test.qSA('.wh-menubar')[0];
        X04 = menu.querySelector("li[data-menuitem$=':x04menu']");
        test.click(X04);
        X07 = test.qSA("li").filter(item => item.textContent.includes('X07'))[0];
        test.click(X07);
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        test.eq('1', test.compByName("action1count").textContent); //we didn't even touch it...
        const menu = test.qSA('.wh-menubar')[0];
        const X04 = menu.querySelector("li[data-menuitem$=':x04menu']");
        test.click(X04);
        const X05 = test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X05'))[0];
        test.assert(!X05.classList.contains("hidden"));
        test.eq(2, getDividers(test.qSA(".wh-menu.open").slice(-1)[0]).length);

      }
    },

    {
      name: 'disableaction',
      test: function (doc, win) {
        test.assert(!test.getMenu(['X01', 'X11']).classList.contains('disabled'));
        const X12 = test.getMenu(['X01', 'X12']);
        test.click(X12);
      },
      waits: ['ui']
    },

    {
      name: 'disableaction2',
      test: function (doc, win) {
        test.assert(test.getMenu(['X01', 'X11']).classList.contains('disabled'));
        const X12 = test.getMenu(['X01', 'X12']);
        test.click(X12);
      },
      waits: ['ui']
    },

    {
      name: 'customaction',
      test: function (doc, win) {
        win.$shell.registerCustomAction("webhare_testsuite:customaction", myCustomAction);

        test.assert(!test.getMenu(['X01', 'X11']).classList.contains('disabled'));
        const X11 = test.getMenu(['X01', 'X11']);

        test.eq(null, lastcustomactioninfo);
        test.click(X11);
        test.assert(lastcustomactioninfo !== null);
        test.eq(/:customaction$/, lastcustomactioninfo.action);
        test.eq(test.getCurrentScreen().win, lastcustomactioninfo.screen);
      },
      waits: ['ui'] //the custom action should send message, which removes the screen
    },

    {
      name: 'customaction2',
      test: function (doc, win) {
        test.assert(test.getMenu(['X01', 'X11']).classList.contains('disabled'));
      }
    },

    {
      name: 'switchbar',
      test: function (doc, win) {
        //Verify that the form properly accounted for the presence of the menubar
        const screennode = test.getCurrentScreen().getNode();
        const testbottom = test.getCurrentScreen().getToddElement('testbottom');
        test.assert(testbottom.getBoundingClientRect().bottom < screennode.getBoundingClientRect().bottom, "'test bottom' is outside the t-screen");

        const X10 = test.getMenu(['X01', 'X10']);
        test.assert(X10 !== null);
        test.click(X10);
      },
      waits: ['ui']
    },
    {
      name: 'switchbar2',
      test: function (doc, win) {
        //Verify that the form properly accounted for the presence of the menubar
        const screennode = test.getCurrentScreen().getNode();
        const testbottom = test.getCurrentScreen().getToddElement('testbottom');
        test.assert(testbottom.getBoundingClientRect().bottom < screennode.getBoundingClientRect().bottom, "'test bottom' is outside the t-screen");

        test.assert(!test.getMenu(['X01'], { allowMissing: true }) !== null);
        const X22 = test.getMenu(['X21', 'x22']);
        test.assert(X22 !== null);
        test.click(X22);
      },
      waits: ['ui']
    },
    {
      name: 'switchbar3',
      test: function (doc, win) {
        //Verify that the form properly accounted for the presence of the menubar
        const screennode = test.getCurrentScreen().getNode();
        const testbottom = test.getCurrentScreen().getToddElement('testbottom');
        test.assert(testbottom.getBoundingClientRect().bottom < screennode.getBoundingClientRect().bottom, "'test bottom' is outside the t-screen");

        test.assert(!test.getMenu([], { allowMissing: true }));
        test.assert(test.compByName('b02_togglebutton') !== null);
        test.click(test.compByName('b01_switchbar'));
      },
      waits: ['ui']
    },

    {
      name: 'toolbarbuttonvisible',
      test: function (doc, win) {
        const X13 = test.getMenu(['X01', 'X13']);
        test.assert(X13 !== null);
        test.click(X13);
      },
      waits: ['ui']
    },
    {
      name: 'toolbarbuttonvisible2 - now use keyboard',
      test: async function (doc, win) {
        await test.pressKey('b', { ctrlKey: true });
      },
      waits: ['ui']
    },
    {
      name: 'toolbarbuttonvisible3',
      test: function (doc, win) {
        test.assert(test.compByName('b02_togglebutton') !== null);
      }
    },

    {
      name: 'toolbarbuttonenable',
      test: function (doc, win) {
        test.assert(test.compByName('b03_menubutton').classList.contains("todd--disabled"));
        test.click(test.getMenu(['X01', 'X15']));
      },
      waits: ['ui']
    },
    {
      test: function (doc, win) {
        test.assert(!test.compByName('b03_menubutton').classList.contains("todd--disabled"));
        test.click(test.getMenu(['X01', 'X15']));
      },
      waits: ['ui']
    },
    {
      test: function (doc, win) {
        test.assert(test.compByName('b03_menubutton').classList.contains("todd--disabled"));
      }
    }

  ]);
