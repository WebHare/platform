import * as test from "@mod-system/js/wh/testframework";
import FormBase from "@mod-publisher/js/forms/formbase";


test.registerTests(
  [
      async function()
      {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
        await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1");

        // Check the form handler
        let formhandler = FormBase.getForNode(test.qS("form[data-wh-form-id=arrayform]"));
        test.true(formhandler, "no formhandler available");

        // Check the empty value
        let result = await formhandler.getFormValue();
        test.eq("", result.text);
        test.eq(0, result.contacts.length);

        // Fill the name field not in the array
        test.fill(test.qS("input[name=text]"), "not array");

        // Check the resulting result
        result = await formhandler.getFormValue();
        test.eq("not array", result.text);
        test.eq(0, result.contacts.length);

        // Verify configuration of the array
        let arrayholder = test.qS(".wh-form__fieldgroup--array");
        test.eq("contacts", arrayholder.dataset.whFormGroupFor); //it should NOT claim its subnodes

        // Add a row
        test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
        test.eq(1, arrayholder.querySelectorAll(".wh-form__arrayrow").length);

        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        // Fill the array's name field and the not-array name field
        test.fill(test.qS("input[name=text]"), "still not array");
        test.fill(test.qS(".wh-form__arrayrow input[type=text]"), "array name");

        //Set select option
        test.fill(test.qS(".wh-form__arrayrow select"), "2");

        //check placeholder
        test.eq("Your full name",test.qS(".wh-form__arrayrow input.wh-form__textinput").placeholder);

        // Check the resulting result
        result = await formhandler.getFormValue();
        test.eq("still not array", result.text);
        test.eq(1, result.contacts.length);
        test.eq("array name", result.contacts[0].name);

        test.eq("2", result.contacts[0].gender);

        // Add another row
        test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
        test.eq(2, test.qSA(".wh-form__arrayrow").length);

        test.eq("Your full name",test.qSA(".wh-form__arrayrow input[data-wh-form-cellname=name]")[1].placeholder);

        //We expect 3 select options
        test.eq(3,test.qSA(".wh-form__arrayrow select")[1].options.length);

        // Fill the array's second row's fields
        let row = test.qSA(".wh-form__arrayrow")[1];
        test.fill(test.qS(row, "input[type=text]"), "another name");

        let uploadpromise = test.prepareUpload(
            [ { url: "/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg"
              , filename: "portrait_8.jpg"
              }
            ]);
        test.qS(row, ".wh-form__uploadfield button").click();
        await uploadpromise;

        // Check the resulting result
        result = await formhandler.getFormValue();
        test.eq("still not array", result.text);
        test.eq(2, result.contacts.length);
        test.eq("array name", result.contacts[0].name);
        test.eq("another name", result.contacts[1].name);
        test.true(result.contacts[1].photo);
        test.eq("portrait_8.jpg", result.contacts[1].photo.filename);

        // No more rows can be added
        test.false(test.canClick("[data-wh-form-group-for=contacts] .wh-form__arrayadd"));


        test.click(test.qS("button[type=submit]"));
        await test.wait("ui")
      }

  , { test: async function()
      {
        // Check the submission result
        let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
        test.true(result.ok);
        result = result.value;
        test.eq("still not array", result.text);
        test.eq(2, result.contacts.length);
        test.eq("array name", result.contacts[0].name);
        test.eq("another name", result.contacts[1].name);
        test.true(result.contacts[1].photo);
        test.eq("portrait_8.jpg", result.contacts[1].photo.filename);
        // These properties are added after the image has been processed on the server
        test.eq(600, result.contacts[1].photo.width);
        test.eq(450, result.contacts[1].photo.height);
        test.eq(90, result.contacts[1].photo.rotation);

        // Delete the first row, clear the not-array name field
        test.click(test.qS(".wh-form__arraydelete"));
        test.fill(test.qS("input[name=text]"), "");
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        // Check the resulting result
        let formhandler = FormBase.getForNode(test.qS("form[data-wh-form-id=arrayform]"));
        result = await formhandler.getFormValue();
        test.eq("", result.text);
        test.eq(1, result.contacts.length);
        test.eq("another name", result.contacts[0].name);
        test.true(result.contacts[0].photo);
        test.eq("portrait_8.jpg", result.contacts[0].photo.filename);

        // Delete the last row
        test.click(test.qS(".wh-form__arraydelete"));
        test.eq(0, test.qSA(".wh-form__arrayrow").length);

        // Check the resulting result
        result = await formhandler.getFormValue();
        test.eq("", result.text);
        test.eq(0, result.contacts.length);

        // The form should not be valid
        result = await formhandler.validate();
        test.false(result.valid);

        // Try to submit, which should fail as there should at least be 1 row
        test.click(test.qS("button[type=submit]"));

        // Add a row and submit
        test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        // The form should now be valid
        result = await formhandler.validate();
        test.true(result.valid);

        test.click(test.qS("button[type=submit]"));
      }
    , waits: [ "ui" ]
    }
  , { test: async function()
      {
        // Check the submission result
        let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
        test.true(result.ok);
        result = result.value;
        test.eq("", result.text);
        test.eq(1, result.contacts.length);
        test.eq("", result.contacts[0].name);
        test.false(result.contacts[0].photo);
      }
    }
  , { test: async function()
      {
        await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");

        // Check the prefilled value
        let formhandler = FormBase.getForNode(test.qS("form[data-wh-form-id=arrayform]"));
        let result = await formhandler.getFormValue();
        test.eq("prefilled name", result.text);
        test.eq(1, result.contacts.length);
        test.eq("first contact", result.contacts[0].name);
        test.true(result.contacts[0].photo);
        test.eq("imgeditfile.jpeg", result.contacts[0].photo.filename);

        // Add a row
        test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
        test.eq(2, test.qSA(".wh-form__arrayrow").length);

        // Fill the array's second row's fields and the not-array name field
        test.fill(test.qS("input[name=text]"), "no longer prefilled");
        let row = test.qSA(".wh-form__arrayrow")[1];
        test.fill(test.qS(row, "input[type=text]"), "not prefilled");

        let uploadpromise = test.prepareUpload(
            [ { url: "/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg"
              , filename: "portrait_8.jpg"
              }
            ]);
        test.qS(row, ".wh-form__uploadfield button").click();
        await uploadpromise;

        // Delete the first row
        test.click(test.qS(".wh-form__arraydelete"));
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        test.click(test.qS("button[type=submit]"));
      }
    , waits: [ "ui" ]
    }
  , { test: async function()
      {
        // Check the submission result
        let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
        test.true(result.ok);
        result = result.value;
        test.eq("no longer prefilled", result.text);
        test.eq(1, result.contacts.length);
        test.eq("not prefilled", result.contacts[0].name);
        test.eq("portrait_8.jpg", result.contacts[0].photo.filename);
      }
    }

  , "Test prefill #2 - keep untransmitted values"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=2");

      // Delete the middle row
      test.click(test.qSA(".wh-form__arrayrow")[1].querySelector(".wh-form__arraydelete"));

      // Submit
      test.click("button[type=submit]");
      await test.wait("ui");

      let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
      test.true(result.ok);
      test.eq(42, result.value.contacts[0].myobject);
      test.eq(43, result.value.contacts[1].myobject);
    }

  , "Test custom component inside arrays"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="customarray"] .wh-form__arrayadd');
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="customarray"] .wh-form__arrayadd');

      let arrayholder = test.qS('.wh-form__fieldgroup--array[data-wh-form-group-for="customarray"]');
      test.eq(2, arrayholder.querySelectorAll(".wh-form__arrayrow").length);

      //TODO not sure if we should be hardcoding names like this... works for now but I'm not sure this is something we are suppposed to rely on
      test.fill('[name="customarray-customarray.name-0"]', 'Name #1');
      test.fill('[name="customarray-customarray.customcomp-0"][value="val2"]', true);
      test.fill('[name="customarray-customarray.customcomp.sub-0"]', 'Sub #1');

      test.fill('[name="customarray-customarray.twolevel.customselect.select-0"]', 'lang-nl');
      test.fill('[name="customarray-customarray.twolevel.textedit-0"]', 'TEXT 1');

      test.fill('[name="customarray-customarray.name-1"]', 'Name #2');
      test.fill('[name="customarray-customarray.customcomp-1"][value="val1"]', true);
      test.fill('[name="customarray-customarray.customcomp.sub-1"]', 'Sub #2');

      test.fill('[name="customarray-customarray.twolevel.customselect.select-1"]', 'abc');
      test.fill('[name="customarray-customarray.twolevel.textedit-1"]', 'TEXT 2');

      // Submit
      test.click("button[type=submit]");
      await test.wait("ui");

      let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
      test.true(result.ok);

      test.eq("Name #1", result.value.customarray[0].name);
      test.false(result.value.customarray[0].customcomp.c1);
      test.true(result.value.customarray[0].customcomp.c2);
      test.eq("Sub #1", result.value.customarray[0].customcomp.subvalue);
      // test.eq("lang-nl", result.value.customarray[0].twolevel.field1); //FIXME - support ANOTHER component sublevel in arrays...
      test.eq("TEXT 1", result.value.customarray[0].twolevel.field2);

      test.eq("Name #2", result.value.customarray[1].name);
      test.true(result.value.customarray[1].customcomp.c1);
      test.false(result.value.customarray[1].customcomp.c2);
      test.eq("Sub #2", result.value.customarray[1].customcomp.subvalue);
      // test.eq("abc", result.value.customarray[1].twolevel.field1); //FIXME - support ANOTHER component sublevel in arrays...
      test.eq("TEXT 2", result.value.customarray[1].twolevel.field2);

    }
  ]);
