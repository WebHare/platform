import * as crypto from "node:crypto";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { parseTyped, stringify } from "@webhare/std";
import { decodeHSON } from "@webhare/hscompat";
import type { ServerEncryptionScopes } from "./services";

function getKeyForScope(scope: string): Buffer {
  const key = getFullConfigFile().secrets.gcm;
  if (!key)
    throw new Error("No gcm secret configured");

  const hash = crypto.createHash("SHA-256");
  hash.update(key, 'base64url');
  hash.update(scope, 'utf8');
  return hash.digest();
}

/** Encrypt data with this server's local key
    @param scope - Scope for encryption (must be unique for each Encrypt usage so you can't accidentally mix up calls)
    @param data - Data to sign and encrypt. Will be encoded as typed JSON if necessary
    @returns Encrypted data, base64url encoded (so safe for direct use in URLs)
*/
export function encryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, data: S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown): string {
  const iv = crypto.randomBytes(12);
  const key = getKeyForScope(scope);
  const text = stringify(data, { typed: true });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(text, 'utf8', 'base64url');
  enc += cipher.final('base64url');

  return `${enc}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

/** Decrypt data encrypted using encryptForThisServer
    @param scope - Scope for encryption (must be unique for each Encrypt usage so you can't accidentally mix up calls)
    @param text - Data to decrypt
    @param options - Options for decryption
    @param options.nullIfInvalid - If true, return null if the data is invalid (instead of throwing an error)
*/
export function decryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, text: string, options: { nullIfInvalid: true }): (S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown) | null;
export function decryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, text: string, options?: { nullIfInvalid?: boolean }): S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown;

export function decryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, text: string, options?: { nullIfInvalid?: boolean }): (S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown) | null {
  type RetVal = S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown;
  const [enc, iv, authTag] = text.split(".");
  if (!enc || !iv || !authTag)
    if (options?.nullIfInvalid)
      return null;
    else
      throw new Error("Invalid encrypted data");

  const key = getKeyForScope(scope);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  let str = decipher.update(enc, 'base64url', 'utf8');
  str += decipher.final('utf8');

  //HareScript EncryptForThisServer will always generate HSON so its 'default usage' remains 100% HS compatible. (TODO not sure if it useful to give it a 'typed json' option?)
  return str.startsWith("hson:") ? decodeHSON(str) as RetVal : parseTyped(str);
}

//Create a signature for this server
export function getSignatureForThisServer(scope: string, text: string): string {
  const hasher = crypto.createHash("SHA-256");
  hasher.update(text + "\t" + scope + "\t" + getFullConfigFile().secrets.cookie);
  return hasher.digest().toString("base64url");
}

//Validate a generated signature
export function validateSignatureForThisServer(scope: string, text: string, signature: string): boolean {
  return getSignatureForThisServer(scope, text) === signature;
}
