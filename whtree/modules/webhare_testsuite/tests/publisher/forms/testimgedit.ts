import * as test from '@mod-system/js/wh/testframework';
import { loadImage } from '@webhare/dompack';
import { readBackgroundUrl } from '@mod-publisher/js/forms/fields/imgedit';
import { prepareUpload } from '@webhare/test-frontend';

test.registerTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
    },
    'Reset image',
    async function () {
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
      test.click('#rtdtest-img');
      await test.wait('ui');
    },
    {
      test: async function () {
        const img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.assert(img, 'no image present');
        test.assert(test.qS('#rtdtest-img .wh-form__imgeditdelete'), 'no delete button');
        test.assert(test.qR('#rtdtest-img').classList.contains('wh-form__imgedit--hasimage'));
        const imgurl = readBackgroundUrl(img);
        test.assert(imgurl, 'no image url');
        const imginfo = await loadImage(imgurl);
        test.eq(450, Math.floor(imginfo.naturalWidth)); //should be portrait even though we uploaded landscape
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    {
      test: function () {
        const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent || '');
        test.eq('.jpg', serverreponse.img.extension);
        test.eq(600, serverreponse.img.width);
        test.eq(90, serverreponse.img.rotation);
      }
    },
    {
      name: 'Verify reloaded image',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
        //wait for image to load
        const img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.assert(img, 'no image present #2');
        test.assert(test.qR('#rtdtest-img').classList.contains('wh-form__imgedit--hasimage'));
        const imgurl = readBackgroundUrl(img);
        test.assert(imgurl, 'no image url');
        const imginfo = await loadImage(imgurl);
        test.eq(450, Math.floor(imginfo.naturalWidth)); //should be portrait even though we uploaded landscape
        //save loaded image again
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    {
      name: 'Verify re-reloaded image',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');

        //wait for image to load
        let img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.assert(img, 'no image present #3');
        test.assert(test.qS('#rtdtest-img .wh-form__imgeditdelete'), 'no delete button');

        test.click('#rtdtest-enablefields');
        test.assert(!test.qR('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");

        test.click('#rtdtest-img .wh-form__imgeditdelete');

        img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.assert(img, 'image should still be present');

        test.click('#rtdtest-enablefields');
        test.assert(test.qR('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");
        test.click('#rtdtest-img .wh-form__imgeditdelete');

        img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.assert(!img, 'image still present');
        test.assert(!test.qS('#rtdtest-img .wh-form__imgeditdelete'), 'delete button still present');
        test.assert(!test.qR('#rtdtest-img').classList.contains('wh-form__imgedit--hasimage'));
      }
    },
    {
      name: 'Test error handling',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&imgrequired=1');
        test.focus('#rtdtest-img');
        test.click('.wh-form__imgeditdelete'); //kill image
        test.click('#submitbutton'); //image should be removed. submit
        await test.wait('ui');

        const imggroup = test.qR('#rtdtest-img').closest('.wh-form__fieldgroup');
        test.assert(imggroup);
        test.assert(imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload an image
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
        test.click('#rtdtest-img');
        await test.wait('ui');

        test.assert(!imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    },

    'Initially disabled imgedit',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&disabled=1');
      test.assert(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'));
    }
  ]);
