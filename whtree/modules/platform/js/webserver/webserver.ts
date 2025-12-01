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
import type { WebServerLogger } from './logger';
import { stringify } from '@webhare/std';

function getLocalAddress(req: http.IncomingMessage): string {
  if (req.socket.localFamily === 'IPv6') {
    return `[${req.socket.localAddress}]:${req.socket.localPort}`;
  }
  return `${req.socket.localAddress}:${req.socket.localPort}`;
}

export async function getMinimalConfig(): Promise<Configuration> {
  return await loadlib("mod::system/lib/internal/webserver/config.whlib").CreateMinimalWebserverConfig();
}

export class WebServerPort {
  server: http.Server | https.Server;
  fixedHost: Host | undefined;
  overrideHost: string | undefined;
  readonly port: Port;

  constructor(public webserver: WebServer, port: Port, fixedHost: Host | undefined) {
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
    this.server.on('error', e => console.log("Server error", e)); //FIXME deal with EADDRINUSE for listen failures. just retry later
    this.server.on('upgrade', (req, socket, head) => this.forwardUpgrade(req, socket as net.Socket, head));
    this.server.listen(port.port, port.ip);
  }

  close() {
    this.server.close();
  }

  buildWebRequest(req: http.IncomingMessage, body?: ArrayBuffer | null): { port: WebServerPort; localAddress: string; webreq: WebRequest } {
    let remoteIp = req.socket.remoteAddress || '';
    let proto = this.port.privatekey ? "https" : "http";
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let port: WebServerPort = this;

    const xForwardedFor = req.headers['x-forwarded-for'];
    const xForwardedProto = req.headers['x-forwarded-proto'];
    const xWhProxy = req.headers['x-wh-proxy'];
    let localAddress = '';

    if (xForwardedFor || xForwardedProto || xWhProxy) {
      if (this.port.istrustedport || this.webserver.isAllowedProxyIP(remoteIp)) {
        if (typeof xWhProxy === 'string') {
          for (const proxypart of xWhProxy.split(';').map(_ => _.trim())) {
            const [key, value] = proxypart.split('=');
            if (key === "proto" && (value === 'http' || value === 'https'))
              proto = value;
            else if (key === "for" && value)
              remoteIp = value;
            else if (key === "local" && value)
              localAddress = value;
            else if (key === "binding" && value) {
              const valueAsNum = parseInt(value, 10);
              const matchedBinding = [...this.webserver.ports].find(_ => _.port.id === valueAsNum);
              if (matchedBinding)
                port = matchedBinding;
            }
          }
        } else {
          if (typeof xForwardedFor === 'string')
            remoteIp = xForwardedFor.split(',').at(-1)!;

          if (typeof xForwardedProto === 'string' && (xForwardedProto === 'http' || xForwardedProto === 'https'))
            proto = xForwardedProto;
        }
      }
    }

    //FIXME verify whether host makes sense given the incoming port (ie virtualhost or force to IP ?)
    //FIXME ensure clientWebServer is also set for virtualhosted URLs
    const finalurl = `${proto}://${this.overrideHost || req.headers.host}${req.url}`;

    //Translate nodejs request to our Router stuff
    const webreq = new IncomingWebRequest(finalurl, {
      method: req.method!.toUpperCase() as HTTPMethod,
      headers: req.headers as Record<string, string>,
      body,
      clientWebServer: this.fixedHost?.id || 0,
      clientIp: remoteIp
    });

    return { port, webreq, localAddress };
  }

  async onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      if (!req.method || !req.url)
        throw new Error("Incomplete request?");

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
      const { port, webreq, localAddress } = this.buildWebRequest(req, body.buffer);
      const response = await coreWebHareRouter(port, webreq, localAddress || getLocalAddress(req));
      res.statusCode = response.status;

      //coreWebHareRouter has filtered all transfer- headers and the Date header, but will let Content-Length through if present, and that will prevent the node server from chunking the output
      for (const [key, value] of response.headers.entries())
        if (key !== 'set-cookie')
          res.setHeader(key, value);
      for (const cookie of response.headers.getSetCookie())
        res.appendHeader("Set-Cookie", cookie);

      //TODO freeze the WebResponse, log errors if any modification still occurs after we're supposedly done
      //FXIME don't buffer all in memory, stream it!
      res.write(new Uint8Array(await response.arrayBuffer()));
      res.end();

      //TODO once clustering we need a two stage log where we inform our parent of start & end of request processing, and the parent actually writes the log and can still log something useful if we crash
      this.webserver.logger?.logRequest(webreq);

    } catch (e) {
      this.handleException(e, req, res);
    }
  }

  forwardUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const { webreq } = this.buildWebRequest(req);
    //forward it unconditionally (TODO integrate with router ?)
    const { targeturl, fetchmethod, headers } = getHSWebserverTarget(this, webreq, getLocalAddress(req));

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
  logger: WebServerLogger | null = null;

  constructor(servicename: string, options?: { rescuePort?: number; rescueIp?: string; forceConfig?: Configuration; logger?: WebServerLogger }) {
    this.config = initialconfig;
    this.forceConfig = options?.forceConfig;
    this.rescuePort = options?.rescuePort;
    this.rescueIp = options?.rescueIp;
    this.logger = options?.logger || null;
    void runBackendService(servicename, () => new WebServerClient(this), { autoRestart: false, dropListenerReference: true }).then(s => this.service = s);

    if (this.forceConfig)
      this.reconfigure(this.forceConfig);
    else
      void this.loadConfig();
  }

  isAllowedProxyIP(ip: string): boolean {
    return this.activeConfig?.trust_xforwardedfor.includes(ip) || false;
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
      const existingPort = [...this.ports].find(_ => _.port.id === port.id);
      if (existingPort) {
        if (stringify(existingPort.port, { stable: true }) === stringify(port, { stable: true }))
          continue;

        // need to terminate the old port!
        existingPort.close();
      }
      this.ports.add(new WebServerPort(this, port, fixedhost));
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
