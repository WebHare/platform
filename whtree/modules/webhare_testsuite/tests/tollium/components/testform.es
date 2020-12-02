import * as test from "@mod-tollium/js/testframework";


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.formtest')
    , waits: [ 'ui' ]
    }

  , { name: 'textfields '
    , test:function(doc,win)
      {
        var richhtmlcomp = test.compByName('richhtmlcomp');
        var richplaincomp = test.compByName('richplaincomp');

        test.eqHTML('<b>Bold <a href="#link">link</a>!</b>', richhtmlcomp.innerHTML);
        test.eq('<plaintext', richplaincomp.textContent);

        //cause onclicklink to trigger
        test.click(richhtmlcomp.querySelector('a'), {x:2,y:2});
      }
    , waits: [ 'ui' ]
    }
  , { name: 'onclicklink'
    , test: function(doc,win)
      {
        var richplaincomp = test.compByName('richplaincomp');
        test.eq(doc.location.href.split('#')[0] + '#link', richplaincomp.textContent);
      }
    }

  , { name: 'setvalue'
    , test:function(doc,win)
      {
        //initially unset
        var textfield = test.compByName('v01').querySelector('input');
        test.eq('', textfield.value);

        var selects = test.getCurrentScreen().qSA('select');

        test.eq(1, selects.length); //ADDME this will probably break once custom selects reappear
        test.eq('o02', selects[0].propTodd.getValue());

        selects[0].propTodd.setValue('o01');
      }
    , waits: [ 'ui-nocheck' ] //won't trigger a ui wait probably until we go back to custom selects
    }

  , { name: 'setvalue2'
    , test:function(doc,win)
      {
        var textfield = test.compByName('v01').querySelector('input');
        test.eq('o01', textfield.value);

        var F01 = test.getMenu(['F01']);
        test.click(F01);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'settextvalues'
    , test:function(doc,win)
      {
        var richhtmlcomp = test.compByName('richhtmlcomp');
        var richplaincomp = test.compByName('richplaincomp');

        test.eqHTML('before » after', richhtmlcomp.innerHTML);
        test.eq('before » after', richplaincomp.textContent);
      }
    }
  ]);
