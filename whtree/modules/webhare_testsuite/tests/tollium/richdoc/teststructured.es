import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
import { $qS, $qSA } from "@mod-system/js/wh/testframework";
import { encodeValue } from 'dompack/types/text';

let instanceref; // instance ref at the frontend side
let instanceid; // instance id at the backend site


async function setRawHTML(code)
{
  test.clickTolliumButton("Edit raw html");
  await test.wait("ui");
  test.compByName('code').querySelector('textarea').value = code;
  test.clickTolliumButton("OK");
  await test.wait("ui");
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.main')
    , waits: [ 'ui' ]
    }

  , { name: 'structured-rte'
    , test: async function(doc,win)
      {
        test.clickTolliumLabel("Tab with Structured RTE");

        var toddrte=test.compByName('structured');
        test.eq('Heading 2', toddrte.querySelector('.wh-rtd__toolbarstyle').selectedOptions[0].textContent);

        var rte = rtetest.getRTE(win,'structured');
        test.eqIn(["rgb(255, 255, 255)","#ffffff"], getComputedStyle(rte.getBody()).backgroundColor);

        var h2 = rte.qS('h2');
        test.eq('Verdana', getComputedStyle(h2).fontFamily);
        test.eqIn(['rgb(17, 17, 17)','#111111'], getComputedStyle(h2).color);

        // Must have an instance
        instanceref = $qS(rte.editnode, '.wh-rtd-embeddedobject').dataset.instanceref || '';
        test.true(instanceref != '');

        //select the paragraph
        rtetest.setRTESelection(win, rte.getEditor(),
                                   { startContainer: h2.nextSibling.firstChild
                                   , startOffset: 5
                                   , endContainer: h2.nextSibling.firstChild
                                   , endOffset: 5
                                   });

        //proper select value?
        test.eq('Normal', toddrte.querySelector('.wh-rtd__toolbarstyle').selectedOptions[0].textContent);

        rtetest.setRTESelection(win, rte.getEditor(),
                                   { startContainer: h2.firstChild
                                   , startOffset: 5
                                   , endContainer: h2.firstChild
                                   , endOffset: 5
                                   });

        //proper select value?
        test.eq('Heading 2', toddrte.querySelector('.wh-rtd__toolbarstyle').selectedOptions[0].textContent);

        //convert to Normal
        await rtetest.runWithUndo(rte.getEditor(), () => test.fill(toddrte.querySelector('.wh-rtd__toolbarstyle'),'NORMAL'));

        //request raw version
        test.clickTolliumButton("Edit raw html");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'verify-normal'
    , test:function(doc,win)
      {
        var rawcode = rtetest.getRawHTMLCode(win);

        // The raw code has an instanceid. Replace that with our instanceref for the compare
        instanceid = /data-instanceid="([^"]*)"/.exec(rawcode)[1];
        let comparecode = rawcode.replace('data-instanceid="' +instanceid, 'data-instanceref="' + encodeValue(instanceref));

        test.eqHTML('<p class="normal">This docs opens with a heading2. It should be selected in the Pulldown!</p><p class="normal">Hier is een image!<img class="wh-rtd__img" height="26" src="cid:SRCEMBED-4tE8e-B6Eig" width="27"></p>'
                    + '<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--editable wh-rtd-embeddedobject--block" data-instanceref="'+encodeValue(instanceref)+'"></div>'
                    + '<p class="normal">And an inline object in <span class="wh-rtd-embeddedobject wh-rtd-embeddedobject--editable wh-rtd-embeddedobject--inline" data-instanceid="inlineobj-Cw-usGy9kO-g"></span> of the paragraph</p>'
                    , comparecode);

        // use the original rawcode for modification
        test.fill(rtetest.getRawHTMLTextArea(win), rawcode.split('be selected').join('no longer be selected'));
        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'rewrite' //rewrite it, to ensure the server is preserving its cid:
    , test:function(doc,win)
      {
        test.clickTolliumButton("Rewrite");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'rewrite.2'
    , test:function(doc,win)
      {
        test.clickTolliumButton("Edit raw html");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'rewrite.3'
    , test:function(doc,win)
      {
        var rawcode = rtetest.getRawHTMLCode(win);

        // Instance id should not have changed on the backend site
        test.true(rawcode.indexOf(instanceid) != -1);

        let comparecode = rawcode.replace('data-instanceid="' +instanceid, 'data-instanceref="' + encodeValue(instanceref));
        test.eqHTML('<p class="normal">This docs opens with a heading2. It should no longer be selected in the Pulldown!</p><p class="normal">Hier is een image!<img class="wh-rtd__img" height="26" src="cid:SRCEMBED-4tE8e-B6Eig" width="27"></p>'
                   + '<div class="wh-rtd-embeddedobject wh-rtd-embeddedobject--editable wh-rtd-embeddedobject--block" data-instanceref="'+encodeValue(instanceref)+'"></div>'
                   + '<p class="normal">And an inline object in <span class="wh-rtd-embeddedobject wh-rtd-embeddedobject--editable wh-rtd-embeddedobject--inline" data-instanceid="inlineobj-Cw-usGy9kO-g"></span> of the paragraph</p>', comparecode);

        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }

  , { name: 'pasteimage'
    , test:function(doc,win)
      {
        var rte = rtetest.getRTE(win,'structured');

        var imgpaste = document.createElement("div");
        imgpaste.innerHTML = '<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" width="27" height="13"/>';
        rte.getEditor().selectNodeOuter(rte.qS('p'));
        rte.getEditor()._pasteContent(imgpaste); //FIXME white box test...
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        test.clickTolliumButton("Edit raw html");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'pasteimageverify'
    , test:function(doc,win)
      {
        var code = rtetest.getRawHTMLCode(win);
        test.true(code.indexOf('src="cid:') != -1); //should contain a cid: and not a pending loader  (ADDME better test possible whether the image actually transferred?)
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }
  , { name: 'imageprops'
    , test: async function(doc,win)
      {
        var rte = rtetest.getRTE(win,'structured');
        rte.getEditor().selectNodeOuter(rte.qSA('img')[0]);
        test.click(test.compByName('structured').querySelector('.wh-rtd-button[data-button=action-properties]'));
        await test.wait("ui");

        test.subtest("checkimageprops");
        //verify 'original dimensions' by simply setting aspect ratio back to "ON". should restore the 27x26 range
        test.eq('13', test.compByName('height').querySelector('input').value);
        test.click(test.compByName('keepaspectratio'));
        await test.wait("ui");

        test.subtest("checkimageprops2");
        test.eq('26', test.compByName('height').querySelector('input').value);

        //set 26... and off to the second tab!
        test.clickTolliumLabel('Hyperlink');
        test.clickTolliumLabel('External link');
        await test.wait("ui");

        test.subtest("sethyperlink-external");

        var textfield = test.getTolliumLabel("External link").closest('.form').querySelector('input[type=text]');
        test.fill(textfield, "http://b-lex.nl/");
        test.clickTolliumButton("OK");
        await test.wait("ui");

        test.subtest("verifyhyperlink-external");
        var imgnode=rte.qSA('img')[0];
        test.eq(26,imgnode.height);
        test.eq("A", imgnode.parentNode.nodeName.toUpperCase());
        test.eq("http://b-lex.nl/", imgnode.parentNode.href);
      }
    }

    //reopen the properties to verify
  , { name: 'openimageprops-2'
    , test: async function(doc,win)
      {
        var rte = rtetest.getRTE(win,'structured');

        test.click(test.compByName('structured').querySelector('.wh-rtd-button[data-button=action-properties]'));
        await test.wait("ui");

        test.subtest("checkimageprops");
        test.eq('26', test.compByName('height').querySelector('input').value);
        test.clickTolliumLabel('Hyperlink');
        var textfield = test.getTolliumLabel("External link").closest('.form').querySelector('input[type=text]');
        test.eq("http://b-lex.nl/", textfield.value);

        test.subtest("url update");
        test.fill(textfield, "http://b-lex.nl/nieuws/");
        test.clickTolliumButton("OK");
        await test.wait("ui");

        test.subtest("checkimageprops");
        var imgnode=rte.qSA('img')[0];
        test.eq(26,imgnode.height);
        test.eq("A", imgnode.parentNode.nodeName.toUpperCase());
        test.eq("http://b-lex.nl/nieuws/", imgnode.parentNode.href);
      }
    , waits: [ 'ui' ]
    }

    //create a simple hyperlink
  , { name: 'createlink'
    , test:function(doc,win)
      {
        var rte = rtetest.getRTE(win,'structured');
        var mypara = rte.qSA('p')[1];
        rtetest.setRTESelection(win, rte.getEditor(),
                                   { startContainer: mypara.firstChild
                                   , startOffset: 0
                                   , endContainer: mypara.firstChild
                                   , endOffset: 4
                                   });
        test.click(test.compByName('structured').querySelector('.wh-rtd-button[data-button=a-href]'));
      }
    , waits: [ 'ui' ]
    }
  , { name: 'createlink-enterit'
    , test:function(doc,win)
      {
        var textfield = test.getTolliumLabel("External link").closest('.form').querySelector('input[type=text]');
        test.fill(textfield, "http://webhare.net/");
        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'createlink-verify'
    , test:function(doc,win)
      {
        var rte = rtetest.getRTE(win,'structured');
        var anode = rte.qSA('a')[1];
        test.eq("http://webhare.net/", anode.href);
        test.false(anode.hasAttribute("target"));
        test.eq("Hier", anode.firstChild.nodeValue);
        test.click(test.compByName('structured').querySelector('.wh-rtd-button[data-button=action-properties]'));
      }
    , waits: [ 'ui' ]
    }
  , { name: 'createlink-verifyprops'
    , test:function(doc,win)
      {
        var textfield = test.getTolliumLabel("External link").closest('.form').querySelector('input[type=text]');
        test.eq("http://webhare.net/", textfield.value);
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }

  , { name: 'imagebuttontest'
    , test: async function(doc, win)
      {
        var rte = rtetest.getRTE(win, 'structured');
        var textnode = rte.qSA("a")[1].nextSibling;
        rtetest.setRTESelection(win, rte.getEditor(),
                          { startContainer: textnode
                          , startOffset: 5
                          , endContainer: textnode
                          , endOffset: 10
                          });

        let uploadpromise = test.prepareUpload(
            [ { url: '/tollium_todd.res/webhare_testsuite/tollium/logo.png'
              , filename: 'logo.png'
              }
            ]);

//        test.prepareNextUpload(win, 'logo.png', new $wh.URL(location.href).resolveToAbsoluteURL('/tollium_todd.res/webhare_testsuite/tollium/logo.png'));
        test.click(test.compByName('structured').querySelector('.wh-rtd-button[data-button=img]'));
        await uploadpromise;
      }
    , waits: [ 'ui' ]
    }
/*
  , { name: 'imagebuttontest-waitupload'
    , test: function() {}
    , waits: [ 'uploadprogress', 500 ] // FIXME: correct waits!
    }
*/
  , { name: 'imagebuttontest-verify'
    , test: function(doc, win)
      {
        // Image should be selected
        var rte = rtetest.getRTE(win, 'structured');
        var selection = rte.getEditor().getSelectionRange();
        test.eq(1, selection.getElementsByTagName("img").length);
      }
    }

  , test.testClickTolliumButton("Rewrite", "dirtytest-resetdirty")

  , { name: 'dirtytest-testnotdirty'
    , test: function(doc, win)
      {
        test.eq('NO', test.compByName('dirty').querySelector('input').value);
      }
    }

  , { name: 'append-paragraph'
    , test: async function(doc, win)
      {
        let rtenode = test.compByName('structured');

        //remove last paragraph with the inline block, as we need the lat para to be a block element for this test
        let body = rtenode.querySelector(".wh-rtd-editor-bodynode");
        body.removeChild(body.lastElementChild);

        let htmlnode = rtenode.querySelector(".wh-rtd-editor-htmlnode");
        test.click(htmlnode, { y: "99%" });
        await test.wait([ "events" ]);

        test.eq("p", body.lastElementChild.nodeName.toLowerCase());
        let firstp = body.lastElementChild;

        var rte = rtetest.getRTE(win,'structured');
        rte.getEditor().insertTable(2, 2);

        test.click(htmlnode);
        await test.wait([ "events" ]);

        // new p?
        test.eq("p", body.lastElementChild.nodeName.toLowerCase());
        test.false(body.lastElementChild === firstp);
      }
    , waits: [ "ui" ] //give dirty event time to process
    }

  , { name: 'dirtytest-testdirty' //should be dirty after appending paragraph
    , test: function(doc, win)
      {
        test.eq('YES', test.compByName('dirty').querySelector('input').value);
      }
    }

  , { name: "Test dirtyness regression"
    , test: async function(doc, win)
      {
        // a document that was changed and than reverted, and then undirties from the backend
        // was still marked as dirty in the rte - but not signalled anymore, so further edits
        // would not cause dirtyness in the backend

        let rtenode = test.compByName('structured');
        let body = rtenode.querySelector(".wh-rtd-editor-bodynode");

        body.querySelector("a").textContent = "Dirtytest1";
        var rte = rtetest.getRTE(win,'structured');
        rte._gotStateChange();
        test.click(test.compByName('undirtybutton'));
        await test.wait("ui");
        test.eq('NO', test.compByName('dirty').querySelector('input').value);

        // change and reset to original value
        body.querySelector("a").textContent = "Dirtytest2";
        rte._gotStateChange();
        body.querySelector("a").textContent = "Dirtytest1";
        rte._gotStateChange();
        await test.wait("ui");
        test.eq('YES', test.compByName('dirty').querySelector('input').value);

        test.click(test.compByName('undirtybutton'));
        await test.wait("ui");
        test.eq('NO', test.compByName('dirty').querySelector('input').value);

        // change again, should be dirty
        body.querySelector("a").textContent = "Hier4";
        rte._gotStateChange();
        await test.wait("ui");
        test.eq('YES', test.compByName('dirty').querySelector('input').value);
      }
    }

  , "Test another dirtyness regression"
  , async function(doc, win)
    {
      /* when
         - making a simple change
         - forcing undirty
         - sending the original version from the server to the client

         the client may ignore this revert */

      //load up simple enough content to trigger the RTE 'unchanged content' optimization
      await setRawHTML(`<html><body><h2 class="heading2">test changes</h2></body</html>`);

      //make a trivial change, verify dirty state flips
      test.eq('NO', test.compByName('dirty').querySelector('input').value);
      let body = test.compByName('structured').querySelector(".wh-rtd-editor-bodynode");
      body.querySelector("h2").textContent = "another change";

      var rte = rtetest.getRTE(win,'structured');
      rte._gotStateChange();

      await test.wait("ui");
      test.eq('YES', test.compByName('dirty').querySelector('input').value);

      //force undirty
      test.clickTolliumButton("Undirty");
      await test.wait("ui");
      test.eq('NO', test.compByName('dirty').querySelector('input').value);

      //reload the initial value
      await setRawHTML(`<html><body><h2 class="heading2">test changes</h2></body</html>`);

      //did the RTE pick this up?
      body = test.compByName('structured').querySelector(".wh-rtd-editor-bodynode");
      test.eq("test changes", body.querySelector("h2").textContent);
      test.eq('NO', test.compByName('dirty').querySelector('input').value);
    }

  , { name: "Test image copypaste within document"
    , test: async function(doc, win)
      {
        var rte = rtetest.getRTE(win,'structured');

        let rtenode = test.compByName('structured');
        let bodynode = rtenode.querySelector(".wh-rtd-editor-bodynode");
        var imgpaste = document.createElement("div");
        imgpaste.innerHTML = '<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" width="27" height="13"/>';
        rte.getEditor().selectNodeInner(bodynode);
        rte.getEditor()._pasteContent(imgpaste); //FIXME white box test...
        await test.wait("ui");

        // Immediately copy the image
        let src = $qS(rte.editnode, 'img').src;
        let imgpaste2 = document.createElement("div");
        imgpaste2.innerHTML = `<img src="${src}" width="27" height="13"/>`;
        rte.getEditor()._pasteContent(imgpaste2); //FIXME white box test...
        await test.wait("ui");

        // test stability of image sources
        let imgs = $qSA(rte.editnode, 'img');
        test.eq(2, imgs.length);
        test.eq(src, imgs[0].src);
        test.eq(src, imgs[1].src);
      }
    }

  , "Test insert image"
  , async function()
    {
      test.click(test.getMenu(['M01','A04']));
      await test.wait('ui');

      let rte = rtetest.getRTE(test.getWin(),'structured');
      let selection = rte.getEditor().getSelectionRange();
      let img = selection.getElementsByTagName("img")[0];
      test.true(img);
      test.eq('428', img.getAttribute("width"));
      test.eq('284', img.getAttribute("height"));
    }


    // ADDME: test dirtying via keyboard interaction (selenium!), editing blocks, some mouse interaction stuff
  ]);
