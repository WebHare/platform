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
