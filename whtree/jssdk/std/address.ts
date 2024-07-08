export interface AddressValue {
  street?: string;
  city?: string;
  houseNumber?: string;
  zip?: string;
  state?: string;
  //2 letter country code, uppercase
  country: string;
}
