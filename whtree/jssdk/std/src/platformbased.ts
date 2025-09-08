/** Test whether a string looks like a valid random id */
export function isLikeRandomId(input: string): boolean { //TODO add encoding parameter/bytes support ?
  return Boolean(input.match(/^[A-Za-z0-9_-]{22}$/));
}

/** Test whether a string is a valid hex UUID
 * @param input - uuid in hex format to verify. you may need to lowercase the uuid first
 * @param format - optional, if set to "v4" it will only accept UUIDv4 format
*/
export function isValidUUID(input: string, format?: "v4"): boolean {
  //we'll require you to lowercase the uuid first to increase the chance that you'll actually be storing/matching it in lowercase too

  if (format === "v4")
    return Boolean(input.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
  else if (format !== undefined)
    throw new Error(`Unsupported format '${format}'`);
  else
    return Boolean(input.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/));
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
