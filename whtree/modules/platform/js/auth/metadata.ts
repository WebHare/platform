import { HTTPErrorCode, type WebHareRouter, type WebRequest, type WebResponse, createJSONResponse } from "@webhare/router";
import { lookupPublishedTarget } from "@webhare/router/src/corerouter";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import type { Platform_BasewrdschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { WRDSchema } from "@webhare/wrd";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import type { IdTokenSigningAlgValuesSupported, OpenIdConfiguration } from "@webhare/auth/src/types";

//wellKnownRouter implements .well-known/openid-configuration
export async function wellKnownRouter(req: WebRequest): Promise<WebResponse> {
  const target = await lookupPublishedTarget(req.url.toString()); //TODO can't we use 'obj' directly instead of going through a URL lookup?
  if (!target?.targetObject)
    throw new Error(`Unable to trace rqeuest back to a target`);

  const tester = await getApplyTesterForObject(target.targetObject);
  const wrdSchemaTag = (await tester.getWRDAuth())?.wrdSchema;
  if (!wrdSchemaTag)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `No WRD schema defined for this location` });

  const authSchema = new WRDSchema<Platform_BasewrdschemaSchemaType>(wrdSchemaTag);
  const settings = await getSchemaSettings(authSchema, ["issuer", "signingKeys"]);
  if (!settings.issuer)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `WRD schema '${wrdSchemaTag}' is not configured with a JWKS issuer` });

  const id_token_signing_alg_values_supported: IdTokenSigningAlgValuesSupported[] = [];
  if (settings.signingKeys.find(_ => _.privateKey.kty === "RSA"))
    id_token_signing_alg_values_supported.push("RS256");
  //  can't offer ES256 yet as we haven't enabled/tested generating it yet
  // if (settings.signingKeys.find(_ => _.privateKey.kty === "EC"))
  //   id_token_signing_alg_values_supported.push("ES256");

  //Encode wrd:schema as /wrd/schema/ in the URL
  const oidc_baseurl = new URL(`/.wh/openid/${encodeURIComponent(wrdSchemaTag).replace('%3A', '/')}/`, req.baseURL).toString();
  //See https://openid.net/specs/openid-connect-discovery-1_0.html for the basic field list
  return createJSONResponse(200, {
    issuer: settings.issuer,
    jwks_uri: oidc_baseurl + 'jwks',
    authorization_endpoint: oidc_baseurl + "authorize",
    token_endpoint: oidc_baseurl + "token",
    userinfo_endpoint: oidc_baseurl + "userinfo",
    id_token_signing_alg_values_supported,
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    scopes_supported: ["openid", "email", "profile"],
    //we many need to add various id_token/token combinations too? but they may only apply to implicit flows?
    //see also https://openid.net/specs/oauth-v2-multiple-response-types-1_0.html
    response_types_supported: ["code"],
    subject_types_supported: ["public"]
  } satisfies OpenIdConfiguration);

}

// validate signatures
wellKnownRouter satisfies WebHareRouter;
