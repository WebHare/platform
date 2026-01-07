// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/hscompat" {
}

import { parseTyped } from "@webhare/std";
import { decodeHSON, encodeHSON, setHareScriptType, HareScriptType } from "./hson";
//Starting with WH5.6.1, you can load these from @webhare/std. TODO deprecate
export { toSnakeCase, toCamelCase, type ToSnakeCase, type ToCamelCase } from "@webhare/std/src/types";
export { isLike, isNotLike, UUIDToWrdGuid, wrdGuidToUUID, isValidWRDGuid } from "./strings";
export { omitHareScriptDefaultValues, recordLowerBound, recordUpperBound, lowerBound, upperBound, recordRange } from "./algorithms";
export { makeDateFromParts, dateToParts, defaultDateTime, maxDateTime, getRoundedDateTime, utcToLocal, localToUTC } from "./datetime";
export { decodeHSON, encodeHSON, setHareScriptType, HareScriptType };
export { buildRTDFromHareScriptRTD, exportAsHareScriptRTD, exportRTDToRawHTML, importHSResourceDescriptor, type HareScriptRTD, type HareScriptResourceDescriptor } from "./richdocument";
export { type HareScriptColumnFile, getSpreadsheetDataFromHareScript } from "./formats";

/** API to prepare for transitional period where we have both HSON and JSON records in the database. */
export function decodeHSONorJSONRecord(input: string | null, { typed = false } = {}): object | null {
  if (!input)
    return null;
  if (input.startsWith("hson:")) {
    const hson = decodeHSON(input);
    if (hson !== null && typeof hson !== "object")
      throw new Error(`Expected a record encoded in HSON, but got a ${typeof hson}`);
    return typed ? hson : JSON.parse(JSON.stringify(hson)); //ensure flattening of Money etc values if we didn't expect typed output
  }
  if (input.startsWith("{"))
    return typed ? parseTyped(input) : JSON.parse(input);
  throw new Error(`Decoding input that was expected to be HSON or JSON, but is neither (starts with: '${input.substring(0, 10)})')`);
}
