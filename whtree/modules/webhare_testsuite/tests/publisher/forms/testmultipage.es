import * as test from '@mod-system/js/wh/testframework';

test.registerTests(
  [  async function()
    {
      await test.load(`${test.getTestSiteRoot()}testpages/formtest/?multipage=1&cookiebar=1`);

      let firstpage = test.qS('.wh-form__page');
      test.eq("Page 1", test.qS('form .wh-form__page--visible h2').textContent);
      test.eq(firstpage, test.qS('form.wh-form').propWhFormhandler.getCurrentPage());

      test.eq('', test.qS('#currentpage').textContent, "We don't get events for the very first page, only on change");
      test.true(test.canClick(test.qS('input[name="email"]')), "'email' field available on page 1");
      test.false(test.canClick(test.qS('input[name="text"]')), "'text' field not available on page 1");
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on page 1");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on page 1");
      test.true(test.canClick(test.qS('.wh-form__button--next')), "'next' button available on page 1");
      test.fill(test.qS('input[name="firstname"]'), 'Homer');

      test.eq('<--', test.qS('.wh-form__button--previous').textContent);
      test.eq('volgende', test.qS('.wh-form__button--next').textContent);

      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="email"]')), 'should still be on page 1');
      test.eq('', test.qS('#currentpage').textContent, "No change event on blocked page nav");

      let events = test.getPxlLog(/^publisher:formfailed/);
      test.eq(1, events.length, "Should be one failed page");
      test.eq("nextpage", events[0].data.ds_formmeta_errorsource);
      test.eq("email", events[0].data.ds_formmeta_errorfields);
      test.eq(1, events[0].data.dn_formmeta_pagenum);
      test.eq("firstpage", events[0].data.ds_formmeta_pagetitle);

      test.fill(test.qS('input[name="email"]'), 'multipage@beta.webhare.net');
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      events = test.getPxlLog(/^publisher:formnextpage/);
      test.eq(1, events.length, "Should be one 'next' page event");
      test.eq(1, events[0].data.dn_formmeta_pagenum);
      test.eq("firstpage", events[0].data.ds_formmeta_pagetitle);
      test.eq(4, events[0].data.dn_formmeta_targetpagenum);
      test.eq("Last Page", events[0].data.ds_formmeta_targetpagetitle);

      //test page2 (actually the FOURTH because an intermediate is skipped) visibitility
      test.eq("Page 2", test.qS('form .wh-form__page--visible h2').textContent);
      test.eq('4', test.qS('#currentpage').textContent);
      test.eq("Come on Homer, just one more page!", test.qS('form .wh-form__page--visible p.normal').textContent);
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field no longer available on page 2");
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field now available on page 2");

      //go back to page1
      test.click(test.qS('.wh-form__button--previous'));
      test.true(test.canClick(test.qS('input[name="email"]')), "'email' field available again on page 1");

      events = test.getPxlLog(/^publisher:formpreviouspage/);
      test.eq(1, events.length, "Should be one 'previous' page event");
      test.eq(4, events[0].data.dn_formmeta_pagenum);
      test.eq("Last Page", events[0].data.ds_formmeta_pagetitle);

      //...and back to page2 again
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field not available again on page 2");

      //verify the buttons
      test.true(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button available on page 2");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button no longer available on page 2");
      test.true(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button now available on page 2");

      //try to submit
      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field still available, it's required");

      test.fill(test.qS('input[name="text"]'), 'FAIL EMAIL');
      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');

      //should jump back to page 1
      test.true(test.canClick(test.qS('input[name="email"]')), "'email' field now invalid and available on page 1");

      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="text"]')), "we should have transition back to page 2, as server side errors should be retryable");

      test.fill(test.qS('input[name="text"]'), 'JUST ACCEPT IT');

      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');

      //should have submitted!
      test.eq("Done!", test.qS('form .wh-form__page--visible h2').textContent);
      let ps = test.qSA('form .wh-form__page--visible p.normal').filter(node => test.canClick(node)); //only count visible paragraphs
      test.eq(1, ps.length);
      test.eq("Thank you for filling this form, we will contact you at multipage@beta.webhare.net", ps[0].textContent);
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button not available on thankyou page");
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?multipage=1&cookiebar=1'
    }
  , async function()
    {
      test.eq("Page 1", test.qS('form .wh-form__page--visible h2').textContent);
      test.true(test.canClick(test.qS('input[name="email"]')), "'email' field available on page 1");
      test.false(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field not available on page 1");
      test.false(test.canClick(test.qS('input[name="text"]')), "'text' field not available on page 1");

      // Default state: page 1, page 2, thank you
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on page 1");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on page 1");
      test.true(test.canClick(test.qS('.wh-form__button--next')), "'next' button available on page 1");

      test.eq('<--', test.qS('.wh-form__button--previous').textContent);
      test.eq('volgende', test.qS('.wh-form__button--next').textContent);

      // Check the 'skipform' checkbox
      test.click(test.qS('input[name="skipform"]'));

      // 'Skip' state: page 1, thank you
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button still not available on page 1");
      test.true(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button now available on page 1");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button no longer available on page 1");

      //test that a disabled field should be treated as unset. showskipform should remove skipform and effectively treat it as unset
      test.click('input[name="showskipform"]'); //untoggles the checkbox and disables skipform
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "Should NOT be showing SUBMIT as skipform might be set but is inaccessible");
      test.true(test.canClick(test.qS('.wh-form__button--next')), "SHOULD be showing NEXT as skipform might be set but is inaccessible");

      test.click('input[name="showskipform"]'); //reactivate
      test.true(test.qS('input[name="skipform"]').checked);
      test.true(test.canClick(test.qS('.wh-form__button--submit')), "SUBMIT should be BACK again!");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "NEXT should be GONE again!");

      // Fill the required fields and submit
      test.fill(test.qS('input[name="firstname"]'), 'Homer');
      test.fill(test.qS('input[name="email"]'), 'multipage@beta.webhare.net');
      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');

      //should have submitted!
      test.eq("Done!", test.qS('form .wh-form__page--visible h2').textContent);
      let ps = test.qSA('form .wh-form__page--visible p.normal');
      test.eq("Thank you for filling this form, we will contact you at multipage@beta.webhare.net", ps[0].textContent);
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button not available on thankyou page");
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?multipage=1&cookiebar=1'
    }
  , async function()
    {
      test.eq("Page 1", test.qS('form .wh-form__page--visible h2').textContent);
      test.true(test.canClick(test.qS('input[name="email"]')), "'email' field available on page 1");
      test.false(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field not available on page 1");
      test.false(test.canClick(test.qS('input[name="text"]')), "'text' field not available on page 1");

      // Default state: page 1, page 2, thank you
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on page 1");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on page 1");
      test.true(test.canClick(test.qS('.wh-form__button--next')), "'next' button available on page 1");

      test.eq('<--', test.qS('.wh-form__button--previous').textContent);
      test.eq('volgende', test.qS('.wh-form__button--next').textContent);

      // Check the 'maybe' checkbox
      test.click(test.qS('input[name="fillmaybe"]'));

      // 'Maybe' state: page 1, maybe page, page 2, thank you
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button still not available on page 1");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button still not available on page 1");
      test.true(test.canClick(test.qS('.wh-form__button--next')), "'next' button still not available on page 1");

      // Fill the required fields and go to next page
      test.fill(test.qS('input[name="firstname"]'), 'Homer');
      test.fill(test.qS('input[name="email"]'), 'multipage@beta.webhare.net');
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      //test maybe page visibitility
      test.eq("Maybe Page", test.qS('form .wh-form__page--visible h2').textContent);
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field no longer available on maybe page");
      test.true(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field now available on maybe page");
      test.false(test.canClick(test.qS('input[name="text"]')), "'text' field still not available on maybe page");
      test.false(test.qS('*[data-wh-form-group-for="img"]').classList.contains("wh-form__fieldgroup--disabled"), "img should not be disabled");

      //verify the buttons
      test.true(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button now available on maybe page");
      test.true(test.canClick(test.qS('.wh-form__button--next')), "'next' button still available on maybe page");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button still not available on maybe page");

      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field still available on maybe page");

      // Fill the required 'maybe' field and go to page 2
      test.fill(test.qS('input[name="maybe"]'), 'definitely');
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      //test page2 visibitility
      test.eq("Page 2", test.qS('form .wh-form__page--visible h2').textContent);
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field not available on page 2");
      test.false(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field no longer available on page 2");
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field now available on page 2");

      //go back to maybe page
      test.click(test.qS('.wh-form__button--previous'));
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field still not available on maybe page");
      test.true(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field available again on maybe page");

      //go back to page1
      test.click(test.qS('.wh-form__button--previous'));
      test.true(test.canClick(test.qS('input[name="email"]')), "'email' field available again on page 1");
      test.false(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field available no longer available on page 1");

      //...back to maybe page again
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field not available again on maybe page");
      test.true(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field available again still on maybe page");

      //...and back to page2 again
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field not available again on page 2");
      test.false(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field no longer available on page 2");

      //verify the buttons
      test.true(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button available on page 2");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button no longer available on page 2");
      test.true(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button now available on page 2");

      //fill required field and submit
      test.fill(test.qS('input[name="text"]'), 'JUST ACCEPT IT');
      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');

      //should have submitted!
      test.eq("Done!", test.qS('form .wh-form__page--visible h2').textContent);
      let ps = test.qSA('form .wh-form__page--visible p.normal').filter(node => test.canClick(node)); //only count visible paragraphs
      test.eq("Thank you for filling this form, we will contact you at multipage@beta.webhare.net", ps[0].textContent);
      test.eq("We will definitely contact you", ps[1].textContent);
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button not available on thankyou page");
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?multipage=1&cookiebar=1'
    }
  , async function()
    {
      test.eq("Page 1", test.qS('form .wh-form__page--visible h2').textContent);

      // Check the 'maybe' checkbox
      test.click(test.qS('input[name="fillmaybe"]'));

      // Fill the required fields and go to next page
      test.fill(test.qS('input[name="firstname"]'), 'Homer');
      test.fill(test.qS('input[name="email"]'), 'multipage@beta.webhare.net');
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      // Fill the required 'maybe' field and go to page 2
      test.true(test.canFocus(test.qS('input[name="maybe"]')), "'maybe' field is available on page 2");
      test.false(test.canFocus(test.qS('input[name="never"]')), "'never' field is not available on page 2");
      test.eq(null, test.qS('input[name="hidden"]'), "Field name 'hidden' should not be there at all as its group is explicitly disabled");
      test.fill(test.qS('input[name="maybe"]'), 'not');

      // We should be able to page2 – the 'extra' field is invisble and thus not required
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field is available on page 2");

      //go back to page1
      test.click(test.qS('.wh-form__button--previous'));
      test.click(test.qS('.wh-form__button--previous'));

      // Uncheck the 'maybe' checkbox
      test.click(test.qS('input[name="fillmaybe"]'));

      //go directly to page2
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.false(test.canClick(test.qS('input[name="email"]')), "'email' field not available again on page 2");
      test.false(test.canClick(test.qS('input[name="maybe"]')), "'maybe' field no longer available on page 2");

      //go back to page1 and check the 'maybe' checkbox again
      test.click(test.qS('.wh-form__button--previous'));
      test.click(test.qS('input[name="fillmaybe"]'));

      //go to maybe page
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      // The 'maybe' field should still be enabled and the 'never' not
      test.true(test.canFocus(test.qS('input[name="maybe"]')), "'maybe' field is still available on page 2");
      test.false(test.canFocus(test.qS('input[name="never"]')), "'never' field is still not available on page 2");

      // We should be able to go to page2 – the 'extra' field is invisble and thus not required
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field available again on page 2");

      // go back and check the 'extra' checkbox, the 'extra' field should now be required
      test.click(test.qS('.wh-form__button--previous'));
      test.click(test.qS('input[name="fillextra"]'));
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.false(test.canClick(test.qS('input[name="text"]')), "'text' field not available because of required 'extra' field");

      // uncheck the 'extra' checkbox, the 'extra' field should no longer be required
      test.click(test.qS('input[name="fillextra"]'));
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field available again because 'extra' field no longer required");

      // go back and check the 'other' checkbox, the 'other' field should now be required
      test.click(test.qS('.wh-form__button--previous'));
      test.click(test.qS('input[name="fillother"]'));
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.false(test.canClick(test.qS('input[name="text"]')), "'text' field not available because of required 'other' field");

      // uncheck the 'other' checkbox, the 'other' field should no longer be required
      test.click(test.qS('input[name="fillother"]'));
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');
      test.true(test.canClick(test.qS('input[name="text"]')), "'text' field available again because 'other' field no longer required");

      //go back to page1
      test.click(test.qS('.wh-form__button--previous'));
      test.click(test.qS('.wh-form__button--previous'));

      // Uncheck the 'maybe' checkbox again and go to page2
      test.click(test.qS('input[name="fillmaybe"]'));
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      //fill required field and submit
      test.fill(test.qS('input[name="text"]'), 'JUST ACCEPT IT');
      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');

      //should have submitted!
      test.eq("Done!", test.qS('form .wh-form__page--visible h2').textContent);
      let ps = test.qSA('form .wh-form__page--visible p.normal');
      test.eq("Thank you for filling this form, we will contact you at multipage@beta.webhare.net", ps[0].textContent);
      test.false(test.canClick(test.qS('.wh-form__button--previous')), "'previous' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--submit')), "'submit' button not available on thankyou page");
      test.false(test.canClick(test.qS('.wh-form__button--next')), "'next' button not available on thankyou page");
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?multipage=1&cookiebar=1'
    }
  , "Test scrolling back up on error"
  , async function()
    {
      test.click('#multipagetest-vertspace');
      test.false(test.canClick(test.qS('.wh-form__button--next')));
      test.getWin().scrollTo(0, test.qS('*[data-wh-form-group-for="vertspacetext"]').getBoundingClientRect().bottom);

      test.false(test.canClick(test.qS('#multipagetest-firstname')),'firstname field should be out of sight');
      test.true(test.canClick(test.qS('.wh-form__button--next')));

      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      test.true(test.canClick('#multipagetest-firstname'),'firstname field should be back in sight because it caused submission failure');

      test.fill(test.qS('#multipagetest-firstname'), 'Homer');
      test.fill(test.qS('input[name="email"]'), 'multipage2@beta.webhare.net');
    }

  , "Test scrolling between pages"
  , async function()
    {
      test.getWin().scrollTo(0, test.qS('*[data-wh-form-group-for="vertspacetext"]').getBoundingClientRect().bottom);
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      test.true(test.canClick('input[name="text"]'),'text field is on page #3 and should be back in sight after page navigation');
      test.true(test.canClick('.multipageform__prefix'),'we also want the form top to be visible');
      test.fill(test.qS('input[name="text"]'), 'Text');

      test.getWin().scrollTo(0, test.qS('*[data-wh-form-group-for="vertspacetext2"]').getBoundingClientRect().bottom);
      test.click(test.qS('.wh-form__button--submit'));
      await test.wait('ui');

      test.true(test.canClick(test.qS('*[data-wh-form-group-for="text3"]')),'test final page is scrolled back too');
    }

  ,"Test disabled radio buttons not evaluating to a value"
  , async function()
    {
      await test.load(`${test.getTestSiteRoot()}testpages/formtest/?multipage=1&cookiebar=1`);
      test.fill('input[name="firstname"]', 'Homer');
      test.fill('input[name="email"]', 'multipage@beta.webhare.net');
      test.fill('#multipagetest-fillmaybe', true);
      test.fill('#multipagetest-metabonusquestion-holygrail', true);

      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      test.fill('#multipagetest-maybe', "yep!");
      test.fill('#multipagetest-bonusquestion-answer3', true);
      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      test.true(test.canClick("[data-wh-form-group-for=bonuspagetext]")); //should see the bonus!
      test.eq('3', test.qS('#currentpage').textContent);

      test.click(test.qS('.wh-form__button--previous'));
      test.click(test.qS('.wh-form__button--previous'));

      test.eq('1', test.qS('#currentpage').textContent);
      test.fill('#multipagetest-fillmaybe', false);

      test.click(test.qS('.wh-form__button--next'));
      await test.wait('ui');

      test.eq('4', test.qS('#currentpage').textContent);
    }
  ]);
