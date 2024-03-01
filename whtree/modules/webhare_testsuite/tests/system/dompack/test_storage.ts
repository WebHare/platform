import * as test from "@webhare/test-frontend";
import * as dompack from "@webhare/dompack";

function runSharedTests() {
  const testApi = test.getWin().__testApi;

  test.eq(null, testApi.getLocal("testFwKey"));
  test.eq(null, testApi.getSession("testFwKey"));
  test.eq(null, testApi.getCookie("testFwCookie"));
  test.assert(!testApi.listCookies().some(_ => _.name === "testFwCookie"));

  testApi.setLocal("testFwKey", { x: 42 });
  testApi.setSession("testFwKey", { x: 32 });
  testApi.setCookie("testFwCookie", "x:22");
  test.eq({ x: 42 }, testApi.getLocal("testFwKey"));
  test.eq({ x: 32 }, testApi.getSession("testFwKey"));
  test.eq("x:22", testApi.getCookie("testFwCookie"));
  test.assert(testApi.listCookies().some(_ => _.name === "testFwCookie"));
  testApi.deleteCookie("testFwCookie");
  test.assert(!testApi.listCookies().some(_ => _.name === "testFwCookie"));
}

test.run(
  [
    "Test plain storage",
    async function () {
      window.localStorage.removeItem("testFwKey");
      window.sessionStorage.removeItem("testFwKey");
      dompack.deleteCookie("testFwCookie");

      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
      const testApi = test.getWin().__testApi;
      test.assert(!testApi.isStorageIsolated());
      runSharedTests();
    },

    "Test isolated storage",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty&isolatestorage=1');
      const testApi = test.getWin().__testApi;
      test.assert(testApi.isStorageIsolated());
      runSharedTests();
    },

    "Test non-isolated storage again",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
      const testApi = test.getWin().__testApi;
      test.eq({ x: 42 }, testApi.getLocal("testFwKey"));
      test.eq({ x: 32 }, testApi.getSession("testFwKey"));
      test.eq(null, testApi.getCookie("testFwCookie"));
      test.assert(!testApi.listCookies().some(_ => _.name === "testFwCookie"));
    }
  ]);
