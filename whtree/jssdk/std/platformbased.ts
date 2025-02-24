/** Test whether a string looks like a valid random id */
export function isLikeRandomId(input: string) { //TODO add encoding parameter/bytes support ?
  return input.match(/^[A-Za-z0-9_-]{22}$/);
}

/** Generate a configurable random id (the default settings, base64url and 16 bytes, match HareScript's GenerateUFS128BitId)
 * @param encoding - Encoding to use, base64url, hex or uuidv4. Default is base64url
 * @param bytes - Number of bytes to generate. Default is 16
 * @returns An encoded ID. With the default settings it will be a url (and filename) safe string of 22 characters in length
 */
export function generateRandomId(encoding: "base64url" | "hex" | "uuidv4" = "base64url", bytes: number = 16): string {
  if (encoding === "uuidv4") {
    if (bytes !== 16)
      throw new Error("UUIDv4 encoding only supports 16 bytes");

    if (crypto.randomUUID) //NOTE: not available in non-secure contexts so the fallback can never go away
      return crypto.randomUUID();
  }

  const u8array = new Uint8Array(bytes);
  crypto.getRandomValues(u8array);

  if (encoding === "uuidv4") {
    u8array[6] = (u8array[6] & 0x0f) | 0x40;
    u8array[8] = (u8array[8] & 0x3f) | 0x80;
    return [...u8array.values()].map(x => x.toString(16).padStart(2, "0")).join("").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }

  if (encoding === "base64url")
    return btoa(String.fromCharCode.apply(null, u8array as unknown as number[])).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");

  if (encoding === "hex")
    return [...u8array.values()].map(x => x.toString(16).padStart(2, "0")).join("");

  throw new Error(`Invalid encoding '${encoding}'`);
}
