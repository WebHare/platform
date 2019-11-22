import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.main')
    , waits: [ 'ui' ]
    }

  , { name: 'imagebuttontest'
    , test: async function(doc, win)
      {
        var rte = rtetest.getRTE(win, 'editor');
        var geoffreynode = rte.qSA("br")[1].nextSibling;
        rtetest.setRTESelection(win, rte.getEditor(),
                          { startContainer: geoffreynode
                          , startOffset: 5
                          , endContainer: geoffreynode
                          , endOffset: 10
                          });

        console.log('start prepare');
        let uploadpromise = test.prepareUpload(
            [ { url: '/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg'
              , filename: 'portrait_8.jpg'
              }
            ]);

        console.log('done prepare');

//        testapi.prepareNextUpload(win, 'logo.png', new $wh.URL(location.href).resolveToAbsoluteURL('/tollium_todd.res/webhare_testsuite/tollium/logo.png'));
        test.click(test.compByName('editor').querySelector('.wh-rtd-button[data-button=img]'));

        await uploadpromise;
        console.log('done uploadpromise');
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verifyimage'
    , test:function(doc,win)
      {
        var img = test.compByName('editor').querySelector("div.wh-rtd-editor-bodynode img");
        //did it return to portrait ?
        test.eq(600, img.height);
        test.eq(450, img.width);
      }
    }
  ]);
