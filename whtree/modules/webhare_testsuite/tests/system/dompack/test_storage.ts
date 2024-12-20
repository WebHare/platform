import * as test from "@webhare/test-frontend";
import * as dompack from "@webhare/dompack";
import { Money } from "@webhare/std";
import type { DompackApi } from "@mod-webhare_testsuite/web/tests/pages/dompack/dompackexample";

function runSharedTests() {
  const testApi = test.importExposed<DompackApi>("dompackApi");

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

  testApi.setLocal("complexKey", { m: new Money("42.42"), d: new Date("2022-04-02") });
  testApi.setSession("complexKey", { m: new Money("32.32"), d: new Date("2022-02-01") });
  test.eq({ m: new Money("42.42"), d: new Date("2022-04-02") }, testApi.getLocal("complexKey"));
  test.eq({ m: new Money("32.32"), d: new Date("2022-02-01") }, testApi.getSession("complexKey"));
}

test.runTests(
  [
    "Test plain storage",
    async function () {
      window.localStorage.removeItem("testFwKey");
      window.sessionStorage.removeItem("testFwKey");
      dompack.deleteCookie("testFwCookie");

      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
      const testApi = test.importExposed<DompackApi>("dompackApi");
      test.assert(!testApi.isStorageIsolated());
      runSharedTests();
    },

    "Test isolated storage",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty&isolatestorage=1');
      const testApi = test.importExposed<DompackApi>("dompackApi");
      test.assert(testApi.isStorageIsolated());
      runSharedTests();
    },

    "Test non-isolated storage again",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty'); //we need 'a' page, doesn't matter which
      const testApi = test.importExposed<DompackApi>("dompackApi");
      test.eq({ x: 42 }, testApi.getLocal("testFwKey"));
      test.eq({ x: 32 }, testApi.getSession("testFwKey"));
      test.eq(null, testApi.getCookie("testFwCookie"));
      test.assert(!testApi.listCookies().some(_ => _.name === "testFwCookie"));
    }
  ]);
