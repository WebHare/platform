import * as test from '@mod-system/js/wh/testframework';

function getFormRPCRequests() {
  return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.includes("/wh_services/publisher/forms/"));
}

test.runTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupEmailFieldtest'); //creates a simple blacklist
      //@ts-ignore expose getFormRPCRequests for test debugging
      test.getWin().top.getFormRPCRequests = getFormRPCRequests;
    },

    'Check smart email field BLOCKING ON SUBMIT',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?email=1');
      test.eq(0, getFormRPCRequests().length, "Should be no RPC requests yet");
      test.eq("email", test.qR("#emailform-email").type);
      test.eq("email", test.qR("#emailform-email_sendfrom").type);

      test.fill('#emailform-email', "PIETJE@BLOCKED.BETA.WEBHARE.NET");
      test.fill('#emailform-email_sendfrom', "a@a");

      await test.pressKey("Enter"); //enter should be a subtitute for the submit button
      await test.wait('ui');
      test.eq(1, getFormRPCRequests().length, "Only one RPC, for the validation");

      const emailgroup = test.qS('#emailform-email')?.closest('.wh-form__fieldgroup');
      const emailSendFromgroup = test.qS('#emailform-email_sendfrom')?.closest('.wh-form__fieldgroup');
      test.assert(emailgroup?.classList.contains('wh-form__fieldgroup--error')); //this field is in error
      test.assert(emailSendFromgroup?.classList.contains('wh-form__fieldgroup--error'));

      test.eq(/problemen.*@blocked.beta.webhare.net/, emailgroup?.querySelector('.wh-form__error')?.textContent);

      test.fill("#emailform-email", "acceptable@beta.webhare.net");
      test.fill('#emailform-email_sendfrom', ""); //clear it again, should not interfere with submission
      await test.pressKey('Tab');
      await test.wait(() => getFormRPCRequests().length >= 2);// A RPC to check 'acceptable' is okay

      test.click('.wh-form__button--submit');
      await test.wait('ui');

      test.assert(!emailSendFromgroup?.classList.contains('wh-form__fieldgroup--error')); //should have cleared after emptying
      test.eq(3, getFormRPCRequests().length, "Should have only added a RPC for the submit, email was already ok");
      test.assert(test.qR('[data-wh-form-pagerole="thankyou"]').classList.contains('wh-form__page--visible'), "thankyou page must be visible now");
    },

    'Check smart email field BLOCKING ON FOCUS',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?email=1');

      test.click('#emailform-email');
      test.eq(0, getFormRPCRequests().length, "Should be no RPC requests yet");

      test.fill('#emailform-email', "PIETJE@BLOCKED.BETA.WEBHARE.NET");
      await test.pressKey('Tab');

      const emailgroup = test.qR('#emailform-email').closest('.wh-form__fieldgroup')!;
      await test.wait(() => emailgroup.classList.contains('wh-form__fieldgroup--error')); //wait for group to error out
      test.eq(1, getFormRPCRequests().length);

      test.eq(/problemen.*@blocked.beta.webhare.net/, emailgroup.querySelector('.wh-form__error')?.textContent);

      test.click('#emailform-email');
      test.fill('#emailform-email', "baduser@example.org");
      await test.pressKey('Tab');
      await test.wait(() => emailgroup.querySelector('.wh-form__error')?.textContent?.match(/BAD BAD BAD/));

      //clear the field
      test.click('#emailform-email');
      test.fill('#emailform-email', "");
      await test.pressKey('Tab');
      await test.wait(() => emailgroup.querySelector('.wh-form__error')?.textContent?.match(/verplicht/));

    },
    'Check smart email field CORRECTING on focus',
    async function () {
      test.click('#emailform-email');
      test.fill('#emailform-email', "fixme@bijna.beta.WEBHARE.net");
      await test.pressKey('Tab');

      await test.wait(() => test.qR('#emailform-email').value === 'fixme@exact.beta.webhare.net');
      await test.sleep(100);
      test.eq(3, getFormRPCRequests().length);
    },
    'Check smart email field SUGGESTING on focus',
    async function () {
      test.click('#emailform-email');
      test.fill('#emailform-email', "pietje@fuzy.beta.webhare.net");
      await test.pressKey('Tab');

      await test.wait(() => test.qS('.wh-form__emailcorrected'));
      test.eq(4, getFormRPCRequests().length);

      test.eq('pietje@fuzzy.beta.webhare.net', test.qR('.wh-form__emailcorrected').textContent);
      test.eq('Bedoel je pietje@fuzzy.beta.webhare.net?', test.qR('.wh-form__emailcorrection').textContent);
      test.click('.wh-form__emailcorrected');
      test.eq('pietje@fuzzy.beta.webhare.net', test.qR('#emailform-email').value);
      test.eq(null, test.qS('.wh-form__emailcorrected'), 'suggestion element should be gone');

      //put the old data back
      test.click('#emailform-email');
      test.fill('#emailform-email', "pietje@fuzy.beta.webhare.net");
      await test.pressKey('Tab');

      //wait for the correction...
      await test.wait(() => test.qS('.wh-form__emailcorrected'));
      test.eq(4, getFormRPCRequests().length, "STILL at 4 rpcs... as we cached the previous answer!");

      //now try to correct it ourselves, but we miscorrect
      test.click('#emailform-email');
      test.fill('#emailform-email', "piet@fuzy.beta.webhare.ne");
      await test.wait("ui");
      test.eq(null, test.qS('.wh-form__emailcorrected'), 'suggestion element should be cleared immediately after editing');

      test.click('.wh-form__button--submit');

      //This submit should FAIL as the email address is not acceptable
      await test.wait('ui');
      test.eq(5, getFormRPCRequests().length, "Expect 5 rpcs, the validation for piet@fuzy.beta.webhare.ne should have gone out");

      const emailgroup = test.qS('#emailform-email')?.closest('.wh-form__fieldgroup');
      test.assert(emailgroup && emailgroup.classList.contains('wh-form__fieldgroup--error')); //wait for group to error out
      test.assert(emailgroup.querySelector('.wh-form__error')?.textContent?.match(/BAD BAD BAD/));

      test.fill('#emailform-email', "pietje@fuzzy.beta.webhare.net");
      test.click('.wh-form__button--submit');
      await test.wait('ui');

      test.assert(!emailgroup.classList.contains('wh-form__fieldgroup--error')); //should have been cleared

      test.eq(6, getFormRPCRequests().length, "Expect 6 rpcs, just the submission");
      test.eq("2", test.qS("#currentpage")?.textContent);
    }
  ]);
