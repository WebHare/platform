/* JSON encoding for the debug agent protocol, keeping the value types JSON doesn't have (bigint, Date, Money) */

import { Money } from "@webhare/std";

export function encodeWire(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, val: unknown) {
    const raw = this[key]; // JSON.stringify has already called toJSON on dates
    if (typeof raw === "bigint")
      return { $bigint: raw.toString() };
    if (raw instanceof Date)
      return { $date: isNaN(raw.getTime()) ? null : raw.getTime() };
    if (raw instanceof Money)
      return { $money: raw.value };
    if (raw && typeof raw === "object" && "arrayBuffer" in raw && "size" in raw && typeof (raw as { arrayBuffer: unknown }).arrayBuffer === "function")
      return { $blob: Number((raw as { size: number }).size) }; // blobs aren't transferred
    return val;
  });
}

export function decodeWire(text: string): unknown {
  return JSON.parse(text, (_key, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const keys = Object.keys(val);
      if (keys.length === 1) {
        const rec = val as Record<string, unknown>;
        if (keys[0] === "$bigint")
          return BigInt(rec.$bigint as string);
        if (keys[0] === "$date")
          return new Date(rec.$date === null ? NaN : rec.$date as number);
        if (keys[0] === "$money")
          return new Money(rec.$money as string);
      }
    }
    return val;
  });
}
