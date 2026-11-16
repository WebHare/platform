import * as crypto from "node:crypto";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { parseTyped, stringify } from "@webhare/std";
import { decodeHSON } from "@webhare/hscompat/src/hson";
import type { ServerEncryptionScopes } from "./services";
import { tryRetiredSecrets } from "./retiredsecrets";

export interface AlgorithmOptions {
  ///Override the default secret. This allows you to encrypt data that can be decrypted by (other) servers that know this secret
  secret?: string;
}

export interface DecryptOptions extends AlgorithmOptions {
  ///If true, return null if the data is invalid (instead of throwing an error)
  nullIfInvalid?: boolean;
  ///If true, also accept data encrypted with a retired secret that hasn't been disabled yet
  acceptRetired?: boolean;
}

/** Get the key for a scope
    @param scope - Scope
    @param options - Algorithm options
    @param gcmSecret - Cluster GCM secret to use instead of the current one (eg a retired secret)
*/
function getKeyForScope(scope: string, options?: AlgorithmOptions, gcmSecret?: string): Buffer {
  const hash = crypto.createHash("SHA-256");
  if (options?.secret) {
    hash.update(options.secret + "\t", 'utf8');
  } else {
    const key = gcmSecret ?? getFullConfigFile().secrets.gcm;
    if (!key)
      throw new Error("No gcm secret configured");

    hash.update(key, 'base64url');
  }
  hash.update(scope, 'utf8');
  return hash.digest();
}

function decryptWithKey(key: Buffer, enc: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  let str = decipher.update(enc, 'base64url', 'utf8');
  str += decipher.final('utf8');
  return str;
}

/** Encrypt data with this server's local key
    @param scope - Scope or audience for encryption. This must be unique for each Encrypt usage so users cannot reuse encrypted data for a different API/call
    @param data - Data to sign and encrypt. Will be encoded as typed JSON if necessary
    @returns Encrypted data, base64url encoded (so safe for direct use in URLs)
    @example

// Set up the data format you will use for TypeScript
declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "mymodule:myscope": {
      field: string;
    };
  }
}

const enctoken = encryptForThisServer("mymodule:myscope", { field: "value" });
*/
export function encryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, data: S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown, options?: AlgorithmOptions): string {
  const iv = crypto.randomBytes(12);
  const key = getKeyForScope(scope, options);
  const text = stringify(data, { typed: true });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(text, 'utf8', 'base64url');
  enc += cipher.final('base64url');

  return `${enc}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

/** Decrypt data encrypted using encryptForThisServer
    @param scope - Scope or audience for encryption. This must be unique for each Encrypt usage so users cannot reuse encrypted data for a different API/call
    @param text - Data to decrypt
    @param options - Options for decryption
    @param options.nullIfInvalid - If true, return null if the data is invalid (instead of throwing an error)
    @param options.acceptRetired - If true, also accept data encrypted with a retired secret that hasn't been disabled yet.
      Only use this for data that may need to remain valid for a long time and is not security sensitive, eg. form targets in published pages.
*/
export function decryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, text: string, options: { nullIfInvalid: true } & DecryptOptions): (S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown) | null;
export function decryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, text: string, options?: DecryptOptions): S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown;

export function decryptForThisServer<S extends string>(scope: keyof ServerEncryptionScopes | S, text: string, options?: DecryptOptions): (S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown) | null {
  type RetVal = S extends keyof ServerEncryptionScopes ? ServerEncryptionScopes[S] : unknown;
  const [enc, iv, authTag] = text.split(".");
  if (!enc || !iv || !authTag)
    if (options?.nullIfInvalid)
      return null;
    else
      throw new Error("Invalid encrypted data");

  try {
    let str: string;
    try {
      str = decryptWithKey(getKeyForScope(scope, options), enc, iv, authTag);
    } catch (err) {
      //Retired secrets only apply to the cluster secret, not to explicitly specified secrets
      const retired = options?.secret ? null : tryRetiredSecrets("gcm", scope, options?.acceptRetired ?? false, secret => decryptWithKey(getKeyForScope(scope, options, secret), enc, iv, authTag));
      if (retired === null)
        throw err;
      str = retired;
    }

    //HareScript EncryptForThisServer will always generate HSON so its 'default usage' remains 100% HS compatible. (TODO not sure if it useful to give it a 'typed json' option?)
    return str.startsWith("hson:") ? decodeHSON(str) as RetVal : parseTyped(str);
  } catch (err) {
    if (options?.nullIfInvalid)
      return null;
    throw err;
  }
}

function calculateSignature(cookieSecret: string, scope: string, text: string): string {
  const hasher = crypto.createHash("SHA-256");
  hasher.update(text + "\t" + scope + "\t" + cookieSecret);
  return hasher.digest().toString("base64url");
}

//Create a signature for this server
export function getSignatureForThisServer(scope: string, text: string): string {
  return calculateSignature(getFullConfigFile().secrets.cookie, scope, text);
}

//Validate a generated signature. Signatures made with a retired secret are never accepted, but are logged
export function validateSignatureForThisServer(scope: string, text: string, signature: string): boolean {
  if (getSignatureForThisServer(scope, text) === signature)
    return true;

  tryRetiredSecrets("cookie", scope, false, secret => calculateSignature(secret, scope, text) === signature ? true : null);
  return false;
}
