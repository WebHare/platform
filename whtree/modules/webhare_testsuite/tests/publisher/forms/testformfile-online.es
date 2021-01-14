import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

let testemail = Math.floor(100000000*Math.random()) + '-testformfile-online+jstest@beta.webhare.net';
var setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addpulldown: true});
    }

  , 'Verify initial form'
  , async function()
    {
      await test.load(setupdata.url);

      // The thankyou node is only filled after submission, so check for the empty richtext node
      let thankyou = test.qSA('.wh-form__page[data-wh-form-pagerole="thankyou"] .wh-form__fieldgroup[data-wh-form-group-for="thankyou"] .wh-form__richtext');
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.eq("", thankyou[0].textContent, "Thankyou node should be empty");
      test.false(test.canClick(thankyou[0]), "Thankyou node should not be visible");
      test.false(dompack.closest(thankyou[0],'form').dataset.whFormResultguid);

      let pulldownoptions = test.qSA('[name=requiredpulldownfield] option');
      test.eq(3, pulldownoptions.length);
      test.true(pulldownoptions[0].disabled);

      test.qS('[name=requiredpulldownfield]').value = pulldownoptions[1].value;

      pulldownoptions = test.qSA('[name=optionalpulldownfield] option');
      test.eq(3, pulldownoptions.length);
      test.false(pulldownoptions[0].disabled);


      let email = dompack.closest(test.qS('input[type=email]'), '.wh-form__fieldgroup').querySelector('.wh-form__label');
      test.eq("Email", email.textContent);
    }

  , 'Submit a form'
  , async function()
    {
      test.fill(test.qSA('input[type=text]')[0], 'Joe');
      test.fill(test.qSA('input[type=email]')[0], testemail);
      test.click(test.qSA('[type=submit]')[0]);
      test.qSA('[type=submit]')[0].click(); //attempt double submission. click() avoids modality layers
      await test.wait('ui');

      // The thankyou node is now filled
      let thankyou = test.qSA('h1').filter(node => node.textContent=="Thank you!");
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.true(test.canClick(thankyou[0]), "Thankyou node should NOW be visible");
      test.false(test.canClick(test.qSA('[type=submit]')[0]), "Submit button should not be available on the thankyou page");

      test.true(dompack.closest(thankyou[0],'form').dataset.whFormResultguid);
    }

  , 'Process mail'
  , async function()
    {
      const emails = await test.waitForEmails("mailresult+jstest@beta.webhare.net", { timeout: 60000 });
      test.eq(1,emails.length,"No emails!");
      test.eq("Your Form Was Filled", emails[0].subject);
    }

  , 'Request results'
  , async function()
    {
      let getguid = test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      let formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', getguid);
      test.eq('tollium:tilde.firstname', formresult.fields[0].title); //':' as its not a tid but just a plain untranslated field
      test.eq(':Email', formresult.fields[1].title); //':' as its not a tid but just a plain untranslated field
      test.eq('FIRSTNAME', formresult.fields[0].name); //':' as its not a tid but just a plain untranslated field

      test.eq(getguid, formresult.guid);
      test.eq('Joe', formresult.response.firstname);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
      test.eq(1, formresult.numresults, "Shouldn't have double submitted!");

      //FIXME test with a 'tagged' field (should have a predictable name instead of accesing through formresult.fields[0].name)
    }
  ]);
