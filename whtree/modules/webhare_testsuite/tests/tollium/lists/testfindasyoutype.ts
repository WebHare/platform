import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/lists.findasyoutypelist");
    },

    {
      name: "press 1",
      test: async function () {
        await test.pressKey('1');
        test.assert(test.getCurrentScreen().getListRow("list", "<1>").classList.contains("wh-list__row--selected"));
        await test.pressKey(['0', '9']);

        test.assert(test.getCurrentScreen().getListRow("list", "<109>").classList.contains("wh-list__row--selected"));
      }
    },
    {
      name: "select <8>",
      test: async function () {
        await test.pressKey(['Escape', '8']);
      }
    },
    {
      name: "test selection <8>",
      test: async function () {
        const listrow = test.getCurrentScreen().getListRow("list", "<8>");
        test.assert(listrow, 'listrow with <8> not available/visible');
        test.assert(listrow.classList.contains("wh-list__row--selected"));
        await test.pressKey(['4']);
      },
      waits: [2500] // Above find as you type timeout (2000)
    },
    {
      name: "select <4>",
      test: async function () {
        await test.pressKey(['4']);
      }
    },
    {
      name: "test selection <4>, select <44>",
      test: async function () {
        test.assert(test.getCurrentScreen().getListRow("list", "<4>").classList.contains("wh-list__row--selected"));
        await test.pressKey(['Control', '4']); //check that sending Ctrl doesn't abort list progression
      }
    },
    {
      name: "test selection <44>, select <41> (with backspace + 1)",
      test: async function () {
        test.assert(test.getCurrentScreen().getListRow("list", "<44>").classList.contains("wh-list__row--selected"));
        await test.pressKey(['Backspace', '1']);
      }
    },
    {
      name: "test selection <41>",
      test: async function () {
        test.assert(test.getCurrentScreen().getListRow("list", "<41>").classList.contains("wh-list__row--selected"));
      }
    }
  ]);
