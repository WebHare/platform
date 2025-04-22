export type CookieOptions = {
  path?: string;
  domain?: string | null;
  expires?: Date | Temporal.Instant | null;
  duration?: number | null;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type ServersideCookieOptions = CookieOptions & {
  httpOnly?: boolean;
};

export function buildCookieHeader(name: string, value: string, options?: ServersideCookieOptions) {
  let header = `${name}=${encodeURIComponent(value)}`;
  if (options?.domain)
    header += ';domain=' + options?.domain;
  header += ';path=' + (options?.path || '/');
  if (!value) //clearing a cookie, so ignore expires/duration and just set 1970
    header += ';expires=Thu, 01 Jan 1970 00:00:00 GMT';
  else if (options?.expires) //we need toUTCString to give us the proper Date formatting
    header += ';expires=' + ("epochMilliseconds" in options.expires ? new Date(options.expires.epochMilliseconds) : options.expires).toUTCString();
  else if (options?.duration) {
    const date = new Date();
    date.setTime(date.getTime() + options?.duration * 24 * 60 * 60 * 1000);
    header += ';expires=' + date.toUTCString();
  }
  if (options?.secure)
    header += ';secure';
  if (options?.sameSite)
    header += ';SameSite=' + options?.sameSite;
  if (options?.httpOnly) //NOTE browsers cannot effectively set this
    header += ';HttpOnly';
  return header;
}
