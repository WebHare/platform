import { doLoginHeaders, doLogout } from "@mod-platform/js/auth/authservice";
import { handleOAuth2AuthorizeLanding } from "@webhare/auth/src/oauth2-client";
import { parseUserAgent } from "@webhare/dompack/src/browser";
import { createRedirectResponse, createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { decryptForThisServer } from "@webhare/services";
import { getApplyTesterForURL } from "@webhare/whfs/src/applytester";

export async function authRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

  if (url.pathname === "/.wh/auth/settoken") {
    const intext = await req.text(); //TODO check length before decoding, rpc() has the same issue
    if (intext.length > 4000)
      return createWebResponse("Request too long", { status: HTTPErrorCode.PayloadTooLarge });
    if (intext.length === 0)
      return createWebResponse("Missing auth token", { status: HTTPErrorCode.BadRequest });

    const params = new URLSearchParams(intext);
    const settoken = decryptForThisServer("platform:settoken", params.get("settoken") || '');

    // Ensure the loginrequest isn't replayed to a different origin or is just too old
    if (settoken.expires.epochMilliseconds < Date.now())
      return createWebResponse("Token expired", { status: HTTPErrorCode.Gone });
    if (!settoken.target.startsWith(url.origin + '/'))
      return createWebResponse("Invalid target", { status: HTTPErrorCode.BadRequest });

    const responseHeaders = new Headers;
    doLoginHeaders(settoken, responseHeaders);
    return createRedirectResponse(settoken.target, HTTPSuccessCode.Found, { headers: responseHeaders });
  }

  if (url.pathname === "/.wh/auth/logout") {
    const origurl = url.origin + "/" + (url.searchParams.get("pathname") || '');
    const applyTester = origurl ? await getApplyTesterForURL(origurl) : null;
    const wrdAuthsettings = await applyTester?.getWRDAuth();
    if (!wrdAuthsettings)
      return createWebResponse("", { status: 400 });

    const responseHeaders = new Headers;
    const browserTriplet = parseUserAgent(req.headers.get("user-agent") || "")?.triplet || "";
    await doLogout(origurl, null, req.headers.get("cookie"), responseHeaders, { clientIp: req.clientIp, browserTriplet });
    return createRedirectResponse(origurl, HTTPSuccessCode.Found, { headers: responseHeaders });
  }

  if (url.pathname === "/.wh/auth/debuglogin") {
    const debuginfo = decryptForThisServer("platform:debuglogin", url.searchParams.get("debug") || "");
    if (debuginfo.now.getTime() > Date.now() + 15 * 60 * 1000)
      return createWebResponse("Debug login request expired", { status: HTTPErrorCode.Gone });

    const handleLanding = await handleOAuth2AuthorizeLanding("platform:openidlogin", url.searchParams.get("oauth2session") || "");
    return createWebResponse(JSON.stringify(handleLanding), { status: HTTPSuccessCode.Ok, headers: new Headers({ "Content-Type": "application/json" }) });
  }

  return createWebResponse("unknown route", { status: 404 });
}

// validate signatures
authRouter satisfies WebHareRouter;
