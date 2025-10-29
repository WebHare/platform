import * as test from '@mod-system/js/wh/testframework';
import { getPxlLogLines } from "@webhare/test-frontend";
import * as datetime from 'dompack/types/datetime';
import type { AddressValue } from "@webhare/address";
import { getFormData, getFormHandler, type FormBase } from '@webhare/forms';

const urlappend = test.getTestArgument(0) === 'replacedcomponents' ? '?dompackpulldown=1' : '';

function quickFillDefaultRequiredFields() {
  //fill required fields so we can submit
  test.fill('#coretest-agree', true);
  test.fill('#coretest-email', 'pietje@example.com');
  test.fill('#coretest-setvalidator', 'validated');
  test.click('#coretest-requiredradio-x');
  test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]").selectedIndex = 2;
  test.fill('#coretest-address\\.country', "NL");
  test.fill("#coretest-address\\.nr_detail", "296");
  test.fill("#coretest-address\\.zip", "7521AM");
}

interface CoreFormShape {
  radiotestnamelijk: number;
  radioboolean: boolean | null;
  address: AddressValue;
  pulldowntest: null | 1 | 2;
  pulldown2test: null | "red";
  pulldown3test: null | "red" | "green" | "blue";
  showradioy: boolean;
  radiotest: null | 3 | 5;
  checkboxes: Array<1 | 2 | 3>;
}

test.runTests(
  [
    'Study page fields',
    {
      test: async function () {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/' + urlappend);
        await test.waitForElement("#coreform.wh-form--allowsubmit");

        test.eq(0, (await getPxlLogLines()).filter(l => l.event.startsWith("platform:form_")).length, "Should be no PXL events yet");

        const form = test.qR<HTMLFormElement>("#coreform");
        test.assert(form.action.startsWith("javascript:"), "Action should be JavaScript");

        const formhandler = getFormHandler<FormBase<CoreFormShape>>(form);
        test.eqPartial({
          radiotest: 3,
          radioboolean: false,
          pulldowntest: null,

        }, formhandler.data);


        const richtext_h2 = test.qR(".wh-form__fields .wh-form__richtext h2");
        const richtext_p = test.qR(".wh-form__fields .wh-form__richtext p");
        const label_namelijk = test.qR(".wh-form__fields label.wh-form__subfieldlabel[for=coretest-radiotestnamelijk]");
        const label_option1 = test.qR(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-1]");
        const label_option3 = test.qR(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-3]");
        const label_option5 = test.qR(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-5]");
        const field_radio1 = test.qR('#coretest-radiotest-1');
        const field_namelijk = test.qSA("input[name=radiotestnamelijk]");
        const field_opt5 = test.qR("input[name=opt5_textedit]");
        const field_radioboolean_dare = test.qSA(".wh-form__fields .wh-form__fieldline input[name=radioboolean]")[1];
        const field_pulldowntest = test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]");
        const field_pulldown2test = test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldown2test]");
        const field_shadetest = test.qR(".wh-form__fields .wh-form__fieldline input[name=shade]");
        const field_text = test.qR(".wh-form__fields .wh-form__fieldline input[name=text]");
        const field_number = test.qR(".wh-form__fields .wh-form__fieldline input[name=number]");
        const field_numberemptyvalue = test.qR(".wh-form__fields .wh-form__fieldline input[name=numberemptyvalue]");
        const field_dateofbirth = test.qR(".wh-form__fields .wh-form__fieldline input[name=dateofbirth]");
        const field_disabledpulldown = test.qR("select[name=disabledpulldowntest]");
        const label_requiredradio = test.qR("label.wh-form__label[for=coretest-requiredradio]");
        const label_disabledpulldown = test.qR("label.wh-form__label[for=coretest-disabledpulldowntest]");
        const label_zwei = test.qR('label.wh-form__optionlabel[for=coretest-checkboxes-2]');
        const label_terms = test.qR('label.wh-form__optionlabel[for=coretest-agree]');
        const label_twcustomselect = test.qR('label.wh-form__label[for="coretest-two_level_field.customselect.select"]');
        const field_address_country = test.qR(".wh-form__fields .wh-form__fieldline select[name='address.country']");
        const field_address_street = test.qR(".wh-form__fields .wh-form__fieldline input[name='address.street']");
        const field_address_nr_detail = test.qR(".wh-form__fields .wh-form__fieldline input[name='address.nr_detail']");
        const field_address_state = test.qR(".wh-form__fields .wh-form__fieldline input[name='address.state']");
        const field_address_zip = test.qR(".wh-form__fields .wh-form__fieldline input[name='address.zip']");
        const field_address_city = test.qR(".wh-form__fields .wh-form__fieldline input[name='address.city']");
        const field_condition_or_1 = test.qR("input[name='condition_or_1']");
        const field_condition_or_2 = test.qR("input[name='condition_or_2']");
        const field_condition_or_visible = test.qR("input[name='condition_or_visible']");
        const field_condition_and_1 = test.qR("input[name='condition_and_1']");
        const field_condition_and_2 = test.qR("input[name='condition_and_2']");
        const field_condition_and_visible = test.qR("input[name='condition_and_visible']");
        const field_condition_not = test.qR("input[name='condition_not']");
        const field_condition_not_enabled = test.qR("input[name='condition_not_enabled']");
        const field_condition_not_required = test.qR("input[name='condition_not_required']");
        const field_matchattributes_type1 = test.qR("input[name='matchattributes_type1']");
        const field_matchattributes_type2_true = test.qR("input[name='matchattributes_type2_true']");
        const field_matchattributes_type2_false = test.qR("input[name='matchattributes_type2_false']");

        test.eq(null, test.qS('#coretest-nevervisible'), 'static invisible field should be');
        test.eq(null, test.qS('#coretest-invisible'), 'dynamic invisible field should be');
        test.eq('secret', test.qR("#coretest-password").placeholder);
        test.eq(2, test.qR("#coretest-password").minLength);
        test.eq("before &lt;richtext&gt; inhoud <i>vanuit</i> tid after", richtext_h2.innerHTML);
        test.eq("Dynamic richtext", richtext_p.innerHTML);
        test.eq(field_matchattributes_type2_false.closest(".wh-form__fieldgroup"), richtext_h2.closest(".wh-form__fieldgroup")?.previousSibling);
        test.assert(label_namelijk, 'missing label namelijk - forms did not render extra field?');
        test.eq("<u>name</u>lijk", label_namelijk.innerHTML);
        test.eq(1, field_namelijk.length, 'namelijk must appear exactly once');
        test.assert(field_namelijk[0], 'missing field namelijk - forms did not render extra field?');
        test.assert(label_option3, 'missing option3 - forms did not update?');
        test.assert(!label_option3.closest('.wh-form__fieldline')?.classList.contains("wh-form__fieldline--subfields"), "option 3 shouldn't be marked as having a subfield");
        test.assert(label_option1.closest('.wh-form__fieldline')?.classList.contains("wh-form__fieldline--subfields"), "option 1 should be marked as having a subfield");
        test.assert(label_option5.closest('.wh-form__fieldline')?.classList.contains("wh-form__fieldline--subfields"), "option 5 should be marked as having a subfield");
        //test.eq(1, field_opt5.minLength); //TODO: minlength is never actually used?
        test.eq(123, field_opt5.maxLength);

        test.assert(field_radioboolean_dare, 'missing field radioboolean_dare');
        test.assert(field_pulldowntest, 'missing field pulldown');
        test.eq('Maak een selectie', field_pulldowntest.querySelector("option")?.textContent);
        test.assert(field_text.disabled);
        test.assert(field_radio1.required, 'radio1 must be required!');
        test.assert(test.qS('[data-wh-form-group-for="requiredradio"]')?.classList.contains("wh-form__fieldgroup--required"));
        test.assert(!test.qS('[data-wh-form-group-for="requiredradio"]')?.classList.contains("wh-form__fieldgroup--error"), "Should NOT be initially validated");
        test.assert(label_requiredradio, 'need to find requiredradio');
        const twcustomselectgroup = label_twcustomselect.closest('.wh-form__fieldgroup');
        test.assert(twcustomselectgroup);
        test.assert(twcustomselectgroup.classList.contains("wh-testsuite-twolevel-groupclasses"));
        test.assert(twcustomselectgroup.classList.contains("wh-testsuite-customselect-groupclasses"));
        test.eq('TW Customselect', label_twcustomselect.textContent);
        test.eq('with the terms.', label_terms.textContent);
        test.assert(label_terms.querySelector('a'), 'must have hyperlink in "agree terms" label');
        test.eq('http://www.example.net/terms', label_terms.querySelector('a')?.href);
        test.eq('Required&;Radio', label_requiredradio.textContent); //should not be decoded
        test.eq('<b>Disabled</b> pulldown', label_disabledpulldown.innerHTML);
        test.eq('Z<i>wei</i>', label_zwei.innerHTML);
        test.eq('number', field_number.type);
        test.eq('-2', field_number.min);
        test.eq('2', field_number.max);
        test.eq('', field_number.value);
        test.eq('-2', field_numberemptyvalue.min);
        test.eq('2', field_numberemptyvalue.max);
        test.eq('0', field_numberemptyvalue.value);

        test.eq('21', field_namelijk[0].value);
        test.eq('coretest-radiotestnamelijk', field_namelijk[0].id);
        test.eq('false', field_radioboolean_dare.value);
        test.assert(field_radioboolean_dare.checked);
        test.eq('radio', field_radioboolean_dare.type);

        test.assert(field_pulldowntest.required);
        test.eq('1764', field_pulldowntest.querySelector('optgroup')?.dataset.universe);
        test.eq(3, field_pulldowntest.querySelector('optgroup')?.childNodes.length, 'first optgroup (below 5) should have 3 elements');
        test.eq('test-x', field_pulldowntest.options[1].dataset.x);
        test.eq('{"z":42}', field_pulldowntest.options[1].dataset.y_y);
        test.eq('red', field_pulldown2test.value); //not sure if this is cross browser yet?
        test.assert(!field_pulldowntest.options[2].disabled);
        test.eq('2', field_pulldowntest.options[2].value);
        test.assert(field_pulldowntest.options[3].disabled);
        test.eq('', field_pulldowntest.options[3].value); //disabled option lose their values so 'required' works

        test.eq("PlaceHolder", test.qR("#coretest-setvalidator").placeholder);
        test.eq("Type a text in this area", test.qR("textarea[name=textarea]").placeholder);
        test.eq(3, test.qR("textarea[name=textarea]").minLength);

        test.assert(field_shadetest.disabled, "shade of green should be disabled initially");
        test.fill(field_pulldown2test, "green");
        test.assert(!field_shadetest.disabled, "shade of green should be enabled now");
        test.fill(field_pulldown2test, "red");
        test.assert(field_shadetest.disabled, "shade of green should be disabled again");

        test.assert(test.qR('[name=shade2]').disabled, 'should be initially disabled, confused JS code broke that');

        const field_pulldowntest_options = field_pulldowntest.querySelectorAll('option');
        test.assert(field_pulldowntest_options[0].selected);
        test.assert(field_pulldowntest_options[0].disabled);
        test.eq('', field_pulldowntest_options[0].value);

        test.assert(test.qR('#coretest-email').required);
        test.assert(test.qR('#coretest-email').closest('.wh-form__fieldgroup')?.classList.contains('wh-form__fieldgroup--required'));
        test.assert(test.qR('#coretest-radiotest-3').required);
        test.assert(test.qR('#coretest-radiotest-3').closest('.wh-form__fieldgroup')?.classList.contains('wh-form__fieldgroup--required'));

        test.assert(test.qR("[data-wh-form-group-for=checkboxes]").classList.contains("wh-form__fieldgroup--required"), "checkbox group should be marked as required, as min=1");

        test.eq('1900-01-01', test.qR('#coretest-dateofbirth').min);
        test.eq(datetime.getISOLocalDate(new Date(Date.now() + 2 * 86400 * 1000)), test.qR('#coretest-dateofbirth').value);
        test.eq(datetime.getISOLocalDate(new Date(Date.now() + 5 * 86400 * 1000)), test.qR('#coretest-dateofbirth').max);

        test.assert(field_dateofbirth.closest('.wh-form__fieldgroup')?.classList.contains('ut-dateofbirth'));

        //test group dataset
        test.eq('rabbit', test.qR('#coretest-email').closest<HTMLElement>('.wh-form__fieldgroup')?.dataset.bunny);
        test.eq({ y: false }, JSON.parse(test.qR('.radioboolean').dataset.x!));

        test.assert(field_disabledpulldown);
        test.assert(field_disabledpulldown.disabled);
        test.assert(!field_disabledpulldown.options[0].disabled);
        test.eq('touch', field_disabledpulldown.value);
        test.eq("", test.qR('#coreformsubmitresponse').textContent, "expected no submission");

        test.assert(field_address_country);
        test.eq('', field_address_country.value); // Empty initially
        test.fill(field_address_country, "NL");
        field_address_street.scrollIntoView();
        test.assert(test.canClick(field_address_street), "street should be available");
        test.assert(!test.canClick(field_address_state), "state should not be available");
        test.fill(field_address_country, "CA");
        test.assert(test.canClick(field_address_street), "street should still be available");
        test.assert(test.canClick(field_address_state), "state should now be available");

        // fill in BE address
        test.fill(field_address_country, "NL");
        test.fill(field_address_street, "Hengelosestraat");
        test.fill(field_address_nr_detail, "296");
        test.fill(field_address_zip, "7521AM");
        test.fill(field_address_city, "Enschede");

        test.getWin().scrollTo(0, field_condition_or_1.getBoundingClientRect().top);
        test.assert(!test.canClick(field_condition_or_visible), "condition OR textedit initially not visible");
        field_condition_or_1.click();
        test.assert(test.canClick(field_condition_or_visible), "condition OR textedit now visible because of checkbox 1");
        field_condition_or_1.click();
        test.assert(!test.canClick(field_condition_or_visible), "condition OR textedit not visible again");
        field_condition_or_2.click();
        test.assert(test.canClick(field_condition_or_visible), "condition OR textedit now visible because of checkbox 2");
        field_condition_or_2.click();
        test.assert(!test.canClick(field_condition_or_visible), "condition OR textedit no longer visible");
        field_condition_or_1.click();
        field_condition_or_2.click();
        test.assert(test.canClick(field_condition_or_visible), "condition OR textedit now visible because of both checkbox 1 and checkbox 2");
        field_condition_or_1.click();
        field_condition_or_2.click();
        test.assert(!test.canClick(field_condition_or_visible), "condition OR textedit finally not visible");

        test.assert(!test.canClick(field_condition_and_visible), "condition AND textedit initially not visible");
        field_condition_and_1.click();
        test.assert(!test.canClick(field_condition_and_visible), "condition AND textedit not visible because of checkbox 2");
        field_condition_and_2.click();
        test.assert(test.canClick(field_condition_and_visible), "condition AND textedit now visible because of both checkbox 1 and checkbox 2");
        field_condition_and_1.click();
        test.assert(!test.canClick(field_condition_and_visible), "condition AND textedit not visible because of checkbox 1");
        field_condition_and_2.click();
        test.assert(!test.canClick(field_condition_and_visible), "condition AND textedit finally not visible");

        test.assert(!field_condition_not_enabled.required);
        test.assert(!test.canFocus(field_condition_not_enabled), "condition NOT textedit-enabled initially not enabled");
        test.assert(!field_condition_not_enabled.required, "condition NOT textedit-enabled initially not required");
        test.assert(!field_condition_not_enabled.closest('.wh-form__fieldgroup')?.classList.contains("wh-form__fieldgroup--required"), "and its group shouldnt be marked as required");
        test.assert(!field_condition_not_required.required, "condition NOT textedit-required initially not required");
        test.assert(!field_condition_not_required.closest('.wh-form__fieldgroup')?.classList.contains("wh-form__fieldgroup--required"), "and its group shouldnt be marked as required");
        field_condition_not.click();
        test.assert(test.canFocus(field_condition_not_enabled), "condition NOT textedit-enabled now enabled because of checkbox");
        test.assert(field_condition_not_enabled.required, "condition NOT textedit-enabled now required");
        test.assert(field_condition_not_enabled.closest('.wh-form__fieldgroup')?.classList.contains("wh-form__fieldgroup--required"), "and its group should now be marked as required");
        test.assert(field_condition_not_required.required, "condition NOT textedit-required now required");
        test.assert(field_condition_not_required.closest('.wh-form__fieldgroup')?.classList.contains("wh-form__fieldgroup--required"), "and its group should now be marked as required");
        test.assert(field_condition_not_enabled.required);
        field_condition_not.click();
        test.assert(!test.canFocus(field_condition_not_enabled), "condition NOT textedit-enabled finally not enabled");
        test.assert(!field_condition_not_enabled.required, "condition NOT textedit-enabled no longer required");
        test.assert(!field_condition_not_enabled.closest('.wh-form__fieldgroup')?.classList.contains("wh-form__fieldgroup--required"), "and its group should no longer be marked as required");
        test.assert(!field_condition_not_required.required, "condition NOT textedit-required no longer required");
        test.assert(!field_condition_not_required.closest('.wh-form__fieldgroup')?.classList.contains("wh-form__fieldgroup--required"), "and its group should no longer be marked as required");

        test.assert(field_matchattributes_type1.closest(".wh-form__fieldgroup")?.classList.contains("wh-testsuite-matchattributes-type1"));
        test.assert(field_matchattributes_type2_true.closest(".wh-form__fieldgroup")?.classList.contains("wh-testsuite-matchattributes-type2-true"));
        test.assert(field_matchattributes_type2_false.closest(".wh-form__fieldgroup")?.classList.contains("wh-testsuite-matchattributes-type2-false"));

        const formevents = (await getPxlLogLines()).filter(l => l.event.startsWith("platform:form_"));
        test.eq(1, formevents.length, "Should be one PXL event now");

        test.eq("platform:form_started", formevents[0].event);
        test.eq("coretest", formevents[0].mod_platform.formmeta_id, "by default we'll just see the form name");
      }
    },

    "Test labeling and group role",
    async function () {
      // Check for simple input fields having a <label> with the correct content
      test.eq('Email', test.qR('[for="coretest-email"]').textContent);
      test.eq('Text', test.qR('[for="coretest-text"]').textContent);
      test.eq('NumberPlease', test.qR('[for="coretest-number"]').textContent);
      test.eq('Pulldowntest', test.qR('[for="coretest-pulldowntest"]').textContent);
      test.eq('DateOfBirth', test.qR('[for="coretest-dateofbirth"]').textContent);

      // Check fields which consist of grouped input elements
      // FIXME: for replaced components we might have an element with role="group" within our fieldgroup..
      const fieldgroupnode = test.qR('[data-wh-form-group-for="requiredradio"]');
      test.eq("group", fieldgroupnode.getAttribute("role"));
      test.eq("coretest-requiredradio-label", fieldgroupnode.getAttribute("aria-labelledby"));

      // Check select type="checkbox" for correct labeling
      const groupnode = test.qR('[data-wh-form-group-for="checkboxes"]');
      test.eq('coretest-checkboxes-label', groupnode.getAttribute("aria-labelledby"));
    },

    "Test data-wh-group-for",
    async function () {
      const optselect5_group = test.qR("#coretest-opt5_select").closest<HTMLElement>('.wh-form__fieldgroup');
      test.eq("radiotest radiotestnamelijk opt5_select opt5_textedit", optselect5_group?.dataset.whFormGroupFor);

      const field_address_street = test.qR(".wh-form__fields .wh-form__fieldline input[name='address.street']");
      const field_address_streetgroup = field_address_street.closest<HTMLElement>('.wh-form__fieldgroup');
      test.eq("address.street", field_address_streetgroup?.dataset.whFormGroupFor);
    },


    {
      name: 'Test formapis',
      test: async function () {
        const formhandler = getFormHandler(test.qR('#coreform'));
        test.assert(formhandler, 'no formhandler available');

        //test the form APIs
        const radioopts = formhandler.getOptions('radioboolean');
        test.eq(2, radioopts.length);
        test.assert(radioopts[0].fieldline);
        test.eq('coretest-radioboolean-true', radioopts[0].inputnode.id);

        const opts = formhandler.getSelectedOptions('radioboolean');
        test.eq(1, opts.length);
        test.eq('coretest-radioboolean-false', opts[0].inputnode.id);

        test.eq(1, formhandler.getSelectedOptions('radiotest').length);

        test.eq('coretest-radiotest-3', formhandler.getSelectedOption('radiotest')?.inputnode.id);
        test.eq(['3'], (await formhandler.getFormValue())['radiotest']);
        test.eq(["false"], (await formhandler.getFormValue())['radioboolean']);

        const radiotestfieldgroup = formhandler.getFieldGroup('radiotest');
        test.assert(radiotestfieldgroup);
        test.assert(radiotestfieldgroup.classList.contains('wh-form__fieldgroup--radiogroup'));
        test.assert(!radiotestfieldgroup.classList.contains("wh-form__fieldgroup--horizontal"));
        test.eq(0, radiotestfieldgroup.querySelectorAll(".wh-form__optiondata--horizontal").length);
        test.eq(4, radiotestfieldgroup.querySelectorAll(".wh-form__optiondata--vertical").length);
        test.eq(4, radiotestfieldgroup.querySelectorAll(".wh-form__optiondata.wh-form__optiondata--vertical").length);

        const emailfieldgroup = formhandler.getFieldGroup('email');
        test.assert(emailfieldgroup);
        test.assert(emailfieldgroup.classList.contains('wh-form__fieldgroup--textedit'));

        test.eq(null, formhandler.getFieldGroup('bestaatniet'));

        const horizontalgroup = formhandler.getFieldGroup('horizontalradio');
        test.assert(horizontalgroup);
        test.assert(horizontalgroup.classList.contains("wh-form__fieldgroup--horizontal"));
        test.eq(0, horizontalgroup.querySelectorAll(".wh-form__optiondata--vertical").length);
        test.eq(2, horizontalgroup.querySelectorAll(".wh-form__optiondata--horizontal").length);
        test.eq(2, horizontalgroup.querySelectorAll(".wh-form__optiondata.wh-form__optiondata--horizontal").length);

        //test retrieving the api. should not return the unnamed fields
        const result = await formhandler.getFormValue();
        test.assert(!("" in result));
      }
    },

    'Test form field API',
    async function () {
      const data = getFormData<CoreFormShape>(test.qR('#coreform'));
      test.eq(21, data.radiotestnamelijk, "type=number");
      test.eq("Enschede", data.address.city, "type=text");
      test.eq(null, data.pulldowntest, "type=text");
      test.eq("red", data.pulldown2test, "type=text");
      test.eq(null, data.pulldown3test, "type=text");

      //Test clearing pulldown. first via OUR code
      data.pulldowntest = null;
      test.eq(0, test.qR("[name=pulldowntest]").selectedIndex);
      test.eq(null, data.pulldowntest);
      //And via the DOM
      test.qR("[name=pulldown3test]").selectedIndex = 0;
      test.eq(null, data.pulldown3test);
      test.qR("[name=pulldown3test]").selectedIndex = -1;
      test.eq(null, data.pulldown3test);

      //Test checkbox field
      test.eq(true, data.showradioy, "type=checkbox");
      await test.waitToggled({
        test: () => test.qR("#coretest-requiredradio-y").disabled,
        run: () => data.showradioy = false,
      }, "Unsetting showradioy should block the 'y' option");

      test.eq(false, test.qR("#coretest-showradioy").checked);

      //Test checkboxes field
      test.eq([1, 3], data.checkboxes);
      data.checkboxes = [2];
      test.eq([2], data.checkboxes);

      //Test the non-HTML field types (and condition updates)
      test.eq(3, data.radiotest, "RadioFormField");
      //@ts-expect-error Typescript also disapproves
      await test.throws(/Invalid type string/, () => data.radiotest = "5");
      await test.waitToggled({
        test: () => !test.qR("[name=opt5_select]").disabled,
        run: () => data.radiotest = 5
      }, "Setting radiotest to 5 should enable the opt5_select field");
      await test.waitToggled({
        test: () => test.qR("[name=opt5_select]").disabled,
        run: () => data.radiotest = null
      }, "Clearing the radio should disable the opt5_select field again");

      test.eq(0, test.qSA("[name=radiotest]:checked").length);
      test.eq(null, data.radiotest);

      //Verify that we can retrieve the formdata as full object
      test.eqPartial(
        {
          radiotestnamelijk: 21,
          address: { city: "Enschede" },
          pulldowntest: null,
          pulldown2test: "red",
          pulldown3test: null,
          showradioy: false,
          radiotest: null,
          checkboxes: [2]
        }, data);

      //Test bulk setup
      const formhandler = getFormHandler<FormBase<CoreFormShape>>(test.qR('#coreform'));
      //@ts-expect-error TypeScript disapproves of blaBla. And it will throw if you ask for it
      test.throws(/blaBla/, () => formhandler.assign({ blaBla: 15, radiotestnamelijk: 23 }, { ignoreUnknownFields: false }));
      //@ts-expect-error TypeScript still disapproves of blaBla. we still want to warn about potential errors. but we won't throw by default
      formhandler.assign({ blaBla: 15, radiotestnamelijk: 25 });
      test.eq(25, data.radiotestnamelijk);
      //@ts-expect-error TypeScript disapproves of blaBla
      test.eq(undefined, data.blaBla, "unknown fields are not retained");
    },

    {
      name: 'Study page flexlayout', //study als in 'bestudeer de layout'
      test: function () {
        //also test stability of DOM by making selectors as explicit as posbible
        const label_option1 = test.qS(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-1]");
        const label_namelijk = test.qS(".wh-form__fields label.wh-form__subfieldlabel[for=coretest-radiotestnamelijk]");

        test.assert(label_option1, 'missing option1');
        test.assert(label_namelijk, 'missing namelijk');

        //'namelijk' should be right of option1
        test.assert(label_option1.getBoundingClientRect().right <= label_namelijk.getBoundingClientRect().left, "'namelijk' should be to the right of 'option1'");
      }
    },
    async function () {
      const label_option4 = test.qR(".wh-form__fields label.wh-form__optionlabel[for=coretest-radiotest-4]");
      const field_pulldowntest = test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldowntest]");

      const formnode = test.qR<HTMLFormElement>('#coreform');
      test.assert(!(await getFormHandler(formnode)!.validate()).valid);

      label_option4.click();
      test.click('#coretest-requiredradio-x');
      test.fill('#coretest-email', 'pietje@example.com');
      test.assert(!(await getFormHandler(formnode)!.validate()).valid);

      field_pulldowntest.selectedIndex = 2;
      test.eq('2', field_pulldowntest.value);
      test.assert(!(await getFormHandler(formnode)!.validate()).valid);
      test.fill('#coretest-agree', true);
      test.assert(!(await getFormHandler(formnode)!.validate()).valid);

      test.fill('#coretest-setvalidator', 'raam');
      test.assert(!(await getFormHandler(formnode)!.validate()).valid);

      test.fill('#coretest-setvalidator', 'roos');
      test.assert((await getFormHandler(formnode)!.validate()).valid);

      test.fill('#coretest-dateofbirth', '2099-01-01');
      test.assert(!(await getFormHandler(formnode)!.validate()).valid, 'Date checkValidity failed (perhaps the date validation polyfill broke)');

      test.fill('#coretest-dateofbirth', '1979-06-13');
      test.assert((await getFormHandler(formnode)!.validate()).valid);
      test.fillUpload('#coretest-upload', [{ filename: 'test.txt', mimetype: 'application/octet-stream', data: 'This is a text file' }]);

      const field_pulldown2test = test.qR(".wh-form__fields .wh-form__fieldline select[name=pulldown2test]");
      field_pulldown2test.selectedIndex = 2;
      test.eq('blue', field_pulldown2test.value);

      // fill address
      test.fill('#coretest-address\\.country', "NL");
      test.fill("#coretest-address\\.nr_detail", "296");
      test.fill("#coretest-address\\.zip", "7521AM");

      // fill the stray field, should not block
      test.fill("[name=strayfield]", "wedontlikeyou@block.beta.webhare.net");

      //submit it
      const prepareSubmitEvent = new Promise(resolve => formnode.addEventListener("wh:form-preparesubmit", resolve, { once: true }));
      const responseEvent = new Promise(resolve => formnode.addEventListener("wh:form-response", resolve, { once: true }));
      const submittedEvent = new Promise(resolve => formnode.addEventListener("wh:form-response", resolve, { once: true }));

      test.eq("", test.qR('#coreformsubmitresponse').textContent, "expected no submission");
      test.click('#submitbutton');

      await test.wait('ui');

      //Can't say i'm too thrilled with how these events have turned out, but code relies on it so for now...
      test.eq({ extrasubmit: { proof: 42 } }, ((await prepareSubmitEvent) as any).detail);
      test.eqPartial({
        result: {
          email: "pietje",
          extradata: { proof: 42 },
          form: { email: "pietje@example.com" }
        }
      }, ((await responseEvent) as any).detail);
      test.eqPartial({
        result: {
          email: "pietje",
          extradata: { proof: 42 },
          form: { email: "pietje@example.com" }
        }
      }, ((await submittedEvent) as any).detail);
    },
    {
      test: async function () {
        test.eq("pietje@example.com", test.qR("#lastsuccessfulsubmit").textContent);

        const formevents = (await getPxlLogLines()).filter(l => l.event.startsWith("platform:form_"));
        test.eq(2, formevents.length, "Should be two PXL events now");
        test.eq("platform:form_submitted", formevents[1].event);

        const serverresponse = JSON.parse(test.qR('#coreformsubmitresponse').textContent!);

        test.assert(!serverresponse.form["address.city"]);
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
        test.assert(!serverresponse.form.radioboolean);
        test.eq('blue', serverresponse.form.pulldown2test);
        test.eq('1979-06-13T00:00:00.000Z', serverresponse.form.dateofbirth);
      }
    },

    "serverside error handling",
    async function () {
      let passwordgroup = test.qR('#coretest-password').closest('.wh-form__fieldgroup');
      test.assert(!passwordgroup?.classList.contains('wh-form__fieldgroup--error')); //this field is in error
      test.eq(null, passwordgroup?.querySelector('.wh-form__error'));

      test.fill('#coretest-password', ' secret');
      test.qR('#coreformsubmitresponse').textContent = '';
      test.click('#submitbutton');
      await test.wait('ui');
      test.eq("", test.qR('#coreformsubmitresponse').textContent, "expected no submission");

      const fieldnode = test.qR('#coretest-password');
      passwordgroup = test.qR('#coretest-password').closest('.wh-form__fieldgroup');
      test.assert(passwordgroup?.classList.contains('wh-form__fieldgroup--error')); //this field is in error
      test.assert(fieldnode.hasAttribute("aria-invalid"));

      const errornode = passwordgroup?.querySelector('.wh-form__error');
      test.assert(errornode);
      test.eq(errornode.id, fieldnode.getAttribute("aria-describedby"));
      test.eq("'secret' is a bad password", errornode.textContent);

      //trigger global error popup
      test.fill('#coretest-password', 'globalerror');
      test.eq("", test.qR("textarea[name=textarea]").value);
      test.click('#submitbutton');
      await test.sleep(1);
      test.qR("#coretest-email").value = "klaasje@beta.webhare.net"; //modify the email address *after* submission to make sure the form isn't overwriting it

      await test.wait('ui');
      test.eq("klaasje@beta.webhare.net", test.qR("#coretest-email").value);
      test.eq(/You broke the form.*Don't do that.*/, test.qR(".mydialog").textContent);
      test.eq("'globalerror' is also a bad password<br>Please come up with something better!", errornode.innerHTML);
      test.eq("Value set from 'globalerror'", test.qR("textarea[name=textarea]").value);
      test.click('.mydialog button');
    },
    {
      name: 'test RPC',
      test: function () {
        test.click('#coretest-email');
        test.click('.prefillbutton');
      },
      waits: ['ui']
    },
    {
      name: 'test RPC response',
      test: function () {
        test.eq('klaasje+test@beta.webhare.net', test.qR('#coretest-email').value);
        test.eq('2000-01-01', test.qR('#coretest-dateofbirth').value);
      }
    },
    'Test disabled fields',
    async function () {
      test.fill('#coretest-password', 'acceptable');
      test.qR('#coretest-disabledpulldowntest').disabled = false;
      test.qR('#coretest-disabledpulldowntest').value = "cant";

      const formhandler = getFormHandler(test.qR('#coreform'));

      //we'll also test the 'extra submit data' passed to .submit see if it work
      await formhandler!.submit({ submitextradata: 5542 });

      test.eq('cant', JSON.parse(test.qR('#coreformsubmitresponse').textContent!).form.disabledpulldowntest, "server update the disabled value, form handler should take care of this");
      test.eq(5542, JSON.parse(test.qR('#coreformsubmitresponse').textContent!).extradata.submitextradata);
    },

    'Test unload event when halfway form',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?require=number,numberemptyvalue'); //also setting up for the next test
      const start = new Date();
      test.fill('#coretest-password', 'acceptable');

      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?require=number,numberemptyvalue'); //also setting up for the next test
      const formevent = await test.wait(async () => (await getPxlLogLines({ start })).filter(l => l.event.startsWith("platform:form_abandoned"))[0]);

      test.eqPartial({
        mod_platform: {
          formmeta_lastfocused: "password",
          formmeta_pagenum: 0
        }
      }, formevent);
    },

    'Test core',
    async function () {
      test.eq('', test.qR('input[name=number]').value);
      test.eq('0', test.qR('input[name=numberemptyvalue]').value);
      quickFillDefaultRequiredFields();
      test.click('#submitbutton');
      await test.wait('ui');

      test.assert(test.qR('[data-wh-form-group-for="number"]').classList.contains("wh-form__fieldgroup--error"), "number should be in error");
      test.fill('input[name=number]', '0');
      test.fill('input[name=numberemptyvalue]', '');

      test.click('#submitbutton');
      await test.wait('ui');
      test.assert(test.qR('[data-wh-form-group-for="numberemptyvalue"]').classList.contains("wh-form__fieldgroup--error"), "numberemptyvalue should be in error");

      test.fill('input[name=numberemptyvalue]', '0');
      test.click('#submitbutton');
      await test.wait('ui');
      test.eq(0, JSON.parse(test.qR('#coreformsubmitresponse').textContent!).form.numberemptyvalue);
    },

    'Test unlocking disabled fields',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/' + urlappend);

      quickFillDefaultRequiredFields();

      // Update the value of the disabled pulldown from "touch" to "this"
      test.qR('#coretest-disabledpulldowntest').selectedIndex = 2;
      test.click('#submitbutton');
      await test.wait('ui');

      const serverresponse = JSON.parse(test.qR('#coreformsubmitresponse').textContent!);
      test.eq("touch", serverresponse.form.disabledpulldowntest); // disabled select value isn't sent to server
    },

    "Test URL preload and slow submission",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?email=joop%40beta.webhare.net&text=Text&opt5_textedit=opt5&opt5_select=BANK2&radiotest=5&disabledpulldowntest=this&checkboxes=2&checkboxes=3&checkboxes=nonexistent&submitsleep=6000' + urlappend);
      const start = new Date;

      /* URL based prefills -especially on static pages- cannot complete before the JS code is ready. We need to wait for that
         (you can  see this by running the above test with Disable cache and Fast 3G - DOMContentLoaded will fire before the JS code is ready */
      await test.waitForElement("#coreform.wh-form--allowsubmit");
      test.eq("joop@beta.webhare.net", test.qR('#coreform [name=email]').value);
      test.eq("", test.qR('[name=text]').value);
      test.assert(test.qR('[name="radiotest"][value="5"]').checked);
      test.assert(test.qR<HTMLOptionElement>('[name=opt5_select] [value=BANK2]').selected);
      test.eq("opt5", test.qR('[name=opt5_textedit]').value);
      test.assert(!test.qR('[name=checkboxes][value="1"]').checked);
      test.assert(test.qR('[name=checkboxes][value="2"]').checked);
      test.assert(test.qR('[name=checkboxes][value="3"]').checked);

      //Fill the remaining required fields so we can submit
      quickFillDefaultRequiredFields();
      test.click(test.qR('#submitbutton'));
      await test.wait('ui');

      const formevents = (await getPxlLogLines({ start })).filter(l => l.event.startsWith("platform:form_"));
      test.eq(3, formevents.length, "Should be 3 PXL events...");
      test.eq("platform:form_slow", formevents[1].event, 'middle event should be "slow" warning');
    },

    "Test back link",
    async function () {
      await test.load(`${test.getTestSiteRoot()}testpages/formtest/?backlink=${encodeURIComponent(test.getTestSiteRoot())}`);
      test.qR("#globalform .wh-form__button--previous").scrollIntoView();
      test.assert(test.canClick('#globalform .wh-form__button--previous'), "'previous' button should be available with a backlink");
      test.click('.wh-form__button--previous');
      await test.wait("load");
      test.eq("Welcome to the testsite", test.qR("#content p").textContent);
    },

    "Test hidden field",
    async function () {
      // Hidden field gets value from XML source
      await test.load(test.getTestSiteRoot() + "testpages/formtest/" + urlappend);
      test.eq("value-xml", test.qR("[name=hidden]").value);
      quickFillDefaultRequiredFields();
      test.click("#submitbutton");
      await test.wait("ui");
      test.eq("value-xml", JSON.parse(test.qR("#coreformsubmitresponse").textContent!).form.hidden);

      // Hidden field is prefilled by url
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?hidden=value-url" + urlappend.replace("?", "&"));
      test.eq("value-url", test.qR("[name=hidden]").value);
      quickFillDefaultRequiredFields();
      test.click("#submitbutton");
      await test.wait("ui");
      test.eq("value-url", JSON.parse(test.qR("#coreformsubmitresponse").textContent!).form.hidden);

      // Hidden field is set dynamically server-side
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?sethiddenfield=harescript" + urlappend.replace("?", "&"));
      test.eq("value-harescript", test.qR("[name=hidden]").value);
      quickFillDefaultRequiredFields();
      test.click("#submitbutton");
      await test.wait("ui");
      test.eq("value-harescript", JSON.parse(test.qR("#coreformsubmitresponse").textContent!).form.hidden);

      // Hidden field is set dynamically client-side
      await test.load(test.getTestSiteRoot() + "testpages/formtest/?sethiddenfield=javascript" + urlappend.replace("?", "&"));
      test.eq("value-javascript", test.qR("[name=hidden]").value);
      quickFillDefaultRequiredFields();
      test.click("#submitbutton");
      await test.wait("ui");
      test.eq("value-javascript", JSON.parse(test.qR("#coreformsubmitresponse").textContent!).form.hidden);
    },
  ]);
