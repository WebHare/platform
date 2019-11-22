import test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import * as domfocus from '@mod-system/js/dom/focus';

var setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'BuildWebtoolForm', { addcheckboxfield: true, addconditions: true, checkboxes:true, addtwolevelfield: true, checkboxsubs:true, custommergefields:true });
    }

  , { loadpage: function() { return setupdata.url; }
    }

  , 'Test conditional'
  , async function()
    {
      test.true(dompack.closest(test.qS('input[name="firstname"]'),'.wh-form__fieldgroup').classList.contains('wh-form__fieldgroup--required'), "firstname should be required");

      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');
      test.true(domfocus.hasFocus(test.qS('input[name="firstname"]')), "firstname should be focused");

      test.click(test.qSA('[name=checkboxfield]')[0]);
      test.click(test.qSA('[type=submit]')[0]);
    }

  , { loadpage: function() { return setupdata.url; }
    }

  , 'Test hiding'
  , async function()
    {
      test.true(test.canClick(test.qS('input[name="firstname"]')), "firstname should be clickable");
      test.click(test.qSA('[name=hidefirstname]')[0]);
      test.false(test.canClick(test.qS('input[name="firstname"]')), "firstname should no longer be clickable");
      test.click(test.qSA('[name=hidefirstname]')[0]);
      test.true(test.canClick(test.qS('input[name="firstname"]')), "firstname should be clickable again");
      test.click(test.qSA('[name=hidefirstname]')[0]);

      test.true(test.qS('*[data-wh-form-group-for="twolevel.customselect.select"]').classList.contains("wh-form__fieldgroup--hidden"), "custom select should be initially hidden");
      test.true(test.qS('*[data-wh-form-group-for="twolevel.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should be initially hidden");
      test.click('#webtoolform-showtwolevelcomp');
      test.false(test.qS('*[data-wh-form-group-for="twolevel.customselect.select"]').classList.contains("wh-form__fieldgroup--hidden"), "custom select should now be visible");
      test.true(test.qS('*[data-wh-form-group-for="twolevel.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should still be hidden");
      test.fill('select[name="twolevel.customselect.select"]', "abc");
      test.false(test.qS('*[data-wh-form-group-for="twolevel.textedit"]').classList.contains("wh-form__fieldgroup--hidden"), "custom textedit should now be visible");

      test.true(test.canClick('input[name="checkboxes"][value="copt3"]'), "CheckBoxOpt3 should be clickable");
      test.click('input[name="checkboxes"][value="copt3"]');
      test.true(test.canClick('input[name="coptsub3"]'), "CheckBoxOpt3 Subfield should be clickable");

      test.click('input[name="togglesomeoptions"]');
      test.false(test.canClick('input[name="checkboxes"][value="copt3"]'), "CheckBoxOpt3 should no longer be clickable");

      test.false(test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should not be hidden");
      let extraoptions = test.qS('select[name="extraoptions.select"]');
      dompack.changeValue(extraoptions, 2);
      test.false(test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should still not be hidden");
      dompack.changeValue(extraoptions, 3);
      test.true(test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should be hidden now");
      dompack.changeValue(extraoptions, 1);
      test.false(test.qS('*[data-wh-form-group-for="extrafield"]').classList.contains("wh-form__fieldgroup--hidden"), "extrafield should be visible again");

      test.click(test.qSA('[type=submit]')[0]);

      // The thankyou node is only filled after submission, so check for the empty richtext node
      let thankyou = test.qSA('.wh-form__page[data-wh-form-pagerole="thankyou"] .wh-form__fieldgroup[data-wh-form-group-for="thankyou"] .wh-form__richtext');
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.eq("", thankyou[0].textContent, "Thankyou node should be empty");

      await test.wait('ui');

      // The thankyou node is now filled
      thankyou = test.qSA('h1').filter(node => node.textContent=="Thank you!");
      test.eq(1, thankyou.length, "Cannot find thankyou node");
   }

  , { loadpage: function() { return setupdata.url; }
    }
  , 'Test disabling'
  , async function()
    {
      test.true(test.qS('input[name="conditionhas"]').disabled, "condition HAS should be disabled as the 'other' option isn't enabled");
      test.true(test.qS('input[name="conditionis"]').disabled, "condition IS should be disabled as the 'other' option isn't enabled");

      test.click(test.qSA('[name=enablefirstname][value=otheroption]')[0]);
      test.false(test.qS('input[name="firstname"]').disabled, "clicking the 'other' option should have no effect on disabling firstname");
      test.false(test.qS('input[name="conditionhas"]').disabled, "condition HAS should now be enabled");
      test.false(test.qS('input[name="conditionis"]').disabled, "condition IS should now be enabled");

      test.click(test.qSA('[name=enablefirstname][value=thirdoption]')[0]);
      test.false(test.qS('input[name="firstname"]').disabled, "clicking the 'third' option should have no effect on disabling firstname");
      test.false(test.qS('input[name="conditionhas"]').disabled, "clicking the 'third' option should have no effect on disabling condition HAS");
      test.true(test.qS('input[name="conditionis"]').disabled, "condition IS should now be disabled as the 'third' option is enabled");

      test.click(test.qSA('[name=enablefirstname][value=enablefirstname]')[0]);
      test.true(test.qS('input[name="firstname"]').disabled, "firstname should be disabled");
      test.click(test.qSA('[type=submit]')[0]);

      // The thankyou node is only filled after submission, so check for the empty richtext node
      let thankyou = test.qSA('.wh-form__page[data-wh-form-pagerole="thankyou"] .wh-form__fieldgroup[data-wh-form-group-for="thankyou"] .wh-form__richtext');
      test.eq(1, thankyou.length, "Cannot find thankyou node");
      test.eq("", thankyou[0].textContent, "Thankyou node should be empty");
    }

  , { loadpage: function() { return setupdata.url; }
    }

  , 'Test group dependencies'
  , async function()
    {
      test.false(test.canClick(test.qS('input[name="phone"]')), "phone should not be visible");
      test.false(test.canClick(test.qS('input[name="mobile"]')), "mobile should not be visible");
      test.click(test.qS('[name=showcontact]'));
      test.true(test.canClick(test.qS('input[name="phone"]')), "phone should now be visible");
      test.false(test.canClick(test.qS('input[name="mobile"]')), "mobile should still not be visible");
      test.click(test.qS('[name=showmobile]'));
      test.true(test.canClick(test.qS('input[name="phone"]')), "phone should still be visible");
      test.true(test.canClick(test.qS('input[name="mobile"]')), "mobile should now be visible");
    }

  , 'Test case sensitivity'
  , async function()
    {
      test.true(test.qS('input[name="sensitivetarget"]').disabled, "sensitivetarget should be disabled");
      test.true(test.qS('input[name="insensitivetarget"]').disabled, "insensitivetarget should be disabled");
      test.fill(test.qS('input[name="sourcetext"]'), "test");
      test.true(test.qS('input[name="sensitivetarget"]').disabled, "sensitivetarget should be disabled");
      test.false(test.qS('input[name="insensitivetarget"]').disabled, "insensitivetarget should be enabled");
      test.fill(test.qS('input[name="sourcetext"]'), "Test");
      test.false(test.qS('input[name="sensitivetarget"]').disabled, "sensitivetarget should be enabled");
      test.false(test.qS('input[name="insensitivetarget"]').disabled, "insensitivetarget should be enabled");
    }

  , 'Test composed required'
  , async function()
    {
      test.false(test.qS('.wh-form__fieldgroup[data-wh-form-group-for="reversed.text"]').classList.contains('wh-form__fieldgroup--required'));
      test.click(test.qS('[name=requirereversed]'));
      test.true(test.qS('.wh-form__fieldgroup[data-wh-form-group-for="reversed.text"]').classList.contains('wh-form__fieldgroup--required'), "reversed should be required");
    }
  ]);
