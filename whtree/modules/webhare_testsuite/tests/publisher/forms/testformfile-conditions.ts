/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

let setupdata;

test.runTests(
  [
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addcheckboxfield: true, addconditions: true, checkboxes: true, addtwolevelfield: true, checkboxsubs: true, custommergefields: true });
    },

    'Test datetime condition',
    async function () {
      await test.load(setupdata.url);
      test.assert(!test.canClick("#webtoolform-not18"));

      const today = new Date;
      const date_tomorrow_18 = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() + 1); //JS just wraps and generally deals with it
      const date_tomorrow_18_iso = date_tomorrow_18.getFullYear() + '-' + ('0' + (date_tomorrow_18.getMonth() + 1)).slice(-2) + '-' + ('0' + date_tomorrow_18.getDate()).slice(-2);

      test.fill("#webtoolform-date", date_tomorrow_18_iso);
      test.focus("#webtoolform-textarea");
      test.assert(test.canClick("#webtoolform-not18"));

      const isLeapDay = today.getMonth() === 1 && today.getDate() === 29;
      const date_18 = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() - (isLeapDay ? 1 : 0));
      const date_18_iso = date_18.getFullYear() + '-' + ('0' + (date_18.getMonth() + 1)).slice(-2) + '-' + ('0' + date_18.getDate()).slice(-2);

      test.fill("#webtoolform-date", date_18_iso);
      test.focus("#webtoolform-textarea");
      test.assert(!test.canClick("#webtoolform-not18"));
    },

    'Test conditional',
    async function () {
      await test.load(setupdata.url);
      test.assert(test.qS('input[name="firstname"]').closest('.wh-form__fieldgroup').classList.contains('wh-form__fieldgroup--required'), "firstname should be required");

      const select_with_placeholder = test.qS('select[name="toggleselectoptions_withplaceholder"]');
      test.eq(0, select_with_placeholder.selectedIndex, "Placeholder should remain selected");
      test.eq("true", select_with_placeholder.options[0].getAttribute("data-placeholder"), "Placeholder option should be marked as such");

      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');
      test.assert(test.hasFocus(test.qS('input[name="firstname"]')), "firstname should be focused");

      test.click(test.qSA('[name=checkboxfield]')[0]);
      test.click(test.qSA('[type=submit]')[0]);
    },

    'Test hiding',
    async function () {
      await test.load(setupdata.url);
      test.assert(test.canClick(test.qS('input[name="firstname"]')), "firstname should be clickable");
      test.click(test.qSA('[name=hidefirstname]')[0]);
      test.assert(!test.canClick(test.qS('input[name="firstname"]')), "firstname should no longer be clickable");
      test.click(test.qSA('[name=hidefirstname]')[0]);
      test.assert(test.canClick(test.qS('input[name="firstname"]')), "firstname should be clickable again");
      test.click(test.qSA('[name=hidefirstname]')[0]);

      test.assert(test.qS('*[data-wh-form-group-for="two_level_field.customselect.select"]').classList.contains("wh-form__fieldgroup--hidden"), "custom select should be initially hidden");
      test.assert(test.qS('*[data-wh-form-group-for="two_level_field.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should be initially hidden");
      test.assert(test.qS('*[data-wh-form-group-for="twolevelcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field condition textedit should be initially hidden");
      test.assert(test.qS('*[data-wh-form-group-for="twolevelsubcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field subcondition textedit should be initially hidden");
      test.click('#webtoolform-showtwolevelcomp');
      test.assert(!test.qS('*[data-wh-form-group-for="two_level_field.customselect.select"]').classList.contains("wh-form__fieldgroup--hidden"), "custom select should now be visible");
      test.assert(test.qS('*[data-wh-form-group-for="two_level_field.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should still be hidden");
      test.assert(test.qS('*[data-wh-form-group-for="twolevelcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field condition textedit should still be hidden");
      test.assert(test.qS('*[data-wh-form-group-for="twolevelsubcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field subcondition textedit should still be hidden");
      test.fill('select[name="two_level_field.customselect.select"]', "abc");
      test.assert(!test.qS('*[data-wh-form-group-for="two_level_field.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should now be visible");
      test.assert(!test.qS('*[data-wh-form-group-for="twolevelcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field condition textedit should now be visible");
      test.assert(test.qS('*[data-wh-form-group-for="twolevelsubcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field subcondition textedit should still be hidden");
      test.fill('select[name="two_level_field.customselect.select"]', "lang-en");
      test.assert(!test.qS('*[data-wh-form-group-for="two_level_field.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should still be visible");
      test.assert(test.qS('*[data-wh-form-group-for="twolevelcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field condition textedit should now be hidden again");
      test.assert(!test.qS('*[data-wh-form-group-for="twolevelsubcondition"]').classList.contains("wh-form__fieldgroup--hidden"), "two_level_field subcondition textedit should now be visible");

      const toggleselectoptions = test.qS('select[name="toggleselectoptions"]');
      test.assert(!toggleselectoptions.querySelector('option[value="copt3"]').disabled, "ToggleSelectOpt3 should be available");
      dompack.changeValue(toggleselectoptions, "copt3");
      test.eq("copt3", toggleselectoptions.value, "ToggleSelectOpt3 should be selected");
      test.assert(test.canClick('input[name="checkboxes"][value="copt3"]'), "CheckBoxOpt3 should be clickable");
      test.click('input[name="checkboxes"][value="copt3"]');
      test.assert(test.canClick('input[name="coptsub3"]'), "CheckBoxOpt3 Subfield should be clickable");

      const select_with_placeholder = test.qS('select[name="toggleselectoptions_withplaceholder"]');
      test.assert(!select_with_placeholder.querySelector('option[value="copt3"]').disabled, "select_with_placeholder: ToggleSelectOpt3 should be available");
      dompack.changeValue(select_with_placeholder, "copt3");
      test.eq("copt3", select_with_placeholder.value, "select_with_placeholder: ToggleSelectOpt3 should be selected");

      test.click('input[name="togglesomeoptions"]');
      test.assert(toggleselectoptions.querySelector('option[value="copt3"]').disabled, "ToggleSelectOpt3 should no longer be available");
      test.assert(toggleselectoptions.value !== "copt3", "ToggleSelectOpt3 should no longer be selected");
      test.assert(!test.canClick('input[name="checkboxes"][value="copt3"]'), "CheckBoxOpt3 should no longer be clickable");
      test.eq(-1, toggleselectoptions.selectedIndex, "Pulldown should be unselected (selectedIndex -1)");

      test.assert(select_with_placeholder.querySelector('option[value="copt3"]').disabled, "select_with_placeholder: ToggleSelectOpt3 should no longer be available");
      test.assert(select_with_placeholder.value !== "copt3", "select_with_placeholder: ToggleSelectOpt3 should no longer be selected");
      test.eq(0, select_with_placeholder.selectedIndex, "select_with_placeholder: Pulldown should be back to placeholder (selectedIndex 0)");

      test.assert(!test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should not be hidden");
      const extraoptions = test.qS('select[name="extraoptions.select"]');
      dompack.changeValue(extraoptions, 2);
      test.assert(!test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should still not be hidden");
      dompack.changeValue(extraoptions, 3);
      test.assert(test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should be hidden now");
      dompack.changeValue(extraoptions, 1);
      test.assert(!test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should be visible again");

      test.fill(select_with_placeholder, "copt1");
      test.click(test.qSA('[type=submit]')[0]);

      // The thankyou node is only filled after submission, so check for the empty richtext node
      let thankyou = test.qSA('.wh-form__page[data-wh-form-pagerole="thankyou"] .wh-form__fieldgroup[data-wh-form-group-for="thankyou"] .wh-form__richtext');
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.eq("", thankyou[0].textContent, "Thankyou node should be empty");

      await test.wait('ui');

      // The thankyou node is now filled
      thankyou = test.qSA('h1').filter(node => node.textContent === "Thank you!");
      test.eq(1, thankyou.length, "Cannot find thankyou node");

      // test subfield merge fields
      const testemail_guid = test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', testemail_guid, { which: "form" });
      console.info(formresult);

      const emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000 });
      console.info(emails);
      test.eq(1, emails.length, "No emails!");
      test.eq("Two-level field mail", emails[0].subject);
      test.eq(/Subfield value: Subvalue #2/, emails[0].plaintext);
    },

    'Test disabling',
    async function () {
      await test.load(setupdata.url);
      test.assert(test.qS('input[name="conditionhas"]').disabled, "condition HAS should be disabled as the 'other' option isn't enabled");
      test.assert(test.qS('input[name="conditionis"]').disabled, "condition IS should be disabled as the 'other' option isn't enabled");

      test.click(test.qSA('[name=enablefirstname][value=otheroption]')[0]);
      test.assert(!test.qS('input[name="firstname"]').disabled, "clicking the 'other' option should have no effect on disabling firstname");
      test.assert(!test.qS('input[name="conditionhas"]').disabled, "condition HAS should now be enabled");
      test.assert(!test.qS('input[name="conditionis"]').disabled, "condition IS should now be enabled");

      test.click(test.qSA('[name=enablefirstname][value=thirdoption]')[0]);
      test.assert(!test.qS('input[name="firstname"]').disabled, "clicking the 'third' option should have no effect on disabling firstname");
      test.assert(!test.qS('input[name="conditionhas"]').disabled, "clicking the 'third' option should have no effect on disabling condition HAS");
      test.assert(test.qS('input[name="conditionis"]').disabled, "condition IS should now be disabled as the 'third' option is enabled");

      test.click(test.qSA('[name=enablefirstname][value=enablefirstname]')[0]);
      test.assert(test.qS('input[name="firstname"]').disabled, "firstname should be disabled");
      test.click(test.qSA('[type=submit]')[0]);

      // The thankyou node is only filled after submission, so check for the empty richtext node
      const thankyou = test.qSA('.wh-form__page[data-wh-form-pagerole="thankyou"] .wh-form__fieldgroup[data-wh-form-group-for="thankyou"] .wh-form__richtext');
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.eq("", thankyou[0].textContent, "Thankyou node should be empty");
    },

    'Test group dependencies',
    async function () {
      await test.load(setupdata.url);
      test.assert(!test.canClick(test.qS('input[name="phone"]')), "phone should not be visible");
      test.assert(!test.canClick(test.qS('input[name="mobile"]')), "mobile should not be visible");
      test.click(test.qS('[name=showcontact]'));
      test.assert(test.canClick(test.qS('input[name="phone"]')), "phone should now be visible");
      test.assert(!test.canClick(test.qS('input[name="mobile"]')), "mobile should still not be visible");
      test.click(test.qS('[name=showmobile]'));
      test.assert(test.canClick(test.qS('input[name="phone"]')), "phone should still be visible");
      test.assert(test.canClick(test.qS('input[name="mobile"]')), "mobile should now be visible");
    },

    'Test case sensitivity',
    async function () {
      test.assert(test.qS('input[name="sensitivetarget"]').disabled, "sensitivetarget should be disabled");
      test.assert(test.qS('input[name="insensitivetarget"]').disabled, "insensitivetarget should be disabled");
      test.fill(test.qS('input[name="sourcetext"]'), "test");
      test.assert(test.qS('input[name="sensitivetarget"]').disabled, "sensitivetarget should be disabled");
      test.assert(!test.qS('input[name="insensitivetarget"]').disabled, "insensitivetarget should be enabled");
      test.fill(test.qS('input[name="sourcetext"]'), "Test");
      test.assert(!test.qS('input[name="sensitivetarget"]').disabled, "sensitivetarget should be enabled");
      test.assert(!test.qS('input[name="insensitivetarget"]').disabled, "insensitivetarget should be enabled");
    },

    'Test composed required',
    async function () {
      test.assert(!test.qS('.wh-form__fieldgroup[data-wh-form-group-for="reversed.text"]').classList.contains('wh-form__fieldgroup--required'));
      test.click(test.qS('[name=requirereversed]'));
      test.assert(test.qS('.wh-form__fieldgroup[data-wh-form-group-for="reversed.text"]').classList.contains('wh-form__fieldgroup--required'), "reversed should be required");
    }
  ]);
