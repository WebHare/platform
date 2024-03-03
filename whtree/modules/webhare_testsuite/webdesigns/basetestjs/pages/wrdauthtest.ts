import * as dompack from "@webhare/dompack";
import { qR } from "@webhare/dompack";
import { setupWRDAuth, isLoggedIn, login } from "@webhare/frontend";
import { logout } from "@webhare/frontend/src/auth";

const frontendTestApi = { isLoggedIn, login, logout };

export type FrontendTestApi = typeof frontendTestApi;

declare global {
  interface Window {
    frontendTestApi: FrontendTestApi;
  }
}

window.frontendTestApi = frontendTestApi;

dompack.register(".wrdauthtest", container => {
  // window.rpc = new JSONRPC({ url: '/wh_services/webhare_testsuite/formservice' });
  document.addEventListener('wh:wrdauth-loginfailed', event => {
    event.preventDefault();
    qR('#status').textContent = 'login failed';
  });

  qR<HTMLInputElement>('#js_isloggedin').checked = isLoggedIn();
});

setupWRDAuth();
