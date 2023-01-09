import { ServiceCallMessage, ServiceCallResult, WebHareServiceDescription, WebHareServiceIPCLinkType } from "@mod-system/js/internal/types";
import bridge, { IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";

/** Interface for the client object we present to the connecting user
    TODO: model this more after jsonrpc-client? Would make it easier to deal with case insensitive HS services */
interface WebHareServiceClient {
  /** Our methods */
  [key: string]: (...args: unknown[]) => unknown | Promise<unknown>;
}

class WebHareServiceWrapper {
  private readonly link: WebHareServiceIPCLinkType["ConnectEndPoint"];
  readonly isjs: boolean;
  private readonly client: WebHareServiceClient;

  constructor(link: WebHareServiceIPCLinkType["ConnectEndPoint"], response: WebHareServiceDescription) {
    this.link = link;
    this.client = { close: function() { link.close(); } };
    this.isjs = response.isjs || false;
    for (const method of response.methods)
      this.client[method.name] = (...args: unknown[]) => this.remotingFunc(method, args);
  }

  getClient() {
    return this.client;
  }

  private async remotingFunc(method: { name: string }, args: unknown[]) {
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
 *  @param options - timeout: Maximum time to wait for the service to come online (default: 30sec)
 *                   linger: If true, service requires an explicit close() and will keep the process running
 */
export async function openBackendService(name: string, args?: unknown[], options?: BackendServiceOptions) {
  const link = bridge.connect<WebHareServiceIPCLinkType>("webhareservice:" + name, { global: true });
  const result = link.doRequest({ __new: (args as IPCMarshallableData[]) ?? [] }) as Promise<WebHareServiceDescription>;
  result.catch(() => false); // don't want this one to turn into a uncaught rejection

  try {
    await link.activate();

    const description = await result;

    if (!options?.linger)
      link.dropReference();

    return (new WebHareServiceWrapper(link, description)).getClient();
  } catch (e) {
    // The request will fail too, but that's expected if activation fails. The activation error is more important to throw.
    link.close();
    throw e;
  }
}

