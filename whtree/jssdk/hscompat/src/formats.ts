import type { SpreadsheetColumn, SpreadsheetData, SpreadsheetRow } from "@webhare/office-formats";
import { throwError } from "@webhare/std";

/** HareScriptColumnFile describes the options supported by RunColumnFileExportDialog */
export type HareScriptColumnFile = {
  rows: unknown[];
  columns?: Array<{
    name: string;
    title: string;
    type: "text" | "boolean" | "money" | "datetime" | "date" | "time" | "float" | "integer" | "integer64" | "timestamp" | "string";
    storeutc?: boolean;
  }>;
  exporttitle?: string;
  filename?: string;
  timezone?: string;
  compressionlevel?: number;
};

/** Convert data that was intended for RunColumnFileExportDialog for use by \@webhare/office-formats.
 * @returns Data that can be passed to generateXLSX or generateODS. You may still need to set some extra properties (most commonly timeZone)
 */
export function getSpreadsheetDataFromHareScript(input: HareScriptColumnFile): SpreadsheetData {
  const out: SpreadsheetData = {
    rows: input.rows as SpreadsheetRow[],
    columns: [],
  };
  for (const inCol of input.columns || []) {
    const outCol: SpreadsheetColumn = {
      name: inCol.name,
      title: inCol.title,
      storeUTC: inCol.storeutc || true,
      type: inCol.type === "text" || inCol.type === "string" ? "string" :
        inCol.type === "datetime" ? "dateTime" :
          inCol.type === "float" || inCol.type === "integer" || inCol.type === "integer64" ? "number" :
            inCol.type === "timestamp" ? throwError("Timestamp type not supported by office-formats yet") :
              inCol.type
    };
    out.columns!.push(outCol);
  }

  return out;
}
