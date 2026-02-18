import { createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { logDebug } from "@webhare/services";

export async function endPointRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

  if (url.pathname === "/.wh/endpoints/sendgrid") {
    //TODO verify key
    logDebug("platform:sendgrid", { url: req.url, headers: Object.fromEntries(req.headers.entries()), body: await req.text() });
    return createWebResponse("OK", { status: HTTPSuccessCode.Ok });
  }
  return createWebResponse("", { status: HTTPErrorCode.NotFound });
}

// validate signatures
endPointRouter satisfies WebHareRouter;
