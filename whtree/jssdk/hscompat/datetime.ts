/* new Date(100000000 * 86400000) is also valid, but to keep parity with HS we set
   it at the very last millisecond of a day
*/
export const maxDateTimeTotalMsecs = 100000000 * 86400000 - 1;

/** Maximum representable datetime
*/
export const maxDateTime: Date = Object.freeze(new Date(maxDateTimeTotalMsecs));
export const defaultDateTime: Date = Object.freeze(new Date(-719163 * 86400000));

export function makeDateFromParts(daycount: number, msecs: number): Date {
  return new Date(Date.UTC(1970, 0, daycount - 719162, 0, 0, 0, msecs));
}
