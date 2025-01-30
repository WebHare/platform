import * as crypto from "node:crypto";
import jwt, { type JwtPayload, type VerifyOptions } from "jsonwebtoken";
import type { SchemaTypeDefinition, WRDSchema } from "@mod-wrd/js/internal/schema";
import type { WRD_IdpSchemaType, WRD_Idp_WRDPerson } from "@mod-platform/generated/wrd/webhare";
import { convertWaitPeriodToDate, generateRandomId, pick, type WaitPeriod } from "@webhare/std";
import { generateKeyPair, type KeyObject, type JsonWebKey, createPrivateKey, createPublicKey } from "node:crypto";
import { getSchemaSettings, updateSchemaSettings } from "./settings";
import { beginWork, commitWork, runInWork, db } from "@webhare/whdb";
import type { NavigateInstruction } from "@webhare/env";
import { closeServerSession, createServerSession, encryptForThisServer, getServerSession, updateServerSession } from "@webhare/services";
import type { PlatformDB } from "@mod-platform/generated/whdb/platform";
import { tagToJS } from "./wrdsupport";
import { loadlib } from "@webhare/harescript";
import type { AttrRef } from "@mod-wrd/js/internal/types";
import { HareScriptType, decodeHSON, encodeHSON, setHareScriptType } from "@webhare/hscompat";

const logincontrolValidMsecs = 60 * 60 * 1000; // login control token is valid for 1 hour

type NavigateOrError = (NavigateInstruction & { error: null }) | { error: string };

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
}

export interface LoginUsernameLookupOptions {
  /** Login to a specific site */
  site?: string;
}

export interface LoginRemoteOptions extends LoginUsernameLookupOptions {
  /** Request a persistent login */
  persistent?: boolean;
}

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  id_token?: string;
  expires_in: number;
};

export type LoginErrorCodes = "internal-error" | "incorrect-login-password" | "incorrect-email-password";

type LoginResult = {
  loggedIn: true;
  accessToken: string;
  expires: Date;
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
  }
}

export interface WRDAuthSettings {
  emailAttribute: string | null;
  loginAttribute: string | null;
  loginIsEmail: boolean;
  passwordAttribute: string | null;
  passwordIsAuthSettings: boolean;
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

export async function getAuthSettings<T extends SchemaTypeDefinition>(wrdschema: WRDSchema<T>): Promise<WRDAuthSettings> {
  const settings = await db<PlatformDB>().selectFrom("wrd.schemas").select(["accountemail", "accountlogin", "accountpassword"]).where("name", "=", wrdschema.tag).executeTakeFirst();
  if (!settings)
    throw new Error(`No such WRD schema '${wrdschema.tag}'`);

  const persontype = wrdschema.getType("wrdPerson");
  const attrs = await persontype.ensureAttributes();

  const email = attrs.find(_ => _.id === settings.accountemail);
  const login = attrs.find(_ => _.id === settings.accountlogin);
  const password = attrs.find(_ => _.id === settings.accountpassword);

  return {
    emailAttribute: email ? tagToJS(email.tag) : null,
    loginAttribute: login ? tagToJS(login.tag) : null,
    loginIsEmail: Boolean(email?.id && email?.id === login?.id),
    passwordAttribute: password ? tagToJS(password.tag) : null,
    passwordIsAuthSettings: password?.attributetypename === "AUTHSETTINGS"
  };
}

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

export interface LookupUsernameParameters extends LoginUsernameLookupOptions {
  /** Username to look up */
  username: string;
}

export interface OpenIdRequestParameters {
  /// ID of the client requesting the token
  client: number;
  /// Requested scopes
  scopes: string[];
  /// ID of the WRD user that has authenticated
  user: number;
}

export type JWTPayload = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- like JwtPayload did. At most we could pick a JSON-Serializable type?
  [key: string]: any;
  sub: string;
  aud: string | string[];
  nbf: number;
  iat: number;

  //Not allowed to touch these variables;
  iss: never;
  jti: never;
  exp: never;

  // Commonly set claims (see https://www.iana.org/assignments/jwt/jwt.xhtml#claims for the full list)
  // https://openid.net/specs/openid-connect-core-1_0.html

  /** End-User's full name in displayable form including all name parts, possibly including titles and suffixes, ordered according to the End-User's locale and preferences. */
  name?: string;

  /** Given name(s) or first name(s) of the End-User. Note that in some cultures, people can have multiple given names; all can be present, with the names being separated by space characters. */
  given_name?: string;

  /** Surname(s) or last name(s) of the End-User. Note that in some cultures, people can have multiple family names or no family name; all can be present, with the names being separated by space characters. */
  family_name?: string;

  /** Middle name(s) of the End-User. Note that in some cultures, people can have multiple middle names; all can be present, with the names being separated by space characters. Also note that in some cultures, middle names are not used. */
  middle_name?: string;

  /** Casual name of the End-User that may or may not be the same as the given_name. For instance, a nickname value of Mike might be returned alongside a given_name value of Michael. */
  nickname?: string;

  /** Shorthand name by which the End-User wishes to be referred to at the RP, such as janedoe or j.doe. This value MAY be any valid JSON string including special characters such as \@, /, or whitespace. The RP MUST NOT rely upon this value being unique, as discussed in Section 5.7. */
  preferred_username?: string;

  /** URL of the End-User's profile page. The contents of this Web page SHOULD be about the End-User. */
  profile?: string;

  /** URL of the End-User's profile picture. This URL MUST refer to an image file (for example, a PNG, JPEG, or GIF image file), rather than to a Web page containing an image. Note that this URL SHOULD specifically reference a profile photo of the End-User suitable for displaying when describing the End-User, rather than an arbitrary photo taken by the End-User. */
  picture?: string;

  /** URL of the End-User's Web page or blog. This Web page SHOULD contain information published by the End-User or an organization that the End-User is affiliated with. */
  website?: string;

  /** End-User's preferred e-mail address. Its value MUST conform to the RFC 5322 [RFC5322] addr-spec syntax. The RP MUST NOT rely upon this value being unique, as discussed in Section 5.7. */
  email?: string;

  /** True if the End-User's e-mail address has been verified; otherwise false. When this Claim Value is true, this means that the OP took affirmative steps to ensure that this e-mail address was controlled by the End-User at the time the verification was performed. The means by which an e-mail address is verified is context specific, and dependent upon the trust framework or contractual agreements within which the parties are operating. */
  email_verified?: boolean;

  /** End-User's gender. Values defined by this specification are female and male. Other values MAY be used when neither of the defined values are applicable. */
  gender?: "male" | "female" | string;

  /** End-User's birthday, represented as an ISO 8601-1 [ISO8601‑1] YYYY-MM-DD format. The year MAY be 0000, indicating that it is omitted. To represent only the year, YYYY format is allowed. Note that depending on the underlying platform's date related function, providing just year can result in varying month and day, so the implementers need to take this factor into account to correctly process the dates. */
  birthdate?: string;
};

export type ReportedUserInfo = Omit<Record<string, unknown>, "error">;

export interface WRDAuthCustomizer {
  /** Invoked to look up a login name */
  lookupUsername?: (params: LookupUsernameParameters) => Promise<number | null> | number | null;
  /** Invoked after authenticating a user but before returning him to the openid client. Can be used to implement additional authorization and reject the user */
  onOpenIdReturn?: (params: OpenIdRequestParameters) => Promise<NavigateInstruction | null> | NavigateInstruction | null;
  /** Invoked when creating an OpenID Token for a third party. Allows you to add or modify claims before it's signed */
  onOpenIdToken?: (params: OpenIdRequestParameters, payload: JWTPayload) => Promise<void> | void;
  /** Invoked when the /userinfo endpoint is requested. Allows you to add or modify the returned fields */
  onOpenIdUserInfo?: (params: OpenIdRequestParameters, userinfo: ReportedUserInfo) => Promise<void> | void;
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

export interface VerifyAccessTokenResult {
  ///wrdId of the found subject
  entity: number;
  ///decoded scopes
  scopes: string[];
  ///client to which the token was provided
  client: number | null;
  ///expiration date
  expires: Date | null;
}

export interface ClientConfig {
  wrdId: number;
  clientId: string;
  clientSecret: string;
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

function preparePayload(subject: string, created: Date | null, validuntil: Date | null, options?: JWTCreationOptions): JwtPayload {
  /* All official claims are on https://www.iana.org/assignments/jwt/jwt.xhtml#claims */


  /* Adding a jwtId ensures that each token is unique and that we have no way ourselves to regenerate a token once we've given it out and hashed it
     It is also a proof that we actually generated the token even without a signature - we wouldn't have stored a hashed token without a random jwtId (all the other fields in the JWT are guessable) */
  const payload: JwtPayload = { jti: generateRandomId() };
  if (created) {
    payload.iat = Math.floor(created.getTime() / 1000);
    payload.nbf = payload.iat;
  }

  // nonce: generateRandomId("base64url", 16), //FIXME we should be generating nonce-s if requested by the openid client, but not otherwise
  if (validuntil)
    payload.exp = Math.floor(validuntil.getTime() / 1000);
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
export async function createJWT(key: JsonWebKey, keyid: string, issuer: string, subject: string, created: Date | null, validuntil: Date | null, options?: JWTCreationOptions): Promise<string> {
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

function hashClientSecret(secret: string): string {
  return hashSHA256(secret).toString("base64url");
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

  async createServiceProvider(spSettings: ServiceProviderInit): Promise<ClientConfig> {
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

  private async createTokens(subject: number, client: number | null, expires: WaitPeriod, scopes: string[], closeSessionId: string | null, nonce: string | null, customizer: WRDAuthCustomizer | null) {
    let clientInfo;
    if (client !== null) {
      clientInfo = await this.wrdschema.getFields("wrdauthServiceProvider", client, ["wrdGuid", "subjectField"]);
      if (!clientInfo)
        throw new Error(`Unable to find serviceProvider #${client}`);
    }

    const subfield = clientInfo?.subjectField || "wrdGuid";
    //@ts-ignore -- too complex and don't have an easy 'as key of wrdPerson' type
    const subjectValue = (await this.wrdschema.getFields("wrdPerson", subject, [subfield]))?.[subfield] as string;
    if (!subjectValue)
      throw new Error(`Unable to find '${subjectValue}' for subject #${subject}`);

    const creationdate = new Date;
    creationdate.setMilliseconds(0); //round down
    const validuntil = convertWaitPeriodToDate(expires, { relativeTo: creationdate });

    //ID tokens are only generated for 3rd party clients requesting an openid scope. They shouldn't be providing access to APIs and cannot be retracted by us (so we won't store them)
    let id_token: string | undefined;
    if (client && clientInfo && scopes.includes("openid")) {
      const payload = preparePayload(subjectValue, creationdate, validuntil, { audiences: [compressUUID(clientInfo?.wrdGuid)], nonce });

      //We allow customizers to hook into the payload, but we won't let them overwrite the issuer as that can only break signing
      if (customizer?.onOpenIdToken) //force-cast it to make clear which fields are already set and which you shouldn't modify
        await customizer.onOpenIdToken({ user: subject, scopes, client }, payload as JWTPayload);

      const config = await this.getKeyConfig();
      if (!config || !config.issuer || !config.signingKeys?.length)
        throw new Error(`Schema ${this.wrdschema.tag} is not configured properly. Missing issuer or signingKeys`);

      payload.iss = config.issuer;

      const bestsigningkey = config.signingKeys.sort((a, b) => b.availableSince.getTime() - a.availableSince.getTime())[0];
      const signingkey = createPrivateKey({ key: bestsigningkey.privateKey, format: 'jwk' }); //TODO use async variant
      id_token = jwt.sign(payload, signingkey, { keyid: bestsigningkey.keyId, algorithm: signingkey.asymmetricKeyType === "rsa" ? "RS256" : "ES256" });
    }

    /* We always generate access tokens (TODO or is there ever any reason not to?) though 3rd party clients aren't sure to be able to do more with it than requesting userinfo
       For our convenience we use JWT for access tokens but we don't strictly have to. We do not set an audience as we're always the audience, and we do not sign this as we
       don't care about signatures, our wrd.tokens table is leading. (we might need to sign at some point if we're going to support refresh tokens) */
    const atPayload = preparePayload(subjectValue, creationdate, validuntil, { scopes });
    const access_token = jwt.sign(atPayload, null, { algorithm: "none" });

    await beginWork();
    await db<PlatformDB>().insertInto("wrd.tokens").values({
      type: "access",
      creationdate: new Date(atPayload.nbf! * 1000),
      expirationdate: new Date(atPayload.exp! * 1000),
      entity: subject,
      client: client,
      scopes: scopes.join(" "),
      hash: hashSHA256(access_token)
    }).execute();

    if (closeSessionId)
      await closeServerSession(closeSessionId);

    await commitWork();

    return { access_token, expires: atPayload.exp!, ...(id_token ? { id_token } : null) };
  }

  /** Get userinfo for a token */
  async getUserInfo(token: string, customizer: WRDAuthCustomizer | null): Promise<ReportedUserInfo | { error: string }> {
    const tokeninfo = await this.verifyAccessToken(token);
    if ("error" in tokeninfo)
      return { error: tokeninfo.error };
    if (!tokeninfo.client)
      return { error: "WRDAuth login tokens are not valid for OpenID /userinfo endpoints" };

    const userfields = await this.wrdschema.getFields("wrdPerson", tokeninfo.entity, ["wrdFullName", "wrdFirstName", "wrdLastName"/*,"wrdContactEmail"*/]);
    if (!userfields)
      return { error: "No such user" };

    const decoded = jwt.decode(token, { complete: true });
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
      await customizer?.onOpenIdUserInfo({ client: tokeninfo.client, scopes: tokeninfo.scopes, user: tokeninfo.entity }, userinfo);

    return userinfo;
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

  /** Verify a token we gave out ourselves. Also checks against retracted tokens
   * @param token - The token to verify
  */
  async verifyAccessToken(token: string): Promise<VerifyAccessTokenResult | { error: string }> {
    //TODO verify that this schema
    const hashed = hashSHA256(token);
    const matchToken = await db<PlatformDB>().selectFrom("wrd.tokens").where("hash", "=", hashed).select(["entity", "client", "expirationdate", "scopes", "type"]).executeTakeFirst();
    if (!matchToken || matchToken.type !== "access" || matchToken.expirationdate < new Date)
      return { error: `Token is invalid` };

    //TOODO verify this schema actually owns the entity (but not sure what the risks are if you mess up endpoints?)
    return {
      entity: matchToken.entity,
      scopes: matchToken.scopes.length ? matchToken.scopes.split(' ') : [],
      client: matchToken.client,
      expires: matchToken.expirationdate
    };
  }

  private getOpenIdBase() {
    const schemaparts = this.wrdschema.tag.split(":");
    return "/.wh/openid/" + encodeURIComponent(schemaparts[0]) + "/" + encodeURIComponent(schemaparts[1]) + "/";
  }

  /** Start an oauth2/openid authorization flow */
  async startAuthorizeFlow(url: string, loginPage: string, customizer: WRDAuthCustomizer | null): Promise<NavigateOrError> {
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

  async returnAuthorizeFlow(url: string, user: number, customizer: WRDAuthCustomizer | null): Promise<NavigateOrError> {
    const searchParams = new URL(url).searchParams;
    const sessionid = searchParams.get("tok") || '';
    const returnInfo = await getServerSession("wrd:openid.idpstate", sessionid);
    if (!returnInfo)
      return { error: "Session has expired" }; //TODO redirect the user to an explanatory page

    //TODO verify this schema actually owns the entity (but not sure what the risks are if you mess up endpoints?)
    if (customizer?.onOpenIdReturn) {
      const redirect = await customizer.onOpenIdReturn({
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
  async retrieveTokens(form: URLSearchParams, headers: Headers, customizer: WRDAuthCustomizer | null): Promise<{ error: string } | { error: null; body: TokenResponse }> {
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

    const expires = this.config.expires || "P1D";
    const tokens = await this.createTokens(returnInfo.user, returnInfo.clientid, expires, returnInfo.scopes, sessionid, returnInfo.nonce, customizer);
    return {
      error: null,
      body: {
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        token_type: "Bearer",
        expires_in: Math.floor(tokens.expires - (Date.now() / 1000)),
      }
    };
  }

  /** Create an access token for WRD's local use */
  async createFirstPartyToken(userid: number, customizer: WRDAuthCustomizer | null): Promise<{ accessToken: string; expires: Date }> {
    //FIXME adopt expiry settings from HS WRDAuth
    const tokens = await this.createTokens(userid, null, "P1D", [], null, null, customizer);
    return {
      accessToken: tokens.access_token,
      expires: new Date(tokens.expires * 1000)
    };
  }

  private async lookupUser(authsettings: WRDAuthSettings, loginname: string, customizer: WRDAuthCustomizer | null, options?: LoginUsernameLookupOptions): Promise<number | null> {
    if (!authsettings.loginAttribute)
      throw new Error("No login attribute defined for WRD schema " + this.wrdschema.tag);

    if (customizer?.lookupUsername)
      return await customizer.lookupUsername({ username: loginname, ...pick(options || {}, ["site"]) });

    const user = await this.wrdschema.search("wrdPerson", authsettings.loginAttribute as AttrRef<WRD_Idp_WRDPerson>, loginname);
    return user || null;
  }

  async handleFrontendLogin(username: string, password: string, customizer: WRDAuthCustomizer | null, options?: LoginRemoteOptions): Promise<LoginResult> {
    const authsettings = await getAuthSettings(this.wrdschema);
    if (!authsettings.passwordAttribute)
      throw new Error("No password attribute defined for WRD schema " + this.wrdschema.tag);

    let userid = await this.lookupUser(authsettings, username, customizer, options);
    if (userid) {
      //@ts-ignore -- how to fix? WRD TS is not flexible enough for this yet:
      const userinfo = await this.wrdschema.getFields("wrdPerson", userid, { password: authsettings.passwordAttribute }) as { password: AuthenticationSettings | null };

      //TODO ratelimits/auditing
      if (!await userinfo?.password?.verifyPassword(password))
        userid = 0;
    }

    if (!userid) {
      return {
        loggedIn: false,
        error: "Unknown username or password",
        code: authsettings.loginIsEmail ? "incorrect-email-password" : "incorrect-login-password"
      }; //TOOD gettid, adapt to whether usernames or email addresses are set up (see HS WRD, it has the tids)
    }

    return { loggedIn: true, ...await this.createFirstPartyToken(userid, customizer) };
  }
}
