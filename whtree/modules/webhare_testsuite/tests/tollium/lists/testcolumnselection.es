import * as test from '@mod-tollium/js/testframework';

test.registerTests(
  [ async function()
    {
      await test.load(test.getTestScreen("tests/lists.columnselection"));
      await test.wait('ui');

      // Click the first cell in the first row (the second cell has an e-mail link)
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      test.true(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0].classList.contains("wh-list__cell--selected"));
      await test.wait('ui');

      // The first row/column should now be selected and feedback should be given
      test.eq("Aap", test.compByName("selectedrows").textContent);
      test.eq("title", test.compByName("selectedcolumns").textContent);

      // There should not be a textedit
      test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

      // Click the second cell in the first row
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[1]);
      test.true(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[1].classList.contains("wh-list__cell--selected"));
      await test.wait('ui');

      test.eq("Aap", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);

      // Click the second cell in the second row
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1]);
      test.true(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1].classList.contains("wh-list__cell--selected"));
      await test.wait('ui');

      test.eq("Bok", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);

      await test.wait(500); // Prevent double click
    }
  ]);
