import * as test from "@mod-tollium/js/testframework";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/shortcuts.shortcuttest");
    },

    {
      name: "press f7",
      test: async function () {
        const target = test.getCurrentScreen().getToddElement("textedit").querySelector("input");
        // FIXME: shouldn't have to set focus... only focusable element in main frame should have focus
        target.focus();

        await test.pressKey("F7");
      },
      waits: ["ui"]
    },

    {
      name: "check result, press ctrl+f7",
      test: async function () {
        // FIXME: shouldn't have to set focus... only focusable element in main frame should have focus
        test.eq("fkey_vanilla 1", test.getCurrentScreen().getToddElement("textedit").querySelector("input").value);

        const target = test.getCurrentScreen().getToddElement("textedit").querySelector("input");
        // FIXME: shouldn't have to set focus... only focusable element in main frame should have focus
        target.focus();

        await test.pressKey("F7", { ctrlKey: true });
      },
      waits: ["ui"]
    },

    {
      name: "check result",
      test: function () {
        test.eq("fkey_ctrl 2", test.getCurrentScreen().getToddElement("textedit").querySelector("input").value);
      }
    }
  ]);
