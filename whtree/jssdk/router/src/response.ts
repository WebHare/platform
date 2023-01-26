type Headers = { [key: string]: string };

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
