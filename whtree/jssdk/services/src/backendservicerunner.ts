import bridge, { IPCMessagePacket, IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";
import { createDeferred } from "@webhare/std";
import { ServiceInitMessage, ServiceCallMessage, WebHareServiceDescription, WebHareServiceIPCLinkType } from '@mod-system/js/internal/types';
import { checkModuleScopedName } from "@webhare/services/src/naming";
import { broadcast } from "@webhare/services/src/backendevents";

export type ServiceControllerFactoryFunction = () => Promise<BackendServiceController> | BackendServiceController;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need to match any possible arguments to be able to return a useful satifsyable type
export type ServiceClientFactoryFunction = (...args: any[]) => Promise<object> | object;

export interface BackendServiceController {
  createClient(...args: unknown[]): Promise<unknown>;
}

const setLink = Symbol("setLink");

export class BackendServiceConnection {
  #link?: LinkState;
  #eventQueue?: Array<{ event: string; data: unknown }>;

  constructor() {
  }
  emit(event: string, data: unknown) {
    if (!this.#link) {
      this.#eventQueue ||= [];
      this.#eventQueue.push({ event, data });
    } else {
      this.#link.link.send({ event, data });
    }
  }
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

  //iterate to top and discover all methods
  for (; inobj; inobj = Object.getPrototypeOf(inobj)) {
    const propnames = Object.getOwnPropertyNames(inobj);
    if (propnames.includes("toString"))
      break; //we've reached the root

    for (const name of propnames) {
      if (name === 'constructor' || name === 'emit' || name[0] === '_')
        continue; //no need to explain the constructor, it's already been invoked. and skip 'private' functions

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- never[] doesn't work here, it confuses the actual calls to runBackendService
export type ConnectionConstructor = (...args: any[]) => object;

interface ServiceConnection {
  [key: string]: (...args: unknown[]) => unknown;
}

class LinkState {
  handler: object | null;
  link: WebHareServiceIPCLinkType["AcceptEndPoint"];
  initdefer = createDeferred<boolean>();

  constructor(handler: object | null, link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    this.handler = handler;
    this.link = link;
  }
}

export class ServiceHandlerBase {
  private _factory: ConnectionConstructor;
  private _options: WebHareServiceOptions;

  constructor(servicename: string, factory: ConnectionConstructor, options: WebHareServiceOptions) {
    this._factory = factory;
    this._options = options;
  }

  async addLink(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    try {
      const state = new LinkState(null, link);
      link.on("close", () => this._onClose(state));
      link.on("message", _ => this._onMessage(state, _));
      link.on("exception", () => false);
      if (this._options.dropListenerReference)
        link.dropReference();

      await link.activate();
    } catch (e) {
      link.close();
    }
  }

  _onClose(state: LinkState) {
    if (state.handler && "_gotClose" in state.handler && typeof state.handler._gotClose == "function")
      state.handler._gotClose();
  }

  async _onMessage(state: LinkState, msg: WebHareServiceIPCLinkType["AcceptEndPointPacket"]) {
    if (!state.handler) {
      try {
        if (!this._factory)
          throw new Error("This service does not accept incoming connections");

        const initdata = msg as IPCMessagePacket<ServiceInitMessage>;

        // We'll pass the state object through a global to BackendServiceConnection (if any)
        const handlerpromise = this._factory(...initdata.message.__new);
        const handler = await handlerpromise;

        if (!state.handler)
          state.handler = handler;
        if (!state.handler)
          throw new Error(`Service handler initialization failed`);

        state.link.send(describePublicInterface(state.handler), msg.msgid);
        if (setLink in state.handler)
          (state.handler as BackendServiceConnection)[setLink](state);

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
      const args = message.jsargs ? JSON.parse(message.jsargs) : message.args; //javascript string-encodes messages so we don't lose property casing due to DecodeJSON/EncodeJSON
      const result = await (state.handler as ServiceConnection)[message.call].apply(state.handler, args) as IPCMarshallableData;
      state.link.send({ result: message.jsargs ? JSON.stringify(result) : result }, msg.msgid);
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

class WebHareService extends ServiceHandlerBase { //EXTEND IPCPortHandlerBase
  private _port: WebHareServiceIPCLinkType["Port"];

  constructor(port: WebHareServiceIPCLinkType["Port"], servicename: string, constructor: ConnectionConstructor, options: WebHareServiceOptions) {
    super(servicename, constructor, options);
    this._port = port;
    this._port.on("accept", link => this.addLink(link));
  }

  close() {
    this._port.close();
    super.close();
  }
}

/** Launch a WebHare service.
    Starts a WebHare service and pass the constructed objects to every incoming connection. The constructor
          can also be left empty - the service will then simply run until its shutdown or requires an autorestart.

    @param servicename - Name of the service (should follow the 'module:tag' pattern)
    @param constructor - Constructor to invoke for incoming connections. This object will be marshalled through %OpenWebhareService
    @param options - Service options
*/
export async function runBackendService(servicename: string, constructor: ConnectionConstructor, options?: WebHareServiceOptions) {
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
