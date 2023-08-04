import { WHDBBlob } from "@webhare/whdb";

export abstract class RichBlob {
  protected readonly blob: WHDBBlob | null;

  constructor(blob: WHDBBlob | null) {
    this.blob = blob;
  }

  get size() {
    return this.blob?.size ?? 0;
  }

  async text(): Promise<string> {
    return this.blob?.text() ?? "";
  }
}
