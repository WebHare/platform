import * as test from "@mod-tollium/js/testframework";
import * as dompack from 'dompack';


test.registerTests(
  [ { loadpage: test.getCompTestPage('textarea')
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        var holder = test.compByName("componentpanel");
        var textedits = holder.querySelectorAll("textarea");
        test.eq(1, textedits.length); //make sure we've got the right(only) one
        test.eq("the-placeholder", textedits[0].getAttribute("placeholder"));
      }
    }

  , async function defaultbutton_pulldown(doc,win)
    {
      let alternatedefault = test.compByName('alternatedefault');
      let textedit_selection = test.compByName("selection");

      let testpanel = test.compByName("componentpanel");
      let node = testpanel.querySelector('textarea');

      test.click(textedit_selection.querySelector("input"));
      test.false(alternatedefault.classList.contains("default"));

      test.click(node);
      test.true(alternatedefault.classList.contains("default"));
    }

  ]);
