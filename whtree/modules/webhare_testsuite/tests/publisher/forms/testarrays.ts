import * as test from "@mod-system/js/wh/testframework";
import FormBase from "@mod-publisher/js/forms/formbase";
import { prepareUpload } from '@webhare/test-frontend';

interface ArrayFormValue {
  text: string;
  contacts: Array<{
    name: string;
    photo?: { name: string };
    gender: string;
    wrd_dateofbirth: string;
  }>;
}

test.registerTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1");

      // Check the form handler
      const formhandler = FormBase.getForNode(test.qR("form"))!;
      test.assert(formhandler, "no formhandler available");

      // Check the empty value
      let result = await formhandler.getFormValue() as unknown as ArrayFormValue;
      test.eq("", result.text);
      test.eq(0, result.contacts.length);

      // Fill the name field not in the array
      test.fill("input[name=text]", "not array");

      // Check the resulting result
      result = await formhandler.getFormValue() as unknown as ArrayFormValue;
      test.eq("not array", result.text);
      test.eq(0, result.contacts.length);

      // Verify configuration of the array
      const arrayholder = test.qS(".wh-form__fieldgroup--array")!;
      test.eq("contacts", arrayholder.dataset.whFormGroupFor); //it should NOT claim its subnodes

      // Add a row
      test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
      test.eq(1, arrayholder.querySelectorAll(".wh-form__arrayrow").length);

      test.eq(1, test.qSA(".wh-form__arrayrow").length);

      // Fill the array's name field and the not-array name field
      test.fill("input[name=text]", "still not array");
      test.fill(test.qS(".wh-form__arrayrow input[type=text]")!, "array name");

      //Set select option
      test.fill(test.qS(".wh-form__arrayrow select")!, "2");

      //check placeholder
      test.eq("Your full name", test.qS(".wh-form__arrayrow input.wh-form__textinput")?.placeholder);

      // Check the resulting result
      result = await formhandler.getFormValue() as unknown as ArrayFormValue;
      test.eq("still not array", result.text);
      test.eq(1, result.contacts.length);
      test.eq("array name", result.contacts[0].name);

      test.eq("2", result.contacts[0].gender);

      // Add another row
      test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
      test.eq(2, test.qSA(".wh-form__arrayrow").length);

      test.eq("Your full name", test.qSA(".wh-form__arrayrow input[data-wh-form-cellname=name]")[1].placeholder);

      //We expect 3 select options
      test.eq(3, test.qSA(".wh-form__arrayrow select")[1].options.length);

      // Fill the array's second row's fields
      const row = test.qSA(".wh-form__arrayrow")[1];
      test.fill(test.qS(row, "input[type=text]")!, "another name");

      prepareUpload(["/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg"]);
      test.qR(row, ".wh-form__uploadfield button").click();
      await test.wait('ui');

      // Check the resulting result
      result = await formhandler.getFormValue() as unknown as ArrayFormValue;
      test.eq("still not array", result.text);
      test.eq(2, result.contacts.length);
      test.eq("array name", result.contacts[0].name);
      test.eq("another name", result.contacts[1].name);
      test.assert(result.contacts[1].photo);
      test.eq("portrait_8.jpg", result.contacts[1].photo.name);

      // No more rows can be added
      test.assert(!test.canClick("[data-wh-form-group-for=contacts] .wh-form__arrayadd"));


      test.click("button[type=submit]");
      await test.wait("ui");
    },

    {
      test: async function () {
        // Check the submission result
        let submitResult = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
        test.assert(submitResult.ok);
        submitResult = submitResult.value;
        test.eq("still not array", submitResult.text);
        test.eq(2, submitResult.contacts.length);
        test.eq("array name", submitResult.contacts[0].name);
        test.eq("another name", submitResult.contacts[1].name);
        test.assert(submitResult.contacts[1].photo);
        test.eq("portrait_8.jpg", submitResult.contacts[1].photo.filename);
        // These properties are added after the image has been processed on the server
        test.eq(600, submitResult.contacts[1].photo.width);
        test.eq(450, submitResult.contacts[1].photo.height);
        test.eq(90, submitResult.contacts[1].photo.rotation);

        // Delete the first row, clear the not-array name field
        test.click(test.qS(".wh-form__arraydelete")!);
        test.fill("input[name=text]", "");
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        // Check the resulting result
        const formhandler = FormBase.getForNode(test.qR("form"))!;
        let result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("", result.text);
        test.eq(1, result.contacts.length);
        test.eq("another name", result.contacts[0].name);
        test.assert(result.contacts[0].photo);
        test.eq("portrait_8.jpg", result.contacts[0].photo.name);

        // Delete the last row
        test.click(test.qS(".wh-form__arraydelete")!);
        test.eq(0, test.qSA(".wh-form__arrayrow").length);

        // Check the resulting result
        result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("", result.text);
        test.eq(0, result.contacts.length);

        // The form should not be valid
        let validateResult = await formhandler.validate();
        test.assert(!validateResult.valid);

        // Try to submit, which should fail as there should at least be 1 row
        test.click(test.qR("button[type=submit]"));

        // Add a row and submit
        test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        // The form should now be valid
        validateResult = await formhandler.validate();
        test.assert(validateResult.valid);

        test.click("button[type=submit]");
      },
      waits: ["ui"]
    },
    {
      test: async function () {
        // Check the submission result
        let result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
        test.assert(result.ok);
        result = result.value;
        test.eq("", result.text);
        test.eq(1, result.contacts.length);
        test.eq("", result.contacts[0].name);
        test.assert(!result.contacts[0].photo);
      }
    },

    "Test setting value client-side",
    {
      test: async function () {
        await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");

        // Check the prefilled value
        const formhandler = FormBase.getForNode(test.qR("form"))!;
        let result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("prefilled name", result.text);
        test.eq(1, result.contacts.length);
        test.eq("first contact", result.contacts[0].name);

        // a prefilled image field is not visible in getFormValue - why would we have to redownload already submitted file ?
        // test.assert(result.contacts[0].photo);
        // test.eq("imgeditfile.jpeg", result.contacts[0].photo.filename);

        // Clear the array by setting the value to an empty array
        const arrayvalue = test.qR("[data-wh-form-group-for=contacts] .wh-form__arrayinput");
        formhandler.setFieldValue(arrayvalue, []);
        test.eq(0, test.qSA(".wh-form__arrayrow").length);

        test.fill("input[name=text]", "no longer prefilled");

        result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("no longer prefilled", result.text);
        test.eq(0, result.contacts.length);

        // Set the value to an empty row
        formhandler.setFieldValue(arrayvalue, [{}]);
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("no longer prefilled", result.text);
        test.eq(1, result.contacts.length);
        test.eq("", result.contacts[0].name);
        test.eq("0", result.contacts[0].gender);
        test.eq("", result.contacts[0].wrd_dateofbirth);
        test.assert(!result.contacts[0].photo);

        // Set the value to two rows with values
        formhandler.setFieldValue(arrayvalue, [{ name: "First person", gender: 1, wrd_dateofbirth: "2000-02-02" }, { name: "Another person", gender: 2, wrd_dateofbirth: "2000-03-03" }]);
        test.eq(2, test.qSA(".wh-form__arrayrow").length);

        result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("no longer prefilled", result.text);
        test.eq(2, result.contacts.length);
        test.eq("First person", result.contacts[0].name);
        test.eq("1", result.contacts[0].gender);
        test.eq("2000-02-02", result.contacts[0].wrd_dateofbirth);
        test.assert(!result.contacts[0].photo);
        test.eq("Another person", result.contacts[1].name);
        test.eq("2", result.contacts[1].gender);
        test.eq("2000-03-03", result.contacts[1].wrd_dateofbirth);
        test.assert(!result.contacts[1].photo);
        test.click("button[type=submit]");
      },
      waits: ["ui"]
    },
    {
      test: async function () {
        // Check the submission result
        let result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
        test.assert(result.ok);
        result = result.value;
        test.eq("no longer prefilled", result.text);
        test.eq(2, result.contacts.length);
        test.eq("First person", result.contacts[0].name);
        test.eq(1, result.contacts[0].gender);
        test.eq(/^2000-02-02/, result.contacts[0].wrd_dateofbirth);
        test.assert(!result.contacts[0].photo);
        test.eq("Another person", result.contacts[1].name);
        test.eq(2, result.contacts[1].gender);
        test.eq(/^2000-03-03/, result.contacts[1].wrd_dateofbirth);
        test.assert(!result.contacts[1].photo);
        test.click("button[type=submit]");
      }
    },

    "Test prefilled array value",
    {
      test: async function () {
        await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");

        // Check the prefilled value
        const formhandler = FormBase.getForNode(test.qR("form"))!;
        const result = await formhandler.getFormValue() as unknown as ArrayFormValue;
        test.eq("prefilled name", result.text);
        test.eq(1, result.contacts.length);
        test.eq("first contact", result.contacts[0].name);

        // a prefilled image field is not visible in getFormValue - why would we have to redownload already submitted file ?
        // test.assert(result.contacts[0].photo);
        // test.eq("imgeditfile.jpeg", result.contacts[0].photo.filename);

        // Add a row
        test.click("[data-wh-form-group-for=contacts] .wh-form__arrayadd");
        test.eq(2, test.qSA(".wh-form__arrayrow").length);

        // Fill the array's second row's fields and the not-array name field
        test.fill("input[name=text]", "no longer prefilled");
        const row = test.qSA(".wh-form__arrayrow")[1];
        test.fill(test.qS(row, "input[type=text]")!, "not prefilled");

        prepareUpload(["/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg"]);
        test.qR(row, ".wh-form__uploadfield button").click();
        await test.wait('ui');

        // Delete the first row
        test.click(test.qS(".wh-form__arraydelete")!);
        test.eq(1, test.qSA(".wh-form__arrayrow").length);

        test.click("button[type=submit]");
      },
      waits: ["ui"]
    },
    {
      test: async function () {
        // Check the submission result
        let result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
        test.assert(result.ok);
        result = result.value;
        test.eq("no longer prefilled", result.text);
        test.eq(1, result.contacts.length);
        test.eq("not prefilled", result.contacts[0].name);
        test.eq("portrait_8.jpg", result.contacts[0].photo.filename);
      }
    },

    "Test prefill #2 - keep untransmitted values",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=2");

      // Delete the middle row
      test.click(test.qSA(".wh-form__arrayrow")[1].querySelector(".wh-form__arraydelete")!);

      // Submit
      test.click("button[type=submit]");
      await test.wait("ui");

      const result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
      test.assert(result.ok);
      test.eq(42, result.value.contacts[0].myobject);
      test.eq(43, result.value.contacts[1].myobject);
    },

    "Test custom component inside arrays",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="customarray"] .wh-form__arrayadd');
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="customarray"] .wh-form__arrayadd');

      const arrayholder = test.qR('.wh-form__fieldgroup--array[data-wh-form-group-for="customarray"]');
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

      const result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
      test.assert(result.ok);

      test.eq("Name #1", result.value.customarray[0].name);
      test.assert(!result.value.customarray[0].customcomp.c1);
      test.assert(result.value.customarray[0].customcomp.c2);
      test.eq("Sub #1", result.value.customarray[0].customcomp.subvalue);
      // test.eq("lang-nl", result.value.customarray[0].twolevel.field1); //FIXME - support ANOTHER component sublevel in arrays...
      test.eq("TEXT 1", result.value.customarray[0].twolevel.field2);

      test.eq("Name #2", result.value.customarray[1].name);
      test.assert(result.value.customarray[1].customcomp.c1);
      test.assert(!result.value.customarray[1].customcomp.c2);
      test.eq("Sub #2", result.value.customarray[1].customcomp.subvalue);
      // test.eq("abc", result.value.customarray[1].twolevel.field1); //FIXME - support ANOTHER component sublevel in arrays...
      test.eq("TEXT 2", result.value.customarray[1].twolevel.field2);
    },

    "Test labels within array rows",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=2");

      // Find the 'Name' fieldgroup of the second row
      let fieldgroup = test.qR(test.qSA(".wh-form__arrayrow")[1], `[data-wh-form-group-for="contacts.name"]`);
      // Click the fieldgroup's label
      test.click(test.qR(fieldgroup, "label"));
      // The fieldgroup's input should have focus
      test.assert(test.hasFocus(test.qR(fieldgroup, "input")));

      // Find the 'Please confirm' fieldgroup of the second row
      fieldgroup = test.qR(test.qSA(".wh-form__arrayrow")[1], `[data-wh-form-group-for="contacts.confirm"]`);
      // The fieldgroup's checkbox should not be checked
      test.assert(!test.qR(fieldgroup, "input").checked);
      // Click the checkbox' label
      test.click(test.qR(fieldgroup, "label.wh-form__optionlabel"));
      // The fieldgroup's checkbox should now be checked
      test.assert(test.qR(fieldgroup, "input").checked);

      // Find the 'Favorite color' fieldgroup of the second row
      fieldgroup = test.qR(test.qSA(".wh-form__arrayrow")[1], `[data-wh-form-group-for="contacts.favcolor"]`);
      // None of the fieldgroup's radiobuttons should be checked
      test.assert(![...fieldgroup.querySelectorAll("input")].filter(_ => _.checked)[0]?.value);
      // Click the second radiobutton's label
      test.click(fieldgroup.querySelectorAll(".wh-form__fieldline")[1].querySelector("label.wh-form__optionlabel")!);
      // The second radiobutton should now be checked
      test.assert([...fieldgroup.querySelectorAll("input")].filter(_ => _.checked)[0]?.value === "yellow");
    },

    "Test adding subfields dynamically and using inter-subfield conditions",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&custom=1");

      // Add two rows
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="contacts"] .wh-form__arrayadd');
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="contacts"] .wh-form__arrayadd');

      // There should be a disabled 'color' subfield
      const color = test.qR('[name="contacts-contacts.color-0"]');
      test.assert(test.canClick(color));
      test.assert(color.disabled);

      // There should be an invisible 'other' subfield
      const other = test.qR('[name="contacts-contacts.other-0"]');
      test.assert(!test.canClick(other));
      test.assert(other.disabled);
      test.assert(!other.required);

      // Check the second row as well
      const color2 = test.qR('[name="contacts-contacts.color-1"]');
      test.assert(color2.disabled);
      const other2 = test.qR('[name="contacts-contacts.other-1"]');
      test.assert(!test.canClick(other2));

      // The 'color' subfield should be enabled if the a date more than 18 years ago is entered
      test.fill('[name="contacts-contacts.wrd_dateofbirth-0"]', "2000-01-01");
      await test.wait("ui");
      test.assert(!color.disabled);
      test.assert(!test.canClick(other));

      // The 'other' subfield is visible and required if the 'other' color and the 'Female' gender options are chosen
      test.fill(color, -1);
      await test.wait("ui");
      test.assert(!test.canClick(other));
      test.fill('[name="contacts-contacts.gender-0"]', 2);
      await test.wait("ui");
      test.assert(test.canClick(other));
      test.assert(!other.disabled);
      test.assert(other.required);

      // Fill the 'other' subfield and submit
      test.fill(other, "Yellow");
      test.click("button[type=submit]");
      await test.wait("ui");

      // The second row's 'color' and 'other' subfields should still be disabled
      test.assert(color2.disabled);
      test.assert(!test.canClick(other2));

      // Enable the second row's 'color' subfield
      test.fill('[name="contacts-contacts.wrd_dateofbirth-1"]', "2000-01-01");
      await test.wait("ui");
      test.assert(!color2.disabled);
      test.assert(!test.canClick(other2));

      // Disable it again
      test.fill('[name="contacts-contacts.wrd_dateofbirth-1"]', "2020-01-01");
      await test.wait("ui");
      test.assert(color2.disabled);
      test.assert(!test.canClick(other2));

      // The first row's 'color' and 'other' subfields should still be enabled
      test.assert(!color.disabled);
      test.assert(test.canClick(other));

      // Remove the second row
      test.click(test.qSA(".wh-form__arrayrow")[1].querySelector(".wh-form__arraydelete")!);

      // Check if the custom subfield values are returned
      const result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
      test.assert(result.ok);
      test.eq(/^2000-01-01/, result.value.contacts[0].wrd_dateofbirth);
      test.eq(-1, result.value.contacts[0].color);
      test.eq("Yellow", result.value.contacts[0].other);
    }
  ]);
