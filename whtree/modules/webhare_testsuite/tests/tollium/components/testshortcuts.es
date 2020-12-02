import * as test from "@mod-tollium/js/testframework";


test.registerTests(
  [ { loadpage: test.getTestScreen("tests/shortcuts.shortcuttest")
    , waits: [ "ui" ]
    }

  , { name: "press f7"
    , test: async function(doc, win)
      {
        var target = test.getCurrentScreen().getToddElement("textedit").querySelector("input");
        // FIXME: shouldn't have to set focus... only focusable element in main frame should have focus
        target.focus();

        await test.pressKey("F7");
      }
    , waits: [ "ui" ]
    }

  , { name: "check result, press ctrl+f7"
    , test: async function()
      {
        // FIXME: shouldn't have to set focus... only focusable element in main frame should have focus
        test.eq("fkey_vanilla 1", test.getCurrentScreen().getToddElement("textedit").querySelector("input").value);

        var target = test.getCurrentScreen().getToddElement("textedit").querySelector("input");
        // FIXME: shouldn't have to set focus... only focusable element in main frame should have focus
        target.focus();

        await test.pressKey("F7", {ctrlKey: true});
      }
    , waits: [ "ui" ]
    }

  , { name: "check result"
    , test: function(doc, win)
      {
        test.eq("fkey_ctrl 2", test.getCurrentScreen().getToddElement("textedit").querySelector("input").value);
      }
    }
  ]);
