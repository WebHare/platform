import type { WebRequest } from "@webhare/router/src/request";
import { getApplyTesterForURL, type WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";
import type { AnyWRDSchema } from "@webhare/wrd";
import { IdentityProvider } from "@webhare/auth/src/identity";
import type { WRDAuthAccountStatus } from "@webhare/auth";

/** Get cookie names to use AND which ones to ignore */
export function getIdCookieName(url: string, wrdauth: WRDAuthPluginSettings) {
  const secure = url.startsWith("https:");
  //If securely accessed, we can use the __Host- or __Secure- prefix for cookies depending on whether we need to expose the cookie to a larger domain
  const useprefix = (secure ? wrdauth.cookieDomain ? "__Secure-" : "__Host-" : "");
  const allprefixes = ["__Host-", "__Secure-", ""];
  return {
    ///Cookie to set/check.
    idCookie: useprefix + wrdauth.cookieName,
    ///Cookies to ignore (but still clear)
    ignoreCookies: allprefixes.filter(p => p !== useprefix).map(p => p + wrdauth.cookieName)
  };
}

/** Get the user linked to a URL */
export async function getRequestUser(req: WebRequest, pathname: string, wrdSchema: AnyWRDSchema): Promise<{ user: number; accountStatus: WRDAuthAccountStatus | null } | null> {
  if (!wrdSchema)
    throw new Error("No WRDSchema provided");
  let accessToken = req.headers.get("Authorization")?.match(/Bearer *(.+)$/i)?.[1];
  if (!accessToken) {
    // Fallback on cookies, but only if WRDAuth is configured to the correct schema
    const info = await getApplyTesterForURL(req.getOriginURL(pathname)!);
    const wrdauth = await info?.getWRDAuth();

    if (wrdauth?.wrdSchema === wrdSchema.tag) {
      /* try the cookie header, but only the one we're configured for, otherwise we'd still check unprefixed headers,
         breaking the whole point of __Host-/__Secure- (being unsettable by JS)
      */
      const { idCookie } = getIdCookieName(req.url, wrdauth);
      const logincookie = req.getCookie(idCookie);
      accessToken = logincookie?.match(/ accessToken:(.+)$/)?.[1];
    }
  }

  if (accessToken) {
    const provider = new IdentityProvider(wrdSchema);
    const tokeninfo = await provider.verifyAccessToken("id", accessToken);
    if (!("error" in tokeninfo))
      return { user: tokeninfo.entity, accountStatus: tokeninfo.accountStatus };
  }

  return null;
}
