// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/whfs" {
}

export { describeWHFSType, openType } from "./contenttypes";
export { openTagManager } from "./tagmanager";
export type { TagManager, Tag } from "./tagmanager";
export { isValidName } from "./support";

export type { CreateFSObjectMetadata, CreateFileMetadata, CreateFolderMetadata, UpdateFileMetadata, UpdateFolderMetadata, WHFSFile, WHFSFolder, WHFSObject } from "./objects";
export { openFile, openFolder, openFileOrFolder } from "./objects";
export { openSite, listSites, type Site } from "./sites";
