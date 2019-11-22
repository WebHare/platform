import * as dompack from 'dompack';
import * as test from '@mod-tollium/js/testframework';
import { $qS } from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/lists.resizetest')
    , waits:["ui"]
    }
  , "test resizing"
  , async function()
    {
      let listview = test.compByName("list").propTodd.list;
      test.eq(0, listview.getFirstVisibleRow());

      test.clickTolliumButton("5x");
      await test.wait("ui");
      test.eq(0, listview.getFirstVisibleRow());

      test.clickTolliumButton("15x");
      await test.wait("ui");
      test.eq(0, listview.getFirstVisibleRow());

      await test.selectListRow("list", "6");

      test.clickTolliumButton("5x");
      await test.wait("ui");
      test.eq(3, listview.getFirstVisibleRow());

      test.clickTolliumButton("15x");
      await test.wait("ui");
      test.eq(0, listview.getFirstVisibleRow());

      // Check for content in the visible rows
      let listbody = test.compByName("list").querySelector(".listbodyholder");
      test.eq([ "1", "2", "3", "4", "5", "6" ], dompack.qSA(listbody, ".listrow .text").map(node => node.textContent));

      // Check if the selection is still visible
      test.clickTolliumButton("5x");
      await test.wait("ui");
      test.eq(3, listview.getFirstVisibleRow());

      // test for partially visible rows
      test.clickTolliumButton("15x");
      await test.wait("ui");
      test.eq(0, listview.getFirstVisibleRow());

      await test.selectListRow("list", "4");

      // Check if the selection is still visible
      test.clickTolliumButton("5x");
      await test.wait("ui");
      test.eq(1, listview.getFirstVisibleRow());

    }
  ]);
