/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [
    {
      loadpage: test.getTestScreen('tests/basecomponents.windowtest'),
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const activewindow = test.qSA('.t-screen.active');
        test.eq(1, activewindow.length);
        test.eq(2, test.qSA('#mainarea .t-screen').length);

        //Find the close button. There should be only one button in the window, so it should be easy to find..
        const buttons = activewindow[0].querySelectorAll('button');
        test.eq(1, buttons.length);

        //var menu = activewindow[0].getElement('.wh-menubar');
        const N01 = test.getMenu(['N01', 'B02']);
        test.click(N01);
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        //this sequentially opens two windows. let's get the first
        const activewindow = test.qSA('.t-screen.active');
        test.eq(1, activewindow.length);
        test.eq(3, test.qSA('#mainarea .t-screen').length);

        //var menu = activewindow[0].getElement('.wh-menubar');
        const N01 = test.getMenu(['N01']); //shouldn't be here
        test.assert(!N01 !== null);
        const M01 = test.getMenu(['M01']); //shoud be here
        test.assert(M01 !== null);

        //Test for existence of the text in the disappearing panel
        test.assert(activewindow[0].textContent.includes("Test <text> node"));

        //Let's play with the embeddable frames option
        test.click(test.getMenu(['M01', 'A05'])); //embed a window
      },
      waits: ['ui']
    },
    {
      name: "embedded window tests",
      test: function (doc, win) {
        //Let's make sure there is only ONE body in the windowq
        const activewindow = test.qSA('.t-screen.active');
        test.eq(1, activewindow.length);

        //Test for disapperance of the text in the disappearing panel
        test.assert(!activewindow[0].textContent.includes("Test <text> node"));

        const thetext = test.compByName("body").querySelector("t-text");
        test.eq('#2', thetext.textContent);
        const thetextedit = test.compByName("body").querySelector("input[type='text']");
        test.eq('', thetextedit.value);
        test.fill(thetextedit, 'This was number 2');

        test.click(test.getMenu(['M01', 'A02'])); //embed a window
      },
      waits: ['ui']
    },
    {
      name: "test after swap", //this used to cause issues because elementnames were something like embeddingpanelname!componentname, so two screens sharing component names woudl conflict
      test: function (doc, win) {
        const thetext = test.compByName("body").querySelector("t-text");
        test.eq('#1', thetext.textContent);
        const thetextedit = test.compByName("body").querySelector("input[type='text']");
        test.eq('', thetextedit.value);

        //Find the new button. There should be only one button in the window, so it should be easy to find..
        const activewindow = test.qSA('.t-screen.active');
        test.clickToddButton("B01 Add line");
      },
      waits: ['ui']
    },
    async function () {
      const activewindow = test.qSA('.t-screen.active');
      test.eq(1, activewindow.length);

      test.assert(!activewindow[0].textContent.includes("Test <text> node"));
      test.assert(activewindow[0].textContent.includes("A new line"), 'new line should have appeared!');

      test.clickToddButton("B01 Add line");//ensure button is still there by clicking it
      await test.wait('ui');
      //it all worked out. close this window
      test.getCurrentScreen().clickCloser();
      await test.wait('ui');
    },
    {
      test: function (doc, win) {
        const activewindow = test.qSA('.t-screen.active');
        test.eq(1, activewindow.length);
        test.eq(3, test.qSA('#mainarea .t-screen').length); //if this test returns '4', the intermediate window wasn't killed

        const menu = activewindow[0].querySelector('.wh-menubar');
        test.assert(!menu.textContent.includes("M01 Actions"), "M01 shouldn't be here, N01 should. Did the window close? ");
        test.assert(menu.textContent.includes("N01 Actions"));

        //Find the close button. There should be only one button in the window, so it should be easy to find..
        const buttons = activewindow[0].querySelectorAll('button');
        test.eq(1, buttons.length);
        test.click(buttons[0]);
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const activewindow = test.qSA('.t-screen.active');
        test.eq(1, activewindow.length);
        test.eq(2, test.qSA('#mainarea .t-screen').length);

        const buttons = activewindow[0].querySelectorAll('button');
        test.eq(1, buttons.length);
        test.click(buttons[0]);
      },
      waits: ['ui']
    },

    {
      name: 'mbox-cancel',
      test: function (doc, win) {
        test.eq(1, test.qSA('#mainarea .t-screen').length);
        test.click(test.getMenu(['M01', 'A03']));
      },
      waits: ['ui']
    },

    {
      name: 'mbox-cancel-clickok',
      test: function (doc, win) {
        test.eq(3, test.qSA('#mainarea .t-screen').length); //N01 + a box should popup
        test.clickToddButton("OK");
      },
      waits: ['ui']
    },

    {
      name: 'mbox-cancel-clickok',
      test: function (doc, win) {
        test.eq(1, test.qSA('#mainarea .t-screen').length); //Both dialogs should be gone
      }
    },

    {
      name: 'megawindow',
      test: function (doc, win) {
        test.click(test.getMenu(['M01', 'A04'])); //this screen will try to become MUCH bigger than the canvas
      },
      waits: ['ui'] //validateDimensions will ensure the screen size has been limited
    }

  ]);
