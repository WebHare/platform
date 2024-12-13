import * as test from '@webhare/test-frontend';

function quickFillDefaultRequiredFields() {
  //fill required fields so we can submit
  test.fill("#coretest-agree", true);
  test.fill("#coretest-email", "pietje@example.com");
  test.fill("#coretest-setvalidator", "validated");
  test.click("#coretest-requiredradio-x");
  test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex = 2;
  test.fill("#coretest-address\\.country", "NL");
  test.fill("#coretest-address\\.nr_detail", "296");
  test.fill("#coretest-address\\.zip", "7521AM");
}

test.run(
  [
    "Initialization",
    async function () {
      await test.invoke("mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits");
    },

    "Test without GTM tags",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?addgtmdatalayer=coretest-submit");

      // The quick fill doesn't select option with custom datalayer titles
      quickFillDefaultRequiredFields();
      test.click("#submitbutton");
      await test.waitForUI();

      // Test option labels on data layer
      const datalayer = await test.wait(() => Array.from(test.getWin().dataLayer).filter(_ => _.form_checkboxes_all_label)[0]);
      test.eq("Eins;Polizei", datalayer.form_checkboxes_all_label);
      test.eq("Option 3", datalayer.form_radiotest_label);
      test.eq("Two", datalayer.form_pulldowntest_label);
    },

    "Test with GTM tags",
    async function () {
      // checkbox '2' has a custom title
      // radiotest '4' has a custom title
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?addgtmdatalayer=coretest-submit&checkboxes=2&radiotest=4");
      quickFillDefaultRequiredFields();
      // pulldowntest '5' has a custom title (set separately as it's set by quickFillDefaultRequiredFields)
      test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex = 4;

      test.click("#submitbutton");
      await test.waitForUI();

      // Test option gtm tags on data layer
      const datalayer = await test.wait(() => Array.from(test.getWin().dataLayer).filter(_ => _.form_checkboxes_all_label)[0]);
      test.eq("Checkbox custom datalayer title", datalayer.form_checkboxes_all_label);
      test.eq("Radio custom datalayer title", datalayer.form_radiotest_label);
      test.eq("Option custom datalayer title", datalayer.form_pulldowntest_label);
    },
  ]);
