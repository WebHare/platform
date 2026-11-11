import { ansiCmd } from "@webhare/cli";
import { inspect } from "node:util";
import { isMoney, isTemporalInstant, isTemporalPlainDate, isTemporalPlainDateTime, isTemporalPlainTime, isTemporalZonedDateTime } from "@webhare/std";
import type { ValidationMessage, ValidationResult } from "../devsupport/validation";

function formatMsgNoType(msg: ValidationMessage): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.message}`;
}
export function logValidationResultToConsole(res: ValidationResult) {
  const prologues = {
    error: ansiCmd("red") + "ERR:  " + ansiCmd("reset"),
    warning: ansiCmd("yellow") + "WARN: " + ansiCmd("reset"),
    hint: "HINT: "
  };

  for (const msg of res.messages)
    console.log(`${prologues[msg.type]}${formatMsgNoType(msg)}`);
}

function formatTableCell(value: unknown): string {
  if (value === null || value === undefined)
    return "";
  if (typeof value === "string")
    return value;
  if (value instanceof Date)
    return value.toISOString();
  if (isTemporalInstant(value) || isTemporalPlainDate(value) || isTemporalPlainDateTime(value) || isTemporalPlainTime(value) || isTemporalZonedDateTime(value) || isMoney(value))
    return value.toString();
  if (typeof value === "object")
    return inspect(value, { breakLength: Infinity, colors: false });
  return String(value);
}

/** Format rows as a table with aligned columns, as a replacement for console.table. Columns containing only numbers are aligned to the right
 * @param rows - Rows to format
 * @param columns - Columns to show. Defaults to all properties of the rows, in order of appearance
 * @returns The table, without a trailing newline (for console.log)
 */
export function formatTable(rows: ReadonlyArray<object>, columns?: readonly string[]): string {
  const records = rows as ReadonlyArray<Record<string, unknown>>;
  columns ??= [...new Set(records.flatMap(row => Object.keys(row)))];
  if (!records.length || !columns.length)
    return "";

  const cells = records.map(row => columns.map(col => formatTableCell(row[col])));
  const widths = columns.map((col, idx) => Math.max(col.length, ...cells.map(row => row[idx].length)));
  const rightAlign = columns.map(col => records.every(row => row[col] === null || row[col] === undefined || typeof row[col] === "number" || typeof row[col] === "bigint"));
  const formatRow = (texts: string[]) => texts.map((text, idx) => rightAlign[idx] ? text.padStart(widths[idx]) : text.padEnd(widths[idx])).join("  ").trimEnd();
  return [formatRow([...columns]), ...cells.map(formatRow)].join("\n");
}
