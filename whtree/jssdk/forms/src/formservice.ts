import { createClient } from "@webhare/jsonrpc-client";
import type { AddressValidationOptions, AddressValidationResult, AddressValue } from "./address";
import { FormSubmitResult } from "@mod-publisher/js/forms/formbase";

export interface EmailValidationResult { /** If blocked, the suggested error message */
  blocked?: string;
  /** If set, the emailaddress should be forced to this value */
  force?: string;
  /** Suggested email address */
  suggestion?: string;
}

interface BaseFormSubmitInfo {
  url: string;
  target: string;
}

interface FormSubmitInfo extends BaseFormSubmitInfo {
  extrasubmit?: unknown;
  vals: Array<{
    name: string;
    value: unknown;
  }>;
}

export interface PublisherFormService {
  /** Validate an email address for validity (including against server configured correction/blacklists)
   *
   * @param langcode - Language code for messages
   * @param emailaddress - Address to validate
   * @returns Validation result
   */
  validateEmail(langcode: string, emailaddress: string)
    : Promise<EmailValidationResult>;

  /** Get an image from a remote URL */
  getImgFromRemoteURL(imageurl: string): Promise<string>;

  /** Get the final image URL to use */
  getUploadedFileFinalURL(uploadurl: string): Promise<string>;

  validateEmbeddedObjects(objrefs: string[]): Promise<{ tokill: string[] }>;

  /** Verify address */
  verifyAddress(url: string, address: AddressValue, options: AddressValidationOptions): Promise<AddressValidationResult>;

  formSubmit(submitinfo: FormSubmitInfo): Promise<FormSubmitResult>;

  formInvoke(submitinfo: FormSubmitInfo & { methodname: string; args: unknown[] }): Promise<{
    messages: Array<{ field: string; prop: string; data: unknown }>;
    result: unknown;
  }>;

  requestBuiltinForm(submitinfo: BaseFormSubmitInfo, filename: string, formname: string): Promise<{ html: string }>;
}

// const client = rpc.createClient<PublisherFormService>("publisher:forms");
export default createClient<PublisherFormService>("publisher:forms");
