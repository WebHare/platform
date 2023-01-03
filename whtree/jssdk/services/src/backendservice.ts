import { ServiceCallMessage, WebHareServiceDescription } from "@mod-system/js/internal/types";
import bridge, { IPCEndPoint } from "@mod-system/js/internal/whmanager/bridge";

/** Interface for the client object we present to the connecting user
    TODO: model this more after jsonrpc-client? Would make it easier to deal with case insensitive HS services */
interface WebHareServiceClient {
  /** Our methods */
  [key: string]: (...args: unknown[]) => unknown;
}

interface RemoteCallResponse {
  result?: unknown;
  exc?: { what: string };
}

type ServiceInitMessage = {
  __new: unknown[];
};

type ServiceIPCEndPoint = IPCEndPoint<ServiceInitMessage | ServiceCallMessage, WebHareServiceDescription | RemoteCallResponse>;


class WebHareServiceWrapper {
  private readonly link: ServiceIPCEndPoint;
  readonly isjs: boolean;
  private readonly client: WebHareServiceClient;

  constructor(link: ServiceIPCEndPoint, response: WebHareServiceDescription) {
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
      calldata.args = args;

    const response = await this.link.doRequest(calldata) as RemoteCallResponse;
    if (response.exc)
      throw new Error(response.exc.what);
    else if (this.isjs)
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
  const link = bridge.connect<ServiceInitMessage | ServiceCallMessage, WebHareServiceDescription | RemoteCallResponse>("webhareservice:" + name, { global: true });
  const result = link.doRequest({ __new: args ?? [] }) as Promise<WebHareServiceDescription>;
  await link.activate();

  const description = await result;

  if (!options?.linger)
    link.dropReference();

  return (new WebHareServiceWrapper(link, description)).getClient();
}

