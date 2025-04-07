import { buildCookieHeader, type CookieOptions } from '@webhare/dompack/src/cookiebuilder';
import { escapeRegExp, parseTyped, stringify } from '@webhare/std';

const isolatedcookies: Record<string, string> = {};
const backup: {
  sessionStorage?: Record<string, string>;
  localStorage?: Record<string, string>;
} = {};
type BrowserStorage = keyof typeof backup;

/** We isolate ourselves for eg. widget previews - CI tests which same Chrome for both preview and tests so the previews start increasing visitorcounts behind our back
 @returns True if our storage is fully isolated */
export function isIsolated(): boolean {
  return typeof document === "undefined" || "whIsolateStorage" in document.documentElement.dataset;
}

export function listCookies() {
  if (isIsolated())
    return Object.entries(isolatedcookies).map((entry: string[]) => ({ name: entry[0].substring(2), value: entry[1] }));

  return document.cookie.split(';').map(cookie => {
    const parts = cookie.split('=');
    return { name: decodeURIComponent(parts[0].trim()), value: decodeURIComponent(parts[1] || '') };
  });
}

export function setCookie(key: string, value: string, options?: CookieOptions) {
  if (!isIsolated())
    document.cookie = buildCookieHeader(key, value, options);
  else if (!value || (options?.duration && options?.duration < 0 && options?.expires === undefined)) //TODO there are probably many more ways to delete a cookie ?
    delete isolatedcookies["c." + key];
  else
    isolatedcookies["c." + key] = value;
}

export function getCookie(key: string): string | null {
  if (isIsolated())
    return isolatedcookies["c." + key] || null;

  const value = document.cookie.match('(?:^|;)\\s*' + escapeRegExp(key) + '=([^;]*)');
  return (value) ? decodeURIComponent(value[1]) : null;
}

export function deleteCookie(key: string, options?: CookieOptions) {
  setCookie(key, '', { ...options, duration: -1, expires: undefined });
}

/** Report whether browser storage APIs are unavailable. They might not be in eg Chrome incognito 'Block third-party cookies'. */
let _available: boolean;
export function isStorageAvailable(): boolean {
  if (isIsolated())
    return false; //'true' until WH5.6, but actual users were expecting 'false' from isStorageAvailable if the storage is not present.

  if (_available === undefined) {
    try {
      _available = Boolean(window.sessionStorage);
    } catch (ignore) {
      _available = false;
    }
  }
  return _available as boolean;
}

function get(storage: BrowserStorage, key: string): unknown | null {
  let foundvalue: string | undefined | null = backup[storage]?.[key];
  if (foundvalue) //if it's in the backups storage encoding can't fail either
    return parseTyped(foundvalue);

  if (!isIsolated()) { //it's not in the backup
    try {
      foundvalue = window[storage].getItem(key);
      if (foundvalue)
        return parseTyped(foundvalue);
    } catch (e) {
      //we ignore parse failures
    }
  }
  return null;
}

function set(storage: BrowserStorage, key: string, value: unknown) {
  const tostore = value !== null && value !== undefined ? stringify(value, { typed: true }) : null;
  if (!backup[storage] && !isIsolated()) //we didn't fall back yet
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
