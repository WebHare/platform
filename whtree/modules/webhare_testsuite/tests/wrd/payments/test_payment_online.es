import * as test from '@mod-system/js/wh/testframework';
// import * as dompack from 'dompack';

// let testemail = Math.floor(100000000*Math.random()) + '-testformfile-online+jstest@beta.webhare.net';
var setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, withpayment: ["withissuer"], filename:"paymenthandlerform" });
      await test.load(setupdata.url);
    }

  , "Simple payment - cancel it"
  , async function()
    {
      //only one issuer, so it should be selected
      test.fill(`[name="firstname"]`,"Jopie");
      test.true(test.qS(`[name="pm.paymentmethod"]`).checked);
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");

      test.click("[type=submit]");
      await test.wait('ui');
      await test.wait('load');
      test.eq("42.42", test.qS(".paymentamount").textContent);
      await test.click("#rejectpayment");
      await test.wait('load');

      //should see cancelled text
      test.true(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed");
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");

      //verify handlers that we get an email
      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort( (lhs,rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eqMatch(/Too bad you've cancelled Jopie!/, emails[0].plaintext);
      test.eq("Payment has failed", emails[1].subject);
    }

  , async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, addmoneyfield: true,withpayment: ["withissuer"], filename:"paymenthandlerform" });
      await test.load(setupdata.url);
    }

  , async function()
    {
      test.fill(`[name="firstname"]`,"Joepie");
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");
      test.fill(`[name="moneyfield"]`, '1.55');
      test.click("[type=submit]");
      await test.wait('ui');

      await test.wait('load');
      test.eq("1.55", test.qS(".paymentamount").textContent);

      await test.click("#notifyapprovepayment");
      await test.wait('load');

      //verify handlers - we should NOW already see emails etc going out!
      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort( (lhs,rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eqMatch(/Hello Joepie!/, emails[0].plaintext);
      test.eq("Payment is confirmed", emails[1].subject);

      await test.click("#rejectpayment"); //doesnt matter what we choose now
      await test.wait('load');

      //should see confirmed text
      test.true(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
    }

  ]);
