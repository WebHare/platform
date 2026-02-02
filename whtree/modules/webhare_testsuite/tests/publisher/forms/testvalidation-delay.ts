/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-system/js/wh/testframework';
// import * as dompack from 'dompack';

test.runTests(
  [
    'Test validation running too fast when a radio is focused',
    async function () {

      await test.load(test.getTestSiteRoot() + 'testpages/formtest/');

      /* If a required radio is focused, and you select a different radio, required validation will temporarily show up
         as focus is lost. and if this error moves the radio button away from the mouse position (due to eg. vertical centering
         or the error appearing above the radio buttons), mouseup will miss it and no click will fire.

         We fix this by delaying validation until mouseup */
      test.focus('#coretest-requiredradio-x');

      test.sendMouseGesture([{ el: test.qS('#coretest-requiredradio-y'), down: 0 }]);
      await test.sleep(25); //give any async updates a chance to interfere
      test.assert(!test.qS(`[data-wh-form-group-for="requiredradio"]`).classList.contains("wh-form__fieldgroup--error"));
      test.sendMouseGesture([{ up: 0 }]);
      await test.sleep(25); //give any async updates a chance to interfere
      test.assert(!test.qS(`[data-wh-form-group-for="requiredradio"]`).classList.contains("wh-form__fieldgroup--error"));
    },

    'Test validation executing on radio after focus loss',
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/');

      /* If a required radio is focused, and you select a different radio, required validation will temporarily show up
         as focus is lost. and if this error moves the radio button away from the mouse position (due to eg. vertical centering
         or the error appearing above the radio buttons), mouseup will miss it and no click will fire.

         We fix this by delaying validation until mouseup */
      test.focus('#coretest-requiredradio-x');
      test.click('#coretest-pulldowntest');
      await test.waitForUI();

      test.assert(test.qS(`[data-wh-form-group-for="requiredradio"]`).classList.contains("wh-form__fieldgroup--error"));
    }
  ]);


//      test.sendMouseGesture([ { el: test.qS('#coretest-requiredradio-y'), down: 0, x: 100 } ]); //click far past the element
