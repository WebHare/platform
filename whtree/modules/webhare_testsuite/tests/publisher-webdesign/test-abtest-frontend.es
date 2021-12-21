import * as test from '@mod-tollium/js/testframework';

let testinfo;
let testemail = Math.floor(100000000*Math.random()) + '-testformfile-online+jstest@beta.webhare.net';

test.registerTests(
  [ async function()
    {
      testinfo = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupABTest');
      await test.load(testinfo.abtestlink);

      test.eq("myabtest", test.getDoc().documentElement.dataset.experimentId);
      test.eq("B", test.getDoc().documentElement.dataset.experimentVariant);
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

      test.true(thankyou[0].closest('form').dataset.whFormResultguid);
    }

  , 'Process mail'
  , async function()
    {
      const emails = await test.waitForEmails("mailresult+jstest@beta.webhare.net", { timeout: 60000 });
      test.eq(1,emails.length,"No emails!");
      test.eq("Your Form Was Filled", emails[0].subject);
    }
  ]);
