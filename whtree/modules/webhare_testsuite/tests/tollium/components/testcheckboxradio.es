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

        test.fill(test.compByName("thecomponent$*").querySelector("input"), true);
        await test.wait('ui');
        test.eq("1", test.compByName("onchangecount").textContent);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
        test.fill(test.compByName("thecomponent$*").querySelector("input"), false);
        await test.wait('ui');
        test.eq("2", test.compByName("onchangecount").textContent);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);

        test.click(test.compByName("thecomponent$*").querySelector("label"));
        await test.wait('ui');
        test.eq("3", test.compByName("onchangecount").textContent);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
        test.click(test.compByName("thecomponent$*").querySelector("label"));
        await test.wait('ui');
        test.eq("4", test.compByName("onchangecount").textContent);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);

        //now set it to indeterminate...
        test.click(test.compByName("indeterminate"));
        await test.wait('ui');
        test.eq("5", test.compByName("onchangecount").textContent);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.true(test.compByName("thecomponent$*").querySelector("input").indeterminate);
        test.true(test.compByName("indeterminate").querySelector("input").checked);

        //value should still read 'false'
        test.eq("false", test.compByName("value*").querySelector("input").value);

        //test toggling indeterminate (back to false)
        test.click(test.compByName("indeterminate"));
        await test.wait('ui');
        test.eq("6", test.compByName("onchangecount").textContent);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.false(test.compByName("thecomponent$*").querySelector("input").indeterminate);
        test.false(test.compByName("indeterminate").querySelector("input").checked);

        //test toggling indeterminate (back to true)
        test.click(test.compByName("indeterminate"));
        await test.wait('ui');
        test.eq("7", test.compByName("onchangecount").textContent);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.true(test.compByName("thecomponent$*").querySelector("input").indeterminate);
        test.true(test.compByName("indeterminate").querySelector("input").checked);

        //now click the checkbox. it will toggle and lose indeterminate
        test.click(test.compByName("thecomponent$*").querySelector("label"));
        await test.wait('ui');
        test.eq("8", test.compByName("onchangecount").textContent);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
        test.false(test.compByName("thecomponent$*").querySelector("input").indeterminate);
        test.false(test.compByName("indeterminate").querySelector("input").checked);
        test.eq("true", test.compByName("value*").querySelector("input").value);

        //make it indeterminate again.. it will remain true
        test.click(test.compByName("indeterminate"));
        await test.wait('ui');
        test.eq("9", test.compByName("onchangecount").textContent);
        test.eq("true", test.compByName("value*").querySelector("input").value);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
        test.true(test.compByName("thecomponent$*").querySelector("input").indeterminate);
        test.true(test.compByName("indeterminate").querySelector("input").checked);

        // programatic unset. also clears indeterminate
        test.fill(test.compByName("value*").querySelector("input"), "false");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');
        test.eq("10", test.compByName("onchangecount").textContent);
        test.false(test.compByName("thecomponent$*").querySelector("input").checked);
        test.false(test.compByName("thecomponent$*").querySelector("input").indeterminate);
        test.false(test.compByName("indeterminate").querySelector("input").checked);

        // programatic set. also clears indeterminate
        test.fill(test.compByName("value*").querySelector("input"), "true");
        test.click(test.compByName("writevaluebutton"));
        await test.wait('ui');
        test.eq("11", test.compByName("onchangecount").textContent);
        test.true(test.compByName("thecomponent$*").querySelector("input").checked);
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
