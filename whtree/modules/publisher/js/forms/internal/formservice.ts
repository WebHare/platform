// import * as rpc from '@mod-system/js/wh/rpc';
import createClient from "@webhare/jsonrpc-client";

export interface EmailValidationResult
{ /** If blocked, the suggested error message */
  blocked?: string;
  /** If set, the emailaddress should be forced to this value */
  force?: string;
  /** Suggested email address */
  suggestion?: string;
}

export interface PublisherFormService
{
  /** Validate an email address for validity (including against server configured correction/blacklists)
   *
   * @param langcode - Language code for messages
   * @param emailaddress - Address to validate
   * @returns Validation result
   */
  validateEmail(langcode: string, emailaddress: string)
    : Promise<EmailValidationResult>
}

// const client = rpc.createClient<PublisherFormService>("publisher:forms");
export default createClient<PublisherFormService>("publisher:forms");