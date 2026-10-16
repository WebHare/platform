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

        test.assert(X01.classList.contains("selected"));
        test.assert(X09.classList.contains("selected"));
        test.assert(!test.getCurrentApp().isBusy());
        test.click(X09);
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
        const X03 = test.getMenu(['X03']);

        //hover to the click action via the opened menu
        const X09 = test.getMenu(['X01', 'X09']);
        await test.sendMouseGesture([
          { el: X09 },
          { relx: 500 },
          { el: X03 }
        ]);

        //should have hover and selected status (menu was already open)
        test.assert(X03.classList.contains("selected"));
        test.assert(!X01.classList.contains("selected"));

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
        let menu = test.qR('.wh-menubar');
        const X03 = test.qSA(menu, "*").filter(item => item.textContent.includes('X03'))[0];
        const X01 = test.qSA(menu, "*").filter(item => item.textContent.includes('X01'))[0];
        let X04 = test.qR<HTMLLIElement>(menu, "li[data-menuitem$=':x04menu']");
        let X07 = test.qSA(X04, "ul li").filter(item => item.textContent.includes('X07'))[0];
        //var X08 = test.qSA(X04,"ul li").filter(item=>item.textContent.includes('X08'));

        test.eq('1', test.compByName("action1count").textContent);

        //should still have hover status but not selected, as our mouse is still here
        test.assert(!X03.classList.contains("selected"));

        //move the mouse to the first menu item
        await test.sendMouseGesture([{ el: X01 }]);
        test.assert(!X01.classList.contains("selected")); //should be false, or the menu didn't lose semifocus after the click!

        //click the menu item
        test.click(X01);
        test.assert(X01.classList.contains("selected"));

        //to the 3rdmenu
        await test.sendMouseGesture([{ el: X04 }]);

        //verify that only X07, X08, and the divider between them are visible
        test.assert(!test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X05'))[0]);
        test.assert(!test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X06'))[0]);
        test.assert(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X07'))[0]);
        test.assert(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X08'))[0]);
        test.assert(!test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X07'))[0].classList.contains("disabled"));
        test.assert(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X08'))[0].classList.contains("disabled"));

        const visibledividers = getDividers(test.getOpenMenu());
        test.eq(1, visibledividers.length);
        const previousElementSibling = visibledividers[0].previousElementSibling;
        test.assert(previousElementSibling);
        test.eq('X07 item', previousElementSibling.textContent);

        //Click the last menu item
        test.click(test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X08'))[0]);

        test.eq('1', test.compByName("action1count").textContent); //action was disabled, so nothing should have happened

        menu = test.qR('.wh-menubar');
        X04 = test.qR<HTMLLIElement>(menu, "li[data-menuitem$=':x04menu']");
        test.click(X04);
        X07 = test.qSA("li").filter(item => item.textContent.includes('X07'))[0];
        test.click(X07);
        await test.waitForUI();
      },

    function () {
        test.eq('1', test.compByName("action1count").textContent); //we didn't even touch it...
        const menu = test.qR('.wh-menubar');
        const X04 = test.qR<HTMLLIElement>(menu, "li[data-menuitem$=':x04menu']");
        test.click(X04);
        const X05 = test.qSA(test.getOpenMenu(), "li").filter(li => li.textContent.includes('X05'))[0];
        test.assert(!X05.classList.contains("hidden"));
        test.eq(2, getDividers(test.qSA(".wh-menu.open").slice(-1)[0]).length);

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
        //Verify that the form properly accounted for the presence of the menubar
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
        //Verify that the form properly accounted for the presence of the menubar
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
        //Verify that the form properly accounted for the presence of the menubar
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
      }

  ]);
