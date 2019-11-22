export function formatDate(dateformat, year, month, day)
{
  if(!isValidDate(year,month,day))
    return '';

  let output='';

  for(let c of dateformat.split(""))
  {
    switch(c.toUpperCase())
    {
      case "Y":
        output += ('000'+year).slice(-4);
        break;
      case "M":
        output += ('0'+month).slice(-2);
        break;
      case "D":
        output += ('0'+day).slice(-2);
        break;
      default:
        output += c;
        break;
    }
  }
  return output;
}

export function formatISODate(year,month,date)
{
  return formatDate("Y-M-D", year,month,date);
}

export function formatISOTime(hour, minute, second, msec)
{
  if(!isValidTime(hour,minute,second !== null ? second : 0,msec !== null ? msec : 0))
    return '';

  let time = ('0'+hour).slice(-2) + ':' + ('0'+minute).slice(-2);
  if (second !== null)
    time += ':' + ('0'+second).slice(-2);
  if (msec !== null)
    time += '.' + ('00'+msec).slice(-3);
  return time;
}

//FIXME dupe from webharefields.es - do we need low level date libs ?
export function isValidDate(year,month,day)
{
  if(!(year>0 && year<=9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) //note: also tests for NaN
    return false;
  if([4,6,9,11].includes(month) && day > 30) //handle april, june, sep, nov
    return false;
  let isleapyear = (year % 400) == 0 || ((year % 100) != 0 && (year % 4) == 0);
  if(month == 2 && day > (isleapyear ? 29 : 28))
    return false;
  return true;
}

export function isValidTime(hour,minute,second,msec)
{
  if(!(hour>=0 && hour <=23 && minute >=0 && minute <= 60 && second >= 0 && second <= 60 && msec >= 0 && msec <= 999))
    return false; //note: also tests for NaN
  return true;
}

export function parseDate(format, newdate, options)
{
  if(!newdate) //empty
    return null;

  //replace . and / with -
  let setdate = newdate.replace(/[./]/g,'-');
  let parts = setdate.split('-');

  if(parts.length == 3)//parseable
  {
    format = format.toLowerCase();
    let dayoffset = format.indexOf('d');
    let monthoffset = format.indexOf('m');
    let yearoffset = format.indexOf('y');

    let daypos = 0 + (dayoffset > monthoffset ? 1 : 0) + (dayoffset > yearoffset ? 1 : 0);
    let monthpos = 0 + (monthoffset > dayoffset ? 1 : 0) + (monthoffset > yearoffset ? 1 : 0);
    let yearpos = 0 + (yearoffset > dayoffset ? 1 : 0) + (yearoffset > monthoffset ? 1 : 0);

    let day = parseInt(parts[daypos],0);
    let month = parseInt(parts[monthpos],0);
    let year = parseInt(parts[yearpos],0);

    // The browser will always add 1900 for years 0-99, so handle years < 100
    // if (year >= 0 && year < 100 && this.options.cutoffyear > 0)
    // {
    //   if (year < this.options.cutoffyear)
    //     year += 2000;
    //   else
    //     year += 1900;
    // }
    if(isValidDate(year, month, day))
      return { year, month, day };
  }
  if(options && options.nofail)
    return undefined;

  throw new Error(`Invalid date value: '${newdate}'`);
}

//compare two dates. return -1 if lhs<rhs, 0 if lhs==rhs, 1 if lhs>rhs
export function compareDate(lhs, rhs)
{
  if(!lhs)
    return rhs ? -1 : 0; //if rhs is set, <null> is before anything. oterhwise equal
  else if(!rhs)
    return 1; //lhs must be set, so lhs>rhs

  return   lhs.year < rhs.year ? -1
         : lhs.year > rhs.year ? 1
         : lhs.month < rhs.month ? -1
         : lhs.month > rhs.month ? 1
         : lhs.day < rhs.day ? -1
         : lhs.day > rhs.day ? 1
         : 0;
}

export function parseISODate(newdate, options)
{
  return parseDate('y-m-d', newdate, options);
}

export function getLocalToday()
{
  let today = new Date;
  return { year: today.getFullYear(), month: 1+today.getMonth(), day: today.getDate() };
}

export function parseISOTime(intime, options)
{
  let split = intime.match(/^([0-9]+):([0-9]+)(:([0-9]+))?(\.([0-9]+))?$/);
  if(split)
  {
    let hour = parseInt(split[1],10);
    let minute = parseInt(split[2],10);
    let second = parseInt(split[4] || "0",10);
    let msec = parseInt(split[6] || "0",10);
    return { hour, minute, second, msec };
  }
  if(options && options.nofail)
    return undefined;

  throw new Error(`Invalid time value: '${intime}'`);
}

export function getWeekNumber(jsdate)
{
  jsdate = new Date(jsdate); //don't modify the caller's date!
  jsdate.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  jsdate.setDate(jsdate.getDate() + 3 - (jsdate.getDay() + 6) % 7);
  // January 4 is always in week 1.
  var week1 = new Date(jsdate.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and count number of weeks from jsdate to week1.
  return 1 + Math.round(((jsdate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// export function getOrdinalDay(date)
// {

// }
export function makeJSLocalDate(dateparts)
{
  return new Date(dateparts.year-1900, dateparts.month-1, dateparts.day);
}

export function makeJSUTCDate(dateparts)
{
  return new Date(Date.UTC(dateparts.year, dateparts.month-1, dateparts.day));
}

export function formatJSLocalISODate(dateobj)
{
  return dateobj.getFullYear() + '-' + ('0'+(dateobj.getMonth()+1)).slice(-2) + '-' + ('0'+dateobj.getDate()).slice(-2);
}
export function formatJSUTCISODate(dateobj)
{
  return dateobj.getUTCFullYear() + '-' + ('0'+(dateobj.getUTCMonth()+1)).slice(-2) + '-' + ('0'+dateobj.getUTCDate()).slice(-2);
}
