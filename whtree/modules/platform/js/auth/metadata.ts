import { HTTPErrorCode, type WebHareRouter, type WebRequest, type WebResponse, createJSONResponse } from "@webhare/router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import { wrd, type WRDSchemaLike } from "@webhare/wrd";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import type { IdTokenSigningAlgValuesSupported, OpenIdConfiguration } from "@webhare/auth/src/types";
import { lookupURL, openFileOrFolder } from "@webhare/whfs";
import { getOpenIDIssuer } from "./openid";

/* TODO RFC 8414 expects the metadata of an issuer with a path component (ie an identity provider site that isn't hosted
   at the root of its host) at /.well-known/oauth-authorization-server/<path>, which a site webrule can't serve. These
   sites currently only offer the OpenID Connect style /<path>/.well-known/ metadata URLs */

async function buildMetadata(req: WebRequest, type: "oauth" | "openid"): Promise<WebResponse> {
  const target = await lookupURL(new URL(req.url));
  const targetObj = target.file || target.folder;
  if (!targetObj)
    throw new Error(`Unable to trace request back to a target`);

  const tester = await getApplyTesterForObject(await openFileOrFolder(targetObj));
  const wrdSchemaTag = (await tester.getWRDAuth())?.wrdSchema;
  if (!wrdSchemaTag)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `No WRD schema defined for this location` });

  const authSchema = wrd<WRDSchemaLike["platform:basewrdschema"]>(wrdSchemaTag);
  const settings = await getSchemaSettings(authSchema, ["signingKeys", "dynamicRegistration", "loginSettings"]);
  const openIdServer = settings.loginSettings?.openIdServer === true;
  if (type === "openid" && !openIdServer)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `WRD schema '${wrdSchemaTag}' is not an OpenID Connect provider` });

  const issuer = await getOpenIDIssuer(wrdSchemaTag);
  if (!issuer)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `No identity provider site found for WRD schema '${wrdSchemaTag}'` });

  //Encode wrd:schema as /wrd/schema/ in the URL
  const oidc_baseurl = new URL(`/.wh/openid/${encodeURIComponent(wrdSchemaTag).replace('%3A', '/')}/`, req.baseURL).toString();

  //RFC 8414 fields. See also https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#authorization-server-metadata
  const oauthMetadata = {
    issuer,
    authorization_endpoint: oidc_baseurl + "authorize",
    token_endpoint: oidc_baseurl + "token",
    ...settings.dynamicRegistration?.enabled === true ? { registration_endpoint: oidc_baseurl + "register" } : {},
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code"],
    response_modes_supported: ["query", "fragment", "form_post"],
    //we many need to add various id_token/token combinations too? but they may only apply to implicit flows?
    //see also https://openid.net/specs/oauth-v2-multiple-response-types-1_0.html
    response_types_supported: ["code"],
  } satisfies OpenIdConfiguration;

  if (!openIdServer)
    return createJSONResponse(200, oauthMetadata);

  const id_token_signing_alg_values_supported: IdTokenSigningAlgValuesSupported[] = [];
  if (settings.signingKeys.find(_ => _.privateKey.kty === "RSA"))
    id_token_signing_alg_values_supported.push("RS256");
  //  can't offer ES256 yet as we haven't enabled/tested generating it yet
  // if (settings.signingKeys.find(_ => _.privateKey.kty === "EC"))
  //   id_token_signing_alg_values_supported.push("ES256");

  //See https://openid.net/specs/openid-connect-discovery-1_0.html for the basic field list
  return createJSONResponse(200, {
    ...oauthMetadata,
    jwks_uri: oidc_baseurl + 'jwks',
    userinfo_endpoint: oidc_baseurl + "userinfo",
    id_token_signing_alg_values_supported,
    scopes_supported: ["openid", "email", "profile"],
    subject_types_supported: ["public"]
  } satisfies OpenIdConfiguration);
}

/** Implements .well-known/openid-configuration (OpenID Connect Discovery). Only available if the schema is an OpenID Connect provider */
export async function wellKnownRouter(req: WebRequest): Promise<WebResponse> {
  return await buildMetadata(req, "openid");
}

/** Implements .well-known/oauth-authorization-server (RFC 8414). Includes the OpenID fields if the schema is an OpenID Connect provider */
export async function oauthAuthorizationServerRouter(req: WebRequest): Promise<WebResponse> {
  return await buildMetadata(req, "oauth");
}

// validate signatures
wellKnownRouter satisfies WebHareRouter;
oauthAuthorizationServerRouter satisfies WebHareRouter;
