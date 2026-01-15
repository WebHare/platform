import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { WebRequestInfo } from "@mod-system/js/internal/types";
import type { PSPAddressFormat, PSPDriver, PSPDriverContext, PSPPrecheckRequest, PSPRequest } from "@webhare/psp-base";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import { createResponseInfoFromResponse } from "@webhare/router/src/response";
import { importJSObject, logDebug } from "@webhare/services";
import { parseTyped, stringify, type Money } from "@webhare/std";

type HsAddressFormat = {
  street: string;
  city: string;
  nr_detail: string;
  zip: string;
  state: string;
  country: string;
};

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
  billingaddress: HsAddressFormat;
  shippingaddress: HsAddressFormat;
  orderlines: Array<{
    linetotal: Money;
    vatamount: Money;
    vatpercentage: Money;
    amount: number;
    title: string;
    type: "shipping" | "payment" | "";
    vatincluded: boolean;
  }>;
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

function mapAddress(address: HsAddressFormat): PSPAddressFormat | undefined {
  if (!address?.country)
    return undefined;

  return {
    street: address.street,
    city: address.city,
    houseNumber: address.nr_detail,
    //TODO remove in the future
    nrDetail: address.nr_detail,
    zip: address.zip,
    state: address.state,
    country: address.country
  };
}

async function openPSP(driver: string, configAsJSON: string, meta?: { paymentId?: string }): Promise<PSPDriver | { error: string }> {
  let config;
  try {
    config = JSON.parse(configAsJSON);
  } catch (e) {
    return { error: "Invalid configuration: " + (e as Error)?.message };
  }

  const context: PSPDriverContext = {
    log: (type: string, data: { [key: string]: unknown }): void => {
      logDebug("wrd:payments", { driver, type, paymentId: meta?.paymentId, data });
    }
  };

  if (!driver.includes('#')) { //not a full object path
    const pspInfo = getExtractedConfig("wrdschemas").psp.find(psp => psp.tag === driver);
    if (!pspInfo)
      return { error: `Unknown payment provider '${driver}'` };
    driver = pspInfo.driver;
  }

  return await importJSObject(driver, config, context) as PSPDriver;
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

function buildPaymentCheck(hsPaymentInfo: HsCheckInfo): PSPPrecheckRequest {
  const req: PSPPrecheckRequest = {
    toPay: hsPaymentInfo.amount_payable,
    method: hsPaymentInfo.paymentoptiontag,
    email: hsPaymentInfo.wrd_contact_email || undefined,
    firstName: hsPaymentInfo.wrd_firstname || undefined,
    infix: hsPaymentInfo.wrd_infix || undefined,
    lastName: hsPaymentInfo.wrd_lastname || undefined,
    ipAddress: hsPaymentInfo.ipaddress || undefined,
    //as we assume both sides will coordinate we're not bothering with json - you'll know if both sides support camelcase props..
    extraPspData: hsPaymentInfo.extrapspdata,
    billingAddress: mapAddress(hsPaymentInfo.billingaddress),
    shippingAddress: mapAddress(hsPaymentInfo.shippingaddress),
    orderLines: hsPaymentInfo.orderlines.map(line => ({
      type: line.type,
      title: line.title,
      sku: "",
      quantity: line.amount,
      lineTotal: line.linetotal,
      vatPercentage: line.vatpercentage,
      vatTotal: line.vatamount,
      vatIncluded: line.vatincluded
    })),
  };

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
  const req: PSPRequest = {
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

  const psp = await openPSP(driver, configAsJSON, { paymentId: hsPaymentInfo.paymentuuid });
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.startPayment(req);
  return {
    navigateto: retval.navigateTo ?? null,
    paymentmetadata: "paymentMetadata" in retval ? stringify(retval.paymentMetadata, { typed: true }) : "",
    errors: retval.errors ?? []
  };
}

export async function processReturnURL(driver: string, configAsJSON: string, paymeta: string, req: WebRequestInfo) {
  if (!paymeta)
    return null; //payment never completely initialized.

  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  if (psp.processReturn)
    return await psp.processReturn(paymeta ? parseTyped(paymeta) : null, await newWebRequestFromInfo(req));
  else
    return await psp.checkStatus(paymeta ? parseTyped(paymeta) : null);
}

export async function processPush(driver: string, configAsJSON: string, paymeta: string, req: WebRequestInfo) {
  if (!paymeta)
    return null; //payment never completely initialized.

  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  if (!psp.processPush)
    return null;

  const retval = await psp.processPush(paymeta ? parseTyped(paymeta) : null, await newWebRequestFromInfo(req));
  return {
    ...retval,
    response: await createResponseInfoFromResponse(retval.response)
  };
}

export async function checkStatus(driver: string, configAsJSON: string, paymeta: string) {
  if (!paymeta)
    return null; //payment never completely initialized.

  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.checkStatus(paymeta ? parseTyped(paymeta) : null);
  return retval;
}
