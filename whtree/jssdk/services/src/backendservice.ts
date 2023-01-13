import { ServiceCallMessage, ServiceCallResult, WebHareServiceDescription, WebHareServiceIPCLinkType } from "@mod-system/js/internal/types";
import bridge, { IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";

/** Interface for the client object we present to the connecting user
    TODO: model this more after jsonrpc-client? Would make it easier to deal with case insensitive HS services */
interface DefaultWebHareServiceClient {
  /** Our methods */
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}

type ServiceBase = {
  close(): void;
};

class ServiceProxy<T extends object> implements ProxyHandler<T & ServiceBase> {
  link: WebHareServiceIPCLinkType["ConnectEndPoint"];
  isjs: boolean;
  description: WebHareServiceDescription;

  constructor(link: WebHareServiceIPCLinkType["ConnectEndPoint"], description: WebHareServiceDescription) {
    this.link = link;
    this.description = description;
    this.isjs = description.isjs || false;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === 'close') //create a close() function
      return () => this.closeService();

    if (this.description.methods.find(m => m.name === prop)) {
      return (...args: unknown[]) => this.remotingFunc({ name: prop }, args);
    }

    return undefined;
  }

  has(target: object, prop: string): boolean {
    return Boolean(this.description.methods.find(m => m.name === prop)) || prop == "close";
  }

  set(target: object, prop: string): boolean {
    throw new Error(`Cannot override service functions, trying to change property ${JSON.stringify(prop)}`);
  }

  closeService() {
    this.link.close();
  }

  async remotingFunc(method: { name: string }, args: unknown[]) {
    const calldata: ServiceCallMessage = { call: method.name };
    if (this.isjs)
      calldata.jsargs = JSON.stringify(args);
    else
      calldata.args = args as IPCMarshallableData[];

    const response = await this.link.doRequest(calldata) as ServiceCallResult;
    if (this.isjs)
      return JSON.parse(response.result as string);
    else
      return response.result;
  }
}

export interface BackendServiceOptions {
  timeout?: number;
  linger?: boolean;
}

/** Open a WebHare backend service
 *  @param name - Service name (a module:service pair)
 *  @param args - Arguments to pass to the constructor
 *  @param options - timeout: Maximum time to wait for the service to come online in msecs (default: 30sec)
 *                   linger: If true, service requires an explicit close() and will keep the process running
 */
export async function openBackendService<T extends object = DefaultWebHareServiceClient>(name: string, args?: unknown[], options?: BackendServiceOptions): Promise<T & ServiceBase> {

  const startconnect = Date.now(); //only used for exception reporting
  const deadline = new Promise(resolve => setTimeout(() => resolve(false), options?.timeout || 30000).unref());

  for (; ;) { //repeat until we're connected
    const link = bridge.connect<WebHareServiceIPCLinkType>("webhareservice:" + name, { global: true });
    const result = link.doRequest({ __new: (args as IPCMarshallableData[]) ?? [] }) as Promise<WebHareServiceDescription>;
    result.catch(() => false); // don't want this one to turn into an uncaught rejection

    //Try to setup a link. Loop until deadline if activate() fails
    try {
      //wrap activate() in a promise returning true, so we can differentiate from the deadline returning false
      const linkpromise = link.activate().then(() => true);

      const connected = await Promise.race([linkpromise, deadline]);
      if (!connected) {
        link.close();
        break; //timeout!
      }
    } catch (e) {
      link.close();
      continue;
    }

    try {
      const description = await result;
      if (!options?.linger)
        link.dropReference();

      return new Proxy({}, new ServiceProxy(link, description)) as T & ServiceBase;
    } catch (e) {
      link.close();
      throw e; //not relooping if describing fails
    }
  }
  throw new Error(`Service '${name}' is unavailable (tried to connect for ${Date.now() - startconnect} ms)`);
}
