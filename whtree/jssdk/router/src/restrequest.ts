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

  constructor(webrequest: WebRequest, path: string, params: RestParams) {
    this.webrequest = webrequest;
    this.path = path;
    this.params = params;
  }
}

export type RestHandler = (request: RestRequest) => Promise<WebResponse>;
