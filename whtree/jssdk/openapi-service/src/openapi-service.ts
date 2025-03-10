/** Library to test and impplement WebHare-based OpenAPI services */

import { getServiceInstance } from "@mod-system/js/internal/openapi/openapiservice";
import { debugFlags } from "@webhare/env";
import { extractRequestBody, extractRequestInfo, logWrqRequest, logWrqResponse } from "@webhare/env/src/fetchdebug";
import { createWebResponse, type HTTPMethod } from "@webhare/router";
import { WebHareBlob } from "@webhare/services";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/openapi-service" {
}

async function convertBody(body: BodyInit | null | undefined): Promise<WebHareBlob> {
  if (!body)
    return WebHareBlob.from("");

  const extract = await extractRequestBody(body);
  if (extract instanceof Blob)
    return WebHareBlob.fromBlob(extract);

  //@ts-ignore FIXME deal with arraybufferviews
  return WebHareBlob.from(extract);
}

//TODO: Like PSPWebResponse extend the subset until we just have Response. But especiaally here internally it doens't matter much
export type OpenAPIWebResponse = Pick<Response, "ok" | "status" | "headers" | "json" | "text" | "arrayBuffer">;

/** The fetch API expected by an OpenAPICall - a subset of the actual fetch() API to allow mocking/direct connections */
export type OpenAPIClientFetch = (input: string, init?: RequestInit) => Promise<OpenAPIWebResponse>;

/** Returns an OpenAPIClientFetch compatible fetch that sets up the openapi service (but not (yet?) the workers) in the same JavaScript VM*/
export async function getDirectOpenAPIFetch(service: string, options?: {
  //Override the base URL pretended that we're hosting the service. This usually matters for Origin checks. Defaults to "https://example.net/api/"
  baseUrl?: string;
}): Promise<OpenAPIClientFetch & Disposable> {
  const serviceinstance = await getServiceInstance(service);

  const fetchCall: OpenAPIClientFetch & Disposable = async (route: string, init?: RequestInit) => {
    const { method, headers, body } = extractRequestInfo(route, init);
    const finalbody = await convertBody(body);

    const reqid = debugFlags.wrq ? logWrqRequest(method, route, headers, finalbody) : null;
    let baseUrl = options?.baseUrl || "https://example.net/api/";
    if (!baseUrl.endsWith("/"))
      baseUrl += '/';

    const res = await serviceinstance.APICall({
      sourceip: "127.0.0.1",
      method: method.toUpperCase() as HTTPMethod,
      url: baseUrl + route,
      body: finalbody,
      headers: Object.fromEntries(headers.entries())
    }, route);

    const response = createWebResponse(res.body.size ? await res.body.arrayBuffer() : undefined, res);
    if (reqid)
      await logWrqResponse(reqid, response);

    return response;
  };
  fetchCall[Symbol.dispose] = () => serviceinstance[Symbol.dispose]();
  return fetchCall;
}
