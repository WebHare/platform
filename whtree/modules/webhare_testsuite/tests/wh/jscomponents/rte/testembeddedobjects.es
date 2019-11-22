import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
import * as dompack from 'dompack';

// use structuredwin when htmltext is structured
function generateInlineEmbeddedObjectHTML(instanceref, title, htmltext)
{
  return <span class="wh-rtd-embeddedobject wh-rtd-embeddedobject--inline" data-instanceref={instanceref} />.outerHTML;
}
function generateEmbeddedObjectHTML(instanceref, title, htmltext)
{
  return <div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref={instanceref} />.outerHTML;
}

function getInlineElementPreview(innernode) //mimick widgtpreview.witty
{
  return <div class="wh-rtd__inlinepreview">
           <div class="wh-rtd__inlinepreview__iconholder">
             <img class="wh-rtd__inlinepreview__icon" width="16" height="16" data-toddimg="tollium:files/widget|16|16|b,c" />
           </div>
           <div class="wh-rtd__inlinepreview__title">
             {innernode}
           </div>
         </div>.outerHTML;
}

var escapeEl;
function escapeHTML(html)
{
  escapeEl = escapeEl || document.createElement('textarea');
  escapeEl.textContent = html;
  return escapeEl.innerHTML;
}

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured&fill=none'
    }

  , { name: 'clean-embeddedobject'
    , test: function(doc, win)
      {
        var rte=test.getWin().rte.getEditor();

        //processing embedded object
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1" data-innerhtml-contents="c&lt;b&gt;d&lt;/b&gt;"></div>'
                           +'<p class="normal">ondertekst</p>');

        test.eqHTML('<h1 class="heading1">Kop</h1>'
                  +generateEmbeddedObjectHTML('inst1', 'title', 'c<b>d</b>')
                  +'<p class="normal">ondertekst</p>'
                  , test.getWin().rte.getValue());

        //processing inline embedded object
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<p class="normal">Paragraph with inline <span class="wh-rtd-embeddedobject wh-rtd-embeddedobject--inline" data-instanceref="inline1" data-innerhtml-contents="c&lt;b&gt;d&lt;/b&gt;"></span> object</p>');

        test.eqHTML('<h1 class="heading1">Kop</h1>'
                  + '<p class="normal">Paragraph with inline ' + generateInlineEmbeddedObjectHTML('inline1', 'title', 'c<b>d</b>') + ' object</p>'
                  ,  test.getWin().rte.getValue());

        //div inside <h1> should be moved out
        rte.setContentsHTML('<h1 class="heading1">Kop'
                           +'<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1" data-innerhtml-contents="c&lt;b&gt;d&lt;/b&gt;"></div>'
                           +'</h1>');
        test.eqHTML('<h1 class="heading1">Kop</h1>'
                  +generateEmbeddedObjectHTML('inst1', 'title', 'c<b>d</b>')
                  , test.getWin().rte.getValue());

        //embedded content should be ignored (ADDME previously it was preserved in blockcomponents. Something to restore? (rob says: I think not))
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1" data-innerhtml-contents="c&lt;b&gt;d&lt;/b&gt;">vroem</div>'
                           );
        test.eqHTML('<h1 class="heading1">Kop</h1>'
                  +generateEmbeddedObjectHTML('inst1', 'title', 'c<b>d</b>')
//                  +'<div class="-wh-rtd-embeddedobject" contenteditable="false" data-instanceref="inst1" data-innerhtml-contents="c&lt;b&gt;d&lt;/b&gt;" tabindex="-1">c<b>d</b></div>'
                  , test.getWin().rte.getValue());

        //div without a class should be ignored
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<div data-instanceref="inst1"></div>');
        test.eqHTML('<h1 class="heading1">Kop</h1>', test.getWin().rte.getValue());

        //missing the optional members should be fine
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1"></div>');
        test.eqHTML('<h1 class="heading1">Kop</h1>'
                  +generateEmbeddedObjectHTML('inst1', '', '')
//                  +'<div class="-wh-rtd-embeddedobject" contenteditable="false" data-instanceref="inst1" tabindex="-1"></div>'
                  , test.getWin().rte.getValue());

        //obsolete block component should be removed
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<div class="wh-rtd-blockcomponent" data-blockns="urn:blockns" data-blocktype="blockie" data-extra="UrData" style="width:222px;height:111px" data-innerhtml-contents="<b>bold!</b>" src="about:blank"></div>');
        test.eqHTML('<h1 class="heading1">Kop</h1>', test.getWin().rte.getValue());

        //found in practice, got wrapped in a <p> incorrectly
        console.error("--SetContentsHTML");
        test.getWin().rte.setValue('<html><body><div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="x8ywN3uVVV7vLJ64BkQCRQ" data-innerhtml-contents="&#60;div style=&#34;height:110px&#34;&#62;&#60;img class=&#34;wh-rtd-color-on-hover&#34; src=&#34;/.system/dl/ic~AQJzxwQAE6MtAzA5CwA-MYcDBwHBeABaAIA6SOg&#34; style=&#34;position:absolute;left:10px;top:10px;border-radius:5px;&#34; width=&#34;120&#34; height=&#34;90&#34; /&#62;&#60;div style=&#34;position:absolute;left:140px;right:60px;top:10px;bottom:10px;overflow:hidden&#34;&#62;&#60;div style=&#34;font-weight:bold;font-size:120%&#34;&#62;&#38;#20027;&#38;#20154;&#38;#29992;&#38;#36965;&#38;#25511;&#38;#36710;&#38;#25226;&#38;#19968;&#38;#32676;&#38;#23567;&#38;#29454;&#38;#29356;&#38;#29609;&#38;#22351;&#38;#20102;&#38;#65292;&#38;#30475;&#38;#30528;&#38;#25105;&#38;#37117;&#38;#24819;&#38;#26469;&#38;#19968;&#38;#20010;&#60;/div&#62;&#60;div style=&#34;margin-bottom:5px&#34;&#62;03-08-2014 1:13&#60;/div&#62;@&#38;#22269;&#38;#22806;&#38;#31934;&#38;#24425;&#38;#35270;&#38;#39057;&#38;#12298;&#38;#27704;&#38;#21033;(&#38;#28145;&#38;#22323;)&#38;#29305;&#38;#31181;&#38;#21360;&#38;#21047;&#38;#26377;&#38;#38480;&#38;#20844;&#38;#21496;&#38;#12299;&#38;#25105;&#38;#20204;&#38;#19981;&#38;#29983;&#38;#20135;&#38;#35270;&#38;#39057;&#38;#65292;&#38;#25105;&#38;#20204;&#38;#21482;&#38;#26159;&#38;#22269;&#38;#22806;youtube&#38;#23448;&#38;#32593;&#38;#35270;&#38;#39057;&#38;#30340;&#38;#25644;&#38;#36816;&#38;#24037;&#38;#65292;&#38;#27599;&#38;#22825;&#38;#20026;&#38;#20320;&#38;#26356;&#38;#26032;&#38;#22269;&#38;#22806;&#38;#31934;&#38;#24425;&#38;#35270;&#38;#39057;&#38;#35805;&#38;#39064;&#38;#12290;&#38;#33391;&#38;#24515;&#38;#20986;&#38;#21697;&#38;#12290;&#38;#27426;&#38;#36814;&#38;#35746;&#38;#38405;&#38;#26412;&#38;#20154;&#38;#20248;&#38;#37239;&#38;#31354;&#38;#38388;&#38;#65281;@&#38;#22269;&#38;#22806;&#38;#31934;&#38;#24425;&#38;#35270;&#38;#39057;&#38;#27714;&#38;#21508;&#38;#20301;&#38;#32769;&#38;#22823;&#38;#28857;&#38;#20010;&#38;#36190;&#38;#65281;&#38;#35874;&#38;#35874;&#60;/div&#62;&#60;img src=&#34;/tollium_todd.res/socialite/img/youku.png&#34; alt=&#34;&#34; class=&#34;wh-rtd-color-on-hover&#34; style=&#34;position:absolute; bottom:5px; right:5px&#34; /&#62;&#60;/div&#62;"></div></body></html>');

        var body = rte.getContentBodyNode();
        test.eq(1, body.childNodes.length);
        test.eqHTML('<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="x8ywN3uVVV7vLJ64BkQCRQ"></div>', test.getWin().rte.getValue());
      }
    }

    // Now test creating one from scratch
  , { name: 'create-embeddedobject'
    , test: async function(doc, win)
      {
        var rte=test.getWin().rte.getEditor();
        rtetest.setRawStructuredContent(win, '<p class=normal>"Dit is een paragraaf tekst waar (*0*)HIER(*1*) een object ingevoegd gaat worden"</p>');
        rtetest.testEqSelHTMLEx(win, '<p class=normal>"Dit is een paragraaf tekst waar (*0*)HIER(*1*) een object ingevoegd gaat worden"</p>');
        test.false(rte.getSelectionState().properties);

        await rtetest.runWithUndo(rte, () => rte.insertEmbeddedObject( { instanceid: 'inst', htmltext: 'De <b>inhoud</b>', title: 'title' } ));

        var body = rte.getContentBodyNode();
        test.eq(3, body.childNodes.length);
        test.eqHTML('<p class=normal>Dit is een paragraaf tekst waar </p>',body.childNodes[0].outerHTML);
        test.eqHTML('<p class="normal"> een object ingevoegd gaat worden</p>',body.childNodes[2].outerHTML);

        test.true(rte.getSelectionState().properties);
      }
    }

  , { name: 'embeddedobject-contentsignore'
    , test: function(doc, win)
      {
        var rte=test.getWin().rte.getEditor();

        var href_contents = escapeHTML(
            "x<a href='example.com'>link</a>y" +
            "<ul><li>1</li><li>2<ul><li>2.1</li></ul></li></ul>");

        //processing embedded object
        rte.setContentsHTML('<h1 class="heading1">Kop</h1>'
                           +'<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceid="inst1" data-innerhtml-contents="'+href_contents+'"></div>'
                           +'<p class="normal">ondertekst</p>');

        rte.selectNodeOuter(rte.getContentBodyNode().getElementsByTagName('div')[0]);

        // Selection should not pick up the <a> in the embedded object
        test.eq(1, rte.getSelectionState().actionelements.length);
      }
    }

    // Now test creating one from scratch
  , { name: 'create-inlineobject'
    , test: async function(doc, win)
      {
        var rte=test.getWin().rte.getEditor();
        rtetest.setRawStructuredContent(win, '<p class=normal>"Dit is een paragraaf tekst waar (*0*)HIER(*1*) een object ingevoegd gaat worden"</p>');
        rtetest.testEqSelHTMLEx(win, '<p class=normal>"Dit is een paragraaf tekst waar (*0*)HIER(*1*) een object ingevoegd gaat worden"</p>');
        test.false(rte.getSelectionState().properties);

        await rtetest.runWithUndo(rte, () => rte.insertEmbeddedObject( { instanceid: 'inst', htmltext: 'De <b>inhoud</b>', title: 'title', embedtype: 'inline' } ));

        var body = rte.getContentBodyNode();
        test.eq(1, body.childNodes.length);
        test.eq(3, body.childNodes[0].childNodes.length);
        test.eq('Dit is een paragraaf tekst waar ',body.childNodes[0].childNodes[0].textContent);
        test.eq(' een object ingevoegd gaat worden',body.childNodes[0].childNodes[2].textContent);

        test.true(rte.getSelectionState().properties);

        rtetest.setRawStructuredContent(win, '<p class=normal>"Dit is een paragraaf tekst waar (*0*)(*1*) HIER een object ingevoegd gaat worden"</p>');
        await rtetest.runWithUndo(rte, () => rte.insertEmbeddedObject( { instanceid: 'inst', htmltext: getInlineElementPreview(<span>De <b>inhoud</b></span>), title: 'title', embedtype: 'inline' } ));

        test.eq(3, body.childNodes[0].childNodes.length);
        test.eq('Dit is een paragraaf tekst waar ',body.childNodes[0].childNodes[0].textContent);
        test.eq(' HIER een object ingevoegd gaat worden',body.childNodes[0].childNodes[2].textContent);
      }
    }

  , "Should not be able to delete inline objects"
  , async function()
    {
      var rte=test.getWin().rte.getEditor();
      var body = rte.getContentBodyNode();

      //position cursor one cursor before before the inline obj. Deleting here caused the inline object to be ripped apart
      rtetest.setRTESelection(null, rte, { startContainer: body.childNodes[0].firstChild, startOffset: 'Dit is een paragraaf tekst waar '.length-1 });
      await test.pressKey("Delete");
      test.eq('"Dit is een paragraaf tekst waar(*0*)(*1*)"', rtetest.getHTML(body.childNodes[0].childNodes[0]));
      test.true(body.childNodes[0].childNodes[1].matches(".wh-rtd-embeddedobject--inline")); //should not be killed
      test.eq('" HIER een object ingevoegd gaat worden"', rtetest.getHTML(body.childNodes[0].childNodes[2]));
    }

  , "Chrome initial cursor position between embedded blocks"
  , async function()
    {
      // chrome (72) gave back a cursor at the beginning of the document, even if it visually was between the embedded blocks in the document 'embedded, emptypara, embedded'
      // Pressing delete then deleted the first embedded object, which shouldn't happen

      await test.loadPage('/.webhare_testsuite/tests/pages/rte/?editor=structured&fill=twoembeds');
      test.click(".wh-rtd__html", { x: 0, y: 0 });
      await test.pressKey("Delete");
      console.log(test.qSA(".wh-rtd-embeddedobject"));
      test.eq(2, test.qSA(".wh-rtd-embeddedobject").length);
    }

  , "Expansion of previews when strated in disabled mode"
  , async function()
    {
      await test.loadPage('/.webhare_testsuite/tests/pages/rte/?editor=structured&fill=none&disabled=true');

      //processing embedded object
      test.getWin().rte.setValue('<h1 class="heading1">Kop</h1>'
                                 +'<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--block" data-instanceref="inst1" data-innerhtml-contents="c&lt;b&gt;d&lt;/b&gt;"></div>'
                                 +'<p class="normal">ondertekst</p>');

      test.eqHTML('<h1 class="heading1">Kop</h1>'
                +generateEmbeddedObjectHTML('inst1', 'title', 'c<b>d</b>')
                +'<p class="normal">ondertekst</p>'
                , test.getWin().rte.getValue());

    }
  ]);
