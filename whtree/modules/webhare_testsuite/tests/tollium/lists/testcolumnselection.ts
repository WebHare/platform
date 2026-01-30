import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/lists.columnselection");
      await test.waitForUI();

      // Click the first cell in the first row (the second cell has an e-mail link)
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      test.assert(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0].classList.contains("wh-list__cell--selected"));
      await test.waitForUI();

      // The first row/column should now be selected and feedback should be given
      test.eq("Aap", test.compByName("selectedrows").textContent);
      test.eq("title", test.compByName("selectedcolumns").textContent);

      // There should not be a textedit
      test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

      // Click the second cell in the first row
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[1]);
      test.assert(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[1].classList.contains("wh-list__cell--selected"));
      await test.waitForUI();

      test.eq("Aap", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);

      // Click the second cell in the second row
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1]);
      test.assert(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1].classList.contains("wh-list__cell--selected"));
      await test.waitForUI();

      test.eq("Bok", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);

      await test.pressKey(['ArrowDown']);
      await test.waitForUI();

      test.eq("Does", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);

      await test.pressKey(['ArrowLeft']);
      await test.waitForUI();

      test.eq("Does", test.compByName("selectedrows").textContent);
      test.eq("title", test.compByName("selectedcolumns").textContent);

      await test.pressKey(['ArrowRight']);
      await test.waitForUI();

      test.eq("Does", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);
    },

    "test multiselect",
    async function () {
      tt.comp(':List selection mode').set('multiple');
      await test.waitForUI();

      test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Duif").childNodes[0], { cmd: true });
      await test.waitForUI();

      test.eq("Aap; Duif", test.compByName("selectedrows").textContent);
      test.eq("title", test.compByName("selectedcolumns").textContent);

      await test.pressKey(['ArrowRight']);
      await test.waitForUI();

      test.eq("Aap; Duif", test.compByName("selectedrows").textContent);
      test.eq("email", test.compByName("selectedcolumns").textContent);
    }
  ]);
