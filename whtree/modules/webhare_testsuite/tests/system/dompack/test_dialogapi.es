import * as test from "@mod-system/js/wh/testframework";

test.registerTests(
  [ "Tests dialog api"
  , async function()
    {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=dialog');
      await test.wait( () => test.hasFocus('#inputfield2'), 'focus should be initially with #inputfield2');

      test.click('[data-dialog-counter="0"] button.opendialognoinputs');
      test.eq(false, test.hasFocus('#inputfield2')); //should remove focus...
      test.false(test.canClick('[data-dialog-counter="0"] button.opendialog'));
      test.true(test.canClick('[data-dialog-counter="1"] button.opendialog'));
      test.click('[data-dialog-counter="1"] button.opendialog');
      test.false(test.canClick('[data-dialog-counter="0"] button.opendialog'));
      test.false(test.canClick('[data-dialog-counter="1"] button.opendialog'));
      test.true(test.canClick('[data-dialog-counter="2"] button.opendialog'));

      await test.wait( () => test.hasFocus('#textedit2'), 'focus should be on the inner textedit');
      await test.pressKey('Tab');
      test.true(test.hasFocus('#button_return1_2'));
      await test.pressKey('Tab');
      await test.pressKey('Tab');
      test.true(test.hasFocus('#button_opendialog_2'));
      await test.pressKey('Tab');
      test.true(test.hasFocus('#textedit2'));

      test.eq(0, test.qS("#dialoglog").childNodes.length);

      test.click('[data-dialog-counter="2"] button.return1');
      await test.wait('tick'); //dialog completion is a promise, so give it time to resolve

      test.eq(false, test.hasFocus('#inputfield2')); //should remove focus...

      test.eq('Dialog 2: 1', test.qS("#dialoglog > :last-child").textContent);
      test.eq(0, test.qSA('[data-dialog-counter="2"]').length, "Cannot certify that dialog #2 has left the DOM");

      test.click('[data-dialog-counter="1"] button.returnyeey');
      await test.wait('tick'); //dialog completion is a promise, so give it time to resolve

      await test.wait( () => test.hasFocus('#inputfield2'), 'focus should be restored to #inputfield2');

      test.eq('Dialog 1: "yeey"', test.qS("#dialoglog > :last-child").textContent);
      test.click('[data-dialog-counter="0"] button.opendialog');
      test.click('[data-dialog-counter="3"] button.opendialog');

      //set the focus to the toplevel window
      test.focus('#textedit4');
      test.pressKey('a');
      await test.wait(() => test.qS('#textedit4').value == 'a');

      //and ESCAPE!
      test.eq(2, test.qS("#dialoglog").childNodes.length);
      test.pressKey("Escape");
      await test.wait(() => test.qS("#dialoglog").childNodes.length == 3);

      test.eq('Dialog 4: null', test.qS("#dialoglog > :last-child").textContent);
      test.eq(3, test.qS("#dialoglog").childNodes.length);

      test.pressKey("Escape");
      await test.wait(() => test.qS("#dialoglog").childNodes.length == 4);

      test.eq('Dialog 3: null', test.qS("#dialoglog > :last-child").textContent);

    }
  ]);
