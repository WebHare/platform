import { WebHareBlob } from "@mod-system/js/internal/whmanager/hsmarshalling";

export abstract class RichBlob {
  protected readonly blob: WebHareBlob | null;

  constructor(blob: WebHareBlob | null) {
    this.blob = blob;
  }

  get size() {
    return this.blob?.size ?? 0;
  }

  async text(): Promise<string> {
    return this.blob?.text() ?? "";
  }
}
