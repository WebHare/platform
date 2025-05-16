import * as crypto from "node:crypto";
import jwt, { type JwtPayload, type SignOptions, type VerifyOptions } from "jsonwebtoken";
import { type SchemaTypeDefinition, WRDSchema } from "@mod-wrd/js/internal/schema";
import type { WRD_IdpSchemaType, WRD_Idp_WRDPerson } from "@mod-platform/generated/wrd/webhare";
import { convertWaitPeriodToDate, generateRandomId, isPromise, parseTyped, pick, stringify, throwError, type WaitPeriod } from "@webhare/std";
import { generateKeyPair, type KeyObject, type JsonWebKey, createPrivateKey, createPublicKey } from "node:crypto";
import { getSchemaSettings, updateSchemaSettings } from "@webhare/wrd/src/settings";
import { beginWork, commitWork, runInWork, db, runInSeparateWork, type Updateable } from "@webhare/whdb";
import type { NavigateInstruction } from "@webhare/env";
import { closeServerSession, createServerSession, encryptForThisServer, getServerSession, importJSObject, updateServerSession, type ServerEncryptionScopes } from "@webhare/services";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import type { AnySchemaTypeDefinition, AttrRef } from "@mod-wrd/js/internal/types";
import { HareScriptType, decodeHSON, defaultDateTime, encodeHSON, setHareScriptType } from "@webhare/hscompat";
import type { AuthCustomizer, JWTPayload, LoginErrorCodes, LoginUsernameLookupOptions, ReportedUserInfo } from "./customizer";
import type { WRDAuthAccountStatus } from "@webhare/auth";
import type { ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { getAuditContext, writeAuthAuditEvent, type AuthAuditContext } from "./audit";
import { calculateWRDSessionExpiry, defaultWRDAuthLoginSettings, getAuthSettings, prepAuth, type PrepAuthResult } from "./support";

const logincontrolValidMsecs = 60 * 60 * 1000; // login control token is valid for 1 hour
const openIdTokenExpiry = 60 * 60 * 1000; // openid id_token is valid for 1 hour

type NavigateOrError = (NavigateInstruction & { error: null }) | { error: string };

/** Token creation options */
export interface AuthTokenOptions {
  /** Customizer object */
  customizer?: AuthCustomizer | null;
  /** Set or override the time of day used for expiration calculations  */
  now?: Temporal.Instant;
  /** Expiration date for the token. If not set, will fallback to any configuration and eventually 1 day */
  expires?: WaitPeriod;
  /** Prefix for API tokens, defaults to 'secret-token:' (see RFC 8959) */
  prefix?: string;
  /** Scopes associated with the API token */
  scopes?: string[];
  /** Title, for the key owner to recognize the specific key */
  title?: string;
  /** Metadata to add */
  metadata?: object | null;
  /** Additional claims to add to the token */
  claims?: Record<string, unknown>;
  /** Information about the source and actors in this event */
  authAuditContext?: AuthAuditContext;
  /** Requesting a persistent auth token (ie no session cookies) */
  persistent?: boolean;
  /** Requesting a cookie for a third party login */
  thirdParty?: boolean;
}

export type ListedToken = {
  /** Database id (table wrd.tokens primary key) */
  id: number;
  /** Title, for the key owner to recognize the specific key */
  title: string;
  /** Token type  */
  type: "id" | "api";
  /** Metadata - as decided by the creation application */
  metadata: unknown;
  /** Token creation date */
  created: Temporal.Instant;
  /** Token expiration date, null if infinite */
  expires: Temporal.Instant | null;
  /** Scopes available to this token */
  scopes: string[];
};

export type SetAuthCookies = {
  /** The cookie to place the ID cookie in */
  idCookie: string;
  ignoreCookies: string[];
  /** Configured original cookiename (not __Host or __Secure prefixed) */
  cookieName: string;
  /** Cookie value, HS webserver compatible */
  value: string;
  expires: Temporal.Instant;
  userInfo?: object;
  cookieSettings: ServersideCookieOptions;
  /** Session should persist after browser close*/
  persistent?: boolean;
};

interface HSONAuthenticationSettings {
  version: number;
  passwords?: Array<{ passwordhash: string; validfrom: Date }>;
  totp?: {
    url: string;
    backupcodes?: Array<{
      code: string;
      used?: Date;
    }>;
    locked?: Date;
  };
}

export type FirstPartyToken = {
  /** Token id in database (wrd.tokens) */
  id: number;
  /** The access token itself */
  accessToken: string;
  /** Access token expiration (null if set to never expire) */
  expires: Temporal.Instant | null;
};

export class AuthenticationSettings {
  #passwords: Array<{ hash: string; validFrom: Date }> = [];
  #totp: {
    url: string;
    backupCodes: Array<{ code: string; used: Date | null }>;
    locked: Date | null;
  } | null = null;

  static fromPasswordHash(hash: string): AuthenticationSettings {
    const auth = new AuthenticationSettings;
    if (hash)
      auth.#passwords.push({ hash, validFrom: new Date });
    return auth;
  }

  static fromHSON(hson: string): AuthenticationSettings {
    const obj = decodeHSON(hson) as unknown as HSONAuthenticationSettings;
    if (typeof obj !== "object")
      throw new Error(`Expected a HSON encoded record, got '${typeof obj}'`);
    if (!obj || !("version" in obj))
      throw new Error("Missing version field");
    if (obj.version !== 1)
      throw new Error(`Unsupported authentication settings version ${obj.version}`);

    const auth = new AuthenticationSettings;
    if (Array.isArray(obj.passwords))
      for (const pwd of (obj.passwords ?? [])) {
        if (!pwd || !pwd.passwordhash || !pwd.validfrom)
          throw new Error("Invalid password record");
        auth.#passwords.push({ hash: pwd.passwordhash, validFrom: pwd.validfrom });
      }

    //FIXME we're not properly setting the various dates to 'null' currently, but to minimum datetime. we'll hit that as soon as we need to manipulate TOTP, but for now the round-trip works okay
    if (obj.totp) {
      auth.#totp = {
        url: obj.totp.url,
        backupCodes: (obj.totp.backupcodes ?? []).map(_ => ({ code: _.code, used: _.used ?? null })),
        locked: obj.totp.locked ?? null
      };
    }
    return auth;
  }

  toHSON() {
    const passwords = this.#passwords.map(_ => ({ passwordhash: _.hash, validfrom: _.validFrom }));
    setHareScriptType(passwords, HareScriptType.RecordArray);

    return encodeHSON({
      version: 1,
      passwords,
      totp: this.#totp ? {
        url: this.#totp.url,
        backupcodes: setHareScriptType(this.#totp.backupCodes.map(_ => ({ code: _.code, used: _.used ?? null })), HareScriptType.RecordArray),
        locked: this.#totp.locked ?? null
      } : null
    });
  }

  hasTOTP(): boolean {
    return Boolean(this.#totp);
  }

  getLastPasswordChange(): Date | null {
    return this.#passwords.at(-1)?.validFrom ?? null;
  }

  getNumPasswords(): number {
    return this.#passwords.length;
  }

  //TODO when to clear password? probably needs to be a WRD schema setting enforced on updateEntity
  /** Update the password in this setting
   * @param password - The new password
   * @param alg - The hash algorithm to use. If not set, use best known method (may change in future versions)
  */
  async updatePassword(password: string, alg: "PLAIN" | "WHBF" = "WHBF"): Promise<void> {
    if (!password)
      throw new Error("Password cannot be empty");

    let hash = '';
    if (alg === "PLAIN")
      hash = 'PLAIN:' + password;
    else if (alg === "WHBF")
      hash = await loadlib("wh::crypto.whlib").CREATEWEBHAREPASSWORDHASH(password);
    else
      throw new Error(`Unsupported password hash algorithm '${alg}'`);

    this.#passwords.push({ hash, validFrom: new Date });
  }

  async verifyPassword(password: string): Promise<boolean> {
    if (!password || !this.#passwords.length)
      return false;

    const tryHash = this.#passwords[this.#passwords.length - 1].hash;
    if (tryHash.startsWith("PLAIN:"))
      return password === tryHash.substring(6);

    return await loadlib("wh::crypto.whlib").VERIFYWEBHAREPASSWORDHASH(password, tryHash);
  }

  async isUsedSince(password: string, cutoff: Temporal.Instant): Promise<boolean> {
    for (let i = this.#passwords.length - 1; i >= 0; i--) {
      const tryHash = this.#passwords[i].hash;
      if (tryHash.startsWith("PLAIN:")) {
        if (password === tryHash.substring(6))
          return true;
      } else if (await loadlib("wh::crypto.whlib").VERIFYWEBHAREPASSWORDHASH(password, tryHash))
        return true;
      if (this.#passwords[i].validFrom.getTime() <= cutoff.epochMilliseconds)
        break;
    }
    return false;
  }
}

export interface LoginRemoteOptions extends LoginUsernameLookupOptions {
  /** Request a persistent login */
  persistent?: boolean;
}

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  id_token?: string;
  expires_in?: number;
};

export type FrontendAuthResult = {
  loggedIn: true;
  setAuth: SetAuthCookies;
} | {
  loggedIn: false;
  error: string;
  code: LoginErrorCodes;
};

const validCodeChallengeMethods = ["plain", "S256"] as const;
export type CodeChallengeMethod = typeof validCodeChallengeMethods[number];

declare module "@webhare/services" {
  interface SessionScopes {
    "wrd:openid.idpstate": {
      clientid: number;
      scopes: string[];
      state: string | null;
      nonce: string | null;
      code_challenge: string | null;
      code_challenge_method: CodeChallengeMethod | null;
      cbUrl: string;
      /** User id to set */
      user?: number;
    };
  }
  interface ServerEncryptionScopes {
    "wrd:authplugin.logincontroltoken": {
      afterlogin: string;
      /** Expected logintypes, eg 'wrdauth' or 'external' */
      logintypes: string[];
      ruleid: number;
      returnto: string;
      validuntil: Date;
    };
    "platform:settoken": SetAuthCookies & {
      target: string;
    };
  }
}

export interface WRDAuthSettings {
  accountType: string;
  emailAttribute: string | null;
  loginAttribute: string | null;
  loginIsEmail: boolean;
  passwordAttribute: string | null;
  passwordIsAuthSettings: boolean;
  hasAccountStatus: boolean;
}

// Autorization with PKCE code verifier: https://www.rfc-editor.org/rfc/rfc7636

// Note that the list of allowed characters for a code verifier is [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~", using
// generateRandomId eliminates "." and "~" from this list, resulting in a slightly less random code verifier
export function createCodeVerifier(len = 56) {
  if (len < 43 || len > 128)
    throw new Error("A code verifier must be between 43 and 128 characters long");
  let result = "";
  while (result.length < len)
    result += generateRandomId();
  return result.substring(0, len);
}

export function createCodeChallenge(verifier: string, method: CodeChallengeMethod) {
  switch (method) {
    case "plain":
      return verifier;
    case "S256": {
      const hash = crypto.createHash("sha256");
      hash.update(verifier);
      return hash.digest("base64url");
    }
    default:
      throw new Error(`Invalid code challenge method '${method}', allowed are 'plain' or 'S256`);
  }
}

function verifyCodeChallenge(verifier: string, challenge: string, method: CodeChallengeMethod) {
  return createCodeChallenge(verifier, method) === challenge;
}

export async function createSigningKey(type: "ec" | "rsa"): Promise<JsonWebKey> {
  const pvtkey = await new Promise<KeyObject>((resolve, reject) => {
    if (type === "ec")
      generateKeyPair("ec", { namedCurve: "P-256" }, (err, publicKey, privateKey) => {
        if (err)
          return reject(err);

        resolve(privateKey);
      });
    else
      //We're required to have support RSA (id_token_signing_alg_values_supported RS256) for openid connect
      generateKeyPair('rsa', { modulusLength: 4096 }, (err, publicKey, privateKey) => {
        if (err)
          return reject(err);

        resolve(privateKey);
      });
  });
  return pvtkey.export({ format: 'jwk' });
}

export interface JWKS {
  keys: JsonWebKey[];
}

export interface JWTCreationOptions {
  scopes?: string[];
  audiences?: string[];
  nonce?: string | null;
}

export interface JWTVerificationOptions {
  audience?: string | RegExp | Array<string | RegExp>;
}

export interface VerifyAccessTokenResult {
  ///wrdId of the found subject
  entity: number;
  ///authAccountStatus of the found subject, if available
  accountStatus: WRDAuthAccountStatus | null;
  ///decoded scopes
  scopes: string[];
  ///client to which the token was provided
  client: number | null;
  ///expiration date
  expires: Temporal.Instant | null;
  //id of the used token (refers to wrd.tokens table)
  tokenId: number;
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

function preparePayload(subject: string, created: Temporal.Instant | null, validuntil: Temporal.Instant | null, options?: JWTCreationOptions): JwtPayload {
  /* All official claims are on https://www.iana.org/assignments/jwt/jwt.xhtml#claims */


  /* Adding a jwtId ensures that each token is unique and that we have no way ourselves to regenerate a token once we've given it out and hashed it
     It is also a proof that we actually generated the token even without a signature - we wouldn't have stored a hashed token without a random jwtId (all the other fields in the JWT are guessable) */
  const payload: JwtPayload = { jti: generateRandomId() };
  if (created) {
    payload.iat = created.epochSeconds;
    payload.nbf = payload.iat;
  }

  // nonce: generateRandomId("base64url", 16), //FIXME we should be generating nonce-s if requested by the openid client, but not otherwise
  if (validuntil)
    payload.exp = validuntil.epochSeconds;
  if (subject)
    payload.sub = subject;
  if (options?.scopes?.length)
    payload.scope = options.scopes.join(" ");
  if (options?.audiences?.length)
    payload.aud = options.audiences.length === 1 ? options.audiences[0] : options.audiences;
  if (typeof options?.nonce === "string")
    payload.nonce = options.nonce;

  return payload;
}

/** Create a WRDAuth JWT token. Note this is more of a debugging/testing endpoint now as we're not actually using it in createTokens anymore
 * @param key - JWK key to sign the token with
 * @param keyid - The id for this key
 * @param issuer - Token issuer
 * @param subject - The subject of the token
 * @param expires - The expiration date of the token, or Infinity
 * @param options - scopes: List of scopes this token is valid for (Note: scopes cannot contain spaces)
 *                  audiences: The intended audiences for this token
 * @returns The JWT token
*/
export async function createJWT(key: JsonWebKey, keyid: string, issuer: string, subject: string, created: Temporal.Instant | null, validuntil: Temporal.Instant | null, options?: JWTCreationOptions): Promise<string> {
  const payload = preparePayload(subject, created, validuntil, options);
  payload.iss = issuer;
  const signingkey = createPrivateKey({ key: key, format: 'jwk' }); //TODO use async variant
  return jwt.sign(payload, signingkey, { keyid, algorithm: signingkey.asymmetricKeyType === "rsa" ? "RS256" : "ES256" });
}

/** Decode a JWT. Does not validate or verify the JWT!  */
export function decodeJWT(token: string): JwtPayload {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload !== "object")
    throw new Error("Invalid JWT token");
  return decoded.payload;
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

function hashSHA256(secret: string): Buffer {
  const hasher = crypto.createHash("SHA-256");
  hasher.update(secret);
  return hasher.digest();
}

export function hashClientSecret(secret: string): string {
  return hashSHA256(secret).toString("base64url");
}

function haveValidKeys(keys: SigningKey[]) {
  const valid_ec = keys.some(key => key.privateKey.kty === "EC");
  const valid_rsa = keys.some(key => key.privateKey.kty === "RSA");
  const valid = valid_ec && valid_rsa;
  return { valid, valid_ec, valid_rsa };
}

type SigningKey = {
  availableSince: Date;
  keyId: string;
  privateKey: JsonWebKey;
};


/** Manage JWT tokens associated with a schema
 * @param wrdschema - The schema to create the token for
*/
export class IdentityProvider<SchemaType extends SchemaTypeDefinition> {
  readonly wrdschema: WRDSchema<WRD_IdpSchemaType>;

  constructor(wrdschema: WRDSchema<SchemaType>) {
    //TODO can we cast to a 'real' base type instead of abusing System_UsermgmtSchemaType for the wrdSettings type?
    this.wrdschema = wrdschema as unknown as WRDSchema<WRD_IdpSchemaType>;
  }

  async ensureSigningKeys(): Promise<SigningKey[]> {
    //FIXME this is still deadlock-prone if someone already updated the schemasettings before invoking us. consider moving this to wh apply wrd (as soon as it's in TS)
    //FIXME readd the option to set up RSA keys if explicitly asked for by a client
    return await runInSeparateWork(async () => {
      const { signingKeys } = await getSchemaSettings(this.wrdschema, ["signingKeys"]);
      const validity = haveValidKeys(signingKeys);
      if (!validity.valid) {
        if (!validity.valid_ec) {
          //TODO keyIds aren't sensitive, we can use much smaller keyIds if we check for dupes ourselves to avoid collisions
          const primarykeyid = generateRandomId();
          signingKeys.push({ availableSince: new Date, keyId: primarykeyid, privateKey: await createSigningKey("ec") });
        }
        if (!validity.valid_rsa) {
          //TODO keyIds aren't sensitive, we can use much smaller keyIds if we check for dupes ourselves to avoid collisions
          const primarykeyid = generateRandomId();
          signingKeys.push({ availableSince: new Date, keyId: primarykeyid, privateKey: await createSigningKey("rsa") });
        }
        await updateSchemaSettings(this.wrdschema, { signingKeys });
      }

      return signingKeys;
    }, { mutex: "wrd:authplugin.signingkeys" });
  }

  private async getKeyConfig() {
    const settings = await getSchemaSettings(this.wrdschema, ["issuer", "signingKeys"]);
    if (!haveValidKeys(settings.signingKeys).valid)
      settings.signingKeys = await this.ensureSigningKeys();
    return settings;
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

  private signJWT(payload: JwtPayload, keys: SigningKey[], restrictType: "EC" | "RSA" | null) {
    if (restrictType)
      keys = keys.filter(key => key.privateKey.kty === restrictType);

    /** Prefer ec over non-ec, then look for most recente key */
    keys = keys.sort((a, b) =>
      (Number(b.privateKey.kty === "EC") - Number(a.privateKey.kty === "EC"))
      || b.availableSince.getTime() - a.availableSince.getTime()
    );

    if (!keys.length)
      throw new Error("No signing keys available");

    const signWithKey = createPrivateKey({ key: keys[0].privateKey, format: 'jwk' }); //TODO use async variant
    const signOptions: SignOptions = { keyid: keys[0].keyId, algorithm: signWithKey.asymmetricKeyType === "rsa" ? "RS256" : "ES256" };
    return jwt.sign(payload, signWithKey, signOptions);
  }

  //TODO with proper caching we can avoid async/DB queries here. and we really should
  async getExpiration(relativeTo: Temporal.Instant, options?: AuthTokenOptions): Promise<null | Temporal.Instant> {
    if (options?.expires === Infinity)
      return null;
    if (options?.expires)
      return convertWaitPeriodToDate(options.expires, { relativeTo });

    const loginSettings = (await getSchemaSettings(this.wrdschema, ["loginSettings"]))?.loginSettings ?? defaultWRDAuthLoginSettings;
    const expiry = options?.thirdParty ? loginSettings?.expire_thirdpartylogin : options?.persistent ? loginSettings?.expire_persistentlogin : loginSettings?.expire_login;
    return calculateWRDSessionExpiry(loginSettings, relativeTo, expiry);
  }

  /** Create ID and Auth tokens and commit to the database as needed
   * @param type - The type of token to create ('id', 'api' or 'oidc')
   * @param subject - The subject for whom the token is created
   * @param client - The client ID
   * @param closeSessionId - The session ID to close after creating the token
   * @param nonce - A nonce value for the token
   * @param options - Additional options for token creation
   */
  async createTokens(type: "id" | "api" | "oidc", subject: number, client: number | null, closeSessionId: string | null, nonce: string | null, options?: AuthTokenOptions) {
    /* TODO:
      - do we need an intermediate 'createJWT' that uses the schema's configuration but doesn't create the tokens in the database?
      - do we need to support an 'ephemeral' mode where we don't actually commit the tokens to the database? (more like current wrdauth which only has
        password reset as a way to clear tokens)
    */
    let clientInfo;
    if (client !== null) {
      clientInfo = await this.wrdschema.getFields("wrdauthServiceProvider", client, ["wrdGuid", "subjectField"]);
      if (!clientInfo)
        throw new Error(`Unable to find serviceProvider #${client}`);
    }

    if (options?.expires === Infinity && type !== "api")
      throw new Error("Infinite expiration is only allowed for API tokens");

    const isOIDC = options?.scopes?.includes("openid");
    if (isOIDC && type !== "oidc")
      throw new Error("OpenID scopes can only be set for 'oidc' tokens");

    const subfield = clientInfo?.subjectField || "wrdGuid";
    //@ts-ignore -- too complex and don't have an easy 'as key of wrdPerson' type
    const subjectValue = (await this.wrdschema.getFields("wrdPerson", subject, [subfield]))?.[subfield] as string;
    if (!subjectValue)
      throw new Error(`Unable to find '${subjectValue}' for subject #${subject}`);

    const relativeTo = (options?.now ?? Temporal.Now.instant()).round({ smallestUnit: "seconds", roundingMode: "floor" }); //round down as the JWT fields have second precision
    const validUntil = await this.getExpiration(relativeTo, options);

    //Figure out signature parameters
    const config = await this.getKeyConfig();
    if (!config || !config.signingKeys?.length)
      throw new Error(`Schema ${this.wrdschema.tag} is not configured properly. Missing issuer or signingKeys`);

    //ID tokens are only generated for 3rd party clients requesting an openid scope. They shouldn't be providing access to APIs and cannot be retracted by us
    let id_token: string | undefined;
    const requestedScopes = options?.scopes || [];
    if (isOIDC) {
      if (!(client && clientInfo))
        throw new Error("Unable to create ID token without a thirdparty client");

      const payload = preparePayload(subjectValue, relativeTo, validUntil, { audiences: [compressUUID(clientInfo?.wrdGuid)], nonce });

      //We allow customizers to hook into the payload, but we won't let them overwrite the issuer as that can only break signing
      if (options?.customizer?.onOpenIdToken) //force-cast it to make clear which fields are already set and which you shouldn't modify
        await options?.customizer.onOpenIdToken({
          wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
          user: subject,
          scopes: requestedScopes,
          client
        }, payload as JWTPayload);

      if (!config.issuer)
        throw new Error(`Schema ${this.wrdschema.tag} is not configured properly. Missing issuer or signingKeys`);

      payload.iss = config.issuer;

      //FIXME use ES256 if client selected it
      id_token = this.signJWT(payload, config.signingKeys, "RSA");
    }

    const scopes = type === "oidc"
      ? requestedScopes.filter(scope => ["openid", "profile", "email"].includes(scope)) //filter out non-openid scopes to protect against misinterpretation, as these tokens were specified by the client!
      : requestedScopes;

    /* We always generate access tokens for OpenID requests (skippable when client only requests an id_token)
       For our convenience we use JWT for access tokens but we don't strictly have to. We do not set an audience as we're always the audience, and we do not really care
       about the signature yet - our wrd.tokens table is leading (and we want to be able to show active sessions anyway) */
    const atPayload = preparePayload(subjectValue, relativeTo, validUntil, { scopes });
    const prefix = options?.prefix ?? (type !== "id" ? "secret-token:" : ""); //if undefined/null, we fall back to the default
    if (options?.claims)
      Object.assign(atPayload, options.claims);
    const access_token = prefix + this.signJWT(atPayload, config.signingKeys, "EC");
    const metadata = options?.metadata ? stringify(options.metadata, { typed: true }) : "";
    if (Buffer.from(metadata).length > 4096)
      throw new Error(`Metadata too large, max size is 4096 bytes`);

    await beginWork();
    const hash = hashSHA256(access_token);
    const insertres = await db<PlatformDB>().insertInto("wrd.tokens").values({
      type: type,
      creationdate: new Date(atPayload.nbf! * 1000),
      expirationdate: atPayload.exp ? new Date(atPayload.exp * 1000) : defaultDateTime,
      entity: subject,
      client: client,
      scopes: scopes?.join(" "),
      hash,
      metadata: metadata,
      title: options?.title ?? ""
    }).returning("id").execute();

    if (closeSessionId)
      await closeServerSession(closeSessionId);

    if (type !== "oidc") {
      await writeAuthAuditEvent(this.wrdschema, {
        type: type === "id" ? "platform:login" : "platform:apikey",
        entity: subject,
        ...(options?.authAuditContext ?? getAuditContext()),
        data: { tokenHash: hash.toString("base64url") }
      });
    }

    await commitWork();

    return { access_token, expires: atPayload.exp || null, ...(id_token ? { id_token } : null), tokenId: insertres[0].id };
  }

  /** An access token may be prefixed with `secret-token:`, strip it (we'll tolerate any `<...>:` prefix here */
  private extractToken(token: string) {
    const parts = token.match(/^(?<prefix>[^:]+):(?<token>.+)$/);
    return parts?.groups?.token || throwError(`Unrecognized token format`);
  }

  /** Get userinfo for a token */
  async getUserInfo(token: string, customizer?: AuthCustomizer): Promise<ReportedUserInfo | { error: string }> {
    /* We do not verify the token's signature currently - we just look it up in our database. TODO we might not have to store access tokens if we verify its
       signature and just reuse it and save a bit of database churn unless other reasons appear to store these tokens */
    const tokeninfo = await this.verifyAccessToken("oidc", token);
    if ("error" in tokeninfo)
      return { error: tokeninfo.error };
    if (!tokeninfo.client)
      return { error: "WRDAuth login tokens are not valid for OpenID /userinfo endpoints" };

    const userfields = await this.wrdschema.getFields("wrdPerson", tokeninfo.entity, ["wrdFullName", "wrdFirstName", "wrdLastName"/*,"wrdContactEmail"*/]);
    if (!userfields)
      return { error: "No such user" };

    const decoded = jwt.decode(this.extractToken(token), { complete: true });
    if (!decoded)
      return { error: "Invalid access token for userinfo" };

    const userinfo: Record<string, unknown> = { //TODO limit by the fields by requested scope and client access
      sub: decoded.payload.sub,
      name: userfields.wrdFullName,
      given_name: userfields.wrdFirstName,
      family_name: userfields.wrdLastName,
      // email: userinfo.wrdContactEmail
    };

    if (customizer?.onOpenIdUserInfo)
      await customizer?.onOpenIdUserInfo({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        client: tokeninfo.client,
        scopes: tokeninfo.scopes,
        user: tokeninfo.entity
      }, userinfo);

    return { ...userinfo } as ReportedUserInfo;
  }

  /** Validate a token (not considering retractions). Note that wrdauth doesn't need to validate tokens it gave out itself - its own token db is considered authorative */
  async validateToken(token: string, verifyOptions?: JWTVerificationOptions) {
    const decoded = jwt.decode(token, { complete: true });
    const keys = await this.getKeyConfig();
    const matchkey = keys.signingKeys.find(k => k.keyId === decoded?.header.kid);
    if (!matchkey)
      throw new Error(`Unable to find key '${decoded?.header.kid}'`);

    const payload = await verifyJWT(matchkey.privateKey, keys.issuer, token, verifyOptions);
    if (!payload.jti || !payload.sub)
      throw new Error(`Invalid token - missing jti or sub`);

    return payload;
  }

  /** Verify a token we gave out ourselves. Also checks against retracted tokens and still existing owner entity
   * @param type - Expected token type
   * @param token - The token to verify
   * @param options - Optional parameters for token verification
  */
  async verifyAccessToken(type: "id" | "api" | "oidc", token: string, options?: { ignoreAccountStatus?: boolean }): Promise<VerifyAccessTokenResult | { error: string }> {
    const hashed = hashSHA256(token);
    const matchToken = await db<PlatformDB>().
      selectFrom("wrd.tokens").
      where("hash", "=", hashed).
      where("type", "=", type).
      select(["entity", "client", "expirationdate", "scopes", "type", "id"]).
      executeTakeFirst();

    if (!matchToken)
      return { error: `Token is invalid` };

    if ((matchToken.expirationdate.getTime() > defaultDateTime.getTime() && matchToken.expirationdate < new Date))
      return { error: `Token expired at ${matchToken.expirationdate.toISOString()}` };

    const authsettings = await getAuthSettings(this.wrdschema);
    let accountStatus: WRDAuthAccountStatus | null = null;
    if (authsettings) {
      const getfields = {
        ...(authsettings.hasAccountStatus ? { wrdauthAccountStatus: "wrdauthAccountStatus" } : {})
      };
      // @ts-expect-error -- TS WRD can't handle this type of dynamic queries
      const entity = await this.wrdschema.getFields(authsettings.accountType, matchToken.entity, getfields, { historyMode: "active", allowMissing: true }) as {
        wrdauthAccountStatus?: WRDAuthAccountStatus | null;
      } | null;
      if (!entity)
        return { error: `Token owner does not exist anymore` };
      if (authsettings.hasAccountStatus) {
        accountStatus = entity.wrdauthAccountStatus || null;
        if (accountStatus?.status !== "active" && !options?.ignoreAccountStatus) {
          return { error: `Token owner has been disabled` };
        }
      }
    }

    return {
      entity: matchToken.entity,
      tokenId: matchToken.id,
      accountStatus,
      scopes: matchToken.scopes.length ? matchToken.scopes.split(' ') : [],
      client: matchToken.client,
      expires: matchToken.expirationdate?.toTemporalInstant() ?? null
    };
  }

  private getOpenIdBase() {
    const schemaparts = this.wrdschema.tag.split(":");
    return "/.wh/openid/" + encodeURIComponent(schemaparts[0]) + "/" + encodeURIComponent(schemaparts[1]) + "/";
  }

  /** Start an oauth2/openid authorization flow */
  async startAuthorizeFlow(url: string, loginPage: string, customizer?: AuthCustomizer): Promise<NavigateOrError> {
    const searchParams = new URL(url).searchParams;
    const clientid = searchParams.get("client_id") || '';
    const scopes = searchParams.get("scope")?.split(" ") || [];
    const redirect_uri = searchParams.get("redirect_uri") || '';
    const state = searchParams.get("state") || null;
    const nonce = searchParams.get("nonce") || null;
    const code_challenge = searchParams.get("code_challenge") || null;
    const code_challenge_method = searchParams.get("code_challenge_method") || null;

    //If a code challenge was supplied, check the challenge method
    if (code_challenge) {
      if (!code_challenge_method)
        return { error: "Missing code_challenge_method for code_challenge" };
      if (!validCodeChallengeMethods.includes(code_challenge_method as CodeChallengeMethod))
        return { error: `Invalid code challenge method '${code_challenge_method}', allowed are 'plain' or 'S256` };
    }

    const client = await this.wrdschema.query("wrdauthServiceProvider").where("wrdGuid", "=", decompressUUID(clientid)).select(["callbackUrls", "wrdId"]).execute();
    if (client.length !== 1)
      return { error: "No such client" };

    if (!client[0].callbackUrls.find((cb) => cb.url === redirect_uri))
      return { error: "Unauthorized callback URL " + redirect_uri };

    const returnInfo = await runInWork(() => createServerSession("wrd:openid.idpstate",
      { clientid: client[0].wrdId, scopes: scopes || [], state, nonce, code_challenge, code_challenge_method: code_challenge_method as CodeChallengeMethod, cbUrl: redirect_uri }));

    const currentRedirectURI = `${this.getOpenIdBase()}return?tok=${returnInfo}`;

    const loginControl = { //see __GenerateAccessRuleLoginControlToken
      afterlogin: "siteredirect",
      logintypes: ["wrdauth"],
      ruleid: 0,
      returnto: currentRedirectURI,
      validuntil: new Date(Date.now() + logincontrolValidMsecs)
    };

    const loginToken = encryptForThisServer("wrd:authplugin.logincontroltoken", loginControl); //TODO merge into the idpstate session? but HS won't understand it without further changes
    const target = new URL(loginPage);
    target.searchParams.set("wrdauth_logincontrol", loginToken);

    return { type: "redirect", url: target.toString(), error: null };
  }

  async returnAuthorizeFlow(url: string, user: number, customizer?: AuthCustomizer): Promise<NavigateOrError> {
    const searchParams = new URL(url).searchParams;
    const sessionid = searchParams.get("tok") || '';
    const returnInfo = await getServerSession("wrd:openid.idpstate", sessionid);
    if (!returnInfo)
      return { error: "Session has expired" }; //TODO redirect the user to an explanatory page

    //TODO verify this schema actually owns the entity (but not sure what the risks are if you mess up endpoints?)
    if (customizer?.onOpenIdReturn) {
      const redirect = await customizer.onOpenIdReturn({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        client: returnInfo.clientid,
        scopes: returnInfo.scopes,
        user
      });

      if (redirect) {
        await runInWork(() => closeServerSession(sessionid));
        return { ...redirect, error: null };
      }
    }

    //Update session with user info
    await runInWork(() => updateServerSession("wrd:openid.idpstate", sessionid, { ...returnInfo, user }));

    const finalRedirectURI = new URL(returnInfo.cbUrl);
    if (returnInfo.state !== null)
      finalRedirectURI.searchParams.set("state", returnInfo.state);
    finalRedirectURI.searchParams.set("code", sessionid);

    return { type: "redirect", url: finalRedirectURI.toString(), error: null };
  }

  ///Implements the oauth2/openid endpoint
  async retrieveTokens(form: URLSearchParams, headers: Headers, options?: AuthTokenOptions): Promise<{ error: string } | { error: null; body: TokenResponse }> {
    let headerClientId = '', headerClientSecret = '';
    const authorization = headers.get("Authorization")?.match(/^Basic +(.+)$/i);
    if (authorization) {
      const decoded = atob(authorization[1]).split(/^([^:]+):(.*)$/);
      if (decoded)
        [, headerClientId, headerClientSecret] = decoded;

      /* TODO? if specified, we should probably validate the id/secret right away to provide a nicer UX rather than waiting for the token endpoint to be hit ?
          Or aren't we allowed to validate  .. RFC6749 4.1.2 doesn't mention checking confidential clients, 4.1.4 does
          */
    }

    const clientid = headerClientId || form.get("client_id") || '';
    const client = await this.wrdschema.
      query("wrdauthServiceProvider").
      where("wrdGuid", "=", decompressUUID(clientid)).
      select(["clientSecrets", "wrdId"]).
      execute();
    if (client.length !== 1)
      return { error: "No such client" };

    const granttype = form.get("grant_type");
    if (granttype !== "authorization_code")
      return { error: `Unexpected grant_type '${granttype}'` };

    const urlsecret = headerClientSecret || form.get("client_secret");
    if (!urlsecret)
      return { error: "Missing parameter client_secret" };

    const hashedsecret = hashClientSecret(urlsecret);
    const matchsecret = client[0].clientSecrets.find((secret) => secret.secretHash === hashedsecret);
    if (!matchsecret)
      return { error: "Invalid secret" };

    const sessionid = form.get("code");
    if (!sessionid)
      return { error: "Missing code" };

    //The code is the session id
    const returnInfo = await getServerSession("wrd:openid.idpstate", sessionid);
    if (!returnInfo || !returnInfo?.user || returnInfo.clientid !== client[0].wrdId)
      return { error: "Invalid or expired code" };

    if (returnInfo.code_challenge && returnInfo.code_challenge_method) {
      //The original request had a code challenge, so this request should have a verifier
      const code_verifier = form.get("code_verifier");
      if (!code_verifier)
        return { error: "Missing code_verifier" };
      if (!code_verifier.match(/^[A-Za-z0-9-._~]{43,128}$/))
        return { error: "Invalid code_verifier" };
      if (!verifyCodeChallenge(code_verifier, returnInfo.code_challenge, returnInfo.code_challenge_method))
        return { error: "Wrong code_verifier" };
    }

    const tokens = await this.createTokens("oidc", returnInfo.user, returnInfo.clientid, sessionid, returnInfo.nonce, {
      scopes: returnInfo.scopes,
      customizer: options?.customizer,
      expires: options?.expires || openIdTokenExpiry
    });

    return {
      error: null,
      body: {
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        token_type: "Bearer",
        ...(tokens.expires ? { expires_in: Math.floor(tokens.expires - (Date.now() / 1000)) } : {})
      }
    };
  }

  private async lookupUser(authsettings: WRDAuthSettings, loginname: string, customizer?: AuthCustomizer, options?: LoginUsernameLookupOptions): Promise<number | null> {
    if (!authsettings.loginAttribute)
      throw new Error("No login attribute defined for WRD schema " + this.wrdschema.tag);

    if (customizer?.lookupUsername)
      return await customizer.lookupUsername({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        username: loginname,
        ...pick(options || {}, ["site"])
      });

    const user = await this.wrdschema.search("wrdPerson", authsettings.loginAttribute as AttrRef<WRD_Idp_WRDPerson>, loginname);
    return user || null;
  }

  async handleFrontendLogin(targeturl: string, username: string, password: string, customizer?: AuthCustomizer, options?: LoginRemoteOptions): Promise<FrontendAuthResult> {
    const prepped = await prepAuth(targeturl, null);
    if ("error" in prepped)
      throw new Error(prepped.error);

    const authsettings = await getAuthSettings(this.wrdschema);
    if (!authsettings?.passwordAttribute)
      throw new Error("No password attribute defined for WRD schema " + this.wrdschema.tag);

    let userid = await this.lookupUser(authsettings, username, customizer, options);
    if (userid) {
      const getfields = {
        password: authsettings.passwordAttribute,
        ...(authsettings.hasAccountStatus ? { wrdauthAccountStatus: "wrdauthAccountStatus" } : {})
      };

      //@ts-ignore -- how to fix? WRD TS is not flexible enough for this yet:
      const userInfo = await this.wrdschema.getFields(authsettings.accountType, userid, getfields) as {
        password: AuthenticationSettings | null;
        wrdauthAccountStatus?: WRDAuthAccountStatus | null;
      };

      if (authsettings.hasAccountStatus && !(userInfo?.wrdauthAccountStatus?.status === "active"))
        userid = 0;

      //TODO ratelimits/auditing
      if (userid && !await userInfo?.password?.verifyPassword(password))
        userid = 0;
    }

    if (!userid) {
      return {
        loggedIn: false,
        error: "Unknown username or password",
        code: authsettings.loginIsEmail ? "incorrect-email-password" : "incorrect-login-password"
      }; //TOOD gettid, adapt to whether usernames or email addresses are set up (see HS WRD, it has the tids)
    }

    if (customizer?.isAllowedToLogin) {
      const awaitableResult = customizer.isAllowedToLogin({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        user: userid,
      });
      const result = isPromise(awaitableResult) ? await awaitableResult : awaitableResult;
      if (result)
        return { loggedIn: false, ...result };
    }

    return {
      loggedIn: true,
      setAuth: await prepCookies(prepped, userid, { customizer, persistent: options?.persistent }),
    };
  }
}

/** Create a token for use with this server
 * @param type - Token type - "id" to identfy the user, "api" to allow access on behalf of the user
 * @param userid - Entity associated with this token
 */
export async function createFirstPartyToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, type: "id", userid: number, options?: AuthTokenOptions): Promise<FirstPartyToken & { expires: Temporal.Instant }>; //id tokens always expire
export async function createFirstPartyToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, type: "id" | "api", userid: number, options?: AuthTokenOptions): Promise<FirstPartyToken>;

export async function createFirstPartyToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, type: "id" | "api", userid: number, options?: AuthTokenOptions): Promise<FirstPartyToken> {
  if (options?.scopes?.includes("openid"))
    throw new Error("Only third party tokens can request an openid scope");

  //FIXME adopt expiry settings from HS WRDAuth
  const prov = new IdentityProvider(wrdSchema);
  const tokens = await prov.createTokens(type, userid, null, null, null, options);
  return {
    id: tokens.tokenId,
    accessToken: tokens.access_token,
    expires: tokens.expires ? Temporal.Instant.fromEpochSeconds(tokens.expires) : null
  };
}

async function getDBTokens<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, tokenId: number | null, entityId: number | null): Promise<ListedToken[]> {
  const tokens =
    await db<PlatformDB>().selectFrom("wrd.tokens").
      where(qb => tokenId !== null ? qb("wrd.tokens.id", "=", tokenId) : qb("wrd.tokens.entity", "=", entityId)).
      fullJoin("wrd.entities", "wrd.entities.id", "wrd.tokens.entity").
      fullJoin("wrd.types", "wrd.types.id", "wrd.entities.type").
      fullJoin("wrd.schemas", "wrd.schemas.id", "wrd.types.wrd_schema").
      select(["wrd.schemas.name", "wrd.tokens.id", "wrd.tokens.type", "wrd.tokens.creationdate", "wrd.tokens.expirationdate", "wrd.tokens.scopes", "wrd.tokens.metadata", "wrd.tokens.title"]).
      execute();

  if (tokens.length && tokens[0]?.name !== wrdSchema.tag)
    throw new Error(entityId !== null ?
      `Requested entity does not belong to schema ${wrdSchema.tag}` :
      `Requested token does not belong to schema ${wrdSchema.tag}`);

  return tokens.map(token => ({
    id: token.id || 0,
    type: token.type as "id" | "api",
    metadata: token.metadata ? parseTyped(token.metadata) : null,
    created: token.creationdate!.toTemporalInstant(),
    expires: token.expirationdate!.getTime() === defaultDateTime.getTime() ? null : token.expirationdate?.toTemporalInstant() ?? null,
    scopes: token.scopes ? token.scopes.split(" ") : [],
    title: token.title || ''
  }));
}

export async function getToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, tokenId: number): Promise<ListedToken | null> {
  return (await getDBTokens(wrdSchema, tokenId, null))[0] || null;
}

/** List active tokens
 * @param wrdSchema - The schema to list tokens for
 * @param entityId - The entity id to list tokens for
 * @returns A list of tokens
*/
export async function listTokens<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, entityId: number): Promise<ListedToken[]> {
  return await getDBTokens(wrdSchema, null, entityId);
}

async function verifyToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, tokenId: number): Promise<void> {
  const token =
    await db<PlatformDB>().selectFrom("wrd.tokens").
      where("wrd.tokens.id", "=", tokenId).
      fullJoin("wrd.entities", "wrd.entities.id", "wrd.tokens.entity").
      fullJoin("wrd.types", "wrd.types.id", "wrd.entities.type").
      fullJoin("wrd.schemas", "wrd.schemas.id", "wrd.types.wrd_schema").
      select("wrd.schemas.name").
      executeTakeFirst();

  if (token?.name !== wrdSchema.tag)
    throw new Error(`Token #${tokenId} does not belong to schema ${wrdSchema.tag}`);
}

/** Update token
* @param wrdSchema - The schema to list tokens for
* @param tokenId - The token id to delete
* @returns A list of tokens
*/
export async function updateToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, tokenId: number, update: {
  title?: string;
  expires?: Temporal.Instant | null;
}): Promise<void> {
  await verifyToken(wrdSchema, tokenId);

  const updates: Updateable<PlatformDB, "wrd.tokens"> = {};
  if (update?.title !== undefined)
    updates.title = update.title;
  if (update?.expires !== undefined)
    updates.expirationdate = update.expires ? new Date(update.expires.epochMilliseconds) : defaultDateTime;

  if (Object.keys(updates).length)
    await db<PlatformDB>().updateTable("wrd.tokens").where("id", "=", tokenId).set(updates).execute();
}

/** Delete token
* @param wrdSchema - The schema to list tokens for
* @param tokenId - The token id to delete
* @returns A list of tokens
*/
export async function deleteToken<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, tokenId: number): Promise<void> {
  await verifyToken(wrdSchema, tokenId);

  await db<PlatformDB>().deleteFrom("wrd.tokens").where("id", "=", tokenId).execute();
}

async function prepCookies(prepped: PrepAuthResult, userId: number, options?: AuthTokenOptions): Promise<SetAuthCookies> {
  if ("error" in prepped)
    throw new Error(prepped.error);

  const customizer = options?.customizer || (prepped.settings?.customizer ? await importJSObject(prepped.settings.customizer) as AuthCustomizer : undefined);
  const wrdSchema = new WRDSchema(prepped.settings.wrdSchema);
  const idToken = await createFirstPartyToken(wrdSchema, "id", userId, { ...options, customizer });

  const setToken: SetAuthCookies = {
    ...prepped.cookies,
    persistent: options?.persistent || false,
    value: generateRandomId() + " accessToken:" + idToken.accessToken,
    expires: idToken.expires,
  };

  if (customizer?.onFrontendUserInfo)
    setToken.userInfo = await customizer.onFrontendUserInfo({
      wrdSchema: wrdSchema as unknown as WRDSchema<AnySchemaTypeDefinition>,
      user: userId,
      entityId: userId
    });

  return setToken;
}

/** Generate a navigation instruction to set an Id Token cookie. This API can be used to construct a "Login As" service
 * @param targetUrl - URL to which we'll redirect after logging in and which will be used to extract WRDAuth settings
 * @param userId - The user ID to generate a token for
 * @param options - Options for token generation
 */
export async function prepareFrontendLogin(targetUrl: string, userId: number, options?: AuthTokenOptions): Promise<NavigateInstruction> {
  const prepped = await prepAuth(targetUrl, null);

  const target = new URL(targetUrl);

  /* encrypt the data - don't want to build a remotely callable __Host- cookie setter
     also sending origin + pathname so you can't redirect this request to another URL
     (doubt we need pathname though?) */
  const setToken: ServerEncryptionScopes["platform:settoken"] = {
    ...await prepCookies(prepped, userId, options),
    target: targetUrl,
  };

  return {
    type: "form",
    form: {
      action: `${target.origin}/.wh/auth/settoken`,
      vars: [{ name: "settoken", value: encryptForThisServer("platform:settoken", setToken) }]
    }
  };
}

export async function closeFrontendLogin(cookie: string): Promise<void> {
  const accessToken = cookie?.match(/ accessToken:(.+)$/)?.[1];
  if (accessToken) {
    const hash = hashSHA256(accessToken);
    await runInWork(() => db<PlatformDB>().deleteFrom("wrd.tokens").where("hash", "=", hash).execute());
  }
}
