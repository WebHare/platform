import * as test from '@webhare/test-frontend';
import * as tt from "@mod-tollium/js/tolliumtest";

test.run(
  [
    "test column resizing",
    async function () {
      await tt.launchScreen('mod::webhare_testsuite/screens/tests/lists.xml#resizetest');
      const row = tt.comp("list").list.getRow(/the fourth cell/);
      const mycell = Array.from(row.children).filter(node => node.nodeName === 'SPAN')[3] as HTMLElement;

      await test.sendMouseGesture([{ el: mycell }]);
      test.assert(mycell.offsetWidth < mycell.scrollWidth, '#4 cell should be overflowing');
      test.eq("the fourth cell", mycell.title, "Title should be set for mouse hover");

      //now resize it. the resize handle should be between the two headers
      const col4 = tt.comp("list").list.getHeader(/Col4/);
      console.log(col4);

      //take the RHS, slide it maximally to the right
      await test.sendMouseGesture([
        { el: col4, x: "100%", down: 0, validateTarget: false },
        { relx: 200, up: 0 }, //maxize the size
      ]);

      test.assert(!(mycell.offsetWidth < mycell.scrollWidth), '#4 cell should no longer be overflowing');

      //We need to send the mousecursor to the cell to make sure the 'title' is updated
      await test.sendMouseGesture([{ el: mycell }]);
      test.assert(!mycell.title);
    },

    "test vertical resizing",
    async function () {
      //@ts-expect-error we need to access the listview directly
      const listview = tt.comp("list").node.propTodd.list;
      test.eq(0, listview.getFirstVisibleRow());

      tt.comp(":5x").click();
      await test.waitForUI();
      test.eq(0, listview.getFirstVisibleRow());

      tt.comp(":15x").click();
      await test.waitForUI();
      test.eq(0, listview.getFirstVisibleRow());

      tt.comp("list").list.getRow(/6/).click();

      tt.comp(":5x").click();
      await test.waitForUI();
      test.eq(3, listview.getFirstVisibleRow());

      tt.comp(":15x").click();
      await test.waitForUI();
      test.eq(0, listview.getFirstVisibleRow());

      // Check for content in the visible rows
      const listbody = tt.comp("list").querySelector(".listbodyholder")!;
      test.eq(["1", "2", "3", "4", "5", "6"], [...listbody.querySelectorAll(".list__row__cell:first-child")].map(node => node.textContent));

      // Check if the selection is still visible
      tt.comp(":5x").click();
      await test.waitForUI();
      test.eq(3, listview.getFirstVisibleRow());

      // test for partially visible rows
      tt.comp(":15x").click();
      await test.waitForUI();
      test.eq(0, listview.getFirstVisibleRow());

      tt.comp("list").list.getRow(/4/).click();

      // Check if the selection is still visible
      tt.comp(":5x").click();
      await test.waitForUI();
      test.eq(1, listview.getFirstVisibleRow());
    },
  ]);
