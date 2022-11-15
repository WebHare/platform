/** Get ISO-formatted local date from a date (getISOString returns an UTC datetime) */
export function getISOLocalDate(date: Date)
{
  return date.getFullYear() + '-' + ('0' + (date.getMonth()+1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
}
