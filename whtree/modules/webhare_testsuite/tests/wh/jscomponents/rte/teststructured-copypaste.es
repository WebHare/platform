import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    }
  , { name: "simulate paste"
    , test: async function(doc, win)
      {
        let rte = win.rte.getEditor();
        let body = rte.getContentBodyNode();
        body.focus();

        test.subtest("chrome/ff/edge html paste");

        // replace 'Kop', the chrome/safari/edge way
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.wait("events", 10);

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
                                            { typesdata: { "text/html": "<span>paste_1<span>" }
                                            , files: []
                                            , items: []
                                            }), { waits: 'ui' });

        test.eq("paste_1", body.firstElementChild.textContent);

        // Safari paste doesn't give a 'text/html' type, so test the fallback handler using browser paste
        test.subtest("safari html paste");

        // replace 'Kop'
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.wait([ "events" ]);

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
                                            { typesdata: { "text/plain": "paste_2" }
                                            , files: []
                                            , items: []
                                            }), { waits: 'ui' });

        test.eq("paste_2", body.firstElementChild.textContent);
      }
    }
  ]);
