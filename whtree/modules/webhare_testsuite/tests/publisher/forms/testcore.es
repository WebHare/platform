import test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import * as datetime from 'dompack/types/datetime';
import FormBase from '@mod-publisher/js/forms/formbase';

var urlappend = test.getTestArgument(0)=='replacedcomponents' ? '?dompackpulldown=1' : '';

test.registerTests(
  [ 'Study page fields'
  , { test: async function()
      {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/' + urlappend);

        test.eq(0, test.getPxlLog(/^publisher:form.+/).length, "Should be no PXL events yet");

        let form = test.qS("#coreform");
        test.true(form.action.startsWith("javascript:"), "Action should be JavaScript");

        let richtext_h2 = test.qS(".wh-form__fields .wh-form__richtext h2");
        let label_namelijk = test.qS(".wh-form__fields label.wh-form__subfieldlabel[for=coretest-radiotestnamelijk]");
        let label_option1 = test.qS(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-1]");
        let label_option3 = test.qS(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-3]");
        let label_option5 = test.qS(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-5]");
        let field_radio1 = test.qS('#coretest-radiotest-1');
        let field_namelijk = test.qSA("input[name=radiotestnamelijk]");
        let field_radioboolean_dare = test.qSA(".wh-form__fields .wh-form__fieldline input[name=radioboolean]")[1];
        let field_pulldowntest = test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]");
        let field_pulldown2test = test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldown2test]");
        let field_shadetest = test.qS(".wh-form__fields .wh-form__fieldline input[name=shade]");
        let field_text = test.qS(".wh-form__fields .wh-form__fieldline input[name=text]");
        let field_number = test.qS(".wh-form__fields .wh-form__fieldline input[name=number]");
        let field_numberemptyvalue = test.qS(".wh-form__fields .wh-form__fieldline input[name=numberemptyvalue]");
        let field_dateofbirth = test.qS(".wh-form__fields .wh-form__fieldline input[name=dateofbirth]");
        let field_disabledpulldown = test.qS("select[name=disabledpulldowntest]");
        let label_requiredradio = test.qS("label.wh-form__label[for=coretest-requiredradio]");
        let label_disabledpulldown = test.qS("label.wh-form__label[for=coretest-disabledpulldowntest]");
        let label_zwei = test.qS('label.wh-form__optionlabel[for=coretest-checkboxes-2]');
        let label_terms = test.qS('label.wh-form__optionlabel[for=coretest-agree]');
        let label_twcustomselect = test.qS('label.wh-form__label[for="coretest-twolevel.customselect.select"]');
        let field_address_country = test.qS(".wh-form__fields .wh-form__fieldline select[name='address.country']");
        let field_address_street = test.qS(".wh-form__fields .wh-form__fieldline input[name='address.street']");
        let field_address_nr_detail = test.qS(".wh-form__fields .wh-form__fieldline input[name='address.nr_detail']");
        let field_address_province = test.qS(".wh-form__fields .wh-form__fieldline input[name='address.province']");
        let field_address_zip = test.qS(".wh-form__fields .wh-form__fieldline input[name='address.zip']");
        let field_address_city = test.qS(".wh-form__fields .wh-form__fieldline input[name='address.city']");
        let field_condition_or_1 = test.qS("input[name='condition_or_1']");
        let field_condition_or_2 = test.qS("input[name='condition_or_2']");
        let field_condition_or_visible = test.qS("input[name='condition_or_visible']");
        let field_condition_and_1 = test.qS("input[name='condition_and_1']");
        let field_condition_and_2 = test.qS("input[name='condition_and_2']");
        let field_condition_and_visible = test.qS("input[name='condition_and_visible']");
        let field_condition_not = test.qS("input[name='condition_not']");
        let field_condition_not_enabled = test.qS("input[name='condition_not_enabled']");
        let field_condition_not_required = test.qS("input[name='condition_not_required']");
        let field_matchattributes_type1 = test.qS("input[name='matchattributes_type1']");
        let field_matchattributes_type2_true = test.qS("input[name='matchattributes_type2_true']");
        let field_matchattributes_type2_false = test.qS("input[name='matchattributes_type2_false']");

        test.eq(null, test.qS('#coretest-nevervisible'), 'static invisible field should be');
        test.eq(null, test.qS('#coretest-invisible'), 'dynamic invisible field should be');
        test.eq('secret', test.qS("#coretest-password").placeholder);
        test.eq("before &lt;richtext&gt; inhoud vanuit tid after", richtext_h2.innerHTML);
        test.eq(dompack.closest(field_matchattributes_type2_false, ".wh-form__fieldgroup"), dompack.closest(richtext_h2, ".wh-form__fieldgroup").previousSibling);
        test.true(label_namelijk, 'missing label namelijk - forms did not render extra field?');
        test.eq("<u>name</u>lijk", label_namelijk.innerHTML);
        test.eq(1, field_namelijk.length, 'namelijk must appear exactly once');
        test.true(field_namelijk[0], 'missing field namelijk - forms did not render extra field?');
        test.true(label_option3, 'missing option3 - forms did not update?');
        test.false(dompack.closest(label_option3, '.wh-form__fieldline').classList.contains("wh-form__fieldline--subfields"), "option 3 shouldn't be marked as having a subfield");
        test.true(dompack.closest(label_option1, '.wh-form__fieldline').classList.contains("wh-form__fieldline--subfields"), "option 1 should be marked as having a subfield");
        test.true(dompack.closest(label_option5, '.wh-form__fieldline').classList.contains("wh-form__fieldline--subfields"), "option 5 should be marked as having a subfield");

        test.true(field_radioboolean_dare, 'missing field radioboolean_dare');
        test.true(field_pulldowntest, 'missing field pulldown');
        test.eq('Maak een selectie', field_pulldowntest.querySelector("option").textContent);
        test.true(field_text.disabled);
        test.true(field_radio1.required, 'radio1 must be required!');
        test.true(test.qS('[data-wh-form-group-for="requiredradio"]').classList.contains("wh-form__fieldgroup--required"));
        test.false(test.qS('[data-wh-form-group-for="requiredradio"]').classList.contains("wh-form__fieldgroup--error"), "Should NOT be initially validated");
        test.true(label_requiredradio, 'need to find requiredradio');
        let twcustomselectgroup = dompack.closest(label_twcustomselect,'.wh-form__fieldgroup');
        test.true(twcustomselectgroup.classList.contains("wh-testsuite-twolevel-groupclasses"));
        test.true(twcustomselectgroup.classList.contains("wh-testsuite-customselect-groupclasses"));
        test.eq('TW Customselect', label_twcustomselect.textContent);
        test.eq('with the terms.', label_terms.textContent);
        test.true(label_terms.querySelector('a'), 'must have hyperlink in "agree terms" label');
        test.eq('http://www.example.net/terms', label_terms.querySelector('a').href);
        test.eq('Required&;Radio', label_requiredradio.textContent); //should not be decoded
        test.eq('<b>Disabled</b> pulldown', label_disabledpulldown.innerHTML);
        test.eq('Z<i>wei</i>', label_zwei.innerHTML);
        test.eq('number', field_number.type);
        test.eq('-2', field_number.min);
        test.eq('2', field_number.max);
        test.eq('0', field_number.value);
        test.eq('', field_numberemptyvalue.value);

        test.eq('21', field_namelijk[0].value);
        test.eq('coretest-radiotestnamelijk', field_namelijk[0].id);
        test.eq('false', field_radioboolean_dare.value);
        test.true(field_radioboolean_dare.checked);
        test.eq('radio', field_radioboolean_dare.type);

        test.true(field_pulldowntest.required);
        test.eq('1764', field_pulldowntest.querySelector('optgroup').dataset.universe);
        test.eq(3, field_pulldowntest.querySelector('optgroup').childNodes.length, 'first optgroup (below 5) should have 3 elements');
        test.eq('test-x', field_pulldowntest.options[1].dataset.x);
        test.eq('{"z":42}', field_pulldowntest.options[1].dataset.y_y);
        test.eq('red', field_pulldown2test.value); //not sure if this is cross browser yet?
        test.false(field_pulldowntest.options[2].disabled);
        test.eq('2', field_pulldowntest.options[2].value);
        test.true(field_pulldowntest.options[3].disabled);
        test.eq('', field_pulldowntest.options[3].value); //disabled option lose their values so 'required' works

        test.eq("PlaceHolder", test.qS("#coretest-setvalidator").placeholder);
        test.eq("Type a text in this area", test.qS("textarea[name=textarea]").placeholder);

        test.true(field_shadetest.disabled, "shade of green should be disabled initially");
        test.fill(field_pulldown2test, "green");
        test.false(field_shadetest.disabled, "shade of green should be enabled now");
        test.fill(field_pulldown2test, "red");
        test.true(field_shadetest.disabled, "shade of green should be disabled again");

        let field_pulldowntest_options = field_pulldowntest.querySelectorAll('option');
        test.true(field_pulldowntest_options[0].selected);
        test.true(field_pulldowntest_options[0].disabled);
        test.eq('', field_pulldowntest_options[0].value);

        test.true(test.qS('#coretest-email').required);
        test.true(dompack.closest(test.qS('#coretest-email'), '.wh-form__fieldgroup').classList.contains('wh-form__fieldgroup--required'));
        test.true(test.qS('#coretest-radiotest-3').required);
        test.true(dompack.closest(test.qS('#coretest-radiotest-3'), '.wh-form__fieldgroup').classList.contains('wh-form__fieldgroup--required'));

        test.true(test.qS("[data-wh-form-group-for=checkboxes]").classList.contains("wh-form__fieldgroup--required"), "checkbox group should be marked as required, as min=1");

        test.eq('1900-01-01', test.qS('#coretest-dateofbirth').min);
        test.eq(datetime.getISOLocalDate(new Date(Date.now() + 2*86400*1000)), test.qS('#coretest-dateofbirth').value);
        test.eq(datetime.getISOLocalDate(new Date(Date.now() + 5*86400*1000)), test.qS('#coretest-dateofbirth').max);

        test.true(dompack.closest(field_dateofbirth,'.wh-form__fieldgroup').classList.contains('ut-dateofbirth'));

        //test group dataset
        test.eq('rabbit', dompack.closest(test.qS('#coretest-email'), '.wh-form__fieldgroup').dataset.bunny);
        test.eq({y:false}, JSON.parse(test.qS('.radioboolean').dataset.x));

        test.true(field_disabledpulldown);
        test.true(field_disabledpulldown.disabled);
        test.false(field_disabledpulldown.options[0].disabled);
        test.eq('touch', field_disabledpulldown.value);
        test.eq("", test.qS('#coreformsubmitresponse').textContent, "expected no submission");

        test.true(field_address_country);
        test.eq('', field_address_country.value); // Empty initially
        test.fill(field_address_country, "NL");
        test.true(test.canClick(field_address_street), "street should be available");
        test.false(test.canClick(field_address_province), "province should not be available");
        test.fill(field_address_country, "BE");
        test.true(test.canClick(field_address_street), "street should still be available");
        test.true(test.canClick(field_address_province), "province should now be available");

        // fill in BE address
        test.fill(field_address_country, "NL");
        test.fill(field_address_street, "Hengelosestraat");
        test.fill(field_address_nr_detail, "296");
        test.fill(field_address_zip, "7521AM");
        test.fill(field_address_city, "Enschede");

        test.getWin().scrollTo(0,field_condition_or_1.getBoundingClientRect().top);
        test.false(test.canClick(field_condition_or_visible), "condition OR textedit initially not visible");
        field_condition_or_1.click();
        test.true(test.canClick(field_condition_or_visible), "condition OR textedit now visible because of checkbox 1");
        field_condition_or_1.click();
        test.false(test.canClick(field_condition_or_visible), "condition OR textedit not visible again");
        field_condition_or_2.click();
        test.true(test.canClick(field_condition_or_visible), "condition OR textedit now visible because of checkbox 2");
        field_condition_or_2.click();
        test.false(test.canClick(field_condition_or_visible), "condition OR textedit no longer visible");
        field_condition_or_1.click();
        field_condition_or_2.click();
        test.true(test.canClick(field_condition_or_visible), "condition OR textedit now visible because of both checkbox 1 and checkbox 2");
        field_condition_or_1.click();
        field_condition_or_2.click();
        test.false(test.canClick(field_condition_or_visible), "condition OR textedit finally not visible");

        test.false(test.canClick(field_condition_and_visible), "condition AND textedit initially not visible");
        field_condition_and_1.click();
        test.false(test.canClick(field_condition_and_visible), "condition AND textedit not visible because of checkbox 2");
        field_condition_and_2.click();
        test.true(test.canClick(field_condition_and_visible), "condition AND textedit now visible because of both checkbox 1 and checkbox 2");
        field_condition_and_1.click();
        test.false(test.canClick(field_condition_and_visible), "condition AND textedit not visible because of checkbox 1");
        field_condition_and_2.click();
        test.false(test.canClick(field_condition_and_visible), "condition AND textedit finally not visible");

        test.false(field_condition_not_enabled.required);
        test.false(test.canFocus(field_condition_not_enabled), "condition NOT textedit-enabled initially not enabled");
        test.false(field_condition_not_enabled.required, "condition NOT textedit-enabled initially not required");
        test.false(dompack.closest(field_condition_not_enabled, '.wh-form__fieldgroup').classList.contains("wh-form__fieldgroup--required"), "and its group shouldnt be marked as required");
        test.false(field_condition_not_required.required, "condition NOT textedit-required initially not required");
        test.false(dompack.closest(field_condition_not_required, '.wh-form__fieldgroup').classList.contains("wh-form__fieldgroup--required"), "and its group shouldnt be marked as required");
        field_condition_not.click();
        test.true(test.canFocus(field_condition_not_enabled), "condition NOT textedit-enabled now enabled because of checkbox");
        test.true(field_condition_not_enabled.required, "condition NOT textedit-enabled now required");
        test.true(dompack.closest(field_condition_not_enabled, '.wh-form__fieldgroup').classList.contains("wh-form__fieldgroup--required"), "and its group should now be marked as required");
        test.true(field_condition_not_required.required, "condition NOT textedit-required now required");
        test.true(dompack.closest(field_condition_not_required, '.wh-form__fieldgroup').classList.contains("wh-form__fieldgroup--required"), "and its group should now be marked as required");
        test.true(field_condition_not_enabled.required);
        field_condition_not.click();
        test.false(test.canFocus(field_condition_not_enabled), "condition NOT textedit-enabled finally not enabled");
        test.false(field_condition_not_enabled.required, "condition NOT textedit-enabled no longer required");
        test.false(dompack.closest(field_condition_not_enabled, '.wh-form__fieldgroup').classList.contains("wh-form__fieldgroup--required"), "and its group should no longer be marked as required");
        test.false(field_condition_not_required.required, "condition NOT textedit-required no longer required");
        test.false(dompack.closest(field_condition_not_required, '.wh-form__fieldgroup').classList.contains("wh-form__fieldgroup--required"), "and its group should no longer be marked as required");

        test.true(dompack.closest(field_matchattributes_type1,".wh-form__fieldgroup").classList.contains("wh-testsuite-matchattributes-type1"));
        test.true(dompack.closest(field_matchattributes_type2_true,".wh-form__fieldgroup").classList.contains("wh-testsuite-matchattributes-type2-true"));
        test.true(dompack.closest(field_matchattributes_type2_false,".wh-form__fieldgroup").classList.contains("wh-testsuite-matchattributes-type2-false"));

        let formevents = test.getPxlLog(/^publisher:form.+/);
        test.eq(1, formevents.length, "Should be one PXL event now");
        test.eq("publisher:formstarted", formevents[0].event);
      }
    }

  , "Test data-wh-group-for"
  , async function()
    {
      let optselect5_group = dompack.closest(test.qS("#coretest-opt5_select"), '.wh-form__fieldgroup');
      test.eq("radiotest radiotestnamelijk opt5_select opt5_textedit", optselect5_group.dataset.whFormGroupFor);

      let field_address_street = test.qS(".wh-form__fields .wh-form__fieldline input[name='address.street']");
      let field_address_streetgroup = dompack.closest(field_address_street, '.wh-form__fieldgroup');
      test.eq("address.street", field_address_streetgroup.dataset.whFormGroupFor);
    }


  , { name: 'Test formapis'
    , test: async function()
      {
        let formhandler = FormBase.getForNode(test.qS('#coreform'));
        test.true(formhandler, 'no formhandler available');

        //test the form APIs
        let radioopts = formhandler.getOptions('radioboolean');
        test.eq(2, radioopts.length);
        test.true(radioopts[0].fieldline);
        test.eq('coretest-radioboolean-true', radioopts[0].inputnode.id);

        let opts = formhandler.getSelectedOptions('radioboolean');
        test.eq(1,opts.length);
        test.eq('coretest-radioboolean-false', opts[0].inputnode.id);

        test.eq(1, formhandler.getSelectedOptions('radiotest').length);

        test.eq('coretest-radiotest-3', formhandler.getSelectedOption('radiotest').inputnode.id);
        test.eq('3', formhandler.getValue('radiotest'));
        test.eq('false', formhandler.getValue('radioboolean'));

        let radiotestfieldgroup = formhandler.getFieldGroup('radiotest');
        test.true(radiotestfieldgroup);
        test.true(radiotestfieldgroup.classList.contains('wh-form__fieldgroup--radiogroup'));
        test.false(radiotestfieldgroup.classList.contains("wh-form__fieldgroup--horizontal"));
        test.eq(0, radiotestfieldgroup.querySelectorAll(".wh-form__optiondata--horizontal").length);
        test.eq(4, radiotestfieldgroup.querySelectorAll(".wh-form__optiondata--vertical").length);
        test.eq(4, radiotestfieldgroup.querySelectorAll(".wh-form__optiondata.wh-form__optiondata--vertical").length);

        let emailfieldgroup = formhandler.getFieldGroup('email');
        test.true(emailfieldgroup);
        test.true(emailfieldgroup.classList.contains('wh-form__fieldgroup--textedit'));

        test.eq(null, formhandler.getFieldGroup('bestaatniet'));

        let horizontalgroup = formhandler.getFieldGroup('horizontalradio');
        test.true(horizontalgroup.classList.contains("wh-form__fieldgroup--horizontal"));
        test.eq(0, horizontalgroup.querySelectorAll(".wh-form__optiondata--vertical").length);
        test.eq(2, horizontalgroup.querySelectorAll(".wh-form__optiondata--horizontal").length);
        test.eq(2, horizontalgroup.querySelectorAll(".wh-form__optiondata.wh-form__optiondata--horizontal").length);

        //test retrieving the api. should not return the unnamed fields
        let result = await formhandler.getFormValue();
        test.false("" in result);
      }
    }

  , { name: 'Study page flexlayout' //study als in 'bestudeer de layout'
    , test: function()
      {
        //also test stability of DOM by making selectors as explicit as posbible
        let label_option1 = test.qS(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-1]");
        let label_namelijk = test.qS(".wh-form__fields label.wh-form__subfieldlabel[for=coretest-radiotestnamelijk]");

        test.true(label_option1, 'missing option1');
        test.true(label_namelijk, 'missing namelijk');

        //'namelijk' should be right of option1
        test.true(label_option1.getBoundingClientRect().right <= label_namelijk.getBoundingClientRect().left, "'namelijk' should be to the right of 'option1'");
      }
    }
  , async function()
    {
      let label_option4 = test.qS(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-4]");
      let field_pulldowntest = test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]");

      let formnode = test.qS('#coreform');
      test.false((await FormBase.getForNode(formnode).validate()).valid);

      label_option4.click();
      test.click('#coretest-requiredradio-x');
      test.fill(test.qS('#coretest-email'),'pietje@example.com');
      test.false((await FormBase.getForNode(formnode).validate()).valid);

      field_pulldowntest.selectedIndex=2;
      test.eq('2', field_pulldowntest.value);
      test.false((await FormBase.getForNode(formnode).validate()).valid);
      test.fill(test.qS('#coretest-agree'), true);
      test.false((await FormBase.getForNode(formnode).validate()).valid);

      test.fill(test.qS('#coretest-setvalidator'), 'raam');
      test.false((await FormBase.getForNode(formnode).validate()).valid);

      test.fill(test.qS('#coretest-setvalidator'), 'roos');
      test.true((await FormBase.getForNode(formnode).validate()).valid);

      test.fill(test.qS('#coretest-dateofbirth'), '2099-01-01');
      test.false((await FormBase.getForNode(formnode).validate()).valid, 'Date checkValidity failed (perhaps the date validation polyfill broke)');

      test.fill(test.qS('#coretest-dateofbirth'), '1979-06-13');
      test.true((await FormBase.getForNode(formnode).validate()).valid);
      test.fillUpload(test.qS('#coretest-upload'), [{filename: 'test.txt', mimetype: 'application/octet-stream', data:'This is a text file'}]);

      let field_pulldown2test = test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldown2test]");
      field_pulldown2test.selectedIndex=2;
      test.eq('blue', field_pulldown2test.value);

      // fill address
      test.fill('#coretest-address\\.country', "NL");
      test.fill("#coretest-address\\.nr_detail", "296");
      test.fill("#coretest-address\\.zip", "7521AM");

      // fill the stray field, should not block
      test.fill("[name=strayfield]", "wedontlikeyou@block.beta.webhare.net");

      //submit it
      test.eq("", test.qS('#coreformsubmitresponse').textContent, "expected no submission");
      test.click(test.qS('#submitbutton'));

      await test.wait('ui');
    }
  , { test: function()
      {
        test.eq("pietje@example.com", test.qS("#lastsuccessfulsubmit").textContent);

        let formevents = test.getPxlLog(/^publisher:form.+/);
        test.eq(2, formevents.length, "Should be two PXL events now");
        test.eq("publisher:formsubmitted", formevents[1].event);

        let serverresponse = JSON.parse(test.qS('#coreformsubmitresponse').textContent);

        test.false(serverresponse.form["address.city"]);
        test.eq("Enschede", serverresponse.form.address.city);

        test.eq(43, serverresponse.ok);
        test.eq('pietje', serverresponse.email);
        test.eq('pietje@example.com', serverresponse.form.email);
        test.eq(4, serverresponse.form.radiotest);

        test.eq('test.txt', serverresponse.form.upload.filename);
        test.eq('This is a text file', serverresponse.form.upload.data);
        test.eq('text/plain', serverresponse.form.upload.mimetype);
        test.eq('.txt', serverresponse.form.upload.extension);
        test.eq(0, serverresponse.form.upload.width);

        test.eq(0, serverresponse.form.number);
        test.false(serverresponse.form.radioboolean);
        test.eq('blue', serverresponse.form.pulldown2test);
        test.eq('1979-06-13T00:00:00.000Z', serverresponse.form.dateofbirth);
      }
    }

  , "serverside error handling"
  , async function()
    {
      let passwordgroup = dompack.closest(test.qS('#coretest-password'), '.wh-form__fieldgroup');
      test.false(passwordgroup.classList.contains('wh-form__fieldgroup--error')); //this field is in error
      test.eq(null, passwordgroup.querySelector('.wh-form__error') );

      test.fill(test.qS('#coretest-password'),' secret');
      test.qS('#coreformsubmitresponse').textContent = '';
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');
      test.eq("", test.qS('#coreformsubmitresponse').textContent, "expected no submission");

      passwordgroup = dompack.closest(test.qS('#coretest-password'), '.wh-form__fieldgroup');
      test.true(passwordgroup.classList.contains('wh-form__fieldgroup--error')); //this field is in error

      let errors = passwordgroup.querySelector('.wh-form__error');
      test.true(errors);
      test.eq("'secret' is a bad password", errors.textContent);
    }
  , { name: 'test RPC'
    , test: function()
      {
        test.click('#coretest-email');
        test.click('.prefillbutton');
      }
    , waits:['ui']
    }
  , { name: 'test RPC response'
    , test: function()
      {
        test.eq('pietje+test@example.com', test.qS('#coretest-email').value);
        test.eq('2000-01-01', test.qS('#coretest-dateofbirth').value);
      }
    }
  , 'Test disabled fields'
  , async function()
    {
      test.fill(test.qS('#coretest-password'),'acceptable');
      test.qS('#coretest-disabledpulldowntest').disabled = false;
      test.qS('#coretest-disabledpulldowntest').value = "cant";

      let formhandler = FormBase.getForNode(test.qS('#coreform'));

      //we'll also test the 'extra submit data' passed to .submit see if it work
      await formhandler.submit({submitextradata:5542});

      test.eq('cant', JSON.parse(test.qS('#coreformsubmitresponse').textContent).form.disabledpulldowntest, "server update the disabled value, form handler should take care of this");
      test.eq(5542, JSON.parse(test.qS('#coreformsubmitresponse').textContent).extradata.submitextradata);
    }

  , 'Test unlocking disabled fields'
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/' + urlappend);

      //quickfill fields so we can submit
      test.fill(test.qS('#coretest-agree'), true);
      test.fill(test.qS('#coretest-email'),'pietje@example.com');
      test.fill(test.qS('#coretest-setvalidator'),'validated');
      test.click('#coretest-requiredradio-x');
      test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex=2;
      test.fill('#coretest-address\\.country', "NL");
      test.fill("#coretest-address\\.nr_detail", "296");
      test.fill("#coretest-address\\.zip", "7521AM");

      // Update the value of the disabled pulldown from "touch" to "this"
      test.qS('#coretest-disabledpulldowntest').selectedIndex = 2;
      test.click('#submitbutton');
      await test.wait('ui');

      let serverresponse = JSON.parse(test.qS('#coreformsubmitresponse').textContent);
      test.eq("touch", serverresponse.form.disabledpulldowntest); // disabled select value isn't sent to server
    }

  , "Test URL preload and slow submission"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?email=joop%40beta.webhare.net&text=Text&opt5_textedit=opt5&opt5_select=BANK2&radiotest=5&disabledpulldowntest=this&checkboxes=2&checkboxes=3&checkboxes=nonexistent&submitsleep=6000' + urlappend);
      test.eq("joop@beta.webhare.net", test.qS('[name=email]').value);
      test.eq("", test.qS('[name=text]').value);
      test.true(test.qS('[name="radiotest"][value="5"]').checked);
      test.true(test.qS('[name=opt5_select] [value=BANK2]').selected);
      test.eq("opt5", test.qS('[name=opt5_textedit]').value);
      test.false(test.qS('[name=checkboxes][value="1"]').checked);
      test.true(test.qS('[name=checkboxes][value="2"]').checked);
      test.true(test.qS('[name=checkboxes][value="3"]').checked);

      //Fill the remaining required fields so we can submit
      test.fill(test.qS('#coretest-setvalidator'),'validated');
      test.click('#coretest-requiredradio-x');
      test.qS(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex=2;
      test.fill('#coretest-address\\.country', "NL");
      test.fill("#coretest-address\\.nr_detail", "296");
      test.fill("#coretest-address\\.zip", "7521AM");
      test.qS('#coretest-disabledpulldowntest').selectedIndex = 2;
      test.fill(test.qS('#coretest-agree'), true);
      test.click(test.qS('#submitbutton'));
      await test.wait('ui');

      test.eq(3, test.getPxlLog(/^publisher:form.+/).length, "Should be 3 PXL events...");
      test.eq("publisher:formslow", test.getPxlLog(/^publisher:form.+/)[1].event, 'middle event should be "slow" warning');
    }
  ]);
