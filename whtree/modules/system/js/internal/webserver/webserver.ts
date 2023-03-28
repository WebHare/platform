import { coreWebHareRouter } from '@webhare/router/src/corerouter';
import { HTTPMethod, WebRequest } from '@webhare/router';
import * as env from "@webhare/env";
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
      //TODO timeout for receiving 'end' event or something else that discards too long requests
      let body = '';
      req.on('readable', function() {
        const inp = req.read();
        if (inp)
          body += inp;
      });

      await new Promise<void>(resolve =>
        req.on('end', function() {
          resolve();
        }));

      //FIXME verify whether host makes sense given the incoming port (ie virtualhost or force to IP ?)
      const finalurl = (port.privatekey ? "https://" : "http://") + req.headers.host + req.url;

      //Translate nodejs request to our Router stuff
      const webreq = new WebRequest(finalurl, { method: req.method.toLowerCase() as HTTPMethod, headers: req.headers as Record<string, string>, body });
      //TODO timeouts, separate VMs, whatever a Robust webserver Truly Requires
      const response = await coreWebHareRouter(webreq);
      for (const [key, value] of response.getHeaders())
        if (key !== 'set-cookie')
          res.setHeader(key, value);

      const cookies = response.getSetCookie();
      if (cookies)
        res.setHeader("set-cookie", cookies);

      //TODO freeze the WebResponse, log errors if any modification still occurs after we're supposedly done
      res.write(response.body);
      res.end();
    } catch (e) {
      this.handleException(e, req, res);
    }
  }

  handleException(e: unknown, req: http.IncomingMessage, res: http.ServerResponse) {
    //TODO log error
    res.statusCode = 500;
    if (!env.flags.etr) {
      res.setHeader("content-type", "text/html");
      res.end("<p>Internal server error");
      return; //and that's all you need to know without 'etr' ...
    }

    res.setHeader("content-type", "text/plain");
    if (e instanceof Error) {
      console.log(`Exception handling ${req.url}: `, e.message);
      res.end(`500 Internal server error\n\n${e.message}\n${e.stack}`);
    } else {
      res.end(`500 Internal server error\n\nDid not receive a proper Error`);
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
