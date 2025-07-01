import type { AnySchemaTypeDefinition, SchemaTypeDefinition } from "@webhare/wrd/src/types";
import type { NavigateInstruction } from "@webhare/env";
import type { WRDSchema } from "@webhare/wrd";
import type { LoginErrorCode } from "./shared";

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

export interface LoginUsernameLookupOptions {
  /** Login to a specific site */
  site?: string;
}

export interface LookupUsernameParameters<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> extends LoginUsernameLookupOptions {
  /** Current WRD schema */
  wrdSchema: WRDSchema<S>;
  /** Username to look up */
  username: string;
  /** JWT payload if we're coming in through an OpenID Connect (OIDC) flow */
  jwtPayload?: JWTPayload;
}

export interface IsAllowedToLoginParameters<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> { //Could imagine adding IP/GEO and browser info to these parameters
  /** Current WRD schema */
  wrdSchema: WRDSchema<S>;
  /** User id to check */
  user: number;
}

export interface FrontendRequestParameters<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> {
  /** Current WRD schema */
  wrdSchema: WRDSchema<S>;
  /** User id to check (available since WH 5.8) */
  user: number;

  /** User id to check
  @deprecated Deprecated since W5.8 for consistency as all the other Parameters use 'entityid' */
  entityId: number;
}

/** @deprecated Use FrontendRequestParameters instead */
export type FrontendUserInfoParameters<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> = FrontendRequestParameters<S>;

export interface OpenIdRequestParameters<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> {
  /** Current WRD schema */
  wrdSchema: WRDSchema<S>;
  /// ID of the client requesting the token
  client: number;
  /// Requested scopes
  scopes: string[];
  /// ID of the WRD user that has authenticated
  user: number;
}

export type ReportedUserInfo = Record<string, unknown> & { error?: never };


export type LoginDeniedInfo = {
  error: string;
  code: LoginErrorCode;
};

export interface AuthCustomizer<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> {
  /** Invoked to look up a login name */
  lookupUsername?: (params: LookupUsernameParameters<S>) => Promise<number | null> | number | null;
  /** Invoked to verify whether a user is allowed to login */
  isAllowedToLogin?: (params: IsAllowedToLoginParameters<S>) => Promise<LoginDeniedInfo | null> | LoginDeniedInfo | null;
  /** Invoked after authenticating a user but before returning him to the openid client. Can be used to implement additional authorization and reject the user */
  onOpenIdReturn?: (params: OpenIdRequestParameters<S>) => Promise<NavigateInstruction | null> | NavigateInstruction | null;
  /** Invoked when creating an OpenID Token for a third party. Allows you to add or modify claims before it's signed */
  onOpenIdToken?: (params: OpenIdRequestParameters<S>, payload: JWTPayload) => Promise<void> | void;
  /** Invoked when the /userinfo endpoint is requested. Allows you to add or modify the returned fields */
  onOpenIdUserInfo?: (params: OpenIdRequestParameters<S>, userinfo: ReportedUserInfo) => Promise<void> | void;
  /** Invoked when creating an access token. Allows you to add or modify claims before it's signed */
  onFrontendIdToken?: (params: FrontendRequestParameters<S>, payload: JWTPayload) => Promise<void> | void;
  /** Invoked when the user logged in to the frontend, returned to clientside JavaScript */
  onFrontendUserInfo?: (params: FrontendRequestParameters<S>) => Promise<object> | object;
}
