import * as dompack from "dompack";
import * as browser from "dompack/extra/browser";
import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
import * as domlevel from "@mod-tollium/web/ui/components/richeditor/internal/domlevel";
import * as richdebug from "@mod-tollium/web/ui/components/richeditor/internal/richdebug";
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';


// HTML used to keep empty elements open
var useblockfill = true;
var alwaysblockfill = '<br data-wh-rte="bogus">'; // Always present blockfill
var blockfill = alwaysblockfill;
var ieblockfill = ''; // IE interchange blockfill, only present in getContentsHTML when useblockfill == false
var blockfillistext = false;
var quotedblockfill = blockfill;
var quotedloc01blockfill = '(*0*)(*1*)' + blockfill;

function getContentsHTMLRaw(win)
{
  return test.qS("div.wh-rtd-editor-bodynode").innerHTML;
}

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    }
  , { name: 'verifyclasses'
    , test: function(doc, win)
      {
        let rte = win.rte.getEditor();
        var bodynode = rte.getContentBodyNode();
        test.true(bodynode.className.indexOf('html-class') == -1);
        test.true(bodynode.className.indexOf('body-class') != -1);
        test.true(bodynode.parentNode.className.indexOf('html-class') != -1);
      }
    }
  , { name: 'verifybodymargin'
    , test: function(doc, win)
      {
        var body = win.rte.getEditor().getContentBodyNode();
        var html = body.parentNode;
        var h1 = body.getElementsByTagName('h1')[0];

        // The h1 has a top margin of 10 pixels
        test.eq('10px', getComputedStyle(h1).marginTop);

        // The body should be positioned at 0 (the h1 top margin shouldn't push the body down)
        var bodypos = dompack.getRelativeBounds(body,html);
        test.eq(-1, bodypos.top);

        // The h1 should be positioned at 10 pixels (its top margin)
        var h1pos = dompack.getRelativeBounds(h1,html);
        test.eq(10, h1pos.top);
      }
    }
  , { name: 'initialcursor'
    , test: function(doc, win)
      {
        // Initial cursor must be placed at start of document
        let rte = win.rte.getEditor();
        var range = rte.getSelectionRange();
        range.normalize(rte.getContentBodyNode());

        var testlocator = new domlevel.Locator(rte.getContentBodyNode());
        var testrange = new Range(testlocator, testlocator);
        testrange.normalize(rte.getContentBodyNode());

        test.eq(testrange, range);

        // Image button should be disabled, as 'img' is not permitted here
        var imgbutton = test.qSA('span.wh-rtd-button[data-button=img]')[0];
        test.true(imgbutton!=null, "No image button");
        test.true(imgbutton.classList.contains('disabled'), "Image button is not disabled");
      }
    }

  , { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured&fill=none'
    }

  , { name: 'emptytest'
    , test: function(doc, win)
      {
        //blockfill = win.$wh.Rich.Dom.usesBRAsBlockFill() ? '<br>' : '\u200b';
        //blockfillistext = blockfill.substr(0,1) != '<';
        //quotedblockfill = !blockfillistext ? blockfill : '"' + blockfill + '"';
        //quotedloc01blockfill = !blockfillistext ? '(*0*)(*1*)' + blockfill : '"(*0*)(*1*)' + blockfill + '"';

        test.eqHTML('<p class="normal">'+blockfill+'</p>', getContentsHTMLRaw(win), 'getContentsHTMLRaw returned unexpected value');
        test.eqHTML('<p class="normal">'+alwaysblockfill+'</p>', win.rte.getValue(), 'getContentsHTML returned unexpected value');
      }
    }

  , { name: 'interchange'
    , test: function(doc, win)
      {
        let rte=win.rte.getEditor();

        // In !usebrasblockblockfill mode, br is not present in raw html
        rte.setContentsHTML('<p class="normal"><br></p>');
        test.eqHTML('<p class="normal">'+blockfill+'</p>', getContentsHTMLRaw(win));
        test.eqHTML('<p class="normal">'+alwaysblockfill+'</p>', win.rte.getValue());

        rte.setContentsHTML('<p class="normal">a</p>');
        test.eqHTML('<p class="normal">a</p>', getContentsHTMLRaw(win));
        test.eqHTML('<p class="normal">a</p>', win.rte.getValue());

        // In !usebrasblockblockfill mode, br is not present in raw html
        rte.setContentsHTML('<ol><li><br><br></li></ol>');
        test.eqHTML('<ol class="ordered"><li><br>'+blockfill+'</li></ol>', getContentsHTMLRaw(win));
        test.eqHTML('<ol class="ordered"><li><br>'+alwaysblockfill+'</li></ol>', win.rte.getValue());

        // Fill needed for li (otherwise not editable in FF)
        rte.setContentsHTML('<ol><li></li></ol>');
        test.eqHTML('<ol class="ordered"><li>'+blockfill+'</li></ol>', getContentsHTMLRaw(win));
        test.eqHTML('<ol class="ordered"><li>'+alwaysblockfill+'</li></ol>', win.rte.getValue());

        //Test code element
        rte.setContentsHTML('<code class="language-harescript">&lt;wh Print("Hello, World\\n");</code>');
        test.eqHTML('<code class="language-harescript">&lt;wh Print("Hello, World\\n");</code>', win.rte.getValue());
      }
    }


  , { name: 'restructuring_1'
    , test: function(doc, win)
      {
        let rte=win.rte.getEditor();

        rtetest.setRawStructuredContent(win, '<p class=normal><b><u>"a(*0*)(*1*)"</u></b><i>"b"</i></p>');
        var range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class=normal><b><u>"a(*0*)(*1*)"</u></b><i>"b"</i></p>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }


  , { name: 'blocknodeinsert'
    , test: function(doc, win)
      {
        let rte=win.rte.getEditor();
        var style_ordered = rte.structure.getBlockStyleByTag('ORDERED');
        var style_normal = rte.structure.getBlockStyleByTag('NORMAL');

        let body, node_li, node_h1;

        // Insert list node
        // * (*here)
        rte.setContentsHTMLRaw('<ol class="ordered"><li></li></ol>');

        body = rte.getContentBodyNode();
        node_li = body.getElementsByTagName("LI")[0];

        rte.insertBlockNode(new domlevel.Locator(node_li), style_ordered, true);
        test.eqHTML('<ol class="ordered"><li><ol class="ordered"><li></li></ol></li></ol>', getContentsHTMLRaw(win));

        // Insert list node (raw setting, this html has different semantics in IE/vs the rest)
        // * (*here)
        rte.setContentsHTMLRaw('<ol class="ordered"><li><br></li></ol>');
        //console.log('li with br', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));
        body = rte.getContentBodyNode();
        node_li = body.getElementsByTagName("LI")[0];
        rte.insertBlockNode(new domlevel.Locator(node_li), style_ordered, true);
        if (useblockfill)
          test.eqHTML('<ol class="ordered"><li><ol class="ordered"><li></li></ol></li></ol>', getContentsHTMLRaw(win));
        else // br was visible in this case, and must be preserved
          test.eqHTML('<ol class="ordered"><li><ol class="ordered"><li></li></ol></li><li><br></li></ol>', getContentsHTMLRaw(win));

        // Insert list node
        // * a(*here)
        rte.setContentsHTML('<ol class="ordered"><li>a</li></ol>');
        body = rte.getContentBodyNode();
        node_li = body.getElementsByTagName("LI")[0];
        rte.insertBlockNode(new domlevel.Locator(node_li, 1), style_ordered, true);
        test.eqHTML('<ol class="ordered"><li>a<ol class="ordered"><li></li></ol></li></ol>', getContentsHTMLRaw(win));

        // Insert list node
        // * (*here)a
        rte.setContentsHTML('<ol class="ordered"><li>a</li></ol>');
        body = rte.getContentBodyNode();
        node_li = body.getElementsByTagName("LI")[0];
        rte.insertBlockNode(new domlevel.Locator(node_li), style_ordered, true);
        test.eqHTML('<ol class="ordered"><li><ol class="ordered"><li></li></ol></li><li>a</li></ol>', getContentsHTMLRaw(win));

        // Insert list node
        // * a(*here)a
        rte.setContentsHTML('<ol class="ordered"><li>aa</li></ol>');
        //console.log('empty ol', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));
        body = rte.getContentBodyNode();
        node_li = body.getElementsByTagName("LI")[0];
        rte.insertBlockNode(new domlevel.Locator(node_li.firstChild, 1), style_ordered, true);
        test.eqHTML('<ol class="ordered"><li>a<ol class="ordered"><li></li></ol></li><li>a</li></ol>', getContentsHTMLRaw(win));

        // Insert non-list into non-list (kinda illegal code, but must be handled gracefully)
        // H1 (*here)
        rte.setContentsHTMLRaw('<h1 class="heading1"></h1>');
//        console.log('empty h1', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));
        body = rte.getContentBodyNode();
        node_h1 = body.getElementsByTagName("H1")[0];
        rte.insertBlockNode(new domlevel.Locator(node_h1), style_normal);
        test.eqHTML('<h1 class="heading1"></h1><p class="normal"></p>', getContentsHTMLRaw(win));

        // Insert non-list into non-list
        // H1 (*here) <br>
        rte.setContentsHTML('<h1 class="heading1"><br></h1>');
        body = rte.getContentBodyNode();
        node_h1 = body.getElementsByTagName("H1")[0];
        rte.insertBlockNode(new domlevel.Locator(node_h1), style_normal);
        test.eqHTML('<h1 class="heading1">'+blockfill+'</h1><p class="normal"></p>', getContentsHTMLRaw(win));

        // Insert non-list into non-list
        // H1 (*here)a
        rte.setContentsHTML('<h1 class="heading1">a</h1>');
        body = rte.getContentBodyNode();
        node_h1 = body.getElementsByTagName("H1")[0];
        rte.insertBlockNode(new domlevel.Locator(node_h1), style_normal);
        test.eqHTML('<p class="normal"></p><h1 class="heading1">a</h1>', getContentsHTMLRaw(win));

        // Insert non-list into non-list
        // H1 a(*here)
        rte.setContentsHTML('<h1 class="heading1">a</h1>');
        body = rte.getContentBodyNode();
        node_h1 = body.getElementsByTagName("H1")[0];
        rte.insertBlockNode(new domlevel.Locator(node_h1, 1), style_normal);
        test.eqHTML('<h1 class="heading1">a</h1><p class="normal">'+ieblockfill+'</p>', win.rte.getValue());
      }
    }

  , { name: 'stitch'
    , test: function(doc, win)
      {
        let rte=win.rte.getEditor();
        let body, node_br, locator;


        // Stitch toward start
        rte.getContentBodyNode().innerHTML = '<p class="normal"><b><br></b><b><br></b></p>';
        body = rte.getContentBodyNode();
        node_br = body.getElementsByTagName("BR")[1];
        locator = new domlevel.Locator(node_br, 0);
        rte.combineAtLocator(rte.getContentBodyNode(), locator, false);
        test.eqHTML('<p class="normal"><b><br><br></b>'+ieblockfill+'</p>', win.rte.getValue());

        // Stitch toward start, multiple levels
        rte.getContentBodyNode().innerHTML = '<p class="normal"><b><i><br></i></b><b><i><br></i></b></p>';
        body = rte.getContentBodyNode();
        node_br = body.getElementsByTagName("BR")[1];
        locator = new domlevel.Locator(node_br, 0);
        rte.combineAtLocator(rte.getContentBodyNode(), locator, false);
        test.eqHTML('<p class="normal"><b><i><br><br></i></b>'+ieblockfill+'</p>', win.rte.getValue());

        // Stitch toward start, list
        rte.getContentBodyNode().innerHTML = '<ol class="ordered"><li><br></li></ol><ol class="ordered"><li><br></li></ol>';
        body = rte.getContentBodyNode();
        node_br = body.getElementsByTagName("BR")[1];
        locator = new domlevel.Locator(node_br, 0);
        rte.combineAtLocator(rte.getContentBodyNode(), locator, false);
        test.eqHTML('<ol class="ordered"><li><br>'+ieblockfill+'</li><li><br>'+ieblockfill+'</li></ol>', win.rte.getValue());

        // Stitch toward end
        rte.getContentBodyNode().innerHTML = '<p class="normal"><b><br></b><b><br></b></p>';
        body = rte.getContentBodyNode();
        node_br = body.getElementsByTagName("BR")[0];
        locator = new domlevel.Locator(node_br, 0);
        rte.combineAtLocator(rte.getContentBodyNode(), locator, true);
        test.eqHTML('<p class="normal"><b><br><br></b>'+ieblockfill+'</p>', win.rte.getValue());

        // Stitch toward end, multiple levels
        rte.getContentBodyNode().innerHTML = '<p class="normal"><b><i><br></i></b><b><i><br></i></b></p>';
        body = rte.getContentBodyNode();
        node_br = body.getElementsByTagName("BR")[0];
        locator = new domlevel.Locator(node_br, 0);
        rte.combineAtLocator(rte.getContentBodyNode(), locator, true);
        test.eqHTML('<p class="normal"><b><i><br><br></i></b>'+ieblockfill+'</p>', win.rte.getValue());

        // Stitch toward end, list
        rte.getContentBodyNode().innerHTML = '<ol class="ordered"><li><br></li></ol><ol class="ordered"><li><br></li></ol>';
        body = rte.getContentBodyNode();
        node_br = body.getElementsByTagName("BR")[0];
        locator = new domlevel.Locator(node_br, 0);
        rte.combineAtLocator(rte.getContentBodyNode(), locator, true);
        test.eqHTML('<ol class="ordered"><li><br>'+ieblockfill+'</li><li><br>'+ieblockfill+'</li></ol>', win.rte.getValue());

        // Stitch list both sides, with empty OL in the middle
        rte.getContentBodyNode().innerHTML = '<ol class="ordered"><li>1</li></ol><ol class="ordered"></ol><ol class="ordered"><li>2</li></ol>';
        body = rte.getContentBodyNode();
        var node_ol = body.getElementsByTagName("OL")[1]; // second OL node
        locator = new domlevel.Locator(node_ol, 0);

        locator = rte.combineAtLocator(rte.getContentBodyNode(), locator, false);
        locator = rte.combineAtLocator(rte.getContentBodyNode(), locator, true);

        test.eqHTML('<ol class="ordered"><li>1</li><li>2</li></ol>', win.rte.getValue());
        test.eq(1, body.getElementsByTagName("OL").length);
        test.eq(body.getElementsByTagName("OL")[0], locator.element);
        test.eq(1, locator.offset);

      }
    }


  , { name: 'structuring'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();

        rte.setContentsHTML('<h1 class="heading1">Kop</h1><p class="mystyle">in mijn <a href="http://b-lex.nl/" trash="true">stijl</a>.</p>');
        var body = rte.getContentBodyNode();

        //this is the style we applied to HEADING1, we're expecting the rte to have properly set the class
        var h1 = body.getElementsByTagName("H1")[0];
        if (test.getTestArgument(0) != 'dummy')
          test.eqIn(['rgb(221, 221, 221)','#dddddd'], rtetest.getCompStyle(h1, "color"));

        //select the heading1. request the current state
        rte.setCursor(h1,0);

        rtetest.testEqSelHTMLEx(win, '<h1 class="heading1">"(*0*)(*1*)Kop"</h1><p class="mystyle">"in mijn "<a href="http://b-lex.nl/">"stijl"</a>"."</p>');

        let selectstate = rte.getSelectionState();
        test.true(selectstate.blockstyle!==null);
        test.eq('HEADING1', selectstate.blockstyle.tag);
        test.true(selectstate.limited.textstyles.includes('u'));
        test.false(selectstate.limited.textstyles.includes('b'));
        test.false(selectstate.limited.textstyles.includes('a-href'));

        //select the first P. request the current state
        var p = body.getElementsByTagName("P")[0];
        rte.setCursor(p,2);
        if (test.getTestArgument(0) != 'dummy')
          test.eqIn(['rgb(255, 0, 0)','#ff0000'], rtetest.getCompStyle(p, "color"));

        //verify that the 'a' was properly copied into the P after whitelisting
        var p_a = p.getElementsByTagName("A")[0];
        test.true(p_a !== null);
        test.eq("http://b-lex.nl/", p_a.href);
        test.false(p_a.hasAttribute("trash"));
        test.eq('stijl', p_a.firstChild.nodeValue);

        selectstate = rte.getSelectionState();
        test.true(selectstate.blockstyle!==null);
        test.eq('MYSTYLE', selectstate.blockstyle.tag);
        rtetest.testEqSelHTMLEx(win, '<h1 class="heading1">"Kop"</h1><p class="mystyle">"in mijn "<a href="http://b-lex.nl/">"stijl"</a>"(*0*)(*1*)."</p>');

        //let's make it a Normal style
        let prestate = rtetest.getPreActionState(rte);
        test.true(rte.setSelectionBlockStyle("NORMAL"));
        test.true(selectstate.limited.textstyles.includes('a-href'));
        await rtetest.testUndoRedo(rte, prestate);

        //selection should now extend over the entire paragraph
        rtetest.testEqSelHTMLEx(win, '<h1 class="heading1">"Kop"</h1><p class="normal">"(*0*)in mijn "<a href="http://b-lex.nl/">"stijl"</a>".(*1*)"</p>');
//        test.eq('in mijn stijl.', rte.getSelectionText());

        rtetest.setStructuredContent(win, '<p class="normal"><b>"a"</b><i>"b"</i></p');
        var range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal"><b>"(*0*)(*1*)a"</b><i>"b"</i></p', rte.getContentBodyNode(), [ range.start, range.end ]);

        let withtable =
            '<p class="normal">"(*0*)a"</p>' +
            '<table class="table wh-rtd-table wh-rtd__table" style="width: 19px;"><colgroup class="wh-tableeditor-colgroup"><col style="width: 18px;"></colgroup>' +
              `<tbody><tr style="height: 18px;"><td class="wh-rtd__tablecell"><p class="normal">"1"</p></td></tr></tbody>` +
            '</table>' +
            '<p class="normal">"b(*1*)"</p>';
        rtetest.setStructuredContent(win, withtable);
        rte.selectNodeInner(rte.getContentBodyNode());
        prestate = rtetest.getPreActionState(rte);
        test.true(rte.setSelectionBlockStyle("heading1"));
        range = rte.getSelectionRange();
        await rtetest.testUndoRedo(rte, prestate);

        rtetest.testEqHTMLEx(win, withtable.replace(/\<p class="normal"/g, '<h1 class="heading1"').replace(/\<\/p/g, '</h1'), rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

  , { name: 'checkDomStructure'
    , test: function(doc,win)
      {
        let rte=win.rte.getEditor();

        rtetest.setRawStructuredContent(win,'"(*0*)a"');
        rte.checkDomStructure();
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"(*0*)(*1*)a"</p>');

        rtetest.setRawStructuredContent(win,'<p>"(*0*)a"</p>');
        rte.checkDomStructure();
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a(*0*)(*1*)"</p>');
      }
    }

  , { name: 'toggleliststyle'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let range, prestate;

        // Normal converts

/*        // No block to list (interesting case, but disabled because the expected behaviour hasn't been determined yet)
        rte.getContentBodyNode().innerHTML = '<i>a</i>';
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        rte._toggleBulletedList();
        testEqHTML('<ul class="unordered"><li><i>a</i></li></ul>', win.rte.getValue());
*/
        // Blockstyle to list
        rte.setContentsHTML('<p class="normal"><i>a</i></p>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        test.eqHTML('<ul class="unordered"><li><i>a</i></li></ul>', win.rte.getValue());

        // Other list type to list
        rte.setContentsHTML('<ol class="ordered"><li><i>a</i></li></ol>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        test.eqHTML('<ul class="unordered"><li><i>a</i></li></ul>', win.rte.getValue());

        // List type to default blockstyle
        rte.setContentsHTML('<ul class="unordered"><li><i>a</i></li></ul>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        test.eqHTML('<p class="normal"><i>a</i></p>', win.rte.getValue());

        // Blockstyle to list, within other lists
        rte.setContentsHTMLRaw('<ul class="unordered"><li>1</li></ul><p class="normal"><i>a</i></p><ul class="unordered"><li>2</li></ul>');
        rtetest.testEqHTMLEx(win, '<ul class="unordered"><li>"1"</li></ul><p class="normal"><i>"a"</i></p><ul class="unordered"><li>"2"</li></ul>', rte.getContentBodyNode(), []);

        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ul class="unordered"><li>"1"</li></ul><p class="normal"><i>"(*0*)(*1*)a"</i></p><ul class="unordered"><li>"2"</li></ul>', rte.getContentBodyNode(), [ range.start, range.end ]);
        //console.log('test pre setsel', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), rte.getSelectionRange()));

        rte.setContentsHTML('<ul class="unordered"><li>1</li></ul><p class="normal"><i>a</i></p><ul class="unordered"><li>2</li></ul>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ul class="unordered"><li>"1"</li></ul><p class="normal"><i>"(*0*)(*1*)a"</i></p><ul class="unordered"><li>"2"</li></ul>', rte.getContentBodyNode(), [ range.start, range.end ]);
        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        test.eqHTML('<ul class="unordered"><li>1</li><li><i>a</i></li><li>2</li></ul>', win.rte.getValue());

        // Other list to list, within other lists
        rte.setContentsHTML('<ul class="unordered"><li>1</li></ul><ol class="ordered"><li><i>a</i></li></ol><ul class="unordered"><li>2</li></ul>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);
        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        test.eqHTML('<ul class="unordered"><li>1</li><li><i>a</i></li><li>2</li></ul>', win.rte.getValue());

        // Unlist, within list
        rte.setContentsHTML('<ul class="unordered"><li>1</li><li><i>a</i></li><li>2</li></ul>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName("I")[0]);

        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        //test.eqHTML('<ul class="unordered"><li>1</li></ul><p class="normal"><i>a</i></p><p class="normal">2</p>', win.rte.getValue());
        rtetest.testEqSelHTMLEx(win, '<ul class="unordered"><li>"1"</li></ul><p class="normal"><i>"(*0*)a"</i></p><ul class="unordered"><li>(*1*)"2"</li></ul>');

        // List to other list style, then to blockstyle, then to list (with empty paragraph)
        rtetest.setStructuredContent(win, '<ul class="unordered"><li>"(*0*)1"</li><li><br data-wh-rte="bogus"></li><li>"2(*1*)"</li></ul>');

        prestate = rtetest.getPreActionState(rte);
        rte._toggleNumberedList();
        await rtetest.testUndoRedo(rte, prestate);
        rtetest.testEqSelHTMLEx(win, '<ol class="ordered"><li>"(*0*)1"</li><li><br data-wh-rte="bogus"></li><li>"2(*1*)"</li></ol>');
        prestate = rtetest.getPreActionState(rte);
        rte._toggleNumberedList();
        await rtetest.testUndoRedo(rte, prestate);
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"(*0*)1"</p><p class="normal"><br data-wh-rte="bogus"></p><p class="normal">"2(*1*)"</p>');
        prestate = rtetest.getPreActionState(rte);
        rte._toggleNumberedList();
        await rtetest.testUndoRedo(rte, prestate);
        rtetest.testEqSelHTMLEx(win, '<ol class="ordered"><li>"(*0*)1"</li><li><br data-wh-rte="bogus"></li><li>"2(*1*)"</li></ol>');

        // List to other list with disallowed <b> and <img> (remove <b> and <img>
        rtetest.setStructuredContent(win, '<ol class="ordered"><li><i><b>"(*0*)1(*1*)"</b></i><img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50"></li></ol>');
        prestate = rtetest.getPreActionState(rte);
        rte._toggleBulletedList();
        await rtetest.testUndoRedo(rte, prestate);
        rtetest.testEqSelHTMLEx(win, '<ul class="unordered"><li><i>"(*0*)1(*1*)"</i></li></ul>');
      }
    }

  , { name: 'initialstyle'
    , test: function(doc,win)
      {
        let rte=win.rte.getEditor();

        //make sure the style of the first paragraph is selected
        rte.setContentsHTML('<h2 class="heading2">Kop 2</h2>');
        let selectstate = rte.getSelectionState();
        test.eq('HEADING2', selectstate.blockstyle.tag);

        //make sure that passing empty content, creates and sets the default style
        rte.setContentsHTML('');

        var p = rte.getContentBodyNode().firstChild;
        test.eq("P", p.nodeName);
        test.eq("normal", p.className);
        selectstate = rte.getSelectionState();
        test.eq('NORMAL', selectstate.blockstyle.tag);
      }
    }

  , { name: 'addcr'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let body, prestate;

        rte.setContentsHTML('<h1 class="heading1">Kop</h1><p class="mystyle">in mijn stijl.</p>');
        body = rte.getContentBodyNode();
        var h1 = body.getElementsByTagName("H1")[0];
        rte.setCursor(h1.firstChild,3);

        prestate = rtetest.getPreActionState(rte);
        rte.executeHardEnter();
        await rtetest.testUndoRedo(rte, prestate);

        test.true(h1.nextSibling.hasAttribute("class"));
        test.eq("h2", h1.nextSibling.nodeName.toLowerCase());
        test.eq("heading2", h1.nextSibling.className);
        test.eq("p", h1.nextSibling.nextSibling.nodeName.toLowerCase());
        test.eq("mystyle", h1.nextSibling.nextSibling.className);
        test.eq(null, h1.nextSibling.nextSibling.nextSibling);

        rte.setContentsHTML('<p class="normal">123</p>');
        body = rte.getContentBodyNode();
        var p = body.getElementsByTagName("P")[0];
        //console.log('test pre setsel', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), Range.fromDOMRange(rte.GetSelectionObject().GetRange())));
        //console.log('fc', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), { fc: p.firstChild }));
        rte.selectRange(new Range(new domlevel.Locator(p.firstChild,1), new domlevel.Locator(p.firstChild,2)));
        //console.log('test post setsel', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), Range.fromDOMRange(rte.GetSelectionObject().GetRange())));

        rte.executeHardEnter();

        test.eqHTML('<p class="normal">1</p><p class="normal">3</p>', win.rte.getValue());

/*        //rtetest.setStructuredContent(win,'<p class="normal">"Stap 1)"</p><p class="normal"><br></p><p class="normal">"je testinfo.xml moet naar de juiste JS files wijzen:"(*0*)</p>');
        rte.setContentsHTML('<p class="normal">"Stap 1)"</p><p class="normal"><br></p><p class="normal">"je testinfo.xml moet naar de juiste JS files wijzen:"</p>');
        throw 1;
        rte.executeHardEnter();

        var range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)b(*1*)"<ol class="ordered"><li>"c"</li></ol></li><li>"d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);
        */
      }
    }

  , { name: 'softenter'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let locators, range, prestate;

        // Within paragraph
        rte.setContentsHTML('<p class="normal">ab</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[3].element, locators[3].offset);
        prestate = rtetest.getPreActionState(rte);
        rte.executeSoftEnter();
        await rtetest.testUndoRedo(rte, prestate);

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"a"<br>"(*0*)(*1*)b"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // At start of paragraph
        rte.setContentsHTML('<p class="normal">ab</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[2].element, locators[2].offset);
        prestate = rtetest.getPreActionState(rte);
        rte.executeSoftEnter();
        await rtetest.testUndoRedo(rte, prestate);

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal"><br>"(*0*)(*1*)ab"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // At end of paragraph
        rte.setContentsHTML('<p class="normal">ab</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[4].element, locators[4].offset);
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"ab"<br>'+quotedloc01blockfill+'</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Spanning paragraphs
        rte.setContentsHTML('<p class="normal">ab</p><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)<p class="normal">(*7*)"(*8*)c(*9*)d(*10*)"(*11*)</p>(*12*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[9]));
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());
        range = rte.getSelectionRange();
        if (blockfillistext)
          rtetest.testEqHTMLEx(win, '<p class="normal">"a"<br>"(*0*)(*1*)d"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Within LI
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[4].element, locators[4].offset);
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<br>"(*0*)(*1*)b"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Li spanning to within P
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[4], locators[11]));
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<br>"(*0*)(*1*)d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Start of li to middle of block
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[11]));
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li><br>"(*0*)(*1*)d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Start of li to end of block
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[12]));
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li><br>'+quotedloc01blockfill+'</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setRawStructuredContent(win, '<p class="normal">"a(*0*) "<br data-wh-rte="bogus"></p>');
        await rtetest.runWithUndo(rte, () => rte.executeSoftEnter());
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a"<br>"(*0*)(*1*)\u00a0"<br data-wh-rte="bogus"></p>');
      }
    }

  , { name: 'hardenter'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let locators, range;

        // in empty paragraph
        rte.setContentsHTML('<p class="normal"><br></p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        if (useblockfill)
          rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)<br data-wh-rte="bogus">(*2*)</p>(*3*)', rte.getContentBodyNode(), locators);
        else
          rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)</p>(*2*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[1].element, locators[1].offset);
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">'+quotedblockfill+'</p><p class="normal">'+quotedloc01blockfill+'</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Within paragraph
        rte.setContentsHTML('<p class="normal">ab</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[3].element, locators[3].offset);
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"a"</p><p class="normal">"(*0*)(*1*)b"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // At start of paragraph
        rte.setContentsHTML('<p class="normal">ab</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[2].element, locators[2].offset);
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">'+quotedblockfill+'</p><p class="normal">"(*0*)(*1*)ab"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Spanning paragraphs
        rte.setContentsHTML('<p class="normal">ab</p><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)<p class="normal">(*7*)"(*8*)c(*9*)d(*10*)"(*11*)</p>(*12*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[9]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"a"</p><p class="normal">"(*0*)(*1*)d"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Within LI
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)', rte.getContentBodyNode(), locators);

        rte.setCursor(locators[4].element, locators[4].offset);
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)(*1*)b"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Within LI containing a soft break
        rte.setContentsHTML('<ol class="ordered"><li>abcd<br>efgh</li></ol>');
        var li = rte.getContentBodyNode().querySelector('li');
        rte.setCursor(li.firstChild, 2);
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"ab"</li><li>"(*0*)(*1*)cd"<br>"efgh"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // End of li, spanning to within P
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[5], locators[11]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"ab"</li><li>"(*0*)(*1*)d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Li spanning to within P
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[4], locators[11]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)(*1*)d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Start of li to end of block
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[11]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>'+quotedblockfill+'</li><li>"(*0*)(*1*)d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Start of li to end of block
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[12]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">'+quotedloc01blockfill+'</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // Start of li to end of block
        rte.setContentsHTML('<ol class="ordered"><li>ab</li></ol><p class="normal">cd</p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</li>(*7*)</ol>(*8*)<p class="normal">(*9*)"(*10*)c(*11*)d(*12*)"(*13*)</p>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[3], locators[12]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">'+quotedloc01blockfill+'</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // End of block (with next block an image)
        rte.setContentsHTML('<p class="normal">ab</p><p class="normal"><img src="/tests/webhare.png" width="50" height="50"></p>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<p class="normal">(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</p>(*6*)<p class="normal">(*7*)<img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50">(*8*)</p>(*9*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[4], locators[4]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"ab"</p><p class="normal">'+quotedloc01blockfill+'</p><p class="normal"><img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50"></p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // End of filled nested li
        rte.setContentsHTML('<ol class="ordered"><li>a<ol class="ordered"><li>b</li></ol></li></ol>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)"(*5*)<ol class="ordered">(*6*)<li>(*7*)"(*8*)b(*9*)"(*10*)</li>(*11*)</ol>(*12*)</li>(*13*)</ol>(*14*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[9], locators[9]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"</li><li>'+quotedloc01blockfill+'</li></ol></li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // End of filled nested li  , with filled next li
        rte.setContentsHTML('<ol class="ordered"><li>a<ol class="ordered"><li>b</li><li>c</li></ol></li></ol>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)"(*5*)<ol class="ordered">(*6*)<li>(*7*)"(*8*)b(*9*)"(*10*)</li>(*11*)<li>(*12*)"(*13*)c(*14*)"(*15*)</li>(*16*)</ol>(*17*)</li>(*18*)</ol>(*19*)', rte.getContentBodyNode(), locators);

        rte.selectRange(new Range(locators[9], locators[9]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"</li><li>'+quotedloc01blockfill+'</li><li>"c"</li></ol></li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // End of empty nested li
        rte.setContentsHTML('<ol class="ordered"><li>a<ol class="ordered"><li><br></li></ol></li></ol>');
        locators = richdebug.getAllLocatorsInNode(rte.getContentBodyNode());
        if (useblockfill)
          rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)"(*5*)<ol class="ordered">(*6*)<li>(*7*)'+blockfill+'(*8*)</li>(*9*)</ol>(*10*)</li>(*11*)</ol>(*12*)', rte.getContentBodyNode(), locators);
        else
          rtetest.testEqHTMLEx(win, '(*0*)<ol class="ordered">(*1*)<li>(*2*)"(*3*)a(*4*)"(*5*)<ol class="ordered">(*6*)<li>(*7*)</li>(*8*)</ol>(*9*)</li>(*10*)</ol>(*11*)', rte.getContentBodyNode(), locators);

        // Enter inside empty (nested) li, must remove it
        rte.selectRange(new Range(locators[7], locators[7]));
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>'+quotedloc01blockfill+'</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        // End of document
        rte.setContentsHTML('<p class="normal">This is the end</p>');
        rte.setCursor(rte.getContentBodyNode().getElementsByTagName('p')[0].firstChild, 'This is the end'.length);
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"This is the end"</p><p class="normal">'+quotedloc01blockfill+'</p>', win.rte.getValue());
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"This is the end"</p><p class="normal">'+quotedblockfill+'</p><p class="normal">'+quotedloc01blockfill+'</p>', win.rte.getValue());

        rtetest.setRawStructuredContent(win, '<p class="normal">"a(*0*) "<br><p class="normal"><br></p>');
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a"</p><p class="normal">"(*0*)(*1*)\u00a0"<br></p><p class="normal"><br></p>');


        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a(*0*)"<br>"b"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.executeHardEnter());
        rtetest.testEqSelHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)(*1*)b"</li></ol>');

        // Toggle list style with sublist also changes sublist
        //FIXME write testcase
      }
    }

  , { name: 'addlistlevel'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let range;

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li>"(*0*)b"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"(*0*)(*1*)b"</li></ol></li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li>"b(*0*)"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b(*0*)(*1*)"</li></ol></li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li>(*0*)"b"</li><li>"c"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"(*0*)(*1*)b"</li></ol></li><li>"c"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"</li><li>"(*0*)c"</li></ol></li><li>"d"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"<ol class="ordered"><li>"(*0*)(*1*)c"</li></ol></li></ol></li><li>"d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li>"b"<ol class="ordered"><li>"(*0*)c"</li></ol></li><li>"d(*1*)"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"b"<ol class="ordered"><li>"(*0*)c"</li><li>"d(*1*)"</li></ol></li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li>"(*0*)b"</li><li>"c"</li><li>"d(*1*)"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"(*0*)b"</li><li>"c"</li><li>"d(*1*)"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win, '<ul class="unordered"><li>"a"</li><li>"(*0*)b"</li><li>"(*1*)c"</li></ul>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        rtetest.testEqSelHTMLEx(win, '<ul class="unordered"><li>"a"<ul class="unordered"><li>"(*0*)b"</li></ul></li><li>(*1*)"c"</li></ul>');

        rtetest.setStructuredContent(win, '<ul class="unordered"><li>"a"</li><li>"(*0*)b"</li><li>"c(*1*)"</li></ul>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        rtetest.testEqSelHTMLEx(win, '<ul class="unordered"><li>"a"<ul class="unordered"><li>"(*0*)b"</li><li>"c(*1*)"</li></ul></li></ul>');

        rtetest.setStructuredContent(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)b"</li><li>"(*1*)c"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte._toggleBulletedList());
        rtetest.testEqSelHTMLEx(win, '<ol class="ordered"><li>"a"</li></ol><ul class="unordered"><li>"(*0*)b"</li></ul><ol class="ordered"><li>(*1*)"c"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.addListLevel());
        rtetest.testEqSelHTMLEx(win, '<ol class="ordered"><li>"a"<ul class="unordered"><li>"(*0*)b"</li></ul></li><li>(*1*)"c"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        rtetest.testEqSelHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)b"</li><li>(*1*)"c"</li></ol>');
      }
    }

  , { name: 'removelistlevel'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let range;

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li><ol class="ordered"><li>"(*0*)b"</li></ol></li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)(*1*)b"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li><ol class="ordered"><li>"(*0*)b(*1*)"</li><li>"c"</li></ol></li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)b(*1*)"<ol class="ordered"><li>"c"</li></ol></li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li><ol class="ordered"><li>"(*0*)b(*1*)"</li><li>"c"</li></ol></li><li>"d"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"(*0*)b(*1*)"<ol class="ordered"><li>"c"</li></ol></li><li>"d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"<ol class="ordered"><li>"(*0*)c(*1*)"</li></ol></li></ol></li><li>"d"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"</li><li>"(*0*)c(*1*)"</li></ol></li><li>"d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"<ol class="ordered"><li>"(*0*)c"</li></ol></li></ol></li><li>"d(*1*)"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b"</li><li>"(*0*)c"</li></ol></li><li>"d(*1*)"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

  , { name: 'removelistlevel_ie8andlower'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let range;

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"<ol class="ordered"><li>"b(*0*)"<ol class="ordered"><li>"c"</li></ol></li></ol></li><li>"d"</li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"b(*0*)(*1*)"<ol class="ordered"><li>"c"</li></ol></li><li>"d"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        rtetest.setStructuredContent(win,  '<ol class="ordered"><li>"a"</li><li>"b(*0*)"<ol class="ordered"><li>"c(*1*)"</li></ol></li></ol>');
        await rtetest.runWithUndo(rte, () => rte.removeListLevel());
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<ol class="ordered"><li>"a"</li><li>"b"(*0*)</li><li>"c(*1*)"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

  , { name: 'pasting'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();

        let locators, topaste, range, imglocator;

        //test with actual conent from a worddoc..
        locators = rtetest.setStructuredContent(win,  '<h1 class="heading1">"Kop 1"</h1><p class="normal">"Tekst paragraaf."</p><p class="normal">"(*0*)after"</p>');
        var macwordpaste = dompack.create("div", { innerHTML: '<style> <!-- /* Font Definitions */ @font-face {font-family:Times; panose-1:2 0 5 0 0 0 0 0 0 0; mso-font-charset:0; /* Style Definitions */ p.MsoNormal, li.MsoNormal, div.MsoNormal {mso-style-unhide:no; mso-style-qformat:yes; mso-style-parent:""; margin:0pt; margin-bottom:.0001pt; mso-pagination:widow-orphan; font-size:12.0pt; font-family:Cambria; } --> </style> <p class="MsoNormal" style="mso-margin-top-alt:auto;mso-margin-bottom-alt:auto; mso-outline-level:2"><b><span style="font-size:18.0pt;font-family:Times; mso-fareast-font-family:&quot;Times New Roman&quot;;mso-bidi-font-family:&quot;Times New Roman&quot;">MSWord normal</span></b></p> <br>' });
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(macwordpaste, true), locators[0]));

        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<h1 class="heading1">"Kop 1"</h1><p class="normal">"Tekst paragraaf."</p><p class="normal"><b>"MSWord normal"</b></p><p class="normal">"(*0*)(*1*)after"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //test with empty p's, p's filled with only br and p's filled with zwsp
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<p>p1</p><p></p><p>p2</p><p><br></p><p>p3</p><p>&#8203;</p><p>p4</p>'});
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"testp1"</p><p class="normal">"p2"</p><p class="normal">'+blockfill+'</p><p class="normal">"p3"</p><p class="normal">'+blockfill+'</p><p class="normal">"p4(*0*)(*1*)"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //test with list with embedded p
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<ol><li><p>a</p></li></ol>'});
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"test"</p><ol class="ordered"><li>"a(*0*)(*1*)"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //multiple list items
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<ol><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li></ol>'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"test"</p><ol class="ordered"><li>"a"</li><li>"b"</li><li>"c"</li><li>"d"</li><li>"e(*0*)(*1*)"</li></ol>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //test li nodes at root
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<li>a</li><li>b<ol><li><p>c</p></li></ol></li><li>d</li>'});
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"test"</p><ul class="unordered"><li>"a"</li><li>"b"<ol class="ordered"><li>"c"</li></ol></li><li>"d(*0*)(*1*)"</li></ul>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //test li nodes at root
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<li>a</li>b<li>c</li>d<li>e</li>f'});
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"test"</p><ul class="unordered"><li>"a"</li></ul><p class="normal">"b"</p><ul class="unordered"><li>"c"</li></ul><p class="normal">"d"</p><ul class="unordered"><li>"e"</li></ul><p class="normal">"f(*0*)(*1*)"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //test li nodes at root, bug concatenated content
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<ol><li>a</li><li>b</li></ol><li>c</li>'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<p class="normal">"test"</p><ol class="ordered"><li>"a"</li><li>"b"</li></ol><ul class="unordered"><li>"c(*0*)(*1*)"</li></ul>', rte.getContentBodyNode(), [ range.start, range.end ]);

        //Test unwrapped content (inline paste)
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: 'a'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"testa(*0*)(*1*)"</p>');

        //Test importsfrom
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test"</p><p class="normal">"(*0*)"<br data-wh-rte="bogus"></p>');
        topaste = dompack.create("div", { innerHTML: '<h2 class="tab">You were a tab</h2>'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"test"</p><p class="contenttab">"You were a tab(*0*)(*1*)"</p><p class="normal">""<br data-wh-rte="bogus"></p>');

        //Test import by class
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test"</p><p class="normal">"(*0*)"<br data-wh-rte="bogus"></p>');
        topaste = dompack.create("div", { innerHTML: '<h2 class="heading1">You were a tab</h2>'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"test"</p><h1 class="heading1">"You were a tab(*0*)(*1*)"</h1><p class="normal">""<br data-wh-rte="bogus"></p>');

        //Test import by tagname
        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test"</p><p class="normal">"(*0*)"<br data-wh-rte="bogus"></p>');
        topaste = dompack.create("div", { innerHTML: '<h2>You were a tab</h2>'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"test"</p><h2 class="heading2">"You were a tab(*0*)(*1*)"</h2><p class="normal">""<br data-wh-rte="bogus"></p>');

        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)ing"</p>');
        topaste = dompack.create("div", { innerHTML: '<br><br> '}); // Need space after last <br>, or it will be ignored
        //console.log(topaste, topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"test"</p><p class="normal">' + blockfill + '</p><p class="normal">"(*0*)(*1*)ing"</p>');

        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<br><br> '}); // Need space after last <br>, or it will be ignored
        //console.log(topaste, topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"test"</p><p class="normal">(*0*)(*1*)'+blockfill+'</p>');

        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50" align="left">'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        imglocator = domlevel.Locator.newPointingTo(rte.getContentBodyNode().querySelector('img'));

        //the selector should be behind the image
        test.eq(-1, imglocator.compare(range.start));
        test.true(range.isCollapsed());

        locators = rtetest.setStructuredContent(win,  '<p class="normal">"test(*0*)"</p>');
        topaste = dompack.create("div", { innerHTML: '<img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50" class="pietje wh-rtd__img--floatleft">'});
        //console.log(topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        range = rte.getSelectionRange();
        imglocator = domlevel.Locator.newPointingTo(rte.getContentBodyNode().querySelector('img'));

        //the selector should be behind the image
        test.eq(-1, imglocator.compare(range.start));
        test.true(range.isCollapsed());

        // Paste into lists
        locators = rtetest.setStructuredContent(win,  '<ul class="unordered"><li><i>"a(*0*)(*1*)"</i></li></ul>');
        topaste = dompack.create("div", { innerHTML: 'woord<br>woord2'}); // Need space after last <br>, or it will be ignored
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<ul class="unordered"><li><i>"a"</i>"woord"</li><li>"woord2(*0*)(*1*)"</li></ul>');

        locators = rtetest.setStructuredContent(win,  '<ul class="unordered"><li><i>"(*0*)(*1*)a"</i></li></ul>');
        topaste = dompack.create("div", { innerHTML: 'woord<br>woord2'}); // Need space after last <br>, or it will be ignored
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"woord"</p><p class="normal">"woord2(*0*)(*1*)"</p><ul class="unordered"><li><i>"a"</i></li></ul>');

        // Paste inline formatted data
        locators = rtetest.setStructuredContent(win, '<p class="normal">"test(*0*)ing"</p>');
        topaste = dompack.create("div", { innerHTML: '<span>a</span><b>b</b><span>c</span>' });
        //console.log(topaste, topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"testa"<b>"b"</b>"c(*0*)(*1*)ing"</p>');

        // Paste root textstyle with 'display: block'
        locators = rtetest.setStructuredContent(win, '<p class="normal">"test(*0*)ing"</p>');
        topaste = dompack.create("div", { innerHTML: 'a<br><i style="display: block">b</i>' });
        //console.log(topaste, topaste.innerHTML);
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"testa"</p><p class="normal"><i>"b(*0*)(*1*)"</i></p><p class="normal">"ing"</p>');

        // Paste forbidden inline styles
        locators = rtetest.setStructuredContent(win, '<h1 class="heading1">"test(*0*)ing"</h1>');
        topaste = dompack.create("div", { innerHTML: '<ul><li><b>b</b></li></ul><h1 class="heading1"><img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50"></h1><ul><li>c</li></ul>' });
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        let imgsrc = dompack.qS(rte.getContentBodyNode(), "img").getAttribute("src", 2);
        rtetest.testEqSelHTMLEx(win, `<h1 class="heading1">"test"</h1><ul class="unordered"><li>"b"</li></ul><p class="normal"><img class="wh-rtd__img" height="50" src="${imgsrc}" width="50"></p><ul class="unordered"><li>"c"</li></ul><h1 class="heading1">"(*0*)(*1*)ing"</h1>`);

        // Paste forbidden inline styles
        locators = rtetest.setStructuredContent(win, '<h1 class="heading1">"test(*0*)ing"</h1>');
        topaste = dompack.create("div", { innerHTML: '<b>b</b><img class="wh-rtd__img" height="50" src="/tests/webhare.png" width="50">' });
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        imgsrc = dompack.qS(rte.getContentBodyNode(), "img").getAttribute("src", 2);
        rtetest.testEqSelHTMLEx(win, `<h1 class="heading1">"testb"</h1><p class="normal"><img class="wh-rtd__img" height="50" src="${imgsrc}" width="50">(*0*)(*1*)</p><h1 class="heading1">"ing"</h1>`);

        // Paste breaking content found on our gitlab wiki
        locators = rtetest.setStructuredContent(win, '<h1 class="heading1">"test(*0*)ing"</h1>');
        topaste = dompack.create("div", { innerHTML: '<meta charset="utf-8"><div class="wiki-page-header has-sidebar-toggle" style="box-sizing: border-box; border-bottom: 1px solid rgb(229, 229, 229); position: relative; padding-right: 0px; color: rgb(46, 46, 46); font-family: -apple-system, system-ui, &quot;Segoe UI&quot;, Roboto, Oxygen-Sans, Ubuntu, Cantarell, &quot;Helvetica Neue&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;; font-size: 14px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-style: initial; text-decoration-color: initial;"><div class="nav-text" style="box-sizing: border-box; padding-top: 16px; padding-bottom: 11px; display: inline-block; line-height: 28px; white-space: normal;"><h2 class="wiki-page-title" style="box-sizing: border-box; font-family: inherit; font-weight: 600; line-height: 1.1; color: rgb(46, 46, 46); margin: 0px; font-size: 22px;">Share image and favicons</h2><span class="wiki-last-edit-by" style="box-sizing: border-box; display: block; color: rgb(112, 112, 112);">Last edited by<span>&nbsp;</span><strong style="box-sizing: border-box; font-weight: bold; color: rgb(46, 46, 46);">Mark de Jong</strong><span>&nbsp;</span><time class="js-timeago js-timeago-render" title="" datetime="2017-05-16T14:18:29Z" data-toggle="tooltip" data-placement="top" data-container="body" data-original-title="May 16, 2017 4:18pm" data-tid="3" style="box-sizing: border-box;">10 months ago</time></span></div><div class="nav-controls" style="box-sizing: border-box; display: inline-block; float: right; text-align: right; padding: 11px 0px; margin-bottom: 0px; width: auto; min-width: 50%;"><a class="add-new-wiki btn btn-new" data-toggle="modal" href="https://gitlab.webhare.com/webhare_com/home/wikis/share-image-and-favicons#modal-new-wiki" style="box-sizing: border-box; background-color: rgb(26, 170, 85); color: rgb(255, 255, 255); text-decoration: none; transition: background-color 100ms linear, border-color 100ms linear, color 100ms linear, box-shadow 100ms linear; display: inline-block; margin-bottom: 0px; font-weight: 400; text-align: center; vertical-align: top; touch-action: manipulation; cursor: pointer; background-image: none; border: 1px solid rgb(22, 143, 72); white-space: nowrap; padding: 6px 10px; font-size: 14px; line-height: 1.42857; border-radius: 3px; user-select: none; margin-right: 10px;">New page</a><a class="btn" href="https://gitlab.webhare.com/webhare_com/home/wikis/share-image-and-favicons/history" style="box-sizing: border-box; background-color: rgb(255, 255, 255); color: rgb(46, 46, 46); text-decoration: none; transition: background-color 100ms linear, border-color 100ms linear, color 100ms linear, box-shadow 100ms linear; display: inline-block; margin-bottom: 0px; font-weight: 400; text-align: center; vertical-align: top; touch-action: manipulation; cursor: pointer; background-image: none; border: 1px solid rgb(229, 229, 229); white-space: nowrap; padding: 6px 10px; font-size: 14px; line-height: 1.42857; border-radius: 3px; user-select: none; margin-right: 10px;">Page history</a><a class="btn js-wiki-edit" href="https://gitlab.webhare.com/webhare_com/home/wikis/share-image-and-favicons/edit" style="box-sizing: border-box; background-color: rgb(255, 255, 255); color: rgb(46, 46, 46); text-decoration: none; transition: background-color 100ms linear, border-color 100ms linear, color 100ms linear, box-shadow 100ms linear; display: inline-block; margin-bottom: 0px; font-weight: 400; text-align: center; vertical-align: top; touch-action: manipulation; cursor: pointer; background-image: none; border: 1px solid rgb(229, 229, 229); white-space: nowrap; padding: 6px 10px; font-size: 14px; line-height: 1.42857; border-radius: 3px; user-select: none; margin-right: 0px; float: right;">Edit</a></div></div><div class="wiki-holder prepend-top-default append-bottom-default" style="box-sizing: border-box; margin-top: 16px !important; margin-bottom: 16px; color: rgb(46, 46, 46); font-family: -apple-system, system-ui, &quot;Segoe UI&quot;, Roboto, Oxygen-Sans, Ubuntu, Cantarell, &quot;Helvetica Neue&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;; font-size: 14px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-style: initial; text-decoration-color: initial;"><div class="wiki" style="box-sizing: border-box; color: rgb(46, 46, 46); word-wrap: break-word;"><h1 dir="auto" style="box-sizing: border-box; font-size: 1.75em; margin: 0px 0px 16px; font-family: inherit; font-weight: 600; line-height: 1.1; color: rgb(46, 46, 46); padding-bottom: 0.3em; border-bottom: 1px solid rgb(234, 234, 234); position: relative; text-align: initial;"><br class="Apple-interchange-newline"></h1></div></div>' });
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));

        rtetest.testEqSelHTMLEx(win, `<h1 class="heading1">"test"</h1><h2 class="heading2" >"Share image and favicons"</h2><p class="normal">"Last edited by""&nbsp;"<b>"Mark de Jong"</b>"&nbsp;"</p><p class="normal">"10 months ago"</p><p class="normal"><a href="https://gitlab.webhare.com/webhare_com/home/wikis/share-image-and-favicons#modal-new-wiki">"New page"</a><a href="https://gitlab.webhare.com/webhare_com/home/wikis/share-image-and-favicons/history">"Page history"</a><a href="https://gitlab.webhare.com/webhare_com/home/wikis/share-image-and-favicons/edit">"Edit"</a></p><h1 class="heading1"><br data-wh-rte="bogus"></h1><h1 class="heading1">"(*0*)(*1*)ing"</h1>`);

        // Paste like google docs, <b style="font-weight:normal">just because we can</b>
        locators = rtetest.setStructuredContent(win, '<p class="normal">"test(*0*)ing"</p>');
        topaste = dompack.create("div", { innerHTML: '<b style="font-weight:normal">just because we can</b>' });
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(topaste, true), locators[0]));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"testjust because we can(*0*)(*1*)ing"</p>');

      }
    }

  , { name: 'pasting_inline'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();

        var locators = rtetest.setStructuredContent(win,  '<h1 class="heading1">"Kop 1"</h1><p class="normal">"Tekst paragraaf.(*0*)"</p>');

        //FIXME: Ik paste inline, ik zou verwachten dat er geen nieuwe regel gevormd wordt
        await rtetest.runWithUndo(rte, () => rte._pasteContentAt(doc.importNode(dompack.create("span",{textContent:"ik ben een testje"}), true), locators[0]));

        var range = rte.getSelectionRange();
        rtetest.testEqHTMLEx(win, '<h1 class="heading1">"Kop 1"</h1><p class="normal">"Tekst paragraaf.ik ben een testje(*0*)(*1*)"</p>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }

  , { name: 'deleteandbackspace'
    , test: async function(doc, win)
      {
        let rte=win.rte.getEditor();

        // Forward delete
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)b"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(true));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a(*0*)(*1*)"</p>');

        // Multiple space stitching
        rtetest.setStructuredContent(win, '<p class="normal">"a (*0*)b c"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(true));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a (*0*)(*1*)\u00A0c"</p>');

        rtetest.setStructuredContent(win, '<p class="normal">"a (*0*)b c(*1*) d"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(true));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a (*0*)(*1*)\u00A0d"</p>');

        // Backward delete
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)b"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(false));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"(*0*)(*1*)b"</p>');

        // Backward delete
        rtetest.setStructuredContent(win, '<p class="normal">"a a a(*0*)"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(false));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a a\u00A0(*0*)(*1*)"</p>');

        // Multiple space stitching
        rtetest.setStructuredContent(win, '<p class="normal">"a (*0*)b c"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(true));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a (*0*)(*1*)\u00A0c"</p>');

        rtetest.setStructuredContent(win, '<p class="normal">"a (*0*)b c(*1*) d"</p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(false));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a (*0*)(*1*)\u00A0d"</p>');

        rtetest.setStructuredContent(win, '<p class="normal">"a (*0*)b(*1*) "<i>"b"</i></p>');
        await rtetest.runWithUndo(rte, () => rte._executeDeleteByKey(false));
        rtetest.testEqSelHTMLEx(win, '<p class="normal">"a (*0*)(*1*)\u00A0"<i>"b"</i></p>');
      }
    }

  , { name: 'focus_after_stylechange'
    , test: async function(doc,win)
      {
        // Get the select element
        let select = doc.querySelector(".wh-rtd__toolbarstyle");

        // Wait a little to let pending focus stuff handle
        await test.sleep(5);

        // focus it, await to let focus take hold
        select.focus();
        await test.sleep(1);
        test.eq(select, doc.activeElement, "Style select should have focus");

        // Select new style, wattch focus going back to rte
        test.fill(select, "MYSTYLE");
        await test.sleep(1);
        test.false(doc.activeElement === select, "Focus should have gone back to rte");
      }
    }

  , { name: 'blockstyle change'
    , test: async function(doc,win)
      {
        // Get the select element
        let select = doc.querySelector(".wh-rtd__toolbarstyle");
        rtetest.setStructuredContent(win,
            `<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1"></div>`+
            `<p class="normal">"(*0*)Testline(*1*)"</p>`+
            `<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst2"></div>`+
            `<h2 class="heading2">"Quote"</h2>`);

        test.fill(select, "ORDERED");

        rtetest.testEqSelHTMLEx(win,
            `<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1"></div>`+
            `(*0*)<ol class="ordered"><li>"Testline"</li></ol>(*1*)`+
            `<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst2"></div>`+
            `<h2 class="heading2">"Quote"</h2>`);

        test.fill(select, "NORMAL");

        rtetest.testEqSelHTMLEx(win,
            `<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1"></div>`+
            `(*0*)<p class="normal">"Testline"</p>(*1*)`+
            `<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst2"></div>`+
            `<h2 class="heading2">"Quote"</h2>`);
      }
    }

  ]);
