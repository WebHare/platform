import * as dompack from "@webhare/dompack";
import { qR } from "@webhare/dompack";
import { setupWRDAuth } from "@webhare/frontend";

dompack.register(".wrdauthtest", container => {
  // window.rpc = new JSONRPC({ url: '/wh_services/webhare_testsuite/formservice' });
  document.addEventListener('wh:wrdauth-loginfailed', event => {
    event.preventDefault();
    qR('#status').textContent = 'login failed';
  });
});

setupWRDAuth();
