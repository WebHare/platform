/* test props like disabled */

import * as test from '@mod-system/js/wh/testframework';

//FIXME: Test that parlsey backend plus plain POST (not RPC!) works

test.registerTests(
  [ { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?dynamic=1&disable=1'
    }

  , { name: 'Study page fields'
    , test: function()
      {
        test.true(test.qS("#dynamictest-myradio-15").disabled);
      }
    }
  ]);
