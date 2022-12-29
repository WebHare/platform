//NOTE: Node19+ allows us to use just 'crypto.getRandomValues'. 18 requires the import
import { webcrypto as crypto } from 'node:crypto';

export function generateBase64UniqueID() {
  const u8array = new Uint8Array(16);
  crypto.getRandomValues(u8array);
  //TODO become a compatible generateufs128bitid() ?
  return Buffer.from(u8array).toString("base64url");
}
