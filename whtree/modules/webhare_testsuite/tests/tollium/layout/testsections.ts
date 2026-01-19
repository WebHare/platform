import * as test from "@webhare/test-frontend";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";
import { getRelativeBounds } from "@webhare/dompack";

test.runTests([
  async function () {
    await tt.loadWTSTestScreen('tests/layout.layouttest,sections');

    const s1 = tt.comp("section1");
    const s2 = tt.comp("section2");
    const s3 = tt.comp("section3");
    test.eq(tt.metrics.gridRowHeight, getRelativeBounds(s2.node, s1.node).top, "Height should match with S1 being closed (currently the row height of 28)");
    test.eq(tt.metrics.gridRowHeight, getRelativeBounds(s3.node, s2.node).top, "Height should match with S2 being closed (currently the row height of 28)");
    test.eq(false, s1.querySelector("details")?.open);
    test.eq(false, s2.querySelector("details")?.open);
    test.eq(true, s3.querySelector("details")?.open);

    //elements such as textedit,textarea should have the same width inside and outside of sections
    test.click(s2.querySelector("summary")!);
    test.eq(tt.comp("outside_textedit").node.getBoundingClientRect().width, tt.comp("s2_textedit").node.getBoundingClientRect().width, "Textedit inside section should match width outside");
    test.eq(tt.comp("outside_textarea").node.getBoundingClientRect().width, tt.comp("s2_textarea").node.getBoundingClientRect().width, "Textarea inside section should match width outside");
  }
]);

/*
)
test.runTests(
[
  asynxc f
  {
    loadpage: test.getTestScreen('tests/layout.layouttest,sections'),
    waits: ['ui']
  },

  {
    name: 'launchappholder',
    test: function (doc, win) {
      test.assert(!test.canClick(test.compByName('tabs')));
      const A01 = test.getMenu(['M01', 'A01']);
      test.click(A01);
    },
    waits: ['ui']
  },

  {
    name: 'clicktab',
    test: function (doc, win) {
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
    },
    waits: ['ui'] //we need to wait for the animation at least
  },

  {
    name: 'stackedtabs',
    test: async function (doc, win) {
      test.fill(test.compByName('type_imagetext_title').querySelector('input'), 'Test Title');

      const tabs = getTabs(test.compByName('tabs'));
      test.click(tabs[3]); //goto tab 3
    },
    waits: ['ui'] //we need to wait for the animation at least
  },
  {
    test: function (doc, win) {
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
    test: function (doc, win) {
      const tabs = getTabs(test.compByName('tabs'));
      test.click(tabs[1]); //goto tab 2
    },
    waits: ['ui']
  },

  {
    name: 'stackedtabs3',
    test: function (doc, win) {
      test.click(test.compByName('syncbutton'));
    },
    waits: ['ui']
  },

  {
    name: 'stackedtabs4',
    test: function (doc, win) {
      test.eq('Test Title', test.compByName('tab1_imagetext_title').textContent);
      test.eq('Test Twee', test.compByName('tab3_texteditstack2').textContent);
    }
  },

  //test state saving
  {
    name: 'isstatesaved',
    test: function (doc, win) {
      test.getCurrentScreen().clickCloser();
    },
    waits: ['ui']
  },
  {
    name: 'isstatesaved-reopen',
    test: function (doc, win) {
      const A02 = test.getMenu(['M01', 'A02']);
      test.click(A02);
    },
    waits: ['ui']
  },
  {
    name: 'isstatesaved-settab3',
    test: function (doc, win) {
      //note,we should be able to access the app, as appholder should've saved state
      const tabs = getTabs(test.compByName('tabs'));
      test.click(tabs[2]); //goto tab 3
    },
    waits: ['ui']
  },
  {
    name: 'isstatesaved-checkstacked2',
    test: function (doc, win) {
      const tabs = getTabs(test.compByName('stackedtabs'));
      test.assert(!tabs[0].classList.contains('active'));
      test.assert(tabs[1].classList.contains('active'));
    }
  },

  //test anonymous tab
  {
    name: 'testanonymoustab',
    test: function (doc, win) {
      const tablabel = test.qSA('*[data-tab$=":untitledtab"]')[0];
      test.click(tablabel, { x: 5, y: 5 });
      test.assert(test.isElementClickable(test.compByName('untitledtabtext')));
    }
  },   //the menu shouldn't be here yet...
  {
    name: 'testmenu',
    test: function (doc, win) {
      const tablabel = test.compByName('tabs').querySelector('.nav-tabs');
      test.assert(!test.isElementClickable(tablabel));

      test.click(test.getMenu(['M01', 'A02']));
    },
    waits: ['ui']
  },
  'testmenu', //use the menu to go to a different tab
  async function (doc, win) {
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
    await test.wait('ui');
    const tabs = getTabs(test.compByName('tabs'));
    test.assert(tabs[3].classList.contains("active"));
    test.assert(test.isElementClickable(tabs[3]));
    test.eq('tab3', test.compByName('selectedtab').textContent);
  }

]);
*/
