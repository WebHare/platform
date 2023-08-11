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
