// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/tabular-files" {
}

//With only one file in src/ currently we mostly exist to clarify public and private exports

export { parseTabularData } from "./tabular-parser";
export type { TabularCellValue, TabularRow, TabularField, TabularFields, TabularImportError } from "./tabular-parser";
