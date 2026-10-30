import type { WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";

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