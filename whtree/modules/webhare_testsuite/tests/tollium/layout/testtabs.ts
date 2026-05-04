/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


function getTabs(startnode) {
  return Array.from(startnode.querySelectorAll("div[data-tab]")).filter(node => node.closest('t-tabs') === startnode);
}
function getActiveTab(startnode) {
  return getTabs(startnode).filter(node => node.classList.contains('active'))[0];
}
function getTabSheetLabel(tab) {
  return Array.from(tab.childNodes).filter(node => node.matches('.label'))[0];
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest,tabs");
    },

    {
      name: 'launchappholder',
      test: async function () {
        test.assert(!test.canClick(test.compByName('tabs')));
        const A01 = test.getMenu(['M01', 'A01']);
        test.click(A01);
        await test.waitForUI();
      }
    },

    {
      name: 'clicktab',
      test: async function () {
        test.assert(test.isElementClickable(test.compByName('tabs')));

        //verify the tabs properly all got the same szie (the 400x350 max)
        const tab1 = test.compByName('tab1');
        const tab2 = test.compByName('tab2');
        const tab3 = test.compByName('tab3');
        test.eq(tab1.offsetWidth, tab2.offsetWidth);
        test.eq(tab1.offsetHeight, tab2.offsetHeight);
        test.eq(tab1.offsetWidth, tab3.offsetWidth);
        test.eq(tab1.offsetHeight, tab3.offsetHeight);
        test.eq(400, tab1.offsetWidth);
        test.eq(350, tab1.offsetHeight);


        //verify tab2 is the selected tab
        let activetab = getActiveTab(test.compByName('tabs'));
        const tab2label = getTabSheetLabel(activetab);
        test.assert(tab2label.offsetWidth >= 25); //regression: it didn't size
        test.eq('Tab 2', tab2label.textContent);
        test.eq('tab2', test.compByName('selectedtab').textContent);

        const tabs = getTabs(test.compByName('tabs'));
        test.eq(4, tabs.length);
        test.eq('Tab 1', getTabSheetLabel(tabs[0]).textContent);

        test.click(tabs[0]);

        //verify tab1 is now the selected tab
        activetab = getActiveTab(test.compByName('tabs'));
        test.eq('Tab 1', getTabSheetLabel(activetab).textContent);
        const elt = test.compByName("typepulldown");
        elt.propTodd.setValue('P02');
        await test.waitForUI(); //we need to wait for the animation at least
      }
    },

    {
      //NOTE Tabs are no longer actually stacked, but the tests till pass so can't hurt to keep them
      name: 'stackedtabs',
      test: async function () {
        test.fill(test.compByName('type_imagetext_title').querySelector('input'), 'Test Title');

        const tabs = getTabs(test.compByName('tabs'));
        test.click(tabs[3]); //goto tab 3
        await test.waitForUI(); //we need to wait for the animation at least
      }
    },
    {
      test: function () {
        test.eq('Stacked tab 1', getActiveTab(test.compByName('stackedtabs')).querySelector('.label').textContent);

        let tabs = getTabs(test.compByName('stackedtabs'));
        test.assert(tabs[0].classList.contains('active'));
        test.assert(!tabs[1].classList.contains('active'));
        test.click(tabs[1]); //stackedtabs1

        tabs = getTabs(test.compByName('stackedtabs'));
        test.assert(!tabs[0].classList.contains('active'));
        test.assert(tabs[1].classList.contains('active'));

        test.fill(test.compByName('texteditstack2').querySelector('input'), 'Test Twee');
      }
    },

    {
      test: async function () {
        const tabs = getTabs(test.compByName('tabs'));
        test.click(tabs[1]); //goto tab 2
        await test.waitForUI();
      }
    },

    {
      name: 'stackedtabs3',
      test: async function () {
        test.click(test.compByName('syncbutton'));
        await test.waitForUI();
      }
    },

    {
      name: 'stackedtabs4',
      test: function () {
        test.eq('Test Title', test.compByName('tab1_imagetext_title').textContent);
        test.eq('Test Twee', test.compByName('tab3_texteditstack2').textContent);
      }
    },

    //test state saving
    {
      name: 'isstatesaved',
      test: async function () {
        test.getCurrentScreen().clickCloser();
        await test.waitForUI();
      }
    },
    {
      name: 'isstatesaved-reopen',
      test: async function () {
        const A02 = test.getMenu(['M01', 'A02']);
        test.click(A02);
        await test.waitForUI();
      }
    },
    {
      name: 'isstatesaved-settab3',
      test: async function () {
        //note,we should be able to access the app, as appholder should've saved state
        const tabs = getTabs(test.compByName('tabs'));
        test.click(tabs[2]); //goto tab 3
        await test.waitForUI();
      }
    },
    {
      name: 'isstatesaved-checkstacked2',
      test: function () {
        const tabs = getTabs(test.compByName('stackedtabs'));
        test.assert(!tabs[0].classList.contains('active'));
        test.assert(tabs[1].classList.contains('active'));
      }
    },

    //test anonymous tab
    {
      name: 'testanonymoustab',
      test: function () {
        const tablabel = test.qSA('*[data-tab$=":untitledtab"]')[0];
        test.click(tablabel, { x: 5, y: 5 });
        test.assert(test.isElementClickable(test.compByName('untitledtabtext')));
      }
    },   //the menu shouldn't be here yet...
    {
      name: 'testmenu',
      test: async function () {
        const tablabel = test.compByName('tabs').querySelector('.nav-tabs');
        test.assert(!test.isElementClickable(tablabel));

        test.click(test.getMenu(['M01', 'A02']));
        await test.waitForUI();
      }
    },
    'testmenu', //use the menu to go to a different tab
    async function () {
      const tablabel = test.compByName('tabs').querySelector('.nav-tabs');
      test.assert(test.isElementClickable(tablabel), 'nav pulldown should have appeared');
      test.click(tablabel);

      test.assert(test.getOpenMenu());
      const openedmenu = test.getOpenMenu();

      test.eq(4, openedmenu.querySelectorAll("li").length); // 4 tabs
      test.eq(openedmenu.querySelector("li").offsetHeight, openedmenu.querySelectorAll("li")[2].offsetHeight); //all the same height, even the anonymous ones
      test.eq(Math.ceil(tablabel.getBoundingClientRect().right), Math.ceil(openedmenu.getBoundingClientRect().right), 'we also expect this menu to be right aligned against the nav-tabs button');

      const tab3 = test.qSA(openedmenu, 'li').filter(li => li.textContent.includes("long name for tab 3"))[0];
      test.assert(tab3, "No menu item named '... long name for tab 3'");

      test.click(tab3);
      await test.wait(() => !test.getOpenMenu()); //menu should closed
      await test.waitForUI();
      const tabs = getTabs(test.compByName('tabs'));
      test.assert(tabs[3].classList.contains("active"));
      test.assert(test.isElementClickable(tabs[3]));
      test.eq('tab3', test.compByName('selectedtab').textContent);
    }

  ]);
