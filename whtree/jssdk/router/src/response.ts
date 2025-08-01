import { debugFlags, type NavigateInstruction } from "@webhare/env";
import { getCallStackAsText } from "@mod-system/js/internal/util/stacktrace";
import type { WebResponseInfo } from "@mod-system/js/internal/types";
import { WebHareBlob } from "@webhare/services";
import type { TransferListItem } from "worker_threads";
import { encodeString, stringify } from "@webhare/std";
import type { RPCResponse } from "@webhare/rpc/src/rpc-client";

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

export type HTTPRedirectCode = HTTPSuccessCode.MovedPermanently | HTTPSuccessCode.Found | HTTPSuccessCode.SeeOther | HTTPSuccessCode.TemporaryRedirect | HTTPSuccessCode.PermanentRedirect;

export type HTTPStatusCode = HTTPErrorCode | HTTPSuccessCode;

export type WebResponseForTransfer = {
  status: HTTPStatusCode;
  bodybuffer: ArrayBuffer | null;
  headers: Array<[string, string]>;
  trace: string | undefined;
};

//TODO ideally we'll support the full Response interface so that some calls can rely on a public interface https://developer.mozilla.org/en-US/docs/Web/API/Response instead of WebResponse
export type SupportedResponseSubset = Pick<Response, "ok" | "status" | "headers" | "json" | "text" | "arrayBuffer">;

export type RPCErrorCodes = HTTPErrorCode.BadRequest | HTTPErrorCode.NotFound | HTTPErrorCode.InternalServerError | HTTPErrorCode.Unauthorized | HTTPErrorCode.Forbidden;
export class RPCError extends Error {
  constructor(public readonly status: RPCErrorCodes, message: string) {
    super(message);
  }
}

/** Create a webresponse returning a typed RPC body. Not a public API, only needed for the RPC router (which cannot use WebResponse directly)
 * @param body - The body to return
 * @param status - Statuscode
   @param headers - Headers
 */
export function createRPCResponse(status: RPCErrorCodes | HTTPSuccessCode.Ok, body: RPCResponse, options?: { headers?: Record<string, string> | Headers }): WebResponse {
  const headers = new Headers(options?.headers);
  const sendbody = stringify(body, { typed: true });
  if (!headers.get("content-type"))
    headers.set("content-type", "application/json");

  return new WebResponse(sendbody, { headers, status });
}

//TODO consider just using Response object - or at least hiding the WebResponse type to external users and have them just use Response
class WebResponse extends Response {
  private _trace: string | undefined;

  constructor(body?: BodyInit, init?: ResponseInit & { trace?: string }) {
    super(body || null, init);
    if (init && "trace" in init)
      this._trace = init.trace;
    else if (debugFlags.openapi) { //TODO this seems a bit too low level to be considering a 'openapi' flag ?
      this._trace = getCallStackAsText(1);
    }
  }

  get trace() {
    return this._trace;
  }

  /// Convert result to WebResponseInfo often used when marshalling. API will be removed when JS webserver has replaced the C++ webserver
  async asWebResponseInfo(): Promise<WebResponseInfo> {
    return {
      status: this.status,
      headers: [...this.headers.entries()],
      body: WebHareBlob.from(Buffer.from(await this.arrayBuffer()))
    };
  }

  async encodeForTransfer(): Promise<{
    value: WebResponseForTransfer;
    transferList: TransferListItem[];
  }> {
    const bodybuffer = this.body ? await this.arrayBuffer() : null;
    return {
      value: {
        status: this.status,
        headers: [...this.headers.entries()],
        bodybuffer,
        trace: this._trace
      },
      transferList: bodybuffer ? [bodybuffer] : []
    };
  }
}

export async function createResponseInfoFromResponse(response: SupportedResponseSubset): Promise<WebResponseInfo> {
  return {
    status: response.status,
    headers: [...response.headers.entries()],
    body: WebHareBlob.from(Buffer.from(await response.arrayBuffer()))
  };
}

export function createWebResponseFromTransferData(data: WebResponseForTransfer): WebResponse {
  return new WebResponse(data.bodybuffer ?? undefined, {
    status: data.status,
    headers: data.headers,
    trace: data.trace
  });
}

/** Create a webresponse
 *
 * If a body is set but no content-type header is explicitly added, the content-type will be set to text/html; charset=utf-8
 *
 * @param body - The body to return.
 * @param options - Optional statuscode and headers
 */
export function createWebResponse(body: string | ArrayBuffer | Blob | ReadableStream<Uint8Array> | undefined, options?: { status?: HTTPStatusCode; headers?: Record<string, string> | Array<[string, string]> | Headers }): WebResponse {
  const headers = new Headers(options?.headers);
  if (!headers.get("content-type") && body !== undefined)
    headers.set("content-type", body instanceof ArrayBuffer ? "application/octet-stream" : "text/html;charset=utf-8");

  const copy = body; // need to do the instanceof test on a separate variable, otherwise TS will narrow 'body' to never
  if (typeof body === "object" && "stream" in body && !(copy instanceof Blob)) {
    // A WebHareBlob can't be used as a body directly (because it isn't a real Blob), but its stream can.
    body = body.stream();
  }

  return new WebResponse(body, { status: options?.status ?? HTTPSuccessCode.Ok, headers });
}

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode and headers
 */
export function createJSONResponse(status: HTTPStatusCode, jsonbody: unknown, options?: { headers?: Record<string, string> | Headers; indent?: boolean }): WebResponse {
  const headers = new Headers(options?.headers);

  //TODO can we have TS already fail force a null type for 204?
  let sendbody: undefined | string;
  if (status === HTTPSuccessCode.NoContent) {
    if (jsonbody)
      throw new Error("HTTP 204 No Content should not have a body");
    sendbody = undefined;
  } else {
    sendbody = JSON.stringify(jsonbody, null, options?.indent ? 2 : undefined);
    if (!headers.get("content-type"))
      headers.set("content-type", "application/json");
  }

  const resp = new WebResponse(sendbody, {
    headers: headers,
    status: status
  });
  return resp;
}

/** Create a redirect response
 * @param location - Target URL/instruction
 * @param status - Status code to use (default is 303 See Other)
 * @param options - Optionals for body and headers
 */
export function createRedirectResponse(location: string | NavigateInstruction, status: HTTPRedirectCode = HTTPSuccessCode.SeeOther, options?: { body?: string; headers?: Record<string, string> | Headers }): WebResponse {
  if (typeof location === "string") {
    const body = options?.body ?? `<html><head><title>Redirecting</title></head><body><a href="${encodeString(location, "attribute")}">Click here to continue</a></body></html>`;
    const resp = new WebResponse(body, {
      headers: options?.headers,
      status: status
    });
    if (!resp.headers.get("location"))
      resp.headers.set("location", location);
    if (!resp.headers.get("content-type"))
      resp.headers.set("content-type", "text/html");
    return resp;
  } else {
    //TODO implement and test the rest of HareScript ExecuteSubmitInstruction and properly allow some createRedirectResponse options to override where it makes sense?
    if (location.type === "redirect")
      return createRedirectResponse(location.url, status, options);
    else
      throw new Error("Unsupported NavigateInstruction type");
  }
}

export type { WebResponse };
