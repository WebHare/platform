import * as test from "@mod-system/js/wh/testframework";
var testurl = '/.webhare_testsuite/tests/pages/focuszones/';
var domfocus = require('@mod-system/js/dom/focus');

async function asyncClick(el)
{
  let target = el.getBoundingClientRect();
  // console.error(target, target.left, target.top, target.width, target.height);
  await test.asyncMouseClick(target.left + target.width/2, target.top + target.height/2);
  await test.wait("events");
}

test.registerTests(
  [ { loadpage: testurl
    , waits: [ 1 ] // Allow focus events to propagate
    }

  , { name: 'focus zones using mouse'
    , test: async function(doc,win)
      {
        test.true(doc.hasFocus(), "This test requires the browser to have focus");
        test.eq("Focused focuszone2", test.$t('log').lastElementChild.textContent, 'make sure the test has focus');
        test.true(domfocus.hasFocus(test.$t('input2_2')));
        test.eq('focuszone2', win.focusZones.getCurrentFocusZone().id);

        test.subtest("Focusing zone 1 by button from zone 2");

        await asyncClick(test.qS("#focuszone2 .tozone1"));

        console.log('(after fz 1 select) current focus zone id', win.focusZones.getCurrentFocusZone().id);
        test.eq('focuszone1', win.focusZones.getCurrentFocusZone().id);
        test.eq("Zone focuszone2 lost focus", test.$t('log').lastElementChild.textContent);
        test.true(domfocus.hasFocus(test.$t('input1_1')));

        test.subtest('Focusing zone 3 by button from zone 1');
        await asyncClick(test.qS("#focuszone1 .tozone3"));

        test.eq('focuszone3', win.focusZones.getCurrentFocusZone().id);
        test.eq("Zone focuszone1 lost focus", test.$t('log').lastElementChild.textContent);

        test.subtest('Refocus zone 1');
        win.focusZones.focusZone(test.$t('focuszone1'));
        await test.wait("events");

        test.eq("Zone focuszone3 lost focus", test.$t('log').lastElementChild.textContent);
        test.eq('focuszone1', win.focusZones.getCurrentFocusZone().id);
        test.true(domfocus.hasFocus(test.$t('input1_1')), "Focus was not returned to input1_1");

        test.subtest('Clicking steal button');
        await asyncClick(test.qS('.steal_input2_3'));
        test.eq('focuszone1', win.focusZones.getCurrentFocusZone().id, 'should have been ignored');

        test.subtest('Focusing zone2 by button from zone 1');
        await asyncClick(test.qS('#focuszone1 .tozone2'));
        test.eq('focuszone2', win.focusZones.getCurrentFocusZone().id);
        test.true(domfocus.hasFocus(test.$t('input2_3')), 'focus not returned to $wh.focused element while zone was inactive');
      }
    }

  , { loadpage: testurl //clear zone histories
    , waits: [ 1 ] // Allow focus events to propagate
    }

  , { name: 'focus zones programmatically'
    , test: async function(doc,win)
      {
        test.true(domfocus.hasFocus(test.$t('input2_2')));
        test.eq('focuszone2', win.focusZones.getCurrentFocusZone().id, 'verifying initial state');
        win.focusZones.focusZone(test.$t('focuszone1'));
        await test.wait("events");
        test.eq("Zone focuszone2 lost focus", test.$t('log').lastElementChild.textContent);

        test.subtest("focus zone 2");
        win.focusZones.focusZone(test.$t('focuszone2'));
        await test.wait("events");
        test.true(domfocus.hasFocus(test.$t('input2_2')), 'focus not returned to $wh.focused element while zone was inactive');
      }
    }

/*
  , { name: 'initial'
    , test: function(doc,win)
      {
        test.eq(test.$t('input2_2'),$wh.getCurrentlyFocusedElement());
        test.eq(2, $wh.getFocusableComponents(doc).length);
      }
    }*/


  ]);
