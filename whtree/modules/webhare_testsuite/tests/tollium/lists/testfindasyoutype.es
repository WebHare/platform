import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen("tests/lists.findasyoutypelist")
    , waits:["ui"]
    }

  , { name: "press 1"
    , test: async function()
      {
        await test.pressKey('1');
        test.true(test.getCurrentScreen().getListRow("list","<1>").classList.contains("selected"));
        await test.pressKey(['0','9']);

        test.true(test.getCurrentScreen().getListRow("list","<109>").classList.contains("selected"));
      }
    }
  , { name: "select <8>"
    , test: async function()
      {
        await test.pressKey(['Escape','8']);
      }
    }
  , { name: "test selection <8>"
    , test: async function()
      {
        let listrow = test.getCurrentScreen().getListRow("list","<8>");
        test.true(listrow, 'listrow with <8> not available/visible');
        test.true(listrow.classList.contains("selected"));
        await test.pressKey(['4']);
      }
    , waits: [ 2500 ] // Above find as you type timeout (2000)
    }
  , { name: "select <4>"
    , test: async function()
      {
        await test.pressKey(['4']);
      }
    }
  , { name: "test selection <4>, select <44>"
    , test: async function()
      {
        test.true(test.getCurrentScreen().getListRow("list","<4>").classList.contains("selected"));
        await test.pressKey(['4']);
      }
    }
  , { name: "test selection <44>, select <41> (with backspace + 1)"
    , test: async function()
      {
        test.true(test.getCurrentScreen().getListRow("list","<44>").classList.contains("selected"));
        await test.pressKey(['Backspace','1']);
      }
    }
  , { name: "test selection <41>"
    , test: async function()
      {
        test.true(test.getCurrentScreen().getListRow("list","<41>").classList.contains("selected"));
      }
    }
  ]);
