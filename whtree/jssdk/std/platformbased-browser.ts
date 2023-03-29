/** Generate a configurable random id (the default settings, base64url and 16 byes, match HareScript's GenerateUFS128BitId)
 * @param encoding - Encoding to use, base64url of hex. Default is base64url
 * @param bytes - Number of bytes to generate. Default is 16
 * @returns An encoded ID. With the default settings it will be a url (and filename) safe string of 22 characters in length
 */

export function generateRandomId(encoding: "base64url" | "hex" = "base64url", bytes: number = 16): string {
  const u8array = new Uint8Array(bytes);
  crypto.getRandomValues(u8array);
  if (encoding === "base64url")
    return btoa(String.fromCharCode.apply(null, u8array as unknown as number[])).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
  if (encoding === "hex")
    return [...u8array.values()].map(x => x.toString(16).padStart(2, "0")).join("");
  throw new Error(`Invalid encoding '${encoding}'`);
}
