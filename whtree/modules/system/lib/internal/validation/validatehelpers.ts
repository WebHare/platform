export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }); return true;
  } catch {
    return false;
  }
}
