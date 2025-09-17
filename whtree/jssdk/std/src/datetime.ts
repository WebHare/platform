import { isDate, isTemporalInstant } from "./quacks";
import type { Temporal } from "temporal-polyfill"; //we need an explicit include for separate @webhare/std publication

/** A tolerant JS date parameter */
export type FlexibleInstant = Date | Temporal.Instant | Temporal.ZonedDateTime;

/** A relative (up to a week) or absolute wait period. Use 0 for 'polling' and Infinity to indicate an endless waits. Numbers are interpreted to be in milliseconds, a string is interpreted as a ISO8601 duration */
export type WaitPeriod = 0 | number | string | FlexibleInstant;
export interface Duration {
  sign: "+" | "-";
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

function parseMS(ms: string): number {
  if (ms.length === 2) //.5
    return parseInt(ms.substring(1)) * 100;
  if (ms.length === 3) //.54
    return parseInt(ms.substring(1)) * 10;
  return parseInt(ms.substring(1, 4));
}

/** Parse an ISO8601 duration
 * @param duration - ISO8601 duration string (e.g. "P1Y2M3DT4H5M6S")
 */
export function parseDuration(duration: string): Duration {
  // const matches = duration.match(/(-)?P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/);
  const matches = duration.match(/^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(\.\d+)?S)?)?$/);
  if (!matches ||
    (matches[4] && (matches[2] || matches[3] || matches[5])) || //can't have weeks and years/months/days
    !(matches[2] || matches[3] || matches[4] || matches[5] || matches[6] || matches[7] || matches[8])) //one component must be present
    throw new Error(`Invalid ISO8601 duration '${duration}'`);

  return {
    sign: matches[1] ? '-' : '+',
    years: parseInt(matches[2]) || 0,
    months: parseInt(matches[3]) || 0,
    weeks: parseInt(matches[4]) || 0,
    days: parseInt(matches[5]) || 0,
    hours: parseInt(matches[6]) || 0,
    minutes: parseInt(matches[7]) || 0,
    seconds: parseInt(matches[8]) || 0,
    milliseconds: matches[9] ? parseMS(matches[9]) : 0
  };
}

/** Add a duration (time) to a date
 * @param startingdate - Date to start from
 * @param duration - Duration to add (as object or as ISO8601 duration string, eg "P1Y2M3DT4H5M6S")
 */
export function addDuration(startingdate: Date, duration: Partial<Duration> | string): Date;
export function addDuration(startingdate: Temporal.Instant, duration: Partial<Duration> | string): Temporal.Instant;

export function addDuration(startingdate: Date | Temporal.Instant, duration: Partial<Duration> | string): Date | Temporal.Instant {
  if (isTemporalInstant(startingdate))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- if you pass a Temporal.Instant, we should be able to create new ones from Temporal.
    return (globalThis as any).Temporal.Instant.fromEpochMilliseconds(addDuration(new Date(startingdate.epochMilliseconds), duration).getTime());

  //we cannot take timezones (flexible instant) yet? as we do not timezone correct day/week/month calculations
  if (typeof duration === "string")
    duration = parseDuration(duration);

  const direction = duration.sign === "-" ? -1 : 1;
  const date = new Date(startingdate.getTime());
  if (duration.years)
    date.setUTCFullYear(date.getUTCFullYear() + direction * duration.years);
  if (duration.months)
    date.setUTCMonth(date.getUTCMonth() + direction * duration.months);

  const modifydays = (duration.days ?? 0) + (duration.weeks ?? 0) * 7;
  if (modifydays)
    date.setUTCDate(date.getUTCDate() + direction * modifydays);

  const timeoffset = (duration.hours ?? 0) * 60 * 60 * 1000 + (duration.minutes ?? 0) * 60 * 1000 + (duration.seconds ?? 0) * 1000 + (duration.milliseconds ?? 0);
  date.setTime(date.getTime() + direction * timeoffset);

  return date;
}

/** Subtract a duration (time) from a date
 * @param startingdate - Date to start from
 * @param duration - Duration to subtract (as object or as ISO8601 duration string, eg "P1Y2M3DT4H5M6S")
 */
export function subtractDuration(startingdate: Date, duration: Partial<Duration> | string): Date;
export function subtractDuration(startingdate: Temporal.Instant, duration: Partial<Duration> | string): Temporal.Instant;

export function subtractDuration(startingdate: Date | Temporal.Instant, duration: Partial<Duration> | string): Date | Temporal.Instant {
  if (isTemporalInstant(startingdate))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- if you pass a Temporal.Instant, we should be able to create new ones from Temporal.
    return (globalThis as any).Temporal.Instant.fromEpochMilliseconds(subtractDuration(new Date(startingdate.epochMilliseconds), duration).getTime());

  if (typeof duration === "string")
    duration = parseDuration(duration);

  return addDuration(startingdate, { ...duration, sign: duration?.sign === "-" ? "+" : "-" });
}

/** Convert a flexible instant to a date
 * @param input - Date, Temporal.Instant or Temporal.ZonedDateTime value to convert
 * @returns The converted date (or null if the input is null)
 */
export function convertFlexibleInstantToDate(input: FlexibleInstant): Date;
export function convertFlexibleInstantToDate(input: null | undefined): null;
export function convertFlexibleInstantToDate(input: FlexibleInstant | null | undefined): Date | null;

export function convertFlexibleInstantToDate(input: FlexibleInstant | null | undefined): Date | null {
  return input ? "epochMilliseconds" in input ? new Date(input.epochMilliseconds) : input : null;
}

export function convertWaitPeriodToDate(wait: WaitPeriod, options: { relativeTo: Temporal.Instant }): Temporal.Instant;
export function convertWaitPeriodToDate(wait: WaitPeriod, options?: { relativeTo?: Date }): Date;

/** Convert a WaitPeriod parameter to a Date
 * @param wait - Wait time as milliseconds or a Date
 * @param options - Options for conversion
 * @param options.relativeTo - Date to use as a reference for relative waits
*/
export function convertWaitPeriodToDate(wait: WaitPeriod, options?: { relativeTo?: Date | Temporal.Instant }): Date | Temporal.Instant {
  if (options?.relativeTo && isTemporalInstant(options?.relativeTo)) { //then our caller expects a Temporal.Instant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- if you pass a Temporal.Instant, we should be able to create new ones from Temporal.
    return (globalThis as any).Temporal.Instant.fromEpochMilliseconds(
      convertWaitPeriodToDate(wait, { relativeTo: new Date(options?.relativeTo.epochMilliseconds) }).getTime()
    );
  }

  if (isDate(wait)) {
    return wait;
  } else if (typeof wait === "string") {
    return addDuration(convertFlexibleInstantToDate(options?.relativeTo) ?? new Date(), wait); //NOTE that "P1D" here adds "24 hours" which is *not* correct for a TimeZonedDate - which is why convertWaitPeriodToDate cannot yet accept these
  } else if (typeof wait === "number") {
    if (wait === 0)
      return new Date(-864000 * 1000 * 10000000);
    if (wait === Infinity)
      return new Date(864000 * 1000 * 10000000);
    if (wait > 0) //note: options?.relativeTo can't be instant, we already eliminated that above
      return new Date(((options?.relativeTo as Date | undefined)?.getTime() ?? Date.now()) + wait);
  } else if (wait && "epochMilliseconds" in wait) { //Instant or ZonedDateTime
    return new Date(wait.epochMilliseconds);
  }

  throw new Error("Invalid wait duration - it must either be an absolute date, 0, a number of milliseconds or Infinity");
}

/** Check whether the specified parts make a valid and reasonable (usually 1600+) date */
export function isValidDate(year: number, month: number, day: number, { minYear = 1601 } = {}) {
  if (!(year >= minYear && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31
    && Number.isSafeInteger(year) && Number.isSafeInteger(month) && Number.isSafeInteger(day)))
    return false;
  if ([4, 6, 9, 11].includes(month) && day > 30) //handle april, june, sep, nov
    return false;
  const isleapyear = (year % 400) === 0 || ((year % 100) !== 0 && (year % 4) === 0);
  if (month === 2 && day > (isleapyear ? 29 : 28))
    return false;
  return true;
}

/** Check whether the specified parts make a reasonable time (does not consider the leap second a valid time) */
export function isValidTime(hour: number, minute: number, second: number, msec: number) {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59 && msec >= 0 && msec <= 999
    && Number.isSafeInteger(hour) && Number.isSafeInteger(minute) && Number.isSafeInteger(second) && Number.isSafeInteger(msec);
}

/** Returns a string containing a formatted date and time.
 * @param format  A string that specifies the format of the output string. The string can contain the following:
%%  Character %
%a  Abbreviated weekday name
%A  Full weekday name
%b  Abbreviated month name
%B  Full month name
%d  Two-digit day of month (01 - 31)
%#d Two-digit day of month, remove any leading zeros
%H  Hour of the day, 24 hour day
%#H Hour of the day, 24 hour day, remove any leading zeros
%I  Two-digit hour, 12 hour day (01 - 12)
%#I Two-digit hour, 12 hour day, remove any leading zeros
%j  Three-digit day of year (001 - 366)
%#j Three-digit day of year, remove any leading zeros
%m  Two-digit month number (01 - 12)
%#m Two-digit month number, remove any leading zeros
%M  2-digit minute (00 - 59)
%#M 2-digit minute, remove leading any zeros
%Q  Three-digit millisecond (000-999)
%#Q Three-digit millisecond, remove any leading zeros
%p  AM or PM
%S  Two-digit second (00 - 59)
%#S Two-digit second, remove leading any zeros
%V  Two-digot week number (00 - 52)
%#V One-digit week number (0 - 52)
%y  Two-digit year without century (00 to 99)
%#y Two-digit year without century, remove any leading zeros
%Y  Year with century
%#Y Year with century, remove any leading zeros
   @param zdt          The date/time value to format.
   @example
// The current date and time in German in the format: 01 Januar 2005
const example1 = formatDateTime("%d %B %Y", Temporal.Instant.now(), { locale: "de-DE" });

// The current day of the week in the Dutch language, using the
// parameter datetexts as language switch.
// The date format is <abbreviated> - <full>.
const example2 = formatDateTime("%a - %B ", new Date, { locale: "nl-NL" });
*/

export function formatDateTime(format: string, zdt: Temporal.ZonedDateTime, options?: { locale: string }): string {
  //TODO consider allowing Date & Instant too? might avoid users going for things like toString().replace("T", " ").replace("Z", "")
  //const zdt: Temporal.ZonedDateTime = date instanceof Date ? date.toTemporalInstant().toZonedDateTimeISO('UTC') : "year" in date ? date : date.toZonedDateTimeISO('UTC');
  const locale = options?.locale || 'en-US';
  let stripZeroes = false;

  function formatNumber(num: number, length: number): string {
    return stripZeroes ? num.toString() : num.toString().padStart(length, '0');
  }

  function formatPart(spec: string): string {
    switch (spec) {
      case 'a': //dayofweek name, abbreviated
        return zdt.toLocaleString(locale, { weekday: 'short' });
      case 'A': //dayofweek name, full
        return zdt.toLocaleString(locale, { weekday: 'long' });
      case 'b':  //month name, abbreviated
        return zdt.toLocaleString(locale, { month: 'short' });
      case 'B': //month name, abbreviated
        return zdt.toLocaleString(locale, { month: 'long' });
      case 'C': //century number
        return formatNumber(Math.floor(zdt.year / 100), 2);
      case 'd':  //day of month
        return formatNumber(zdt.day, 2);
      case 'H':  //hour of the day (24 hours format)
        return formatNumber(zdt.hour, 2);
      case 'I'://hour of the day (12 hours format)
        return formatNumber((zdt.hour % 12) || 12, 2);
      case 'j'://day of the year (three-digit)
        return formatNumber(zdt.dayOfYear, 3);
      case 'M'://two digit minute
        return formatNumber(zdt.minute, 2);
      case 'm'://two digit month
        return formatNumber(zdt.month, 2);
      case 'p'://am/pm
        //Unfortunately this doesn't return am/pm: return zdt.toLocaleString(locale, { dayPeriod: 'narrow', hourCycle: "h12" });
        return zdt.hour < 12 ? "am" : "pm";
      case 'Q'://three digit millisecond
        return formatNumber(Math.floor(zdt.millisecond), 3);
      case 'S'://two digit second
        return formatNumber(zdt.second, 2);
      case 'V'://week number
        if (zdt.weekOfYear === undefined)
          throw new Error("Week of year is not defined for this calendar");
        return formatNumber(zdt.weekOfYear, 2);
      case 'Y'://year, with century
        return formatNumber(zdt.year, 4);
      case 'y'://year, without century
        return formatNumber(zdt.year % 100, 2);
      default:
        throw new Error(`Invalid date format specifier '%${spec}'`);
    }
  }

  let out = '', inSpecifier = false;
  for (const spec of [...format]) {
    if (inSpecifier) {
      if (spec === '#') {
        stripZeroes = true;
        continue; //get the next char
      }

      inSpecifier = false;
      if (spec === '%') {
        out += '%';
        continue;
      }
      out += formatPart(spec);
    } else {
      if (spec === '%') {
        inSpecifier = true;
        stripZeroes = false; //reset it
        continue;
      }
      out += spec;
    }
  }
  if (inSpecifier)
    throw new Error("Invalid date format string, ends with single %");

  return out;
}
