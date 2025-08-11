import type { WebRequest } from "@webhare/router";
import { getApplyTesterForURL, type WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";
import type { AnyWRDSchema } from "@webhare/wrd";
import { IdentityProvider } from "./identity";

/** Get cookie names to use AND which ones to ignore */
export function getIdCookieName(wrdauth: WRDAuthPluginSettings, secureRequest: boolean) {
  //If securely accessed, we can use the __Host- or __Secure- prefix for cookies depending on whether we need to expose the cookie to a larger domain
  const useprefix = (secureRequest ? wrdauth.cookieDomain ? "__Secure-" : "__Host-" : "");
  const allprefixes = ["__Host-", "__Secure-", ""];
  return {
    ///Cookie to set/check.
    idCookie: useprefix + wrdauth.cookieName,
    ///Cookies to ignore (but still clear)
    ignoreCookies: allprefixes.filter(p => p !== useprefix).map(p => p + wrdauth.cookieName)
  };
}

export async function getCookieBasedUser(req: WebRequest, wrdSchema: AnyWRDSchema, wrdauth: WRDAuthPluginSettings) {
  /* try the cookie header, but only the one we're configured for, otherwise we'd still check unprefixed headers,
      breaking the whole point of __Host-/__Secure- (being unsettable by JS)
  */
  const { idCookie } = getIdCookieName(wrdauth, req.url.startsWith("https:"));
  const logincookie = req.getCookie(idCookie);
  const accessToken = logincookie?.match(/ accessToken:(.+)$/)?.[1];
  return accessToken ? getUserForAccessToken(accessToken, wrdSchema) : null;
}

async function getUserForAccessToken(accessToken: string, wrdSchema: AnyWRDSchema) {
  const provider = new IdentityProvider(wrdSchema);
  const tokeninfo = await provider.verifyAccessToken("id", accessToken);
  if (!("error" in tokeninfo))
    return { user: tokeninfo.entity }; // TODO accountStatus: tokeninfo.accountStatus - but only useful if we also accept 'ignoreAccountStatus' and return whether this field was actually present in the schema?

  return null;
}

/** Get the user linked to a URL */
export async function getRequestUser(req: WebRequest, pathname: string, wrdSchema: AnyWRDSchema): Promise<{ user: number /*; accountStatus: WRDAuthAccountStatus | null*/ } | null> {
  if (!wrdSchema)
    throw new Error("No WRDSchema provided");

  const accessToken = req.headers.get("Authorization")?.match(/Bearer *(.+)$/i)?.[1];
  if (accessToken)
    return getUserForAccessToken(accessToken, wrdSchema);

  // Fallback on cookies, but only if WRDAuth is configured to the correct schema
  const info = await getApplyTesterForURL(req.getOriginURL(pathname)!);
  const wrdauth = await info?.getWRDAuth();

  if (wrdauth?.wrdSchema === wrdSchema.tag)
    return getCookieBasedUser(req, wrdSchema, wrdauth);

  return null;
}
