import * as test from '@mod-system/js/wh/testframework';

function getFormRPCRequests() {
  return Array.from(test.getWin().performance.getEntriesByType('resource')).filter(node => node.name.includes("/wh_services/publisher/forms/"));
}

test.registerTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupEmailFieldtest'); //creates a simple blacklist
    },

    'Check smart email field BLOCKING ON SUBMIT',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?email=1');
      test.eq(0, getFormRPCRequests().length, "Should be no RPC requests yet");

      test.fill('#emailform-email', "PIETJE@BLOCKED.BETA.WEBHARE.NET");
      test.click('.wh-form__button--submit');
      await test.wait('ui');
      test.eq(1, getFormRPCRequests().length, "Only one RPC, for the validation");

      const emailgroup = test.qS('#emailform-email')?.closest('.wh-form__fieldgroup');
      test.assert(emailgroup?.classList.contains('wh-form__fieldgroup--error')); //this field is in error

      test.eq(/problemen.*@blocked.beta.webhare.net/, emailgroup?.querySelector('.wh-form__error')?.textContent);

      test.fill("#emailform-email", "acceptable@beta.webhare.net");
      await test.pressKey('Tab');
      await test.wait(() => getFormRPCRequests().length >= 2);// A RPC to check 'acceptable' is okay

      test.click('.wh-form__button--submit');
      await test.wait('ui');

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

      //now try to correct it ourselves!
      test.click('#emailform-email');
      test.fill('#emailform-email', "piet@fuzy.beta.webhare.ne");
      await test.wait("ui");
      test.eq(null, test.qS('.wh-form__emailcorrected'), 'suggestion element should be cleared immediately after editing');

      test.eq(4, getFormRPCRequests().length, "STILL only 4 rpcs!");

      test.click('.wh-form__button--submit');
      await test.wait('ui');

      test.eq(5, getFormRPCRequests().length, "We accept 5 rpcs (but no more) as emailvalidation might race submission RPC");
    }


  ]);
