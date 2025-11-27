/* To use this webserver as the main webserver, start WebHare with WEBHARE_WEBSERVER=node
   To test it (with only the interface) start it with --rescue=[ip:]<portnumber>
   eg wh run mod::system/js/internal/webserver/cli-webserver.ts --rescueport 8888
*/

import * as webserver from "./webserver";
import type { Configuration } from "./webconfig";
import { loadlib } from "@webhare/harescript";
import { run } from "@webhare/cli";

run({
  description: "WebHare Webserver",
  options: {
    "rescueport": { description: "Open only a rescue server at the specified port" },
  },
  async main({ opts }) {
    const config = await loadlib("mod::system/lib/internal/webserver/config.whlib").DownloadWebserverConfig() as Configuration;

    //Remove the HS trusted port from our bindlist - that one needs to be held by the HS webserver
    const trustedportidx = config.ports.findIndex(_ => _.id === -6 /*whwebserverconfig_hstrustedportid*/);
    if (trustedportidx >= 0)
      config.ports.splice(trustedportidx, 1);

    if (opts.rescueport) {
      const parts = opts.rescueport.match(/^(.*:)?(\d+)$/);
      if (!parts)
        throw new Error(`Invalid --rescue specification: ${opts.rescueport}`);
      const portnumber = parseInt(parts[2]!);
      if (portnumber < 1 || portnumber > 65535)
        throw new Error(`Invalid listening port ${portnumber}`);

      config.ports = config.ports.filter(_ => _.id === -4); //keeps only the original 13679 rescueport
      config.ports[0].port = portnumber;
      config.ports[0].ip = parts[1] || "127.0.0.1";
      console.log(`Opening rescue interface on http://${config.ports[0].ip}:${config.ports[0].port}/`);
    }

    await webserver.launch(config);
  }
});
