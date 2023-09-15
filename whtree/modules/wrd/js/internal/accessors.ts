import { WRDBaseAttributeType, WRDAttributeType, AllowedFilterConditions, WRDAttrBase, WRDGender, Insertable, GetResultType, SimpleWRDAttributeType } from "./types";
import type { AttrRec, EntityPartialRec, EntitySettingsRec, EntitySettingsWHFSLinkRec } from "./db";
import { sql, SelectQueryBuilder, ExpressionBuilder, RawBuilder, ComparisonOperatorExpression, WhereInterface } from "kysely";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { compare, ComparableType, recordLowerBound, recordUpperBound } from "@webhare/hscompat/algorithms";
import { isLike } from "@webhare/hscompat/strings";
import { Money } from "@webhare/std";
import { decodeScanData, RichFileDescriptor } from "@webhare/services/src/richfile";
import { defaultDateTime, makeDateFromParts, maxDateTime, maxDateTimeTotalMsecs } from "@webhare/hscompat/datetime";
import { decodeHSON } from "@webhare/hscompat/hscompat";
import { IPCMarshallableRecord } from "@mod-system/js/internal/whmanager/hsmarshalling";


/** Response type for addToQuery. Null to signal the added condition is always false
 * @typeParam O - Kysely selection map for wrd.entities (third parameter for `SelectQueryBuilder<WebHareDB, "wrd.entities", O>`)
 */
type AddToQueryResponse<O> = {
  needaftercheck: boolean;
  query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>;
} | null;

/** Base for an attribute accessor
 * @typeParam In - Type for allowed values for insert and update
 * @typeParam Out - Type returned by queries
 * @typeParam Default - Output type plus default type (output may not include the default value for eg required domains, where `null` is the default)
 */
export abstract class WRDAttributeValueBase<In, Default, Out extends Default, C extends { condition: AllowedFilterConditions; value: unknown }> {
  attr: AttrRec;
  constructor(attr: AttrRec) {
    this.attr = attr;
  }

  /** Returns the default value for a value with no settings
   *  @returns Default value for this type
   */
  abstract getDefaultValue(): Default;

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
  abstract addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: C): AddToQueryResponse<O>;

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
   */
  abstract getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[]): Out;

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, may be the same as settings_start
   * @param row - Entity record
   * @param links - Entity settings whfs links, sorted on id
   * @returns The parsed value. The return type of this function is used to determine the selection output type for a attribute.
   */
  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, row: EntityPartialRec, links: EntitySettingsWHFSLinkRec[]): Out {
    if (settings_limit <= settings_start)
      return this.getDefaultValue() as Out; // Cast is needed because for required fields, Out may not extend Default.
    else
      return this.getFromRecord(entity_settings, settings_start, settings_limit, links);
  }

  /** Check the contents of a value used to insert or update a value
   * @param value - The value to check. The type of this value is used to determine which type is accepted in an insert or update.
   */
  abstract validateInput(value: In): void;

  /** Returns the list of attributes that need to be fetched */
  getAttrIds(): number | number[] {
    return this.attr.id;
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    return null;
  }
}

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

type SettingsSelectBuilder = SelectQueryBuilder<WebHareDB, "wrd.entities" | "wrd.entity_settings", { id: number }>;

/** Returns a subquery over wrd.entity_settings on a wrd.entities where, joined on the entity id
 * @param qb - Query over wrd.entities
 * @returns Subquery over wrd.entity_settings, with the column `id` already selected.
*/
function getSettingsSelect(qb: ExpressionBuilder<WebHareDB, "wrd.entities">, attr: number): SettingsSelectBuilder {
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
function addQueryFilter<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, attr: number, defaultmatches: boolean, builder: (b: SettingsSelectBuilder) => SettingsSelectBuilder): SelectQueryBuilder<WebHareDB, "wrd.entities", O> {
  return query.where((oqb) => {
    oqb = oqb.orWhereExists((qb) => {
      return builder(getSettingsSelect(qb, attr));
    });
    if (defaultmatches)
      oqb = oqb.orWhereNotExists(soqb => getSettingsSelect(soqb, attr));
    return oqb;
  });
}

/** Adds a where to a query. Changes `in X` to `= any(X)`, the postgrsql-client expands arrays into a parameter per element when using `in X` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addWhere<Select extends SelectQueryBuilder<any, any, any>>(query: Select, field: string | RawBuilder<any>, condition: ComparisonOperatorExpression, value: unknown) {
  if (condition === "in")
    return query.where(field, "=", sql`any(${value})`) as Select;
  else
    return query.where(field, condition, value) as Select;
}

/** Adds a orWhere to a query. Changes `in X` to `= any(X)`, the postgrsql-client expands arrays into a parameter per element when using `in X` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addOrWhere<Select extends WhereInterface<any, any>>(query: Select, field: string | RawBuilder<any>, condition: ComparisonOperatorExpression, value: unknown) {
  if (condition === "in")
    return query.orWhere(field, "=", sql`any(${value})`) as Select;
  else
    return query.orWhere(field, condition, value) as Select;
}


type WRDDBStringConditions = {
  condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: string; options?: { matchcase?: boolean };
} | {
  condition: "in"; value: readonly string[]; options?: { matchcase?: boolean };
} | {
  condition: "like"; value: string; options?: { matchcase?: boolean };
} | {
  condition: "mentions"; value: string; options?: { matchcase?: boolean };
} | {
  condition: "mentionsany"; value: readonly string[]; options?: { matchcase?: boolean };
};

class WRDDBStringValue extends WRDAttributeValueBase<string, string, string, WRDDBStringConditions> {
  getDefaultValue() { return ""; }
  checkFilter({ condition, value }: WRDDBStringConditions) {
    if (condition === "mentions" && !value)
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(condition)}`);
  }
  matchesValue(value: string, cv: WRDDBStringConditions): boolean {
    if (!cv.options?.matchcase)
      value = value.toUpperCase();
    if (cv.condition === "in" || cv.condition === "mentionsany") {
      if (!cv.options?.matchcase) {
        return cv.value.some(v => value === v.toUpperCase());
      } else
        return cv.value.includes(value);
    }
    const cmpvalue = cv.options?.matchcase ? cv.value : cv.value.toUpperCase();
    if (cv.condition === "like") {
      return isLike(value, cmpvalue);
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cmpvalue);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBStringConditions): AddToQueryResponse<O> {
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

    if (!db_cv.options?.matchcase) {
      if (db_cv.condition === "in")
        db_cv.value = db_cv.value.map(v => v.toUpperCase());
      else
        db_cv.value = db_cv.value.toUpperCase();
    }

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null; // no results!

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;
    query = addQueryFilter(query, this.attr.id, defaultmatches, b => {
      return b
        .$if(Boolean(db_cv.options?.matchcase), f => addWhere(f, sql`rawdata`, filtered_cv.condition, filtered_cv.value))
        .$if(!db_cv.options?.matchcase, f => addWhere(f, sql`upper("rawdata")`, filtered_cv.condition, filtered_cv.value));
    });

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    return entity_settings[settings_start].rawdata;
  }

  validateInput(value: string) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

class WRDDBBaseStringValue extends WRDAttributeValueBase<string, string, string, WRDDBStringConditions> {
  getDefaultValue() { return ""; }
  checkFilter({ condition, value }: WRDDBStringConditions) {
    if (condition === "mentions" && !value)
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(condition)}`);
  }
  matchesValue(value: string, cv: WRDDBStringConditions): boolean {
    if (!cv.options?.matchcase)
      value = value.toUpperCase();
    if (cv.condition === "in" || cv.condition === "mentionsany") {
      if (!cv.options?.matchcase) {
        return cv.value.some(v => value === v.toUpperCase());
      } else
        return cv.value.includes(value);
    }
    const cmpvalue = cv.options?.matchcase ? cv.value : cv.value.toUpperCase();
    if (cv.condition === "like") {
      return isLike(value, cmpvalue);
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cmpvalue);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBStringConditions): AddToQueryResponse<O> {
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

    if (!db_cv.options?.matchcase) {
      if (db_cv.condition === "in")
        db_cv.value = db_cv.value.map(v => v.toUpperCase());
      else
        db_cv.value = db_cv.value.toUpperCase();
    }

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null;

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;

    let baseAttr: RawBuilder<unknown>;
    switch (this.attr.tag) {
      case "wrdTag": baseAttr = db_cv.options?.matchcase ? sql`tag` : sql`upper("tag")`; break;
      case "wrdInitials": baseAttr = db_cv.options?.matchcase ? sql`initials` : sql`upper("initials")`; break;
      case "wrdFirstName": baseAttr = db_cv.options?.matchcase ? sql`firstname` : sql`upper("firstname")`; break;
      case "wrdFirstNames": baseAttr = db_cv.options?.matchcase ? sql`firstnames` : sql`upper("firstnames")`; break;
      case "wrdInfix": baseAttr = db_cv.options?.matchcase ? sql`infix` : sql`upper("infix")`; break;
      case "wrdLastName": baseAttr = db_cv.options?.matchcase ? sql`lastname` : sql`upper("lastname")`; break;
      case "wrdTitlesSuffix": baseAttr = db_cv.options?.matchcase ? sql`titles_suffix` : sql`upper("titles_suffix")`; break;
      default: throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);
    }
    return {
      needaftercheck: false,
      query: addWhere(query, baseAttr, filtered_cv.condition, filtered_cv.value)
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
      case "wrdTitlesSuffix": return entityRecord.titles_suffix || "";
      default: throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    throw new Error("Not implemented for base fields");
  }

  validateInput(value: string) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
    if (value.length > 256)
      throw new Error(`Value for attribute ${this.attr.tag} is too long (${value.length} characters, maximum is 256)`);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    switch (this.attr.tag) {
      case "wrdTag": return "tag";
      case "wrdInitials": return "initials";
      case "wrdFirstName": return "firstname";
      case "wrdFirstNames": return "firstnames";
      case "wrdInfix": return "infix";
      case "wrdLastName": return "lastname";
      case "wrdTitlesSuffix": return "titles_suffix";
      default: throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }
}

type WRDDBGuidConditions = {
  condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: string;
} | {
  condition: "in"; value: readonly string[]; options?: { matchcase?: boolean };
};

class WRDDBBaseGuidValue extends WRDAttributeValueBase<string, string, string, WRDDBGuidConditions> {
  checkGuid(guid: string) {
    if (!/^wrd:[0-9a-fA-F]{32}$/.exec(guid))
      throw new Error(`Invalid guid value`);
  }
  getDefaultValue() { return ""; }
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
  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBGuidConditions): AddToQueryResponse<O> {
    // Rewrite like query to PostgreSQL LIKE mask format
    const db_cv = cv.condition === "in" ?
      { ...cv, value: cv.value.map(v => Buffer.from(v.slice(4), "hex")) } :
      { ...cv, value: Buffer.from(cv.value.slice(4), "hex") };

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null;

    return {
      needaftercheck: false,
      query: addWhere(query, "guid", db_cv.condition, db_cv.value)
    };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityRecord: EntityPartialRec): string {
    return `wrd:${entityRecord.guid!.toString("hex").toUpperCase()}`;
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    throw new Error("Not implemented for base fields");
  }

  validateInput(value: string) {
    this.checkGuid(value);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    return "guid";
  }
}

type WRDDBaseGeneratedStringConditions = {
  condition: "=" | ">=" | ">" | "!=" | "<" | "<="; value: string;
} | {
  condition: "in"; value: readonly string[]; options?: { matchcase?: boolean };
};

class WRDDBBaseGeneratedStringValue extends WRDAttributeValueBase<never, string, string, WRDDBaseGeneratedStringConditions> {
  getDefaultValue() { return ""; }

  checkFilter({ condition, value }: WRDDBaseGeneratedStringConditions) {
    // type-check is enough (for now)
  }

  matchesValue(value: string, cv: WRDDBaseGeneratedStringConditions): boolean {
    if (cv.condition === "in")
      return cv.value.includes(value);
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBaseGeneratedStringConditions): AddToQueryResponse<O> {
    return { needaftercheck: true, query };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityRecord: EntityPartialRec): string {
    switch (this.attr.tag) {
      case "wrdSaluteFormal": {
        throw new Error(`wrdSaluteFormal is not implemented`);
      }
      case "wrdAddressFormal": {
        throw new Error(`wrdAddressFormal is not implemented`);
      }
      case "wrdFullName":
      case "wrdTitle": {
        if (!entityRecord.firstname && !entityRecord.firstnames && !entityRecord.lastname)
          return ""; //Not enough information to create a 'full name'

        let fullname = "";
        if (entityRecord.firstname != "")
          fullname += entityRecord.firstname;
        else if (entityRecord.firstnames != "")
          fullname += entityRecord.firstnames;
        else if (entityRecord.initials)
          fullname += entityRecord.initials;
        if (entityRecord.lastname)
          fullname += `${entityRecord.infix ? entityRecord.infix + " " : ""}${entityRecord.lastname}`;
        return fullname.trim();
      }
      default: throw new Error(`Unhandled base generated string attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): string {
    throw new Error("Not implemented for base fields");
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    switch (this.attr.tag) {
      case "wrdSaluteFormal": return ["lastname", "gender", "titles", "infix"];
      case "wrdAddressFormal": return ["lastname", "gender", "titles", "infix", "initials"];
      case "wrdFullName":
      case "wrdTitle": return ["initials", "firstname", "firstnames", "lastname", "infix"];
      default: throw new Error(`Unhandled base generated string attribute ${JSON.stringify(this.attr.tag)}`);
    }
  }

  validateInput(value: string): void {
    throw new Error(`Unable to updated generated field ${JSON.stringify(this.attr.tag)}`);
  }
}

type WRDDBBooleanConditions = {
  condition: "<" | "<=" | "=" | "!=" | ">=" | ">"; value: boolean;
};

class WRDDBBooleanValue extends WRDAttributeValueBase<boolean, boolean, boolean, WRDDBBooleanConditions> {
  getDefaultValue() { return false; }
  checkFilter({ condition, value }: WRDDBBooleanConditions) {
    // type-check is enough (for now)
  }
  matchesValue(value: boolean, cv: WRDDBBooleanConditions): boolean {
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBBooleanConditions): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    query = addQueryFilter(query, this.attr.id, defaultmatches, b => addWhere(b, `rawdata`, cv.condition, cv.value ? "1" : ""));

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): boolean {
    return entity_settings[settings_start].rawdata == "1";
  }

  validateInput(value: boolean) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

type WRDDBIntegerConditions = {
  condition: "<" | "<=" | "=" | "!=" | ">=" | ">"; value: number;
} | {
  condition: "in"; value: readonly number[];
};

class WRDDBIntegerValue extends WRDAttributeValueBase<number, number, number, WRDDBIntegerConditions> {
  getDefaultValue() { return 0; }
  checkFilter({ condition, value }: WRDDBIntegerConditions) {
    // type-check is enough (for now)
  }
  matchesValue(value: number, cv: WRDDBIntegerConditions): boolean {
    if (cv.condition === "in")
      return cv.value.includes(value);
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBIntegerConditions): AddToQueryResponse<O> {
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    if (cv.condition === "in" && !cv.value.length)
      return null;

    query = addQueryFilter(query, this.attr.id, defaultmatches, b => addWhere(b, sql`rawdata::integer`, cv.condition, cv.value));

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): number {
    return Number(entity_settings[settings_start].rawdata);
  }

  validateInput(value: number) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

class WRDDBBaseIntegerValue extends WRDAttributeValueBase<number, number, number, WRDDBIntegerConditions> {
  getDefaultValue() { return 0; }
  checkFilter({ condition, value }: WRDDBIntegerConditions) {
    // type-check is enough (for now)
  }
  matchesValue(value: number, cv: WRDDBIntegerConditions): boolean {
    if (cv.condition === "in")
      return cv.value.includes(value);
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBIntegerConditions): AddToQueryResponse<O> {
    if (cv.condition === "in" && !cv.value.length)
      return null;
    switch (this.attr.tag) {
      case "wrdId": query = addWhere(query, "id", cv.condition, cv.value); break;
      case "wrdType": query = addWhere(query, "type", cv.condition, cv.value); break;
      case "wrdOrdering": query = addWhere(query, "ordering", cv.condition, cv.value); break;
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

  validateInput(value: number) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    switch (this.attr.tag) {
      case "wrdId": return "id";
      case "wrdType": return "type";
      case "wrdOrdering": return "ordering";
    }
    return null;
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
  (true extends Required ? number : number | null),
  (number | null),
  (true extends Required ? number : number | null),
  WRDDBDomainConditions
> {
  getDefaultValue(): number | null { return null; }
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

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDomainConditions): AddToQueryResponse<O> {
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
    query = addQueryFilter(query, this.attr.id, defaultmatches, b => b.where(`setting`, fixed_db_cv.condition, fixed_db_cv.value));

    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (true extends Required ? number : number | null) {
    return entity_settings[settings_start].setting as number; // for domains, always filled with valid reference
  }

  validateInput(value: true extends Required ? number : number | null) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

class WRDDBBaseDomainValue<Required extends boolean> extends WRDAttributeValueBase<
  (true extends Required ? number : number | null),
  (number | null),
  (true extends Required ? number : number | null),
  WRDDBDomainConditions
> {
  getDefaultValue(): number | null { return null; }
  checkFilter(cv: WRDDBDomainConditions) {
    if (cv.condition === "in" || cv.condition === "mentionsany") {
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

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDomainConditions): AddToQueryResponse<O> {
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
    if (this.attr.tag === "wrdLeftEntity")
      query = addWhere(query, "leftentity", fixed_db_cv.condition, fixed_db_cv.value);
    else if (this.attr.tag === "wrdRightEntity")
      query = addWhere(query, "rightentity", fixed_db_cv.condition, fixed_db_cv.value);
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);

    return {
      needaftercheck: false,
      query
    };
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): (true extends Required ? number : number | null) {
    if (this.attr.tag === "wrdLeftEntity")
      return entityrec.leftentity || null as (true extends Required ? number : number | null);
    else if (this.attr.tag === "wrdRightEntity")
      return entityrec.rightentity || null as (true extends Required ? number : number | null);
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (true extends Required ? number : number | null) {
    throw new Error(`Should not be called for base attributes`);
  }

  validateInput(value: true extends Required ? number : number | null) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    if (this.attr.tag === "wrdLeftEntity")
      return "leftentity";
    else if (this.attr.tag === "wrdRightEntity")
      return "rightentity";
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);
  }
}

type WRDDBDomainArrayConditions = {
  condition: "mentions" | "contains"; value: number;
} | {
  condition: "mentionsany" | "intersects"; value: readonly number[];
} | {
  condition: "=" | "!="; value: readonly number[];
};

class WRDDBDomainArrayValue extends WRDAttributeValueBase<number[], number[], number[], WRDDBDomainArrayConditions> {
  getDefaultValue(): number[] { return []; }
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

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDomainArrayConditions): AddToQueryResponse<O> {
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

      query = addQueryFilter(query, this.attr.id, defaultmatches, b => b.where(`setting`, fixed_db_cv.condition, fixed_db_cv.value));
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

  validateInput(value: number[]) {
    if (this.attr.required && !value.length)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

type WRDDBEnumConditions = {
  condition: "=" | "!="; value: string | null;
} | {
  condition: "in"; value: ReadonlyArray<string | null>;
} | {
  condition: "like"; value: string;
} | {
  condition: "mentions"; value: string;
} | {
  condition: "mentionsany"; value: readonly string[];
};

// FIXME: add wildcard support
type GetEnumAllowedValues<Options extends { allowedvalues: string }, Required extends boolean> = (Options extends { allowedvalues: infer V } ? V : never) | (Required extends true ? never : null);

class WRDDBEnumValue<Options extends { allowedvalues: string }, Required extends boolean> extends WRDAttributeValueBase<GetEnumAllowedValues<Options, Required>, GetEnumAllowedValues<Options, Required> | null, GetEnumAllowedValues<Options, Required>, WRDDBEnumConditions> {
  getDefaultValue(): GetEnumAllowedValues<Options, Required> | null { return null; }
  checkFilter({ condition, value }: WRDDBEnumConditions) {
    if (condition === "mentions" && !value)
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(condition)}`);
    if (value === "")
      throw new Error(`Use null instead of "" for enum compares`);
  }
  matchesValue(value: string | null, cv: WRDDBEnumConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    value = value || "";
    if (cv.condition === "mentionsany") {
      return cv.value.includes(value);
    }
    if (cv.condition === "like") {
      return isLike(value, cv.value);
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cv.value || "");
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBEnumConditions): AddToQueryResponse<O> {
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

    // Eliminate nulls
    if (db_cv.condition === "=" || db_cv.condition === "!=")
      db_cv = { ...db_cv, value: db_cv.value ?? "" };
    if (db_cv.condition === "in")
      db_cv = { ...db_cv, value: db_cv.value.map(v => v ?? "") };

    if (db_cv.condition === "in" && !db_cv.value.length)
      return null; // no results!

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;
    query = addQueryFilter(query, this.attr.id, defaultmatches, b => b.where(sql`rawdata`, filtered_cv.condition, filtered_cv.value));
    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): GetEnumAllowedValues<Options, Required> {
    return entity_settings[settings_start].rawdata as GetEnumAllowedValues<Options, Required>;
  }

  validateInput(value: GetEnumAllowedValues<Options, Required> | null) {
    if (this.attr.required && (!value || !value.length))
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

type WRDDBEnumArrayConditions = {
  condition: "=" | "!="; value: readonly string[];
} | {
  condition: "intersects"; value: readonly string[];
} | {
  condition: "contains"; value: string;
};

class WRDDBEnumArrayValue<Options extends { allowedvalues: string }> extends WRDAttributeValueBase<Array<GetEnumArrayAllowedValues<Options>>, Array<GetEnumArrayAllowedValues<Options>>, Array<GetEnumArrayAllowedValues<Options>>, WRDDBEnumArrayConditions> {
  getDefaultValue(): Array<GetEnumArrayAllowedValues<Options>> { return []; }
  checkFilter(cv: WRDDBEnumArrayConditions) {
    if (cv.condition === "contains") {
      if (!cv.value)
        throw new Error(`Value may not be empty for condition type ${JSON.stringify(cv.condition)}`);
    } else if (cv.value.some(v => !v))
      throw new Error(`Value may not contain empty strings empty for condition type ${JSON.stringify(cv.condition)}`);
  }
  matchesValue(value: readonly string[], cv: WRDDBEnumArrayConditions): boolean {
    if (cv.condition === "contains") {
      return value.includes(cv.value);
    }
    throw new Error(`Condition ${cv.condition} not yet implemented for enumarray`);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBEnumArrayConditions): AddToQueryResponse<O> {
    return { needaftercheck: true, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Array<GetEnumArrayAllowedValues<Options>> {
    return entity_settings[settings_start].rawdata ? entity_settings[settings_start].rawdata.split("\t") as Array<GetEnumArrayAllowedValues<Options>> : [];
  }

  validateInput(value: Array<GetEnumArrayAllowedValues<Options>>) {
    if (value.some(v => !v))
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}


type WRDDBDateTimeConditions = {
  condition: "=" | "!="; value: Date | null;
} | {
  condition: ">=" | "<=" | "<" | ">"; value: Date;
} | {
  condition: "in"; value: ReadonlyArray<Date | null>;
};

class WRDDBDateValue<Required extends boolean> extends WRDAttributeValueBase<(true extends Required ? Date : Date | null), Date | null, (true extends Required ? Date : Date | null), WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
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

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    return { needaftercheck: true, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (true extends Required ? Date : Date | null) {
    const parts = entity_settings[settings_start].rawdata.split(",");
    if (Number(parts[0]) >= 2147483647)
      return null as (true extends Required ? Date : Date | null);
    return makeDateFromParts(Number(parts[0]), 0);
  }

  validateInput(value: (true extends Required ? Date : Date | null)) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

class WRDDBBaseDateValue extends WRDAttributeValueBase<Date | null, Date | null, Date | null, WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
  checkFilter(cv: WRDDBDateTimeConditions) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.validateInput(v));
    else
      this.validateInput(cv.value);
  }
  matchesValue(value: Date | null, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
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

    query = addWhere(query, fieldname, cv.condition, cv.value);
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

  validateInput(value: Date | null) {
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDatetime or maxDatetime, use null`);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    switch (this.attr.tag) {
      case "wrdDateOfBirth": return "dateofbirth";
      case "wrdDateOfDeath": return "dateofdeath";
    }
    return null;
  }

}

class WRDDBDateTimeValue<Required extends boolean> extends WRDAttributeValueBase<(true extends Required ? Date : Date | null), Date | null, (true extends Required ? Date : Date | null), WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
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

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    return { needaftercheck: true, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (true extends Required ? Date : Date | null) {
    const parts = entity_settings[settings_start].rawdata.split(",");
    if (Number(parts[0]) >= 2147483647)
      return null as (true extends Required ? Date : Date | null);
    return makeDateFromParts(Number(parts[0]), Number(parts[1]));
  }

  validateInput(value: (true extends Required ? Date : Date | null)) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

type ArraySelectable<Members extends Record<string, SimpleWRDAttributeType | WRDAttrBase>> = {
  [K in keyof Members]: GetResultType<Members[K]>;
};

class WRDDBBaseCreationLimitDateValue extends WRDAttributeValueBase<Date | null, Date | null, Date | null, WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
  checkFilter(cv: WRDDBDateTimeConditions) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.validateInput(v));
    else
      this.validateInput(cv.value);
  }
  matchesValue(value: Date | null, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
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
      query = query.where(qb => addOrWhere(qb, fieldname, cv.condition, cv.value)
        .orWhere(fieldname, "=", maxDateTime));
    } else {
      query = addWhere(query, fieldname, cv.condition, cv.value);
      if (maxDateTimeMatches && !defaultMatches)
        query = addWhere(query, fieldname, "!=", maxDateTime);
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

  validateInput(value: Date | null) {
    if (value && (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDatetime or maxDatetime, use null`);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    switch (this.attr.tag) {
      case "wrdCreationDate": return "creationdate";
      case "wrdLimitDate": return "limitdate";
    }
    return null;
  }
}

class WRDDBBaseModificationDateValue extends WRDAttributeValueBase<Date, Date | null, Date, WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
  checkFilter(cv: WRDDBDateTimeConditions) {
    if (cv.condition === "in") {
      for (const value of cv.value)
        if (!value)
          throw new Error(`Not allowed to use null in comparisions`);
        else
          this.validateInput(value);
    } else if (!cv.value)
      throw new Error(`Not allowed to use null in comparisions`);
    else
      this.validateInput(cv.value);
  }
  matchesValue(value: Date, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    if (cv.condition === "in")
      cv.value = cv.value.map(v => v ?? defaultDateTime);
    else
      cv.value ??= defaultDateTime;

    if (cv.condition === "in" && !cv.value.length)
      return null; // no results!

    query = addWhere(query, "modificationdate", cv.condition, cv.value);
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

  validateInput(value: Date) {
    if (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs)
      throw new Error(`Not allowed to use defaultDatetime or maxDatetime`);
  }

  getAttrBaseCells(): null | keyof EntityPartialRec | Array<keyof EntityPartialRec> {
    return "modificationdate";
  }
}

class WRDDBArrayValue<Members extends Record<string, SimpleWRDAttributeType | WRDAttrBase>> extends WRDAttributeValueBase<
  Array<Insertable<Members> & { wrdSettingId?: bigint }>,
  Array<ArraySelectable<Members> & { wrdSettingId: bigint }>,
  Array<ArraySelectable<Members> & { wrdSettingId: bigint }>,
  never> {

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields = new Array<{ name: keyof Members; accessor: WRDAttributeValueBase<any, any, any, any> }>;

  constructor(attr: AttrRec, parentAttrMap: Map<number | null, AttrRec[]>) {
    super(attr);

    const childAttrs = parentAttrMap.get(attr.id);
    if (childAttrs) {
      for (const childAttr of childAttrs) {
        this.fields.push({ name: childAttr.tag, accessor: getAccessor(childAttr, parentAttrMap) });
      }
    }
  }

  getDefaultValue(): Array<ArraySelectable<Members> & { wrdSettingId: bigint }> { return []; }

  checkFilter({ condition, value }: never) {
    throw new Error(`Filters not allowed on arrays`);
  }

  matchesValue(value: Array<ArraySelectable<Members>>, cv: never): boolean {
    throw new Error(`Filters not allowed on arrays`);
  }

  /** Try to add wheres to the database query on wrd.entities to filter out non-matches for this filter
   * @typeParam O - Output map for the database query
   * @param query - Database query
   * @param cv - Condition and value to compare with
   * @returns Whether after-filtering is necessary and updated query
   */
  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: never): AddToQueryResponse<O> {
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
  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[]): Array<ArraySelectable<Members> & { wrdSettingId: bigint }> {
    throw new Error(`Not implemented yet`);
  }

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, may be the same as settings_start)
   * @returns The parsed value. The return type of this function is used to determine the selection output type for a attribute.
   */
  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, row: EntityPartialRec, links: EntitySettingsWHFSLinkRec[]): Array<ArraySelectable<Members> & { wrdSettingId: bigint }> {
    if (settings_limit <= settings_start)
      return this.getDefaultValue() as Array<ArraySelectable<Members> & { wrdSettingId: bigint }>; // Cast is needed because for required fields, Out may not extend Default.
    else {
      const retval = new Array<ArraySelectable<Members> & { wrdSettingId: bigint }>;
      for (let idx = settings_start; idx < settings_limit; ++idx) {
        const settingid = entity_settings[idx].id;
        const rec = { wrdSettingId: BigInt(settingid) } as ArraySelectable<Members> & { wrdSettingId: bigint };
        for (const field of this.fields) {
          const lb = recordLowerBound(entity_settings, { attribute: field.accessor.attr.id, parentsetting: settingid }, ["attribute", "parentsetting"]);
          const ub = recordUpperBound(entity_settings, { attribute: field.accessor.attr.id, parentsetting: settingid }, ["attribute", "parentsetting"]);
          rec[field.name] = field.accessor.getValue(entity_settings, lb.position, ub, row, links);
        }
        retval.push(rec);
      }
      return retval;
    }
  }

  /** Check the contents of a value used to insert or update a value
   * @param value - The value to check. The type of this value is used to determine which type is accepted in an insert or update.
   */
  validateInput(value: Array<Insertable<Members> & { wrdSettingId?: bigint }>) {
    throw new Error(`Not implemented yet`);
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
}

export abstract class WRDAttributeUncomparableValueBase<In, Default, Out extends Default> extends WRDAttributeValueBase<In, Default, Out, never> {
  checkFilter(cv: never): void {
    throw new Error(`Cannot compare values of type ${WRDAttributeType[this.attr.attributetype]}`);
  }

  matchesValue(value: unknown, cv: never): boolean {
    throw new Error(`Cannot compare values of type  ${WRDAttributeType[this.attr.attributetype]}`);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv_org: never): AddToQueryResponse<O> {
    throw new Error(`Cannot compare values of type  ${WRDAttributeType[this.attr.attributetype]}`);
  }

  containsOnlyDefaultValues(cv: never): boolean {
    throw new Error(`Cannot compare values of type  ${WRDAttributeType[this.attr.attributetype]}`);
  }
}

class WRDDBJSONValue extends WRDAttributeUncomparableValueBase<object | null, object | null, object | null> {
  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): object | null {
    return null;
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): object | null {
    if (entity_settings[settings_start].rawdata)
      return JSON.parse(entity_settings[settings_start].rawdata);
    const buf = entity_settings[settings_start].blobdata?.tryArrayBufferSync();
    return buf ? JSON.parse(Buffer.from(buf).toString()) : null;
  }

  validateInput(value: object | null): void {
    /* always valid */
  }
}

class WRDDBRecordValue extends WRDAttributeUncomparableValueBase<object | null, IPCMarshallableRecord | null, IPCMarshallableRecord | null> {
  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): IPCMarshallableRecord | null {
    return null;
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): IPCMarshallableRecord | null {
    if (entity_settings[settings_start].rawdata)
      return decodeHSON(entity_settings[settings_start].rawdata) as IPCMarshallableRecord;
    const buf = entity_settings[settings_start].blobdata?.tryArrayBufferSync();
    return buf ? decodeHSON(Buffer.from(buf).toString()) as IPCMarshallableRecord : null;
  }

  validateInput(value: object | null): void {
    /* always valid */
  }
}

//TODO {data: Buffer} is for 5.3 compatibility and we might have to just remove it
class WHDBRichFileAttributeBase extends WRDAttributeUncomparableValueBase<RichFileDescriptor | null | { data: Buffer }, RichFileDescriptor | null, RichFileDescriptor | null> {
  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): RichFileDescriptor | null {
    return null;
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, links: EntitySettingsWHFSLinkRec[]): RichFileDescriptor | null {
    const val = entity_settings[settings_start];
    const lpos = recordLowerBound(links, val, ["id"]);
    const sourceFile = lpos.found ? links[lpos.position].fsobject : null;
    return val.blobdata
      ? new RichFileDescriptor(val.blobdata, { ...decodeScanData(val.rawdata), sourceFile })
      : null;
  }

  validateInput(value: RichFileDescriptor | null | { data: Buffer }): void {
    /* always valid */
  }
}

class WRDDBFileValue extends WHDBRichFileAttributeBase { }

class WRDDBImageValue extends WHDBRichFileAttributeBase { }

class WRDDBRichDocumentValue extends WHDBRichFileAttributeBase { }

export class WRDAttributeUnImplementedValueBase<In, Default, Out extends Default, C extends { condition: AllowedFilterConditions; value: unknown } = { condition: AllowedFilterConditions; value: unknown }> extends WRDAttributeValueBase<In, Default, Out, C> {
  throwError(): never {
    throw new Error(`Unimplemented accessor for type ${WRDAttributeType[this.attr.attributetype] ?? WRDBaseAttributeType[this.attr.attributetype]} (tag: ${JSON.stringify(this.attr.tag)})`);
  }

  /** Returns the default value for a value with no settings
      @returns Default value for this type
  */
  getDefaultValue(): Default {
    this.throwError();
  }

  checkFilter(cv: C): void {
    this.throwError();
  }

  matchesValue(value: unknown, cv: C): boolean {
    this.throwError();
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv_org: C): AddToQueryResponse<O> {
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
}

// FIXME: add wildcard support
type GetEnumArrayAllowedValues<Options extends { allowedvalues: string }> = Options extends { allowedvalues: infer V } ? V : never;

/// The following accessors are not implemented yet, but have some typings
//class WRDDBBaseCreationLimitDateValue extends WRDAttributeUnImplementedValueBase<Date | null, Date | null, Date | null> { }
//class WRDDBBaseModificationDateValue extends WRDAttributeUnImplementedValueBase<Date, Date, Date> { }
class WRDDBMoneyValue extends WRDAttributeUnImplementedValueBase<Money, Money, Money> { }
class WRDDBInteger64Value extends WRDAttributeUnImplementedValueBase<bigint, bigint, bigint> { }
class WRDDBBaseGenderValue extends WRDAttributeUnImplementedValueBase<WRDGender, WRDGender, WRDGender> { }
//class WRDDBEnumArrayValue<Options extends { allowedvalues: string }, Required extends boolean> extends WRDAttributeUnImplementedValueBase<Array<GetEnumArrayAllowedValues<Options>>, Array<GetEnumArrayAllowedValues<Options>>, Array<GetEnumArrayAllowedValues<Options>>> { _x?: Options; _y?: Required; }

/// The following accessors are not implemented yet
class WRDDBAddressValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBPasswordValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
//class WRDDBImageValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
//class WRDDBFileValue extends WRDAttributeUnImplementedValueBase<RichFileDescriptor | { data: Buffer } | null, RichFileDescriptor | null, RichFileDescriptor | null> { }
//class WRDDBRichDocumentValue extends WRDAttributeUnImplementedValueBase<RichFileDescriptor | null, RichFileDescriptor | null, RichFileDescriptor | null> { }
class WRDDBWHFSInstanceValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBWHFSIntextlinkValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
//class WRDDBRecordValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBPaymentProviderValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBPaymentValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBStatusRecordValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBAuthenticationSettingsValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBWHFSLinkValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }

/// Map for all attribute types that have no options
type SimpleTypeMap<Required extends boolean> = {
  [WRDBaseAttributeType.Base_Integer]: WRDDBIntegerValue;
  [WRDBaseAttributeType.Base_Guid]: WRDDBBaseGuidValue;
  [WRDBaseAttributeType.Base_Tag]: WRDDBBaseStringValue;
  [WRDBaseAttributeType.Base_CreationLimitDate]: WRDDBBaseCreationLimitDateValue;
  [WRDBaseAttributeType.Base_ModificationDate]: WRDDBBaseModificationDateValue;
  [WRDBaseAttributeType.Base_Date]: WRDDBDateValue<false>;
  [WRDBaseAttributeType.Base_GeneratedString]: WRDDBStringValue;
  [WRDBaseAttributeType.Base_NameString]: WRDDBBaseStringValue;
  [WRDBaseAttributeType.Base_Domain]: WRDDBBaseDomainValue<Required>;
  [WRDBaseAttributeType.Base_Gender]: WRDDBBaseGenderValue;

  [WRDAttributeType.Free]: WRDDBStringValue;
  [WRDAttributeType.Email]: WRDDBStringValue;
  [WRDAttributeType.Telephone]: WRDDBStringValue;
  [WRDAttributeType.URL]: WRDDBStringValue;
  [WRDAttributeType.Boolean]: WRDDBBooleanValue;
  [WRDAttributeType.Integer]: WRDDBIntegerValue;
  [WRDAttributeType.Domain]: WRDDBDomainValue<Required>;
  [WRDAttributeType.DomainArray]: WRDDBDomainArrayValue;
  [WRDAttributeType.Address]: WRDDBAddressValue;
  [WRDAttributeType.Password]: WRDDBPasswordValue;
  [WRDAttributeType.Image]: WRDDBImageValue;
  [WRDAttributeType.File]: WRDDBFileValue;
  [WRDAttributeType.Money]: WRDDBMoneyValue;
  [WRDAttributeType.RichDocument]: WRDDBRichDocumentValue;
  [WRDAttributeType.Integer64]: WRDDBInteger64Value;
  [WRDAttributeType.WHFSInstance]: WRDDBWHFSInstanceValue;
  [WRDAttributeType.WHFSIntextlink]: WRDDBWHFSIntextlinkValue;
  [WRDAttributeType.Record]: WRDDBRecordValue;
  [WRDAttributeType.JSON]: WRDDBJSONValue;
  [WRDAttributeType.PaymentProvider]: WRDDBPaymentProviderValue;
  [WRDAttributeType.Payment]: WRDDBPaymentValue;
  [WRDAttributeType.StatusRecord]: WRDDBStatusRecordValue;
  [WRDAttributeType.AuthenticationSettings]: WRDDBAuthenticationSettingsValue;
  [WRDAttributeType.WHFSLink]: WRDDBWHFSLinkValue;
};

/** Returns the accessor for a WRDAttr record
 * @typeParam T - WRDAttr type
 * @returns Accessor (extends WRDAttributeValueBase)
 */
export type AccessorType<T extends WRDAttrBase> = T["__attrtype"] extends keyof SimpleTypeMap<T["__required"]>
  ? SimpleTypeMap<T["__required"]>[T["__attrtype"]]
  : (T extends { __attrtype: WRDAttributeType.Enum }
    ? WRDDBEnumValue<T["__options"], T["__required"]>
    : (T extends { __attrtype: WRDAttributeType.EnumArray }
      ? WRDDBEnumArrayValue<T["__options"]>
      : (T extends { __attrtype: WRDAttributeType.Date }
        ? WRDDBDateValue<T["__required"]>
        : (T extends { __attrtype: WRDAttributeType.DateTime }
          ? WRDDBDateTimeValue<T["__required"]>
          : (T extends { __attrtype: WRDAttributeType.Array }
            ? WRDDBArrayValue<T["__options"]["members"]>
            : never)))));

export function getAccessor<T extends WRDAttrBase>(
  attrinfo: AttrRec & { attributetype: T["__attrtype"]; required: T["__required"] },
  parentAttrMap: Map<number | null, AttrRec[]>,
): AccessorType<T> {
  switch (attrinfo.attributetype) {
    case WRDBaseAttributeType.Base_Integer: return new WRDDBBaseIntegerValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_Guid: return new WRDDBBaseGuidValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_Tag: return new WRDDBBaseStringValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_CreationLimitDate: return new WRDDBBaseCreationLimitDateValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_ModificationDate: return new WRDDBBaseModificationDateValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_Date: return new WRDDBBaseDateValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_GeneratedString: return new WRDDBBaseGeneratedStringValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_NameString: return new WRDDBBaseStringValue(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_Domain: return new WRDDBBaseDomainValue<T["__required"]>(attrinfo) as AccessorType<T>;
    case WRDBaseAttributeType.Base_Gender: return new WRDAttributeUnImplementedValueBase(attrinfo) as AccessorType<T>; // WRDDBBaseGenderValue

    case WRDAttributeType.Free: return new WRDDBStringValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Email: return new WRDDBStringValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Telephone: return new WRDDBStringValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.URL: return new WRDDBStringValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Boolean: return new WRDDBBooleanValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Integer: return new WRDDBIntegerValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Domain: return new WRDDBDomainValue<T["__required"]>(attrinfo) as AccessorType<T>;
    case WRDAttributeType.DomainArray: return new WRDDBDomainArrayValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Address: return new WRDDBAddressValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Password: return new WRDDBPasswordValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Image: return new WRDDBImageValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.File: return new WRDDBFileValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Money: return new WRDDBMoneyValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.RichDocument: return new WRDDBRichDocumentValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Integer64: return new WRDDBInteger64Value(attrinfo) as AccessorType<T>;
    case WRDAttributeType.WHFSInstance: return new WRDDBWHFSInstanceValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.WHFSIntextlink: return new WRDDBWHFSIntextlinkValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Record: return new WRDDBRecordValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.JSON: return new WRDDBJSONValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.PaymentProvider: return new WRDDBPaymentProviderValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Payment: return new WRDDBPaymentValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.StatusRecord: return new WRDDBStatusRecordValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.AuthenticationSettings: return new WRDDBAuthenticationSettingsValue(attrinfo) as AccessorType<T>;
    case WRDAttributeType.WHFSLink: return new WRDDBWHFSLinkValue(attrinfo) as AccessorType<T>;

    case WRDAttributeType.Enum: return new WRDDBEnumValue<{ allowedvalues: (T["__options"] & { allowedvalues: string })["allowedvalues"] }, T["__required"]>(attrinfo) as AccessorType<T>;
    case WRDAttributeType.EnumArray: return new WRDDBEnumArrayValue<{ allowedvalues: (T["__options"] & { allowedvalues: string })["allowedvalues"] }>(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Date: return new WRDDBDateValue<T["__required"]>(attrinfo) as AccessorType<T>;
    case WRDAttributeType.DateTime: return new WRDDBDateTimeValue<T["__required"]>(attrinfo) as AccessorType<T>;
    case WRDAttributeType.Array: return new WRDDBArrayValue<(T["__options"] & { members: Record<string, SimpleWRDAttributeType | WRDAttrBase> })["members"]>(attrinfo, parentAttrMap) as AccessorType<T>;
  }
  throw new Error(`Unhandled attribute type ${(attrinfo.attributetype < 0 ? WRDBaseAttributeType[attrinfo.attributetype] : WRDAttributeType[attrinfo.attributetype]) ?? attrinfo.attributetype}`);
}
