import { isDate, stdTypeOf, typedEntries, type Money } from "@webhare/std";

interface ColumnTypeDef {
  validDataTypes?: Array<ReturnType<typeof stdTypeOf>>;
}

type ValidColumnTypes = "string" | "number" | "date" | "boolean" | "money" | "time" | "dateTime";

export const ColumnTypes: Record<ValidColumnTypes, ColumnTypeDef> = {
  "string": {},
  "number": { validDataTypes: ["number"] },
  "dateTime": { validDataTypes: ["Date", "Instant", "null"] },
  "date": { validDataTypes: ["Date", "PlainDate", "null"] },
  "boolean": { validDataTypes: ["boolean"] },
  "money": { validDataTypes: ["Money"] },
  "time": { validDataTypes: ["number"] },
};

export type SpreadsheetColumn = {
  /** Column name (property name in rows) */
  name: string;
  /** Column title (display name in spreadsheet header) */
  title: string;
  /** Column alignment */
  align?: "left" | "center" | "right";
  /** Column width measured as the number of characters of the maximum digit width of the
      numbers 0, 1, 2, …, 9 as rendered in the normal style's font */
  width?: number;
} & ({
  type: Exclude<keyof typeof ColumnTypes, "dateTime" | "number">;
} | {
  type: "dateTime";
  storeUTC: boolean;
} | {
  type: "number";
  decimals?: number;
});

export type SpreadsheetRow = Record<string, number | string | Date | boolean | null | Money>;

// Map the string literal column `type` to the actual TS type
type ColumnTypeMap<T extends string> = T extends "string"
  ? string
  : T extends "number"
  ? number
  : T extends "boolean"
  ? boolean
  : T extends "date"
  ? Temporal.PlainDate | Date //FIXME phase out Date support
  : T extends "datetime"
  ? Temporal.Instant | Date //FIXME phase out Date support
  : unknown;

// Produces a row object type from a `columns` array declared `as const`.
export type TypedSpreadsheetRow<C extends SpreadsheetColumn[]> = {
  [Col in C[number]as Col["name"]]: ColumnTypeMap<Col["type"]> | null;
};


export type SpreadsheetData = ({
  rows: SpreadsheetRow[];
  columns: SpreadsheetColumn[];
} | {
  rows: Array<Record<string, unknown>>;
  columns?: SpreadsheetColumn[];
}) & {
  title?: string;
  timeZone?: string;
  /** Split (freeze) rows or columns. Set to eg '1' to freeze only the topmost row/column  */
  split?: {
    columns?: number;
    rows?: number;
  };
  withAutoFilter?: boolean;
};

export type FixedSpreadsheetOptions = {
  rows: Array<Record<string, unknown>>;
  columns: SpreadsheetColumn[];
  title?: string;
  timeZone?: string;
  split?: { columns?: number; rows?: number };
  withAutoFilter?: boolean;
};

export type WorkbookData = {
  sheets: SpreadsheetData[];
  title?: string;
  timeZone?: string;
};

export function isValidSheetName(sheetname: string): boolean {
  /*  https://support.microsoft.com/en-us/office/rename-a-worksheet-3f1f7148-ee83-404d-8ef0-9ff99fbad1f9
      Important:  Worksheet names cannot:
      - Be blank .
      - Contain more than 31 characters.
      - Contain any of the following characters: / \ ? * : [ ]
      - Begin or end with an apostrophe ('), but they can be used in between text or numbers in a name.
      - Be named "History". This is a reserved word Excel uses internally.

    WE'll also reject
    - anything starting or ending with a space
    - anything outside the printable range
*/
  // eslint-disable-next-line no-control-regex
  return /^[^:/\\?\\*\\[\]\x00-\x1F]{1,31}$/.test(sheetname) && sheetname.toLowerCase() !== "history" && !/^[' ]|[ ']$/.test(sheetname);
}

/** Check columns and row consistency. */
export function validateAndFixRowsColumns(options: SpreadsheetData, index: number): FixedSpreadsheetOptions & { title: string } {
  options = { ...options }; //don't modify original object, we'll return a new one with the fixes

  if (options.title && options.title?.length >= 31)
    options.title = options.title.substring(0, 31).trim();

  if (!options?.title || !isValidSheetName(options.title)) { //fix it!
    options.title = `Sheet${index + 1}`;
  }

  if (!("columns" in options)) {
    //Infer them!
    type SpeculatedSpreadsheetColumn = { name: string; title: string; type?: ValidColumnTypes; storeUTC?: boolean };
    const speculatedCols: SpeculatedSpreadsheetColumn[] = [];
    for (const row of options.rows)
      for (const [key, value] of Object.entries(row)) { //TODO infer Date and number ?
        let matchCol = speculatedCols.find((col) => col.name === key);
        if (!matchCol) {
          matchCol = { name: key, title: key };
          speculatedCols.push(matchCol);
        }

        const valueType = stdTypeOf(value);
        const matchType = typedEntries(ColumnTypes).find(([type, def]) => def.validDataTypes?.includes(valueType));
        const requireTz = matchType?.[0] === "date" || matchType?.[0] === "dateTime";

        if (matchType && (options.timeZone || !requireTz) && (matchCol.type === undefined || matchCol.type === matchType?.[0])) { //we recognized this type and it's the first clue or matches the guessed type
          if (!matchCol.type)
            matchCol.type = matchType?.[0];
          if (requireTz)
            matchCol.storeUTC = true;
        } else if (value && matchCol.type !== 'string') {
          matchCol.type = "string"; //reset to 'string' if types are inconsistent
        }
        console.log(key, matchCol.type);
      }
    console.log(speculatedCols);
    options.columns = speculatedCols.map((col) => ({ name: col.name, title: col.title, type: col.type ?? "string", storeUTC: col.storeUTC ?? false }));
    console.log(options.columns);
  }

  for (const column of options.columns || []) {
    if (column.type === "dateTime") {
      if (typeof column.storeUTC !== "boolean")
        throw new Error(`Column ${column.name} is of type dateTime but storeUTC is not a boolean`);
      if (column.storeUTC && !options.timeZone)
        throw new Error(`Column ${column.name} is of type dateTime and storeUTC is true but no timeZone is set`);
    } else if (!(column.type in ColumnTypes)) {
      throw new Error(`Column ${column.name} has an invalid type: ${column.type}`);
    }
  }

  return options as FixedSpreadsheetOptions & { title: string }; //cast should be safe, we verified columns exists
}

export function byteStreamFromStringParts(parts: Iterable<string | Iterator<string> | (() => string | Iterator<string>)>, options?: { minChunkSize?: number }): ReadableStream<Uint8Array<ArrayBuffer>> {
  const minChunkSize = options?.minChunkSize ?? 32768;
  const iter = parts[Symbol.iterator]();
  let cur: Iterator<string> | undefined;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      let toEnqueueLen = 0;
      const toEnqueue: string[] = [];
      let finished = false;
      for (; ;) {
        if (!cur) {
          const v = iter.next();
          if (v.done) {
            finished = true;
            break;
          }
          if (typeof v.value === "function")
            v.value = v.value();
          if (typeof v.value === "string") {
            toEnqueue.push(v.value);
            toEnqueueLen += v.value.length;
            if (toEnqueueLen >= minChunkSize)
              break;
            continue;
          } else
            cur = v.value;
        }

        const v = cur.next();
        if (v.done) {
          cur = undefined;
          break;
        }
        toEnqueue.push(v.value);
        toEnqueueLen += v.value.length;
        if (toEnqueueLen >= minChunkSize)
          break;
      }
      if (toEnqueue.length > 0)
        controller.enqueue(new TextEncoder().encode(toEnqueue.join("")));
      if (finished)
        controller.close();
    },
  }, {
    highWaterMark: 4
  });
}

//get name for column, 1-based
export function getNameForCell(col: number, row: number, options?: { fixedRow?: boolean; fixedColumn?: boolean }): string {
  if (col < 1 || row < 1)
    throw new Error(`Invalid column or row number: col=${col}, row=${row}`);
  let name = "";
  col -= 1;
  while (true) {
    name = String.fromCharCode(65 + col % 26) + name;
    if (col < 26)
      break;
    col = (col - 26) / 26;
  }
  return (options?.fixedColumn ? "$" : "") + name + (options?.fixedRow ? "$" : "") + row;
}

export type OmitUndefined<T extends object> = T extends object ? {
  [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
} : never;

export function omitUndefined<T extends object>(obj: T): OmitUndefined<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, value]) => value !== undefined)) as OmitUndefined<T>;
}

export function shouldShowCell(value: unknown): boolean {
  if (value === null || value === undefined)
    return false;
  if (typeof value === "number")
    return isFinite(value);
  if (isDate(value)) {
    const time = value.getTime();
    return time > -719163 * 86400000 && time < 100000000 * 86400000 - 1;
  }
  return true;
}
