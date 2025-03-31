import type { SupportedRequestSubset, WebRequest } from "@webhare/router/src/request";
import { getApplyTesterForURL, type WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";
import { WRDSchema } from "@mod-wrd/js/internal/schema";
import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { IdentityProvider } from "@webhare/auth/src/identity";

/** Get cookie names to use AND which ones to ignore */
export function getIdCookieName(req: SupportedRequestSubset, wrdauth: WRDAuthPluginSettings) {
  const secure = req.url.startsWith("https:");
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
export async function getRequestUser(req: WebRequest, pathname: string): Promise<{ wrdSchema: string; user: number } | null> {
  const info = await getApplyTesterForURL(req.getOriginURL(pathname)!);
  const wrdauth = await info?.getWRDAuth();
  if (!wrdauth?.wrdSchema)
    throw new Error(`WRDAuth is not configured for ${req.url}`);

  const { idCookie } = getIdCookieName(req, wrdauth);
  const logincookie = req.getCookie(idCookie);
  const accessToken = logincookie?.match(/ accessToken:(.+)$/)?.[1];
  if (accessToken) {
    const wrdschema = new WRDSchema<WRD_IdpSchemaType>(wrdauth.wrdSchema);
    const provider = new IdentityProvider(wrdschema);
    const tokeninfo = await provider.verifyAccessToken("id", accessToken);
    if (!("error" in tokeninfo))
      return { wrdSchema: wrdauth.wrdSchema, user: tokeninfo.entity };
  }

  return null;
}
