export type RawDragItem = {
  kind: "File";
  type: string;
  data: File;
};

export class SimulatedFileSystemFileEntry implements FileSystemFileEntry {
  private _item;
  get filesystem(): FileSystem { throw new Error("Not implemented in SimulatedFileSystemFileEntry"); }
  get fullPath() {
    return "/files/" + this._item.data.name;
  }
  get isFile() {
    return true;
  }
  get isDirectory() {
    return false;
  }
  get name() {
    return this._item.data.name;
  }
  file(successCallback: (file: File) => void) {
    setTimeout(() => successCallback(this._item.data), 0);
  }
  getParent(successCallback?: (folder: FileSystemDirectoryEntry) => void) {
    throw new Error("Not implemented in SimulatedFileSystemFileEntry");
  }
  constructor(item: RawDragItem) {
    this._item = item;
  }
}
