import { Money } from "./money";

/** Encode string for use in a regexp
 * @param text - Text to encode
 * @returns Encoded for safe use in a RegExp
*/
export function escapeRegExp(text: string) {
  return text.replaceAll(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&'); // $& means the whole matched string
}

/** Create a regular expression from a string with DOS-like wildcards (? and *)
 * @param mask - Mask with '?' and/or '*' wildcards
 * @returns Regular expression string which can be passed to new RegExp
*/
export function wildcardsToRegExp(mask: string): string {
  mask = escapeRegExp(mask);
  mask = mask.replaceAll("\\*", ".*");
  mask = mask.replaceAll("\\?", ".");
  return mask;
}

function isHTMLUnrepresentableChar(curch: number) {
  return (curch < 32 && curch != 9 && curch != 10 && curch != 13)
    || (curch >= 128 && curch <= 159);
}

function encodeEntities(str: string, html: boolean) {
  let s = "";
  for (const char of str) {
    const curch = char.codePointAt(0);
    if (curch == undefined || isHTMLUnrepresentableChar(curch))
      continue;
    if (curch >= 32 && curch < 128 && curch != 38 && curch != 60 && curch != 62 && (html || curch != 34 && curch != 39)) {
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

      if (origvalue instanceof Money)
        value = { "$stdType": "Money", money: origvalue.value };
      else if (origvalue instanceof Date)
        value = { "$stdType": "Date", date: origvalue.toISOString() };
      else if (typeof origvalue === "object" && (origvalue as { "$stdType": string })?.["$stdType"])
        throw new Error(`Cannot encode objects with already embedded '$stdType's`);
      else if (typeof origvalue === "bigint")
        value = { "$stdType": "BigInt", bigint: origvalue.toString() };
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

/** @deprecated Use the more generic stringify instead in 5.4 (and consider your target!) */
export function stableStringify(arg: unknown, replacer?: JSONReplacerArgument, space?: string | number) {
  return stringify(arg, { replacer, space, stable: true });
}
/** Decode JSON with types (Generated using stringify with typed:true ) */
export function parseTyped(input: string) {
  return JSON.parse(input, (key, value) => {
    switch (value?.["$stdType"]) {
      case "Money":
        return new Money(value.money);
      case "Date":
        return new Date(value.date);
      case "BigInt":
        return BigInt(value.bigint as string);
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
    @returns True if the email address would appears to be a well-formed email address to a non-greybeard
*/
export function isValidEmail(email: string) {
  if (email.length > 254) //TODO count bytes instead of characters
    return false;

  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*(?:\.[a-zA-Z0-9-]{2,})$/.test(email);
}
