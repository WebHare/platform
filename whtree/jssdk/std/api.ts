//FIXME not sure yet if we should want the 'api' name for this library. Perhaps it should be 'apisupport' or .. ?

/** A relative (up to a week) or absolute wait period. Use 0 for 'polling' and Infinity to indicate anendless waits */
export type WaitPeriod = 0 | number | Date;

/** Convert a WaitPeriod parameter to a Date
 *  @param wait - Wait time as milliseconds or a Date
*/
export function convertWaitPeriodToDate(wait: WaitPeriod): Date {
  if (wait instanceof Date) {
    return wait;
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
