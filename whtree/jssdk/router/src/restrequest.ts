import type { LoggableRecord } from "@webhare/services/src/logmessages";
import type { WebRequest } from "./request";
import { createJSONResponse, createWebResponse, type HTTPErrorCode, type HTTPSuccessCode, type WebResponse } from "./response";
import type { Simplify } from "@mod-system/js/internal/util/algorithms";
import type { DisallowExtraPropsRecursive } from "@webhare/js-api-tools";

export type RestDefaultErrorBody = { status: HTTPErrorCode; error: string };

/** Every rest responses specification must extend from this type. For allowed JSON responses, set `isjson`
 * to true and put the expected body type in `response`. For raw results, set isjson to true.
 */
export type RestResponsesBase =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for signature
  { status: HTTPSuccessCode; isjson: true; response: any } |
  { status: HTTPSuccessCode; isjson: false } |
  { status: HTTPErrorCode; isjson: true; response: unknown };

/// Default, you can send every response code as json or as raw
export type DefaultRestResponses =
  { status: HTTPSuccessCode; isjson: boolean; response: unknown };

/** Returns all responses that acccept json (could also do (`& { json: true }`, but this results in cleaner result
 * types. Intersections are usually kept in the result type and complicate type tests
 */
export type JSONResponses<Responses extends RestResponsesBase> = Responses extends { isjson: false } ? never : Responses;

/** Returns the allowed response codes for JSON responses. Error codes are always allowed, as are success codes
 * where isjson is set to true (or to true | false).
 */
export type JSONResponseCodes<Responses extends RestResponsesBase> = HTTPErrorCode | (Responses & { isjson: true })["status"];

/** Returns the allowed response codes for raw responses. Error codes are always allowed, as are success codes
 * where isjson is set to false (or to true | false).
 */
export type RawResponseCodes<Responses extends RestResponsesBase> = (Responses & { isjson: false })["status"];

export type DefaultRestParams = Record<string, string | number | boolean | string[]>;

/** For responses specified in Responses, returns the type of the JSON body */
export type ResponseForCode<
  Responses extends RestResponsesBase,
  DefaultErrorFormat extends object,
  C extends JSONResponseCodes<Responses>
> = C extends Responses["status"]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for type inference
  ? (Responses extends { response: any } ? C extends Responses["status"] ? Responses : never : never) // This allowes numeric status codes. To disallow them, use `? (Responses & { status: C; response: any })["response"]` instead
  : (C extends HTTPErrorCode ? { status: C; isjson: true; response: DefaultErrorFormat } : never); // for non-specified error codes, falls back to DefaultErrorFormat

/** For responses specified in Responses, returns the type of the JSON body */
export type JSONResponseForCode<
  Responses extends RestResponsesBase,
  DefaultErrorFormat extends object,
  C extends JSONResponseCodes<Responses>
> = ResponseForCode<Responses, DefaultErrorFormat, C>["response"];

export type MakeStatusOptional<T extends object> = Simplify<Partial<Pick<T, "status" & keyof T>> & Omit<T, "status">>;

declare const error: unique symbol;

export class RestRequest<
  Authorization = unknown,
  Params extends object = DefaultRestParams,
  Body = unknown,
  Responses extends RestResponsesBase = DefaultRestResponses,
  DefaultErrorFormat extends object = RestDefaultErrorBody
> {
  ///The original WebRequest we received
  readonly webRequest: WebRequest;
  ///The relative request path, starting with '/'
  readonly path: string;
  ///The route, starting with '/'
  readonly route: string;
  ///Rest parameters received
  readonly params: Params;
  ///The parsed body of the request (if this operation accepts an application/json body)
  readonly body: Body;

  ///Authorization result
  authorization: Authorization;

  constructor(webRequest: WebRequest, path: string, route: string, params: Params, body: Body) {
    this.webRequest = webRequest;
    this.path = path;
    this.route = route;
    this.params = params;
    this.body = body;
    this.authorization = null as Authorization;
  }

  /** Create a webresponse for a successfull response, returning a JSON body
   * @param status - Status code to return
   * @param jsonbody - The JSON body to return
   * @param options - Optional statuscode and headers
   */
  createJSONResponse<
    Status extends JSONResponseCodes<Responses> & HTTPSuccessCode,
    ResponseBody extends JSONResponseForCode<Responses, DefaultErrorFormat, Status>
  >(
    status: Status,
    jsonbody: ResponseBody & DisallowExtraPropsRecursive<ResponseBody, JSONResponseForCode<Responses, DefaultErrorFormat, Status>>,
    options?: { headers?: Record<string, string> }
  ) {
    return createJSONResponse(status, jsonbody, options);
  }
  /** Create a webresponse for an error response, returning a JSON body. Only allowed when the return body can
   * contain a 'status' property.
   * @param status - Status code to return
   * @param jsonbody - The JSON body to return
   * @param options - Optional statuscode and headers
   */
  createErrorResponse<
    Status extends HTTPErrorCode,
    ResponseBody extends JSONResponseForCode<Responses, DefaultErrorFormat, Status> & object
  >(
    status: Status,
    jsonbody: ResponseBody extends { status?: number } ?
      MakeStatusOptional<ResponseBody & DisallowExtraPropsRecursive<ResponseBody, JSONResponseForCode<Responses, DefaultErrorFormat, Status>>> :
      { [error]: "Cannot use this function, the error schema doesn't contain a 'status' property" },
    options?: { headers?: Record<string, string> }
  ) {
    return createJSONResponse(status, { status, ...jsonbody as object }, options);
  }

  /** Create a webresponse for a successfull response, returning a raw file
   * @typeParam Status - Inferred type of the status code, used for typing purposes
   * @param status - Status code to return
   * @param body - The body of the response to return
   * @param options - Optional statuscode and headers
   */
  createRawResponse<Status extends RawResponseCodes<Responses>>(status: Status, body: string | Blob | ReadableStream<Uint8Array>, options?: { headers?: Record<string, string> }) {
    return createWebResponse(body, { status, headers: options?.headers });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for type inference
type ResponsesOfRequest<Request extends RestRequest> = Request extends RestRequest<any, any, any, infer Responses> ? Responses : never;

/** Returns the JSON response type for a specific status code
 * @typeParam Request - Type of the Rest request (typically `typeof req` in an openapi handler function)
 * @typeParam Status - Status code. If omitted, defaults to all success codes specified in the Responses type parameter of the rest request
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RestResponseType<Request extends RestRequest<any, any, any, any, any>, Status extends ResponsesOfRequest<Request>["status"] = ResponsesOfRequest<Request>["status"] & HTTPSuccessCode> = (ResponsesOfRequest<Request> & { status: Status })["response"];

/** Returned upon a succesful authorization. May be extended to store authorization details */
export interface RestSuccessfulAuthorization<AuthInternal = unknown, LogInfo = LoggableRecord> {
  //TODO expire/cache/validity info? the handler should explain us which headers it looked at (like 'Vary'?)
  authorized: true;
  /** This authorization will be set as the request's authorization */
  authorization: AuthInternal;
  /** Information to log about this user with any context information (apicalls, errors) */
  loginfo?: LogInfo;
}

/** Returned upon a failed autorization. May optionally contain a WebResponse to send to the user (if not set, a 401 Unauthorized error is returned) */
export interface RestFailedAuthorization {
  authorized: false;
  response?: WebResponse;
}

/** Return type for a RestAuthorizationFunction */
export type RestAuthorizationResult<AuthInternal = unknown, LogInfo = LoggableRecord> = RestSuccessfulAuthorization<AuthInternal, LogInfo> | RestFailedAuthorization;

/** Signature for a x-webhare-authorization function */
export type RestAuthorizationFunction = (request: RestRequest) => Promise<RestAuthorizationResult>;

/** Signature for a x-webhare-implementation function */
export type RestImplementationFunction = (request: RestRequest) => Promise<WebResponse>;

/** Signature for a x-webhare-default-error-mapper function */
export type RestDefaultErrorMapperFunction = (data: { status: HTTPErrorCode; error: string }) => Promise<WebResponse>;
