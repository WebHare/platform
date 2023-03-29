//NOTE: Node19+ allows us to use just 'crypto.getRandomValues'. 18 requires the import
import { webcrypto as crypto } from 'node:crypto';

/** Generate a configurable random id (the default settings, base64url and 16 byes, match HareScript's GenerateUFS128BitId)
 * @param encoding - Encoding to use, base64url of hex. Default is base64url
 * @param bytes - Number of bytes to generate. Default is 16
 * @returns An encoded ID. With the default settings it will be a url (and filename) safe string of 22 characters in length
 */
export function generateRandomId(encoding: "base64url" | "hex" = "base64url", bytes: number = 16): string {
  const u8array = new Uint8Array(bytes);
  crypto.getRandomValues(u8array);
  return Buffer.from(u8array).toString(encoding);
}
