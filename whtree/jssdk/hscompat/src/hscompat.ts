// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/hscompat" {
}

import { decodeHSON, encodeHSON, setHareScriptType, HareScriptType, getHSTypeName } from "./hson";
//Starting with WH5.6.1, you can load these from @webhare/std. TODO deprecate
export { toSnakeCase, toCamelCase, type ToSnakeCase, type ToCamelCase } from "@webhare/std/src/types";
export { isLike, isNotLike, UUIDToWrdGuid, wrdGuidToUUID, isValidWRDGuid } from "./strings";
export { omitHareScriptDefaultValues, recordLowerBound, recordUpperBound, lowerBound, upperBound, recordRange } from "./algorithms";
export { makeDateFromParts, dateToParts, defaultDateTime, maxDateTime, getRoundedDateTime, utcToLocal, localToUTC } from "./datetime";
export { decodeHSON, encodeHSON, setHareScriptType, HareScriptType, getHSTypeName };
export { decodeHSONorJSONRecord } from "./hson";
export { resizeTSDescriptor, type ExportedTSDescriptor } from "./resources";
export { buildRTDFromHareScriptRTD, exportAsHareScriptRTD, exportRTDToRawHTML, importHSResourceDescriptor, type HareScriptRTD, type HareScriptResourceDescriptor } from "./richdocument";
export { type HareScriptColumnFile, getSpreadsheetDataFromHareScript } from "./formats";
