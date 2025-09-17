// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/address" {
}

/** Represents addresses as stored/used by WRD */
export interface AddressValue {
  /** Street value. If necessary use multiple address lines */
  street?: string;
  /** City */
  city?: string;
  /** House number */
  houseNumber?: string;
  /** Zip or postal code */
  zip?: string;
  /** State, province or region */
  state?: string;
  /** 2 letter country code, uppercase, eg NL or US */
  country: string;
}

/** Split a houseNumber into its bare number and suffix. This is a mostly Dutch thing to simplify resolving postal codes to an address
    @param houseNumber String with housenumber and addition
    @returns Split housenumber and addition or 'null' if the number cannot be parsed
    @cell(string) return.nr House number (digits part)
    @cell(string) return.suffix Detail/additional part (eg 'A', '-6')
*/
export function splitHouseNumber(houseNumber: string): { bareNumber: number; suffix: string } | null {
  const parts = houseNumber.trim().match(/^(\d+)\s*(.*)$/);
  return parts ? { bareNumber: parseInt(parts[1]), suffix: parts[2] } : null;
}

/** Recombines a nr and detail into a single housenumber avoiding ambiguity by inserting a space where both parts are a number
    @param bareNumber House number (digits)
    @param suffix Detail part (eg 'A', '-6', '3')
    @returns Combined house number, inserting a space between the parts when needed because of ambiguity
*/
export function joinHouseNumber(bareNumber: number, suffix: string): string {
  return bareNumber + (suffix.match(/^\d/) ? " " : "") + suffix.trim();
}
