/* To directly invoke:
   wh run mod::system/js/internal/webserver/cli-webserver.ts

   May require you to mask port 80 and 443 as used by WebHare by using;
   __WEBHARE_WEBSERVER_IGNOREPORTS=80,443 wh console
*/

import * as webserver from "./webserver";
import { Configuration } from "./webconfig";
import * as services from "@webhare/services";

services.ready().then(async () => {
  const config = (await services.callHareScript("mod::system/lib/internal/webserver/config.whlib#DownloadWebserverConfig", [], { openPrimary: true })) as Configuration;

  //FIXME: locally we usually have multiple identical listeners for port 80 and 443. we'll take the first of either and reset the IP (as needed by mac tobind <1024)
  //       but we *should* just honor the actual configuration

  //also binding avoid the 13679+ ports to not get in the way of the real webhare webserver
  const firstport80 = config.ports.find(_ => _.port === 80);
  const firstport443 = config.ports.find(_ => _.port === 443);

  config.ports = [];
  if (firstport80)
    config.ports.push({ ...firstport80, ip: '' });
  if (firstport443)
    config.ports.push({ ...firstport443, ip: '' });
  config.ports.filter(_ => [80, 443].includes(_.port));
  webserver.launch(config);
});
