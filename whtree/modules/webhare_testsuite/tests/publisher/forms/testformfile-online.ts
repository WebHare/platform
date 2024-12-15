import * as test from '@webhare/test-frontend';
import { getPxlLog } from '@mod-system/js/wh/testframework';

const testemail = Math.floor(100000000 * Math.random()) + '-testformfile-online+jstest@beta.webhare.net';
let setupdata: any;

test.run(
  [
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addpulldown: true, addgtmdatalayer: "muhdata" });
    },

    'Verify initial form',
    async function () {
      await test.load(setupdata.url, { urlParams: { gtmFormEvents: "publisher:form" } });

      // The thankyou node is only filled after submission, so check for the empty richtext node
      const thankyou = test.qSA('.wh-form__page[data-wh-form-pagerole="thankyou"] .wh-form__fieldgroup[data-wh-form-group-for="thankyou"] .wh-form__richtext');
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.eq("", thankyou[0].textContent, "Thankyou node should be empty");
      test.assert(!test.canClick(thankyou[0]), "Thankyou node should not be visible");
      test.assert(!thankyou[0].closest('form')!.dataset.whFormResultguid);

      let pulldownoptions = test.qSA('[name=requiredpulldownfield] option');
      test.eq(3, pulldownoptions.length);
      test.assert(pulldownoptions[0].disabled);

      test.qR('[name=requiredpulldownfield]').value = pulldownoptions[1].value;

      pulldownoptions = test.qSA('[name=optionalpulldownfield] option');
      test.eq(3, pulldownoptions.length);
      test.assert(!pulldownoptions[0].disabled);

      const email = test.qR('input[type=email]').closest('.wh-form__fieldgroup')!.querySelector('.wh-form__label')!;
      test.eq("Email", email.textContent);
    },

    'Submit a form',
    async function () {
      test.fill(test.qSA('input[type=text]')[0], 'Joe');
      test.fill(test.qSA('input[type=email]')[0], testemail);

      test.eq(0, Array.from(test.getWin().dataLayer).filter(_ => _.event === "platform:form_submitted").length);

      test.click(test.qSA('[type=submit]')[0]);
      test.qSA('[type=submit]')[0].click(); //attempt double submission. click() avoids modality layers
      await test.waitForUI();

      const events = getPxlLog(/^platform:form_submitted/);
      test.eq(1, events.length, "Should be one submission");
      test.eq("webtoolform", events[0].data.ds_formmeta_id, "by default we'll just see the 'webtoolform' name");

      // The thankyou node is now filled
      const thankyou = test.qSA('h1').filter(node => node.textContent === "Thank you!");
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.assert(test.canClick(thankyou[0]), "Thankyou node should NOW be visible");
      test.assert(!test.canClick(test.qSA('[type=submit]')[0]), "Submit button should not be available on the thankyou page");

      test.assert(thankyou[0].closest('form')!.dataset.whFormResultguid);

      // Expecting classic event names on the datalayer as that's how the test was configured
      await test.wait(() => Array.from(test.getWin().dataLayer).filter(_ => _.event === "publisher:formsubmitted").length === 1);
      const lastsubmitevent = Array.from(test.getWin().dataLayer).filter(_ => _.event === "publisher:formsubmitted").at(-1);
      test.assert(lastsubmitevent);
      test.eq("muhdata", lastsubmitevent.form);

      const emailfieldname = test.qR(`[type=email]`).name;
      test.eqPartial({
        form: "muhdata",
        form_firstname: "Joe",
        form_optionalpulldownfield: "",
        form_optionalpulldownfield_label: "Make your choice",
        form_requiredpulldownfield: "yes",
        form_requiredpulldownfield_label: "Yes !!!!",
        formmeta_pagenum: 1,
        [`form_${emailfieldname}`]: testemail
      }, test.getCurrentDataLayer());
    },

    'Process mail',
    async function () {
      const emails = await test.waitForEmails("mailresult+jstest@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, "No emails!");
      test.eq("Your Form Was Filled", emails[0].subject);
    },

    'Request results',
    async function () {
      const getguid = test.qR('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', getguid);
      test.eq('tollium:tilde.firstname', formresult.fields[0].title); //':' as its not a tid but just a plain untranslated field
      test.eq(':Email', formresult.fields[1].title); //':' as its not a tid but just a plain untranslated field
      test.eq('FIRSTNAME', formresult.fields[0].name); //':' as its not a tid but just a plain untranslated field

      test.eq(getguid, formresult.guid);
      test.eq('Joe', formresult.response.firstname);
      test.eq(testemail, formresult.response[formresult.fields[1].name.toLowerCase()]);
      test.eq(1, formresult.numresults, "Shouldn't have double submitted!");

      //FIXME test with a 'tagged' field (should have a predictable name instead of accesing through formresult.fields[0].name)
    },

    'Submitform api',
    async function () {
      const target = test.getDoc().documentElement.dataset.rpcformtarget!;
      let result = await test.getWin().formrpc_submitForm(target, {});
      test.eqPartial([{ message: "This value is required.", name: "requiredpulldownfield" }], result.errors);
      test.eq(false, result.success);

      result = await test.getWin().formrpc_submitForm(target, { requiredpulldownfield: "yes", nosuchfield: 42 });
      test.eq(true, result.success);
      test.eq([], result.errors);
      test.assert(result.result.resultsguid!.length > 10);
    }
  ]);
