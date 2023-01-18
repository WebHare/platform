export class WebResponse {
  private body: string;

  constructor() {
    this.body = '';
  }

  /** Render the contents of the specified witty component (path#component) with te specified data
      Using path:component is a syntax error and will throw if detected
      Resolves when completed. If you're not waiting, don't modify dataobject and any contained objects until the Witty has completed running! */
  //  async addWitty(wittycomponent: string, dataobject?: unknown);

  /** Finish any async additions */
  //  async flush()

  /** Append the specified text */
  async addText(text: string) {
    this.body += text;
  }

  /** Retrieve the final page */
  async getFinalPage() {
    return {
      body: `<html><body>` + this.body + `</body</html>`,
      headers: { "content-type": "text/html; charset=utf-8" }
    };
  }
}
