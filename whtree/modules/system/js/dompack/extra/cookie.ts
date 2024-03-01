import { getCookie, setCookie, listCookies, deleteCookie } from "@webhare/dompack";
/** @deprecated Use \@webhare/dompack listCookies */
export const list = listCookies;
/** @deprecated Use \@webhare/dompack getCookie */
export const read = getCookie;
/** @deprecated Use \@webhare/dompack setCookie */
export const write = setCookie;
/** @deprecated Use \@webhare/dompack deleteCookie */
export const remove = deleteCookie;
