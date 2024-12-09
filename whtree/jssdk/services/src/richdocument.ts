import { WebHareBlob } from "./webhareblob";

class RichDocument {
  private rawHtml;

  //TODO should we still accept a string constructor now that a WebHareBlob is so easy to build?
  constructor(rawHtml: string | WebHareBlob) {
    this.rawHtml = rawHtml;
  }

  // Not sure if these APIs will stay
  async __getRawHTML() {
    return typeof this.rawHtml === 'string' ? this.rawHtml : await this.rawHtml.text();
  }
  __getHTMLBlob() {
    return typeof this.rawHtml === 'string' ? WebHareBlob.from(this.rawHtml) : this.rawHtml;
  }
}

// Export RichDocument as type only, so user code can't touch its constructor yet
export type { RichDocument };
export { RichDocument as __RichDocumentInternal };
