// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/office-formats" {
}

export { isValidSheetName, type SpreadsheetColumn, type SpreadsheetRow } from "./support";
export { generateXLSX } from "./xlsx-output";
