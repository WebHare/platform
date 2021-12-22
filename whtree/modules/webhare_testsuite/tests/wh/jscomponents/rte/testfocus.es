import * as dompack from "dompack";
import * as browser from "dompack/extra/browser";
import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

var std_contents = '<p>"hmmm hmm"</p><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png">"test"<b>"(*0*)Bo ld!(*1*)"</b>"en nog een "<a href="http://example.org/">"hyperlink"</a>"!"<p>"regel 2"</p><p>"image met "<a href="#link">"een hyperlink: "<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png"></a></p>';

function waitForReparentedRTE()
{
  return !!test.qS(".wh-rtd-editor");
}

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free'
    //, waits:['ui']
    }
  , { name: "earlyselectionstatecheck"
    , test: function(doc,win)
      {
        //create a local RTE and immediately check its selection state (ie before we know its loaded
//        var rtenode = new Element('div');
//        var myrte = new win.$wh.Rich.FreeEditor(rtenode);
//        var sel = myrte.getSelectionState();
//        test.false(sel.haveselection);
      }
    }

  , { name: "clickfocus"
    , test: async function(doc,win)
      {
        test.qS('#store').focus();
        test.eq(test.qS('#store'), doc.activeElement);
        test.click(test.qS('.wh-rtd-editor'));
        await test.wait("events");
        test.eq(test.qS('.wh-rtd-editor-bodynode'), doc.activeElement);
      }
    }

  , { name: 'setfocus'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        test.qS('#store').focus();
        test.eq(test.qS('#store'), doc.activeElement);
        test.false(rte.hasFocus());
        rte.takeFocus();
        //rte.delayedTakeFocus();
      }
    , allowevents:true
    }

  , { name: 'setenabled(false)'
    , test:function(doc,win)
      {
        var rte = win.rte.getEditor();

        test.true(rte.hasFocus());
        test.eq('DIV', doc.activeElement.nodeName);

        rte.selectNodeInner(rte.getContentBodyNode().getElementsByTagName('b')[0]);
        test.true(test.canClick(test.qS('span.wh-rtd-button[data-button=b]')));
        win.rte.setEnabled(false);

        test.true( !!win.rte.getBody().closest('.wh-rtd--disabled'));
        test.false(win.rte.getBody().closest('.wh-rtd--readonly'));
        test.throws(rtetest.testEqSelHTMLEx.bind(null, win, std_contents));
        test.eq(null, win.rte.getEditor());
        test.false(test.canClick(test.qS('span.wh-rtd-button[data-button=b]')));
      }
    }

  , { name: 'setenabled(true)'
    , test:function(doc,win)
      {
        win.rte.setEnabled(true);

        test.false(win.rte.getBody().closest('.wh-rtd--disabled'));
        test.false(win.rte.getBody().closest('.wh-rtd--readonly'));

/*
        test.true(win.rte.getEditor(), "We appear to not have an actual editor (didn't reconnect?)");
*/
        //make sure setenabled(true) didn't ruin selection after sleep..
        rtetest.testEqSelHTMLEx(win, std_contents);
        test.true(test.canClick(test.qS('span.wh-rtd-button[data-button=b]')));
      }
    }

  , { name: 'setreadonly(true)'
    , test:function(doc,win)
      {
        win.rte.setReadonly(true);

        test.false(win.rte.getBody().closest('.wh-rtd--disabled'));
        test.true( !!win.rte.getBody().closest('.wh-rtd--readonly'));
        test.throws(rtetest.testEqSelHTMLEx.bind(null, win, std_contents));
        test.eq(null, win.rte.getEditor());
      }
    }

  , { name: 'setreadonly(false)'
    , test:function(doc,win)
      {
        win.rte.setReadonly(false);

        test.false(win.rte.getBody().closest('.wh-rtd--disabled'));
        test.false(win.rte.getBody().closest('.wh-rtd--readonly'));

        test.true(win.rte.getEditor()); // make sure we have an editor

        //make sure setenabled(true) didn't ruin selection after sleep..
        rtetest.testEqSelHTMLEx(win, std_contents);
      }
    }

  , { name: 'hide parent container'
    , test:function(doc,win)
      {
        var rte=win.rte.getEditor();

        //make sure setenabled(true) didn't ruin selection after sleep..
        rtetest.testEqSelHTMLEx(win, std_contents);
        //console.log('pre setcursor', win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), { range: rte.getSelectionRange() }));

        rte.setCursor(rte.getContentBodyNode().getElementsByTagName('b')[0].firstChild,2);
        //console.log('post setcursor', win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), { range: rte.getSelectionRange() }));

        var sel = rte.getSelectionState();
        test.true(sel.hasTextStyle('b'));
        test.qS('#holder').style.display="none";
      }
    , allowevents:true
    }
      //during this wait, FF destroyes the nativeSelection object because the iframe is no longer in the DOM

  , { name: 'update rte while hidden'
    , test:function(doc,win)
      {
        var rte = win.rte.getEditor();
        var sel = rte.getSelectionState();
        test.true(sel.hasTextStyle('b'));
        rte.setContentsHTML('<p><b>bold</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');

        // Cursor selection doesn't work here on IE 8
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName('b')[0].firstChild,2);
        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
      }
    }

    // simple reparenting test
  , { name: 'simplereparent phase 1'
    , test:function(doc,win)
      {
        var rte=win.rte.getEditor();
        test.qS('#holder').style.display = "";
        rte.setContentsHTML('<p><b>bold</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName('b')[0].firstChild,2);
        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        win.reparent_rte();
      }
    }

  , { waits: [ waitForReparentedRTE ]
    }
    //and verify restoration
  , { name: 'simplereparent phase 2'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.takeFocus();
        await test.wait("events");

        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
      }
    }

    // reparenting test with offline change
  , { name: 'reparenting phase 1'
    , test:function(doc,win)
      {
        //var rte=win.rte.getEditor();
        win.reparent_rte();

        // RTE is now hidden -> no selection!
      }
    , waits: [ waitForReparentedRTE ]
    }

    //and verify restoration
  , { name: 'reparenting phase 2'
    , test:function(doc,win)
      {
        //var rte=win.rte.getEditor();
        // IE 8 doesn't have correct selection here. Though manual tests seems to work, so xfailing.
        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        //sometimes we get here, sometimes we don't
//        var range = rte.debugGetRawRawSelectionRange();
//        range.normalize(rte.getContentBodyNode());
//        rtetest.testEqHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

    // Firefox has problems when hiding, then showing, then focusing (loses cursor just when focusing)
    // First test with valid selection just before hide&show
  , { name: 'selectionrestore-validbefore-prepare'
    , test:function(doc,win)
      {
        var rte=win.rte.getEditor();

        rte.setContentsHTML('<p><b>bold</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        win.focus();
        rte.takeFocus();
        // Wait before setting cursor (contenteditable in chrome needs that)
      }
    }

  , { name: 'selectionrestore-validbefore-setcursor'
    , wait:function(doc,win,callback)
      {
        var rte=win.rte.getEditor();
        console.log('TEST set cursor');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName('b')[0].firstChild,2);
        console.log('TEST set cursor done, hiding');

        // FF sometimes fails restoring. trying this to find out why
        setTimeout(callback, 2000);
      }
    }

  , { name: 'selectionrestore-validbefore-hide'
    , wait:function(doc,win,callback)
     {
        test.qS('#holder').style.display="none";
        setTimeout(callback, 100);
      }
    }

  , { name: 'selectionrestore-validbefore-show'
    , wait:function(doc,win,callback)
      {
        test.qS('#holder').style.display = "";
        setTimeout(callback, 100);
      }
    }

  , { name: 'selectionrestore-validbefore-takefocus'
    , wait: function(doc,win,callback)
      {
        var rte=win.rte.getEditor();
        win.focus();
        rte.takeFocus();

        // Little time to give IE time to restore selection on focus
        if (browser.getName() === "ie")
          setTimeout(callback, 10);
        else
          callback();
      }
    }
/*
    // wait for it to load again...
  , { name: 'selectionrestore-validbefore-waitload'
    , wait: function(doc,win,callback)
      {
//        var rte=win.rte.getEditor();
//        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');

        if(win.rte.getEditor().isloaded)
          callback();
        else
          win.rte.getEditor().addEvent('load:once', callback);

      }
    }
*/
  , { name: 'selectionrestore-validbefore-test'
    , test:function(doc,win)
      {
        var rte=win.rte.getEditor();
        var range = rte.debugGetRawSelectionRange();
//        console.log('Real DOM range', range);
//        console.log('REALRANGE', win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), { range: range }));

        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');

        range.normalize(rte.getContentBodyNode());
        rtetest.testEqHTMLEx   (win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

    // Then test with selection set when hidden

  , { name: 'selectionrestore-setwhenhidden-prepare'
    , test:function(doc,win,callback)
      {
        var rte=win.rte.getEditor();

        rte.setContentsHTML('<p><b>bold</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        win.focus();
        rte.takeFocus();

        // Chrome won't send us a blur here... because of that, the test fails when chrome restores a default
        // selection on show
        test.qS('#holder').style.display="none";
      }
    }

  , { name: 'selectionrestore-setwhenhidden-show'
    , wait:function(doc,win,callback)
      {
        var rte=win.rte.getEditor();
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName('b')[0].firstChild,2);
        test.qS('#holder').style.display = "";
        setTimeout(callback, 100);
      }
    }

  , { name: 'selectionrestore-setwhenhidden-refocus'
    , wait:function(doc,win,callback)
      {
        var rte=win.rte.getEditor();
        win.focus();
        rte.takeFocus();
        setTimeout(callback, 100);
      }
    }

  , { name: 'selectionrestore-setwhenhidden-test'
    , xfail: test.getTestArgument(0)=='contenteditable' && (browser.getName() === "chrome") // see comment at -prepare
    , test:function(doc,win)
      {
        var rte=win.rte.getEditor();
        var range = rte.debugGetRawSelectionRange();
        //console.log('Real DOM range', range);
        //console.log('REALRANGE', win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), { range: range }));

        rtetest.testEqSelHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');

        range.normalize(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '<p><b>"bo(*0*)(*1*)ld"</b><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

  ]);
