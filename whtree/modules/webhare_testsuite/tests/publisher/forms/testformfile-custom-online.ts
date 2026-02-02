/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import { getPxlLogLines } from '@webhare/test-frontend';
import * as test from '@mod-system/js/wh/testframework';

let setupdata;
const rand = Math.floor(100000000 * Math.random());
const testemail = rand + '-testformfile-online+jstest@beta.webhare.net';
const testemail2 = rand + '-testformfile2-online+jstest@beta.webhare.net';
let editlink;
let testemail_guid;

test.runTests(
  [
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { which: "custom2", addtscustomcomp: true, formid: "custom form 2" });
    },

    async function () {
      await test.load(setupdata.url + "?error=formunavailable");

      const content = test.qS('#content');
      test.eq("The form is currently unavailable", content.textContent.trim(), "Cannot find default form unavailable text");
    },

    async function () {
      await test.load(setupdata.url);

      test.assert(test.canClick('[data-wh-form-group-for="greeting_new"]'), "Should see 'new' text");
      test.assert(!test.canClick('[data-wh-form-group-for="greeting_change"]'), "Should not see 'change' text");
      test.assert(!test.canClick('[data-wh-form-group-for="greeting_cancel"]'), "Should not see 'cancel' text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");


      test.eq(1, test.qSA('[name="tscustom.sub"]').length, "There should be just one tscustom.sub!");
      test.fill(test.qSA('input[type=text]')[0], 'Joe');
      test.fill(test.qSA('input[type=email]')[0], testemail);
      test.fill(test.qS('[name="tscustom.sub"]'), 'filledsub');
      test.fill(test.qS('[name="textarea"]'), 'TextAreaVulling');
      test.click(test.qSA('[type=submit]')[0]);
      await test.waitForUI();

      test.assert(test.hasFocus(test.qS('#webtoolform-tscustom-1')), "custom field's first element should be focused");
      test.eq("Kies de 2e optie. Sub: filledsub", test.qS('[data-wh-form-group-for="tscustom"] .wh-form__error').textContent);
      test.click(test.qS('#webtoolform-tscustom-2'));
      test.click(test.qSA('[type=submit]')[0]);
      await test.waitForUI();

      const events = (await getPxlLogLines()).filter(l => l.event === "platform:form_submitted");
      test.eq(1, events.length, "Should be one submission");
      test.eq("custom form 2", events[0].mod_platform.formmeta_id, "by default we'll just see the 'webtoolform' name");
    },

    'Request results',
    async function () {
      test.assert(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should see thankyou");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");

      // Check if the first name is merged into the thankyou text
      test.eq(/Joe/, test.qS('[data-wh-form-group-for="thankyou"]').textContent);

      testemail_guid = test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', testemail_guid, { which: "custom2" });
      test.eq('tollium:tilde.firstname', formresult.fields[0].title);
      test.eq(':Email', formresult.fields[1].title); //':' as its not a tid but just a plain untranslated field
      test.eq('FIRSTNAME', formresult.fields[0].name);

      test.eq(testemail_guid, formresult.guid);
      test.eq('Joe', formresult.response.firstname);
      test.eq("TextAreaVulling", formresult.response.textarea);
      test.eq(testemail, formresult.response[formresult.fields[1].name.toLowerCase()]);
      test.eq(testemail, formresult.idfield);
      test.eq(6, formresult.pagedata.electric);
      test.eq("something", formresult.pagedata.ihavegot);
      test.eq(1, formresult.numresults);
      test.eq({ c1: false, c2: true, subvalue: "filledsub" }, formresult.response.tscustom);

      editlink = formresult.editlink;
    },

    'Process mail',
    async function () {
      const emails = await test.waitForEmails("mailresult+jstest@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, "No emails!");
      test.eq("Your Form Was Filled", emails[0].subject);
    },

    'Test results prefill and edit',
    async function () {
      await test.load(editlink);

      const namefield = test.qSA('input[type=text]')[0], emailfield = test.qSA('input[type=email]')[0];
      test.assert(test.canClick('[data-wh-form-group-for="greeting_change"]'), "Should see 'change' text");
      test.assert(!test.canClick('[data-wh-form-group-for="greeting_new"]'), "Should not see 'new' text");
      test.assert(!test.canClick('[data-wh-form-group-for="greeting_cancel"]'), "Should not see 'cancel' text");

      test.eq('Joe', namefield.value);
      test.eq(testemail, emailfield.value);
      test.assert(!test.qS('[name="tscustom"][value="val1"]').checked);
      test.assert(test.qS('[name="tscustom"][value="val2"]').checked);
      test.eq('filledsub', test.qS('[name="tscustom.sub"]').value);
      test.eq('TextAreaVulling', test.qS('[name="textarea"]').value);

      namefield.value = 'Jim';

      test.assert(emailfield.disabled, 'email field should be disabled');
      //but we'll hack our way around it!
      emailfield.value = testemail2; //should be ignored by the form itself

      test.click(test.qSA('[type=submit]')[0]);
      await test.waitForUI();

      test.eq(testemail_guid, test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid);
      const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', testemail_guid, { which: "custom2" });
      test.eq(1, formresult.numresults);
      test.eq('Jim', formresult.response.firstname);
      test.eq(testemail, formresult.response[formresult.fields[1].name.toLowerCase()]);
      test.eq(testemail, formresult.idfield);
    },

    'Test editing through id field',
    async function () {
      await test.load(setupdata.url);

      const namefield = test.qSA('input[type=text]')[0], emailfield = test.qSA('input[type=email]')[0];
      namefield.value = "Timmy";
      emailfield.value = testemail;

      test.click(test.qS('#webtoolform-tscustom-2'));
      test.click(test.qSA('[type=submit]')[0]);
      await test.waitForUI();

      test.eq(testemail_guid, test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid);

      const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', testemail_guid, { which: "custom2" });
      test.eq(1, formresult.numresults);
    },

    'Process mail',
    async function () {
      const emails = await test.waitForEmails("mailresult+jstest@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      test.eq("Your Form Was Filled", emails[0].subject, "Should be two mails, both for the NEW and for the EDIT action");
    },

    'Test cancellation',
    async function () {
      await test.load(editlink + "?cancel=1");

      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should  see thankyou_cancelled text");
    }
  ]);
