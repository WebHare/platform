import { type PSPCheckResult, type PSPDriver, type PSPPushResult, type PSPRequest, type PSPPayResult, type PSPWebRequest, type PSPMethod } from "@webhare/psp-base";

interface DummyDriverConfig {
}

interface DummyDriverPayMeta {
}

export class DummyDriver implements PSPDriver<DummyDriverPayMeta> {
  constructor(private readonly config: DummyDriverConfig) {
  }

  async connect() {
    const methods: PSPMethod[] = [];
    return { methods, isLive: true };
  }

  async startPayment(request: PSPRequest): Promise<PSPPayResult<DummyDriverPayMeta>> {
    return {
      navigateTo: { type: "redirect", url: "https://www.example.com/payment/" },
      paymentMetadata: {}
    };
  }

  async processReturn(paymeta: DummyDriverPayMeta, req: PSPWebRequest): Promise<PSPCheckResult> {
    return { setStatus: "failed" };
  }

  async processPush(paymeta: DummyDriverPayMeta, req: PSPWebRequest): Promise<PSPPushResult> {
    return {
      setStatus: "failed",
      response: new Response("Sorry, failed", { headers: { "content-type": "text/plain" } })
    };
  }

  async checkStatus(paymeta: DummyDriverPayMeta): Promise<PSPCheckResult> {
    return { setStatus: "failed" };
  }
}
