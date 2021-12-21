import * as test from "@mod-tollium/js/testframework";
import * as browser from 'dompack/extra/browser';

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.imagetest')
    , waits: ['ui']
    }

  , { name: 'emptyimg'
    , test: function(doc,win)
      {
        var img = test.compByName('image').querySelector('img,canvas');

        if(browser.getName() != 'ie') //on IE placeholders are canvasses instead of images... we'll just skip the test
        {
          test.eq(300, img.naturalWidth);
          test.eq(300, img.naturalHeight);
        }
        test.true(img.closest('.t-image--clickable'));
        test.false(test.compByName('image').classList.contains('todd--disabled'));

        // Update placeholder
        test.click(test.getMenu(['I01']));
      }
    , waits: ['ui']
    }

  , { name: 'updatedplaceholder'
    , test: function(doc,win)
      {
        var img = test.compByName('image').querySelector('img,canvas');

        //tollium scales up SVGs to match the devicePixelRatio
        if(browser.getName() != 'ie') //on IE placeholders are canvasses instead of images... we'll just skip the test
        {
          test.eq(100 * window.devicePixelRatio, img.naturalWidth);
          test.eq(100 * window.devicePixelRatio, img.naturalHeight);
        }
        test.click(test.getMenu(['I03']));
      }
    , waits: ['ui']
    }

  , { name: 'imagebysrc'
    , test: function(doc,win)
      {
        var img = test.compByName('image').querySelector('img');

        test.eq(1024, img.naturalWidth);
        test.eq(768, img.naturalHeight);
        //verify aspect ratio properly applied: as this is a 100by100 image, we expact acutal image width to be 100 by 75
        test.eq(100, img.offsetWidth);
        test.eq(75, img.offsetHeight);

        test.sendMouseGesture([ { el: img, down: 0, x: 9, y: 15 }
                              , { el: img, up: 0, x: 9, y: 15 }
                              ]);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'topclick'
    , test: function(doc,win)
      {
        /* click coordinates are supposed to scale back to the original image
            x=9, 9/100*1024= 92,16
            y=15, 15/75*768 = 153,6 */

        var textarea = test.compByName('log').querySelector('textarea');
        test.eq('action\ncallback 92 154', textarea.value);

        test.click(test.getMenu(['I05']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'preparesecondtopclick'
    , test: function(doc,win)
      {
        test.true(test.compByName('image').classList.contains('todd--disabled'),"Expected image to be disabled after I05 changed the action");
        var img = test.compByName('image').querySelector('img');
        test.sendMouseGesture([ { el: img, down: 0, x: 9, y: 15 }
                              , { el: img, up: 0, x: 9, y: 15 }
                              ]);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'bottomclick'
    ,  test: async function(doc,win)
      {
        let textarea = test.compByName('log').querySelector('textarea');
        test.eq('action\ncallback 92 154\ncallback2 92 154', textarea.value);

        var img = test.compByName('image').querySelector('img');
        test.click(test.compByName('action2checkbox').querySelector('label'));
        let focused_pre_click = doc.activeElement;
        test.sendMouseGesture([ { el: img, down: 0, x: 98, y: 70 }
                              , { el: img, up: 0, x: 98, y: 70 }
                              ]);

        test.eq(focused_pre_click, doc.activeElement, "Click on image with action shouldn't change focus");

        await test.wait('ui');
        test.false(test.compByName('image').classList.contains('todd--disabled'));
        textarea = test.compByName('log').querySelector('textarea');
        test.eq('action\ncallback 92 154\ncallback2 92 154\naction2\ncallback2 1004 717', textarea.value);

        // Clear action
        test.click(test.getMenu(['I06']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'preparebottomclickwithoutaction'
    , test: async function(doc,win)
      {
        test.false(test.compByName('image').classList.contains('todd--disabled'), 'removing action should unlink image from disabling-by-action');
        test.click(test.compByName('action2checkbox').querySelector('label'));

        var img = test.compByName('image').querySelector('img');
        test.sendMouseGesture([ { el: img, down: 0, x: 98, y: 70 }
                              , { el: img, up: 0, x: 98, y: 70 }
                              ]);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'bottomclickwithoutaction'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        test.eq('action\ncallback 92 154\ncallback2 92 154\naction2\ncallback2 1004 717\ncallback2 1004 717', textarea.value);

        var img = test.compByName('image');
        test.true(img.classList.contains('t-image--clickable'));

        // Clear onclick
        test.click(test.getMenu(['I07']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'bottomclickwithoutanycallbacks'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        test.eq('action\ncallback 92 154\ncallback2 92 154\naction2\ncallback2 1004 717\ncallback2 1004 717', textarea.value);

        var img = test.compByName('image');
        test.false(img.classList.contains('t-image--clickable'));
      }
    }

  ]);
