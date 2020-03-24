import * as test from '@mod-system/js/wh/testframework';
import { $qS, $qSA } from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import FormBase from '@mod-publisher/js/forms/formbase';
var domfocus = require('@mod-system/js/dom/focus');

function setRequiredFields() //fill them with a value so we can submit
{
  test.fill(test.qS('#coretest-email'),'pietje@example.com');
  test.fill(test.qS('#coretest-setvalidator'),'test');
  test.click(test.qS('#coretest-requiredradio-x'));
  test.fill(test.qS('#coretest-pulldowntest'),'2');
  test.click(test.qS('#coretest-agree'));
  test.fill('#coretest-address\\.country', "NL");
  test.fill("#coretest-address\\.nr_detail", "296");
  test.fill("#coretest-address\\.zip", "7521AM");
  test.fill('#coretest-dateofbirth','1999-12-31');
  test.fill('#coretest-number','1');
}

test.registerTests(
  [ 'Test the new native validator'
  , async function()
    {
      if(dompack.debugflags.fdv)
        alert("Disable the 'fdv' debugflag before running a validation test");

      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');
      test.click('#coretest-email');
      test.eq(0, $qSA('.wh-form__fieldgroup--error').length, "Form should be initially clean of errors");

      test.fill('#coretest-email', 'x');
      test.eq(0, $qSA('.wh-form__fieldgroup--error').length, "No errors if this field never failed #1");
      test.fill('#coretest-email', '');
      test.eq(0, $qSA('.wh-form__fieldgroup--error').length, "No errors if this field never failed #2");

      await test.pressKey('Tab');

      let emailgroup = dompack.closest($qS('#coretest-email'), '.wh-form__fieldgroup');
      test.true(emailgroup.classList.contains('wh-form__fieldgroup--error'), "Expecting required emailfield to be in error mode now");
      test.eq('Dit veld is verplicht.', emailgroup.querySelector('.wh-form__error').textContent);

      await new Promise(resolve => setTimeout(resolve,50)); //small delay to make sure no odd event handlers/focus change is iinterecept us

      await test.pressKey('z'); //this should end up in 'setValiator' field

      await test.pressKey('Tab', { shiftKey: true });
      await test.pressKey('x');
      test.eq('Dit is geen geldig e-mailadres.', emailgroup.querySelector('.wh-form__error').textContent);

      test.fill('#coretest-email', 'advocado@beta.webhare.net');
      test.eq('', emailgroup.querySelector('.wh-form__error').textContent);
      test.false(emailgroup.classList.contains('wh-form__fieldgroup--error'));

      //but now we should again warn immediately about errors
      await test.pressKey('@');
      test.eq('Dit is geen geldig e-mailadres.', emailgroup.querySelector('.wh-form__error').textContent);
      test.true(emailgroup.classList.contains('wh-form__fieldgroup--error'));
    }

  , 'Test number field'
  , async function()
    {
      let numbergroup = dompack.closest($qS('#coretest-number'), '.wh-form__fieldgroup');
      test.fill('#coretest-number','5');
      await test.pressKey('Tab', { shiftKey: true });
      test.eq('De waarde mag niet groter zijn dan 2.', numbergroup.querySelector('.wh-form__error').textContent);
      test.fill('#coretest-number','-5');
      test.eq('De waarde mag niet lager zijn dan -2.', numbergroup.querySelector('.wh-form__error').textContent);
    }

  , 'Test datetime field'
  , async function()
    {
      test.eq('', test.qS('#coretest-dateofbirth').validationMessage||'');

      let dateofbirthgroup = dompack.closest($qS('#coretest-dateofbirth'), '.wh-form__fieldgroup');
      let sevendayslater = new Date(Date.now()+7*86400*1000).toISOString().substr(0,10);

      //FIXME date localization
      test.fill('#coretest-dateofbirth',sevendayslater);
      await test.pressKey('Tab', { shiftKey: true });
      test.eqMatch(/De waarde mag niet groter zijn dan 2...-..-..\./, dateofbirthgroup.querySelector('.wh-form__error').textContent);
      test.fill('#coretest-dateofbirth','1899-12-31');
      test.eq('De waarde mag niet lager zijn dan 1900-01-01.', dateofbirthgroup.querySelector('.wh-form__error').textContent);

      test.fill("#coretest-dateofbirth","");
      test.eq('Dit veld is verplicht.', dateofbirthgroup.querySelector('.wh-form__error').textContent);
    }

  , 'Test radio visiblity and checks'
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');

      test.eq(false, test.qS('[data-wh-form-group-for="requiredradio"]').classList.contains("wh-form__fieldgroup--error"));
      test.click('#coretest-showradioy'); //hid e Y

      test.eq(false, test.qS('[data-wh-form-group-for="requiredradio"]').classList.contains("wh-form__fieldgroup--error"));
      test.click('#coretest-showradioy'); //show Y

      setRequiredFields(); //sets all fields (note: selects X)
      test.click('#coretest-requiredradio-y'); //and select Y again

      test.click('#coretest-showradioy'); //hide Y

      //submit should fail as we've made "Y" disappear
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');

      //the CLIENT should have detected this..
      let errorinfo = test.getPxlLog(/^publisher:form.+/).slice(-1)[0];
      test.eq('client', errorinfo.data.ds_formmeta_errorsource);
    }

  , 'Test checkboxes min/max'
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?customemailvalidator=1');
      setRequiredFields();
      let formhandler = FormBase.getForNode($qS('#coreform'));

      //1 + 3 are now checked
      test.click('#coretest-checkboxes-2'); //adding 2 to the set
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');

      let formevents = test.getPxlLog(/^publisher:form.*/);
      test.eq(2, formevents.length, "Should be two PXL events now - one for start and one for failure");
      test.eq("publisher:formfailed", formevents[1].event);
      test.eq("checkboxes", formevents[1].data.ds_formmeta_errorfields);
      test.eq("client", formevents[1].data.ds_formmeta_errorsource);

      let checkboxgroup = dompack.closest($qS('#coretest-checkboxes-2'), '.wh-form__fieldgroup');
      test.true(domfocus.hasFocus(test.qS('#coretest-checkboxes-1')), "first focusable checkbox of this group should receive focus");
      test.eq('Kies maximaal 2 items.', checkboxgroup.querySelector('.wh-form__error').textContent);

      test.click('#coretest-checkboxes-3'); //deselecting #3
      await test.wait('ui'); //checkboxes don't update until UI is open (because it uses a validation handler) so wait for it..
      test.eq('', checkboxgroup.querySelector('.wh-form__error').textContent);

      test.click('#coretest-checkboxes-3'); //selecting #3 - now expecting immediate responses
      await test.wait('ui');
      test.eq('Kies maximaal 2 items.', checkboxgroup.querySelector('.wh-form__error').textContent);

      test.click('#coretest-checkboxes-3'); //selecting #3 - now expecting immediate responses
      test.click('#coretest-checkboxes-2'); //selecting #3 - now expecting immediate responses
      test.click('#coretest-checkboxes-1'); //selecting #3 - now expecting immediate responses
      await test.wait('ui');
      test.eq('Kies minimaal 1 item.', checkboxgroup.querySelector('.wh-form__error').textContent);
      let result = await formhandler.validate(checkboxgroup);
      test.eq(checkboxgroup, result.firstfailed);
      test.true(result.failed.length==1);

      delete checkboxgroup.dataset.whMin; // Removing required number of selected checkboxes
      result = await formhandler.validate(checkboxgroup);
      test.eq(null, result.firstfailed);
      test.true(result.failed.length==0);

      test.click('#coretest-checkboxesvisible');
      test.qS('#coreformsubmitresponse').textContent='';
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');

      test.true(JSON.parse(test.qS('#coreformsubmitresponse').textContent).form.agree, "expected successful submit");

      formevents = test.getPxlLog(/^publisher:form.*/);
      test.eq(3, formevents.length, "Should be three PXL events now - one for start, one for failure and one for submission");
      test.eq("publisher:formsubmitted", formevents[2].event);
    }

  ,'Test server side errors'
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/');
      setRequiredFields();

      //set a rejected password
      test.fill("#coretest-password", "secret");

      test.click(test.qS('#submitbutton'));
      await test.wait('ui');

      if(test.qS("#coretest-password").value != "secret")
      {
        console.error('YOUR PASSWORD MANAGER CHANGED THE PASSWORD!\n\n'
                      + `  For LastPass: Go to the LastPass Vault > Account Settings > Never URLs\n`
                      + `  Add the URL ${test.getWin().location.origin}/webhare-testsuite.site/* to the "Never Do Anything" list\n\n`);
        throw new Error("YOUR PASSWORD MANAGER CHANGED THE PASSWORD! disable it!");
      }
      test.true(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
      await test.pressKey('Tab');
      test.true(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"), "should still have error state after tab");
      await test.pressKey('Tab', { shiftKey: true });
      test.qS("#coretest-number").focus();
      test.true(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"), "should still have error state after focus");

      //change it, immediately clears the error
      test.fill("#coretest-password", "secret!");
      test.false(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));

      //submit that, fails again
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.true(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));

      //now set a _different_ field to allow the password
      test.qS("#coretest-number").focus();
      test.fill("#coretest-number", "-2");

      //stil in error, but should go OUT of error after submission
      test.true(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.false(test.qS('[data-wh-form-group-for="password"]').classList.contains("wh-form__fieldgroup--error"));
    }

  , 'Test taking over error handling'
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?captureerrors=1'
    }

  , async function()
    {
      let setvalidatorgroup = dompack.closest($qS('#coretest-setvalidator'), '.wh-form__fieldgroup');
      test.click('#coretest-setvalidator');
      await test.pressKey('Tab');
      await test.wait('ui');
      test.eq("R<a>am", setvalidatorgroup.querySelector('.customerror').textContent);
      test.true(test.qS('#coretest-setvalidator').classList.contains("broken"));

      test.fill('#coretest-setvalidator','richerror');
      test.eq("Rich Error", setvalidatorgroup.querySelector('.customerror a').textContent);
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/'
    }
    //the following tests only test the API (and for compatibility with parlsey). We can get through these tests without actually responding to the user (ie no triggers)
  , { name: 'Test builtin validation API'
    , test: async function (doc,win)
      {
        let formhandler = FormBase.getForNode($qS('#coreform'));
        test.eq(0, $qSA('.wh-form__fieldgroup--error').length, "Form should be initially clean of errors");

        let result;
        result = await formhandler.validate([]); //empty set

        let emailgroup = dompack.closest($qS('#coretest-email'), '.wh-form__fieldgroup');
        test.false(emailgroup.classList.contains('wh-form__fieldgroup--error'));

        //if we set an error before we start validating...
        formhandler.setFieldError($qS('#coretest-email'), 'bad email field');
        //...don't show it. this is more consistent with html5 rendering
        test.false(emailgroup.classList.contains('wh-form__fieldgroup--error'));
        test.false(emailgroup.querySelector('.wh-form__error'));

        //but if we force show it...
        formhandler.setFieldError($qS('#coretest-email'), 'really bad email field', { reportimmediately: true });
        test.true(emailgroup.classList.contains('wh-form__fieldgroup--error'));
        test.eq('really bad email field', emailgroup.querySelector('.wh-form__error').textContent);

        //and we can hide it
        formhandler.setFieldError($qS('#coretest-email'), '');
        test.false(emailgroup.classList.contains('wh-form__fieldgroup--error'));
        test.eq('', emailgroup.querySelector('.wh-form__error').textContent);

        result = await formhandler.validate(emailgroup);
        test.eq($qS('#coretest-email'), result.firstfailed);
        test.true(result.failed.length==1);
        test.true(emailgroup.classList.contains('wh-form__fieldgroup--error'),'email group should be marked as error');
        test.eq('Dit veld is verplicht.', emailgroup.querySelector('.wh-form__error').textContent);

        //test HTML5 custom validation
        result = await formhandler.validate($qS('#coretest-setvalidator'));
        test.false(result.valid, 'setvalidator should be seen as invalid');
        test.eq($qS('#coretest-setvalidator'), result.firstfailed);
        test.true(result.failed.length==1);

        //test custom errors
        $qS('#coretest-email').value='klaas@example.org';
        result = await formhandler.validate(emailgroup);
        test.true(result.valid);
        test.false(emailgroup.classList.contains('wh-form__fieldgroup--error'),'email group should not be marked as error');

        formhandler.setFieldError($qS('#coretest-email'), 'bad email field', { reportimmediately: true });
        test.true(emailgroup.classList.contains('wh-form__fieldgroup--error'),'email group should be marked as error after explicit setFieldError');

        result = await formhandler.validate(emailgroup);
        test.true(emailgroup.classList.contains('wh-form__fieldgroup--error'),'revalidation may not clear explicit errors, as they have no callback to restore erros');

        formhandler.setFieldError($qS('#coretest-email'), null);
        test.false(emailgroup.classList.contains('wh-form__fieldgroup--error'),'email group should be unmarked as error');
        $qS('#coretest-email').value='';

        // Test disabling by condition clearing validation errors
        test.fill("#coretest-condition_not", true);
        test.click(test.qS('#coretest-condition_not_required'));
        test.click(test.qS('#coretest-condition_not_enabled'));
        test.true(test.qS('#coretest-condition_not_required').classList.contains('wh-form__field--error'));
        test.fill("#coretest-condition_not", false);
        await test.wait('ui');
        test.false(test.qS('#coretest-condition_not_required').classList.contains('wh-form__field--error'));
      }
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?scrollzone=1'
    }

  , { name: 'Test built-in validation far away validation'
    , test: function (doc,win)
      {
        win.scrollTo(0,doc.documentElement.scrollHeight - win.innerHeight);
        test.false(test.canClick($qS('#coretest-email')), '#coretest-email should be out of sight');
        test.click($qS('.validatebutton'));
      }
    , waits: ['ui']
    }
  , { test: function (doc,win)
      {
        test.true(test.canClick($qS('#coretest-email')), '#coretest-email should be back in of sight');
        test.true(domfocus.hasFocus($qS('#coretest-email')),'#coretest-email should have focus');
      }
    }

  , { name: 'Test built-in validation not validating custom validated fields - SUBMIT button'
    , loadpage: test.getTestSiteRoot() + 'testpages/formtest/'
    }

  , async function (doc,win)
    {
      let setvalidatorgroup = dompack.closest($qS('#coretest-setvalidator'), '.wh-form__fieldgroup');
      test.false(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'));

      test.fill(test.qS('#coretest-email'),'pietje@example.com');
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');

      test.true(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'), 'setvalidator not marked as failed');
      //make sure parlsey isn't causing injection errors
      test.eq("R<a>am", setvalidatorgroup.querySelector('.wh-form__error').textContent);
    }

  , { name: 'Test built-in validation not validating custom validated fields - VALIDATE button'
    , loadpage: test.getTestSiteRoot() + 'testpages/formtest/'
    }

  , async function (doc,win)
    {
      let setvalidatorgroup = dompack.closest($qS('#coretest-setvalidator'), '.wh-form__fieldgroup');
      test.false(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'));

      test.fill(test.qS('#coretest-email'),'pietje@example.com');
      test.click(test.qS('.validatebutton'));
      await test.wait('ui');

      test.true(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'), 'setvalidator not marked as failed');
    }

  , { name: 'Test rich validation errors'
    , loadpage: test.getTestSiteRoot() + 'testpages/formtest/'
    }

  , async function (doc,win)
    {
      let setvalidatorgroup = dompack.closest($qS('#coretest-setvalidator'), '.wh-form__fieldgroup');
      test.false(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'));

      test.fill(test.qS('#coretest-email'),'pietje@example.com');
      test.fill(test.qS('#coretest-setvalidator'),'richerror');
      test.click(test.qS('.validatebutton'));
      await test.wait('ui');

      test.true(setvalidatorgroup.classList.contains('wh-form__fieldgroup--error'), 'setvalidator not marked as failed');
      test.eq("Rich Error", setvalidatorgroup.querySelector('.wh-form__error').textContent);
      test.eq("Rich Error", setvalidatorgroup.querySelector('.wh-form__error a').textContent);
    }

  , { name: 'Test odd radio validation behaviour'
    , loadpage: test.getTestSiteRoot() + 'testpages/formtest/'
    }
  , async function(doc,win)
    {
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.true(test.qS('[data-wh-form-group-for="requiredradio"]').classList.contains('wh-form__fieldgroup--error'));
      test.click(test.qS('#coretest-requiredradio-y'));
      await test.wait('ui');

      test.false(test.qS('[data-wh-form-group-for="requiredradio"]').classList.contains('wh-form__fieldgroup--error'), "Error should be cleared immediately");
    }

    //load the page without initial checkboxes selected
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?nocheckboxselect=1' }

  , async function()
    {
      test.false(test.qS('[data-wh-form-group-for=checkboxes]').classList.contains("wh-form__fieldgroup--error"));
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.true(test.qS('[data-wh-form-group-for=checkboxes]').classList.contains("wh-form__fieldgroup--error"));
    }

  ]);
