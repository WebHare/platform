import * as crypto from "node:crypto";
import jwt, { type JwtPayload, type SignOptions, type VerifyOptions } from "jsonwebtoken";
import { type AnyWRDSchema, type SchemaTypeDefinition, WRDSchema } from "@webhare/wrd/src/schema";
import type { WRD_IdpSchemaType, WRD_Idp_WRDPerson } from "@mod-platform/generated/wrd/webhare";
import { convertWaitPeriodToDate, generateRandomId, isPromise, parseTyped, pick, stringify, throwError, type WaitPeriod } from "@webhare/std";
import { generateKeyPair, type KeyObject, type JsonWebKey, createPrivateKey, createPublicKey } from "node:crypto";
import { getSchemaSettings, updateSchemaSettings } from "@webhare/wrd/src/settings";
import { runInWork, db, runInSeparateWork, type Updateable } from "@webhare/whdb";
import { dtapStage, type NavigateInstruction } from "@webhare/env";
import { closeServerSession, decryptForThisServer, encryptForThisServer, importJSObject, type ServerEncryptionScopes } from "@webhare/services";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { AnySchemaTypeDefinition, AttrRef } from "@webhare/wrd/src/types";
import { defaultDateTime } from "@webhare/hscompat";
import type { AuthCustomizer, JWTPayload, LoginDeniedInfo, LoginUsernameLookupOptions, ReportedUserInfo } from "./customizer";
import type { WRDAuthAccountStatus } from "@webhare/auth";
import type { ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { getAuditContext, writeAuthAuditEvent, type AuthAuditContext } from "./audit";
import { calculateWRDSessionExpiry, defaultWRDAuthLoginSettings, getAuthPageURL, getAuthSettings, getUserValidationSettings, prepAuth, prepAuthForURL, type PrepAuthResult, type WRDAuthPluginSettings_Request } from "./support";
import { tagToHS, tagToJS } from "@webhare/wrd/src/wrdsupport";
import type { PublicAuthData } from "@webhare/frontend/src/auth";
import { checkPasswordCompliance, verifyPasswordCompliance, type PasswordCheckResult } from "./passwords";
import { getCompleteAccountNavigation, type LoginTweaks, type LoginErrorCode, type LoginResult } from "./shared";
import { AuthenticationSettings } from "@webhare/wrd";
import { getGuidForEntity } from "@webhare/wrd/src/accessors";

const defaultPasswordResetExpiry = 3 * 86400_000; //default 3 days epxiry

/** Token creation options. DO NOT EXPOSE FROM \@webhare/auth . */
export interface AuthTokenOptions {
  /** Customizer object */
  customizer?: AuthCustomizer;
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
  /** Skip writing an audit event. This should only be used if an event was written at a higher level. We may consider removing this flag once all old wrdauth events are replaced by platform events */
  skipAuditEvent?: boolean;
  /** Explicitly indicate that this is an impersonation, don't auditlog/update lastlogin as if it were real */
  isImpersonation?: boolean;
  /** Callback to invoke inside the work on succesful token creation */
  onSuccess?: () => Promise<void>;
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
  /** Client to which the token was provided */
  client: number | null;
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
  /** Public auth data*/
  publicAuthData: PublicAuthData;
  /** Base cookie settings */
  cookieSettings: ServersideCookieOptions;
  /** Session should persist after browser close*/
  persistent?: boolean;

  // The value below are needed for prepareLoginCookies
  /** WRD Schema used */
  wrdSchema: WRDSchema<AnySchemaTypeDefinition>;
  /** User id logging in */
  userId: number;
  /** Customizer used */
  customizer: AuthCustomizer | undefined;
};

export type FrontendLoginRequest = {
  /** Host page for logins. We should be able to redirect here if authentication is incomplete. It's also a fallback if no returnTo option is set in loginOptions, we assume the loginpage will redirect you if you're already logged in  */
  loginHost: string;
  settings: WRDAuthPluginSettings_Request;
  login: string;
  password: string;
  customizer?: AuthCustomizer;
  loginOptions?: LoginOptions;
  tokenOptions: AuthTokenOptions & { authAuditContext: { clientIp: string; browserTriplet: string } }; //some auditfields are required coming from the frontend
};

export type FirstPartyToken = {
  /** Token id in database (wrd.tokens) */
  id: number;
  /** The access token itself */
  accessToken: string;
  /** Access token expiration (null if set to never expire) */
  expires: Temporal.Instant | null;
};

export interface LoginOptions extends LoginUsernameLookupOptions, LoginTweaks {
  /** Request a persistent login */
  persistent?: boolean;
  /** Return url */
  returnTo?: string;
}

export type FrontendAuthResult = LoginResult & { setAuth?: SetAuthCookies };

declare module "@webhare/services" {
  interface SessionScopes {
    "platform:incomplete-account": {
      /** User id to login */
      user: number;
      /** Return url */
      returnTo: string;
      /** Failed checks */
      failedchecks: string[];
      /** Time of the bad password */
      badPasswordTime: Temporal.Instant | null;
    };
  }
  interface ServerEncryptionScopes {
    "platform:settoken": SetAuthCookies & {
      target: string;
    };
    "platform:totpchallenge": { //mirrors HS 'firstfactorproof'
      userId: number;
      password: string; //password used
      challenge: string;
      validUntil: Date;
      returnTo: string;
    };
    "platform:passwordreset": {
      /** User to reset */
      user: number;
      /** Verifier expected, if any */
      verifier?: string;
      /** Creation */
      iat: number;
      /** Expiration */
      exp: number;
      /** Return URL */
      returnUrl: string;
      /** Is set password? */
      isSet?: boolean;
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
  hasWhuserUnit: boolean;
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
  /** wrdId of the found subject */
  entity: number;
  /** authAccountStatus of the found subject, if available */
  accountStatus: WRDAuthAccountStatus | null;
  /** decoded scopes */
  scopes: string[];
  /** client to which the token was provided */
  client: number | null;
  /** expiration date */
  expires: Temporal.Instant | null;
  /** id of the used token (refers to wrd.tokens table) */
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

export function hashSHA256(secret: string): Buffer {
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
  private authsettings?: WRDAuthSettings | null;

  constructor(wrdschema: WRDSchema<SchemaType>) {
    //TODO can we cast to a 'real' base type instead of abusing System_UsermgmtSchemaType for the wrdSettings type?
    this.wrdschema = wrdschema as unknown as WRDSchema<WRD_IdpSchemaType>;
  }

  getAuthSettings(required: true): Promise<WRDAuthSettings & { loginAttribute: string; passwordAttribute: string; passwordIsAuthSettings: true }>;
  getAuthSettings(required: false): Promise<WRDAuthSettings | null>;

  async getAuthSettings(required: boolean): Promise<WRDAuthSettings | null> {
    if (!this.authsettings)
      this.authsettings ||= await getAuthSettings(this.wrdschema);
    if (required) {
      if (!this.authsettings?.passwordAttribute)
        throw new Error(`Schema '${this.wrdschema.tag}' is not configured for WRD Authentication`);
      if (!this.authsettings.loginAttribute)
        throw new Error(`Schema '${this.wrdschema.tag}' has an outdated confuguration (login attribute note set)`);
      if (!this.authsettings.passwordIsAuthSettings)
        throw new Error(`Schema '${this.wrdschema.tag}' has an outdated confuguration (field '${this.authsettings.passwordAttribute}' is not of type AUTHSETTINGS)`);
    }
    return this.authsettings;
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

    const loginSettings = { ...defaultWRDAuthLoginSettings, ...(await getSchemaSettings(this.wrdschema, ["loginSettings"]))?.loginSettings };
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

    const authsettings = await this.getAuthSettings(false);
    if (!authsettings?.accountType)
      throw new Error(`Schema '${this.wrdschema.tag}' is not configured for WRD Authentication - accountType not set`);

    const subfield = clientInfo?.subjectField || "wrdGuid";
    const subjectValue = subfield === "wrdGuid"
      ? await getGuidForEntity(subject) // faster and doesn't enforce a accountType dependency if a there's not clientInfo and thus no configuration anyway
      : (await (this.wrdschema as AnyWRDSchema).getFields(authsettings.accountType, subject, [subfield]))?.[subfield] as string;
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
      if (options?.scopes?.includes("email")) { //TODO authorize somewhere whether 'email' is allowed for this client
        if (authsettings.emailAttribute) {
          const { email } = await (this.wrdschema as AnyWRDSchema).getFields("wrdPerson", subject, { email: authsettings.emailAttribute });
          if (email)
            payload.email = email;
        }
      }

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
    if (options?.customizer?.onFrontendIdToken)
      await options.customizer.onFrontendIdToken({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        user: subject,
        entityId: subject
      }, atPayload as JWTPayload);
    const access_token = prefix + this.signJWT(atPayload, config.signingKeys, "EC");
    const metadata = options?.metadata ? stringify(options.metadata, { typed: true }) : "";
    if (Buffer.from(metadata).length > 4096)
      throw new Error(`Metadata too large, max size is 4096 bytes`);

    return await runInWork(async () => {
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

      if (options?.onSuccess)
        await options.onSuccess();

      if (type !== "oidc" && !options?.skipAuditEvent) {
        await writeAuthAuditEvent(this.wrdschema, {
          type: type === "id" ? "platform:login" : "platform:apikey",
          entity: subject,
          ...(options?.authAuditContext ?? getAuditContext()),
          data: { tokenHash: hash.toString("base64url") }
        });
      }


      return { access_token, expires: atPayload.exp || null, ...(id_token ? { id_token } : null), tokenId: insertres[0].id };
    });
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

    const authsettings = await this.getAuthSettings(false);
    let accountStatus: WRDAuthAccountStatus | null = null;
    if (authsettings) {
      const getfields = {
        ...(authsettings.hasAccountStatus ? { wrdauthAccountStatus: "wrdauthAccountStatus" } : {})
      };
      const entity = await (this.wrdschema as AnyWRDSchema).getFields(authsettings.accountType, matchToken.entity, getfields, { historyMode: "active", allowMissing: true }) as {
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

  async lookupUser(authsettings: WRDAuthSettings, loginname: string, customizer?: AuthCustomizer, jwtPayload?: JWTPayload | undefined, options?: LoginUsernameLookupOptions): Promise<number | null> {
    if (!authsettings.loginAttribute)
      throw new Error("No login attribute defined for WRD schema " + this.wrdschema.tag);

    if (customizer?.lookupUsername)
      return await customizer.lookupUsername({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        username: loginname,
        jwtPayload,
        ...pick(options || {}, ["site"])
      });

    const user = await (this.wrdschema as AnyWRDSchema).search(authsettings.accountType, authsettings.loginAttribute as AttrRef<WRD_Idp_WRDPerson>, loginname);
    return user || null;
  }

  async returnLoginFail(request: FrontendLoginRequest, userid: number | null, userCode: LoginErrorCode, logCode?: LoginErrorCode): Promise<FrontendAuthResult> {
    await runInWork(() => writeAuthAuditEvent(this.wrdschema, {
      type: "platform:login-failed",
      entity: userid,
      entityLogin: request.login,
      ...request.tokenOptions?.authAuditContext,
      data: { code: logCode ?? userCode }
    }));

    return { loggedIn: false, code: userCode };
  }

  async handleFrontendLogin(request: FrontendLoginRequest): Promise<FrontendAuthResult> {
    type UserInfo = {
      password: AuthenticationSettings | null;
      wrdauthAccountStatus?: WRDAuthAccountStatus | null;
      whuserUnit?: number | null;
    };

    const prepped = prepAuth(request.settings);
    if ("error" in prepped)
      throw new Error(prepped.error);

    if (!request.tokenOptions?.authAuditContext?.clientIp)
      throw new Error("Remote IP address is required for authentication auditing");
    if (!request.tokenOptions?.authAuditContext?.browserTriplet)
      throw new Error("BrowserTriplet is required for authentication auditing");

    const authsettings = await this.getAuthSettings(true);
    const returnTo = request.loginOptions?.returnTo || request.loginHost;
    const userid = await this.lookupUser(authsettings, request.login, request.customizer, undefined, pick(request.loginOptions || {}, ["persistent", "site"]));
    if (!userid)
      return await this.returnLoginFail(request, null, authsettings.loginIsEmail ? "incorrect-email-password" : "incorrect-login-password", "unknown-account");

    const getfields = {
      password: authsettings.passwordAttribute,
      ...(authsettings.hasAccountStatus ? { wrdauthAccountStatus: "wrdauthAccountStatus" } : {}),
      ...(authsettings.hasWhuserUnit ? { whuserUnit: "whuserUnit" } : {})
    };

    const userInfo = await (this.wrdschema as AnyWRDSchema).getFields(authsettings.accountType, userid, getfields) as UserInfo;

    //TODO reuse the unitInfo for later password checks
    const passwordValidationChecks = await getUserValidationSettings(this.wrdschema, userInfo.whuserUnit || null);
    const noExternalLogin = passwordValidationChecks.split(' ').includes("externallogin");
    if (noExternalLogin
      || !userInfo?.password
      || !await userInfo.password.verifyPassword(request.password)) {
      const userCode = authsettings.loginIsEmail ? "incorrect-email-password" : "incorrect-login-password";
      const logCode = noExternalLogin ? "require-external-login" : userCode;
      return await this.returnLoginFail(request, userid, userCode, logCode);
    }

    if (!userInfo.password.isPasswordStillSecure()) { //upgrade using re-entered password
      await userInfo.password?.updatePassword(request.password, { inPlace: true });
      await runInWork(() => this.wrdschema.update("wrdPerson", userid, { [authsettings.passwordAttribute]: userInfo.password }));
    }

    if (userInfo.password.hasTOTP()) {
      const validUntil = new Date(Date.now() + 5 * 60_000);
      const challenge = generateRandomId();
      //FIXME don't store the password, but instead store its compliance settings. makes it harder to accidentally log passwords. but then totpchallenge would be creating the compliance session *after* us? or we should still arrange for sharing session/tokens ?
      const token = encryptForThisServer("platform:totpchallenge", { challenge, userId: userid, validUntil, password: request.password, returnTo });

      await runInWork(() => writeAuthAuditEvent(this.wrdschema, {
        type: "platform:secondfactor.challenge",
        entity: userid,
        entityLogin: request.login,
        ...request.tokenOptions.authAuditContext,
        data: { challenge }
      }));

      return { //redirect to authpages to complete the account
        loggedIn: false,
        navigateTo: {
          type: "form",
          form: {
            //FIXME where does our caller gauarantee that returnTo will be compatible with request.settings ? or that it's a safe redirection target?
            action: new URL(request.loginHost).origin + "/.wh/common/authpages/?wrd_pwdaction=totp&pathname=" + encodeURIComponent(new URL(request.loginHost).pathname.substring(1)),
            vars: [{ name: "token", value: token }]
          },
        },
      };
    }

    //TODO this may be inconsistent, shouldn't verifyPasswordCompliance take the loginHost as parameter instead of returnTo, and pass loginOptions to deal with returnTo and other preferences ?
    const complianceToken = await verifyPasswordCompliance(this.wrdschema, userid, userInfo.whuserUnit || null, request.password, userInfo.password, returnTo, request.tokenOptions.authAuditContext);
    if (complianceToken) {
      return { //redirect to authpages to complete the account
        loggedIn: false,
        navigateTo: getCompleteAccountNavigation(complianceToken, new URL(request.loginHost).pathname.substring(1))
      };
    }

    //TODO ratelimits/auditing
    //TODO we should probably use the same token for the login page as well
    if (authsettings.hasAccountStatus && userInfo?.wrdauthAccountStatus?.status !== "active")
      return await this.returnLoginFail(request, userid, "account-disabled");

    if (request.customizer?.isAllowedToLogin) {
      const awaitableResult = request.customizer.isAllowedToLogin({
        wrdSchema: this.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
        user: userid,
      });
      const result = isPromise(awaitableResult) ? await awaitableResult : awaitableResult;
      if (result)
        return await this.returnLoginFail(request, userid, result.code); //Maybe we'll reintroduce custom errors again in the future, but we'd also need to pass langcode context then or rely on CodeContext
    }

    const prepOptions = { ...request.tokenOptions, customizer: request.customizer, persistent: request.loginOptions?.persistent };

    // Use ?wrdauth_limit_expiry=<seconds> to limit expiry up to 15 minutes - but only on development servers
    if (request.loginOptions?.limitExpiry) {
      if (dtapStage !== "development")
        throw new Error("Limit expiry (wrdauth_limit_expiry) is only allowed on development servers");
      if (!(request.loginOptions.limitExpiry > 0 && request.loginOptions.limitExpiry <= 15 * 60))
        throw new Error("Limit expiry (wrdauth_limit_expiry) must be between 0 and 15 minutes");

      prepOptions.expires = request.loginOptions.limitExpiry * 1000;
    }

    return {
      loggedIn: true,
      setAuth: await prepCookies(authsettings, prepped, userid, prepOptions),
      navigateTo: { type: "redirect", url: returnTo },
    };
  }

  /** Create a password reset link for email, with optionally a raw code-enty for verification
      @param baseurl - Base url to redirect the user to
      @param user - Userid to reset
      @returns Password reset link data
  */
  async createPasswordResetLink(targetUrl: string, user: number, options?: {
    /** Optional code with which the verifier should start */
    prefix?: string;
    /** Do not log this request to the auditlog - needed to prevent unsollicited link requests from flooding the logs (eg webshop order confiration) */
    skipAuditLog?: boolean;
    separateCode?: boolean;
    expires?: WaitPeriod;
    /** This is a 'set (first) passsword' flow, not a 'reset password'. It changes some terminology  */
    isSetPassword?: boolean;
    /** Information about the source and actors in this event */
    authAuditContext?: AuthAuditContext;
    /** If we're hosting the password page ourself */
    selfHosted?: boolean;
  }): Promise<{
    /** The link to reset the password (and optionally enter the code) */
    link: string;
    /** The verification code (should be sent to the user through a separate channel) */
    verifier: string | null;
  }> {
    const iat = Date.now();
    const exp = convertWaitPeriodToDate(options?.expires || defaultPasswordResetExpiry).getTime();
    const verifier = options?.separateCode ? ((options?.prefix || "") + generateRandomId("hex", 6)).toUpperCase() : undefined;
    const tok = encryptForThisServer("platform:passwordreset", { iat, exp, user, verifier, returnUrl: targetUrl, isSet: options?.isSetPassword || undefined });

    if (!options?.skipAuditLog)
      await runInWork(() => writeAuthAuditEvent(this.wrdschema, {
        entity: user,
        type: "platform:resetpassword",
        ...(options?.authAuditContext ?? getAuditContext())
      }));

    const link = options?.selfHosted ? new URL(targetUrl) : getAuthPageURL(targetUrl);
    link.searchParams.set("wrd_pwdaction", "resetpassword");
    link.searchParams.set("_ed", tok);

    return {
      link: link.toString(),
      verifier: verifier || null
    };
  }

  async verifyPassword(userId: number, password: string): Promise<boolean> {
    const authsettings = await this.getAuthSettings(true);
    const { whuserPassword } = await (this.wrdschema as AnyWRDSchema).getFields(authsettings.accountType, userId, { whuserPassword: authsettings.passwordAttribute }) ?? throwError(`Unable to find user #${userId} in schema ${this.wrdschema.tag}`);
    return whuserPassword?.verifyPassword(password) || false;
  }

  async verifyPasswordReset(tok: string, verifier: string | null, options?: { skipVerifierCheck?: boolean }): Promise<{
    result: "expired" | "badverifier" | "ok" | "alreadychanged";
    expired?: Temporal.Instant;
    login?: string;
    user?: number;
    needsVerifier?: boolean;
    isSetPassword?: boolean;
    returnTo?: string;
  }> {
    const decode = decryptForThisServer("platform:passwordreset", tok, { nullIfInvalid: true });
    if (!decode)
      return { result: "expired" };

    const isSetPassword = decode.isSet || false;
    const returnTo = decode.returnUrl;
    if (decode.exp < Date.now())
      return { result: "expired", isSetPassword, expired: Temporal.Instant.fromEpochSeconds(decode.exp), returnTo };

    const authsettings = await this.getAuthSettings(true);
    const getfields = {
      login: authsettings.loginAttribute,
      whuserPassword: authsettings.passwordAttribute
    };

    const { login, whuserPassword } = await (this.wrdschema as AnyWRDSchema).getFields(authsettings.accountType, decode.user, getfields) as {
      login: string;
      whuserPassword: AuthenticationSettings | null;
    };
    const lastchange = whuserPassword?.getLastPasswordChange();
    if (lastchange && lastchange.epochMilliseconds > decode.iat) //password already changed
      return { result: "alreadychanged", isSetPassword, expired: Temporal.Instant.fromEpochMilliseconds(lastchange.epochMilliseconds), returnTo };

    const needsVerifier = Boolean(decode.verifier);
    if (options?.skipVerifierCheck)
      return { result: "ok", isSetPassword, needsVerifier, login, returnTo }; //we're not going to return a userid to ensure API users can't accidentally skip the verifier check

    if (decode.verifier && decode.verifier.toUpperCase() !== verifier?.toUpperCase())
      return { result: "badverifier", isSetPassword, returnTo };

    return { result: "ok", isSetPassword, needsVerifier, login, user: decode.user, returnTo };
  }

  async updatePassword(user: number, newPassword: string, options?: { lang?: string }): Promise<PasswordCheckResult> {
    const authsettings = await this.getAuthSettings(true);
    const getfields = {
      whuserPassword: authsettings.passwordAttribute,
      ...(authsettings.hasWhuserUnit ? { whuserUnit: "whuserUnit" } : {})
    };

    let {
      whuserPassword, whuserUnit
    } = await (this.wrdschema as AnyWRDSchema).getFields(authsettings.accountType, user, getfields) as {
      whuserPassword: AuthenticationSettings | null;
      whuserUnit?: number | null;
    };

    const passwordValidationChecks = await getUserValidationSettings(this.wrdschema, whuserUnit || null);
    if (passwordValidationChecks) {
      const passwordCheck = await checkPasswordCompliance(passwordValidationChecks, newPassword, {
        isCurrentPassword: false,
        authenticationSettings: whuserPassword || undefined,
        lang: options?.lang,
      });
      if (!passwordCheck.success)
        return passwordCheck;
    }

    await runInWork(async () => {
      whuserPassword ||= new AuthenticationSettings;
      await whuserPassword.updatePassword(newPassword);
      await this.wrdschema.update("wrdPerson", user, { [authsettings.passwordAttribute]: whuserPassword });
    });
    return { success: true };
  }
} //ends IdentityProvider

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
      select(["wrd.schemas.name", "wrd.tokens.id", "wrd.tokens.type", "wrd.tokens.creationdate", "wrd.tokens.expirationdate", "wrd.tokens.scopes", "wrd.tokens.metadata", "wrd.tokens.title", "wrd.tokens.client"]).
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
    title: token.title || '',
    client: token.client
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

export async function buildPublicAuthData(authsettings: WRDAuthSettings, prepped: PrepAuthResult, userId: number, expiresMs: number, persistent: boolean, customizer?: AuthCustomizer): Promise<PublicAuthData> {
  if ("error" in prepped)
    throw new Error(prepped.error);

  customizer ||= prepped.settings?.customizer ? await importJSObject(prepped.settings.customizer) as AuthCustomizer : undefined;
  const wrdSchema = new WRDSchema(prepped.settings.wrdSchema);
  let userInfo: object | null = null;

  if (prepped.settings.cacheFields?.length) { //HS field getter, contains fieldnames such as WRD_FULLNAME
    const getfields = prepped.settings.cacheFields.map(tagToJS);
    const addUserInfo = await wrdSchema.getFields(authsettings.accountType, userId, getfields);
    userInfo = Object.fromEntries(
      Object.entries(addUserInfo).map(([key, value]) => [tagToHS(key).toLowerCase(), value])
    );
  }

  if (customizer?.onFrontendUserInfo) {
    const addUserInfo = await customizer.onFrontendUserInfo({
      wrdSchema: wrdSchema as unknown as WRDSchema<AnySchemaTypeDefinition>,
      user: userId,
      entityId: userId
    });
    if (addUserInfo) {
      userInfo = { ...userInfo, ...addUserInfo };
    }
  }

  return { expiresMs, userInfo: userInfo, persistent: persistent || undefined };
}

export async function prepCookies(authsettings: WRDAuthSettings, prepped: PrepAuthResult, userId: number, options?: AuthTokenOptions): Promise<SetAuthCookies> {
  if ("error" in prepped)
    throw new Error(prepped.error);

  const customizer = options?.customizer || (prepped.settings?.customizer ? await importJSObject(prepped.settings.customizer) as AuthCustomizer : undefined);
  const wrdSchema = new WRDSchema(prepped.settings.wrdSchema);

  //Create the token
  const idToken = await createFirstPartyToken(wrdSchema, "id", userId, {
    ...options,
    customizer,
    onSuccess: async () => {
      //Update first&last login if specified in wrdauth settings
      const isImpersonation = options?.isImpersonation || Boolean(options?.authAuditContext?.impersonatedBy);
      if (!isImpersonation && (prepped.settings.firstLoginField || prepped.settings.lastLoginField)) {
        const needFirstLogin = prepped.settings.firstLoginField && (await wrdSchema.getFields(authsettings.accountType, userId, { firstLogin: prepped.settings.firstLoginField })).firstLogin === null;
        const now = new Date;
        await wrdSchema.update(authsettings.accountType, userId, {
          ...(prepped.settings.lastLoginField ? { [prepped.settings.lastLoginField]: now } : {}),
          ...(needFirstLogin ? { [prepped.settings.firstLoginField!]: now } : {}),
        });
      }

      //Chainload any other onSuccess handler
      if (options?.onSuccess)
        await options.onSuccess();
    }
  });

  const setToken: SetAuthCookies = {
    ...prepped.cookies,
    persistent: options?.persistent || false,
    value: generateRandomId() + " accessToken:" + idToken.accessToken,
    expires: idToken.expires,
    publicAuthData: await buildPublicAuthData(authsettings, prepped, userId, idToken.expires.epochMilliseconds, options?.persistent || false, customizer),
    userId,
    customizer,
    wrdSchema
  };

  return setToken;
}

export async function prepareLogin(prepped: PrepAuthResult, userId: number, options?: AuthTokenOptions): Promise<SetAuthCookies> {
  if ("error" in prepped)
    throw new Error(prepped.error);

  /* encrypt the data - don't want to build a remotely callable __Host- cookie setter
     also sending origin + pathname so you can't redirect this request to another URL
     (doubt we need pathname though?) */
  const authsettings = await getAuthSettings(new WRDSchema(prepped.settings.wrdSchema)) ?? throwError("unconfigured wrd schema?");
  return await prepCookies(authsettings, prepped, userId, options);
}

export function wrapAuthCookiesIntoForm(targetUrl: string, setAuthCookies: SetAuthCookies): NavigateInstruction {
  /* encrypt the data - don't want to build a remotely callable __Host- cookie setter
     also sending origin + pathname so you can't redirect this request to another URL
     (doubt we need pathname though?) */
  const setToken: ServerEncryptionScopes["platform:settoken"] = {
    ...setAuthCookies,
    target: targetUrl,
  };

  return {
    type: "form",
    form: {
      action: `${new URL(targetUrl).origin}/.wh/preauth/settoken`,
      vars: [{ name: "settoken", value: encryptForThisServer("platform:settoken", setToken) }]
    }
  };
}

/** Generate a navigation instruction to set an Id Token cookie. This API can be used to construct a "Login As" service
 * @param targetUrl - URL to which we'll redirect after logging in and which will be used to extract WRDAuth settings
 * @param userId - The user ID to generate a token for
 * @param options - Options for token generation
 */
export async function prepareFrontendLogin(targetUrl: string, userId: number, options?: AuthTokenOptions): Promise<NavigateInstruction> {
  const setAuthCookies = await prepareLogin(await prepAuthForURL(targetUrl, null), userId, options);
  return wrapAuthCookiesIntoForm(targetUrl, setAuthCookies);
}

export async function verifyAllowedToLogin(wrdSchema: WRDSchema<AnySchemaTypeDefinition>, userId: number, customizer?: AuthCustomizer): Promise<LoginDeniedInfo | null> {
  const authsettings = await getAuthSettings(wrdSchema);
  if (!authsettings)
    throw new Error(`WRD schema '${wrdSchema.tag}' not configured for authentication`);

  if (authsettings?.hasAccountStatus) {
    const { wrdauthAccountStatus } = await wrdSchema.getFields(authsettings.accountType, userId, ["wrdauthAccountStatus"]);
    if (wrdauthAccountStatus?.status !== "active")
      return { error: "Account is disabled", code: "account-disabled" };
  }

  if (customizer?.isAllowedToLogin) {
    //It's a bit ugly to repeat the isAllowedToLogin call here and have to throw ... but prepareLoginCookies will go away once all HS Login calls go through handleFrontendLogin
    const awaitableResult = customizer.isAllowedToLogin({
      wrdSchema: wrdSchema as unknown as WRDSchema<AnySchemaTypeDefinition>,
      user: userId
    });
    const result = isPromise(awaitableResult) ? await awaitableResult : awaitableResult;
    if (result)
      return result;
  }
  return null;
}
