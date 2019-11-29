import * as browser from "dompack/extra/browser";
import * as test from "@mod-tollium/js/testframework";
import { $qS, $qSA } from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
var domlevel = require('@mod-tollium/web/ui/components/richeditor/internal/domlevel');
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';

var useblockfill = true;

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/'
    }
  /*, { wait: rtetest.
    }*/
  , { name: 'firsttest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();

        rte.setContentsHTML('<p><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        rtetest.testEqSelHTMLEx(win, '<p>(*0*)(*1*)<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
      }
    }

  , { name: 'selectionapi_1'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();

        var tests =
          [
            '<ol class="ordered"><li>"a"<ol class="ordered"><li>"(*0*)(*2*)b"</li><li>"c"</li><li>"d(*1*)(*3*)"</li></ol></li></ol>'
          , '<b>"this text (*0*)(*1*)(*2*)(*3*)a b"<i>"old"</i>" text"</b>'
          , '<b>"this text (*0*)(*2*)a b"<i>"o(*1*)(*3*)ld"</i>" text"</b>'

          , '"ab"<br>"c(*0*)(*1*)(*2*)(*3*)"'
          , '"ab"(*0*)(*2*)<br>(*1*)(*3*)"c"'
          , '"ab(*0*)"(*2*)<br>(*3*)"(*1*)c"'

          , '<p>"a(*2*)(*3*)"<a href="yeey"></a>(*0*)(*1*)<br>' // don't move cursor into <a>!
          , '"a(*0*)(*1*)(*2*)(*3*)"<a href="yeey">"b"</a>' // don't move cursor into <a>!
          , '"a(*2*)(*3*)"(*0*)(*1*)<a href="yeey">"b"</a>' // don't move cursor into <a>!
          , '"a"<a href="yeey">"b"</a>(*0*)(*1*)"(*2*)(*3*)c"' // don't move cursor into <a>!

          , '<p><i>"a"</i></p><ol><li>"b(*0*)(*1*)(*2*)(*3*)"<ol><li>"c"</li></ol></li></ol>'
          , '<div><ul><li>"a"</li></ul><p><i>"(*0*)(*1*)(*2*)(*3*)b"</i></p></div>'

          , '(*0*)(*1*)<p><i>"(*2*)(*3*)a"</i></p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p>(*0*)(*1*)<i>"(*2*)(*3*)a"</i></p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>(*0*)(*1*)"(*2*)(*3*)a"</i></p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"(*0*)(*1*)(*2*)(*3*)a"</i></p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a(*0*)(*1*)(*2*)(*3*)"</i></p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a(*2*)(*3*)"(*0*)(*1*)</i></p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a(*2*)(*3*)"</i>(*0*)(*1*)</p><ol><li>"b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p>(*0*)(*1*)<ol><li>"(*2*)(*3*)b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol>(*0*)(*1*)<li>"(*2*)(*3*)b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>(*0*)(*1*)"(*2*)(*3*)b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"(*0*)(*1*)(*2*)(*3*)b"<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b(*2*)(*3*)"(*0*)(*1*)<ol><li>"c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol>(*0*)(*1*)<li>"(*2*)(*3*)c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>(*0*)(*1*)"(*2*)(*3*)c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"(*0*)(*1*)(*2*)(*3*)c"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*0*)(*1*)(*2*)(*3*)"</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*2*)(*3*)"(*0*)(*1*)</li></ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*2*)(*3*)"</li>(*0*)(*1*)</ol></li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*2*)(*3*)"</li></ol>(*0*)(*1*)</li></ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*2*)(*3*)"</li></ol></li>(*0*)(*1*)</ol>'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*2*)(*3*)"</li></ol></li></ol>(*0*)(*1*)'
          , '<p><i>"a"</i></p><ol><li>"b"<ol><li>"c(*2*)(*3*)"</li></ol></li></ol>(*0*)(*1*)'
          , useblockfill ? '' : '<p>"a"</p><p>(*0*)(*1*)(*2*)(*3*)</p><p>"b"</p>'
          , useblockfill ? '' : '<p>"a"</p><p><br>(*0*)(*1*)(*2*)(*3*)</p><p>"b"</p>'
          , ''
          ];

        // Test range normalizing
        for (let i = 0; i < tests.length; ++i)
        {
          if (!tests[i])
            continue;
          console.log('test ', i, tests[i]);

          let locators = rtetest.setStructuredContent(win, tests[i]);
          locators[0].check(rte.getContentBodyNode());
          locators[1].check(rte.getContentBodyNode());
          let range = new Range(locators[0], locators[1]);
          rte.selectRange(range);
          range.normalize(rte.getContentBodyNode());
          rtetest.testEqHTMLEx(win, tests[i], rte.getContentBodyNode(), [ locators[0], locators[1], range.start, range.end ]);
        }

        // Test selection setting
        // (normalize()->set browser selection->get browser selection->normalize() ). Should be equal to just normalize()
        for (let i = 0; i < tests.length; ++i)
        {
          if (!tests[i])
            continue;

          console.log('test ' + i + ' ' + tests[i]);
          let locators = rtetest.setStructuredContent(win, tests[i]);
          let range = rte.getSelectionRange();
          locators[2].assign(range.start);
          locators[3].assign(range.end);

          rtetest.testEqHTMLEx(win, tests[i], rte.getContentBodyNode(), locators);
        }
      }
    }


  //test the selection apis, mostly used to verify the IE6-8 range emulation
  , { name: 'selectionapi_2'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();

        rte.setContentsHTML('hey <b>bold</b> text');
        test.eq('hey <b>bold</b> text', win.rte.getValue().toLowerCase());

        let body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte, { startContainer: body.firstChild
                               , startOffset: 0
                               , endContainer: body.firstChild
                               , endOffset: 2
                               });

        rtetest.testEqSelHTMLEx(win, '"(*0*)he(*1*)y "<b>"bold"</b>" text"');
        rtetest.setRTESelection(win, rte, rtetest.getRTESelection(win, rte));
        rtetest.testEqSelHTMLEx(win, '"(*0*)he(*1*)y "<b>"bold"</b>" text"');
        test.false(rte.getSelectionState().hasTextStyle('b'));

        rte.selectNodeInner(body.childNodes[1]);
        rtetest.testEqSelHTMLEx(win, '"hey "<b>"(*0*)bold(*1*)"</b>" text"');
        rtetest.setRTESelection(win, rte, rtetest.getRTESelection(win, rte));
        rtetest.testEqSelHTMLEx(win, '"hey "<b>"(*0*)bold(*1*)"</b>" text"');
        test.true(rte.getSelectionState().hasTextStyle('b'));

        rte.setContentsHTML('<B>this text a b<I>old</I> text</B>');
        body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.firstChild
                               , startOffset: 1
                               , endContainer: body.firstChild
                               , endOffset: 2
                               });
        rtetest.testEqSelHTMLEx(win, '<B>"this text a b"<I>"(*0*)old(*1*)"</I>" text"</B>');
        test.true(rte.getSelectionState().hasTextStyle('i'));
        test.true(rte.getSelectionState().hasTextStyle('b'));
        rtetest.setRTESelection(win, rte, rtetest.getRTESelection(win, rte));
        rtetest.testEqSelHTMLEx(win, '<B>"this text a b"<I>"(*0*)old(*1*)"</I>" text"</B>');
        test.true(rte.getSelectionState().hasTextStyle('i'));
        test.true(rte.getSelectionState().hasTextStyle('b'));

        rte.setContentsHTML('<B>this text a b<I>old</I> text</B>');
        body = rte.getContentBodyNode();
        let t1 = body.firstChild.firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: t1
                               , startOffset: 1
                               , endContainer: t1
                               , endOffset: 4
                               });
        rtetest.testEqSelHTMLEx(win, '<B>"t(*0*)his(*1*) text a b"<I>"old"</I>" text"</B>');
        test.false(rte.getSelectionRange().isCollapsed());
        rte.collapseSelection(true);
        rtetest.testEqSelHTMLEx(win, '<B>"t(*0*)(*1*)his text a b"<I>"old"</I>" text"</B>');
        test.true(rte.getSelectionRange().isCollapsed());
        rte.insertTextAtCursor('x');
        rtetest.setRTESelection(win, rte,  { startContainer: t1
                               , startOffset: 1
                               , endContainer: t1
                               , endOffset: 5
                               });
        rtetest.testEqSelHTMLEx(win, '<B>"t(*0*)xhis(*1*) text a b"<I>"old"</I>" text"</B>');

        rte.collapseSelection();
        test.true(rte.getSelectionRange().isCollapsed());
        rtetest.testEqSelHTMLEx(win, '<B>"txhis(*0*)(*1*) text a b"<I>"old"</I>" text"</B>');
        rte.insertTextAtCursor('x');
        rtetest.setRTESelection(win, rte,  { startContainer: t1
                               , startOffset: 1
                               , endContainer: t1
                               , endOffset: 6
                               });
        rtetest.testEqSelHTMLEx(win, '<B>"t(*0*)xhisx(*1*) text a b"<I>"old"</I>" text"</B>');

        // Test various cursor and selection positions
        rte.setContentsHTML('ab<br/>c');
        body = rte.getContentBodyNode();
        t1 = body.firstChild;

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 0
                               , endContainer: body
                               , endOffset: 0
                               });

        rtetest.testEqSelHTMLEx(win, '"(*0*)(*1*)ab"<br/>"c"');

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 0
                               , endContainer: body
                               , endOffset: 1
                               });
        rtetest.testEqSelHTMLEx(win, '"(*0*)ab(*1*)"<br/>"c"');

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 1
                               , endContainer: body
                               , endOffset: 1
                               });

        rtetest.testEqSelHTMLEx(win, '"ab(*0*)(*1*)"<br/>"c"');

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 1
                               , endContainer: body
                               , endOffset: 2
                               });
        rtetest.testEqSelHTMLEx(win, '"ab"(*0*)<br/>(*1*)"c"');

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 2
                               , endContainer: body
                               , endOffset: 2
                               });
        rtetest.testEqSelHTMLEx(win, '"ab"<br/>"(*0*)(*1*)c"');

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 2
                               , endContainer: body
                               , endOffset: 3
                               });
        rtetest.testEqSelHTMLEx(win, '"ab"<br/>"(*0*)c(*1*)"');

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 3
                               , endContainer: body
                               , endOffset: 3
                               });
        rtetest.testEqSelHTMLEx(win, '"ab"<br/>"c(*0*)(*1*)"');

        rte.setContentsHTML('ab<b>c</b>');
        var pastb = new domlevel.Locator(rte.getContentBodyNode().firstChild, 2); // "ab|"<b>...
        var prec = new domlevel.Locator(rte.getContentBodyNode().firstChild.nextSibling.firstChild, 0); // "ab|"<b>"|c...

        rte.selectRange(new Range(pastb, pastb));
        rtetest.testEqSelHTMLEx(win, '"ab(*0*)(*1*)"<b>"c"</b>');

        // Firefox is more liberal with caret placement thatn other browsers, and lets the user place the caret
        // just before the next visible text (instead of always after the last visible text, which all other browsers)
        // do. Need to keep that behaviour, 'cause FF uses the style where the caret is placed for inserting new text.
        rte.selectRange(new Range(prec, prec), { skipnormalize: true });
        if (browser.getName() === "firefox")
          rtetest.testEqSelHTMLEx(win, '"ab"<b>"(*0*)(*1*)c"</b>');
        else
          rtetest.testEqSelHTMLEx(win, '"ab(*0*)(*1*)"<b>"c"</b>');
      }
    }

  , { name: 'selectionapi_ie8andlower'
    , test: function(doc,win)
      {
        // Rangy has problems with positioning at end of text node just before OL, places them inside the ol
        rtetest.setStructuredContent(win, '<ol><li>"ab(*0*)"<ol><li>"c"</li></ol></li></ol>');
        rtetest.testEqSelHTMLEx(win, '<ol><li>"ab(*0*)(*1*)"<ol><li>"c"</li></ol></li></ol>');
      }
    }


  , { name: 'properties'
    , test: async (doc,win) =>
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('<b>Bold tekst</b> en ook een plaatje: <img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" />'
                            +' en een link <a id="link" href="#link">link</a>,'
                            +' een <a id="anchor" name="anchor">anchor</a> '
                            +' en een img in een link <a id="link2" href="../link2"><img id="img2" src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" /></a>');

        var body = rte.getContentBodyNode();

        /* ADDME should also work with simple cursor positioning ?
        rte.setCursor(body.getElementsByTagName('b')[0],2);
        test.false(rte.getSelectionState().properties);

        rte.setCursor(body.getElementsByTagName('img')[0],2);
        test.true(rte.getSelectionState().properties);
        */

        rtetest.setRTESelection(win, rte, {startContainer:body.childNodes[1], startOffset:4, endContainer:body.childNodes[1], endOffset:8});
        rtetest.testEqSelHTMLEx(win,
            '<b>"Bold tekst"</b>" en (*0*)ook (*1*)een plaatje: "<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" />'
          + '" en een link "<a id="link" href="#link">"link"</a>",'
          + ' een "<a id="anchor" name="anchor">"anchor"</a>" '
          + ' en een img in een link "<a id="link2" href="../link2"><img id="img2" src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" /></a>');

        test.false(rte.getSelectionState().properties);

        rtetest.setRTESelection(win, rte, {startContainer:body, startOffset:2, endContainer:body, endOffset:3});
        test.true(rte.getSelectionState().properties);
        test.eq("img", rte.getSelectionState().actionelements[0].element);

        // When settings selection at start of link text, browser puts selection outside of link
        rte.setCursor($qS('#link').firstChild,0);
        //console.log('selected', win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));
        test.false(rte.getSelectionState().properties);


        rte.setCursor($qS('#link').firstChild,1);
        test.true(rte.getSelectionState().properties);

        win.apropshandler = function(targetid,target)
                            {
                              test.eq("#link", target.getAttribute("href"));
                              win.apropshandler=null;
                            };
        rte.executeAction("action-properties");
        test.eq(null, win.apropshandler); //ensure it was invoked

        rte.setCursor($qS('#anchor').firstChild,0);
        test.false(rte.getSelectionState().properties);

        rte.setCursor($qS('#link2'),0);
        test.false(rte.getSelectionState().properties); //as we're positioned _before_ the image, only <a href matches, so it's okay

        rtetest.setRTESelection(win, rte, {startContainer:$qS('#link2')
                         ,startOffset:0
                         ,endContainer:$qS('#link2')
                         ,endOffset:1});

        //var selrange = rte.getSelectionRange();
        //console.log('selected', win.$wh.Rich.getStructuredOuterHTML(selrange.getAncestorElement(), rte.getSelectionRange()));

        var state = rte.getSelectionState();
        test.true(state.properties);
        test.eq(2, state.actionelements.length);
        test.eq('img', state.actionelements[0].element); //img is deepest, should be selected first
        test.eq('a', state.actionelements[1].element);

        win.imgpropshandler = function(targetid,target)
                            {
                              test.eq("../link2", target.parentNode.getAttribute("href"));
                              win.imgpropshandler=null;
                            };
        rte.executeAction("action-properties");
        test.eq(null, win.imgpropshandler); //ensure it was invoked

        //now try to trigger it by doubleclicking
        win.imgpropshandler = function(targetid,target)
                            {
                              if(target.nodeName.toUpperCase()=='IMG')
                                win.imgpropshandler=null;
                            };

        await test.wait("events"); // FF needs to load the image
        await test.wait(100); // chrome needs some extra wait too
        test.click($qS(rte.getContentBodyNode(), "img"));
        test.click($qS(rte.getContentBodyNode(), "img")); //doubleclick
        test.eq(null, win.imgpropshandler); //ensure it was invoked
      }
    }

  , { name: 'formattingstate'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();

        var stdavailable = [ "img", "b", "i", "u", "strike", "sub", "sup", "ol", "ul" ];

        // available is excluding the stdavailable stuff, not specifying means nothing (same for active)
        var tests =
            [ { html: '<p>(*0*)<br></p>', active: [] }
            , { html: '<p>"a"<b>"(*0*)b"</b>"c"</p>', active: [] }
            , { html: '<p>"a"<b>"b(*0*)"</b>"c"</p>', active: [ 'b' ] }
            , { html: '<p>"a"<b>"b"</b>"(*0*)c"</p>', active: [ 'b' ] }
            , { html: '<p>"a"<u>"b(*0*)"</u>"c"</p>', active: [ 'u' ] }
            , { html: '<p>"a"<b><u>"b(*0*)"</u></b>"c"</p>', active: [ 'b', 'u' ] }
            , { html: '<p>"a"<i>"b(*0*)"</i>"c"</p>', active: [ 'i' ] }
            , { html: '<p>"a"<strike>"b(*0*)"</strike>"c"</p>', active: [ 'strike' ] }
            , { html: '<p>"a"<sub>"b(*0*)"</sub>"c"</p>', active: [ 'sub' ] }
            , { html: '<p>"a"<sup>"b(*0*)"</sup>"c"</p>', active: [ 'sup' ] }
            , { html: '<ol><li>"(*0*)a"</li><ol>', active: [ 'ol' ], available: [ 'li-increase-level', 'li-decrease-level' ] }
            , { html: '<ul><li>"(*0*)a"</li><ul>', active: [ 'ul' ], available: [ 'li-increase-level', 'li-decrease-level' ]  }
            , { html: '<ul><li><ol><li>"(*0*)a"</li></ol></li><ul>', active: [ 'ol' ], available: [ 'li-increase-level', 'li-decrease-level' ] }
            , { html: '<ol><li><ul><li>"(*0*)a"</li></ul></li><ol>', active: [ 'ul' ], available: [ 'li-increase-level', 'li-decrease-level' ]  }
            , { html: '<ul><li></li><li>"(*0*)a"</li><ul>', active: [ 'ul' ], available: [ 'li-increase-level', 'li-decrease-level' ]  }
            , { html: '<ol><li></li><li>"(*0*)a"</li><ol>', active: [ 'ol' ], available: [ 'li-increase-level', 'li-decrease-level' ]  }
            , { html: '<p>"a"<a href="http://example.com">"(*0*)b"</a>"c"</p>', active: [ ] }
            , { html: '<p>"a"<a href="http://example.com">"b(*0*)"</a>"c"</p>', active: [ ] }
            , { html: '<p>"a"<a href="http://example.com">"(*0*)b(*1*)"</a>"c"</p>', available: [ 'a-href', 'action-properties' ] }
            , { html: '<p>"a"(*0*)<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="50" width="50">"c"</p>', active: [ ] }
            , { html: '<p>"a"<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="50" width="50">(*0*)"c"</p>', active: [ ] }
            , { html: '<p>"a"(*0*)<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="50" width="50">"(*1*)c"</p>', available: [ 'a-href', 'action-properties' ] }
            ];

        for (var i = 0; i < tests.length; ++i)
        {
          console.log('test', i, tests[i].html);

          rtetest.setStructuredContent(win, tests[i].html);
          var state = rte.getSelectionState();

          var active = Object.entries(state.actionstate).filter(([ name, value ]) => value.active).map(([ name ]) => name).sort();
          var available = Object.entries(state.actionstate).filter(([ name, value ]) => value.available).map(([ name ]) => name).sort();

          test.eq((tests[i].active||[]).sort(), active);
          test.eq(stdavailable.concat(tests[i].available||[]).sort(), available);
        }
      }
    }


  , { name: 'insertimage'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('<b id="b">Bold tekst</b>');
        rte.setCursor($qS('#b').firstChild,4);

        rtetest.testEqSelHTMLEx(win, '<b id="b">"Bold(*0*)(*1*) tekst"</b>');

        rte.insertImage("/tollium_todd.res/webhare_testsuite/tollium/logo.png", 50, 50);
        rtetest.testEqSelHTMLEx(win, '<b id="b">"Bold"(*0*)<img class="wh-rtd__img" src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="50" width="50">(*1*)" tekst"</b>');

        rte.selectNodeOuter($qS(rte.getContentBodyNode(), "img"));
        rtetest.testEqSelHTMLEx(win, '<b id="b">"Bold"(*0*)<img class="wh-rtd__img" src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="50" width="50" >(*1*)" tekst"</b>');
        rte.insertImage("/tollium_todd.res/webhare_testsuite/tollium/radiobutton.png", 16, 16);
        rtetest.testEqSelHTMLEx(win, '<b id="b">"Bold"(*0*)<img class="wh-rtd__img" src="/tollium_todd.res/webhare_testsuite/tollium/radiobutton.png" height="16" width="16">(*1*)"\u00a0tekst"</b>');

        rte.setContentsHTML('<b id="b">Bold tekst</b>');
        rte.setCursor($qS('#b').firstChild,4);

        rte.insertImage("/tollium_todd.res/webhare_testsuite/tollium/logo.png", 10, 10);
        rtetest.testEqSelHTMLEx(win, '<b id="b">"Bold"(*0*)<img class="wh-rtd__img" src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10">(*1*)" tekst"</b>');

        rte.setContentsHTML('<p><img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
        rtetest.testEqSelHTMLEx(win, '<p>(*0*)(*1*)<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" height="10" width="10"></p>');
      }
    }

  , { name: 'simplereadwritetest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();
        var body = rte.getContentBodyNode();

        rte.setContentsHTML('<b>this text a bold text</b>');
        test.eq('<b>this text a bold text</b>', win.rte.getValue().toLowerCase());

        //Select 'old'
        var boldelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.firstChild
                               , startOffset: 13
                               , endContainer: boldelement.firstChild
                               , endOffset: 16
                               });
        rtetest.testEqSelHTMLEx(win, '<b>"this text a b(*0*)old(*1*) text"</b>');

        rte.applyTextStyle('i',true);
        rtetest.testEqSelHTMLEx(win, '<b>"this text a b"<i>"(*0*)old(*1*)"</i>" text"</b>');
        rte.applyTextStyle('i',false);
        // TODO Implement node combine when removing stuff
        rtetest.testEqSelHTMLEx(win, '<b>"this text a b""(*0*)old(*1*)"" text"</b>');
        rte.applyTextStyle('i',true);
        rtetest.testEqSelHTMLEx(win, '<b>"this text a b"<i>"(*0*)old(*1*)"</i>" text"</b>');

        //Select 'a bo'
        boldelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.firstChild
                               , startOffset: 10
                               , endContainer: boldelement.getElementsByTagName('i')[0].firstChild
                               , endOffset: 1
                               });
        rtetest.testEqSelHTMLEx(win, '<b>"this text (*0*)a b"<i>"o(*1*)ld"</i>" text"</b>');

        rte.applyTextStyle('u',true);
        test.eq('<b>this text <u>a b<i>o</i></u><i>ld</i> text</b>', win.rte.getValue().toLowerCase());

        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.firstChild
                               , startOffset: 0
                               , endContainer: boldelement.lastChild
                               , endOffset: ' text'.length - 1
                               });

        rtetest.testEqSelHTMLEx(win, '<b>"(*0*)this text "<u>"a b"<i>"o"</i></u><i>"ld"</i>" tex(*1*)t"</b>', win.rte.getValue().toLowerCase());

        rte.applyTextStyle('b',false);

        rtetest.testEqSelHTMLEx(win, '"(*0*)this text "<u>"a b"<i>"o"</i></u><i>"ld"</i>" tex(*1*)"<b>"t"</b>', win.rte.getValue().toLowerCase());

        rte.applyTextStyle('b',true);

        rte.selectNodeInner(rte.getContentBodyNode());
        // TODO Implement node combine when adding stuff
        rtetest.testEqSelHTMLEx(win, '<b>"(*0*)this text "<u>"a b"<i>"o"</i></u><i>"ld"</i>" tex"</b><b>"t(*1*)"</b>', win.rte.getValue().toLowerCase());

        rte.applyTextStyle('b',false);

        // TODO Implement node combine when removing stuff
        rtetest.testEqSelHTMLEx(win, '"(*0*)this text "<u>"a b"<i>"o"</i></u><i>"ld"</i>" tex""t(*1*)"', win.rte.getValue().toLowerCase());

        rte.setContentsHTML('this text no bold text');

        //Select nothing in the middle
        let textelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: textelement
                               , startOffset: 14
                               , endContainer: textelement
                               , endOffset: 14
                               });

        rtetest.testEqSelHTMLEx(win, '"this text no b(*0*)(*1*)old text"', win.rte.getValue().toLowerCase());
        rte.applyTextStyle('b',true);
        rtetest.testEqSelHTMLEx(win, '"this text no b(*0*)(*1*)old text"', win.rte.getValue().toLowerCase());

        rte._gotKeyPress(test.generateKeyboardEvent(body, "keypress", { key: "x" }));
        rtetest.testEqSelHTMLEx(win, '"this text no b"<b>"x(*0*)(*1*)"</b>"old text"', win.rte.getValue().toLowerCase());

        rte.setContentsHTML('this text no bold text');

        //Select nothing in the middle
        textelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: textelement
                               , startOffset: 14
                               , endContainer: textelement
                               , endOffset: 14
                               });

        rtetest.testEqSelHTMLEx(win, '"this text no b(*0*)(*1*)old text"', win.rte.getValue().toLowerCase());
        rte.insertTextAtCursor('x');
        rtetest.testEqSelHTMLEx(win, '"this text no b(*0*)x(*1*)old text"', win.rte.getValue().toLowerCase());
        rte.applyTextStyle('b',true);
        rtetest.testEqSelHTMLEx(win, '"this text no b"<b>"(*0*)x(*1*)"</b>"old text"', win.rte.getValue().toLowerCase());

        rte.setContentsHTML('<b>bold<i>bold,italic</i></b><u>underlined</u>');

        var italictextelement = rte.getContentBodyNode().firstChild.firstChild.nextSibling.firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: italictextelement
                               , startOffset: 1
                               , endContainer: italictextelement
                               , endOffset: 1
                               });

        rte.applyTextStyle('b',false);
        rtetest.testEqSelHTMLEx(win, '<b>"bold"<i>"b(*0*)(*1*)old,italic"</i></b><u>"underlined"</u>');
        rte._gotKeyPress(test.generateKeyboardEvent(body, "keypress", { key: "x" }));
        rtetest.testEqSelHTMLEx(win, '<b>"bold"<i>"b"</i></b><i>"x(*0*)(*1*)"</i><b><i>"old,italic"</i></b><u>"underlined"</u>');

        rte.setContentsHTML('<ul><li>ab</li><li>cd</li></ul>');
        var ullement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: ullement.firstChild.firstChild
                               , startOffset: 1
                               , endContainer: ullement.firstChild.nextSibling.firstChild
                               , endOffset: 1
                               });

        rte.applyTextStyle('b',true);
        // IE inserts newlines...
        rtetest.testEqSelHTMLEx(win, '<ul><li>"a"<b>"(*0*)b"</b></li><li><b>"c(*1*)"</b>"d"</li></ul>');
      }

    }


  , { name: 'elementoffsettest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();

        rte.setContentsHTML('<b>this text a b<span>old</span> text</b>');
        test.eq('<b>this text a b<span>old</span> text</b>', win.rte.getValue().toLowerCase());

        //Select 'old'
        var boldelement = rte.getContentBodyNode().firstChild;
        var spanelement = boldelement.firstChild.nextSibling;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement
                               , startOffset: 1
                               , endContainer: boldelement
                               , endOffset: 2
                               });

        //necessary sanity checks..
        test.eqIn([ boldelement, spanelement ], rte.getSelectionRange().getAncestorElement());

        rtetest.testEqSelHTMLEx(win, '<b>"this text a b"<span>"(*0*)old(*1*)"</span>" text"</b>');

        rte.applyTextStyle('i',true);

        rtetest.testEqSelHTMLEx(win, '<b>"this text a b"<span><i>"(*0*)old(*1*)"</i></span>" text"</b>');
        //test.eq('<b>this text a b<i><span>old</span></i> text</b>', win.rte.getValue().toLowerCase());

        rte.applyTextStyle('i',false);

        rtetest.testEqSelHTMLEx(win, '<b>"this text a b"<span>"(*0*)old(*1*)"</span>" text"</b>');
        rte.applyTextStyle('i',true);

        rtetest.testEqSelHTMLEx(win, '<b>"this text a b"<span><i>"(*0*)old(*1*)"</i></span>" text"</b>');

        //Select 'a bo'

        boldelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.firstChild
                               , startOffset: 10
                               , endContainer: rtetest.getTextChild(boldelement.getElementsByTagName('i')[0])
                               , endOffset: 1
                               });
        rtetest.testEqSelHTMLEx(win, '<b>"this text (*0*)a b"<span><i>"o(*1*)ld"</i></span>" text"</b>');


        rte.applyTextStyle('u',true);
        rtetest.testEqSelHTMLEx(win, '<b>"this text "<u>"(*0*)a b"<span><i>"o(*1*)"</i></span></u><span><i>"ld"</i></span>" text"</b>');
      }

    }


  , { name: 'doubleapplytest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();

        rte.setContentsHTML('<b>this text a bold text</b>');
        test.eq('<b>this text a bold text</b>', win.rte.getValue().toLowerCase());
        let boldelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.firstChild
                               , startOffset: 'this '.length
                               , endContainer: boldelement.firstChild
                               , endOffset: 'this text'.length
                               });

        rtetest.testEqSelHTMLEx(win, '<b>"this (*0*)text(*1*) a bold text"</b>');
        rte.applyTextStyle('i',true);
        rtetest.testEqSelHTMLEx(win, '<b>"this "<i>"(*0*)text(*1*)"</i>" a bold text"</b>');

        //partial overlap syntax reapply, overlap on right end
        boldelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.childNodes[1].firstChild // <i>
                               , startOffset: 'xt'.length
                               , endContainer: boldelement.childNodes[2]
                               , endOffset: ' a bo'.length
                               });
        rtetest.testEqSelHTMLEx(win, '<b>"this "<i>"te(*0*)xt"</i>" a bo(*1*)ld text"</b>');
        rte.applyTextStyle('i',true);
        //ADDME nice to have, good cleanup of children
        rtetest.testEqSelHTMLEx(win, '<b>"this "<i>"te"</i><i>"(*0*)xt"" a bo(*1*)"</i>"ld text"</b>');

        //all underlines should go!
        rte.selectNodeInner(rte.getContentBodyNode());
        rtetest.testEqSelHTMLEx(win, '<b>"(*0*)this "<i>"te"</i><i>"xt"" a bo"</i>"ld text(*1*)"</b>');
        rte.applyTextStyle('i',false);
        rtetest.testEqSelHTMLEx(win, '<b>"(*0*)this ""te""xt"" a bo""ld text(*1*)"</b>');

        //full overlap reapply
        rte.setContentsHTML('<b>this text a bold text</b>');
        boldelement = rte.getContentBodyNode().firstChild;
        rtetest.setRTESelection(win, rte,  { startContainer: boldelement.firstChild
                               , startOffset: 'this '.length
                               , endContainer: boldelement.firstChild
                               , endOffset: 'this text'.length
                               });
        rtetest.testEqSelHTMLEx(win, '<b>"this (*0*)text(*1*) a bold text"</b>');
        rte.applyTextStyle('i',true);
        rtetest.testEqSelHTMLEx(win, '<b>"this "<i>"(*0*)text(*1*)"</i>" a bold text"</b>');
        rte.applyTextStyle('i',true);
        rtetest.testEqSelHTMLEx(win, '<b>"this "<i>"(*0*)text(*1*)"</i>" a bold text"</b>');
      }

    }


  , { name: 'complexmaniptest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('just another text. <b>bold 1</b>, <i>italic 1</i>, <b>secondbold</b>, <u>underline 1</u>');
        test.eq('just another text. <b>bold 1</b>, <i>italic 1</i>, <b>secondbold</b>, <u>underline 1</u>', win.rte.getValue().toLowerCase());

        //make everything from 'another' until 'italic' bold. should eliminate the bold tags around bold1
        var body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.firstChild
                               , startOffset: 'Just '.length
                               , endContainer: body.getElementsByTagName('i')[0].firstChild
                               , endOffset: 'italic'.length
                               });
        rtetest.testEqSelHTMLEx(win, '"just (*0*)another text. "<b>"bold 1"</b>", "<i>"italic(*1*) 1"</i>", "<b>"secondbold"</b>", "<u>"underline 1"</u>');

        rte.applyTextStyle('b',true);
        rtetest.testEqSelHTMLEx(win, '"just "<b>"(*0*)another text. ""bold 1"", "<i>"italic(*1*)"</i></b><i>" 1"</i>", "<b>"secondbold"</b>", "<u>"underline 1"</u>');
      }
    }


  , { name: 'breaktest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('a<br>b<br>c<br>');

        var body = rte.getContentBodyNode();

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 3
                               , endContainer: body
                               , endOffset: 3
                               });
        rtetest.testEqSelHTMLEx(win, '"a"<br>"b(*0*)(*1*)"<br>"c"<br>');
        rte.applyTextStyle('b',true);
        rte._gotKeyPress(test.generateKeyboardEvent(body, "keypress", { key: "x" }));
        rtetest.testEqSelHTMLEx(win, '"a"<br>"b"<b>"x(*0*)(*1*)"</b><br>"c"<br>');
      }

    }


  , { name: 'paramaniptest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('<p>Haikus are easy</p><p>But sometimes they don\'t make sense</p><p>Refrigerator</p>');
        //testEqHTML( '<p>haikus are easy</p><p>but sometimes they don\'t make sense</p><p>refrigerator</p>'
        //                   , win.rte.getValue().toLowerCase());

        let body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[0].firstChild
                               , startOffset: 'Haikus are '.length
                               , endContainer: body.childNodes[1].firstChild
                               , endOffset: 'but sometimes'.length
                               });

        //ADDME getSelectionText() should probably contain \ns. But we use getSelectionText only for debugging now, so don't really care..
        rtetest.testEqSelHTMLEx(win, '<p>"Haikus are (*0*)easy"</p><p>"But sometimes(*1*) they don\'t make sense"</p><p>"Refrigerator"</p>');
        rte.applyTextStyle('b',true);
        rtetest.testEqSelHTMLEx(win, '<p>"Haikus are "<b>"(*0*)easy"</b></p><p><b>"But sometimes(*1*)"</b>" they don\'t make sense"</p><p>"Refrigerator"</p>');

        rte.setContentsHTML('<p>AB</p><p>CD</p><div><p>EF</p>GH</div><p>IJ</p>');
        //testEqHTML('<p>ab</p><p>cd</p><div><p>ef</p>gh</div><p>ij</p>'
        //    , win.rte.getValue().toLowerCase());

        body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[0].firstChild
                               , startOffset: 'A'.length
                               , endContainer: body.childNodes[3].firstChild
                               , endOffset: 'I'.length
                               });

        rtetest.testEqSelHTMLEx(win, '<p>"A(*0*)B"</p><p>"CD"</p><div><p>"EF"</p>"GH"</div><p>"I(*1*)J"</p>');

        rte.applyTextStyle('b',true);
        rtetest.testEqSelHTMLEx(win, '<p>"A"<b>"(*0*)B"</b></p><p><b>"CD"</b></p><div><p><b>"EF"</b></p><b>"GH"</b></div><p><b>"I(*1*)"</b>"J"</p>');
      }

    }


  , { name: 'hyperlinktest'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        win.rte.setValue('<p>Haikus are easy</p><p>But sometimes they don\'t make sense</p><p>Refrigerator</p>');
        test.false(win.rte.isDirty());

        let body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[0].firstChild
                               , startOffset: 'Haikus are'.length
                               , endContainer: body.childNodes[1].firstChild
                               , endOffset: 'but sometimes '.length
                               });
    //    WHRTE.log('selection #1:');
        rtetest.getRTESelection(win, rte); // FIXME: remove, only used for showing state by debug statements
        test.eq( false, rte.getSelectionState().hyperlink);
        test.false(win.rte.isDirty());
        win.rte.insertHyperlink('http://www.b-lex.nl/', { target: '_blank' });
        test.true(win.rte.isDirty());

    //    WHRTE.log('selection #2:');
        rtetest.getRTESelection(win, rte); // FIXME: remove, only used for showing state by debug statements

        test.eq( true, rte.getSelectionState().hyperlink);
        test.eqHTML('<p>haikus are <a href="http://www.b-lex.nl/" target="_blank">easy</a></p><p><a href="http://www.b-lex.nl/" target="_blank">but sometimes</a> they don\'t make sense</p><p>refrigerator</p>'
            , win.rte.getValue().toLowerCase());

        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[1].firstChild.firstChild
                               , startOffset: 0
                               , endContainer: body.childNodes[1].firstChild.firstChild
                               , endOffset: 'but'.length
                               });
        test.true(rte.getSelectionState().hyperlink);

        win.rte.clearDirty();
        test.false(win.rte.isDirty());

        //Execute a properties action on the RTE, and capture it
        let propsevent = rtetest.getNextAction();
        test.click(win.rte.getButtonNode('a-href'));
        let result = await propsevent;

        //Modify the hyperlink
        let targetinfo = win.rte.getTargetInfo(result.detail.actiontarget);
        test.eq('hyperlink', targetinfo.type);
        test.eq('http://www.b-lex.nl/', targetinfo.link);
        test.eq('_blank', targetinfo.target);
        win.rte.updateTarget(result.detail.actiontarget, { link: 'http://www.example.net/' });
        test.true(win.rte.isDirty());

        test.eq( true, rte.getSelectionState().hyperlink);
        test.eqHTML('<p>haikus are <a href="http://www.b-lex.nl/" target="_blank">easy</a></p><p><a href="http://www.example.net/" target="_blank">but sometimes</a> they don\'t make sense</p><p>refrigerator</p>'
            , win.rte.getValue().toLowerCase());

        win.rte.clearDirty();
        win.rte.updateTarget(result.detail.actiontarget, { destroy: true });
        test.true(win.rte.isDirty());

        test.eq( false, rte.getSelectionState().hyperlink);
        test.eqHTML('<p>haikus are <a href="http://www.b-lex.nl/" target="_blank">easy</a></p><p>but sometimes they don\'t make sense</p><p>refrigerator</p>'
            , win.rte.getValue().toLowerCase());

        rte.selectNodeInner(rte.getContentBodyNode());
        test.eq( true, rte.getSelectionState().hyperlink);

        rte.setContentsHTML('abcd');
        body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.firstChild
                               , startOffset: 'a'.length
                               , endContainer: body.firstChild
                               , endOffset: 'abc'.length
                               });

        //verify that hyperlinks get preserved as-is
        rte.insertHyperlink('#top');
        test.eq("#top", rte.getContentBodyNode().getElementsByTagName("A")[0].getAttribute("href"));
        rtetest.testEqSelHTMLEx(win, '"a"<a href="#top">"(*0*)bc(*1*)"</a>"d"');

        rte.insertHyperlink('http://www.b-lex.nl/');
        rtetest.testEqSelHTMLEx(win, '"a"<a href="http://www.b-lex.nl/">"(*0*)bc(*1*)"</a>"d"');


        rtetest.setRTESelection(win, rte,  { startContainer: body.firstChild.nextSibling.firstChild
                               , startOffset: 'b'.length
                               , endContainer: body.firstChild.nextSibling.nextSibling
                               , endOffset: 'd'.length
                               });

        rte.applyTextStyle('i',true);
        rtetest.testEqSelHTMLEx(win, '"a"<a href="http://www.b-lex.nl/">"b"<i>"(*0*)c"</i></a><i>"d(*1*)"</i>');
      }

    }

  , { name: 'iteratortest'
    , test: function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('<p>Haikus are easy</p><p>But sometimes they don\'t make sense</p><p>Refrigerator</p>');

        var body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[0].firstChild
                               , startOffset: body.childNodes[0].firstChild.nodeValue.length
                               , endContainer: body.childNodes[2].firstChild
                               , endOffset: 0
                               });

        test.eq( [ 'p', '#text: But sometimes they don\'t make sense' ], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));

        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[0].firstChild
                               , startOffset: body.childNodes[0].firstChild.nodeValue.length
                               , endContainer: body.childNodes[2].firstChild
                               , endOffset: 1
                               });

        test.eq( [ 'p', '#text: But sometimes they don\'t make sense', 'p', '#text: Refrigerator' ], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));

        rtetest.setRTESelection(win, rte,  { startContainer: body.childNodes[0].firstChild
                               , startOffset: body.childNodes[0].firstChild.nodeValue.length
                               , endContainer: body
                               , endOffset: body.childNodes.length
                               });

        test.eq( [ 'p', '#text: But sometimes they don\'t make sense', 'p', '#text: Refrigerator' ], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));

        rte.selectNodeInner(rte.getContentBodyNode());
        //console.log(win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));

        //var topnode = getTestArgument(0)=='contenteditable' ? 'div' : 'body';
        test.eq( [ /*topnode, */'p', '#text: Haikus are easy', 'p', '#text: But sometimes they don\'t make sense', 'p', '#text: Refrigerator' ], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 0
                               , endContainer: body
                               , endOffset: 0
                               });

        //console.log(win.$wh.Rich.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));
        test.eq( [], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: 1
                               , endContainer: body
                               , endOffset: 1
                               });

        test.eq( [], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));

        rtetest.setRTESelection(win, rte,  { startContainer: body
                               , startOffset: body.childNodes.length
                               , endContainer: body
                               , endOffset: body.childNodes.length
                               });

        test.eq( [], rtetest.RunIteratorOnRange2(win,rte.getSelectionRange()));
      }
    }
  ]);
