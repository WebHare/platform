import * as test from "@mod-system/js/wh/testframework";
import * as cookie from "dompack/extra/cookie";

test.registerTests(
[ "Test isolated storage"
, async function()
  {
    window.localStorage.removeItem("testFwKey");
    window.sessionStorage.removeItem("testFwKey");
    cookie.remove("testFwCookie");

    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
    test.false(test.getWin().storageIsIsolated());

    test.eq(null, test.getWin().storageGetLocal("testFwKey"));
    test.eq(null, test.getWin().storageGetSession("testFwKey"));
    test.eq(null, test.getWin().cookieRead("testFwCookie"));
    test.false(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));

    test.getWin().storageSetLocal("testFwKey", {x:42});
    test.getWin().storageSetSession("testFwKey", {x:32});
    test.getWin().cookieWrite("testFwCookie", "x:22");
    test.eq({x:42}, test.getWin().storageGetLocal("testFwKey"));
    test.eq({x:32}, test.getWin().storageGetSession("testFwKey"));
    test.eq("x:22", test.getWin().cookieRead("testFwCookie"));
    test.true(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));

    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty&isolatestorage=1');
    test.true(test.getWin().storageIsIsolated());
    test.eq(null, test.getWin().storageGetLocal("testFwKey"));
    test.eq(null, test.getWin().storageGetSession("testFwKey"));
    test.eq(null, test.getWin().cookieRead("testFwCookie"));
    test.false(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));

    test.getWin().storageSetLocal("testFwKey", {x:43});
    test.getWin().storageSetSession("testFwKey", {x:33});
    test.getWin().cookieWrite("testFwCookie", "x:23");
    test.eq({x:43}, test.getWin().storageGetLocal("testFwKey"));
    test.eq({x:33}, test.getWin().storageGetSession("testFwKey"));
    test.eq("x:23", test.getWin().cookieRead("testFwCookie"));
    test.true(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));
    test.getWin().cookieRemove("testFwCookie");
    test.false(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));

    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
    test.eq({x:42}, test.getWin().storageGetLocal("testFwKey"));
    test.eq({x:32}, test.getWin().storageGetSession("testFwKey"));
    test.eq("x:22", test.getWin().cookieRead("testFwCookie"));
    test.true(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));
    test.getWin().cookieRemove("testFwCookie");
    test.false(test.getWin().cookieList().some(_ => _.name == "testFwCookie"));
  }
]);
