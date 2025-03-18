/** WRD (auth) concepts are shared between frontend and backend */

/* Strip cookie prefixes such as __Host- and __Secure-. See https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie */
export function cleanCookieName(name: string): string {
  return name.replace(/^(?:__Host-|__Secure-)/i, "");
}
