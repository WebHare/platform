import * as test from '@webhare/test-frontend';
import FormBase from '@mod-publisher/js/forms/formbase';
import type { MySimpleFieldValue } from '@mod-webhare_testsuite/webdesigns/basetestjs/pages/formtest/simplefield';
import { getFormHandler } from '@webhare/forms';


interface CustomElementFormShape {
  simpleField: MySimpleFieldValue;
}

async function testSimpleElement() {
  await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
  await test.load(test.getTestSiteRoot() + 'testpages/formtest/?form=customelements');

  test.click("my-simple-field button"); //0->14
  test.click("my-simple-field button"); //14->28
  test.eq("28", test.qR("my-simple-field .answer").textContent);

  const form = getFormHandler<FormBase<CustomElementFormShape>>(test.qR("form"));
  test.eq({ simpleField: { answer: 28 } }, form.data);

  test.click('button[type=submit]');
  await test.waitForUI();

  const serverresponse = JSON.parse(test.qR('#dynamicformsubmitresponse').textContent!);
  test.eq({ answer: 28 }, serverresponse.form.simple_field);
}

async function testAttributeSyncingSimple() {
  //Test the disabled attribute
  test.eq(false, test.qR("my-simple-field").disabled);
  await test.waitToggled({
    test: () => test.qR("my-simple-field").disabled,
    run: () => test.qR("my-simple-field").setAttribute("disabled", "disabled")
  });

  test.eq(true, test.qR("my-simple-field").disabled);
  test.eq(true, test.qR("my-simple-field").matches(":disabled"));
  test.qR("my-simple-field").removeAttribute("disabled");
  test.eq(false, test.qR("my-simple-field").disabled);
  test.eq(false, test.qR("my-simple-field").matches(":disabled"));

  //Test the required attribute
  test.eq(false, test.qR("my-simple-field").required);
  test.qR("my-simple-field").setAttribute("required", "required");
  test.eq(true, test.qR("my-simple-field").required);
  // Doesn't look like its possible to have :required CSS selector work. elementInternals customStateSet doesn't work for it
  // test.eq(true, test.qR("my-simple-field").matches(":required"));
  test.qR("my-simple-field").removeAttribute("required");
  test.eq(false, test.qR("my-simple-field").required);
  // test.eq(false, test.qR("my-simple-field").matches(":required"));
}

test.runTests([
  testSimpleElement,
  testAttributeSyncingSimple,
]);
