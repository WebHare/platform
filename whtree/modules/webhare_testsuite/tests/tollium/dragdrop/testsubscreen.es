import * as test from '@mod-tollium/js/testframework';
import { $qSA } from '@mod-tollium/js/testframework';
var gesture_time = 200;

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/dragdrop.subscreen')
    , waits: [ "ui" ]
    }

  , { name: 'source.row1->target.row1_prepare'
    , test: function(doc,win)
      {
        let toplog = $qSA('t-textarea')[0];
        let bottomlog = $qSA('t-textarea')[1]
        let topsource = $qSA('.wh-ui-listview[data-name$=source]')[0]
        let bottomtarget = $qSA('.wh-ui-listview[data-name$=target]')[1]

        test.eq('', toplog.querySelector('textarea').value);
        test.eq('', bottomlog.querySelector('textarea').value);

        var srow = test.getCurrentScreen().getListRow(topsource.dataset.name,"Row 1: type1");
        var trow = test.getCurrentScreen().getListRow(bottomtarget.dataset.name,"Row 1: Can add");
        test.sendMouseGesture([ { el: srow, x: 10, down: 0 }
                              , { el: trow, x: 10, up: 0, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui" ]
    }

  , { name: 'source.row1->target.row1_test'
    , test: function(doc,win)
      {
        test.eq('1 T1 ontarget move', $qSA('t-textarea')[1].querySelector('textarea').value);
      }
    }
  ]);
