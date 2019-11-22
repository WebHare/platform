import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/tables.calendartest')
    , waits: [ 'ui' ]
    }

  , { name: 'verifylayout'
    , test:function(doc,win)
      {
        test.true(test.compByName('calendarholder').offsetHeight < 768, 'calendarholder too big'); //should not be escaping the screen

        //find our overlay
        var greenoverlay = test.$$t('[data-overlayid="GREENEVENT"]')[0];
        test.true(greenoverlay ,'overlay GREENEVENT not found');
        test.true(test.isElementClickable(greenoverlay));
        test.false(greenoverlay.classList.contains('todd-table--selected'));

        var redoverlay = test.$$t('[data-overlayid="REDEVENT"]')[0];
        test.true(redoverlay ,'overlay REDEVENT not found');
        test.true(test.isElementClickable(redoverlay));
        test.false(redoverlay.classList.contains('todd-table--selected'));

        var yellowoverlay = test.$$t('[data-overlayid="YELLOWEVENT"]')[0];
        test.true(yellowoverlay ,'overlay YELLOWEVENT not found');
        test.true(test.isElementClickable(yellowoverlay));
        test.false(yellowoverlay.classList.contains('todd-table--selected'));

        var purpleoverlay = test.$$t('[data-overlayid="PURPLEEVENT"]')[0];
        test.true(purpleoverlay ,'overlay PURPLEEVENT not found');
        test.true(test.isElementClickable(purpleoverlay));
        test.false(purpleoverlay.classList.contains('todd-table--selected'));

        test.true(greenoverlay.getBoundingClientRect().left < yellowoverlay.getBoundingClientRect().left, "green and yellow should partially overlap");

        //the 04:00 cell contains both green & yellow
        var overlappedcell = test.$$t('[data-todd-cellpos="9:6"]')[0];
        test.true(overlappedcell ,'overlapped cell 04:00 (9:6) not found');
        test.eq(Math.round(overlappedcell.getBoundingClientRect().left+1), greenoverlay.getBoundingClientRect().left);
        test.eq(Math.round(overlappedcell.getBoundingClientRect().right), yellowoverlay.getBoundingClientRect().right);

        //click in the overlapped cell, the yellow overlay should be selected
        var overlappedcoords = overlappedcell.getBoundingClientRect();
        test.sendMouseGesture([ { el: doc.body, down: 0, x: overlappedcoords.left + overlappedcoords.width/2, y: overlappedcoords.top + overlappedcoords.height/2 }, { up: 0 } ]);
        test.true(yellowoverlay.classList.contains('todd-table__overlay--selected'));
        test.false(greenoverlay.classList.contains('todd-table__overlay--selected'));

        //click the green overlay, it should be selected now
        test.click(greenoverlay);
        test.false(yellowoverlay.classList.contains('todd-table__overlay--selected'));
        test.true(greenoverlay.classList.contains('todd-table__overlay--selected'));

        //click in the overlapped cell, the green overlay should still be selected as it should be positioned before the yellow overlay
        test.sendMouseGesture([ { el: doc.body, down: 0, x: overlappedcoords.left + overlappedcoords.width/2, y: overlappedcoords.top + overlappedcoords.height/2 }, { up: 0 } ]);
        test.false(yellowoverlay.classList.contains('todd-table__overlay--selected'));
        test.true(greenoverlay.classList.contains('todd-table__overlay--selected'));

        //click again to open the appointment properties
        test.sendMouseGesture([ { el: doc.body, down: 0, x: overlappedcoords.left + overlappedcoords.width/2, y: overlappedcoords.top + overlappedcoords.height/2 }, { up: 0 } ]);
      }
    , waits: [ 'ui' ]
    }

  ]);
