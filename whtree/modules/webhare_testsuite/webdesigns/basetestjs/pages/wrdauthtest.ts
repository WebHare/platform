import * as dompack from "@webhare/dompack";
import * as test from "@webhare/test-frontend";
import { qR } from "@webhare/dompack";
import { setupWRDAuth, isLoggedIn, login, logout } from "@webhare/frontend";

const frontendAuthApi = test.expose("frontendAuthApi", { isLoggedIn, login, logout });
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
