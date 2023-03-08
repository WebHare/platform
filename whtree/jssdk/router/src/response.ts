type Headers = { [key: string]: string };

export enum HTTPErrorCode {
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

export enum HTTPSuccessCode {
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

export type HTTPStatusCode = HTTPErrorCode | HTTPSuccessCode;

export class WebResponse {
  private _status: HTTPStatusCode = HTTPSuccessCode.Ok;
  private _body = '';
  private _headers: Headers;

  constructor() {
    this._headers = { "content-type": "text/html; charset=utf-8" }; //TODO caller should set this based on expected extension eg to text/plain
  }

  get status() {
    return this._status;
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

  setStatus(status: HTTPStatusCode) {
    this._status = status;
  }
}

/** Create a webresponse
 *
 * If a body is set but no content-type header is explicitly added, the content-type will be set to text/html; charset=utf-8
 *
 * @param body - The body to return.
 * @param options - Optional statuscode and headers
 */
export function createWebResponse(body: string, options?: { status?: HTTPStatusCode; headers?: Record<string, string> }): WebResponse {
  const resp = new WebResponse;
  resp.setStatus(options?.status || HTTPSuccessCode.Ok);
  if (body)
    resp.setHeader("content-type", "text/html; charset=utf-8");

  if (options?.headers)
    for (const [key, value] of Object.entries(options.headers))
      resp.setHeader(key, value);

  resp.setBody(body);
  return resp;
}

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode and headers
 */
export function createJSONResponse(jsonbody: unknown, options?: { status?: HTTPStatusCode; headers?: Record<string, string> }): WebResponse {
  const headers = { "content-type": "application/json", ...options?.headers };
  return createWebResponse(JSON.stringify(jsonbody), { status: options?.status, headers });
}
