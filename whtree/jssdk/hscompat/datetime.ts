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

export function utcToLocal(utc: Date, timeZone: string) {
  if (utc.getTime() >= maxDateTimeTotalMsecs || utc.getTime() < defaultDateTime.getTime())
    return utc;
  const raw = Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    fractionalSecondDigits: 3,
  }).format(utc);

  const toparse = raw.replace(" ", "T").replace(",", ".") + `Z`;
  return new Date(toparse);
}

export function localToUTC(local: Date, timeZone: string) {
  // Calculate the timezone offsets a day before and a day after the local date (pretending local is UTC)
  const localTimeMs = local.getTime();
  if (localTimeMs >= maxDateTimeTotalMsecs || localTimeMs < defaultDateTime.getTime())
    return local;
  const preOffset = utcToLocal(new Date(localTimeMs - 86400000), timeZone).getTime() - localTimeMs + 86400000;
  const postOffset = utcToLocal(new Date(localTimeMs + 86400000), timeZone).getTime() - localTimeMs - 86400000;

  // When resolving tot he correct local time, prefer the offset from the day after
  const postCorrected = new Date(localTimeMs - postOffset);
  if (utcToLocal(postCorrected, timeZone).getTime() === localTimeMs)
    return postCorrected;
  return new Date(localTimeMs - preOffset);
}
