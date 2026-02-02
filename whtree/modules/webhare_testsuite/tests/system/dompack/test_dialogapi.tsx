import * as test from "@mod-system/js/wh/testframework";
import { importExposed } from "@webhare/test-frontend";
import type { DompackApi } from "@mod-webhare_testsuite/web/tests/pages/dompack/dompackexample";
import * as dompack from "@webhare/dompack";

test.runTests(
  [
    "Tests dialog api",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=dialog');
      await test.wait(() => test.hasFocus('#inputfield2'), 'focus should be initially with #inputfield2');

      test.click('[data-dialog-counter="0"] button.opendialognoinputs');
      test.eq(false, test.hasFocus('#inputfield2')); //should remove focus...
      test.assert(!test.canClick('[data-dialog-counter="0"] button.opendialog'));
      test.assert(test.canClick('[data-dialog-counter="1"] button.opendialog'));
      test.click('[data-dialog-counter="1"] button.opendialog');
      test.assert(!test.canClick('[data-dialog-counter="0"] button.opendialog'));
      test.assert(!test.canClick('[data-dialog-counter="1"] button.opendialog'));
      test.assert(test.canClick('[data-dialog-counter="2"] button.opendialog'));

      await test.wait(() => test.hasFocus('#textedit2'), 'focus should be on the inner textedit');
      await test.pressKey('Tab');
      test.assert(test.hasFocus('#button_return1_2'));
      await test.pressKey('Tab');
      await test.pressKey('Tab');
      test.assert(test.hasFocus('#button_opendialog_2'));
      await test.pressKey('Tab');
      test.assert(test.hasFocus('#textedit2'));

      test.eq(0, test.qR("#dialoglog").childNodes.length);

      test.click('[data-dialog-counter="2"] button.return1');
      await test.wait('tick'); //dialog completion is a promise, so give it time to resolve

      test.eq(false, test.hasFocus('#inputfield2')); //should remove focus...

      test.eq('Dialog 2: 1', test.qR("#dialoglog > :last-child").textContent);
      test.eq(0, test.qSA('[data-dialog-counter="2"]').length, "Cannot certify that dialog #2 has left the DOM");

      test.click('[data-dialog-counter="1"] button.returnyeey');
      await test.wait('tick'); //dialog completion is a promise, so give it time to resolve

      await test.wait(() => test.hasFocus('#inputfield2'), 'focus should be restored to #inputfield2');

      test.eq('Dialog 1: "yeey"', test.qR("#dialoglog > :last-child").textContent);
      test.click('[data-dialog-counter="0"] button.opendialog');
      test.click('[data-dialog-counter="3"] button.opendialog');

      //set the focus to the toplevel window
      test.focus('#textedit4');
      await test.pressKey('a');
      await test.wait(() => test.qR('#textedit4').value === 'a');

      //and ESCAPE!
      test.eq(2, test.qR("#dialoglog").childNodes.length);
      await test.pressKey("Escape");
      await test.wait(() => test.qR("#dialoglog").childNodes.length === 3);

      test.eq('Dialog 4: null', test.qR("#dialoglog > :last-child").textContent);
      test.eq(3, test.qR("#dialoglog").childNodes.length);

      await test.pressKey("Escape");
      await test.wait(() => test.qR("#dialoglog").childNodes.length === 4);

      test.eq('Dialog 3: null', test.qR("#dialoglog > :last-child").textContent);
    },

    "test busymodal",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=dialog');

      const api = importExposed<DompackApi>("dompackApi");
      api.setupBusyModal("Please wait...");

      {
        const lock = api.flagUIBusy({ modal: true });
        const dialog = await test.waitForElement(['dialog', /Please wait.../]);
        lock.release();
        await test.wait(() => dialog.parentNode === null);
      }

      //Give the API a DOM. verify it only appears once even after reuse
      api.setupBusyModal(<u><b class="waiternode">Please wait!</b></u>);
      for (let repeat = 0; repeat < 2; ++repeat) {
        const lock = api.flagUIBusy({ modal: true });
        const dialog = await test.waitForElement(['dialog', /Please wait!/]);
        test.eq(1, test.qSA("dialog.dompack-busydialog").length);
        lock[Symbol.dispose](); //should be identical to release()
        await test.waitForUI(); //ensure ui-wait works - we did just flag busy...
        await test.wait(() => dialog.parentNode === null);
      }
      test.eq(null, test.findElement(['dialog', /Please wait!/]));

      //Give the API *our* dialog element
      api.setupBusyModal(test.qR("#mywaiter") as HTMLDialogElement);
      test.eq(false, test.canClick("#mywaiter"));
      for (let repeat = 0; repeat < 2; ++repeat) {
        { /* extra block to verify 'using'
            unfortunately there's no way to use using without a variable. see also
            https://github.com/tc39/proposal-explicit-resource-management/blob/main/future/using-void-declaration.md
          */
          using lock = api.flagUIBusy({ modal: true }); void lock;
          await test.waitForElement("#mywaiter");
          test.eq(true, test.canClick("#mywaiter"));
        }
        await test.wait(() => !test.canClick("#mywaiter"));
      }

      test.eq(false, test.canClick("#mywaiter"));
      test.eq(true, test.qR("#mywaiter").parentNode === test.qR("body"));
    }
  ]);
