import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/lists.celleditlist");
      await test.waitForUI();

      // The first row should not be selected
      test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("wh-list__row--selected"));

      // Click the first cell in the first row (the second cell has an e-mail link)
      test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      await test.waitForUI();

      // The first row should now be selected
      test.assert(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("wh-list__row--selected"));
      // There should not be a textedit
      test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

      await test.sleep(500); // Prevent double click
    },

    {
      name: "not editing",
      test: async function () {
        // Click the first cell in the first row again to start editing it
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
        await test.waitForUI();
      }
    },

    {
      name: "editing",
      test: async function () {
        // The first row should still be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("wh-list__row--selected"));
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.assert(textedit);

        // Click the second cell in the first row to stop editing the first cell
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[1]);
        await test.sleep(250); // Wait for list rows to be updated
      }
    },

    {
      name: "submitting by clicking other cell",
      test: async function () {
        // The first row should still be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("wh-list__row--selected"));
        // There should not be a textedit
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
        await test.waitForUI();
      }
    },

    {
      name: "editing 2",
      test: async function () {
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.assert(textedit);

        // Click the first cell in the second row to stop editing
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1]);
        await test.sleep(250); // Wait for list rows to be updated
      }
    },

    {
      name: "submitting by clicking another row",
      test: async function () {
        // The first row should still be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("wh-list__row--selected"));
        // There should not be a textedit
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
        await test.waitForUI();
      }
    },

    {
      name: "editing 3",
      test: async function () {
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.assert(textedit);
        // Change the value
        textedit.value = "monkey";

        // Press Escape to stop editing
        await test.pressKey("Escape");
        await test.waitForUI({ optional: true });
        await test.sleep(500); // Prevent double click
      }
    },

    {
      name: "cancelling by pressing escape",
      test: async function () {
        // There should not be a textedit
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
        await test.waitForUI();
      }
    },

    {
      name: "editing 4",
      test: async function () {
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.assert(textedit);
        // Check the current value
        test.eq("Aap", textedit.value);
        // Change the value
        textedit.value = "monkey";

        // Click the first cell in the second row to stop editing
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1]);
        await test.sleep(250); // Wait for list rows to be updated
      }
    },

    {
      name: "value changed to 'Monkey' by clicking another row",
      test: async function () {
        // There should no longer be a row with 'Aap'
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap"));
        // There should not be a row with 'monkey'
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "monkey"));
        // The 'monkey' should be capitalized to 'Monkey'
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Monkey"));
        // There should not be a textedit
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Monkey").querySelector(".textedit"));
        // The first row should still be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Monkey").classList.contains("wh-list__row--selected"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Monkey").childNodes[0]);
        await test.waitForUI();
      }
    },

    {
      name: "editing 5",
      test: async function () {
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Monkey").querySelector(".textedit");
        test.assert(textedit);

        // Change the value again. pressKey is better to find issues with parent keyboard handlers
        textedit.focus();
        textedit.select();
        await test.pressKey(["a", "p", "e"]);

        // Press Enter to submit
        await test.pressKey("Enter");
        await test.waitForUI();
      }
    },

    {
      name: "value changed to 'Ape' by pressing enter",
      test: function () {
        // There should no longer be a row with 'Aap' or 'Monkey'
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Aap"));
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "Monkey"));
        // There should not be a row with 'ape'
        test.assert(!test.getCurrentScreen().getListRow("leesplankje", "ape"));
        // The 'monkey' should be capitalized to 'Ape'
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Ape"));
        // The first row should still be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Ape").classList.contains("wh-list__row--selected"));
      }
    },

    {
      name: "changing value of another row",
      test: async function () {
        // Click the second cell in the 4th row to select it, don't click in the middle to prevent the mail client from opening
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Duif").childNodes[1], { x: "90%" });
        await test.waitForUI();
      }
    },

    {
      name: "changing value of another row - start edit",
      test: async function () {
        // Click the first cell in the 4th row to edit it
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Duif").childNodes[0]);
        await test.waitForUI();
      }
    },

    {
      name: "editing 6",
      test: async function () {
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Duif").querySelector(".textedit");
        test.assert(textedit);
        // Change the value again
        textedit.value = "dove";

        // Press Enter to submit
        await test.pressKey("Enter");
        await test.sleep(250); // Wait for list rows to be updated
      }
    },

    {
      name: "value changed to 'Ape' by pressing enter",
      test: function () {
        // The 'monkey' should be capitalized to 'Ape'
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Ape"));
        // The 'duif' should be changed to 'Dove'
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Dove"));
        // The 4th row should be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Dove").classList.contains("wh-list__row--selected"));
      }
    },

    {
      name: "changing value of cell with checkbox - start edit",
      test: async function () {
        // Click the second cell in the 4th row to select it, don't click in the middle to prevent the mail client from opening
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Dove").childNodes[1], { x: "90%" });
        await test.waitForUI();
      }
    },

    {
      name: "editing 7",
      test: async function () {
        // There should be a textedit now
        const textedit = test.getCurrentScreen().getListRow("leesplankje", "Dove").querySelector(".textedit");
        test.assert(textedit);
        // Change the value again
        textedit.value = "dove@example.org";

        // Press Enter to submit
        await test.pressKey("Enter");
        await test.sleep(250); // Wait for list rows to be updated
      }
    },

    {
      name: "value changed to 'dove@example.org' by pressing enter",
      test: function () {
        // The 'duif@example.org' should be changed to 'dove@example.org'
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "dove@example.org"));
        // The 4th row should still be selected
        test.assert(test.getCurrentScreen().getListRow("leesplankje", "Dove").classList.contains("wh-list__row--selected"));
      }
    },

    "Test array editor",
    async function () {
      // Edit first cell in array edit
      test.click(test.getCurrentScreen().getListRow("arrayedit!list", "Aap").childNodes[0]);
      await test.sleep(250); //prevent doubleclick detection
      test.click(test.getCurrentScreen().getListRow("arrayedit!list", "Aap").childNodes[0]);

      const textedit = test.getCurrentScreen().getListRow("arrayedit!list", "Aap").querySelector(".textedit");
      test.assert(textedit);
      textedit.value = "aapje";
      await test.pressKey("Enter");
      await test.waitForUI();

      test.assert(test.getCurrentScreen().getListRow("arrayedit!list", "aapje"));

    }
  ]);
