import * as test from '@mod-system/js/wh/testframework';

const replacedcomponents = test.getTestArgument(0)=='replacedcomponents';
const urlappend = replacedcomponents ? '?dompackpulldown=1' : '';

test.registerTests(
  [ async function()
    {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/' + urlappend);
      test.qS('#coretest-radiotestnamelijk').value=''; //empty it for Required testing

      let field_namelijk = test.qSA("input[name=radiotestnamelijk]");
      test.eq('coretest-radiotestnamelijk', field_namelijk[0].id);
      test.true(field_namelijk[0].disabled, 'coretest-radiotestnamelijk should be initially disabled');

      test.fill(test.qS('#coretest-email'),'testconditionalfields@beta.webhare.net');
      test.fill(test.qS('#coretest-setvalidator'),'test');
      test.click(test.qS('#coretest-requiredradio-x'));
      test.fill(test.qS('#coretest-pulldowntest'),'2');
      test.click(test.qS('#coretest-agree'));
      test.fill('#coretest-address\\.country', "NL");
      test.fill("#coretest-address\\.nr_detail", "296");
      test.fill("#coretest-address\\.zip", "7521AM");

      test.qS("#coreformsubmitresponse").textContent = '';
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.true(JSON.parse(test.qS('#coreformsubmitresponse').textContent).form.agree, "expected successful submit");

      test.qS("#coreformsubmitresponse").textContent = '';

      test.click(test.qS('#coretest-radiotest-1'));
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.eq("", test.qS('#coreformsubmitresponse').textContent, "expected no submission");

      test.fill(test.qS('#coretest-radiotestnamelijk'),'23');
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.true(JSON.parse(test.qS('#coreformsubmitresponse').textContent).form.agree, "expected successful submit #2");
    }

  , async function()
    {
      const alloptions = test.qSA("#coretest-condition_options option");

      // 1 and 3 are now checked, so only 2 should be disabled
      let disabled_options = test.qSA("#coretest-condition_options option[disabled]").map(_ => _.value);
      test.false(disabled_options.includes("1"));
      test.true(disabled_options.includes("2"));
      test.false(disabled_options.includes("3"));

      if (replacedcomponents)
      {
        test.click(test.qS(".wh-form__fieldgroup[data-wh-form-group-for='condition_options'] .wh-form__pulldown.mypulldown--replaced + .mypulldown .mypulldown__arrow"));
        await test.wait('ui');

        disabled_options = test.qSA("body > .mypulldown__items .mypulldown__item--disabled").map(_ => alloptions[_.dataset.dompackPulldownIndex].value);
        test.false(disabled_options.includes("1"));
        test.true(disabled_options.includes("2"));
        test.false(disabled_options.includes("3"));
      }

      // enable 2
      test.click('#coretest-checkboxes-2');
      disabled_options = test.qSA("#coretest-condition_options option[disabled]").map(_ => _.value);
      test.false(disabled_options.includes("1"));
      test.false(disabled_options.includes("2"));
      test.false(disabled_options.includes("3"));

      if (replacedcomponents)
      {
        test.click(test.qS(".wh-form__fieldgroup[data-wh-form-group-for='condition_options'] .wh-form__pulldown.mypulldown--replaced + .mypulldown .mypulldown__arrow"));
        await test.wait('ui');

        disabled_options = test.qSA("body > .mypulldown__items .mypulldown__item--disabled").map(_ => alloptions[_.dataset.dompackPulldownIndex].value);
        test.false(disabled_options.includes("1"));
        test.false(disabled_options.includes("2"));
        test.false(disabled_options.includes("3"));
      }

      // disable 2 and 3
      test.click('#coretest-checkboxes-2');
      test.click('#coretest-checkboxes-3');
      disabled_options = test.qSA("#coretest-condition_options option[disabled]").map(_ => _.value);
      test.false(disabled_options.includes("1"));
      test.true(disabled_options.includes("2"));
      test.true(disabled_options.includes("3"));

      if (replacedcomponents)
      {
        test.click(test.qS(".wh-form__fieldgroup[data-wh-form-group-for='condition_options'] .wh-form__pulldown.mypulldown--replaced + .mypulldown .mypulldown__arrow"));
        await test.wait('ui');

        disabled_options = test.qSA("body > .mypulldown__items .mypulldown__item--disabled").map(_ => alloptions[_.dataset.dompackPulldownIndex].value);
        test.false(disabled_options.includes("1"));
        test.true(disabled_options.includes("2"));
        test.true(disabled_options.includes("3"));
      }
    }
  ]);
