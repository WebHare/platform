// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/litty" {
}

import { encodeString } from "@webhare/std";

type LittyValue = string | number | Litty | Litty[];

export type Litty = {
  strings: string[];
  values: LittyValue[];
};

/** Build a Litty template literal, automatically encoding inserted strings
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

/** Insert a value with a specific encoding
 * @param data - The string to encode
 * @param encoding - The type of encoding to apply, e "html" to encode `\n` as `<br>`.
*/
export function littyEncode(data: string, encoding: "attribute" | "html"): Litty {
  return rawLitty(encodeString(data, encoding));
}

/** Convert a litty template to a string */
export async function littyToString(lit: Litty): Promise<string> {
  //We're async to have room to support async template parts in the future
  let result = "";
  if (!lit)
    return "";

  for (let i = 0; i < lit.strings.length; i++) {
    result += lit.strings[i];
    if (i < lit.values.length) {
      const item = lit.values[i];
      if (typeof item === "number") {
        result += item.toString();
      } else if (typeof item === "string") {
        result += encodeString(item, 'attribute');
      } else if (Array.isArray(item)) {
        result += (await Array.fromAsync(item.map(littyToString))).join("");
      } else {
        result += await littyToString(item);
      }
    }
  }
  return result;
}

export function isLitty(value: unknown): value is Litty {
  return typeof value === "object" && value !== null && "strings" in value && "values" in value;
}
