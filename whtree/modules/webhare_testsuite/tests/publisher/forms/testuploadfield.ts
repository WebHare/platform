import { prepareUpload } from '@webhare/test-frontend';
import * as test from '@mod-system/js/wh/testframework';
import { getFormData, type FormFileValue } from '@webhare/forms';

function getUploadField() { //get the replament field, not the original input
  return test.qR('#rtdtest-file').shadowRoot!;
}
function getUploadField2() { //get the replament field, not the original input
  return test.qR('#rtdtest-file2').shadowRoot!;
}

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
    'Set file',
    async function () {
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click(test.qR(getUploadField(), '.wh-form__uploadfieldselect'));
      await test.waitForUI();
    },
    {
      test: async function () {
        const filenameinput = test.qR(getUploadField(), '.file__name');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        test.assert(test.canClick(test.qR(getUploadField(), '.file__deletebutton')), 'no delete button');

        //form field API
        const formdata = getFormData<RTDForm>(test.qR('#rtdform'));
        test.eq('mytestfile.txt', formdata.file[0].fileName);
        test.eq('This is a test.\n', await formdata.file[0].file?.text());

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
    {
      name: 'Verify reloaded file',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
        const filenameinput = test.qR(getUploadField(), '.file__name');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');
        //save loaded image again
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    {
      name: 'Verify re-reloaded file',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte');
        const filenameinput = test.qR(getUploadField(), '.file__name');
        test.eq('mytestfile.txt', filenameinput.value, 'should be a file present');

        await test.waitToggled({
          test: () => !test.qS(getUploadField(), '.file:not(.file--placeholder) .file__name'),
          run: () => test.click(test.qR(getUploadField(), '.file__deletebutton'))
        }, 'should be no more file present after delete');
        test.assert(!test.qS(getUploadField(), '.file__deletebutton'), 'delete button still present');
      }
    },

    "test limited allowed types",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&accept=image/gif,image/jpeg');
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click(test.qR(getUploadField(), '.wh-form__uploadfieldselect'));
      await test.waitForUI();

      const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
      test.assert(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');
      test.eq("Dit bestandstype is niet toegestaan", test.qR(filegroup, ".wh-form__error").textContent);

      //uploading proper file should fix it
      prepareUpload(['/tests/flipped_and_180.jpg']);

      test.click(test.qR(getUploadField(), '.wh-form__uploadfieldselect'));
      await test.waitForUI();

      test.assert(!filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be ok!');
    },

    "test limited allowed types with custom error",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&accept=image/gif,image/jpeg&accepterror=snap+ik+niet');
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click(test.qR(getUploadField(), '.wh-form__uploadfieldselect'));
      await test.waitForUI();

      const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup');
      test.assert(filegroup?.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');
      test.eq("snap ik niet", test.qR(filegroup!, ".wh-form__error").textContent);
    },

    {
      name: 'Test validation button',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&filerequired=1');
        test.click('.validatebutton');
        await test.waitForUI();

        const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
        test.assert(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
        test.click(test.qR(getUploadField(), '.wh-form__uploadfieldselect'));
        await test.waitForUI();

        test.assert(!filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    },
    {
      name: 'Test error handling',
      test: async function () {
        await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&filerequired=1');
        test.click('#submitbutton');
        await test.waitForUI();

        const filegroup = test.qR('#rtdtest-file').closest('.wh-form__fieldgroup')!;
        test.assert(filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be in error');

        //upload an image
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
        test.click(test.qR(getUploadField(), '.wh-form__uploadfieldselect'));
        await test.waitForUI();

        test.assert(!filegroup.classList.contains('wh-form__fieldgroup--error'), 'field should be out of error');
      }
    },

    //Removed 'Test disable (for all fields, not just upload)' -- too much white box and not adding much now that required/disabled are not mapped to separate data-wh-form- attributes

    "Test uploading file through initially invisible field",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1');

      test.click('#rtdtest-showfile2');
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/mytestfile.txt']);
      test.click(test.qR(getUploadField2(), '.wh-form__uploadfieldselect'));
      await test.waitForUI();

      test.click('#submitbutton');
      await test.waitForUI();

      const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent!);
      test.eq('text/plain', serverreponse.file2.mimetype);
      test.eq('mytestfile.txt', serverreponse.file2.filename);
    },

    'Test multi file',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&mode=writeonly'); //drop stored data
      const filesCompRoot = test.qR('#rtdtest-files').shadowRoot!;
      prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
      test.qR(filesCompRoot, '.file--placeholder').click();
      await test.waitForUI();

      prepareUpload(["/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg"]);
      test.qR(filesCompRoot, '.file--placeholder').click();
      await test.waitForUI();

      const formdata = getFormData<RTDForm>(test.qR('#rtdform'));
      test.eqPartial({
        files: [{ fileName: "portrait_8.jpg" }, { fileName: "landscape_4.jpg" },]
      }, formdata);

      test.click('#submitbutton');
      await test.waitForUI();

      {
        const serverreponse = JSON.parse(test.qR('#rtdformresponse').textContent || '');
        test.eqPartial({
          files: [{ filename: "portrait_8.jpg" }, { filename: "landscape_4.jpg" },]
        }, serverreponse);
      }
    },


    'Initially disabled upload',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?rtd=1&store=testrte&disabled=1');
      test.assert(test.qR('[data-wh-form-group-for=file] wh-fileedit').disabled);
    }
  ]);
