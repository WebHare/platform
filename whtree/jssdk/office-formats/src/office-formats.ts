import type { SpreadsheetData, WorkbookData } from "./support";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/office-formats" {
}

export { isValidSheetName, type SpreadsheetColumn, type SpreadsheetRow, type SpreadsheetData, type WorkbookData } from "./support";
export { generateXLSX } from "./xlsx-output";
export { generateODS } from "./ods-output";

/** @deprecated Use SpreadsheetData | WorkbookData, available since WebHare 5.9.2 */
export type GenerateXLSXOptions = SpreadsheetData | WorkbookData;
/** @deprecated Use SpreadsheetData | WorkbookData, available since WebHare 5.9.2 */
export type GenerateODSOptions = SpreadsheetData | WorkbookData;
