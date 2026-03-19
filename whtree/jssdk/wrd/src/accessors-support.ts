import { compare, type ComparableType, type MaybePromise } from "@webhare/std";
import { baseAttrCells, type AllowedFilterConditions } from "./types";
import type { AttrRec, EntityPartialRec, EntitySettingsRec, EntitySettingsWHFSLinkRec } from "./db";
import type { AnyWRDType } from "./schema";
import type { SelectQueryBuilder } from "kysely";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { AwaitableEncodedValue, EncodedSetting } from "./accessors";
import type { ExportOptions } from "@webhare/services/src/descriptor";
import type { ValueQueryChecker } from "./checker";
import { WebHareBlob } from "@webhare/services/src/webhareblob";
import { uploadBlob } from "@webhare/whdb/src/impl";

/** Response type for addToQuery. Null to signal the added condition is always false
 * @typeParam O - Kysely selection map for wrd.entities (third parameter for `SelectQueryBuilder<PlatformDB, "wrd.entities", O>`)
 */
export type AddToQueryResponse<O> = {
  needaftercheck: boolean;
  query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>;
} | null;


/** Compare values */
export function cmp<T extends ComparableType>(a: T, condition: "=" | ">=" | ">" | "!=" | "<" | "<=", b: T) {
  const cmpres = compare(a, b, { flexibleTimeTypes: true });
  switch (condition) {
    case "=": return cmpres === 0;
    case ">=": return cmpres >= 0;
    case "<=": return cmpres <= 0;
    case "<": return cmpres < 0;
    case ">": return cmpres > 0;
    case "!=": return cmpres !== 0;
  }
}

export function matchesValueWithCmp<
  V extends ComparableType,
  C extends ({ condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: V } | { condition: "in"; value: readonly V[] })>(value: V, cv: C): boolean {
  if (cv.condition === "in")
    return cv.value.some(v => cmp(value, '=', v));

  return cmp(value, cv.condition, cv.value);
}

export function getAttrBaseCells<T extends keyof typeof baseAttrCells>(tag: string, allowedTypes: readonly T[]): typeof baseAttrCells[T] {
  if (!allowedTypes.includes(tag as T))
    throw new Error(`Unhandled base attribute ${JSON.stringify(tag)}`);
  return baseAttrCells[tag as T];
}


/** Base for an attribute accessor
 * @typeParam In - Type for allowed values for insert and update
 * @typeParam Out - Type returned by queries
 * @typeParam Default - Output type plus default type (output may not include the default value for eg required domains, where `null` is the default)
 */
export abstract class WRDAttributeValueBase<In, Default, Out extends Default, ExportOut, C extends { condition: AllowedFilterConditions; value: unknown }> {
  attr: AttrRec;
  type: AnyWRDType;

  constructor(type: AnyWRDType, attr: AttrRec) {
    this.type = type;
    this.attr = attr;
  }

  /** Returns the default value for a value with no settings
   *  @returns Default value for this type
   */
  abstract getDefaultValue(): Default;

  /** Returns true if the value is not the default value
   * @param value - Value to check
   * @returns true if the value is not the default value
   */
  abstract isSet(value: Default): boolean;

  /** Checks if a filter (condition + value) is allowed for this attribute. Throws if not.
   * @param condition - Condition type
   * @param value - Condition value
   */
  abstract checkFilter({ condition, value }: C): void;

  /** Checks if a value matches a filter
   * @param value - Value to check
   * @param cv - Condition and value
   * @returns true if the value matches
   */
  abstract matchesValue(value: Default, cv: C): boolean;

  /** Try to add wheres to the database query on wrd.entities to filter out non-matches for this filter
   * @typeParam O - Output map for the database query
   * @param query - Database query
   * @param cv - Condition and value to compare with
   * @returns Whether after-filtering is necessary and updated query
   */
  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: C): AddToQueryResponse<O> {
    return { needaftercheck: true, query };
  }

  /** Returns true all the values in a filter match the default value
   * @param cv - Condition+value to check
   * @returns true if all values match the default value
   */
  containsOnlyDefaultValues<CE extends C>(cv: CE): boolean {
    const defaultvalue = this.getDefaultValue();
    if (Array.isArray(cv.value)) {
      for (const value of cv.value) {
        const newcv = { condition: "=", value };
        if (!this.matchesValue(defaultvalue, newcv as C))
          return false;
      }
      return true;
    } else if (cv.condition === "=")
      return this.matchesValue(defaultvalue, cv);
    else
      throw new Error(`Cannot handle condition ${cv.condition} in containsOnlyDefaultValues`);
  }

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, is always greater than settings_start
   * @param links - Entity settings whfs links, sorted on id
   * @param cc - Creationdate unified cache validator
   */
  abstract getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[], cc: number): Out | Promise<Out>;

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, may be the same as settings_start
   * @param row - Entity record
   * @param links - Entity settings whfs links, sorted on id
   * @param cc - Creationdate unified cache validator
   * @returns The parsed value. The return type of this function is used to determine the selection output type for a attribute.
   */
  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, row: EntityPartialRec, links: EntitySettingsWHFSLinkRec[], cc: number): Out | Promise<Out> {
    if (settings_limit <= settings_start)
      return this.getDefaultValue() as Out; // Cast is needed because for required fields, Out may not extend Default.
    else
      return this.getFromRecord(entity_settings, settings_start, settings_limit, links, cc);
  }

  /** Preprocess (load) exportable values to be importable
   */
  importValue(value: ExportOut | In): MaybePromise<In> {
    return value as unknown as In;
  }

  /** Convert the returned value to its exportable version
   */
  exportValue(value: Out, exportOptions?: ExportOptions): ExportOut | Promise<ExportOut> {
    return value as unknown as ExportOut;
  }

  /** Check the contents of a value used to insert or update a value
   * @param value - The value to check. The type of this value is used to determine which type is accepted in an insert or update.
   */
  abstract validateInput(value: In, checker: ValueQueryChecker, attrPath: string): void;

  /** Returns the list of attributes that need to be fetched */
  getAttrIds(): number | number[] {
    return this.attr.id || [];
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | ReadonlyArray<keyof EntityPartialRec> {
    return null;
  }

  abstract encodeValue(value: In | null): AwaitableEncodedValue; //explicitly add | null so derived classes have to handle it

  protected decodeAsStringWithOverlow(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    if (entity_settings[settings_start].rawdata)
      return entity_settings[settings_start].rawdata;
    const buf = entity_settings[settings_start].blobdata?.__getAsSyncUInt8Array();
    return buf ? Buffer.from(buf).toString() : "";
  }

  protected encodeAsStringWithOverlow(rawdata: string): AwaitableEncodedValue {
    if (!rawdata)
      return {};
    if (Buffer.byteLength(rawdata) <= 4096)
      return { settings: { rawdata, attribute: this.attr.id } };

    return {
      settings: (async (): Promise<EncodedSetting[]> => {
        const blobdata = WebHareBlob.from(rawdata);
        await uploadBlob(blobdata);
        return [{ blobdata, attribute: this.attr.id }];
      })()
    };
  }
}
