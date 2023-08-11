import { HareScriptBlob } from "@webhare/harescript";

export abstract class RichBlob {
  protected readonly blob: HareScriptBlob | null;

  constructor(blob: HareScriptBlob | null) {
    this.blob = blob;
  }

  get size() {
    return this.blob?.size ?? 0;
  }

  async text(): Promise<string> {
    return this.blob?.text() ?? "";
  }
}
