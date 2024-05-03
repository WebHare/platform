import { makeJSObject } from "@mod-system/js/internal/resourcetools";
import type { WebRequestInfo } from "@mod-system/js/internal/types";
import type { PSPDriver, PSPPrecheckRequest, PSPRequest } from "@webhare/psp-base";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import { createResponseInfoFromResponse } from "@webhare/router/src/response";
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

async function openPSP(driver: string, configAsJSON: string): Promise<PSPDriver | { error: string }> {
  let config;
  try {
    config = JSON.parse(configAsJSON);
  } catch (e) {
    return { error: "Invalid configuration" };
  }

  return await makeJSObject(driver, config) as PSPDriver;
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

export async function processReturnURL(driver: string, configAsJSON: string, paymeta: string, req: WebRequestInfo) {
  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.processReturn(paymeta ? JSON.parse(paymeta) : null, await newWebRequestFromInfo(req));
  return retval;
}

export async function processPush(driver: string, configAsJSON: string, paymeta: string, req: WebRequestInfo) {
  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  if (!psp.processPush)
    return null;

  const retval = await psp.processPush(paymeta ? JSON.parse(paymeta) : null, await newWebRequestFromInfo(req));
  return {
    ...retval,
    response: await createResponseInfoFromResponse(retval.response)
  };
}

export async function checkStatus(driver: string, configAsJSON: string, paymeta: string) {
  const psp = await openPSP(driver, configAsJSON);
  if ("error" in psp)
    throw new Error(`Cannot initialize PSP - ${psp.error}`);

  const retval = await psp.checkStatus(paymeta ? JSON.parse(paymeta) : null);
  return retval;
}
