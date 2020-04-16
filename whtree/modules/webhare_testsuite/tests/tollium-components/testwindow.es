import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.windowtest')
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        var activewindow = test.qSA('.t-screen.active');
        test.eq(1,activewindow.length);
        test.eq(2, test.qSA('#mainarea .t-screen').length);

        //Find the close button. There should be only one button in the window, so it should be easy to find..
        var buttons = activewindow[0].querySelectorAll('t-button');
        test.eq(1, buttons.length);

        //var menu = activewindow[0].getElement('.wh-menubar');
        var N01 = test.getMenu(['N01','B02']);
        test.click(N01);
      }
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        //this sequentially opens two windows. let's get the first
        var activewindow = test.qSA('.t-screen.active');
        test.eq(1,activewindow.length);
        test.eq(3, test.qSA('#mainarea .t-screen').length);

        //var menu = activewindow[0].getElement('.wh-menubar');
        var N01 = test.getMenu(['N01']); //shouldn't be here
        test.false(N01!=null);
        var M01 = test.getMenu(['M01']); //shoud be here
        test.true(M01!=null);

        //Test for existence of the text in the disappearing panel
        test.true(activewindow[0].textContent.includes("Test <text> node"));

        //Let's play with the embeddable frames option
        test.click(test.getMenu(['M01','A05'])); //embed a window
      }
    , waits: [ 'ui' ]
    }
  , { name: "embedded window tests"
    , test:function(doc,win)
      {
        //Let's make sure there is only ONE body in the windowq
        var activewindow = test.qSA('.t-screen.active');
        test.eq(1,activewindow.length);

        //Test for disapperance of the text in the disappearing panel
        test.false(activewindow[0].textContent.includes("Test <text> node"));

        var thetext = test.compByName("body").querySelector("t-text");
        test.eq('#2', thetext.textContent);
        var thetextedit = test.compByName("body").querySelector("input[type='text']");
        test.eq('', thetextedit.value);
        test.fill(thetextedit,'This was number 2');

        test.click(test.getMenu(['M01','A02'])); //embed a window
      }
    , waits: [ 'ui' ]
    }
  , { name: "test after swap" //this used to cause issues because elementnames were something like embeddingpanelname!componentname, so two screens sharing component names woudl conflict
    , test:function(doc,win)
      {
        var thetext = test.compByName("body").querySelector("t-text");
        test.eq('#1', thetext.textContent);
        var thetextedit = test.compByName("body").querySelector("input[type='text']");
        test.eq('', thetextedit.value);

        //Find the new button. There should be only one button in the window, so it should be easy to find..
        var activewindow = test.qSA('.t-screen.active');
        test.clickToddButton("B01 Add line");
      }
    , waits: [ 'ui' ]
    }
  , async function()
    {
      var activewindow = test.qSA('.t-screen.active');
      test.eq(1,activewindow.length);

      test.false(activewindow[0].textContent.includes("Test <text> node"));
      test.true(activewindow[0].textContent.includes("A new line"), 'new line should have appeared!');

      test.clickToddButton("B01 Add line");//ensure button is still there by clicking it
      await test.wait('ui');
      //it all worked out. close this window
      test.getCurrentScreen().clickCloser();
      await test.wait('ui');
    }
  , { test:function(doc,win)
      {
        var activewindow = test.qSA('.t-screen.active');
        test.eq(1,activewindow.length);
        test.eq(3, test.qSA('#mainarea .t-screen').length); //if this test returns '4', the intermediate window wasn't killed

        var menu = activewindow[0].querySelector('.wh-menubar');
        test.false(menu.textContent.includes("M01 Actions"), "M01 shouldn't be here, N01 should. Did the window close? ");
        test.true(menu.textContent.includes("N01 Actions"));

        //Find the close button. There should be only one button in the window, so it should be easy to find..
        var buttons = activewindow[0].querySelectorAll('t-button');
        test.eq(1, buttons.length);
        test.click(buttons[0]);
      }
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        var activewindow = test.qSA('.t-screen.active');
        test.eq(1,activewindow.length);
        test.eq(2, test.qSA('#mainarea .t-screen').length);

        var buttons = activewindow[0].querySelectorAll('t-button');
        test.eq(1, buttons.length);
        test.click(buttons[0]);
      }
    , waits: [ 'ui' ]
    }

  , { name:'mbox-cancel'
    , test:function(doc,win)
      {
        test.eq(1, test.qSA('#mainarea .t-screen').length);
        test.click(test.getMenu(['M01','A03']));
      }
    , waits: [ 'ui' ]
    }

  , { name:'mbox-cancel-clickok'
    , test:function(doc,win)
      {
        test.eq(3, test.qSA('#mainarea .t-screen').length); //N01 + a box should popup
        test.clickToddButton("OK");
      }
    , waits: [ 'ui' ]
    }

  , { name:'mbox-cancel-clickok'
    , test:function(doc,win)
      {
        test.eq(1, test.qSA('#mainarea .t-screen').length); //Both dialogs should be gone
      }
    }

  , { name:'megawindow'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['M01','A04'])); //this screen will try to become MUCH bigger than the canvas
      }
    , waits: [ 'ui' ] //validateDimensions will ensure the screen size has been limited
    }

  ]);
