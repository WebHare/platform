/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.formtest");
    },

    {
      name: 'textfields ',
      test: async function (doc, win) {
        const richhtmlcomp = test.compByName('richhtmlcomp');
        const richplaincomp = test.compByName('richplaincomp');

        test.eqHTML('<b>Bold <a href="#link">link</a>!</b>', richhtmlcomp.innerHTML);
        test.eq('<plaintext', richplaincomp.textContent);

        //cause onclicklink to trigger
        test.click(richhtmlcomp.querySelector('a'), { x: 2, y: 2 });
        await test.waitForUI();
      }
    },
    {
      name: 'onclicklink',
      test: function (doc, win) {
        const richplaincomp = test.compByName('richplaincomp');
        test.eq(doc.location.href.split('#')[0] + '#link', richplaincomp.textContent);
      }
    },

    {
      name: 'setvalue',
      test: async function (doc, win) {
        //initially unset
        const textfield = test.compByName('v01').querySelector('input');
        test.eq('', textfield.value);

        const selects = test.getCurrentScreen().qSA('select');

        test.eq(1, selects.length); //ADDME this will probably break once custom selects reappear
        test.eq('o02', selects[0].propTodd.getValue());

        selects[0].propTodd.setValue('o01');
        //won't trigger a ui wait probably until we go back to custom selects
        await test.waitForUI({ optional: true });
      }
    },

    {
      name: 'setvalue2',
      test: async function (doc, win) {
        const textfield = test.compByName('v01').querySelector('input');
        test.eq('o01', textfield.value);

        const F01 = test.getMenu(['F01']);
        test.click(F01);
        await test.waitForUI();
      }
    },

    {
      name: 'settextvalues',
      test: function (doc, win) {
        const richhtmlcomp = test.compByName('richhtmlcomp');
        const richplaincomp = test.compByName('richplaincomp');

        test.eqHTML('before » after', richhtmlcomp.innerHTML);
        test.eq('before » after', richplaincomp.textContent);
      }
    }
  ]);
