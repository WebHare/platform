import { doLogout } from "@mod-platform/js/auth/authservice";
import { createRedirectResponse, createWebResponse, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
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
    await doLogout(origurl, null, responseHeaders);
    return createRedirectResponse(origurl, HTTPSuccessCode.TemporaryRedirect, { headers: responseHeaders });
  }
  return createWebResponse("", { status: 404 });
}

// validate signatures
authRouter satisfies WebHareRouter;
