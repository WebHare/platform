export class WebRequest {
  readonly method: string;
  readonly url: string;

  constructor(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
}
