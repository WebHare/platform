import * as crypto from "node:crypto";
import jwt, { JwtPayload, VerifyOptions } from "jsonwebtoken";
import { SchemaTypeDefinition, WRDSchema } from "@mod-wrd/js/internal/schema";
import type { WRD_IdpSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { convertWaitPeriodToDate, generateRandomId, WaitPeriod } from "@webhare/std";
import { generateKeyPair, KeyObject, JsonWebKey, createPrivateKey, createPublicKey } from "node:crypto";
import { getSchemaSettings, updateSchemaSettings } from "./settings";
import { beginWork, commitWork } from "@webhare/whdb/src/whdb";

export async function createSigningKey(): Promise<JsonWebKey> {
  const pvtkey = await new Promise((resolve, reject) =>
    //generateKeyPair('ec', { namedCurve: "P-256" }, (err, publicKey, privateKey) => { // TODO optionally create EC keys, but RS256 are likely more compatible
    generateKeyPair('rsa', {
      modulusLength: 4096
    }, (err, publicKey, privateKey) => {
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
  jwtId?: string;
}

export interface JWTVerificationOptions {
  audience?: string | RegExp | Array<string | RegExp>;
}

export interface ServiceProviderInit {
  title: string;
  callbackUrls?: string[];
  subjectField?: string;
}

export interface SessionCreationOptions {
  expires?: WaitPeriod;
  settings?: Record<string, unknown>;
  scopes?: string[];
}

export interface VerifySessionResult {
  ///wrdId of the found subject
  wrdId: number;
  ///the decooded and validated payload
  payload: JwtPayload;
  ///decoded scopes
  scopes: string[];
}

/** Configuring the WRDAuth provider */
export interface IdentityProviderConfiguration {
  /** The type storing tokens. Must implement the AccessToken interface */
  //  tokenType?: string;
  /** JWT expiry. */
  expires?: WaitPeriod;
  /** Our audience */
  //audience?: string;
}

//TODO these might make nice @webhare/std candidate but require a frontend-compatible implementation (or a backend + frontend version)

export function compressUUID(uuid: string) {
  const buffer = Buffer.from(uuid.replace(/-/g, ""), "hex");
  return buffer.toString("base64url");
}

export function decompressUUID(compressed: string) {
  const buffer = Buffer.from(compressed, "base64url");
  return buffer.toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
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
    nbf: Math.floor(now / 1000)
    // nonce: generateRandomId("base64url", 16), //FIXME we should be generating nonce-s if requested by the openid client, but not otherwise
  };

  if (expires !== Infinity)
    payload.exp = Math.floor(convertWaitPeriodToDate(expires).getTime() / 1000);
  if (subject)
    payload.sub = subject;
  if (options?.scopes?.length)
    payload.scope = options.scopes.join(" ");
  if (options?.audiences?.length)
    payload.aud = options.audiences.length == 1 ? options.audiences[0] : options.audiences;
  if (options?.jwtId)
    payload.jti = options.jwtId;

  const signingkey = createPrivateKey({ key: key, format: 'jwk' }); //TODO use async variant
  return jwt.sign(payload, signingkey, { keyid, algorithm: signingkey.asymmetricKeyType === "rsa" ? "RS256" : "ES256" });
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

export function hashClientSecret(secret: string) {
  const hasher = crypto.createHash("SHA-256");
  hasher.update(secret);
  return hasher.digest().toString("base64url");
}


/** Manage JWT tokens associated with a schema
 * @param wrdschema - The schema to create the token for
*/
export class IdentityProvider<SchemaType extends SchemaTypeDefinition> {
  readonly wrdschema: WRDSchema<WRD_IdpSchemaType>;
  readonly config: IdentityProviderConfiguration;

  constructor(wrdschema: WRDSchema<SchemaType>, config?: IdentityProviderConfiguration) {
    //TODO can we cast to a 'real' base type instead of abusing System_UsermgmtSchemaType for the wrdSettings type?
    this.wrdschema = wrdschema as unknown as WRDSchema<WRD_IdpSchemaType>;
    this.config = config || {};
  }

  async initializeIssuer(issuer: string): Promise<void> {
    await updateSchemaSettings(this.wrdschema, { issuer });

    const cursettings = await getSchemaSettings(this.wrdschema, ["signingKeys"]);
    if (!cursettings.signingKeys.length) { //create the first key
      //TODO keyIds aren't sensitive, we can use much smaller keyIds if we check for dupes ourselves to avoid collisions
      const primarykeyid = generateRandomId();
      await updateSchemaSettings(this.wrdschema, {
        signingKeys: [{ availableSince: new Date, keyId: primarykeyid, privateKey: await createSigningKey() }]
      });
    }
  }

  async createServiceProvider(spSettings: ServiceProviderInit) {
    const clientId = generateRandomId("uuidv4");
    const clientSecret = generateRandomId("base64url", 24);
    const wrdId = await this.wrdschema.insert("wrdauthServiceProvider", {
      wrdTitle: spSettings.title || "Client " + clientId,
      wrdGuid: clientId,
      clientSecrets:
        [
          {
            created: new Date,
            secretHash: hashClientSecret(clientSecret)
          }
        ],
      callbackUrls: spSettings.callbackUrls?.map(url => ({ url })) ?? [],
      subjectField: spSettings.subjectField || ""
    });

    return { wrdId, clientId: compressUUID(clientId), clientSecret };
  }

  private async getKeyConfig() {
    return getSchemaSettings(this.wrdschema, ["issuer", "signingKeys"]);
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

  private async createAccessTokenJWT(subject: number, client: number, validuntil: Date, scopes: string[], sessionGuid: string) {
    const clientInfo = await this.wrdschema.getFields("wrdauthServiceProvider", client, ["wrdGuid", "subjectField"]);
    if (!clientInfo)
      throw new Error(`Unable to find serviceProvider #${client}`);

    const subfield = clientInfo.subjectField || "wrdGuid";
    //@ts-ignore -- too complex and don't have an easy 'as key of wrdPerson' tpye
    const subjectguid = (await this.wrdschema.getFields("wrdPerson", subject, [subfield]))?.[subfield];
    if (!subjectguid)
      throw new Error(`Unable to find the wrdGuid for subject #${subject}`);

    const config = await this.getKeyConfig();
    if (!config || !config.issuer || !config.signingKeys?.length)
      throw new Error(`Schema ${this.wrdschema.id} is not configured properly. Missing issuer or signingKeys`);

    const bestsigningkey = config.signingKeys.sort((a, b) => b.availableSince.getTime() - a.availableSince.getTime())[0];
    const token = await createJWT(bestsigningkey.privateKey, bestsigningkey.keyId, config.issuer, subjectguid, validuntil, { scopes, audiences: [compressUUID(clientInfo.wrdGuid)], jwtId: compressUUID(sessionGuid) });
    return { access_token: token, expires_in: Math.floor((validuntil.getTime() - Date.now()) / 1000) };
  }

  /** Create a session
   * @param serviceProvider - Client registering this session
   * @param subject - The subject (wrdPerson) for which we're creating a session
  */
  async createSession(subject: number, serviceProvider: number, options?: SessionCreationOptions): Promise<number> {
    const expires: WaitPeriod = options?.expires || this.config.expires || "P1D";
    const validuntil = convertWaitPeriodToDate(expires); //TODO round to second precision for consistency between WRD and Token values

    const wrdId = await this.wrdschema.insert("wrdauthAccessToken", {
      wrdLeftEntity: subject,
      wrdRightEntity: serviceProvider,
      wrdLimitDate: validuntil,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO we need wrd to provide a type for scopes
      scopes: options?.scopes ?? [] as any,
      ...options?.settings
    });
    return wrdId;
  }

  async createSessionToken(session: number) {
    const sessioninfo = await this.wrdschema.getFields("wrdauthAccessToken", session, ["wrdLeftEntity", "wrdRightEntity", "wrdLimitDate", "scopes", "wrdGuid"]);
    if (!sessioninfo)
      throw new Error(`Unable to find session #${session}`);
    if (!sessioninfo.wrdLimitDate)
      throw new Error(`Session #${session} has no expiration date`);

    return this.createAccessTokenJWT(sessioninfo.wrdLeftEntity, sessioninfo.wrdRightEntity, sessioninfo.wrdLimitDate, sessioninfo.scopes, sessioninfo.wrdGuid);
  }

  /** Exchange code for session token */
  async exchangeCode(serviceProvider: number, code: string) {
    const match = await this.wrdschema.selectFrom("wrdauthAccessToken").
      where("code", "=", code).
      where("wrdRightEntity", "=", serviceProvider).
      select(["wrdLeftEntity", "wrdRightEntity", "wrdLimitDate", "scopes", "wrdId", "wrdGuid"]).
      execute();

    if (!match.length)
      return null;
    if (!match[0].wrdLimitDate)
      throw new Error(`Session has no expiration date`);

    const token = await this.createAccessTokenJWT(match[0].wrdLeftEntity, match[0].wrdRightEntity, match[0].wrdLimitDate, match[0].scopes, match[0].wrdGuid);
    await beginWork();
    await this.wrdschema.update("wrdauthAccessToken", match[0].wrdId, { code: '' });
    await commitWork();
    return token;
  }

  /** Verify a session */
  async verifySession(token: string, verifyOptions?: JWTVerificationOptions): Promise<VerifySessionResult> {
    const decoced = jwt.decode(token, { complete: true });
    const keys = await this.getKeyConfig();
    const matchkey = keys.signingKeys.find(k => k.keyId === decoced?.header.kid);
    if (!matchkey)
      throw new Error(`Unable to find key '${decoced?.header.kid}'`);

    const payload = await verifyJWT(matchkey.privateKey, keys.issuer, token, verifyOptions);
    if (!payload.jti || !payload.sub)
      throw new Error(`Invalid token - missing jti or sub`);

    //We don't want to deal with sub ambiguity as we're the only one creating the tokens - just loop up by jwtId. also verifies this token is still active
    const matchToken = await this.wrdschema.selectFrom("wrdauthAccessToken").where("wrdGuid", '=', decompressUUID(payload.jti)).select(["wrdLeftEntity"]).execute();
    if (!matchToken.length)
      throw new Error(`Token '${payload.jti}' is not active`);

    return {
      wrdId: matchToken[0].wrdLeftEntity,
      payload,
      scopes: payload.scope?.split(" ") ?? []
    };
  }
}
