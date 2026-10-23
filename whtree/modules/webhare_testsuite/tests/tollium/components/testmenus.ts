import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import type { IndyShell } from '@mod-tollium/web/ui/js/shell';
import type { ObjFrame } from '@mod-tollium/webdesigns/webinterface/components/frame/frame';


function getDividers(menu: ParentNode): HTMLLIElement[] {
  return Array.from(menu.querySelectorAll<HTMLLIElement>("li.divider")).filter(el => el.offsetHeight > 0);
}

let lastcustomactioninfo: { action: string; screen: ObjFrame } | null = null;

function myCustomAction(info: { action: string; screen: ObjFrame }) {
  lastcustomactioninfo = info;
  info.screen.sendFrameMessage({ msg: "removecustomaction" }, true);
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest");
    },

    'dummyaction',
    async function () {
      const X01 = test.getMenu(['X01']);
      test.click(X01);
      test.assert(X01.classList.contains("selected"));

      const X09 = test.getMenu(['X01', 'X09']);
      await test.sendMouseGesture([{ el: X09 }]);

      test.assert(X09.classList.contains("selected"));
      test.assert(!test.getCurrentApp().isBusy());
      const X02 = X09.previousElementSibling as HTMLLIElement;
      await test.pressKey('ArrowUp');
      test.assert(X02.classList.contains("selected"));
      await test.pressKey('ArrowDown');
      test.assert(X09.classList.contains("selected"));
      await test.pressKey('Enter');
      test.assert(test.getCurrentApp().isBusy());
      await test.waitForUI();
    },

    'triggerquickaction',
    async function () {
      test.assert(!test.getCurrentApp().isBusy());

      // After clicking a menu item, ensure the menu is closed
      const X01 = test.getMenu(['X01']);
      test.assert(!X01.classList.contains("selected"));
      test.click(X01);

      //hover to the click action via the opened menu
      const X09 = test.getMenu(['X01', 'X09']);
      await test.sendMouseGesture([
        { el: X09 },
        { relx: 500 },
      ]);

      //click outside the menu to close it
      await test.sendMouseGesture([
        { rely: 150, down: 0 },
        { up: 0 }
      ]);
    },

    'verify X03',
    async function () {
      //hover to the click action
      const X03 = test.getMenu(['X03']);
      //should have hover and status, but not selected
      test.assert(!X03.classList.contains("selected"), 'X03 should not have selected state yet');

      //hover to the click action
      await test.sendMouseGesture([{ el: X03 }]);

      //test simply clicking on the direct action
      test.eq('0', test.compByName("action1count").textContent);
      test.click(X03);

      //should still have hover status but not selected
      await test.sleep(1);
      test.assert(!X03.classList.contains("selected"));
      await test.waitForUI();
    },

    'visibility checks',
    async function () {
      test.eq('1', test.compByName("action1count").textContent);

      const X07 = test.getMenu(['X04', 'X07']);
      const openSubmenu = test.getOpenMenu();
      test.assert(openSubmenu);
      const X08 = test.qSA(openSubmenu, "li").filter(item => item.textContent.includes('X08'))[0];
      test.assert(X08.getBoundingClientRect().top > X07.getBoundingClientRect().top, "submenu items should be vertically stacked");
      //verify that only X07, X08, and the divider between them are visible
      test.assert(!test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X05'))[0]);
      test.assert(!test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X06'))[0]);
      test.assert(test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X07'))[0]);
      test.assert(test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X08'))[0]);
      test.assert(!test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X07'))[0].classList.contains("disabled"));
      test.assert(test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X08'))[0].classList.contains("disabled"));

      const visibledividers = getDividers(openSubmenu);
      test.eq(1, visibledividers.length);
      const previousElementSibling = visibledividers[0].previousElementSibling;
      test.assert(previousElementSibling);
      test.eq('X07 item', previousElementSibling.textContent);

      //Click the last menu item
      test.click(test.qSA(openSubmenu, "li").filter(li => li.textContent.includes('X08'))[0]);

      test.eq('1', test.compByName("action1count").textContent); //action was disabled, so nothing should have happened

      test.click(test.getMenu(['X04', 'X07']));
      await test.waitForUI();
    },

    function () {
      test.eq('1', test.compByName("action1count").textContent); //we didn't even touch it...
      test.click(test.getMenu(['X04']));
      test.eq(2, getDividers(test.qSA(".wh-menu:popover-open").slice(-1)[0]).length);

    },

    'disableaction',
    async function () {
      test.assert(!test.getMenu(['X01', 'X11']).classList.contains('disabled'));
      const X12 = test.getMenu(['X01', 'X12']);
      test.click(X12);
      await test.waitForUI();
    },

    'disableaction2',
    async function () {
      test.assert(test.getMenu(['X01', 'X11']).classList.contains('disabled'));
      const X12 = test.getMenu(['X01', 'X12']);
      test.click(X12);
      await test.waitForUI();
    },

    'customaction',
    async function () {
      //@ts-expect-error $shell doesn't offer a public API for this
      const shell = test.getWin().$shell as IndyShell;
      shell.registerCustomAction("webhare_testsuite:customaction", myCustomAction);

      test.assert(!test.getMenu(['X01', 'X11']).classList.contains('disabled'));
      const X11 = test.getMenu(['X01', 'X11']);

      test.eq(null, lastcustomactioninfo);
      test.click(X11);
      test.assert(lastcustomactioninfo !== null);
      test.eq(/:customaction$/, lastcustomactioninfo.action);
      test.eq(test.getCurrentScreen().win, lastcustomactioninfo.screen);
      await test.waitForUI();
    },

    'customaction2',
    function () {
      test.assert(test.getMenu(['X01', 'X11']).classList.contains('disabled'));
    },

    'switchbar',
    async function () {
      //Verify that the form fits within the screen when its menu is open
      const screennode = test.getCurrentScreen().getNode();
      test.assert(screennode);
      const testbottom = test.getCurrentScreen().getToddElement('testbottom');
      test.assert(testbottom.getBoundingClientRect().bottom < screennode.getBoundingClientRect().bottom, "'test bottom' is outside the t-screen");

      const X10 = test.getMenu(['X01', 'X10']);
      test.assert(X10 !== null);
      test.click(X10);
      await test.waitForUI();
    },
    'switchbar2',
    async function () {
      //Verify that the form fits within the screen when its menu is open
      const screennode = test.getCurrentScreen().getNode();
      test.assert(screennode);
      const testbottom = test.getCurrentScreen().getToddElement('testbottom');
      test.assert(testbottom.getBoundingClientRect().bottom < screennode.getBoundingClientRect().bottom, "'test bottom' is outside the t-screen");

      test.assert(!test.getMenu(['X01'], { allowMissing: true }));
      const X22 = test.getMenu(['X21', 'x22']);
      test.assert(X22 !== null);
      test.click(X22);
      await test.waitForUI();
    },
    'switchbar3',
    async function () {
      //Verify that the form fits within the screen when its menu is open
      const screennode = test.getCurrentScreen().getNode();
      test.assert(screennode);
      const testbottom = test.getCurrentScreen().getToddElement('testbottom');
      test.assert(testbottom.getBoundingClientRect().bottom < screennode.getBoundingClientRect().bottom, "'test bottom' is outside the t-screen");

      test.assert(!test.getMenu([], { allowMissing: true }));
      test.assert(test.compByName('b02_togglebutton') !== null);
      test.click(test.compByName('b01_switchbar'));
      await test.waitForUI();
    },

    'toolbarbuttonvisible',
    async function () {
      const X13 = test.getMenu(['X01', 'X13']);
      test.assert(X13 !== null);
      test.click(X13);
      await test.waitForUI();
    },
    'toolbarbuttonvisible2 - now use keyboard',
    async function () {
      await test.pressKey('b', { ctrlKey: true });
      await test.waitForUI();
    },
    'toolbarbuttonvisible3',
    function () {
      test.assert(test.compByName('b02_togglebutton') !== null);
    },

    'toolbarbuttonenable',
    async function () {
      test.assert(test.compByName('b03_menubutton').classList.contains("todd--disabled"));
      test.click(test.getMenu(['X01', 'X15']));
      await test.waitForUI();
    },
    async function () {
      test.assert(!test.compByName('b03_menubutton').classList.contains("todd--disabled"));
      test.click(test.getMenu(['X01', 'X15']));
      await test.waitForUI();
    },
    function () {
      test.assert(test.compByName('b03_menubutton').classList.contains("todd--disabled"));
    },
    {
      test: function () {
        test.eq(1, test.qSA('t-toolbar').length);
        test.click(test.getCurrentScreen().qR("button.ismenubutton"));
        test.assert(test.isElementClickable(test.qSA('li[data-menuitem$=":x01menu"]')[0]), "X01 Menu is already gone!");

        test.click(test.compByName('b04_submenubutton'));
        test.click(test.compByName('b04_submenubutton'));
        test.click(test.getCurrentScreen().qR("button.ismenubutton"));
        test.assert(test.isElementClickable(test.qSA('li[data-menuitem$=":x01menu"]')[0]), "X01 Menu disappeared from the hamburger button after opening it from B04");
      }
    },

    {
      name: 'openburger',
      test: async function () {
        const burgerbutton = test.getCurrentScreen().qR('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.click(burgerbutton);
        test.assert(burgerbutton.classList.contains("button--active"), "button should remain highlighted with open menu");
        test.assert(burgerbutton.classList.contains("ismenubutton"));

        const topmenu = test.getOpenMenu();
        test.assert(topmenu);
        test.assert(!topmenu.querySelector('li[data-menuitem$=":x0b1"]'));
        test.assert(topmenu.querySelector('li[data-menuitem$=":x0b2"]'));

        await test.sendMouseGesture([{ el: test.qSA(topmenu, "li").filter(li => li.textContent?.includes("X01"))[0] }]);
        const x13item = test.qS('li[data-menuitem$=x13]');
        test.assert(x13item);
        test.assert(x13item.hasAttribute("data-menushortcut"));
        test.assert(x13item.closest('ul')?.classList.contains('showshortcuts'), 'shortcuts class missing in hamburger, needed to make data-shortcuts appear');

        await test.sendMouseGesture([{ el: test.qSA(topmenu, "li").filter(li => li.textContent?.includes("X03"))[0] }]);

        test.assert(burgerbutton.classList.contains("button--active"));
        test.assert(test.getOpenMenu());

        const burgerbuttonrect = burgerbutton.getBoundingClientRect();
        const burgermenurect = topmenu.getBoundingClientRect();
        test.eq(Math.ceil(burgerbuttonrect.right), Math.ceil(burgermenurect.right), "burgermenu should right align with button");

        test.click(test.getCurrentScreen().getNode()!, { x: 0, y: 0 });
        test.assert(!burgerbutton.classList.contains("active"));
        test.assert(!test.getOpenMenu());

      }
    },

    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest");
    },

    {
      name: 'initialburger',
      test: async function () {
        test.click(test.getMenu(['X01', 'X17']));
        await test.waitForUI();
      }
    },

    {
      name: 'test burger',
      test: async function () {
        console.error(test.getCurrentScreen());
        const burgerbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.assert(burgerbutton);
        test.assert(burgerbutton.classList.contains("ismenubutton"));
        test.assert(!test.getMenu(['X01'], { allowMissing: true, autoClickHamburger: false }));

        test.click(burgerbutton);
        test.assert(test.getOpenMenu());
      }
    },
    {
      name: 'add menuitems',
      test: async function () {
        //check if the ismenubutton is back
        const lastbutton = test.getCurrentScreen().qR('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.assert(lastbutton.classList.contains("ismenubutton"));
        test.click(lastbutton);
        const menu = test.getOpenMenu();
        test.assert(menu);
        test.click(test.qR(menu, 'li[data-menuitem$=":x01menu"]'));
        test.click(test.qR(menu, 'li[data-menuitem$=":x18"]'));
        await test.waitForUI();
      }
    },
    {
      name: 'check added menuitems',
      test: function () {
        const lastbutton = test.getCurrentScreen().qR('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.click(lastbutton);

        const menu = test.getOpenMenu();
        test.assert(menu);
        test.assert(test.qS('li[data-menuitem$=":x07"]'));
      }
    },

    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest");
    },

    {
      name: 'initialburger-withpopup',
      test: async function () {
        test.click(test.getMenu(['X01', 'X19']));
        await test.waitForUI();
      }
    },

    {
      name: "Check if menubar isn't visible in parent",
      test: function () {
        const parentscreen = test.getCurrentScreen().getParent();
        const lastbutton = parentscreen.qR('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.assert(lastbutton.classList.contains("ismenubutton"));
      }
    },

    "Verify a toolbar appears for a menu",
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest_notoolbar");
      test.eq(1, test.qSA('t-toolbar').length);
      test.click(test.getMenu(['X0B1'])); //should popup @notimplemented screen
      await test.waitForUI();

      test.eq(/This feature has not yet been implemented/, test.getCurrentScreen().getNode()?.textContent);
    }
  ]);
