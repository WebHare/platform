// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/whfs" {
}

export { openType, visitResources, whfsType } from "./contenttypes";
export { listInstances } from "./listinstances";
export type {
  VisitedResourceContext,
  VisitCallback,
  WHFSTypeName,
  InstanceData,
  InstanceSource,
  ExportedInstance,
  TypedInstanceData,
  ExportedTypedInstance,
  TypedInstanceSource,
  WHFSTypeMember,
} from "./contenttypes";
export { describeWHFSType } from "./describe";
export { openTagManager } from "./tagmanager";
export type { TagManager, Tag } from "./tagmanager";
export { isValidName } from "./support";

export type { CreateFileMetadata, CreateFolderMetadata, UpdateFileMetadata, UpdateFolderMetadata, WHFSFile, WHFSFolder, WHFSObject } from "./objects";
export { openFile, openFolder, openFileOrFolder, nextWHFSObjectId } from "./objects";
export { openSite, listSites, type Site } from "./sites";
export { lookupURL, type LookupURLOptions, type LookupURLResult } from "./lookupurl";

export { createWHFSExportZip, storeWHFSExport, type ExportWHFSOptions } from "./export";
export { importIntoWHFS, type ImportWHFSOptions, type ImportWHFSResult, type ImportWHFSProgress } from "./import";
