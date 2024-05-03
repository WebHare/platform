import type { WebRequestInfo } from "@mod-system/js/internal/types";
import type { DebugFlags } from "@webhare/env/src/envbackend";
import { getDebugSettings } from "./debug";
import { TransferListItem } from "worker_threads";

export enum HTTPMethod {
  GET = "GET",
  PUT = "PUT",
  POST = "POST",
  DELETE = "DELETE",
  OPTIONS = "OPTIONS",
  HEAD = "HEAD",
  PATCH = "PATCH",
  TRACE = "TRACE"
}

const validmethods = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"];

export type WebRequestTransferData = {
  method: HTTPMethod;
  url: string;
  headers: Array<[string, string]>;
  clientWebServer: number;
  body: ArrayBuffer | null;
  baseURL: string;
  localPath: string;
};

//TODO ideally we'll support the full Request interface so that some calls can rely on a public interface https://developer.mozilla.org/en-US/docs/Web/API/Request instead of WebRequest
export type SupportedRequestSubset = Omit<Request, "cache" | "credentials" | "destination" | "integrity" | "keepalive" | "mode" | "redirect" | "referrer" | "referrerPolicy" | "signal" | "clone" | "body" | "bodyUsed" | "arrayBuffer" | "blob" | "formData">;

export interface WebRequest extends SupportedRequestSubset {
  ///HTTP Method, eg "get", "post"
  readonly method: HTTPMethod;
  ///Full original request URL
  readonly url: string;
  ///Request headers
  readonly headers: Headers;
  ///Client webserver ID
  readonly clientWebServer: number;

  ///Request body as text
  text(): Promise<string>;
  ///Request body as JSON
  json(): Promise<unknown>;

  //Base URL for this route. Usually https://example.net/ but when forwarding to a deeper router this will get updated
  readonly baseURL: string;
  //Local path inside this route (URL decoded, lowercase, no variables, does not start with a slash)
  readonly localPath: string;


  /** This returns all the cookies originally sent by the client. They are not decrypted.
      @param req - The request to get the cookies from
      @returns - The cookies
  */
  getAllCookies(): Record<string, string>;

  /** This returns a single cookie originally sent by the client. It is not decrypted.
      @param req - The request to get the cookie from
      @param name - The name of the cookie
      @returns - The cookie value or null if not found
  */
  getCookie(name: string): string | null;

  /** The return value only contains the trusted flags set in this request (from both cookies and URL - either signed or part of the subset of flags that do not need a signature)
      You should normally use debugFlags from \@webhare/env - request specific flags will be merged into this set for the current code context.
  */
  getDebugSettings(): { flags: DebugFlags };

  /** Reconstruct the client's URL based on a pathname and unforgable headers (Origin or Referer) and on requesturl otherwise (if it's not a browser invoking us)
    @param pathname - Local path as specified by app. Browsers should pass `location.pathname`. The URL may or may not start with a slash but may not be a full url.
    @returns The pathname rebased to the actual origin URL or null if we couldn't safely determine it */
  getOriginURL(pathname: string): string | null;

  encodeForTransfer(): { value: WebRequestTransferData; transferList: TransferListItem[] };
}

export class IncomingWebRequest implements WebRequest {
  readonly method: HTTPMethod;
  readonly headers: Headers;
  readonly url: string;
  readonly clientWebServer: number;
  private readonly __body: ArrayBuffer | null;

  constructor(url: string, options?: { method?: HTTPMethod; headers?: Headers | Record<string, string>; body?: ArrayBuffer | null; clientWebServer?: number }) {
    this.url = url;
    if (options && "method" in options) {
      if (!validmethods.includes(options.method as string)) {
        //Migration code
        if (validmethods.includes(options.method!.toUpperCase())) {
          console.error(`Invalid method '${options.method}' - convert to uppercase!`);
          console.trace();
        } else {
          throw new Error(`Invalid method '${options.method}', must be one of: ${validmethods.join(", ")}`);
        }
      }

      this.method = (options.method!).toLowerCase() as HTTPMethod;
    } else {
      this.method = HTTPMethod.GET;
    }

    this.clientWebServer = options?.clientWebServer || 0;
    this.method = options?.method || HTTPMethod.GET;
    this.headers = options?.headers ? (options.headers instanceof Headers ? options.headers : new Headers(options.headers)) : new Headers;
    this.__body = options?.body || null;
  }

  async text() {
    return this.__body ? new TextDecoder().decode(this.__body) : "";
  }
  async json() {
    return JSON.parse(this.__body ? new TextDecoder().decode(this.__body) : "");
  }

  get baseURL() {
    return new URL("/", this.url).toString();
  }

  get localPath() {
    return decodeURIComponent(new URL(this.url).pathname).toLowerCase().substring(1);
  }

  getAllCookies(): Record<string, string> {
    const retval: Record<string, string> = {};
    const cookieHeader = this.headers.get("cookie");
    if (!cookieHeader)
      return retval;

    const cookies = cookieHeader.split(';');
    for (let cookietok of cookies) {
      cookietok = cookietok.trim();
      const eqIdx = cookietok.indexOf('=');
      if (eqIdx < 0)
        continue;
      const cookiename = cookietok.substring(0, eqIdx);
      const cookievalue = cookietok.substring(eqIdx + 1);
      retval[cookiename] = decodeURIComponent(cookievalue);
    }
    return retval;
  }

  getCookie(name: string): string | null {
    const allCookies = this.getAllCookies();
    return allCookies[name] ?? null;
  }

  getDebugSettings(): { flags: DebugFlags } {
    return getDebugSettings(this);
  }

  getOriginURL(pathname: string): string | null {
    if (pathname.match(/^[a-zA-Z-0-9]*:/) || pathname.startsWith("//"))
      return null; //looks like a full url, not good

    let origin = this.headers.get("origin");
    if (!origin) {
      const referrer = this.headers.get("referer");
      if (referrer)
        origin = new URL(referrer).origin;
    }
    if (!origin) //still not found
      origin = new URL(this.url).origin;

    return origin + (pathname.startsWith('/') ? '' : '/') + pathname;
  }

  encodeForTransfer(): { value: WebRequestTransferData; transferList: TransferListItem[] } {
    return {
      value: {
        method: this.method,
        url: this.url.toString(),
        headers: Array.from(this.headers.entries()),
        clientWebServer: this.clientWebServer,
        body: this.__body,
        baseURL: this.baseURL,
        localPath: this.localPath
      },
      transferList: this.__body ? [this.__body] : []
    };
  }
}

class ForwardedWebRequest implements WebRequest {
  readonly baseURL: string;
  readonly localPath: string;
  private readonly original: WebRequest;

  constructor(original: WebRequest, newbaseurl: string) {
    this.baseURL = newbaseurl;
    this.localPath = decodeURIComponent(original.url.toString().substring(newbaseurl.length)).toLowerCase().replace(/\?.*$/, "");
    this.original = original;
  }

  get method() { return this.original.method; }
  get url() { return this.original.url; }
  get headers() { return this.original.headers; }
  get clientWebServer() { return this.original.clientWebServer; } //FIXME is this corrrect or should it be updated for the new URL ?
  async text() { return this.original.text(); }
  async json() { return this.original.json(); }

  getAllCookies(): Record<string, string> { return this.original.getAllCookies(); }
  getCookie(name: string): string | null { return this.original.getCookie(name); }

  getDebugSettings(): { flags: DebugFlags } { return this.original.getDebugSettings(); }
  getOriginURL(pathname: string) { return this.original.getOriginURL(pathname); }

  encodeForTransfer() { return this.original.encodeForTransfer(); }
}

export async function newWebRequestFromInfo(req: WebRequestInfo): Promise<WebRequest> {
  //'req' is from Harescript and thus uses HareScript Blobs, but that should not leak into the JS Router objects
  const body = req.body ? await req.body.arrayBuffer() : null;
  return new IncomingWebRequest(req.url, { method: req.method, headers: req.headers, body });
}

export function newForwardedWebRequest(req: WebRequest, suburl: string): WebRequest {
  const newbaseurl = req.baseURL + suburl;
  if (!req.url.toString().startsWith(newbaseurl))
    throw new Error(`The suburl added must be a part of the original base url`);
  if (newbaseurl.includes("?"))
    throw new Error(`The suburl added may not add search/query parameters to the URL`);

  return new ForwardedWebRequest(req, newbaseurl);
}

export function createWebRequestFromTransferData(encoded: WebRequestTransferData): WebRequest {
  return new TransferredWebRequest(encoded);
}

class TransferredWebRequest extends IncomingWebRequest {
  readonly __baseURL: string;
  readonly __localPath: string;

  get baseURL() {
    return this.__baseURL;
  }

  get localPath() {
    return this.__localPath;
  }

  constructor(encoded: WebRequestTransferData) {
    super(encoded.url, {
      method: encoded.method,
      headers: new Headers(encoded.headers),
      body: encoded.body,
      clientWebServer: encoded.clientWebServer
    });
    this.__baseURL = encoded.baseURL;
    this.__localPath = encoded.localPath;
  }
}
