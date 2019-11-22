import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { name: "An empty canvas..."
    , loadpage: test.getCompTestPage('image-overlays')
    , waits:['ui']
    }

  , {
      test:async function()
      {
        test.eq('0',test.compByName('onchangeoverlayscount').textContent);
        test.sendMouseGesture([{ el: test.compByName("thecomponent$*"), x:50, y:50, down:0 }
                              ,{ el: test.compByName("thecomponent$*"), x:70, y:90, up:0, delay:50 }
                              ]);
        await test.wait('pointer');
        test.click(test.compByName('oncreateoverlay$*')); //enable new overlays
        await test.wait('ui');
        test.eq('0',test.compByName('onchangeoverlayscount').textContent, 'should still have no changes');
        test.sendMouseGesture([{ el: test.compByName("thecomponent$*"), x:70, y:70, down:0 }
                              ,{ relx:50, rely:60, up:0, delay:50 }
                              ]);
        await test.wait('pointer');
        await test.wait('ui');
        test.eq('1',test.compByName('onchangeoverlayscount').textContent, 'first overlay appeared');

        let focused = test.getDoc().activeElement;
        test.true(focused.classList.contains('t-image__overlay'), 'overlay should be focused after creation');
        test.click(test.compByName('buttonreadoverlays'));
        await test.wait('ui');

        let overlays = JSON.parse(test.compByName('overlays').querySelector('input').value);
        test.eq(1,overlays.length);
        test.eq(122, overlays[0].area.height); //scale 1:2, and apparently height is inclusive?

        //oncreate should reject overlays less than 10 pixels high
        test.sendMouseGesture([{ el: test.compByName("thecomponent$*"), x:270, y:70, down:0 }
                              ,{ relx:50, rely:4, up:0, delay:50 }
                              ]);

        await test.wait('pointer');
        await test.wait('ui');
        test.click(test.compByName('buttonreadoverlays'));
        await test.wait('ui');

        overlays = JSON.parse(test.compByName('overlays').querySelector('input').value);
        test.eq(1,overlays.length,'new overlay should not be added');
        test.eq(122, overlays[0].area.height, 'only remaining overlay should still be the one that\'s 122px high');
      }
    }
 , { name: "Page with preset overlays"
   , loadpage: test.getCompTestPage('image-overlays'
                , { overlays:  [ { rowkey: 1, area: { type: "rectangle", left:  50, top:  50, width: 80, height: 80 } }
                               , { rowkey: 2, area: { type: "rectangle", left: 500, top: 150, width: 80, height: 80 } }
                               , { rowkey: 3, area: { type: "rectangle", left: 250, top: 450, width: 80, height: 80 } }
                               ]
                  })
    , waits:['ui']
    }
  , { name:"Add overlay"
    , test:async function()
      {
        test.click(test.compByName('oncreateoverlay$*')); //enable new overlays
        await test.wait('ui');
        test.sendMouseGesture([{ el: test.compByName("thecomponent$*"), x:90, y:50, down:0 }
                              ,{ el: test.compByName("thecomponent$*"), x:110, y:90, up:0, delay:1500 }
                              ]);
        await test.wait('pointer');
        await test.wait('ui');

        test.click(test.compByName('buttonreadoverlays'));
        await test.wait('ui');

        let overlays = JSON.parse(test.compByName('overlays').querySelector('input').value);
        test.eq(4,overlays.length, 'overlay not added?');
      }
    }
  , { test:function()
      {
        test.clickToddButton('selection');
      }
    , waits:['ui']
    }
  //ADDME: Test overlays not rendered if overlays_active is not set
  //ADDME: Test overlays rendered if overlays_active is set (checkbox 'overlays_active')
  //ADDME: Test adding overlays server-side (button 'add_overlay')
  //ADDME: Test adding overlays client-side (by dragging on the image)
  //ADDME: Test moving/resizing overlays client-side (by dragging the overlay)
  //ADDME: Test selecting overlays client-side (by clicking the overlay)
  //ADDME: Test selecting overlays server-side (button 'selection')
  ]);
