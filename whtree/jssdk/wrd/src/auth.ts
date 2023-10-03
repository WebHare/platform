import jwt, { JwtPayload, VerifyOptions } from "jsonwebtoken";
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

export interface JWTCreationOptions {
  scopes?: string[];
  audiences?: string[];
}

export interface JWTVerificationOptions {
  audience?: string | RegExp | Array<string | RegExp>;
}

export interface SessionCreationOptions extends JWTCreationOptions {
  expires?: WaitPeriod;
  settings?: Record<string, unknown>;
}

export interface CreateSessionResult {
  ///wrdId of newly inserted session entity
  sessionWrdId: number;
  ///the JWT token to return
  token: string;
}

export interface VerifySessionResult {
  ///wrdId of the found subject
  subjectWrdId: number;
  ///the decooded and validated payload
  payload: JwtPayload;
  ///decoded scopes
  scopes: string[];
}

/** Configuring the WRDAuth provider */
export interface AuthProviderConfiguration {
  /** The type storing tokens. Must implement the AccessToken interface */
  tokenType?: string;
  /** JWT expiry. */
  expires?: WaitPeriod;
  /** Our audience */
  audience?: string;
}

/** Create a WRDAuth JWT token.
 * @param key - JWK key to sign the token with
 * @param keyid - The id for this key
 * @param issuer - Token issuer
 * @param subject - The subject of the token
 * @param expires - The expiration date of the token, or Infinity
 * @param options - scopes: List of scopes this token is valid for (Note: scopes cannot contain spaces)
 *                  audiences: The intended audiences for this token
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

export async function verifyJWT(key: JsonWebKey, issuer: string, token: string, options?: JWTVerificationOptions): Promise<JwtPayload> {
  const jwk = createPublicKey({ key: key, format: 'jwk' });
  const verifyoptions: VerifyOptions = { issuer };
  if (options?.audience)
    verifyoptions.audience = options.audience;

  const data = jwt.verify(token, jwk, verifyoptions); //TODO use async variant

  if (typeof data !== "object")
    throw new Error("Invalid JWT token");

  return data;
}

/** Manage JWT tokens associated with a schema
 * @param wrdschema - The schema to create the token for
*/
export class AuthProvider<WRDSchemaType> {
  readonly wrdschema: WRDSchema<System_UsermgmtSchemaType>;
  readonly config: AuthProviderConfiguration;

  constructor(wrdschema: WRDSchemaType, config?: AuthProviderConfiguration) {
    //TODO can we cast to a 'real' base type instead of abusing System_UsermgmtSchemaType for the wrdSettings type?
    this.wrdschema = wrdschema as unknown as WRDSchema<System_UsermgmtSchemaType>;
    this.config = config || {};
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

    return { issuer: settings.issuer, signingKeys: settings.signingKeys };
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

  /* TODO:
     - do we need an intermediate 'createJWT' that uses the schema's configuration but doesn't create the tokens in the database?
     - do we need to support an 'ephemeral' mode where we don't actually commit the tokens to the database? (more like current wrdauth which only has
       password reset as a way to clear tokens)
  */

  /** Lookup the accounttype for the specified token type */
  private async getAccountType() {
    if (!this.config.tokenType)
      throw new Error(`No tokentype configured for this authentication provider`);

    const tokentypeinfo = await this.wrdschema.describeType(this.config.tokenType);
    if (!tokentypeinfo)
      throw new Error(`Tokentype ${this.config.tokenType} does not exist`);
    if (!tokentypeinfo.left)
      throw new Error(`Tokentype ${this.config.tokenType} does not have a left-side type`);

    return tokentypeinfo.left;
  }

  /** Create a session
   * @param subject - The subject of the session. Must be the left entity of the config.tokentype
  */
  async createSession(subject: number, options?: SessionCreationOptions): Promise<CreateSessionResult> {
    const config = await this.getKeyConfig();
    if (!config || !config.issuer || !config.signingKeys?.length)
      throw new Error(`Schema ${this.wrdschema.id} is not configured properly. Missing issuer or signingKeys`);

    // @ts-ignore Need to fix the any issue above first
    const bestsigningkey = config.signingKeys.sort((a, b) => b.availableSince.getTime() - a.availableSince.getTime())[0];
    if (!this.config.tokenType)
      throw new Error(`No tokentype configured for this authentication provider`);

    const accounttype = await this.getAccountType();

    // @ts-ignore FIXME Not sure how to properly satisfy this check - there's no way to statically verify tokentypeinfo.left is valid
    const subjectguid = (await this.wrdschema.getFields(accounttype, subject, ["wrdGuid"]))?.wrdGuid;
    if (!subjectguid)
      throw new Error(`Unable to find the wrdGuid for subject #${subject}`);

    const audiences = options?.audiences || (this.config.audience ? [this.config.audience] : []);
    const expires: WaitPeriod = options?.expires || this.config.expires || "P1D";
    const validuntil = convertWaitPeriodToDate(expires); //TODO round to second precision for consistency between WRD and Token values

    const token = await createJWT(bestsigningkey.privateKey, bestsigningkey.keyId, config.issuer, subjectguid, validuntil, { scopes: options?.scopes, audiences });
    // @ts-ignore FIXME Not sure how to properly satisfy this check - there's no way to statically verify accounttype is valid
    const sessionWrdId = await this.wrdschema.insert(this.config.tokenType, { wrdLeftEntity: subject, token: token, wrdLimitDate: validuntil, ...options?.settings });
    return { token, sessionWrdId };
  }

  /** Verify a session */
  async verifySession(token: string): Promise<VerifySessionResult> {
    const decoced = jwt.decode(token, { complete: true });
    const keys = await this.getKeyConfig();
    const matchkey = keys.signingKeys.find(k => k.keyId === decoced?.header.kid);
    if (!matchkey)
      throw new Error(`Unable to find key '${decoced?.header.kid}'`);

    const verifyoptions: JWTVerificationOptions = {};
    if (this.config.audience)
      verifyoptions.audience = this.config.audience;

    const payload = await verifyJWT(matchkey.privateKey, keys.issuer, token, verifyoptions);
    const accounttype = await this.getAccountType();
    // @ts-ignore FIXME Not sure how to properly satisfy this check - there's no way to statically verify accounttype is valid
    const matchuser = await this.wrdschema.search(accounttype, "wrdGuid", payload.sub);
    if (!matchuser)
      throw new Error(`Unable to find subject '${payload.sub}'`);

    return {
      subjectWrdId: matchuser,
      payload,
      scopes: payload.scope?.split(" ") ?? []
    };
  }
}
