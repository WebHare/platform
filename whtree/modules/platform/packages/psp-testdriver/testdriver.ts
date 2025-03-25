import type { PSPCheckResult, PSPDriver, PSPPushResult, PSPPrecheckRequest, PSPRequest, PSPPayResult, PSPWebRequest } from "@webhare/psp-base";
import { createServerSession, getServerSession, updateServerSession } from "@webhare/services";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";

interface TestDriverConfig {
  methods: number;
  sleep?: number;
}

interface TestDriverPayMeta {
  paymentSession: string;
  orig: { creationDate: Date };
}

export class TestDriver implements PSPDriver<TestDriverPayMeta> {
  readonly config: TestDriverConfig;

  constructor(config: TestDriverConfig) {
    this.config = config;
  }

  /** Connect to the remote, return settings or error */
  async connect() {
    if (!this.config.methods)
      return { error: "Missing expected field 'methods'" };

    const methods = [];
    for (let i = 1; i <= this.config.methods; i++)
      methods.push({ rowkey: "M" + i, title: "Method " + i, requirements: [] });
    return { methods, isLive: false };
  }

  /** Run a new payment request */
  async startPayment(request: PSPRequest): Promise<PSPPayResult<TestDriverPayMeta>> {
    if (request.email?.match(/fraud/i) && request.method === "M1")
      return { errors: [{ field: "wrdContactEmail", error: request.lang === "nl" ? "Geblokkeerd mailadres" : "This emailaddres has been blocked", comment: "User with this email is not trusted" }] };

    if (request.email?.match(/throw/i))
      throw new Error(`The address '${request.email}' triggers a throw!`);

    /*     IF(this->autocompletes != DEFAULT DATETIME)
         {
           result.complete := TRUE;
           RETURN result;
         }
         */

    //Pretend we invoked a payment API. Create a session to store the received paymentref and amount
    await beginWork();
    const paymentSession = await createServerSession("wrd:testpayment", {
      amount: request.toPay,
      paymentid: request.paymentId,
      orderid: request.orderId,
      sleep: this.config.sleep || 0,
      pushurl: request.pushUrl,
      returnurl: request.returnUrl,
      expires: request.extraPspData?.expires as Date || null,
      lastname: request.lastName || '',
      crashpoll: Boolean(request.extraPspData?.crashpoll)
    });
    await commitWork();

    return {
      navigateTo: { type: "redirect", url: "/.wrd/endpoints/psp/test-payment.shtml?s=" + paymentSession },
      paymentMetadata: { paymentSession, orig: { creationDate: new Date } }
    };
  }

  async precheckPayment(request: PSPPrecheckRequest) {
    if (request.email?.startsWith("precheckfail") && request.method === "M1") {
      return {
        errors: [
          {
            field: "wrdContactEmail" as const,
            error: request.lang === "nl" ? "Geblokkeerd mailadres" : "This emailaddres has been blocked",
            comment: "User with this email will fail in precheck"
          }
        ]
      };
    }
    return {};
  }

  #translateStatus(paymeta: TestDriverPayMeta, sessinfo: Record<string, unknown>): PSPCheckResult {
    if (!paymeta.orig.creationDate.getTime)
      throw new Error("Creation date not properly stored as time");
    if (paymeta.orig.creationDate.getTime() < (Date.now() - 86400000))
      throw new Error("Creation date more than 24 hours ago?!");

    if (sessinfo.approval === "yes")
      return { setStatus: "approved", cardIssuer: (sessinfo.cardissuer || "") as string, cardNumber: (sessinfo.cardnumber || "") as string };
    if (sessinfo.approval === "no")
      return { setStatus: "failed", cardIssuer: (sessinfo.cardissuer || "") as string, cardNumber: (sessinfo.cardnumber || "") as string };
    if (sessinfo.approval === "reject")
      return { setStatus: "failed", rejectReasonHTML: sessinfo.why as string };

    return {}; //nothing to update

  }

  async processReturn(paymeta: TestDriverPayMeta, req: PSPWebRequest): Promise<PSPCheckResult> {
    const sessinfo = await getServerSession("wrd:testpayment", paymeta.paymentSession);
    if (!sessinfo)
      throw new Error("Session has expired");

    return this.#translateStatus(paymeta, sessinfo);
  }

  async processPush(paymeta: TestDriverPayMeta, req: PSPWebRequest): Promise<PSPPushResult> {
    const sessinfo = await getServerSession("wrd:testpayment", paymeta.paymentSession);
    if (!sessinfo)
      throw new Error("Session has expired");

    const params = new URLSearchParams(await req.text());
    if (params.get("approval")) {
      sessinfo.approval = params.get("approval");
      sessinfo.pushfrom = req.clientIp;
      await runInWork(() => updateServerSession("wrd:testpayment", paymeta.paymentSession, sessinfo));
    } else {
      throw new Error("Missing 'approval' variable");
    }

    return {
      ...this.#translateStatus(paymeta, sessinfo),
      response: new Response("It is done", { headers: { "content-type": "text/plain" } })
    };
  }

  async checkStatus(paymeta: TestDriverPayMeta): Promise<PSPCheckResult> {
    const sessinfo = await getServerSession("wrd:testpayment", paymeta.paymentSession);
    if (!sessinfo || (sessinfo.expires && sessinfo.expires < new Date))
      return { setStatus: "failed" };
    if (sessinfo.crashpoll)
      throw new Error("Crash requested");

    return this.#translateStatus(paymeta, sessinfo);
  }
}
