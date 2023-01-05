import bridge, { IPCMessagePacket, IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";
import { createDeferred } from "./tools";
import { ServiceInitMessage, ServiceCallMessage, WebHareServiceDescription, WebHareServiceIPCLinkType } from './types';

interface WebHareServiceOptions {
  autorestart?: boolean;
  restartimmediately?: boolean;
  //TODO __droplistenerreference is now a hack for the incoming bridgemgmt service which should either become permanent or go away once bridge uses IPClinks for that
  __droplistenerreference?: boolean;
}

//Describe a JS public interface in a HS compatible way
function describePublicInterface(inobj: object): WebHareServiceDescription {
  const methods = [];

  //iterate to top and discover all methods
  for (; inobj; inobj = Object.getPrototypeOf(inobj)) {
    const propnames = Object.getOwnPropertyNames(inobj);
    if (propnames.includes("toString"))
      break; //we've reached the root

    for (const name of propnames) {
      if (name === 'constructor' || name[0] === '_')
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- never[] doesn't work here, it confuses the actual calls to runWebHareService
export type ConnectionConstructor = (...args: any[]) => object;

interface ServiceConnection {
  [key: string]: (...args: unknown[]) => unknown;
}

class WebHareService { //EXTEND IPCPortHandlerBase
  private _port: WebHareServiceIPCLinkType["Port"];
  private _constructor: ConnectionConstructor;
  private _links: Array<{ handler: object; link: object }>;
  private _options: WebHareServiceOptions;
  private firstpacket?= createDeferred<IPCMessagePacket<ServiceInitMessage>>();

  constructor(port: WebHareServiceIPCLinkType["Port"], servicename: string, constructor: ConnectionConstructor, options: WebHareServiceOptions) {
    this._port = port;
    this._constructor = constructor;
    this._port.on("accept", link => this._onLinkAccepted(link));
    this._links = [];
    this._options = options;
  }

  async _onLinkAccepted(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
    try {
      link.on("message", _ => this._onMessage(link, _));
      await link.activate();
      const packet = await this.firstpacket?.promise;
      if (packet)
        this._setupLink(link, packet.message, packet.msgid);
    } catch (e) {
      console.log("_onLinkAccepted error", e);
      link.close();
    }
  }

  async _setupLink(link: WebHareServiceIPCLinkType["AcceptEndPoint"], msg: ServiceInitMessage, id: bigint) {
    try {
      if (!this._constructor)
        throw new Error("This service does not accept incoming connections");

      const handler = await this._constructor(...msg.__new);
      link.on("message", _ => this._onMessage(link, _));
      link.on("exception", () => false);
      //const itf = describePublicInterface(handler);
      link.send(describePublicInterface(handler), id);
      if (this._options.__droplistenerreference)
        link.dropReference();

      this._links.push({ handler, link });
    } catch (e) {
      console.log("_setupLink error", e);
      link.sendException(e as Error, id);
      link.close();
    }
  }

  async _onMessage(link: WebHareServiceIPCLinkType["AcceptEndPoint"], msg: WebHareServiceIPCLinkType["AcceptEndPointPacket"]) {
    try {
      if (this.firstpacket) {
        this.firstpacket.resolve(msg as IPCMessagePacket<ServiceInitMessage>);
        this.firstpacket = undefined;
        return;
      }

      const message = msg.message as ServiceCallMessage;
      const pos = this._links.findIndex(_ => _.link === link);
      const args = message.jsargs ? JSON.parse(message.jsargs) : message.args; //javascript string-encodes messages so we don't lose property casing due to DecodeJSON/EncodeJSON
      const result = await (this._links[pos].handler as ServiceConnection)[message.call].apply(this._links[pos].handler, args) as IPCMarshallableData;
      link.send({ result: message.jsargs ? JSON.stringify(result) : result }, msg.msgid);
    } catch (e) {
      link.sendException(e as Error, msg.msgid);
    }
  }

  async _onException(link: WebHareServiceIPCLinkType["AcceptEndPoint"], msg: WebHareServiceIPCLinkType["ExceptionPacket"]) {
    // ignore exceptions, not sent by connecting endpoints
  }

}

/** Launch a WebHare service.
    Starts a WebHare service and pass the constructed objects to every incoming connection. The constructor
          can also be left empty - the service will then simply run until its shutdown or requires an autorestart.

    @param servicename - Name of the service (should follow the 'module:tag' pattern)
    @param constructor - Constructor to invoke for incoming connections. This object will be marshalled through %OpenWebhareService
    @param options - Options.<br>
     - autorestart: Automatically restart the service if the source code has changed. Defaults to TRUE
     - restartimmediately: Immediately restart the service even if we stil have open connections. Defaults to FALSE
*/
export default async function runWebHareService(servicename: string, constructor: ConnectionConstructor, options?: WebHareServiceOptions) {
  options = { autorestart: true, restartimmediately: false, __droplistenerreference: false, ...options };
  if (!servicename.match(/^.+:.+$/))
    throw new Error("A service should have a <module>:<service> name");

  const hostport = bridge.createPort<WebHareServiceIPCLinkType>("webhareservice:" + servicename, { global: true });
  const service = new WebHareService(hostport, servicename, constructor, options);

  if (options.__droplistenerreference)
    hostport.dropReference();

  await hostport.activate();

  return service;
}
