import * as test from '@mod-system/js/wh/testframework';
import { $qS, $qSA } from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

test.registerTests(
  [ { loadpage: test.getTestSiteRoot()
    }
  , { test: function(doc,win)
      {
        test.eq('\u2028unicode line separator,\u2029another separator', win.getTidTest().unicode2028);
      }
    }
  ]);
