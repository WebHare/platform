export class WebResponse {
  private body: string;
  private headers: { [key: string]: string };

  constructor() {
    this.headers = { "content-type": "text/html; charset=utf-8" }; //TODO caller should set this based on expected extension eg to text/plain
    this.body = '';
  }

  /** Set the body */
  setBody(text: string) {
    this.body = text;
  }

  setHeader(header: string, value: string) {
    //TODO WebResponse should track the context for which a response is generated. for static publication it shouldn't permit *any* header for now other than one specific fixed charset header
    if (value)
      this.headers[header] = value;
    else
      delete this.headers[header];
  }

  /** Retrieve the final page */
  getFinalPage() {
    return {
      body: this.body,
      headers: this.headers
    };
  }
}
