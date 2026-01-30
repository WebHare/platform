import * as test from "@mod-tollium/js/testframework";

test.runTests(
  [
    {
      loadpage: test.getCompTestPage('checkbox', { title: "", label: "checkboxlabel" }), //standard labelled checkbox
      waits: ['ui']
    },
    {
      test: async function () {
        //make sure component fits
        const comppanel = test.compByName("componentpanel");
        const textlabel = comppanel.querySelector('t-text');
        test.eq('checkboxlabel', textlabel.textContent);
        test.assert(comppanel.getBoundingClientRect().right >= textlabel.getBoundingClientRect().right, 'text must fit inside panel');
        test.assert(!test.compByName("thecomponent").checked);
        test.assert(!test.compByName("thecomponent").disabled);

        test.click(test.compByName('enable'));
        await test.waitForUI();
        test.assert(!test.compByName("thecomponent").checked);
        test.assert(test.compByName("thecomponent").disabled);
        test.click(test.compByName('enable'));
        await test.waitForUI();

        test.fill(test.compByName("thecomponent"), true);
        await test.waitForUI();
        test.eq("1", test.compByName("onchangecount").textContent);
        test.assert(test.compByName("thecomponent").checked);
        test.fill(test.compByName("thecomponent"), false);
        await test.waitForUI();
        test.eq("2", test.compByName("onchangecount").textContent);
        test.assert(!test.compByName("thecomponent").checked);

        test.click(test.compByName("thecomponent"));
        await test.waitForUI();
        test.eq("3", test.compByName("onchangecount").textContent);
        test.assert(test.compByName("thecomponent").checked);
        test.click(test.compByName("thecomponent"));
        await test.waitForUI();
        test.eq("4", test.compByName("onchangecount").textContent);
        test.assert(!test.compByName("thecomponent").checked);

        //now set it to indeterminate...
        test.click(test.compByName("indeterminate"));
        await test.waitForUI();
        test.eq("5", test.compByName("onchangecount").textContent);
        test.assert(!test.compByName("thecomponent").checked);
        test.assert(test.compByName("thecomponent").indeterminate);
        test.assert(test.compByName("indeterminate").checked);

        //test toggling indeterminate (back to false)
        test.click(test.compByName("indeterminate"));
        await test.waitForUI();
        test.eq("6", test.compByName("onchangecount").textContent);
        test.assert(!test.compByName("thecomponent").checked);
        test.assert(!test.compByName("thecomponent").indeterminate);
        test.assert(!test.compByName("indeterminate").checked);

        //test toggling indeterminate (back to true)
        test.click(test.compByName("indeterminate"));
        await test.waitForUI();
        test.eq("7", test.compByName("onchangecount").textContent);
        test.assert(!test.compByName("thecomponent").checked);
        test.assert(test.compByName("thecomponent").indeterminate);
        test.assert(test.compByName("indeterminate").checked);

        //now click the checkbox. it will toggle to true and lose indeterminate
        test.click(test.compByName("thecomponent"));
        await test.waitForUI();
        test.eq("8", test.compByName("onchangecount").textContent);
        test.assert(test.compByName("thecomponent").checked);
        test.assert(!test.compByName("thecomponent").indeterminate);
        test.assert(!test.compByName("indeterminate").checked);

        //set it to false
        test.click(test.compByName("thecomponent"));
        await test.waitForUI();
        test.eq("9", test.compByName("onchangecount").textContent);

        //re-enable indetermiante
        test.click(test.compByName("indeterminate"));
        await test.waitForUI();
        test.assert(test.compByName("thecomponent").indeterminate);

        //click it
        test.click(test.compByName("thecomponent"));
        await test.waitForUI();

        test.assert(test.compByName("thecomponent").checked);
        test.assert(!test.compByName("thecomponent").indeterminate);
        test.assert(test.compByName("thecomponent").checked);
      }
    },

    {
      loadpage: test.getCompTestPage('radiobutton', { title: "", label: "radiolabel" }), //standard labelled radio
      waits: ['ui']
    },
    {
      test: async function () {
        //make sure component fits
        const comppanel = test.compByName("componentpanel");
        const textlabel = comppanel.querySelector('t-text');
        test.eq('radiolabel', textlabel.textContent);
        test.assert(comppanel.getBoundingClientRect().right >= textlabel.getBoundingClientRect().right, 'text must fit inside panel');
        test.assert(!test.compByName("thecomponent").querySelector("input").checked);
        test.assert(!test.compByName("thecomponent").querySelector("input").disabled);

        test.click(test.compByName('enable'));
        await test.waitForUI();
        test.assert(!test.compByName("thecomponent").querySelector("input").checked);
        test.assert(test.compByName("thecomponent").querySelector("input").disabled);

        test.click(test.compByName('enable'));
        await test.waitForUI();
        test.assert(!test.compByName("thecomponent").querySelector("input").disabled);

        // test onset handler
        test.click(test.compByName("listenonchange"));
        await test.waitForUI();

        test.fill(test.compByName("thecomponent").querySelector("input"), true);
        await test.waitForUI();
        test.eq("set: 1", test.compByName("onchangecounter").querySelector("input").value);

        // uncheck programatically
        test.fill(test.compByName("value*").querySelector("input"), "false");
        test.click(test.compByName("writevaluebutton"));
        await test.waitForUI();

        test.assert(!test.compByName("thecomponent").querySelector("input").checked);
        test.click(test.compByName("thecomponent").querySelector("label"));
        await test.waitForUI();

        test.eq("set: 2", test.compByName("onchangecounter").querySelector("input").value);

        // programatic unset
        test.fill(test.compByName("value*").querySelector("input"), "false");
        test.click(test.compByName("writevaluebutton"));
        await test.waitForUI();
        test.eq("set: 2", test.compByName("onchangecounter").querySelector("input").value);

        // programatic set
        test.fill(test.compByName("value*").querySelector("input"), "true");
        test.click(test.compByName("writevaluebutton"));
        await test.waitForUI();
        test.eq("set: 3", test.compByName("onchangecounter").querySelector("input").value);
      }
    }
  ]);
