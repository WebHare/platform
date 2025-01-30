import { type WebHareRouter, type WebRequest, type WebResponse, createJSONResponse, createRedirectResponse } from "@webhare/router";

export async function handleJSRequest(req: WebRequest): Promise<WebResponse> {
  const searchParams = new URL(req.url).searchParams;
  if (searchParams.get("type") === "debug")
    return createJSONResponse(200, {
      debug: true,
      url: req.url.toString(),
      baseURL: req.baseURL,
      localPath: req.localPath,
      headers: Object.fromEntries(req.headers.entries()),
      text: await req.text()
    });

  if (searchParams.get("type") === "redirect")
    return createRedirectResponse("https://www.webhare.dev/", 301);

  return createJSONResponse(400, { error: "Invalid request" });
}

// validate signatures
handleJSRequest satisfies WebHareRouter;
