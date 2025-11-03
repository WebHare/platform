import * as test from '@mod-system/js/wh/testframework';

let setupdata;
const rand = Math.floor(100000000 * Math.random());
const testemail = rand + "-testformfile-online+jstest@beta.webhare.net";

test.runTests(
  [
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { filename: "formcaptcha" });

      await test.load(setupdata.url + '?skipcaptcha=1');

      test.click('.wh-form__button--submit');
      test.assert(!test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      await test.wait('ui');
      test.assert(test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "submit should have succeeded");

      await test.load(setupdata.url + '?wh-debug=nsc');

      //A server side error should not trigger a recatpcha (but it did errors coming from Submit handlers. Trigger one by messing with the name field
      test.fill(`[name=firstname]`, "reject");
      test.click('.wh-form__button--submit');
      await test.wait('ui');

      test.assert(!test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      test.eq(0, test.qSA('.mydialog').length);

      //trigger it!
      await test.load(setupdata.url + '?wh-debug=nsc');

      test.click('.wh-form__button--submit');
      test.assert(!test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      await test.wait('ui');
      test.assert(!test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "submit should have been blocked by captcha");
      test.assert(test.canClick('wh-captcha'));
      test.click('.wh-captcha__mock input[type="checkbox"]');

      test.click('.wh-form__button--submit');
      await test.waitUI();
      test.assert(test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "should see a thankyou!");
      test.assert(!test.canClick('wh-captcha')); //captcha should be gone
    },

    async function () {
      //Note using formcaptcha2 because we saw us racing and sometimes showing a recyclebin version of the previous file instead of the one we're creating
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { filename: "formcaptcha2", mailconfirmation: true });

      await test.load(setupdata.url + '?wh-debug=nsc');

      test.fill(test.qSA("input[type=email]")[0], testemail);

      test.click('.wh-form__button--submit');
      test.assert(!test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      await test.wait('ui');
      test.assert(!test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "submit should have been blocked by captcha");
      test.eq(1, test.qSA('wh-captcha').length);
      test.click('.wh-captcha__mock input[type="checkbox"]');
      test.click('.wh-form__button--submit');

      //ui waits don't really work here, so we'll wait for thankyou page to appear
      await test.wait(() => test.qR('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      test.assert(!test.qR('[data-wh-form-group-for="thankyou_unconfirmed"]').classList.contains('wh-form__fieldgroup--hidden'));
      test.assert(test.qR('[data-wh-form-group-for="thankyou_confirmed"]').classList.contains('wh-form__fieldgroup--hidden'));

      const testemail_guid = test.qR("form[data-wh-form-resultguid]").dataset.whFormResultguid;
      const formresult = await test.invoke("mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult", testemail_guid, { which: "captcha2", allowpending: true });
      test.assert(formresult.response);
      test.eq("new", formresult.submittype);
      test.eq("pending", formresult.status);
    },

    "Process confirmation mail and confirm result",
    async function () {
      const emails = await test.waitForEmails(testemail, { timeout: 60000 });
      test.eq(1, emails.length, "No emails!");
      test.eq("Confirm your email address", emails[0].subject);

      const confirmlink = emails[0].links.filter(_ => _.textContent === "click here").map(_ => _.href)[0];
      await test.load(confirmlink);

      test.assert(test.qR('[data-wh-form-group-for="thankyou_unconfirmed"]').classList.contains('wh-form__fieldgroup--hidden'));
      test.assert(!test.qR('[data-wh-form-group-for="thankyou_confirmed"]').classList.contains('wh-form__fieldgroup--hidden'));
    }

  ]);
