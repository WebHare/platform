type Headers = { [key: string]: string };

export enum HttpErrorCode {
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  MethodNotAllowed = 405,
  NotAcceptable = 406,
  ProxyAuthenticationRequired = 407,
  RequestTimeout = 408,
  Conflict = 409,
  Gone = 410,
  LengthRequired = 411,
  PreconditionFailed = 412,
  PayloadTooLarge = 413,
  URITooLong = 414,
  UnsupportedMediaType = 415,
  RangeNotSatisfiable = 416,
  ExpectationFailed = 417,
  MisdirectedRequest = 421,
  UnprocessableEntity = 422,
  Locked = 423,
  FailedDependency = 424,
  TooEarly = 425,
  UpgradeRequired = 426,
  PreconditionRequired = 428,
  TooManyRequests = 429,
  RequestHeaderFieldsTooLarge = 431,
  InternalServerError = 500,
  NotImplemented = 501,
  BadGateway = 502,
  ServiceUnavailable = 503,
  GatewayTimeout = 504
}

export enum HttpSuccessCode {
  Ok = 200,
  Created = 201,
  Accepted = 202,
  NoContent = 204,
  PartialContent = 206,
  ResetContent = 205,
  MovedPermanently = 301,
  Found = 302,
  SeeOther = 303,
  NotModified = 304,
  TemporaryRedirect = 307,
  PermanentRedirect = 308
}

export type HttpStatusCode = HttpErrorCode | HttpSuccessCode;

export class WebResponse {
  private _body = '';
  private _headers: Headers;

  constructor() {
    this._headers = { "content-type": "text/html; charset=utf-8" }; //TODO caller should set this based on expected extension eg to text/plain
  }

  get body() {
    return this._body;
  }

  get headers() {
    return this._headers;
  }

  /** Set the body */
  setBody(text: string) {
    this._body = text;
  }

  setHeader(header: string, value: string) {
    //TODO WebResponse should track the context for which a response is generated. for static publication it shouldn't permit *any* header for now other than one specific fixed charset header
    if (value)
      this._headers[header] = value;
    else
      delete this._headers[header];
  }
}

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode
 */
export function createJSONResponse(jsonbody: unknown, options?: { statusCode?: HttpStatusCode }): WebResponse {
  const resp = new WebResponse;
  if (options?.statusCode)
    resp.setHeader("status", options.statusCode.toString());

  resp.setHeader("content-type", "application/json");
  resp.setBody(JSON.stringify(jsonbody));
  return resp;
}
