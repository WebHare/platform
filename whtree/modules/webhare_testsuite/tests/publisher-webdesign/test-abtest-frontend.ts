/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';

let testinfo;
const testemail = Math.floor(100000000 * Math.random()) + '-testformfile-online+jstest@beta.webhare.net';

test.registerTests(
  [
    async function () {
      testinfo = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupABTest');
      await test.load(testinfo.abtestlink + "?appending");

      test.eq("myabtest", test.getDoc().documentElement.dataset.experimentId);
      test.eq("B", test.getDoc().documentElement.dataset.experimentVariant);

      const dynamicpageparameters = JSON.parse(test.qS("#content").dataset.dynamicpageparameters);
      test.eq(testinfo.abtestlink, dynamicpageparameters.absolutebaseurl);
      test.eq("", dynamicpageparameters.subpath);
      test.eq("?appending", dynamicpageparameters.append);
    },

    'Submit a form',
    async function () {
      test.fill(test.qSA('input[type=text]')[0], 'Joe');
      test.fill(test.qSA('input[type=email]')[0], testemail);
      test.click(test.qSA('[type=submit]')[0]);
      test.qSA('[type=submit]')[0].click(); //attempt double submission. click() avoids modality layers
      await test.wait('ui');

      // The thankyou node is now filled
      const thankyou = test.qSA('h1').filter(node => node.textContent === "Thank you!");
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.assert(test.canClick(thankyou[0]), "Thankyou node should NOW be visible");
      test.assert(!test.canClick(test.qSA('[type=submit]')[0]), "Submit button should not be available on the thankyou page");

      test.assert(thankyou[0].closest('form').dataset.whFormResultguid);
    },

    'Process mail',
    async function () {
      const emails = await test.waitForEmails("mailresult+jstest@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, "No emails!");
      test.eq("Your Form Was Filled", emails[0].subject);
    }
  ]);
