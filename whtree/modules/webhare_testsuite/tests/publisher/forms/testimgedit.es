import test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import * as preload from 'dompack/extra/preload';
import { readBackgroundUrl } from '@mod-publisher/js/forms/fields/imgedit';

test.registerTests(
  [ { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte'
    }
  , 'Reset image'
  , async function()
    {
      test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg'
                           , filename: 'portrait_8.jpg'
                           }]);
      test.false(test.qS('[data-wh-form-group-for=img]').classList.contains("wh-form--uploading"));
      test.qS('#rtdtest-img').click();

      //click handler processing is async, so give it a chance to run
      await test.wait( () => test.qS('[data-wh-form-group-for=img]').classList.contains("wh-form--uploading"));
      await test.wait('ui');
    }
  , { test: async function()
      {
        test.false(test.qS('[data-wh-form-group-for=img]').classList.contains("wh-form--uploading"));
        let img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.true(img, 'no image present');
        test.true(test.qS('#rtdtest-img .wh-form__imgeditdelete'), 'no delete button');
        test.true(test.qS('#rtdtest-img').classList.contains('wh-form__imgedit--hasimage'));
        let imgurl = readBackgroundUrl(img);
        test.true(imgurl, 'no image url');
        let imginfo = await preload.promiseImage(imgurl);
        test.eq(450, Math.floor(imginfo.width)); //should be portrait even though we uploaded landscape
        test.click('#submitbutton');
      }
    , waits:['ui']
    }
  , { test: function()
      {
        let serverreponse = JSON.parse(test.qS('#rtdformresponse').textContent);
        test.eq('.jpg', serverreponse.img.extension);
        test.eq(600, serverreponse.img.width);
        test.eq(90, serverreponse.img.rotation);
      }
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte'
    }
  , { name: 'Verify reloaded image'
    , test: async function()
      {
        //wait for image to load
        let img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.true(img, 'no image present #2');
        test.true(test.qS('#rtdtest-img').classList.contains('wh-form__imgedit--hasimage'));
        let imgurl = readBackgroundUrl(img);
        test.true(imgurl, 'no image url');
        let imginfo = await preload.promiseImage(imgurl);
        test.eq(450, Math.floor(imginfo.width)); //should be portrait even though we uploaded landscape
        //save loaded image again
        test.click('#submitbutton');
      }
    , waits:['ui']
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte'
    }
  , { name: 'Verify re-reloaded image'
    , test: async function()
      {
        //wait for image to load
        let img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.true(img, 'no image present #3');
        test.true(test.qS('#rtdtest-img .wh-form__imgeditdelete'), 'no delete button');

        test.click(test.qS('#rtdtest-enablefields'));
        test.false(test.qS('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");

        test.qS('#rtdtest-img .wh-form__imgeditdelete').click();

        img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.true(img, 'image should still be present');

        test.click(test.qS('#rtdtest-enablefields'));
        test.true(test.qS('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");
        test.qS('#rtdtest-img .wh-form__imgeditdelete').click();

        img = test.qS('#rtdtest-img .wh-form__imgeditimg');
        test.false(img, 'image still present');
        test.false(test.qS('#rtdtest-img .wh-form__imgeditdelete'), 'delete button still present');
        test.false(test.qS('#rtdtest-img').classList.contains('wh-form__imgedit--hasimage'));
      }
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&imgrequired=1'
    }
  , { name: 'Test error handling'
    , test: async function()
      {
        test.qS('#rtdtest-img').focus();
        test.click('.wh-form__imgeditdelete'); //kill image
        test.click('#submitbutton'); //image should be removed. submit
        await test.wait('ui');

        let imggroup = dompack.closest(test.qS('#rtdtest-img'), '.wh-form__fieldgroup');
        test.true(imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload an image
        test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg'
                             , filename: 'portrait_8.jpg'
                             }]);
        test.qS('#rtdtest-img').click();
        await test.wait('ui');

        test.false(imggroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&disabled=1' }

  , 'Initially disabled imgedit'
  , async function()
    {
      test.true(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'));
    }
  ]);
