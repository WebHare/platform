/** This is currently more or less based on the mootools Cookie library */
/* eslint no-useless-escape: off */

import { isIsolated } from './storage';
import { escapeRegExp } from '@webhare/std';
const isolatedcookies: Record<string, string> = {};

export type CookieOptions =
  {
    path?: string;
    domain?: string | null;
    duration?: number | null;
    secure?: boolean;
    encode?: boolean;
    httponly?: boolean;
    samesite?: string;
  };

//based on mootools cookie
class Cookie {
  key: string;
  options: CookieOptions;

  constructor(key: string, options?: CookieOptions) {
    if (!options)
      options = {};

    this.key = key;
    this.options = {
      path: options.path ?? '/',
      domain: options.domain ?? null,
      duration: options.duration ?? null,
      secure: options.secure ?? false,
      encode: options.encode ?? true,
      httponly: options.httponly ?? false,
      samesite: options.samesite ?? ''
    };
  }
  write(value: string): Cookie {
    if (isIsolated()) {
      isolatedcookies["c." + this.key] = value;
      return this;
    }

    if (this.options.encode)
      value = encodeURIComponent(value);
    if (this.options.domain)
      value += '; domain=' + this.options.domain;
    if (this.options.path)
      value += '; path=' + this.options.path;
    if (this.options.duration) {
      const date = new Date();
      date.setTime(date.getTime() + this.options.duration * 24 * 60 * 60 * 1000);
      value += '; expires=' + date.toUTCString();
    }
    if (this.options.secure)
      value += '; secure';
    if (this.options.httponly)
      value += '; HttpOnly';
    if (this.options.samesite)
      value += '; SameSite=' + this.options.samesite;

    document.cookie = this.key + '=' + value;
    return this;
  }
  read(): string | null {
    if (isIsolated())
      return isolatedcookies["c." + this.key] || null;

    const value = document.cookie.match('(?:^|;)\\s*' + escapeRegExp(this.key) + '=([^;]*)');
    return (value) ? decodeURIComponent(value[1]) : null;
  }
  remove() {
    if (isIsolated()) {
      delete isolatedcookies["c." + this.key];
      return;
    }
    new Cookie(this.key, { ...this.options, duration: -1 }).write('');
  }
}

export function list() {
  if (isIsolated())
    return Object.entries(isolatedcookies).map((entry: string[]) => ({ name: entry[0].substring(2), value: entry[1] }));

  return document.cookie.split(';').map(cookie => {
    const parts = cookie.split('=');
    return { name: decodeURIComponent(parts[0].trim()), value: decodeURIComponent(parts[1] || '') };
  });
}

export function write(key: string, value: string, options?: CookieOptions) {
  return new Cookie(key, options).write(value);
}

export function read(key: string): string | null {
  return new Cookie(key).read();
}

export function remove(key: string, options?: CookieOptions) {
  new Cookie(key, options).remove();
}
