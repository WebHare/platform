import { isValidDate, isValidTime } from '@webhare/std';

export function formatDate(dateformat: string, year: number, month: number, day: number): string {
  if (!isValidDate(year, month, day, { minYear: 1 }))
    return '';

  let output = '';

  for (const c of dateformat.split("")) {
    switch (c.toUpperCase()) {
      case "Y":
        output += ('000' + year).slice(-4);
        break;
      case "M":
        output += ('0' + month).slice(-2);
        break;
      case "D":
        output += ('0' + day).slice(-2);
        break;
      default:
        output += c;
        break;
    }
  }
  return output;
}

export function formatISODate(year: number, month: number, date: number) {
  return formatDate("Y-M-D", year, month, date);
}

export function formatISOTime(hour: number, minute: number, second: number | null, msec: number | null) {
  if (!isValidTime(hour, minute, second !== null ? second : 0, msec !== null ? msec : 0))
    return '';

  let time = ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
  if (second !== null)
    time += ':' + ('0' + second).slice(-2);
  if (msec !== null)
    time += '.' + ('00' + msec).slice(-3);
  return time;
}

export interface DateParts {
  day: number;
  month: number;
  year: number;
}

export function parseDate(format: string, newdate: string, options?: { nofail: boolean }): DateParts | null {
  if (!newdate) //empty
    return null;

  //replace . and / with -
  const setdate = newdate.replace(/[./]/g, '-');
  const parts = setdate.split('-');

  if (parts.length === 3) { //parseable
    format = format.toLowerCase();
    const dayoffset = format.indexOf('d');
    const monthoffset = format.indexOf('m');
    const yearoffset = format.indexOf('y');

    const daypos = 0 + (dayoffset > monthoffset ? 1 : 0) + (dayoffset > yearoffset ? 1 : 0);
    const monthpos = 0 + (monthoffset > dayoffset ? 1 : 0) + (monthoffset > yearoffset ? 1 : 0);
    const yearpos = 0 + (yearoffset > dayoffset ? 1 : 0) + (yearoffset > monthoffset ? 1 : 0);

    const day = parseInt(parts[daypos], 0);
    const month = parseInt(parts[monthpos], 0);
    const year = parseInt(parts[yearpos], 0);

    // The browser will always add 1900 for years 0-99, so handle years < 100
    // if (year >= 0 && year < 100 && this.options.cutoffyear > 0)
    // {
    //   if (year < this.options.cutoffyear)
    //     year += 2000;
    //   else
    //     year += 1900;
    // }
    if (isValidDate(year, month, day))
      return { year, month, day };
  }
  if (options && options.nofail)
    return null;

  throw new Error(`Invalid date value: '${newdate}'`);
}

//compare two dates. return -1 if lhs<rhs, 0 if lhs==rhs, 1 if lhs>rhs
export function compareDate(lhs: DateParts | null, rhs: DateParts | null) {
  if (!lhs)
    return rhs ? -1 : 0; //if rhs is set, <null> is before anything. oterhwise equal
  else if (!rhs)
    return 1; //lhs must be set, so lhs>rhs

  return lhs.year < rhs.year ? -1
    : lhs.year > rhs.year ? 1
      : lhs.month < rhs.month ? -1
        : lhs.month > rhs.month ? 1
          : lhs.day < rhs.day ? -1
            : lhs.day > rhs.day ? 1
              : 0;
}

export function parseISODate(newdate: string, options?: { nofail: boolean }) {
  return parseDate('y-m-d', newdate, options);
}

export function getLocalToday(): DateParts {
  const today = new Date;
  return { year: today.getFullYear(), month: 1 + today.getMonth(), day: today.getDate() };
}

export function parseISOTime(intime: string, { nofail = false } = {}) {
  const split = intime.match(/^([0-9]+):([0-9]+)(:([0-9]+))?(\.([0-9]+))?$/);
  if (split) {
    const hour = parseInt(split[1], 10);
    const minute = parseInt(split[2], 10);
    const second = parseInt(split[4] || "0", 10);
    const msec = parseInt(split[6] || "0", 10);
    return { hour, minute, second, msec };
  }
  if (nofail)
    return undefined;

  throw new Error(`Invalid time value: '${intime}'`);
}

export function getWeekNumber(jsdate: Date) {
  jsdate = new Date(jsdate); //don't modify the caller's date!
  jsdate.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  jsdate.setDate(jsdate.getDate() + 3 - (jsdate.getDay() + 6) % 7);
  // January 4 is always in week 1.
  const week1 = new Date(jsdate.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and count number of weeks from jsdate to week1.
  return 1 + Math.round(((jsdate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

export function makeJSUTCDate(dateparts: DateParts) {
  return new Date(Date.UTC(dateparts.year, dateparts.month - 1, dateparts.day));
}

export function formatJSUTCISODate(dateobj: Date) {
  return dateobj.getUTCFullYear() + '-' + ('0' + (dateobj.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + dateobj.getUTCDate()).slice(-2);
}
