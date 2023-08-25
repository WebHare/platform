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
    if (curch >= 32 && curch < 128 && curch != 38 && curch != 60 && curch != 62) {
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

function stableReplacer(this: unknown, key: unknown, value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort((lhs, rhs) => lhs < rhs ? -1 : lhs === rhs ? 0 : 1));
  }
  return value;
}

/** Encode as JSON with sorted keys for stable comparison */
export function stableStringify(arg: unknown, replacer?: (this: unknown, key: unknown, value: unknown) => unknown, space?: string | number) {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this -- a replacer needs a forwarded this
  const usereplacer = !replacer ? stableReplacer : function (this: unknown, key: unknown, value: unknown) {
    return stableReplacer.call(this, key, replacer!.call(this, key, value));
  };
  return JSON.stringify(arg, usereplacer, space);
}
