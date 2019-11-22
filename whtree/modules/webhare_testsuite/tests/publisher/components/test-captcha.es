import * as test from '@mod-tollium/js/testframework';

//TODO test with google's recaptcha in testmode - but we need a cross iframe test.click for that

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/captcha?wh-debug=nsc'
    }

  , "Test google specific recaptcha"

  , async function()
    {
      test.click('#trigger_googlerecaptcha');
      await test.wait('ui');
      test.eq(1, test.qSA('.mydialog').length);
      test.click('.wh-captcha__mock input[type="checkbox"]');
      await test.wait('ui');
      test.eq(0, test.qSA('.mydialog').length, 'dialog should be gone after clicking');
      test.click('#submit_googlerecaptcha');
      await test.wait('pageload');
      test.eq('YES', test.qS('#googlerecaptcha_accepted').textContent);
    }

  , "Test context api"

  , async function()
    {
      test.click('#trigger_webcontextcaptcha');
      await test.wait('ui');
      test.eq(1, test.qSA('.mydialog').length);
      test.click('.wh-captcha__mock input[type="checkbox"]');
      await test.wait('ui');
      test.eq(0, test.qSA('.mydialog').length, 'dialog should be gone after clicking');
      test.click('#submit_webcontextcaptcha');
      await test.wait('pageload');
      test.eq('YES', test.qS('#webcontextcaptcha_accepted').textContent);
    }
  ]);
