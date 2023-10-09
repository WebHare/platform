import * as env from "@webhare/env";
import { getCallStackAsText } from "@mod-system/js/internal/util/stacktrace";
import { WebResponseInfo } from "@mod-system/js/internal/types";
import { WebHareBlob } from "@webhare/services";

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
  private _status: HTTPStatusCode;
  private _bodybuffer: ArrayBuffer | null = null;
  private _headers: Headers;
  private _trace: string | undefined;

  constructor(status: HTTPStatusCode, headers: Record<string, string> | Headers) {
    this._status = status;
    this._headers = new Headers(headers);
    if (env.flags.openapi) { //TODO this seems a bit too low level to be considering a 'openapi' flag ?
      this._trace = getCallStackAsText(1);
    }
  }

  get status() {
    return this._status;
  }

  /* TODO if body() returns - it should be a ReadableStream!
  get body() {
    return this._bodystring;
  }*/

  /** Get the body as an arraybuffer */
  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this._bodybuffer)
      return this._bodybuffer;
    return new ArrayBuffer(0);
  }

  /** Get the body as a JavaScript string */
  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  /** Parse the body as JSON */
  async json(): Promise<unknown> {
    //FIXME validate content type?
    return JSON.parse(await this.text());
  }

  get trace() {
    return this._trace;
  }

  /** Set the body */
  setBody(text: string | ArrayBuffer) {
    if (text instanceof ArrayBuffer)
      this._bodybuffer = text;
    else
      this._bodybuffer = new TextEncoder().encode(text).buffer;
  }

  getHeader(header: string): string | null {
    return this._headers.get(header);
  }

  /** Get all headers */
  getHeaders(): string[][] {
    return [...this._headers.entries()];
  }

  /** Get all setCookie headers */
  getSetCookie(): string[] {
    //https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
    interface HeadersWithSetSookie extends Headers {
      getSetCookie(): string[];
    }
    return (this._headers as HeadersWithSetSookie).getSetCookie();
  }

  setHeader(header: string, value: string) {
    this._headers.set(header, value);
  }

  setStatus(status: HTTPStatusCode) {
    this._status = status;
  }

  /// Convert result to WebResponseInfo often used when marshalling. API will be removed when JS webserver has replaced the C++ webserver
  async asWebResponseInfo(): Promise<WebResponseInfo> {
    const headers = this.getHeaders();
    return { status: this.status, headers: Object.fromEntries(headers), body: WebHareBlob.from(Buffer.from(await this.arrayBuffer())) };
  }
}

/** Create a webresponse
 *
 * If a body is set but no content-type header is explicitly added, the content-type will be set to text/html; charset=utf-8
 *
 * @param body - The body to return.
 * @param options - Optional statuscode and headers
 */
export function createWebResponse(body: string, options?: { status?: HTTPStatusCode; headers?: Record<string, string> | Headers }): WebResponse {
  const resp = new WebResponse(options?.status || HTTPSuccessCode.Ok, options?.headers || {});
  if (body && !resp.getHeader("content-type"))
    resp.setHeader("content-type", "text/html; charset=utf-8");

  resp.setBody(body);
  return resp;
}

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode and headers
 */
export function createJSONResponse<T = unknown>(status: HTTPStatusCode, jsonbody: T, options?: { headers?: Record<string, string> | Headers; indent?: boolean }): WebResponse {
  const resp = new WebResponse(status, options?.headers || {});
  if (!resp.getHeader("content-type"))
    resp.setHeader("content-type", "application/json");

  resp.setBody(JSON.stringify(jsonbody, null, options?.indent ? 2 : undefined));
  return resp;
}
