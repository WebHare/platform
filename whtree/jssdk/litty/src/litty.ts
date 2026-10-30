// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/litty" {
}

import { encodeString, isDate, type Money } from "@webhare/std";

/** Value types supported in Litty interpolations */
export type LittyValue = string | number | bigint | boolean | Date | URL | Money
  | Temporal.Instant | Temporal.PlainDate | Temporal.PlainDateTime | Temporal.PlainTime | Temporal.ZonedDateTime
  | Litty | LittyValue[] | null | undefined;

export type Litty = {
  strings: string[];
  values: LittyValue[];
};

/** Build a Litty template literal, automatically encoding inserted strings
 * Null and undefined render as empty strings; dates render as ISO timestamps and Temporal values use their string representation.
 * #example litty`<p>${content}</p>`
 */
export function litty(strings: TemplateStringsArray, ...values: LittyValue[]): Litty {
  return { strings: [...strings], values };
}

/** Wrap a string as raw content which shouldn't be encoded
 * #example litty`<p>${content}</p>`
 */
export function rawLitty(str: string): Litty {
  return { strings: [str], values: [] };
}

/** Insert a value with a specific encoding. Use this to override encoding, eg the `html` format to encode soft linebreaks as `<br/>`
 * @param data - The string to encode
 * @param encoding - The type of encoding to apply, e "html" to encode `\n` as `<br>`.
*/
export function littyEncode(data: string, encoding: "attribute" | "html"): Litty {
  return rawLitty(encodeString(data, encoding));
}

async function encodeLittyValue(value: LittyValue): Promise<string> {
  if (value === null || value === undefined)
    return "";
  if (Array.isArray(value))
    return (await Array.fromAsync(value.map(encodeLittyValue))).join("");
  if (isLitty(value))
    return littyToString(value);
  return encodeString(isDate(value) ? value.toISOString() : value.toString(), 'attribute');
}

/** Convert a litty template to a string */
export async function littyToString(lit: Litty | null | undefined): Promise<string> {
  //We're async to have room to support async template parts in the future
  let result = "";
  if (lit === null || lit === undefined)
    return "";

  for (let i = 0; i < lit.strings.length; i++) {
    result += lit.strings[i];
    if (i < lit.values.length)
      result += await encodeLittyValue(lit.values[i]);
  }
  return result;
}

export function isLitty(value: unknown): value is Litty {
  return typeof value === "object" && value !== null && "strings" in value && "values" in value;
}
