// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/system-tools" {
}

export { readDirRecursive, storeDiskFile, deleteRecursive } from "./fs";
