export type CookieOptions = {
  path?: string;
  domain?: string | null;
  expires?: Date | null;
  duration?: number | null;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type ServersideCookieOptions = CookieOptions & {
  httpOnly?: boolean;
};

export function buildCookieHeader(name: string, value: string, options?: ServersideCookieOptions) {
  value = encodeURIComponent(value);
  if (options?.domain)
    value += ';domain=' + options?.domain;
  value += ';path=' + (options?.path || '/');
  if (options?.expires)
    value += ';expires=' + options?.expires.toUTCString();
  else if (options?.duration) {
    const date = new Date();
    date.setTime(date.getTime() + options?.duration * 24 * 60 * 60 * 1000);
    value += ';expires=' + date.toUTCString();
  }
  if (options?.secure)
    value += ';secure';
  if (options?.sameSite)
    value += ';SameSite=' + options?.sameSite;
  if (options?.httpOnly) //NOTE browsers cannot effectively set this
    value += ';HttpOnly';
  return `${name}=${value}`;
}
