import { WebHareRouter, WebRequest, WebResponse, createJSONResponse } from "@webhare/router";
import { lookupPublishedTarget } from "@webhare/router/src/corerouter";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import type { Platform_BasewrdschemaSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { WRDSchema } from "@webhare/wrd";
import { getSchemaSettings } from "@webhare/wrd/src/settings";

export async function wellKnownRouter(req: WebRequest): Promise<WebResponse> {
  const target = await lookupPublishedTarget(req.url.toString()); //TODO can't we use 'obj' directly instead of going through a URL lookup?
  if (!target?.targetObject)
    throw new Error(`Unable to trace rqeuest back to a target`);

  const tester = await getApplyTesterForObject(target.targetObject);
  const wrdSchemaTag = (await tester.getWRDAuth())?.wrdSchema;
  if (!wrdSchemaTag)
    throw new Error(`No WRD schema defined for this location`);

  const authSchema = new WRDSchema<Platform_BasewrdschemaSchemaType>(wrdSchemaTag);
  const settings = await getSchemaSettings(authSchema, ["issuer"]);
  if (!settings.issuer)
    throw new Error(`WRD schema '${wrdSchemaTag}' is not configured with a JWKS issuer`);

  const oidc_baseurl = new URL(`/.wh/openid/${encodeURIComponent(wrdSchemaTag)}/`, req.baseURL).toString();
  return createJSONResponse(200, {
    issuer: settings.issuer,
    jwks_uri: oidc_baseurl + 'jwks',
    authorization_endpoint: oidc_baseurl + "authorize",
    token_endpoint: oidc_baseurl + "token",
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  });

}

// validate signatures
wellKnownRouter satisfies WebHareRouter;

