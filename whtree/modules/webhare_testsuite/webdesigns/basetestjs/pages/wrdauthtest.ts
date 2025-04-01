import * as test from "@webhare/test-frontend";
import * as dompack from "@webhare/dompack";
import { qR } from "@webhare/dompack";
import { setupWRDAuth, isLoggedIn, login, logout, getUserInfo } from "@webhare/frontend";
import { stringify } from "@webhare/std";
import { rpc } from "@webhare/rpc";

async function validateLoggedinUser() {
  return await rpc("webhare_testsuite:testapi").validateLoggedinUser();
}

const frontendAuthApi = test.expose("frontendAuthApi", { isLoggedIn, login, logout, validateLoggedinUser });
void frontendAuthApi;
export type FrontendAuthApi = typeof frontendAuthApi;

dompack.register(".wrdauthtest", container => {
  // window.rpc = new JSONRPC({ url: '/wh_services/webhare_testsuite/formservice' });
  document.addEventListener('wh:wrdauth-loginfailed', event => { //TODO is this still part of the new api, and is the approach desirable?
    event.preventDefault();
    qR('#status').textContent = 'login failed';
  });

  qR<HTMLInputElement>('#js_isloggedin').checked = isLoggedIn();
});

function onNavLessLogin() {
  qR("#loginform_response").textContent = stringify({ userInfo: getUserInfo() }, { typed: true });
}

const params = new URL(location.href).searchParams;
const authopts: Parameters<typeof setupWRDAuth>[0] = {};
if (params.get("navlesslogin") === "1")
  authopts.onLogin = onNavLessLogin;

setupWRDAuth(authopts);
