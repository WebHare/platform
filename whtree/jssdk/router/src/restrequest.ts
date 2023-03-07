import { WebRequest } from "./request";
import { WebResponse } from "./response";

export type RestParams = Record<string, string | number>;

export class RestRequest {
  ///The original WebRequest we received
  readonly webrequest: WebRequest;
  ///The relative request path, starting with '/'
  readonly path: string;
  ///Rest parameters received
  readonly params: RestParams;
  ///The parsed body of the request (if this operation accepts an application/json body)
  readonly body: unknown;

  ///Authorization result
  authorization: unknown;

  constructor(webrequest: WebRequest, path: string, params: RestParams, body: unknown) {
    this.webrequest = webrequest;
    this.path = path;
    this.params = params;
    this.body = body;
  }
}

/** Returned upon a succesful authorization. May be extended to store authorization details */
export interface RestSuccessfulAuthorization<T = unknown> {
  //TODO expire/cache/validity info? the handler should explain us which headers it looked at (like 'Vary'?)
  authorized: true;
  /** This authorization will be set as the request's authorization */
  authorization?: T;
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
