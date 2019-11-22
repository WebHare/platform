import test from '@mod-system/js/wh/testframework';

test.registerTests(
  [ async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
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
  ]);
