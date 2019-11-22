import * as dompack from "dompack";
import { qS } from "dompack";
import * as wrdauth from "@mod-wrd/js/auth";

var JSONRPC = require("@mod-system/js/net/jsonrpc");

dompack.register(".wrdauthtest", container =>
{
  window.rpc = new JSONRPC({ url: '/wh_services/webhare_testsuite/formservice'});
  document.addEventListener('wh:wrdauth-loginfailed', event =>
  {
    event.preventDefault();
    qS('#status').textContent='login failed';
  });

  qS('#js_isloggedin').checked = wrdauth.getDefaultAuth().isLoggedIn();
});
