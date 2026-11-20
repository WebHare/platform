// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/system-tools" {
}

export { listDirectory, storeDiskFile, storeTempFile, deleteRecursive, type TempFile, type ListDirectoryEntry, type StoreDiskFileSource, type StoreTempFileOptions } from "./fs";
export { getScriptName } from "./node";
