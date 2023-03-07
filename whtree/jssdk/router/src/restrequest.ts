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

  constructor(webrequest: WebRequest, path: string, params: RestParams, body: unknown) {
    this.webrequest = webrequest;
    this.path = path;
    this.params = params;
    this.body = body;
  }
}

export type RestHandler = (request: RestRequest) => Promise<WebResponse>;
