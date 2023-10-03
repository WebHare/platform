import { HareScriptBlob } from "@webhare/harescript/src/hsblob";
import { WHDBBlob } from "@webhare/whdb";

class RichDocument {
  private rawHtml;

  constructor(rawHtml: string | HareScriptBlob | WHDBBlob) {
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
