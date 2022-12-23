import { IPCLink } from "@mod-system/js/internal/bridge";
import { ServiceCallMessage, WebHareServiceDescription } from "@mod-system/js/internal/types";

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

class WebHareServiceWrapper {
  private readonly port: IPCLink;
  readonly isjs: boolean;
  private readonly client: WebHareServiceClient;

  constructor(port: IPCLink, response: WebHareServiceDescription) {
    this.port = port;
    this.client = { close: function() { port.close(); } };
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

    const response = await this.port.doRequest(calldata) as RemoteCallResponse;
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
  //FIXME implement timeout
  const link = new IPCLink;
  try {
    await link.connect("webhareservice:" + name, true);
    const description = await link.doRequest({ __new: args ?? [] }) as WebHareServiceDescription;
    if (!options?.linger)
      link.dropReference();

    return (new WebHareServiceWrapper(link, description)).getClient();
  } catch (e) {
    link.close();
    throw e;
  }
}

