import { WRDBaseAttributeTypeId, WRDAttributeTypeId, type AllowedFilterConditions, type WRDAttrBase, WRDGender, type WRDInsertable, type GetResultType, type SimpleWRDAttributeType, baseAttrCells } from "./types";
import type { AttrRec, EntityPartialRec, EntitySettingsRec, EntitySettingsWHFSLinkRec, TypeRec } from "./db";
import { sql, type SelectQueryBuilder, type ExpressionBuilder, type RawBuilder, type Expression, type SqlBool, type Updateable } from "kysely";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { recordLowerBound, recordUpperBound } from "@webhare/hscompat/src/algorithms";
import { isLike } from "@webhare/hscompat/src/strings";
import type { AddressValue } from "@webhare/address";
import { Money, omit, isValidEmail, isValidUrl, isDate, toCLocaleUppercase, regExpFromWildcards, stringify, parseTyped, isValidUUID, compare, type ComparableType, throwError, isTruthy, stdTypeOf } from "@webhare/std";
import { addMissingScanData, decodeScanData, ResourceDescriptor, type ExportedResource, type ExportOptions } from "@webhare/services/src/descriptor";
import { encodeHSON, decodeHSON, dateToParts, defaultDateTime, makeDateFromParts, maxDateTime } from "@webhare/hscompat";
import type { IPCMarshallableData, IPCMarshallableRecord } from "@webhare/hscompat/src/hson";
import { maxDateTimeTotalMsecs } from "@webhare/hscompat/src/datetime";
import { isValidWRDTag } from "./wrdsupport";
import { db, uploadBlob } from "@webhare/whdb";
import { WebHareBlob, type RichTextDocument, IntExtLink, type Instance, buildRTD } from "@webhare/services";
import { wrdSettingId } from "@webhare/services/src/symbols";
import { AuthenticationSettings } from "./authsettings";
import type { ValueQueryChecker } from "./checker";
import { getInstanceFromWHFS, getRTDFromWHFS, storeInstanceInWHFS, storeRTDinWHFS } from "./wrd-whfs";
import { isPromise } from "node:util/types";
import type { InstanceExport, InstanceSource } from "@webhare/whfs/src/contenttypes";
import { buildInstance, isInstance, type RTDExport, type RTDSource } from "@webhare/services/src/richdocument";
import type { AnyWRDType } from "./schema";
import { makePaymentProviderValueFromEntitySetting, makePaymentValueFromEntitySetting, type PaymentProviderValue, type PaymentValue } from "./paymentstore";
import { buildRTDFromComposedDocument, exportRTDAsComposedDocument } from "@webhare/hscompat/src/richdocument";

/** Response type for addToQuery. Null to signal the added condition is always false
 * @typeParam O - Kysely selection map for wrd.entities (third parameter for `SelectQueryBuilder<PlatformDB, "wrd.entities", O>`)
 */
type AddToQueryResponse<O> = {
  needaftercheck: boolean;
  query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>;
} | null;

/// Returns `null` if Required might be false
type NullIfNotRequired<Required extends boolean> = false extends Required ? null : never;

/// Returns T or a promise resolving to T
type MaybePromise<T> = Promise<T> | T;

/** Allowed values for wrd.entity_settings_whfslink.linktype */
export const LinkTypes = { RTD: 0, Instance: 1, FSObject: 2 } as const;

/// Single settings record
export type EncodedSetting = Updateable<PlatformDB["wrd.entity_settings"]> & {
  id?: number;
  attribute: number;
  sub?: EncodedSetting[];
  ///If we also need to encode a link in the WHFS/WRD link table
  linktype?: typeof LinkTypes[keyof typeof LinkTypes];
  link?: number;
};

export type AwaitableEncodedSetting = Updateable<PlatformDB["wrd.entity_settings"]> & {
  id?: number;
  attribute: number;
  sub?: Array<AwaitableEncodedSetting | Promise<EncodedSetting[]>>;
  ///If we also need to encode a link in the WHFS/WRD link table
  linktype?: typeof LinkTypes[keyof typeof LinkTypes];
  link?: number;
};
/// All values needed for an field update
export type EncodedValue = {
  entity?: EntityPartialRec;
  settings?: EncodedSetting | EncodedSetting[];
};
export type AwaitableEncodedValue = {
  entity?: EntityPartialRec;
  settings?: AwaitableEncodedSetting | AwaitableEncodedSetting[] | Promise<EncodedSetting[]>;
};

export function encodeWRDGuid(guid: Buffer) {
  if (guid.length !== 16)
    throw new Error(`Input to encodeWRDGuid is not a raw guid`);

  const guidhex = guid.toString("hex");
  return `${guidhex.substring(0, 8)}-${guidhex.substring(8, 12)}-${guidhex.substring(12, 16)}-${guidhex.substring(16, 20)}-${guidhex.substring(20)}`;

}
export function decodeWRDGuid(wrdGuid: string) {
  if (!isValidUUID(wrdGuid))
    throw new Error("Invalid wrdGuid: " + wrdGuid);

  return Buffer.from(wrdGuid.replaceAll('-', ''), "hex");
}

export async function getGuidForEntity(id: number): Promise<string | null> {
  const row = await db<PlatformDB>()
    .selectFrom("wrd.entities")
    .select(["guid"])
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? encodeWRDGuid(row.guid) : null;
}

export async function getIdToGuidMap(ids: Array<number | null>): Promise<Map<number | null, string>> {
  return new Map((await db<PlatformDB>()
    .selectFrom("wrd.entities")
    .select(["id", "guid"])
    .where("id", "in", ids.filter(isTruthy))
    .execute()).map(row => [row.id, encodeWRDGuid(row.guid)]));
}

function decodeResourceDescriptor(val: EntitySettingsRec, links: EntitySettingsWHFSLinkRec[], cc: number): ResourceDescriptor {
  const lpos = recordLowerBound(links, val, ["id"]);
  const sourceFile = lpos.found ? links[lpos.position].fsobject : null;
  //See also GetWrappedObjectFromWRDSetting: rawdata is prefixed with WHFS: if we need to pick up a link
  const hasSourceFile = val.rawdata.startsWith("WHFS:");
  const meta = {
    ...decodeScanData(val.rawdata.substring(hasSourceFile ? 5 : 0)),
    sourceFile,
    dbLoc: { source: 3, id: val.id, cc }
  };

  const blob = val.blobdata;
  return new ResourceDescriptor(blob, meta);
}

async function encodeResourceDescriptor(attribute: number, value: ResourceDescriptor, fileName?: string): Promise<EncodedSetting> {
  const rawdata = (value.sourceFile ? "WHFS:" : "") + await addMissingScanData(value, { fileName });
  if (value.resource.size)
    await uploadBlob(value.resource);

  const setting: EncodedSetting = { rawdata, blobdata: value.resource.size ? value.resource : null, attribute, id: value.dbLoc?.id };
  if (value.sourceFile) {
    setting.linktype = 2;
    setting.link = value.sourceFile;
  }
  return setting;
}


/** Lookup domain values by id, guid or tag
 * @param type - Referring type (not necessarily the one we're searching *in*)
 * @param attr - Attribute to lookup
 */
async function lookupDomainValues(type: AnyWRDType, attr: AttrRec, vals: Array<string | number>): Promise<number[]> {
  //TODO bulk lookups
  //TODO have an import context to cache earlier lookups during the same import session
  const output: number[] = [];

  let targetType: TypeRec | undefined;

  for (const val of vals) {
    if (typeof val === "number") { //FIXME
      output.push(val);
      continue;
    }

    if (!targetType) {
      const schemadata = await type.schema.__ensureSchemaData();
      targetType = schemadata.typeIdMap.get(attr.domain!) ?? throwError(`Type #${attr.domain} not found in schema data`);
    }

    const query = db<PlatformDB>().selectFrom("wrd.entities").where("type", "in", targetType.childTypeIds);
    let res;

    if (isValidUUID(val)) {
      const binaryGuid = decodeWRDGuid(val);
      res = await query.where("guid", "=", binaryGuid).select(["id"]).executeTakeFirst();
    } else if (isValidWRDTag(val)) {
      res = await query.where("tag", "=", val).select(["id"]).executeTakeFirst();
    } else {
      throw new Error(`Unrecognized value kind '${val}' for domain ${attr.tag} in type ${type.getFormattedName()}`);
    }

    if (!res) //TODO clearer error using JS metadata/names
      throw new Error(`Unable to locate '${val}' for domain ${attr.tag} in type ${type.getFormattedName()}`);
    output.push(res.id);
    continue;
  }
  return output;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWRDAccessor = WRDAttributeValueBase<any, any, any, any, any>;

/** Compare values */
function cmp<T extends ComparableType>(a: T, condition: "=" | ">=" | ">" | "!=" | "<" | "<=", b: T) {
  const cmpres = compare(a, b);
  switch (condition) {
    case "=": return cmpres === 0;
    case ">=": return cmpres >= 0;
    case "<=": return cmpres <= 0;
    case "<": return cmpres < 0;
    case ">": return cmpres > 0;
    case "!=": return cmpres !== 0;
  }
}

type SettingsSelectBuilder = SelectQueryBuilder<PlatformDB, "wrd.entities" | "wrd.entity_settings", { id: number }>;
type SettingsExpressionBuilder = ExpressionBuilder<PlatformDB, "wrd.entities" | "wrd.entity_settings">;

/** Returns a subquery over wrd.entity_settings on a wrd.entities where, joined on the entity id
 * @param qb - Query over wrd.entities
 * @returns Subquery over wrd.entity_settings, with the column `id` already selected.
*/
function getSettingsSelect(qb: ExpressionBuilder<PlatformDB, "wrd.entities">, attr: number): SettingsSelectBuilder {
  return qb
    .selectFrom("wrd.entity_settings")
    .select(["wrd.entity_settings.id"])
    .whereRef("wrd.entity_settings.entity", "=", "wrd.entities.id")
    .where("wrd.entity_settings.attribute", "=", attr);
}

/** Adds query filters to a query for simple query matches
 * Given the query
 * ```
 * SELECT ...
 *   FROM wrd.entities
 * ```
 * this function adds the following condition
 *  WHERE (EXISTS (SELECT FROM wrd.entity_settings WHERE entity = entities.id AND (...part added by builder callback))
 *         OR NOT EXISTS (SELECT FROM entity_settings WHERE entity = entities.id) // only if defaultmatches === true
 * @param query - Query to extend
 * @param defaultmatches - If TRUE, entities that have no matching settings records (aka have a default value) should also be returned
 * @param builder - Function that add the relevant conditions on the first subquery to identify matching settings records
 * @returns Updated query
*/
function addQueryFilter2<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, attr: number, defaultmatches: boolean, builder?: (b: SettingsExpressionBuilder) => Expression<SqlBool>): SelectQueryBuilder<PlatformDB, "wrd.entities", O> {
  return query.where((oqb) => {
    let subquery = getSettingsSelect(oqb, attr);
    if (builder)
      subquery = subquery.where(sqb => builder(sqb));

    const valueTest = oqb.exists(subquery);
    if (defaultmatches) {
      return oqb.or([
        valueTest,
        oqb.not(oqb.exists(eqb => getSettingsSelect(eqb, attr)))
      ]);
    }
    return valueTest;
  });
}

function addIndexedSelect(builder: SettingsExpressionBuilder, expr: Expression<SqlBool>, condition: string, value: string | readonly (string | null)[]): Expression<SqlBool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any --  !Array.isArray doesn't exclude readonly arrays
  if (condition === "=" && !(Array.isArray as (arg: any) => arg is any[] | readonly any[])(value) && value) {
    value = toCLocaleUppercase(value).substring(0, 264);
    return builder.and([
      expr,
      builder(sql`upper(left("rawdata", 264))`, `=`, value)
    ]);
  } else if (condition === "in" && Array.isArray(value)) {
    value = value.map(v => v && toCLocaleUppercase(v).substring(0, 264)).filter(v => v);
    if (!value.length)
      return expr;
    return builder.and([
      expr,
      builder(sql`upper(left("rawdata", 264))`, `in`, value)
    ]);
  }
  return expr;
}


function getAttrBaseCells<T extends keyof typeof baseAttrCells>(tag: string, allowedTypes: readonly T[]): typeof baseAttrCells[T] {
  if (!allowedTypes.includes(tag as T))
    throw new Error(`Unhandled base attribute ${JSON.stringify(tag)}`);
  return baseAttrCells[tag as T];
}

type WRDDBStringConditions = {
  condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: string; options?: { matchCase?: boolean };
} | {
  condition: "in"; value: readonly string[]; options?: { matchCase?: boolean };
} | {
  condition: "like"; value: string; options?: { matchCase?: boolean };
} | {
  condition: "mentions"; value: string; options?: { matchCase?: boolean };
} | {
  condition: "mentionsany"; value: readonly string[]; options?: { matchCase?: boolean };
};

class WRDDBStringValue extends WRDAttributeValueBase<string, string, string, string, WRDDBStringConditions> {
  getDefaultValue() { return ""; }
  isSet(value: string) { return Boolean(value); }
  checkFilter({ condition, value }: WRDDBStringConditions) {
    if (condition === "mentions" && !value)
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(condition)}`);
  }
  matchesValue(value: string, cv: WRDDBStringConditions): boolean {
    const caseInsensitive = cv.options?.matchCase === false; //matchcase defauls to true
    if (caseInsensitive)
      value = toCLocaleUppercase(value);
    if (cv.condition === "in" || cv.condition === "mentionsany") {
      if (caseInsensitive) {
        return cv.value.some(v => value === toCLocaleUppercase(v));
      } else
        return cv.value.includes(value);
    }
    const cmpvalue = caseInsensitive ? toCLocaleUppercase(cv.value) : cv.value;
    if (cv.condition === "like") {
      return isLike(value, cmpvalue);
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cmpvalue);
  }

  isCaseInsensitve(cv: WRDDBStringConditions) {
    return cv.options?.matchCase === false; //matchcase defaults to true;
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBStringConditions): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);
    const caseInsensitive = this.isCaseInsensitve(cv);

    // Rewrite like query to PostgreSQL LIKE mask format
    let db_cv = { ...cv };
    if (db_cv.condition === "like") {
      db_cv.value = db_cv.value.replaceAll(/[\\%_]/g, "\\$&").replaceAll("*", "%").replaceAll("?", "_");
    }

    // rewrite mentions and mentionsany to supported conditions
    if (db_cv.condition === "mentions")
      db_cv = { ...db_cv, condition: "=" };
    else if (db_cv.condition === "mentionsany")
      db_cv = { ...db_cv, condition: "in" };

    if (caseInsensitive) {
      if (db_cv.condition === "in")
        db_cv.value = db_cv.value.map(v => toCLocaleUppercase(v));
      else
        db_cv.value = toCLocaleUppercase(db_cv.value);
    }

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null; // no results!

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;
    query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
      const mainQuery = caseInsensitive ?
        b(sql`upper("rawdata")`, filtered_cv.condition, filtered_cv.value) :
        b(`rawdata`, filtered_cv.condition, filtered_cv.value);
      return addIndexedSelect(b, mainQuery, filtered_cv.condition, filtered_cv.value);
    });

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    return entity_settings[settings_start].rawdata;
  }

  validateInput(value: string, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (typeof value !== "string")
      throw new Error(`Expected string for attribute ${checker.typeTag}.${attrPath}${this.attr.tag} but got ${stdTypeOf(value)}`);
    if (value && this.attr.isunique)
      checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
    if (Buffer.byteLength(value) > 4096)
      throw new Error(`Provided too large value (${Buffer.byteLength(value)} bytes) for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: string): EncodedValue {
    return value ? { settings: { rawdata: value, attribute: this.attr.id } } : {};
  }
}

class WRDDBEmailValue extends WRDDBStringValue {
  validateInput(value: string, checker: ValueQueryChecker, attrPath: string): void {
    super.validateInput(value, checker, attrPath);
    if (value && !isValidEmail(value) && !checker.importMode)
      throw new Error(`Invalid email address ${JSON.stringify(value)} for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }
  isCaseInsensitve(cv: WRDDBStringConditions) {
    return true;
  }
}

class WRDDBUrlValue extends WRDDBStringValue {
  validateInput(value: string, checker: ValueQueryChecker, attrPath: string): void {
    super.validateInput(value, checker, attrPath);
    if (value && !isValidUrl(value) && !checker.importMode)
      throw new Error(`Invalid URL ${JSON.stringify(value)} for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }
}

class WRDDBBaseStringValue extends WRDAttributeValueBase<string, string, string, string, WRDDBStringConditions> {
  getDefaultValue() { return ""; }
  isSet(value: string) { return Boolean(value); }
  checkFilter({ condition, value }: WRDDBStringConditions) {
    if (condition === "mentions" && !value)
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(condition)}`);
  }
  matchesValue(value: string, cv: WRDDBStringConditions): boolean {
    const caseInsensitive = cv.options?.matchCase === false; //matchcase defauls to true
    if (caseInsensitive)
      value = toCLocaleUppercase(value);
    if (cv.condition === "in" || cv.condition === "mentionsany") {
      if (caseInsensitive) {
        return cv.value.some(v => value === toCLocaleUppercase(v));
      } else
        return cv.value.includes(value);
    }
    const cmpvalue = caseInsensitive ? toCLocaleUppercase(cv.value) : cv.value;
    if (cv.condition === "like") {
      return isLike(value, cmpvalue);
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cmpvalue);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBStringConditions): AddToQueryResponse<O> {
    const caseInsensitive = cv.options?.matchCase === false; //matchcase defauls to true
    // Rewrite like query to PostgreSQL LIKE mask format
    let db_cv = { ...cv };
    if (db_cv.condition === "like") {
      db_cv.value = db_cv.value.replaceAll(/[\\%_]/g, "\\$&").replaceAll("*", "%").replaceAll(".", "_");
    }

    // rewrite mentions and mentionsany to supported conditions
    if (db_cv.condition === "mentions")
      db_cv = { ...db_cv, condition: "=" };
    else if (db_cv.condition === "mentionsany")
      db_cv = { ...db_cv, condition: "in" };

    if (caseInsensitive) {
      if (db_cv.condition === "in")
        db_cv.value = db_cv.value.map(v => toCLocaleUppercase(v));
      else
        db_cv.value = toCLocaleUppercase(db_cv.value);
    }

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null;

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;

    let baseAttr: RawBuilder<unknown>;
    switch (this.attr.tag) {
      case "wrdTag": baseAttr = !caseInsensitive ? sql`tag` : sql`upper("tag")`; break;
      case "wrdInitials": baseAttr = !caseInsensitive ? sql`initials` : sql`upper("initials")`; break;
      case "wrdFirstName": baseAttr = !caseInsensitive ? sql`firstname` : sql`upper("firstname")`; break;
      case "wrdFirstNames": baseAttr = !caseInsensitive ? sql`firstnames` : sql`upper("firstnames")`; break;
      case "wrdInfix": baseAttr = !caseInsensitive ? sql`infix` : sql`upper("infix")`; break;
      case "wrdLastName": baseAttr = !caseInsensitive ? sql`lastname` : sql`upper("lastname")`; break;
      case "wrdTitles": baseAttr = !caseInsensitive ? sql`titles` : sql`upper("titles")`; break;
      case "wrdTitlesSuffix": baseAttr = !caseInsensitive ? sql`titles_suffix` : sql`upper("titles_suffix")`; break;
      default: throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);
    }
    return {
      needaftercheck: false,
      query: query.where(baseAttr, filtered_cv.condition, filtered_cv.value)
    };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityRecord: EntityPartialRec): string {
    switch (this.attr.tag) {
      case "wrdTag": return entityRecord.tag || "";
      case "wrdInitials": return entityRecord.initials || "";
      case "wrdFirstName": return entityRecord.firstname || "";
      case "wrdFirstNames": return entityRecord.firstnames || "";
      case "wrdInfix": return entityRecord.infix || "";
      case "wrdLastName": return entityRecord.lastname || "";
      case "wrdTitles": return entityRecord.titles || "";
      case "wrdTitlesSuffix": return entityRecord.titles_suffix || "";
      default: throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    throw new Error("Not implemented for base fields");
  }

  validateInput(value: string, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode)
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value.length > 256)
      throw new Error(`Value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag} is too long (${value.length} characters, maximum is 256)`);
    if (value && this.attr.isunique)
      checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
    if (this.attr.tag === "wrdTag" && value && !isValidWRDTag(value))
      throw new Error(`Invalid wrdTag '${value}' - must start with A-Z, may only contain A-Z, 0-9 and _, but must not end with a _. Maximum length is 64 characters`);
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, [
      "wrdTag",
      "wrdInitials",
      "wrdFirstName",
      "wrdFirstNames",
      "wrdInfix",
      "wrdLastName",
      "wrdTitles",
      "wrdTitlesSuffix"
    ]);
  }

  encodeValue(value: string): EncodedValue {
    const key = this.getAttrBaseCells();
    return { entity: { [key]: value } };
  }
}

type WRDDBGuidConditions = {
  condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: string;
} | {
  condition: "in"; value: readonly string[]; options?: { matchcase?: boolean };
};

class WRDDBBaseGuidValue extends WRDAttributeValueBase<string, string, string, string, WRDDBGuidConditions> {
  checkGuid(guid: string) {
    decodeWRDGuid(guid);
  }
  getDefaultValue() { return ""; }
  isSet(value: string) { return Boolean(value); }
  checkFilter(cv: WRDDBGuidConditions) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.checkGuid(v));
    else
      this.checkGuid(cv.value);
  }
  matchesValue(value: string, cv: WRDDBGuidConditions): boolean {
    if (cv.condition === "in")
      return cv.value.includes(value);
    return cmp(value, cv.condition, cv.value);
  }
  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBGuidConditions): AddToQueryResponse<O> {
    // Rewrite like query to PostgreSQL LIKE mask format
    const db_cv = cv.condition === "in" ?
      { ...cv, value: cv.value.map(decodeWRDGuid) } :
      { ...cv, value: decodeWRDGuid(cv.value) };

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null;

    return {
      needaftercheck: false,
      query: query.where("guid", db_cv.condition, db_cv.value)
    };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityRecord: EntityPartialRec): string {
    return encodeWRDGuid(entityRecord.guid!);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    throw new Error("Not implemented for base fields");
  }

  validateInput(value: string, checker: ValueQueryChecker) {
    this.checkGuid(value);
    checker.addUniqueCheck(this.attr.fullTag, value, this.attr.tag);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    return getAttrBaseCells(this.attr.tag, ["wrdGuid"]);
  }

  encodeValue(value: string): EncodedValue {
    return { entity: { guid: decodeWRDGuid(value) } };
  }
}

type WRDDBaseGeneratedStringConditions = {
  condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: string;
} | {
  condition: "in"; value: readonly string[]; options?: { matchcase?: boolean };
};

class WRDDBBaseGeneratedStringValue extends WRDAttributeValueBase<never, string, string, string, WRDDBaseGeneratedStringConditions> {
  getDefaultValue() { return ""; }

  isSet(value: string) { return Boolean(value); }

  checkFilter({ condition, value }: WRDDBaseGeneratedStringConditions) {
    // type-check is enough (for now)
  }

  matchesValue(value: string, cv: WRDDBaseGeneratedStringConditions): boolean {
    if (cv.condition === "in")
      return cv.value.includes(value);
    return cmp(value, cv.condition, cv.value);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityRecord: EntityPartialRec): string {
    switch (this.attr.tag) {
      case "wrdFullName":
      case "wrdTitle": {
        if (!entityRecord.firstname && !entityRecord.firstnames && !entityRecord.lastname)
          return ""; //Not enough information to create a 'full name'

        let fullname = "";
        if (entityRecord.firstname !== "")
          fullname += entityRecord.firstname;
        else if (entityRecord.firstnames !== "")
          fullname += entityRecord.firstnames;
        else if (entityRecord.initials)
          fullname += entityRecord.initials;
        if (entityRecord.lastname)
          fullname += ` ${entityRecord.infix ? entityRecord.infix + " " : ""}${entityRecord.lastname}`;
        return fullname.trim();
      }
      default: throw new Error(`Unhandled base generated string attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    throw new Error("Not implemented for base fields");
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | ReadonlyArray<keyof EntityPartialRec> {
    return getAttrBaseCells(this.attr.tag, ["wrdFullName", "wrdTitle"]);
  }

  validateInput(value: string, checker: ValueQueryChecker, attrPath: string): void {
    throw new Error(`Unable to update generated field ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: string | null): EncodedValue {
    throw new Error(`Unable to updated generated field ${JSON.stringify(this.attr.tag)}`);
  }
}

type WRDDBBooleanConditions = {
  condition: "<" | "<=" | "=" | "!=" | ">=" | ">"; value: boolean;
};

class WRDDBBooleanValue extends WRDAttributeValueBase<boolean, boolean, boolean, boolean, WRDDBBooleanConditions> {
  getDefaultValue() { return false; }
  isSet(value: boolean) { return value; }
  checkFilter({ condition, value }: WRDDBBooleanConditions) {
    // type-check is enough (for now)
  }
  matchesValue(value: boolean, cv: WRDDBBooleanConditions): boolean {
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBBooleanConditions): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
      const mainQuery = b(`rawdata`, cv.condition, cv.value ? "1" : "");
      return addIndexedSelect(b, mainQuery, cv.condition, cv.value ? "1" : "");
    });

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): boolean {
    return entity_settings[settings_start].rawdata === "1";
  }

  validateInput(value: boolean, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: boolean): EncodedValue {
    return value ? { settings: { rawdata: "1", attribute: this.attr.id } } : {};
  }
}

type WRDDBIntegerConditions<Required extends boolean> = {
  condition: "<" | "<=" | "=" | "!=" | ">=" | ">";
  value: number | NullIfNotRequired<Required>;
} | {
  condition: "in"; value: true extends Required ? readonly number[] : ReadonlyArray<number | null>;
} | {
  condition: "mentions"; value: number;
} | {
  condition: "mentionsany"; value: readonly number[];
};

// Required flags whether or not |null is denied. Real integers don't use null, wrdId supports null in some query scenarios
class WRDDBIntegerValue<Required extends boolean = true> extends WRDAttributeValueBase<
  number,
  number,
  number,
  number,
  WRDDBIntegerConditions<Required>> {
  getDefaultValue() { return 0; }
  isSet(value: number) { return Boolean(value); }
  checkFilter({ condition, value }: WRDDBIntegerConditions<Required>) {
    // type-check is enough (for now)
  }
  matchesValue(value: number, cv: WRDDBIntegerConditions<Required>): boolean {
    if (cv.condition === "in" || cv.condition === "mentionsany")
      return cv.value.includes(value);
    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBIntegerConditions<Required>): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    else if (cv.condition === "mentionsany")
      cv = { condition: "in", value: cv.value };
    if (cv.condition === "in" && !cv.value.length)
      return null;

    query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
      const mainQuery = b(sql<number>`rawdata::integer`, cv.condition, cv.value);
      return addIndexedSelect(b, mainQuery, cv.condition, cv.value?.toString() ?? "");
    });

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): number {
    return Number(entity_settings[settings_start].rawdata);
  }

  validateInput(value: number, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value && this.attr.isunique)
      checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
  }

  encodeValue(value: number): EncodedValue {
    return value ? { settings: { rawdata: String(value), attribute: this.attr.id } } : {};
  }
}


class WRDDBBaseIntegerValue extends WRDAttributeValueBase<number, number, number, number, WRDDBIntegerConditions<true>> {
  getDefaultValue() { return 0; }
  isSet(value: number) { return Boolean(value); }
  checkFilter({ condition, value }: WRDDBIntegerConditions<true>) {
    // type-check is enough (for now)
  }
  matchesValue(value: number, cv: WRDDBIntegerConditions<true>): boolean {
    if (cv.condition === "in" || cv.condition === "mentionsany")
      return cv.value.includes(value);
    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBIntegerConditions<true>): AddToQueryResponse<O> {
    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    else if (cv.condition === "mentionsany")
      cv = { condition: "in", value: cv.value };

    if (cv.condition === "in" && !cv.value.length)
      return null;

    switch (this.attr.tag) {
      case "wrdOrdering": query = query.where("ordering", cv.condition, cv.value); break;
      default: throw new Error(`Unhandled base integer attribute ${JSON.stringify(this.attr.tag)}`);
    }

    return {
      needaftercheck: false,
      query
    };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): number {
    switch (this.attr.tag) {
      case "wrdId": return entityrec["id"] || 0;
      case "wrdType": return entityrec["type"] || 0;
      case "wrdOrdering": return entityrec["ordering"] || 0;
      default: throw new Error(`Unhandled base integer attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): number {
    throw new Error(`Should not be called for base attributes`);
  }

  validateInput(value: number, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value && this.attr.isunique)
      checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdId", "wrdType", "wrdOrdering"]);
  }

  encodeValue(value: number): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value } };
  }
}

type WRDDBDomainConditions = {
  condition: "=" | "!="; value: number | null;
} | {
  condition: "in"; value: ReadonlyArray<number | null>;
} | {
  condition: "mentions"; value: number;
} | {
  condition: "mentionsany"; value: readonly number[];
};

class WRDDBDomainValue<Required extends boolean> extends WRDAttributeValueBase<
  (number | NullIfNotRequired<Required>),
  (number | null),
  number | NullIfNotRequired<Required>,
  (true extends Required ? string : string | null),
  WRDDBDomainConditions
> {
  getDefaultValue(): number | null { return null; }
  isSet(value: number | null) { return Boolean(value); }
  checkFilter(cv: WRDDBDomainConditions) {
    if (cv.condition === "mentionsany") {
      if (cv.value.some(v => !v))
        throw new Error(`Not allowed to use 'null' or 0 for matchtype ${JSON.stringify(cv.condition)}`);
    } else if (cv.condition === "in") {
      if (cv.value.some(v => v === 0))
        throw new Error(`Not allowed to use 0 for matchtype ${JSON.stringify(cv.condition)}`);
    } else if (cv.condition === "mentions" && !cv.value)
      throw new Error(`Not allowed to use 'null' or 0 for matchtype ${JSON.stringify(cv.condition)}`);
    if (cv.value === 0)
      throw new Error(`Not allowed to use 0 for domain types`);
  }
  matchesValue(value: number | null, cv: WRDDBDomainConditions): boolean {
    switch (cv.condition) {
      case "=":
      case "mentions": {
        return value === (cv.value || null);
      }
      case "!=": {
        return value !== (cv.value || null);
      }
      case "in": {
        return Boolean(cv.value.includes(value));
      }
      case "mentionsany": {
        return Boolean(value && cv.value.includes(value));
      }
    }
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDomainConditions): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    // rewrite mentions and mentionsany to supported conditions
    let db_cv = { ...cv };
    if (db_cv.condition === "mentions")
      db_cv = { ...db_cv, condition: "=" };
    else if (db_cv.condition === "mentionsany")
      db_cv = { ...db_cv, condition: "in" };

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null;

    // copy to a new variable to satisfy TypeScript type inference
    const fixed_db_cv = db_cv;
    query = db_cv.value === null && db_cv.condition === '!='
      ? addQueryFilter2(query, this.attr.id, defaultmatches)
      : addQueryFilter2(query, this.attr.id, defaultmatches, b => b(`setting`, fixed_db_cv.condition, fixed_db_cv.value));
    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): number | NullIfNotRequired<Required> {
    return entity_settings[settings_start].setting as number; // for domains, always filled with valid reference
  }

  validateInput(value: number | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value && this.attr.domain) {
      checker.addRefCheck(this.attr.domain, value, attrPath + this.attr.tag);
      if (this.attr.isunique)
        checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
    }
    if (value === 0)
      throw new Error(`Value may not be the number 0 for attribute ${checker.typeTag}.${attrPath}${this.attr.tag} - use \`null\` to encode an empty domain value`);
  }

  encodeValue(value: number): EncodedValue {
    if (value === null)
      return {};

    return { settings: { setting: value, attribute: this.attr.id } };
  }

  importValue(value: string | number | NullIfNotRequired<Required>): Promise<number | NullIfNotRequired<Required>> | number | NullIfNotRequired<Required> {
    if (typeof value === "string")
      return lookupDomainValues(this.type, this.attr, [value]).then(val => val[0]);

    return value;
  }

  async exportValue(value: number | NullIfNotRequired<Required>): Promise<true extends Required ? string : string | null> {
    if (value === null)
      return null as unknown as string; //pretend it's all right, we shouldn't receive a null anyway if Required was set

    return await getGuidForEntity(value) ?? throwError(`Domain value ${value} for attribute ${this.attr.tag} not found in database`);
  }
}

class WRDDBBaseDomainValue<Required extends boolean, ExportOut extends string | number> extends WRDAttributeValueBase<
  number | NullIfNotRequired<Required>,
  number | null,
  number | NullIfNotRequired<Required>,
  ExportOut | NullIfNotRequired<Required>,
  WRDDBDomainConditions
> {
  constructor(type: AnyWRDType, attr: AttrRec, private exportString: boolean) {
    super(type, attr);
  }
  getDefaultValue(): number | null { return null; }
  isSet(value: number | null) { return Boolean(value); }
  checkFilter(cv: WRDDBDomainConditions) {
    if (cv.condition === "mentionsany") {
      if (cv.value.some(v => !v))
        throw new Error(`The value 'null' (or 0) is not allowed for matchtype ${JSON.stringify(cv.condition)}`);
    } else if (cv.condition === "mentions" && !cv.value)
      throw new Error(`The value 'null' (or 0) is not allowed for matchtype ${JSON.stringify(cv.condition)}`);
  }
  matchesValue(value: number | null, cv: WRDDBDomainConditions): boolean {
    switch (cv.condition) {
      case "=":
      case "mentions": {
        return value === (cv.value || null);
      }
      case "!=": {
        return value !== (cv.value || null);
      }
      case "in":
      case "mentionsany": {
        return Boolean(value && cv.value.includes(value));
      }
    }
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDomainConditions): AddToQueryResponse<O> {
    // rewrite mentions and mentionsany to supported conditions
    let db_cv = { ...cv };
    if (db_cv.condition === "mentions")
      db_cv = { ...db_cv, condition: "=" };
    else if (db_cv.condition === "mentionsany")
      db_cv = { ...db_cv, condition: "in" };

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null; // no results!

    // copy to a new variable to satisfy TypeScript type inference
    const fixed_db_cv = db_cv;
    const fieldname = this.getAttrBaseCells();
    if (fixed_db_cv.condition === "=" && !fixed_db_cv.value)
      query = query.where(fieldname, "is", null);
    else if (fixed_db_cv.condition === "!=" && !fixed_db_cv.value)
      query = query.where(fieldname, "is not", null);
    else if (fixed_db_cv.condition === "in" && fixed_db_cv.value.some(v => !v)) {
      // convert `field in [ null, ...x ]` to `(field is null or field in [ ...x ])`
      const nonnull = fixed_db_cv.value.filter(v => v);
      if (nonnull.length)
        query = query.where(qb => qb.or([qb(fieldname, "in", nonnull), qb(fieldname, "is", null)]));
      else
        query = query.where(fieldname, "is", null);
    } else
      query = query.where(fieldname, fixed_db_cv.condition, fixed_db_cv.value);

    return {
      needaftercheck: false,
      query
    };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): number | NullIfNotRequired<Required> {
    const retval = entityrec[this.getAttrBaseCells()] || null;
    return retval as number | NullIfNotRequired<Required>;
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): number | NullIfNotRequired<Required> {
    throw new Error(`Should not be called for base attributes`);
  }

  validateInput(value: number | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);

    if (value && this.attr.domain && (this.attr.tag === "wrdLeftEntity" || this.attr.tag === "wrdRightEntity")) {
      if (value === checker.entityId)
        throw new Error(`Entity ${checker.entityId} may not reference itself in attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      checker.addRefCheck(this.attr.domain, value, attrPath + this.attr.tag);
      if (value && this.attr.isunique)
        checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
    }
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdId", "wrdType", "wrdLeftEntity", "wrdRightEntity"]);
  }

  encodeValue(value: number): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value } };
  }

  importValue(value: ExportOut | number | NullIfNotRequired<Required>): MaybePromise<number | NullIfNotRequired<Required>> {
    if (typeof value === "string")
      return lookupDomainValues(this.type, this.attr, [value]).then(val => val[0]);

    return value as number | NullIfNotRequired<Required>;
  }

  async exportValue(value: number | NullIfNotRequired<Required>): Promise<ExportOut | NullIfNotRequired<Required>> {
    if (value === null || !this.exportString) //wrdId/wrdType are not converted
      return value as unknown as ExportOut; //pretend it's all right, we shouldn't receive a null anyway if Required was set

    return await getGuidForEntity(value) as ExportOut ?? throwError(`Domain value ${value} for attribute ${this.attr.tag} not found in database`);
  }
}

type WRDDBDomainArrayConditions = {
  condition: "mentions" | "contains"; value: number;
} | {
  condition: "mentionsany" | "intersects"; value: readonly number[];
} | {
  condition: "=" | "!="; value: readonly number[];
};

class WRDDBDomainArrayValue extends WRDAttributeValueBase<number[], number[], number[], string[], WRDDBDomainArrayConditions> {
  getDefaultValue(): number[] { return []; }
  isSet(value: number[]) { return Boolean(value?.length); }
  checkFilter({ condition, value }: WRDDBDomainArrayConditions) {
    if (Array.isArray(value)) {
      if (value.some(v => !v))
        throw new Error(`The value 'null' (or 0) is not allowed for matchtype ${JSON.stringify(condition)}`);
    } else if (!value)
      throw new Error(`The value 'null' (or 0) is not allowed for matchtype ${JSON.stringify(condition)}`);
  }
  matchesValue(value: number[], cv: WRDDBDomainArrayConditions): boolean {
    switch (cv.condition) {
      case "mentions":
      case "contains": {
        return value.includes(cv.value);
      }
      case "mentionsany":
      case "intersects": {
        for (const v of value)
          if (cv.value.includes(v))
            return true;
        return false;
      }
      case "=":
      case "!=": {
        for (const v of value)
          if (!cv.value.includes(v))
            return cv.condition === "!=";
        for (const v of cv.value)
          if (!value.includes(v))
            return cv.condition === "!=";
        return cv.condition !== "!=";
      }
    }
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDomainArrayConditions): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    type Conditions = {
      condition: "=" | "!="; value: number;
    } | {
      condition: "in" | "not in"; value: readonly number[];
    } | undefined;

    // For '=' and '!=',
    let db_cv: Conditions;
    switch (cv.condition) {
      case "mentions":
      case "contains": db_cv = { condition: "=", value: cv.value }; break;
      case "mentionsany":
      case "intersects": db_cv = { condition: "in", value: cv.value }; break;
      case "=": if (cv.value.length) db_cv = { condition: "in", value: cv.value }; break;
    }

    if (db_cv) {
      if (db_cv.condition === "in" && !db_cv.value.length)
        return null; // no results!

      // copy to a new variable to satisfy TypeScript type inference
      const fixed_db_cv = db_cv;

      query = addQueryFilter2(query, this.attr.id, defaultmatches, b => b(`setting`, fixed_db_cv.condition, fixed_db_cv.value));
    }

    return {
      needaftercheck: cv.condition === "=" || cv.condition === "!=",
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): number[] {
    const retval: number[] = [];
    for (let idx = settings_start; idx < settings_limit; ++idx) {
      const link = entity_settings[idx].setting;
      if (link)
        retval.push(link);
    }
    return retval;
  }

  validateInput(value: number[], checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value.length && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value.includes(0))
      throw new Error(`Value may not include the number 0 for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);

    if (value && this.attr.domain) {
      checker.addRefCheck(this.attr.domain, value, attrPath + this.attr.tag);
    }
  }

  encodeValue(value: number[]): EncodedValue {
    return {
      settings: [...new Set(value)].toSorted((a, b) => a - b).map((setting, idx) => ({ setting, attribute: this.attr.id, ordering: idx + 1 }))
    };
  }

  importValue(value: Array<number | string>): Promise<number[]> | number[] {
    if (value.some(_ => typeof _ !== "number"))
      return lookupDomainValues(this.type, this.attr, value);

    return value as number[];
  }

  async exportValue(value: number[]): Promise<string[]> {
    if (!value.length)
      return [];

    // we're *almost* getIdToGuidMap but not quite yet...
    const lookupres = await db<PlatformDB>().selectFrom("wrd.entities").select(["guid"]).where("id", "in", value).execute();
    return lookupres.map(_ => encodeWRDGuid(_.guid)).toSorted();
  }
}

type WRDDBEnumConditions<Options extends { allowedValues: string }, Required extends boolean> = {
  condition: "=" | "!="; value: GetEnumAllowedValues<Options, Required> | null; options: { ignoreAllowedValues?: boolean };
} | {
  condition: "in"; value: ReadonlyArray<GetEnumAllowedValues<Options, Required> | null>; options: { ignoreAllowedValues?: boolean };
} | {
  condition: "like"; value: string;
} | {
  condition: "mentions"; value: GetEnumAllowedValues<Options, Required>; options: { ignoreAllowedValues?: boolean };
} | {
  condition: "mentionsany"; value: ReadonlyArray<GetEnumAllowedValues<Options, Required>>; options: { ignoreAllowedValues?: boolean };
};

// FIXME: add wildcard support
type GetEnumAllowedValues<Options extends { allowedValues: string }, Required extends boolean> = (Options extends { allowedValues: infer V } ? V : never) | (Required extends true ? never : null);

type AllowedValues = Array<string | RegExp>;

function prepAllowedValues(allowedValues: string): AllowedValues {
  return allowedValues?.split("\t").map(_ => _.includes("*") || _.includes('?') ? regExpFromWildcards(_) : _);
}

function isAllowed(allowed: AllowedValues, value: string) {
  return value.match(/^[-a-zA-Z0-9_:.]+$/) && allowed.some(_ => _ === value || (_ instanceof RegExp && _.test(value)));
}


abstract class WRDDBEnumValueBase<
  Options extends { allowedValues: string },
  Required extends boolean> extends WRDAttributeValueBase<
    GetEnumAllowedValues<Options, Required>,
    GetEnumAllowedValues<Options, Required> | null,
    GetEnumAllowedValues<Options, Required>,
    GetEnumAllowedValues<Options, Required>,
    WRDDBEnumConditions<Options, Required>
  > {
  getDefaultValue(): GetEnumAllowedValues<Options, Required> | null { return null; }
  isSet(value: string | null) { return Boolean(value); }
  checkFilter(cv: WRDDBEnumConditions<Options, Required>) {
    if ((cv.condition === "mentions" && !cv.value) || (cv.condition === "mentionsany" && cv.value.some(_ => !_)))
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(cv.condition)}`);
    if (cv.value === "")
      throw new Error(`Use null instead of "" for enum compares`);

    if (cv.condition !== "like" && !cv.options?.ignoreAllowedValues) {
      if (cv.value && cv.condition === "=" && !isAllowed(prepAllowedValues(this.attr.allowedvalues), cv.value))
        throw new Error(`Invalid value ${JSON.stringify(cv.value)} for enum attribute ${this.attr.fullTag}`);
    }
  }
  //Note that even though the vlque
  matchesValue(value: GetEnumAllowedValues<Options, Required> | null, cv: WRDDBEnumConditions<Options, Required>): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    if (cv.condition === "mentionsany") {
      return Boolean(value && cv.value.includes(value));
    }
    if (cv.condition === "like") {
      return Boolean(value && isLike(value, cv.value));
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBEnumConditions<Options, Required>): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    // Rewrite like query to PostgreSQL LIKE mask format
    let db_cv = { ...cv };
    if (db_cv.condition === "like") {
      db_cv.value = db_cv.value.replaceAll(/[\\%_]/g, "\\$&").replaceAll("*", "%").replaceAll(".", "_");
    }

    // rewrite mentions and mentionsany to supported conditions
    if (db_cv.condition === "mentions")
      db_cv = { ...db_cv, condition: "=" };
    else if (db_cv.condition === "mentionsany")
      db_cv = { ...db_cv, condition: "in" };

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null; // no results!

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;
    query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
      const mainQuery = b(sql`rawdata`, filtered_cv.condition, filtered_cv.value || '');
      return addIndexedSelect(b, mainQuery, filtered_cv.condition, filtered_cv.value || '');
    });
    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): GetEnumAllowedValues<Options, Required> {
    return entity_settings[settings_start].rawdata as GetEnumAllowedValues<Options, Required>;
  }

  validateInput(value: GetEnumAllowedValues<Options, Required> | null, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && (!value || !value.length) && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value) {
      if (this.attr.isunique)
        checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);

      if (!checker.importMode && !isAllowed(prepAllowedValues(this.attr.allowedvalues), value))
        throw new Error(`Invalid value ${JSON.stringify(value)} for enum attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    }
  }
}

class WRDDBEnumValue<Options extends { allowedValues: string }, Required extends boolean> extends WRDDBEnumValueBase<Options, Required> {
  encodeValue(value: GetEnumAllowedValues<Options, Required> | null) {
    return value ? { settings: { rawdata: value, attribute: this.attr.id } } : {};
  }
}

class WRDDBBaseGenderValue extends WRDDBEnumValueBase<{ allowedValues: WRDGender }, false> {
  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBEnumConditions<{ allowedValues: WRDGender }, false>): AddToQueryResponse<O> {
    if (this.attr.tag !== 'wrdGender')
      throw new Error(`Unhandled base gender attribute ${JSON.stringify(this.attr.tag)}`);

    //TODO implement (but low prio, searching by gender is rare)
    return { needaftercheck: true, query }; //avoid suoer() - WRDDBEnumValueBase does the wrong thing
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): WRDGender | null {
    if (this.attr.tag !== 'wrdGender')
      throw new Error(`Unhandled base gender attribute ${JSON.stringify(this.attr.tag)}`);

    switch (entityrec["gender"]) {
      case 0: return null;
      case 1: return WRDGender.Male;
      case 2: return WRDGender.Female;
      case 3: return WRDGender.Other;
      default: throw new Error(`Unhandled base integer attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): never {
    throw new Error(`Should not be called for base attributes`);

  }
  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdGender"]);
  }

  validateInput(value: GetEnumAllowedValues<{ allowedValues: WRDGender }, false> | null, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && (!value || !value.length) && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value) {
      if (!["male", "female", "other"].includes(value))
        throw new Error(`Invalid value ${JSON.stringify(value)} for gender attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    }
  }


  encodeValue(value: WRDGender) {
    const mapped = [null, WRDGender.Male, WRDGender.Female, WRDGender.Other].indexOf(value);
    if (mapped === -1)
      throw new Error(`Unknown gender value '${value}'`);
    return { entity: { [this.getAttrBaseCells()]: mapped } };
  }
}


type WRDDBEnumArrayConditions<Options extends { allowedValues: string }> = {
  condition: "=" | "!=" | "intersects"; value: ReadonlyArray<GetEnumAllowedValues<Options, true>>; options: { ignoreAllowedValues?: boolean };
} | {
  condition: "contains"; value: GetEnumAllowedValues<Options, true>;
};

class WRDDBEnumArrayValue<Options extends { allowedValues: string }> extends WRDAttributeValueBase<
  Array<GetEnumArrayAllowedValues<Options>>,
  Array<GetEnumArrayAllowedValues<Options>>,
  Array<GetEnumArrayAllowedValues<Options>>,
  Array<GetEnumArrayAllowedValues<Options>>,
  WRDDBEnumArrayConditions<Options>> {
  getDefaultValue(): Array<GetEnumArrayAllowedValues<Options>> { return []; }
  isSet(value: string[]) { return Boolean(value?.length); }
  checkFilter(cv: WRDDBEnumArrayConditions<Options>) {
    const allowedvalues = prepAllowedValues(this.attr.allowedvalues);
    const testList = cv.condition === "contains" ? [cv.value] : cv.value;
    const firstBadValue = testList.find(_ => !_ || !isAllowed(allowedvalues, _));
    if (firstBadValue)
      throw new Error(`Invalid value ${JSON.stringify(firstBadValue)} for enum attribute ${this.attr.fullTag}`);
  }
  matchesValue(value: readonly string[], cv: WRDDBEnumArrayConditions<Options>): boolean {
    if (cv.condition === "contains") {
      return value.includes(cv.value);
    }
    throw new Error(`Condition ${cv.condition} not yet implemented for enumarray`);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Array<GetEnumArrayAllowedValues<Options>> {
    return entity_settings[settings_start].rawdata ? entity_settings[settings_start].rawdata.split("\t") as Array<GetEnumArrayAllowedValues<Options>> : [];
  }

  validateInput(value: Array<GetEnumArrayAllowedValues<Options>>, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value.length && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);

    for (const v of value)
      if (!v)
        throw new Error(`Provided default enum value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);

    if (!checker.importMode) {
      const allowed = prepAllowedValues(this.attr.allowedvalues);
      for (const v of value)
        if (!isAllowed(allowed, v))
          throw new Error(`Invalid value ${JSON.stringify(v)} for enum attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    }
    if (Buffer.byteLength(value.join("\t")) > 4096)
      throw new Error(`EnumArray value too long for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: Array<GetEnumArrayAllowedValues<Options>>): EncodedValue {
    return value.length ? {
      settings: { rawdata: value.toSorted().join("\t"), attribute: this.attr.id }
    } : {};
  }
}

/* Statusrecords are deprecated and TS support is allowed to be minimal. At most we may want to support WRD Syncing these
   fields for some compatibility with newsletter-using modules. No need to validate them any further */
type GetStatusRecordValues<Options extends { allowedValues: string; type: object }, Required extends boolean> = (Options extends { allowedValues: infer V; type: infer T extends object } ? { status: V } & T : never) | (Required extends true ? never : null);

class WRDDBStatusRecordValue<Options extends { allowedValues: string; type: object }, Required extends boolean> extends WRDAttributeValueBase<
  never,
  GetStatusRecordValues<Options, Required> | null,
  GetStatusRecordValues<Options, Required>,
  GetStatusRecordValues<Options, Required>,
  WRDDBEnumConditions<Options, Required>> {
  getDefaultValue(): GetStatusRecordValues<Options, Required> | null { return null; }
  isSet(value: object | null) { return Boolean(value); }
  checkFilter({ condition, value }: WRDDBEnumConditions<Options, Required>) {
  }
  matchesValue(value: { status: string } | null, cv: WRDDBEnumConditions<Options, Required>): boolean {
    if (cv.condition === "=" || cv.condition === "!=")
      return cmp(value?.status || "", cv.condition, cv.value || "");

    throw new Error(`Unsupported condition type '${cv.condition}' for statusrecords in TS`);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): GetStatusRecordValues<Options, Required> {
    const rawdata = entity_settings[settings_start].rawdata;
    const tabPos = rawdata.indexOf("\t");
    if (tabPos < 0)
      return null as GetStatusRecordValues<Options, Required>;

    const status = rawdata.substring(0, tabPos);
    if (rawdata.length > tabPos + 1)
      return { status, ...(decodeHSON(rawdata.substring(tabPos + 1)) as object) } as GetStatusRecordValues<Options, Required>;
    const buf = entity_settings[settings_start].blobdata?.__getAsSyncUInt8Array();
    const bufData = buf ? decodeHSON(Buffer.from(buf).toString()) as object : {};
    return { status, ...bufData } as GetStatusRecordValues<Options, Required>;
  }

  validateInput(value: GetStatusRecordValues<Options, Required>, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && !value?.status.length && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: GetStatusRecordValues<Options, Required> | null): EncodedValue | AwaitableEncodedValue {
    if (!value)
      return {};

    const restData = encodeHSON(omit(value as { status: string }, ["status"]));
    const rawdata = value.status + "\t" + restData;
    if (Buffer.byteLength(rawdata) > 4096) {
      return { settings: { rawdata: rawdata, attribute: this.attr.id } };
    } else {
      return {
        settings: (async (): Promise<EncodedSetting[]> => {
          const blobdata = WebHareBlob.from(restData);
          await uploadBlob(blobdata);
          return [{ rawdata: value.status + "\t", blobdata, attribute: this.attr.id }];
        })()
      };
    }
  }
}

//////////////////////////////////////
//
// DATE and DATETIME support

// DATE and DATETIME shared
type WRDDBDateTimeConditions = {
  condition: "=" | "!="; value: Date | null;
} | {
  condition: ">=" | "<=" | "<" | ">"; value: Date;
} | {
  condition: "in"; value: ReadonlyArray<Date | null>;
};

abstract class WRDDBDateValueBase<Required extends boolean> extends WRDAttributeValueBase<
  Date | string | NullIfNotRequired<Required>,
  Date | null,
  Date | NullIfNotRequired<Required>,
  string | NullIfNotRequired<Required>,
  WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
  isSet(value: Date | null) { return Boolean(value); }
}

// Plain DATEs: type Date, field wrdDateOfBirth, wrdDateOfDeath

abstract class WRDDBPlainDateValueBase<Required extends boolean> extends WRDDBDateValueBase<Required> {
  matchesValue(value: Date | null, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      for (const v of cv.value)
        if (v?.getTime() === value?.getTime())
          return true;
      return false;
    }
    return cmp(value, cv.condition, cv.value);
  }

  exportValue(value: Date | NullIfNotRequired<Required>): string | NullIfNotRequired<Required> {
    if (value === null)
      return null as unknown as string; //pretend it's all right, we shouldn't receive a null anyway if Required was set

    return value.toISOString().substring(0, 10); //only return the Date part "2004-01-01"
  }

  importValue(value: string | Date | NullIfNotRequired<Required>): Date | NullIfNotRequired<Required> {
    if (typeof value === "string") {
      try {
        return new Date(Temporal.PlainDate.from(value).toZonedDateTime("UTC").epochMilliseconds); //Temporal parser actually limits itselfs to dates
      } catch (e) {
        throw new Error(`Invalid value ${JSON.stringify(value)} for date attribute ${this.attr.fullTag}`);
      }
    }
    return value;
  }
}

class WRDDBDateValue<Required extends boolean> extends WRDDBPlainDateValueBase<Required> {
  checkFilter({ condition, value }: WRDDBDateTimeConditions) {
    /* always ok */
  }
  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Date | NullIfNotRequired<Required> {
    const parts = entity_settings[settings_start].rawdata.split(",");
    if (Number(parts[0]) >= 2147483647)
      return null as Date | NullIfNotRequired<Required>; // invalid date, return null
    return makeDateFromParts(Number(parts[0]), 0);
  }

  validateInput(value: Date | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string) {
    if (value !== null && (!isDate(value) || isNaN(value.getTime())))
      throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs))
      throw new Error(`Not allowed use defaultDateTime of maxDateTime for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: Date | NullIfNotRequired<Required>): EncodedValue {
    if (!value)
      return {};

    const parts = dateToParts(value);
    return { settings: { rawdata: parts.days.toString(), attribute: this.attr.id } };
  }
}

class WRDDBBaseDateValue extends WRDDBPlainDateValueBase<false> {
  validateFilterInput(value: Date | null) {
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime, use null`);
  }
  checkFilter(cv: WRDDBDateTimeConditions) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.validateFilterInput(v));
    else
      this.validateFilterInput(cv.value);
  }
  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    let fieldname: "dateofbirth" | "dateofdeath";
    if (this.attr.tag === "wrdDateOfBirth")
      fieldname = "dateofbirth";
    else if (this.attr.tag === "wrdDateOfDeath")
      fieldname = "dateofdeath";
    else
      throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);

    if (cv.condition === "in")
      cv.value = cv.value.map(v => v ?? defaultDateTime);
    else
      cv.value ??= defaultDateTime;

    if (cv.condition === "in" && !cv.value.length)
      return null; // no results!

    query = query.where(fieldname, cv.condition, cv.value);
    return { needaftercheck: false, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Date | null {
    throw new Error(`not used`);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): Date | null {
    let val: Date | undefined;
    if (this.attr.tag === "wrdDateOfBirth")
      val = entityrec.dateofbirth;
    else if (this.attr.tag === "wrdDateOfDeath")
      val = entityrec.dateofdeath;
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);
    if (!val || val.getTime() <= defaultDateTime.getTime() || val.getTime() >= maxDateTimeTotalMsecs)
      return null;
    return val;
  }

  validateInput(value: Date | null, checker: ValueQueryChecker, attrPath: string) {
    if (value !== null && (!isDate(value) || isNaN(value.getTime())))
      throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime, use null for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value && this.attr.tag === "wrdDateOfDeath" && value.getTime() > Date.now() && !checker.importMode)
      throw new Error(`Provided date of death in the future for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdDateOfBirth", "wrdDateOfDeath"]);
  }

  encodeValue(value: Date | null): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value || defaultDateTime } };
  }
}

// DATETIMEs: type DateTime, field wrdCreationDate, wrdLimitDate, wrdModificationDate

abstract class WRDDBDateTimeValueBase<Required extends boolean> extends WRDDBDateValueBase<Required> {
  exportValue(value: Date | NullIfNotRequired<Required>): string | NullIfNotRequired<Required> {
    if (value === null)
      return null as unknown as string; //pretend it's all right, we shouldn't receive a null anyway if Required was set

    let retval = value.toISOString();
    if (value.getMilliseconds() === 0)  // remove milliseconds if they are 0
      retval = retval.substring(0, 19) + "Z";

    return retval;
  }

  importValue(value: string | Date | NullIfNotRequired<Required>): Date | NullIfNotRequired<Required> {
    if (typeof value === "string") {
      try {
        return new Date(Temporal.Instant.from(value).epochMilliseconds); //Temporal parser is much stricter (and thus safer) than new Date
      } catch (e) {
        throw new Error(`Invalid value ${JSON.stringify(value)} for datetime attribute ${this.attr.fullTag}`);
      }
    }
    return value;
  }
}


class WRDDBDateTimeValue<Required extends boolean> extends WRDDBDateTimeValueBase<Required> {
  checkFilter({ condition, value }: WRDDBDateTimeConditions) {
    /* always ok */
  }
  matchesValue(value: Date | null, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      for (const v of cv.value)
        if (v?.getTime() === value?.getTime())
          return true;
      return false;
    }
    return cmp(value, cv.condition, cv.value);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Date | NullIfNotRequired<Required> {
    const parts = entity_settings[settings_start].rawdata.split(",");
    if (Number(parts[0]) >= 2147483647)
      return null as Date | NullIfNotRequired<Required>;
    return makeDateFromParts(Number(parts[0]), Number(parts[1]));
  }

  validateInput(value: Date | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string) {
    if (value !== null && (!isDate(value) || isNaN(value.getTime())))
      throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (this.attr.required && !value && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: Date | NullIfNotRequired<Required>): EncodedValue {
    if (!value)
      return {};

    const parts = dateToParts(value);
    return { settings: { rawdata: `${parts.days.toString()},${parts.msecs.toString()}`, attribute: this.attr.id } };
  }
}

type ArraySelectable<Members extends Record<string, SimpleWRDAttributeType | WRDAttrBase>, Export extends boolean> = {
  [K in keyof Members]: GetResultType<Members[K], Export>;
};

class WRDDBBaseCreationLimitDateValue extends WRDDBDateTimeValueBase<false> {
  validateFilterInput(value: Date | null) {
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime`);
  }

  checkFilter(cv: WRDDBDateTimeConditions) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.validateFilterInput(v));
    else
      this.validateFilterInput(cv.value);
  }
  matchesValue(value: Date | null, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    const defaultMatches = this.matchesValue(this.getDefaultValue(), cv);

    let fieldname: "creationdate" | "limitdate";
    if (this.attr.tag === "wrdCreationDate")
      fieldname = "creationdate";
    else if (this.attr.tag === "wrdLimitDate")
      fieldname = "limitdate";
    else
      throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);

    if (cv.condition === "in")
      cv.value = cv.value.map(v => v ?? defaultDateTime);
    else
      cv.value ??= defaultDateTime;

    if (cv.condition === "in" && !cv.value.length)
      return null; // no results!

    const maxDateTimeMatches = this.matchesValue(maxDateTime, cv);
    if (defaultMatches && !maxDateTimeMatches) {
      query = query.where(qb => qb.or([
        qb(fieldname, cv.condition, cv.value),
        qb(fieldname, "=", maxDateTime)
      ]));
    } else {
      query = query.where(fieldname, cv.condition, cv.value);
      if (maxDateTimeMatches && !defaultMatches)
        query = query.where(fieldname, "!=", maxDateTime);
    }
    return { needaftercheck: false, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Date | null {
    throw new Error(`not used`);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): Date | null {
    let val: Date | number | undefined;
    if (this.attr.tag === "wrdCreationDate")
      val = entityrec.creationdate as Date | number;
    else if (this.attr.tag === "wrdLimitDate")
      val = entityrec.limitdate as Date | number;
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);
    if (typeof val === "number") // -Infinity and Infinity
      return null;
    if (!val || val.getTime() <= defaultDateTime.getTime() || val.getTime() >= maxDateTimeTotalMsecs)
      return null;
    return val;
  }

  validateInput(value: Date | null, checker: ValueQueryChecker, attrPath: string) {
    if (value !== null && (!isDate(value) || isNaN(value.getTime())))
      throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    // FIXME: check temp mode
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}, use null`);
    if (!value && this.attr.tag === "wrdCreationDate" && !checker.temp && !checker.importMode)
      throw new Error(`Not allowed to use \`null\` for attribute ${checker.typeTag}.${attrPath}${this.attr.tag} for non-temp entities`);
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdCreationDate", "wrdLimitDate"]);
  }

  encodeValue(value: Date | null): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value ?? maxDateTime } };
  }
}

class WRDDBBaseModificationDateValue extends WRDDBDateTimeValueBase<true> {
  validateFilterInput(value: Date) {
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime`);
  }

  checkFilter(cv: WRDDBDateTimeConditions) {
    if (cv.condition === "in") {
      for (const value of cv.value)
        if (!value)
          throw new Error(`Not allowed to use null in comparisions`);
        else
          this.validateFilterInput(value);
    } else if (!cv.value)
      throw new Error(`Not allowed to use null in comparisions`);
    else
      this.validateFilterInput(cv.value);
  }
  matchesValue(value: Date, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    if (cv.condition === "in")
      cv.value = cv.value.map(v => v ?? defaultDateTime);
    else
      cv.value ??= defaultDateTime;

    if (cv.condition === "in" && !cv.value.length)
      return null; // no results!

    query = query.where("modificationdate", cv.condition, cv.value);
    return { needaftercheck: false, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Date {
    throw new Error(`not used`);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): Date {
    if (!entityrec.modificationdate || entityrec.modificationdate.getTime() <= defaultDateTime.getTime() || entityrec.modificationdate.getTime() >= maxDateTimeTotalMsecs)
      return defaultDateTime;
    return entityrec.modificationdate;
  }

  validateInput(value: Date, checker: ValueQueryChecker, attrPath: string) {
    if (value !== null && (!isDate(value) || isNaN(value.getTime())))
      throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (!value)
      throw new Error(`Not allowed to use null for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs)
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdModificationDate"]);
  }

  encodeValue(value: Date | null): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value } };
  }
}

class WRDDBArrayValue<Members extends Record<string, SimpleWRDAttributeType | WRDAttrBase>> extends WRDAttributeValueBase<
  Array<WRDInsertable<Members>>,
  Array<ArraySelectable<Members, false>>,
  Array<ArraySelectable<Members, false>>,
  Array<WRDInsertable<Members>>,
  never> {
  fields = new Array<{ name: keyof Members; accessor: AnyWRDAccessor }>;

  constructor(type: AnyWRDType, attr: AttrRec, parentAttrMap: Map<number | null, AttrRec[]>) {
    super(type, attr);

    const childAttrs = parentAttrMap.get(attr.id);
    if (childAttrs) {
      for (const childAttr of childAttrs) {
        this.fields.push({
          name: childAttr.tag,
          accessor: getAccessor(type, childAttr, parentAttrMap)
        });
      }
    }
  }

  getDefaultValue(): Array<ArraySelectable<Members, false>> { return []; }

  isSet(value: unknown[]) { return Boolean(value?.length); }

  checkFilter({ condition, value }: never) {
    throw new Error(`Filters not allowed on arrays`);
  }

  matchesValue(value: Array<ArraySelectable<Members, false>>, cv: never): boolean {
    throw new Error(`Filters not allowed on arrays`);
  }

  /** Try to add wheres to the database query on wrd.entities to filter out non-matches for this filter
   * @typeParam O - Output map for the database query
   * @param query - Database query
   * @param cv - Condition and value to compare with
   * @returns Whether after-filtering is necessary and updated query
   */
  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: never): AddToQueryResponse<O> {
    throw new Error(`Filters not allowed on arrays`);
  }

  /** Returns true all the values in a filter match the default value
   * @param cv - Condition+value to check
   * @returns true if all values match the default value
   */
  containsOnlyDefaultValues<CE extends never>(cv: CE): boolean {
    throw new Error(`Filters not allowed on arrays`);
  }

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, is always greater than settings_start
   */
  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[]): Array<ArraySelectable<Members, false>> {
    throw new Error(`Not implemented yet`);
  }

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, may be the same as settings_start)
   * @returns The parsed value. The return type of this function is used to determine the selection output type for a attribute.
   */
  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, row: EntityPartialRec, links: EntitySettingsWHFSLinkRec[], cc: number): Array<ArraySelectable<Members, false>> | Promise<Array<ArraySelectable<Members, false>>> {
    type RowType = ArraySelectable<Members, false>;

    if (settings_limit <= settings_start)
      return this.getDefaultValue() as RowType[]; // Cast is needed because for required fields, Out may not extend Default.

    const retval: RowType[] = [];
    const promises: Array<{ //We try to return promises only if really needed. Track which ones we want to resolve..
      row: RowType;
      member: keyof Members;
    }> = [];

    for (let idx = settings_start; idx < settings_limit; ++idx) {
      const settingid = entity_settings[idx].id;
      const rec = {} as ArraySelectable<Members, false> & { [wrdSettingId]: number };
      for (const field of this.fields) {
        const lb = recordLowerBound(entity_settings, { attribute: field.accessor.attr.id, parentsetting: settingid }, ["attribute", "parentsetting"]);
        const ub = recordUpperBound(entity_settings, { attribute: field.accessor.attr.id, parentsetting: settingid }, ["attribute", "parentsetting"]);
        rec[field.name] = field.accessor.getValue(entity_settings, lb.position, ub, row, links, cc);

        if (isPromise(rec[field.name])) {
          promises.push({ row: rec, member: field.name });
        }
      }
      rec[wrdSettingId] = settingid;
      retval.push(rec);
    }

    if (!promises.length)
      return retval;

    return (async function () {
      const results = await Promise.all(promises.map(rec => rec.row[rec.member]));
      for (const [idx, promise] of promises.entries()) {
        promise.row[promise.member] = results[idx];
      }
      return retval;
    })();
  }

  /** Check the contents of a value used to insert or update a value
   * @param value - The value to check. The type of this value is used to determine which type is accepted in an insert or update.
   */
  validateInput(value: Array<WRDInsertable<Members>>, checker: ValueQueryChecker, attrPath: string) {
    const eltBasePath = attrPath + this.attr.tag + "[";
    for (const [idx, row] of value.entries()) {
      const eltPath = eltBasePath + idx + '].';
      for (const field of this.fields) {
        if (field.name in row)
          field.accessor.validateInput(row[field.name as keyof typeof row], checker, eltPath);
        else if (field.accessor.attr.required && !checker.importMode)
          throw new Error(`Missing required field ${JSON.stringify(field.name)} for attribute ${checker.typeTag}.${eltBasePath}${field.name as string}`);
      }
    }
  }

  getAttrIds(): number | number[] {
    const retval = [this.attr.id];
    for (const field of this.fields) {
      const childIds = field.accessor.getAttrIds();
      if (typeof childIds === "number")
        retval.push(childIds);
      else
        retval.push(...childIds);
    }
    return retval;
  }

  encodeValue(value: Array<WRDInsertable<Members> & { [wrdSettingId]?: number }>): AwaitableEncodedValue {
    return {
      settings: value.map((row, idx): AwaitableEncodedSetting => {
        // if a setting id is present in an element (stored with wrdSettingId symbol), include it for re-use
        const retval: EncodedSetting = { attribute: this.attr.id, ordering: idx + 1, id: row[wrdSettingId] };
        const subs: NonNullable<AwaitableEncodedSetting["sub"]> = [];
        for (const field of this.fields) {
          if (field.name in row) {
            const subSettings = field.accessor.encodeValue(row[field.name as keyof typeof row]);
            if (subSettings.settings)
              if (Array.isArray(subSettings.settings))
                subs.push(...subSettings.settings);
              else
                subs.push(subSettings.settings);
          }
        }
        return { ...retval, sub: subs };
      })
    };
  }

  //adding wrdSettingId to the signatures has annoying ripple effects in the typings required to set/get so removed that, but we still preserve them
  async exportValue(value: Array<ArraySelectable<Members, false>>, exportOptions?: ExportOptions): Promise<Array<WRDInsertable<Members>>> {
    return Promise.all((value as Array<WRDInsertable<Members> & { [wrdSettingId]?: number }>).map(async (row) => {
      const outrow: WRDInsertable<Members> = { [wrdSettingId]: row[wrdSettingId] } as unknown as WRDInsertable<Members>;
      for (const field of this.fields) {
        if (field.name in row) {
          let val = row[field.name as keyof typeof row];
          val = await field.accessor.exportValue(val, exportOptions);
          outrow[field.name as keyof typeof outrow] = val as typeof outrow[keyof typeof outrow];
        }
      }
      return outrow;
    })) as unknown as Array<WRDInsertable<Members>>;
  }

  async importValue(value: Array<WRDInsertable<Members>>): Promise<Array<WRDInsertable<Members>>> {
    const out: Array<WRDInsertable<Members>> = [];
    for (const row of value as Array<WRDInsertable<Members> & { [wrdSettingId]?: number }>) {
      const outrow: WRDInsertable<Members> = { [wrdSettingId]: row[wrdSettingId] } as unknown as WRDInsertable<Members>;
      for (const field of this.fields) {
        if (field.name in row) {
          let val = row[field.name as keyof typeof row];
          val = await field.accessor.importValue(val);
          outrow[field.name as keyof typeof outrow] = val as typeof outrow[keyof typeof outrow];
        }
      }
      out.push(outrow);
    }
    return out;
  }
}

export abstract class WRDAttributeUncomparableValueBase<In, Default, Out extends Default, Export> extends WRDAttributeValueBase<In, Default, Out, Export, never> {
  checkFilter(cv: never): void {
    throw new Error(`Cannot compare values of type ${WRDAttributeTypeId[this.attr.attributetype]}`);
  }

  matchesValue(value: unknown, cv: never): boolean {
    throw new Error(`Cannot compare values of type  ${WRDAttributeTypeId[this.attr.attributetype]}`);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv_org: never): AddToQueryResponse<O> {
    throw new Error(`Cannot compare values of type  ${WRDAttributeTypeId[this.attr.attributetype]}`);
  }

  containsOnlyDefaultValues(cv: never): boolean {
    throw new Error(`Cannot compare values of type  ${WRDAttributeTypeId[this.attr.attributetype]}`);
  }
}

class WRDDBJSONValue<Required extends boolean, JSONType extends object> extends WRDAttributeUncomparableValueBase<
  JSONType | NullIfNotRequired<Required>,
  JSONType | null,
  JSONType | NullIfNotRequired<Required>,
  JSONType | NullIfNotRequired<Required>
> {
  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): JSONType | null {
    return null;
  }

  isSet(value: object | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): JSONType | NullIfNotRequired<Required> {
    const data = this.decodeAsStringWithOverlow(entity_settings, settings_start, settings_limit);
    return data ? parseTyped(data) : null as JSONType | NullIfNotRequired<Required>;
  }

  validateInput(value: JSONType | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string): void {
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: JSONType | NullIfNotRequired<Required>): AwaitableEncodedValue {
    return this.encodeAsStringWithOverlow(value ? stringify(value, { typed: true }) : '');
  }
}

class WRDDBRecordValue extends WRDAttributeUncomparableValueBase<object | null, IPCMarshallableRecord | null, IPCMarshallableRecord | null, IPCMarshallableRecord | null> {
  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): IPCMarshallableRecord | null {
    return null;
  }

  isSet(value: object | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): IPCMarshallableRecord | null {
    const data = this.decodeAsStringWithOverlow(entity_settings, settings_start, settings_limit);
    return data ? decodeHSON(data) as IPCMarshallableRecord : null;
  }

  validateInput(value: object | null, checker: ValueQueryChecker, attrPath: string): void {
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: object | null): AwaitableEncodedValue {
    return this.encodeAsStringWithOverlow(value ? encodeHSON(value as IPCMarshallableData) : '');
  }
}

class WRDDBPaymentProviderValue extends WRDAttributeUncomparableValueBase<object | null, PaymentProviderValue | null, PaymentProviderValue | null, PaymentProviderValue | null> {
  getDefaultValue(): PaymentProviderValue | null {
    return null;
  }

  isSet(value: object | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): PaymentProviderValue | null {
    const data = this.decodeAsStringWithOverlow(entity_settings, settings_start, settings_limit);
    return data ? makePaymentProviderValueFromEntitySetting(decodeHSON(data) as object) : null;
  }

  validateInput(value: object | null, checker: ValueQueryChecker, attrPath: string): void {
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: PaymentProviderValue | null): AwaitableEncodedValue {
    throw new Error(`No write support yet for PaymentProviderValue`);
    // return this.encodeAsStringWithOverlow(value ? encodeHSON(value as IPCMarshallableData) : '');
  }
}

class WRDDBPaymentValue extends WRDAttributeUncomparableValueBase<object | null, PaymentValue | null, PaymentValue | null, PaymentValue | null> {
  getDefaultValue(): PaymentValue | null {
    return null;
  }

  isSet(value: object | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): PaymentValue | null {
    const rows = Array<{ ordering: number; data: unknown }>();
    for (let idx = settings_start; idx < settings_limit; idx++) {
      const data = this.decodeAsStringWithOverlow(entity_settings, idx, idx + 1);
      rows.push({ ordering: entity_settings[idx].ordering, data: decodeHSON(data) });
    }
    rows.sort((a, b) => a.ordering - b.ordering);
    return rows.length ? makePaymentValueFromEntitySetting(rows.map(r => r.data as object)) : null;
  }

  validateInput(value: object | null, checker: ValueQueryChecker, attrPath: string): void {
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: PaymentValue | null): AwaitableEncodedValue {
    throw new Error(`No write support yet for PaymentValue`);
    // return this.encodeAsStringWithOverlow(value ? encodeHSON(value as IPCMarshallableData) : '');
  }
}

class WHDBResourceAttributeBase<Required extends boolean> extends WRDAttributeUncomparableValueBase<
  ResourceDescriptor | NullIfNotRequired<Required>,
  ResourceDescriptor | null,
  ResourceDescriptor | NullIfNotRequired<Required>,
  ExportedResource | NullIfNotRequired<Required>
> {
  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): ResourceDescriptor | null {
    return null;
  }

  isSet(value: ResourceDescriptor | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[], cc: number): ResourceDescriptor | NullIfNotRequired<Required> {
    return decodeResourceDescriptor(entity_settings[settings_start], links, cc);
  }

  validateInput(value: ResourceDescriptor | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string): void {
    if (value && "data" in value && value.data instanceof Buffer)
      throw new Error(`Invalid value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}, use ResourceDescriptor instead of Buffer`);
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: ResourceDescriptor | null): AwaitableEncodedValue {
    if (!value)
      return {};

    return {
      settings: (async (): Promise<EncodedSetting[]> => {
        return [{ ...await encodeResourceDescriptor(this.attr.id, value) }];
      })()
    };
  }

  importValue(value: ResourceDescriptor | NullIfNotRequired<Required> | ExportedResource): Promise<ResourceDescriptor | NullIfNotRequired<Required>> | ResourceDescriptor | NullIfNotRequired<Required> {
    if (value && "data" in value && value.data instanceof Buffer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we're letting validateInput complain about this as it has more metadata. somewhere after WH5.8 if noone has hit it that check and this can perhaps go away
      return value as any;

    if (value && "data" in value) { //looks like an ExportedResource?
      return ResourceDescriptor.import(value);
    }
    return value;
  }

  /** Convert the returned value to its exportable version
   */
  async exportValue(value: ResourceDescriptor | NullIfNotRequired<Required>, exportOptions?: ExportOptions): Promise<ExportedResource | NullIfNotRequired<Required>> {
    return value?.export(exportOptions) ?? null as unknown as ExportedResource;
  }
}

class WRDDBFileValue<Required extends boolean> extends WHDBResourceAttributeBase<Required> { }

class WRDDBImageValue<Required extends boolean> extends WHDBResourceAttributeBase<Required> { }

class WRDDBRichDocumentValue extends WRDAttributeUncomparableValueBase<RichTextDocument | null, RichTextDocument | null, RichTextDocument | null, RTDExport | null> {
  getDefaultValue(): RichTextDocument | null {
    return null;
  }

  isSet(value: RichTextDocument | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[], cc: number): null | Promise<RichTextDocument | null> {
    const val = entity_settings[settings_start];
    if (!val.blobdata) {
      const matchlink = links.find(_ => _.id === val.id);
      return matchlink ? getRTDFromWHFS(matchlink.fsobject) : null;
    }

    const embedded = new Map<string, ResourceDescriptor>();
    for (const item of entity_settings.slice(settings_start + 1, settings_limit)) {
      if (item.ordering === 1) { //it's an embedded image
        const descr = decodeResourceDescriptor(item, links, cc);
        if (descr.fileName)
          embedded.set(descr.fileName, descr);
      }
    }

    return buildRTDFromComposedDocument({ text: val.blobdata, embedded, type: "platform:richtextdocument", links: new Map(), instances: new Map() });
  }

  validateInput(value: RichTextDocument | null, checker: ValueQueryChecker, attrPath: string): void {
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: RichTextDocument | null): AwaitableEncodedValue {
    if (!value || !value?.blocks.length)
      return {};

    return {
      settings: (async (): Promise<EncodedSetting[]> => {
        //FIXME: Encode links and instances (which are currently not yet supported by RichDocument anyway)
        //FIXME Reuse existing documents/settings

        const asComposed = await exportRTDAsComposedDocument(value);

        //do we need to use WHFS to store this document ?
        const inWHFS = asComposed.links.size > 0 || asComposed.instances.size > 0; //TODO what about embedded images ? can they have a source object which requires preservation?
        if (inWHFS) {
          //TODO Can storeRTDinWHFS reuse the asComposed value?
          const whfsId = await storeRTDinWHFS(this.attr.schemaId, value);
          const setting: EncodedSetting = { rawdata: "WHFS", blobdata: null, attribute: this.attr.id, linktype: LinkTypes.RTD, link: whfsId };
          return [setting];
        }

        //Generate direct settings.
        const rawdata = await addMissingScanData(await ResourceDescriptor.from(asComposed.text, { fileName: "rd1.html", getHash: true, mediaType: "text/html" }));
        await uploadBlob(asComposed.text);
        const settings: EncodedSetting[] = [{ rawdata, blobdata: asComposed.text, attribute: this.attr.id }];

        for (const [contentid, image] of asComposed.embedded.entries()) {
          settings.push({
            ...await encodeResourceDescriptor(this.attr.id, image, contentid),
            ordering: 1
          });
        }
        return settings;
      })()
    };
  }

  importValue(value: RTDSource | RichTextDocument | null): Promise<RichTextDocument | null> | RichTextDocument | null {
    if (Array.isArray(value)) { //TODO can we do a more reliable 'is an Buildable RTD' check ?
      return buildRTD(value);
    }
    return value;
  }

  exportValue(value: RichTextDocument | null): Promise<RTDExport> | null {
    return value?.blocks.length ? value.export() : null;
  }
}

class WRDDBInstanceValue extends WRDAttributeUncomparableValueBase<Instance | InstanceSource | null, Instance | null, Instance | null, InstanceExport | null> {
  getDefaultValue(): Instance | null {
    return null;
  }

  isSet(value: Instance | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, _settings_limit: number, links: EntitySettingsWHFSLinkRec[], _cc: number): Promise<Instance | null> | null {
    //based on RetrieveInstanceInWHFS(INTEGER64 wrd_settingid, OBJECT whfsmapper)
    const matchobj = links.find(_ => _.id === entity_settings[settings_start].id);
    if (!matchobj?.fsobject)
      throw new Error(`Unable to find WHFS instance for setting ${entity_settings[settings_start].id}`);

    return getInstanceFromWHFS(matchobj?.fsobject);
  }

  validateInput(value: Instance | InstanceSource | null, checker: ValueQueryChecker, attrPath: string): void {
    if (value && !value?.whfsType)
      throw new Error(`Invalid WHFS instance value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag} - missing whfsType`);
  }

  encodeValue(value: Instance | InstanceSource | null): AwaitableEncodedValue {
    if (!value)
      return {};

    //INSERT [ setting := 0, rawdata := "WHFS", blobdata := DEFAULT BLOB, whfsdata := val/*StoreInstanceInWHFS(this->wrdschema->id, val, whfsmapper)*/, linktype := 1 ] INTO newsets AT END;
    //FIXME reuse existing object ids, but it looks like the HS implemtentation and storeRTDinWHFS can't do that either ?x
    return {
      settings: storeInstanceInWHFS(this.attr.schemaId, value).then(whfsId => {
        return [{ rawdata: "WHFS", linktype: 1, link: whfsId, attribute: this.attr.id }];
      })
    };
  }

  importValue(value: Instance | InstanceSource | null): MaybePromise<Instance | null> {
    if (value && !isInstance(value)) { //looks like InstanceSource?
      return buildInstance(value);
    }

    return value;
  }

  async exportValue(value: Instance | null, exportOptions?: ExportOptions): Promise<InstanceExport | null> {
    return await value?.export() ?? null;
  }
}

class WRDDBWHFSIntextlinkValue extends WRDAttributeUncomparableValueBase<IntExtLink | null, IntExtLink | null, IntExtLink | null, IntExtLink | null> {
  getDefaultValue(): IntExtLink | null {
    return null;
  }

  isSet(value: IntExtLink | null) { return Boolean(value); }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, _settings_limit: number, links: EntitySettingsWHFSLinkRec[], _cc: number): IntExtLink | null {
    const setting = entity_settings[settings_start];
    if (!setting.rawdata)
      return null;

    let result: IntExtLink | null = null;
    if (setting.rawdata.startsWith("*")) // external link
      result = new IntExtLink(setting.rawdata.substring(1));
    else if (setting.rawdata === "WHFS" || setting.rawdata.startsWith("WHFS:")) {
      const target = links.filter(_ => _.id === setting.id)[0]?.fsobject;
      if (target)
        result = new IntExtLink(target, { append: setting.rawdata.substring(5) });
    } else
      throw new Error("Unrecognized whfs int/extlink format");
    return result;
  }

  validateInput(value: IntExtLink | null, checker: ValueQueryChecker, attrPath: string) {
    if (!value && this.attr.required && !checker.importMode && (!checker.temp || attrPath))
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: IntExtLink | null) {
    if (!value)
      return {};

    if (value.internalLink) {
      return { settings: { rawdata: "WHFS" + (value.append ? ":" + value.append : ""), attribute: this.attr.id, link: value.internalLink, linktype: LinkTypes.FSObject } };
    } else if (value.externalLink) {
      return { settings: { rawdata: "*" + value.externalLink, attribute: this.attr.id } };
    }
    throw new Error("Invalid whfs int/extlink");
  }
}

type WRDDBInteger64Conditions = {
  condition: "<" | "<=" | "=" | "!=" | ">=" | ">"; value: bigint | number;
} | {
  condition: "in"; value: readonly bigint[];
} | {
  condition: "mentions"; value: bigint | number;
} | {
  condition: "mentionsany"; value: readonly bigint[];
};
class WRDDBInteger64Value extends WRDAttributeValueBase<bigint | number | string, bigint, bigint, string, WRDDBInteger64Conditions> {
  getDefaultValue() { return 0n; }
  isSet(value: bigint) { return Boolean(value); }
  checkFilter({ condition, value }: WRDDBInteger64Conditions) {
    // type-check is enough (for now)
  }
  matchesValue(value: bigint, cv: WRDDBInteger64Conditions): boolean {
    if (cv.condition === "in" || cv.condition === "mentionsany")
      return cv.value.includes(value);
    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBInteger64Conditions): AddToQueryResponse<O> {
    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    else if (cv.condition === "mentionsany")
      cv = { condition: "in", value: cv.value };

    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);
    if (cv.condition === "in" && !cv.value.length)
      return null;

    if (cv.condition === "in") {
      query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
        const mainQuery = b(sql<bigint>`rawdata::NUMERIC(1000)`, cv.condition, cv.value);
        return addIndexedSelect(b, mainQuery, cv.condition, cv.value.map(v => String(v)));
      });
    } else {
      const value = typeof cv.value === "number" ? BigInt(cv.value) : cv.value;
      query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
        const mainQuery = b(sql<bigint>`rawdata::NUMERIC(1000)`, cv.condition, value);
        return addIndexedSelect(b, mainQuery, cv.condition, String(value));
      });
    }

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): bigint {
    return BigInt(entity_settings[settings_start].rawdata);
  }

  validateInput(value: bigint | number, checker: ValueQueryChecker, attrPath: string) {
    if (typeof value === "number")
      value = BigInt(value);
    if (this.attr.required && !value && !checker.importMode)
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    if (value >= 2n ** 63n)
      throw new Error(`Integer64 out of range for ${checker.typeTag}.${attrPath}${this.attr.tag}: ${value} > 2^63-1`);
    if (value < -(2n ** 63n))
      throw new Error(`Integer64 out of range for ${checker.typeTag}.${attrPath}${this.attr.tag}: ${value} < -2^63`);
    if (value && this.attr.isunique)
      checker.addUniqueCheck(this.attr.fullTag, value, attrPath + this.attr.tag);
  }

  encodeValue(value: bigint): EncodedValue {
    return value ? { settings: { rawdata: String(value), attribute: this.attr.id } } : {};
  }

  exportValue(value: bigint): string {
    return String(value);
  }
  importValue(value: string | bigint): bigint {
    if (typeof value === "string")
      value = BigInt(value);
    return value;
  }
}

type WRDDBMoneyConditions = {
  condition: "<" | "<=" | "=" | "!=" | ">=" | ">"; value: Money;
} | {
  condition: "in"; value: readonly Money[];
} | {
  condition: "mentions"; value: Money;
} | {
  condition: "mentionsany"; value: readonly Money[];
};

class WRDDBMoneyValue extends WRDAttributeValueBase<Money | string, Money, Money, string, WRDDBMoneyConditions> {
  getDefaultValue() { return new Money("0"); }
  isSet(value: Money) { return Money.cmp(value, "0") !== 0; }
  checkFilter({ condition, value }: WRDDBMoneyConditions) {
    // type-check is enough (for now)
  }
  matchesValue(value: Money, cv: WRDDBMoneyConditions): boolean {
    if (cv.condition === "in" || cv.condition === "mentionsany")
      return cv.value.some(v => Money.cmp(value, v) === 0);
    const cmpres = Money.cmp(value, cv.value);
    switch (cv.condition) {
      case "=": return cmpres === 0;
      case "mentions": return cmpres === 0;
      case ">=": return cmpres >= 0;
      case "<=": return cmpres <= 0;
      case "<": return cmpres < 0;
      case ">": return cmpres > 0;
      case "!=": return cmpres !== 0;
    }
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBMoneyConditions): AddToQueryResponse<O> {
    if (cv.condition === "mentions")
      cv = { condition: "=", value: cv.value };
    else if (cv.condition === "mentionsany")
      cv = { condition: "in", value: cv.value };

    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    if (cv.condition === "in") {
      if (!cv.value.length)
        return null;
    }

    query = addQueryFilter2(query, this.attr.id, defaultmatches, b => {
      const mainQuery = b(sql<Money>`rawdata::NUMERIC(1000,5)`, cv.condition, cv.value);
      return addIndexedSelect(b, mainQuery, cv.condition, Array.isArray(cv.value) ? cv.value.map(v => v.toString()) : String(cv.value));
    });

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Money {
    return new Money(entity_settings[settings_start].rawdata);
  }

  validateInput(value: Money, checker: ValueQueryChecker, attrPath: string) {
    if (this.attr.required && (!value || !Money.cmp(value, "0")) && !checker.importMode)
      throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: Money): EncodedValue {
    return value ? { settings: { rawdata: String(value), attribute: this.attr.id } } : {};
  }

  exportValue(value: Money): string {
    return value.toString();
  }
  importValue(value: string | Money): Money {
    if (typeof value === "string")
      value = new Money(value);
    return value;
  }
}

class WRDDBPasswordValue extends WRDAttributeUncomparableValueBase<
  AuthenticationSettings | null,
  AuthenticationSettings | null,
  AuthenticationSettings | null,
  AuthenticationSettings | null> {
  getDefaultValue(): null {
    return null;
  }

  isSet(value: AuthenticationSettings | null): boolean {
    return Boolean(value);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): AuthenticationSettings | null {
    return AuthenticationSettings.fromPasswordHash(entity_settings[settings_start].rawdata);
  }

  validateInput(value: AuthenticationSettings | null): void {
    /* always valid */
  }

  encodeValue(value: AuthenticationSettings | null): AwaitableEncodedValue {
    // For now this may also save us from having to port the Password->AuthenticationSetting migration from HS to TS. Would be nice to leave that all behind in HS
    throw new Error(`Writing password values is not supported in the TypeScript API - the schema needs to switch to AuthenticationSettings`);
  }
}

class WRDDBAddressValue<Required extends boolean> extends WRDAttributeUncomparableValueBase<
  AddressValue | NullIfNotRequired<Required>,
  AddressValue | null,
  AddressValue | NullIfNotRequired<Required>,
  AddressValue | NullIfNotRequired<Required>> {
  getDefaultValue(): AddressValue | null {
    return null;
  }

  isSet(value: AddressValue | null): boolean {
    return Boolean(value);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[], cc: number): AddressValue | NullIfNotRequired<Required> {
    const data = this.decodeAsStringWithOverlow(entity_settings, settings_start, settings_limit);
    const parsed = JSON.parse(data) as AddressValue & { nr_detail: string };
    return { ...omit(parsed, ["nr_detail"]), houseNumber: parsed.nr_detail };
  }

  validateInput(value: AddressValue | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string): void {
    if (!value) {
      if (this.attr.required && !checker.importMode)
        throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      return;
    }
    if ("nr_detail" in value)
      throw new Error(`AddressValue should not contain nr_detail for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}, use houseNumber instead`);
    if ("housenumber" in value)
      throw new Error(`AddressValue should not contain housenumber for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}, use houseNumber instead (did you route the address value through HareScript?)`);
    if (value.country?.length !== 2)
      throw new Error(`The field 'country' is required in an address for attribute ${checker.typeTag}.${attrPath}${this.attr.tag} and must be a 2 character code`);
    if (value.country !== toCLocaleUppercase(value.country))
      throw new Error(`The field 'country' must be uppercase for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: AddressValue | NullIfNotRequired<Required>): AwaitableEncodedValue {
    return this.encodeAsStringWithOverlow(value ? JSON.stringify({ ...omit(value, ["houseNumber"]), nr_detail: value.houseNumber }) : '');
  }
}

class WRDDBAuthenticationSettingsValue extends WRDAttributeUncomparableValueBase<
  AuthenticationSettings | null,
  AuthenticationSettings | null,
  AuthenticationSettings | null,
  AuthenticationSettings | null
> {
  getDefaultValue(): null {
    return null;
  }

  isSet(value: AuthenticationSettings | null): boolean {
    return Boolean(value);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): AuthenticationSettings | null {
    const data = this.decodeAsStringWithOverlow(entity_settings, settings_start, settings_limit);
    return data.startsWith("hson:") ? AuthenticationSettings.fromHSON(data) : AuthenticationSettings.fromPasswordHash(data);
  }

  validateInput(value: AuthenticationSettings | null): void {
    /* always valid */
  }

  encodeValue(value: AuthenticationSettings | null): AwaitableEncodedValue {
    return this.encodeAsStringWithOverlow(value ? value.toHSON() : '');
  }
}

export class WRDAttributeUnImplementedValueBase<In, Default, Out extends Default, C extends { condition: AllowedFilterConditions; value: unknown } = { condition: AllowedFilterConditions; value: unknown }> extends WRDAttributeValueBase<In, Default, Out, Out, C> {
  throwError(): never {
    throw new Error(`Unimplemented accessor for type ${WRDAttributeTypeId[this.attr.attributetype] ?? WRDBaseAttributeTypeId[this.attr.attributetype]} (tag: ${JSON.stringify(this.attr.tag)})`);
  }

  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): Default {
    this.throwError();
  }

  isSet(value: Default): boolean {
    this.throwError();
  }

  checkFilter(cv: C): void {
    this.throwError();
  }

  matchesValue(value: unknown, cv: C): boolean {
    this.throwError();
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv_org: C): AddToQueryResponse<O> {
    this.throwError();
  }

  containsOnlyDefaultValues<CE extends C>(cv: CE): boolean {
    this.throwError();
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Out {
    this.throwError();
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, row: EntityPartialRec): Out {
    this.throwError();
  }

  validateInput(value: In): void {
    this.throwError();
  }

  encodeValue(value: In): EncodedValue {
    this.throwError();
  }
}

type GetEnumArrayAllowedValues<Options extends { allowedValues: string }> = Options extends { allowedValues: infer V } ? V : never;

/// The following accessors are not implemented yet
class WRDDBWHFSLinkValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }

/// Map for all attribute types that have no options
type SimpleTypeMap<Required extends boolean> = {
  [WRDBaseAttributeTypeId.Base_Integer]: WRDDBIntegerValue<true>;
  [WRDBaseAttributeTypeId.Base_Guid]: WRDDBBaseGuidValue;
  [WRDBaseAttributeTypeId.Base_Tag]: WRDDBBaseStringValue;
  [WRDBaseAttributeTypeId.Base_CreationLimitDate]: WRDDBBaseCreationLimitDateValue;
  [WRDBaseAttributeTypeId.Base_ModificationDate]: WRDDBBaseModificationDateValue;
  [WRDBaseAttributeTypeId.Base_Date]: WRDDBDateValue<false>;
  [WRDBaseAttributeTypeId.Base_GeneratedString]: WRDDBStringValue;
  [WRDBaseAttributeTypeId.Base_NameString]: WRDDBBaseStringValue;
  [WRDBaseAttributeTypeId.Base_Domain]: WRDDBBaseDomainValue<Required, string>;
  [WRDBaseAttributeTypeId.Base_Gender]: WRDDBBaseGenderValue;
  [WRDBaseAttributeTypeId.Base_FixedDomain]: WRDDBBaseDomainValue<true, number>;

  [WRDAttributeTypeId.String]: WRDDBStringValue;
  [WRDAttributeTypeId.Email]: WRDDBEmailValue;
  [WRDAttributeTypeId.Telephone]: WRDDBStringValue;
  [WRDAttributeTypeId.URL]: WRDDBUrlValue;
  [WRDAttributeTypeId.Boolean]: WRDDBBooleanValue;
  [WRDAttributeTypeId.Integer]: WRDDBIntegerValue;
  [WRDAttributeTypeId.Date]: WRDDBDateValue<Required>;
  [WRDAttributeTypeId.DateTime]: WRDDBDateTimeValue<Required>;
  [WRDAttributeTypeId.Domain]: WRDDBDomainValue<Required>;
  [WRDAttributeTypeId.DomainArray]: WRDDBDomainArrayValue;
  [WRDAttributeTypeId.Address]: WRDDBAddressValue<Required>;
  [WRDAttributeTypeId.Password]: WRDDBPasswordValue;
  [WRDAttributeTypeId.Image]: WRDDBImageValue<Required>;
  [WRDAttributeTypeId.File]: WRDDBFileValue<Required>;
  [WRDAttributeTypeId.Money]: WRDDBMoneyValue;
  [WRDAttributeTypeId.RichTextDocument]: WRDDBRichDocumentValue;
  [WRDAttributeTypeId.Integer64]: WRDDBInteger64Value;
  [WRDAttributeTypeId.Instance]: WRDDBInstanceValue;
  [WRDAttributeTypeId.IntExtLink]: WRDDBWHFSIntextlinkValue;
  [WRDAttributeTypeId.HSON]: WRDDBRecordValue;
  [WRDAttributeTypeId.PaymentProvider]: WRDDBPaymentProviderValue;
  [WRDAttributeTypeId.Payment]: WRDDBPaymentValue;
  [WRDAttributeTypeId.AuthenticationSettings]: WRDDBAuthenticationSettingsValue;
  [WRDAttributeTypeId.WHFSRef]: WRDDBWHFSLinkValue;
  [WRDAttributeTypeId.Time]: WRDDBIntegerValue;
};

/** Returns the accessor for a WRDAttr record
 * @typeParam T - WRDAttr type
 * @returns Accessor (extends WRDAttributeValueBase)
 */
export type AccessorType<T extends WRDAttrBase> = T["__attrtype"] extends keyof SimpleTypeMap<T["__required"]>
  ? SimpleTypeMap<T["__required"]>[T["__attrtype"]]
  : (T extends { __attrtype: WRDAttributeTypeId.Enum }
    ? WRDDBEnumValue<T["__options"], T["__required"]>
    : (T extends { __attrtype: WRDAttributeTypeId.EnumArray }
      ? WRDDBEnumArrayValue<T["__options"]>
      : (T extends { __attrtype: WRDAttributeTypeId.DeprecatedStatusRecord }
        ? WRDDBStatusRecordValue<T["__options"], T["__required"]>
        : (T extends { __attrtype: WRDAttributeTypeId.Array }
          ? WRDDBArrayValue<T["__options"]["members"]>
          : (T extends { __attrtype: WRDAttributeTypeId.JSON }
            ? WRDDBJSONValue<T["__required"], T["__options"]["type"]>
            : never)))));


export function getAccessor<T extends WRDAttrBase>(
  type: AnyWRDType,
  attrinfo: AttrRec & { attributetype: T["__attrtype"]; required: T["__required"] },
  parentAttrMap: Map<number | null, AttrRec[]>,
): AccessorType<T> {
  switch (attrinfo.attributetype) {
    case WRDBaseAttributeTypeId.Base_Integer: return new WRDDBBaseIntegerValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_Guid: return new WRDDBBaseGuidValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_Tag: return new WRDDBBaseStringValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_CreationLimitDate: return new WRDDBBaseCreationLimitDateValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_ModificationDate: return new WRDDBBaseModificationDateValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_Date: return new WRDDBBaseDateValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_GeneratedString: return new WRDDBBaseGeneratedStringValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_NameString: return new WRDDBBaseStringValue(type, attrinfo) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_Domain: return new WRDDBBaseDomainValue<T["__required"], string>(type, attrinfo, true) as AccessorType<T>;
    case WRDBaseAttributeTypeId.Base_Gender: return new WRDDBBaseGenderValue(type, attrinfo) as AccessorType<T>; // WRDDBBaseGenderValue
    case WRDBaseAttributeTypeId.Base_FixedDomain: return new WRDDBBaseDomainValue<true, number>(type, attrinfo, false) as AccessorType<T>;

    case WRDAttributeTypeId.String: return new WRDDBStringValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Email: return new WRDDBEmailValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Telephone: return new WRDDBStringValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.URL: return new WRDDBUrlValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Boolean: return new WRDDBBooleanValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Integer:
    case WRDAttributeTypeId.Time:
      return new WRDDBIntegerValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Date: return new WRDDBDateValue<T["__required"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.DateTime: return new WRDDBDateTimeValue<T["__required"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Domain: return new WRDDBDomainValue<T["__required"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.DomainArray: return new WRDDBDomainArrayValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Address: return new WRDDBAddressValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Password: return new WRDDBPasswordValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Image: return new WRDDBImageValue<T["__required"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.File: return new WRDDBFileValue<T["__required"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Money: return new WRDDBMoneyValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.RichTextDocument: return new WRDDBRichDocumentValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Integer64: return new WRDDBInteger64Value(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Instance: return new WRDDBInstanceValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.IntExtLink: return new WRDDBWHFSIntextlinkValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.HSON: return new WRDDBRecordValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.PaymentProvider: return new WRDDBPaymentProviderValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Payment: return new WRDDBPaymentValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.AuthenticationSettings: return new WRDDBAuthenticationSettingsValue(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.WHFSRef: return new WRDDBWHFSLinkValue(type, attrinfo) as AccessorType<T>;

    case WRDAttributeTypeId.Enum: return new WRDDBEnumValue<{ allowedValues: (T["__options"] & { allowedValues: string })["allowedValues"] }, T["__required"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.EnumArray: return new WRDDBEnumArrayValue<{ allowedValues: (T["__options"] & { allowedValues: string })["allowedValues"] }>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.Array: return new WRDDBArrayValue<(T["__options"] & { members: Record<string, SimpleWRDAttributeType | WRDAttrBase> })["members"]>(type, attrinfo, parentAttrMap) as AccessorType<T>;
    case WRDAttributeTypeId.JSON: return new WRDDBJSONValue<T["__required"], (T["__options"] & { type: object })["type"]>(type, attrinfo) as AccessorType<T>;
    case WRDAttributeTypeId.DeprecatedStatusRecord: return new WRDDBStatusRecordValue<T["__options"] & { allowedValues: string; type: object }, T["__required"]>(type, attrinfo) as AccessorType<T>;
  }
  throw new Error(`Unhandled attribute type ${(attrinfo.attributetype < 0 ? WRDBaseAttributeTypeId[attrinfo.attributetype] : WRDAttributeTypeId[attrinfo.attributetype]) ?? attrinfo.attributetype}`);
}
