import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
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
        instanceref = test.qS(rte.editnode, '.wh-rtd-embeddedobject').dataset.instanceref || '';
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
                    + '<div class="wh-rtd-embeddedobject" data-instanceref="'+encodeValue(instanceref)+'"></div>'
                    + '<p class="normal">And an inline object in <span class="wh-rtd-embeddedobject" data-instanceid="inlineobj-Cw-usGy9kO-g"></span> of the paragraph</p>'
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
                   + '<div class="wh-rtd-embeddedobject" data-instanceref="'+encodeValue(instanceref)+'"></div>'
                   + '<p class="normal">And an inline object in <span class="wh-rtd-embeddedobject" data-instanceid="inlineobj-Cw-usGy9kO-g"></span> of the paragraph</p>', comparecode);

        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }

  , "Paste image from data url"
  , async function()
    {
      //remove existing images RTE first
      var rte = rtetest.getRTE(test.getWin(),'structured');
      rte.qSA('img').forEach(img => img.parentNode.removeChild(img));

      var imgpaste = document.createElement("div");
      const logoasdata = "data:image/png;base64,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";
      imgpaste.innerHTML = `<img src="${logoasdata}" width="27" height="13"/>`;
      rte.getEditor().selectNodeOuter(rte.qS('p'));
      rte.getEditor()._pasteContent(imgpaste); //FIXME white box test...
      test.eq(1, rte.qSA("img").length);
      await test.wait("ui");

      test.clickTolliumButton("Edit raw html");
      await test.wait("ui");

      var code = rtetest.getRawHTMLCode(test.getWin());
      test.true(code.indexOf('src="cid:') != -1); //should contain a cid: and not a pending loader  (ADDME better test possible whether the image actually transferred?)
      test.getCurrentScreen().clickCloser();
      await test.wait("ui");
    }

  , "Paste image from HTTP url"
  , async function()
    {
      var rte = rtetest.getRTE(test.getWin(),'structured');
      var imgpaste = document.createElement("div");
      imgpaste.innerHTML = '<img src="/tollium_todd.res/webhare_testsuite/tollium/logo.png" width="27" height="13"/>';
      rte.getEditor().selectNodeOuter(rte.qS('p'));
      rte.getEditor()._pasteContent(imgpaste); //FIXME white box test...
      test.eq(1, rte.qSA("img").length);
      await test.wait("ui");

      test.clickTolliumButton("Edit raw html");
      await test.wait("ui");

      var code = rtetest.getRawHTMLCode(test.getWin());
      test.true(code.indexOf('src="cid:') != -1); //should contain a cid: and not a pending loader  (ADDME better test possible whether the image actually transferred?)
      test.getCurrentScreen().clickCloser();
      await test.wait("ui");
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
        test.eq(1, selection.querySelectorAll("img").length);
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
        await test.wait("events");

        test.eq("p", body.lastElementChild.nodeName.toLowerCase());
        let firstp = body.lastElementChild;

        var rte = rtetest.getRTE(win,'structured');
        rte.getEditor().insertTable(2, 2);

        test.click(htmlnode);
        await test.wait("events");

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
        let src = test.qS(rte.editnode, 'img').src;
        let imgpaste2 = document.createElement("div");
        imgpaste2.innerHTML = `<img src="${src}" width="27" height="13"/>`;
        rte.getEditor()._pasteContent(imgpaste2); //FIXME white box test...
        await test.wait("ui");

        // test stability of image sources
        let imgs = test.qSA(rte.editnode, 'img');
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
      let img = selection.querySelectorAll("img")[0];
      test.true(img);
      test.eq('428', img.getAttribute("width"));
      test.eq('284', img.getAttribute("height"));
    }


    // ADDME: test dirtying via keyboard interaction (selenium!), editing blocks, some mouse interaction stuff
  ]);
