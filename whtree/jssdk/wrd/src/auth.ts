import jwt, { JwtPayload } from "jsonwebtoken";
import { WRDSchema } from "@mod-wrd/js/internal/schema";
import { convertWaitPeriodToDate, generateRandomId, WaitPeriod } from "@webhare/std";
import { generateKeyPair, KeyObject, JsonWebKey, createPrivateKey, createPublicKey } from "node:crypto";
import { System_UsermgmtSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";

export async function createSigningKey(): Promise<JsonWebKey> {
  const pvtkey = await new Promise((resolve, reject) =>
    generateKeyPair('ec', { namedCurve: "P-256" }, (err, publicKey, privateKey) => {
      if (err)
        return reject(err);

      resolve(privateKey);
    })) as KeyObject;
  return pvtkey.export({ format: 'jwk' });
}

export interface JWKS {
  keys: JsonWebKey[];
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

/** Manage JWT tokens associated with a schema
 * @param wrdschema - The schema to create the token for
*/
export class AuthProvider<WRDSchemaType> {
  readonly wrdschema: WRDSchema<System_UsermgmtSchemaType>;

  constructor(wrdschema: WRDSchemaType) {
    //TODO can we cast to a 'real' base type instead of abusing System_UsermgmtSchemaType for the wrdSettings type?
    this.wrdschema = wrdschema as unknown as WRDSchema<System_UsermgmtSchemaType>;
  }

  async initializeIssuer(issuer: string): Promise<void> {
    const settingid = await this.wrdschema.search("wrdSettings", "wrdTag", "WRD_SETTINGS");
    if (!settingid)
      throw new Error("WRD_SETTINGS not found");

    //TODO keyIds aren't sensitive, we can use much smaller keyIds if we check for dupes ourselves to avoid collisons
    const primarykeyid = generateRandomId("uuidv4");

    await this.wrdschema.update("wrdSettings", settingid, {
      issuer: issuer,
      signingKeys: [{ availableSince: new Date, keyId: primarykeyid, privateKey: await createSigningKey() }]
    });
  }

  private async getKeyConfig() {
    const schema = this.wrdschema as unknown as WRDSchema<System_UsermgmtSchemaType>;
    const settingid = await schema.search("wrdSettings", "wrdTag", "WRD_SETTINGS");
    if (!settingid)
      throw new Error("WRD_SETTINGS not found");

    const settings = await schema.getFields("wrdSettings", settingid, { issuer: "issuer", signingKeys: "signingKeys" });
    if (!settings)
      throw new Error("WRD_SETTINGS not found");

    // @ts-ignore the cast are needed because TS thinks setting can be '{}' ?
    return { issuer: settings.issuer as string, signingKeys: settings.signingKeys as Array<{ privateKey: JsonWebKey; keyId: string }> };
  }

  async getPublicJWKS(): Promise<JWKS> {
    const config = await this.getKeyConfig();
    const keys: JsonWebKey[] = [];
    for (const key of config.signingKeys) {
      //Load the key
      const jwk = createPublicKey({ key: key.privateKey, format: 'jwk' }).export({ format: 'jwk' });
      keys.push({ ...jwk, issuer: config.issuer, use: "sig", kid: key.keyId });
    }
    return { keys };
  }
}
