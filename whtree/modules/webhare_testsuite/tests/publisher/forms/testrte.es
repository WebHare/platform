import * as test from "@mod-tollium/js/testframework";
import * as dompack from 'dompack';
import * as rtetestapi from '@mod-tollium/js/testframework-rte';

let videobuttonselector = '[data-wh-form-name="rtd"] [data-button="object-video"]';
let tablebuttonselector = '[data-wh-form-name="rtd"] [data-button="table"]';

function verifyBeagleVideo()
{
  let rtebody = test.qS('[data-wh-form-name="rtd"] .wh-rtd__body');
  test.eq(2, rtebody.querySelectorAll('p').length);

  let embobj = rtebody.querySelector('div.wh-rtd-embeddedobject');
  test.true(embobj);
  test.true(embobj.textContent.toUpperCase().includes("8 WEEKS OLD"));

  test.true(embobj.querySelector('.wh-rtd-deletebutton'));
  test.false(embobj.querySelector('.wh-rtd-editbutton'));
}

function verifyImage()
{
  let rtebody = test.qS('[data-wh-form-name="rtd"] .wh-rtd__body');
  test.eq(1, rtebody.querySelectorAll('p').length);
  test.eq(1, rtebody.querySelectorAll('img').length);

  let imgobj = rtebody.querySelector('img');
  test.eq(450, Math.round(imgobj.getBoundingClientRect().width));
}

test.registerTests(
  [ { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte'
    }
  , { name: 'Reset RTE'
    , test: function()
      {
        //We didn't specify a video provider so the button shouldn't be there
        test.eq(null, test.qS(videobuttonselector), 'video button should not be present yet');
        //There is no table style defined in the rtd's structure so the button shouldn't be there
        test.eq(null, test.qS(tablebuttonselector), 'table button should not be present yet');

        let rtebody = test.qS('[data-wh-form-name="rtd"] .wh-rtd__body');
        rtebody.innerHTML='<p class="normal">Initial state</p>';
        test.click(test.qS('#submitbutton'));
      }
    , waits:['ui']
    }
  , { test: function()
      {
        let serverreponse = JSON.parse(test.qS('#rtdformresponse').textContent);
        test.eq('<html><body><p class=\"normal\">Initial state</p></body></html>', serverreponse.htmltext);
      }
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1'
    }
  , { name: 'Verify basic RTE content'
    , test: function()
      {
        let rtebody = test.qS('[data-wh-form-name="rtd"] .wh-rtd__body');
        test.eq(1, rtebody.querySelectorAll('p').length);
        test.eq('Initial state', rtebody.querySelectorAll('p')[0].textContent);
      }
    }

  , 'test RPC'
  , async function()
    {
      let rtebody = test.qS('[data-wh-form-name="rtd"] .wh-rtd__body');
      rtebody.innerHTML='<p class="normal">Changed content</p>';
      test.eq(1, rtebody.querySelectorAll('p').length);
      test.eq('Changed content', rtebody.querySelectorAll('p')[0].textContent);

      test.false(test.qS('html.dompack--busymodal'));
      test.click(test.qS('.prefillbutton'));
      test.true(test.qS('html.dompack--busymodal'));

      await test.wait('ui');
      test.false(test.qS('html.dompack--busymodal'));

      test.eq(1, rtebody.querySelectorAll('p').length);
      test.eq('Initial state', rtebody.querySelectorAll('p')[0].textContent);
    }

  , { name: 'Insert beagle'
    , test: function()
      {
        rtetestapi.setStructuredContent(test.qS('[data-wh-form-name="rtd"]'), '<p class="normal">"Ik wil hier(*0*)een object"</p>');
        test.qS(videobuttonselector).click();
      }
    , waits:['ui']
    }
  , { test:function()
      {
        test.eq(null, test.qS('#embedvideo'));
        test.eq(null, test.qS('#embedvideo-videourl')); //do not want the fields to leak with a name

        test.eq(1, test.qSA('.mydialog').length); //should be only one dialog
        test.qS('.mydialog input[name=videourl]').value='https://www.youtube.com/watch?v=u-e3CcIBxdw';
        test.qS('.mydialog button.wh-form__button--submit').click();
      }
    , waits:['ui']
    }
  , { name: 'Test beagle'
    , test: function()
      {
        verifyBeagleVideo();
        test.click(test.qS('#submitbutton'));
      }
    , waits:['ui']
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1'
    }
  , { name: 'Test beagle after reload'
    , test: function()
      {
        verifyBeagleVideo();
      }
    }

  , { name: 'Insert image!'
    , test: async function()
      {
        rtetestapi.setStructuredContent(test.qS('[data-wh-form-name="rtd"]'), '<p class="normal">"Ik wil hier(*0*)een afbeelding"</p>');
        let uploadpromise = test.prepareUpload(
            [ { url: '/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg'
              , filename: 'portrait_8.jpg'
              }
            ]);
        test.qS('[data-wh-form-name="rtd"] [data-button="img"]').click();
        await uploadpromise;
      }
    , waits:['ui']
    }

  , { name: 'Verify image'
    , test: function()
      {
        verifyImage();
        test.click(test.qS('#submitbutton'));
      }
    , waits:['ui']
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&video=1'
    }
  , { name: 'Verify image after reload'
    , test: function()
      {
        verifyImage();
      }
    }

  , { name: 'Test disable'
    , test: async function()
      {
        test.click(test.qS('#rtdtest-enablefields'));
        test.false(test.qS('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");

        let rtenode = test.qS('[data-wh-form-name="rtd"] .wh-rtd__stylescope');
        test.true(rtenode.classList.contains("wh-rtd--disabled"));

        test.click(test.qS('#rtdtest-enablefields'));
        test.true(test.qS('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");

        test.false(rtenode.classList.contains("wh-rtd--disabled"));
      }
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&rtdrequired=1'
    }
  , { name: 'Test error handling'
    , test: async function()
      {
        rtetestapi.setStructuredContent(test.qS('[data-wh-form-name="rtd"]'), '<p class="normal"><br data-wh-rte="bogus"/></p>');
        test.click('#submitbutton'); //image should be removed. submit
        await test.wait('ui');

        let rtdgroup = dompack.closest(test.qS('#rtdtest-rtd'), '.wh-form__fieldgroup');
        test.true(rtdgroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        rtetestapi.setStructuredContent(test.qS('[data-wh-form-name="rtd"]'), '<p class="normal">"(*0*)"<br data-wh-rte="bogus"/></p>');
        let uploadpromise = test.prepareUpload(
            [ { url: '/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg'
              , filename: 'portrait_8.jpg'
              }
            ]);
        test.qS('[data-wh-form-name="rtd"] [data-button="img"]').click();
        await uploadpromise;

        test.click('#submitbutton'); //image should be removed. submit
        await test.wait('ui');

        test.false(rtdgroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    }

  ]);
