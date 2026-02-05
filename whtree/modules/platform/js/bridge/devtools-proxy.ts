import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import EventSource from '@mod-system/js/internal/eventsource';
import { getInspectorURL } from './tools';

type DevToolsRequest = { id?: number; method: string; params?: object };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DevToolsResponse = { id: number; result: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DevToolsEvent = { method: string; params: any };

type DevToolsSocketEvents = {
  event: DevToolsEvent;
  response: DevToolsResponse;
  open: void;
  close: { code: number; reason: string };
  error: Error;
} & Record<`event:${string}`, DevToolsEvent>;

type ListJson = Array<{
  description: string;
  devtoolsFrontendUrl: string;
  devtoolsFrontendUrlCompat: string;
  faviconUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}>;


class DevToolsSocket extends EventSource<DevToolsSocketEvents> {
  cws: WebSocket;
  idCounter = 1_000_000_000;
  requestPromises = new Map<number, (data: Extract<DevToolsResponse, { result: unknown }>) => void>();
  active: Promise<void>;

  constructor(url: string) {
    super();
    this.cws = new WebSocket(url);
    this.active = new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      this.cws.on("open", async () => {
        // console.log(`event open`);
        try {
          await this.handleOpen();
          resolve();
          this.emit("open", void undefined);
        } catch (e) {
          reject(e as Error);
        }
      });
      this.cws.on("error", (error) => { reject(error); this.emit("error", error); });
    });
    this.cws.on("close", (code, reason) => this.emit("close", { code, reason: reason.toString() }));
    this.cws.on("message", (message) => {
      let data: DevToolsResponse | DevToolsEvent;
      if (Array.isArray(message))
        throw new Error(`Got buffer array`);
      else if (message instanceof ArrayBuffer)
        data = JSON.parse(Buffer.from(message).toString());
      else
        data = JSON.parse(message.toString());

      // console.log(`<-cws`, "id" in data ? `response ${data.id}` : `event: ${data.method}`);

      if ("id" in data) {
        const resolve = this.requestPromises.get(data.id);
        if (resolve) {
          this.requestPromises.delete(data.id);
          resolve(data);
        } else
          this.emit("response", data);
      } else {
        this.emit("event", data);
        this.emit(`event:${data.method}`, data);
      }
    });
  }

  async handleOpen() {
  }

  send(request: DevToolsRequest, options?: { awaitResponse?: false }): void;
  send(request: DevToolsRequest, options: { awaitResponse: true }): Promise<Extract<DevToolsResponse, { result: unknown }>>;
  send(request: DevToolsRequest, { awaitResponse }: { awaitResponse?: boolean } = {}): void | Promise<Extract<DevToolsResponse, { result: unknown }>> {
    const toSend = { ...request };
    toSend.id ??= toSend.id = ++this.idCounter;
    // console.log(`->cws`, toSend);
    this.cws.send(JSON.stringify(toSend));
    if (awaitResponse) {
      const deferred = Promise.withResolvers<Extract<DevToolsResponse, { result: unknown }>>();
      this.requestPromises.set(toSend.id, deferred.resolve);
      return deferred.promise;
    }
    return undefined;
  }

  close() {
    this.cws.close();
  }
}

class NodeWorkerKeeper {
  workers = new Map<string, {
    sessionId: string;
    workerInfo: {
      workerId: string;
      type: 'worker';
      title: string;
      url: string;
    };
    waitingForDebugger: false;
  }>();

  active: Promise<void>;

  constructor(cws: DevToolsSocket) {
    cws.on("event:NodeWorker.attachedToWorker", (data) => {
      this.workers.set(data.params.sessionId, data.params);
    });
    cws.on("event:NodeWorker.detachedFromWorker", (data) => {
      this.workers.delete(data.params.sessionId);
    });
    // wait for nodeworker to become active
    this.active = cws.active.then(() => void cws.send({ method: `NodeWorker.enable`, params: { waitForDebuggerOnStart: true } }, { awaitResponse: true }));
  }
}

class NodeWorkerForwarder extends EventSource<DevToolsSocketEvents> {
  cws: DevToolsSocket;
  idCounter = 1;// 2_000_000_000;
  sessionId: string | undefined;
  requestPromises = new Map<number, (data: Extract<DevToolsResponse, { result: unknown }>) => void>();
  active: Promise<void>;

  constructor(cws: DevToolsSocket, workerKeeper: NodeWorkerKeeper, workerId: string) {
    super();
    this.cws = cws;
    this.cws.on("open", m => this.emit("open", m));
    this.cws.on("close", m => this.emit("close", m));
    this.cws.on("event:NodeWorker.receivedMessageFromWorker", m => {
      const data = JSON.parse(m.params.message) as DevToolsResponse | DevToolsEvent;
      if ("id" in data) {
        const resolve = this.requestPromises.get(data.id);
        if (resolve) {
          this.requestPromises.delete(data.id);
          resolve(data);
        } else
          this.emit("response", data);
      } else {
        this.emit("event", data);
        this.emit(`event:${data.method}`, data);
      }
    });
    this.active = (async () => {
      await workerKeeper.active;
      const worker = [...workerKeeper.workers.values()].find(w => w.workerInfo.workerId === workerId);
      if (!worker)
        throw new Error(`No such worker ${workerId}`);

      this.sessionId = worker.sessionId;
    })();
  }

  send(request: DevToolsRequest, options?: { awaitResponse?: false }): void;
  send(request: DevToolsRequest, options: { awaitResponse: true }): Promise<Extract<DevToolsResponse, { result: unknown }>>;
  send(request: DevToolsRequest, { awaitResponse }: { awaitResponse?: boolean } = {}): void | Promise<Extract<DevToolsResponse, { result: unknown }>> {
    if (!this.sessionId)
      throw new Error(`Cannot send when not active yet`);
    const toSend = { ...request };
    toSend.id ??= toSend.id = ++this.idCounter;
    this.cws.send({ method: `NodeWorker.sendMessageToWorker`, params: { sessionId: this.sessionId, message: JSON.stringify(toSend) } }, { awaitResponse: false });
    if (awaitResponse) {
      const deferred = Promise.withResolvers<Extract<DevToolsResponse, { result: unknown }>>();
      this.requestPromises.set(toSend.id, deferred.resolve);
      return deferred.promise;
    }
    return undefined;
  }
}


function toNaturalCompare(a: string) {
  const retval = a.replace(/([0-9]+)(\.[0-9]*)?/g, (_, digits, frac) => ("0".repeat(10) + digits).slice(Math.min(digits.length, 10) + (frac ?? "")));
  return retval;
}

function naturalCompare(a: string, b: string) {
  // convert
  a = toNaturalCompare(a);
  b = toNaturalCompare(b);
  return a === b ? 0 : a < b ? -1 : 1;
}

function setURLVariables(url: string, vars: Record<string, string>) {
  const u = new URL(url);
  for (const [name, value] of Object.entries(vars)) {
    u.searchParams.set(name, value);
  }
  return u.toString();
}

function parseWebSocketRawDataToJSON(rawData: WebSocket.RawData) {
  if (Array.isArray(rawData))
    throw new Error(`Got buffer array`);
  else if (rawData instanceof ArrayBuffer)
    return JSON.parse(Buffer.from(rawData).toString());
  else
    return JSON.parse(rawData.toString());
}

interface DevToolsConn extends EventSource<DevToolsSocketEvents> {
  active: Promise<void>;

  send(request: DevToolsRequest, options?: { awaitResponse?: false }): void;
  send(request: DevToolsRequest, options: { awaitResponse: true }): Promise<Extract<DevToolsResponse, { result: unknown }>>;
}

export async function devtoolsProxy(options: { localHost: string; localPort: number; bindHost: string; bindPort: number; connectProcess: string }) {
  console.log(`Enabling inspector for process ${options.connectProcess}`);
  const inspectorUrl = await getInspectorURL(options.connectProcess);
  if (!inspectorUrl) {
    console.error(`Could not get inspector url for process ${options.connectProcess}`);
    process.exit(1);
  }
  console.log(`Inspector URL: ${inspectorUrl}`);
  const parsedInspectorUrl = new URL(inspectorUrl);
  const host = `http://${parsedInspectorUrl.host}`;

  console.log(`Publishing data on location ${options.localHost}:${options.localPort}`);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = http.createServer(async (req, res) => {
    // console.log(`request ${req.method} ${req.url} `);
    //console.log(requestBuffers);

    let toSend: unknown;
    let headers: Record<string, string> = {};
    switch (req.url?.split("?")[0]) {
      case "/json/version": {
        const versionRes = await fetch(`${host}${req.url}`);
        const versionText = await versionRes.text();
        toSend = JSON.parse(versionText) as ListJson;
        headers = Object.fromEntries([...versionRes.headers.entries()]);
      } break;
      case "/json/list": {
        const listRes = await fetch(`${host}${req.url}`);
        const listText = await listRes.text();
        const listJson = JSON.parse(listText) as ListJson;

        const debuggerUrl = listJson[0].webSocketDebuggerUrl;

        // redirect the webSocket debugger url
        const url = new URL(debuggerUrl);
        url.host = options.localHost;
        url.port = options.localPort?.toString();
        listJson[0].webSocketDebuggerUrl = url.toString();

        const cws = new DevToolsSocket(debuggerUrl);
        const workerKeeper = new NodeWorkerKeeper(cws);
        await workerKeeper.active;

        //console.log(proxy.workers);
        for (const [, worker] of [...workerKeeper.workers.entries()].sort((a, b) => naturalCompare(a[1].workerInfo.title, b[1].workerInfo.title))) {
          const newElt = { ...listJson[0] };
          newElt.id = newElt.id + `?workerId=${worker.workerInfo.workerId}`;
          newElt.webSocketDebuggerUrl = setURLVariables(newElt.webSocketDebuggerUrl, { workerId: worker.workerInfo.workerId });
          const wsUrl = newElt.webSocketDebuggerUrl.replace(`ws://`, ``);
          newElt.devtoolsFrontendUrl = setURLVariables(newElt.devtoolsFrontendUrl, { ws: wsUrl });
          newElt.devtoolsFrontendUrlCompat = setURLVariables(newElt.devtoolsFrontendUrlCompat, { ws: wsUrl });
          newElt.title = `${worker.workerInfo.title} url ${worker.workerInfo.url}`;
          listJson.push(newElt);
        }

        cws.close();
        toSend = listJson;
      } break;
    }

    if (toSend) {
      //console.log(toSend);
      const data = Buffer.from(JSON.stringify(toSend));
      headers["content-length"] = data.length.toString();
      res.writeHead(200, "ok", headers);
      res.write(data);
    } else {
      res.writeHead(404, "Not found");
    }

    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  wss.on('connection', async (ws, request) => {
    let buffered: DevToolsRequest[] | undefined = [];

    const listRes = await fetch(`${host}/json/list`);
    const listText = await listRes.text();
    const listJson = JSON.parse(listText) as ListJson;

    const url = new URL(`ws://e${request.url ?? ""}`);
    const workerId = url.searchParams.get("workerId");
    const targetId = url.pathname.slice(1);

    const item = listJson.find(w => w.id === targetId);
    if (!item) {
      ws.close(1001, `Target not found`);
      return;
    }

    // console.log({ item });

    const client = new DevToolsSocket(item.webSocketDebuggerUrl);
    let itf: DevToolsConn;
    if (workerId) {
      const workerKeeper = new NodeWorkerKeeper(client);
      itf = new NodeWorkerForwarder(client, workerKeeper, workerId);
    } else
      itf = client;

    ws.on("message", rawData => {
      const message = parseWebSocketRawDataToJSON(rawData) as DevToolsRequest;
      if (buffered)
        buffered.push(message);
      else
        itf.send(message);
    });
    ws.on("error", () => client.close());
    ws.on("close", () => client.close());

    itf.on("event", e => ws.send(JSON.stringify(e)));
    itf.on("response", r => ws.send(JSON.stringify(r)));

    await itf.active;
    console.log(`itf active`);
    for (const bufferedItem of buffered) {
      itf.send(bufferedItem);
    }
    buffered = undefined;
  });

  console.log(`Starting server on ${options.bindHost}:${options.bindPort}`);
  server.listen(options.bindPort, options.bindHost);
}
