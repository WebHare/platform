import { prepareUpload } from '@webhare/test-frontend';
import * as test from '@mod-system/js/wh/testframework';

function getUploadField() { //get the replament field, not the original input
  return test.qR(test.qR('#rtdtest-file').closest('.wh-form__fieldline')!, '.wh-form__uploadfield');
}

test.registerTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
    },
    'Reset RTE', //a partially completed testre.ts leaves behind a big image, pushing our test components outside the screen
    async function () {
      const rtebody = await test.waitForElement('[data-wh-form-name="rtd"] .wh-rtd__body');
      rtebody.innerHTML = '<p class="normal">Initial state</p>';
      test.click('#submitbutton');
      await test.wait('ui');
      const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent!);
      test.eq('<html><body><p class="normal">Initial state</p></body></html>', serverreponse.htmltext);
    },
    'Reset file',
    async function () {
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');
    },
    {
      test: async function () {
        const filenameinput = test.qR(getUploadField(), '.wh-form__uploadfieldfilename');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.assert(test.canClick('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete'), 'no delete button');
        test.assert(getUploadField().classList.contains('wh-form__uploadfield--hasfile'), "wh-form__uploadfield--hasfile must be present");
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    {
      test: function () {
        const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent!);
        test.eq('.txt', serverreponse.file.extension);
        test.eq('text/plain', serverreponse.file.mimetype);
      }
    },
    { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte' },
    {
      name: 'Verify reloaded file',
      test: async function () {
        const filenameinput = test.qR(getUploadField(), '.wh-form__uploadfieldfilename');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.assert(getUploadField().classList.contains('wh-form__uploadfield--hasfile'));
        //save loaded image again
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte' },
    {
      name: 'Verify re-reloaded file',
      test: async function () {
        const filenameinput = test.qR(getUploadField(), '.wh-form__uploadfieldfilename');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.getWin().scrollTo(0, filenameinput.getBoundingClientRect().top);
        test.assert(test.canClick('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete'), 'no delete button');
        test.qR('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete').click();

        test.eq('', filenameinput.value, 'should be no more file present');
        test.assert(!test.canClick('[data-wh-form-group-for="file"] .wh-form__uploadfielddelete'), 'delete button still present');
        test.assert(!test.qR('#rtdtest-file').classList.contains('wh-form__uploadfield--hasfile'));
        test.assert(!getUploadField().classList.contains('wh-form__uploadfield--hasfile'), "wh-form__uploadfield--hasfile must be removed");
      }
    },

    "test limited allowed types",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&accept=image/gif,image/jpeg');
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');

      const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
      test.assert(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');
      test.eq("Dit bestandstype is niet toegestaan", test.qR(filegroup, ".wh-form__error").textContent);

      //uploading proper file should fix it
      prepareUpload(['/tests/flipped_and_180.jpg']);

      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');

      test.assert(!filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be ok!');
    },

    "test limited allowed types with custom error",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&accept=image/gif,image/jpeg&accepterror=snap+ik+niet');
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click('[data-wh-form-group-for=file] .wh-form__uploadfieldselect');
      await test.wait('ui');

      const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup');
      test.assert(filegroup?.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');
      test.eq("snap ik niet", test.qR(filegroup!, ".wh-form__error").textContent);
    },

    { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&filerequired=1' },
    {
      name: 'Test validation button',
      test: async function () {
        test.click('.validatebutton');
        await test.wait('ui');

        const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
        test.assert(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);

        test.qR('#rtdtest-file').click();
        await test.wait('ui');

        test.assert(!filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    },
    { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&filerequired=1' },
    {
      name: 'Test error handling',
      test: async function () {
        test.click('#submitbutton');
        await test.wait('ui');

        const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
        test.assert(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload an image
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);

        test.qR('#rtdtest-file').click();
        await test.wait('ui');

        test.assert(!filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    },

    {
      name: 'Test disable (for all fields, not just upload)',
      test: async function () {
        test.assert(!test.qR('[data-wh-form-group-for=file] button').disabled, "custom file upload field button expected to not have the disabled attribute");
        test.assert(!test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'), "imgedit component expected to not have the data-wh-form-disabled attribute");
        test.assert(!test.qS('[data-wh-form-group-for=rtd] .wh-form__rtd[data-wh-form-disabled]'), "RTD component expected to not have the data-wh-form-disabled attribute");

        const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
        test.click('#rtdtest-enablefields');
        test.assert(test.qR('[data-wh-form-group-for=file] button').disabled, "custom file upload field button missing disabled attribute");
        test.assert(test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'), "imgedit component missing data-wh-form-disabled attribute");
        test.assert(test.qS('[data-wh-form-group-for=rtd] .wh-form__rtd[data-wh-form-disabled]'), "RTD component missing data-wh-form-disabled attribute");
        test.assert(!test.qR('#rtdtest-enablefields').checked, "enablefields should have been unchecked now");

        test.assert(test.qR(filegroup, '.wh-form__uploadfieldfilename').disabled);

        test.click('#rtdtest-enablefields');
        test.assert(!test.qR('[data-wh-form-group-for=file] button').disabled, "disabled attribute should have been reenabled for file (browse) button");
        test.assert(!test.qS('[data-wh-form-group-for=img] .wh-form__imgedit[data-wh-form-disabled]'), "data-wh-form-disabled attribute should have been reenabled for the imageedit component");
        test.assert(!test.qS('[data-wh-form-group-for=rtd] .wh-form__rtd[data-wh-form-disabled]'), "data-wh-form-disabled attribute should have been reenabled for the RTD component");
        test.assert(test.qR('#rtdtest-enablefields').checked, "enablefields should have been re-enabled now");

        test.assert(test.qR(filegroup, '.wh-form__uploadfieldfilename').disabled, "The name field should remain disabled");
      }
    },

    "Test uploading file through initially invisible field",
    { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1' },
    async function () {
      test.click('#rtdtest-showfile2');
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click('[data-wh-form-group-for="file2"] button');
      await test.wait('ui');

      test.click('#submitbutton');
      await test.wait('ui');

      const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent!);
      test.eq('text/plain', serverreponse.file2.mimetype);
      test.eq('mytestfile.txt', serverreponse.file2.filename);
    },

    { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&disabled=1' },

    'Initially disabled upload',
    async function () {
      test.assert(test.qR('[data-wh-form-group-for=file] button').disabled);
    }
  ]);
