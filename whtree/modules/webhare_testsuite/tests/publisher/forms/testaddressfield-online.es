import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

function getFormRPCRequests()
{
   return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.includes("/wh_services/publisher/forms/"));
}

test.registerTests(
    [ 'Check UX'
    , async function()
      {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=2');

        test.eq(0, getFormRPCRequests().length, "Verify initial state");

        //just changing country on an empty field used to trigger a validation, and then a "Ongeldige postcode"
        test.fill("#addressform-address\\.country", "BE");
        await test.wait(50);

        //ensure nothing has the lookup class
        test.eq([], test.qSA('[data-wh-form-group-for^="address."]').filter(el => el.classList.contains("wh-form__fieldgroup--addresslookup")));
      }

    , 'Check required subfields'
    , async function()
      {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=2');

        test.true(test.canClick("#addressform-address\\.country"));
        test.eq('', test.qS("#addressform-address\\.country").value);
        test.false(test.canClick("#addressform-address\\.city"));

        // NL (no province, street and city disabled, rest required)
        test.fill("#addressform-address\\.country", "NL");
        test.true(test.canClick("#addressform-address\\.street"));
        test.true(test.canClick("#addressform-address\\.nr_detail"));
        test.true(test.canClick("#addressform-address\\.zip"));
        test.true(test.canClick("#addressform-address\\.city"));
        test.true(test.qS("#addressform-address\\.street").disabled);
        test.false(test.qS("#addressform-address\\.nr_detail").disabled);
        test.false(test.qS("#addressform-address\\.zip").disabled);
        test.true(test.qS("#addressform-address\\.city").disabled);
        test.false(test.qS("#addressform-address\\.province").required);
        test.false(test.qS("#addressform-address\\.street").required);
        test.true(test.qS("#addressform-address\\.nr_detail").required);
        test.true(test.qS("#addressform-address\\.zip").required);
        test.false(test.qS("#addressform-address\\.city").required);

        // BE (+province, province and nr_detail not required)
        test.fill("#addressform-address\\.country", "BE");
        test.true(test.canClick("#addressform-address\\.street"));
        test.true(test.canClick("#addressform-address\\.province"));
        test.true(test.canClick("#addressform-address\\.nr_detail"));
        test.true(test.canClick("#addressform-address\\.zip"));
        test.true(test.canClick("#addressform-address\\.city"));
        test.false(test.qS("#addressform-address\\.province").required);
        test.true(test.qS("#addressform-address\\.street").required);
        test.true(test.qS("#addressform-address\\.nr_detail").required);
        test.true(test.qS("#addressform-address\\.zip").required);
        test.true(test.qS("#addressform-address\\.city").required);

        //Test that the third unconfigured address field simply shows all countries
        let address3country = test.qS("#addressform-address3\\.country");
        test.true(address3country, 'selector should be visible');
        //make sure it sorted right. ie NL countrynames didn't get EN sorted

        test.eq(["Afghanistan","Åland"], Array.from(address3country.options).slice(1,3).map(el => el.textContent));

        //Test that selecting NL does not disable the or reorder the zip field
        test.fill(address3country,'NL');
        await test.wait('tick'); //just in case someone delays reodering

        let zipfield = test.qS("#addressform-address3\\.zip");
        let streetfield = test.qS("#addressform-address3\\.street");
        test.false(streetfield.disabled);
        test.true(zipfield.getBoundingClientRect().top > streetfield.getBoundingClientRect().bottom, "Zip MUST be below country");
      }

    , 'Check recursive enable/visible'
    , async function()
      {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');

        // initially not visible
        test.false(test.canClick("#addressform-address\\.nr_detail"));
        test.false(test.qS("#addressform-address\\.street").required);
        test.false(test.qS("#addressform-address\\.nr_detail").required);

        test.fill("#addressform-address\\.country", "NL");
        test.true(test.qS("#addressform-address\\.nr_detail").required);
        test.false(test.qS("#addressform-address\\.nr_detail").disabled);

        test.fill("#addressform-enablefields", false);
        test.true(test.qS("#addressform-address\\.nr_detail").disabled);

        test.fill("#addressform-visiblefields", false);
        test.false(test.canClick("#addressform-address\\.nr_detail"));

        test.fill("#addressform-enablefields", true);
        test.fill("#addressform-visiblefields", true);
        test.false(test.qS("#addressform-address\\.nr_detail").disabled);
        test.true(test.canClick("#addressform-address\\.nr_detail"));

        test.fill("#addressform-enablegroup", false);
        test.true(test.qS("#addressform-address\\.nr_detail").disabled);

        test.fill("#addressform-visiblegroup", false);
        test.false(test.canClick("#addressform-address\\.nr_detail"));
      }

    , 'Check address validation'
    , async function()
      {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?address=1');

        // set country to NL
        test.fill("#addressform-address\\.country", "NL");
        // fill nr and zip
        test.fill("#addressform-address\\.nr_detail", "296");
        test.fill("#addressform-address\\.zip", "7521AM");
        // address validation/completion should be triggered now

        await test.wait("ui");
        test.eq("Hengelosestraat", test.qS("#addressform-address\\.street").value);
        test.eq("Enschede", test.qS("#addressform-address\\.city").value);

        test.fill("#addressform-address\\.country", "NL");

        //ensure nothing has the lookup class
        test.eq([], test.qSA('[data-wh-form-group-for^="address."]').filter(el => el.classList.contains("wh-form__fieldgroup--addresslookup")));
        test.fill("#addressform-address\\.zip", "7500 OO");

        //no visible element should not have the lookup class
        test.eq([], test.qSA('[data-wh-form-group-for^="address."]:not(.wh-form__fieldgroup--hidden)').filter(el => !el.classList.contains("wh-form__fieldgroup--addresslookup")));
        await test.wait("ui");
        //lookup should be done again
        test.eq([], test.qSA('[data-wh-form-group-for^="address."]').filter(el => el.classList.contains("wh-form__fieldgroup--addresslookup")));

        test.fill("#addressform-address\\.nr_detail", "2");
        //no visible element should not have the lookup class
        test.eq([], test.qSA('[data-wh-form-group-for^="address."]:not(.wh-form__fieldgroup--hidden)').filter(el => !el.classList.contains("wh-form__fieldgroup--addresslookup")));
        await test.wait("ui");
        //lookup should be done again
        test.eq([], test.qSA('[data-wh-form-group-for^="address."]').filter(el => el.classList.contains("wh-form__fieldgroup--addresslookup")));

        test.eq("Combinatie van postcode en huisnummer komt niet voor.", test.qS('[data-wh-form-group-for="address.zip"] .wh-form__error').textContent);

        // address_not_found should place an error on the first field (here: 'zip')
        test.fill("#addressform-address\\.nr_detail", "3");
        await test.wait("ui");
        test.eq("Het adres kon niet worden gevonden.", test.qS('[data-wh-form-group-for="address.zip"] .wh-form__error').textContent);
      }

  , async function CheckAddressFieldReordering()
    {
      test.fill("#addressform-address2\\.country", "NL");
      test.eq([ "country", "zip", "nr_detail", "street", "city" ], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
      test.fill("#addressform-address2\\.country", "BE");
      test.eq([ "country", "province", "street", "nr_detail", "zip", "city" ], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
      test.fill("#addressform-address2\\.country", "DE");
      test.eq([ "country", "street", "nr_detail", "zip", "city" ], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
      test.fill("#addressform-address2\\.country", "NL");
      test.eq([ "country", "zip", "nr_detail", "street", "city" ], test.qSA(`.wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden) [name^="address2."]`).map(node => node.name.replace("address2.", "")));
    }

  , "Regression: addressfield clearing itself when receiving events that don't change anything"
  , async function()
    {
      test.eq("NL", test.qS("[id='addressform-address.country']").value);
      test.eq("7500 OO", test.qS("[id='addressform-address.zip']").value);
      test.fill("[id='addressform-visiblegroup']", false); //hide the addreses
      dompack.dispatchDomEvent(test.qS("[id='addressform-address.country']"), 'change'); //this used to trigger a reset because the field was hidden
      test.eq("NL", test.qS("[id='addressform-address.country']").value);
    }
  ]);
