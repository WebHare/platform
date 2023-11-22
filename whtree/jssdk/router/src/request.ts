import { WebRequestInfo } from "@mod-system/js/internal/types";

export enum HTTPMethod {
  GET = "get",
  PUT = "put",
  POST = "post",
  DELETE = "delete",
  OPTIONS = "options",
  HEAD = "head",
  PATCH = "patch",
  TRACE = "trace"
}

const validmethods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export interface WebRequest {
  ///HTTP Method, eg "get", "post"
  readonly method: HTTPMethod;
  ///Full original request URL
  readonly url: URL;
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
}

export class IncomingWebRequest implements WebRequest {
  readonly method: HTTPMethod;
  readonly url: URL;
  readonly headers: Headers;
  readonly clientWebServer: number;
  private readonly __body: string;

  constructor(url: string, options?: { method?: HTTPMethod; headers?: Headers | Record<string, string>; body?: string; clientWebServer?: number }) {
    this.url = new URL(url);
    if (options && "method" in options) {
      if (!validmethods.includes(options.method as string))
        throw new Error(`Invalid method '${options.method}', must be one of: ${validmethods.join(", ")}`);

      this.method = options.method!;
    } else {
      this.method = HTTPMethod.GET;
    }

    this.clientWebServer = options?.clientWebServer || 0;
    this.method = options?.method || HTTPMethod.GET;
    this.headers = options?.headers ? (options.headers instanceof Headers ? options.headers : new Headers(options.headers)) : new Headers;
    this.__body = options?.body || "";
  }

  async text() {
    return this.__body;
  }
  async json() {
    return JSON.parse(this.__body);
  }

  get baseURL() {
    return this.url.origin + "/";
  }

  get localPath() {
    return decodeURIComponent(this.url.pathname).toLowerCase().substring(1);
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
}

export function newWebRequestFromInfo(req: WebRequestInfo): WebRequest {
  return new IncomingWebRequest(req.url, { method: req.method, headers: req.headers, body: req.body.toString() });
}

export function newForwardedWebRequest(req: WebRequest, suburl: string): WebRequest {
  const newbaseurl = req.baseURL + suburl;
  if (!req.url.toString().startsWith(newbaseurl))
    throw new Error(`The suburl added must be a part of the original base url`);
  if (newbaseurl.includes("?"))
    throw new Error(`The suburl added may not add search/query parameters to the URL`);

  return new ForwardedWebRequest(req, newbaseurl);
}
