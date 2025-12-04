/** Library to test and implement WebHare-based OpenAPI services */

import { getServiceInstance } from "@mod-system/js/internal/openapi/openapiservice";
import { debugFlags } from "@webhare/env";
import { extractRequestBody, extractRequestInfo, logWrqRequest, logWrqResponse } from "@webhare/env/src/fetchdebug";
import { createJSONResponse, createWebResponse, HTTPErrorCode, type HTTPMethod, type RestAuthorizationResult, type RestRequest } from "@webhare/router";
import { WebHareBlob } from "@webhare/services";
import { getApplyTesterForURL } from "@webhare/whfs/src/applytester";
import { WRDSchema } from "@webhare/wrd";
import { IdentityProvider } from "@webhare/auth/src/identity";
import type { WRDAuthAccountStatus } from "@webhare/auth";
export type { RestResponseType as OpenAPIResponseType } from "@webhare/router/src/restrequest";
export { type RestDefaultErrorMapperFunction as OpenAPIDefaultErrorMapperFunction, type RestImplementationFunction as OpenAPIImplementationFunction, type OpenAPIServiceInitializationContext, HTTPSuccessCode, HTTPErrorCode, type RestRequest as OpenAPIRequest, type RestAuthorizationResult as OpenAPIAuthorization, type RestAuthorizationFunction as OpenAPIAuthorizationFunction } from "@webhare/router";
export type { OpenAPIHandlerInitializationContext } from "@webhare/router/src/openapi";

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

//TODO: Like PSPWebResponse extend the subset until we just have Response. But especially here internally it doesn't matter much
export type OpenAPIResponse = Pick<Response, "ok" | "status" | "headers" | "json" | "text" | "arrayBuffer">;

/** The fetch API expected by an OpenAPICall - a subset of the actual fetch() API to allow mocking/direct connections */
export type OpenAPIClientFetch = (input: string, init?: RequestInit) => Promise<OpenAPIResponse>;

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

/** Describes a WRD API user authenticated by verifyWRDAPIUser */
export type AuthorizedWRDAPIUser = {
  /** WRD schema we've authenticated to */
  wrdSchema: string;
  /** Authenticated WRD entity#  */
  userId: number;
  /** ID of the wrd.tokens row the user authenticatd with */
  tokenId: number;
  /** Scopes granted to this API key */
  scopes: string[];
  /** Entity account status if available */
  accountStatus: WRDAuthAccountStatus | null;
};

/** Craft a 403/401 error response. Should be used by verifyWRDAPIUser wrappers  */
export function failWRDAPIUserAuth(error: string, errorCode: HTTPErrorCode.Unauthorized | HTTPErrorCode.Forbidden = HTTPErrorCode.Forbidden): RestAuthorizationResult<AuthorizedWRDAPIUser> {
  return {
    authorized: false,
    response: createJSONResponse(errorCode, {
      error
    }, {
      headers: { "WWW-Authenticate": "Bearer" }
    })
  };
}

/** Verify whether the current API call was done by a proper WRD user. Use or wrap this function to perform additional user/scope checks
 * @param req - Received request
 * @returns - Result of the authentication. If authorized, the result contains the WRD schema and user ID
*/
export async function verifyWRDAPIUser(req: RestRequest): Promise<RestAuthorizationResult<AuthorizedWRDAPIUser>> {
  const key = req.webRequest.headers.get("authorization");
  if (!key || !key.toLowerCase().startsWith("bearer "))
    return failWRDAPIUserAuth("Missing 'Authorization: bearer ....' header", 401);

  const applytester = await getApplyTesterForURL(req.webRequest.url);
  const wrdauth = await applytester?.getWRDAuth();
  if (!wrdauth)
    return failWRDAPIUserAuth("No authentication configured for this URL");
  if (!wrdauth.wrdSchema)
    return failWRDAPIUserAuth("No WRD Schema configured for this URL");

  const idp = new IdentityProvider(new WRDSchema(wrdauth.wrdSchema));
  const res = await idp.verifyAccessToken("api", key.substring(7).trim());
  if ("error" in res)
    return failWRDAPIUserAuth(res.error, 401);

  return {
    authorized: true,
    loginfo: {
      userId: res.entity,
      tokenId: res.tokenId,
    },
    authorization: {
      wrdSchema: wrdauth.wrdSchema,
      userId: res.entity,
      tokenId: res.tokenId,
      scopes: res.scopes,
      accountStatus: res.accountStatus,
    }
  };
}
