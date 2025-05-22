import { buildCookieHeader, type CookieOptions } from '@webhare/dompack/src/cookiebuilder';
import { escapeRegExp, parseTyped, stringify } from '@webhare/std';

const backup: {
  sessionStorage?: Record<string, string>;
  localStorage?: Record<string, string>;
} = {};
type BrowserStorage = keyof typeof backup;

export function listCookies() {
  return document.cookie.split(';').map(cookie => {
    const parts = cookie.split('=');
    return { name: decodeURIComponent(parts[0].trim()), value: decodeURIComponent(parts[1] || '') };
  });
}

export function setCookie(key: string, value: string, options?: CookieOptions) {
  document.cookie = buildCookieHeader(key, value, options);
}

export function getCookie(key: string): string | null {
  const value = document.cookie.match('(?:^|;)\\s*' + escapeRegExp(key) + '=([^;]*)');
  return (value) ? decodeURIComponent(value[1]) : null;
}

export function deleteCookie(key: string, options?: CookieOptions) {
  setCookie(key, '', { ...options, duration: -1, expires: undefined });
}

function get(storage: BrowserStorage, key: string): unknown | null {
  let foundvalue: string | undefined | null = backup[storage]?.[key];
  if (foundvalue) //if it's in the backups storage encoding can't fail either
    return parseTyped(foundvalue);

  try {
    foundvalue = window[storage].getItem(key);
    if (foundvalue)
      return parseTyped(foundvalue);
  } catch (e) {
    //we ignore parse failures
  }
  return null;
}

function set(storage: BrowserStorage, key: string, value: unknown) {
  const tostore = value !== null && value !== undefined ? stringify(value, { typed: true }) : null;
  try {
    if (tostore !== null)
      window[storage].setItem(key, tostore);
    else
      window[storage].removeItem(key);
    return;
  } catch (e) {
    //ignore
  }

  const store = (backup[storage] ||= {});
  if (tostore !== null)
    store[key] = tostore;
  else
    delete store[key];
}

export function getSession<T>(key: string): T | null {
  return get("sessionStorage", key) as T | null;
}
export function setSession<T>(key: string, value: T) {
  set("sessionStorage", key, value);
}
export function getLocal<T>(key: string): T | null {
  return get("localStorage", key) as T | null;
}
export function setLocal<T>(key: string, value: T) {
  set("localStorage", key, value);
}
