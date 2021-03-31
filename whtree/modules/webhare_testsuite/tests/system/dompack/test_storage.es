import * as test from "@mod-system/js/wh/testframework";

test.registerTests(
[ "Test isolated storage"
, async function()
  {
    window.localStorage.removeItem("testFwKey");

    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
    test.false(test.getWin().storageIsIsolated());
    test.eq(null, test.getWin().storageGetLocal("testFwKey"));
    test.getWin().storageSetLocal("testFwKey", {x:42});
    test.eq({x:42}, test.getWin().storageGetLocal("testFwKey"));

    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty&isolatestorage=1');
    test.true(test.getWin().storageIsIsolated());
    test.eq(null, test.getWin().storageGetLocal("testFwKey"));
    test.getWin().storageSetLocal("testFwKey", {x:43});
    test.eq({x:43}, test.getWin().storageGetLocal("testFwKey"));

    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
    test.eq({x:42}, test.getWin().storageGetLocal("testFwKey"));
  }
]);
