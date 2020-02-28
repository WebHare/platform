import * as test from "@mod-system/js/wh/testframework";

function getPressedKeys() { return JSON.parse(test.qS('#keyspressed').value || "[]"); }

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/keyboard/'
    }
  , 'simple press'
  , async function()
    {
      test.qS('#testfield').focus();
      await test.pressKey('b', { shiftKey: true });
      test.eq(['B'], getPressedKeys());
      await test.pressKey('C', { shiftKey: false });
      test.eq(['B','c'], getPressedKeys());
    }

  , 'keyboard bunny'
  , async function()
    {
      test.qS('#keyboardbunny').focus();
      await test.pressKey('A', { ctrlKey: true });
      test.eq('^a', test.qS('#lastkey').value);
      test.qS('#lastkey').value='';

      await test.pressKey('A', { ctrlKey: true, shiftKey: true });
      test.eq('', test.qS('#lastkey').value, "ctrl+shift+a should have been ignored");
      await test.pressKey('b', { ctrlKey: true });
      test.eq('', test.qS('#lastkey').value, "ctrl+b should have been ignored");

      await test.pressKey('b', { ctrlKey: true, shiftKey:true });
      test.eq('^B', test.qS('#lastkey').value);

      test.eq('', test.qS('#keyboardbunny').value);
    }
]);
