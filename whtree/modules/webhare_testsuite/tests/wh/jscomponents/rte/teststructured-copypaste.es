//Test copy&paste quirks. Only do stuff that requires selenium for accurate validation

import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
import * as domfocus from 'dompack/browserfix/focus';

class ClipBoardEmul
{
  constructor(props)
  {
    this.files = props.files;
    this.items = props.items;
    this.types = props.types;
    this._typesdata = props.typesdata;
  }

  getData(type)
  {
    return this._typesdata[type];
  }
}

async function paste(rte, props)
{
  let target = domfocus.getCurrentlyFocusedElement();
  let htmltext = props.typesdata && "text/html" in props.typesdata
      ? props.typesdata["text/html"]
      : typeof props.content == 'string' ? props.content : props.content.innerHTML;

  /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
     only firefox is said to implement clipboard currently so we'll create a plain event */
  let evt = target.ownerDocument.createEvent('Event');

  let types = Object.keys(props.typesdata);
  types.contains = key => types.includes(key);

  props = Object.assign({ types }, props);
  let cpdata = new ClipBoardEmul(props);

  evt.initEvent('paste', true, true);
  Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

  let prestate = rtetest.getPreActionState(rte);

  let dodefault = target.dispatchEvent(evt);
  if(dodefault)
  {
    // wait 10 microtask rounds to make sure a single microtask wait (as the editor used to use)
    // is triggered first. In safari the actual paste takes somethat longer, so the paste handler
    // is run too quick. However, due to strange ordering and timing, this loop will resolve quicker
    // than the single promise resolve in the paste handler in Safari. It will fail on chrome though,
    // so a bug would be exposed there.
    for (let i = 0; i < 10; ++i)
      await Promise.resolve(1);

    if (!target.ownerDocument.execCommand("insertHTML", true, htmltext))
    {
      // execCommand insertHTML fails on firefox 68, emulation code follows
      test.eq(1, target.ownerDocument.getSelection().rangeCount, `expected a selection in the target document`);

      // delete selection range, replace with single anchor node
      const range = target.ownerDocument.getSelection().getRangeAt(0);
      range.deleteContents();
      let tempnode = target.ownerDocument.createElement("div");
      range.insertNode(tempnode);
      // insert new stuff relative to anchor node, remove the anchor
      tempnode.insertAdjacentHTML("afterend", htmltext);
      tempnode.remove();
    }
  }
  else
  {
    await test.wait('ui'); // embedded object validation
    await rtetest.testUndoRedo(rte, prestate);
  }

  return dodefault;
}

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    }
  , { ignore: !test.selenium.haveSelenium()
    , test: async function(doc,win)
      {
        var rte = win.rte.getEditor();

        await test.selenium.clickElement(rte.getContentBodyNode());

        var body = rte.getContentBodyNode();
        rtetest.setRTESelection(win, rte,
                                   { startContainer: body
                                   , startOffset: 0
                                   , endContainer: body
                                   , endOffset: 3
                                   });


        await test.selenium.sendKeysToElement(rte.getContentBodyNode(),
            [ test.selenium.getKey("Control") + test.selenium.getKey("Insert")
            ]);

        rtetest.setRTESelection(win, rte, { startContainer:body, startOffset:3, endContainer:body, endOffset:3});

        await test.selenium.sendKeysToElement(rte.getContentBodyNode(),
            [ test.selenium.getKey("Shift") + test.selenium.getKey("Insert")
            ]);
      }
    }
  , { name: "simulate paste"
    , ignore: test.selenium.haveSelenium()
    , test: async function(doc, win)
      {
        let rte = win.rte.getEditor();
        let body = rte.getContentBodyNode();
        body.focus();

        test.subtest("chrome/ff/edge html paste");

        // replace 'Kop', the chrome/safari/edge way
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.wait("events", 10);

        await paste(rte,
            { typesdata: { "text/html": "<span>paste_1<span>" }
            , files: []
            , items: []
            });

        test.eq("paste_1", body.firstElementChild.textContent);

        // Safari paste doesn't give a 'text/html' type, so test the fallback handler using browser paste
        test.subtest("safari html paste");

        // replace 'Kop'
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.wait([ "events" ]);

        await paste(rte,
            { typesdata: {}
            , files: []
            , items: []
            , content: "<span>paste_2<span>"
            });

        test.eq("paste_2", body.firstElementChild.textContent);
      }
    }
  ]);
