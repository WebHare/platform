import * as dompack from 'dompack';
import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/lists.basetest,prepjump');
    },
    {
      name: 'scrollfirst', //manually scroll first. setting a manual scroll may break scroll restoration
      test: function () {
        //TODO gesture support so we can just point to the list and it'll figure out what to scroll
        const list = test.compByName("staticlist").querySelector(".listbodyholder");
        list.scrollTop = 50;
        dompack.dispatchDomEvent(list, 'scroll');
      }
    },
    {
      name: 'jumptoselection',
      test: function () {
        test.click(test.getMenu(['M01', 'M06']));
      },
      waits: ['ui']
    },
    {
      test: function () {
        const listview = test.compByName("staticlist").propTodd.list;
        test.eq(143, listview.getFirstVisibleRow());//we currently whole "Row #144", which is sequentially 0-based row 143
      }
    },

    async function () {
      await tt.loadWTSTestScreen('tests/lists.basetest,jumpnow');
    },
    {
      test: function () {
        const listview = test.compByName("staticlist").propTodd.list;
        test.eq(143, listview.getFirstVisibleRow());//we currently whole "Row #144", which is sequentially 0-based row 143
      }
    },
    //make sure scroll position is retained after toggling list
    {
      name: 'toggle list off/on',
      test: async function () {
        let list = test.compByName("staticlist").querySelector(".listbodyholder");
        list.scrollTop = 250;
        dompack.dispatchDomEvent(list, 'scroll');
        let listview = test.compByName("staticlist").propTodd.list;
        test.eq(10, listview.getFirstVisibleRow());
        test.assert(test.canClick(test.getCurrentScreen().getListRow('staticlist', 'Row #017')));

        test.click(test.getMenu(['M01', 'M11']));
        await test.wait("ui");
        test.click(test.getMenu(['M01', 'M11']));
        await test.wait("ui");
        list = test.compByName("staticlist").querySelector(".listbodyholder");
        listview = test.compByName("staticlist").propTodd.list;
        test.eq(250, list.scrollTop);
        test.eq(10, listview.getFirstVisibleRow());

        await test.wait(() => test.getCurrentScreen().getListRow('staticlist', 'Row #017')); //wait for the row to actually appear. scroll events may take some time to reshow the row
        test.assert(test.canClick(test.getCurrentScreen().getListRow('staticlist', 'Row #017')));
      }
    },

    {
      name: "arrow left in tree to invisible parent",
      test: async function () {
        test.click(test.getMenu(['M01', 'M12']));
        await test.wait("ui");

        // focus the component to make sure the key gets there
        test.compByName("dynamiclist").focus();
        await test.wait("events");

        // press the left key, should go to the parent
        await test.pressKey("ArrowLeft");
        await test.wait("events");

        // Test the right row is selected
        const listview = test.compByName("dynamiclist").propTodd.list;
        test.eq(0, listview.getFirstVisibleRow());//Should have gone to the top node
      }
    },

    {
      name: "truncate list",
      test: async function () {
        test.click(test.getMenu(['M01', 'M13']));
        await test.wait("ui");
        test.eq(0, test.compByName("staticlist").querySelector(".listbodyholder").scrollTop);
      }
    }
  ]);
