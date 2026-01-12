import * as test from "@webhare/test-frontend";
import * as dompack from "@webhare/dompack";
import { qR } from "@webhare/dompack";
import { setupWRDAuth, isLoggedIn, login, logout, getUserInfo, navigateTo, startSSOLogin } from "@webhare/frontend";
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
  qR<HTMLInputElement>('#js_fullname').value = getUserInfo<{ firstName: string }>()?.firstName || '';
});

function onNavLessLogin() {
  qR("#loginform_response").textContent = stringify({ userInfo: getUserInfo() }, { typed: true });
}

const params = new URL(location.href).searchParams;
const authopts: Parameters<typeof setupWRDAuth>[0] = {};
if (params.get("navlesslogin") === "1")
  authopts.onLogin = onNavLessLogin;

dompack.register("#customclaimbutton", node => node.addEventListener("click", () => {
  void rpc("webhare_testsuite:testapi").getCustomClaimAction().then(instr => navigateTo(instr));
}));
dompack.register("#ssobutton", node => node.addEventListener("click", () => {
  void startSSOLogin("TESTFW_OIDC_SP");
}));
dompack.register("#ssopassivebutton", node => {
  if (location.hash === "#passivelogin") {
    qR("#ssopassivestatus").textContent = "Completed passive SSO login";
    location.hash = "#";
  }
  node.addEventListener("click", () => {
    qR("#ssopassivestatus").textContent = "Starting passive SSO login...";
    location.hash = "#passivelogin";
    void startSSOLogin("TESTFW_OIDC_SP", { passive: true });
  });
});

setupWRDAuth(authopts);
