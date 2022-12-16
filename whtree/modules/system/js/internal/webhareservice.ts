import WHBridge, { IPCListenerPort, IPCLink } from './bridge';

/** Encode into a record for transfer over IPC. Use RegisterReceivedExceptionType to register decoders for other types
    of exception.
    @returns Encoded exception
*/
function encodeExceptionForIPC(e: unknown) {
  let what = String(e);
  if (what.startsWith("Error: "))
    what = what.substring(7); //for compatibility with HareScript exceptins

  return {
    type: "exception",
    what: what,
    trace: [] //TODO
  };
}


//Describe a JS public interface in a HS compatible way
function describePublicInterface(inobj: object) {
  const methods: object[] = [];

  //iterate to top and discover all methods
  for (; inobj; inobj = Object.getPrototypeOf(inobj)) {
    const propnames = Object.getOwnPropertyNames(inobj);
    if (propnames.includes("toString"))
      break; //we've reached the root

    for (const name of propnames) {
      if (name === 'constructor' || name[0] === '_')
        continue; //no need to explain the constructor, it's already been invoked. and skip 'private' functions

      const params: object[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cleanup later, creating interfaces this way is ugly anyway
      for (let i = 0; i < (inobj as any)[name].length; ++i)
        params.push({ type: 1, has_default: true }); //pretend all params to be variants

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
  return { methods };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- never[] doesn't work here, it confuses the actual calls to runWebHareService
export type ConnectionConstructor = (...args: any[]) => object;

interface ServiceConnection {
  [key: string]: (...args: unknown[]) => unknown;
}


interface ServiceCallMessage {
  /** invoked method */
  call: string;
  /** arguments */
  args: unknown[];
}

class WebHareService { //EXTEND IPCPortHandlerBase
  private _port: IPCListenerPort;
  private _constructor: ConnectionConstructor;
  private _links: Array<{ handler: object; link: object }>;

  constructor(port: IPCListenerPort, servicename: string, constructor: ConnectionConstructor, options: object) {
    this._port = port;
    this._constructor = constructor;
    this._port.on("accept", link => this._onLinkAccepted(link));
    this._links = [];
  }
  async _onLinkAccepted(link: IPCLink) {
    try {
      //TODO can we use something like liveapi's async event waiters?
      const messagepromise = link.waitOn("message");
      link.accept();
      const packet = await messagepromise;
      this._setupLink(link, packet.message as { __new: unknown[] }, packet.msgid);
    } catch (e) {
      console.log("_onLinkAccepted error", e);
      WHBridge._closeLink(link);
    }
  }

  async _setupLink(link: IPCLink, msg: { __new: unknown[] }, id: number) {
    try {
      if (!this._constructor)
        throw new Error("This service does not accept incoming connections");

      const handler = await this._constructor(...msg.__new);
      link.on("message", _ => this._onMessage(link, _));
      link.send(describePublicInterface(handler), id);

      this._links.push({ handler, link });
    } catch (e) {
      console.log("_setupLink error", e);
      link.sendException(e as Error, id);
      WHBridge._closeLink(link);
    }
  }

  async _onMessage(link: IPCLink, msg: unknown) {
    const parsed = msg as { message: ServiceCallMessage; msgid: number };
    const message = parsed.message;
    const replyid = parsed.msgid;
    try {
      const pos = this._links.findIndex(_ => _.link === link);
      const result = await (this._links[pos].handler as ServiceConnection)[message.call].apply(this._links[pos].handler, message.args);
      link.send({ result }, replyid);
    } catch (e) {
      link.send({ exc: encodeExceptionForIPC(e) }, replyid);
    }
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
export default async function runWebHareService(servicename: string, constructor: ConnectionConstructor, { autorestart, restartimmediately } = { autorestart: true, restartimmediately: false }) {
  if (!servicename.match(/^.+:.+$/))
    throw new Error("A service should have a <module>:<service> name");

  const hostport = new IPCListenerPort;
  const service = new WebHareService(hostport, servicename, constructor, { autorestart, restartimmediately });
  await hostport.listen("webhareservice:" + servicename, true);
  return service;
}
