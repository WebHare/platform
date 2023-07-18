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

export class WebRequest {
  readonly method: HTTPMethod;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string;

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
    this.body = options?.body || "";
  }
}

export function WebRequestFromInfo(req: WebRequestInfo): WebRequest {
  return new WebRequest(req.url, { method: req.method, headers: req.headers, body: req.body.toString() });
}
