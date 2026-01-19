import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import { getRoundedBoundingClientRect } from "@webhare/test-frontend";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/tables.calendartest");
    },

    {
      name: 'verifylayout',
      test: async function () {
        test.assert(test.compByName('calendarholder').offsetHeight < 768, 'calendarholder too big'); //should not be escaping the screen

        //find our overlay
        const greenoverlay = test.qSA('[data-overlayid="GREENEVENT"]')[0];
        test.assert(greenoverlay, 'overlay GREENEVENT not found');
        test.assert(test.isElementClickable(greenoverlay));
        test.assert(!greenoverlay.classList.contains('todd-table--selected'));

        const redoverlay = test.qSA('[data-overlayid="REDEVENT"]')[0];
        test.assert(redoverlay, 'overlay REDEVENT not found');
        test.assert(test.isElementClickable(redoverlay));
        test.assert(!redoverlay.classList.contains('todd-table--selected'));

        const yellowoverlay = test.qSA('[data-overlayid="YELLOWEVENT"]')[0];
        test.assert(yellowoverlay, 'overlay YELLOWEVENT not found');
        test.assert(test.isElementClickable(yellowoverlay));
        test.assert(!yellowoverlay.classList.contains('todd-table--selected'));

        const purpleoverlay = test.qSA('[data-overlayid="PURPLEEVENT"]')[0];
        test.assert(purpleoverlay, 'overlay PURPLEEVENT not found');
        test.assert(test.isElementClickable(purpleoverlay));
        test.assert(!purpleoverlay.classList.contains('todd-table--selected'));

        test.assert(greenoverlay.getBoundingClientRect().left < yellowoverlay.getBoundingClientRect().left, "green and yellow should partially overlap");

        //the 04:00 cell contains both green & yellow
        const overlappedcell = test.qSA('[data-todd-cellpos="9:6"]')[0];
        test.assert(overlappedcell, 'overlapped cell 04:00 (9:6) not found');
        test.eq(getRoundedBoundingClientRect(overlappedcell).left + 1, getRoundedBoundingClientRect(greenoverlay).left);
        test.eq(getRoundedBoundingClientRect(overlappedcell).right - 1, getRoundedBoundingClientRect(yellowoverlay).right);

        //click in the overlapped cell, the yellow overlay should be selected
        const overlappedcoords = overlappedcell.getBoundingClientRect();
        await test.sendMouseGesture([{ el: test.getDoc().body, down: 0, x: overlappedcoords.left + overlappedcoords.width / 2, y: overlappedcoords.top + overlappedcoords.height / 2 }, { up: 0 }]);
        test.assert(yellowoverlay.classList.contains('todd-table__overlay--selected'));
        test.assert(!greenoverlay.classList.contains('todd-table__overlay--selected'));

        //click the green overlay, it should be selected now
        test.click(greenoverlay);
        test.assert(!yellowoverlay.classList.contains('todd-table__overlay--selected'));
        test.assert(greenoverlay.classList.contains('todd-table__overlay--selected'));

        //click in the overlapped cell, the green overlay should still be selected as it should be positioned before the yellow overlay
        await test.sendMouseGesture([{ el: test.getDoc().body, down: 0, x: overlappedcoords.left + overlappedcoords.width / 2, y: overlappedcoords.top + overlappedcoords.height / 2 }, { up: 0 }]);
        test.assert(!yellowoverlay.classList.contains('todd-table__overlay--selected'));
        test.assert(greenoverlay.classList.contains('todd-table__overlay--selected'));

        //click again to open the appointment properties
        await test.sendMouseGesture([{ el: test.getDoc().body, down: 0, x: overlappedcoords.left + overlappedcoords.width / 2, y: overlappedcoords.top + overlappedcoords.height / 2 }, { up: 0 }]);
      }
    }

  ]);
