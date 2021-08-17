import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

let testblock = test.getTestArgument(0) == 'block';

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.main')
    , waits: [ 'ui' ]
    }

  , "Test initial objects"
  , async function()
    {
      test.click(test.qSA("nav t-text").filter(node => node.textContent=="Tab with Structured RTE")[0]);

      let rte = rtetest.getRTE(test.getWin(), 'structured');
      let inlineobj = rte.getBody().querySelector("span.wh-rtd-embeddedobject .wh-rtd-embeddedobject__preview");
      test.eq("<u>UNDERLINED</u> HTML", inlineobj.textContent);
    }

  , { name: 'structured-rte'
    , test:function(doc,win)
      {
        var rte = rtetest.getRTE(win, 'structured');
        rtetest.setRTESelection(win, rte.getEditor(),
                          { startContainer: rte.qS("p").firstChild
                          , startOffset: 0
                          , endContainer: rte.qS("p").firstChild
                          , endOffset: 4
                          });
        test.click(test.getMenu(['M01',testblock ? 'A01' : 'A03']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'objectprops'
    , test:function(doc,win)
      {
        var rte = rtetest.getRTE(win, 'structured');
        var selection = rte.getEditor().getSelectionRange();

        test.eq(testblock ? 1 : 0, selection.querySelectorAll("div").filter(el => el.matches(".wh-rtd__preview__htmlcode")).length);
        test.eq(testblock ? 0 : 1, selection.querySelectorAll("span").filter(el => el.matches(".wh-rtd__preview__htmlcode")).length);
        if(testblock)
        {
          test.eq(2, rte.getBody().querySelectorAll("div.wh-rtd-embeddedobject").length, "Must have two block embedded objects now");
        }
        else
        {
          test.eq(1, rte.getBody().querySelectorAll("div.wh-rtd-embeddedobject").length, "Must still have one block object");
          test.eq(2, rte.getBody().querySelectorAll("span.wh-rtd-embeddedobject").length, "And now two inline objects");
        }

        let newobj = rte.getBody().querySelector(".wh-rtd-embeddedobject");
        test.eq('false', newobj.contentEditable);

        test.eq(1, test.getCurrentApp().getNumOpenScreens());
        test.click(test.compByName('structured').querySelector('.wh-rtd-button[data-button=action-properties]'));
      }
    , waits: [ 'ui' ]
    }
  , { name: 'objectprops-settitle'
    , test: function(doc,win)
      {
        test.eq(2, test.getCurrentApp().getNumOpenScreens());
        let textfield = test.compByName("fragment1!html").querySelector("textarea");
        test.eq("<u>inserted</u> object", textfield.value);
        test.fill(textfield, "<b>bolded</u> object");
        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'objectprops-checktitle'
    , test: function(doc,win)
      {
        var rte = rtetest.getRTE(win, 'structured');
        var selection = rte.getEditor().getSelectionRange();

        let htmlcode = selection.querySelectorAll(testblock ? "div" : "span").filter(el => el.matches(".wh-rtd__preview__htmlcode"))[0];
        test.true(htmlcode);
        test.eq("<b>bolded object</b>", htmlcode.textContent);
        test.eq(1, selection.querySelectorAll("*").filter(n => n.classList.contains('wh-rtd-embeddedobject')).length);

        // Store instanceids
        var body = rte.getBody();
        var divs = body.querySelectorAll(".wh-rtd-embeddedobject");
        test.eq(3, divs.length);

        //request raw version
        test.clickTolliumButton("Edit raw html");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'objectprops-checkhtml'
    , test:function(doc,win)
      {
        var rawcode = rtetest.getRawHTMLCode(win);

        let instanceid_regex = /data-instanceid="([^"]*)"/g;
        let id_1 = instanceid_regex.exec(rawcode)[1];
        let id_2 = instanceid_regex.exec(rawcode)[1];

        if(testblock)
        {
          test.eqHTML(
              '<html><body><h2 class="heading2">This docs opens with a heading2. It should be selected in the Pulldown!</h2>'
             +'<div class="wh-rtd-embeddedobject" data-instanceid="'+id_1+'"></div>'
             +'<p class="normal">is een image!<img class="wh-rtd__img" height="26" src="cid:SRCEMBED-4tE8e-B6Eig" width="27"/></p>'
             +'<div class="wh-rtd-embeddedobject" data-instanceid="'+id_2+'"></div>'
             +'<p class="normal">And an inline object in <span class="wh-rtd-embeddedobject" data-instanceid="inlineobj-Cw-usGy9kO-g"></span> of the paragraph</p>'
             +'</body></html>', rawcode);
        }
        else
        {
          test.eqHTML(
              '<html><body><h2 class="heading2">This docs opens with a heading2. It should be selected in the Pulldown!</h2>'
             +'<p class="normal"><span class="wh-rtd-embeddedobject" data-instanceid="'+id_1+'"></span> is een image!<img class="wh-rtd__img" height="26" src="cid:SRCEMBED-4tE8e-B6Eig" width="27"/></p>'
             +'<div class="wh-rtd-embeddedobject" data-instanceid="'+id_2+'"></div>'
             +'<p class="normal">And an inline object in <span class="wh-rtd-embeddedobject" data-instanceid="inlineobj-Cw-usGy9kO-g"></span> of the paragraph</p>'
             +'</body></html>', rawcode);
        }
        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui' ]
    }
  , { name: 'objectprops-checkhtml'
    , test:function(doc,win)
      {
        test.eq(1, test.getCurrentApp().getNumOpenScreens());
      }
    }

  //reload so we're not dirty
  , { loadpage: test.getTestScreen('tests/richdoc.main')
    , waits: [ 'ui' ]
    }
  , { name: 'objects-badpaste'
    , test: async function(doc,win)
      {
        test.clickTolliumLabel("Tab with Structured RTE");

        //make sure 'dirty' is still false. note that tollium checkboxes are hard to scan :/
        test.eq('NO', test.compByName('dirty').querySelector('input').value);

        let rte = rtetest.getRTE(win, 'structured');
        test.eq(1, rte.qSA('div.wh-rtd-embeddedobject').length);

        let pasteblock = document.createElement("div");
        let firstblock = rte.qS('div.wh-rtd-embeddedobject').cloneNode(true);
        test.true(firstblock.dataset.instanceref != '');

        //corrupt the instance ref to make it look like it's from a different source
        firstblock.dataset.instanceref = firstblock.dataset.instanceref.substr(0,15) + 'gggg' + firstblock.dataset.instanceref.substr(19);
        pasteblock.appendChild(firstblock);

        //paste it!
        rte.focus();
        rtetest.setRTESelection(win, rte.getEditor(),
                          { startContainer: rte.qS("h2").firstChild
                          , startOffset: 5
                          , endContainer: rte.qS("h2").firstChild
                          , endOffset: 10
                          });

        await rtetest.runWithUndo(rte.getEditor(), () => test.pasteHTML(pasteblock), { waits: 'ui' });
      }
    , waits:['ui']
    }
  , { name: 'objects-badpaste should now be dirty'
    , test:function(doc,win)
      {
        let rte = rtetest.getRTE(win, 'structured');

        test.eq('YES', test.compByName('dirty').querySelector('input').value);

        //but we should have only ONE object as the new object was broken...
        test.eq(1, rte.qSA('div.wh-rtd-embeddedobject').length);
      }
    }

  , { name: 'edit object, test nested embedded objects'
    , test: async function()
      {
        /* throw in a 2column object that will contain embedded widgets  to test proper handling of recursive embedded objects
           (at some point the RTD was rewriting embedded widgetpreviews because they match the same selector) */

        let rte = rtetest.getRTE(test.getWin(), 'structured');
        let embobj = rte.qSA("div.wh-rtd-embeddedobject");
        test.eq(1, embobj.length);

        test.click(test.getMenu(['M01','A05']));
        await test.wait('ui');

        embobj = rte.qSA("div.wh-rtd-embeddedobject");
        test.eq(4, embobj.length);

        // create embedded object without instanceid
        let invalidembed3 = document.createElement("div");
        invalidembed3.className = "wh-rtd-embeddedobject";

        var bodynode = rte.getEditor().getContentBodyNode();
        bodynode.append(invalidembed3);

        // Execute a paste to trigger revalidation
        rte.focus();
        rtetest.setRTESelection(test.getWin(), rte.getEditor(),
                          { startContainer: rte.qS("h2").firstChild
                          , startOffset: 0
                          , endContainer: rte.qS("h2").firstChild
                          , endOffset: 0
                          });

        // Paste 2 embedded objects, one with no instanceref, one with invalid ref
        let pasteblock = document.createElement("div");
        pasteblock.textContent = "(pasted)";
        let invalidembed1 = document.createElement("div");
        invalidembed1.className = "wh-rtd-embeddedobject";
        pasteblock.append(invalidembed1);
        let invalidembed2 = document.createElement("div");
        invalidembed2.className = "wh-rtd-embeddedobject";
        invalidembed2.dataset.instanceref = "embedobj:fail2";
        pasteblock.append(invalidembed2);

        test.pasteHTML(pasteblock);

        await test.wait("ui");

        // Shouldn't have touched the nested embedded object, but removed the just pasted elements
        embobj = rte.qSA("div.wh-rtd-embeddedobject");
        test.eq(4, embobj.length);

        // doubleclick should not crash (we used to target the embobj directly for doubleclicks, but that no longer works now since pointer events fix)
        test.false(test.canClick(embobj[2]));
        test.click(embobj[0]);
        test.click(embobj[0]);
        await test.wait("ui");
        test.true(test.compByName('fragment1!rtdleft'));
        test.clickTolliumButton("OK");
        await test.wait("ui");

        test.eq(4, rte.qSA("div.wh-rtd-embeddedobject").length);
        test.true(rte.qSA("div.wh-rtd-embeddedobject")[0].classList.contains("wh-rtd-embeddedobject--selected"));
        test.eq(1, rte.qSA(".wh-rtd-embeddedobject--selected").length, "ONLY the toplevel embobj should have the selected class..");
      }
    }
  ]);

