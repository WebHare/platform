/* Rendering of raw debugger values (job-getvariables responses), a port of
   mod::system/lib/internal/debugger/externvariable.whlib */

import { defaultDateTime, maxDateTime } from "@webhare/hscompat";
import type { RawDebugCell, RawDebugValue } from "./protocol";

/** Special type ids used by the debugger */
export const SpecialValueType = {
  /** Object member that isn't a variable (eg a method) */
  objectContext: -3,
  requesting: -2,
  invalidRequest: -1,
  /** Variable not (yet) present on the stack */
  optimizedAway: 0,
} as const;

const TypeIds = {
  integer: 0x10,
  money: 0x11,
  float: 0x12,
  boolean: 0x13,
  datetime: 0x14,
  integer64: 0x17,
  functionptr: 0x20,
  record: 0x21,
  string: 0x22,
  object: 0x23,
  weakobject: 0x24,
  blob: 0x40,
  array: 0x80,
} as const;

const typeNames: Record<number, string> = {
  0x01: "VARIANT",
  0x10: "INTEGER",
  0x11: "MONEY",
  0x12: "FLOAT",
  0x13: "BOOLEAN",
  0x14: "DATETIME",
  0x15: "TABLE",
  0x16: "SCHEMA",
  0x17: "INTEGER64",
  0x20: "FUNCTION PTR",
  0x21: "RECORD",
  0x22: "STRING",
  0x23: "OBJECT",
  0x24: "WEAKOBJECT",
  0x40: "BLOB",
};

/** Get the HareScript name of a type id, eg 'RECORD ARRAY' */
export function getHareScriptTypeName(type: number): string {
  if (type & TypeIds.array)
    return type === TypeIds.array ? "VARIANT ARRAY" : `${typeNames[type & ~TypeIds.array] ?? `TYPE(${type & ~TypeIds.array})`} ARRAY`;
  return typeNames[type] ?? `TYPE(${type})`;
}

/** Whether the value contains other values (records, objects, arrays) */
export function isContainerValue(value: RawDebugValue): boolean {
  return value.type === TypeIds.record || value.type === TypeIds.object || value.type === TypeIds.weakobject || value.type >= TypeIds.array;
}

/** Whether only part of the value was retrieved */
export function isPartialValue(value: RawDebugValue): boolean {
  return value.length !== undefined && value.max !== undefined && (value.max - (value.min ?? 0n) < value.length);
}

/** A rendered variable */
export interface RenderedVariable {
  name: string;
  /** Description of the value, eg '"text"', 'RECORD (3 cells)' or 'INTEGER ARRAY (10 items)' */
  value: string;
  /** HareScript type id (negative for special values) */
  type: number;
  /** Id to request (more of) the value */
  id: number;
  /** Members (record cells, object members, array elements), if included */
  members: RenderedVariable[];
  /** Whether there are members that weren't included (because of the depth limit or because the debugger didn't send them) */
  truncated: boolean;
}

function formatDateTime(value: Date): string {
  if (value.getTime() >= maxDateTime.getTime())
    return "MAX_DATETIME";
  if (value.getTime() === defaultDateTime.getTime())
    return "DEFAULT DATETIME";
  return value.toISOString();
}

function partialSuffix(value: RawDebugValue, unit: string): string {
  const length = value.length ?? 0n;
  const shown = (value.max ?? 0n) - (value.min ?? 0n);
  return shown < length ? ` (${length} ${unit}, ${shown} shown)` : ` (${length} ${unit})`;
}

/** Describe a raw value (without its members) */
export function describeValue(value: RawDebugValue): string {
  switch (value.type) {
    case SpecialValueType.objectContext: return "<object context>";
    case SpecialValueType.requesting: return "<requesting>";
    case SpecialValueType.invalidRequest: return "<invalid request>";
    case SpecialValueType.optimizedAway: return "<optimized away>";
    case TypeIds.boolean: return value.value ? "TRUE" : "FALSE";
    case TypeIds.integer:
    case TypeIds.integer64:
    case TypeIds.float:
      return String(value.value);
    case TypeIds.money: return String(value.value);
    case TypeIds.string: {
      const str = String(value.value ?? "");
      return JSON.stringify(str).slice(0, -1) + (isPartialValue(value) ? `..." (${value.length} bytes)` : `"`);
    }
    case TypeIds.blob: {
      const length = value.length ?? 0n;
      return length === 0n ? "DEFAULT BLOB" : `BLOB (length: ${length} bytes)`;
    }
    case TypeIds.datetime: return value.value instanceof Date ? formatDateTime(value.value) : String(value.value);
    case TypeIds.record: {
      if (!value.exists)
        return "DEFAULT RECORD";
      if (!value.length)
        return "EMPTY RECORD";
      return "RECORD" + partialSuffix(value, "cells");
    }
    case TypeIds.object:
    case TypeIds.weakobject: {
      const name = getHareScriptTypeName(value.type);
      if (!value.exists)
        return `DEFAULT ${name}`;
      return `${name} #${value.objectid} (${(value.objecttypes ?? []).join(", ")})` + partialSuffix(value, "cells");
    }
    default: {
      const name = getHareScriptTypeName(value.type);
      return value.type >= TypeIds.array ? name + partialSuffix(value, "items") : name;
    }
  }
}

/** Get the members of a container value that were included in the raw value */
export function getMembers(value: RawDebugValue): Array<{ name: string; value: RawDebugValue }> {
  if (!Array.isArray(value.value))
    return [];
  const min = Number(value.min ?? 0n);
  if (value.type >= TypeIds.array)
    return (value.value as RawDebugValue[]).map((elt, idx) => ({ name: `[${min + idx}]`, value: elt }));
  if (value.type === TypeIds.record || value.type === TypeIds.object || value.type === TypeIds.weakobject)
    return (value.value as Array<Partial<RawDebugCell> | null>).map((cell, idx) => cell?.name !== undefined && cell.value
      ? { name: cell.name, value: cell.value }
      : { name: `[${min + idx}]`, value: { type: SpecialValueType.objectContext, id: 0 } }); // object members that aren't variables
  return [];
}

/** Render a raw value into a tree
    @param name - Name to give the value
    @param value - Raw value
    @param maxDepth - Maximum depth of members to render (0: only the value itself)
*/
export function renderVariable(name: string, value: RawDebugValue, maxDepth: number): RenderedVariable {
  const members = getMembers(value);
  const container = isContainerValue(value);
  const includeMembers = maxDepth > 0;
  return {
    name,
    value: describeValue(value),
    type: value.type,
    id: value.id,
    members: includeMembers ? members.map(m => renderVariable(m.name, m.value, maxDepth - 1)) : [],
    truncated: container && ((!includeMembers && members.length > 0) || isPartialValue(value)),
  };
}
