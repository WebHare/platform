import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,table2')
    , waits: [ 'ui' ]
    }

  ]);
