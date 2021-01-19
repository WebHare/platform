import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

function getUploadField() //get the replament field, not the original input
{
  return dompack.closest(test.qS('#rtdtest-file'), '.wh-form__fieldline').querySelector('.wh-form__uploadfield');
}

test.registerTests(
  [ async function()
    {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
    }
  , 'Reset file'
  , async function()
    {
      test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/testfile.txt'
                          , filename: 'mytestfile.txt'
                          }]);
      test.false(test.qS('[data-wh-form-group-for=file]').classList.contains("wh-form--uploading"));
      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');

      //note that uploading mytestfile.txt is delayed by 1 sec by the server so we have a chance to see 'uploading'
      await test.wait( () => test.qS('[data-wh-form-group-for=file]').classList.contains("wh-form--uploading"));
      await test.wait('ui');
    }
  , { test: async function()
      {
        test.false(test.qS('[data-wh-form-group-for=file]').classList.contains("wh-form--uploading"));
        let filenameinput = getUploadField().querySelector('.wh-form__uploadfieldfilename');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.true(test.canClick('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete'), 'no delete button');
        test.true(getUploadField().classList.contains('wh-form__uploadfield--hasfile'), "wh-form__uploadfield--hasfile must be present");
        test.click('#submitbutton');
      }
    , waits:['ui']
    }
   , { test: function()
       {
         let serverreponse = JSON.parse(test.qS('#rtdformresponse').textContent);
         test.eq('.txt', serverreponse.file.extension);
         test.eq('text/plain', serverreponse.file.mimetype);
       }
     }
   , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte'
     }
   , { name: 'Verify reloaded file'
    , test: async function()
      {
        let filenameinput = getUploadField().querySelector('.wh-form__uploadfieldfilename');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.true(getUploadField().classList.contains('wh-form__uploadfield--hasfile'));
        //save loaded image again
        test.click('#submitbutton');
      }
    , waits:['ui']
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte'
    }
  , { name: 'Verify re-reloaded file'
    , test: async function()
      {
        let filenameinput = getUploadField().querySelector('.wh-form__uploadfieldfilename');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.getWin().scrollTo(0,filenameinput.getBoundingClientRect().top);
        test.true(test.canClick('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete'), 'no delete button');
        test.qS('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete').click();

        test.eq('', filenameinput.value, 'should be no more file present');
        test.false(test.canClick('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete'), 'delete button still present');
        test.false(test.qS('#rtdtest-file').classList.contains('wh-form__uploadfield--hasfile'));
        test.false(getUploadField().classList.contains('wh-form__uploadfield--hasfile'), "wh-form__uploadfield--hasfile must be removed");
      }
    }

  , "test limited allowed types"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&accept=image/gif,image/jpeg');
      test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/testfile.txt'
                          , filename: 'mytestfile.txt'
                          }]);
      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');

      let filegroup = test.qS('#rtdtest-file').closest('.wh-form__fieldgroup');
      test.true(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');
      test.eq("Dit bestandstype is niet toegestaan", filegroup.querySelector(".wh-form__error").textContent);

      //uploading proper file should fix it
      test.prepareUpload( [{ url: '/tests/flipped_and_180.jpg'
                          , filename: 'flipped_and_180.jpg'
                          }]);

      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');

      test.false(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be ok!');
    }

  , "test limited allowed types with custom error"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&accept=image/gif,image/jpeg&accepterror=snap+ik+niet');
      test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/testfile.txt'
                          , filename: 'mytestfile.txt'
                          }]);
      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');

      let filegroup = test.qS('#rtdtest-file').closest('.wh-form__fieldgroup');
      test.true(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');
      test.eq("snap ik niet", filegroup.querySelector(".wh-form__error").textContent);
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&filerequired=1'
    }
  , { name: 'Test validation button'
    , test: async function()
      {
        test.click('.validatebutton');
        await test.wait('ui');

        let filegroup = dompack.closest(test.qS('#rtdtest-file'), '.wh-form__fieldgroup');
        test.true(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload an image
        test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/testfile.txt'
                             , filename: 'mytestfile.txt'
                             }]);

        test.qS('#rtdtest-file').click();
        await test.wait('ui');

        test.false(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    }
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&filerequired=1'
    }
  , { name: 'Test error handling'
    , test: async function()
      {
        test.click('#submitbutton');
        await test.wait('ui');

        let filegroup = dompack.closest(test.qS('#rtdtest-file'), '.wh-form__fieldgroup');
        test.true(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload an image
        test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/testfile.txt'
                             , filename: 'mytestfile.txt'
                             }]);

        test.qS('#rtdtest-file').click();
        await test.wait('ui');

        test.false(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    }

  , { name: 'Test disable (for all fields, not just upload)'
    , test: async function()
      {
        test.false(test.qS('[data-wh-form-group-for=file] button').disabled,                         "custom file upload field button expected to not have the disabled attribute");
        test.false(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'), "imgedit component expected to not have the data-wh-form-disabled attribute");
        test.false(test.qS('[data-wh-form-group-for=rtd] .wh-form__rtd[data-wh-form-disabled]'),     "RTD component expected to not have the data-wh-form-disabled attribute");

        let filegroup = dompack.closest(test.qS('#rtdtest-file'), '.wh-form__fieldgroup');
        test.click(test.qS('#rtdtest-enablefields'));
        test.true(test.qS('[data-wh-form-group-for=file] button').disabled,                          "custom file upload field button missing disabled attribute");
        test.true(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'),  "imgedit component missing data-wh-form-disabled attribute");
        test.true(test.qS('[data-wh-form-group-for=rtd] .wh-form__rtd[data-wh-form-disabled]'),      "RTD component missing data-wh-form-disabled attribute");
        test.false(test.qS('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");

        test.true(filegroup.querySelector('.wh-form__uploadfieldfilename').disabled);

        test.click(test.qS('#rtdtest-enablefields'));
        test.false(test.qS('[data-wh-form-group-for=file] button').disabled,                          "disabled attribute should have been reenabled for file (browse) button");
        test.false(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'),  "data-wh-form-disabled attribute should have been reenabled for the imageedit component");
        test.false(test.qS('[data-wh-form-group-for=rtd] .wh-form__rtd[data-wh-form-disabled]'),      "data-wh-form-disabled attribute should have been reenabled for the RTD component");
        test.true(test.qS('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");

        test.true(filegroup.querySelector('.wh-form__uploadfieldfilename').disabled, "The name field should remain disabled");
      }
    }

  , "Test uploading file through initially invisible field"
  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1'
    }
  , async function()
    {
      test.click(test.qS('#rtdtest-showfile2'));
      test.prepareUpload( [{ url: '/tollium_todd.res/webhare_testsuite/tollium/testfile.txt'
                           , filename: 'mytestfile2.txt'
                           }]);
      test.click(test.qS('[data-wh-form-group-for="file2"] button'));
      await test.wait('ui');

      test.click('#submitbutton');
      await test.wait('ui');

      let serverreponse = JSON.parse(test.qS('#rtdformresponse').textContent);
      test.eq('text/plain', serverreponse.file2.mimetype);
      test.eq('mytestfile2.txt', serverreponse.file2.filename);
    }

  , { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&disabled=1' }

  , 'Initially disabled upload'
  , async function()
    {
      test.true(test.qS('[data-wh-form-group-for=file] button').disabled);
    }
  ]);
