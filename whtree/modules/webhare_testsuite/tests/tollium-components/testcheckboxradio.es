import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getCompTestPage('checkbox', { title: "", label: "checkboxlabel" }) //standard labelled checkbox
    , waits:['ui']
    }
  , { test:async function()
      {
        //make sure component fits
        let comppanel = test.compByName("componentpanel");
        let textlabel = comppanel.querySelector('t-text');
        test.eq('checkboxlabel', textlabel.textContent);
        test.true(comppanel.getBoundingClientRect().right >= textlabel.getBoundingClientRect().right, 'text must fit inside panel');
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.false(test.compByName("thecomponent$*").querySelector("input").disabled);

        test.click(test.compByName('enable'));
        await test.wait('ui');
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.true(test.compByName("thecomponent$*").querySelector("input").disabled);
        test.click(test.compByName('enable'));
        await test.wait('ui');

        // test onchange handler
        test.click(test.compByName("listenonchange").querySelector("label"));
        await test.wait('ui');

        test.fill(test.compByName("thecomponent$*").querySelector("input"), true);
        await test.wait('ui');
        test.eq("change: 1", test.compByName("onchangecounter").querySelector("input").value);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
        test.fill(test.compByName("thecomponent$*").querySelector("input"), false);
        await test.wait('ui');
        test.eq("change: 2", test.compByName("onchangecounter").querySelector("input").value);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);

        test.click(test.compByName("thecomponent$*").querySelector("label"));
        await test.wait('ui');
        test.eq("change: 3", test.compByName("onchangecounter").querySelector("input").value);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
        test.click(test.compByName("thecomponent$*").querySelector("label"));
        await test.wait('ui');
        test.eq("change: 4", test.compByName("onchangecounter").querySelector("input").value);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);

        // programatic set
        test.fill(test.compByName("value*").querySelector("input"), "true");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');
        test.eq("change: 5", test.compByName("onchangecounter").querySelector("input").value);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);

        // programatic unset
        test.fill(test.compByName("value*").querySelector("input"), "false");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');
        test.eq("change: 6", test.compByName("onchangecounter").querySelector("input").value);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);

      }
    }
  , { loadpage: test.getCompTestPage('radiobutton', { title: "", label: "radiolabel" }) //standard labelled radio
    , waits:['ui']
    }
  , { test:async function()
      {
        //make sure component fits
        let comppanel = test.compByName("componentpanel");
        let textlabel = comppanel.querySelector('t-text');
        test.eq('radiolabel', textlabel.textContent);
        test.true(comppanel.getBoundingClientRect().right >= textlabel.getBoundingClientRect().right, 'text must fit inside panel');
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.false(test.compByName("thecomponent$*").querySelector("input").disabled);

        test.click(test.compByName('enable'));
        await test.wait('ui');
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.true(test.compByName("thecomponent$*").querySelector("input").disabled);

        test.click(test.compByName('enable'));
        await test.wait('ui');
        test.false(test.compByName("thecomponent$*").querySelector("input").disabled);

        // test onset handler
        test.click(test.compByName("listenonchange").querySelector("label"));
        await test.wait('ui');

        test.fill(test.compByName("thecomponent$*").querySelector("input"), true);
        await test.wait('ui');
        test.eq("set: 1", test.compByName("onchangecounter").querySelector("input").value);

        // uncheck programatically
        test.fill(test.compByName("value*").querySelector("input"), "false");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');

        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.click(test.compByName("thecomponent$*").querySelector("label"));
        await test.wait('ui');

        test.eq("set: 2", test.compByName("onchangecounter").querySelector("input").value);

        // programatic unset
        test.fill(test.compByName("value*").querySelector("input"), "false");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');
        test.eq("set: 2", test.compByName("onchangecounter").querySelector("input").value);

        // programatic set
        test.fill(test.compByName("value*").querySelector("input"), "true");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');
        test.eq("set: 3", test.compByName("onchangecounter").querySelector("input").value);
      }
    }
  ]);
