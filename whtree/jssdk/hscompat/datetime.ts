export function makeDateFromParts(daycount: number, msecs: number): Date {
  return new Date(Date.UTC(1970, 0, daycount - 719162, 0, 0, 0, msecs));
}
