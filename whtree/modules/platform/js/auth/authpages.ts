import { doLoginHeaders, doLogout } from "@mod-platform/js/auth/authservice";
import { createRedirectResponse, createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { decryptForThisServer } from "@webhare/services";
import { stringify } from "@webhare/std";
import { getApplyTesterForURL } from "@webhare/whfs/src/applytester";

export async function authRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

  if (url.pathname === "/.wh/auth/logout") {
    const origurl = url.origin + "/" + (url.searchParams.get("pathname") || '');
    const applyTester = origurl ? await getApplyTesterForURL(origurl) : null;
    const wrdAuthsettings = await applyTester?.getWRDAuth();
    if (!wrdAuthsettings)
      return createWebResponse("", { status: 400 });

    const responseHeaders = new Headers;
    await doLogout(origurl, null, req.headers.get("cookie"), responseHeaders);
    return createRedirectResponse(origurl, HTTPSuccessCode.TemporaryRedirect, { headers: responseHeaders });
  }

  if (url.pathname === "/.wh/auth/settoken") {
    const intext = await req.text(); //TODO check length before decoding, rpc() has the same issue
    if (intext.length > 4000)
      return createWebResponse("Request too long", { status: HTTPErrorCode.PayloadTooLarge });

    const params = new URLSearchParams(intext);
    const settoken = decryptForThisServer("platform:settoken", params.get("settoken") || '');

    // Ensure the loginrequest isn't replayed to a different origin or is just too old
    if (settoken.expires.epochMilliseconds < Date.now())
      return createWebResponse("Token expired", { status: HTTPErrorCode.Gone });
    if (!settoken.target.startsWith(url.origin + '/'))
      return createWebResponse("Invalid target", { status: HTTPErrorCode.BadRequest });

    const responseHeaders = new Headers;
    doLoginHeaders(settoken.idCookie, settoken.ignoreCookies, settoken.expires, settoken.value, settoken.cookieSettings, responseHeaders);
    //override any existing CSP for the domain. unsafe-inline should be safe as all input is already signed and validated
    responseHeaders.set("Content-Security-Policy", "default-src 'none';script-src 'unsafe-inline'");

    /* We need to mimick frontend/auth.ts:

      dompack.setLocal<AuthLocalData>(getStorageKeyName(), {
        expires: result.expires,
        userInfo: result.userInfo || null
      });

      directly setting localStorage. it's expected to contain typed-stringify keys so we need a double encode:
    */
    const storageKeyName = "wh:wrdauth-" + settoken.cookieName;
    const data = { expires: new Date(settoken.expires.epochMilliseconds), userInfo: settoken.userInfo || null };
    const body = `<html><head><script type="text/javascript">
      try { window.localStorage[${JSON.stringify(storageKeyName)}]=${JSON.stringify(stringify(data, { typed: true }))}; } catch(ignore){}
      location.href=${JSON.stringify(settoken.target)};
      </script></head></html>`;

    return createWebResponse(body, { headers: responseHeaders });
  }

  return createWebResponse("unknown route", { status: 404 });
}

// validate signatures
authRouter satisfies WebHareRouter;
