import * as test from '@mod-system/js/wh/testframework';
import FormBase from '@mod-publisher/js/forms/formbase';
import { debugFlags } from '@webhare/env/src/envbackend';
import { getPxlLogLines } from '@webhare/test-frontend';

function setRequiredFields() { //fill them with a value so we can submit
  test.fill('#coretest-email', 'pietje@example.com');
  test.fill('#coretest-setvalidator', 'test');
  test.click('#coretest-requiredradio-x');
  test.fill('#coretest-pulldowntest', '2');
  test.click('#coretest-agree');
  test.fill('#coretest-address\\.country', "NL");
  test.fill("#coretest-address\\.nr_detail", "296");
  test.fill("#coretest-address\\.zip", "7521AM");
  test.fill('#coretest-dateofbirth', '1999-12-31');
  test.fill('#coretest-number', '1');
}

test.runTests([
  'Test the new native validator',
  async function () {
    if (debugFlags.fdv)
      throw new Error("Disable the 'fdv' debugflag before running a validation test");

    await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');
    test.click('#coretest-email');
    test.eq(0, test.qSA('.wh-form__fieldgroup--error').length, "Form should be initially clean of errors");
    test.eq(0, test.qSA('aria-invalid').length, "Form should not have any aria-invalid attributes yet");

    test.fill('#coretest-email', 'x');
    test.eq(0, test.qSA('.wh-form__fieldgroup--error').length, "No errors if this field never failed #1");
    test.fill('#coretest-email', '');
    test.eq(0, test.qSA('.wh-form__fieldgroup--error').length, "No errors if this field never failed #2");

    await test.pressKey('Tab'); // leave email field

    // The email field should now get validated and give an error because it's required and the value is empty
    const emailfield = test.qR('#coretest-email');
    const emailgroup = emailfield.closest('.wh-form__fieldgroup');
    test.assert(emailgroup);

    test.assert(emailfield.getAttribute("aria-invalid"), "Expecting required emailfield to be in error mode now");

    let errornode = test.qR(emailgroup, '.wh-form__error');
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'), "Expecting required emailfield to have an error message");
    test.eq('Dit veld is verplicht.', errornode.textContent);
    test.eq(errornode.id, emailfield.getAttribute("aria-describedby"));

    await new Promise(resolve => setTimeout(resolve, 50)); //small delay to make sure no odd event handlers/focus change is interecept us

    await test.pressKey('z'); //this should end up in 'setValidator' field

    await test.pressKey('Tab', { shiftKey: true });
    await test.pressKey('x');

    errornode = test.qR(emailgroup, '.wh-form__error');
    test.eq('Dit is geen geldig e-mailadres.', test.qR(emailgroup, '.wh-form__error').textContent);
    test.eq("true", emailfield.getAttribute("aria-invalid"));
    test.eq(errornode.id, emailfield.getAttribute("aria-describedby"));

    // Set a correct email and check that errors has gone
    test.fill('#coretest-email', 'advocado@beta.webhare.net');
    await test.waitForUI();
    test.eq('', test.qR(emailgroup, '.wh-form__error').textContent);
    test.assert(!emailgroup.classList.contains('wh-form__fieldgroup--error'));
    test.assert(!emailfield.hasAttribute("aria-invalid"));
    test.assert(!emailfield.hasAttribute("aria-describedby"));

    //but now we should again warn immediately about errors
    await test.pressKey('@');
    test.eq('Dit is geen geldig e-mailadres.', test.qR(emailgroup, '.wh-form__error').textContent);
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'));

    test.eq("true", emailfield.getAttribute("aria-invalid"));
    errornode = test.qR(emailgroup, '.wh-form__error');
    test.eq(errornode.id, emailfield.getAttribute("aria-describedby"));

    // Set a correct email again
    test.fill('#coretest-email', 'advocado@beta.webhare.net');
    await test.waitForUI();
    test.eq('', test.qR(emailgroup, '.wh-form__error').textContent);

    // And now set an email *not* accepted by our isValidEmail, but accepted by the browser
    test.fill('#coretest-email', 'email@a.a');
    await test.pressKey('Tab');
    test.eq('Dit is geen geldig e-mailadres.', test.qR(emailgroup, '.wh-form__error').textContent);

  },

  'Test required/focus behavior of additional fields inside radio groups',
  async function () {
    test.click("#coretest-radiotest-5");
    test.click("#coretest-opt5_textedit");
    test.assert(!test.qR("#coretest-opt5_textedit").matches(".wh-form__field--error, .wh-form__field--everfailed"), "Should not be in failed state yet");
    test.assert(!test.qR("#coretest-opt5_textedit").closest(".wh-form__fieldgroup")!.matches(".wh-form__fieldgroup--error"), "Group should not be in failed state yet");
    test.click("#coretest-number"); //focus something else
    //now we should see the error classes appear!
    await test.waitForUI();
    test.assert(test.qR("#coretest-opt5_textedit").matches(".wh-form__field--error.wh-form__field--everfailed"));
    test.assert(test.qR("#coretest-opt5_textedit").closest(".wh-form__fieldgroup")?.matches(".wh-form__fieldgroup--error"));
  },

  'Test number field',
  async function () {
    const field = test.qR('#coretest-number');
    const numbergroup = test.qR('#coretest-number').closest('.wh-form__fieldgroup');
    test.assert(numbergroup);
    test.fill('#coretest-number', '5');
    await test.pressKey('Tab', { shiftKey: true });
    test.assert(field.getAttribute("aria-invalid"));
    test.eq('De waarde mag niet groter zijn dan 2.', test.qR(numbergroup, '.wh-form__error').textContent);
    test.fill('#coretest-number', '-5');
    await test.waitForUI();
    test.eq('De waarde mag niet lager zijn dan -2.', test.qR(numbergroup, '.wh-form__error').textContent);

    // check ARIA attributes
    const errornode = test.qR(numbergroup, '.wh-form__error');
    test.eq(errornode.id, field.getAttribute("aria-describedby"));
  },

  'Test datetime field',
  async function () {
    test.eq('', test.qR('#coretest-dateofbirth').validationMessage || '');

    const dateofbirthgroup = test.qR('#coretest-dateofbirth').closest('.wh-form__fieldgroup');
    test.assert(dateofbirthgroup);
    const sevendayslater = new Date(Date.now() + 7 * 86400 * 1000).toISOString().substr(0, 10);

    //FIXME date localization
    test.fill('#coretest-dateofbirth', sevendayslater);
    await test.pressKey('Tab', { shiftKey: true });
    test.eq(/De waarde mag niet groter zijn dan ..-..-2...\./, test.qR(dateofbirthgroup, '.wh-form__error').textContent);
    test.fill('#coretest-dateofbirth', '1899-12-31');
    await test.waitForUI();
    test.eq('De waarde mag niet lager zijn dan 01-01-1900.', test.qR(dateofbirthgroup, '.wh-form__error').textContent);

    test.fill("#coretest-dateofbirth", "");
    test.eq('Dit veld is verplicht.', test.qR(dateofbirthgroup, '.wh-form__error').textContent);

    const errornode = test.qR(dateofbirthgroup, '.wh-form__error');

    // check ARIA attributes
    const field = test.qR('#coretest-dateofbirth');
    // test.eq("true", field.getAttribute("aria-invalid"));
    test.eq(errornode.id, field.getAttribute("aria-describedby"));
  },

  'Test text area',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');

    //test proper textarea validation
    //minLength & maxLength don't trigger validation issues if no userinteraction happened yet, so we'll enable required manually
    test.qR('#coretest-textarea').required = true;
    test.click('#coretest-textarea');
    await test.pressKey('Tab');
    test.eq("true", test.qR('#coretest-textarea').getAttribute("aria-invalid"));
    test.eq('Dit veld is verplicht.', test.qR('#coretest-textarea').closest('.wh-form__fieldgroup')?.querySelector(".wh-form__error")?.textContent);
  },

  'Test radio visiblity and checks',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');

    //      test.assert(!test.qR('[data-wh-form-group-for="requiredradio"]').classList.contains("wh-form__fieldgroup--error"));
    // Checkbox groups (select type="checkbox") must have a groupnode with aria-labels
    const groupnode = test.qR('[data-wh-form-group-for="requiredradio"]');
    test.assert(!groupnode.classList.contains("wh-form__fieldgroup--error"));
    test.eq(false, groupnode.hasAttribute("aria-invalid"));
    test.eq(false, groupnode.hasAttribute("aria-describedby"));

    test.click('#coretest-showradioy'); //hid e Y

    test.assert(!test.qR('[data-wh-form-group-for="requiredradio"]').classList.contains("wh-form__fieldgroup--error"));
    test.click('#coretest-showradioy'); //show Y

    setRequiredFields(); //sets all fields (note: selects X)
    test.click('#coretest-requiredradio-y'); //and select Y again

    test.click('#coretest-showradioy'); //hide Y

    //submit should fail as we've made "Y" disappear
    test.click('#submitbutton');
    await test.waitForUI();

    //the CLIENT should have detected this..
    const errorinfo = (await getPxlLogLines()).filter(l => l.event.startsWith("platform:form_")).at(-1);
    test.eq('client', errorinfo?.mod_platform.formmeta_errorsource);

    // select type="radio" must use a container with role="group"
    // on which to set the ARIA attributes
    test.eq("true", groupnode.getAttribute("aria-invalid"));
    const errornode = test.qR(groupnode, '.wh-form__error');
    test.eq(errornode.id, groupnode.getAttribute("aria-describedby"));
  },

  'Test checkboxes min/max',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');
    const start = new Date;

    setRequiredFields();
    const formhandler = FormBase.getForNode(test.qR('#coreform'));
    test.assert(formhandler);

    //1 + 3 are now preselected (as defined in the formtest.formdef.xml)
    test.click('#coretest-checkboxes-2'); //adding 2 to the set
    test.click('#submitbutton');
    await test.waitForUI();

    let formevents = (await getPxlLogLines({ start })).filter(l => l.event.startsWith("platform:form_"));

    test.eq(2, formevents.length, "Should be two PXL events now - one for start and one for failure");
    test.eq("platform:form_failed", formevents[1].event);
    test.eq("checkboxes", formevents[1].mod_platform.formmeta_errorfields);
    test.eq("client", formevents[1].mod_platform.formmeta_errorsource);

    const checkboxgroup = test.qR('#coretest-checkboxes-2').closest<HTMLElement>('.wh-form__fieldgroup');
    test.assert(checkboxgroup);
    test.assert(test.hasFocus(test.qR('#coretest-checkboxes-1')), "first focusable checkbox of this group should receive focus");
    test.eq('Kies maximaal 2 items.', test.qR(checkboxgroup, '.wh-form__error').textContent);

    // The ARIA attributes are expected on the group container
    test.eq("true", checkboxgroup.getAttribute("aria-invalid"));
    let errornode = test.qR(checkboxgroup, '.wh-form__error');
    test.eq(errornode.id, checkboxgroup.getAttribute("aria-describedby"));

    test.click('#coretest-checkboxes-3'); //deselecting #3
    await test.waitForUI(); //checkboxes don't update until UI is open (because it uses a validation handler) so wait for it..

    // Check wether all error indicators have been cleared
    test.eq('', test.qR(checkboxgroup, '.wh-form__error').textContent);
    test.eq(false, checkboxgroup.hasAttribute("aria-invalid"));
    test.eq(false, checkboxgroup.hasAttribute("aria-describedby"));

    test.click('#coretest-checkboxes-3'); //selecting #3 - now expecting immediate responses
    await test.waitForUI();

    test.eq('Kies maximaal 2 items.', test.qR(checkboxgroup, '.wh-form__error').textContent);
    test.eq("true", checkboxgroup.getAttribute("aria-invalid"));
    errornode = test.qR(checkboxgroup, '.wh-form__error');
    test.eq(errornode.id, checkboxgroup.getAttribute("aria-describedby"));

    test.click('#coretest-checkboxes-3'); //deselecting #3 - now expecting immediate responses
    test.click('#coretest-checkboxes-2'); //deselecting #2 - now expecting immediate responses
    test.click('#coretest-checkboxes-1'); //deselecting #1 - now expecting immediate responses
    await test.waitForUI();
    test.eq('Kies minimaal 1 item.', test.qR(checkboxgroup, '.wh-form__error').textContent);

    let result = await formhandler.validate(checkboxgroup);
    test.eq(checkboxgroup, result.firstfailed);
    test.assert(result.failed.length === 1);

    delete checkboxgroup.dataset.whMin; // Removing required number of selected checkboxes
    result = await formhandler.validate(checkboxgroup);
    test.eq(null, result.firstfailed);
    test.assert(result.failed.length === 0);

    test.click('#coretest-checkboxesvisible');
    test.qR('#coreformsubmitresponse').textContent = '';
    test.click('#submitbutton');
    await test.waitForUI();

    test.assert(JSON.parse(test.qR('#coreformsubmitresponse').textContent!).form.agree, "expected successful submit");

    formevents = (await getPxlLogLines({ start })).filter(l => l.event.startsWith("platform:form_"));
    test.eq(3, formevents.length, "Should be three PXL events now - one for start, one for failure and one for submission");
    test.eq("platform:form_submitted", formevents[2].event);
  },

  'Test server fallback error handling',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');

    // Check for correct labeling
    test.eq('Textarea', test.qR('[for="coretest-textarea"]').textContent);

    test.eq(70, test.qR("textarea").maxLength);
    test.qR("textarea").removeAttribute("maxlength");
    test.fill("textarea", "This text is way too long. Yes it is way too long. Yes it is way too long. Yes it is way too long. 113 characters");
    setRequiredFields();

    test.click('#submitbutton');
    await test.waitForUI();

    test.assert(test.qR('[data-wh-form-group-for="textarea"]').classList.contains("wh-form__fieldgroup--error"), "should have failed serverside");

    // Serverside errors must also trigger the ARIA attributes
    const field = test.qR('#coretest-textarea');
    test.eq("true", field.getAttribute("aria-invalid"));

    const errornode = field.closest('.wh-form__fieldgroup')!.querySelector('.wh-form__error');
    test.eq(errornode!.id, field.getAttribute("aria-describedby"));
  },

  'Test server side errors',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
    setRequiredFields();

    //set a rejected password
    test.fill("#coretest-password", "secret");

    test.click('#submitbutton');
    await test.waitForUI();

    if (test.qR("#coretest-password").value !== "secret") {
      console.error('YOUR PASSWORD MANAGER CHANGED THE PASSWORD!\n\n'
        + `  For LastPass: Go to the LastPass Vault > Account Settings > Never URLs\n`
        + `  Add the URL ${test.getWin().location.origin}/webhare-testsuite.site/* to the "Never Do Anything" list\n\n`);
      throw new Error("YOUR PASSWORD MANAGER CHANGED THE PASSWORD! disable it!");
    }

    const field = test.qR("#coretest-password");
    test.eq("true", field.getAttribute("aria-invalid"));

    let errornode = field.closest('.wh-form__fieldgroup')!.querySelector('.wh-form__error');
    test.eq(errornode!.id, field.getAttribute("aria-describedby"));

    test.assert(test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
    await test.pressKey('Tab');
    test.assert(test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"), "should still have error state after tab");
    await test.pressKey('Tab', { shiftKey: true });
    test.qR("#coretest-number").focus();
    test.assert(test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"), "should still have error state after focus");

    //change it, immediately clears the error
    test.fill("#coretest-password", "secret!");
    test.assert(!test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
    test.assert(!field.hasAttribute("aria-invalid"));
    test.assert(!field.hasAttribute("aria-describedby"));

    //submit that, fails again
    test.click('#submitbutton');
    await test.waitForUI();
    test.assert(test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
    test.assert(field.hasAttribute("aria-invalid"));
    errornode = field.closest('.wh-form__fieldgroup')!.querySelector('.wh-form__error');
    test.eq(errornode!.id, field.getAttribute("aria-describedby"));

    //now set a _different_ field to allow the password
    test.qR("#coretest-number").focus();
    test.fill("#coretest-number", "-2");

    //stil in error, but should go OUT of error after submission
    test.assert(test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
    test.click('#submitbutton');
    await test.waitForUI();
    test.assert(!test.qR('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
  },

  //the following tests only test the API (and for compatibility with parlsey). We can get through these tests without actually responding to the user (ie no triggers)

  'Test builtin validation API',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
    const formhandler = FormBase.getForNode(test.qR('#coreform'));
    test.assert(formhandler);
    test.eq(0, test.qSA('.wh-form__fieldgroup--error').length, "Form should be initially clean of errors");

    let result;
    result = await formhandler.validate([]); //empty set

    const emailgroup = test.qR('#coretest-email').closest<HTMLElement>('.wh-form__fieldgroup');
    test.assert(emailgroup);
    test.assert(!emailgroup.classList.contains('wh-form__fieldgroup--error'));

    //we now just show errors immediately if you set them. reportimmediately should become obsolete soon as we're no longer eagerly validating the form on rendering (actually triggered by setupValidator which immediately ran the check)
    formhandler.setFieldError(test.qR('#coretest-email'), 'really bad email field', { reportimmediately: true });
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'));
    test.eq('really bad email field', test.qR(emailgroup, '.wh-form__error').textContent);

    /* and we can hide it. This *used* to completely hide the error but I've now reduced the amount of state to keep
       and I don't think we really need to support this scenario? The simpler approach falls back to the business rule
       'once a field has reported an error, it will no longer delay further error reports' so clearing the explicit
       error will now cause a 'required' error to be shown.

    formhandler.setFieldError(test.qR('#coretest-email'), '');
    test.assert(!emailgroup.classList.contains('wh-form__fieldgroup--error'));
    test.eq('', test.qR(emailgroup, '.wh-form__error').textContent);

    */
    formhandler.setFieldError(test.qR('#coretest-email'), '');
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'));
    test.eq('Dit veld is verplicht.', test.qR(emailgroup, '.wh-form__error').textContent);

    result = await formhandler.validate(emailgroup);
    test.eq(test.qR('#coretest-email'), result.firstfailed);
    test.assert(result.failed.length === 1);
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'), 'email group should be marked as error');
    test.eq('Dit veld is verplicht.', test.qR(emailgroup, '.wh-form__error').textContent);

    //test HTML5 custom validation
    result = await formhandler.validate(test.qR('#coretest-setvalidator'));
    test.assert(!result.valid, 'setvalidator should be seen as invalid');
    test.eq(test.qR('#coretest-setvalidator'), result.firstfailed);
    test.assert(result.failed.length === 1);

    //test custom errors
    test.qR('#coretest-email').value = 'klaas@example.org';
    result = await formhandler.validate(emailgroup);
    test.assert(result.valid);
    test.assert(!emailgroup.classList.contains('wh-form__fieldgroup--error'), 'email group should not be marked as error');

    formhandler.setFieldError(test.qR('#coretest-email'), 'bad email field', { reportimmediately: true });
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'), 'email group should be marked as error after explicit setFieldError');

    result = await formhandler.validate(emailgroup);
    test.assert(emailgroup.classList.contains('wh-form__fieldgroup--error'), 'revalidation may not clear explicit errors, as they have no callback to restore errors');

    formhandler.setFieldError(test.qR('#coretest-email'), "");
    test.assert(!emailgroup.classList.contains('wh-form__fieldgroup--error'), 'email group should be unmarked as error');
    test.qR('#coretest-email').value = '';

    // Test disabling by condition clearing validation errors
    test.fill("#coretest-condition_not", true);
    test.click('#coretest-condition_not_required');
    test.click('#coretest-condition_not_enabled');
    await test.waitForUI();
    test.assert(test.qR('#coretest-condition_not_required').classList.contains('wh-form__field--error'));
    test.fill("#coretest-condition_not", false);
    await test.waitForUI();
    test.assert(!test.qR('#coretest-condition_not_required').classList.contains('wh-form__field--error'));
  },

  {
    name: 'Test built-in validation far away validation',
    test: async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?scrollzone=1');
      test.getWin().scrollTo(0, test.getDoc().documentElement.scrollHeight - test.getWin().innerHeight);
      test.assert(!test.canClick(test.qR('#coretest-email')), '#coretest-email should be out of sight');
      test.click('.validatebutton');
    },
    waits: ['ui']
  },
  {
    test: function () {
      test.assert(test.canClick(test.qR('#coretest-email')), '#coretest-email should be back in of sight');
      test.assert(test.hasFocus(test.qR('#coretest-email')), '#coretest-email should have focus');
    }
  },

  'Test built-in validation not validating custom validated fields - SUBMIT button',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
    const setvalidatorgroup = test.qR('#coretest-setvalidator').closest('.wh-form__fieldgroup');
    test.assert(setvalidatorgroup);
    test.assert(!setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'));

    test.fill('#coretest-email', 'pietje@example.com');
    test.click('#submitbutton');
    await test.waitForUI();

    test.assert(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'), 'setvalidator not marked as failed');
    //make sure parlsey isn't causing injection errors
    test.eq("R<a>am", test.qR(setvalidatorgroup, '.wh-form__error').textContent);
  },

  'Test built-in validation not validating custom validated fields - VALIDATE button',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
    const setvalidatorgroup = test.qR('#coretest-setvalidator').closest('.wh-form__fieldgroup');
    test.assert(setvalidatorgroup);
    test.assert(!setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'));

    test.fill('#coretest-email', 'pietje@example.com');
    test.click('.validatebutton');
    await test.waitForUI();

    test.assert(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'), 'setvalidator not marked as failed');
  },

  'Test rich validation errors',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
    const setvalidatorgroup = test.qR('#coretest-setvalidator').closest('.wh-form__fieldgroup');
    test.assert(setvalidatorgroup);
    test.assert(!setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'));

    test.fill('#coretest-email', 'pietje@example.com');
    test.fill('#coretest-setvalidator', 'richerror');
    test.click('.validatebutton');
    await test.waitForUI();

    test.assert(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'), 'setvalidator not marked as failed');
    test.eq("Rich Error", test.qR(setvalidatorgroup, '.wh-form__error').textContent);
    test.eq("Rich Error", test.qR(setvalidatorgroup, '.wh-form__error a').textContent);
  },

  'Test odd radio validation behaviour',
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
    test.click('#submitbutton');
    await test.waitForUI();
    test.assert(test.qR('[data-wh-form-group-for="requiredradio"]').classList.contains('wh-form__fieldgroup--error'));
    test.click('#coretest-requiredradio-y');
    await test.waitForUI();

    test.assert(!test.qR('[data-wh-form-group-for="requiredradio"]').classList.contains('wh-form__fieldgroup--error'), "Error should be cleared immediately");
  },

  "load the page without initial checkboxes selected",
  async function () {
    await test.load(test.getTestSiteRoot() + 'testpages/formtest/?nocheckboxselect=1');
    test.assert(!test.qR('[data-wh-form-group-for=checkboxes]').classList.contains("wh-form__fieldgroup--error"));
    test.click('#submitbutton');
    await test.waitForUI();
    test.assert(test.qR('[data-wh-form-group-for=checkboxes]').classList.contains("wh-form__fieldgroup--error"));
  },

  'Test async validation with SetupValidator',
  async function () {
    const setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm',
      {
        jshandler: "webhare_testsuite:customform2",
        which: "custom2"
      });

    await test.load(setupdata.url);

    test.click('button[type=submit]');
    await test.waitForUI();
    test.eq('RPC not called yet', test.qR(`[name=textarea]`).closest('.wh-form__fieldgroup')!.querySelector(".wh-form__error")!.textContent);
  }
]);
