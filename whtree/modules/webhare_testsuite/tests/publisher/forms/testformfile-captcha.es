import test from '@mod-system/js/wh/testframework';

var setupdata;
let rand = Math.floor(100000000*Math.random());
let testemail = rand + "-testformfile-online+jstest@beta.webhare.net";
let confirmlink;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'BuildWebtoolForm', { filename: "formcaptcha" });

      await test.load(setupdata.url + '?skipcaptcha=1');

      test.click('.wh-form__button--submit');
      test.false(test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      await test.wait('ui');
      test.true(test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "submit should have succeeded");

      await test.load(setupdata.url + '?wh-debug=nsc');

      test.click('.wh-form__button--submit');
      test.false(test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      await test.wait('ui');
      test.false(test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "submit should have been blocked by captcha");
      test.eq(1, test.qSA('.mydialog').length);
      test.click('.wh-captcha__mock input[type="checkbox"]');

      //ui waits don't really work here, so we'll wait for thankyou page to appear
      await test.wait(() => test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
    }

  , async function()
    {
      //Note using formcaptcha2 because we saw us racing and sometimes showing a recyclebin version of the previous file instead of the one we're creating
      setupdata = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'BuildWebtoolForm', { filename: "formcaptcha2", mailconfirmation: true });

      await test.load(setupdata.url + '?wh-debug=nsc');

      test.fill(test.qSA("input[type=email]")[0], testemail);

      test.click('.wh-form__button--submit');
      test.false(test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      await test.wait('ui');
      test.false(test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'), "submit should have been blocked by captcha");
      test.eq(1, test.qSA('.mydialog').length);
      test.click('.wh-captcha__mock input[type="checkbox"]');

      //ui waits don't really work here, so we'll wait for thankyou page to appear
      await test.wait(() => test.qS('[data-wh-form-pagerole=thankyou]').classList.contains('wh-form__page--visible'));
      test.false(test.qS('[data-wh-form-group-for="thankyou_unconfirmed"]').classList.contains('wh-form__fieldgroup--hidden'));
      test.true(test.qS('[data-wh-form-group-for="thankyou_confirmed"]').classList.contains('wh-form__fieldgroup--hidden'));

      let testemail_guid = test.qS("form[data-wh-form-resultguid]").dataset.whFormResultguid;
      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"captcha2", allowpending: true });
      test.true(formresult.response);
      test.eq("new", formresult.submittype);
      test.eq("pending", formresult.status);
    }

  , "Process confirmation mail"
  , { email: testemail
    , emailtimeout: 6000
    , emailhandler: function(emails)
      {
        test.eq(1, emails.length, "No emails!");
        test.eq("Confirm your email address", emails[0].subject);

        confirmlink = emails[0].links.filter(_ => _.textcontent = "click here").map(_ => _.href)[0];
      }
    }

  , "Confirm result"
  , async function()
    {
      await test.load(confirmlink);

      test.true(test.qS('[data-wh-form-group-for="thankyou_unconfirmed"]').classList.contains('wh-form__fieldgroup--hidden'));
      test.false(test.qS('[data-wh-form-group-for="thankyou_confirmed"]').classList.contains('wh-form__fieldgroup--hidden'));
    }

  ]);
