import { stdTypeOf } from "./quacks";
import { Money } from "./money";

export type WildcardTypes = "?*";

/** Encode string for use in a regexp
 * @param text - Text to encode
 * @param wildcards - Type of wildcards to encode (defaults to none)
 * @returns Encoded for safe use in a RegExp
*/
export function escapeRegExp(text: string, options?: { wildcards?: WildcardTypes }): string {
  let mask = text.replaceAll(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&'); // $& means the whole matched string
  if (options?.wildcards === "?*") {
    mask = mask.replaceAll("\\*", ".*");
    mask = mask.replaceAll("\\?", ".");
  }
  return mask;
}

/** Create a regular expression from one or more wildcard masks
 * @param masks - One or more masks with '?' and/or '*' wildcards
 * @returns Regular expression string
*/
export function regExpFromWildcards(masks: string | string[], options?: { wildcards?: WildcardTypes; caseInsensitive?: boolean }): RegExp {
  if (Array.isArray(masks) && masks.length === 0)
    throw new Error("Empty mask list");

  const code = Array.isArray(masks)
    ? `^(${masks.map(mask => escapeRegExp(mask, { wildcards: options?.wildcards || "?*" })).join('|')})$`
    : `^${escapeRegExp(masks, { wildcards: options?.wildcards || "?*" })}$`;
  return new RegExp(code, options?.caseInsensitive ? "i" : undefined);
}

function isHTMLUnrepresentableChar(curch: number) {
  return (curch < 32 && curch !== 9 && curch !== 10 && curch !== 13)
    || (curch >= 128 && curch <= 159);
}

function encodeEntities(str: string, html: boolean) {
  let s = "";
  for (const char of str) {
    const curch = char.codePointAt(0);
    if (curch === undefined || isHTMLUnrepresentableChar(curch))
      continue;
    if (curch >= 32 && curch < 128 && curch !== 38 && curch !== 60 && curch !== 62 && (html || curch !== 34 && curch !== 39)) {
      s += String.fromCodePoint(curch);
      continue;
    }

    switch (curch) {
      case 10:
        {
          if (html) {
            s += "<br>";
            continue;
          }
          break;
        }
      case 13:
        {
          if (html)
            continue;
          break;
        }
      case 34:
        {
          s += "&quot;";
          continue;
        }
      case 38:
        {
          s += "&amp;";
          continue;
        }
      case 39:
        {
          s += "&apos;";
          continue;
        }
      case 60:
        {
          s += "&lt;";
          continue;
        }
      case 62:
        {
          s += "&gt;";
          continue;
        }
    }

    s += "&#" + curch + ";";
  }
  return s;
}

function decodeEntities(str: string, html: boolean) {
  if (html)
    str = str.replace(/<br *\/?>/g, "\n");

  str = str.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

  return str;
}

export type StringEncodings = "base64url" | "attribute" | "html";

export function encodeString(str: string, encoding: StringEncodings): string {
  if (encoding === "base64url")
    return btoa(str).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
  if (encoding === "attribute")
    return encodeEntities(str, false);
  if (encoding === "html")
    return encodeEntities(str, true);

  throw new Error(`Invalid encoding '${encoding}'`);
}

export function decodeString(str: string, encoding: StringEncodings): string {
  if (encoding === "base64url")
    return atob(str.replaceAll("-", "+").replaceAll("_", "/"));
  if (encoding === "attribute")
    return decodeEntities(str, false);
  if (encoding === "html")
    return decodeEntities(str, true);

  throw new Error(`Invalid encoding '${encoding}'`);
}

type JSONReplacerArgument = ((this: unknown, key: string, value: unknown) => unknown) | undefined;

export interface StringifyOptions {
  replacer?: JSONReplacerArgument;
  space?: string | number;
  stable?: boolean;
  ///Encode with types (preserve Money, Date, BigInt). Needs std.parseTyped
  typed?: boolean;
  ///What to target: string (like JSON.stringify), script (escapes '/') or attribute (escapes '/' and applies attribute encoding)
  target?: "string" | "script" | "attribute";
}

/** Improved JSON encoder
 * @param arg - Object to encode
 * @param options - Encoding options
*/
export function stringify(arg: unknown, options?: StringifyOptions) {
  const usereplacer: JSONReplacerArgument = options?.stable || options?.typed ? (function (this: unknown, key: string, value: unknown) {
    if (options.typed) {
      const origvalue = (this as Record<string, unknown>)[key]; //We can't use 'value' as .toJSON() will already have been invoked
      const type = stdTypeOf(origvalue);
      switch (type) {
        case "function":
          throw new Error(`Cannot stringify property '${key}' of type "${type}'`);
        case "Date":
          value = { "$stdType": "Date", date: (origvalue as Date).toISOString() };
          break;
        case "Money":
        case "bigint":
        case "Instant":
        case "PlainDate":
        case "PlainDateTime":
        case "ZonedDateTime":
          value = { "$stdType": type, [type.toLowerCase()]: (origvalue as { toString: () => string }).toString() };
          break;
        case "object":
          if ("$stdType" in (origvalue as { "$stdType": string }))
            throw new Error(`Cannot encode objects with already embedded '$stdType's`);
        //fallthrough
      }
    }
    if (options.stable && value && typeof value === "object" && !Array.isArray(value))
      value = Object.fromEntries(Object.entries(value).sort((lhs, rhs) => lhs < rhs ? -1 : lhs === rhs ? 0 : 1));
    if (options.replacer)
      value = options.replacer.call(this, key, value);
    return value;
  }) : options?.replacer ?? undefined;

  let result = JSON.stringify(arg, usereplacer, options?.space);
  if (options?.target && ["script", "attribute"].includes(options.target)) {
    result = result.replaceAll("/", "\\/");
    if (options.target === "attribute")
      result = encodeEntities(result, false);
  }
  return result;
}

/** Decode JSON with types (Generated using stringify with typed:true ) */
export function parseTyped(input: string) {
  return JSON.parse(input, (key, value) => {
    switch (value?.["$stdType"]) {
      case "Money":
        return new Money(value.money);
      case "Date":
        return new Date(value.date);
      case "bigint":
      case "BigInt": //pre wh5.7 spelling
        return BigInt(value.bigint as string);
      case "Instant":
      case "PlainDate":
      case "PlainDateTime":
      case "ZonedDateTime":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we just assume/require you to have Temporal installed if you expect to receive/decode Temporal types. browsers should catch up eventually
        if (!(globalThis as any).Temporal)
          throw new Error(`Temporal is not available in this environment, cannot deserialize value of type Temporal.${value["$stdType"]}. Load eg. @webhare/deps/temporal-polyfill to use Temporal types in browsers`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we just assume/require you to have Temporal installed if you expect to receive/decode Temporal types. browsers should catch up eventually
        return (globalThis as any).Temporal[value["$stdType"]].from(value[value["$stdType"].toLowerCase()]);
      case undefined:
        return value;
      default:
        throw new Error(`Unrecognized type '${value["$stdType"]}'`);
    }
  });
}

/** Generate a slug from a (suggested) (file)name
 * @param text - Text to convert
 * @param separator - Separator to use between words (defaults to '-')
 * @param keep - Set of characters to keep in addition to a-z0-9
 * @returns Slugified text or null if we couldn't generate anything reeadable
 */
export function slugify(text: string, { separator = "-", keep = "" }: {
  separator?: string;
  keep?: string;
} = {}): string | null {
  //This function mixes HS getSafeName with a few more modern approaches
  const keepclass = `[^a-z0-9${escapeRegExp(keep)}]`;
  text = text
    .normalize('NFD')                   // split an accented letter in the base letter and the acent
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u001F]/g, '')
    .replaceAll(/[\u0300-\u036f]/g, '')   // remove all previously split accents
    .replaceAll(/ß/g, 'ss')               // german ss
    .toLowerCase()
    .replace(new RegExp(`^${keepclass}+`), "") //replace bad characters at the start
    .replace(new RegExp(`${keepclass}+$`), "") //.. and end
    .replaceAll(new RegExp(`${keepclass}+`, "g"), separator); // replace all non alphanumeric/space with a single dash

  return text || null; //we return 'null' on purpose so callers realize we won't necessarily give them a string!
}

/** Check if an email address is valid in modern times (an emailcheck much closer to what a browser would do, with additional sanity checks. No attempt to allow all legacy styles supported by the RFCs but 99.9%+ sure to be an error if seen submitted in a form
    @returns True if the email address appears to be a well-formed email address to a non-greybeard
*/
export function isValidEmail(email: string): boolean {
  if (email.length > 254) //TODO count bytes instead of characters
    return false;

  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*(?:\.[a-zA-Z0-9-]{2,})$/.test(email);
}

/** Joins a path to a URL, eliminating any double slash (similar to NodeJS path.join)
 * @param baseurl - URL to join to
 * @param path - Path to join. May not contain '.' or '..' segments in the path
 * @returns Joined URL, with a single slash between both parts
*/
export function joinURL(baseurl: string, path: string) {
  const pathtoks = path.match(/([^?#]*)(.*)/)!; //this will always return something
  if (pathtoks[1].match(/(\/\/)|:/))
    throw new Error(`Invalid path to merge with: ${path}`);
  //look for any . or .. path segments
  if (("/" + path + "/").match(/\/\.\.?\//))
    throw new Error(`Invalid path to merge with: ${path}`);

  if (baseurl.endsWith("/"))
    baseurl = baseurl.substring(0, baseurl.length - 1);
  return baseurl + (path.startsWith("/") ? path : "/" + path);
}

function unpackUrl(inUrl: string) {
  const retval = {
    inUrl,
    scheme: "",
    schemeSpecificPart: "",
    user: "",
    password: "",
    host: "",
    port: 0,
    urlPathSlash: false,
    urlPath: "",
    secure: false,
    specifiedPort: false,
    isDefaultPort: false,
    origin: "",
  };
  let missingSlash = false;
  const firstColon = inUrl.indexOf(":");
  if (firstColon < 0) {
    retval.scheme = inUrl;
    return retval;
  }

  retval.scheme = decodeURIComponent(inUrl.substring(0, firstColon)).toLowerCase();
  inUrl = inUrl.substring(firstColon + 1);
  retval.schemeSpecificPart = inUrl;

  if (!retval.schemeSpecificPart.startsWith("//")) //not an internet host format
    return retval;

  inUrl = inUrl.substring(2);

  //Find the first slash, it terminates the user..port part
  let firstSlash = inUrl.indexOf("/");
  if (firstSlash < 0)
    firstSlash = inUrl.length;

  const firstAt = inUrl.indexOf("@");
  if (firstAt >= 0 && firstAt < firstSlash) {
    //Username and possible password are present
    const pwdColon = inUrl.indexOf(":");
    if (pwdColon >= 0 && pwdColon < firstAt) {
      retval.user = decodeURIComponent(inUrl.substring(0, pwdColon));
      retval.password = decodeURIComponent(inUrl.substring(pwdColon + 1, firstAt));
    } else {
      retval.user = decodeURIComponent(inUrl.substring(0, firstAt));
    }
    inUrl = inUrl.substring(firstAt + 1);
    firstSlash = inUrl.indexOf("/");
    if (firstSlash < 0)
      firstSlash = inUrl.length;
  }

  //Common mistake, at least in http* urls, specifying a ? right after the URL (ADDME perhaps this shoud apply for all URLs? check rfc)
  if (retval.scheme === "http" || retval.scheme === "https") {
    const firstQuestionMark = inUrl.indexOf("?");
    if (firstQuestionMark >= 0 && firstQuestionMark < firstSlash) {
      firstSlash = firstQuestionMark;
      missingSlash = true;
    }
  }

  let closingBracket = 0;
  if (inUrl.startsWith("[")) //RFC3986 IP-literal
    closingBracket = inUrl.indexOf("]");

  if (closingBracket > 0) { //Indeed an IP-literal
    retval.host = decodeURIComponent(inUrl.substring(1, closingBracket));
    if (inUrl[closingBracket + 1] === ':') //port follows
      retval.port = parseInt(decodeURIComponent(inUrl.substring(closingBracket + 2, firstSlash - 1)), 0) || 0;
    else
      retval.port = getSchemeDefaultPort(retval.scheme);
  } else {
    const portColon = inUrl.indexOf(":");
    if (portColon >= 0 && portColon < firstSlash) {
      retval.host = decodeURIComponent(inUrl.substring(0, portColon));
      retval.port = parseInt(decodeURIComponent(inUrl.substring(portColon + 1, firstSlash)), 0) || 0;
      retval.specifiedPort = true;
      retval.isDefaultPort = retval.port === getSchemeDefaultPort(retval.scheme);
    } else {
      retval.host = decodeURIComponent(inUrl.substring(0, firstSlash));
      retval.port = getSchemeDefaultPort(retval.scheme);
      retval.isDefaultPort = true;
    }
  }

  retval.urlPathSlash = !(missingSlash || firstSlash === inUrl.length);
  retval.urlPath = inUrl.substring(firstSlash + (missingSlash ? 0 : 1));
  retval.secure = ["aas", "ftps", "https", "imaps", "ldaps", "shttp", "sips", "ssh", "sftp"].includes(retval.scheme);
  if (retval.host)
    retval.origin = retval.scheme + "://" + retval.host + (retval.isDefaultPort ? "" : ":" + retval.port);
  return retval;
}

function getSchemeDefaultPort(scheme: string) {
  switch (scheme) {//port numbers from RFC1738
    case "ftp": return 21;
    case "http": return 80;
    case "ws": return 80;
    case "gopher": return 70;
    case "nntp": return 119;
    case "telnet": return 23;
    case "wais": return 210;
    case "prospero": return 1525;
    //well known protocols
    case "https": return 443;
    case "wss": return 443;
    case "ldap": return 389;
    case "ldaps": return 636;
    case "smtp": return 25;
    default: return 0;
  }
}


/** Test whether an URL is a valid url. This function verifies that an URL looks
 * like an URL. If the scheme is recognized, more  stringent checks are performed
 * @returns True if the url appears to be a well-formed url
 */
export function isValidUrl(url: string): boolean {
  // test: no control characters or spaces (0x00 - 0x20)
  // test: starts with 'scheme' ':' anychar +
  // test: scheme only has letters, numbers, '-', '.' or '+' (and is not empty)
  // Unpack url
  // test: for http/https schema, hostname is not empty and port is in range 1-65535

  // eslint-disable-next-line no-control-regex
  if (!url.match(/^[-.+a-zA-Z0-9]+:[^\x00-\x20]+$/))
    return false;
  const unpacked = unpackUrl(url);
  if (unpacked.scheme !== "http" && unpacked.scheme !== "https")
    return true;
  if (unpacked.port < 1 || unpacked.port > 65535 || !unpacked.host)
    return false;
  return true;
}

/** Uppercases a string using the C-locale (so only the ASCII characters a-z are uppercased)
 * @param str - String to uppercase
 * @returns Uppercased string
 */
export function toCLocaleUppercase(str: string) {
  return str.replaceAll(/[a-z]+/g, part => part.toUpperCase());
}

/** Lowercases a string using the C-locale (so only the ASCII characters A-Z are lowercased)
 * @param str - String to lowercase
 * @returns Lowercased string
 */
export function toCLocaleLowercase(str: string) {
  return str.replaceAll(/[A-Z]+/g, part => part.toLowerCase());
}

/** Calculate the levenshtein distance between two strings */
export function levenshteinDistance(a: string, b: string): number {
  /* calculateLevenshteinDistance is adopted from https://github.com/gustf/js-levenshtein/blob/master/index.js, licensed MIT © Gustaf Andersson
    Picked over fastest-levenshtein because a permanent 256KB memory area for a bit more speed doesn't seem worth it
  */
  function _min(d0: number, d1: number, d2: number, bx: number, ay: number) {
    return d0 < d1 || d2 < d1
      ? d0 > d2
        ? d2 + 1
        : d0 + 1
      : bx === ay
        ? d1
        : d1 + 1;
  }

  if (a === b) {
    return 0;
  }

  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  let la = a.length;
  let lb = b.length;

  while (la > 0 && (a.charCodeAt(la - 1) === b.charCodeAt(lb - 1))) {
    la--;
    lb--;
  }

  let offset = 0;

  while (offset < la && (a.charCodeAt(offset) === b.charCodeAt(offset))) {
    offset++;
  }

  la -= offset;
  lb -= offset;

  if (la === 0 || lb < 3) {
    return lb;
  }

  let x = 0;
  let y, d0, d1, d2, d3, dd = 0, dy, ay, bx0, bx1, bx2, bx3;

  const vector: number[] = [];

  for (y = 0; y < la; y++) {
    vector.push(y + 1);
    vector.push(a.charCodeAt(offset + y));
  }

  const len = vector.length - 1;

  for (; x < lb - 3;) {
    bx0 = b.charCodeAt(offset + (d0 = x));
    bx1 = b.charCodeAt(offset + (d1 = x + 1));
    bx2 = b.charCodeAt(offset + (d2 = x + 2));
    bx3 = b.charCodeAt(offset + (d3 = x + 3));
    dd = (x += 4);
    for (y = 0; y < len; y += 2) {
      dy = vector[y];
      ay = vector[y + 1];
      d0 = _min(dy, d0, d1, bx0, ay);
      d1 = _min(d0, d1, d2, bx1, ay);
      d2 = _min(d1, d2, d3, bx2, ay);
      dd = _min(d2, d3, dd, bx3, ay);
      vector[y] = dd;
      d3 = d2;
      d2 = d1;
      d1 = d0;
      d0 = dy;
    }
  }

  for (; x < lb;) {
    bx0 = b.charCodeAt(offset + (d0 = x));
    dd = ++x;
    for (y = 0; y < len; y += 2) {
      dy = vector[y];
      vector[y] = dd = _min(dy, d0, dd, bx0, vector[y + 1]);
      d0 = dy;
    }
  }

  return dd;
}

/** Return the length of the string in bytes when UTF-8 encoded */
export function getUTF8Length(str: string) {
  return new TextEncoder().encode(str).length;
}

/** Truncate the string so it's at most len UTF-8 bytes long */
export function limitUTF8Length(str: string, len: number) {
  // TextEncoder.encodeInto writes into the given array until there's no more room to add more valid UTF-8 sequences from the
  // source. We can use this property to limit the number of bytes by creating an array that has room for at most the given
  // number of bytes.
  const utf8array = new Uint8Array(len);
  // This function returns the actual number of bytes written to the array
  const { written } = new TextEncoder().encodeInto(str, utf8array);
  // Decode only the actually written bytes
  return new TextDecoder().decode(utf8array.subarray(0, written));
}
