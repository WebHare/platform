/** Get ISO-formatted local date from a date (getISOString returns an UTC datetime) */
export function getISOLocalDate(date)
{
  return date.getFullYear() + '-' + ('0' + (date.getMonth()+1)).substr(-2) + '-' + ('0' + date.getDate()).substr(-2);
}
