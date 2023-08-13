/** Interface to make a blob useful for HareScript use */
export interface HareScriptBlob {
  ///Blob size in bytes
  readonly size: number;
  ///Compare whether two blobs objects refer to the same blob
  isSameBlob(rhs: HareScriptBlob): boolean;
  ///Get the blob contents as a utf8 encoded string
  text(): Promise<string>;
  ///Get the blob contents as a U8 buffer
  arrayBuffer(): Promise<ArrayBuffer>;
  ///Annouce that this blob has been uploaded to the PG database. Used to prevent reuploading the same blob.
  registerPGUpload?(databaseid: string): void;
}

/** Return whether the specified object is a valid HaresSript blob */
export function isHareScriptBlob(v: unknown): v is HareScriptBlob {
  return Boolean(typeof v === "object" && v && "size" in v && "isSameBlob" in v && "text" in v);
}

/** An in-memory blob
 * */
export class HareScriptMemoryBlob implements HareScriptBlob {
  readonly size: number;
  readonly data: Buffer | null;

  constructor(source?: Buffer) {
    this.size = source?.byteLength || 0;
    this.data = source ? Buffer.from(source) : null;
  }

  isSameBlob(rhs: HareScriptBlob): boolean {
    return this === rhs || (this.size === 0 && rhs.size == 0);
  }

  text(): Promise<string> {
    return this.data ? Promise.resolve(this.data.toString("utf8")) : Promise.resolve("");
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.data || new ArrayBuffer(0));
  }
}
