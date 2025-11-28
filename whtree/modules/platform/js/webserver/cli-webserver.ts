/* To use this webserver as the main webserver, start WebHare with WEBHARE_WEBSERVER=node
   To test it (with only the interface) start it with --rescue=[ip:]<portnumber>
   eg wh run mod::platform/js/webserver/cli-webserver.ts --rescueport 8888
*/

import { WebServerConsoleLogger, WebServerFileLogger } from "./logger";
import * as webserver from "./webserver";
import { run } from "@webhare/cli";

run({
  description: "WebHare Webserver",
  options: {
    "rescueport": { description: "Open only a rescue server at the specified port" },
  },
  async main({ opts }) {
    let rescuePort: number | null = null;
    let rescueIp = '127.0.0.1';

    if (opts.rescueport) {
      const parts = opts.rescueport.match(/^(.*:)?(\d+)$/);
      if (!parts)
        throw new Error(`Invalid --rescue specification: ${opts.rescueport}`);
      rescuePort = parseInt(parts[2]!);
      if (rescuePort < 1 || rescuePort > 65535)
        throw new Error(`Invalid listening port ${rescuePort}`);

      if (parts[1])
        rescueIp = parts[1];

      console.log(`Opening rescue interface on http://${rescueIp}:${rescuePort}/`);
    }

    new webserver.WebServer("platform:webserver", {
      rescuePort: rescuePort || undefined,
      rescueIp,
      logger: rescuePort ? new WebServerConsoleLogger : new WebServerFileLogger
    });
  }
});
