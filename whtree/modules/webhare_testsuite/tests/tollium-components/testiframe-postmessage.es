import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.iframetest')
    , waits: [ 'ui' ]
    }
  , { name: 'postmessage'
    , test: async function()
      {
        test.compByName('callbacks').querySelector('textarea').value='';
        test.click(test.getMenu(['I06'])); //postmessage

        await test.wait(function() { return !!test.compByName('callbacks').querySelector('textarea').value });

        let result = test.compByName('callbacks').querySelector('textarea').value;
        let origin = test.getWin().location.origin;
        test.eq(`message:{"question":1764}\norigin:${origin}`, result);
      }
    }
  , { name: 'postrequest'
    , test: async function()
      {
        test.compByName('callbacks').querySelector('textarea').value='';
        test.click(test.getMenu(['I07'])); //postrequest

        await test.wait(function() { return !!test.compByName('callbacks').querySelector('textarea').value });

        let result = test.compByName('callbacks').querySelector('textarea').value;
        test.eq(`response:{"response":1764}`, result);
      }
    }
  ]);
