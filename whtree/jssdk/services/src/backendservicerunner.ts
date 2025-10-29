import bridge, { type IPCMessagePacket, type IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";
import type { ServiceInitMessage, ServiceCallMessage, WebHareServiceDescription, WebHareServiceIPCLinkType } from '@mod-system/js/internal/types';
import { checkModuleScopedName } from "@webhare/services/src/naming";
import { broadcast } from "@webhare/services/src/backendevents";
import { setLink } from "./symbols";
import { parseTyped, stringify } from "@webhare/std";

export type ServiceControllerFactoryFunction = (options?: { debug?: boolean }) => Promise<BackendServiceController> | BackendServiceController;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need to match any possible arguments to be able to return a useful satifsyable type
export type ServiceClientFactoryFunction = (...args: any[]) => Promise<BackendServiceConnection> | BackendServiceConnection;

export interface BackendServiceController {
  createClient(...args: unknown[]): Promise<BackendServiceConnection> | BackendServiceConnection;
}

/** Base class for service connections */
export class BackendServiceConnection implements Disposable {
  #link?: LinkState;
  #eventQueue?: Array<{ event: string; data: unknown }>;

  constructor() {
  }

  /** Emit an event to the client */
  emit(event: string, data: unknown) {
    if (!this.#link) {
      this.#eventQueue ||= [];
      this.#eventQueue.push({ event, data });
    } else {
      this.#link.link.send({ event, data });
    }
  }

  /** Invoke to close this connection. This will cause onClose to be invoked */
  [Symbol.dispose]() {
    this.#link?.link.close();
  }

  /** Invoked when the client explicitly closed the connection */
  onClose() {
  }

  //private api used to associate the connection with a link
  [setLink](link: LinkState) {
    while (this.#eventQueue?.length)
      link.link.send(this.#eventQueue.shift()!);

    this.#link = link;
    this.#eventQueue = undefined;
  }
}

export interface WebHareServiceOptions {
  ///Enable automatic restart of the service when the source code changes. Defaults to true
  autoRestart?: boolean;
  ///Immediately restart the service even if we stil have open connections.
  restartImmediately?: boolean;
  //Don't keep a reference to the listening port, preventing this service from keeping the process alive
  dropListenerReference?: boolean;
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

export type ConnectionFactory = (...args: unknown[]) => Promise<BackendServiceConnection> | BackendServiceConnection;

interface ServiceConnection {
  [key: string]: (...args: unknown[]) => unknown;
}

class LinkState {
  handler: BackendServiceConnection | null;
  link: WebHareServiceIPCLinkType["AcceptEndPoint"];
  initdefer = Promise.withResolvers<boolean>();

  constructor(handler: BackendServiceConnection | null, link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    this.handler = handler;
    this.link = link;
  }
}

export class ServiceHandlerBase {
  private _factory: ConnectionFactory;
  private _options: WebHareServiceOptions;

  constructor(servicename: string, factory: ConnectionFactory, options: WebHareServiceOptions) {
    this._factory = factory;
    this._options = options;
  }

  async addLink(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    try {
      const state = new LinkState(null, link);
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

  _onClose(state: LinkState) {
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
      state.link.sendException(e as Error, msg.msgid);
    }
  }

  async _onException(link: WebHareServiceIPCLinkType["AcceptEndPoint"], msg: WebHareServiceIPCLinkType["ExceptionPacket"]) {
    // ignore exceptions, not sent by connecting endpoints
  }

  close() {
  }

  emit(name: string, detail: unknown) {
  }
}

class WebHareService extends ServiceHandlerBase implements Disposable { //EXTEND IPCPortHandlerBase
  private _port: WebHareServiceIPCLinkType["Port"];

  constructor(port: WebHareServiceIPCLinkType["Port"], servicename: string, constructor: ConnectionFactory, options: WebHareServiceOptions) {
    super(servicename, constructor, options);
    this._port = port;
    this._port.on("accept", link => void this.addLink(link));
  }

  close() {
    this._port.close();
    super.close();
  }

  [Symbol.dispose]() {
    this.close();
  }
}

/** Launch a WebHare service.
    Starts a WebHare service and pass the constructed objects to every incoming connection. The constructor
          can also be left empty - the service will then simply run until its shutdown or requires an autorestart.

    @param servicename - Name of the service (should follow the 'module:tag' pattern)
    @param constructor - Constructor to invoke for incoming connections. This object will be marshalled through %OpenWebhareService
    @param options - Service options
*/
export async function runBackendService(servicename: string, constructor: ConnectionFactory, options?: WebHareServiceOptions): Promise<WebHareService> {
  options = { autoRestart: true, restartImmediately: false, dropListenerReference: false, ...options };
  checkModuleScopedName(servicename);

  const hostport = bridge.createPort<WebHareServiceIPCLinkType>("webhareservice:" + servicename, { global: true });
  const service = new WebHareService(hostport, servicename, constructor, options);

  if (options.dropListenerReference)
    hostport.dropReference();

  await hostport.activate();
  //HareScript uses this event if waiting for service to come online. FIXME TS should too (it now spins in openBackendService)
  broadcast(`system:webhareservice.${servicename}.start`);

  return service;
}

export type { WebHareService };
