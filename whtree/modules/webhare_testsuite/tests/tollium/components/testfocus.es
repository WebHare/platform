import * as dompack from "dompack";
import * as test from "@mod-tollium/js/testframework";
import * as domfocus from 'dompack/browserfix/focus';

/* WARNING
   test failures here may just as well mean that the simulation of tabfocus
   in jstests.js, or the detection of focusable components in uibase.js, is broken
*/

function getToddFocusedComponent()
{
  for(var node=domfocus.getCurrentlyFocusedElement();node; node = node.parentNode)
  {
    if(node.nodeType==9)//#document
      continue;
    if(!node.getAttribute)
      return null; //not in a dom?
    var toddname = node.getAttribute('data-name');
    if(toddname && toddname.indexOf('#') == -1)
      return toddname;
  }
  return null;
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.focustest')
    , waits: [ 'ui' ]
    }

  , { name: 'focus1'
    , test: async function()
      {
        test.true(test.getDoc().hasFocus(), "This test requires the browser to have focus");

        //ADDME also test the Tollium hasFocus() calls
        test.eqMatch(/:box!heading!cbox$/, getToddFocusedComponent());

        //test focus moving
        await test.pressKey('Tab');
        test.eqMatch(/:textedit$/, getToddFocusedComponent());
        await test.pressKey('Tab');
        await test.pressKey('Tab');
        test.eqMatch(/:list$/, getToddFocusedComponent());

        //test whether clicks properly transfer focus
        var thewin = test.qSA('.t-screen.active')[0];
        test.click(thewin.querySelector('textarea'));
        test.eqMatch(/:textarea$/, getToddFocusedComponent());

        test.click(thewin.querySelector('.wh-ui-listview .listrow'));
        await test.waitUIFree();
        test.eqMatch(/:list$/, getToddFocusedComponent());

        //test whether setting the focus server-side properly transfers focus
        test.click(thewin.querySelector('textarea'));
        test.eqMatch(/:textarea$/, getToddFocusedComponent());
        test.click(test.getMenu(['M01','A06']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'serverfocus'
    , test:function(doc,win)
      {
        test.eqMatch(/:list$/, getToddFocusedComponent());

        test.click(test.getMenu(['M01','A01']));
      }
    , waits: [ 'ui' ]
    }

  , 'focussub'
  , async function(doc,win)
    {
      test.eq(2, test.qSA('.t-screen').length);
      test.true(test.getCurrentScreen().getNode().contains(doc.activeElement)); //make sure focus is in the expected window
      test.eqMatch(/:box!heading!cbox$/, getToddFocusedComponent());

      await test.pressKey('Tab');
      test.eqMatch(/:textedit$/, getToddFocusedComponent());
      await test.pressKey('Tab', { shiftKey: true });
      test.eqMatch(/:box!heading!cbox$/, getToddFocusedComponent());

      //focus should leave completely..
      await test.pressKey('Tab', { shiftKey: true });
      await test.pressKey('Tab', { shiftKey: true });
      await test.pressKey('Tab', { shiftKey: true });
      test.true(domfocus.getCurrentlyFocusedElement().ownerDocument != doc);
      //and come back!
      await test.pressKey('Tab');
      await test.pressKey('Tab');
      await test.pressKey('Tab');
      test.eqMatch(/:box!heading!cbox$/, getToddFocusedComponent());
      //closing this window should restore focus to the list in our parent
      test.getCurrentScreen().clickCloser();

      await test.wait('ui');
    }

  , { name: 'focusback'
    , test:function(doc,win)
      {
        test.eq(1, test.qSA('.t-screen').length);
        test.eqMatch(/:list$/, getToddFocusedComponent());
      }
    }

  , { name: 'openemptydialog'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['M01','A02']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'openemptydialog-testfocus'
    , test:function(doc,win)
      {
        let screens = test.qSA('.t-screen');
        test.eq(2, screens.length);
        test.eq(screens[1], doc.activeElement);
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }

  , { name: 'opertedialog'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['M01','A03']));
      }
    , waits: [ 'ui' ]
    , delayafter:500 //we NEED the delay for the RTE iframe to steal focus...
    }

  , { name: 'openrtedialog-testfocus'
    , test:function(doc,win)
      {
        //the RTE should NOT have focus
        test.eq(2, test.qSA('.t-screen').length);
        test.eqMatch(/:textedit$/,getToddFocusedComponent());
//        test.getCurrentScreen().clickCloser();

        //let's focus the RTE
        test.click(test.compByName('rte'));
        //verify
        test.eqMatch(/:rte$/,getToddFocusedComponent());
      }
    }

  , { name: 'openrtedialog-opensubwindow'
    , test:function(doc,win)
      {
        //and open a subwindow
        test.click(test.getMenu(['M02','A03']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'openrtedialog-testsubwindowfocus'
    , test:function(doc,win)
      {
        test.eqMatch(/:textedit$/,getToddFocusedComponent());
      }
    }

  , { name: 'openrtedialog-closesub'
    , test:function(doc,win)
      {
        //close the subwindow again
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }

  , { name: 'openrtedialog-testfocusafterclosesub'
    , test:function(doc,win)
      {
        //verify that the RTE got focus again
        test.eqMatch(/:rte/,getToddFocusedComponent());
      }
    }

  , { name: 'openrtedialog-close'
    , test:function(doc,win)
      {
        //close this window too, and we'll be back at the toplevel window
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }

  , { name: 'openrteonlydialog'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['M01','A04']));
      }
    , waits: [ 'ui' ]
    , delayafter:500 //we NEED the delay for the RTE iframe to steal focus...
    }

  , { name: 'openrteonlydialog-testfocus' }
  , async function(doc,win)
    {
      //the RTE should NOT have focus
      test.eq(2, test.qSA('.t-screen').length);
      test.true(dompack.matches(doc.activeElement, 'div.wh-rtd-editor[contenteditable]'));
      test.eqMatch(/:rte$/,getToddFocusedComponent());
      test.getCurrentScreen().clickCloser();
      await test.waitUIFree();
    }

  , "Open RTE+text Dialog, focus the RTE"
  , async function(doc,win)
    {
      test.click(test.getMenu(['M01','A05']));
      await test.waitUIFree();
      test.eq(2, test.qSA('.t-screen').length);
      test.true(dompack.matches(doc.activeElement, 'div.wh-rtd-editor[contenteditable]'));
      test.eqMatch(/:rte$/,getToddFocusedComponent());
    }
  ]);
