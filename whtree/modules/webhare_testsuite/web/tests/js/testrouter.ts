import { WebHareRouter, WebRequest, WebResponse, createJSONResponse } from "@webhare/router";

export async function handleJSRequest(req: WebRequest): Promise<WebResponse> {
  if (req.url.searchParams.get("type") == "debug")
    return createJSONResponse(200, { debug: true, url: req.url.toString() });

  return createJSONResponse(400, { error: "Invalid request" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature. for CI purposes, not needed in external modules
const handleJSRequestValidator: WebHareRouter = handleJSRequest;
