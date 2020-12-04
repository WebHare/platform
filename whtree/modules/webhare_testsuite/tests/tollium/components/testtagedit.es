import * as test from '@mod-tollium/js/testframework';

test.registerTests(
  [ 'create first tag'
  , async function()
    {
      await test.load(test.getCompTestPage('tagedit'));
      await test.wait('ui');

      let holder = test.compByName("componentpanel");
      let tagedit = holder.querySelector("input");
      test.true(tagedit);

      let tags = holder.querySelectorAll('.wh-tagedit-tag');

      test.eq(0, tags.length);
      tagedit.focus();

      await test.pressKey(['a','b','c']);
      await test.pressKey('Enter');
      await test.wait('ui');

      tags = holder.querySelectorAll('.wh-tagedit-tag');
      test.eq(1, tags.length);
      test.eq('abc', tags[0].textContent);

      await test.pressKey('d');
      await test.pressKey('e');
      await test.pressKey('f');
      await test.pressKey('Enter');
      await test.wait('ui');
    }

  , "Test keyboard nav"
  , async function()
    {
      let holder = test.compByName("componentpanel");
      let tags = holder.querySelectorAll('.wh-tagedit-tag');
      test.eq(2, tags.length);
      test.eq(0, holder.querySelectorAll('.wh-tagedit-tag.wh-tagedit-selected').length);
      test.eq('abc', tags[0].textContent);
      test.eq('def', tags[1].textContent);

      //test keyboard navigation
      await test.pressKey('ArrowLeft');
      test.eq('def', holder.querySelector('.wh-tagedit-tag.wh-tagedit-selected').textContent);
      await test.pressKey('ArrowUp');
      test.eq('abc', holder.querySelector('.wh-tagedit-tag.wh-tagedit-selected').textContent);
      await test.pressKey('ArrowRight');
      test.eq('def', holder.querySelector('.wh-tagedit-tag.wh-tagedit-selected').textContent);
      await test.pressKey('ArrowDown');
      test.eq(null, holder.querySelector('.wh-tagedit-tag.wh-tagedit-selected'));

      test.click(holder.querySelectorAll('.wh-tagedit-tag')[0]);
      test.eq('abc', holder.querySelector('.wh-tagedit-tag.wh-tagedit-selected').textContent);
      await test.pressKey('Tab');
      test.true(test.hasFocus(holder.querySelector(".wh-tagedit-input")));

      await test.pressKey('Backspace');
      tags = holder.querySelectorAll('.wh-tagedit-tag');
      test.eq(2, tags.length);
      test.false(tags[0].classList.contains('wh-tagedit-selected'));
      test.true(tags[1].classList.contains('wh-tagedit-selected'));

      await test.pressKey('Backspace');
      tags = holder.querySelectorAll('.wh-tagedit-tag');
      test.eq(1, tags.length);
      test.eq('abc', tags[0].textContent);
      test.eq(0, holder.querySelectorAll('.wh-tagedit-tag.wh-tagedit-selected').length);
    }

  , "Test disabling"
  , async function()
    {
      let holder = test.compByName("componentpanel");
      test.true(test.canClick(holder.querySelector(".wh-tagedit-input")), "entry field should be there");
      await test.pressKey("X");
      test.eq('x', holder.querySelector(".wh-tagedit-input").value, "the 'x' should have landed");

      test.click(test.compByName('enable'));
      await test.wait('ui');

      holder = test.compByName("componentpanel");
      test.true(holder.querySelector(".wh-tagedit").classList.contains("disabled"));
      test.false(test.canClick(holder.querySelector(".wh-tagedit-input")), "entry field should be gone");
    }
  ]);
