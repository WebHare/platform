import { HTTPErrorCode, type WebHareRouter, type WebRequest, type WebResponse, createJSONResponse, createWebResponse } from "@webhare/router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import { wrd, type WRDSchemaLike } from "@webhare/wrd";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import type { IdTokenSigningAlgValuesSupported, OpenIdConfiguration } from "@webhare/auth/src/types";
import { lookupURL, openFileOrFolder } from "@webhare/whfs";
import { getOpenIDIssuer } from "./openid";

const oauthWellKnownPath = "/.well-known/oauth-authorization-server";

/* Metadata is offered at two kinds of locations:
   - "suffix": the well-known path appended to the issuer, ie /<path>/.well-known/<name>. This is the OpenID Connect
     Discovery location, and for an issuer without a path also the RFC 8414 location. Served by site webrules.
   - "inserted": the well-known path inserted between the host and the issuer's path, ie /.well-known/<name>/<path>.
     RFC 8414 section 3.1 expects the metadata of an issuer with a path component (ie an identity provider site that
     isn't hosted at the root of its host) there. Served by an allroots webrule as it's outside the site */
type MetadataLocation = "suffix" | "inserted";

async function buildMetadata(req: WebRequest, type: "oauth" | "openid", location: MetadataLocation = "suffix"): Promise<WebResponse> {
  const requestedUrl = new URL(req.url);
  requestedUrl.search = "";

  /* For the inserted form, the path after the well-known path is the issuer's path. Look up the site from there.
     The path is empty for an issuer at the root (/.well-known/oauth-authorization-server/). Concatenate with the origin
     instead of resolving it relative to it, so a path like '//' can't be interpreted as a protocol-relative URL */
  const issuerLocation = location === "inserted"
    ? new URL(requestedUrl.origin + requestedUrl.pathname.substring(oauthWellKnownPath.length).replace(/\/+$/, "") + "/")
    : requestedUrl;
  const target = await lookupURL(issuerLocation);
  const targetObj = target.file || target.folder;
  if (!targetObj) {
    if (location === "inserted")
      return createJSONResponse(HTTPErrorCode.NotFound, { error: `No site found at ${issuerLocation.toString()}` });
    throw new Error(`Unable to trace request back to a target`);
  }

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

  /* The issuer must match the location the metadata was retrieved from (RFC 8414 section 3.3, OpenID Connect Discovery
     section 4.3), so we refuse to serve metadata through an alias hostname or other URL than the identity provider site's webroot */
  const expectedUrl = location === "inserted"
    ? new URL(issuer).origin + oauthWellKnownPath + new URL(issuer).pathname
    : issuer + requestedUrl.pathname.substring(requestedUrl.pathname.lastIndexOf("/.well-known/"));
  if (requestedUrl.toString() !== expectedUrl)
    return createWebResponse(`This metadata is only available at ${expectedUrl}\n\n`
      + `The issuer of WRD schema '${wrdSchemaTag}' is ${issuer} (derived from the webroot of the site with the platform:identityprovider webfeature). `
      + `RFC 8414 and OpenID Connect Discovery require the issuer to match the URL the metadata is retrieved from, `
      + `so clients would reject the metadata if we served it at ${requestedUrl.toString()}\n`, {
      status: HTTPErrorCode.NotFound,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });

  //Encode wrd:schema as /wrd/schema/ in the URL
  const oidc_baseurl = new URL(`/.wh/openid/${encodeURIComponent(wrdSchemaTag).replace(/%3A/g, '/')}/`, req.baseURL).toString();

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

/** Implements /.well-known/oauth-authorization-server/<path> (RFC 8414 section 3.1) for identity provider sites hosted at a path */
export async function oauthAuthorizationServerInsertedRouter(req: WebRequest): Promise<WebResponse> {
  return await buildMetadata(req, "oauth", "inserted");
}

// validate signatures
wellKnownRouter satisfies WebHareRouter;
oauthAuthorizationServerRouter satisfies WebHareRouter;
oauthAuthorizationServerInsertedRouter satisfies WebHareRouter;
