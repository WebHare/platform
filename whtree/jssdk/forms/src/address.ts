import type { AddressValue } from "@webhare/address";
import { stringify, emplace, omit } from "@webhare/std";
import { getFormService, type HareScriptAddressValidationResult, type HareScriptAddressValue } from "./formservice";

export type { HareScriptAddressValue, HareScriptAddressValidationResult } from "./formservice";

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
  corrections: Partial<Record<keyof AddressValue, string>> | null;
}

let lookupcache: Map<string, Promise<AddressValidationResult>> | undefined;

export async function verifyHareScriptAddress(address: HareScriptAddressValue, options: AddressValidationOptions = {}): Promise<HareScriptAddressValidationResult> {
  if (!lookupcache)
    lookupcache = new Map<string, Promise<AddressValidationResult>>;

  const lookupkey = stringify({ address, options }, { stable: true });
  const lookup = emplace(lookupcache, lookupkey, {
    insert: () => getFormService().verifyAddress(location.pathname, address, options)
  });
  return await lookup;
}

export async function verifyAddress(address: AddressValue, options: AddressValidationOptions = {}): Promise<AddressValidationResult> {
  if (!lookupcache)
    lookupcache = new Map<string, Promise<AddressValidationResult>>;

  // convert houseNumber to nr_detail
  const hsAddress = { ...omit(address, ["houseNumber"]), nr_detail: address.houseNumber };

  const hsresult = await verifyHareScriptAddress(hsAddress, options);

  // back-convert nr_detail to houseNumber
  let corrections: AddressValidationResult["corrections"] = null;
  if (hsresult.corrections) {
    corrections = {};
    for (const [key, value] of Object.entries(hsresult.corrections) as Array<[keyof HareScriptAddressValue, string]>) {
      corrections[key === "nr_detail" ? "houseNumber" as const : key] = value;
    }
  }
  return {
    status: hsresult.status,
    errors: hsresult.errors.map(error => ({ fields: error.fields.map(f => f === "houseNumber" ? "nr_detail" : f), message: error.message })),
    corrections,
  };
}
