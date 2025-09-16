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
