import * as test from '@mod-system/js/wh/testframework';

var setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, withpayment: ["withissuer"] });
      await test.load(setupdata.url);
    }

  , "Inspect form"
  , async function()
    {
      //only one issuer, so it should be selected
      test.true(test.qS(`[name="pm.paymentmethod"]`).checked);
    }
  ]);
