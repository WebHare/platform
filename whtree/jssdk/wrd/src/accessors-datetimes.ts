import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { EncodedValue, NullIfNotRequired } from "./accessors";
import type { EntityPartialRec, EntitySettingsRec } from "./db";
import type { ValueQueryChecker } from "./checker";
import type { SelectQueryBuilder } from "kysely";
import { cmp, getAttrBaseCells, matchesValueWithCmp, WRDAttributeValueBase, type AddToQueryResponse } from "./accessors-support";
import { dateToParts, defaultDateTime, makeDateFromParts, maxDateTime, maxDateTimeTotalMsecs } from "@webhare/hscompat/src/datetime";
import { isDate, isTemporalInstant, isTemporalPlainDate } from "@webhare/std";

type WRDDBDateConditions<ModernSchema extends boolean> = {
  condition: "=" | "!="; value: (ModernSchema extends true ? Temporal.PlainDate : Date) | null;
} | {
  condition: ">=" | "<=" | "<" | ">"; value: ModernSchema extends true ? Temporal.PlainDate : Date;
} | {
  condition: "in"; value: ReadonlyArray<(ModernSchema extends true ? Temporal.PlainDate : Date) | null>;
};

/* Base for date validation.
   Note that with dates ... accepting Date (or HS DATETIME) is pretty dangerous as Date objects may also have a time and unexpected things
   may happen with non-midnight dates. So we don't accept any form of Date with 'modern' WRD integrations

   For datetime values it's not such a problem to allow mixing Date & Temporal.Instant
   */

abstract class WRDDBPlainDateValueBase<Required extends boolean, ModernSchema extends boolean> extends WRDAttributeValueBase<
  (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>,
  (ModernSchema extends true ? Temporal.PlainDate : Date) | null,
  (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>,
  string | NullIfNotRequired<Required>,
  WRDDBDateConditions<ModernSchema>
> {
  getDefaultValue(): null { return null; }
  isSet(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | null) { return Boolean(value); }

  matchesValue(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | null, cv: WRDDBDateConditions<ModernSchema>): boolean {
    return matchesValueWithCmp(value, cv);
  }

  exportValue(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>): string | NullIfNotRequired<Required> {
    if (value === null)
      return null as unknown as string; //pretend it's all right, we shouldn't receive a null anyway if Required was set

    if (isDate(value)) {
      return value.toISOString().substring(0, 10); //only return the Date part "2004-01-01"
    } else {
      return value.toString(); // Temporal.PlainDate to string
    }
  }

  importValue(value: string | (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>): (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required> {
    type RetVal = (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>;
    if (typeof value === "string") {
      try {
        if (this.type.legacySchema)
          return new Date(Temporal.PlainDate.from(value).toZonedDateTime("UTC").epochMilliseconds) as RetVal; //Temporal parser actually limits itselfs to dates
        else
          return Temporal.PlainDate.from(value) as RetVal;
      } catch (e) {
        throw new Error(`Invalid value ${JSON.stringify(value)} for date attribute ${this.attr.fullTag}`);
      }
    }
    return value;
  }
}

export class WRDDBDateValue<Required extends boolean, ModernSchema extends boolean> extends WRDDBPlainDateValueBase<Required, ModernSchema> {
  checkFilter({ condition, value }: WRDDBDateConditions<ModernSchema>) {
    /* always ok */
  }
  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required> {
    type RetVal = (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>;
    const parts = entity_settings[settings_start].rawdata.split(",");
    if (Number(parts[0]) >= 2147483647)
      return null as NullIfNotRequired<Required>; // invalid date, return null
    const dt = makeDateFromParts(Number(parts[0]), 0);
    if (!this.type.legacySchema)
      return dt.toTemporalInstant().toZonedDateTimeISO("UTC").toPlainDate() as RetVal;
    else
      return dt as RetVal;
  }

  validateInput(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string) {
    if (value === null) {
      if (this.attr.required && !checker.importMode && (!checker.temp || attrPath))
        throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      return;
    }

    if (this.type.legacySchema) {
      if (!isDate(value) || isNaN(value.getTime()))
        throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      if (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs)
        throw new Error(`Not allowed use defaultDateTime of maxDateTime for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    } else {
      if (!isTemporalPlainDate(value))
        throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    }
  }

  encodeValue(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | NullIfNotRequired<Required>): EncodedValue {
    if (!value)
      return {};
    const asDate = isTemporalPlainDate(value) ? new Date(value.toZonedDateTime("UTC").epochMilliseconds) : value;
    const parts = dateToParts(asDate);
    return { settings: { rawdata: parts.days.toString(), attribute: this.attr.id } };
  }
}

export class WRDDBBaseDateValue<ModernSchema extends boolean> extends WRDDBPlainDateValueBase<false, ModernSchema> {
  validateFilterInput(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | null) {
    if (value && isDate(value) && (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime, use null`);
  }
  checkFilter(cv: WRDDBDateConditions<ModernSchema>) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.validateFilterInput(v));
    else
      this.validateFilterInput(cv.value);
  }
  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDateConditions<ModernSchema>): AddToQueryResponse<O> {
    let fieldname: "dateofbirth" | "dateofdeath";
    if (this.attr.tag === "wrdDateOfBirth")
      fieldname = "dateofbirth";
    else if (this.attr.tag === "wrdDateOfDeath")
      fieldname = "dateofdeath";
    else
      throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);

    const asDateCv: WRDDBDateConditions<false> =
      cv.condition === "in"
        ? { condition: "in", value: (cv.value.map(v => v ? isDate(v) ? v : new Date(v.toZonedDateTime("UTC").epochMilliseconds) : defaultDateTime)) }
        : { condition: cv.condition, value: (cv.value ? isDate(cv.value) ? cv.value : new Date(cv.value.toZonedDateTime("UTC").epochMilliseconds) : defaultDateTime) };

    if (asDateCv.condition === "in" && !asDateCv.value.length)
      return null; // no results!

    query = query.where(fieldname, asDateCv.condition, asDateCv.value);
    return { needaftercheck: false, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): null {
    throw new Error(`not used`);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): (ModernSchema extends true ? Temporal.PlainDate : Date) | null {
    type RetVal = (ModernSchema extends true ? Temporal.PlainDate : Date) | null;
    let val: Date | undefined;
    if (this.attr.tag === "wrdDateOfBirth")
      val = entityrec.dateofbirth;
    else if (this.attr.tag === "wrdDateOfDeath")
      val = entityrec.dateofdeath;
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);

    if (!val || val.getTime() <= defaultDateTime.getTime() || val.getTime() >= maxDateTimeTotalMsecs)
      return null;

    if (this.type.legacySchema)
      return val as RetVal;
    else
      return val.toTemporalInstant().toZonedDateTimeISO("UTC").toPlainDate() as RetVal;
  }

  validateInput(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | null, checker: ValueQueryChecker, attrPath: string) {
    if (value === null) {
      if (this.attr.required && !checker.importMode && (!checker.temp || attrPath))
        throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      return;
    }

    //TODO the wrdDateOfXX checks are probably incorrect for positive time zones that already passed midnight before UTC did
    if (this.type.legacySchema) {
      if (!isDate(value) || isNaN(value.getTime()))
        throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      if (value.getTime() <= defaultDateTime.getTime() || value.getTime() > maxDateTimeTotalMsecs)
        throw new Error(`Not allowed use defaultDateTime of maxDateTime, use null for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      if (["wrdDateOfDeath", "wrdDateOfBirth"].includes(this.attr.tag) && value.getTime() > Date.now() && !checker.importMode)
        throw new Error(`Provided '${this.attr.tag}' in the future for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    } else {
      if (!isTemporalPlainDate(value))
        throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      if (["wrdDateOfDeath", "wrdDateOfBirth"].includes(this.attr.tag) && value.toZonedDateTime("UTC").epochMilliseconds > Date.now() && !checker.importMode)
        throw new Error(`Provided '${this.attr.tag}' in the future for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
    }
  }

  getAttrBaseCells(): keyof EntityPartialRec {
    return getAttrBaseCells(this.attr.tag, ["wrdDateOfBirth", "wrdDateOfDeath"]);
  }

  encodeValue(value: (ModernSchema extends true ? Temporal.PlainDate : Date) | null): EncodedValue {
    if (!value)
      return { entity: { [this.getAttrBaseCells()]: defaultDateTime } };

    const asDate = isTemporalPlainDate(value) ? new Date(value.toZonedDateTime("UTC").epochMilliseconds) : value;
    return { entity: { [this.getAttrBaseCells()]: asDate } };
  }
}

//////////////////////////////////////
//
// DATE and DATETIME support

// DATE and DATETIME shared
export type WRDDBDateTimeConditions<AllowInstants> = {
  condition: "=" | "!="; value: Date | (AllowInstants extends true ? Temporal.Instant : never) | null;
} | {
  condition: ">=" | "<=" | "<" | ">"; value: Date | (AllowInstants extends true ? Temporal.Instant : never);
} | {
  condition: "in"; value: ReadonlyArray<Date | (AllowInstants extends true ? Temporal.Instant : never) | null>;
};

abstract class WRDDBDateValueBase<Required extends boolean, ModernSchema extends boolean> extends WRDAttributeValueBase<
  Temporal.Instant | Date | NullIfNotRequired<Required>,
  Temporal.Instant | Date | null,
  (ModernSchema extends true ? Temporal.Instant : Date) | NullIfNotRequired<Required>,
  string | NullIfNotRequired<Required>,
  WRDDBDateTimeConditions<true>> {
  getDefaultValue(): null { return null; }
  isSet(value: Temporal.Instant | Date | null) { return Boolean(value); }
}

// Plain DATEs: type Date, field wrdDateOfBirth, wrdDateOfDeath

// DATETIMEs: type DateTime, field wrdCreationDate, wrdLimitDate, wrdModificationDate

abstract class WRDDBDateTimeValueBase<Required extends boolean, ModernSchema extends boolean> extends WRDDBDateValueBase<Required, ModernSchema> {
  exportValue(value: Temporal.Instant | Date | NullIfNotRequired<Required>): string | NullIfNotRequired<Required> {
    if (value === null)
      return null as unknown as string; //pretend it's all right, we shouldn't receive a null anyway if Required was set

    let retval = "toISOString" in value ? value.toISOString() : value.toString();
    if (retval.endsWith(".000Z")) // remove milliseconds if they are 0
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

  protected asDateTimeCv(cv: WRDDBDateTimeConditions<true>): WRDDBDateTimeConditions<false> {
    return cv.condition === "in"
      ? { condition: "in", value: (cv.value.map(v => v ? isDate(v) ? v : new Date(v.epochMilliseconds) : defaultDateTime)) }
      : { condition: cv.condition, value: (cv.value ? isDate(cv.value) ? cv.value : new Date(cv.value.epochMilliseconds) : defaultDateTime) };
  }
}

export class WRDDBDateTimeValue<Required extends boolean, ModernSchema extends boolean> extends WRDDBDateTimeValueBase<Required, ModernSchema> {
  checkFilter({ condition, value }: WRDDBDateTimeConditions<true>) {
    /* always ok */
  }
  matchesValue(value: Temporal.Instant | Date | null, cv: WRDDBDateTimeConditions<true>): boolean {
    return matchesValueWithCmp(value, cv);
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): (ModernSchema extends true ? Temporal.Instant : Date) | NullIfNotRequired<Required> {
    const parts = entity_settings[settings_start].rawdata.split(",");
    if (Number(parts[0]) >= 2147483647)
      return null as (ModernSchema extends true ? Temporal.Instant : Date) | NullIfNotRequired<Required>;
    const dt = makeDateFromParts(Number(parts[0]), Number(parts[1]));
    return (this.type.legacySchema ? dt : Temporal.Instant.fromEpochMilliseconds(dt.getTime())) as (ModernSchema extends true ? Temporal.Instant : Date) | NullIfNotRequired<Required>;
  }

  validateInput(value: Date | Temporal.Instant | NullIfNotRequired<Required>, checker: ValueQueryChecker, attrPath: string) {
    if (value === null) {
      if (this.attr.required && !checker.importMode && (!checker.temp || attrPath))
        throw new Error(`Provided default value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
      return;
    }

    if (isTemporalInstant(value))
      return;
    if (!isDate(value) || isNaN(value.getTime()))
      throw new Error(`Invalid date value for attribute ${checker.typeTag}.${attrPath}${this.attr.tag}`);
  }

  encodeValue(value: Date | Temporal.Instant | NullIfNotRequired<Required>): EncodedValue {
    if (!value)
      return {};

    const asDate = isDate(value) ? value : new Date(value.epochMilliseconds);
    const parts = dateToParts(asDate);
    return { settings: { rawdata: `${parts.days.toString()},${parts.msecs.toString()}`, attribute: this.attr.id } };
  }
}

export class WRDDBBaseCreationLimitDateValue<ModernSchema extends boolean> extends WRDDBDateTimeValueBase<false, ModernSchema> {
  validateFilterInput(value: Temporal.Instant | Date | null) {
    if (value && isDate(value) && (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime`);
  }

  checkFilter(cv: WRDDBDateTimeConditions<true>) {
    if (cv.condition === "in")
      cv.value.forEach(v => this.validateFilterInput(v));
    else
      this.validateFilterInput(cv.value);
  }
  matchesValue(value: Temporal.Instant | Date | null, cv: WRDDBDateTimeConditions<true>): boolean {
    return matchesValueWithCmp(value, cv);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions<true>): AddToQueryResponse<O> {
    const defaultMatches = this.matchesValue(this.getDefaultValue(), cv);

    let fieldname: "creationdate" | "limitdate";
    if (this.attr.tag === "wrdCreationDate" || this.attr.tag === "wrdCreated")
      fieldname = "creationdate";
    else if (this.attr.tag === "wrdLimitDate" || this.attr.tag === "wrdClosed")
      fieldname = "limitdate";
    else
      throw new Error(`Unhandled base string attribute ${JSON.stringify(this.attr.tag)}`);

    const asDateTimeCv = this.asDateTimeCv(cv);
    if (asDateTimeCv.condition === "in" && !asDateTimeCv.value.length)
      return null; // no results!

    const maxDateTimeMatches = this.matchesValue(maxDateTime, cv);
    if (defaultMatches && !maxDateTimeMatches) {
      query = query.where(qb => qb.or([
        qb(fieldname, cv.condition, asDateTimeCv.value),
        qb(fieldname, "=", maxDateTime)
      ]));
    } else {
      query = query.where(fieldname, cv.condition, asDateTimeCv.value);
      if (maxDateTimeMatches && !defaultMatches)
        query = query.where(fieldname, "!=", maxDateTime);
    }
    return { needaftercheck: false, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): null {
    throw new Error(`not used`);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): (ModernSchema extends true ? Temporal.Instant : Date) | null {
    let val: Date | number | undefined;
    if (this.attr.tag === "wrdCreationDate" || this.attr.tag === "wrdCreated")
      val = entityrec.creationdate as Date | number;
    else if (this.attr.tag === "wrdLimitDate" || this.attr.tag === "wrdClosed")
      val = entityrec.limitdate as Date | number;
    else
      throw new Error(`Unhandled base domain attribute ${JSON.stringify(this.attr.tag)}`);
    if (typeof val === "number") // -Infinity and Infinity
      return null;
    if (!val || val.getTime() <= defaultDateTime.getTime() || val.getTime() >= maxDateTimeTotalMsecs)
      return null;
    return (this.type.legacySchema ? val : val.toTemporalInstant()) as ModernSchema extends true ? Temporal.Instant : Date;
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
    return getAttrBaseCells(this.attr.tag, ["wrdCreationDate", "wrdLimitDate", "wrdCreated", "wrdClosed"]);
  }

  encodeValue(value: Date | null): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value ?? maxDateTime } };
  }
}

export class WRDDBBaseModificationDateValue<ModernSchema extends boolean> extends WRDDBDateTimeValueBase<true, ModernSchema> {
  validateFilterInput(value: Temporal.Instant | Date | null) {
    if (value && isDate(value) && (value.getTime() <= defaultDateTime.getTime() || value.getTime() >= maxDateTimeTotalMsecs))
      throw new Error(`Not allowed to use defaultDateTime or maxDateTime`);
  }

  checkFilter(cv: WRDDBDateTimeConditions<true>) {
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
  matchesValue(value: Date, cv: WRDDBDateTimeConditions<true>): boolean {
    if (cv.condition === "in") {
      return cv.value.includes(value);
    }
    return cmp(value, cv.condition, cv.value);
  }

  addToQuery<O>(query: SelectQueryBuilder<PlatformDB, "wrd.entities", O>, cv: WRDDBDateTimeConditions<true>): AddToQueryResponse<O> {
    const asDateTimeCv = this.asDateTimeCv(cv);
    if (asDateTimeCv.condition === "in" && !asDateTimeCv.value.length)
      return null; // no results!

    query = query.where("modificationdate", asDateTimeCv.condition, asDateTimeCv.value);
    return { needaftercheck: false, query };
  }

  getFromRecord(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number): ModernSchema extends true ? Temporal.Instant : Date {
    throw new Error(`not used`);
  }

  getValue(entity_settings: EntitySettingsRec[], settings_start: number, settings_limit: number, entityrec: EntityPartialRec): (ModernSchema extends true ? Temporal.Instant : Date) {
    const value =
      (!entityrec.modificationdate || entityrec.modificationdate.getTime() <= defaultDateTime.getTime() || entityrec.modificationdate.getTime() >= maxDateTimeTotalMsecs)
        ? defaultDateTime
        : entityrec.modificationdate;

    return (this.type.legacySchema ? value : value.toTemporalInstant()) as ModernSchema extends true ? Temporal.Instant : Date;
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
    return getAttrBaseCells(this.attr.tag, ["wrdModificationDate", "wrdModified"]);
  }

  encodeValue(value: Date | null): EncodedValue {
    return { entity: { [this.getAttrBaseCells()]: value } };
  }
}
