/* global test.sendMouseGesture testEq */
import * as test from '@mod-tollium/js/testframework';
var gesture_time = 200;


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/dragdrop.listtest')
    , waits: [ "ui" ]
    }

    // ---------------------------------------------------------------------------

  , { name: 'source.row1->target.row1_prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source',/Row 1/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 1/);

        test.sendMouseGesture([ { el: srow, x: 10, down: 0 }
                              , { el: trow, x: 10, up: 0, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row1->target.row1_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 T1 ontarget move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------

  , { name: 'source.row2->target.row1_prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 1/);

        // Should not drop
        test.sendMouseGesture([ { el: srow, x: 10, down: 0 }
                              , { el: trow, x: 10, up: 0, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'source.row2->target.row1_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------

  , { name: 'source.row2->target.row1_copy_prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 1/);

        test.sendMouseGesture([ { el: srow, x: 10, down: 0, ...test.keyboardCopyModifier }
                              , { el: trow, x: 10, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row2->target.row1_copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('2 T1 ontarget copy', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------

  , { name: 'source.row3->target.row1_copy_prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 3/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 1/);

        test.sendMouseGesture([ { el: srow, x: 10, down: 0, ...test.keyboardCopyModifier }
                              , { el: trow, x: 10, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'source.row3->target.row1_copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------

  , { name: 'source.row2->target.row2_copy_prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 2/);

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                              , { el: trow, x: 10, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'source.row2->target.row2_copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------

  , { name: 'source.row2->target.none_copy_prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        var trow = test.compByName('target').querySelector('.listbodyholder');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                         , { el: trow, x: 10, y: 100, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row2->none.row2_copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('2 n/a ontarget copy', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag row 2 into target void

  , { name: 'source.row2->target.none_copy_clickrow1'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        test.click(srow, { x: 10 });
      }
    , waits: [ "ui" ]
    }

  , { name: 'source.row2(sel:row1)->target.none_copy_prepare'
    , test: function(doc,win)
      {
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        var trow = test.compByName('target').querySelector('.listbodyholder');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                         , { el: trow, x: 10, y: 100, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row2(sel:row1)->none.row2_copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('2 n/a ontarget copy', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1 & row 2, drag row 2 into target void

  , { name: 'source.row2->target.none_copy_clickrow1'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        test.click(srow, { x: 10 });
      }
    , waits: [ "ui" ]
    }

  , { name: 'source.row2->target.none_copy_ctrlclickrow1'
    , test: function(doc,win)
      {
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        test.click(srow, { x: 10, cmd: true });
      }
    , waits: [ "ui" ]
    }

  , { name: 'source.row2(sel:row1)->target.none_copy_prepare'
    , test: function(doc,win)
      {
        var srow = test.getCurrentScreen().getListRow('source', /Row 2/);
        var trow = test.compByName('target').querySelector('.listbodyholder');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                         , { el: trow, x: 10, y: 100, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row2(sel:row1)->none.row2_copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1,2 n/a ontarget copy', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 4, drag row 4 into target void

  , { name: 'source.row4->target.none_copy_clickrow4'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        test.click(srow, { x: 10 });
      }
    , waits: [ "ui" ]
    }

  , { name: 'source.row4->target.none_copy_prepare'
    , test: function(doc,win)
      {
        var srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        var trow = test.compByName('target').querySelector('.listbodyholder');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                         , { el: trow, x: 10, y: 100, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'source.row4->target.none.copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 4, drag row 4 into target row 1

  , { name: 'source.row4->target.row1.copy_clickrow4'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        test.click(srow, { x: 10 });
      }
    , waits: [ "ui" ]
    }

  , { name: 'source.row4->target.row1.copy_prepare'
    , test: function(doc,win)
      {
        var srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 1/);

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                         , { el: trow, x: 10, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row4->target.row1.copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('4 T1 ontarget copy', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 4, drag row 4 into target row 1

  , { name: 'source.row4->target.row1.link_clickrow4'
    , test: async function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        test.click(srow, { x: 10 });

        await test.wait("ui");

        srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        var trow = test.getCurrentScreen().getListRow('target',/Row 3/);

        await test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0, ...test.keyboardLinkModifier }
                                    , { el: trow, x: 10, up: 0, ...test.keyboardLinkModifier, delay: gesture_time }
                                    ]);

        await test.wait("ui");
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('4 T3 ontarget link', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 4, drag nothing into target void

  , { name: 'source.void->target.row1.copy_clickrow4'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 4/);
        test.click(srow, { x: 10 });
      }
    , waits: [ "ui" ]
    }

  , { name: 'source.void->target.row1.copy_prepare'
    , test: function(doc,win)
      {
        var srow = test.compByName('source').querySelector('.listbodyholder');
        var trow = test.getCurrentScreen().getListRow('target',/Row 1/);

        test.sendMouseGesture([ { el: srow, x: 10, y: 140, cmd: 0, down: 0, ...test.keyboardCopyModifier }
                         , { el: trow, x: 10, up: 0, ...test.keyboardCopyModifier, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'source.void->target.row1.copy_test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row R1, drag to R1: no drag

  , { name: 'tree.r1.to.r1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('tree', /R1/).querySelector('span.text');
        var trow = test.getCurrentScreen().getListRow('tree', /R1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { relx: 30, delay: gesture_time } // move 30px to right
                         , { el: trow, x: 10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'tree.r1.to.r1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row R1, drag to R1.1: no drag

  , { name: 'tree.r1.to.r1.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('tree', /R1/).querySelector('span.text');
        var trow = test.getCurrentScreen().getListRow('tree', /R1.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, x: 10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui-nocheck" ]
    }

  , { name: 'tree.r1.to.r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row R1.1, drag to R1: drag

  , { name: 'tree.r1.1.to.r1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('tree', /R1.1/).querySelector('span.text');
        var trow = test.getCurrentScreen().getListRow('tree', /R1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, x: 10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'tree.r1.to.r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('R1.1 R1 ontarget move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row R3, drag to R3: drag

  , { name: 'tree.r3.to.r3-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('tree', /R3/).querySelector('span.text');
        var trow = test.getCurrentScreen().getListRow('tree', /R3/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { relx: 30, delay: gesture_time } // move a little
                         , { el: trow, x: 10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'tree.r3.to.r3-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('R3 R3 ontarget move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to before R1: drag insertbefore

  , { name: 'source-1-to-before-r1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
//                         , { relx: 30, delay: gesture_time } // move a little
                         , { el: trow, y: 1, x: 10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1 insertbefore move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to before R1 (too far to left): drag insertbefore 1.1

  , { name: 'source-1-to-before-r1.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
//                         , { relx: 30, delay: gesture_time } // move a little
                         , { el: trow, y: 1, x: -10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1.1 insertbefore move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to before R1 (too far to right): drag insertbefore 1.1

  , { name: 'source-1-to-before-r1.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
//                         , { relx: 30, delay: gesture_time } // move a little
                         , { el: trow, y: 1, x: 20, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1.1 insertbefore move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R1.2 (far left): drag insertbefore 1.2.1

  , { name: 'source-1-to-after-r1.2-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.2/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
//                         , { relx: 30, delay: gesture_time } // move a little
                         , { el: trow, y: 23, x: -10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1.2.1 insertbefore move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R1.2.1 (far left): drag insertbefore 1.2.1

  , { name: 'source-1-to-after-r1.2.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.2.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 23, x: -10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R2 insertbefore move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R1.2.1 (): drag insertbefore 1.2.1

  , { name: 'source-1-to-after-r1.2.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.2.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 23, x: 12, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1 appendchild move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R1.2.1 (): drag insertbefore 1.2.1

  , { name: 'source-1-to-after-r1.2.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.2.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 23, x: 22, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1 appendchild move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R1.2.1 (): drag insertbefore 1.2.1

  , { name: 'source-1-to-after-r1.2.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.2.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 23, x: 38, up: 0, delay: gesture_time * 1 }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1.2 appendchild move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R1.2.1 (far right): drag insertbefore 1.2.1

  , { name: 'source-1-to-after-r1.2.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R1.2.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 23, x: 40, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R1.2.1 appendchild move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to before R4 (far left): drag appendchild R3 (insertbefore R4 disallowed by flags)

  , { name: 'source-1-to-before-r1.4-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R4/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 1, x: -10, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R3 appendchild move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to before R4 (far right): drag appendchild R3 (appendchild R3.1 disallowed by flags)

  , { name: 'source-1-to-before-r1.4-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R4/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 1, x: 50, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R3 appendchild move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Select row 1, drag to after R2.1 (far right): drag intarget R2.1 (all positioned moves disallowed by flags)

  , { name: 'source-1-to-after-r2.1-prepare'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /R2.1/).querySelector('span.text');

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, y: 19, x: 50, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source-1-to-before-r1.1-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 R2.1 ontarget move', textarea.value);
      }
    }

    // ---------------------------------------------------------------------------
    // Drop on scrolled list (firefox regression)

  , { name: 'drop-on-scrolled-list-prepare'
    , test: function(doc,win)
      {
        var A01 = test.getMenu(['A01']);
        test.click(A01);
      }
    , waits: [ "ui" ]
    }

  , { name: 'drop-on-scrolled-list'
    , test: function(doc,win)
      {
        test.compByName('log').querySelector('textarea').value = '';
        var srow = test.getCurrentScreen().getListRow('source', /Row 1/);
        var trow = test.getCurrentScreen().getListRow('tree', /S18/).querySelector('span.text');

        console.log(srow, trow);

        test.sendMouseGesture([ { el: srow, x: 10, cmd: 0, down: 0 }
                         , { el: trow, x: 50, up: 0, delay: gesture_time }
                         ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'drop-on-scrolled-list-test'
    , test: function(doc,win)
      {
        var textarea = test.compByName('log').querySelector('textarea');
        testEq('1 S18 ontarget move', textarea.value);
      }
    }


  ]);
