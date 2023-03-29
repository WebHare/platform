/** Create a regular expression from a string with DOS-like wildcards (? and *)
 * @param mask - Mask with '?' and/or '*' wildcards
 * @returns Regular expression string which can be passed to new RegExp
*/
export function wildcardsToRegExp(mask: string): string {
  mask = mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  mask = mask.replaceAll("\\*", ".*");
  mask = mask.replaceAll("\\?", ".");
  return mask;
}

export function encodeString(str: string, encoding = "base64url"): string {
  if (encoding === "base64url")
    return btoa(str).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
  throw new Error(`Invalid encoding '${encoding}'`);
}

export function decodeString(str: string, encoding = "base64url"): string {
  if (encoding === "base64url")
    return atob(str.replaceAll("-", "+").replaceAll("_", "/"));
  throw new Error(`Invalid encoding '${encoding}'`);
}
