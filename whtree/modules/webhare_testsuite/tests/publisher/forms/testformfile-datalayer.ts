/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-system/js/wh/testframework";

function quickFillDefaultRequiredFields() {
  //fill required fields so we can submit
  test.fill(test.qS("#coretest-agree"), true);
  test.fill(test.qS("#coretest-email"), "pietje@example.com");
  test.fill(test.qS("#coretest-setvalidator"), "validated");
  test.click("#coretest-requiredradio-x");
  test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex = 2;
  test.fill("#coretest-address\\.country", "NL");
  test.fill("#coretest-address\\.nr_detail", "296");
  test.fill("#coretest-address\\.zip", "7521AM");
}

test.registerTests(
  [
    "Initialization",
    async function () {
      await test.invoke("mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits");
    },

    "Test without GTM tags",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?addgtmdatalayer=coretest-submit");
      const form = test.qS("#coreform");

      // The quick fill doesn't select option with custom datalayer titles
      quickFillDefaultRequiredFields();
      test.click(test.qS("#submitbutton"));
      await test.wait("ui");

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
      const form = test.qS("#coreform");
      quickFillDefaultRequiredFields();
      // pulldowntest '5' has a custom title (set separately as it's set by quickFillDefaultRequiredFields)
      test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex = 4;

      test.click(test.qS("#submitbutton"));
      await test.wait("ui");

      // Test option gtm tags on data layer
      const datalayer = await test.wait(() => Array.from(test.getWin().dataLayer).filter(_ => _.form_checkboxes_all_label)[0]);
      test.eq("Checkbox custom datalayer title", datalayer.form_checkboxes_all_label);
      test.eq("Radio custom datalayer title", datalayer.form_radiotest_label);
      test.eq("Option custom datalayer title", datalayer.form_pulldowntest_label);
    },
  ]);
