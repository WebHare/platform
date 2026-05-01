import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest");
    },

    {
      name: 'enableburger',
      test: async function () {
        test.assert(test.getCurrentScreen().qS("ul.wh-menubar"));
        test.assert(test.qS('li[data-menuitem$="x0b1"]'));
        test.assert(!test.qS('li[data-menuitem$="x0b2"]'));
        test.eq(1, test.qSA('t-toolbar').length);

        //XB01 should be there, XB02 shouldn't
        test.click(test.compByName('b14_toggleforcemenubar'));
        await test.waitForUI();
      }
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

        test.click(test.compByName('b14_toggleforcemenubar'));
        await test.waitForUI();
      }
    },
    {
      name: 'test menu back',
      test: function () {
        test.assert(!test.getOpenMenu());
        const lastbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.eq(null, lastbutton);

        test.assert(test.getMenu(['X01']), 'menubar did not come back');
      }
    },
    {
      name: 'reenable burger',
      test: async function () {
        test.click(test.compByName('b14_toggleforcemenubar'));
        await test.waitForUI();
      }
    },
    {
      name: 'add menuitems',
      test: async function () {
        //check if the ismenubutton is back
        const lastbutton = test.getCurrentScreen().qR('t-toolbar .t-toolbar-buttongroup__right button:last-child');
        test.assert(lastbutton.classList.contains("ismenubutton"));
        test.click(lastbutton);
        test.click(test.qR(test.getOpenMenu(), 'li[data-menuitem$=":x01menu"]'));
        test.click(test.qR(test.getOpenMenu(), 'li[data-menuitem$=":x18"]'));
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
        test.assert(!parentscreen.qS("ul.wh-menubar"));
      }
    }
  ]);
