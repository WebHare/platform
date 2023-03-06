import { coreWebHareRouter } from '@webhare/router/src/corerouter';
import { HTTPMethod, WebRequest } from '@webhare/router';
import * as http from 'node:http';
import * as https from 'node:https';
import { Configuration, Port, initialconfig } from "./webconfig";

class WebServer {
  config: Configuration;
  ports: Array<{
    server: http.Server | https.Server;
  }> = [];

  constructor() {
    this.config = initialconfig;
  }

  async onRequest(port: Port, req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      if (!req.method || !req.url)
        throw new Error("Incomplete request?");

      console.log(`${req.method} ${req.headers.host} ${req.url}`);
      //FIXME verify whether host makes sense given the incoming port (ie virtualhost or force to IP ?)
      const finalurl = (port.privatekey ? "https://" : "http://") + req.headers.host + req.url;

      //Translate nodejs request to our Router stuff
      const webreq = new WebRequest(req.method as HTTPMethod, finalurl, new Headers(req.headers as Record<string, string>), ""); //FIXME pass the body too
      //TODO timeouts, separate VMs, whatever a Robust webserver Truly Requires
      const response = await coreWebHareRouter(webreq);
      //TODO freeze the WebResponse, log errors if any modification still occurs after we're supposedly done
      res.write(response.body);
      res.end();
    } catch (e) {
      res.statusCode = 500;
      res.end();
    }
  }

  reconfigure(config: Configuration) {
    for (const port of config.ports) {
      const serveroptions: https.ServerOptions = {};
      if (port.privatekey) {
        serveroptions.key = port.privatekey;
        serveroptions.cert = port.certificatechain;
      }

      const callback = (req: http.IncomingMessage, res: http.ServerResponse) => this.onRequest(port, req, res);
      const server = port.privatekey ? https.createServer(serveroptions, callback)
        : http.createServer(serveroptions, callback);
      server.on('error', e => console.log("Server error", e)); //TODO deal with EADDRINUSE for listen falures
      server.listen(port.port, port.ip);

      this.ports.push({ server });
    }
  }

  unref() {
    this.ports.forEach(_ => _.server.unref());
  }

  close() {
    this.ports.forEach(_ => _.server.close());
    this.ports = [];
  }
}

export async function launch(config: Configuration) {
  const ws = new WebServer();
  ws.reconfigure(config);
  return ws;
}
