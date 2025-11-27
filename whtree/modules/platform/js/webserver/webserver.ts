import { coreWebHareRouter, getHSWebserverTarget } from '@webhare/router/src/corerouter';
import type { HTTPMethod, WebRequest } from '@webhare/router';
import * as env from "@webhare/env";
import type * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import { type Configuration, type Port, type Host, initialconfig } from "./webconfig";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { BackendServiceConnection, runBackendService } from '@webhare/services';
import type { WebHareService } from '@webhare/services/src/backendservicerunner';
import { loadlib } from '@webhare/harescript';

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

    const callback = (req: http.IncomingMessage, res: http.ServerResponse) => void this.onRequest(req, res);
    this.server = port.privatekey ? https.createServer(serveroptions, callback)
      : http.createServer(serveroptions, callback);
    this.server.on('error', e => console.log("Server error", e)); //TODO deal with EADDRINUSE for listen falures
    this.server.on('upgrade', (req, socket, head) => this.forwardUpgrade(req, socket as net.Socket, head));
    this.server.listen(port.port, port.ip);
  }

  buildWebRequest(req: http.IncomingMessage, body?: ArrayBuffer | null): WebRequest {
    //FIXME verify whether host makes sense given the incoming port (ie virtualhost or force to IP ?)
    //FIXME ensure clientWebServer is also set for virtualhosted URLs
    const finalurl = (this.port.privatekey ? "https://" : "http://") + (this.overrideHost || req.headers.host) + req.url;

    //Translate nodejs request to our Router stuff
    const webreq = new IncomingWebRequest(finalurl, {
      method: req.method!.toUpperCase() as HTTPMethod,
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
      const bodyParts = new Array<Buffer>;
      let bodyLength = 0;
      req.on('readable', function () {
        const inp = req.read();
        if (inp) {
          bodyParts.push(inp);
          bodyLength += inp.length;
        }
      });

      await new Promise<void>(resolve =>
        req.on('end', function () {
          resolve();
        }));

      const body = new Uint8Array(bodyLength);
      let offset = 0;
      for (const part of bodyParts) {
        body.set(part, offset);
        offset += part.length;
      }

      //TODO timeouts, separate VMs, whatever a Robust webserver Truly Requires
      const webreq = this.buildWebRequest(req, body.buffer);
      const response = await coreWebHareRouter(webreq);
      res.statusCode = response.status;

      for (const [key, value] of response.headers.entries())
        res.setHeader(key, value); //entries() returns all individual cookie headers so expanding getSetCookie is not needed

      //TODO freeze the WebResponse, log errors if any modification still occurs after we're supposedly done
      res.write(new Uint8Array(await response.arrayBuffer()));
      res.end();
    } catch (e) {
      this.handleException(e, req, res);
    }
  }

  forwardUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const webreq = this.buildWebRequest(req);
    //forward it unconditionally (TODO integrate with router ?)
    const { targeturl, fetchmethod, headers } = getHSWebserverTarget(webreq);

    //FIXME deal with upstream connect errors
    const destreq = http.request(targeturl, { headers, method: fetchmethod });
    destreq.end();
    destreq.on('upgrade', (res, nextsocket, upgradeHead) => {
      try {
        //Handle ECONNRESET errors. Just disconnect
        socket.on("error", err => {
          console.error("Socket error", err.message);
          socket.destroy();
          nextsocket.destroy();
        });
        nextsocket.on("error", err => {
          console.error("NextSocket error", err.message);
          socket.destroy();
          nextsocket.destroy();
        });
        //We need to return the headers, or at minimum: sec-websocket-accept
        //TODO accesslog something about this connection. or just at the end/termination ?
        socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
          Object.entries(res.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + "\r\n");
        socket.write(upgradeHead);
        nextsocket.write(head,);
        nextsocket.pipe(socket);
        socket.pipe(nextsocket);
      } catch (e) {
        console.error("Exception forwarding websocket", (e as Error).message);
        socket.destroy();
        nextsocket.destroy();
      }
    });
  }

  handleException(e: unknown, req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      //TODO log error
      res.statusCode = 500;
      if (!env.debugFlags.etr) {
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
    } catch (e2) {
      //without this handler, I/O errors during finishing will crash the server with uncaught exception
      console.error("Exception handling exception", e2);
      req.socket.destroy();
    }
  }
}

class WebServerClient extends BackendServiceConnection {
  constructor(public ws: WebServer) {
    super();
  }
  async reloadConfig() {
    return await this.ws.loadConfig();
  }
}

export class WebServer {
  config: Configuration;
  ports = new Set<WebServerPort>();
  service: WebHareService | null = null;
  rescuePort;
  rescueIp;
  forceConfig;
  activeConfig: Configuration | null = null;

  constructor(servicename: string, options?: { rescuePort?: number; rescueIp?: string; forceConfig?: Configuration }) {
    this.config = initialconfig;
    this.forceConfig = options?.forceConfig;
    this.rescuePort = options?.rescuePort;
    this.rescueIp = options?.rescueIp;
    void runBackendService(servicename, () => new WebServerClient(this), { autoRestart: false, dropListenerReference: true }).then(s => this.service = s);

    if (this.forceConfig)
      this.reconfigure(this.forceConfig);
    else
      void this.loadConfig();
  }

  async loadConfig() {
    if (this.forceConfig) {
      this.reconfigure(this.forceConfig);
      return;
    }

    const config = await loadlib("mod::system/lib/internal/webserver/config.whlib").DownloadWebserverConfig() as Configuration;

    //Remove the HS trusted port from our bindlist - that one needs to be held by the HS webserver
    const trustedportidx = config.ports.findIndex(_ => _.id === -6 /*whwebserverconfig_hstrustedportid*/);
    if (trustedportidx >= 0)
      config.ports.splice(trustedportidx, 1);

    this.reconfigure(config);
  }

  reconfigure(config: Configuration) {
    this.activeConfig = structuredClone(config);

    if (this.rescuePort) {
      config.ports = config.ports.filter(_ => _.id === -4); //keeps only the original 13679 rescueport
      config.ports[0].port = this.rescuePort;
      config.ports[0].ip = this.rescueIp || "127.0.0.1";
    }

    for (const port of config.ports) {
      const fixedhost = !port.virtualhost ? config.hosts.find(_ => _.port === port.id) : undefined;
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
