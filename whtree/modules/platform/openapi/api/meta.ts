import { type AuthorizedWRDAPIUser, type OpenAPIResponse, HTTPSuccessCode, type OpenAPIRequest, type OpenAPIAuthorization, failWRDAPIUserAuth, verifyWRDAPIUser, type OpenAPIAuthorizationFunction } from "@webhare/openapi-service";
import type { TypedRestRequest } from "modules/platform/generated/openapi/platform/api";

import { WRDSchema } from "@webhare/wrd";
import { getAuthorizationInterface } from "@webhare/auth";

export async function verifyUser(req: OpenAPIRequest): Promise<OpenAPIAuthorization<AuthorizedWRDAPIUser>> {
  const basecheck = await verifyWRDAPIUser(req);
  if (!basecheck.authorized)
    return basecheck;

  //Check whether this user is allowed to access the API
  const rightsChecker = getAuthorizationInterface(basecheck.authorization.userId);
  if (!await rightsChecker.hasRight("platform:api"))
    return failWRDAPIUserAuth(`User is not authorized to access the WebHare API`);

  if (!await rightsChecker.hasRight("system:sysop")) //TODO APIs themselves SHOULD check whatever you're trying to do by testing against an intersection of your rights and scopes, but for now juist require sysop rights and tokens
    return failWRDAPIUserAuth(`User does not have the privileges to share what is currently scoped`);
  if (!basecheck.authorization.scopes.includes("system:sysop"))
    return failWRDAPIUserAuth(`User lacks required scope`);

  return basecheck;
}

export async function getMeta(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /meta">): Promise<OpenAPIResponse> {
  const wrdschema = new WRDSchema(req.authorization.wrdSchema);
  //TODO get the proper type and email/auth info from the wrdschema settings
  const user = await wrdschema.getFields("wrdPerson", req.authorization.userId, ["wrdContactEmail", "wrdGuid"]);
  return req.createJSONResponse(HTTPSuccessCode.Ok, {
    user: {
      guid: user.wrdGuid,
      email: user.wrdContactEmail
    }
  });
}


//validate signatures
verifyUser satisfies OpenAPIAuthorizationFunction;
