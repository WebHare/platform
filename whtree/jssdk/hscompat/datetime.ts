export type ValidDateTimeSources = Date | Temporal.Instant | Temporal.PlainDateTime | Temporal.PlainDate | Temporal.ZonedDateTime;

/* new Date(100000000 * 86400000) is also valid, but to keep parity with HS we set
   it at the very last millisecond of a day
*/
export const maxDateTimeTotalMsecs = 100000000 * 86400000 - 1;

/** Maximum representable datetime
*/
export const maxDateTime: Date = Object.freeze(new Date(maxDateTimeTotalMsecs));
export const defaultDateTime: Date = Object.freeze(new Date(-719163 * 86400000));

export function makeDateFromParts(days: number, msecs: number): Date {
  days -= 719163;
  const totalmsecs = days * 86400000 + msecs;
  if (totalmsecs >= maxDateTimeTotalMsecs)
    return maxDateTime;
  return new Date(totalmsecs);
}

/** Convert a date to msecs/days since the HareScript epoch (1-1-0001), ie the 'DATETIME parts'
 * @param date - The date to convert
 * @returns - The number of days and milliseconds since the January 1st 0001 assuming a Gregorian calendar since that epoch
 */
export function dateToParts(date: ValidDateTimeSources): { days: number; msecs: number } {
  const totalmsecs = "epochMilliseconds" in date ? date.epochMilliseconds : "getTime" in date ? date.getTime() : date.toZonedDateTime("UTC").epochMilliseconds;
  let days, msecs;
  if (totalmsecs >= maxDateTimeTotalMsecs) {
    days = 2147483647;
    msecs = 86400000 - 1;
  } else {
    days = Math.floor(totalmsecs / 86400000);
    msecs = totalmsecs - days * 86400000;
    days += 719163; // 1970-1-1
    if (days < 0 || msecs < 0) {
      days = 0;
      msecs = 0;
    }
  }
  return { days, msecs };
}

const intlCache = new Map<string, Intl.DateTimeFormat>;

/** @deprecated Switch to Temporal (or use temporal-polyfill) */
export function utcToLocal(utc: Date, timeZone: string) {
  if (utc.getTime() >= maxDateTimeTotalMsecs || utc.getTime() < defaultDateTime.getTime())
    return utc;
  let intl = intlCache.get(timeZone);
  if (!intl) {
    // Use the Swedish locale, because it formats dates like `YYYY-MM-DD HH:MM:SS,QQQ`, which is very close the the ISO8601 format needed for reliable parsing.
    intlCache.set(timeZone, intl = Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    }));
  }
  const raw = intl.format(utc);
  const toparse = raw.replace(" ", "T").replace(",", ".") + `Z`;
  return new Date(toparse);
}

/** @deprecated Switch to Temporal (or use temporal-polyfill) */
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

export type FormatISO8601DateOptions = {
  dateFormat?: "year" | "month" | "day" | "empty";
  timeFormat?: "hours" | "minutes" | "seconds" | "milliseconds" | "empty";
  timeZone?: string;
  extended?: boolean;
};

export function formatISO8601Date(date: Date, options?: FormatISO8601DateOptions) {

  if (options?.dateFormat === "empty" && options.timeFormat === "empty")
    return "";

  // Quick-n-dirty timezone conversion, relying on the fact that the Swedish locale uses ISO8601 date/time notation
  const formatOptions: Intl.DateTimeFormatOptions = { timeZone: options?.timeZone || "UTC" };
  // If timezone other than UTC, add timezone to formatter
  if (options?.timeZone !== "UTC" && options?.timeFormat !== "empty")
    formatOptions.timeZoneName = "longOffset";

  switch (options?.dateFormat || "day") {
    case "day": {
      formatOptions.day = "2-digit";
    } // fallthrough
    case "month": {
      formatOptions.month = "2-digit";
    } // fallthrough
    case "year": {
      formatOptions.year = "numeric";
      break;
    }
    case "empty": {
      break;
    }
  }
  switch (options?.timeFormat ?? "seconds") {
    case "milliseconds": {
      formatOptions.fractionalSecondDigits = 3;
    } // fallthrough
    case "seconds": {
      formatOptions.second = "2-digit";
    } // fallthrough
    case "minutes": {
      formatOptions.minute = "2-digit";
    } // fallthrough
    case "hours": {
      formatOptions.hour = "2-digit";
      break;
    }
    case "empty": {
      break;
    }
  }

  let value = Intl.DateTimeFormat("sv-SE", formatOptions).format(date).replace(" ", "T");
  if (options?.timeFormat !== "empty") {
    if (options?.timeZone === "UTC")
      value += "Z"; // Just add "Z"
    else
      value = value.replace(" GMT", ""); // Remove the " GMT" part from " GMT+xxxx"
    if (options?.timeFormat === "milliseconds")
      value = value.replace(",", "."); // Replace decimal separator
  }

  /* For month representation, only the extended format is allowed.
     According to Wikipedia (http://en.wikipedia.org/wiki/ISO_8601):

         Although the standard allows both the YYYY-MM-DD and YYYYMMDD formats for complete calendar date representations,
         if the day [DD] is omitted then only the YYYY-MM format is allowed. By disallowing dates of the form YYYYMM, the
         standard avoids confusion with the truncated representation YYMMDD (still often used).

     Also, don't replace the millisecond separator, it's not optional in the non-extended format.
  */
  if (!options?.extended) {
    if (options?.dateFormat !== "month")
      value = value.replaceAll(/[-:]/g, "");
    else
      value = value.replaceAll(/[:]/g, "");
  }
  return value;
}

export function localizeDate(format: string, date: Date, locale: string, timeZone: string = "UTC") {
  const options: Intl.DateTimeFormatOptions = {};

  // Parse an ICU date/time formatting string into DateTimeFormatOptions
  // https://unicode-org.github.io/icu/userguide/format_parse/datetime/#datetime-format-syntax
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#parameters
  let parsing = ""; // The symbol we're currently parsing, or "'" for quoted text, or "" for other characters
  let symbol = ""; // The currently parsed symbol
  let maybeQuote = false; // For detection of "''", signifying an escaped single quote
  // Iterate over all characters (add an empty string to emit the last parsed option)
  for (const char of [...format, ""]) {
    if (/[a-zA-Z]/.test(char) && char === parsing) {
      // This is a character of the symbol we're currently parsing, add it to the parsed symbol
      symbol += char;
    } else {
      if (symbol && parsing !== "'") {
        // We encountered a new symbol or other character, update the options for the parsed symbol
        switch (parsing) {
          case "": break; // We have been parsing other text, skip it
          case "E": { // day of week
            options.weekday = symbol.length <= 3 ? "short" : symbol.length === 4 ? "long" : "narrow";
            break;
          }
          case "G": { // era designator
            options.era = symbol.length <= 3 ? "short" : symbol.length === 4 ? "long" : "narrow";
            break;
          }
          case "y": { // year
            options.year = symbol.length === 2 ? "2-digit" : "numeric";
            break;
          }
          case "M": { // month in year
            options.month = symbol.length === 1 ? "numeric" : symbol.length === 2 ? "2-digit" : symbol.length === 3 ? "short" : symbol.length === 4 ? "long" : "narrow";
            break;
          }
          case "d": { // day in month
            options.day = symbol.length === 2 ? "2-digit" : "numeric";
            break;
          }
          case "B": { // flexible day periods
            options.dayPeriod = symbol.length <= 3 ? "short" : symbol.length === 4 ? "long" : "narrow";
            break;
          }
          case "h": { // hour in am/pm (1~12)
            options.hour = symbol.length === 2 ? "2-digit" : "numeric";
            options.hourCycle = "h12";
            break;
          }
          case "H": { // hour in day (0~23)
            options.hour = symbol.length === 2 ? "2-digit" : "numeric";
            options.hourCycle = "h23";
            break;
          }
          case "k": { // hour in day (1~24)
            options.hour = symbol.length === 2 ? "2-digit" : "numeric";
            options.hourCycle = "h24";
            break;
          }
          case "K": { // hour in day (0~11)
            options.hour = symbol.length === 2 ? "2-digit" : "numeric";
            options.hourCycle = "h11";
            break;
          }
          case "j": { // hour in day (locale-dependent, not in official documentation)
            options.hour = symbol.length === 2 ? "2-digit" : "numeric";
            // Don't set hourCycle for locale-dependent display
            break;
          }
          case "m": { // minute in hour
            options.minute = symbol.length === 2 ? "2-digit" : "numeric";
            break;
          }
          case "s": { // second in minute
            options.second = symbol.length === 2 ? "2-digit" : "numeric";
            break;
          }
          case "S": { // fractional second
            // Only lengths 1-3 have a corresponding DateTimeFormat option
            if (symbol.length > 0 && symbol.length <= 3)
              //@ts-ignore We know that the length is either 1, 2 or 3
              options.fractionalSecondDigits = symbol.length;
            break;
          }
          case "z": { // Time Zone: specific non-location
            options.timeZoneName = symbol.length <= 3 ? "short" : "long";
            break;
          }
          case "Z": { // Time Zone: long localized
            // Only 'ZZZZ' (long localized GMT) has a corresponding DateTimeFormat option
            if (symbol.length === 4)
              options.timeZoneName = "longOffset";
            else
              throw new Error(`Unsupported date field symbol '${symbol}'`);
            break;
          }
          case "O": { // Time Zone: short & long localized GMT
            // Only 'O' and 'OOOO' are valid values
            if (symbol.length === 1)
              options.timeZoneName = "shortOffset";
            else if (symbol.length === 4)
              options.timeZoneName = "longOffset";
            break;
          }
          case "v": { // Time Zone: generic non-location
            // Only 'v' and 'vvvv' are valid values
            if (symbol.length === 1)
              options.timeZoneName = "shortGeneric";
            else if (symbol.length === 4)
              options.timeZoneName = "longGeneric";
            break;
          }
          default: {
            // All other symbols don't have corresponding DateTimeFormat options
            throw new Error(`Unsupported date field symbol '${symbol}'`);
          }
        }
      }
      if (parsing !== "'" && /[a-zA-Z]/.test(char)) {
        // This is the new symbol we're matching (all letters and only letters are symbols, unless they're enclosed within
        // single quotes)
        parsing = char;
        symbol = char;
        maybeQuote = false;
      } else {
        if (char === "'") {
          // If the previous character was a quote, we've encountered an escaped quote, otherwise maybe this quote escapes
          // the next quote
          if (maybeQuote) {
            maybeQuote = false;
          } else {
            maybeQuote = true;
          }
          // Either stop or start processing quoted text (note that an escaped quote either stops and immediately starts or
          // starts and immediately stops parsing quoted text, we don't have to process escaped quotes separately)
          if (parsing === "'")
            parsing = "";
          else
            parsing = "'";
        } else {
          // Other text, no longer expect an escaped quote
          maybeQuote = false;
          // Reset the current symbol, so it will be add to the options
          if (parsing !== "'")
            parsing = "";
        }
      }
    }
  }
  return Intl.DateTimeFormat(locale, { ...options, timeZone, formatMatcher: "basic" }).format(date);
}

/** Round down a datetime
    @param dt - Datetime to round down
    @param precision - Precision in milliseconds (eg, 1000 to round down to seconds, 86400*1000 to round down to a day)
    @returns - Rounded datetime
*/
export function getRoundedDateTime(date: Date, precision: number | "day" | "hour" | "minute") {
  if (typeof precision === "string") {
    switch (precision) {
      case "day": precision = 86400 * 1000; break;
      case "hour": precision = 3600 * 1000; break;
      case "minute": precision = 60 * 1000; break;
      default: throw new Error(`Unknown period ${JSON.stringify(precision)}`);
    }
  }
  const msec = date.getTime();
  if (msec >= maxDateTimeTotalMsecs || msec <= defaultDateTime.getTime())
    return date;
  return new Date(msec - (msec % precision));
}
