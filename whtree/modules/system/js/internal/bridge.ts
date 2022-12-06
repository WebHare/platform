//This is based on Webhare's @mod-system/js/internal/bridge.ts - FIXME and that one should really be moved to internal namespace or be remove

import * as Events from "events";
import * as stacktrace_parser from "stacktrace-parser";
import * as configuration from './configuration';
import WebSocket from "ws";
import * as tools from "./tools";
import * as whdebug from "./whdebug";

const BridgeFailureExitCode = 153;

// eslint-disable-next-line prefer-const -- making it const currently makes this file a lot more complex due to definition ordering issues
let bridge : WebHareBridge;

interface ResponsePacketBase
{
  type: string;
}
interface ResponseOkPacket extends ResponsePacketBase
{
  type: "response-ok";
  msgid: number;
  value?: unknown;
}

interface ResponseExceptionPacket extends ResponsePacketBase
{
  type: "response-exception";
  msgid: number;
  what: string;
  trace: unknown;
}

interface LinkMessagePacket extends ResponsePacketBase
{
  type: "link-message";
  id: number;
  message: unknown;
  replyto: number;
  msgid: number;
}

interface LinkGonePacket extends ResponsePacketBase
{
  type: "link-gone";
  id: number;
}

interface EventCallbackPacket extends ResponsePacketBase
{
  type: "eventcallback";
  id: number;
  event: string;
  data: unknown[];
}

interface PortAcceptedPacket extends ResponsePacketBase
{
  type: "port-accepted";
  id: number;
  link: number;
}

type ResponsePacket = ResponseOkPacket | ResponseExceptionPacket | LinkMessagePacket | LinkGonePacket | EventCallbackPacket | PortAcceptedPacket;

export class IPCLink extends Events.EventEmitter
{
  private readonly id: number;
  readonly name: string;
  _closed = false;

  constructor(linkid: number, name: string)
  {
    super();
    this.id = linkid;
    this.name = name;
  }

  send(message: object, replyto?: number)
  {
    return bridge.sendMessage({ type: "message", id: this.id, message: message, replyto: replyto || 0 });
  }

  doRequest(message: object)
  {
    return bridge.doRequest({ type: "message", id: this.id, message: message, replyto: 0 });
  }

  sendException(e: Error, replyto: number)
  {
    this.send(
        { __exception:
              { type:  "exception"
              , what:  e.message
              , trace: bridge.getStructuredTrace(e)
              }
        }, replyto);
  }

  close()
  {
    bridge.closeLink(this.id);
  }
}

export class IPCListenerPort extends Events.EventEmitter
{
  id: number;
  name: string;
  _closed = false;

  constructor(portid:number, name:string)
  {
    super();
    this.id = portid;
    this.name = name;
  }

  close()
  {
    bridge.closePort(this.id);
  }
}

/** Interface for the client object we present to the connecting user
    TODO: model this more after jsonrpc-client? Would make it easier to deal with case insensitive HS services */
interface WebHareServiceClient
{
  /** Our methods */
  [key: string]: (...args: unknown[]) => unknown;
}

interface RemoteCallResponse
{
  result?: unknown;
  exc?: { what: string };
}

interface WebHareServiceDescription
{
  methods: Array<{ name: string }>;
}

class WebHareServiceWrapper
{
  port: IPCLink;
  private client: WebHareServiceClient;

  constructor(port: IPCLink, response: WebHareServiceDescription)
  {
    this.port = port;
    this.client = { close: function() { port.close(); } };
    for(const method of response.methods)
      this.client[method.name] = (...args: unknown[]) => this.remotingFunc(method, args);
  }

  getClient()
  {
    return this.client;
  }

  private async remotingFunc(method: { name: string; }, args: unknown[])
  {
    const response = await this.port.doRequest({call: method.name, args: args }) as RemoteCallResponse;
    if(response.exc)
      throw new Error(response.exc.what);
    else
      return response.result;
  }
}

/** Describes config info sent by HareScript as soon as we establish the connection */
interface VersionData
{
  installationroot: string;
  moduleroots: { [key:string]: string };
  /** data root (FIXME stop naming it varroot!) */
  varroot: string[];
  version:string;
}

interface WebSocketWithRefAccess extends WebSocket
{
  _socket:
  {
    ref: () => void;
    unref: () => void;
  }
}

type EventCallback = (event: string, data: object) => void;

//TODO we don't really create multiple bridges. should we allow that or should we just stop bothering and have one global connection?
class WebHareBridge extends Events.EventEmitter
{
  private _waitcount = 0;

  debug = false;
  gotfirstmessage = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not fixing this yet, I wonder if it wouldn't be cleaner to swap out sentmessages/pendingrequests for IPC links and WebHareServices completely!
  sentmessages: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not fixing this yet, I wonder if it wouldn't be cleaner to swap out sentmessages/pendingrequests for IPC links and WebHareServices completely!
  pendingrequests: any[] = [];
  ports:Map< number, IPCListenerPort> = new Map;
  links:Map< number, IPCLink> = new Map;
  eventcallbacks:Array< { id: number; callback: EventCallback } > = [];
  nextmsgid = 21000; //makes it easier to tell apart these IDs from other ids
  socket: WebSocketWithRefAccess;
  /** Promise to resolve when the first bridge connection has come alive and we have version info etc */
  private onlinedefer: tools.DeferredPromise<void>;
  /** Flag to set if someone has requested ready() */
  private havereadywaiter = false;
  versiondata: VersionData | null = null;

  constructor()
  {
    super();

    this.debug = whdebug.isDebugTagEnabled("bridge");
    this.onlinedefer = tools.createDeferred<void>();

    //TODO connect on demand (ie when ready or an IPC is requested)
    this.socket = new WebSocket("ws" + configuration.getRescueOrigin().substr(4) + "/.system/endpoints/bridge.whsock") as WebSocketWithRefAccess;
    this.socket.on("open", this.onConnected.bind(this));
    this.socket.on("message", this.onMessage.bind(this));
    this.socket.on("error", this.onError.bind(this));
    this.socket.on("close", this.onClose.bind(this));
  }

  /** Get the current number of references to the bridge */
  get references()
  {
    return this._waitcount;
  }

  /** Get a promise that wil resolve as soon as the bridge is connected and configuration APIs are ready.
  */
  get ready() : Promise<void> {
    if(!this.havereadywaiter) { //Mark a waiter so nodejs doesn't abort during `await bridge.ready`
      this.updateWaitCount(+1, "ready check");
      this.havereadywaiter = true;
      //Clear the waiter when the online promise has resolved
      this.onlinedefer.promise.finally( () => this.updateWaitCount(-1, "ready check"));
    }
    return this.onlinedefer.promise;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _closeLink(link: IPCLink)
  {
    console.error("FIXME _closeLink not implemented, will leak");
  }

  updateWaitCount(nr: number, reason: string)
  {
    const newcount = this._waitcount + nr;
    if(newcount < 0)
      throw new Error("Wait count became negative!");

    //unref/ref doesn't count so we'll handle that ourselves
    if(newcount == 0 && this._waitcount > 0)
    {
      //Stop us from preventing node shutdown.
      this.socket._socket?.unref();
    }
    else if(newcount > 0 && this._waitcount == 0)
    {
      this.socket._socket?.ref();
    }
    this._waitcount = newcount;

    if(this.debug)
      console.log(`webhare-bridge: waitcount ${nr > 0 ? '+' : ''}${nr}: ${reason} (now: ${this._waitcount})`);
  }

  private onConnected()
  {
    if(this._waitcount == 0) //noone is caring about us right now
      this.socket._socket.unref();
  }

  private onMessage(datatext: string, flags: unknown)
  {
    const data: ResponsePacket = JSON.parse(datatext) as ResponsePacket;
    if(!this.gotfirstmessage)
    {
      this.gotfirstmessage=true;
      this.onVersionInfo(data as unknown as VersionData);
      return;
    }
    if(this.debug)
      console.log("webhare-bridge: received message:", data, flags);

    switch (data.type)
    {
      case "response-ok":
      {
        const req = this.sentmessages.find(item => item.msgid == data.msgid);
        if (req)
        {
          this.sentmessages.splice(this.sentmessages.indexOf(req), 1);
          req.resolve(data.value);
        }
        return;
      }
      case "response-exception":
      {
        const req = this.sentmessages.find(item => item.msgid == data.msgid);
        if (req)
          req.reject(new Error(data.what));
        return;
      }

      case "port-accepted":
      {
        const portrec = this.ports.get(data.id);
        if (!portrec)
        {
          this.abortBridge("webhare-bridge: received accept for nonexisting port #" + data.id);
          return;
        }

        if(this.debug)
          console.log("webhare-bridge: accepted connection on port #" + data.id  + " new link #" + data.link);

        const newlink = new IPCLink(data.link, `IPCLink #${data.link} incoming '${portrec.name}' connection`);
        this.links.set(data.link, newlink);
        if (!portrec._closed)
          portrec.emit("accept", newlink);
        else
          newlink.close();
        return;
      }

      case "link-message":
      {
        if(data.replyto) //it's a response
        {
          const responseidx = this.pendingrequests.findIndex(el => el.msgid == data.replyto);
          if(responseidx < 0)
          {
            console.log(data.message);
            this.abortBridge("Received reply to unknown request #" + data.replyto);
            return;
          }

          const req = this.pendingrequests[responseidx];
          this.pendingrequests.splice(responseidx,1);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FIXME we should figure out if we still need this and then properly put in the messages
          if((data.message as any).__exception)
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            req.reject(new Error((data.message as any).__exception.what));
          }
          else
            req.resolve(data.message);
          return;
        }

        const linkrec = this.links.get(data.id);
        if (!linkrec)
        {
          console.log(data);
          this.abortBridge("webhare-bridge: received message for nonexisting port #" + data.id);
          return;
        }
        if (!linkrec._closed)
        {
          linkrec.emit("message", data.message, data.msgid);
        }
        return;
      }

      case "link-gone":
      {
        //Fail all open requests
        this.pendingrequests.filter(el => el.linkid == data.id).forEach(el => el.reject(new Error("link disconnected")));
        this.pendingrequests = this.pendingrequests.filter(el => el.linkid != data.id);

        //If we still know of this link, close it.
        this.links.get(data.id)?.close();
        return;
      }

      case "eventcallback":
      {
        const eventcallback = this.eventcallbacks.find(el => el.id == data.id);
        if (eventcallback)
          eventcallback.callback(data.event, data.data);
        return;
      }
    }

    //TODO whould there be a way for TS to infer that data is at least as ResponsePacketBase?
    this.abortBridge("webhare-bridge: unexpected command " + (data as ResponsePacketBase).type);
  }

  closePort(id: number)
  {
    const port = this.ports.get(id);
    if (!port || port._closed)
    {
      console.error("webhare-bridge: closing port #" + id + " that was already closed",port);
      return;
    }
    port._closed = true;
    this.sendMessage({ type: "closeport", id: id });
    this.ports.delete(id);
    this.updateWaitCount(-1, port.name);
  }

  closeLink(id: number)
  {
    const link = this.links.get(id);
    if (!link || link._closed)
    {
      console.error("webhare-bridge: closing link #" + id + " that was already closed",link);
      return;
    }
    link._closed = true;
    this.sendMessage({ type: "closelink", id: id });
    this.links.delete(id);
    this.updateWaitCount(-1, link.name);
  }

  /**
  */
  sendMessage(data: object)
  {
    const msgid = ++this.nextmsgid;

    let rec;
    const promise = new Promise((resolve, reject) =>
    {
      rec = { msgid, resolve, reject };
    });
    this.sentmessages.push(rec);
    this.transmit({ msgid, data });

    return { msgid, promise };
  }

  /** Transmit data to remote, wait for the bridge to connect if still needed */
  private transmit(data: unknown)
  {
    if(this.debug)
      console.log("webhare-bridge: sending message: ", data);

    //TODO if we know we're online, skip the promise wait ? save some callstacks?
    this.onlinedefer.promise.then(() =>
    {
      this.socket.send(JSON.stringify(data));
    });
  }

  async doRequest(data: object)
  {
    const defer = tools.createDeferred();
    const sent = this.sendMessage(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FIXME linkid handling by monkypatching the data is ugly.. but old bridge had the same issue.
    this.pendingrequests.push( { linkid: (data as any).id, msgid: sent.msgid, resolve: defer.resolve, reject: defer.reject });

    try
    {
      this.updateWaitCount(+1, "doRequest #" + sent.msgid);

      await sent.promise;
      return await defer.promise;
    }
    finally
    {
      this.updateWaitCount(-1, "doRequest #" + sent.msgid);
    }
  }

  abortBridge(why: string)
  {
    //TODO abort is a bit drastic, but we need to do something to prevent silent hangs on a RPC failure (because eg an 'unknown request #' rpc error will also 'hang' a promise elsehwere!)
    //     eg. reject all outstanding promises and reconnect ?
    console.error("Bridge failure: " + why);
    process.exit(BridgeFailureExitCode);
    return;
  }

  private onError(error: string)
  {
    console.error("webhare-bridge: websocket reported error: " + error);
    this.onlinedefer.reject(new Error(error));
  }

  private onClose()
  {
    console.log("webhare-bridge: the server has closed the connection");
    process.exit(245); //FIXME but we should *survive* this and reconnect
  }

  private onVersionInfo(versiondata: VersionData)
  {
    if(!versiondata.version)
      throw new Error("Retrieving version data failed, are we sure this is a WebHare port?");

    if(this.debug)
      console.log("webhare-bridge: connected. remote version = " + versiondata.version);
    this.versiondata=versiondata;
    new Promise(resolve => setTimeout(resolve,1500)).then( () => {
      this.onlinedefer.resolve();
    });
  }

  getInstallationRoot()
  {
    if(!this.versiondata)
      throw new Error("Requesting WebHare configuration data before the link was established");
    return this.versiondata.installationroot;
  }
  getModuleInstallationRoot(module: string)
  {
    if(!this.versiondata)
      throw new Error("Requesting WebHare configuration data before the link was established");
    return this.versiondata.moduleroots[module] || null;
  }
  getModuleInstallationRoots()
  {
    if(!this.versiondata)
      throw new Error("Requesting WebHare configuration data before the link was established");
    return Object.entries(this.versiondata.moduleroots).map(([ name, path ]) => ({ name, path }));
  }
  getBaseDataRoot()
  {
    if(!this.versiondata)
      throw new Error("Requesting WebHare configuration data before the link was established");
    return this.versiondata.varroot;
  }

  async createIPCPort(name: string, global: boolean) : Promise<IPCListenerPort>
  {
    const connectresult = this.sendMessage({ type: "createlistenport", name, global });
    const port = new IPCListenerPort(connectresult.msgid, `IPCListenerPort #${connectresult.msgid} named '${name}'`);
    this.ports.set(connectresult.msgid, port);

    this.updateWaitCount(+1, port.name); //FIXME we need -1s when the port closes or throws?
    await connectresult.promise;
    return port;
  }

  async connectIPCPort(name: string, global: "managed" | boolean) : Promise<IPCLink>
  {
    const connectresult = this.sendMessage({ type: "connectport", name:name, global:Boolean(global), managed: global === "managed" });
    const link = new IPCLink(connectresult.msgid, `IPCLink #${connectresult.msgid} to ${name}`);
    this.updateWaitCount(+1, link.name);

    // TODO What if we connect to an IPC Port and they already start talking before the client had a chance to resolve connectIPCPort ? Best if servers don't talk early? :)

    // Synchronous registration at incoming message time. Errors can be handled asynchronously
    // TODO create the IPCLink before the message is transmitted, perhaps just use the messageid for the portnumber, to fix potential races if someone talks early
    this.links.set(connectresult.msgid, link);
    try
    {
      await connectresult.promise;
    }
    catch(e)
    {
      link.close();
      throw e;
    }

    return link;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- FIXME implement timeout
  async openService(name: string, args?: unknown[], options?: { timeout: number; })
  {
    this.updateWaitCount(+1, "openService " +name);
    try
    {
      const link = await this.connectIPCPort("webhareservice:" + name, true);
      try //if we fail after connect, we'll need to disconnect the link ourselves
      {
        const description = await link.doRequest({ __new: args ?? [] }) as WebHareServiceDescription;
        return (new WebHareServiceWrapper(link, description)).getClient();
      }
      catch(e)
      {
        link.close();
        throw e;
      }
    }
    finally
    {
      this.updateWaitCount(-1, "openService " +name);
    }
  }

  broadcastEvent(event: string, data?: unknown)
  {
    this.transmit({ type: "broadcast", event: event, data: data || {} });
  }

  async registerMultiEventCallback(event: string, callback: EventCallback)
  {
    // updateWaitCount?  but we need a de-register API then
    const msgresult = this.sendMessage({ type: "registermultieventcallback", event: event });
    this.eventcallbacks.push({ id: msgresult.msgid, callback });
    await msgresult.promise;
    return { id: msgresult.msgid };
  }

  /** Returns the trace of an exception in a structured format compatible with Harescript traces
      @param e - Exception
      @returns Ecxeption trace
  */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getStructuredTrace(e: Error)
  {
    if(!e.stack)
      return [];

    const trace = stacktrace_parser.parse(e.stack);
    return trace.map(i => ({ filename: i.file || "", line: i.lineNumber || 1, col: i.column || 1, func: i.methodName || "" }));
  }
}

bridge = new WebHareBridge;
export default bridge;
