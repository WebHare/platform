/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/enabled.enableontest");
    },

    {
      name: 'enableon',
      test: async function (doc, win) {
        // The action should be disabled initially, because there is no selection yet
        const button_node = test.compByName('subwindowbutton');
        const button_comp = button_node.propTodd;
        test.assert(!button_comp.getEnabled());

        // Select the list item
        const list_node = test.compByName('subwindowlist');
        const item_node = list_node.querySelector(".listrow");
        test.click(item_node);
        await test.waitForUI();
      }
    },

    {
      name: 'select item',
      test: async function (doc, win) {
        // The action should be enabled now
        const button_node = test.compByName('subwindowbutton');
        const button_comp = button_node.propTodd;
        test.assert(button_comp.getEnabled());

        // Click the button to open the window
        test.click(button_node);
        await test.waitForUI();
      }
    },

    {
      name: 'open subwindow',
      test: async function (doc, win) {
        // Click the close button to close the window again
        const button_node = test.compByName('closebutton');
        test.click(button_node);
        await test.waitForUI();
      }
    },

    {
      name: 'enabled after direct close',
      test: async function (doc, win) {
        // The action should still be enabled
        const button_node = test.compByName('subwindowbutton');
        const button_comp = button_node.propTodd;
        test.assert(button_comp.getEnabled());

        // Click the button to open the window
        test.click(button_node);
        await test.waitForUI();
      }
    },

    {
      name: 'open subwindow again',
      test: async function (doc, win) {
        // Click the reload button to reload the list
        const button_node = test.compByName('reloadbutton');
        test.click(button_node);
        await test.waitForUI();
      }
    },

    {
      name: 'reload subwindow list',
      test: async function (doc, win) {
        // Click the close button to close the window
        const button_node = test.compByName('closebutton');
        test.click(button_node);
        await test.waitForUI();
      }
    },

    {
      name: 'enabled after subwindow list reload',
      test: function (doc, win) {
        // The action should still be enabled
        const button_node = test.compByName('subwindowbutton');
        const button_comp = button_node.propTodd;
        test.assert(button_comp.getEnabled());
      }
    }

  ]);
