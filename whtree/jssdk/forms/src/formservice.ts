import { createClient } from "@webhare/jsonrpc-client";
import type { AddressValidationOptions, AddressValidationStatus } from "./address";
import { FormSubmitResult } from "@mod-publisher/js/forms/formbase";
import type { EmailValidationResult, RPCFormTarget, RPCFormInvokeRPC, RPCFormSubmission } from "./types";
import type { FormService } from "@mod-publisher/lib/internal/forms/service";
import type { AddressValue } from "@webhare/std";


/// HareScript uses 'nr_detail' instead of 'houseNumber'
export type HareScriptAddressValue = Omit<AddressValue, "houseNumber"> & { nr_detail?: string };

export interface HareScriptAddressValidationResult {
  status: AddressValidationStatus;
  errors: Array<{
    ///Fields affected by the error
    fields: string[];
    ///Error message in the requested language
    message: string;
  }>;
  corrections: Partial<Record<keyof HareScriptAddressValue, string>> | null;
}

export interface PublisherFormService {
  /** Validate an email address for validity (including against server configured correction/blacklists)
   *
   * @param langcode - Language code for messages
   * @param emailaddress - Address to validate
   * @returns Validation result
   */
  validateEmail(langcode: string, emailaddress: string): Promise<EmailValidationResult>;

  formValidateEmail(target: RPCFormTarget & { field: string }, emailaddress: string): Promise<EmailValidationResult>;

  /** Get an image from a remote URL */
  getImgFromRemoteURL(imageurl: string): Promise<string>;

  /** Get the final image URL to use */
  getUploadedFileFinalURL(uploadurl: string): Promise<string>;

  validateEmbeddedObjects(objrefs: string[]): Promise<{ tokill: string[] }>;

  /** Verify address */
  verifyAddress(url: string, address: HareScriptAddressValue, options: AddressValidationOptions): Promise<HareScriptAddressValidationResult>;

  formSubmit(submitinfo: RPCFormSubmission): Promise<FormSubmitResult>;

  formInvoke(submitinfo: RPCFormInvokeRPC): Promise<{
    messages: Array<{ field: string; prop: string; data: unknown }>;
    result: unknown;
  }>;

  requestBuiltinForm(submitinfo: RPCFormTarget, filename: string, formname: string): Promise<{ html: string }>;
}

export const hsFormService = createClient<PublisherFormService>("publisher:forms");
export const tsFormService = createClient<FormService>("publisher:formsts");

export default hsFormService;
