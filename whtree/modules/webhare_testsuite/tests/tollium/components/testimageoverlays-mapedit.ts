/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";

test.runTests(
  [
    {
      name: "imagemap test",
      loadpage: test.getTestSiteRoot() + `testsuiteportal/?app=webhare_testsuite:imagemap`,
      waits: ['ui']
    },

    {
      test: async function () {
        //first image is selected
        test.assert(!test.compByName("anybutton").classList.contains("todd--disabled"));
        test.assert(!test.compByName("anywithfocusbutton").classList.contains("todd--disabled"));
        test.assert(test.compByName("oddbutton").classList.contains("todd--disabled"));

        test.click(test.compByName('icon').querySelectorAll('.t-image__overlay')[1]);
        await test.waitForUI(); //FIXME we shouldn't need this

        test.assert(!test.compByName("anybutton").classList.contains("todd--disabled"));
        test.assert(!test.compByName("anywithfocusbutton").classList.contains("todd--disabled"));
        test.assert(!test.compByName("oddbutton").classList.contains("todd--disabled"), 'oddbutton should be enabled now, but has classes:' + test.compByName("oddbutton").className);

        test.click(test.compByName('overlays!list'));

        test.assert(!test.compByName("anybutton").classList.contains("todd--disabled"));
        test.assert(test.compByName("anywithfocusbutton").classList.contains("todd--disabled"));
        test.assert(!test.compByName("oddbutton").classList.contains("todd--disabled"));
      }
    }

  ]);
