import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

const gesture_time = 200;

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/dragdrop.subscreen');
    },

    {
      name: 'source.row1->target.row1_prepare',
      test: async function () {
        const toplog = test.qSA('t-textarea')[0];
        const bottomlog = test.qSA('t-textarea')[1];
        const topsource = test.qSA('.wh-ui-listview[data-name$=source]')[0];
        const bottomtarget = test.qSA('.wh-ui-listview[data-name$=target]')[1];

        test.eq('', toplog.querySelector('textarea')?.value);
        test.eq('', bottomlog.querySelector('textarea')?.value);

        const srow = test.getCurrentScreen().getListRow(topsource.dataset.name!, "Row 1: type1");
        const trow = test.getCurrentScreen().getListRow(bottomtarget.dataset.name!, "Row 1: Can add");
        await test.sendMouseGesture([
          { el: srow, x: 10, down: 0 },
          { el: trow, x: 10, up: 0, delay: gesture_time }
        ]);
      },
      waits: ["ui"]
    },

    {
      name: 'source.row1->target.row1_test',
      test: function () {
        test.eq('1 T1 ontarget move', test.qSA('t-textarea')[1]?.querySelector('textarea')?.value);
      }
    }
  ]);
