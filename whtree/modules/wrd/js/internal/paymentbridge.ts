import { makeJSObject } from "@mod-system/js/internal/resourcetools";
import type { WebRequestInfo } from "@mod-system/js/internal/types";
import type { NavigateInstruction } from "@webhare/env";
import { stringify, type Money } from "@webhare/std";

type HsCheckInfo = {
  paymentoptiontag: string;
  paymenthandler: string;
  issuer: string;
  customerid: string;
  orderdescription: string;
  language: string;
  ipaddress: string;
  userdata: unknown;
  isrecurring: boolean;
  capturefrom: unknown;
  capturedate: Date;
  wrdpersonentity: number;
  billingaddress: unknown;
  shippingaddress: unknown;
  orderlines: unknown[];
  extrapspdata: Record<string, unknown>;
  wrd_initials: string;
  wrd_firstname: string;
  wrd_dateofbirth: Date;
  wrd_gender: number;
  wrd_infix: string;
  wrd_lastname: string;
  wrd_contact_email: string;
  wrd_contact_phone: string;
  wrd_contact_phone2: string;
  cart: unknown[];
  amount_payable: Money;
};

type HsPaymentInfo = HsCheckInfo & {
  paymentuuid: string;
  pushurl: string;
  returnurl: string;
  orderid: string;
};

///WebHare TS address format
interface AddressFormat {
  //street name. may contain multiple lines if the address calls for it
  street?: string;
  //city
  city?: string;
  //house number and any suffix, if not included in street address
  nrDetail?: string;
  //ZIP code
  zip?: string;
  //State or province
  state?: string;
  //2 letter country code, uppercase
  country: string;
}

interface OrderLine {
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

export interface WebHarePaymentPrecheckRequest {
  /** The amount we'd like to be paid, includes vat if we expect that to be included in the payment */
  toPay: Money;
  /** Rowkey of the selected method */
  method: string;

  billingAddress?: AddressFormat;
  shippingaddress?: AddressFormat;
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
  orderLines?: OrderLine[];
  /** Extra data */
  extraPspData?: Record<string, unknown>; //this is an 'escape hatch' if the standard APIs do not (yet) give you the necessary fields
}

export interface WebHarePaymentRequest extends WebHarePaymentPrecheckRequest {
  /** Order id/payment reference which should be unique in the scope of the relevant application for the payment requests (but shared over all payment attempts) */
  orderId: string;
  /** The end-to-end paymentuuid to track this payment attempt which should be globally unique */
  paymentId: string;
  /** URL the PSP should return to */
  returnUrl: string;
  /** URL the PSP should push notifications to */
  pushUrl: string;
}

export interface WebHarePaymentPrecheckResult {
  /// Any errors?
  errors?: Array<{
    /// Affected field field
    field: "wrdContactEmail";
    /// Error message for user
    error: string;
    /// Internal description
    comment: string;
  }>;
}

/** @typeParam PayMetaType - Data cached after sending a payment request to the API to be able to request the status later (eg a transaction id)
*/
export interface WebHarePaymentResult<PayMetaType = unknown> extends WebHarePaymentPrecheckResult {
  /// If set, next step for user to take. Often a redirect
  navigateTo?: NavigateInstruction;
  /// Metadata to store to get payment details later
  paymentMetadata?: PayMetaType;
}

export type PaymentRequirement = "ipAddress" | "wrdLastName" | "billingAddress";

export type PaymentMethod = {
  rowkey: string;
  title: string;
  requirements: PaymentRequirement[];
};

export interface PaymentSetup {
  methods: PaymentMethod[];
  isLive: boolean;
}

export interface CheckPaymentResult {
  setStatus?: "approved" | "failed";
  rejectReasonHTML?: string;
}

/** Interface to be implemented by a payment driver
 * @typeParam PayMetaType - Data cached after sending a payment request to the API to be able to request the status later (eg a transaction id)
 */
export interface PaymentDriver<PayMetaType = unknown> {
  /** Connect with the API, verify the configuration as passed to the constructor */
  connect(): Promise<PaymentSetup | { error: string }>;
  /** Precheck as much as we can before actually starting the payment. This is usally part of form validation before the actual payment starts */
  precheckPayment?(request: WebHarePaymentPrecheckRequest): Promise<WebHarePaymentPrecheckResult>;
  /** Starts the payment. If succesful we generally return a redirect to an external payment portal */
  startPayment(request: WebHarePaymentRequest): Promise<WebHarePaymentResult<PayMetaType>>;
  /** Process the return (and/or notification requests) from the payment portal */
  processReturn(paymeta: PayMetaType, req: WebRequestInfo, options: { isPush: boolean }): Promise<CheckPaymentResult>;
  /** Check the current status of the payment */
  checkStatus(paymeta: PayMetaType): Promise<CheckPaymentResult>;
}

async function openPSP(driver: string, configAsJSON: string): Promise<PaymentDriver | { error: string }> {
  let config;
  try {
    config = JSON.parse(configAsJSON);
  } catch (e) {
    return { error: "Invalid configuration" };
  }

  return await makeJSObject(driver, config) as PaymentDriver;
}

export async function connectPSP(driver: string, configAsJSON: string) {
  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    return { error: psp.error };

  const retval = await psp.connect();
  if ("methods" in retval) { //success
    return {
      error: "",
      methods: retval.methods,
      isLive: retval.isLive
    };
  } else {
    return { error: retval.error };
  }
}

function buildPaymentCheck(hsPaymentInfo: HsCheckInfo): WebHarePaymentPrecheckRequest {
  const req: WebHarePaymentPrecheckRequest = {
    toPay: hsPaymentInfo.amount_payable,
    method: hsPaymentInfo.paymentoptiontag,
    email: hsPaymentInfo.wrd_contact_email || undefined,
    firstName: hsPaymentInfo.wrd_firstname || undefined,
    infix: hsPaymentInfo.wrd_infix || undefined,
    lastName: hsPaymentInfo.wrd_lastname || undefined,
    ipAddress: hsPaymentInfo.ipaddress || undefined,
    //as we assume both sides will coordinate we're not bothering with json - you'll know if both sides support camelcase props..
    extraPspData: hsPaymentInfo.extrapspdata,
  };

  if (!req.method)
    throw new Error("No payment method specified");

  return req;
}

export async function precheckPaymentRequest(driver: string, configAsJSON: string, hsPaymentInfo: HsCheckInfo) {
  const req = buildPaymentCheck(hsPaymentInfo);

  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  if (!psp.precheckPayment)
    return { errors: [] };

  return { errors: (await psp.precheckPayment(req)).errors ?? [] };
}

export async function runPaymentRequest(driver: string, configAsJSON: string, hsPaymentInfo: HsPaymentInfo) {
  const req: WebHarePaymentRequest = {
    ...buildPaymentCheck(hsPaymentInfo),
    orderId: hsPaymentInfo.orderid,
    paymentId: hsPaymentInfo.paymentuuid,
    pushUrl: hsPaymentInfo.pushurl,
    returnUrl: hsPaymentInfo.returnurl,
  };

  if (!req.orderId)
    throw new Error("No order id specified");
  if (!req.paymentId)
    throw new Error("No paymentId specified");

  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.startPayment(req);
  return {
    navigateto: retval.navigateTo ?? null,
    paymentmetadata: "paymentMetadata" in retval ? stringify(retval.paymentMetadata, { typed: true }) : "",
    errors: retval.errors ?? []
  };
}

export async function processReturnURL(driver: string, configAsJSON: string, paymeta: string, isNotification: boolean, req: WebRequestInfo) {
  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.processReturn(JSON.parse(paymeta), req, { isPush: isNotification });
  return retval;
}

export async function checkStatus(driver: string, configAsJSON: string, paymeta: string) {
  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.checkStatus(JSON.parse(paymeta));
  return retval;
}
