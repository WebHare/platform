import { HareScriptBlob } from "@webhare/harescript/src/hsblob";


class RichDocument {
  private rawHtml: HareScriptBlob;
  constructor(rawHtml: HareScriptBlob) {
    this.rawHtml = rawHtml;
  }

  // Not sure if this API will stay
  async __getRawHTML() {
    return await this.rawHtml.text();
  }
}

// Export RichDocument as type only, so user code can't touch its constructor yet
export type { RichDocument };
export { RichDocument as __RichDocumentInternal };
