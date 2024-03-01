/** A relative (up to a week) or absolute wait period. Use 0 for 'polling' and Infinity to indicate an endless waits. Numbers are interpreted to be in milliseconds, a string is interpreted as a ISO8601 duration */
export type WaitPeriod = 0 | number | string | Date;

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

/** Test whether a value is a date (even if crossrealm, unlike instanceOf) */
export function isDate(value: unknown): value is Date {
  return value instanceof Date || ((value instanceof Object) === false && (value as object)?.constructor?.name === "Date");
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

/** Add a duration (time) to a date */
export function addDuration(startingdate: Date, duration: Partial<Duration> | string): Date {
  if (typeof duration === "string")
    duration = parseDuration(duration);

  const direction = duration.sign === "-" ? -1 : 1;
  const date = new Date(startingdate);
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

/** Convert a WaitPeriod parameter to a Date
 *  @param wait - Wait time as milliseconds or a Date
*/
export function convertWaitPeriodToDate(wait: WaitPeriod): Date {
  if (isDate(wait)) {
    return wait;
  } else if (typeof wait === "string") {
    return addDuration(new Date(), wait);
  } else if (typeof wait === "number") {
    if (wait === 0)
      return new Date(-864000 * 1000 * 10000000);
    if (wait === Infinity)
      return new Date(864000 * 1000 * 10000000);
    if (wait > 7 * 86400 * 1000)
      throw new Error("Invalid wait duration - a wait may not be longer than a week"); //prevents you from passing in Date.now() based values
    if (wait > 0)
      return new Date(Date.now() + wait);
  }

  throw new Error("Invalid wait duration - it must either be an absolute date, 0, a number of milliseconds or Infinity");
}
