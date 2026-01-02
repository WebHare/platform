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

  if (searchParams.get("type") === "cookies") {
    const headers = new Headers;
    headers.append("Set-Cookie", "testcookie=123");
    headers.append("Set-Cookie", "testcookie2=456");
    return createJSONResponse(200, { cookies: true }, { headers });
  }

  if (searchParams.get("type") === "formdata") {
    const formdata = await req.formData();
    const values = await Promise.all([...formdata.entries()].map(
      async ([field, value]) => ({ field, value: value instanceof File ? `File: ${value.name} - ${Buffer.from(await value.arrayBuffer()).toString("base64")}` : value })
    ));
    return createJSONResponse(200, {
      contentType: req.headers.get("content-type"),
      values
    });
  }

  return createJSONResponse(400, { error: "Invalid request" });
}

// validate signatures
handleJSRequest satisfies WebHareRouter;
