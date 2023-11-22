import { coreWebHareRouter, getHSWebserverTarget } from '@webhare/router/src/corerouter';
import { HTTPMethod, WebRequest } from '@webhare/router';
import * as env from "@webhare/env";
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import { Configuration, Port, Host, initialconfig } from "./webconfig";
import { IncomingWebRequest } from "@webhare/router/src/request";

class WebServerPort {
  server: http.Server | https.Server;
  fixedHost: Host | undefined;
  overrideHost: string | undefined;
  readonly port: Port;

  constructor(port: Port, fixedHost: Host | undefined) {
    this.port = port;
    this.fixedHost = fixedHost;
    if (fixedHost)
      this.overrideHost = new URL(fixedHost.baseurl).host; //host can include :port!

    const serveroptions: https.ServerOptions = {};
    if (port.privatekey) {
      serveroptions.key = port.privatekey;
      serveroptions.cert = port.certificatechain;
    }

    const callback = (req: http.IncomingMessage, res: http.ServerResponse) => this.onRequest(req, res);
    this.server = port.privatekey ? https.createServer(serveroptions, callback)
      : http.createServer(serveroptions, callback);
    this.server.on('error', e => console.log("Server error", e)); //TODO deal with EADDRINUSE for listen falures
    this.server.on('upgrade', (req, socket, head) => this.forwardUpgrade(req, socket as net.Socket, head));
    this.server.listen(port.port, port.ip);
  }

  buildWebRequest(req: http.IncomingMessage, body?: string): WebRequest {
    //FIXME verify whether host makes sense given the incoming port (ie virtualhost or force to IP ?)
    //FIXME ensure clientWebServer is also set for virtualhosted URLs
    const finalurl = (this.port.privatekey ? "https://" : "http://") + (this.overrideHost || req.headers.host) + req.url;

    //Translate nodejs request to our Router stuff
    const webreq = new IncomingWebRequest(finalurl, {
      method: req.method!.toLowerCase() as HTTPMethod,
      headers: req.headers as Record<string, string>,
      body,
      clientWebServer: this.fixedHost?.id || 0
    });
    return webreq;
  }

  async onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      if (!req.method || !req.url)
        throw new Error("Incomplete request?");

      console.log(`${req.method} ${req.headers.host} ${req.url}`);
      //TODO timeout for receiving 'end' event or something else that discards too long requests
      let body = '';
      req.on('readable', function () {
        const inp = req.read();
        if (inp)
          body += inp;
      });

      await new Promise<void>(resolve =>
        req.on('end', function () {
          resolve();
        }));

      //TODO timeouts, separate VMs, whatever a Robust webserver Truly Requires
      const webreq = this.buildWebRequest(req, body);
      const response = await coreWebHareRouter(webreq);
      for (const [key, value] of response.getHeaders())
        if (key !== 'set-cookie')
          res.setHeader(key, value);

      const cookies = response.getSetCookie();
      if (cookies)
        res.setHeader("set-cookie", cookies);

      //TODO freeze the WebResponse, log errors if any modification still occurs after we're supposedly done
      res.write(new Uint8Array(await response.arrayBuffer()));
      res.end();
    } catch (e) {
      this.handleException(e, req, res);
    }
  }

  async forwardUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const webreq = this.buildWebRequest(req);
    //forward it unconditionally (TODO integrate with router ?)
    const { targeturl, fetchmethod, headers } = getHSWebserverTarget(webreq);

    //FIXME deal with upstream connect errors
    const destreq = http.request(targeturl, { headers, method: fetchmethod });
    destreq.end();
    destreq.on('upgrade', (res, nextsocket, upgradeHead) => {
      //We need to return the headers, or at minimum: sec-websocket-accept
      //TODO accesslog something about this connection. or just at the end/termination ?
      socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
        Object.entries(res.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + "\r\n");
      socket.write(upgradeHead);
      nextsocket.write(head);
      nextsocket.pipe(socket);
      socket.pipe(nextsocket);
    });
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
}

class WebServer {
  config: Configuration;
  ports = new Set<WebServerPort>();

  constructor() {
    this.config = initialconfig;
  }

  reconfigure(config: Configuration) {
    for (const port of config.ports) {
      const fixedhost = !port.virtualhost ? config.hosts.find(_ => _.port == port.id) : undefined;
      this.ports.add(new WebServerPort(port, fixedhost));
    }
  }

  unref() {
    this.ports.forEach(_ => _.server.unref());
  }

  close() {
    this.ports.forEach(_ => _.server.close());
    this.ports.clear();
  }
}

export async function launch(config: Configuration) {
  const ws = new WebServer();
  ws.reconfigure(config);
  return ws;
}
