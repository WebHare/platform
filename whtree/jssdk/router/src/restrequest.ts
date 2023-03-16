import { WebRequest } from "./request";
import { createJSONResponse, HTTPStatusCode, HTTPSuccessCode, WebResponse } from "./response";

export type DefaultRestParams = Record<string, string | number>;

export type DefaultRestResponses = { status: HTTPStatusCode; response: unknown };

export class RestRequest<
  Authorization = unknown,
  Params extends object = DefaultRestParams,
  Body = unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for signature
  Responses extends { status: HTTPStatusCode; response: any } = DefaultRestResponses,
> {
  ///The original WebRequest we received
  readonly webrequest: WebRequest;
  ///The relative request path, starting with '/'
  readonly path: string;
  ///Rest parameters received
  readonly params: Params;
  ///The parsed body of the request (if this operation accepts an application/json body)
  readonly body: Body;

  ///Authorization result
  authorization: Authorization;

  constructor(webrequest: WebRequest, path: string, params: Params, body: Body) {
    this.webrequest = webrequest;
    this.path = path;
    this.params = params;
    this.body = body;
    this.authorization = null as Authorization;
  }

  createJSONResponse<C extends Responses["status"] & HTTPStatusCode>(status: C, jsonbody: (Responses & { status: C })["response"], options?: { headers?: Record<string, string> }) {
    return createJSONResponse(jsonbody, { status, ...options });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for type inference
type ResponsesOfRequest<Request extends RestRequest> = Request extends RestRequest<any, any, any, infer Responses> ? Responses : never;

export type RestResponseType<Request extends RestRequest, C extends ResponsesOfRequest<Request>["status"] = ResponsesOfRequest<Request>["status"] & HTTPSuccessCode> = (ResponsesOfRequest<Request> & { status: C })["response"];

/** Returned upon a succesful authorization. May be extended to store authorization details */
export interface RestSuccessfulAuthorization<T = unknown> {
  //TODO expire/cache/validity info? the handler should explain us which headers it looked at (like 'Vary'?)
  authorized: true;
  /** This authorization will be set as the request's authorization */
  authorization: T;
}

/** Returned upon a failed autorization. May optionally contain a WebResponse to send to the user (if not set, a 401 Unauthorized error is returned) */
export interface RestFailedAuthorization {
  authorized: false;
  response?: WebResponse;
}

/** Return type for a RestAuthorizationFunction */
export type RestAuthorizationResult<T = unknown> = RestSuccessfulAuthorization<T> | RestFailedAuthorization;

/** Signature for a x-webhare-authorization function */
export type RestImplementationFunction = (request: RestRequest) => Promise<WebResponse>;
export type RestAuthorizationFunction = (request: RestRequest) => Promise<RestAuthorizationResult>;
