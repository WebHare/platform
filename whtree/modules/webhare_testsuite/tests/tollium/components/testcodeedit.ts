/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.codeedittest");
    },

    {
      name: 'initialselectedline',
      test: async function () {
        test.assert(test.hasFocus(test.qS('textarea')));
        test.assert(test.qS('textarea').scrollTop !== 0, 'scrollTop = 0, so no initial selection done');
        test.assert(!test.qS('textarea').readOnly);

        // Disable
        test.click(test.getMenu(['I04']));
        await test.waitForUI();
      }
    },

    {
      name: 'disabled',
      test: async function () {
        test.assert(test.qS('textarea').readOnly);
        test.assert(test.qS('textarea').scrollTop !== 0);

        // Enable
        test.click(test.getMenu(['I04']));
        await test.waitForUI();
      }
    },

    {
      name: 'reenabled',
      test: async function () {
        test.assert(!test.qS('textarea').readOnly);
        test.assert(test.qS('textarea').scrollTop !== 0);

        // First line
        test.click(test.getMenu(['I01']));
        await test.waitForUI();
      }
    },

    {
      name: 'firstline',
      test: async function () {
        test.assert(test.qS('textarea').scrollTop === 0);

        // Last line
        test.click(test.getMenu(['I02']));
        await test.waitForUI();
      }
    },

    {
      name: 'lastline',
      test: async function () {
        const textarea = test.qS('textarea');
        test.eq(textarea.scrollHeight - textarea.clientHeight, textarea.scrollTop);

        // Reset
        test.click(test.getMenu(['I03']));
        await test.waitForUI();
      }
    },

    {
      name: 'reset',
      test: function () {
        test.assert(test.qS('textarea').scrollTop === 0);
        const textarea = test.qS('textarea');
        test.eq('', textarea.value);
      }
    },

    {
      name: 'set',
      test: async function () {
        const textarea = test.qS('textarea');
        dompack.focus(textarea);
        await test.pressKey('Enter'); //ensure cr doesn't kill us by leaking to parent frame
        test.fill(textarea, "Dit is een test");
        test.click(test.getMenu(['I05']));
        await test.waitForUI();
      }
    },

    {
      name: 'setcheck',
      test: function () {
        const textarea = test.qS('textarea');
        test.eq("RGl0IGlzIGVlbiB0ZXN0", textarea.value);
      }
    },

    async function testSelectionWhenDisabled() {
      const textarea = test.qS('textarea');
      dompack.focus(textarea);
      textarea.value = "0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n";
      test.click(test.getMenu(['I04'])); // toggle enabled
      await test.wait("ui");
      textarea.scrollTop = 60;
      textarea.setSelectionRange(12, 15);
      test.click(test.getMenu(['I06'])); // update status line
      await test.wait("ui");
      test.eq("4: '6\\n7'", test.compByName("status").textContent);
      textarea.value = ""; // clean to see if changes are ignored
      test.click(test.getMenu(['I05']));
      await test.wait("ui");
      test.eq('MAoxCjIKMw', textarea.value.substr(0, 10));
    }

  ]);
