import bridge, { type IPCLinkType } from "@mod-system/js/internal/whmanager/bridge";
import { backendConfig, WebHareBlob } from "@webhare/services";
import { generateRandomId } from "@webhare/std";
import { createWebRequestFromTransferData, type HTTPMethod, type WebRequest } from "./request";
import { createWebResponseFromTransferData, createWebResponse, HTTPErrorCode, type WebResponse } from "./response";

type EphemeralEndpointLink = IPCLinkType<{
  method: HTTPMethod;
  url: string;
  headers: Array<[string, string]>;
  clientwebserver: number;
  clientip: string;
  baseurl: string;
  localpath: string;
  body: WebHareBlob | null;
}, {
  status: number;
  headers: Array<[string, string]>;
  body: WebHareBlob | null;
  trace: string;
}>;

export interface EphemeralEndpoint extends Disposable {
  readonly url: string;
  /** Stop accepting requests and disconnect outstanding requests. Subsequent requests return HTTP 503. */
  close(): void;
}

/** Create an ephemeral backend endpoint served by a callback in this process.
 * The endpoint remains available until closed, disposed, or this process exits.
 * Requests to subpaths are supported. The callback's baseURL is the endpoint URL with a trailing slash,
 * and localPath is the URL-decoded, lowercase path relative to that base.
 * @param callback - Handle each incoming request and return its response.
 * @returns A handle containing the URL. Close or dispose it when no longer needed.
 */
export async function createEphemeralEndpoint(callback: (request: WebRequest) => Promise<WebResponse>): Promise<EphemeralEndpoint> {
  const id = generateRandomId();
  const port = bridge.createPort<EphemeralEndpointLink>(`platform:webserver.ephemeralendpoint.${id}`, { global: true });
  const links = new Set<EphemeralEndpointLink["AcceptEndPoint"]>();
  const close = () => {
    port.close();
    for (const link of links)
      link.close();
  };

  port.on("accept", link => {
    links.add(link);
    link.on("close", () => links.delete(link));
    link.on("message", packet => void (async () => {
      try {
        const data = packet.message;
        const request = createWebRequestFromTransferData({
          method: data.method,
          url: data.url,
          headers: data.headers,
          clientWebServer: data.clientwebserver,
          clientIp: data.clientip,
          baseURL: data.baseurl,
          localPath: data.localpath,
          body: data.body ? await data.body.arrayBuffer() : null
        });
        const { value: response } = await (await callback(request)).encodeForTransfer();
        link.send({
          status: response.status,
          headers: response.headers,
          body: response.bodybuffer === null ? null : WebHareBlob.from(response.bodybuffer),
          trace: response.trace ?? ""
        }, packet.msgid);
      } catch (error) {
        link.sendException(error, packet.msgid);
      }
    })());
    void link.activate().catch(error => {
      bridge.logError(error);
      link.close();
    });
  });

  try {
    await port.activate();
  } catch (error) {
    close();
    throw error;
  }

  return {
    url: `${backendConfig.backendURL}.wh/endpoints/ephemeral/${id}`,
    close,
    [Symbol.dispose]: close
  };
}

export async function handleEphemeralEndpoint(request: WebRequest, id: string): Promise<WebResponse> {
  using link = bridge.connect<EphemeralEndpointLink>(`platform:webserver.ephemeralendpoint.${id}`, { global: true });
  try {
    await link.activate();
  } catch {
    return createWebResponse("Ephemeral endpoint is no longer available", { status: HTTPErrorCode.ServiceUnavailable });
  }

  const { value: data } = request.encodeForTransfer();
  const url = new URL(request.url);
  const baseURL = new URL(`/.wh/endpoints/ephemeral/${id}/`, url);
  let response;
  try {
    response = await link.doRequest({
      method: data.method,
      url: data.url,
      headers: data.headers,
      clientwebserver: data.clientWebServer,
      clientip: data.clientIp,
      baseurl: baseURL.href,
      localpath: decodeURIComponent(url.pathname.slice(baseURL.pathname.length)).toLowerCase(),
      body: data.body === null ? null : WebHareBlob.from(data.body)
    });
  } catch (error) {
    if (!link.closed)
      throw error;
    return createWebResponse("Ephemeral endpoint is no longer available", { status: HTTPErrorCode.ServiceUnavailable });
  }
  return createWebResponseFromTransferData({
    status: response.status,
    headers: response.headers,
    bodybuffer: response.body ? await response.body.arrayBuffer() : null,
    trace: response.trace || undefined
  });
}
