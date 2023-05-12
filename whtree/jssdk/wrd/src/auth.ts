import jwt, { JwtPayload } from "jsonwebtoken";
import { convertWaitPeriodToDate, generateRandomId, WaitPeriod } from "@webhare/std";
import { generateKeyPair, KeyObject, JsonWebKey, createPrivateKey, createPublicKey } from "node:crypto";

export async function createSigningKey(): Promise<JsonWebKey> {
  const pvtkey = await new Promise((resolve, reject) =>
    generateKeyPair('ec', { namedCurve: "P-256" }, (err, publicKey, privateKey) => {
      if (err)
        return reject(err);

      resolve(privateKey);
    })) as KeyObject;
  return pvtkey.export({ format: 'jwk' });
}

interface JWTCreationOptions {
  scopes?: string[];
  audiences?: string[];
}

/** Create a WRDAuth JWT token.
 * @param key - JWK key to sign the token with
 * @param keyid - The id for htis key
 * @param issuer - Toknen issuer
 * @param subject - The subject of the token
 * @param expires - The expiration date of the token, or Infinity
 * @param options - scopes: List of scopes this key is valid for.
 * @returns The JWT token
*/
export async function createJWT(key: JsonWebKey, keyid: string, issuer: string, subject: string, expires: WaitPeriod, options?: JWTCreationOptions): Promise<string> {
  if (typeof expires === "number" && expires <= 0)
    throw new Error(`Expiry period may not be zero or negative`);

  const now = Date.now();
  /* All official claims are on https://www.iana.org/assignments/jwt/jwt.xhtml#claims */
  const payload: JwtPayload = {
    iss: issuer,
    iat: Math.floor(now / 1000),
    nbf: Math.floor(now / 1000),
    nonce: generateRandomId("base64url", 16),
  };

  if (expires !== Infinity)
    payload.exp = Math.floor(convertWaitPeriodToDate(expires).getTime() / 1000);
  if (subject)
    payload.sub = subject;
  if (options?.scopes?.length)
    payload.scope = options.scopes.join(" ");
  if (options?.audiences?.length)
    payload.aud = options.audiences.length == 1 ? options.audiences[0] : options.audiences;

  const signingkey = createPrivateKey({ key: key, format: 'jwk' }); //TODO use async variant
  return jwt.sign(payload, signingkey, { keyid, algorithm: "ES256" });
}

export async function verifyJWT(key: JsonWebKey, issuer: string, token: string): Promise<JwtPayload> {
  // const data = jwt.decode(token, { complete: true });
  // console.log(data);
  const jwk = createPublicKey({ key: key, format: 'jwk' });
  const data = jwt.verify(token, jwk, { issuer }); //TODO use async variant

  if (typeof data !== "object")
    throw new Error("Invalid JWT token");

  return data;
}

