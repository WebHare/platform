import * as dompack from "@webhare/dompack";
import * as test from "@webhare/test-frontend";
import { qR } from "@webhare/dompack";
import { setupWRDAuth, isLoggedIn, login, logout } from "@webhare/frontend";
import type { TestNoAuthJS } from "@mod-webhare_testsuite/js/jsonrpc/service";
import { createClient } from "@webhare/jsonrpc-client/src/jsonrpc-client";

const noAuthJSService = createClient<TestNoAuthJS>("webhare_testsuite:testnoauthjs");

async function validateLoggedinUser() {
  return await noAuthJSService.validateLoggedinUser(location.pathname);
}

const frontendAuthApi = test.expose("frontendAuthApi", { isLoggedIn, login, logout, validateLoggedinUser });
export type FrontendAuthApi = typeof frontendAuthApi;

dompack.register(".wrdauthtest", container => {
  // window.rpc = new JSONRPC({ url: '/wh_services/webhare_testsuite/formservice' });
  document.addEventListener('wh:wrdauth-loginfailed', event => {
    event.preventDefault();
    qR('#status').textContent = 'login failed';
  });

  qR<HTMLInputElement>('#js_isloggedin').checked = isLoggedIn();
});

setupWRDAuth();
