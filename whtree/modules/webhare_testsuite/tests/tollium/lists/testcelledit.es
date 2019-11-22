import * as test from '@mod-tollium/js/testframework';

test.registerTests(
  [ { loadpage: test.getTestScreen("tests/lists.celleditlist")
    , waits:["ui"]
    }

  , { name: "not selected"
    , test: function(doc, win)
      {
        // The first row should not be selected
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("selected"));

        // Click the first cell in the first row (the second cell has an e-mail link)
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "selected, not editing"
    , test: function(doc, win)
      {
        // The first row should now be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("selected"));
        // There should not be a textedit
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));
      }
    , waits: [ 500 ] // Prevent double click
    }

  , { name: "not editing"
    , test: function(doc, win)
      {
        // Click the first cell in the first row again to start editing it
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "editing"
    , test: function(doc, win)
      {
        // The first row should still be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("selected"));
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.true(textedit);

        // Click the second cell in the first row to stop editing the first cell
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[1]);
      }
    , waits: [ 250 ] // Wait for list rows to be updated
    }

  , { name: "submitting by clicking other cell"
    , test: function(doc, win)
      {
        // The first row should still be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("selected"));
        // There should not be a textedit
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "editing 2"
    , test: function(doc, win)
      {
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.true(textedit);

        // Click the first cell in the second row to stop editing
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1]);
      }
    , waits: [ 250 ] // Wait for list rows to be updated
    }

  , { name: "submitting by clicking another row"
    , test: function(doc, win)
      {
        // The first row should still be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Aap").classList.contains("selected"));
        // There should not be a textedit
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "editing 3"
    , test: async function()
      {
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.true(textedit);
        // Change the value
        textedit.value = "monkey";

        // Press Escape to stop editing
        await test.pressKey("Escape");
      }
    , waits: [ "ui-nocheck", 500 ] // Prevent double click
    }

  , { name: "cancelling by pressing escape"
    , test: function(doc, win)
      {
        // There should not be a textedit
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Aap").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "editing 4"
    , test: function(doc, win)
      {
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
        test.true(textedit);
        // Check the current value
        test.eq("Aap", textedit.value);
        // Change the value
        textedit.value = "monkey";

        // Click the first cell in the second row to stop editing
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Bok").childNodes[1]);
      }
    , waits: [ 250 ] // Wait for list rows to be updated
    }

  , { name: "value changed to 'Monkey' by clicking another row"
    , test: function(doc, win)
      {
        // There should no longer be a row with 'Aap'
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap"));
        // There should not be a row with 'monkey'
        test.false(test.getCurrentScreen().getListRow("leesplankje", "monkey"));
        // The 'monkey' should be capitalized to 'Monkey'
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Monkey"));
        // There should not be a textedit
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Monkey").querySelector(".textedit"));
        // The first row should still be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Monkey").classList.contains("selected"));

        // Click the first cell in the first row again to start editing it again
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Monkey").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "editing 5"
    , test: async function()
      {
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Monkey").querySelector(".textedit");
        test.true(textedit);
        // Change the value again
        textedit.value = "ape";

        // Press Enter to submit
        await test.pressKey("Enter");
        await test.wait('ui');
      }
    }

  , { name: "value changed to 'Ape' by pressing enter"
    , test: function(doc, win)
      {
        // There should no longer be a row with 'Aap' or 'Monkey'
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Aap"));
        test.false(test.getCurrentScreen().getListRow("leesplankje", "Monkey"));
        // There should not be a row with 'ape'
        test.false(test.getCurrentScreen().getListRow("leesplankje", "ape"));
        // The 'monkey' should be capitalized to 'Ape'
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Ape"));
        // The first row should still be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Ape").classList.contains("selected"));
      }
    }

  , { name: "changing value of another row"
    , test: function(doc, win)
      {
        // Click the second cell in the 4th row to select it, don't click in the middle to prevent the mail client from opening
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Duif").childNodes[1], { x: "90%" });
      }
    , waits: [ "ui" ]
    }

  , { name: "changing value of another row - start edit"
    , test: function(doc, win)
      {
        // Click the first cell in the 4th row to edit it
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Duif").childNodes[0]);
      }
    , waits: [ "ui" ]
    }

  , { name: "editing 6"
    , test: async function()
      {
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Duif").querySelector(".textedit");
        test.true(textedit);
        // Change the value again
        textedit.value = "dove";

        // Press Enter to submit
        await test.pressKey("Enter");
      }
    , waits: [ 250 ] // Wait for list rows to be updated
    }

  , { name: "value changed to 'Ape' by pressing enter"
    , test: function(doc, win)
      {
        // The 'monkey' should be capitalized to 'Ape'
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Ape"));
        // The 'duif' should be changed to 'Dove'
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Dove"));
        // The 4th row should be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Dove").classList.contains("selected"));
      }
    }

  , { name: "changing value of cell with checkbox - start edit"
    , test: function(doc, win)
      {
        // Click the second cell in the 4th row to select it, don't click in the middle to prevent the mail client from opening
        test.click(test.getCurrentScreen().getListRow("leesplankje", "Dove").childNodes[1], { x: "90%" });
      }
    , waits: [ "ui" ]
    }

  , { name: "editing 7"
    , test: async function()
      {
        // There should be a textedit now
        let textedit = test.getCurrentScreen().getListRow("leesplankje", "Dove").querySelector(".textedit");
        test.true(textedit);
        // Change the value again
        textedit.value = "dove@example.org";

        // Press Enter to submit
        await test.pressKey("Enter");
      }
    , waits: [ 250 ] // Wait for list rows to be updated
    }

  , { name: "value changed to 'dove@example.org' by pressing enter"
    , test: function(doc, win)
      {
        // The 'duif@example.org' should be changed to 'dove@example.org'
        test.true(test.getCurrentScreen().getListRow("leesplankje", "dove@example.org"));
        // The 4th row should still be selected
        test.true(test.getCurrentScreen().getListRow("leesplankje", "Dove").classList.contains("selected"));
      }
    }

  , "Test array editor"
  , async function()
    {
        // Edit first cell in array edit
        test.click(test.getCurrentScreen().getListRow("arrayedit!list", "Aap").childNodes[0]);
        await test.sleep(250); //prevent doubleclick detection
        test.click(test.getCurrentScreen().getListRow("arrayedit!list", "Aap").childNodes[0]);

        let textedit = test.getCurrentScreen().getListRow("arrayedit!list", "Aap").querySelector(".textedit");
        test.true(textedit);
        textedit.value = "aapje";
        await test.pressKey("Enter");
        await test.wait('ui');

        test.true(test.getCurrentScreen().getListRow("arrayedit!list", "aapje"));

  //       test.click(test.getCurrentScreen().getListRow("arrayedit!list", "Aap"));

  //     }
  //   , waits: [ "ui" ]
  //   }

  // , { name: "editing 3"
  //   , test: async function()
  //     {
  //       // There should be a textedit now
  //       let textedit = test.getCurrentScreen().getListRow("leesplankje", "Aap").querySelector(".textedit");
  //       test.true(textedit);
  //       // Change the value
  //       textedit.value = "monkey";

  //       // Press Escape to stop editing
  //       await test.pressKey("Escape");

    }
  ]);
