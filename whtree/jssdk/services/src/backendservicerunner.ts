import bridge, { type IPCMessagePacket, type IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";
import type { ServiceInitMessage, ServiceCallMessage, WebHareServiceDescription, WebHareServiceIPCLinkType, ServiceCallResult, ServiceEventMessage } from '@mod-system/js/internal/types';
import { checkModuleScopedName } from "@webhare/services/src/naming";
import { broadcast } from "@webhare/services/src/backendevents";
import { setLink } from "./symbols";
import { generateRandomId, isPromise, parseTyped, stringify } from "@webhare/std";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { rename, rm } from "node:fs/promises";
import { UnixSocketLineBasedConnection, type USLMethodCall } from "@mod-system/js/internal/whmanager/unix-connections";
import type { BackendServiceProtocol } from "./backendservice";
import { debugFlags } from "@webhare/env";

export type ServiceControllerFactoryFunction = (options?: { debug?: boolean }) => Promise<BackendServiceController> | BackendServiceController;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need to match any possible arguments to be able to return a useful satifsyable type
export type ServiceClientFactoryFunction = (...args: any[]) => Promise<BackendServiceConnection> | BackendServiceConnection;

export interface BackendServiceController {
  createClient(...args: unknown[]): Promise<BackendServiceConnection> | BackendServiceConnection;
  close?: () => void;
}

interface LinkInterface {
  handler: BackendServiceConnection | null;
  // send(message: ServiceEventMessage, replyto?: bigint): bigint;
  send(message: ServiceEventMessage): void;
  close(): void;
}

/** Base class for service connections */
export class BackendServiceConnection implements Disposable {
  #link?: LinkInterface;
  #eventQueue?: Array<{ event: string; data: unknown }>;

  constructor() {
  }

  /** Emit an event to the client */
  emit(event: string, data: unknown) {
    if (!this.#link) {
      this.#eventQueue ||= [];
      this.#eventQueue.push({ event, data });
    } else {
      this.#link.send({ event, data });
    }
  }

  /** Invoke to close this connection. This will cause onClose to be invoked */
  [Symbol.dispose]() {
    this.#link?.close();
  }

  /** Invoked when the client explicitly closed the connection */
  onClose() {
  }

  //private api used to associate the connection with a link
  [setLink](link: LinkInterface) {
    while (this.#eventQueue?.length)
      link.send(this.#eventQueue.shift()!);

    this.#link = link;
    this.#eventQueue = undefined;
  }
}

export interface BackendServiceOptions {
  /** Enable automatic restart of the service when the source code changes. Defaults to true */
  autoRestart?: boolean;
  /** Immediately restart the service even if we stil have open connections. */
  restartImmediately?: boolean;
  /** Don't keep a reference to the listening port, preventing this service from keeping the process alive */
  dropListenerReference?: boolean;
  /** Callback to invoke when service is shut down */
  onClose?: () => void;
  /** Protocols to listen on */
  protocols?: BackendServiceProtocol[];
}


//Describe a JS public interface in a HS compatible way
export function describePublicInterface(inobj: object): WebHareServiceDescription {
  const methods = [];
  const seenMethods = new Set<string>();

  // Hide any names of the base class - prevents them from being exposed if also defined by the service
  Object.getOwnPropertyNames(BackendServiceConnection.prototype).forEach(name => seenMethods.add(name));

  //iterate to top and discover all methods
  for (; inobj && !Object.hasOwn(inobj, setLink); inobj = Object.getPrototypeOf(inobj)) {
    for (const name of Object.getOwnPropertyNames(inobj)) {
      // Don't expose _-prefixed APIs (often 'internal' methods), anything we've already seen in higher classes, or BackendServiceConnection members (including 'constructor)
      if (name[0] === '_' || seenMethods.has(name))
        continue;

      seenMethods.add(name); //We're ignoring the risk of only case-differing identifiers sent to HareScript and clashing there. Just don't.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cleanup later, creating interfaces this way is ugly anyway
      const method = (inobj as any)[name];
      if (typeof method !== 'function')
        continue; //we only expose real functions, not variables, constants etc

      const params = [];
      for (let i = 0; i < method.length; ++i) //iterate arguments of method
        params.push({ type: 1, has_default: true }); //pretend all arguments to be VARIANTs in HareScript

      methods.push({
        signdata: {
          returntype: 1,  //variant return value
          params,
          excessargstype: -1
        },
        name
      });
    }
  }
  return { isjs: true, methods };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConnectionFactory = (...args: any[]) => Promise<BackendServiceConnection> | BackendServiceConnection;

interface ServiceConnection {
  [key: string]: (...args: unknown[]) => unknown;
}

class LinkState implements LinkInterface {
  handler: BackendServiceConnection | null = null;
  link: WebHareServiceIPCLinkType["AcceptEndPoint"];
  initdefer = Promise.withResolvers<boolean>();

  constructor(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    this.link = link;
  }
  send(message: WebHareServiceDescription | ServiceCallResult | ServiceEventMessage, replyto?: bigint): bigint {
    return this.link.send(message, replyto);
  }
  close() {
    this.link.close();
  }
}

class UnixLinkState extends UnixSocketLineBasedConnection<false> implements LinkInterface {
  handler: (BackendServiceConnection & ServiceConnection) | null = null;
  service: WebHareService;
  initdefer = Promise.withResolvers<boolean>();
  invokedConstructor = false;

  constructor(service: WebHareService, link: Socket) {
    super(link);
    this.service = service;
  }

  processDisconnect() {
    this.handler?.onClose();
  }

  async processMessage(message: USLMethodCall) {
    try {
      if (message.method === "constructor" || (!this.handler && !this.invokedConstructor)) {
        if (this.handler)
          throw new Error(`Received unexpected constructor call while handler is already initialized`);

        this.invokedConstructor = true; //allows further queued calls to wait for the constructor (as the factory may be async and we may re-enter processMessage)

        //We need to construct the object.
        const args = message.method === "constructor" ? message.args || [] : [];
        const newhandler = await this.service._factory(...args) satisfies BackendServiceConnection as BackendServiceConnection & ServiceConnection;

        this.handler = newhandler;
        this.handler[setLink](this);
        this.initdefer.resolve(true);

        if (message.method === "constructor") { //then we need to send an explicit reply
          this.send({ id: message.id });
          return;
        }
      }

      if (!await this.initdefer.promise || !this.handler)  //this waits for the constructor to complete
        return; //it failed, just drop the call as the connection will terminate anyway

      const result = this.handler![message.method](...message.args || []);
      if (isPromise(result)) {
        result.then(res => this.send({ id: message.id, result: res }), err => this.send({ id: message.id, error: err instanceof Error ? err.message : String(err) }));
      } else {
        this.send({ id: message.id, result });
      }
    } catch (e) {
      this.send({ id: message.id, error: e instanceof Error ? e.message : String(e) });
      if (!this.handler) { //construction was failing
        this.fail("Construction failed, closing connection");
        this.initdefer.resolve(false);
      }
    }
  }
}

class WebHareService implements Disposable { //EXTEND IPCPortHandlerBase
  _factory: ConnectionFactory;
  private _options: BackendServiceOptions;
  private _port: WebHareServiceIPCLinkType["Port"] | null;
  #unixSockets = new Array<{
    server: Server;
    path: string;
  }>();
  #onClose;

  constructor(port: WebHareServiceIPCLinkType["Port"] | null, servicename: string, factory: ConnectionFactory, options: BackendServiceOptions) {
    this._factory = factory;
    this._options = options;
    this._port = port;
    this._port?.on("accept", link => void this.addLink(link));
    this.#onClose = options.onClose;
  }

  async addLink(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    try {
      const state = new LinkState(link);
      link.on("close", () => this._onClose(state));
      link.on("message", _ => void this._onMessage(state, _));
      link.on("exception", () => false);
      if (this._options.dropListenerReference)
        link.dropReference();

      await link.activate();
    } catch (e) {
      link.close();
    }
  }

  _onClose(state: LinkInterface) {
    state.handler?.onClose();
  }

  async _onMessage(state: LinkState, msg: WebHareServiceIPCLinkType["AcceptEndPointPacket"]) {
    if (!state.handler) {
      try {
        if (!this._factory)
          throw new Error("This service does not accept incoming connections");

        const initdata = msg as IPCMessagePacket<ServiceInitMessage>;

        // We'll pass the state object through a global to BackendServiceConnection (if any)
        const handler = await this._factory(...initdata.message.__new);
        if (!(setLink in handler)) //instanceof BackendServiceConnection is unsafe in case WebHare itself is hotfixed
          throw new Error(`Service handler (type ${Object.getPrototypeOf(handler).constructor.name}?) is not an instance of BackendServiceConnection`);

        if (!state.handler)
          state.handler = handler;
        if (!state.handler)
          throw new Error(`Service handler initialization failed`);

        state.link.send(describePublicInterface(state.handler), msg.msgid);
        state.handler[setLink](state);

        state.initdefer.resolve(true);
      } catch (e) {
        state.link.sendException(e as Error, msg.msgid);
        state.link.close();
        state.initdefer.resolve(false);
      }
      return;
    }
    if (!await state.initdefer.promise) {
      state.link.sendException(new Error(`Service has not been properly initialized`), msg.msgid);
      state.link.close();
      return;
    }

    try {
      const message = msg.message as ServiceCallMessage;
      const args = message.jsargs ? parseTyped(message.jsargs) : message.args; //javascript string-encodes messages so we don't lose property casing due to DecodeJSON/EncodeJSON
      const result = await (state.handler as BackendServiceConnection & ServiceConnection)[message.call].apply(state.handler, args) as IPCMarshallableData;
      state.link.send({ result: message.jsargs ? stringify(result, { typed: true }) : result }, msg.msgid);
    } catch (e) {
      state.link.sendException(e, msg.msgid);
    }
  }

  async _onException(link: WebHareServiceIPCLinkType["AcceptEndPoint"], msg: WebHareServiceIPCLinkType["ExceptionPacket"]) {
    // ignore exceptions, not sent by connecting endpoints
  }

  close() {
    this.#onClose?.();
    this._port?.close();
    for (const socket of this.#unixSockets) {
      socket.server.close();
      rm(socket.path).catch(() => { }); //best effort cleanup, ignore errors
    }
  }

  [Symbol.dispose]() {
    this.close();
  }

  async addUnixSocket(path: string) {
    const server = createServer(socket => this.handleUnixSocketConnection(socket));
    const tempPath = dirname(path) + "/.$" + generateRandomId();

    const defer = Promise.withResolvers<void>();
    server.on("error", e => {
      console.log("Unix socket server error on", tempPath, e);
      defer.reject(e);
    });
    server.listen(tempPath, () => {
      defer.resolve();
    });
    await defer.promise;
    await rename(tempPath, path);
    this.#unixSockets.push({ server, path });
  }

  handleUnixSocketConnection(socket: Socket) {
    try {
      const state = new UnixLinkState(this, socket);
      if (debugFlags["ipc-unixsockets"])
        console.log(`[ipc-unixsockets:${state.id}] Accepted new unix socket connection`);

      socket.on("exception", () => false);
      if (this._options.dropListenerReference)
        socket.unref();
    } catch (e) {
      socket.end();
    }
  }
}

/** Launch a WebHare service.
    Starts a WebHare service and pass the constructed objects to every incoming connection. The constructor
          can also be left empty - the service will then simply run until its shutdown or requires an autorestart.

    @param servicename - Name of the service (should follow the 'module:tag' pattern)
    @param constructor - Constructor to invoke for incoming connections. This object will be marshalled through %OpenWebhareService
    @param options - Service options
*/
export async function runBackendService<Constructor extends ConnectionFactory>(servicename: string, constructor: Constructor, options?: BackendServiceOptions): Promise<WebHareService> {
  // Max path length 108, subtract '/tmp/whsock.FYZtwasn8B8cUQ2qIpmv_w/' (35) leaves 73, round down to 70.
  if (servicename.length > 70)
    throw new Error(`Service name '${servicename}' is too long, must be up to 70 characters but is ${servicename.length} characters`); //socket paths may become too long

  options = { autoRestart: true, restartImmediately: false, dropListenerReference: false, protocols: ["bridge"], ...options };
  checkModuleScopedName(servicename);

  let hostport;
  if (options.protocols?.includes("bridge")) {
    hostport = bridge.createPort<WebHareServiceIPCLinkType>("webhareservice:" + servicename, { global: true });
  }

  const service = new WebHareService(hostport || null, servicename, constructor, options);
  if (hostport) {
    if (options.dropListenerReference)
      hostport.dropReference();

    await hostport.activate();
  }

  if (options.protocols?.includes("unix-socket")) {
    if (!getFullConfigFile().socketDir)
      throw new Error(`Cannot start service '${servicename}' with unix - socket protocol because no socket directory is configured`);
    await service.addUnixSocket(getFullConfigFile().socketDir + servicename);
  }

  //HareScript uses this event if waiting for service to come online. FIXME TS should too (it now spins in openBackendService)
  broadcast(`system: webhareservice.${servicename}.start`);
  return service;
}

export type { WebHareService };
