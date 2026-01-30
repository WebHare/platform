import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import type { verifyHareScriptAddress as VerifyAddressAPI } from '@webhare/forms/src/address';
import { FormBase } from '@mod-publisher/js/forms';
import type { AddressValue } from "@webhare/address";

function getFormRPCRequests() {
  return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.includes("/wh_services/publisher/forms/"));
}

function testNoLookup(fieldname: string) {
  test.eq(0, test.qSA(`[data-wh-form-group-for^="${CSS.escape(fieldname + ".")}"]`).filter(el => el.classList.contains("wh-form__fieldgroup--addresslookup")).length);
}
function testHasLookup(fieldname: string) {
  test.assert(test.qSA(`[data-wh-form-group-for^="${CSS.escape(fieldname + ".")}"]`).filter(el => el.classList.contains("wh-form__fieldgroup--addresslookup")).length > 0);
}

const rawApiTests = 10;

interface AddressFormShape {
  address: AddressValue | null;
  address2: AddressValue | null;
  enablefields: boolean;
  enablegroup: boolean;
  neighbourhood: string;
  visiblefields: boolean;
  visiblegroup: boolean;
}

test.runTests(
  [
    'Prepare',
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=2');

      test.eq(0, getFormRPCRequests().length, "Verify initial state");
    },

    'Test raw API',
    async function () {

      const verifyAddress = (test.getWin() as unknown as { formrpc_validateAddress: typeof VerifyAddressAPI }).formrpc_validateAddress;
      test.eqPartial({
        status: "error",
        errors: [{ fields: ["city"], message: /address.*not.*found/ }],
        corrections: null
      }, await verifyAddress({ country: "GH", city: "15" }));

      //Test all well known valiadtion paths
      test.eqPartial({
        status: "ok",
        errors: [],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7521 AM", nr_detail: "296", street: "Hengelosestraat", city: "Enschede" }));

      test.eqPartial({
        status: "unknown",
        errors: [],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "1" }));

      test.eqPartial({
        status: "error",
        errors: [{ fields: ["zip", "nr_detail"], message: "Unknown combination of postal code and house number." }],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "2" }));

      test.eqPartial({
        status: "error",
        errors: [{ fields: [], message: "The address could not be found." }],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "3" }));

      test.eqPartial({
        status: "error",
        errors: [{ fields: [], message: "Het adres kon niet worden gevonden." }],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "3" }, { lang: "nl" }));

      test.eqPartial({
        status: "unknown",
        errors: [],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "4" }));

      test.eqPartial({
        status: "error",
        errors: [{ fields: [], message: "The address could not be found." }],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "4" }, { checks: ["nl-zip-force"] }));

      test.eqPartial({
        status: "error",
        errors: [{ fields: ["zip"], message: "Invalid ZIP or postal code." }],
        corrections: null
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "5" }));

      test.eqPartial({
        status: "error",
        errors: [{ fields: ["zip"], message: "Invalid ZIP or postal code." }],
        corrections: { city: "DO NOT SHIP - NIET VERZENDEN", street: "PDOK (Publieke Dienstverlening Op de Kaart)" }
      }, await verifyAddress({ country: "NL", zip: "7500 OO", nr_detail: "296" }));
    },

    'Check UX',
    async function () {
      //just changing country on an empty field used to trigger a validation, and then a "Ongeldige postcode"
      test.fill("#addressform-address\\.country", "BE");
      testNoLookup("address");
      await test.sleep(50);

      //ensure nothing has the lookup class
      testNoLookup("address");

      test.fill("#addressform-address\\.country", "NL");
      testNoLookup("address");
      await test.sleep(50);

      //still on lookups
      testNoLookup("address");

      //set a zipcode and housenumber, bring the NL validator into error mode
      test.eq(rawApiTests, getFormRPCRequests().length, "Still no lookups please..");
      test.fill("#addressform-address\\.nr_detail", "100");
      test.fill("#addressform-address\\.zip", "1000");
      await test.waitForUI();

      test.eq(rawApiTests + 1, getFormRPCRequests().length, "ONE lookup allowed to reject 1000-100");
      test.assert(test.qR('[data-wh-form-group-for="address.zip"]').classList.contains("wh-form__fieldgroup--error"), "ZIP should now be in error mode");

      //STORY: Switching to BE should immediately clear the zip error state. let validation confirm issues first..
      test.fill("#addressform-address\\.country", "BE");
      test.assert(!test.qR('[data-wh-form-group-for="address.zip"]').classList.contains("wh-form__fieldgroup--error"), "ZIP should be out of error mode");
    },

    'Check UX - AF',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=2');
      test.fill("#addressform-address\\.country", "AF");
      test.fill("#addressform-address\\.nr_detail", "100");
      test.fill("#addressform-address\\.zip", "1000");
      testNoLookup("address");

      await test.sleep(50);
      testNoLookup("address");
    },

    'Check API',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');
      const formhandler = FormBase.getForNode<AddressFormShape>(test.qR('[data-wh-form-id="addressform"]'))!;
      test.eq(null, formhandler.data.address);
      test.eq(null, formhandler.data.address2);

      formhandler.assign({ address: { country: "NL", houseNumber: "296" } });
      test.eq({ country: "NL", zip: "", street: "", city: "", state: "", houseNumber: "296" }, formhandler.data.address);
      await test.sleep(5);
      testNoLookup("address");

      formhandler.assign({ address: { country: "NL", houseNumber: "296", zip: "7521AM" } });
      test.eq({ country: "NL", zip: "7521AM", street: "", city: "", state: "", houseNumber: "296" }, formhandler.data.address);
      test.eq("NL", test.qR("#addressform-address\\.country").value);
      await test.sleep(5);
      testNoLookup("address");

      formhandler.assign({ address: null });
      test.eq(null, formhandler.data.address);
      test.eq("", test.qR("#addressform-address\\.country").value);

      //if we manually set country...
      test.qR("#addressform-address\\.country").value = "NL";
      //the other fields should still be empty
      test.eq("", test.qR("#addressform-address\\.street").value);
      test.eq({ country: "NL", zip: "", street: "", city: "", state: "", houseNumber: "" }, formhandler.data.address);
    },

    'Check required subfields',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=2');

      test.assert(test.canClick("#addressform-address\\.country"));
      test.eq('', test.qR("#addressform-address\\.country").value);
      test.assert(!test.canClick("#addressform-address\\.city"));

      // NL (no state, street and city disabled, rest required)
      test.fill("#addressform-address\\.country", "NL");
      test.assert(test.canClick("#addressform-address\\.street"));
      test.assert(test.canClick("#addressform-address\\.nr_detail"));
      test.assert(test.canClick("#addressform-address\\.zip"));
      test.assert(test.canClick("#addressform-address\\.city"));
      test.assert(test.qR("#addressform-address\\.street").disabled);
      // test.eq("INPUT", test.qR("#addressform-address\\.street").tagName);
      test.assert(!test.qR("#addressform-address\\.nr_detail").disabled);
      test.assert(!test.qR("#addressform-address\\.zip").disabled);
      test.assert(test.qR("#addressform-address\\.city").disabled);
      test.assert(!test.qR("#addressform-address\\.street").required);
      test.assert(test.qR("#addressform-address\\.nr_detail").required);
      test.assert(test.qR("#addressform-address\\.zip").required);
      test.assert(!test.qR("#addressform-address\\.city").required);

      // test.fill(test.qR("#addressform-address\\.street"), "Hengelosestraat");

      // Afghanistan (to test the 'default' address field)
      test.fill("#addressform-address\\.country", "AF");
      test.assert(test.canClick("#addressform-address\\.street"));
      // test.eq("TEXTAREA", test.qR("#addressform-address\\.street").tagName);
      test.assert(!test.canClick("#addressform-address\\.nr_detail"));
      test.assert(test.canClick("#addressform-address\\.zip"));
      test.assert(test.canClick("#addressform-address\\.city"));
      test.assert(test.qR("#addressform-address\\.street").required);
      test.assert(!test.qR("#addressform-address\\.nr_detail").required);
      test.assert(!test.qR("#addressform-address\\.zip").required);
      test.assert(test.qR("#addressform-address\\.city").required);
      test.assert(!test.qR("#addressform-address\\.state").required);

      //Test that the third unconfigured address field simply shows all countries
      const address3country = test.qR("#addressform-address3\\.country");
      test.assert(address3country, 'selector should be visible');
      //make sure it sorted right. ie NL countrynames didn't get EN sorted

      test.eq(["Afghanistan", "Åland"], Array.from(address3country.options).slice(1, 3).map(el => el.textContent));

      //Test that selecting NL does not disable the or reorder the zip field
      test.fill(address3country, 'NL');
      await test.wait('tick'); //just in case someone delays reodering

      const zipfield = test.qR("#addressform-address3\\.zip");
      const streetfield = test.qR("#addressform-address3\\.street");
      test.assert(!streetfield.disabled);
      test.assert(zipfield.getBoundingClientRect().top > streetfield.getBoundingClientRect().bottom, "Zip MUST be below country");
    },

    'Check recursive enable/visible',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');

      // initially not visible
      test.assert(!test.canClick("#addressform-address\\.nr_detail"));
      test.assert(!test.qR("#addressform-address\\.street").required);
      test.assert(!test.qR("#addressform-address\\.nr_detail").required);

      test.fill("#addressform-address\\.country", "NL");
      test.assert(test.qR("#addressform-address\\.nr_detail").required);
      test.assert(!test.qR("#addressform-address\\.nr_detail").disabled);

      test.fill("#addressform-enablefields", false);
      test.assert(test.qR("#addressform-address\\.nr_detail").disabled);

      test.fill("#addressform-visiblefields", false);
      test.assert(!test.canClick("#addressform-address\\.nr_detail"));

      test.fill("#addressform-enablefields", true);
      test.fill("#addressform-visiblefields", true);
      test.assert(!test.qR("#addressform-address\\.nr_detail").disabled);
      test.assert(test.canClick("#addressform-address\\.nr_detail"));

      test.fill("#addressform-enablegroup", false);
      test.assert(test.qR("#addressform-address\\.nr_detail").disabled);

      test.fill("#addressform-visiblegroup", false);
      test.assert(!test.canClick("#addressform-address\\.nr_detail"));
    },

    'Check address validation',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');
      const formhandler = FormBase.getForNode<AddressFormShape>(test.qR('[data-wh-form-id="addressform"]'))!;
      test.eq(null, formhandler.data.address);

      // set country to NL
      test.fill("#addressform-address\\.country", "NL");
      // fill nr and zip
      test.fill("#addressform-address\\.nr_detail", "296");
      test.fill("#addressform-address\\.zip", "7521AM");

      test.eq({ city: "", country: "NL", houseNumber: "296", state: "", street: "", zip: "7521AM" }, formhandler.data.address);

      // address validation/completion should be triggered now
      await test.waitForUI();
      test.eq("Hengelosestraat", test.qR("#addressform-address\\.street").value);
      test.eq("Enschede", test.qR("#addressform-address\\.city").value);

      test.fill("#addressform-address\\.country", "NL");

      //ensure nothing has the lookup class
      testNoLookup("address");
      test.fill("#addressform-address\\.zip", "7500 OO");

      //no visible element should not have the lookup class
      test.eq([], test.qSA('[data-wh-form-group-for^="address."]:not(.wh-form__fieldgroup--hidden)').filter(el => !el.classList.contains("wh-form__fieldgroup--addresslookup")));
      await test.wait("ui");
      //lookup should be done again
      testNoLookup("address");

      test.fill("#addressform-address\\.nr_detail", "2");
      //no visible element should not have the lookup class
      test.eq([], test.qSA('[data-wh-form-group-for^="address."]:not(.wh-form__fieldgroup--hidden)').filter(el => !el.classList.contains("wh-form__fieldgroup--addresslookup")));
      await test.wait("ui");
      //lookup should be done again
      testNoLookup("address");

      test.eq("Combinatie van postcode en huisnummer komt niet voor.", test.qR('[data-wh-form-group-for="address.zip"] .wh-form__error').textContent);

      // address_not_found should place an error on the first field (here: 'zip')
      test.fill("#addressform-address\\.nr_detail", "3");
      await test.wait("ui");
      test.eq("Het adres kon niet worden gevonden.", test.qR('[data-wh-form-group-for="address.zip"] .wh-form__error').textContent);
    },

    async function CheckAddressFieldReordering() {
      const countryoptions = [...test.qR("#addressform-address2\\.country").options].map(el => el.value);
      test.eq(["", "NL", "BE", "DE", "", "AF", "AX", "AL"], countryoptions.slice(0, 8));
      test.fill("#addressform-address2\\.country", "NL");
      test.eq(["country", "zip", "nr_detail", "street", "city"], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
      test.fill("#addressform-address2\\.country", "CA");
      test.eq(["country", "street", "zip", "city", "state"], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
      test.fill("#addressform-address2\\.country", "DE");
      test.eq(["country", "street", "nr_detail", "zip", "city"], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
      test.fill("#addressform-address2\\.country", "NL");
      test.eq(["country", "zip", "nr_detail", "street", "city"], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
    },

    "Regression: addressfield clearing itself when receiving events that don't change anything",
    async function () {
      test.eq("NL", test.qR("[id='addressform-address.country']").value);
      test.eq("7500 OO", test.qR("[id='addressform-address.zip']").value);
      test.fill("[id='addressform-visiblegroup']", false); //hide the addreses
      dompack.dispatchDomEvent(test.qR("[id='addressform-address.country']"), 'change'); //this used to trigger a reset because the field was hidden
      test.eq("NL", test.qR("[id='addressform-address.country']").value);
    },
    // */
    "Regression: modify during validation",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');
      //fill in address2 just so we can submit...
      test.fill("#addressform-address2\\.country", "BE");
      test.fill("#addressform-address2\\.city", "Brussel");
      test.fill("#addressform-address2\\.street", "Rue de la Loi");
      test.fill("#addressform-address2\\.nr_detail", "6");
      test.fill("#addressform-address2\\.zip", "1000");

      test.fill("#addressform-address\\.country", "NL");
      test.fill("#addressform-address\\.zip", "1000");
      test.fill("#addressform-address\\.nr_detail", "6");
      testHasLookup("address");
      //now while the lookup is flying... switch country to one where the above address is VALID
      test.fill("#addressform-address\\.country", "BE");
      test.fill("#addressform-address\\.city", "Brussel");
      test.fill("#addressform-address\\.street", "Rue de la Loi");
      test.click("button[type=submit]");

      await test.wait("ui");
      test.assert(!test.qR('[data-wh-form-group-for="address.zip"]').classList.contains("wh-form__fieldgroup--error"), "ZIP was valid for BE so should NOT report an error");
      test.eq("1000", test.qR("#addressform-address\\.zip").value);
      test.assert(!test.qR('[data-wh-form-group-for="address2.zip"]').classList.contains("wh-form__fieldgroup--error"), "ZIP was valid for BE so should NOT report an error");
      test.eq("1000", test.qR("#addressform-address2\\.zip").value);
    },

    "Regression: addressfield nl-optional broke (incorrectly waiting for allrequiredset)",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');
      test.fill("#addressform-address2\\.country", "NL");
      test.fill("#addressform-address2\\.zip", "7521AM");
      test.fill("#addressform-address2\\.nr_detail", "296");
      await test.pressKey('Tab');
      //wait for completion
      await test.wait(() => test.qR("#addressform-address2\\.street").value);
      test.eq("Hengelosestraat", test.qR("#addressform-address2\\.street").value);
      test.eq("Enschede", test.qR("#addressform-address2\\.city").value);
    },

    "Test using (disabled) city field as condition source",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');

      test.assert(!test.canClick("#addressform-neighbourhood"));

      test.fill("#addressform-address\\.country", "NL");
      test.fill("#addressform-address\\.zip", "7521AM");
      test.fill("#addressform-address\\.nr_detail", "296");
      await test.pressKey('Tab');
      //wait for completion
      await test.wait(() => test.qR("#addressform-address\\.street").value);

      test.assert(test.canClick("#addressform-neighbourhood"));
    },

    "Test nl-zip-force",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=4');

      test.fill("[id='addressform-address2.country']", "NL");
      test.fill("[id='addressform-address2.zip']", "7521AM");
      test.fill("[id='addressform-address2.nr_detail']", "705");
      test.fill("[id='addressform-address2.street']", "Teststraat");
      test.fill("[id='addressform-address2.city']", "Teststad");

      await test.pressKey('Tab');
      test.fill("[id='addressform-address4.country']", "NL");
      test.fill("[id='addressform-address4.zip']", "7521AM");
      test.fill("[id='addressform-address4.nr_detail']", "705");

      await test.pressKey('Tab');

      //wait for completion. one should fail
      await test.wait(() => test.qSA(".wh-form__fieldgroup--error").length === 1);
      test.assert(test.qR(`[data-wh-form-group-for="address4.zip"]`).classList.contains("wh-form__fieldgroup--error"), "ZIP should be in error mode");

      ///@ts-ignore We need a more central error check/count facility
      test.eq(0, test.getWin().basetestErrorList.length);
    }
  ]);
