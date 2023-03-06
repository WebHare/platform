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

export class WebRequest {
  readonly method: HTTPMethod;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;

  constructor(method: HTTPMethod, url: string, headers: Headers, body: string) {
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
  }
}
