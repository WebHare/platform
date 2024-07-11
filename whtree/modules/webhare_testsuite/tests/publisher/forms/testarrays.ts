import * as test from "@mod-system/js/wh/testframework";
import FormBase from "@mod-publisher/js/forms/formbase";
import { prepareUpload } from '@webhare/test-frontend';

interface ArrayFormValue {
  text: string;
  contacts: Array<{
    name: string;
    photo?: { name: string };
    upload?: { name: string };
    gender: string;
    wrd_dateofbirth: string;
  }>;
}

interface ArrayFormShape {
  text: string;
  contacts: Array<{
    name: string;
    photo?: { name: string };
    upload?: { name: string };
    gender: string;
    wrdDateofbirth: string;
    confirm: boolean;
    favcolor: null | string;
  }>;
  contacts2: Array<{
    name: string;
    customcomp: unknown;
  }>;
  customArray: Array<{
    name: string;
    customcomp: unknown;
    twoLevelInArray: {
      customselect: string;
      textedit: string;
    };
  }>;
}

test.registerTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1");

      // Check the form handler
      const formhandler = FormBase.getForNode<ArrayFormShape>(test.qR("form"))!;
      test.assert(formhandler, "no formhandler available");

      // Check the empty value
      let result = await formhandler.getFormValue() as unknown as ArrayFormValue;
      test.eq("", result.text);
      test.eq(0, result.contacts.length);
      test.eq({ text: "", contacts: [], contacts2: [], customArray: [] }, formhandler.data);

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
      test.qR(row, ".wh-form__imgedit").click();
      await test.wait('ui');

      prepareUpload(["/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg"]);
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
      test.assert(result.contacts[1].upload);
      test.eq("landscape_4.jpg", result.contacts[1].upload.name);

      test.eqPartial({
        text: "still not array",
        contacts: [
          {
            name: "array name",
            photo: undefined
          }, {
            name: "another name",
          }
        ]
      }, formhandler.data);
      test.eq("portrait_8.jpg", formhandler.data.contacts[1].photo?.name);
      test.eq("landscape_4.jpg", formhandler.data.contacts[1].upload?.name);

      //@ts-expect-error TS knows there is no 'noSuchField'
      test.eq(undefined, result.contacts[0].noSuchField);

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
        const formhandler = FormBase.getForNode<ArrayFormShape>(test.qR("form"))!;
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
        const formhandler = FormBase.getForNode<ArrayFormShape>(test.qR("form"))!;
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

        //REDO the settings above but now through a nicer Form api

        test.click("button[type=submit]");

      },
      waits: ["ui"]
    },
    "Test setting value client-side - NEW API",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");

      // Check the prefilled value through the new fields api
      const formhandler = FormBase.getForNode<ArrayFormShape>(test.qR("form"))!;
      test.eqPartial({
        text: "prefilled name",
        contacts: [
          {
            name: "first contact",
          }
        ]
      }, formhandler.data);

      test.assert(!("photo" in formhandler.data.contacts[0]), "The photo property should *not be there* as we don't have enough information from the server to be able to safely re-setValue it!");

      // a prefilled image field is not visible in getFormValue - why would we have to redownload already submitted file ?
      // test.assert(result.contacts[0].photo);
      // test.eq("imgeditfile.jpeg", result.contacts[0].photo.filename);

      // Clear the array by setting the value to an empty array
      formhandler.data.contacts = [];
      test.eq(0, test.qSA(".wh-form__arrayrow").length);

      test.fill("input[name=text]", "no longer prefilled");

      test.eq("no longer prefilled", formhandler.data.text);
      test.eq(0, formhandler.data.contacts.length);

      // Set the value to an empty row
      formhandler.assign({ contacts: [{}] });
      test.eq(1, test.qSA(".wh-form__arrayrow").length);

      test.eq("no longer prefilled", formhandler.data.text);
      test.eq(1, formhandler.data.contacts.length);
      test.eq("", formhandler.data.contacts[0].name);
      test.eq("0", formhandler.data.contacts[0].gender);
      test.eq("", formhandler.data.contacts[0].wrdDateofbirth);
      test.assert(!formhandler.data.contacts[0].photo);

      // Set the value to two rows with values
      formhandler.assign({ contacts: [{ name: "First person", gender: "1", wrdDateofbirth: "2000-02-02" }, { name: "Another person", gender: "2", wrdDateofbirth: "2000-03-03" }] });
      test.eq(2, test.qSA(".wh-form__arrayrow").length);

      test.eq("no longer prefilled", formhandler.data.text);
      test.eq(2, formhandler.data.contacts.length);
      test.eq("First person", formhandler.data.contacts[0].name);
      test.eq("1", formhandler.data.contacts[0].gender);
      test.eq("2000-02-02", formhandler.data.contacts[0].wrdDateofbirth);
      test.assert(!formhandler.data.contacts[0].photo);
      test.eq("Another person", formhandler.data.contacts[1].name);
      test.eq("2", formhandler.data.contacts[1].gender);
      test.eq("2000-03-03", formhandler.data.contacts[1].wrdDateofbirth);
      test.assert(!formhandler.data.contacts[1].photo);

      //Set a photo - first by updating the property fully because not all Proxies are in place yet.
      formhandler.data.contacts = [
        formhandler.data.contacts[0],
        {
          ...formhandler.data.contacts[1], upload: new File(["het is een test #1"], "test1.txt")
        }
      ];
      test.eq("test1.txt", formhandler.data.contacts[1].upload?.name);

      //TODO properly update only the rows/values we're setting (ie Better Proxies) rather than rewriting all
      /*
      formhandler.data.contacts[1].upload = new File(["het is een test #2"], "test2.txt");
      test.eq("test2.txt", formhandler.data.contacts[1].file?.name);
*/

      test.click("button[type=submit]");
      await test.wait("ui");
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
        test.eqPartial({ filename: "test1.txt", "data": btoa("het is een test #1") }, result.contacts[1].upload);
        test.click("button[type=submit]");
      }
    },

    "Test prefilled array value",
    {
      test: async function () {
        await test.load(test.getTestSiteRoot() + "testpages/formtest/?array=1&prefill=1");

        // Check the prefilled value
        const formhandler = FormBase.getForNode<ArrayFormShape>(test.qR("form"))!;
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
        test.eq("portrait_8.jpg", result.contacts[0].upload.filename);
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
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="custom_array"] .wh-form__arrayadd');
      test.click('.wh-form__fieldgroup--array[data-wh-form-group-for="custom_array"] .wh-form__arrayadd');

      const arrayholder = test.qR('.wh-form__fieldgroup--array[data-wh-form-group-for="custom_array"]');
      test.eq(2, arrayholder.querySelectorAll(".wh-form__arrayrow").length);

      //TODO not sure if we should be hardcoding names like this... works for now but I'm not sure this is something we are suppposed to rely on
      test.fill('[name="custom_array.0.name"]', 'Name #1');
      test.fill('[name="custom_array.0.customcomp"][value="val2"]', true);
      test.fill('[name="custom_array.0.customcomp.sub"]', 'Sub #1');

      test.fill('[name="custom_array.0.two_level_in_array.customselect.select"]', 'lang-nl');
      test.fill('[name="custom_array.0.two_level_in_array.textedit"]', 'TEXT 1');

      test.fill('[name="custom_array.1.name"]', 'Name #2');
      test.fill('[name="custom_array.1.customcomp"][value="val1"]', true);
      test.fill('[name="custom_array.1.customcomp.sub"]', 'Sub #2');

      test.fill('[name="custom_array.1.two_level_in_array.customselect.select"]', 'abc');
      test.fill('[name="custom_array.1.two_level_in_array.textedit"]', 'TEXT 2');

      const formhandler = FormBase.getForNode<ArrayFormShape>(test.qR("form"))!;
      test.eq({
        "text": "prefilled name",
        "contacts": [
          {
            "name": "first contact",
            "gender": "0",
            "wrdDateofbirth": "",
            "confirm": false,
            "favcolor": null
          }
        ],
        "contacts2": [],
        "customArray": [
          {
            "name": "Name #1",
            "customcomp": {
              "sub": "Sub #1"
            },
            "twoLevelInArray": {
              "customselect": "lang-nl",
              "textedit": "TEXT 1"
            }
          },
          {
            "name": "Name #2",
            "customcomp": {
              "sub": "Sub #2"
            },
            "twoLevelInArray": {
              "customselect": "abc",
              "textedit": "TEXT 2"
            }
          }
        ]
      }, formhandler.data);

      // Submit
      test.click("button[type=submit]");
      await test.wait("ui");

      const result = JSON.parse(test.qR("#dynamicformsubmitresponse").textContent!);
      test.assert(result.ok);

      test.eq("Name #1", result.value.custom_array[0].name);
      test.assert(!result.value.custom_array[0].customcomp.c1);
      test.assert(result.value.custom_array[0].customcomp.c2);
      test.eq("Sub #1", result.value.custom_array[0].customcomp.subvalue);
      // test.eq("lang-nl", result.value.custom_array[0].two_level_in_array.field1); //FIXME - support ANOTHER component sublevel in arrays...
      test.eq("TEXT 1", result.value.custom_array[0].two_level_in_array.field2);

      test.eq("Name #2", result.value.custom_array[1].name);
      test.assert(result.value.custom_array[1].customcomp.c1);
      test.assert(!result.value.custom_array[1].customcomp.c2);
      test.eq("Sub #2", result.value.custom_array[1].customcomp.subvalue);
      // test.eq("abc", result.value.custom_array[1].two_level_in_array.field1); //FIXME - support ANOTHER component sublevel in arrays...
      test.eq("TEXT 2", result.value.custom_array[1].two_level_in_array.field2);
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
      await test.sleep(1); //condition refreshing is currently async TODO can we go back to sync?

      // There should be a disabled 'color' subfield
      const color = test.qR('[name="contacts.0.color"]');
      test.assert(test.canClick(color));
      console.log(color, color.disabled);
      test.assert(color.disabled);

      // There should be an invisible 'other' subfield
      const other = test.qR('[name="contacts.0.other"]');
      test.assert(!test.canClick(other));
      test.assert(other.disabled);
      test.assert(!other.required);

      // Check the second row as well
      const color2 = test.qR('[name="contacts.1.color"]');
      test.assert(color2.disabled);
      const other2 = test.qR('[name="contacts.1.other"]');
      test.assert(!test.canClick(other2));

      // The 'color' subfield should be enabled if the a date more than 18 years ago is entered
      test.fill('[name="contacts.0.wrd_dateofbirth"]', "2000-01-01");
      await test.wait("ui");
      test.assert(!color.disabled);
      test.assert(!test.canClick(other));

      // The 'other' subfield is visible and required if the 'other' color and the 'Female' gender options are chosen
      test.fill(color, -1);
      await test.wait("ui");
      test.assert(!test.canClick(other));
      test.fill('[name="contacts.0.gender"]', 2);
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
      test.fill('[name="contacts.1.wrd_dateofbirth"]', "2000-01-01");
      await test.wait("ui");
      test.assert(!color2.disabled);
      test.assert(!test.canClick(other2));

      // Disable it again
      test.fill('[name="contacts.1.wrd_dateofbirth"]', "2020-01-01");
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
