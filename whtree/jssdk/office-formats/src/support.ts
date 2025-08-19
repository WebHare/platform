import type { Money, stdTypeOf } from "@webhare/std";
import { ReadableStream } from "node:stream/web";

interface ColumnTypeDef {
  validDataTypes?: Array<ReturnType<typeof stdTypeOf>>;
}

type ValidColumnTypes = "string" | "number" | "date" | "boolean" | "money" | "time" | "dateTime";

export const ColumnTypes: Record<ValidColumnTypes, ColumnTypeDef> = {
  "string": {},
  "number": { validDataTypes: ["number"] },
  "date": { validDataTypes: ["Date", "null"] },
  "boolean": { validDataTypes: ["boolean"] },
  "money": { validDataTypes: ["Money"] },
  "time": { validDataTypes: ["number"] },
  "dateTime": { validDataTypes: ["Date", "null"] },
};

export type SpreadsheetColumn = {
  name: string;
  title: string;
  type: Exclude<keyof typeof ColumnTypes, "dateTime" | "number">;
  align?: "left" | "center" | "right";
} | {
  name: string;
  title: string;
  type: "dateTime";
  storeUTC: boolean;
  align?: "left" | "center" | "right";
} | {
  name: string;
  title: string;
  type: "number";
  decimals?: number;
  align?: "left" | "center" | "right";
};

export type SpreadsheetRow = Record<string, number | string | Date | boolean | null | Money>;

export type GenerateSpreadsheetOptions = ({
  rows: SpreadsheetRow[];
  columns: SpreadsheetColumn[];
} | {
  rows: Array<Record<string, unknown>>;
}) & {
  title?: string;
  timeZone?: string;
  split?: { columns?: number; rows?: number };
};

export type FixedSpreadsheetOptions = {
  rows: Array<Record<string, unknown>>;
  columns: SpreadsheetColumn[];
  title?: string;
  timeZone?: string;
  split?: { columns?: number; rows?: number };
};

export type GenerateWorkbookProperties = {
  sheets: GenerateSpreadsheetOptions[];
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
export function validateAndFixRowsColumns(options: GenerateSpreadsheetOptions): FixedSpreadsheetOptions {
  if (!("columns" in options)) {
    //Infer them!
    const cols: SpreadsheetColumn[] = [];
    for (const row of options.rows)
      for (const [key] of Object.entries(row)) { //TODO infer Date and number ?
        let matchCol: SpreadsheetColumn | undefined = cols.find((col) => col.name === key);
        if (!matchCol) {
          matchCol = { name: key, title: key, type: "string" };
          cols.push(matchCol);
        }
      }

    return { ...options, columns: cols };
  }

  if (options.columns.length === 0) { //*if* you define a col[] array, we expect it to be there
    throw new Error("No columns defined");
  }

  for (const column of options.columns) {
    if (column.type === "dateTime") {
      if (typeof column.storeUTC !== "boolean")
        throw new Error(`Column ${column.name} is of type dateTime but storeUTC is not a boolean`);
      if (column.storeUTC && !options.timeZone)
        throw new Error(`Column ${column.name} is of type dateTime and storeUTC is true but no timeZone is set`);
    } else if (!(column.type in ColumnTypes)) {
      throw new Error(`Column ${column.name} has an invalid type: ${column.type}`);
    }
  }

  return options as FixedSpreadsheetOptions; //cast should be safe, we verified columns exists
}

export function byteStreamFromStringParts(parts: Iterable<string | Iterator<string> | (() => string | Iterator<string>)>, options?: { minChunkSize?: number }): ReadableStream<Uint8Array> {
  const minChunkSize = options?.minChunkSize ?? 32768;
  const iter = parts[Symbol.iterator]();
  let cur: Iterator<string> | undefined;
  return new ReadableStream<Uint8Array>({
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
export type OmitUndefined<T extends object> = T extends object ? {
  [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
} : never;

export function omitUndefined<T extends object>(obj: T): OmitUndefined<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, value]) => value !== undefined)) as OmitUndefined<T>;
}
