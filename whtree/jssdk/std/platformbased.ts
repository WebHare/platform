/** Generate a configurable random id (the default settings, base64url and 16 bytes, match HareScript's GenerateUFS128BitId)
 * @param encoding - Encoding to use, base64url, hex or uuidv4. Default is base64url
 * @param bytes - Number of bytes to generate. Default is 16
 * @returns An encoded ID. With the default settings it will be a url (and filename) safe string of 22 characters in length
 */
export function generateRandomId(encoding: "base64url" | "hex" | "uuidv4" = "base64url", bytes: number = 16): string {
  if (encoding === "uuidv4") {
    if (bytes !== 16)
      throw new Error("UUIDv4 encoding only supports 16 bytes");

    return crypto.randomUUID();
  }

  const u8array = new Uint8Array(bytes);
  crypto.getRandomValues(u8array);
  return Buffer.from(u8array).toString(encoding);
}
