import { createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { decryptForThisServer, logDebug } from "@webhare/services";
import { parseSendGridMessage } from "../email/sendgrid";
import { createVM } from "@webhare/harescript";


declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "platform:endpoint": {
      type: string;
    };
  }
}

async function handleSendGrid(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);
  const endpointInfo = decryptForThisServer("platform:endpoint", url.searchParams.get("key") || "");
  if (endpointInfo.type !== "sendgrid")
    return createWebResponse("Invalid key", { status: HTTPErrorCode.Unauthorized });

  const body = await req.json() as Array<unknown>;
  logDebug("platform:sendgrid", { url: req.url, headers: Object.fromEntries(req.headers.entries()), body });
  const reports = body.map(msg => parseSendGridMessage(msg)).filter(data => data.basictype); //only pass those where we figured out the type
  for (const bounce of reports) {
    //we need a separate HSVM per bounce as the HS code expects that. fix that for the TS handlers
    await using vm = await createVM();
    await vm.loadlib("mod::system/lib/internal/mail/incoming.whlib").ProcessBounce(bounce);
  }
  return createWebResponse("OK", { status: HTTPSuccessCode.Ok });
}

export async function endPointRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

  if (url.pathname === "/.wh/endpoints/sendgrid")
    return await handleSendGrid(req);

  return createWebResponse("", { status: HTTPErrorCode.NotFound });
}

// validate signatures
endPointRouter satisfies WebHareRouter;
