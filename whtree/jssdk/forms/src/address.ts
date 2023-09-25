import PublisherFormService from "./formservice";

export interface AddressValue {
  street?: string;
  city?: string;
  nr_detail?: string;
  zip?: string;
  state?: string;
  //2 letter country code, uppercase
  country: string;
}

export type AddressChecks = "nl-zip-suggest" | "nl-zip-force";

export type AddressValidationStatus = "ok" | "unknown" | "error";
// not_supported" | "ok" | "not_enough_data" | "invalid_city" | "invalid_zip" | "invalid_nr_detail" | "zip_not_found" | "address_not_found" | "different_citystreet" | "incomplete" | "lookup_failed";

export interface AddressValidationOptions {
  checks?: AddressChecks[];
  lang?: string;
}

export interface AddressValidationResult {
  status: AddressValidationStatus;
  errors: Array<{
    ///Fields affected by the error
    fields: string[];
    ///Error message in the requested language
    message: string;
  }>;
  corrections: Record<keyof AddressValue, string> | null;
}

export async function verifyAddress(address: AddressValue, options?: AddressValidationOptions): Promise<AddressValidationResult> {
  //FIXME client side cache
  const result = await PublisherFormService.verifyAddress(location.pathname, address, options) as AddressValidationResult;
  return result;
}
