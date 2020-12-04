import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { name: "imagemap test"
    , loadpage: test.getTestSiteRoot() + `testsuiteportal/?app=webhare_testsuite:imagemap`
    , waits:['ui']
    }

  , {
      test:async function()
      {
        //first image is selected
        test.false(test.compByName("anybutton").classList.contains("todd--disabled"));
        test.false(test.compByName("anywithfocusbutton").classList.contains("todd--disabled"));
        test.true(test.compByName("oddbutton").classList.contains("todd--disabled"));

        test.click(test.compByName('icon').querySelectorAll('.t-image__overlay')[1]);
        await test.wait('ui'); //FIXME we shouldn't need this

        test.false(test.compByName("anybutton").classList.contains("todd--disabled"));
        test.false(test.compByName("anywithfocusbutton").classList.contains("todd--disabled"));
        test.false(test.compByName("oddbutton").classList.contains("todd--disabled"),'oddbutton should be enabled now, but has classes:' + test.compByName("oddbutton").className);

        test.click(test.compByName('overlays!list'));

        test.false(test.compByName("anybutton").classList.contains("todd--disabled"));
        test.true( test.compByName("anywithfocusbutton").classList.contains("todd--disabled"));
        test.false(test.compByName("oddbutton").classList.contains("todd--disabled"));
      }
    }

  ]);
