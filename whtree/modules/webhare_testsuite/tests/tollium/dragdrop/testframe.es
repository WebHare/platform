import * as test from '@mod-tollium/js/testframework';

var gesture_time = 25;
var test_win = null;
var test_el = null, test_pos = null, test_size = null;
//var org_pos = null;
//var part_left = null, part_middle = null, part_right = null, part_top = null, part_bottom = null;
//let prevpos;
let testel_centerx, testel_centery;

let desktopbounds; //, windowbounds;

function initTestWin()
{
  // Get the window with the 'subwindow_body' panel
  desktopbounds = test.qS("#desktop").getBoundingClientRect();
  //windowbounds = test.qS("html").getBoundingClientRect();
  test_win = test.compByName("subwindow_body").closest(".t-screen");
}

function initTestElement(cssmatch, idx)
{
  test_el = cssmatch ? test.qSA(test_win,cssmatch)[idx || 0] : test_win;
  test_pos  = { x: test_el.getBoundingClientRect().left,  y: test_el.getBoundingClientRect().top };
  test_size = { x: test_el.getBoundingClientRect().width, y: test_el.getBoundingClientRect().height };
  testel_centerx = Math.floor(test_size.x / 2);
  testel_centery = Math.floor(test_size.y / 2);
}


function generateResizeTests(name, opts)
{
  var savewinpos;//, relx, rely;
  opts={...opts}; //clone it

  return [ { name: 'resize frame ' + name
           , test: function(doc, win)
             {
               savewinpos = test_win.getBoundingClientRect(); //store current

               let clientx = opts.left ? savewinpos.left + 2 : opts.right ? savewinpos.right - 2 : Math.floor((savewinpos.left+savewinpos.right)/2);
               let clienty = opts.top ? savewinpos.top + 2 : opts.bottom ? savewinpos.bottom - 2 : Math.floor((savewinpos.top+savewinpos.bottom)/2);

               test.sendMouseGesture([ { doc: doc, down: 0, clientx: clientx, clienty: clienty }
                                     , { up: 0, relx: opts.relx||0, rely: opts.rely||0, delay: gesture_time, transition: test.dragTransition }
                                     ]);
             }
           , waits:['pointer']//,'animationframe']
           }
         , { test: function(doc,win)
             {
               let newpos = test_win.getBoundingClientRect();
               test.eq(savewinpos.left   + (opts.left ? opts.relx : 0),   newpos.left);
               test.eq(savewinpos.right  + (opts.right ? opts.relx : 0),  newpos.right);
               test.eq(savewinpos.top    + (opts.top ? opts.rely : 0),    newpos.top);
               test.eq(savewinpos.bottom + (opts.bottom ? opts.rely : 0), newpos.bottom);
             }
           }
         ];
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/dragdrop.frametest')
    , waits: [ 'ui' ]
    }

  , { name: 'move frame'
    , test: function(doc,win)
      {
        // Initialize the test window node
        initTestWin(win);

        // Find the window header
        initTestElement(".windowheader");
        //org_pos = test_pos;

        // Start at the current position
        var pos = test_pos;
        // Move the window 100 pixels down
        test_pos = { x: pos.x, y: pos.y + 100 };

        test.sendMouseGesture([ { doc: doc, down: 0, clientx: pos.x + testel_centerx, clienty: pos.y + testel_centery }
                              , { up: 0, clientx: test_pos.x + testel_centerx, clienty: test_pos.y + testel_centery, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }

  , { name: 'move frame down'
    , test: function(doc, win)
      {
        test.eq(test_pos.x, test_el.getBoundingClientRect().left);
        test.eq(test_pos.y, test_el.getBoundingClientRect().top);

        // Start at the current position
        var pos = test_pos;
        // Move the window 100 pixels to the right
        test_pos = { x: pos.x + 100, y: pos.y };

        test.sendMouseGesture([ { doc: doc, down: 0, clientx: pos.x + testel_centerx, clienty: pos.y + testel_centery }
                              , { up: 0, clientx: test_pos.x + testel_centerx, clienty: test_pos.y + testel_centery, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }

  , { name: 'move frame right'
    , test: function(doc, win)
      {
        test.eq(test_pos.x, test_el.getBoundingClientRect().left);
        test.eq(test_pos.y, test_el.getBoundingClientRect().top);

        // Start at the current position
        var from_pos = test_pos;
        // Move the window out of the bottom left corner of the browser
        var to_pos = { x: -200, y: doc.body.offsetHeight+200 };

        test.sendMouseGesture([ { doc: doc, down: 0, clientx: from_pos.x + testel_centerx, clienty: from_pos.y + testel_centery }
                              , { up: 0, clientx: to_pos.x, clienty: to_pos.y, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }
  , { test: function(doc, win)
      {
        test.eq(desktopbounds.left - testel_centerx, test_el.getBoundingClientRect().left);
        test.eq(desktopbounds.top + (desktopbounds.height - 1 - testel_centery), test_el.getBoundingClientRect().top);
      }
    }

  , { name: 'move frame out of window south west'
    , test: function(doc, win)
      {
        // Start at the current position
        var from_pos = test_pos;
        // Move the window out of the top right corner of the browser
        var to_pos = { x: doc.body.offsetWidth+200, y: -200 };

        test.sendMouseGesture([ { doc: doc, down: 0, clientx: from_pos.x + testel_centerx, clienty: from_pos.y + testel_centery }
                              , {             up: 0, clientx: to_pos.x,                   clienty: to_pos.y,                    delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }
  , { test: function(doc, win)
      {
        test.eq(-testel_centerx, test_el.getBoundingClientRect().left);
        test.eq(desktopbounds.bottom - testel_centery - 1, test_el.getBoundingClientRect().top);
        //test.eq({ x: desktopbounds.left - testel_centerx, y: desktopbounds.top + (desktopbounds.height - 1 - testel_centery) }, test_el.getPosition());
      }
    }

  , { name: 'move frame out of window north east'
    , test: function(doc, win)
      {
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: 0, clienty: desktopbounds.bottom-1 }
                              , {  up: 0, clientx: desktopbounds.right-1, clienty: desktopbounds.top, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }
  , { test: function(doc, win)
      {
        test.eq(desktopbounds.right - testel_centerx - 1, test_el.getBoundingClientRect().left);
        test.eq(desktopbounds.top - testel_centery, test_el.getBoundingClientRect().top);
      }
    }

  , { name: 'move back'
    , test: function(doc, win)
      {
        //IE/Edge work around, add one. not sure why, but otherwise we hit the appbar?
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: desktopbounds.right-1, clienty: desktopbounds.top+1 }
                              , {  up: 0, clientx: 300, clienty: 200, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }
  , { test: function(doc, win)
      {
        test.eq(300 - testel_centerx, test_el.getBoundingClientRect().left);
        test.eq(200 - testel_centery - 1, test_el.getBoundingClientRect().top);
      }
    }

  , { name: 'try to move using close button'
    , test: function(doc,win)
      {
        // Find the close button
        let closebutton = test_win.querySelector('.closewindow');

        // Drag 100 pixels down - the window should not move
        test.sendMouseGesture([ { el: closebutton, down: 0 }
                              , { up: 0, rely: 100, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits:['pointer','animationframe']
    }
  , { test: function(doc, win)
      {
        test.eq(300 - testel_centerx, test_el.getBoundingClientRect().left);
        test.eq(200 - testel_centery - 1, test_el.getBoundingClientRect().top);
      }
    }

  , ...generateResizeTests('north west', { left:1, top:1, relx:-20, rely:-10})
  , ...generateResizeTests('north',      { top:1, relx:-20, rely:-10})
  , ...generateResizeTests('north east', { right:1, top:1, relx:-20, rely:-10})
  , ...generateResizeTests('east',       { right:1, relx:-20, rely:-10})
  , ...generateResizeTests('south east', { bototm:1, right:1, relx:-20, rely:-10})
  , ...generateResizeTests('south',      { bototm:1, right:1, relx:-20, rely:-10})
  , ...generateResizeTests('south west', { bototm:1, right:1, relx:-20, rely:-10})

  , { name: 'savestate'
    , test: async function(doc, win)
      {
        let savesize = test_win.getBoundingClientRect();
        test.getCurrentScreen().clickCloser();
        await test.wait('ui');

        // We have a new window, re-initialize the test window node
        initTestWin(win);

        //tollium should immediately reopen so
        test.eq(savesize.width, test_win.getBoundingClientRect().width);
        test.eq(savesize.height, test_win.getBoundingClientRect().height);
      }
    }
  ]);
