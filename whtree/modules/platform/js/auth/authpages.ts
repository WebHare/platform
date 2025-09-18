import { doLoginHeaders, doLogout } from "@mod-platform/js/auth/authservice";
import { parseUserAgent } from "@webhare/dompack/src/browser";
import { createRedirectResponse, createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { decryptForThisServer } from "@webhare/services";
import { getApplyTesterForURL } from "@webhare/whfs/src/applytester";

/** Preauth rules run before generic WebHare access rules. It's needed to make sure that eg .wh/preauth/settoken
 *  is not blocked by an access rule, as preauth/settoken might be involved in the actual login, or we just need to
 *  avoid its POST from being intercepted.
 */
export async function preAuthRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

  if (url.pathname === "/.wh/preauth/settoken") {
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

  return createWebResponse("unknown route", { status: 404 });
}

export async function authRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

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

  return createWebResponse("unknown route", { status: 404 });
}

// validate signatures
authRouter satisfies WebHareRouter;
