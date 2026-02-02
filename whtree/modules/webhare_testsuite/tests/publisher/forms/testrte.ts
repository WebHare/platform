import * as test from "@mod-tollium/js/testframework";
import * as rtetestapi from '@mod-tollium/js/testframework-rte';
import { prepareUpload } from '@webhare/test-frontend';

const videobuttonselector = '[name="rtd"] [data-button="object-video"]';
const tablebuttonselector = '[name="rtd"] [data-button="table"]';

async function verifyBeagleVideo() {
  const rtebody = await test.waitForElement('[name="rtd"] .wh-rtd__body');
  test.eq(2, rtebody.querySelectorAll('p').length);

  const embobj = rtebody.querySelector('div.wh-rtd-embeddedobject');
  test.assert(embobj);
  test.assert(embobj.textContent?.toUpperCase().includes("8 WEEKS OLD"));

  test.assert(embobj.querySelector('.wh-rtd-deletebutton'));
  test.assert(!embobj.querySelector('.wh-rtd-editbutton'));
}

async function verifyImage() {
  const rtebody = test.qR('[name="rtd"] .wh-rtd__body');
  test.eq(1, rtebody.querySelectorAll('p').length);
  test.eq(1, rtebody.querySelectorAll('img').length);

  const imgobj = test.qR<HTMLImageElement>(rtebody, 'img');
  //wait for the image to be loaded!
  await test.wait(() => imgobj.complete);
  test.eq(450, Math.round(imgobj.getBoundingClientRect().width));
}

test.runTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
    },

    'Reset RTE',
    async function () {
      //We didn't specify a video provider so the button shouldn't be there
      test.eq(null, test.qS(videobuttonselector), 'video button should not be present yet');
      //There is no table style defined in the rtd's structure so the button shouldn't be there
      test.eq(null, test.qS(tablebuttonselector), 'table button should not be present yet');

      const rtebody = await test.waitForElement('[name="rtd"] .wh-rtd__body');
      rtebody.innerHTML = '<p class="normal">Initial state</p>';
      test.click('#submitbutton');
      await test.waitForUI();
      const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent!);
      test.eq('<html><body><p class="normal">Initial state</p></body></html>', serverreponse.htmltext);
    },

    {
      name: 'Verify basic RTE content',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1');
        const rtebody = await test.waitForElement('[name="rtd"] .wh-rtd__body');
        test.eq(1, rtebody.querySelectorAll('p').length);
        test.eq('Initial state', rtebody.querySelectorAll('p')[0].textContent);
      }
    },

    'test RPC',
    async function () {
      const rtebody = test.qR('[name="rtd"] .wh-rtd__body');
      rtebody.innerHTML = '<p class="normal">Changed content</p>';
      test.eq(1, rtebody.querySelectorAll('p').length);
      test.eq('Changed content', rtebody.querySelectorAll('p')[0].textContent);

      test.assert(!test.qS('html.dompack--busymodal'));
      test.click('.prefillbutton');
      test.assert(test.qS('html.dompack--busymodal'));

      await test.waitForUI();
      test.assert(!test.qS('html.dompack--busymodal'));

      test.eq(1, rtebody.querySelectorAll('p').length);
      test.eq('Initial state', rtebody.querySelectorAll('p')[0].textContent);
    },

    {
      name: 'Insert beagle',
      test: function () {
        rtetestapi.setStructuredContent(test.qS('[name="rtd"]'), '<p class="normal">"Ik wil hier(*0*)een object"</p>');
        test.qR(videobuttonselector).click();
      },
      waits: ['ui']
    },
    {
      test: function () {
        test.eq(null, test.qS('#embedvideo'));
        test.eq(null, test.qS('#embedvideo-videourl')); //do not want the fields to leak with a name

        test.eq(1, test.qSA('.mydialog').length); //should be only one dialog
        test.qR('.mydialog input[name=videourl]').value = 'https://www.youtube.com/watch?v=u-e3CcIBxdw';
        test.qR('.mydialog button.wh-form__button--submit').click();
      },
      waits: ['ui']
    },
    {
      name: 'Test beagle',
      test: async function () {
        await verifyBeagleVideo();
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    {
      name: 'Test beagle after reload',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1');
        await verifyBeagleVideo();
      }
    },

    {
      name: 'Insert image!',
      test: async function () {
        rtetestapi.setStructuredContent(test.qS('[name="rtd"]'), '<p class="normal">"Ik wil hier(*0*)een afbeelding"</p>');
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
        test.qR('[name="rtd"] [data-button="img"]').click();
      },
      waits: ['ui']
    },

    {
      name: 'Verify image',
      test: async function () {
        await verifyImage();
        test.click('#submitbutton');
      },
      waits: ['ui']
    },

    {
      name: 'Verify image after reload',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1');
        await verifyImage();
      }
    },

    {
      name: 'Test disable',
      test: async function () {
        test.click('#rtdtest-enablefields');
        test.assert(!test.qR('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");

        const rtenode = test.qR('[name="rtd"] .wh-rtd__stylescope');
        test.assert(rtenode.classList.contains("wh-rtd--disabled"));

        test.click('#rtdtest-enablefields');
        test.assert(test.qR('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");

        test.assert(!rtenode.classList.contains("wh-rtd--disabled"));
      }
    },

    {
      name: 'Test error handling',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&rtdrequired=1');
        await test.waitForElement('[name="rtd"] .wh-rtd__body');
        rtetestapi.setStructuredContent(test.qS('[name="rtd"]'), '<p class="normal"><br data-wh-rte="bogus"/></p>');
        test.click('#submitbutton'); //image should be removed. submit
        await test.waitForUI();

        const rtdgroup = test.qR('#rtdtest-rtd').closest('.wh-form__fieldgroup');
        test.assert(rtdgroup?.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        rtetestapi.setStructuredContent(test.qS('[name="rtd"]'), '<p class="normal">"(*0*)"<br data-wh-rte="bogus"/></p>');
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
        test.qR('[name="rtd"] [data-button="img"]').click();
        await test.waitForUI();

        test.click('#submitbutton'); //image should be removed. submit
        await test.waitForUI();

        test.assert(!rtdgroup!.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    }
  ]);
