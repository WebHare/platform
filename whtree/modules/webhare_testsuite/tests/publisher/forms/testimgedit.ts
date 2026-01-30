import * as test from '@mod-system/js/wh/testframework';
import { loadImage } from '@webhare/dompack';
import { prepareUpload } from '@webhare/test-frontend';
import { getFormData, type FormFileValue } from '@webhare/forms';

interface RTDForm {
  file: FormFileValue[];
  file2: FormFileValue[];
  files: FormFileValue[];
  img: FormFileValue[];
  imgs: FormFileValue[];
}

test.runTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&mode=writeonly'); //writeonly: dont read any existing state on first render, or earlier tests will interfere
    },

    'Reset image',
    async function () {
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
      test.click('#rtdtest-img');
      await test.waitForUI();
    },
    {
      test: async function () {
        const imgCompRoot = test.qR('#rtdtest-img').shadowRoot;
        test.assert(imgCompRoot);
        test.assert(imgCompRoot.querySelector('img'), 'no image present');
        test.assert(imgCompRoot.querySelector('.image__deletebutton'), 'no delete button');
        const imgurl = imgCompRoot.querySelector('img')?.src;
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

        const imgCompRoot = test.qR('#rtdtest-img').shadowRoot;
        test.assert(imgCompRoot);
        test.assert(imgCompRoot.querySelector('img'), 'no image present #2');
        const imgurl = imgCompRoot.querySelector('img')?.src;
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
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');

        const imgCompRoot = test.qR('#rtdtest-img').shadowRoot;
        test.assert(imgCompRoot);
        test.assert(imgCompRoot.querySelector('img'), 'no image present #3');
        test.assert(imgCompRoot.querySelector('.image__deletebutton'), 'no delete button');

        test.click('#rtdtest-enablefields');
        test.assert(!test.qR('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");
        test.assert(!test.canClick(test.qR(imgCompRoot, '.image__deletebutton')));

        test.assert(test.qR("#rtdtest-img").hasAttribute("disabled"));
        test.click('#rtdtest-enablefields');

        test.assert(test.qR('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");

        test.assert(!test.qR("#rtdtest-img").hasAttribute("disabled"));

        await test.waitToggled({
          test: () => !test.qS(imgCompRoot, 'img'),
          run: () => test.click(test.qR(imgCompRoot, '.image__deletebutton'))
        }, 'image should have gone away after clicking delete');
        test.assert(!test.qS(imgCompRoot, '.image__deletebutton'), 'delete button still present');
      }
    },
    {
      name: 'Test error handling',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&imgrequired=1');
        const imgCompRoot = test.qR('#rtdtest-img').shadowRoot!;
        test.focus('#rtdtest-img');
        test.click(test.qR(imgCompRoot, '.image__deletebutton')); //kill image
        test.click('#submitbutton'); //image should be removed. submit
        await test.waitForUI();

        const imggroup = test.qR('#rtdtest-img').closest('.wh-form__fieldgroup');
        test.assert(imggroup);
        test.assert(imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload a small image that's too small
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/logo.png']);
        test.click('#rtdtest-img');
        await test.waitForUI();
        test.assert(imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should still be in error');

        //dynamically remove the min width constraint
        test.qR('#rtdtest-img').setAttribute("min-width", "0");
        //re-upload to trigger revalidation
        test.click(test.qR(imgCompRoot, '.image__deletebutton')); //kill image
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/logo.png']);
        test.click('#rtdtest-img');
        await test.waitForUI();
        test.assert(!imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');

        //dynamically set a max height constraint
        test.qR('#rtdtest-img').setAttribute("max-height", "500");
        //upload portrait image that's too high
        test.click(test.qR(imgCompRoot, '.image__deletebutton')); //kill image
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
        test.click('#rtdtest-img');
        await test.waitForUI();
        test.assert(imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error again');

        //upload landscape image
        test.click(test.qR(imgCompRoot, '.image__deletebutton')); //kill image
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg']);
        test.click('#rtdtest-img');
        await test.waitForUI();

        test.assert(!imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should finally be out of error');
      }
    },

    'Test multi image',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&mode=writeonly'); //drop stored data
      const imgsCompRoot = test.qR('#rtdtest-imgs').shadowRoot!;
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
      test.qR(imgsCompRoot, '.image--placeholder').click();
      await test.waitForUI();

      prepareUpload(["/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg"]);
      test.qR(imgsCompRoot, '.image--placeholder').click();
      await test.waitForUI();

      const formdata = getFormData<RTDForm>(test.qR('#rtdform'));
      test.eqPartial({
        imgs: [{ fileName: "portrait_8.jpg" }, { fileName: "landscape_4.jpg" },]
      }, formdata);

      test.click('#submitbutton');
      await test.waitForUI();

      {
        const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent || '');
        test.eqPartial({
          imgs: [{ filename: "portrait_8.jpg" }, { filename: "landscape_4.jpg" },]
        }, serverreponse);
      }
    },

    'Initially disabled imgedit',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&disabled=1');
      test.assert(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[disabled]'));
    }
  ]);
