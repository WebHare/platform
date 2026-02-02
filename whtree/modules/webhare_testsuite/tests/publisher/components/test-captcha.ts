import * as test from '@mod-tollium/js/testframework';

//TODO test with google's recaptcha in testmode - but we need a cross iframe test.click for that

test.runTests(
  [
    "Test context based recaptcha",

    async function () {
      await test.load('/.webhare_testsuite/tests/pages/captcha?wh-debug=nsc');
      test.click('#trigger_webcontextcaptcha');
      await test.waitForUI();
      test.click('.wh-captcha__mock input[type="checkbox"]');
      await test.waitForUI();
      test.eq(0, test.qSA('.mydialog').length, 'dialog should be gone after clicking');
      test.click('#submit_webcontextcaptcha');
      await test.wait('pageload');
      test.eq('YES', test.qR('#webcontextcaptcha_accepted').textContent);
    }
  ]);
