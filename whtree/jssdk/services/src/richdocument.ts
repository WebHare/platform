import { WebHareBlob } from "./webhareblob";

class RichDocument {
  private rawHtml;

  //TODO should we still accept a string constructor now that a WebHareBlob is so easy to build?
  constructor(rawHtml: string | WebHareBlob) {
    this.rawHtml = rawHtml;
  }

  // Not sure if this API will stay
  async __getRawHTML() {
    return typeof this.rawHtml === 'string' ? this.rawHtml : await this.rawHtml.text();
  }
}

// Export RichDocument as type only, so user code can't touch its constructor yet
export type { RichDocument };
export { RichDocument as __RichDocumentInternal };
