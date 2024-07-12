import { decodeHSON, encodeHSON, setHareScriptType, HareScriptType } from "./hson";
//Starting with WH5.6.1, you can load these from @webhare/std. TODO deprecate
export { toSnakeCase, toCamelCase, type ToSnakeCase, type ToCamelCase } from "@webhare/std/types";
export { isLike, isNotLike, UUIDToWrdGuid, wrdGuidToUUID } from "./strings";
export { omitHareScriptDefaultValues, recordLowerBound, recordUpperBound } from "./algorithms";
export { makeDateFromParts, dateToParts, defaultDateTime, maxDateTime } from "./datetime";
export { decodeHSON, encodeHSON, setHareScriptType, HareScriptType };

/** API to prepare for transitional period where we have both HSON and JSON records in the database. */
export function decodeHSONorJSONRecord(input: string | null): object | null {
  if (!input)
    return null;
  if (input.startsWith("hson:")) {
    const hson = decodeHSON(input);
    if (hson !== null && typeof hson !== "object")
      throw new Error(`Expected a record encoded in HSON, but got a ${typeof hson}`);
    return JSON.parse(JSON.stringify(hson)); //ensure flattening of Money etc values
  }
  if (input.startsWith("{"))
    return JSON.parse(input);
  throw new Error(`Decoding input that was expected to be HSON or JSON, but is neither (starts with: '${input.substring(0, 10)})')`);
}
