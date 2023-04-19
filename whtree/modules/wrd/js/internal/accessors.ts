import { WRDAttributeType, AllowedFilterConditions, WRDAttrBase, WRDGender } from "./types";
import type { AttrRec, EntityPartialRec, EntitySettingsRec } from "./db";
import { sql, SelectQueryBuilder, ExpressionBuilder } from "kysely";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { compare, ComparableType } from "@webhare/hscompat/algorithms";
import { isLike } from "@webhare/hscompat/strings";
import { Money } from "@webhare/std";


/** Response type for addToQuery
 * @typeParam O - Kysely selection map for wrd.entities (third parameter for `SelectQueryBuilder<WebHareDB, "wrd.entities", O>`)
 */
type AddToQueryResponse<O> = {
  needaftercheck: boolean;
  query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>;
};

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
   */
  abstract getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): Out;

  /** Given a list of entity settings, extract the return value for a field
   * @param entity_settings - List of entity settings
   * @param settings_start - Position where settings for this attribute start
   * @param settings_limit - Limit of setting for this attribute, may be the same as settings_start)
   * @returns The parsed value. The return type of this function is used to determine the selection output type for a attribute.
   */
  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, row: EntityPartialRec): Out {
    if (settings_limit <= settings_start)
      return this.getDefaultValue() as Out; // Cast is needed because for required fields, Out may not extend Default.
    else
      return this.getFromRecord(entity_settings, settings_start, settings_limit);
  }

  /** Check the contents of a value used to insert or update a value
   * @param value - The value to check. The type of this value is used to determine which type is accepted in an insert or update.
   */
  abstract validateInput(value: In): void;
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
function getSettingsSelect(qb: ExpressionBuilder<WebHareDB, "wrd.entities">): SettingsSelectBuilder {
  return qb
    .selectFrom("wrd.entity_settings")
    .select(["wrd.entity_settings.id"])
    .whereRef("wrd.entity_settings.entity", "=", "wrd.entities.id");
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
function addQueryFilter<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, defaultmatches: boolean, builder: (b: SettingsSelectBuilder) => SettingsSelectBuilder): SelectQueryBuilder<WebHareDB, "wrd.entities", O> {
  return query.where((oqb) => {
    oqb = oqb.orWhereExists((qb) => {
      return builder(getSettingsSelect(qb));
    });
    if (defaultmatches)
      oqb = oqb.orWhereNotExists(getSettingsSelect);
    return oqb;
  });
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

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;
    query = addQueryFilter(query, defaultmatches, b => {
      return b
        .$if(Boolean(db_cv.options?.matchcase), f => f.where(sql`rawdata`, filtered_cv.condition, filtered_cv.value))
        .$if(!db_cv.options?.matchcase, f => f.where(sql`upper("rawdata")`, filtered_cv.condition, filtered_cv.value));
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

    query = addQueryFilter(query, defaultmatches, b => b.where(`rawdata`, cv.condition, cv.value ? "1" : ""));

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

    query = addQueryFilter(query, defaultmatches, b => b.where(sql`rawdata::integer`, cv.condition, cv.value));

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
    const defaultmatches = this.matchesValue(this.getDefaultValue(), cv);

    // rewrite mentions and mentionsany to supported conditions
    let db_cv = { ...cv };
    if (db_cv.condition === "mentions")
      db_cv = { ...db_cv, condition: "=" };
    else if (db_cv.condition === "mentionsany")
      db_cv = { ...db_cv, condition: "in" };

    // copy to a new variable to satisfy TypeScript type inference
    const fixed_db_cv = db_cv;
    query = addQueryFilter(query, defaultmatches, b => b.where(`setting`, fixed_db_cv.condition, fixed_db_cv.value));

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
      // copy to a new variable to satisfy TypeScript type inference
      const fixed_db_cv = db_cv;
      query = addQueryFilter(query, defaultmatches, b => b.where(`setting`, fixed_db_cv.condition, fixed_db_cv.value));
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
  condition: "=" | "!=" | ">=" | "<="; value: string;
} | {
  condition: ">" | "<"; value: string;
} | {
  condition: "in"; value: readonly string[];
} | {
  condition: "like"; value: string;
} | {
  condition: "mentions"; value: string;
} | {
  condition: "mentionsany"; value: readonly string[];
};

// FIXME: add wildcard support
type GetEnumAllowedValues<Options extends { allowedvalues: string }, Required extends boolean> = (Options extends { allowedvalues: infer V } ? V : never) | (Required extends true ? never : "");

class WRDDBEnumValue<Options extends { allowedvalues: string }, Required extends boolean> extends WRDAttributeValueBase<GetEnumAllowedValues<Options, Required>, GetEnumAllowedValues<Options, Required> | "", GetEnumAllowedValues<Options, Required>, WRDDBEnumConditions> {
  getDefaultValue(): GetEnumAllowedValues<Options, Required> | "" { return ""; }
  checkFilter({ condition, value }: WRDDBEnumConditions) {
    if (condition === "mentions" && !value)
      throw new Error(`Value may not be empty for condition type ${JSON.stringify(condition)}`);
  }
  matchesValue(value: string, cv: WRDDBEnumConditions): boolean {
    if (cv.condition === "in" || cv.condition === "mentionsany") {
      return cv.value.includes(value);
    }
    const cmpvalue = cv.value;
    if (cv.condition === "like") {
      return isLike(value, cmpvalue);
    }
    return cmp(value, cv.condition === "mentions" ? "=" : cv.condition, cmpvalue);
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

    // copy to a new variable to satisfy TypeScript type inference
    const filtered_cv = db_cv;
    query = addQueryFilter(query, defaultmatches, b => b.where(sql`rawdata`, filtered_cv.condition, filtered_cv.value));
    return {
      needaftercheck: false,
      query
    };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): GetEnumAllowedValues<Options, Required> {
    return entity_settings[settings_start].rawdata as GetEnumAllowedValues<Options, Required>;
  }

  validateInput(value: GetEnumAllowedValues<Options, Required>) {
    if (this.attr.required && !value.length)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

type WRDDBDateTimeConditions = {
  condition: "=" | "!=" | ">=" | "<=" | "<" | ">"; value: Date | null;
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
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    throw new Error(`not implemented`);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (true extends Required ? Date : Date | null) {
    throw new Error(`not implemented`);
  }

  validateInput(value: (true extends Required ? Date : Date | null)) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

class WRDDBDateTimeValue<Required extends boolean> extends WRDAttributeValueBase<(true extends Required ? Date : Date | null), Date | null, (true extends Required ? Date : Date | null), WRDDBDateTimeConditions> {
  getDefaultValue(): Date | null { return null; }
  checkFilter({ condition, value }: WRDDBDateTimeConditions) {
    /* always ok */
  }
  matchesValue(value: Date | null, cv: WRDDBDateTimeConditions): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<WebHareDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions): AddToQueryResponse<O> {
    throw new Error(`not implemented`);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (true extends Required ? Date : Date | null) {
    throw new Error(`not implemented`);
  }

  validateInput(value: (true extends Required ? Date : Date | null)) {
    if (this.attr.required && !value)
      throw new Error(`Provided default value for attribute ${this.attr.tag}`);
  }
}

export class WRDAttributeUnImplementedValueBase<In, Default, Out extends Default, C extends { condition: AllowedFilterConditions; value: unknown } = { condition: AllowedFilterConditions; value: unknown }> extends WRDAttributeValueBase<In, Default, Out, C> {

  throwError(): never {
    throw new Error(`Unimplemented accessor for type ${WRDAttributeType[this.attr.type]} (tag: ${JSON.stringify(this.attr.tag)})`);
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
class WRDDBBaseCreationLimitDateValue extends WRDAttributeUnImplementedValueBase<Date | null, Date | null, Date | null> { }
class WRDDBBaseModificationDateValue extends WRDAttributeUnImplementedValueBase<Date, Date, Date> { }
class WRDDBMoneyValue extends WRDAttributeUnImplementedValueBase<Money, Money, Money> { }
class WRDDBInteger64Value extends WRDAttributeUnImplementedValueBase<bigint, bigint, bigint> { }
class WRDDBBaseGenderValue extends WRDAttributeUnImplementedValueBase<WRDGender, WRDGender, WRDGender> { }
class WRDDBEnumArrayValue<Options extends { allowedvalues: string }, Required extends boolean> extends WRDAttributeUnImplementedValueBase<Array<GetEnumArrayAllowedValues<Options>>, Array<GetEnumArrayAllowedValues<Options>>, Array<GetEnumArrayAllowedValues<Options>>> { _x?: Options; _y?: Required; }

/// The following accessors are not implemented yet
class WRDDBAddressValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBPasswordValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBImageValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBFileValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBRichDocumentValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBWHFSInstanceValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBWHFSIntextlinkValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBRecordValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBPaymentProviderValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBPaymentValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBStatusRecordValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBAuthenticationSettingsValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }
class WRDDBWHFSLinkValue extends WRDAttributeUnImplementedValueBase<unknown, unknown, unknown> { }

/// Map for all attribute types that have no options
type SimpleTypeMap<Required extends boolean> = {
  [WRDAttributeType.Base_Integer]: WRDDBIntegerValue;
  [WRDAttributeType.Base_Guid]: WRDDBStringValue;
  [WRDAttributeType.Base_Tag]: WRDDBStringValue;
  [WRDAttributeType.Base_CreationLimitDate]: WRDDBBaseCreationLimitDateValue;
  [WRDAttributeType.Base_ModificationDate]: WRDDBBaseModificationDateValue;
  [WRDAttributeType.Base_Date]: WRDDBDateValue<false>;
  [WRDAttributeType.Base_GeneratedString]: WRDDBStringValue;
  [WRDAttributeType.Base_NameString]: WRDDBStringValue;
  [WRDAttributeType.Base_Domain]: WRDDBDomainValue<Required>;
  [WRDAttributeType.Base_Gender]: WRDDBBaseGenderValue;

  [WRDAttributeType.Free]: WRDDBStringValue;
  [WRDAttributeType.Email]: WRDDBStringValue;
  [WRDAttributeType.Telephone]: WRDDBStringValue;
  [WRDAttributeType.Url]: WRDDBStringValue;
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
      ? WRDDBEnumArrayValue<T["__options"], T["__required"]>
      : (T extends { __attrtype: WRDAttributeType.Date }
        ? WRDDBDateValue<T["__required"]>
        : (T extends { __attrtype: WRDAttributeType.DateTime }
          ? WRDDBDateTimeValue<T["__required"]>
          : never))));
