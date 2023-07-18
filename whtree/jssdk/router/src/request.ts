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
  ///Request body as text
  text(): Promise<string>;
  ///Request body as JSON
  json(): Promise<string>;
}

export class IncomingWebRequest implements WebRequest {
  readonly method: HTTPMethod;
  readonly url: URL;
  readonly headers: Headers;
  private readonly __body: string;

  constructor(url: string, options?: { method?: HTTPMethod; headers?: Headers | Record<string, string>; body?: string }) {
    this.url = new URL(url);
    if (options && "method" in options) {
      if (!validmethods.includes(options.method as string))
        throw new Error(`Invalid method '${options.method}', must be one of: ${validmethods.join(", ")}`);

      this.method = options.method!;
    } else {
      this.method = HTTPMethod.GET;
    }

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
}

export function newWebRequestFromInfo(req: WebRequestInfo): WebRequest {
  return new IncomingWebRequest(req.url, { method: req.method, headers: req.headers, body: req.body.toString() });
}
