/* To use this webserver, start WebHare with WEBHARE_WEBSERVER=node
*/

import * as webserver from "./webserver";
import { Configuration } from "./webconfig";
import * as services from "@webhare/services";

async function main() {
  const config = (await services.callHareScript("mod::system/lib/internal/webserver/config.whlib#DownloadWebserverConfig", [], { openPrimary: true })) as Configuration;

  //Remove the HS trusted port from our bindlist - we should stay away
  const trustedportidx = config.ports.findIndex(_ => _.id === -6 /*whwebserverconfig_hstrustedportid*/);
  if (trustedportidx >= 0)
    config.ports.splice(trustedportidx, 1);

  webserver.launch(config);
}

main();
