/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation
import * as dompack from "@webhare/dompack";
import * as test from "@mod-system/js/wh/testframework";

function getPressedKeys() { return JSON.parse(test.qS('#keyspressed').value || "[]"); }

test.registerTests(
  [
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/statictestpage.html');
      //Test straight wait
      test.eq('H2', (await test.waitForElement('h2')).nodeName);
      //Indexed wait
      await test.throws(/Multiple matches/, () => test.waitForElement('p'));
      test.eq('p1', (await test.waitForElement(['p', 0])).id);
      test.eq('p2', (await test.waitForElement(['p', 1])).id);

      const waitfor_p3 = test.waitForElement(['p', 2]);

      await test.sleep(5);
      test.qR("#p2").after(<p id="p3">p3</p>);
      test.eq('p3', (await waitfor_p3).id);
    }
  ]);
