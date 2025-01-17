// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/system-tools" {
}

export { listDirectory, storeDiskFile, deleteRecursive, type ListDirectoryEntry } from "./fs";
