import * as test from '@mod-system/js/wh/testframework';
let setupdata: any;

test.runTests(
  [
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, withpayment: ["withissuer"], filename: "paymenthandlerform" });
      await test.load(setupdata.url);
    },

    "Verify autoselect when only one method exists",
    async function () {
      //only one issuer, so it should be selected
      test.assert(test.qR(`[name="pm.paymentmethod"]`).checked);
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");
      await test.load(setupdata.url);
    },

    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, withpayment: ["withissuer", "testdriver"], filename: "paymenthandlerform" });
      await test.load(setupdata.url);
    },

    "Simple payment - cancel it",
    async function () {
      //only one issuer, so it should be selected
      test.fill(`[name="firstname"]`, "Jopie");
      const method2 = test.findElement(['[name="pm.paymentmethod"]', 2]);
      test.eq("/.wh/ea/p/branding/webhare.svg", method2?.dataset.whPaymentmethodImage);
      test.click(method2!);

      test.click("[type=submit]");
      await test.waitForUI();
      await test.wait('load');
      test.eq("42.42", test.qR(".paymentamount").textContent);
      test.eq("Test provider payment page", test.getDoc().title, "Some tests verify the page's title to know they're in the right place");
      await test.click("#rejectpayment");
      await test.wait('load');

      //should see cancelled text
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should see thankyou_cancelled text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_pending"]'), "Should not see thankyou_pending");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");

      //verify handlers that we get an email
      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort((lhs, rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eq(/Too bad you've cancelled Jopie!/, emails[0].plaintext);
      test.eq("Payment has failed", emails[1].subject);
    },

    "Simple payment - keep it pending",
    async function () {
      await test.load(setupdata.url);
      test.fill(`[name="firstname"]`, "Jaapie");
      test.click(test.findElement(['[name="pm.paymentmethod"]', 0])!);
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");

      test.click("[type=submit]");
      await test.waitForUI();
      await test.wait('load');
      test.eq("42.42", test.qR(".paymentamount").textContent);
      await test.click("#pendingpayment");
      await test.wait('load');

      //should see pending text
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_pending"]'), "Should see thankyou_pending");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
    },

    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, addmoneyfield: true, withpayment: ["withissuer"], filename: "paymenthandlerform" });
      await test.load(setupdata.url);
    },

    async function () {
      test.fill(`[name="firstname"]`, "Joepie");
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");
      test.fill(`[name="moneyfield"]`, '1.55');
      test.click("[type=submit]");
      await test.waitForUI();

      await test.wait('load');
      test.eq("1.55", test.qR(".paymentamount").textContent);

      await test.click("#notifyapprovepayment");
      await test.wait('load');

      //verify handlers - we should NOW already see emails etc going out!
      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort((lhs, rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eq(/Hello Joepie!/, emails[0].plaintext);
      test.eq("Payment is confirmed", emails[1].subject);

      await test.click("#rejectpayment"); //that doesnt change a thing
      await test.wait('load');

      //should see confirmed text
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should see thankyou_confirmed text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_pending"]'), "Should not see thankyou_pending");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
    },

    "Test rejected payment succeeding after all",
    async function () {
      await test.load(setupdata.url);
      test.fill(`[name="firstname"]`, "Jippie");
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");
      test.fill(`[name="moneyfield"]`, '1.55');
      test.click("[type=submit]");
      await test.waitForUI();

      await test.wait('load');
      test.eq("1.55", test.qR(".paymentamount").textContent);

      await test.click("#notifyrejectpayment");
      await test.wait('load');

      //verify handlers - we should NOW already see emails etc going out!
      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort((lhs, rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eq(/Too bad you've cancelled Jippie!/, emails[0].plaintext);
      test.eq("Payment has failed", emails[1].subject);

      await test.click("#approvepayment"); //approving it anyway! CCs can do this, rejecting first and then approving ANYWAY
      await test.wait('load');

      //should see confirmed text
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should see thankyou_confirmed text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_pending"]'), "Should not see thankyou_pending");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");

      //and now we get confirmation mails!
      emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort((lhs, rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eq(/Hello Jippie!/, emails[0].plaintext);
      test.eq("Payment is confirmed", emails[1].subject);
    },

    "Test re-rejecting payment",
    async function () {
      await test.load(setupdata.url);
      test.fill(`[name="firstname"]`, "Joppie");
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");
      test.fill(`[name="moneyfield"]`, "1.55");
      test.click("[type=submit]");
      await test.waitForUI();

      await test.wait('load');
      test.eq("1.55", test.qR(".paymentamount").textContent);

      await test.click("#notifyrejectpayment");
      await test.wait('load');

      //verify handlers - we should NOW already see emails etc going out!
      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort((lhs, rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("About Your Submission", emails[0].subject);
      test.eq(/Too bad you've cancelled Joppie!/, emails[0].plaintext);
      test.eq("Payment has failed", emails[1].subject);

      await test.click("#rejectpayment"); //also going through this route
      await test.wait('load');

      //should see cancelled text
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should see thankyou_cancelled text");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou_pending"]'), "Should not see thankyou_pending");
      test.assert(!test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
    },

    "Test custom field providing payment amounts",
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { addpaymentmethod: true, addpaymenthandler: true, addtslinecomp: true, withpayment: ["withissuer"], filename: "paymenthandlerform" });
      await test.load(setupdata.url);
      test.fill(`[name="firstname"]`, "Joepje");
      test.fill('[id="webtoolform-tsline.field1"]', "55");
      test.fill('[id="webtoolform-tsline.field2"]', "15");
      test.fill(`[name="pm.paymentmethod.issuer0"]`, "DPB");
      test.click("[type=submit]");

      await test.wait('load');
      test.eq("40.00", test.qR(".paymentamount").textContent);

      await test.click("#approvepayment"); //approving it anyway! CCs can do this, rejecting first and then approving ANYWAY
      await test.wait('load');

      //should see confirmed text
      test.assert(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should see thankyou_confirmed text");

      let emails = await test.waitForEmails("test@beta.webhare.net", { timeout: 60000, count: 2 });
      test.eq(2, emails.length, "No emails!");
      emails = emails.sort((lhs, rhs) => lhs.subject < rhs.subject ? -1 : lhs.subject > rhs.subject ? 1 : 0);
      test.eq("Payment is confirmed", emails[1].subject);
      test.eq(/TSLinecomp difference: \{40,00\}/, emails[1].plaintext);

    }
  ]);
