import * as test from "@mod-tollium/js/testframework";
import * as rtetestapi from '@mod-tollium/js/testframework-rte';
import { prepareUpload } from '@webhare/test-frontend';
import type StructuredEditor from '@mod-tollium/web/ui/components/richeditor/internal/structurededitor';

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
      test: async function () {
        rtetestapi.setStructuredContent(test.qS('[name="rtd"]'), '<p class="normal">"Ik wil hier(*0*)een object"</p>');
        test.qR(videobuttonselector).click();
        await test.waitForUI();
      }
    },
    {
      test: async function () {
        test.eq(null, test.qS('#embedvideo'));
        test.eq(null, test.qS('#embedvideo-videourl')); //do not want the fields to leak with a name

        test.eq(1, test.qSA('.mydialog').length); //should be only one dialog
        test.qR('.mydialog input[name=videourl]').value = 'https://www.youtube.com/watch?v=u-e3CcIBxdw';
        test.qR('.mydialog button.wh-form__button--submit').click();
        await test.waitForUI();
      }
    },
    {
      name: 'Test beagle',
      test: async function () {
        await verifyBeagleVideo();
        test.click('#submitbutton');
        await test.waitForUI();
      }
    },
    {
      name: 'Test beagle after reload',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1');
        await verifyBeagleVideo();
      }
    },
    {
      name: 'Paste beagle, the form should render it',
      test: async function () {
        const rtenode = test.qR('[name="rtd"]');
        const rte = (rtenode as unknown as { rte: StructuredEditor }).rte;
        const rtebody = test.qR(rtenode, '.wh-rtd__body');
        const embobj = test.qR<HTMLElement>(rtebody, 'div.wh-rtd-embeddedobject');

        //The preview on the clipboard can't be trusted and should never end up in the RTE
        const pasted = embobj.cloneNode(true) as HTMLElement;
        test.qR(pasted, '.wh-rtd-embeddedobject__preview').innerHTML = `<span class="evil">evil</span>`;

        rte.focus();
        rtetestapi.setRTESelection(test.getWin(), rte, {
          startContainer: rtebody.querySelector('p')!.firstChild!,
          startOffset: 0,
          endContainer: rtebody.querySelector('p')!.firstChild!,
          endOffset: 0
        });
        await rtetestapi.paste(rte, { typesdata: { "text/html": pasted.outerHTML } });
        test.eq(1, rtebody.querySelectorAll('.wh-rtd-embeddedobject--placeholder').length);
        await test.waitForUI();

        test.eq(0, rtebody.querySelectorAll('.evil, .wh-rtd-embeddedobject--placeholder').length);
        const embobjs = rtebody.querySelectorAll('div.wh-rtd-embeddedobject');
        test.eq(2, embobjs.length);
        for (const obj of embobjs)
          test.assert(obj.textContent?.toUpperCase().includes("8 WEEKS OLD"));
      }
    },

    {
      name: 'Insert image!',
      test: async function () {
        rtetestapi.setStructuredContent(test.qS('[name="rtd"]'), '<p class="normal">"Ik wil hier(*0*)een afbeelding"</p>');
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
        test.qR('[name="rtd"] [data-button="img"]').click();
        await test.waitForUI();
      }
    },

    {
      name: 'Verify image',
      test: async function () {
        await verifyImage();
        test.click('#submitbutton');
        await test.waitForUI();
      }
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
