// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/whdb" {
}

export { isSameUploadedBlob } from "./blobs";

// Export kysely helper stuff for use in external modules
export {
  sql
} from "kysely";
export type {
  ColumnType,
  Generated,
  GeneratedAlways
} from "kysely";

export { escapePGIdentifier } from "./metadata";
export { schemaExists, tableExists, columnExists } from "./meta";
export { beginWork, broadcastOnCommit, commitWork, db, isWorkOpen, nextVal, nextVals, onFinishWork, query, rollbackWork, runInSeparateWork, runInWork, uploadBlob, DBReadonlyError, overrideValueType, overrideQueryArgType } from "./impl";
export type { FinishHandler, Selectable, Updateable, WorkObject, WorkOptions } from "./impl";
