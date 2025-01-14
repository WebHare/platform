import type { Money, stdTypeOf } from "@webhare/std";

interface ColumnTypeDef {
  validDataTypes: Array<ReturnType<typeof stdTypeOf>>;
}

export const ColumnTypes = {
  "string": { validDataTypes: ["string"] },
  "number": { validDataTypes: ["number"] },
  "date": { validDataTypes: ["Date", "null"] },
  "boolean": { validDataTypes: ["boolean"] },
  "money": { validDataTypes: ["Money"] },
  "time": { validDataTypes: ["number"] },
  "dateTime": { validDataTypes: ["Date", "null"] },
} as const satisfies Record<string, ColumnTypeDef>;

export type SpreadsheetColumn = {
  name: string;
  title: string;
  type: Exclude<keyof typeof ColumnTypes, "dateTime">;
} | {
  name: string;
  title: string;
  type: "dateTime";
  storeUTC: boolean;
};

export type SpreadsheetRow = Record<string, number | string | Date | boolean | null | Money>;

export type GenerateSpreadsheetOptions = {
  rows: SpreadsheetRow[];
  columns: SpreadsheetColumn[];
  title?: string;
  timezone?: string;
};

export type GenerateWorkbookProperties = {
  sheets: GenerateSpreadsheetOptions[];
  timezone?: string;
};

export function validateRowsColumns(options: GenerateSpreadsheetOptions) {
  if (options.columns.length === 0) {
    throw new Error("No columns defined");
  }

  for (const column of options.columns) {
    if (column.type === "dateTime") {
      if (typeof column.storeUTC !== "boolean")
        throw new Error(`Column ${column.name} is of type dateTime but storeUTC is not a boolean`);
      if (column.storeUTC && !options.timezone)
        throw new Error(`Column ${column.name} is of type dateTime and storeUTC is true but no timezone is set`);
    } else if (!(column.type in ColumnTypes)) {
      throw new Error(`Column ${column.name} has an invalid type: ${column.type}`);
    }
  }
}
