// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/psp-base" {
}

import type { Money } from "@webhare/std";
import type { NavigateInstruction } from "@webhare/env";

export interface PSPDriverContext {
  log(type: string, data: { [key: string]: unknown }): void;
}

///WebHare TS address format
export interface PSPAddressFormat {
  //street name. may contain multiple lines if the address calls for it
  street?: string;
  //city
  city?: string;
  //houseNumber including any suffix, if not included in street address
  houseNumber?: string;
  /** @deprecated old name for houseNumber */
  nrDetail?: string;
  //ZIP code
  zip?: string;
  //State or province
  state?: string;
  //2 letter country code, uppercase
  country: string;
}

export interface PSPOrderLine {
  type: "" | "payment" | "shipping";
  title: string;
  sku: string;
  quantity: number;
  lineTotal: Money;
  vatPercentage: Money;
  vatTotal: Money;
  ///Is vatTotal included in the lineTotal?
  vatIncluded: boolean;
}

export interface PSPPrecheckRequest {
  /** The amount we'd like to be paid, includes vat if we expect that to be included in the payment */
  toPay: Money;
  /** Rowkey of the selected method */
  method: string;

  billingAddress?: PSPAddressFormat;
  shippingAddress?: PSPAddressFormat;
  /** User's language code, eg 'nl' or 'en-US */
  lang?: string;
  /** User's IP address */
  ipAddress?: string;
  /** User's customer id in our database */
  customerId?: string;
  /** Email address */
  email?: string;
  /** Personal info */
  firstName?: string;
  infix?: string;
  lastName?: string;
  /** TODO person fields, specify them */
  /** Order contents */
  orderLines?: PSPOrderLine[];
  /** Extra data */
  extraPspData?: Record<string, unknown>; //this is an 'escape hatch' if the standard APIs do not (yet) give you the necessary fields
}

export interface PSPRequest extends PSPPrecheckRequest {
  /** Order id/payment reference which should be unique in the scope of the relevant application for the payment requests (but shared over all payment attempts) */
  orderId: string;
  /** The end-to-end paymentuuid to track this payment attempt which should be globally unique */
  paymentId: string;
  /** URL the PSP should return to */
  returnUrl: string;
  /** URL the PSP should push notifications to */
  pushUrl: string;
}

export interface PSPPrecheckResult {
  /// Any errors?
  errors?: Array<{
    /// Affected field
    field?: "wrdContactEmail";
    /// Error message for user
    error: string;
    /// Internal description
    comment: string;
  }>;
}

/** @typeParam PayMetaType - Data cached after sending a payment request to the API to be able to request the status later (eg a transaction id)
*/
export interface PSPPayResult<PayMetaType = unknown> extends PSPPrecheckResult {
  /// If set, next step for user to take. Often a redirect
  navigateTo?: NavigateInstruction;
  /// Metadata to store to get payment details later
  paymentMetadata?: PayMetaType;
}

//"orderLines" and "shippingAddress" are supported pre-WH5.8!
export type PSPRequirement = "ipAddress" | "wrdGender" | "wrdFirstName" | "wrdLastName" | "wrdDateOfBirth" | "wrdContactPhone" | "billingAddress" | "orderLines" | "shippingAddess";

/** A method supported by this PSP */
export type PSPMethod = {
  /** A non-changing reference to the payment method */
  rowkey: string;
  /** The display title for the method */
  title: string;
  /** Requirements for a startPayment call */
  requirements: PSPRequirement[];
  /** Minimum amount supported by this payment method */
  minAmount?: Money;
  /** Maximum amount supported by this payment method */
  maxAmount?: Money;
  /** Image supplied, sorted from best quality */
  images?: Array<{
    mimeType: "image/png" | "image/svg+xml";
    link: string;
  }>;
};

export interface PSPSetup {
  methods: PSPMethod[];
  isLive: boolean;
}

export interface PSPCheckResult {
  setStatus?: "approved" | "failed";
  cardIssuer?: string;
  cardNumber?: string;
  rejectReasonHTML?: string;
}

/** A subset of the Request interface we need from PSPs */
export type PSPWebRequest = Pick<Request, "method" | "headers" | "url" | "json" | "text"> & { clientIp: string };
/** A subset of the Response interface we need from PSPs */
export type PSPWebResponse = Pick<Response, "ok" | "status" | "headers" | "json" | "text" | "arrayBuffer">;
export interface PSPPushResult extends PSPCheckResult {
  response: PSPWebResponse;
}

/** Interface to be implemented by a payment driver
 * @typeParam PayMetaType - Data cached after sending a payment request to the API to be able to request the status later (eg a transaction id)
 */
export interface PSPDriver<PayMetaType = unknown> {
  /** Connect with the API, verify the configuration as passed to the constructor */
  connect(): Promise<PSPSetup | { error: string }>;
  /** Precheck as much as we can before actually starting the payment. This is usally part of form validation before the actual payment starts */
  precheckPayment?(request: PSPPrecheckRequest): Promise<PSPPrecheckResult>;
  /** Starts the payment. If succesful we generally return a redirect to an external payment portal
   * @returns Metadata to store for later status checks
  */
  startPayment(request: PSPRequest): Promise<PSPPayResult<PayMetaType>>;
  /** Process the user returning from the payment portal. If not implemented we'll fall back to a checkStatus call.
   * @param paymeta - Data cached after sending a payment request to the API to be able to request the status later (eg a transaction id)
   * @param req - Current request landing on the return page
  */
  processReturn?(paymeta: PayMetaType, req: PSPWebRequest): Promise<PSPCheckResult>;
  /** Process a push/notification directly from the payment portal */
  processPush?(paymeta: PayMetaType, req: PSPWebRequest): Promise<PSPPushResult>;
  /** Check the current status of the payment */
  checkStatus(paymeta: PayMetaType): Promise<PSPCheckResult>;
}
